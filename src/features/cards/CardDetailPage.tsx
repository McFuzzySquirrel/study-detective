/**
 * Card detail for one photo or topic card.
 *
 * The screen renders repository data and composes two owning APIs: title
 * updates through `updateCard`, and photo replacement through the local image
 * pipeline followed by `replaceCardAttachments`. The card ID is never changed,
 * no Dexie table is opened here, and the view owns every object URL it creates.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import Button from '../../components/Button';
import Dialog from '../../components/Dialog';
import Field from '../../components/Field';
import Toast from '../../components/Toast';
import type { ToastTone } from '../../components/Toast';
import { CaseRepository } from '../../data/caseRepository';
import type { CaseRepositoryPort } from '../../data/caseRepository';
import { ConnectionRepository } from '../../data/connectionRepository';
import type { ConnectionRepositoryPort } from '../../data/connectionRepository';
import { openNotesDetectiveDatabase } from '../../data/db';
import type {
  AttachmentKind,
  AttachmentMime,
  CardRecord,
  CaseRecord,
  ConnectionRecord,
} from '../../domain/model';
import { TITLE_MAX_LENGTH } from '../../domain/model';
import { FULL_CROP, type CropRect, type Rotation } from '../capture/imagePipeline';
import CropRotateEditor from '../capture/CropRotateEditor';
import type { CropResult } from '../capture/CropRotateEditor';
import ConnectionPicker from '../connections/ConnectionPicker';
import type { ConnectionPickerIntent } from '../connections/ConnectionPicker';
import { connectionTypeLabel } from '../connections/useUndoDeleteConnection';
import OcrPanel from '../ocr/OcrPanel';
import type { OcrResult } from '../ocr/ocrWorker';
import TagInput from '../search/TagInput';
import {
  replaceCardPhoto as replaceCardPhotoWithPipeline,
  type CardPhotoSource,
  type ReplaceCardPhotoInput,
  type ReplaceCardPhotoOptions,
  type ReplaceCardPhotoOutcome,
  type ReplaceProgress,
  type ReplaceStage,
} from './cardReplace';

import './CardDetail.css';

export type CardDetailRepositoryLoader = () => Promise<CaseRepositoryPort>;
export type CardDetailConnectionRepositoryLoader = () => Promise<ConnectionRepositoryPort>;

export type CardPhotoReplacer = (
  input: ReplaceCardPhotoInput,
  options: ReplaceCardPhotoOptions,
) => Promise<ReplaceCardPhotoOutcome>;

export interface CardDetailPageProps {
  /** Injected repository for route composition and component tests. */
  readonly repository?: CaseRepositoryPort | undefined;
  /** Injected opener used by the route table and failure-state tests. */
  readonly loadRepository?: CardDetailRepositoryLoader | undefined;
  /** Injected connection write boundary for the keyboard picker. */
  readonly connectionRepository?: ConnectionRepositoryPort | undefined;
  /** Lazy connection opener; resolved only when the picker saves. */
  readonly loadConnectionRepository?: CardDetailConnectionRepositoryLoader | undefined;
  /** Defaults to the real local image pipeline plus repository replacement. */
  readonly replacePhoto?: CardPhotoReplacer | undefined;
}

type LoadStatus = 'loading' | 'ready' | 'missing' | 'error';

type ReplacementJob = {
  readonly source: CardPhotoSource;
  readonly crop?: CropRect;
  readonly rotation?: Rotation;
};

type CropSession = {
  readonly url: string;
  readonly width: number;
  readonly height: number;
  readonly blob: Blob;
  readonly mime: AttachmentMime;
};

type AttachmentView = {
  readonly kind: AttachmentKind;
  readonly id: string;
  readonly width: number;
  readonly height: number;
  readonly mime: AttachmentMime;
  readonly blob: Blob;
};

type Feedback = {
  readonly message: string;
  readonly tone: ToastTone;
};

const TYPE_LABELS: Record<CardRecord['type'], string> = {
  note: 'Study Note',
  source: 'Source',
  topic: 'Topic',
};

const REPLACE_STAGE_LABELS: Record<ReplaceStage, string> = {
  decoding: 'Reading the replacement photo…',
  transforming: 'Applying the crop and rotation…',
  encoding: 'Preparing the image files…',
  saving: 'Replacing the photo…',
  done: 'Photo replaced.',
};

const REPLACE_STAGE_VALUES: Record<ReplaceStage, number> = {
  decoding: 1,
  transforming: 2,
  encoding: 3,
  saving: 4,
  done: 5,
};

const REPLACE_STAGE_COUNT = 5;

let defaultRepositoryPromise: Promise<CaseRepositoryPort> | null = null;
let defaultConnectionRepositoryPromise: Promise<ConnectionRepositoryPort> | null = null;

/** Open the one production repository, forgetting a failed open so Retry works. */
function loadDefaultRepository(): Promise<CaseRepositoryPort> {
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

/**
 * Open the connection repository only when the picker writes. The page still
 * never opens Dexie itself; this mirrors the board's lazy opener.
 */
function loadDefaultConnectionRepository(): Promise<ConnectionRepositoryPort> {
  if (defaultConnectionRepositoryPromise === null) {
    defaultConnectionRepositoryPromise = openNotesDetectiveDatabase()
      .then((database) => new ConnectionRepository(database))
      .catch((error: unknown) => {
        defaultConnectionRepositoryPromise = null;
        throw error;
      });
  }

  return defaultConnectionRepositoryPromise;
}

function attachmentView(
  attachments: readonly {
    readonly kind: AttachmentKind;
    readonly id: string;
    readonly width: number;
    readonly height: number;
    readonly mime: AttachmentMime;
    readonly blob: Blob;
  }[],
): AttachmentView[] {
  return attachments.map((attachment) => ({
    kind: attachment.kind,
    id: attachment.id,
    width: attachment.width,
    height: attachment.height,
    mime: attachment.mime,
    blob: attachment.blob,
  }));
}

function stageIsCancelable(stage: ReplaceStage | null): boolean {
  return stage !== 'saving' && stage !== 'done';
}

/**
 * Read the stored OCR fields as one renderable result. A card written before
 * OCR existed simply has no fields; a partially written row falls back to
 * conservative metadata rather than failing the whole detail screen.
 */
function storedOcrResult(card: CardRecord): OcrResult | null {
  if (card.ocrText === undefined || card.ocrText.trim().length === 0) {
    return null;
  }

  return {
    text: card.ocrText,
    confidence: card.ocrConfidence ?? 0,
    engineVersion: card.ocrEngineVersion ?? 'Unknown',
    updatedAt: card.ocrUpdatedAt ?? card.updatedAt,
  };
}

interface TitleEditDialogProps {
  readonly initialTitle: string;
  readonly onClose: () => void;
  readonly onSubmit: (title: string) => Promise<void>;
}

/**
 * Title-only edit. The card type, photo, and position are deliberately
 * untouchable here; tags have their own editor and the dialog restores focus
 * to the Edit title trigger.
 */
function TitleEditDialog({ initialTitle, onClose, onSubmit }: TitleEditDialogProps) {
  const [title, setTitle] = useState(initialTitle);
  const [error, setError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (saving) {
      return;
    }

    const trimmed = title.trim();

    if (trimmed.length === 0) {
      setError('Enter a card title.');
      inputRef.current?.focus();
      return;
    }

    if (trimmed.length > TITLE_MAX_LENGTH) {
      setError(`Card titles can be at most ${TITLE_MAX_LENGTH} characters.`);
      inputRef.current?.focus();
      return;
    }

    setError(null);
    setFormError(null);
    setSaving(true);

    try {
      await onSubmit(trimmed);
    } catch {
      setFormError('The title could not be saved. Your text is still here; try again.');
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit card title"
      description="The title appears on the board and in the card list. The photo and type do not change."
      dismissible={!saving}
      closeOnBackdrop={!saving}
    >
      <form className="card-detail-form" onSubmit={handleSubmit} noValidate>
        <Field
          label="Card title"
          hint={`1 to ${TITLE_MAX_LENGTH} characters.`}
          error={error}
          required
        >
          {(control) => (
            <input
              {...control}
              ref={inputRef}
              type="text"
              name="title"
              value={title}
              autoComplete="off"
              maxLength={TITLE_MAX_LENGTH}
              onChange={(event) => {
                setTitle(event.currentTarget.value);
                setError(null);
                setFormError(null);
              }}
            />
          )}
        </Field>

        {formError !== null ? (
          <p className="card-detail-form__error" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="nd-dialog__actions">
          <Button variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save title'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface TagsEditDialogProps {
  readonly initialTags: readonly string[];
  readonly onClose: () => void;
  readonly onSubmit: (tags: readonly string[]) => Promise<void>;
}

/**
 * Tag-only edit. The title, type, photo, and position stay untouched; saving
 * writes the normalized set through the repository so a reload keeps it.
 */
function TagsEditDialog({ initialTags, onClose, onSubmit }: TagsEditDialogProps) {
  const [tags, setTags] = useState<readonly string[]>(initialTags);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();

    if (saving) {
      return;
    }

    setFormError(null);
    setSaving(true);

    try {
      await onSubmit(tags);
    } catch {
      setFormError('The tags could not be saved. Your changes are still here; try again.');
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit card tags"
      description="Tags help you find this card from the board and the card list. Up to 10 tags are saved with the card."
      dismissible={!saving}
      closeOnBackdrop={!saving}
    >
      <form className="card-detail-form" onSubmit={handleSubmit} noValidate>
        <TagInput
          value={tags}
          onChange={setTags}
          label="Card tags"
          listLabel="Edited card tags"
          hint="Type a tag and press Enter or comma to add it. Backspace removes the last tag."
          disabled={saving}
        />

        {formError !== null ? (
          <p className="card-detail-form__error" role="alert">
            {formError}
          </p>
        ) : null}

        <div className="nd-dialog__actions">
          <Button variant="quiet" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={saving}>
            {saving ? 'Saving…' : 'Save tags'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

interface DeleteCardDialogProps {
  readonly title: string;
  readonly onClose: () => void;
  readonly onConfirm: () => Promise<void>;
}

/**
 * Destructive confirmation. Cancel receives initial focus, Escape cancels, and
 * the dialog names the card before any attachment or connection is removed.
 */
function DeleteCardDialog({ title, onClose, onConfirm }: DeleteCardDialogProps) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const handleConfirm = async (): Promise<void> => {
    if (deleting) {
      return;
    }

    setDeleting(true);
    setError(null);

    try {
      await onConfirm();
    } catch {
      setError('The card could not be deleted. Nothing was removed; try again.');
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={`Delete “${title}”?`}
      description="Deleting this card permanently removes its photo files and every string attached to it from this device."
      size="sm"
      dismissible={!deleting}
      closeOnBackdrop={!deleting}
      initialFocusRef={cancelRef}
      actions={
        <>
          <Button ref={cancelRef} variant="quiet" onClick={onClose} disabled={deleting}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void handleConfirm()} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete card'}
          </Button>
        </>
      }
    >
      {error !== null ? (
        <p className="card-detail__dialog-error" role="alert">
          {error}
        </p>
      ) : null}
    </Dialog>
  );
}

/**
 * The routed card-detail screen. A card is addressed by both its case and card
 * IDs, so a stale cross-case URL cannot open another case's evidence.
 */
export function CardDetailPage({
  repository,
  loadRepository,
  connectionRepository,
  loadConnectionRepository,
  replacePhoto = replaceCardPhotoWithPipeline,
}: CardDetailPageProps) {
  const { caseId: caseIdParam, cardId: cardIdParam } = useParams();
  const caseId = caseIdParam ?? '';
  const cardId = cardIdParam ?? '';
  const casePath = `/case/${caseId}`;
  const navigate = useNavigate();

  const [status, setStatus] = useState<LoadStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [activeRepository, setActiveRepository] = useState<CaseRepositoryPort | null>(null);
  const [caseRecord, setCaseRecord] = useState<CaseRecord | null>(null);
  const [card, setCard] = useState<CardRecord | null>(null);
  const [cards, setCards] = useState<CardRecord[]>([]);
  const [connections, setConnections] = useState<ConnectionRecord[]>([]);
  const [attachments, setAttachments] = useState<AttachmentView[]>([]);
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);

  const [titleDialogOpen, setTitleDialogOpen] = useState(false);
  const [pickerIntent, setPickerIntent] = useState<ConnectionPickerIntent | null>(null);
  const [tagsDialogOpen, setTagsDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [cropSession, setCropSession] = useState<CropSession | null>(null);

  const [replacing, setReplacing] = useState(false);
  const [replaceProgress, setReplaceProgress] = useState<ReplaceStage | null>(null);
  const [replaceError, setReplaceError] = useState<string | null>(null);
  const [failedJob, setFailedJob] = useState<ReplacementJob | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const headingRef = useRef<HTMLHeadingElement>(null);
  const loadedCardIdRef = useRef<string | null>(null);
  const cropTriggerRef = useRef<HTMLButtonElement>(null);
  const wasCroppingRef = useRef(false);
  const restoreCropFocusRef = useRef(false);
  const replaceInputRef = useRef<HTMLInputElement>(null);
  const replaceControllerRef = useRef<AbortController | null>(null);
  const displayUrlRef = useRef<string | null>(null);
  const pendingRevokeRef = useRef<string[]>([]);
  const titleId = useId();
  const replacementTitleId = useId();

  /**
   * Apply a repository attachment set and rotate the one object URL this view
   * owns. Creating the URL here, rather than in an effect, keeps a single
   * revoke/recreate step per image and supports replacement without a flash.
   */
  const applyAttachments = useCallback((next: AttachmentView[]): void => {
    const nextDisplay =
      next.find((attachment) => attachment.kind === 'display') ??
      next.find((attachment) => attachment.kind === 'original') ??
      next.find((attachment) => attachment.kind === 'thumbnail') ??
      null;

    let nextUrl: string | null = null;
    if (nextDisplay !== null && typeof URL.createObjectURL === 'function') {
      try {
        nextUrl = URL.createObjectURL(nextDisplay.blob);
      } catch {
        nextUrl = null;
      }
    }

    const previousUrl = displayUrlRef.current;
    if (previousUrl !== null && previousUrl !== nextUrl) {
      // Defer the revoke until the new URL has rendered; revoking it here could
      // leave the previous <img> with a dead src for one frame.
      pendingRevokeRef.current.push(previousUrl);
    }

    displayUrlRef.current = nextUrl;
    setAttachments(next);
    setDisplayUrl(nextUrl);
  }, []);

  const invalidAddress = caseId.length === 0 || cardId.length === 0;
  const visibleStatus: LoadStatus = invalidAddress ? 'missing' : status;

  const resolveRepository = useCallback<CardDetailRepositoryLoader>(() => {
    if (repository !== undefined) {
      return Promise.resolve(repository);
    }
    return (loadRepository ?? loadDefaultRepository)();
  }, [repository, loadRepository]);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      if (caseId.length === 0 || cardId.length === 0) {
        return;
      }

      try {
        const target = await resolveRepository();
        if (cancelled) {
          return;
        }

        const record = await target.getCard(cardId);
        if (cancelled) {
          return;
        }

        if (record === null || record.caseId !== caseId) {
          setActiveRepository(target);
          setStatus('missing');
          return;
        }

        const owningCase = await target.getCase(caseId);
        if (cancelled) {
          return;
        }

        if (owningCase === null) {
          setActiveRepository(target);
          setStatus('missing');
          return;
        }

        const [storedAttachments, storedCards, storedConnections] = await Promise.all([
          target.listAttachments(record.id),
          target.listCards(caseId),
          target.listConnections(caseId),
        ]);
        if (cancelled) {
          return;
        }

        setActiveRepository(target);
        setCaseRecord(owningCase);
        setCard(record);
        setCards(storedCards);
        setConnections(storedConnections);
        applyAttachments(attachmentView(storedAttachments));
        setFailedJob(null);
        setReplaceError(null);
        setLoadError(null);
        setStatus('ready');
      } catch {
        if (!cancelled) {
          setActiveRepository(null);
          setLoadError(
            'The local case database could not be reached. Nothing on this card was changed.',
          );
          setStatus('error');
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [applyAttachments, caseId, cardId, resolveRepository, reloadToken]);

  // Focus the card heading once per card so a route change announces the new
  // surface without stealing focus after the title dialog or a replacement.
  useEffect(() => {
    if (status !== 'ready' || card === null) {
      return;
    }

    if (loadedCardIdRef.current === card.id) {
      return;
    }

    loadedCardIdRef.current = card.id;
    headingRef.current?.focus();
  }, [status, card]);

  const displayAttachment =
    attachments.find((attachment) => attachment.kind === 'display') ??
    attachments.find((attachment) => attachment.kind === 'original') ??
    attachments.find((attachment) => attachment.kind === 'thumbnail') ??
    null;
  const originalAttachment =
    attachments.find((attachment) => attachment.kind === 'original') ?? null;

  // Revoke the previous display URL only after the replacement has rendered.
  useEffect(() => {
    const pending = pendingRevokeRef.current;
    pendingRevokeRef.current = [];

    pending.forEach((url) => {
      if (url === displayUrlRef.current) {
        pendingRevokeRef.current.push(url);
        return;
      }
      try {
        URL.revokeObjectURL(url);
      } catch {
        // Best-effort cleanup of the replaced image.
      }
    });
  }, [displayUrl]);

  // The display URL is created and revoked by applyAttachments. Unmount is the
  // final owner boundary: never leave a Blob URL alive after the route leaves.
  useEffect(
    () => () => {
      const owned = new Set(pendingRevokeRef.current);
      if (displayUrlRef.current !== null) {
        owned.add(displayUrlRef.current);
      }
      displayUrlRef.current = null;
      pendingRevokeRef.current = [];

      owned.forEach((url) => {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Best-effort cleanup; the rendered card never depends on the URL.
        }
      });
    },
    [],
  );

  // The crop editor's preview URL lives exactly as long as its session.
  useEffect(() => {
    if (cropSession === null) {
      return;
    }

    return () => {
      try {
        URL.revokeObjectURL(cropSession.url);
      } catch {
        // Best-effort cleanup of a preview the editor no longer shows.
      }
    };
  }, [cropSession]);

  // Close the editor because of Save, Cancel, or a replacement: land focus back
  // on the Crop/rotate trigger instead of the removed Save button.
  useEffect(() => {
    if (wasCroppingRef.current && cropSession === null) {
      cropTriggerRef.current?.focus();
    }
    wasCroppingRef.current = cropSession !== null;
  }, [cropSession]);

  // A saved crop starts a replacement immediately, which disables Crop/rotate
  // until it settles. Restore focus only once that button is enabled again.
  useEffect(() => {
    if (!replacing && restoreCropFocusRef.current) {
      restoreCropFocusRef.current = false;
      cropTriggerRef.current?.focus();
    }
  }, [replacing]);

  useEffect(
    () => () => {
      replaceControllerRef.current?.abort();
    },
    [],
  );

  const runReplacement = async (job: ReplacementJob): Promise<void> => {
    const currentCard = card;
    const target = activeRepository;

    if (currentCard === null || target === null) {
      return;
    }

    setReplacing(true);
    setReplaceProgress(null);
    setReplaceError(null);
    setFeedback(null);

    const controller = new AbortController();
    replaceControllerRef.current = controller;

    try {
      const outcome = await replacePhoto(
        {
          card: currentCard,
          source: job.source,
          ...(job.crop !== undefined ? { crop: job.crop } : {}),
          ...(job.rotation !== undefined ? { rotation: job.rotation } : {}),
        },
        {
          repository: target,
          signal: controller.signal,
          onProgress: (progress: ReplaceProgress) => {
            if (!controller.signal.aborted) {
              setReplaceProgress(progress.stage);
            }
          },
        },
      );

      if (outcome.status === 'replaced') {
        // A commit is authoritative even if Cancel landed after the repository
        // call began. Showing the old image here would misreport storage.
        setReplacing(false);
        setReplaceProgress(null);
        setCard(outcome.card);
        applyAttachments(attachmentView(outcome.attachments));
        setFailedJob(null);
        setFeedback({
          message: outcome.cleanupPending
            ? 'Photo replaced. The card kept its ID, but the previous copy could not be cleaned up.'
            : 'Photo replaced. The card kept its ID and its connections.',
          tone: outcome.cleanupPending ? 'info' : 'success',
        });
        return;
      }

      if (controller.signal.aborted) {
        return;
      }

      if (outcome.status === 'cancelled') {
        setReplaceError(null);
        setFailedJob(null);
        setFeedback({
          message: 'Photo replacement cancelled. The card is unchanged.',
          tone: 'info',
        });
        return;
      }

      setReplaceError(outcome.message);
      setFailedJob(job);
    } catch {
      if (!controller.signal.aborted) {
        setReplaceError('The photo could not be replaced. The previous image is still here.');
        setFailedJob(job);
      }
    } finally {
      if (replaceControllerRef.current === controller) {
        replaceControllerRef.current = null;
      }
      if (!controller.signal.aborted) {
        setReplacing(false);
        setReplaceProgress(null);
      }
    }
  };

  const handleReplaceFile = (file: File): void => {
    if (replacing) {
      return;
    }

    void runReplacement({ source: { kind: 'file', file } });
  };

  const handleOpenCrop = (): void => {
    if (originalAttachment === null) {
      setFeedback({
        message: 'This card has no retained original to re-crop.',
        tone: 'error',
      });
      return;
    }

    if (typeof URL.createObjectURL !== 'function') {
      setFeedback({ message: 'This browser cannot preview the retained original.', tone: 'error' });
      return;
    }

    try {
      const url = URL.createObjectURL(originalAttachment.blob);
      setCropSession({
        url,
        width: originalAttachment.width,
        height: originalAttachment.height,
        blob: originalAttachment.blob,
        mime: originalAttachment.mime,
      });
    } catch {
      setFeedback({ message: 'The retained original could not be opened.', tone: 'error' });
    }
  };

  const handleCropSave = (result: CropResult): void => {
    const session = cropSession;
    setCropSession(null);

    if (session === null) {
      return;
    }

    restoreCropFocusRef.current = true;
    void runReplacement({
      source: { kind: 'original', blob: session.blob, mime: session.mime },
      crop: result.crop,
      rotation: result.rotation,
    });
  };

  const handleTitleSubmit = async (title: string): Promise<void> => {
    const target = activeRepository;
    const currentCard = card;

    if (target === null || currentCard === null) {
      throw new Error('The card repository is not open.');
    }

    const updated = await target.updateCard(currentCard.id, { title });
    setCard(updated);
    setTitleDialogOpen(false);
    setFeedback({ message: 'Card title updated.', tone: 'success' });
  };

  const handleTagsSubmit = async (tags: readonly string[]): Promise<void> => {
    const target = activeRepository;
    const currentCard = card;

    if (target === null || currentCard === null) {
      throw new Error('The card repository is not open.');
    }

    const updated = await target.updateCard(currentCard.id, { tags });
    setCard(updated);
    setTagsDialogOpen(false);
    setFeedback({ message: 'Card tags updated.', tone: 'success' });
  };

  const handleOcrPersist = async (result: OcrResult): Promise<void> => {
    const target = activeRepository;
    const currentCard = card;

    if (target === null || currentCard === null) {
      throw new Error('The card repository is not open.');
    }

    const updated = await target.updateCard(currentCard.id, {
      ocrText: result.text,
      ocrConfidence: result.confidence,
      ocrEngineVersion: result.engineVersion,
      ocrUpdatedAt: result.updatedAt,
    });
    setCard(updated);
    setFeedback({ message: 'OCR text saved with this card.', tone: 'success' });
  };

  const handleOcrClear = async (): Promise<void> => {
    const target = activeRepository;
    const currentCard = card;

    if (target === null || currentCard === null) {
      throw new Error('The card repository is not open.');
    }

    const updated = await target.updateCard(currentCard.id, {
      ocrText: null,
      ocrConfidence: null,
      ocrEngineVersion: null,
      ocrUpdatedAt: null,
    });
    setCard(updated);
    setFeedback({ message: 'OCR text cleared from this card.', tone: 'success' });
  };

  const handleOcrApplyTitle = async (title: string): Promise<void> => {
    const target = activeRepository;
    const currentCard = card;

    if (target === null || currentCard === null) {
      throw new Error('The card repository is not open.');
    }

    const updated = await target.updateCard(currentCard.id, { title });
    setCard(updated);
    setFeedback({ message: 'Title applied from OCR.', tone: 'success' });
  };

  const handleConnectionCreated = useCallback((connection: ConnectionRecord): void => {
    setConnections((current) => [
      ...current.filter((candidate) => candidate.id !== connection.id),
      connection,
    ]);
    setFeedback({
      message: `Connection saved: ${connectionTypeLabel(connection.type)}.`,
      tone: 'success',
    });
  }, []);

  const handleConnectionChanged = useCallback((connection: ConnectionRecord): void => {
    setConnections((current) => {
      const exists = current.some((candidate) => candidate.id === connection.id);
      if (!exists) {
        return [...current, connection];
      }
      return current.map((candidate) => (candidate.id === connection.id ? connection : candidate));
    });
    setFeedback({
      message: `Connection updated: ${connectionTypeLabel(connection.type)}.`,
      tone: 'success',
    });
  }, []);

  const handleConnectionDeleted = useCallback((connection: ConnectionRecord): void => {
    setConnections((current) => current.filter((candidate) => candidate.id !== connection.id));
    setFeedback({ message: 'Connection deleted. Both cards are unchanged.', tone: 'success' });
  }, []);

  const handleDeleteConfirmed = async (): Promise<void> => {
    const target = activeRepository;
    const currentCard = card;

    if (target === null || currentCard === null) {
      throw new Error('The card repository is not open.');
    }

    await target.deleteCard(currentCard.id);
    replaceControllerRef.current?.abort();
    navigate(casePath, { replace: true });
  };

  const cancelReplacement = (): void => {
    if (!stageIsCancelable(replaceProgress)) {
      return;
    }
    replaceControllerRef.current?.abort();
    setReplacing(false);
    setReplaceProgress(null);
    setFeedback({ message: 'Photo replacement cancelled. The card is unchanged.', tone: 'info' });
  };

  const backToShelf = (): void => {
    navigate('/');
  };

  return (
    <section
      className="card-detail"
      aria-labelledby={card !== null ? titleId : undefined}
      aria-label={card === null ? 'Card detail' : undefined}
      aria-busy={visibleStatus === 'loading' || replacing}
      data-card-id={card?.id}
      data-card-case-id={card?.caseId}
    >
      <Toast
        message={feedback?.message ?? null}
        tone={feedback?.tone ?? 'info'}
        onDismiss={() => setFeedback(null)}
      />

      <Link className="card-detail__back" to={casePath}>
        Back to case
      </Link>

      {visibleStatus === 'loading' ? (
        <p className="card-detail__status" role="status">
          Opening the card…
        </p>
      ) : null}

      {visibleStatus === 'error' ? (
        <section className="card-detail__error" role="alert" aria-labelledby="card-load-error">
          <h2 id="card-load-error">Card could not open</h2>
          <p>{loadError}</p>
          <div className="card-detail__error-actions">
            <Button
              variant="primary"
              onClick={() => {
                setLoadError(null);
                setStatus('loading');
                setReloadToken((token) => token + 1);
              }}
            >
              Retry
            </Button>
            <Button variant="quiet" onClick={backToShelf}>
              Back to case shelf
            </Button>
          </div>
        </section>
      ) : null}

      {visibleStatus === 'missing' ? (
        <section className="card-detail__error" role="alert" aria-labelledby="card-missing-title">
          <h2 id="card-missing-title">Card not found</h2>
          <p>
            This card is not in the named case. It may have been deleted, or the address may point
            at another case.
          </p>
          <div className="card-detail__error-actions">
            <Link className="card-detail__text-link" to={casePath}>
              Back to the case
            </Link>
          </div>
        </section>
      ) : null}

      {visibleStatus === 'ready' && card !== null ? (
        <>
          <header className="card-detail__header">
            <p className="card-detail__eyebrow">
              {caseRecord !== null ? caseRecord.title : 'Case file'}
            </p>
            <p className="card-detail__type" data-card-type={card.type}>
              {TYPE_LABELS[card.type]}
            </p>
            <h2 id={titleId} ref={headingRef} className="card-detail__title" tabIndex={-1}>
              {card.title}
            </h2>
            <p className="card-detail__summary">
              {card.type === 'topic'
                ? 'A text-only topic. It has no photo to crop or replace.'
                : 'This card owns one retained original, one display copy, and one thumbnail. Editing the photo keeps the card ID.'}
            </p>
          </header>

          {cropSession !== null ? (
            <CropRotateEditor
              imageSrc={cropSession.url}
              sourceWidth={cropSession.width}
              sourceHeight={cropSession.height}
              initialCrop={card.crop ?? FULL_CROP}
              initialRotation={card.rotation ?? 0}
              title="Crop and rotate photo"
              imageAlt={`Retained original for ${card.title}`}
              saveLabel="Save crop"
              onSave={handleCropSave}
              onCancel={() => setCropSession(null)}
            />
          ) : (
            <div className="card-detail__layout">
              <section className="card-detail__photo" aria-labelledby="card-photo-title">
                <h3 id="card-photo-title">Photo</h3>
                {displayUrl !== null ? (
                  <img
                    className="card-detail__image"
                    src={displayUrl}
                    alt={`Display image for ${card.title}`}
                  />
                ) : (
                  <p className="card-detail__no-photo">
                    {card.type === 'topic'
                      ? 'No photo is attached to this topic.'
                      : 'The display image could not be loaded. Replace the photo to restore this card.'}
                  </p>
                )}
                {displayAttachment !== null ? (
                  <p className="card-detail__meta">
                    {displayAttachment.width} × {displayAttachment.height} pixels
                    {card.rotation !== undefined && card.rotation !== 0
                      ? ` · rotated ${card.rotation}°`
                      : ''}
                    {card.retainFullResolution === true ? ' · full resolution retained' : ''}
                  </p>
                ) : null}
              </section>

              <div className="card-detail__sidebar">
                <section className="card-detail__actions" aria-labelledby="card-actions-title">
                  <h3 id="card-actions-title">Card actions</h3>
                  <div className="card-detail__action-grid">
                    <Button
                      className="card-detail__action"
                      onClick={() => setTitleDialogOpen(true)}
                    >
                      Edit title
                    </Button>

                    {card.type === 'topic' ? null : (
                      <>
                        <Button
                          className="card-detail__action"
                          disabled={replacing}
                          onClick={() => replaceInputRef.current?.click()}
                        >
                          Replace photo
                        </Button>
                        <Button
                          ref={cropTriggerRef}
                          className="card-detail__action"
                          disabled={replacing || originalAttachment === null}
                          onClick={handleOpenCrop}
                        >
                          Crop/rotate
                        </Button>
                      </>
                    )}

                    <Button
                      className="card-detail__action"
                      variant="danger"
                      onClick={() => setDeleteDialogOpen(true)}
                    >
                      Delete card
                    </Button>

                    <Button
                      className="card-detail__action"
                      onClick={() => {
                        setFeedback(null);
                        setPickerIntent('connect');
                      }}
                    >
                      Connect to…
                    </Button>

                    {card.type === 'note' ? (
                      <Button
                        className="card-detail__action"
                        onClick={() => {
                          setFeedback(null);
                          setPickerIntent('attach-source');
                        }}
                      >
                        Attach source
                      </Button>
                    ) : null}
                  </div>

                  <p className="card-detail__hint">
                    Connect to… builds a thread from this card without the board. A Study Note can
                    also attach a Source as provenance.
                  </p>

                  {card.type === 'topic' ? null : (
                    <p className="card-detail__hint">
                      Replace photo uses a new image. Crop/rotate reuses the retained original, so
                      you can refine this card again later.
                    </p>
                  )}

                  <input
                    ref={replaceInputRef}
                    className="card-detail__file"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    tabIndex={-1}
                    aria-hidden="true"
                    disabled={replacing}
                    data-testid="card-replace-photo"
                    onChange={(event) => {
                      const input = event.currentTarget;
                      const file = input.files?.[0];
                      input.value = '';
                      if (file !== undefined) {
                        handleReplaceFile(file);
                      }
                    }}
                  />
                </section>

                <section className="card-detail__tags" aria-labelledby="card-tags-title">
                  <div className="card-detail__tags-header">
                    <h3 id="card-tags-title">Tags</h3>
                    <Button
                      className="card-detail__tag-edit"
                      onClick={() => setTagsDialogOpen(true)}
                    >
                      Edit tags
                    </Button>
                  </div>
                  {card.tags.length === 0 ? (
                    <p className="card-detail__muted">No tags yet.</p>
                  ) : (
                    <ul className="card-detail__tag-list" aria-label="Card tags">
                      {card.tags.map((tag) => (
                        <li key={tag} className="card-detail__tag">
                          {tag}
                        </li>
                      ))}
                    </ul>
                  )}
                </section>

                <p className="card-detail__record">
                  Card record <code>{card.id}</code>
                </p>
              </div>
            </div>
          )}

          {card.type === 'topic' ? null : (
            <OcrPanel
              image={displayAttachment?.blob ?? originalAttachment?.blob ?? null}
              title={card.title}
              initialResult={storedOcrResult(card)}
              headingLevel={3}
              disabled={replacing}
              onPersist={handleOcrPersist}
              onClear={handleOcrClear}
              onApplyTitle={handleOcrApplyTitle}
            />
          )}

          {replacing ? (
            <section
              className="card-detail__progress"
              role="status"
              aria-live="polite"
              aria-atomic="true"
              aria-busy="true"
              aria-labelledby={replacementTitleId}
            >
              <h3 id={replacementTitleId}>
                {replaceProgress === null
                  ? 'Preparing the replacement…'
                  : REPLACE_STAGE_LABELS[replaceProgress]}
              </h3>
              <p>
                The new original, display, and thumbnail are written before the old copy leaves.
              </p>
              <progress
                className="card-detail__progress-meter"
                max={REPLACE_STAGE_COUNT}
                value={replaceProgress === null ? 0 : REPLACE_STAGE_VALUES[replaceProgress]}
                aria-label="Photo replacement progress"
              />
              {stageIsCancelable(replaceProgress) ? (
                <div className="card-detail__progress-actions">
                  <Button variant="secondary" onClick={cancelReplacement}>
                    Cancel
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}

          {replaceError !== null ? (
            <section className="card-detail__replace-error" role="alert">
              <h3>The photo was not replaced</h3>
              <p>{replaceError}</p>
              <div className="card-detail__error-actions">
                {failedJob !== null ? (
                  <Button variant="primary" onClick={() => void runReplacement(failedJob)}>
                    Retry
                  </Button>
                ) : null}
                <Button
                  variant="quiet"
                  onClick={() => {
                    setReplaceError(null);
                    setFailedJob(null);
                  }}
                >
                  Dismiss
                </Button>
              </div>
            </section>
          ) : null}

          {titleDialogOpen ? (
            <TitleEditDialog
              initialTitle={card.title}
              onClose={() => setTitleDialogOpen(false)}
              onSubmit={handleTitleSubmit}
            />
          ) : null}

          {tagsDialogOpen ? (
            <TagsEditDialog
              initialTags={card.tags}
              onClose={() => setTagsDialogOpen(false)}
              onSubmit={handleTagsSubmit}
            />
          ) : null}

          {deleteDialogOpen ? (
            <DeleteCardDialog
              title={card.title}
              onClose={() => setDeleteDialogOpen(false)}
              onConfirm={handleDeleteConfirmed}
            />
          ) : null}

          {pickerIntent !== null ? (
            <ConnectionPicker
              key={`${card.id}:${pickerIntent}`}
              open
              currentCard={card}
              cards={cards}
              connections={connections}
              intent={pickerIntent}
              {...(connectionRepository !== undefined ? { repository: connectionRepository } : {})}
              loadRepository={loadConnectionRepository ?? loadDefaultConnectionRepository}
              onClose={() => setPickerIntent(null)}
              onConnectionCreated={handleConnectionCreated}
              onConnectionChanged={handleConnectionChanged}
              onConnectionDeleted={handleConnectionDeleted}
            />
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default CardDetailPage;
