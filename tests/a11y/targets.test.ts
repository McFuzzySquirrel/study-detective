/**
 * A11Y-FR-01 / VIS-CON-08 target-size evidence.
 *
 * jsdom has no layout engine, so the geometry is proved from the stylesheets the
 * browser loads while representative component fixtures prove that the real
 * controls actually carry the classes those rules target. A visual 20 px glyph
 * passes only when its interactive wrapper is at least 44x44 CSS pixels.
 */

import { createElement } from 'react';
import type { ComponentType } from 'react';
import { MemoryRouter } from 'react-router';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Button from '../../src/components/Button';
import Dialog from '../../src/components/Dialog';
import EmptyState from '../../src/components/EmptyState';
import Field from '../../src/components/Field';
import type { FieldControlProps, FieldProps } from '../../src/components/Field';
import IconButton from '../../src/components/IconButton';
import type { IconButtonProps } from '../../src/components/IconButton';
import Toast from '../../src/components/Toast';
import { createMotionStore } from '../../src/app/motionPreference';
import type { CardRecord } from '../../src/domain/model';
import { createHintSeenStore } from '../../src/features/onboarding/hints';
import SearchPanel from '../../src/features/search/SearchPanel';
import TagInput from '../../src/features/search/TagInput';
import { SettingsPage } from '../../src/features/settings/SettingsPage';
import type { SettingsPageProps } from '../../src/features/settings/SettingsPage';
import {
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveLengthPx,
} from '../helpers/css-contract';

const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));
const componentsCss = readRepositoryFile('src/components/components.css');
const responsiveCss = readRepositoryFile('src/styles/responsive.css');
const boardCss = readRepositoryFile('src/board/BoardCanvas.css');
const caseBoardCss = readRepositoryFile('src/features/case/CaseBoardPage.css');
const cardDetailCss = readRepositoryFile('src/features/cards/CardDetail.css');
const cardListCss = readRepositoryFile('src/features/case/CardListPanel.css');
const connectionsCss = readRepositoryFile('src/features/connections/connections.css');
const recallCss = readRepositoryFile('src/features/recall/recall.css');
const searchCss = readRepositoryFile('src/features/search/SearchPanel.css');
const tagCss = readRepositoryFile('src/features/search/TagInput.css');
const shelfCss = readRepositoryFile('src/features/shelf/shelf.css');
const settingsCss = readRepositoryFile('src/features/settings/settings.css');
const backupCss = readRepositoryFile('src/features/backup/BackupDialog.css');
const captureCss = readRepositoryFile('src/features/capture/capture.css');
const updateCss = readRepositoryFile('src/app/UpdatePrompt.css');
const appShellCss = readRepositoryFile('src/app/AppShell.css');

const h = createElement;

// `createElement`'s overloads do not infer a required `children` prop from the
// variadic argument in this `.ts` contract file, so the fixtures are cast to
// their component types once.
const Icon = IconButton as ComponentType<IconButtonProps>;
const FieldControl = Field as ComponentType<FieldProps>;
const Settings = SettingsPage as ComponentType<SettingsPageProps>;

afterEach(() => {
  cleanup();
});

const CASE_ID = '11111111-1111-4111-8111-111111111111';

const NOTE: CardRecord = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  caseId: CASE_ID,
  type: 'note',
  title: 'Osmosis lab notes',
  position: { x: 120, y: 140 },
  tags: ['Biology', 'Lab'],
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
};

function targetStyles(
  css: string,
  selector: string,
  options: { readonly media?: string } = {},
): { readonly block: number; readonly inline: number } {
  const declarations = declarationsFor(css, selector, options);

  return {
    block: resolveLengthPx(tokens, declarations.get('min-block-size')),
    inline: resolveLengthPx(tokens, declarations.get('min-inline-size')),
  };
}

describe('primitive fixtures carry the shared 44 px target', () => {
  it('Button and IconButton use the shared target floor', () => {
    render(
      h(
        'div',
        null,
        h(Button, { onClick: vi.fn() }, 'Create case'),
        h(Icon, { label: 'Dismiss notice', children: '×' }),
      ),
    );

    const button = screen.getByRole('button', { name: 'Create case' });
    const iconButton = screen.getByRole('button', { name: 'Dismiss notice' });

    expect(button).toHaveClass('nd-button');
    expect(iconButton).toHaveClass('nd-icon-button');
    expect(button).toHaveClass('nd-button--md');
    expect(iconButton).toHaveClass('nd-icon-button--md');

    const buttonTarget = targetStyles(componentsCss, '.nd-button');
    expect(buttonTarget.block).toBeGreaterThanOrEqual(44);
    expect(buttonTarget.inline).toBeGreaterThanOrEqual(44);

    const icon = declarationsFor(componentsCss, '.nd-icon-button', { topLevelOnly: true });
    expect(resolveLengthPx(tokens, icon.get('inline-size'))).toBeGreaterThanOrEqual(44);
    expect(resolveLengthPx(tokens, icon.get('block-size'))).toBeGreaterThanOrEqual(44);
    expect(targetStyles(componentsCss, '.nd-icon-button').block).toBeGreaterThanOrEqual(44);
    expect(targetStyles(componentsCss, '.nd-icon-button').inline).toBeGreaterThanOrEqual(44);
  });

  it('Dialog close and actions, Toast actions, Field control, and EmptyState action are real targets', () => {
    render(
      h(
        Dialog,
        {
          open: true,
          onClose: vi.fn(),
          title: 'Delete card',
          actions: h(Button, { variant: 'danger', onClick: vi.fn() }, 'Delete card'),
        },
        h('p', null, 'This cannot be undone.'),
      ),
    );

    const dialog = screen.getByRole('dialog', { name: 'Delete card' });
    expect(within(dialog).getByRole('button', { name: 'Close dialog' })).toHaveClass(
      'nd-icon-button',
    );
    expect(within(dialog).getByRole('button', { name: 'Delete card' })).toHaveClass('nd-button');

    cleanup();

    render(
      h(Toast, {
        message: 'Card deleted.',
        actionLabel: 'Undo',
        onAction: vi.fn(),
        onDismiss: vi.fn(),
      }),
    );

    expect(screen.getByRole('button', { name: 'Undo' })).toHaveClass('nd-button');
    expect(screen.getByRole('button', { name: 'Dismiss message' })).toHaveClass('nd-icon-button');

    cleanup();

    render(
      h(FieldControl, {
        label: 'Case title',
        hint: 'A short name.',
        children: (control: FieldControlProps) =>
          h('input', { ...control, value: '', onChange: vi.fn() }),
      }),
    );

    expect(screen.getByLabelText('Case title')).toHaveClass('nd-field__control');
    expect(targetStyles(componentsCss, '.nd-field__control').block).toBeGreaterThanOrEqual(44);
    expect(targetStyles(componentsCss, '.nd-field__control').inline).toBeGreaterThanOrEqual(44);

    cleanup();

    render(
      h(EmptyState, {
        title: 'No cards yet',
        description: 'Add evidence to start this case.',
        action: h(Button, { variant: 'primary', onClick: vi.fn() }, 'Add evidence'),
      }),
    );

    expect(screen.getByRole('button', { name: 'Add evidence' })).toHaveClass('nd-button');
  });
});

describe('screen fixtures carry the classes their stylesheets target', () => {
  it('Settings renders the Appearance motion toggle inside a 44 px label', () => {
    const motionStore = createMotionStore({ storage: null, media: null, root: null });

    render(
      h(Settings, {
        hintStore: createHintSeenStore(null),
        motionStore,
      }),
    );

    const toggle = screen.getByTestId('motion-toggle');
    const appearance = screen.getByTestId('appearance-settings');

    expect(appearance).toHaveClass('appearance-settings');
    expect(appearance).toHaveAttribute('aria-labelledby', 'appearance-title');
    expect(toggle).toHaveClass('appearance-settings__checkbox');
    expect(toggle.closest('label')).toHaveClass('appearance-settings__toggle');

    const labelTarget = targetStyles(settingsCss, '.appearance-settings__toggle');
    expect(labelTarget.block).toBeGreaterThanOrEqual(44);
    expect(labelTarget.inline).toBeGreaterThanOrEqual(44);
  });

  it('Search and TagInput expose 44 px inputs, chips, result actions, and remove controls', async () => {
    const user = userEvent.setup();

    render(
      h(
        MemoryRouter,
        null,
        h(SearchPanel, {
          cards: [NOTE],
          onSelectCard: vi.fn(),
          defaultFiltersOpen: true,
        }),
      ),
    );

    const search = screen.getByRole('searchbox', { name: 'Search cards' });
    expect(search).toHaveClass('nd-field__control');

    expect(screen.getByRole('button', { name: 'Filters' })).toHaveClass('nd-button');
    expect(screen.getByRole('button', { name: 'Clear all' })).toHaveClass('nd-button');

    const tagChip = screen.getByRole('button', { name: 'Biology' });
    expect(tagChip).toHaveClass('search-panel__chip');

    await user.click(tagChip);

    expect(screen.getByRole('button', { name: 'Remove Tag: Biology' })).toHaveClass(
      'search-panel__active-remove',
    );
    expect(screen.getByRole('button', { name: 'Biology' })).toHaveClass('search-panel__chip');

    for (const selector of [
      '.search-panel__chip',
      '.search-panel__active-remove',
      '.search-panel__result-select',
      '.search-panel__detail-link',
    ]) {
      const size = targetStyles(searchCss, selector);
      expect(size.block, `${selector} block`).toBeGreaterThanOrEqual(44);
      expect(size.inline, `${selector} inline`).toBeGreaterThanOrEqual(44);
    }

    cleanup();

    render(h(TagInput, { value: ['Biology'], onChange: vi.fn() }));

    expect(screen.getByRole('button', { name: 'Remove tag Biology' })).toHaveClass(
      'tag-input__remove',
    );
    const removeSize = targetStyles(tagCss, '.tag-input__remove');
    expect(removeSize.block).toBeGreaterThanOrEqual(44);
    expect(removeSize.inline).toBeGreaterThanOrEqual(44);
  });
});

describe('CSS target contract', () => {
  it('sets the shared floor to 44 px', () => {
    expect(resolveLengthPx(tokens, tokens.get('--target-min') ?? '')).toBe(44);
  });

  it('keeps every primary navigation, error, and skip target at 44 px', () => {
    for (const selector of [
      '.app-frame__skip-link',
      '.app-frame__nav a',
      '.not-found__action',
      '.error-view__action',
    ]) {
      const size = targetStyles(appShellCss, selector);
      expect(size.block, `${selector} block`).toBeGreaterThanOrEqual(44);
      expect(size.inline, `${selector} inline`).toBeGreaterThanOrEqual(44);
    }
  });

  it('keeps board, card, and connection controls at 44 px', () => {
    for (const [css, selector] of [
      [boardCss, '.board-minimap__toggle'],
      [caseBoardCss, '.case-board-rail__link'],
      [caseBoardCss, '.case-board-bar__add'],
      [cardDetailCss, '.card-detail__sheet-trigger'],
      [cardListCss, '.card-list__action-link'],
      [cardListCss, '.card-list__action'],
      [connectionsCss, '.connection-type-menu__label'],
      [connectionsCss, '.connection-detail__label'],
      [connectionsCss, '.connection-picker__label'],
      [connectionsCss, '.connection-picker__target-label'],
      [recallCss, '.recall-toolbar__actions .nd-button'],
    ] as const) {
      const size = targetStyles(css, selector);
      expect(size.block, `${selector} block`).toBeGreaterThanOrEqual(44);
      expect(size.inline, `${selector} inline`).toBeGreaterThanOrEqual(44);
    }

    // The zoom buttons inherit the 44 px block floor from `.nd-button` and add
    // their own inline floor.
    const zoom = declarationsFor(boardCss, '.board-canvas__zoom-button');
    expect(resolveLengthPx(tokens, zoom.get('min-inline-size'))).toBeGreaterThanOrEqual(44);
    expect(targetStyles(componentsCss, '.nd-button').block).toBeGreaterThanOrEqual(44);
  });

  it('keeps shelf, capture, backup, update, and phone sheet actions at 44 px', () => {
    for (const [css, selector] of [
      [shelfCss, '.case-card__link'],
      [captureCss, '.capture-toggle'],
      [captureCss, '.capture-form__submit'],
      [backupCss, '.backup-dialog__file-label'],
      [backupCss, '.backup-dialog__choice'],
      [updateCss, '.update-prompt__action'],
      [settingsCss, '.appearance-settings__toggle'],
    ] as const) {
      const size = targetStyles(css, selector);
      expect(size.block, `${selector} block`).toBeGreaterThanOrEqual(44);
      expect(size.inline, `${selector} inline`).toBeGreaterThanOrEqual(44);
    }

    const sheetAction = targetStyles(responsiveCss, '.nd-dialog__actions .nd-button', {
      media: 'max-width: 37.4375rem',
    });
    expect(sheetAction.block).toBeGreaterThanOrEqual(44);
    expect(sheetAction.inline).toBeGreaterThanOrEqual(44);
  });
});
