import { useCallback, useId, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import Button from '../../components/Button';
import type { CardRecord, CardType, ConnectionRecord } from '../../domain/model';
import { CARD_TYPES } from '../../domain/model';
import SearchPanel from '../search/SearchPanel';

import './CardListPanel.css';

const CARD_TYPE_LABELS: Record<CardType, string> = {
  note: 'Study note',
  source: 'Source',
  topic: 'Topic',
};

const GROUP_LABELS: Record<CardType, string> = {
  note: 'Study notes',
  source: 'Sources',
  topic: 'Topics',
};

const GROUP_DESCRIPTIONS: Record<CardType, string> = {
  note: 'Photographed notes and the explanations you want to remember.',
  source: 'Reference material that supports a note.',
  topic: 'Text-only headings that can anchor a thread.',
};

/** How many strings currently name this card as an endpoint. */
function countCardStrings(connections: readonly ConnectionRecord[], cardId: string): number {
  return connections.filter(
    (connection) => connection.fromCardId === cardId || connection.toCardId === cardId,
  ).length;
}

function topicStatusText(stringCount: number): string {
  if (stringCount === 0) {
    return 'No strings yet';
  }
  return `${stringCount} ${stringCount === 1 ? 'string' : 'strings'} attached`;
}

export interface CardListPanelProps {
  readonly cards: readonly CardRecord[];
  /** Strings are read only to derive the topic-status slot; none are created here. */
  readonly connections?: readonly ConnectionRecord[];
  readonly onEdit: (card: CardRecord) => void;
  readonly onDelete: (card: CardRecord) => void;
  /**
   * Optional override for choosing a search result. The default navigates to
   * the board with the card focused and centered.
   */
  readonly onSearchSelect?: ((card: CardRecord) => void) | undefined;
  /** Optional detail path builder for search results. */
  readonly searchDetailHref?: ((card: CardRecord) => string) | undefined;
}

interface CardListGroupProps {
  readonly type: CardType;
  readonly cards: readonly CardRecord[];
  readonly connections: readonly ConnectionRecord[];
  readonly onEdit: (card: CardRecord) => void;
  readonly onDelete: (card: CardRecord) => void;
}

function CardListGroup({ type, cards, connections, onEdit, onDelete }: CardListGroupProps) {
  const headingId = `card-list-group-${useId().replace(/:/g, '')}-${type}`;

  return (
    <section className="card-list__group" aria-labelledby={headingId} data-card-group={type}>
      <header className="card-list__group-header">
        <h3 id={headingId} className="card-list__group-title">
          {GROUP_LABELS[type]}
          <span className="card-list__group-count">{cards.length}</span>
        </h3>
        <p className="card-list__group-description">{GROUP_DESCRIPTIONS[type]}</p>
      </header>

      <ul className="card-list__cards">
        {cards.map((card) => {
          const stringCount = countCardStrings(connections, card.id);
          return (
            <li key={card.id} className="card-list__item">
              <article
                id={`card-row-${card.id}`}
                className="card-list__card"
                aria-labelledby={`card-title-${card.id}`}
                data-card-id={card.id}
                data-card-type={card.type}
              >
                <div className="card-list__body">
                  <p className="card-list__type">{CARD_TYPE_LABELS[card.type]}</p>
                  <h4 id={`card-title-${card.id}`} className="card-list__title">
                    {card.title}
                  </h4>

                  {card.type === 'topic' ? (
                    <p
                      className="card-list__status"
                      data-topic-status={stringCount === 0 ? 'loose' : 'connected'}
                    >
                      <span className="visually-hidden">Topic status: </span>
                      {topicStatusText(stringCount)}
                    </p>
                  ) : (
                    <p className="card-list__status card-list__status--muted">
                      {stringCount} {stringCount === 1 ? 'string' : 'strings'} attached
                    </p>
                  )}

                  {card.tags.length > 0 ? (
                    <p className="card-list__tags">
                      <span className="card-list__tags-label">Tags: </span>
                      {card.tags.join(', ')}
                    </p>
                  ) : null}
                </div>

                <div className="card-list__actions">
                  <Link
                    id={`card-open-${card.id}`}
                    className="card-list__action-link"
                    to={`/case/${card.caseId}/card/${card.id}`}
                    aria-label={`Open detail for ${card.title}`}
                  >
                    Open detail
                  </Link>
                  <Button
                    className="card-list__action"
                    aria-label={`Edit ${card.title}`}
                    onClick={() => onEdit(card)}
                  >
                    Edit
                  </Button>
                  <Button
                    className="card-list__action"
                    variant="danger"
                    aria-label={`Delete ${card.title}`}
                    onClick={() => onDelete(card)}
                  >
                    Delete
                  </Button>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * Grouped, keyboard-operable text view of the board.
 *
 * It never places a card and never touches the canvas: every card is an
 * ordinary article with real links and buttons, and group headings give screen
 * readers a stable map of notes, sources, and topics.
 */
export default function CardListPanel({
  cards,
  connections = [],
  onEdit,
  onDelete,
  onSearchSelect,
  searchDetailHref,
}: CardListPanelProps) {
  const navigate = useNavigate();
  const [searchActive, setSearchActive] = useState(false);

  const handleSearchSelect = useCallback(
    (card: CardRecord): void => {
      if (onSearchSelect !== undefined) {
        onSearchSelect(card);
        return;
      }

      // "Select" has the same meaning as on the board: open the board with the
      // card focused and centered. "Open detail" remains the secondary action.
      void navigate(`/case/${card.caseId}?card=${encodeURIComponent(card.id)}`);
    },
    [navigate, onSearchSelect],
  );

  return (
    <div className="card-list">
      <SearchPanel
        cards={cards}
        onSelectCard={handleSearchSelect}
        {...(searchDetailHref !== undefined ? { detailHref: searchDetailHref } : {})}
        onActiveChange={setSearchActive}
        className="card-list__search"
      />

      {searchActive ? (
        <p className="card-list__search-note">
          The grouped list is hidden while results are shown. Clear all in the search panel to
          return to every card.
        </p>
      ) : (
        CARD_TYPES.map((type) => {
          const group = cards.filter((card) => card.type === type);
          if (group.length === 0) {
            return null;
          }

          return (
            <CardListGroup
              key={type}
              type={type}
              cards={group}
              connections={connections}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          );
        })
      )}
    </div>
  );
}
