import { MemoryRouter, Route, Routes } from 'react-router';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AppRoutes from '../../src/app/routes';
import type { NewAttachment } from '../../src/data/attachmentStore';
import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import type {
  AttachmentKind,
  AttachmentRecord,
  CardRecord,
  CaseRecord,
} from '../../src/domain/model';
import { DEFAULT_VIEWPORT } from '../../src/domain/model';
import type { CropRotateEditorProps } from '../../src/features/capture/CropRotateEditor';
import { CardDetailPage } from '../../src/features/cards/CardDetailPage';
import type { CardPhotoReplacer } from '../../src/features/cards/CardDetailPage';
import {
  contrastRatio,
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveColor,
  resolveLengthPx,
} from '../helpers/css-contract';

// The crop editor has its own component suite. This page only needs the editor
// boundary and a deterministic crop, so the mock keeps the mount contract.
vi.mock('../../src/features/capture/CropRotateEditor', () => ({
  default: ({
    sourceWidth,
    sourceHeight,
    initialCrop,
    initialRotation,
    onSave,
    onCancel,
  }: CropRotateEditorProps) => (
    <section aria-labelledby="mock-card-crop-title">
      <h3 id="mock-card-crop-title">Crop and rotate photo</h3>
      <p>{`Source ${sourceWidth} by ${sourceHeight}`}</p>
      <p>{`Starting at ${initialRotation ?? 0} degrees`}</p>
      <p>{`Starting crop width ${initialCrop?.width ?? 1}`}</p>
      <button
        type="button"
        onClick={() =>
          onSave({
            crop: { x: 0.2, y: 0.1, width: 0.5, height: 0.6 },
            rotation: 90,
          })
        }
      >
        Save crop
      </button>
      <button type="button" onClick={onCancel}>
        Cancel crop
      </button>
    </section>
  ),
}));

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_CASE_ID = '22222222-2222-4222-8222-222222222222';
const CARD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORIGINAL_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const DISPLAY_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const THUMBNAIL_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

const CASE: CaseRecord = {
  id: CASE_ID,
  title: 'Biology Final',
  subject: 'Biology',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  viewport: DEFAULT_VIEWPORT,
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

const CROP = { x: 0.1, y: 0.2, width: 0.7, height: 0.6 };

function makeCard(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: CARD_ID,
    caseId: CASE_ID,
    type: 'note',
    title: 'Photosynthesis',
    position: { x: 40, y: 60 },
    tags: ['Cell biology', 'Exam 1'],
    crop: CROP,
    rotation: 90,
    retainFullResolution: false,
    createdAt: '2026-09-02T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
    ...overrides,
  };
}

function makeAttachment(
  kind: AttachmentKind,
  id: string,
  content = `${kind}-bytes`,
): AttachmentRecord {
  const blob = new Blob([content], { type: 'image/png' });
  return {
    id,
    cardId: CARD_ID,
    kind,
    mime: 'image/png',
    width: kind === 'thumbnail' ? 320 : 1200,
    height: kind === 'thumbnail' ? 214 : 800,
    bytes: blob.size,
    sha256: 'a'.repeat(64),
    blob,
  };
}

function makeRepository(card: CardRecord = makeCard()): InMemoryCaseRepository {
  return new InMemoryCaseRepository({
    seed: {
      cases: [CASE],
      cards: [card],
      attachments: [
        makeAttachment('original', ORIGINAL_ID),
        makeAttachment('display', DISPLAY_ID),
        makeAttachment('thumbnail', THUMBNAIL_ID),
      ],
    },
  });
}

let replacementCounter = 0;

function replacementAttachments(): NewAttachment[] {
  replacementCounter += 1;
  return [
    { kind: 'original', content: `new-original-${replacementCounter}` },
    { kind: 'display', content: `new-display-${replacementCounter}` },
    { kind: 'thumbnail', content: `new-thumbnail-${replacementCounter}` },
  ].map(({ kind, content }) => {
    const blob = new Blob([content], { type: 'image/png' });
    return {
      kind: kind as AttachmentKind,
      mime: 'image/png',
      width: kind === 'thumbnail' ? 320 : 1200,
      height: kind === 'thumbnail' ? 214 : 800,
      bytes: blob.size,
      sha256: 'b'.repeat(64),
      blob,
    } satisfies NewAttachment;
  });
}

interface ReplacerOptions {
  failures?: number;
}

function makeReplacer(
  repository: InMemoryCaseRepository,
  { failures = 0 }: ReplacerOptions = {},
): CardPhotoReplacer & {
  readonly mock: { readonly calls: Array<[Parameters<CardPhotoReplacer>[0], unknown]> };
} {
  let remainingFailures = failures;

  return vi.fn<CardPhotoReplacer>(async (input) => {
    if (remainingFailures > 0) {
      remainingFailures -= 1;
      return {
        status: 'failed',
        code: 'storage',
        message: 'The photo could not be replaced. Try again.',
      };
    }

    const result = await repository.replaceCardAttachments(
      input.card.id,
      replacementAttachments(),
      {
        crop: input.crop ?? { x: 0, y: 0, width: 1, height: 1 },
        rotation: input.rotation ?? 0,
      },
    );

    return {
      status: 'replaced',
      card: result.card,
      attachments: result.attachments,
      cleanupPending: false,
    };
  }) as CardPhotoReplacer & {
    readonly mock: { readonly calls: Array<[Parameters<CardPhotoReplacer>[0], unknown]> };
  };
}

function cardUrl(caseId = CASE_ID, cardId = CARD_ID): string {
  return `/case/${caseId}/card/${cardId}`;
}

interface RenderOptions {
  readonly repository?: InMemoryCaseRepository;
  readonly replacer?: CardPhotoReplacer;
  readonly caseId?: string;
  readonly cardId?: string;
}

function renderDetail({
  repository = makeRepository(),
  replacer,
  caseId = CASE_ID,
  cardId = CARD_ID,
}: RenderOptions = {}) {
  const activeReplacer = replacer ?? makeReplacer(repository);

  const view = render(
    <MemoryRouter initialEntries={[cardUrl(caseId, cardId)]}>
      <Routes>
        <Route
          path="/case/:caseId/card/:cardId"
          element={<CardDetailPage repository={repository} replacePhoto={activeReplacer} />}
        />
        <Route path="/case/:caseId" element={<h2>Case board</h2>} />
        <Route path="/" element={<h2>Case shelf</h2>} />
      </Routes>
    </MemoryRouter>,
  );

  return { ...view, repository, replacer: activeReplacer };
}

let objectUrlCounter = 0;
const createObjectUrl = vi.fn(() => `blob:card-detail-${objectUrlCounter + 1}`);
const revokeObjectUrl = vi.fn();

beforeEach(() => {
  objectUrlCounter = 0;
  replacementCounter = 0;
  createObjectUrl.mockReset();
  createObjectUrl.mockImplementation(() => {
    objectUrlCounter += 1;
    return `blob:card-detail-${objectUrlCounter}`;
  });
  revokeObjectUrl.mockReset();

  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: createObjectUrl,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    writable: true,
    value: revokeObjectUrl,
  });
});

afterEach(() => {
  cleanup();
});

describe('Card detail route', () => {
  it('is wired through the app route table by URL and keeps the card actions in Tab order', async () => {
    const user = userEvent.setup();
    const repository = makeRepository();

    render(
      <MemoryRouter initialEntries={[cardUrl()]}>
        <AppRoutes cardRepository={repository} />
      </MemoryRouter>,
    );

    const heading = await screen.findByRole('heading', { level: 2, name: 'Photosynthesis' });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByText('Study Note')).toBeInTheDocument();

    await user.tab();
    expect(screen.getByRole('button', { name: 'Edit title' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Replace photo' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Crop/rotate' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Delete card' })).toHaveFocus();
  });

  it('shows the display image, title, type, tags slot, and stable card ID', async () => {
    renderDetail();
    const heading = await screen.findByRole('heading', { level: 2, name: 'Photosynthesis' });
    await waitFor(() => expect(heading).toHaveFocus());

    expect(heading.closest('section')).toHaveAttribute('data-card-id', CARD_ID);
    const image = await screen.findByRole('img', {
      name: 'Display image for Photosynthesis',
    });
    expect(image).toHaveAttribute('src', 'blob:card-detail-1');
    expect(screen.getByText('1200 × 800 pixels · rotated 90°')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Tags' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Card tags' })).toHaveTextContent('Cell biology');
    expect(screen.getByRole('list', { name: 'Card tags' })).toHaveTextContent('Exam 1');
    expect(screen.getByText(CARD_ID)).toBeInTheDocument();
  });

  it('reports a wrong-case URL as a missing card without loading another case', async () => {
    renderDetail({ caseId: OTHER_CASE_ID });

    expect(await screen.findByRole('heading', { name: 'Card not found' })).toBeInTheDocument();
  });
});

describe('Title editing', () => {
  it('validates, saves a trimmed title, announces success, and restores focus', async () => {
    const user = userEvent.setup();
    const repository = makeRepository();
    renderDetail({ repository });

    await screen.findByRole('heading', { level: 2, name: 'Photosynthesis' });
    const trigger = screen.getByRole('button', { name: 'Edit title' });
    await user.click(trigger);

    const input = await screen.findByRole('textbox', { name: 'Card title' });
    await waitFor(() => expect(input).toHaveFocus());

    await user.clear(input);
    await user.click(screen.getByRole('button', { name: 'Save title' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a card title.');
    expect(input).toHaveFocus();

    await user.type(input, '  Light reactions  ');
    await user.click(screen.getByRole('button', { name: 'Save title' }));

    const heading = await screen.findByRole('heading', { level: 2, name: 'Light reactions' });
    expect(await repository.getCard(CARD_ID)).toMatchObject({ title: 'Light reactions' });
    expect(screen.getByText('Card title updated.')).toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(heading.closest('section')).toHaveAttribute('data-card-id', CARD_ID);
  });

  it('cancels with Escape and restores focus to the trigger', async () => {
    const user = userEvent.setup();
    renderDetail();

    await screen.findByRole('heading', { level: 2, name: 'Photosynthesis' });
    const trigger = screen.getByRole('button', { name: 'Edit title' });
    await user.click(trigger);
    await screen.findByRole('dialog', { name: 'Edit card title' });

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
  });
});

describe('Photo replacement and re-crop', () => {
  it('replaces the photo through the file input while preserving the card ID and exactly three attachments', async () => {
    const repository = makeRepository();
    const replacer = makeReplacer(repository);
    renderDetail({ repository, replacer });

    await screen.findByRole('heading', { level: 2, name: 'Photosynthesis' });
    const image = await screen.findByRole('img', {
      name: 'Display image for Photosynthesis',
    });
    const oldAttachments = await repository.listAttachments(CARD_ID);
    const oldIds = oldAttachments.map((attachment) => attachment.id);

    const file = new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'source.png', {
      type: 'image/png',
    });
    fireEvent.change(screen.getByTestId('card-replace-photo'), {
      target: { files: [file] },
    });

    expect(await screen.findByText(/Photo replaced\. The card kept its ID/)).toBeInTheDocument();

    expect(replacer).toHaveBeenCalledTimes(1);
    const input = replacer.mock.calls[0]?.[0];
    expect(input?.card.id).toBe(CARD_ID);
    expect(input?.source.kind).toBe('file');
    if (input?.source.kind === 'file') {
      expect(input.source.file).toBe(file);
    }

    const card = await repository.getCard(CARD_ID);
    expect(card?.id).toBe(CARD_ID);

    const attachments = await repository.listAttachments(CARD_ID);
    expect(attachments.map((attachment) => attachment.kind)).toEqual([
      'original',
      'display',
      'thumbnail',
    ]);
    expect(attachments).toHaveLength(3);
    const newIds = attachments.map((attachment) => attachment.id);
    oldIds.forEach((id) => expect(newIds).not.toContain(id));

    await waitFor(() => expect(image.getAttribute('src')).not.toBe('blob:card-detail-1'));
    await waitFor(() => expect(revokeObjectUrl).toHaveBeenCalledWith('blob:card-detail-1'));
    expect(screen.getByText('Photo replaced.', { exact: false })).toBeInTheDocument();
  });

  it('re-crops from the retained original and keeps the card ID', async () => {
    const user = userEvent.setup();
    const repository = makeRepository();
    const replacer = makeReplacer(repository);
    const original = await repository.listAttachments(CARD_ID);
    const originalBlob = original.find((attachment) => attachment.kind === 'original')?.blob;
    renderDetail({ repository, replacer });

    await screen.findByRole('heading', { level: 2, name: 'Photosynthesis' });
    const cropTrigger = screen.getByRole('button', { name: 'Crop/rotate' });
    await user.click(cropTrigger);

    expect(
      await screen.findByRole('heading', { name: 'Crop and rotate photo' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Source 1200 by 800')).toBeInTheDocument();
    expect(screen.getByText('Starting at 90 degrees')).toBeInTheDocument();
    expect(screen.getByText('Starting crop width 0.7')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save crop' }));

    expect(await screen.findByText(/Photo replaced\. The card kept its ID/)).toBeInTheDocument();
    const input = replacer.mock.calls[0]?.[0];
    expect(input?.source.kind).toBe('original');
    if (input?.source.kind === 'original') {
      expect(input.source.blob).toBe(originalBlob);
      expect(input.source.mime).toBe('image/png');
    }
    expect(input?.crop).toEqual({ x: 0.2, y: 0.1, width: 0.5, height: 0.6 });
    expect(input?.rotation).toBe(90);

    const card = await repository.getCard(CARD_ID);
    expect(card?.id).toBe(CARD_ID);
    expect(card?.crop).toEqual({ x: 0.2, y: 0.1, width: 0.5, height: 0.6 });
    expect(card?.rotation).toBe(90);

    const attachments = await repository.listAttachments(CARD_ID);
    expect(attachments).toHaveLength(3);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Crop/rotate' })).toHaveFocus());
  });

  it('cancels a re-crop without writing and restores focus to the crop trigger', async () => {
    const user = userEvent.setup();
    const repository = makeRepository();
    const replacer = makeReplacer(repository);
    renderDetail({ repository, replacer });

    await screen.findByRole('heading', { level: 2, name: 'Photosynthesis' });
    const cropTrigger = screen.getByRole('button', { name: 'Crop/rotate' });
    await user.click(cropTrigger);
    await screen.findByRole('heading', { name: 'Crop and rotate photo' });
    await user.click(screen.getByRole('button', { name: 'Cancel crop' }));

    expect(
      screen.queryByRole('heading', { name: 'Crop and rotate photo' }),
    ).not.toBeInTheDocument();
    expect(replacer).not.toHaveBeenCalled();
    expect(await repository.listAttachments(CARD_ID)).toHaveLength(3);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Crop/rotate' })).toHaveFocus());
  });

  it('keeps the old image and attachments after a failed replacement, then retries', async () => {
    const user = userEvent.setup();
    const repository = makeRepository();
    const replacer = makeReplacer(repository, { failures: 1 });
    renderDetail({ repository, replacer });

    await screen.findByRole('heading', { level: 2, name: 'Photosynthesis' });
    const image = await screen.findByRole('img', {
      name: 'Display image for Photosynthesis',
    });
    const oldIds = (await repository.listAttachments(CARD_ID)).map((attachment) => attachment.id);

    fireEvent.change(screen.getByTestId('card-replace-photo'), {
      target: {
        files: [
          new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'broken.png', {
            type: 'image/png',
          }),
        ],
      },
    });

    expect(
      await screen.findByRole('heading', { name: 'The photo was not replaced' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The photo could not be replaced. Try again.',
    );
    expect(image.getAttribute('src')).toBe('blob:card-detail-1');

    const stillThere = await repository.listAttachments(CARD_ID);
    expect(stillThere.map((attachment) => attachment.id)).toEqual(oldIds);
    expect(stillThere).toHaveLength(3);
    expect((await repository.getCard(CARD_ID))?.id).toBe(CARD_ID);

    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText(/Photo replaced\. The card kept its ID/)).toBeInTheDocument();
    expect(replacer).toHaveBeenCalledTimes(2);
    expect(await repository.listAttachments(CARD_ID)).toHaveLength(3);
    expect((await repository.getCard(CARD_ID))?.id).toBe(CARD_ID);
  });

  it('revokes the display object URL when the screen unmounts', async () => {
    const { unmount } = renderDetail();

    await screen.findByRole('heading', { level: 2, name: 'Photosynthesis' });
    await waitFor(() => expect(createObjectUrl).toHaveBeenCalled());

    unmount();

    expect(revokeObjectUrl).toHaveBeenCalledWith('blob:card-detail-1');
  });
});

describe('Delete card', () => {
  it('requires confirmation, focuses Cancel, Escape closes, and confirm deletes then returns to the case', async () => {
    const user = userEvent.setup();
    const repository = makeRepository();
    renderDetail({ repository });

    await screen.findByRole('heading', { level: 2, name: 'Photosynthesis' });
    const trigger = screen.getByRole('button', { name: 'Delete card' });
    await user.click(trigger);

    const dialog = await screen.findByRole('dialog', { name: /Delete “Photosynthesis”\?/ });
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(cancel).toHaveFocus());

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(await repository.getCard(CARD_ID)).not.toBeNull();
    await waitFor(() => expect(trigger).toHaveFocus());

    await user.click(trigger);
    const confirmDialog = await screen.findByRole('dialog', {
      name: /Delete “Photosynthesis”\?/,
    });
    await user.click(within(confirmDialog).getByRole('button', { name: 'Delete card' }));

    expect(await screen.findByRole('heading', { name: 'Case board' })).toBeInTheDocument();
    expect(await repository.getCard(CARD_ID)).toBeNull();
  });
});

describe('Card detail accessibility contract', () => {
  it('keeps action targets at 44px with token-driven focus and reduced-motion styles', () => {
    const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));
    const css = readRepositoryFile('src/features/cards/CardDetail.css');

    ['.card-detail__back', '.card-detail__action', '.card-detail__text-link'].forEach(
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

    ['.card-detail__title:focus-visible', '.card-detail__back:focus-visible'].forEach(
      (selector) => {
        expect(declarationsFor(css, selector).get('outline'), selector).toContain(
          'var(--color-focus-ring)',
        );
      },
    );
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/);

    ['src/features/cards/CardDetailPage.tsx', 'src/features/cards/CardDetail.css'].forEach(
      (file) => {
        const source = readRepositoryFile(file);
        expect(source, `${file} palette literal`).not.toMatch(
          /(#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\()/i,
        );
        expect(source, `${file} HTML injection`).not.toContain('dangerouslySetInnerHTML');
      },
    );
  });

  it('uses the paper badge pair at 4.5:1 and announces replacement status politely', async () => {
    const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));
    expect(
      contrastRatio(
        resolveColor(tokens, '--color-paper-ink'),
        resolveColor(tokens, '--color-paper'),
      ),
      'card type badge contrast',
    ).toBeGreaterThanOrEqual(4.5);

    renderDetail();
    await screen.findByRole('heading', { level: 2, name: 'Photosynthesis' });

    const status = screen.getAllByRole('status')[0];
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByRole('button', { name: 'Edit title' })).toHaveClass('nd-button');
    expect(screen.getByRole('button', { name: 'Delete card' })).toHaveClass('nd-button--danger');
  });
});
