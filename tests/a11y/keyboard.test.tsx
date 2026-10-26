/**
 * A11Y-FR-02 / A11Y-FR-06 keyboard evidence.
 *
 * These tests prove the non-spatial keyboard contract at the component level:
 * the shell mounts one shortcut listener, shortcuts stay inert while typing,
 * search/help/traversal/connect work through real controls, Settings documents
 * every shortcut, the recall toolbar restores focus when Reset disables itself,
 * and the canvas exposes a name, a description, and a visible card-list link.
 * The real-browser journey lives in `e2e/keyboard-journey.spec.ts`.
 */

import { MemoryRouter, useLocation } from 'react-router';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import AppShell from '../../src/app/AppShell';
import { connectFocusedCard, moveCardListFocus } from '../../src/app/focus';
import KeyboardShortcuts from '../../src/app/KeyboardShortcuts';
import { createBoardStore } from '../../src/board/boardStore';
import type { BoardSnapshot } from '../../src/board/BoardScene';
import type { UsePixiAppResult } from '../../src/board/usePixiApp';
import { KEYBOARD_SHORTCUTS } from '../../src/components/shortcuts';
import type { CardRecord } from '../../src/domain/model';
import CardListPanel from '../../src/features/case/CardListPanel';
import { createHintSeenStore } from '../../src/features/onboarding/hints';
import RecallToolbar from '../../src/features/recall/RecallToolbar';
import SearchPanel from '../../src/features/search/SearchPanel';
import SettingsPage from '../../src/features/settings/SettingsPage';

const { usePixiAppMock } = vi.hoisted(() => ({ usePixiAppMock: vi.fn() }));

vi.mock('../../src/board/usePixiApp', () => ({
  usePixiApp: usePixiAppMock,
}));

// Imported after the mock so the Pixi boundary is replaced without pulling the
// renderer into jsdom.
import { BoardCanvas } from '../../src/board/BoardCanvas';

const CASE_ID = '11111111-1111-4111-8111-111111111111';

function card(id: string, title: string, x: number): CardRecord {
  return {
    id,
    caseId: CASE_ID,
    type: 'note',
    title,
    position: { x, y: 120 },
    tags: [],
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
  };
}

const ALPHA = card('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'Alpha note', 100);
const BETA = card('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'Beta note', 500);

const SNAPSHOT: BoardSnapshot = {
  caseId: CASE_ID,
  caseTitle: 'Keyboard case',
  cards: [
    { id: ALPHA.id, title: ALPHA.title, type: 'note', position: ALPHA.position },
    { id: BETA.id, title: BETA.title, type: 'note', position: BETA.position },
  ],
};

function readyPixi(): UsePixiAppResult {
  return {
    status: 'ready',
    error: null,
    contextLost: false,
    viewportSize: { width: 1000, height: 800 },
    retry: vi.fn(),
    recover: vi.fn(),
  };
}

beforeEach(() => {
  usePixiAppMock.mockImplementation(() => readyPixi());
});

afterEach(() => {
  cleanup();
});

function renderShell(route = '/settings') {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <AppShell>
        <button type="button">Case content</button>
      </AppShell>
    </MemoryRouter>,
  );
}

function LocationProbe() {
  const location = useLocation();

  return (
    <output data-testid="location">
      {location.pathname}
      {location.search}
    </output>
  );
}

describe('KeyboardShortcuts mounted by AppShell', () => {
  it('opens the shortcut help with ?, lists every shortcut, and restores focus on Escape', async () => {
    const user = userEvent.setup();
    renderShell();

    const trigger = screen.getByRole('button', { name: 'Case content' });
    trigger.focus();
    expect(trigger).toHaveFocus();

    await user.keyboard('?');

    const dialog = await screen.findByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(dialog).toBeInTheDocument();

    for (const shortcut of KEYBOARD_SHORTCUTS) {
      const row = dialog.querySelector<HTMLElement>(`[data-shortcut-id="${shortcut.id}"]`);
      expect(row).not.toBeNull();
      expect(within(row as HTMLElement).getByText(shortcut.keys)).toBeInTheDocument();
      expect(within(row as HTMLElement).getByText(shortcut.title)).toBeInTheDocument();
      expect(within(row as HTMLElement).getByText(shortcut.description)).toBeInTheDocument();
    }

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('does not fire any shortcut while typing in an editable field', async () => {
    const user = userEvent.setup();
    const connect = vi.fn();

    render(
      <MemoryRouter>
        <KeyboardShortcuts />
        <div data-shortcut-target="search" tabIndex={-1} data-testid="search-proxy" />
        <input aria-label="Title" />
        <textarea aria-label="Notes" />
        <select aria-label="Type">
          <option>Note</option>
        </select>
        <div role="textbox" aria-label="Rich text" contentEditable tabIndex={0} />
        <article data-card-row="true" data-card-id={ALPHA.id}>
          <button type="button" data-connect-action="true" onClick={connect}>
            Connect Alpha
          </button>
        </article>
      </MemoryRouter>,
    );

    const editableFields = [
      screen.getByRole('textbox', { name: 'Title' }),
      screen.getByRole('textbox', { name: 'Notes' }),
      screen.getByRole('combobox', { name: 'Type' }),
      screen.getByRole('textbox', { name: 'Rich text' }),
    ];

    for (const field of editableFields) {
      field.focus();
      expect(field).toHaveFocus();

      await user.keyboard('?');
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

      await user.keyboard('/');
      expect(field).toHaveFocus();
      expect(screen.getByTestId('search-proxy')).not.toHaveFocus();

      await user.keyboard(']');
      expect(field).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Connect Alpha' })).not.toHaveFocus();

      await user.keyboard('[[');
      expect(field).toHaveFocus();
      expect(screen.getByRole('button', { name: 'Connect Alpha' })).not.toHaveFocus();

      await user.keyboard('c');
      expect(connect).not.toHaveBeenCalled();
    }
  });

  it('ignores shortcuts with Ctrl, Meta, or Alt held', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.keyboard('{Control>}?{/Control}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.keyboard('{Meta>}?{/Meta}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await user.keyboard('{Alt>}?{/Alt}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('shortcut actions on real controls', () => {
  it('focuses search with /, moves between cards with [ and ], and connects with c', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <KeyboardShortcuts />
        <CardListPanel cards={[ALPHA, BETA]} onEdit={vi.fn()} onDelete={vi.fn()} />
      </MemoryRouter>,
    );

    const search = screen.getByRole('searchbox', { name: 'Search cards' });

    await user.keyboard('/');
    expect(search).toHaveFocus();
    expect(search).toHaveAttribute('data-shortcut-target', 'search');

    (document.activeElement as HTMLElement | null)?.blur();

    const openAlpha = screen.getByRole('link', { name: 'Open detail for Alpha note' });
    const openBeta = screen.getByRole('link', { name: 'Open detail for Beta note' });

    await user.keyboard(']');
    expect(openAlpha).toHaveFocus();

    await user.keyboard(']');
    expect(openBeta).toHaveFocus();

    await user.keyboard('[[');
    expect(openAlpha).toHaveFocus();

    await user.keyboard('c');

    const picker = await screen.findByRole('dialog', { name: 'Connect to a card' });
    expect(picker).toBeInTheDocument();
    expect(within(picker).getByRole('searchbox', { name: 'Find a target card' })).toHaveFocus();
  });

  it('clears an active search with Escape while leaving the field focused', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter>
        <KeyboardShortcuts />
        <SearchPanel cards={[ALPHA, BETA]} onSelectCard={vi.fn()} debounceMs={0} />
      </MemoryRouter>,
    );

    const search = screen.getByRole('searchbox', { name: 'Search cards' });
    await user.type(search, 'Alpha');

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('1 card matches your search.');
    });

    await user.keyboard('{Escape}');

    expect(search).toHaveValue('');
    expect(search).toHaveFocus();
    expect(screen.getByRole('status')).toHaveTextContent('2 cards available.');
  });

  it('sends / from card detail to the card-list search route', async () => {
    const user = userEvent.setup();

    render(
      <MemoryRouter initialEntries={['/case/case-1/card/card-1']}>
        <KeyboardShortcuts />
        <LocationProbe />
      </MemoryRouter>,
    );

    await user.keyboard('/');

    await waitFor(() => {
      expect(screen.getByTestId('location')).toHaveTextContent('/case/case-1/list?focus=search');
    });
  });

  it('focuses the search field when the card list opens with focus=search', async () => {
    render(
      <MemoryRouter initialEntries={['/case/case-1/list?focus=search']}>
        <SearchPanel cards={[ALPHA, BETA]} onSelectCard={vi.fn()} debounceMs={0} />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole('searchbox', { name: 'Search cards' })).toHaveFocus();
    });
  });
});

describe('Settings shortcut documentation', () => {
  it('lists every shortcut with its key, name, and description', () => {
    render(
      <MemoryRouter>
        <SettingsPage hintStore={createHintSeenStore(null)} />
      </MemoryRouter>,
    );

    const section = screen.getByRole('region', { name: 'Keyboard shortcuts' });

    for (const shortcut of KEYBOARD_SHORTCUTS) {
      const row = section.querySelector<HTMLElement>(`[data-shortcut-id="${shortcut.id}"]`);
      expect(row).not.toBeNull();
      expect(within(row as HTMLElement).getByText(shortcut.keys)).toBeInTheDocument();
      expect(within(row as HTMLElement).getByText(shortcut.title)).toBeInTheDocument();
      expect(within(row as HTMLElement).getByText(shortcut.description)).toBeInTheDocument();
    }

    expect(section).toHaveTextContent('Spatial placement, canvas panning, and scratch drawing');
  });
});

describe('recall toolbar focus handling', () => {
  it('moves focus to Check when Reset disables itself after clearing a result', async () => {
    const props = {
      scratchConnections: [],
      cards: [ALPHA, BETA],
      onCheck: vi.fn(),
      onReset: vi.fn(),
      onExit: vi.fn(),
      onRemove: vi.fn(),
    };

    const { rerender } = render(
      <MemoryRouter>
        <RecallToolbar {...props} checked />
      </MemoryRouter>,
    );

    const reset = screen.getByRole('button', { name: 'Reset scratch' });
    reset.focus();
    expect(reset).toHaveFocus();

    rerender(
      <MemoryRouter>
        <RecallToolbar {...props} checked={false} />
      </MemoryRouter>,
    );

    expect(screen.getByRole('button', { name: 'Check' })).toHaveFocus();
  });
});

describe('canvas text alternative', () => {
  it('exposes a name, description, and visible Open card list action', () => {
    render(
      <MemoryRouter initialEntries={[`/case/${CASE_ID}`]}>
        <BoardCanvas snapshot={SNAPSHOT} store={createBoardStore()} />
      </MemoryRouter>,
    );

    const host = screen.getByRole('group', { name: 'Case board canvas' });
    expect(host).toHaveAccessibleDescription(
      'Case board with 2 cards arranged spatially. Use Open card list for a keyboard-operable view. Placement, panning, and thread drawing stay pointer-only.',
    );

    const openList = screen.getByTestId('open-card-list');
    expect(openList).toBeVisible();
    expect(openList).toHaveAttribute('href', `/case/${CASE_ID}/list`);
    expect(screen.getByTestId('board-canvas')).toHaveAttribute('data-board-card-count', '2');
  });
});

describe('focus helpers survive real DOM removal', () => {
  it('moves card focus and clamps at the ends instead of wrapping', () => {
    const { container } = render(
      <>
        <article data-card-row="true" data-card-id="a">
          <button type="button" data-card-open="true">
            Open A
          </button>
        </article>
        <article data-card-row="true" data-card-id="b">
          <button type="button" data-card-open="true">
            Open B
          </button>
        </article>
      </>,
    );

    const openA = within(container).getByRole('button', { name: 'Open A' });
    const openB = within(container).getByRole('button', { name: 'Open B' });

    openA.focus();
    expect(moveCardListFocus('next')).toBe('b');
    expect(openB).toHaveFocus();

    expect(moveCardListFocus('next')).toBe('b');
    expect(openB).toHaveFocus();

    expect(moveCardListFocus('previous')).toBe('a');
    expect(openA).toHaveFocus();
  });

  it('reports no card target when the list is empty', () => {
    render(<p>No cards</p>);

    expect(moveCardListFocus('next')).toBeNull();
    expect(moveCardListFocus('previous')).toBeNull();
    expect(connectFocusedCard()).toBe(false);
  });
});
