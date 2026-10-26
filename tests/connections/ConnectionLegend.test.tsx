import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';

import ConnectionLegend from '../../src/features/connections/ConnectionLegend';
import {
  contrastRatio,
  declarationsFor,
  parseTokens,
  readRepositoryFile,
  resolveColor,
  resolveLengthPx,
} from '../helpers/css-contract';

const connectionsCss = readRepositoryFile('src/features/connections/connections.css');
const componentsCss = readRepositoryFile('src/components/components.css');
const tokens = parseTokens(readRepositoryFile('src/styles/tokens.css'));

function expectSharedButtonTarget(): void {
  const styles = declarationsFor(componentsCss, '.nd-button');
  const block = resolveLengthPx(tokens, styles.get('min-block-size'));
  const inline = resolveLengthPx(tokens, styles.get('min-inline-size'));

  expect(block, '.nd-button block target').toBeGreaterThanOrEqual(44);
  expect(inline, '.nd-button inline target').toBeGreaterThanOrEqual(44);
}

afterEach(() => {
  cleanup();
});

describe('ConnectionLegend', () => {
  it('names both thread types and distinguishes them by pattern as well as colour', () => {
    render(<ConnectionLegend />);

    const region = screen.getByRole('region', { name: 'Connection legend' });
    expect(region).toBeInTheDocument();

    expect(screen.getByText(/solid red thread/i)).toBeInTheDocument();
    expect(screen.getByText(/dashed amber thread/i)).toBeInTheDocument();
    expect(screen.getByText(/Association/)).toBeInTheDocument();
    expect(screen.getByText(/Provenance/)).toBeInTheDocument();
    expect(screen.getByText(/Study Note to a Source/)).toBeInTheDocument();

    const swatches = region.querySelectorAll<HTMLElement>('.connection-legend__swatch');
    expect(swatches).toHaveLength(2);
    expect(swatches[0]).toHaveAttribute('data-type', 'association');
    expect(swatches[0]).toHaveAttribute('aria-hidden', 'true');
    expect(swatches[1]).toHaveAttribute('data-type', 'provenance');

    const associationLine = declarationsFor(connectionsCss, '.connection-legend__swatch');
    expect(associationLine.get('border-block-start')).toContain('solid');
    expect(associationLine.get('border-block-start')).toContain('var(--color-string-association)');

    const provenanceLine = declarationsFor(
      connectionsCss,
      ".connection-legend__swatch[data-type='provenance']",
    );
    expect(provenanceLine.get('border-block-start')).toContain('dashed');
    expect(provenanceLine.get('border-block-start')).toContain('var(--color-string-provenance)');
  });

  it('is keyboard operable, announces expanded state, and hides the key when collapsed', async () => {
    const user = userEvent.setup();
    render(<ConnectionLegend defaultOpen={false} />);

    const toggle = screen.getByRole('button', { name: 'Connection legend' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveClass('nd-button');
    expectSharedButtonTarget();

    const panel = screen
      .getByTestId('connection-legend')
      .querySelector<HTMLElement>('.connection-legend__panel');
    expect(panel).not.toBeNull();
    expect(panel).toHaveAttribute('hidden');
    expect(toggle).toHaveAttribute('aria-controls', panel?.id);

    await user.tab();
    expect(toggle).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveAttribute('hidden');
    expect(screen.getByRole('group', { name: 'Thread types' })).toBeVisible();

    await user.keyboard(' ');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(panel).toHaveAttribute('hidden');
  });

  it('meets AA text contrast and keeps a visible focus ring', () => {
    render(<ConnectionLegend defaultOpen />);

    const bodyContrast = contrastRatio(
      resolveColor(tokens, '--color-ink-muted'),
      resolveColor(tokens, '--color-surface'),
    );
    const emphasisContrast = contrastRatio(
      resolveColor(tokens, '--color-ink'),
      resolveColor(tokens, '--color-surface'),
    );

    expect(bodyContrast).toBeGreaterThanOrEqual(4.5);
    expect(emphasisContrast).toBeGreaterThanOrEqual(4.5);

    const focusRing = declarationsFor(componentsCss, '.nd-button:focus-visible');
    expect(focusRing.get('outline')).toContain('var(--focus-ring-width)');
    expect(focusRing.get('outline')).toContain('var(--color-focus-ring)');
  });
});
