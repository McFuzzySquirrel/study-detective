import { describe, expect, it } from 'vitest';

import type {
  CaseReadiness,
  LooseNoteThread,
  LooseTopicThread,
  ReadinessCard,
  ReadinessConnection,
} from '../../src/domain/readiness';
import {
  countLooseThreads,
  deriveLooseThreads,
  deriveReadiness,
  deriveTopicReadiness,
  getNoteReadiness,
  getTopicReadiness,
  isCaseReady,
} from '../../src/domain/readiness';
import type { CardType, ConnectionType } from '../../src/domain/model';

const CASE_ID = '11111111-1111-4111-8111-111111111111';

function makeCard(id: string, type: CardType, title: string): ReadinessCard {
  return { id, caseId: CASE_ID, type, title };
}

function connect(
  from: ReadinessCard,
  to: ReadinessCard,
  type: ConnectionType,
): ReadinessConnection {
  return { fromCardId: from.id, toCardId: to.id, type };
}

function looseNoteAt(report: CaseReadiness, index = 0): LooseNoteThread {
  const thread = report.looseThreads[index];
  if (thread?.kind !== 'note') {
    throw new Error(`Expected a loose note at index ${index}`);
  }
  return thread;
}

function looseTopicAt(report: CaseReadiness, index = 0): LooseTopicThread {
  const thread = report.looseThreads[index];
  if (thread?.kind !== 'topic') {
    throw new Error(`Expected a loose topic at index ${index}`);
  }
  return thread;
}

const NOTE_A = makeCard('22222222-2222-4222-8222-222222222222', 'note', 'Alpha note');
const NOTE_B = makeCard('55555555-5555-4555-8555-555555555555', 'note', 'Beta note');
const NOTE_C = makeCard('66666666-6666-4666-8666-666666666666', 'note', 'Gamma note');
const SOURCE_A = makeCard('33333333-3333-4333-8333-333333333333', 'source', 'Lecture handout');
const SOURCE_B = makeCard('77777777-7777-4777-8777-777777777777', 'source', 'Textbook page');
const TOPIC_A = makeCard('44444444-4444-4444-8444-444444444444', 'topic', 'Cell respiration');
const TOPIC_B = makeCard('88888888-8888-4888-8888-888888888888', 'topic', 'Enzyme kinetics');
const TOPIC_C = makeCard('99999999-9999-4999-8999-999999999999', 'topic', 'Membrane transport');

describe('empty graph', () => {
  it('is ready with no loose threads and no topic statuses', () => {
    const report = deriveReadiness([], []);

    expect(report.ready).toBe(true);
    expect(report.looseThreadCount).toBe(0);
    expect(report.looseNoteCount).toBe(0);
    expect(report.looseTopicCount).toBe(0);
    expect(report.looseThreads).toEqual([]);
    expect(report.looseNotes).toEqual([]);
    expect(report.looseTopics).toEqual([]);
    expect(report.notes).toEqual([]);
    expect(report.topics).toEqual([]);

    expect(deriveLooseThreads([], [])).toEqual([]);
    expect(countLooseThreads([], [])).toBe(0);
    expect(isCaseReady([], [])).toBe(true);
  });

  it('treats a source-only graph as ready and never flags the source', () => {
    const report = deriveReadiness([SOURCE_A], []);

    expect(report.ready).toBe(true);
    expect(report.looseThreadCount).toBe(0);
    expect(report.looseThreads).toEqual([]);
    expect(report.looseNotes).toEqual([]);
    expect(report.looseTopics).toEqual([]);
  });
});

describe('note readiness', () => {
  it('flags a note with no links once with both missing requirements', () => {
    const report = deriveReadiness([NOTE_A], []);

    expect(report.ready).toBe(false);
    expect(report.looseThreadCount).toBe(1);
    expect(report.looseNoteCount).toBe(1);
    expect(report.looseTopicCount).toBe(0);

    const thread = looseNoteAt(report);
    expect(thread.card.id).toBe(NOTE_A.id);
    expect(thread.cardId).toBe(NOTE_A.id);
    expect(thread.reason).toBe('no-source-link');
    expect(thread.reasons).toEqual(['no-source-link', 'no-topic-connection']);
    expect(thread.sourceLinkCount).toBe(0);
    expect(thread.topicLinkCount).toBe(0);
  });

  it('flags a note that has only a provenance source link', () => {
    const report = deriveReadiness([NOTE_A, SOURCE_A], [connect(NOTE_A, SOURCE_A, 'provenance')]);
    const thread = looseNoteAt(report);

    expect(thread.reason).toBe('no-topic-connection');
    expect(thread.reasons).toEqual(['no-topic-connection']);
    expect(thread.sourceLinkCount).toBe(1);
    expect(thread.topicLinkCount).toBe(0);
    expect(report.topics).toEqual([]);
  });

  it('flags a note that has only an association topic link', () => {
    const report = deriveReadiness([NOTE_A, TOPIC_A], [connect(NOTE_A, TOPIC_A, 'association')]);
    const thread = looseNoteAt(report);

    expect(thread.reason).toBe('no-source-link');
    expect(thread.reasons).toEqual(['no-source-link']);
    expect(thread.sourceLinkCount).toBe(0);
    expect(thread.topicLinkCount).toBe(1);
  });

  it('does not treat an association to another note as a topic connection', () => {
    const report = deriveReadiness(
      [NOTE_A, NOTE_B, SOURCE_A],
      [connect(NOTE_A, SOURCE_A, 'provenance'), connect(NOTE_A, NOTE_B, 'association')],
    );
    const thread = looseNoteAt(report);

    expect(thread.reason).toBe('no-topic-connection');
    expect(thread.sourceLinkCount).toBe(1);
    expect(thread.topicLinkCount).toBe(0);
  });

  it('does not count an association to a source or provenance to a topic as links', () => {
    const report = deriveReadiness(
      [NOTE_A, SOURCE_A, TOPIC_A],
      [connect(NOTE_A, SOURCE_A, 'association'), connect(NOTE_A, TOPIC_A, 'provenance')],
    );
    const thread = looseNoteAt(report);

    expect(thread.reason).toBe('no-source-link');
    expect(thread.reasons).toEqual(['no-source-link', 'no-topic-connection']);
    expect(thread.sourceLinkCount).toBe(0);
    expect(thread.topicLinkCount).toBe(0);
  });

  it('is ready with provenance to a source and association to a topic in either orientation', () => {
    const cards = [NOTE_A, SOURCE_A, TOPIC_A];
    const connections = [
      connect(SOURCE_A, NOTE_A, 'provenance'),
      connect(TOPIC_A, NOTE_A, 'association'),
    ];
    const report = deriveReadiness(cards, connections);

    expect(report.ready).toBe(true);
    expect(report.looseThreadCount).toBe(0);
    expect(report.looseThreads).toEqual([]);
    expect(isCaseReady(cards, connections)).toBe(true);

    const note = getNoteReadiness(NOTE_A.id, cards, connections);
    expect(note?.ready).toBe(true);
    expect(note?.sourceLinkCount).toBe(1);
    expect(note?.topicLinkCount).toBe(1);
    expect(note?.reasons).toEqual([]);
  });

  it('counts multiple distinct links and ignores duplicate connection rows', () => {
    const cards = [NOTE_A, SOURCE_A, SOURCE_B, TOPIC_A, TOPIC_B];
    const connections = [
      connect(NOTE_A, SOURCE_A, 'provenance'),
      connect(SOURCE_A, NOTE_A, 'provenance'),
      connect(SOURCE_B, NOTE_A, 'provenance'),
      connect(NOTE_A, TOPIC_A, 'association'),
      connect(TOPIC_A, NOTE_A, 'association'),
      connect(TOPIC_B, NOTE_A, 'association'),
    ];
    const note = getNoteReadiness(NOTE_A.id, cards, connections);

    expect(note?.ready).toBe(true);
    expect(note?.sourceLinkCount).toBe(2);
    expect(note?.topicLinkCount).toBe(2);
    expect(countLooseThreads(cards, connections)).toBe(0);
  });

  it('ignores stale readiness-like fields stored on the card', () => {
    const staleNote = { ...NOTE_A, ready: true, looseThreadCount: 0 };
    const staleTopic = { ...TOPIC_A, status: 'solved' as const, solved: true };
    const report = deriveReadiness([staleNote, staleTopic], []);

    expect(report.ready).toBe(false);
    expect(looseNoteAt(report).reason).toBe('no-source-link');
    expect(report.topics[0]?.status).toBe('orphan');
  });
});

describe('topic readiness and status', () => {
  it('flags a topic with zero connections as loose and orphan', () => {
    const report = deriveReadiness([TOPIC_A], []);
    const thread = looseTopicAt(report);

    expect(report.looseThreadCount).toBe(1);
    expect(report.looseTopicCount).toBe(1);
    expect(thread.reason).toBe('no-connections');
    expect(thread.reasons).toEqual(['no-connections']);
    expect(thread.status).toBe('orphan');
    expect(thread.connectionCount).toBe(0);

    expect(report.topics).toHaveLength(1);
    expect(report.topics[0]?.status).toBe('orphan');
    expect(report.topics[0]?.linkedNoteCount).toBe(0);
    expect(report.topics[0]?.loose).toBe(true);
  });

  it('clears looseness after one connection even when no note is linked', () => {
    const report = deriveReadiness(
      [TOPIC_A, SOURCE_A],
      [connect(TOPIC_A, SOURCE_A, 'association')],
    );

    expect(report.looseThreadCount).toBe(0);
    expect(report.looseTopics).toEqual([]);
    expect(report.topics[0]?.loose).toBe(false);
    expect(report.topics[0]?.connectionCount).toBe(1);
    expect(report.topics[0]?.linkedNoteCount).toBe(0);
    expect(report.topics[0]?.status).toBe('orphan');
  });

  it('does not count a wrong-type provenance row as a linked note', () => {
    const report = deriveReadiness(
      [TOPIC_A, TOPIC_B, NOTE_A, SOURCE_A],
      [
        connect(NOTE_A, TOPIC_A, 'provenance'),
        connect(NOTE_A, TOPIC_B, 'association'),
        connect(NOTE_A, SOURCE_A, 'provenance'),
      ],
    );

    expect(report.looseThreadCount).toBe(0);
    expect(report.topics[0]?.loose).toBe(false);
    expect(report.topics[0]?.connectionCount).toBe(1);
    expect(report.topics[0]?.linkedNoteCount).toBe(0);
    expect(report.topics[0]?.status).toBe('orphan');
  });

  it('is developing with one associated note and solved with two or more distinct notes', () => {
    const cards = [NOTE_A, NOTE_B, NOTE_C, TOPIC_A];

    const oneNote = deriveReadiness(cards, [connect(NOTE_A, TOPIC_A, 'association')]);
    expect(oneNote.topics[0]?.status).toBe('developing');
    expect(oneNote.topics[0]?.linkedNoteCount).toBe(1);

    const twoNotes = deriveReadiness(cards, [
      connect(NOTE_A, TOPIC_A, 'association'),
      connect(TOPIC_A, NOTE_B, 'association'),
    ]);
    expect(twoNotes.topics[0]?.status).toBe('solved');
    expect(twoNotes.topics[0]?.linkedNoteCount).toBe(2);

    const threeNotes = deriveReadiness(cards, [
      connect(NOTE_A, TOPIC_A, 'association'),
      connect(NOTE_B, TOPIC_A, 'association'),
      connect(NOTE_C, TOPIC_A, 'association'),
    ]);
    expect(threeNotes.topics[0]?.status).toBe('solved');
    expect(threeNotes.topics[0]?.linkedNoteCount).toBe(3);
  });

  it('counts a duplicated note connection once', () => {
    const report = deriveReadiness(
      [NOTE_A, TOPIC_A],
      [connect(NOTE_A, TOPIC_A, 'association'), connect(TOPIC_A, NOTE_A, 'association')],
    );

    expect(report.topics[0]?.linkedNoteCount).toBe(1);
    expect(report.topics[0]?.connectionCount).toBe(1);
    expect(report.topics[0]?.status).toBe('developing');
  });

  it('does not count a topic-to-topic association as a linked note but clears looseness', () => {
    const report = deriveReadiness([TOPIC_A, TOPIC_B], [connect(TOPIC_A, TOPIC_B, 'association')]);

    expect(report.looseThreadCount).toBe(0);
    expect(report.topics).toHaveLength(2);
    for (const topic of report.topics) {
      expect(topic.loose).toBe(false);
      expect(topic.linkedNoteCount).toBe(0);
      expect(topic.status).toBe('orphan');
    }
  });

  it('exposes status for every topic and nothing for notes or sources', () => {
    const cards = [NOTE_A, SOURCE_A, TOPIC_A, TOPIC_B];
    const connections = [
      connect(NOTE_A, SOURCE_A, 'provenance'),
      connect(NOTE_A, TOPIC_A, 'association'),
    ];
    const report = deriveReadiness(cards, connections);
    const statuses = deriveTopicReadiness(cards, connections);

    expect(statuses).toEqual(report.topics);
    expect(statuses.map((topic) => topic.cardId).sort()).toEqual([TOPIC_A.id, TOPIC_B.id].sort());
    expect(getTopicReadiness(TOPIC_A.id, cards, connections)?.status).toBe('developing');
    expect(getTopicReadiness(TOPIC_B.id, cards, connections)?.status).toBe('orphan');
    expect(getTopicReadiness(NOTE_A.id, cards, connections)).toBeUndefined();
    expect(getNoteReadiness(TOPIC_A.id, cards, connections)).toBeUndefined();
    expect(getNoteReadiness('00000000-0000-4000-8000-000000000000', cards, connections)).toBe(
      undefined,
    );
  });
});

describe('loose thread list and counts', () => {
  it('returns each offending card once with a total count, never a source', () => {
    const cards = [NOTE_A, NOTE_B, SOURCE_A, TOPIC_A];
    const connections = [
      connect(NOTE_A, SOURCE_A, 'provenance'),
      connect(NOTE_A, TOPIC_A, 'association'),
    ];
    const report = deriveReadiness(cards, connections);
    const threads = deriveLooseThreads(cards, connections);

    expect(report.looseThreadCount).toBe(1);
    expect(report.looseNoteCount).toBe(1);
    expect(threads).toHaveLength(1);
    expect(looseNoteAt(report).card.id).toBe(NOTE_B.id);
    expect(threads.some((thread) => thread.card.type === 'source')).toBe(false);
    expect(report.looseThreads.map((thread) => thread.cardId)).not.toContain(SOURCE_A.id);
    expect(countLooseThreads(cards, connections)).toBe(report.looseThreadCount);
    expect(isCaseReady(cards, connections)).toBe(false);
  });

  it('counts a note missing both requirements once, not once per reason', () => {
    const report = deriveReadiness([NOTE_A, TOPIC_A], []);
    const thread = looseNoteAt(report);

    expect(thread.reasons).toHaveLength(2);
    expect(report.looseThreadCount).toBe(2);
    expect(report.looseNoteCount).toBe(1);
    expect(report.looseTopicCount).toBe(1);
    expect(report.looseThreads.map((entry) => entry.kind)).toEqual(['note', 'topic']);
  });

  it('does not duplicate a loose card when its duplicate rows exist', () => {
    const report = deriveReadiness(
      [NOTE_A, SOURCE_A],
      [connect(NOTE_A, SOURCE_A, 'association'), connect(SOURCE_A, NOTE_A, 'association')],
    );

    expect(report.looseThreadCount).toBe(1);
    expect(looseNoteAt(report).reasons).toEqual(['no-source-link', 'no-topic-connection']);
  });
});

describe('defensive graph rows', () => {
  it('ignores a self-link instead of treating it as a connection', () => {
    const report = deriveReadiness(
      [NOTE_A, SOURCE_A],
      [{ fromCardId: NOTE_A.id, toCardId: NOTE_A.id, type: 'provenance' }],
    );
    const thread = looseNoteAt(report);

    expect(thread.sourceLinkCount).toBe(0);
    expect(thread.topicLinkCount).toBe(0);
    expect(thread.reasons).toEqual(['no-source-link', 'no-topic-connection']);
  });

  it('ignores connections with a dangling or foreign endpoint', () => {
    const missingCardId = '00000000-0000-4000-8000-000000000000';
    const report = deriveReadiness(
      [NOTE_A, TOPIC_A],
      [
        { fromCardId: NOTE_A.id, toCardId: missingCardId, type: 'association' },
        { fromCardId: missingCardId, toCardId: TOPIC_A.id, type: 'association' },
      ],
    );

    expect(report.looseThreadCount).toBe(2);
    expect(looseNoteAt(report).topicLinkCount).toBe(0);
    expect(report.topics[0]?.connectionCount).toBe(0);
    expect(report.topics[0]?.status).toBe('orphan');
  });

  it('collapses duplicate card rows to the first occurrence', () => {
    const duplicate = { ...NOTE_A, title: 'Duplicate note' };
    const report = deriveReadiness([NOTE_A, duplicate], []);

    expect(report.notes).toHaveLength(1);
    expect(report.looseNotes).toHaveLength(1);
    expect(report.looseNotes[0]?.card.title).toBe(NOTE_A.title);
  });
});

describe('stable ordering', () => {
  it('orders loose notes then loose topics by title regardless of input order', () => {
    const cards = [TOPIC_C, NOTE_B, NOTE_A, TOPIC_A, NOTE_C, TOPIC_B, SOURCE_A];
    const shuffled = [SOURCE_A, NOTE_A, TOPIC_C, TOPIC_B, NOTE_C, TOPIC_A, NOTE_B];

    const first = deriveReadiness(cards, []);
    const second = deriveReadiness(shuffled, []);

    expect(first.looseNotes.map((note) => note.card.title)).toEqual([
      'Alpha note',
      'Beta note',
      'Gamma note',
    ]);
    expect(first.looseTopics.map((topic) => topic.card.title)).toEqual([
      'Cell respiration',
      'Enzyme kinetics',
      'Membrane transport',
    ]);
    expect(first.looseThreads.map((thread) => thread.card.title)).toEqual([
      'Alpha note',
      'Beta note',
      'Gamma note',
      'Cell respiration',
      'Enzyme kinetics',
      'Membrane transport',
    ]);
    expect(second).toEqual(first);
  });

  it('orders equal titles by id and ignores connection input order', () => {
    const firstTopic = makeCard('00000000-0000-4000-8000-000000000001', 'topic', 'Same title');
    const secondTopic = makeCard('00000000-0000-4000-8000-000000000002', 'topic', 'Same title');
    const cards = [secondTopic, NOTE_A, SOURCE_A, TOPIC_A, firstTopic];
    const provenance = connect(NOTE_A, SOURCE_A, 'provenance');
    const association = connect(NOTE_A, TOPIC_A, 'association');

    const first = deriveReadiness(cards, [provenance, association]);
    const second = deriveReadiness(cards, [association, provenance]);

    expect(first.looseTopics.map((topic) => topic.cardId)).toEqual([firstTopic.id, secondTopic.id]);
    expect(second).toEqual(first);
  });

  it('breaks a case-insensitive title tie with the exact title', () => {
    const lowerTopic = makeCard('00000000-0000-4000-8000-000000000011', 'topic', 'alpha topic');
    const upperTopic = makeCard('00000000-0000-4000-8000-000000000012', 'topic', 'Alpha topic');

    const report = deriveReadiness([lowerTopic, upperTopic], []);

    expect(report.looseTopics.map((topic) => topic.card.title)).toEqual([
      'Alpha topic',
      'alpha topic',
    ]);
  });

  it('does not mutate the supplied cards or connections', () => {
    const cards = [NOTE_A, SOURCE_A, TOPIC_A];
    const connections = [connect(NOTE_A, SOURCE_A, 'provenance')];
    const cardsBefore = [...cards];
    const connectionsBefore = [...connections];

    deriveReadiness(cards, connections);

    expect(cards).toEqual(cardsBefore);
    expect(connections).toEqual(connectionsBefore);
  });
});
