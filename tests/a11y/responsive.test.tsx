/**
 * A11Y-FR-03 / VIS-FR-02 responsive layout evidence.
 *
 * Two kinds of proof live here:
 *
 * 1. Component-level: the shell and each screen report the active layout mode,
 *    phone side panels render as modal sheets that trap focus while open and
 *    restore it on Escape, and a nested confirmation closes without also
 *    closing its parent sheet.
 * 2. CSS-contract: the documented breakpoints, safe-area padding, 44 px sheet
 *    and board controls, and no-page-overflow rules exist in the stylesheets
 *    the browser actually loads. jsdom has no layout engine, so CSS geometry is
 *    asserted from the source and the real geometry is covered by
 *    `e2e/responsive.spec.ts`.
 */

import { MemoryRouter, Route, Routes } from 'react-router';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AppShell from '../../src/app/AppShell';
import { createBoardStore } from '../../src/board/boardStore';
import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import type { CardRecord, CaseRecord, CaseSummary, ConnectionRecord } from '../../src/domain/model';
import { DEFAULT_VIEWPORT, buildPairKey } from '../../src/domain/model';
import { CardDetailPage } from '../../src/features/cards/CardDetailPage';
import { CaseBoardPage } from '../../src/features/case/CaseBoardPage';
import { createHintSeenStore, HINT_IDS } from '../../src/features/onboarding/hints';
import { SettingsPage } from '../../src/features/settings/SettingsPage';
import CaseShelf from '../../src/features/shelf/CaseShelf';
import SearchPanel from '../../src/features/search/SearchPanel';
import {
  declarationsFor,
  mediaBody,
  parseTokens,
  readRepositoryFile,
  resolveLengthPx,
} from '../helpers/css-contract';

vi.mock('../../src/board/BoardCanvas', () => ({
  BoardCanvas: () => <div data-testid="board-canvas-stub" />,
}));

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const TOPIC_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOTE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SOURCE_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ASSOCIATION_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROVENANCE_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

const CASE: CaseRecord = {
  id: CASE_ID,
  title: 'Responsive biology case',
  subject: 'Biology',
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
  viewport: DEFAULT_VIEWPORT,
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

const TOPIC: CardRecord = {
  id: TOPIC_ID,
  caseId: CASE_ID,
  type: 'topic',
  title: 'Membrane transport',
  position: { x: 120, y: 140 },
  tags: ['Biology'],
  createdAt: '2026-10-01T09:01:00.000Z',
  updatedAt: '2026-10-01T09:01:00.000Z',
};

const NOTE: CardRecord = {
  id: NOTE_ID,
  caseId: CASE_ID,
  type: 'note',
  title: 'Osmosis lab observations',
  position: { x: 520, y: 260 },
  tags: ['Biology', 'Lab'],
  createdAt: '2026-10-01T09:02:00.000Z',
  updatedAt: '2026-10-01T09:02:00.000Z',
};

const SOURCE: CardRecord = {
  id: SOURCE_ID,
  caseId: CASE_ID,
  type: 'source',
  title: 'Lecture slide: membrane structure',
  position: { x: 900, y: 140 },
  tags: ['Lecture'],
  createdAt: '2026-10-01T09:03:00.000Z',
  updatedAt: '2026-10-01T09:03:00.000Z',
};

const CONNECTIONS: readonly ConnectionRecord[] = [
  {
    id: ASSOCIATION_ID,
    caseId: CASE_ID,
    fromCardId: TOPIC_ID,
    toCardId: NOTE_ID,
    pairKey: buildPairKey(TOPIC_ID, NOTE_ID),
    type: 'association',
  },
  {
    id: PROVENANCE_ID,
    caseId: CASE_ID,
    fromCardId: NOTE_ID,
    toCardId: SOURCE_ID,
    pairKey: buildPairKey(NOTE_ID, SOURCE_ID),
    type: 'provenance',
  },
];

const SUMMARY: CaseSummary = {
  id: CASE_ID,
  title: CASE.title,
  subject: 'Biology',
  createdAt: CASE.createdAt,
  updatedAt: CASE.updatedAt,
  closedAt: null,
  isDemo: false,
  cardCount: 3,
  connectionCount: 2,
  readiness: 'loose',
  looseThreadCount: 2,
};

const originalMatchMedia = window.matchMedia;
const originalInnerWidth = window.innerWidth;
const originalInnerHeight = window.innerHeight;

/**
 * Install a width-aware matchMedia. The queries mirror `useLayoutMode` and the
 * stylesheet breakpoints, so a component test can render the phone branch.
 */
function installViewport(width: number, height = 800): void {
  const listeners = new Set<() => void>();

  const readQuery = (query: string): { readonly matches: boolean } => {
    let matches = false;

    if (query.includes('max-width: 37.4375rem')) {
      matches = width < 600;
    } else if (query.includes('max-width: 74.9375rem')) {
      matches = width < 1200;
    }

    return { matches };
  };

  const matchMedia = vi.fn((query: string): MediaQueryList => {
    const value = readQuery(query);

    return {
      matches: value.matches,
      media: query,
      onchange: null,
      addEventListener: (type: string, listener: () => void) => {
        if (type === 'change') {
          listeners.add(listener);
        }
      },
      removeEventListener: (type: string, listener: () => void) => {
        if (type === 'change') {
          listeners.delete(listener);
        }
      },
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    } as unknown as MediaQueryList;
  });

  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: matchMedia,
  });
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: width });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: height,
  });
}

function restoreViewport(): void {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  });
  Object.defineProperty(window, 'innerWidth', {
    configurable: true,
    writable: true,
    value: originalInnerWidth,
  });
  Object.defineProperty(window, 'innerHeight', {
    configurable: true,
    writable: true,
    value: originalInnerHeight,
  });
}

function seenHintStore() {
  const store = createHintSeenStore(null);
  HINT_IDS.forEach((hintId) => store.markSeen(hintId));
  return store;
}

function makeRepository(): InMemoryCaseRepository {
  return new InMemoryCaseRepository({
    seed: {
      cases: [CASE],
      cards: [TOPIC, NOTE, SOURCE],
      connections: [...CONNECTIONS],
    },
  });
}

function renderBoard(width: number) {
  installViewport(width);
  const store = createBoardStore(DEFAULT_VIEWPORT);
  const repository = makeRepository();

  const result = render(
    <MemoryRouter initialEntries={[`/case/${CASE_ID}`]}>
      <Routes>
        <Route
          path="/case/:caseId"
          element={
            <CaseBoardPage repository={repository} store={store} hintStore={seenHintStore()} />
          }
        />
      </Routes>
    </MemoryRouter>,
  );

  return { ...result, store, repository };
}

afterEach(() => {
  cleanup();
  restoreViewport();
});

describe('responsive breakpoints', () => {
  it.each([
    [390, 'phone'],
    [600, 'tablet'],
    [768, 'tablet'],
    [1199, 'tablet'],
    [1280, 'desktop'],
    [1440, 'desktop'],
  ] as const)('reports %i px as %s in the shell', (width, expected) => {
    installViewport(width);
    render(
      <MemoryRouter>
        <AppShell>
          <p>Case content</p>
        </AppShell>
      </MemoryRouter>,
    );

    expect(screen.getByTestId('app-frame')).toHaveAttribute('data-layout', expected);
    cleanup();
  });

  it('renders the shelf, settings, and search panel with the phone layout marker', () => {
    installViewport(390);

    const shelf = render(
      <MemoryRouter>
        <CaseShelf cases={[SUMMARY]} selectedCaseId={null} onEdit={vi.fn()} onDelete={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('list', { name: 'Case files' })).toHaveAttribute(
      'data-layout',
      'phone',
    );
    shelf.unmount();

    const settings = render(<SettingsPage hintStore={seenHintStore()} />);
    expect(screen.getByTestId('settings-page')).toHaveAttribute('data-layout', 'phone');
    settings.unmount();

    render(
      <MemoryRouter>
        <SearchPanel cards={[NOTE]} onSelectCard={vi.fn()} variant="sheet" />
      </MemoryRouter>,
    );
    const panel = screen.getByRole('region', { name: 'Search this case' });
    expect(panel).toHaveClass('search-panel--sheet');
    expect(panel).toHaveAttribute('data-variant', 'sheet');
  });
});

describe('phone board sheets', () => {
  it('opens the Case menu as a dialog sheet, closes on Escape, and restores the trigger', async () => {
    const user = userEvent.setup();
    renderBoard(390);

    await screen.findByRole('heading', { level: 2, name: 'Case board' });
    const trigger = await screen.findByRole('button', { name: 'Case menu' });
    expect(trigger).toHaveClass('nd-icon-button');
    expect(screen.queryByRole('searchbox', { name: 'Search cards' })).not.toBeInTheDocument();

    await user.click(trigger);

    const sheet = screen.getByRole('dialog', { name: 'Case menu' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(within(sheet).getByRole('button', { name: 'Back up case' })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Open card list' })).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Case shelf' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Thread types' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Case menu' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('opens Search in a sheet and returns focus to its trigger', async () => {
    const user = userEvent.setup();
    renderBoard(390);

    await screen.findByRole('heading', { level: 2, name: 'Case board' });
    const trigger = await screen.findByRole('button', { name: 'Search' });

    await user.click(trigger);

    const sheet = screen.getByRole('dialog', { name: 'Search this case' });
    expect(within(sheet).getByRole('searchbox', { name: 'Search cards' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Filters' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Clear all' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Search this case' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('opens Case closure in a sheet without leaving an inline duplicate', async () => {
    const user = userEvent.setup();
    renderBoard(390);

    await screen.findByRole('heading', { level: 2, name: 'Case board' });
    expect(screen.queryByTestId('closure-panel')).not.toBeInTheDocument();

    const trigger = await screen.findByRole('button', { name: 'Case closure' });
    await user.click(trigger);

    const sheet = screen.getByRole('dialog', { name: 'Case closure' });
    expect(within(sheet).getByTestId('closure-panel')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Case closure' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('closure-panel')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('opens a selected connection as a sheet and clears the selection on Escape', async () => {
    const user = userEvent.setup();
    const { store } = renderBoard(390);

    await screen.findByRole('heading', { level: 2, name: 'Case board' });

    act(() => {
      store.getState().selectConnection(ASSOCIATION_ID);
    });

    const sheet = await screen.findByRole('dialog', { name: 'Connection details' });
    expect(within(sheet).getByTestId('connection-detail')).toBeInTheDocument();
    expect(within(sheet).getByRole('radio', { name: /Association/ })).toBeChecked();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Connection details' })).not.toBeInTheDocument();
    expect(store.getState().selectedConnectionId).toBeNull();
  });

  it('opens non-modal panels on a 768 px tablet', async () => {
    const user = userEvent.setup();
    renderBoard(768);

    await screen.findByRole('heading', { level: 2, name: 'Case board' });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Case menu' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Search' }));
    const searchPanel = screen.getByRole('dialog', { name: 'Search this case' });
    expect(searchPanel).not.toHaveAttribute('aria-modal');
    expect(
      within(searchPanel).getByRole('searchbox', { name: 'Search cards' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search cards' })).toHaveFocus();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: 'Search this case' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^Readiness:/ }));
    const closurePanel = screen.getByRole('dialog', { name: 'Case closure' });
    expect(closurePanel).not.toHaveAttribute('aria-modal');
    expect(within(closurePanel).getByTestId('closure-panel')).toBeInTheDocument();
  });
});

describe('phone card detail sheet', () => {
  it('moves the action sidebar into a sheet and closes a nested title dialog independently', async () => {
    installViewport(390);
    const user = userEvent.setup();
    const repository = new InMemoryCaseRepository({
      seed: { cases: [CASE], cards: [TOPIC] },
    });

    render(
      <MemoryRouter initialEntries={[`/case/${CASE_ID}/card/${TOPIC_ID}`]}>
        <Routes>
          <Route
            path="/case/:caseId/card/:cardId"
            element={<CardDetailPage repository={repository} />}
          />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByRole('heading', { level: 2, name: TOPIC.title });
    const trigger = screen.getByRole('button', { name: 'Card actions and tags' });
    expect(trigger).toHaveClass('card-detail__sheet-trigger');
    expect(screen.queryByRole('button', { name: 'Edit title' })).not.toBeInTheDocument();

    await user.click(trigger);

    const sheet = screen.getByRole('dialog', { name: 'Card actions and tags' });
    const editTitle = within(sheet).getByRole('button', { name: 'Edit title' });

    await user.click(editTitle);

    const nested = screen.getByRole('dialog', { name: 'Edit card title' });
    expect(nested).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Card actions and tags' })).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog', { name: 'Edit card title' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Card actions and tags' })).toBeInTheDocument();
    expect(editTitle).toHaveFocus();

    await user.keyboard('{Escape}');

    await waitFor(() => {
      expect(
        screen.queryByRole('dialog', { name: 'Card actions and tags' }),
      ).not.toBeInTheDocument();
    });
    expect(trigger).toHaveFocus();
  });
});

describe('responsive CSS contract', () => {
  const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));
  const responsive = readRepositoryFile('src/styles/responsive.css');
  const appShellCss = readRepositoryFile('src/app/AppShell.css');
  const boardCss = readRepositoryFile('src/features/case/CaseBoardPage.css');
  const boardCanvasCss = readRepositoryFile('src/board/BoardCanvas.css');
  const cardCss = readRepositoryFile('src/features/cards/CardDetail.css');
  const recallCss = readRepositoryFile('src/features/recall/recall.css');
  const shelfCss = readRepositoryFile('src/features/shelf/shelf.css');
  const searchCss = readRepositoryFile('src/features/search/SearchPanel.css');
  const hintsCss = readRepositoryFile('src/features/onboarding/hints.css');
  const componentsCss = readRepositoryFile('src/components/components.css');

  it('declares the documented phone, tablet, and desktop breakpoints', () => {
    expect(mediaBody(responsive, 'max-width: 37.4375rem')).toContain('.app-frame__content');
    const tablet = mediaBody(responsive, 'max-width: 74.9375rem');
    expect(tablet).toContain('.app-frame__content');
    expect(tablet).toContain('.card-detail__layout');
    expect(mediaBody(responsive, 'min-width: 75rem')).not.toContain('.app-frame__content');
    expect(appShellCss).toContain('max-inline-size: 72rem');

    // Below 600 px in both the stylesheet and the JavaScript layout hook.
    expect(mediaBody(responsive, 'max-width: 37.4375rem')).toContain('.nd-dialog__panel');
    expect(boardCss).toContain('@media (max-width: 37.4375rem)');
    expect(boardCss).toContain('.case-board-bar');
    expect(cardCss).toContain('.card-detail__sheet-trigger');
  });

  it('keeps the page free of horizontal scrolling without clipping controls', () => {
    expect(declarationsFor(responsive, '.app-frame').get('max-inline-size')).toBe('100%');
    expect(
      declarationsFor(responsive, '.app-frame__content', { topLevelOnly: true }).get(
        'max-inline-size',
      ),
    ).toBe('100%');

    const phone = mediaBody(responsive, 'max-width: 37.4375rem');
    expect(phone).toContain('.nd-dialog__panel');
    expect(phone).not.toContain('overflow-x: hidden');
    expect(responsive).not.toMatch(/overflow-x:\s*hidden/i);
  });

  it('applies safe-area padding to the sticky top bar and fixed bottom elements', () => {
    const root = declarationsFor(responsive, ':root');
    expect(root.get('--safe-area-top')).toContain('env(safe-area-inset-top');
    expect(root.get('--safe-area-bottom')).toBeUndefined();
    expect(root.get('--layout-topbar-padding-block')).toContain('var(--safe-area-top)');
    expect(root.get('--layout-bottom-padding')).toContain('var(--safe-area-bottom)');

    const topbar = declarationsFor(responsive, '.app-frame__topbar');
    expect(topbar.get('position')).toBe('sticky');
    expect(topbar.get('padding-block-start')).toContain('var(--layout-topbar-padding-block)');
    expect(topbar.get('padding-inline-start')).toContain('var(--safe-area-inline-start)');

    expect(declarationsFor(responsive, '.nd-toast-region').get('inset-block-end')).toContain(
      'var(--safe-area-bottom)',
    );

    const phone = mediaBody(responsive, 'max-width: 37.4375rem');
    expect(phone).toMatch(
      /\.nd-dialog__panel[\s\S]*padding-block-end:[\s\S]*var\(--safe-area-bottom\)/,
    );
    expect(phone).toContain('var(--safe-area-top)');
    expect(appShellCss).toContain('var(--safe-area-inline-start)');
  });

  it('keeps board controls and sheet actions at the 44 px target floor', () => {
    for (const [css, selector] of [
      [boardCss, '.case-board-rail__link'],
      [boardCss, '.case-board-bar__add'],
      [cardCss, '.card-detail__sheet-trigger'],
    ] as const) {
      const declarations = declarationsFor(css, selector);
      expect(resolveLengthPx(tokens, declarations.get('min-block-size'))).toBeGreaterThanOrEqual(
        44,
      );
      expect(resolveLengthPx(tokens, declarations.get('min-inline-size'))).toBeGreaterThanOrEqual(
        44,
      );
    }

    // Board zoom controls are shared Buttons; they inherit the 44 px block
    // target and add their own 44 px inline floor.
    const zoom = declarationsFor(boardCanvasCss, '.board-canvas__zoom-button');
    expect(resolveLengthPx(tokens, zoom.get('min-inline-size'))).toBeGreaterThanOrEqual(44);

    const phone = mediaBody(responsive, 'max-width: 37.4375rem');
    expect(phone).toContain('.nd-dialog__actions .nd-button');
    expect(phone).toContain('.card-detail__sheet .nd-button');

    const sheetAction = declarationsFor(responsive, '.nd-dialog__actions .nd-button', {
      media: 'max-width: 37.4375rem',
    });
    expect(resolveLengthPx(tokens, sheetAction.get('min-block-size'))).toBeGreaterThanOrEqual(44);
    expect(resolveLengthPx(tokens, sheetAction.get('min-inline-size'))).toBeGreaterThanOrEqual(44);

    const primitiveButton = declarationsFor(componentsCss, '.nd-button', { topLevelOnly: true });
    expect(resolveLengthPx(tokens, primitiveButton.get('min-block-size'))).toBeGreaterThanOrEqual(
      44,
    );
    expect(resolveLengthPx(tokens, primitiveButton.get('min-inline-size'))).toBeGreaterThanOrEqual(
      44,
    );
  });

  it('keeps phone screen rules in every primary stylesheet', () => {
    expect(mediaBody(responsive, 'max-width: 37.4375rem')).toContain('.shelf__grid');
    expect(mediaBody(responsive, 'max-width: 37.4375rem')).toContain('.card-detail__layout');
    expect(mediaBody(recallCss, 'max-width: 37.4375rem')).toContain('.recall-toolbar__actions');
    expect(mediaBody(searchCss, 'max-width: 37.4375rem')).toContain('.search-panel');
    expect(mediaBody(hintsCss, 'max-width: 37.4375rem')).toContain('.settings-page');
    expect(mediaBody(shelfCss, 'max-width: 37.4375rem')).toContain('.case-card__actions');
    expect(mediaBody(componentsCss, 'max-width: 37.4375rem')).toContain('.nd-dialog__panel');
  });

  it('contains no raw palette values in the responsive and screen stylesheets', () => {
    for (const css of [
      responsive,
      appShellCss,
      boardCss,
      cardCss,
      recallCss,
      shelfCss,
      searchCss,
      hintsCss,
    ]) {
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b/i);
      expect(css).not.toMatch(/\brgba?\(/i);
      expect(css).not.toMatch(/\bhsla?\(/i);
    }
  });
});
