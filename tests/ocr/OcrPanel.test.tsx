import { render, screen, waitFor, within, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { OCR_ENGINE_VERSION } from '../../src/features/ocr/ocrAssets';
import type { OcrResult, OcrWorkerLike } from '../../src/features/ocr/ocrWorker';
import OcrPanel from '../../src/features/ocr/OcrPanel';
import type { OcrPanelProps } from '../../src/features/ocr/OcrPanel';
import { firstMeaningfulOcrLine } from '../../src/features/ocr/ocrTitle';
import {
  contrastRatio,
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveColor,
  resolveLengthPx,
} from '../helpers/css-contract';

const image = new Blob(['fixture'], { type: 'image/png' });

afterEach(() => {
  cleanup();
});

const RESULT: OcrResult = {
  text: 'CELL BIOLOGY\nMITOCHONDRIA RELEASE ENERGY\nTHE CELL MEMBRANE',
  confidence: 95.4,
  engineVersion: OCR_ENGINE_VERSION,
  updatedAt: '2026-10-26T10:00:00.000Z',
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeWorker(
  text = RESULT.text,
  {
    confidence = RESULT.confidence,
    recognize,
  }: {
    readonly confidence?: number;
    readonly recognize?: OcrWorkerLike['recognize'];
  } = {},
) {
  const recognizeSpy = vi.fn(
    recognize ?? (async () => ({ data: { text, confidence } })),
  ) as OcrWorkerLike['recognize'];
  const terminate = vi.fn(async () => undefined);
  return {
    worker: { recognize: recognizeSpy, terminate } satisfies OcrWorkerLike,
    recognize: recognizeSpy,
    terminate,
  };
}

function renderPanel(overrides: Partial<OcrPanelProps> = {}) {
  const onTitleChange = overrides.onTitleChange ?? vi.fn();
  const onPersist = overrides.onPersist ?? vi.fn();
  const onClear = overrides.onClear ?? vi.fn();

  const view = render(
    <OcrPanel
      image={image}
      title=""
      onTitleChange={onTitleChange}
      onPersist={onPersist}
      onClear={onClear}
      {...overrides}
    />,
  );

  return { ...view, onTitleChange, onPersist, onClear };
}

describe('firstMeaningfulOcrLine', () => {
  it('skips blank and punctuation-only lines, collapses whitespace, and bounds the title', () => {
    expect(firstMeaningfulOcrLine('\n  \n---\n  Cell   Biology  \nsecond')).toBe('Cell Biology');
    expect(firstMeaningfulOcrLine('\n\n!!!\n')).toBeNull();
    expect(firstMeaningfulOcrLine('x'.repeat(120))).toHaveLength(80);
  });
});

describe('OcrPanel activation and status', () => {
  it('stays idle and does not create a worker until Read text is activated', async () => {
    const user = userEvent.setup();
    const { worker } = makeWorker();
    const createWorker = vi.fn(async () => worker);
    renderPanel({
      title: 'Existing title',
      ocrOptions: { createWorker, now: () => RESULT.updatedAt },
    });

    expect(screen.getByRole('region', { name: 'Read text with OCR' })).toHaveAttribute(
      'data-ocr-status',
      'idle',
    );
    expect(createWorker).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: 'Extracted OCR text' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Read text' }));

    await screen.findByRole('button', { name: 'Run again' });
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(worker.recognize).toHaveBeenCalledTimes(1);
    expect(worker.recognize).toHaveBeenCalledWith(image);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it('announces loading and reading, shows an indeterminate progress indicator, and cancels the worker', async () => {
    const user = userEvent.setup();
    const gate = deferred<{ data: { text: string; confidence: number } }>();
    const { worker, terminate } = makeWorker(RESULT.text, {
      recognize: () => gate.promise,
    });
    renderPanel({ ocrOptions: { createWorker: async () => worker } });

    await user.click(screen.getByRole('button', { name: 'Read text' }));

    expect(await screen.findByText('Reading text…')).toBeInTheDocument();
    const progress = screen.getByRole('progressbar', { name: 'OCR progress' });
    expect(progress).not.toHaveAttribute('value');

    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(
      (await screen.findAllByText(/OCR cancelled\. The image and the card were not changed\./))
        .length,
    ).toBeGreaterThan(0);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Extracted OCR text' })).not.toBeInTheDocument();
  });
});

describe('OcrPanel title rules', () => {
  it('fills an empty title from the first meaningful line and announces it', async () => {
    const user = userEvent.setup();
    const { worker } = makeWorker();
    const { onTitleChange } = renderPanel({
      title: '',
      ocrOptions: { createWorker: async () => worker, now: () => RESULT.updatedAt },
    });

    await user.click(screen.getByRole('button', { name: 'Read text' }));

    await waitFor(() => expect(onTitleChange).toHaveBeenCalledWith('CELL BIOLOGY'));
    expect(onTitleChange).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText('OCR finished. Title filled from OCR: CELL BIOLOGY.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Suggested title' })).not.toBeInTheDocument();
  });

  it('never changes a non-empty title automatically and applies only after Apply', async () => {
    const user = userEvent.setup();
    const { worker } = makeWorker();
    const { onTitleChange } = renderPanel({
      title: 'Draft title',
      ocrOptions: { createWorker: async () => worker, now: () => RESULT.updatedAt },
    });

    await user.click(screen.getByRole('button', { name: 'Read text' }));

    await screen.findByRole('heading', { name: 'Suggested title' });
    expect(screen.getByText('CELL BIOLOGY')).toBeInTheDocument();
    expect(onTitleChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onTitleChange).toHaveBeenCalledWith('CELL BIOLOGY');
    expect(screen.queryByRole('heading', { name: 'Suggested title' })).not.toBeInTheDocument();
    expect(screen.getByText('Suggested title applied: CELL BIOLOGY.')).toBeInTheDocument();
  });

  it('dismisses a suggestion without touching the field', async () => {
    const user = userEvent.setup();
    const { worker } = makeWorker();
    const { onTitleChange } = renderPanel({
      title: 'Draft title',
      ocrOptions: { createWorker: async () => worker, now: () => RESULT.updatedAt },
    });

    await user.click(screen.getByRole('button', { name: 'Read text' }));
    await screen.findByRole('heading', { name: 'Suggested title' });
    await user.click(screen.getByRole('button', { name: 'Dismiss' }));

    expect(onTitleChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Suggested title' })).not.toBeInTheDocument();
    expect(screen.getByText(/Suggested title dismissed\./)).toBeInTheDocument();
  });

  it('applies a suggestion through the owning page callback when one exists', async () => {
    const user = userEvent.setup();
    const { worker } = makeWorker();
    const onApplyTitle = vi.fn(async () => undefined);
    renderPanel({
      title: 'Draft title',
      onApplyTitle,
      ocrOptions: { createWorker: async () => worker, now: () => RESULT.updatedAt },
    });

    await user.click(screen.getByRole('button', { name: 'Read text' }));
    await user.click(await screen.findByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(onApplyTitle).toHaveBeenCalledWith('CELL BIOLOGY'));
    expect(screen.queryByRole('heading', { name: 'Suggested title' })).not.toBeInTheDocument();
  });
});

describe('OcrPanel persistence', () => {
  it('shows stored text, confidence, engine, and timestamp, then persists a rerun result', async () => {
    const user = userEvent.setup();
    const { worker } = makeWorker('NEW READING\nSecond line', { confidence: 88 });
    const { onPersist } = renderPanel({
      title: 'Existing title',
      initialResult: RESULT,
      ocrOptions: { createWorker: async () => worker, now: () => '2026-10-26T11:30:00.000Z' },
    });

    expect(screen.getByRole('textbox', { name: 'Extracted OCR text' })).toHaveValue(RESULT.text);
    expect(screen.getByText('95%')).toBeInTheDocument();
    expect(screen.getByText(OCR_ENGINE_VERSION)).toBeInTheDocument();
    expect(screen.getByText(/2026/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Run again' }));

    await waitFor(() =>
      expect(onPersist).toHaveBeenCalledWith(
        expect.objectContaining({
          text: 'NEW READING\nSecond line',
          confidence: 88,
          engineVersion: OCR_ENGINE_VERSION,
          updatedAt: '2026-10-26T11:30:00.000Z',
        }),
      ),
    );
    expect(screen.getByRole('textbox', { name: 'Extracted OCR text' })).toHaveValue(
      'NEW READING\nSecond line',
    );
    expect(screen.getByRole('heading', { name: 'Suggested title' })).toBeInTheDocument();
  });

  it('leaves the stored result and title unchanged on failure, then retries successfully', async () => {
    const user = userEvent.setup();
    const { worker } = makeWorker();
    let attempts = 0;
    const createWorker = vi.fn(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new Error('engine unavailable');
      }
      return worker;
    });
    const { onPersist, onTitleChange } = renderPanel({
      title: 'Existing title',
      initialResult: RESULT,
      ocrOptions: { createWorker, now: () => '2026-10-26T12:00:00.000Z' },
    });

    await user.click(screen.getByRole('button', { name: 'Run again' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('The OCR engine failed to start.');
    expect(onPersist).not.toHaveBeenCalled();
    expect(onTitleChange).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Extracted OCR text' })).toHaveValue(RESULT.text);

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    await waitFor(() => expect(onPersist).toHaveBeenCalledTimes(1));
    expect(attempts).toBe(2);
  });

  it('times out at the configured bound, terminates the worker, and exposes Retry', async () => {
    const user = userEvent.setup();
    const { worker, terminate } = makeWorker(RESULT.text, {
      recognize: () => new Promise<never>(() => {}),
    });
    renderPanel({
      title: 'Existing title',
      ocrOptions: { timeoutMs: 30, createWorker: async () => worker },
    });

    await user.click(screen.getByRole('button', { name: 'Read text' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/OCR timed out after/i);
    expect(terminate).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Extracted OCR text' })).not.toBeInTheDocument();
  });
});

describe('OcrPanel clear flow', () => {
  it('requires confirmation, focuses Cancel, Escape leaves the result, and confirm clears it', async () => {
    const user = userEvent.setup();
    const { onClear } = renderPanel({
      title: 'Existing title',
      initialResult: RESULT,
    });

    const clearTrigger = screen.getByRole('button', { name: 'Clear OCR' });
    await user.click(clearTrigger);

    const dialog = await screen.findByRole('dialog', { name: 'Clear OCR text?' });
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(onClear).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Extracted OCR text' })).toBeInTheDocument();
    await waitFor(() => expect(clearTrigger).toHaveFocus());

    await user.click(clearTrigger);
    const confirmDialog = await screen.findByRole('dialog', { name: 'Clear OCR text?' });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Clear OCR' }));

    await waitFor(() => expect(onClear).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('textbox', { name: 'Extracted OCR text' })).not.toBeInTheDocument();
    expect(screen.getByText(/OCR text cleared\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Read text' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getByRole('heading', { name: 'Read text with OCR' })).toHaveFocus(),
    );
  });

  it('keeps the result and reports an error when clearing cannot be persisted', async () => {
    const user = userEvent.setup();
    const onClear = vi.fn(async () => {
      throw new Error('storage failed');
    });
    renderPanel({ title: 'Existing title', initialResult: RESULT, onClear });

    await user.click(screen.getByRole('button', { name: 'Clear OCR' }));
    const dialog = await screen.findByRole('dialog', { name: 'Clear OCR text?' });
    await user.click(within(dialog).getByRole('button', { name: 'Clear OCR' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'The OCR text could not be cleared. Nothing was removed; try again.',
    );
    expect(screen.getByRole('textbox', { name: 'Extracted OCR text' })).toHaveValue(RESULT.text);
    expect(dialog).toBeInTheDocument();
  });
});

describe('OcrPanel accessibility contract', () => {
  it('uses a mounted polite live region and token-driven 44px actions with reduced motion', () => {
    renderPanel({ title: 'Existing title', initialResult: RESULT });

    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('region', { name: 'Read text with OCR' })).toBeInTheDocument();
    const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));
    const css = readRepositoryFile('src/features/ocr/OcrPanel.css');

    const styles = declarationsFor(css, '.ocr-panel__actions .nd-button');
    const block = Math.max(
      ...[
        resolveLengthPx(tokens, styles.get('min-block-size')),
        resolveLengthPx(tokens, styles.get('block-size')),
      ].filter((value) => Number.isFinite(value)),
    );
    const inline = Math.max(
      ...[
        resolveLengthPx(tokens, styles.get('min-inline-size')),
        resolveLengthPx(tokens, styles.get('inline-size')),
      ].filter((value) => Number.isFinite(value)),
    );
    expect(block).toBeGreaterThanOrEqual(44);
    expect(inline).toBeGreaterThanOrEqual(44);

    expect(declarationsFor(css, '.ocr-panel__text:focus-visible').get('outline')).toContain(
      'var(--color-focus-ring-on-paper)',
    );
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);

    const contrastPairs = [
      ['body ink on the panel', '--color-ink', '--color-surface-sunken', 4.5],
      ['muted ink on the panel', '--color-ink-muted', '--color-surface-sunken', 4.5],
      ['panel heading on the panel', '--color-heading-ink', '--color-surface-sunken', 4.5],
      ['OCR text on paper', '--color-paper-ink', '--color-paper', 4.5],
      ['suggestion heading on paper', '--color-paper-heading-ink', '--color-paper', 4.5],
      ['error text on a surface', '--color-danger-text', '--color-surface', 4.5],
      ['focus ring on the panel', '--color-focus-ring', '--color-surface-sunken', 3],
    ] as const;

    contrastPairs.forEach(([label, foreground, background, minimum]) => {
      const ratio = contrastRatio(
        resolveColor(tokens, foreground),
        resolveColor(tokens, background),
      );
      expect(ratio, label).toBeGreaterThanOrEqual(minimum);
    });

    ['src/features/ocr/OcrPanel.tsx', 'src/features/ocr/OcrPanel.css'].forEach((file) => {
      const source = readRepositoryFile(file);
      expect(source, `${file} palette literal`).not.toMatch(
        /(#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\()/i,
      );
      expect(source, `${file} HTML injection`).not.toContain('dangerouslySetInnerHTML');
    });
  });

  it('reaches the OCR actions in document order from the panel heading', async () => {
    const user = userEvent.setup();
    renderPanel({ title: 'Existing title', initialResult: RESULT });

    screen.getByRole('heading', { name: 'Read text with OCR' }).focus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Run again' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Clear OCR' })).toHaveFocus();
  });

  it('renders untrusted OCR text and titles as text, never as markup', () => {
    const hostile = '<img src=x onerror=alert(1)> & "quoted" title';
    renderPanel({ title: hostile, initialResult: { ...RESULT, text: hostile } });

    expect(screen.getByRole('textbox', { name: 'Extracted OCR text' })).toHaveValue(hostile);
    expect(document.querySelector('img')).toBeNull();
  });
});
