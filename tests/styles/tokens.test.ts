import { describe, expect, it } from 'vitest';

import {
  contrastRatio,
  declarationsFor,
  listComponentFiles,
  parseCssRules,
  parseTokens,
  readRepositoryFile,
  resolveColor,
  resolveLengthPx,
  resolveToken,
} from '../helpers/css-contract';

const tokensCss = readRepositoryFile('src/styles/tokens.css');
const baseCss = readRepositoryFile('src/styles/base.css');
const componentsCss = readRepositoryFile('src/components/components.css');
const tokens = parseTokens(tokensCss);

function ratio(foreground: string, background: string): number {
  return contrastRatio(resolveColor(tokens, foreground), resolveColor(tokens, background));
}

const bodyPairs = [
  ['body ink on the canvas', '--color-ink', '--color-canvas', 4.5],
  ['body ink on a surface', '--color-ink', '--color-surface', 4.5],
  ['body ink on a raised surface', '--color-ink', '--color-surface-raised', 4.5],
  ['body ink on a sunken field', '--color-ink', '--color-surface-sunken', 4.5],
  ['body ink on a control surface', '--color-ink', '--color-control-surface', 4.5],
  ['body ink on a hovered control', '--color-ink', '--color-control-surface-hover', 4.5],
  ['muted ink on the canvas', '--color-ink-muted', '--color-canvas', 4.5],
  ['muted ink on a surface', '--color-ink-muted', '--color-surface', 4.5],
  ['muted ink on a raised surface', '--color-ink-muted', '--color-surface-raised', 4.5],
  ['muted ink on a sunken field', '--color-ink-muted', '--color-surface-sunken', 4.5],
  ['paper ink on sepia paper', '--color-paper-ink', '--color-paper', 4.5],
  ['paper muted ink on sepia paper', '--color-paper-ink-muted', '--color-paper', 4.5],
  ['link text on the canvas', '--color-link', '--color-canvas', 4.5],
  ['link text on a surface', '--color-link', '--color-surface', 4.5],
  ['error text on a surface', '--color-danger-text', '--color-surface', 4.5],
  ['error text on a raised surface', '--color-danger-text', '--color-surface-raised', 4.5],
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
] as const;

const headingPairs = [
  ['large heading on the canvas', '--color-heading-ink', '--color-canvas', 3],
  ['large heading on a surface', '--color-heading-ink', '--color-surface', 3],
  ['large heading on a raised surface', '--color-heading-ink', '--color-surface-raised', 3],
  ['paper heading on sepia paper', '--color-paper-heading-ink', '--color-paper', 3],
] as const;

const nonTextPairs = [
  ['focus ring on the canvas', '--color-focus-ring', '--color-canvas', 3],
  ['focus ring on a surface', '--color-focus-ring', '--color-surface', 3],
  ['focus ring on a raised surface', '--color-focus-ring', '--color-surface-raised', 3],
  ['focus ring on a control surface', '--color-focus-ring', '--color-control-surface', 3],
  ['focus ring on an oxblood action', '--color-focus-ring', '--color-accent', 3],
  ['primary border on a surface', '--color-accent-border', '--color-surface', 3],
  ['primary border on an oxblood action', '--color-accent-border', '--color-accent', 3],
  ['secondary border on a control surface', '--color-control-border', '--color-control-surface', 3],
  ['danger border on a surface', '--color-danger-border', '--color-surface', 3],
  ['strong rule on a surface', '--color-border-strong', '--color-surface', 3],
  ['strong rule on the canvas', '--color-border-strong', '--color-canvas', 3],
] as const;

describe('token contract', () => {
  it('locks the chosen Midnight Archive direction as the only palette source', () => {
    expect(tokensCss).toMatch(/color-scheme:\s*dark/);
    expect(tokensCss).not.toMatch(/color-scheme:\s*light/);
    expect(tokens.get('--color-cork')).toBeDefined();
    expect(tokens.get('--color-paper')).toBeDefined();
    expect(tokens.get('--color-accent')).toBeDefined();
    expect(tokens.get('--color-pin-dome')).toBeDefined();
    expect(tokens.get('--color-string-association')).toBeDefined();
    expect(tokens.get('--color-string-provenance')).toBeDefined();
  });

  it('defines every semantic token group the primitives consume', () => {
    const requiredGroups = [
      '--font-family-body',
      '--font-family-heading',
      '--font-family-mono',
      '--font-size-xs',
      '--font-size-sm',
      '--font-size-md',
      '--font-size-lg',
      '--font-size-xl',
      '--font-size-2xl',
      '--font-size-3xl',
      '--font-size-display',
      '--font-weight-regular',
      '--font-weight-medium',
      '--font-weight-semibold',
      '--font-weight-bold',
      '--line-height-tight',
      '--line-height-heading',
      '--line-height-body',
      '--line-height-control',
      '--letter-spacing-heading',
      '--letter-spacing-caps',
      '--radius-none',
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
      '--radius-pill',
      '--motion-duration-fast',
      '--motion-duration-base',
      '--motion-duration-slow',
      '--motion-ease-standard',
      '--motion-ease-exit',
      '--motion-lift',
      '--motion-scale-press',
      '--motion-dialog-offset',
      '--motion-toast-offset',
      '--z-dialog',
      '--z-toast',
      '--z-skip-link',
      '--target-min',
      '--border-width',
      '--border-width-strong',
      '--focus-ring-width',
      '--focus-ring-offset',
      '--measure-body',
      '--measure-narrow',
      '--shadow-panel',
      '--shadow-toast',
      '--safe-area-bottom',
    ];

    requiredGroups.forEach((name) => {
      expect(tokens.get(name), `missing token ${name}`).toBeDefined();
    });
  });

  it('keeps the spacing scale on a monotonic 4 px rhythm', () => {
    const spacingNames = [
      '--space-1',
      '--space-2',
      '--space-3',
      '--space-4',
      '--space-5',
      '--space-6',
      '--space-8',
      '--space-10',
      '--space-12',
      '--space-16',
    ];
    const values = spacingNames.map((name) =>
      Number.parseFloat(resolveToken(tokens, name).replace('rem', '')),
    );

    expect(values[0]?.valueOf()).toBeCloseTo(0.25);
    expect(values[1]?.valueOf()).toBeCloseTo(0.5);
    expect(values[2]?.valueOf()).toBeCloseTo(0.75);
    values.forEach((value, index) => {
      if (index > 0) {
        expect(value).toBeGreaterThan(values[index - 1] ?? Number.POSITIVE_INFINITY);
      }
      expect(value * 16).toBeGreaterThanOrEqual(4);
    });
  });

  it('sets the 44 px target floor in one place', () => {
    expect(resolveLengthPx(tokens, resolveToken(tokens, '--target-min'))).toBe(44);
  });

  it.each(bodyPairs)('keeps %s at or above 4.5:1', (_label, foreground, background, minimum) => {
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

  it('reserves the period face for headings and case-file chrome', () => {
    const headingFont = resolveToken(tokens, '--font-family-heading');
    const bodyFont = resolveToken(tokens, '--font-family-body');

    expect(headingFont).toMatch(/serif/i);
    expect(bodyFont).toMatch(/system-ui/i);
    expect(bodyFont).toMatch(/sans-serif/i);

    expect(declarationsFor(baseCss, 'h1', { topLevelOnly: true }).get('font-family')).toBe(
      'var(--font-family-heading)',
    );

    [
      '.nd-button',
      '.nd-icon-button',
      '.nd-field__control',
      '.nd-field__label',
      '.nd-toast__message',
    ].forEach((selector) => {
      expect(declarationsFor(componentsCss, selector).get('font-family')).toBe(
        'var(--font-family-body)',
      );
    });
  });

  it('imports the token layer from the global baseline', () => {
    expect(baseCss).toMatch(/@import\s+['"]\.\/tokens\.css['"]/);
  });

  it('removes primitive transitions, animations, and transforms under reduced motion', () => {
    const reducedMotion = { media: 'prefers-reduced-motion' } as const;

    ['.nd-button', '.nd-icon-button', '.nd-dialog', '.nd-dialog__panel', '.nd-toast'].forEach(
      (selector) => {
        const declarations = declarationsFor(componentsCss, selector, reducedMotion);
        expect(declarations.get('transition'), `${selector} transition`).toMatch(/^none\b/);
        expect(declarations.get('animation'), `${selector} animation`).toMatch(/^none\b/);
      },
    );

    [
      '.nd-button:hover:not(:disabled)',
      '.nd-button:active:not(:disabled)',
      '.nd-icon-button:hover:not(:disabled)',
      '.nd-icon-button:active:not(:disabled)',
      '.nd-dialog__panel',
      '.nd-toast',
    ].forEach((selector) => {
      expect(
        declarationsFor(componentsCss, selector, reducedMotion).get('transform'),
        `${selector} transform`,
      ).toMatch(/^none\b/);
    });

    expect(
      parseCssRules(componentsCss).some((rule) =>
        rule.media?.includes('prefers-reduced-motion: reduce'),
      ),
    ).toBe(true);
  });

  it('uses motion tokens rather than literal durations in primitive styles', () => {
    expect(componentsCss).toMatch(/transition:[\s\S]*var\(--motion-duration-fast\)/);
    expect(componentsCss).toContain('animation: nd-dialog-enter var(--motion-duration-base)');
    expect(componentsCss).toContain('animation: nd-toast-enter var(--motion-duration-base)');
  });

  it('keeps palette values out of every component file', () => {
    const palettePattern = /(#[0-9a-f]{3,8}\b|\brgba?\s*\(|\bhsla?\s*\()/i;
    const componentFiles = listComponentFiles();

    expect(componentFiles.length).toBeGreaterThan(0);

    componentFiles.forEach((file) => {
      const source = readRepositoryFile(`src/components/${file}`);
      expect(source, `${file} contains a raw palette value`).not.toMatch(palettePattern);
    });
  });

  it('never renders user content as HTML from a primitive', () => {
    listComponentFiles()
      .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
      .forEach((file) => {
        expect(readRepositoryFile(`src/components/${file}`)).not.toContain(
          'dangerouslySetInnerHTML',
        );
      });
  });
});
