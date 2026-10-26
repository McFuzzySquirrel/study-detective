/**
 * A11Y-FR-04 / A11Y-CON-02 reduced-motion evidence.
 *
 * Two layers are covered:
 *
 * 1. The install-level motion store and the Appearance toggle: the device
 *    preference is the default, an explicit "reduce" choice persists and
 *    applies to the document root in the same interaction, and a later device
 *    change updates the open page without a reload.
 * 2. The stylesheets and board hand-off: every named motion intent (pin drop,
 *    string draw, auto-pan, page transition, pulse) has an explicit
 *    reduced-motion rule, the board receives the same resolved preference, and
 *    auto-pan is an instant camera jump under reduced motion.
 */

import { createElement } from 'react';
import { MemoryRouter } from 'react-router';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  MOTION_ANIMATION_CLASSES,
  MOTION_ATTRIBUTE,
  MOTION_PREFERENCE_ATTRIBUTE,
  MOTION_STORAGE_KEY,
  createMotionStore,
  motionBehavior,
} from '../../src/app/motionPreference';
import type { MotionMediaQuery, MotionStorage } from '../../src/app/motionPreference';
import type { BoardSnapshot } from '../../src/board/BoardScene';
import type { UsePixiAppResult } from '../../src/board/usePixiApp';
import { createHintSeenStore } from '../../src/features/onboarding/hints';
import { SettingsPage } from '../../src/features/settings/SettingsPage';
import { declarationsFor, mediaBody, readRepositoryFile } from '../helpers/css-contract';

const { usePixiAppMock } = vi.hoisted(() => ({ usePixiAppMock: vi.fn() }));

vi.mock('../../src/board/usePixiApp', () => ({
  usePixiApp: usePixiAppMock,
}));

// Imported after the mock so the Pixi boundary is replaced in jsdom.
import { BoardCanvas } from '../../src/board/BoardCanvas';

const baseCss = readRepositoryFile('src/styles/base.css');
const settingsCss = readRepositoryFile('src/features/settings/settings.css');
const componentsCss = readRepositoryFile('src/components/components.css');

const CASE_ID = '11111111-1111-4111-8111-111111111111';

const SNAPSHOT: BoardSnapshot = {
  caseId: CASE_ID,
  caseTitle: 'Motion case',
  cards: [
    {
      id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      title: 'Alpha note',
      type: 'note',
      position: { x: 100, y: 120 },
    },
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

interface FakeStorage extends MotionStorage {
  readonly values: Map<string, string>;
}

function createStorage(initial: Record<string, string> = {}): FakeStorage {
  const values = new Map(Object.entries(initial));

  return {
    values,
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, value);
    },
    removeItem(key) {
      values.delete(key);
    },
  };
}

interface FakeMedia {
  readonly query: MotionMediaQuery;
  setMatches(matches: boolean): void;
}

function createMedia(initial: boolean): FakeMedia {
  const listeners = new Set<() => void>();
  let matches = initial;

  const query: MotionMediaQuery = {
    get matches() {
      return matches;
    },
    media: '(prefers-reduced-motion: reduce)',
    addEventListener(type, listener) {
      if (type === 'change') {
        listeners.add(listener);
      }
    },
    removeEventListener(type, listener) {
      if (type === 'change') {
        listeners.delete(listener);
      }
    },
  };

  return {
    query,
    setMatches(next) {
      matches = next;
      listeners.forEach((listener) => {
        listener();
      });
    },
  };
}

let media: FakeMedia;
let storage: FakeStorage;

beforeEach(() => {
  media = createMedia(false);
  storage = createStorage();
  document.documentElement.removeAttribute(MOTION_ATTRIBUTE);
  document.documentElement.removeAttribute(MOTION_PREFERENCE_ATTRIBUTE);
  usePixiAppMock.mockImplementation(() => readyPixi());
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute(MOTION_ATTRIBUTE);
  document.documentElement.removeAttribute(MOTION_PREFERENCE_ATTRIBUTE);
});

describe('motion store', () => {
  it('follows the device preference until an explicit choice is made', () => {
    const store = createMotionStore({
      storage,
      media: media.query,
      root: document.documentElement,
    });

    store.refresh();

    expect(store.getPreference()).toBe('system');
    expect(store.isReduced()).toBe(false);
    expect(document.documentElement).toHaveAttribute(MOTION_ATTRIBUTE, 'full');
    expect(document.documentElement).toHaveAttribute(MOTION_PREFERENCE_ATTRIBUTE, 'system');
  });

  it('defaults to the device reduced-motion request without storing an override', () => {
    media.setMatches(true);

    const store = createMotionStore({
      storage,
      media: media.query,
      root: document.documentElement,
    });

    store.refresh();

    expect(store.isReduced()).toBe(true);
    expect(store.getPreference()).toBe('system');
    expect(storage.values.has(MOTION_STORAGE_KEY)).toBe(false);
    expect(document.documentElement).toHaveAttribute(MOTION_ATTRIBUTE, 'reduced');
  });

  it('persists an explicit reduced choice and reads it back in a new store', () => {
    const store = createMotionStore({
      storage,
      media: media.query,
      root: document.documentElement,
    });

    store.setReduced(true);

    expect(store.getPreference()).toBe('reduced');
    expect(storage.values.get(MOTION_STORAGE_KEY)).toBe('reduced');
    expect(document.documentElement).toHaveAttribute(MOTION_ATTRIBUTE, 'reduced');
    expect(document.documentElement).toHaveAttribute(MOTION_PREFERENCE_ATTRIBUTE, 'reduced');

    const reopened = createMotionStore({
      storage,
      media: media.query,
      root: document.documentElement,
    });
    reopened.refresh();

    expect(reopened.isReduced()).toBe(true);
  });

  it('clears the override and returns to the device setting', () => {
    const store = createMotionStore({
      storage,
      media: media.query,
      root: document.documentElement,
    });

    store.setReduced(true);
    store.setReduced(false);

    expect(store.getPreference()).toBe('system');
    expect(store.isReduced()).toBe(false);
    expect(storage.values.has(MOTION_STORAGE_KEY)).toBe(false);
    expect(document.documentElement).toHaveAttribute(MOTION_ATTRIBUTE, 'full');
  });

  it('never lets the app override a device that asks for reduced motion', () => {
    media.setMatches(true);

    const store = createMotionStore({
      storage,
      media: media.query,
      root: document.documentElement,
    });

    store.setReduced(false);

    expect(store.isReduced()).toBe(true);
    expect(store.getPreference()).toBe('system');
    expect(document.documentElement).toHaveAttribute(MOTION_ATTRIBUTE, 'reduced');
  });

  it('applies a live device change while the page is open', () => {
    const store = createMotionStore({
      storage,
      media: media.query,
      root: document.documentElement,
    });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.refresh();
    expect(document.documentElement).toHaveAttribute(MOTION_ATTRIBUTE, 'full');

    act(() => {
      media.setMatches(true);
    });

    expect(listener).toHaveBeenCalled();
    expect(document.documentElement).toHaveAttribute(MOTION_ATTRIBUTE, 'reduced');

    unsubscribe();
    store.dispose();
  });
});

describe('Appearance motion toggle', () => {
  function renderSettings(store = createMotionStore({ storage, media: media.query })) {
    return render(<SettingsPage hintStore={createHintSeenStore(null)} motionStore={store} />);
  }

  it('defaults to the device setting and applies a reduced choice immediately', async () => {
    const user = userEvent.setup();
    renderSettings();

    const toggle = screen.getByTestId('motion-toggle');
    const status = screen.getByTestId('motion-status');

    expect(toggle).not.toBeChecked();
    expect(toggle).toBeEnabled();
    expect(toggle).toHaveAttribute('aria-labelledby');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(status).toHaveTextContent('Motion is on.');
    expect(document.documentElement).toHaveAttribute(MOTION_ATTRIBUTE, 'full');

    await user.click(toggle);

    expect(toggle).toBeChecked();
    expect(toggle).toHaveFocus();
    expect(storage.values.get(MOTION_STORAGE_KEY)).toBe('reduced');
    expect(document.documentElement).toHaveAttribute(MOTION_ATTRIBUTE, 'reduced');
    expect(status).toHaveTextContent('Reduced motion is on.');
  });

  it('operates the toggle from the keyboard without moving focus', async () => {
    const user = userEvent.setup();
    renderSettings();

    const toggle = screen.getByTestId('motion-toggle');
    toggle.focus();
    expect(toggle).toHaveFocus();

    await user.keyboard(' ');

    expect(toggle).toBeChecked();
    expect(toggle).toHaveFocus();
    expect(storage.values.get(MOTION_STORAGE_KEY)).toBe('reduced');
    expect(document.documentElement).toHaveAttribute(MOTION_ATTRIBUTE, 'reduced');
  });

  it('reads a persisted reduced choice back after a remount', async () => {
    const user = userEvent.setup();
    const first = renderSettings();

    await user.click(screen.getByTestId('motion-toggle'));
    first.unmount();

    renderSettings(
      createMotionStore({ storage, media: media.query, root: document.documentElement }),
    );

    expect(screen.getByTestId('motion-toggle')).toBeChecked();
    expect(document.documentElement).toHaveAttribute(MOTION_ATTRIBUTE, 'reduced');
  });

  it('shows the device request as checked and disabled with an explanatory note', () => {
    media.setMatches(true);
    renderSettings();

    const toggle = screen.getByTestId('motion-toggle');

    expect(toggle).toBeChecked();
    expect(toggle).toBeDisabled();
    expect(toggle.closest('label')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByText(/Your device asks for reduced motion/i)).toBeInTheDocument();
    expect(document.documentElement).toHaveAttribute(MOTION_ATTRIBUTE, 'reduced');
  });

  it('updates an open Settings page when the device setting changes', () => {
    renderSettings();

    expect(screen.getByTestId('motion-toggle')).not.toBeChecked();

    act(() => {
      media.setMatches(true);
    });

    expect(screen.getByTestId('motion-toggle')).toBeChecked();
    expect(document.documentElement).toHaveAttribute(MOTION_ATTRIBUTE, 'reduced');
  });
});

describe('reduced-motion stylesheet contract', () => {
  it('removes animation, transitions, and smooth scrolling for the in-app setting', () => {
    const globalRule = declarationsFor(baseCss, ":root[data-motion='reduced'] *");

    expect(globalRule.get('animation')).toMatch(/^none\b/);
    expect(globalRule.get('transition')).toMatch(/^none\b/);
    expect(globalRule.get('scroll-behavior')).toMatch(/^auto\b/);

    expect(declarationsFor(baseCss, ":root[data-motion='reduced']").get('scroll-behavior')).toMatch(
      /^auto\b/,
    );
  });

  it('names every required motion intent and neutralises each one explicitly', () => {
    for (const className of MOTION_ANIMATION_CLASSES) {
      const declarations = declarationsFor(baseCss, `:root[data-motion='reduced'] .${className}`);

      expect(declarations.get('animation'), `${className} animation`).toMatch(/^none\b/);
      expect(declarations.get('transition'), `${className} transition`).toMatch(/^none\b/);
      expect(baseCss, `${className} missing from the motion layer`).toContain(`.${className}`);
    }
  });

  it('keeps the platform media-query fallback for the pre-hydration frame', () => {
    const reducedMedia = mediaBody(baseCss, 'prefers-reduced-motion: reduce');

    expect(reducedMedia).toContain('animation: none');
    expect(reducedMedia).toContain('transition: none');
    expect(reducedMedia).toContain('scroll-behavior: auto');
  });

  it('removes Settings and shared primitive motion under both entry points', () => {
    expect(
      declarationsFor(settingsCss, ":root[data-motion='reduced'] .appearance-settings__toggle").get(
        'transition',
      ),
    ).toMatch(/^none\b/);

    expect(
      declarationsFor(settingsCss, '.appearance-settings__toggle', {
        media: 'prefers-reduced-motion',
      }).get('transition'),
    ).toMatch(/^none\b/);

    for (const selector of [
      '.nd-button',
      '.nd-icon-button',
      '.nd-dialog',
      '.nd-dialog__panel',
      '.nd-toast',
    ]) {
      const declarations = declarationsFor(componentsCss, selector, {
        media: 'prefers-reduced-motion',
      });

      expect(declarations.get('animation'), `${selector} animation`).toMatch(/^none\b/);
      expect(declarations.get('transition'), `${selector} transition`).toMatch(/^none\b/);
    }
  });
});

describe('board hand-off and auto-pan policy', () => {
  it('reports every required motion category as suppressed when reduced', () => {
    const reduced = motionBehavior(true);
    const full = motionBehavior(false);

    expect(reduced).toMatchObject({
      reduced: true,
      pinDrop: 'suppress',
      stringDraw: 'suppress',
      autoPan: 'instant',
      pageTransition: 'suppress',
      pulse: 'suppress',
      durationMs: 0,
    });

    expect(full).toMatchObject({
      reduced: false,
      pinDrop: 'allow',
      stringDraw: 'allow',
      autoPan: 'allow',
      pageTransition: 'allow',
      pulse: 'allow',
    });
    expect(full.durationMs).toBeGreaterThan(0);
  });

  it('passes the persisted reduced choice into the Pixi scene and marks the board', () => {
    const store = createMotionStore({
      storage: createStorage({ [MOTION_STORAGE_KEY]: 'reduced' }),
      media: media.query,
      root: document.documentElement,
    });

    render(
      createElement(
        MemoryRouter,
        null,
        createElement(BoardCanvas, { snapshot: SNAPSHOT, motionStore: store }),
      ),
    );

    const board = screen.getByTestId('board-canvas');

    expect(board).toHaveAttribute('data-motion', 'reduced');
    expect(board).toHaveAttribute('data-motion-auto-pan', 'instant');
    expect(board).toHaveClass('motion-pin-drop');
    expect(board).toHaveClass('motion-string-draw');
    expect(board).toHaveClass('motion-auto-pan');

    expect(usePixiAppMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ reducedMotion: true }),
    );
  });

  it('does not schedule a camera animation when reduced motion is active', () => {
    const store = createMotionStore({
      storage: createStorage({ [MOTION_STORAGE_KEY]: 'reduced' }),
      media: media.query,
      root: document.documentElement,
    });
    const frameSpy = vi.spyOn(window, 'requestAnimationFrame');

    render(
      createElement(
        MemoryRouter,
        null,
        createElement(BoardCanvas, { snapshot: SNAPSHOT, motionStore: store }),
      ),
    );

    // BoardCanvas's mocked Pixi boundary is inert; the only camera path on this
    // surface is the store's synchronous temporary viewport. No auto-pan frame
    // is requested by the reduced-motion branch.
    expect(frameSpy).not.toHaveBeenCalled();

    frameSpy.mockRestore();
  });
});

describe('page and remount stability', () => {
  it('keeps the root attributes after Settings unmounts', async () => {
    const user = userEvent.setup();
    const view = render(
      <SettingsPage
        hintStore={createHintSeenStore(null)}
        motionStore={createMotionStore({ storage, media: media.query })}
      />,
    );

    await user.click(screen.getByTestId('motion-toggle'));
    view.unmount();

    await waitFor(() => {
      expect(document.documentElement).toHaveAttribute(MOTION_ATTRIBUTE, 'reduced');
    });
  });
});
