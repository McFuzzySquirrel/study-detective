/**
 * The grouped, keyboard-readable recall summary.
 *
 * The summary is ordinary document content: headings, ordered groups, and
 * lists of card titles. It deliberately contains no score, percentage, grade,
 * streak, or ranking. A pair with the right endpoints but the wrong
 * relationship type appears in both the remembered list and the type-mismatch
 * list, with an explanatory label, so the student can see what was right and
 * what needs another look.
 *
 * This module is presentation only. It imports no repository, Dexie, PixiJS,
 * or storage API.
 */

import { useId } from 'react';
import type { ReactNode } from 'react';

import type { ConnectionType } from '../../domain/model';

import type { RecallComparison, RecallPair, RecallTypeMismatch } from './compareConnections';

import './recall.css';

export interface RecallResultCard {
  readonly id: string;
  readonly title: string;
}

export interface RecallSummaryProps {
  readonly comparison: RecallComparison;
  readonly cards: readonly RecallResultCard[];
}

const TYPE_LABELS: Readonly<Record<ConnectionType, string>> = Object.freeze({
  association: 'Association',
  provenance: 'Provenance',
});

/** A readable label for a saved or drawn relationship type. */
export function connectionTypeLabel(type: ConnectionType): string {
  return TYPE_LABELS[type];
}

/** The card title, or a safe fallback for a stale/deleted card reference. */
export function recallCardTitle(cards: readonly RecallResultCard[], cardId: string): string {
  return cards.find((card) => card.id === cardId)?.title ?? 'Unknown card';
}

/** A deterministic pair key fallback when a row is rendered without one. */
function pairKeyOf(pair: RecallPair): string {
  return pair.pairKey;
}

function pairCountLabel(count: number): string {
  return count === 1 ? '1 pair' : `${count} pairs`;
}

function mismatchLabel(mismatch: RecallTypeMismatch): string {
  return `${connectionTypeLabel(mismatch.actualType)} drawn / ${connectionTypeLabel(
    mismatch.expectedType,
  )} actual`;
}

interface PairTitlesProps {
  readonly cards: readonly RecallResultCard[];
  readonly pair: RecallPair;
}

/** Two plain-text titles with a decorative arrow that screen readers skip. */
function PairTitles({ cards, pair }: PairTitlesProps) {
  const fromTitle = recallCardTitle(cards, pair.fromCardId);
  const toTitle = recallCardTitle(cards, pair.toCardId);

  return (
    <span className="recall-summary__pair-titles">
      <span>{fromTitle}</span>
      <span className="visually-hidden"> linked to </span>
      <span className="recall-summary__pair-arrow" aria-hidden="true">
        ↔
      </span>
      <span>{toTitle}</span>
    </span>
  );
}

interface SummaryGroupProps {
  readonly kind: 'remembered' | 'missed' | 'extra' | 'typeMismatch';
  readonly headingId: string;
  readonly title: string;
  readonly description: string;
  readonly count: number;
  readonly children: ReactNode;
}

/**
 * One named group. The heading carries the title and the count; the list is a
 * normal list with card titles, so a screen reader can read it without ever
 * focusing the canvas.
 */
function SummaryGroup({ kind, headingId, title, description, count, children }: SummaryGroupProps) {
  return (
    <section
      className="recall-summary__group"
      aria-labelledby={headingId}
      data-testid={`recall-summary-${kind}`}
      data-count={count}
    >
      <h4 id={headingId} className="recall-summary__group-title">
        <span>{title}</span>
        <span className="recall-summary__count">{pairCountLabel(count)}</span>
      </h4>
      <p className="recall-summary__group-description">{description}</p>
      {count === 0 ? (
        <p className="recall-summary__empty">None in this check.</p>
      ) : (
        <ul className="recall-summary__list" aria-label={`${title} pairs`}>
          {children}
        </ul>
      )}
    </section>
  );
}

function PairType({ label }: { readonly label: string }) {
  return (
    <span className="recall-summary__type">
      <span className="visually-hidden">Relationship type: </span>
      {label}
    </span>
  );
}

/**
 * Render remembered, missed, extra, and type-mismatched pairs as four groups.
 * Every visible string comes from a React text node; imported titles can never
 * become markup here.
 */
export function RecallSummary({ comparison, cards }: RecallSummaryProps) {
  const baseId = useId();
  const scratchCount = comparison.remembered.length + comparison.extra.length;

  return (
    <div className="recall-summary" data-testid="recall-summary">
      {scratchCount === 0 ? (
        <p className="recall-summary__note" data-testid="recall-summary-empty-scratch">
          {comparison.missed.length === 0
            ? 'There are no saved or scratch pairs to compare yet.'
            : 'No scratch connections were drawn, so every saved pair is listed as missed.'}
        </p>
      ) : null}

      <SummaryGroup
        kind="remembered"
        headingId={`${baseId}-remembered`}
        title="Remembered"
        description="Saved pairs you rebuilt. A scratch string in either direction counts."
        count={comparison.remembered.length}
      >
        {comparison.remembered.map((pair) => (
          <li className="recall-summary__pair" key={pairKeyOf(pair)}>
            <PairTitles cards={cards} pair={pair} />
            <PairType label={connectionTypeLabel(pair.type)} />
          </li>
        ))}
      </SummaryGroup>

      <SummaryGroup
        kind="missed"
        headingId={`${baseId}-missed`}
        title="Missed"
        description="Saved pairs with no scratch connection yet."
        count={comparison.missed.length}
      >
        {comparison.missed.map((pair) => (
          <li className="recall-summary__pair" key={pairKeyOf(pair)}>
            <PairTitles cards={cards} pair={pair} />
            <PairType label={connectionTypeLabel(pair.type)} />
          </li>
        ))}
      </SummaryGroup>

      <SummaryGroup
        kind="extra"
        headingId={`${baseId}-extra`}
        title="Extra"
        description="Scratch connections that do not match a saved pair."
        count={comparison.extra.length}
      >
        {comparison.extra.map((pair) => (
          <li className="recall-summary__pair" key={pairKeyOf(pair)}>
            <PairTitles cards={cards} pair={pair} />
            <PairType label={connectionTypeLabel(pair.type)} />
          </li>
        ))}
      </SummaryGroup>

      <SummaryGroup
        kind="typeMismatch"
        headingId={`${baseId}-typeMismatch`}
        title="Type mismatches"
        description="The right cards, but the drawn relationship type differs from the saved one."
        count={comparison.typeMismatch.length}
      >
        {comparison.typeMismatch.map((pair) => (
          <li className="recall-summary__pair recall-summary__pair--mismatch" key={pairKeyOf(pair)}>
            <PairTitles cards={cards} pair={pair} />
            <span
              className="recall-summary__mismatch-label"
              data-testid="recall-type-mismatch-label"
              data-expected-type={pair.expectedType}
              data-actual-type={pair.actualType}
            >
              {mismatchLabel(pair)}
            </span>
            <span className="recall-summary__mismatch-note">
              Remembered because the pair matches; the relationship type is different.
            </span>
          </li>
        ))}
      </SummaryGroup>
    </div>
  );
}

function pluralPairs(count: number): string {
  return count === 1 ? '1 pair' : `${count} pairs`;
}

/**
 * A concise sentence for the mounted live region. It reports counts and pair
 * lists only; there is no score or percentage to announce.
 */
export function recallSummaryAnnouncement(comparison: RecallComparison): string {
  const scratchCount = comparison.remembered.length + comparison.extra.length;
  const savedCount = comparison.remembered.length + comparison.missed.length;

  if (scratchCount === 0 && savedCount === 0) {
    return 'Recall results. There are no saved or scratch pairs to compare.';
  }

  if (scratchCount === 0) {
    return `Recall results. No scratch connections were drawn. ${pluralPairs(
      comparison.missed.length,
    )} saved listed as missed.`;
  }

  return [
    'Recall results.',
    `${pluralPairs(comparison.remembered.length)} remembered,`,
    `${pluralPairs(comparison.missed.length)} missed,`,
    `${pluralPairs(comparison.extra.length)} extra,`,
    `${pluralPairs(comparison.typeMismatch.length)} with a different relationship type.`,
  ].join(' ');
}

export default RecallSummary;
