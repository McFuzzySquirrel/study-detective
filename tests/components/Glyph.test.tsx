import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import Glyph from '../../src/components/Glyph';
import type { GlyphName } from '../../src/components/Glyph';

const NAMES: readonly GlyphName[] = ['search', 'card-list', 'case-menu', 'add', 'closure', 'map'];

afterEach(() => {
  cleanup();
});

describe('Glyph', () => {
  it.each(NAMES)('renders %s as one decorative 24x24 SVG', (name) => {
    const { container } = render(<Glyph name={name} />);
    const svgs = container.querySelectorAll('svg');

    expect(svgs).toHaveLength(1);
    expect(svgs[0]).toHaveAttribute('viewBox', '0 0 24 24');
    expect(svgs[0]).toHaveAttribute('aria-hidden', 'true');
    expect(svgs[0]).toHaveAttribute('focusable', 'false');
    expect(svgs[0]).toHaveAttribute('fill', 'none');
    expect(svgs[0]).toHaveAttribute('stroke', 'currentColor');
    expect(svgs[0]).toHaveAttribute('stroke-width', '2');
    expect(svgs[0]).toHaveAttribute('data-glyph', name);
  });

  it('exposes exactly the six documented glyph names', () => {
    render(
      <div>
        {NAMES.map((name) => (
          <Glyph key={name} name={name} />
        ))}
      </div>,
    );

    expect(screen.queryAllByRole('img', { hidden: true })).toHaveLength(0);
    expect(document.querySelectorAll('svg')).toHaveLength(6);
    expect(NAMES).toEqual(['search', 'card-list', 'case-menu', 'add', 'closure', 'map']);
  });
});
