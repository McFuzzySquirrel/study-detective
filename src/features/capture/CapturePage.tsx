/**
 * The capture route: one photo path for notes and sources, with optional
 * images on topics.
 *
 * The page owns the step machine, object URL, abort controllers, and progress
 * announcements. Validation, image processing, and persistence stay behind the
 * capture APIs: this file never decodes an image, touches Dexie, or writes an
 * attachment row itself.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import Button from '../../components/Button';
import { MAX_BOARD_CARDS, SPLIT_CASE_MESSAGE, canAddCard } from '../../board/boardCapacity';
import { CaseRepository } from '../../data/caseRepository';
import type { CaseRepositoryPort } from '../../data/caseRepository';
import { openNotesDetectiveDatabase } from '../../data/db';
import type { CaseRecord } from '../../domain/model';
import type { OcrResult } from '../ocr/ocrWorker';
import {
  importImageCard,
  type CardImportOutcome,
  type ImageCardType,
  type ImportImageCardInput,
  type ImportImageCardOptions,
  type ImportStage,
} from './cardImport';
import {
  isAbortError,
  validateImageFile,
  type ImageValidationResult,
  type SupportedImageMime,
} from './imageValidation';
import { FULL_CROP, type CropRect, type Rotation } from './imagePipeline';
import {
  computeInitialCardPosition,
  readBrowserViewportSize,
  type CaptureViewportSize,
} from './capturePosition';
import CaptureSourcePicker from './CaptureSourcePicker';
import CropRotateEditor from './CropRotateEditor';
import type { CropResult } from './CropRotateEditor';
import NoteSourceForm from './NoteSourceForm';
import type { NoteSourceValues } from './NoteSourceForm';
import TopicForm from './TopicForm';
import type { TopicFormValues } from './TopicForm';

import './capture.css';

export type CaptureImageValidator = (
  file: File,
  options?: { readonly signal?: AbortSignal },
) => Promise<ImageValidationResult>;

export type CaptureImageImporter = (
  input: ImportImageCardInput,
  options: ImportImageCardOptions,
) => Promise<CardImportOutcome>;

export type CaptureRepositoryLoader = () => Promise<CaseRepositoryPort>;

export interface CapturePageProps {
  /** Injected repository for route composition and component tests. */
  readonly repository?: CaseRepositoryPort | undefined;
  /** Injected opener used by the route table and failure-state tests. */
  readonly loadRepository?: CaptureRepositoryLoader | undefined;
  /** Defaults to the real local image validation. */
  readonly validateImage?: CaptureImageValidator | undefined;
  /** Defaults to the real atomic card import. */
  readonly importCard?: CaptureImageImporter | undefined;
  /** Defaults to the visible browser viewport. */
  readonly readViewportSize?: (() => CaptureViewportSize) | undefined;
}

type Step =
  | 'loading'
  | 'load-error'
  | 'capacity-blocked'
  | 'picker'
  | 'validating'
  | 'crop'
  | 'details'
  | 'topic'
  | 'saving'
  | 'failed';

type LoadFailure = {
  readonly message: string;
  readonly canRetry: boolean;
};

type PendingCard = {
  readonly file: File;
  readonly type: ImageCardType;
  readonly title: string;
  readonly details?: string;
  readonly retainFullResolution: boolean;
  readonly tags: readonly string[];
  readonly crop: CropRect;
  readonly rotation: Rotation;
  readonly position: ImportImageCardInput['position'];
  readonly ocr?: OcrResult;
};

type PendingTopic = {
  readonly title: string;
  readonly tags: readonly string[];
  readonly position: ImportImageCardInput['position'];
};

type CaptureFailure =
  | { readonly stage: 'validation'; readonly message: string; readonly file: File }
  | { readonly stage: 'import'; readonly message: string; readonly draft: PendingCard }
  | { readonly stage: 'topic'; readonly message: string; readonly draft: PendingTopic };

type SavingKind = 'image' | 'topic' | null;

const STEP_LABELS: Record<Step, string> = {
  loading: 'Opening the case',
  'load-error': 'The case could not be opened',
  'capacity-blocked': 'This case is full',
  picker: 'Add evidence',
  validating: 'Checking the photo',
  crop: 'Crop and rotate',
  details: 'Name the card',
  topic: 'Add a topic',
  saving: 'Saving the card',
  failed: 'No card was saved',
};

const IMPORT_STAGE_LABELS: Record<ImportStage, string> = {
  validating: 'Checking the photo…',
  decoding: 'Reading the photo…',
  transforming: 'Applying the crop and rotation…',
  encoding: 'Preparing the image files…',
  saving: 'Saving the card…',
  done: 'Card saved.',
};

const IMPORT_STAGE_VALUES: Record<ImportStage, number> = {
  validating: 1,
  decoding: 2,
  transforming: 3,
  encoding: 4,
  saving: 5,
  done: 6,
};

const IMPORT_STAGE_COUNT = 6;

let defaultRepositoryPromise: Promise<CaseRepositoryPort> | null = null;

/** Open the one production database handle, forgetting a failed open so Retry works. */
function openDefaultRepository(): Promise<CaseRepositoryPort> {
  if (defaultRepositoryPromise === null) {
    defaultRepositoryPromise = openNotesDetectiveDatabase()
      .then((database) => new CaseRepository(database))
      .catch((error: unknown) => {
        defaultRepositoryPromise = null;
        throw error;
      });
  }

  return defaultRepositoryPromise;
}

function createPreviewUrl(file: File): string | null {
  if (typeof URL.createObjectURL !== 'function') {
    return null;
  }

  try {
    return URL.createObjectURL(file);
  } catch {
    return null;
  }
}

function revokePreviewUrl(url: string): void {
  if (typeof URL.revokeObjectURL !== 'function') {
    return;
  }

  try {
    URL.revokeObjectURL(url);
  } catch {
    // A preview URL is best-effort cleanup; the card never depends on it.
  }
}

function SavingProgress({
  kind,
  stage,
  onCancel,
}: {
  readonly kind: Exclude<SavingKind, null>;
  readonly stage: ImportStage | null;
  readonly onCancel: () => void;
}) {
  const cancelable = kind === 'image' && stage !== 'saving' && stage !== 'done';
  const heading =
    kind === 'topic'
      ? 'Saving the topic…'
      : stage === null
        ? 'Preparing the card…'
        : IMPORT_STAGE_LABELS[stage];

  return (
    <div
      className="capture__progress"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-busy="true"
    >
      <h3>{heading}</h3>
      <p>
        {kind === 'topic'
          ? 'Writing the topic to this case. No image is involved.'
          : 'The card and its image files are written together. Keep this screen open until it finishes.'}
      </p>
      {kind === 'image' ? (
        <progress
          className="capture__progress-meter"
          max={IMPORT_STAGE_COUNT}
          value={stage === null ? 0 : IMPORT_STAGE_VALUES[stage]}
          aria-label="Photo import progress"
        />
      ) : null}
      {cancelable ? (
        <div className="capture__progress-actions">
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function CapturePage({
  repository,
  loadRepository,
  validateImage = validateImageFile,
  importCard = importImageCard,
  readViewportSize = readBrowserViewportSize,
}: CapturePageProps) {
  const { caseId: caseIdParam } = useParams();
  const caseId = caseIdParam ?? '';
  const casePath = `/case/${caseId}`;
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // The empty board and card list link straight to one capture kind. A topic
  // opens its text form; note/source keep the shared photo picker and preselect
  // the final card type.
  const requestedKind = searchParams.get('kind');
  const initialImageType: Extract<ImageCardType, 'note' | 'source'> =
    requestedKind === 'source' ? 'source' : 'note';

  const [step, setStep] = useState<Step>('loading');
  const [loadFailure, setLoadFailure] = useState<LoadFailure | null>(null);
  const [caseRecord, setCaseRecord] = useState<CaseRecord | null>(null);
  const [activeRepository, setActiveRepository] = useState<CaseRepositoryPort | null>(null);
  const [existingCardCount, setExistingCardCount] = useState(0);
  const [reloadToken, setReloadToken] = useState(0);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedMime, setSelectedMime] = useState<SupportedImageMime | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [sourceSize, setSourceSize] = useState<CaptureViewportSize | null>(null);
  const [cropResult, setCropResult] = useState<CropResult | null>(null);

  const [pendingCard, setPendingCard] = useState<PendingCard | null>(null);
  const [failure, setFailure] = useState<CaptureFailure | null>(null);
  const [savingKind, setSavingKind] = useState<SavingKind>(null);
  const [progressStage, setProgressStage] = useState<ImportStage | null>(null);

  const stepRef = useRef<HTMLDivElement>(null);
  const firstStepRef = useRef(true);
  const previewUrlRef = useRef<string | null>(null);
  const validationControllerRef = useRef<AbortController | null>(null);
  const importControllerRef = useRef<AbortController | null>(null);

  const resolveRepository = useCallback<CaptureRepositoryLoader>(() => {
    if (repository !== undefined) {
      return Promise.resolve(repository);
    }
    return (loadRepository ?? openDefaultRepository)();
  }, [repository, loadRepository]);

  const releasePreview = useCallback((): void => {
    const current = previewUrlRef.current;
    previewUrlRef.current = null;

    if (current !== null) {
      revokePreviewUrl(current);
    }
  }, []);

  /**
   * The shared 200-card guard. A direct capture address and a stale picker
   * both land here before any validation, image work, or repository write.
   */
  const blockAtCapacity = useCallback((): boolean => {
    if (canAddCard(existingCardCount)) {
      return false;
    }

    releasePreview();
    setPreviewUrl(null);
    setSelectedFile(null);
    setSelectedMime(null);
    setCropResult(null);
    setSourceSize(null);
    setFailure(null);
    setStep('capacity-blocked');
    return true;
  }, [existingCardCount, releasePreview]);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      setStep('loading');
      setLoadFailure(null);

      if (caseId.length === 0) {
        setLoadFailure({ message: 'This address does not name a case.', canRetry: false });
        setStep('load-error');
        return;
      }

      try {
        const target = await resolveRepository();
        if (cancelled) {
          return;
        }

        const record = await target.getCase(caseId);
        if (cancelled) {
          return;
        }

        if (record === null) {
          setActiveRepository(target);
          setLoadFailure({
            message: 'This case is not on the shelf. It may have been deleted.',
            canRetry: false,
          });
          setStep('load-error');
          return;
        }

        const cards = await target.listCards(caseId);
        if (cancelled) {
          return;
        }

        setActiveRepository(target);
        setCaseRecord(record);
        setExistingCardCount(cards.length);
        setStep(
          canAddCard(cards.length)
            ? requestedKind === 'topic'
              ? 'topic'
              : 'picker'
            : 'capacity-blocked',
        );
      } catch {
        if (!cancelled) {
          setActiveRepository(null);
          setLoadFailure({
            message: 'The local case database could not be reached. Nothing was added or changed.',
            canRetry: true,
          });
          setStep('load-error');
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [caseId, requestedKind, resolveRepository, reloadToken]);

  // Move focus to the step container when the flow changes. This keeps the
  // keyboard path intact when the picker buttons unmount after a selection.
  useEffect(() => {
    if (firstStepRef.current) {
      firstStepRef.current = false;
      return;
    }

    if (step !== 'loading') {
      stepRef.current?.focus();
    }
  }, [step]);

  // A route change must cancel in-flight work and release the preview URL
  // whether the student saved, cancelled, or navigated away.
  useEffect(
    () => () => {
      validationControllerRef.current?.abort();
      importControllerRef.current?.abort();
      releasePreview();
    },
    [releasePreview],
  );

  const beginValidation = async (file: File): Promise<void> => {
    if (blockAtCapacity()) {
      return;
    }

    releasePreview();
    setPreviewUrl(null);
    setSelectedFile(file);
    setSelectedMime(null);
    setCropResult(null);
    setSourceSize(null);
    setFailure(null);
    setStep('validating');

    validationControllerRef.current?.abort();
    const controller = new AbortController();
    validationControllerRef.current = controller;

    try {
      const result = await validateImage(file, { signal: controller.signal });

      if (controller.signal.aborted) {
        return;
      }

      if (!result.ok) {
        setFailure({ stage: 'validation', message: result.message, file });
        setStep('failed');
        return;
      }

      const url = createPreviewUrl(file);
      if (url !== null) {
        previewUrlRef.current = url;
        setPreviewUrl(url);
      }

      setSourceSize({ width: result.width, height: result.height });
      setSelectedMime(result.mime);
      if (result.mime === 'image/gif') {
        setCropResult({ crop: FULL_CROP, rotation: 0 });
        setStep('details');
      } else {
        setStep('crop');
      }
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        return;
      }

      setFailure({
        stage: 'validation',
        message: 'That image could not be read. Try another photo.',
        file,
      });
      setStep('failed');
    } finally {
      if (validationControllerRef.current === controller) {
        validationControllerRef.current = null;
      }
    }
  };

  const handleFileSelected = (file: File): void => {
    void beginValidation(file);
  };

  const handleAddTopic = (): void => {
    if (blockAtCapacity()) {
      return;
    }

    releasePreview();
    setPreviewUrl(null);
    setSelectedFile(null);
    setSelectedMime(null);
    setCropResult(null);
    setFailure(null);
    setStep('topic');
  };

  const handleCropSave = (result: CropResult): void => {
    setCropResult(result);
    setFailure(null);
    setStep('details');
  };

  const handleCropCancel = (): void => {
    releasePreview();
    setPreviewUrl(null);
    setSelectedFile(null);
    setSelectedMime(null);
    setCropResult(null);
    setSourceSize(null);
    setStep('picker');
  };

  const runImageImport = async (draft: PendingCard): Promise<void> => {
    const target = activeRepository;
    if (target === null) {
      return;
    }

    if (blockAtCapacity()) {
      return;
    }

    setFailure(null);
    setSavingKind('image');
    setProgressStage(null);
    setStep('saving');

    const controller = new AbortController();
    importControllerRef.current = controller;

    try {
      const outcome = await importCard(
        {
          file: draft.file,
          caseId,
          type: draft.type,
          title: draft.title,
          ...(draft.details !== undefined ? { details: draft.details } : {}),
          position: draft.position,
          tags: draft.tags,
          crop: draft.crop,
          rotation: draft.rotation,
          retainFullResolution: draft.retainFullResolution,
          ...(draft.ocr !== undefined
            ? {
                ocrText: draft.ocr.text,
                ocrConfidence: draft.ocr.confidence,
                ocrEngineVersion: draft.ocr.engineVersion,
                ocrUpdatedAt: draft.ocr.updatedAt,
              }
            : {}),
        },
        {
          repository: target,
          signal: controller.signal,
          onProgress: (progress) => {
            if (!controller.signal.aborted) {
              setProgressStage(progress.stage);
            }
          },
        },
      );

      if (controller.signal.aborted) {
        return;
      }

      if (outcome.status === 'cancelled') {
        releasePreview();
        navigate(casePath);
        return;
      }

      if (outcome.status === 'failed') {
        setFailure({ stage: 'import', message: outcome.message, draft });
        setSavingKind(null);
        setStep('failed');
        return;
      }

      releasePreview();
      navigate(casePath);
    } catch (error) {
      if (controller.signal.aborted || isAbortError(error)) {
        return;
      }

      setFailure({
        stage: 'import',
        message: 'The card could not be saved. Try again.',
        draft,
      });
      setSavingKind(null);
      setStep('failed');
    } finally {
      if (importControllerRef.current === controller) {
        importControllerRef.current = null;
      }
    }
  };

  const runTopicSave = async (draft: PendingTopic): Promise<void> => {
    const target = activeRepository;
    if (target === null) {
      return;
    }

    if (blockAtCapacity()) {
      return;
    }

    setFailure(null);
    setSavingKind('topic');
    setStep('saving');

    try {
      await target.createCard({
        caseId,
        type: 'topic',
        title: draft.title,
        position: draft.position,
        tags: draft.tags,
      });
      navigate(casePath);
    } catch {
      setFailure({
        stage: 'topic',
        message: 'The topic could not be saved. Try again.',
        draft,
      });
      setSavingKind(null);
      setStep('failed');
    }
  };

  const nextPosition = (): ImportImageCardInput['position'] | null => {
    if (caseRecord === null) {
      return null;
    }

    return computeInitialCardPosition(caseRecord.viewport, readViewportSize(), existingCardCount);
  };

  const handleNoteSourceSubmit = (values: NoteSourceValues): void => {
    if (blockAtCapacity()) {
      return;
    }

    if (selectedFile === null || cropResult === null) {
      return;
    }

    const position = nextPosition();
    if (position === null) {
      return;
    }

    const draft: PendingCard = {
      file: selectedFile,
      type: values.type,
      title: values.title,
      ...(values.details !== undefined ? { details: values.details } : {}),
      retainFullResolution: values.retainFullResolution,
      tags: values.tags ?? [],
      crop: cropResult.crop,
      rotation: cropResult.rotation,
      position,
      ...(values.ocr !== undefined ? { ocr: values.ocr } : {}),
    };

    setPendingCard(draft);
    void runImageImport(draft);
  };

  const handleTopicSubmit = (values: TopicFormValues): void => {
    if (blockAtCapacity()) {
      return;
    }

    const position = nextPosition();
    if (position === null) {
      return;
    }

    if (values.image !== undefined) {
      const draft: PendingCard = {
        file: values.image,
        type: 'topic',
        title: values.title,
        retainFullResolution: false,
        tags: values.tags ?? [],
        crop: { x: 0, y: 0, width: 1, height: 1 },
        rotation: 0,
        position,
      };
      setPendingCard(draft);
      void runImageImport(draft);
      return;
    }

    const draft: PendingTopic = {
      title: values.title,
      tags: values.tags ?? [],
      position,
    };
    void runTopicSave(draft);
  };

  const handleRetry = (): void => {
    const current = failure;
    if (current === null) {
      return;
    }

    if (current.stage === 'validation') {
      setFailure(null);
      void beginValidation(current.file);
      return;
    }

    if (current.stage === 'import') {
      setFailure(null);
      void runImageImport(current.draft);
      return;
    }

    setFailure(null);
    void runTopicSave(current.draft);
  };

  const cancelToCase = (): void => {
    validationControllerRef.current?.abort();
    importControllerRef.current?.abort();
    releasePreview();
    setPreviewUrl(null);
    navigate(casePath);
  };

  const handleImportCancel = (): void => {
    // Saving cannot be interrupted once the atomic write starts; the control is
    // hidden at that stage and the guard makes the intent explicit.
    if (progressStage === 'saving' || progressStage === 'done') {
      return;
    }

    importControllerRef.current?.abort();
    releasePreview();
    setPreviewUrl(null);
    navigate(casePath);
  };

  const backToCase = (): void => {
    releasePreview();
    setPreviewUrl(null);
    navigate(casePath);
  };

  const backToShelf = (): void => {
    releasePreview();
    setPreviewUrl(null);
    navigate('/');
  };

  return (
    <section className="capture" aria-labelledby="capture-title">
      <header className="capture__header">
        <div className="capture__heading">
          <p className="capture__eyebrow">Capture</p>
          <h2 id="capture-title">Capture evidence</h2>
          <p className="capture__intro">
            Add a study note, source, or topic. Images are validated and saved locally; nothing is
            uploaded.
          </p>
          {caseRecord !== null ? (
            <p className="capture__case">
              Case file: <strong>{caseRecord.title}</strong>
            </p>
          ) : null}
        </div>
      </header>

      <div
        ref={stepRef}
        className="capture__step"
        data-testid="capture-step"
        role="group"
        aria-label={STEP_LABELS[step]}
        tabIndex={-1}
      >
        {step === 'loading' ? (
          <p className="capture__status" role="status">
            Opening the case…
          </p>
        ) : null}

        {step === 'load-error' && loadFailure !== null ? (
          <section
            className="capture__failure"
            role="alert"
            aria-labelledby="capture-load-error-title"
          >
            <h3 id="capture-load-error-title">Case could not open</h3>
            <p>{loadFailure.message}</p>
            <div className="capture__failure-actions">
              {loadFailure.canRetry ? (
                <Button
                  variant="primary"
                  onClick={() => {
                    setReloadToken((token) => token + 1);
                  }}
                >
                  Retry
                </Button>
              ) : null}
              <Button variant="quiet" onClick={backToShelf}>
                Back to case shelf
              </Button>
            </div>
          </section>
        ) : null}

        {step === 'capacity-blocked' ? (
          <section
            className="capture__failure capture__capacity-blocked"
            role="alert"
            aria-labelledby="capture-capacity-title"
            data-testid="capture-capacity-blocked"
          >
            <h3 id="capture-capacity-title">Case board is full</h3>
            <p>
              This case already has {Math.max(existingCardCount, MAX_BOARD_CARDS)} cards, the hard
              limit of {MAX_BOARD_CARDS}. No card was added.
            </p>
            <p>{SPLIT_CASE_MESSAGE}</p>
            <p>
              The direct capture address cannot bypass this limit. Split the case first, then add
              the new evidence there.
            </p>
            <div className="capture__failure-actions">
              <Button variant="primary" onClick={backToShelf}>
                Back to case shelf
              </Button>
              <Button variant="quiet" onClick={backToCase}>
                Back to case
              </Button>
            </div>
          </section>
        ) : null}

        {step === 'picker' ? (
          <CaptureSourcePicker
            cardType={initialImageType}
            onFileSelected={handleFileSelected}
            onAddTopic={handleAddTopic}
          />
        ) : null}

        {step === 'validating' ? (
          <div
            className="capture__progress"
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-busy="true"
          >
            <h3>Checking the photo…</h3>
            <p>
              Reading the image locally and confirming it is a JPEG, PNG, WebP, or GIF under 30 MB.
              Nothing is uploaded.
            </p>
            <div className="capture__progress-actions">
              <Button variant="secondary" onClick={cancelToCase}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {step === 'crop' && selectedFile !== null && sourceSize !== null ? (
          <CropRotateEditor
            imageSrc={previewUrl ?? ''}
            sourceWidth={sourceSize.width}
            sourceHeight={sourceSize.height}
            {...(cropResult !== null
              ? { initialCrop: cropResult.crop, initialRotation: cropResult.rotation }
              : {})}
            title="Crop and rotate"
            imageAlt="Selected note photo to crop and rotate"
            saveLabel="Use this crop"
            onSave={handleCropSave}
            onCancel={handleCropCancel}
          />
        ) : null}

        {step === 'details' && selectedFile !== null && cropResult !== null ? (
          <NoteSourceForm
            initialType={
              pendingCard !== null && pendingCard.type !== 'topic'
                ? pendingCard.type
                : initialImageType
            }
            initialTitle={pendingCard?.title ?? ''}
            initialDetails={pendingCard?.details ?? ''}
            initialTags={pendingCard?.tags ?? []}
            image={selectedFile}
            animated={selectedMime === 'image/gif'}
            backLabel={selectedMime === 'image/gif' ? 'Choose another image' : 'Back to crop'}
            onBack={() => {
              if (selectedMime === 'image/gif') {
                handleCropCancel();
              } else {
                setStep('crop');
              }
            }}
            onSubmit={handleNoteSourceSubmit}
          />
        ) : null}

        {step === 'topic' ? (
          <TopicForm onBack={() => setStep('picker')} onSubmit={handleTopicSubmit} />
        ) : null}

        {step === 'saving' && savingKind !== null ? (
          <SavingProgress kind={savingKind} stage={progressStage} onCancel={handleImportCancel} />
        ) : null}

        {step === 'failed' && failure !== null ? (
          <section
            className="capture__failure"
            role="alert"
            aria-labelledby="capture-failure-title"
          >
            <h3 id="capture-failure-title">No card was saved</h3>
            <p>{failure.message}</p>
            <p>Nothing was added to this case.</p>
            <div className="capture__failure-actions">
              <Button variant="primary" onClick={handleRetry}>
                Retry
              </Button>
              <Button variant="quiet" onClick={backToCase}>
                Back
              </Button>
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}

export default CapturePage;
