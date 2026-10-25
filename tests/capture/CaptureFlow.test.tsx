import { MemoryRouter, Route, Routes } from 'react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AppRoutes from '../../src/app/routes';
import type { NewAttachment } from '../../src/data/attachmentStore';
import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import type { AttachmentKind, CardRecord, CaseRecord } from '../../src/domain/model';
import type { CardImportOutcome } from '../../src/features/capture/cardImport';
import { CapturePage } from '../../src/features/capture/CapturePage';
import type {
  CaptureImageImporter,
  CaptureImageValidator,
} from '../../src/features/capture/CapturePage';
import type { CaptureViewportSize } from '../../src/features/capture/capturePosition';
import type { CropRotateEditorProps } from '../../src/features/capture/CropRotateEditor';
import type { ImageValidationResult } from '../../src/features/capture/imageValidation';
import {
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveLengthPx,
} from '../helpers/css-contract';

// The real editor owns react-easy-crop and has its own component suite. This
// journey only needs a deterministic crop result, so the mock keeps the step
// boundary and reports a known rectangle and rotation.
vi.mock('../../src/features/capture/CropRotateEditor', () => ({
  default: ({ sourceWidth, sourceHeight, onSave, onCancel }: CropRotateEditorProps) => (
    <section aria-labelledby="mock-crop-title">
      <h3 id="mock-crop-title">Crop photo</h3>
      <p>{`Source ${sourceWidth} by ${sourceHeight}`}</p>
      <button
        type="button"
        onClick={() =>
          onSave({
            crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
            rotation: 90,
          })
        }
      >
        Use this crop
      </button>
      <button type="button" onClick={onCancel}>
        Cancel crop
      </button>
    </section>
  ),
}));

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const SEED_CARD_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SEED_CARD_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const CASE: CaseRecord = {
  id: CASE_ID,
  title: 'Tudor England',
  subject: 'History',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  viewport: { x: 100, y: 50, scale: 1 },
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

const VALIDATION_OK: ImageValidationResult = {
  ok: true,
  mime: 'image/png',
  byteLength: 2048,
  width: 1200,
  height: 900,
};

const DEFAULT_VIEWPORT_SIZE: CaptureViewportSize = { width: 1000, height: 800 };

function makeSeedCard(id: string, title: string): CardRecord {
  return {
    id,
    caseId: CASE_ID,
    type: 'note',
    title,
    position: { x: 0, y: 0 },
    tags: [],
    createdAt: '2026-09-02T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
  };
}

function makeRepository(cards: readonly CardRecord[] = []): InMemoryCaseRepository {
  return new InMemoryCaseRepository({ seed: { cases: [CASE], cards } });
}

function noteFile(name = 'note.png'): File {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], name, {
    type: 'image/png',
  });
}

function attachment(kind: AttachmentKind): NewAttachment {
  const blob = new Blob([`${kind} bytes`], { type: 'image/png' });

  return {
    kind,
    mime: 'image/png',
    width: 1200,
    height: 900,
    bytes: blob.size,
    sha256: 'a'.repeat(64),
    blob,
  };
}

function makeImporter(repository: InMemoryCaseRepository): CaptureImageImporter {
  return vi.fn<CaptureImageImporter>(async (input) => {
    const result = await repository.createCardWithAttachments(input, [
      attachment('original'),
      attachment('display'),
      attachment('thumbnail'),
    ]);

    return { status: 'imported', card: result.card, attachments: result.attachments };
  });
}

interface RenderOptions {
  readonly repository?: InMemoryCaseRepository;
  readonly validator?: CaptureImageValidator;
  readonly importer?: CaptureImageImporter;
  readonly viewportSize?: CaptureViewportSize;
}

function renderCapture({
  repository,
  validator,
  importer,
  viewportSize = DEFAULT_VIEWPORT_SIZE,
}: RenderOptions = {}) {
  const activeRepository = repository ?? makeRepository();
  const activeValidator =
    validator ?? vi.fn<CaptureImageValidator>().mockResolvedValue(VALIDATION_OK);
  const activeImporter = importer ?? makeImporter(activeRepository);

  const view = render(
    <MemoryRouter initialEntries={[`/case/${CASE_ID}/capture`]}>
      <Routes>
        <Route
          path="/case/:caseId/capture"
          element={
            <CapturePage
              repository={activeRepository}
              validateImage={activeValidator}
              importCard={activeImporter}
              readViewportSize={() => viewportSize}
            />
          }
        />
        <Route path="/case/:caseId" element={<h2>Case board</h2>} />
        <Route path="/" element={<h2>Case shelf</h2>} />
      </Routes>
    </MemoryRouter>,
  );

  return {
    ...view,
    repository: activeRepository,
    validator: activeValidator,
    importer: activeImporter,
  };
}

function selectFile(testId: string, file: File): void {
  fireEvent.change(screen.getByTestId(testId), { target: { files: [file] } });
}

beforeEach(() => {
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(() => 'blob:capture-preview'),
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
});

describe('Capture route', () => {
  it('is wired through the app route table instead of the placeholder', async () => {
    const repository = makeRepository();

    render(
      <MemoryRouter initialEntries={[`/case/${CASE_ID}/capture`]}>
        <AppRoutes captureRepository={repository} />
      </MemoryRouter>,
    );

    expect(await screen.findByRole('button', { name: 'Take photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add topic' })).toBeInTheDocument();
  });

  it('replaces the placeholder with one picker and two correctly scoped photo inputs', async () => {
    const user = userEvent.setup();
    renderCapture();

    expect(
      await screen.findByRole('heading', { level: 2, name: 'Capture evidence' }),
    ).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Take photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Choose photo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add topic' })).toBeInTheDocument();

    const take = screen.getByTestId('capture-take-photo') as HTMLInputElement;
    const choose = screen.getByTestId('capture-choose-photo') as HTMLInputElement;

    [take, choose].forEach((input) => {
      expect(input).toHaveAttribute('type', 'file');
      expect(input).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp');
    });
    expect(take).toHaveAttribute('capture', 'environment');
    expect(choose).not.toHaveAttribute('capture');

    const takeClick = vi.spyOn(take, 'click').mockImplementation(() => undefined);
    const chooseClick = vi.spyOn(choose, 'click').mockImplementation(() => undefined);

    await user.click(screen.getByRole('button', { name: 'Take photo' }));
    expect(takeClick).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole('button', { name: 'Choose photo' }));
    expect(chooseClick).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['Take photo', 'capture-take-photo'],
    ['Choose photo', 'capture-choose-photo'],
  ] as const)('%s reaches the same validation and crop path', async (_label, testId) => {
    const validator = vi.fn<CaptureImageValidator>().mockResolvedValue(VALIDATION_OK);
    const repository = makeRepository();
    renderCapture({ repository, validator });

    await screen.findByRole('button', { name: 'Take photo' });
    const file = noteFile();
    selectFile(testId, file);

    expect(await screen.findByRole('heading', { name: 'Crop photo' })).toBeInTheDocument();
    expect(validator).toHaveBeenCalledTimes(1);
    expect(validator.mock.calls[0]?.[0]).toBe(file);
    expect(screen.getByText('Source 1200 by 900')).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByTestId('capture-step')).toHaveFocus();
    });
  });

  it('saves a Source with one image, a valid title, and a staggered viewport position', async () => {
    const user = userEvent.setup();
    const repository = makeRepository([
      makeSeedCard(SEED_CARD_A, 'Existing A'),
      makeSeedCard(SEED_CARD_B, 'Existing B'),
    ]);
    const importer = makeImporter(repository);
    renderCapture({ repository, importer });

    await screen.findByRole('button', { name: 'Take photo' });
    selectFile('capture-take-photo', noteFile());
    await screen.findByRole('heading', { name: 'Crop photo' });
    await user.click(screen.getByRole('button', { name: 'Use this crop' }));

    expect(await screen.findByRole('heading', { name: 'Name the card' })).toBeInTheDocument();

    const fullResolution = screen.getByRole('checkbox', { name: /Keep full resolution/i });
    expect(fullResolution).not.toBeChecked();
    expect(screen.getByText(/uses more of this device's storage/i)).toBeInTheDocument();

    await user.selectOptions(screen.getByRole('combobox', { name: 'Card type' }), 'source');
    await user.type(screen.getByRole('textbox', { name: 'Title' }), '  Lecture 3  ');
    await user.click(screen.getByRole('button', { name: 'Save card' }));

    expect(await screen.findByRole('heading', { name: 'Case board' })).toBeInTheDocument();

    const cards = await repository.listCards(CASE_ID);
    expect(cards).toHaveLength(3);
    const saved = cards.find((card) => card.title === 'Lecture 3');
    expect(saved).toBeDefined();
    expect(saved?.type).toBe('source');
    // Viewport (100, 50) at scale 1 on a 1000x800 screen, plus a 2-card stagger.
    expect(saved?.position).toEqual({ x: 632, y: 482 });

    expect(importer).toHaveBeenCalledWith(
      expect.objectContaining({
        caseId: CASE_ID,
        type: 'source',
        title: 'Lecture 3',
        retainFullResolution: false,
        crop: { x: 0.1, y: 0.2, width: 0.8, height: 0.6 },
        rotation: 90,
        position: { x: 632, y: 482 },
      }),
      expect.objectContaining({ repository, signal: expect.any(AbortSignal) }),
    );

    const attachments = await repository.listAttachments(saved?.id ?? '');
    expect(attachments.map((item) => item.kind)).toEqual(['original', 'display', 'thumbnail']);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:capture-preview');
  });

  it('keeps the draft and announces an empty title before any write', async () => {
    const user = userEvent.setup();
    const repository = makeRepository();
    const importer = makeImporter(repository);
    renderCapture({ repository, importer });

    await screen.findByRole('button', { name: 'Take photo' });
    selectFile('capture-take-photo', noteFile());
    await screen.findByRole('heading', { name: 'Crop photo' });
    await user.click(screen.getByRole('button', { name: 'Use this crop' }));
    await screen.findByRole('heading', { name: 'Name the card' });

    await user.click(screen.getByRole('button', { name: 'Save card' }));

    const alert = await screen.findByRole('alert');
    const title = screen.getByRole('textbox', { name: 'Title' });

    expect(alert).toHaveTextContent('Enter a title for this card.');
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(title).toHaveFocus();
    expect(importer).not.toHaveBeenCalled();
    expect(await repository.listCards(CASE_ID)).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Name the card' })).toBeInTheDocument();
  });

  it('opts a card into the imported resolution only after the toggle is enabled', async () => {
    const user = userEvent.setup();
    const repository = makeRepository();
    const importer = makeImporter(repository);
    renderCapture({ repository, importer });

    await screen.findByRole('button', { name: 'Take photo' });
    selectFile('capture-take-photo', noteFile());
    await screen.findByRole('heading', { name: 'Crop photo' });
    await user.click(screen.getByRole('button', { name: 'Use this crop' }));
    await screen.findByRole('heading', { name: 'Name the card' });

    const fullResolution = screen.getByRole('checkbox', { name: /Keep full resolution/i });
    expect(fullResolution).not.toBeChecked();
    await user.click(fullResolution);
    expect(fullResolution).toBeChecked();

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Full page');
    await user.click(screen.getByRole('button', { name: 'Save card' }));
    await screen.findByRole('heading', { name: 'Case board' });

    expect(importer).toHaveBeenCalledWith(
      expect.objectContaining({ retainFullResolution: true, title: 'Full page' }),
      expect.anything(),
    );
  });

  it('creates a text-only topic without touching an image or an attachment', async () => {
    const user = userEvent.setup();
    const repository = makeRepository();
    const validator = vi.fn<CaptureImageValidator>().mockResolvedValue(VALIDATION_OK);
    renderCapture({ repository, validator });

    await screen.findByRole('button', { name: 'Add topic' });
    await user.click(screen.getByRole('button', { name: 'Add topic' }));

    expect(await screen.findByRole('heading', { name: 'Add a topic' })).toBeInTheDocument();
    expect(screen.queryByTestId('capture-take-photo')).not.toBeInTheDocument();
    expect(screen.queryByTestId('capture-choose-photo')).not.toBeInTheDocument();
    expect(validator).not.toHaveBeenCalled();

    await user.type(screen.getByRole('textbox', { name: 'Topic title' }), '  Carbonyls  ');
    await user.click(screen.getByRole('button', { name: 'Add topic' }));

    expect(await screen.findByRole('heading', { name: 'Case board' })).toBeInTheDocument();

    const cards = await repository.listCards(CASE_ID);
    expect(cards).toHaveLength(1);
    const topic = cards[0];
    expect(topic).toMatchObject({
      type: 'topic',
      title: 'Carbonyls',
      position: { x: 600, y: 450 },
    });
    expect(await repository.listAttachments(topic?.id ?? '')).toEqual([]);
  });

  it('offers Retry and Back after a decode failure and writes nothing', async () => {
    const user = userEvent.setup();
    const repository = makeRepository();
    const validator = vi
      .fn<CaptureImageValidator>()
      .mockResolvedValueOnce({
        ok: false,
        code: 'corrupt-image',
        message: 'That image could not be read. Try another photo.',
      })
      .mockResolvedValueOnce(VALIDATION_OK);
    renderCapture({ repository, validator });

    await screen.findByRole('button', { name: 'Take photo' });
    selectFile('capture-take-photo', noteFile());

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('No card was saved');
    expect(alert).toHaveTextContent('That image could not be read.');
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
    expect(await repository.listCards(CASE_ID)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('heading', { name: 'Crop photo' })).toBeInTheDocument();
    expect(validator).toHaveBeenCalledTimes(2);
  });

  it('returns to the case from a failure without creating a card', async () => {
    const user = userEvent.setup();
    const repository = makeRepository();
    const validator = vi.fn<CaptureImageValidator>().mockResolvedValue({
      ok: false,
      code: 'corrupt-image',
      message: 'That image could not be read. Try another photo.',
    });
    renderCapture({ repository, validator });

    await screen.findByRole('button', { name: 'Take photo' });
    selectFile('capture-take-photo', noteFile());
    await screen.findByRole('alert');
    await user.click(screen.getByRole('button', { name: 'Back' }));

    expect(await screen.findByRole('heading', { name: 'Case board' })).toBeInTheDocument();
    expect(await repository.listCards(CASE_ID)).toHaveLength(0);
  });

  it('leaves no partial card after a write failure and retries the same draft', async () => {
    const user = userEvent.setup();
    const repository = makeRepository();
    let attempts = 0;
    const importer = vi.fn<CaptureImageImporter>(async (input) => {
      attempts += 1;
      if (attempts === 1) {
        return {
          status: 'failed',
          code: 'storage',
          message: 'The card could not be saved. Try again.',
        };
      }

      const result = await repository.createCardWithAttachments(input, [
        attachment('original'),
        attachment('display'),
        attachment('thumbnail'),
      ]);
      return { status: 'imported', card: result.card, attachments: result.attachments };
    });

    renderCapture({ repository, importer });

    await screen.findByRole('button', { name: 'Take photo' });
    selectFile('capture-take-photo', noteFile());
    await screen.findByRole('heading', { name: 'Crop photo' });
    await user.click(screen.getByRole('button', { name: 'Use this crop' }));
    await screen.findByRole('heading', { name: 'Name the card' });
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Retry me');
    await user.click(screen.getByRole('button', { name: 'Save card' }));

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The card could not be saved. Try again.');
    expect(await repository.listCards(CASE_ID)).toHaveLength(0);

    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByRole('heading', { name: 'Case board' })).toBeInTheDocument();

    const cards = await repository.listCards(CASE_ID);
    expect(cards).toHaveLength(1);
    expect(cards[0]?.title).toBe('Retry me');
    expect(await repository.listAttachments(cards[0]?.id ?? '')).toHaveLength(3);
    expect(importer).toHaveBeenCalledTimes(2);
  });

  it('cancels an in-flight import and returns to the case with no card', async () => {
    const user = userEvent.setup();
    const repository = makeRepository();
    const importer = vi.fn<CaptureImageImporter>(
      (_input, options) =>
        new Promise<CardImportOutcome>((resolve) => {
          options.signal?.addEventListener('abort', () => resolve({ status: 'cancelled' }), {
            once: true,
          });
        }),
    );
    renderCapture({ repository, importer });

    await screen.findByRole('button', { name: 'Take photo' });
    selectFile('capture-take-photo', noteFile());
    await screen.findByRole('heading', { name: 'Crop photo' });
    await user.click(screen.getByRole('button', { name: 'Use this crop' }));
    await screen.findByRole('heading', { name: 'Name the card' });
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Never saved');
    await user.click(screen.getByRole('button', { name: 'Save card' }));

    await user.click(await screen.findByRole('button', { name: 'Cancel' }));

    expect(await screen.findByRole('heading', { name: 'Case board' })).toBeInTheDocument();
    expect(await repository.listCards(CASE_ID)).toHaveLength(0);
  });

  it('revokes the preview URL when the route unmounts', async () => {
    const { unmount } = renderCapture();

    await screen.findByRole('button', { name: 'Take photo' });
    selectFile('capture-take-photo', noteFile());
    await screen.findByRole('heading', { name: 'Crop photo' });

    unmount();

    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:capture-preview');
  });
});

describe('Capture accessibility contract', () => {
  it('keeps action and toggle targets at 44px with token-driven focus styles', () => {
    const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));
    const css = readRepositoryFile('src/features/capture/capture.css');

    ['.capture-source-picker__action', '.capture-toggle', '.capture-form__submit'].forEach(
      (selector) => {
        const styles = declarationsFor(css, selector);
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

        expect(block, `${selector} block target`).toBeGreaterThanOrEqual(44);
        expect(inline, `${selector} inline target`).toBeGreaterThanOrEqual(44);
      },
    );

    expect(declarationsFor(css, '.capture__step:focus-visible').get('outline')).toContain(
      'var(--color-focus-ring)',
    );
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);
    expect(css).not.toMatch(/(#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\()/i);

    ['CapturePage.tsx', 'CaptureSourcePicker.tsx', 'NoteSourceForm.tsx', 'TopicForm.tsx'].forEach(
      (file) => {
        expect(readRepositoryFile(`src/features/capture/${file}`)).not.toContain(
          'dangerouslySetInnerHTML',
        );
      },
    );
  });
});
