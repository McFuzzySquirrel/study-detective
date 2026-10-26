/**
 * Recall result presentation: the accessible summary panel and the board
 * overlay that marks each checked pair.
 *
 * The summary is the source of truth for assistive technology. The overlay is
 * decorative (`aria-hidden`) and is positioned from the same plain card
 * positions and camera the canvas uses, so panning or zooming keeps the marks
 * over the cards without the overlay ever becoming an interaction surface.
 *
 * Both surfaces animate only their entrance. Under
 * `prefers-reduced-motion: reduce` the animation is removed entirely and the
 * final marker state is shown immediately.
 *
 * This module imports no repository, Dexie, PixiJS, or storage API.
 */

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import type { Viewport } from '../../domain/model';
import { BOARD_CARD_HEIGHT, BOARD_CARD_WIDTH, worldToScreen } from '../../board/viewport';
import type { BoardPoint } from '../../board/viewport';

import type { RecallComparison, RecallPair, RecallTypeMismatch } from './compareConnections';
import { connectionTypeLabel, RecallSummary } from './RecallSummary';
import type { RecallResultCard } from './RecallSummary';

import './recall.css';

export interface RecallResultsProps {
  readonly comparison: RecallComparison;
  readonly cards: readonly RecallResultCard[];
  /** Defaults to true: Check focuses the results heading for keyboard readers. */
  readonly focusOnMount?: boolean;
}

/** A card with the world position needed to place a decorative marker. */
export interface RecallOverlayCard extends RecallResultCard {
  readonly position: {
    readonly x: number;
    readonly y: number;
  };
}

export interface RecallResultOverlayProps {
  readonly comparison: RecallComparison;
  readonly cards: readonly RecallOverlayCard[];
  readonly viewport: Viewport;
}

type OverlayKind = 'remembered' | 'missed' | 'extra' | 'mismatch';

interface OverlayMarker {
  readonly key: string;
  readonly kind: OverlayKind;
  readonly label: string;
  readonly glyph: string;
  readonly pairKey: string;
  readonly x: number;
  readonly y: number;
}

interface OverlayOutline {
  readonly key: string;
  readonly pairKey: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const KIND_OFFSETS: Readonly<Record<OverlayKind, number>> = Object.freeze({
  remembered: -18,
  missed: 18,
  extra: 0,
  mismatch: 44,
});

function readReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Track the OS motion preference so a mid-session change updates the marks. */
function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readReducedMotion);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }

    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handleChange = (): void => {
      setReduced(query.matches);
    };

    handleChange();
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  return reduced;
}

function cardCenter(card: RecallOverlayCard, viewport: Viewport): BoardPoint {
  return worldToScreen(
    {
      x: card.position.x + BOARD_CARD_WIDTH / 2,
      y: card.position.y + BOARD_CARD_HEIGHT / 2,
    },
    viewport,
  );
}

function midpoint(
  first: RecallOverlayCard,
  second: RecallOverlayCard,
  viewport: Viewport,
): BoardPoint {
  const a = cardCenter(first, viewport);
  const b = cardCenter(second, viewport);
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function cardsFor(
  cards: readonly RecallOverlayCard[],
  pair: RecallPair,
): readonly [RecallOverlayCard, RecallOverlayCard] | null {
  const from = cards.find((card) => card.id === pair.fromCardId);
  const to = cards.find((card) => card.id === pair.toCardId);
  if (from === undefined || to === undefined) {
    return null;
  }
  return [from, to];
}

function mismatchLabel(mismatch: RecallTypeMismatch): string {
  return `${connectionTypeLabel(mismatch.actualType)} drawn / ${connectionTypeLabel(
    mismatch.expectedType,
  )} actual`;
}

function buildOverlay(
  comparison: RecallComparison,
  cards: readonly RecallOverlayCard[],
  viewport: Viewport,
): { readonly markers: readonly OverlayMarker[]; readonly outlines: readonly OverlayOutline[] } {
  const markers: OverlayMarker[] = [];
  const outlines: OverlayOutline[] = [];
  const scale = viewport.scale;

  const mark = (
    kind: OverlayKind,
    pair: RecallPair,
    index: number,
    glyph: string,
    label: string,
  ): void => {
    const endpoints = cardsFor(cards, pair);
    if (endpoints === null) {
      return;
    }

    const center = midpoint(endpoints[0], endpoints[1], viewport);
    markers.push({
      key: `${kind}:${pair.pairKey}`,
      kind,
      label,
      glyph,
      pairKey: pair.pairKey,
      x: center.x,
      y: center.y + KIND_OFFSETS[kind] + index * 22,
    });
  };

  comparison.remembered.forEach((pair, index) => {
    mark('remembered', pair, index, '✓', 'Remembered');
  });

  comparison.missed.forEach((pair, index) => {
    const endpoints = cardsFor(cards, pair);
    if (endpoints === null) {
      return;
    }

    for (const card of endpoints) {
      const topLeft = worldToScreen(card.position, viewport);
      outlines.push({
        key: `missed:${pair.pairKey}:${card.id}`,
        pairKey: pair.pairKey,
        x: topLeft.x,
        y: topLeft.y,
        width: BOARD_CARD_WIDTH * scale,
        height: BOARD_CARD_HEIGHT * scale,
      });
    }

    mark('missed', pair, index, '!', 'Missed');
  });

  comparison.extra.forEach((pair, index) => {
    mark('extra', pair, index, '✕', 'Extra');
  });

  comparison.typeMismatch.forEach((pair, index) => {
    mark('mismatch', pair, index, '≠', mismatchLabel(pair));
  });

  return { markers, outlines };
}

/**
 * The decorative check overlay. It is aria-hidden and pointer-transparent;
 * every result it shows is also in the summary text below the stage.
 */
export function RecallResultOverlay({ comparison, cards, viewport }: RecallResultOverlayProps) {
  const reducedMotion = usePrefersReducedMotion();
  const { markers, outlines } = useMemo(
    () => buildOverlay(comparison, cards, viewport),
    [cards, comparison, viewport],
  );

  return (
    <div
      className="recall-overlay"
      aria-hidden="true"
      data-testid="recall-overlay"
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      data-marker-count={markers.length}
      data-outline-count={outlines.length}
    >
      {outlines.map((outline) => (
        <span
          key={outline.key}
          className="recall-overlay__outline"
          data-testid="recall-overlay-outline"
          data-pair-key={outline.pairKey}
          style={{
            left: `${outline.x}px`,
            top: `${outline.y}px`,
            width: `${outline.width}px`,
            height: `${outline.height}px`,
          }}
        />
      ))}

      {markers.map((marker) => (
        <span
          key={marker.key}
          className={`recall-overlay__marker recall-overlay__marker--${marker.kind}`}
          data-testid="recall-overlay-marker"
          data-result-kind={marker.kind}
          data-pair-key={marker.pairKey}
          style={{
            left: `${marker.x}px`,
            top: `${marker.y}px`,
          }}
        >
          <span className="recall-overlay__glyph" aria-hidden="true">
            {marker.glyph}
          </span>
          <span className="recall-overlay__label">{marker.label}</span>
        </span>
      ))}
    </div>
  );
}

/**
 * The results panel rendered after Check. Mounting it moves focus to the
 * heading so a keyboard or screen-reader user lands on the summary instead of
 * needing the canvas. The page keeps its toolbar mounted and available.
 */
export function RecallResults({ comparison, cards, focusOnMount = true }: RecallResultsProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  const headingId = useId();

  useEffect(() => {
    if (focusOnMount) {
      headingRef.current?.focus();
    }
  }, [comparison, focusOnMount]);

  return (
    <section
      className="recall-results"
      aria-labelledby={headingId}
      data-testid="recall-results"
      data-remembered-count={comparison.remembered.length}
      data-missed-count={comparison.missed.length}
      data-extra-count={comparison.extra.length}
      data-type-mismatch-count={comparison.typeMismatch.length}
    >
      <header className="recall-results__header">
        <h3 id={headingId} ref={headingRef} className="recall-results__title" tabIndex={-1}>
          Recall results
        </h3>
        <p className="recall-results__intro">
          These are pair lists, not a mark. Remembered pairs are a match; missed and extra pairs
          show where to look again.
        </p>
      </header>

      <RecallSummary comparison={comparison} cards={cards} />
    </section>
  );
}

export default RecallResults;
