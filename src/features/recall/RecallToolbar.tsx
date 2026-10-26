/**
 * The slim recall toolbar.
 *
 * It owns only UI: the scratch count, the three mode actions, and the list that
 * lets one scratch string be removed by a real keyboard-reachable button. The
 * page owns the in-memory store, the check comparison, and navigation, so this
 * component imports no repository and cannot write storage.
 */

import Button from '../../components/Button';

import type { ScratchConnection } from './recallStore';

import './recall.css';

export interface RecallToolbarCard {
  readonly id: string;
  readonly title: string;
}

export interface RecallToolbarProps {
  readonly scratchConnections: readonly ScratchConnection[];
  readonly cards: readonly RecallToolbarCard[];
  readonly checked: boolean;
  readonly onCheck: () => void;
  readonly onReset: () => void;
  readonly onExit: () => void;
  readonly onRemove: (connectionId: string) => void;
}

function scratchCountLabel(count: number): string {
  return `Scratch ${count} ${count === 1 ? 'connection' : 'connections'}`;
}

function titleFor(cards: readonly RecallToolbarCard[], cardId: string): string {
  return cards.find((card) => card.id === cardId)?.title ?? 'Unknown card';
}

export function RecallToolbar({
  scratchConnections,
  cards,
  checked,
  onCheck,
  onReset,
  onExit,
  onRemove,
}: RecallToolbarProps) {
  const hasScratch = scratchConnections.length > 0;

  return (
    <section className="recall-toolbar" aria-label="Recall controls">
      <div className="recall-toolbar__bar">
        <p className="recall-toolbar__count" data-testid="recall-scratch-count">
          {scratchCountLabel(scratchConnections.length)}
        </p>

        <div className="recall-toolbar__actions">
          <Button variant="primary" onClick={onCheck}>
            Check
          </Button>
          <Button variant="secondary" onClick={onReset} disabled={!hasScratch && !checked}>
            Reset scratch
          </Button>
          <Button variant="quiet" onClick={onExit}>
            Exit recall
          </Button>
        </div>
      </div>

      {hasScratch ? (
        <div className="recall-toolbar__scratch">
          <h3 className="recall-toolbar__scratch-title">Scratch connections</h3>
          <ul className="recall-toolbar__list" aria-label="Scratch connections">
            {scratchConnections.map((connection) => {
              const fromTitle = titleFor(cards, connection.fromCardId);
              const toTitle = titleFor(cards, connection.toCardId);

              return (
                <li key={connection.id} className="recall-toolbar__item">
                  <span className="recall-toolbar__pair">
                    {fromTitle} <span aria-hidden="true">↔</span> {toTitle}
                  </span>
                  <Button
                    variant="quiet"
                    size="md"
                    onClick={() => onRemove(connection.id)}
                    aria-label={`Remove scratch connection between ${fromTitle} and ${toTitle}`}
                  >
                    Remove
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <p className="recall-toolbar__hint">
          Select a card, then drag its red thread anchor to another card. Drawing stays
          pointer-only; every other control here is a normal button.
        </p>
      )}
    </section>
  );
}

export default RecallToolbar;
