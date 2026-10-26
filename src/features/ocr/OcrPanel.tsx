/**
 * Read-text panel for one pending image or one saved card.
 *
 * OCR is opt-in: this panel renders an explanation and a `Read text` action,
 * and nothing starts until that action is pressed. The panel owns the OCR
 * status presentation and the title-suggestion decision, while the owning
 * form or detail page owns the field value and the persistence call. That
 * split keeps a pending card in the capture draft and a saved card in the
 * repository without either surface opening Dexie directly.
 *
 * Title contract:
 *
 * - An empty title is filled from the first meaningful OCR line and announced.
 * - A non-empty title is never changed automatically; the panel shows a
 *   `Suggested title` block with Apply and Dismiss.
 *
 * Status announcements use one always-mounted polite live region. Failure and
 * timeout use an alert and expose Retry; Cancel aborts the single worker owned
 * by `useOcr`, which terminates it and ignores any late result.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';

import Button from '../../components/Button';
import Dialog from '../../components/Dialog';
import type { OcrImage, OcrResult } from './ocrWorker';
import { firstMeaningfulOcrLine } from './ocrTitle';
import { useOcr } from './useOcr';
import type { OcrStatus, UseOcrOptions } from './useOcr';

import './OcrPanel.css';

const OCR_PANEL_TITLE = 'Read text with OCR';

export type OcrPanelHeadingLevel = 3 | 4;

export interface OcrPanelProps {
  /** The current photo. OCR never runs when this is null. */
  readonly image: OcrImage | null;
  /** The current title field value; used only to decide fill versus suggest. */
  readonly title: string;
  /** Stored OCR for a saved card. Omitted while a capture draft is pending. */
  readonly initialResult?: OcrResult | null;
  /** Updates the visible title field. Never called with a replacement. */
  readonly onTitleChange?: (title: string) => void;
  /** Persists an applied suggestion. Falls back to `onTitleChange`. */
  readonly onApplyTitle?: (title: string) => void | Promise<void>;
  /** Persists a successful read. Omitted while a capture card is unsaved. */
  readonly onPersist?: (result: OcrResult) => void | Promise<void>;
  /** Removes stored OCR after the panel's confirmation. */
  readonly onClear?: () => void | Promise<void>;
  /** Notifies the form so a pending result is included when the card saves. */
  readonly onResultChange?: (result: OcrResult | null) => void;
  /** Test and composition seam for the worker, clock, and timeout. */
  readonly ocrOptions?: UseOcrOptions;
  /** Disables actions while the surrounding screen is writing something else. */
  readonly disabled?: boolean;
  /** Stable label prefix; defaults to a generated React ID. */
  readonly id?: string;
  /** Panel heading level. The capture form nests it under its own h3. */
  readonly headingLevel?: OcrPanelHeadingLevel;
}

const STATUS_LABELS: Record<OcrStatus, string> = {
  idle: 'OCR is off until you start it.',
  'loading-engine': 'Loading the OCR engine…',
  reading: 'Reading text…',
  done: 'OCR finished.',
  failed: 'OCR failed.',
  'timed-out': 'OCR timed out.',
  cancelled: 'OCR cancelled.',
};

function isFailureStatus(status: OcrStatus): boolean {
  return status === 'failed' || status === 'timed-out' || status === 'cancelled';
}

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Read-text panel for one pending image or saved card. See the module comment
 * for the activation, title, failure, and clear contracts.
 */
export function OcrPanel({
  image,
  title,
  initialResult = null,
  onTitleChange,
  onApplyTitle,
  onPersist,
  onClear,
  onResultChange,
  ocrOptions,
  disabled = false,
  id,
  headingLevel = 3,
}: OcrPanelProps) {
  const generatedId = useId().replace(/:/g, '');
  const baseId = id ?? `ocr-panel-${generatedId}`;
  const headingId = `${baseId}-title`;
  const resultId = `${baseId}-result`;
  const suggestionId = `${baseId}-suggestion`;
  const liveId = `${baseId}-live`;

  const ocr = useOcr(ocrOptions ?? {});
  // `undefined` means "no local run yet, use the stored result"; a successful
  // run or a clear replaces it without a setState-in-effect mirror.
  const [localResult, setLocalResult] = useState<OcrResult | null | undefined>(undefined);
  const result = localResult !== undefined ? localResult : initialResult;
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [clearOpen, setClearOpen] = useState(false);
  const [clearBusy, setClearBusy] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);

  const titleRef = useRef(title);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cancelClearRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    titleRef.current = title;
  }, [title]);

  const headingTag = headingLevel === 4 ? 'h4' : 'h3';
  const subheadingTag = headingLevel === 4 ? 'h5' : 'h4';
  const Heading = headingTag;
  const Subheading = subheadingTag;

  const running = ocr.isRunning;
  const failureStatus = !running && isFailureStatus(ocr.status) ? ocr.status : null;
  const displayStatus: OcrStatus = running
    ? ocr.status
    : (failureStatus ?? (result !== null ? 'done' : ocr.status));

  const applyOutcome = useCallback(
    async (output: OcrResult): Promise<void> => {
      setLocalResult(output);
      onResultChange?.(output);
      setSaveError(null);

      const line = firstMeaningfulOcrLine(output.text);
      const currentTitle = titleRef.current;

      if (currentTitle.trim().length === 0) {
        if (line !== null) {
          onTitleChange?.(line);
          setSuggestion(null);
          setAnnouncement(`OCR finished. Title filled from OCR: ${line}.`);
        } else {
          setAnnouncement('OCR finished, but no readable title line was found.');
        }
      } else if (line !== null) {
        setSuggestion(line);
        setAnnouncement(
          `OCR finished. Suggested title: ${line}. Use Apply to replace the current title.`,
        );
      } else {
        setAnnouncement('OCR finished. Extracted text is ready below.');
      }

      if (onPersist !== undefined) {
        try {
          await onPersist(output);
        } catch {
          setSaveError(
            'OCR finished but the text could not be saved. The card is unchanged; try Run again.',
          );
        }
      }
    },
    [onPersist, onResultChange, onTitleChange],
  );

  const run = async (): Promise<void> => {
    if (image === null || disabled || running) {
      return;
    }

    setSuggestion(null);
    setSaveError(null);
    const output = await ocr.start(image);

    if (output !== null) {
      if (output.text.trim().length === 0) {
        setAnnouncement('OCR finished but found no readable text. The card was not changed.');
        return;
      }
      await applyOutcome(output);
    }
  };

  const cancel = (): void => {
    if (!running) {
      return;
    }

    ocr.cancel();
    setAnnouncement('OCR cancelled. The image and the card were not changed.');
  };

  const applySuggestion = async (): Promise<void> => {
    const value = suggestion;
    if (value === null || applying) {
      return;
    }

    setApplying(true);
    setSaveError(null);

    try {
      if (onApplyTitle !== undefined) {
        await onApplyTitle(value);
      } else {
        onTitleChange?.(value);
      }
      setSuggestion(null);
      setAnnouncement(`Suggested title applied: ${value}.`);
    } catch {
      setSaveError('The suggested title could not be saved. The current title is unchanged.');
    } finally {
      setApplying(false);
    }
  };

  const dismissSuggestion = (): void => {
    setSuggestion(null);
    setAnnouncement('Suggested title dismissed. The current title was not changed.');
  };

  const openClear = (): void => {
    setClearError(null);
    setClearOpen(true);
  };

  const confirmClear = async (): Promise<void> => {
    if (clearBusy) {
      return;
    }

    setClearBusy(true);
    setClearError(null);

    try {
      await onClear?.();
      setLocalResult(null);
      onResultChange?.(null);
      setSuggestion(null);
      setSaveError(null);
      ocr.reset();
      setClearOpen(false);
      setAnnouncement('OCR text cleared. The title, tags, photo, and connections are unchanged.');
      // The Clear trigger disappears with the result. Put the keyboard path
      // back on the panel heading once the dialog has restored focus.
      window.setTimeout(() => {
        headingRef.current?.focus();
      }, 0);
    } catch {
      setClearError('The OCR text could not be cleared. Nothing was removed; try again.');
    } finally {
      setClearBusy(false);
    }
  };

  const failureCopy =
    failureStatus === 'timed-out'
      ? (ocr.error?.message ??
        'OCR timed out after 60 seconds. The card was not changed. Retry when ready.')
      : failureStatus === 'failed'
        ? (ocr.error?.message ?? 'OCR failed. The card was not changed. You can retry.')
        : 'OCR cancelled. The image and the card were not changed.';

  const showClear = result !== null && !running;
  const primaryLabel =
    failureStatus !== null ? 'Retry' : result === null ? 'Read text' : 'Run again';

  return (
    <section
      className="ocr-panel"
      aria-labelledby={headingId}
      aria-busy={running}
      data-ocr-status={displayStatus}
      data-ocr-has-result={result !== null ? 'true' : 'false'}
    >
      <header className="ocr-panel__header">
        <Heading ref={headingRef} id={headingId} className="ocr-panel__title" tabIndex={-1}>
          {OCR_PANEL_TITLE}
        </Heading>
        <p className="ocr-panel__intro">
          Optional and on-device. Nothing is uploaded. OCR may take several seconds on a tablet and
          needs a clear, well-lit photo of typed or printed text.
        </p>
      </header>

      <p className="ocr-panel__status" data-ocr-status={displayStatus}>
        <span className="visually-hidden">OCR status: </span>
        {STATUS_LABELS[displayStatus]}
      </p>

      <p
        className="ocr-panel__live"
        id={liveId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {announcement}
      </p>

      {running ? (
        <div className="ocr-panel__progress" aria-busy="true">
          <progress className="ocr-panel__progress-meter" aria-label="OCR progress" />
          <p className="ocr-panel__progress-text">
            {ocr.status === 'loading-engine'
              ? 'Loading the bundled English engine. Keep this screen open.'
              : 'Reading the image locally. Cancel is safe and writes nothing.'}
          </p>
          <div className="ocr-panel__actions">
            <Button variant="secondary" onClick={cancel}>
              Cancel
            </Button>
          </div>
        </div>
      ) : null}

      {failureStatus !== null ? (
        <p
          className={
            failureStatus === 'cancelled'
              ? 'ocr-panel__message ocr-panel__message--info'
              : 'ocr-panel__message ocr-panel__message--error'
          }
          {...(failureStatus === 'cancelled' ? {} : { role: 'alert' })}
        >
          {failureCopy}
        </p>
      ) : null}

      {saveError !== null ? (
        <p className="ocr-panel__message ocr-panel__message--error" role="alert">
          {saveError}
        </p>
      ) : null}

      {!running ? (
        <div className="ocr-panel__actions">
          <Button
            variant="primary"
            onClick={() => void run()}
            disabled={disabled || image === null}
          >
            {primaryLabel}
          </Button>
          {showClear ? (
            <Button variant="quiet" onClick={openClear} disabled={disabled}>
              Clear OCR
            </Button>
          ) : null}
        </div>
      ) : null}

      {suggestion !== null ? (
        <div className="ocr-panel__suggestion" role="group" aria-labelledby={suggestionId}>
          <Subheading id={suggestionId} className="ocr-panel__suggestion-title">
            Suggested title
          </Subheading>
          <p className="ocr-panel__suggestion-text">{suggestion}</p>
          <div className="ocr-panel__actions">
            <Button
              variant="primary"
              onClick={() => void applySuggestion()}
              disabled={disabled || applying}
            >
              Apply
            </Button>
            <Button variant="quiet" onClick={dismissSuggestion} disabled={disabled || applying}>
              Dismiss
            </Button>
          </div>
        </div>
      ) : null}

      {result !== null ? (
        <div className="ocr-panel__result" aria-labelledby={resultId}>
          <Subheading id={resultId} className="ocr-panel__result-title">
            Extracted text
          </Subheading>
          <textarea
            className="ocr-panel__text"
            aria-label="Extracted OCR text"
            value={result.text}
            readOnly
            spellCheck={false}
            rows={10}
          />
          <dl className="ocr-panel__meta">
            <div className="ocr-panel__meta-item">
              <dt>Confidence</dt>
              <dd>{`${Math.round(result.confidence)}%`}</dd>
            </div>
            <div className="ocr-panel__meta-item">
              <dt>Engine</dt>
              <dd>{result.engineVersion}</dd>
            </div>
            <div className="ocr-panel__meta-item">
              <dt>Updated</dt>
              <dd>
                <time dateTime={result.updatedAt}>{formatTimestamp(result.updatedAt)}</time>
              </dd>
            </div>
          </dl>
        </div>
      ) : null}

      {clearOpen ? (
        <Dialog
          open
          onClose={() => {
            if (!clearBusy) {
              setClearOpen(false);
            }
          }}
          title="Clear OCR text?"
          description="This removes the extracted text, confidence, engine version, and timestamp. The title, tags, photo, and connections are not changed."
          size="sm"
          dismissible={!clearBusy}
          closeOnBackdrop={!clearBusy}
          initialFocusRef={cancelClearRef}
          actions={
            <>
              <Button
                ref={cancelClearRef}
                variant="quiet"
                onClick={() => setClearOpen(false)}
                disabled={clearBusy}
              >
                Cancel
              </Button>
              <Button variant="danger" onClick={() => void confirmClear()} disabled={clearBusy}>
                {clearBusy ? 'Clearing…' : 'Clear OCR'}
              </Button>
            </>
          }
        >
          {clearError !== null ? (
            <p className="ocr-panel__message ocr-panel__message--error" role="alert">
              {clearError}
            </p>
          ) : null}
        </Dialog>
      ) : null}
    </section>
  );
}

export default OcrPanel;
