/**
 * The six board glyphs.
 *
 * Icons are inline SVG so the board route carries no icon library, icon font,
 * or CSS mask. Every glyph is decorative: the surrounding button or link owns
 * the accessible name. Geometry is a 24x24 viewBox, a 2 px currentColor stroke,
 * and round caps and joins so the silhouette stays legible at 24 px.
 */

import './components.css';

export type GlyphName = 'search' | 'card-list' | 'case-menu' | 'add' | 'closure' | 'map';

export interface GlyphProps {
  readonly name: GlyphName;
  readonly className?: string | undefined;
}

function glyphBody(name: GlyphName) {
  switch (name) {
    case 'search':
      return (
        <>
          <circle cx="10.5" cy="10.5" r="6.5" />
          <path d="M15.5 15.5 21 21" />
        </>
      );
    case 'card-list':
      return (
        <>
          <path d="M9 6h11M9 12h11M9 18h11" />
          <circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
        </>
      );
    case 'case-menu':
      return (
        <>
          <circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
          <circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none" />
        </>
      );
    case 'add':
      return <path d="M12 5v14M5 12h14" />;
    case 'closure':
      return <path d="M6 21V4m0 0h11l-2.2 4L17 12H6" />;
    case 'map':
      return (
        <>
          <path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2Z" />
          <path d="M9 4v14M15 6v14" />
        </>
      );
  }
}

export default function Glyph({ name, className }: GlyphProps) {
  return (
    <svg
      className={['nd-glyph', className].filter(Boolean).join(' ')}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-glyph={name}
    >
      {glyphBody(name)}
    </svg>
  );
}
