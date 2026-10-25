import { useCallback, useEffect, useRef, useState } from 'react';

import Button from '../../components/Button';
import EmptyState from '../../components/EmptyState';
import Toast from '../../components/Toast';
import type { ToastTone } from '../../components/Toast';
import { CaseRepository, compareCaseSummaries } from '../../data/caseRepository';
import type { CaseRepositoryPort } from '../../data/caseRepository';
import { openNotesDetectiveDatabase } from '../../data/db';
import type { CaseDeletionPreview } from '../../data/deleteCase';
import { createPersistenceClient, UNSUPPORTED_PERSISTENCE } from '../../data/persistence';
import type { PersistenceClient, PersistenceResult } from '../../data/persistence';
import { readStorageEstimate, UNKNOWN_STORAGE_ESTIMATE } from '../../data/storageEstimate';
import type { StorageEstimateSnapshot } from '../../data/storageEstimate';
import type { CaseSummary } from '../../domain/model';

import CaseFormDialog from './CaseFormDialog';
import type { CaseFormMode, CaseFormValues } from './CaseFormDialog';
import CaseShelf from './CaseShelf';
import DeleteCaseDialog from './DeleteCaseDialog';
import StorageStatus from './StorageStatus';
import { useBroadcastSync } from './useBroadcastSync';
import type { BroadcastChannelFactory } from './useBroadcastSync';
import './shelf.css';

export type CaseRepositoryLoader = () => Promise<CaseRepositoryPort>;

export interface CaseShelfPageProps {
  /** Injected repository for tests and future composition. */
  readonly repository?: CaseRepositoryPort | undefined;
  /** Injected opener used by the route table and failure-state tests. */
  readonly loadRepository?: CaseRepositoryLoader | undefined;
  /** Injected persistence client; defaults to the real navigator.storage API. */
  readonly persistenceClient?: PersistenceClient | undefined;
  /** Injected estimate reader; defaults to navigator.storage.estimate(). */
  readonly loadStorageEstimate?: (() => Promise<StorageEstimateSnapshot>) | undefined;
  /** Injected BroadcastChannel factory so tests can simulate another tab. */
  readonly syncChannelFactory?: BroadcastChannelFactory | undefined;
}

type LoadStatus = 'loading' | 'ready' | 'error';

type DialogState =
  | { readonly mode: Extract<CaseFormMode, 'create'> }
  | { readonly mode: Extract<CaseFormMode, 'edit'>; readonly summary: CaseSummary };

type Feedback = {
  readonly message: string;
  readonly tone: ToastTone;
};

let defaultRepositoryPromise: Promise<CaseRepositoryPort> | null = null;

/**
 * Open the one production database handle. A failed open is forgotten so the
 * shelf's Retry action can genuinely try again instead of replaying the error.
 */
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

/** The repository already sorts; re-sorting keeps local edits in the same order. */
function orderCases(summaries: readonly CaseSummary[]): CaseSummary[] {
  return [...summaries].sort(compareCaseSummaries);
}

/**
 * The shelf route: the student's home screen. It owns loading, ordering,
 * create/edit orchestration, selection, and the recoverable database error.
 * All writes go through the repository boundary; no Dexie call lives here.
 */
export function CaseShelfPage({
  repository,
  loadRepository,
  persistenceClient,
  loadStorageEstimate,
  syncChannelFactory,
}: CaseShelfPageProps) {
  const [status, setStatus] = useState<LoadStatus>('loading');
  const [cases, setCases] = useState<CaseSummary[]>([]);
  const [activeRepository, setActiveRepository] = useState<CaseRepositoryPort | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [deletePreview, setDeletePreview] = useState<CaseDeletionPreview | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [persistence, setPersistence] = useState<PersistenceResult | null>(null);
  const [storageEstimate, setStorageEstimate] = useState<StorageEstimateSnapshot | null>(null);
  const [defaultPersistenceClient] = useState(() => createPersistenceClient());
  const focusAfterLoadRef = useRef(false);
  const pendingFocusCaseIdRef = useRef<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const persistenceRequestedRef = useRef(false);
  const remoteRefreshTokenRef = useRef(0);
  const activePersistenceClient = persistenceClient ?? defaultPersistenceClient;
  const loadEstimate = useCallback(
    () => (loadStorageEstimate ?? readStorageEstimate)(),
    [loadStorageEstimate],
  );

  const resolveRepository = useCallback<CaseRepositoryLoader>(() => {
    if (repository !== undefined) {
      return Promise.resolve(repository);
    }
    return (loadRepository ?? loadDefaultRepository)();
  }, [repository, loadRepository]);

  useEffect(() => {
    let cancelled = false;

    const load = async (): Promise<void> => {
      try {
        const loadedRepository = await resolveRepository();
        const summaries = await loadedRepository.listCaseSummaries();

        if (cancelled) {
          return;
        }

        const ordered = orderCases(summaries);
        setActiveRepository(loadedRepository);
        setCases(ordered);
        setStatus('ready');

        if (focusAfterLoadRef.current) {
          focusAfterLoadRef.current = false;
          const first = ordered[0];
          if (first !== undefined) {
            pendingFocusCaseIdRef.current = first.id;
          } else {
            headingRef.current?.focus();
          }
        }
      } catch {
        if (!cancelled) {
          setActiveRepository(null);
          setStatus('error');
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [resolveRepository, reloadToken]);

  // Move focus to a newly created case after the grid has rendered. The dialog
  // closes in the same commit, so this effect is the final focus destination.
  useEffect(() => {
    const pendingId = pendingFocusCaseIdRef.current;
    if (pendingId === null) {
      return;
    }

    pendingFocusCaseIdRef.current = null;
    document.getElementById(`case-open-${pendingId}`)?.focus();
  }, [cases]);

  // Report the browser's current persistence answer and storage usage before
  // the first case exists. Both readers resolve to an explicit unsupported
  // state rather than rejecting, so the shelf always renders.
  useEffect(() => {
    let cancelled = false;

    void activePersistenceClient
      .read()
      .then((result) => {
        // A first-case request may have started while this read was in flight;
        // its answer is newer than the pre-creation snapshot.
        if (!cancelled && !persistenceRequestedRef.current) {
          setPersistence(result);
        }
      })
      .catch(() => {
        if (!cancelled && !persistenceRequestedRef.current) {
          setPersistence(UNSUPPORTED_PERSISTENCE);
        }
      });

    void loadEstimate()
      .then((result) => {
        if (!cancelled) {
          setStorageEstimate(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStorageEstimate(UNKNOWN_STORAGE_ESTIMATE);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activePersistenceClient, loadEstimate]);

  /**
   * A mutation in another tab invalidates this tab's derived reads. Re-reading
   * the repository keeps IndexedDB authoritative; the response is applied only
   * if a newer refresh has not superseded it. Dialog state is deliberately
   * untouched, so an unsaved draft survives the background refresh.
   */
  const refreshFromRemote = useCallback(async (): Promise<void> => {
    const target = activeRepository;
    if (target === null) {
      return;
    }

    const token = remoteRefreshTokenRef.current + 1;
    remoteRefreshTokenRef.current = token;

    try {
      const summaries = await target.listCaseSummaries();
      if (token !== remoteRefreshTokenRef.current) {
        return;
      }
      setCases(orderCases(summaries));
    } catch {
      // A silent background refresh must never replace an open form with an
      // error. The next foreground action or Retry still reports failures.
    }

    void loadEstimate()
      .then((result) => setStorageEstimate(result))
      .catch(() => setStorageEstimate(UNKNOWN_STORAGE_ESTIMATE));
  }, [activeRepository, loadEstimate]);

  const { broadcastMutation } = useBroadcastSync({
    onMutation: () => {
      void refreshFromRemote();
    },
    ...(syncChannelFactory !== undefined ? { createChannel: syncChannelFactory } : {}),
  });

  const requestPersistenceForFirstCase = useCallback((): void => {
    if (persistenceRequestedRef.current) {
      return;
    }

    persistenceRequestedRef.current = true;

    void activePersistenceClient
      .request()
      .then((result) => setPersistence(result))
      .catch(() => setPersistence(UNSUPPORTED_PERSISTENCE));
    void loadEstimate()
      .then((result) => setStorageEstimate(result))
      .catch(() => setStorageEstimate(UNKNOWN_STORAGE_ESTIMATE));
  }, [activePersistenceClient, loadEstimate]);

  const openCreate = (): void => {
    setDialog({ mode: 'create' });
  };

  const openEdit = (summary: CaseSummary): void => {
    setDialog({ mode: 'edit', summary });
  };

  /**
   * Read the authoritative dependent counts before showing the destructive
   * prompt, so the dialog never names stale numbers. Nothing is deleted here.
   */
  const openDelete = (summary: CaseSummary): void => {
    const target = activeRepository;
    if (target === null) {
      return;
    }

    void target
      .getCaseDeletionPreview(summary.id)
      .then((preview) => {
        if (preview === null) {
          setFeedback({
            message: `That case is already gone: ${summary.title}.`,
            tone: 'info',
          });
          void refreshFromRemote();
          return;
        }
        setDeletePreview(preview);
      })
      .catch(() => {
        setFeedback({
          message: 'The case contents could not be read. Nothing was deleted.',
          tone: 'error',
        });
      });
  };

  const handleRetry = (): void => {
    focusAfterLoadRef.current = true;
    setStatus('loading');
    setActiveRepository(null);
    setReloadToken((token) => token + 1);
  };

  const applySummary = (summary: CaseSummary | null): boolean => {
    if (summary === null) {
      // The write is already committed but the authoritative summary could not
      // be read. Show the recoverable shelf error instead of a stale tile.
      setStatus('error');
      setActiveRepository(null);
      return false;
    }

    setCases((current) =>
      orderCases([...current.filter((item) => item.id !== summary.id), summary]),
    );
    return true;
  };

  const handleCreate = async (
    target: CaseRepositoryPort,
    values: CaseFormValues,
  ): Promise<void> => {
    const wasFirstCase = cases.length === 0;
    const record = await target.createCase({
      title: values.title,
      ...(values.subject !== null ? { subject: values.subject } : {}),
      ...(values.examDate !== null ? { examDate: values.examDate } : {}),
    });

    // Cancel any remote refresh that read before this commit: the local
    // summary below is now the newer persisted truth for this tab.
    remoteRefreshTokenRef.current += 1;
    broadcastMutation(record.id, 'created');
    if (wasFirstCase) {
      requestPersistenceForFirstCase();
    }

    const summary = await target.getCaseSummary(record.id).catch(() => null);

    if (!applySummary(summary)) {
      setFeedback({
        message: 'The case was created, but the shelf could not refresh. Retry to see it.',
        tone: 'error',
      });
      return;
    }

    setSelectedCaseId(record.id);
    pendingFocusCaseIdRef.current = record.id;
    setFeedback({ message: `Case created: ${record.title}.`, tone: 'success' });
  };

  const handleUpdate = async (
    target: CaseRepositoryPort,
    summaryId: string,
    values: CaseFormValues,
  ): Promise<void> => {
    const updated = await target.updateCase(summaryId, {
      title: values.title,
      subject: values.subject,
      examDate: values.examDate,
    });

    remoteRefreshTokenRef.current += 1;
    broadcastMutation(updated.id, 'updated');

    const summary = await target.getCaseSummary(updated.id).catch(() => null);

    if (!applySummary(summary)) {
      setFeedback({
        message: 'The case was saved, but the shelf could not refresh. Retry to see it.',
        tone: 'error',
      });
      return;
    }

    setSelectedCaseId(updated.id);
    setFeedback({ message: `Case updated: ${updated.title}.`, tone: 'success' });
  };

  /**
   * Called only by the confirmed dialog. The repository commits the cascade in
   * one transaction; this handler updates derived shelf state afterwards.
   */
  const handleDeleteConfirmed = async (): Promise<void> => {
    const target = activeRepository;
    const preview = deletePreview;

    if (target === null || preview === null) {
      throw new Error('The case repository is not open.');
    }

    const deleted = await target.deleteCase(preview.caseId);

    remoteRefreshTokenRef.current += 1;
    broadcastMutation(preview.caseId, 'deleted');
    setCases((current) => current.filter((summary) => summary.id !== preview.caseId));
    setSelectedCaseId((current) => (current === preview.caseId ? null : current));
    setDeletePreview(null);

    setFeedback({
      message: deleted
        ? `Case deleted: ${preview.title}.`
        : `The case was already deleted: ${preview.title}.`,
      tone: 'success',
    });
  };

  const handleDialogSubmit = async (values: CaseFormValues): Promise<void> => {
    if (dialog === null) {
      return;
    }

    const target = activeRepository;
    if (target === null) {
      throw new Error('The case repository is not open.');
    }

    if (dialog.mode === 'edit') {
      await handleUpdate(target, dialog.summary.id, values);
      return;
    }

    await handleCreate(target, values);
  };

  const storageStatus =
    status === 'ready' ? (
      <StorageStatus persistence={persistence} estimate={storageEstimate} />
    ) : null;

  return (
    <section className="shelf" aria-labelledby="shelf-title" aria-busy={status === 'loading'}>
      <header className="shelf__header">
        <div className="shelf__heading">
          <p className="shelf__eyebrow">Case files</p>
          <h2 id="shelf-title" ref={headingRef} tabIndex={-1}>
            Case shelf
          </h2>
          <p className="shelf__intro">
            Each case is a board for one exam. Open a case to work on its evidence, or start a new
            one.
          </p>
        </div>

        {status === 'ready' && cases.length > 0 ? (
          <Button variant="primary" size="lg" onClick={openCreate}>
            New case
          </Button>
        ) : null}
      </header>

      <Toast
        message={feedback?.message ?? null}
        tone={feedback?.tone ?? 'info'}
        onDismiss={() => setFeedback(null)}
      />

      {status === 'loading' ? (
        <p className="shelf__status" role="status">
          Opening the case shelf…
        </p>
      ) : null}

      {status === 'error' ? (
        <section className="shelf__error" role="alert" aria-labelledby="shelf-error-title">
          <h3 id="shelf-error-title">Case shelf could not open</h3>
          <p>
            Notes Detective could not reach the local case database. Nothing on your shelf was
            changed.
          </p>
          <p>
            Try again. If the shelf stays empty, import your most recent <code>.ndcase</code> backup
            from a copy you trust.
          </p>
          <div className="shelf__error-actions">
            <Button variant="primary" onClick={handleRetry}>
              Retry
            </Button>
          </div>
        </section>
      ) : null}

      {status === 'ready' && cases.length === 0 ? (
        <>
          {storageStatus}
          <EmptyState
            title="No case files yet"
            description="Create a case for your next exam. Notes, sources, and topics get pinned to it once the case is open."
            headingLevel={3}
            action={
              <Button variant="primary" size="lg" onClick={openCreate}>
                Create your first case
              </Button>
            }
          />
        </>
      ) : null}

      {status === 'ready' && cases.length > 0 ? (
        <CaseShelf
          cases={cases}
          selectedCaseId={selectedCaseId}
          onEdit={openEdit}
          onDelete={openDelete}
          storageStatus={storageStatus}
        />
      ) : null}

      {dialog !== null ? (
        <CaseFormDialog
          mode={dialog.mode}
          {...(dialog.mode === 'edit' ? { initialCase: dialog.summary } : {})}
          onClose={() => setDialog(null)}
          onSubmit={handleDialogSubmit}
        />
      ) : null}

      {deletePreview !== null ? (
        <DeleteCaseDialog
          preview={deletePreview}
          onClose={() => setDeletePreview(null)}
          onConfirm={handleDeleteConfirmed}
        />
      ) : null}
    </section>
  );
}

export default CaseShelfPage;
