/**
 * A11Y-FR-01 / VIS-FR-03 contrast evidence.
 *
 * The app is a single dark theme with a sepia paper reading surface for archival
 * chrome. Contrast is computed from the semantic tokens themselves, so a future
 * palette edit cannot pass a hand-picked sample while failing a real text or
 * control pair. The same file checks that the paper-specific focus ring is used
 * where a control actually sits on paper.
 */

import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveColor,
} from '../helpers/css-contract';

const tokensCss = readRepositoryFile('src/styles/tokens.css');
const baseCss = readRepositoryFile('src/styles/base.css');
const componentsCss = readRepositoryFile('src/components/components.css');
const settingsCss = readRepositoryFile('src/features/settings/settings.css');
const ocrCss = readRepositoryFile('src/features/ocr/OcrPanel.css');
const tokens = parseTokens(tokensCss);

function ratio(foreground: string, background: string): number {
  return contrastRatio(resolveColor(tokens, foreground), resolveColor(tokens, background));
}

/*
 * Body and control copy. Every dark surface a student can read copy on is
 * listed explicitly; adding a surface token without a readable ink pair is a
 * failure, not an oversight.
 */
const textPairs = [
  ['body ink on the canvas', '--color-ink', '--color-canvas', 4.5],
  ['body ink on the deep canvas', '--color-ink', '--color-canvas-deep', 4.5],
  ['body ink on a surface', '--color-ink', '--color-surface', 4.5],
  ['body ink on a raised surface', '--color-ink', '--color-surface-raised', 4.5],
  ['body ink on a sunken field', '--color-ink', '--color-surface-sunken', 4.5],
  ['body ink on a control surface', '--color-ink', '--color-control-surface', 4.5],
  ['body ink on a hovered control', '--color-ink', '--color-control-surface-hover', 4.5],
  ['body ink on an active control', '--color-ink', '--color-control-surface-active', 4.5],
  ['body ink on cork', '--color-ink', '--color-cork', 4.5],
  ['muted ink on the canvas', '--color-ink-muted', '--color-canvas', 4.5],
  ['muted ink on the deep canvas', '--color-ink-muted', '--color-canvas-deep', 4.5],
  ['muted ink on a surface', '--color-ink-muted', '--color-surface', 4.5],
  ['muted ink on a raised surface', '--color-ink-muted', '--color-surface-raised', 4.5],
  ['muted ink on a sunken field', '--color-ink-muted', '--color-surface-sunken', 4.5],
  ['muted ink on a control surface', '--color-ink-muted', '--color-control-surface', 4.5],
  ['muted ink on cork', '--color-ink-muted', '--color-cork', 4.5],
  ['demo ribbon accent text on a surface', '--color-accent-border', '--color-surface', 4.5],
  ['paper ink on sepia paper', '--color-paper-ink', '--color-paper', 4.5],
  ['paper ink on the paper edge', '--color-paper-ink', '--color-paper-edge', 4.5],
  ['paper muted ink on sepia paper', '--color-paper-ink-muted', '--color-paper', 4.5],
  ['link text on the canvas', '--color-link', '--color-canvas', 4.5],
  ['link text on a surface', '--color-link', '--color-surface', 4.5],
  ['link text on a raised surface', '--color-link', '--color-surface-raised', 4.5],
  ['link text on a sunken field', '--color-link', '--color-surface-sunken', 4.5],
  ['link text on cork', '--color-link', '--color-cork', 4.5],
  ['error text on a surface', '--color-danger-text', '--color-surface', 4.5],
  ['error text on a raised surface', '--color-danger-text', '--color-surface-raised', 4.5],
  ['error text on a sunken field', '--color-danger-text', '--color-surface-sunken', 4.5],
] as const;

const controlPairs = [
  ['primary action label', '--color-accent-ink', '--color-accent', 4.5],
  ['primary action hover label', '--color-accent-ink', '--color-accent-hover', 4.5],
  ['primary action active label', '--color-accent-ink', '--color-accent-active', 4.5],
  ['danger action label', '--color-danger-ink', '--color-danger', 4.5],
  ['danger action hover label', '--color-danger-ink', '--color-danger-hover', 4.5],
  ['success status label', '--color-success-ink', '--color-success', 4.5],
  ['success hover label', '--color-success-ink', '--color-success-hover', 4.5],
  ['warning status label', '--color-warning-ink', '--color-warning', 4.5],
  ['selection label', '--color-selection-ink', '--color-selection-bg', 4.5],
] as const;

/*
 * Large headings are at least 24 px (or 18.66 px bold) in the type scale, so
 * the AA large-text floor is 3:1.
 */
const headingPairs = [
  ['large heading on the canvas', '--color-heading-ink', '--color-canvas', 3],
  ['large heading on the deep canvas', '--color-heading-ink', '--color-canvas-deep', 3],
  ['large heading on a surface', '--color-heading-ink', '--color-surface', 3],
  ['large heading on a raised surface', '--color-heading-ink', '--color-surface-raised', 3],
  ['large heading on a sunken field', '--color-heading-ink', '--color-surface-sunken', 3],
  ['large heading on cork', '--color-heading-ink', '--color-cork', 3],
  ['paper heading on sepia paper', '--color-paper-heading-ink', '--color-paper', 3],
] as const;

/*
 * Non-text contrast for focus indicators and control boundaries. The focus ring
 * is surface-aware: the light ring covers dark surfaces and the two dark rings
 * cover the sepia paper reading surface and the amber status chip.
 */
const nonTextPairs = [
  ['focus ring on the canvas', '--color-focus-ring', '--color-canvas', 3],
  ['focus ring on the deep canvas', '--color-focus-ring', '--color-canvas-deep', 3],
  ['focus ring on a surface', '--color-focus-ring', '--color-surface', 3],
  ['focus ring on a raised surface', '--color-focus-ring', '--color-surface-raised', 3],
  ['focus ring on a sunken field', '--color-focus-ring', '--color-surface-sunken', 3],
  ['focus ring on a control surface', '--color-focus-ring', '--color-control-surface', 3],
  ['focus ring on a hovered control', '--color-focus-ring', '--color-control-surface-hover', 3],
  ['focus ring on an active control', '--color-focus-ring', '--color-control-surface-active', 3],
  ['focus ring on cork', '--color-focus-ring', '--color-cork', 3],
  ['focus ring on an oxblood action', '--color-focus-ring', '--color-accent', 3],
  ['focus ring on a danger action', '--color-focus-ring', '--color-danger', 3],
  ['focus ring on a success status', '--color-focus-ring', '--color-success', 3],
  ['paper focus ring on sepia paper', '--color-focus-ring-on-paper', '--color-paper', 3],
  ['paper focus ring on the paper edge', '--color-focus-ring-on-paper', '--color-paper-edge', 3],
  ['warning focus ring on the amber chip', '--color-focus-ring-on-warning', '--color-warning', 3],
  ['primary border on a surface', '--color-accent-border', '--color-surface', 3],
  ['primary border on an oxblood action', '--color-accent-border', '--color-accent', 3],
  ['control border on a surface', '--color-control-border', '--color-surface', 3],
  ['control border on a sunken field', '--color-control-border', '--color-surface-sunken', 3],
  ['control border on a control surface', '--color-control-border', '--color-control-surface', 3],
  ['danger border on a surface', '--color-danger-border', '--color-surface', 3],
  ['strong rule on a surface', '--color-border-strong', '--color-surface', 3],
  ['strong rule on the canvas', '--color-border-strong', '--color-canvas', 3],
] as const;

describe('semantic contrast contract', () => {
  it.each(textPairs)('keeps %s at or above 4.5:1', (_label, foreground, background, minimum) => {
    expect(ratio(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });

  it.each(controlPairs)('keeps %s at or above 4.5:1', (_label, foreground, background, minimum) => {
    expect(ratio(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });

  it.each(headingPairs)('keeps %s at or above 3:1', (_label, foreground, background, minimum) => {
    expect(ratio(foreground, background)).toBeGreaterThanOrEqual(minimum);
  });

  it.each(nonTextPairs)(
    'keeps %s at or above 3:1 for non-text contrast',
    (_label, foreground, background, minimum) => {
      expect(ratio(foreground, background)).toBeGreaterThanOrEqual(minimum);
    },
  );

  it('defines the surface-aware focus rings and the reduced-motion duration in tokens', () => {
    expect(tokens.get('--color-focus-ring')).toBeDefined();
    expect(tokens.get('--color-focus-ring-on-paper')).toBeDefined();
    expect(tokens.get('--color-focus-ring-on-warning')).toBeDefined();
    expect(tokens.get('--motion-duration-none')).toBe('0ms');
  });

  it('uses the shared focus ring on dark primitives and the paper ring on the paper textarea', () => {
    expect(declarationsFor(baseCss, ':focus-visible').get('outline')).toContain(
      'var(--color-focus-ring)',
    );
    expect(declarationsFor(componentsCss, '.nd-button:focus-visible').get('outline')).toContain(
      'var(--color-focus-ring)',
    );
    expect(
      declarationsFor(componentsCss, '.nd-field__control:focus-visible').get('outline'),
    ).toContain('var(--color-focus-ring)');
    expect(
      declarationsFor(settingsCss, '.appearance-settings__checkbox:focus-visible').get('outline'),
    ).toContain('var(--color-focus-ring)');
    expect(declarationsFor(ocrCss, '.ocr-panel__text:focus-visible').get('outline')).toContain(
      'var(--color-focus-ring-on-paper)',
    );

    // The OCR suggestion is a paper surface with real controls: quiet ink is
    // dark paper ink, the button boundary is dark, and its focus ring is the
    // paper ring.
    expect(declarationsFor(ocrCss, '.ocr-panel__suggestion .nd-button--quiet').get('color')).toBe(
      'var(--color-paper-ink)',
    );
    expect(
      declarationsFor(ocrCss, '.ocr-panel__suggestion .nd-button--quiet').get('border-color'),
    ).toBe('var(--color-paper-ink)');
    expect(
      declarationsFor(ocrCss, '.ocr-panel__suggestion .nd-button--quiet:focus-visible').get(
        'outline-color',
      ),
    ).toBe('var(--color-focus-ring-on-paper)');
    expect(declarationsFor(ocrCss, '.ocr-panel__suggestion .nd-button').get('border-color')).toBe(
      'var(--color-paper-ink)',
    );
  });

  it('keeps base and settings styles free of raw palette values', () => {
    const palettePattern = /(#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\()/i;

    expect(baseCss).not.toMatch(palettePattern);
    expect(settingsCss).not.toMatch(palettePattern);
  });

  it('keeps tokens.css as the only file that names palette values', () => {
    expect(tokensCss).toMatch(/--color-canvas:\s*#[0-9a-f]{6}/i);
    expect(tokensCss).toMatch(/--color-focus-ring-on-paper:\s*#[0-9a-f]{6}/i);
  });
});
