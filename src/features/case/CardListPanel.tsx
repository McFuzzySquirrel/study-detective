import { useCallback, useId, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';

import Button from '../../components/Button';
import Toast from '../../components/Toast';
import type { ToastTone } from '../../components/Toast';
import type { ConnectionRepositoryPort } from '../../data/connectionRepository';
import type { CardRecord, CardType, ConnectionRecord } from '../../domain/model';
import { CARD_TYPES } from '../../domain/model';
import { deriveReadiness } from '../../domain/readiness';
import type { TopicReadiness } from '../../domain/readiness';
import ConnectionPicker from '../connections/ConnectionPicker';
import type { ConnectionPickerIntent } from '../connections/ConnectionPicker';
import { connectionTypeLabel } from '../connections/useUndoDeleteConnection';
import SearchPanel from '../search/SearchPanel';

import TopicStatusBadge from './TopicStatusBadge';

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
  topic: 'Headings that can anchor a thread, with an optional image.',
};

/** How many strings currently name this card as an endpoint. */
function countCardStrings(connections: readonly ConnectionRecord[], cardId: string): number {
  return connections.filter(
    (connection) => connection.fromCardId === cardId || connection.toCardId === cardId,
  ).length;
}

/** Stable fallback so the readiness memo is not invalidated by a fresh array. */
const NO_CONNECTIONS: readonly ConnectionRecord[] = [];

export interface CardListPanelProps {
  readonly cards: readonly CardRecord[];
  /** Current-case strings; readiness is derived from them on every render. */
  readonly connections?: readonly ConnectionRecord[];
  readonly onEdit: (card: CardRecord) => void;
  readonly onDelete: (card: CardRecord) => void;
  /** Direct connection write boundary for tests and composition. */
  readonly connectionRepository?: ConnectionRepositoryPort | undefined;
  /** Lazy connection opener; resolved only when the picker saves. */
  readonly loadConnectionRepository?: (() => Promise<ConnectionRepositoryPort>) | undefined;
  readonly onConnectionCreated?: ((connection: ConnectionRecord) => void) | undefined;
  readonly onConnectionChanged?: ((connection: ConnectionRecord) => void) | undefined;
  readonly onConnectionDeleted?: ((connection: ConnectionRecord) => void) | undefined;
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
  /** Derived per-topic readiness for this render, keyed by card ID. */
  readonly topicReadiness: ReadonlyMap<string, TopicReadiness>;
  readonly onEdit: (card: CardRecord) => void;
  readonly onDelete: (card: CardRecord) => void;
  readonly onConnect: (card: CardRecord, intent: ConnectionPickerIntent) => void;
}

function CardListGroup({
  type,
  cards,
  connections,
  topicReadiness,
  onEdit,
  onDelete,
  onConnect,
}: CardListGroupProps) {
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
          const topic = card.type === 'topic' ? topicReadiness.get(card.id) : undefined;
          return (
            <li key={card.id} className="card-list__item">
              <article
                id={`card-row-${card.id}`}
                className="card-list__card"
                aria-labelledby={`card-title-${card.id}`}
                data-card-id={card.id}
                data-card-type={card.type}
                data-card-row="true"
              >
                <div className="card-list__body">
                  <p className="card-list__type">{CARD_TYPE_LABELS[card.type]}</p>
                  <h4 id={`card-title-${card.id}`} className="card-list__title">
                    {card.title}
                  </h4>

                  {card.type === 'topic' ? (
                    topic === undefined ? null : (
                      <TopicStatusBadge
                        cardType={card.type}
                        status={topic.status}
                        linkedNoteCount={topic.linkedNoteCount}
                      />
                    )
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
                    data-card-open="true"
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
                  <Button
                    className="card-list__action"
                    aria-label={`Connect to… for ${card.title}`}
                    data-connect-action="true"
                    onClick={() => onConnect(card, 'connect')}
                  >
                    Connect to…
                  </Button>
                  {card.type === 'note' ? (
                    <Button
                      className="card-list__action"
                      aria-label={`Attach source to ${card.title}`}
                      onClick={() => onConnect(card, 'attach-source')}
                    >
                      Attach source
                    </Button>
                  ) : null}
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
  connections = NO_CONNECTIONS,
  onEdit,
  onDelete,
  connectionRepository,
  loadConnectionRepository,
  onConnectionCreated,
  onConnectionChanged,
  onConnectionDeleted,
  onSearchSelect,
  searchDetailHref,
}: CardListPanelProps) {
  const navigate = useNavigate();
  const [searchActive, setSearchActive] = useState(false);
  const [pickerCard, setPickerCard] = useState<CardRecord | null>(null);
  const [pickerIntent, setPickerIntent] = useState<ConnectionPickerIntent>('connect');
  const [feedback, setFeedback] = useState<{
    readonly message: string;
    readonly tone: ToastTone;
  } | null>(null);

  /**
   * Status is derived from the graph on every render, so a connection saved or
   * deleted through the picker (or refreshed by the page) changes the badge in
   * place. Nothing is cached in the card record.
   */
  const topicReadiness = useMemo(() => {
    const byCardId = new Map<string, TopicReadiness>();
    for (const topic of deriveReadiness(cards, connections).topics) {
      byCardId.set(topic.cardId, topic);
    }
    return byCardId;
  }, [cards, connections]);

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

  const openPicker = useCallback((card: CardRecord, intent: ConnectionPickerIntent): void => {
    setFeedback(null);
    setPickerCard(card);
    setPickerIntent(intent);
  }, []);

  const handleConnectionCreated = useCallback(
    (connection: ConnectionRecord): void => {
      onConnectionCreated?.(connection);
      setFeedback({
        message: `Connection saved: ${connectionTypeLabel(connection.type)}.`,
        tone: 'success',
      });
    },
    [onConnectionCreated],
  );

  const handleConnectionChanged = useCallback(
    (connection: ConnectionRecord): void => {
      onConnectionChanged?.(connection);
      setFeedback({
        message: `Connection updated: ${connectionTypeLabel(connection.type)}.`,
        tone: 'success',
      });
    },
    [onConnectionChanged],
  );

  const handleConnectionDeleted = useCallback(
    (connection: ConnectionRecord): void => {
      onConnectionDeleted?.(connection);
      setFeedback({ message: 'Connection deleted. Both cards are unchanged.', tone: 'success' });
    },
    [onConnectionDeleted],
  );

  return (
    <div className="card-list">
      <Toast
        message={feedback?.message ?? null}
        tone={feedback?.tone ?? 'info'}
        onDismiss={() => setFeedback(null)}
        dismissLabel="Dismiss connection message"
      />

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
              topicReadiness={topicReadiness}
              onEdit={onEdit}
              onDelete={onDelete}
              onConnect={openPicker}
            />
          );
        })
      )}

      {pickerCard !== null ? (
        <ConnectionPicker
          key={`${pickerCard.id}:${pickerIntent}`}
          open
          currentCard={pickerCard}
          cards={cards}
          connections={connections}
          intent={pickerIntent}
          {...(connectionRepository !== undefined ? { repository: connectionRepository } : {})}
          {...(loadConnectionRepository !== undefined
            ? { loadRepository: loadConnectionRepository }
            : {})}
          onClose={() => setPickerCard(null)}
          onConnectionCreated={handleConnectionCreated}
          onConnectionChanged={handleConnectionChanged}
          onConnectionDeleted={handleConnectionDeleted}
        />
      ) : null}
    </div>
  );
}
