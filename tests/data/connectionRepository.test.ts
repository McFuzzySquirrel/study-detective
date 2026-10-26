// @vitest-environment node

import 'fake-indexeddb/auto';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CaseRepository } from '../../src/data/caseRepository';
import {
  ConnectionRepository,
  InMemoryConnectionRepository,
} from '../../src/data/connectionRepository';
import type { ConnectionRepositoryPort } from '../../src/data/connectionRepository';
import type { NotesDetectiveDatabase } from '../../src/data/db';
import { RecordNotFoundError, StorageReadError } from '../../src/data/errors';
import type { ConnectionEndpointCard } from '../../src/domain/connections';
import { DuplicateConnectionError, buildPairKey } from '../../src/domain/connections';
import type { ConnectionRecord } from '../../src/domain/model';
import { DomainValidationError } from '../../src/domain/validation';
import { advancingClock, closeTestDatabase, openTestDatabase, requireRow } from './testDatabase';

const RAW_CONNECTION_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const RAW_CONNECTION_TWO = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const MISSING_CARD_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const MISSING_CASE_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MISSING_CONNECTION_ID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

let db: NotesDetectiveDatabase;
let cases: CaseRepository;
let connections: ConnectionRepositoryPort;
let caseId: string;
let noteId: string;
let sourceId: string;
let topicId: string;

async function addCard(type: 'note' | 'source' | 'topic', title: string): Promise<string> {
  const card = await cases.createCard({
    caseId,
    type,
    title,
    position: { x: 0, y: 0 },
  });
  return card.id;
}

beforeEach(async () => {
  db = await openTestDatabase('connection-repository');
  const clock = advancingClock();
  cases = new CaseRepository(db, { clock });
  connections = new ConnectionRepository(db, { clock });

  const createdCase = await cases.createCase({ title: 'Connections' });
  caseId = createdCase.id;
  noteId = await addCard('note', 'Note');
  sourceId = await addCard('source', 'Source');
  topicId = await addCard('topic', 'Topic');
});

afterEach(async () => {
  await closeTestDatabase(db);
});

describe('creating connections', () => {
  it('creates one association by default and round-trips it validated', async () => {
    const before = await cases.getCase(caseId);

    const result = await connections.create({
      caseId,
      fromCardId: noteId,
      toCardId: topicId,
    });

    expect(result.status).toBe('created');
    if (result.status !== 'created') {
      throw new Error('expected a created connection');
    }

    expect(result.connection.type).toBe('association');
    expect(result.connection.pairKey).toBe(buildPairKey(noteId, topicId));
    expect(result.connection.fromCardId).toBe(noteId);

    const listed = await connections.listByCase(caseId);
    expect(listed).toEqual([result.connection]);
    expect(await db.connections.count()).toBe(1);

    const after = await cases.getCase(caseId);
    expect(Date.parse(after?.updatedAt ?? '')).toBeGreaterThan(Date.parse(before?.updatedAt ?? ''));
  });

  it('creates provenance between a note and a source in either orientation', async () => {
    const forward = await connections.create({
      caseId,
      fromCardId: noteId,
      toCardId: sourceId,
      type: 'provenance',
    });
    expect(forward.status).toBe('created');

    const listed = await connections.listByCase(caseId);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.type).toBe('provenance');
  });

  it('returns the existing row for A-B then B-A and never writes a second row', async () => {
    const first = await connections.create({
      caseId,
      fromCardId: noteId,
      toCardId: sourceId,
      type: 'provenance',
    });
    if (first.status !== 'created') {
      throw new Error('expected the first string to be created');
    }

    const second = await connections.create({
      caseId,
      fromCardId: sourceId,
      toCardId: noteId,
      type: 'association',
    });

    expect(second.status).toBe('duplicate');
    if (second.status !== 'duplicate') {
      throw new Error('expected the reversed pair to be a duplicate');
    }

    expect(second.connection.id).toBe(first.connection.id);
    expect(second.connection.type).toBe('provenance');
    expect(second.connection.pairKey).toBe(buildPairKey(noteId, sourceId));
    expect(await db.connections.count()).toBe(1);
  });

  it('rejects a self-link before any write', async () => {
    await expect(
      connections.create({ caseId, fromCardId: noteId, toCardId: noteId }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    expect(await db.connections.count()).toBe(0);
  });

  it('rejects provenance between anything other than a note and a source', async () => {
    const secondNoteId = await addCard('note', 'Second note');

    await expect(
      connections.create({
        caseId,
        fromCardId: noteId,
        toCardId: topicId,
        type: 'provenance',
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    await expect(
      connections.create({
        caseId,
        fromCardId: noteId,
        toCardId: secondNoteId,
        type: 'provenance',
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    await expect(
      connections.create({
        caseId,
        fromCardId: sourceId,
        toCardId: topicId,
        type: 'provenance',
      }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    expect(await db.connections.count()).toBe(0);
  });

  it('allows association between two notes while provenance stays illegal', async () => {
    const secondNoteId = await addCard('note', 'Second note');

    const association = await connections.create({
      caseId,
      fromCardId: noteId,
      toCardId: secondNoteId,
    });

    expect(association.status).toBe('created');
    await expect(
      connections.retype(
        association.status === 'created' ? association.connection.id : '',
        'provenance',
      ),
    ).rejects.toBeInstanceOf(DomainValidationError);
  });

  it('rejects a missing endpoint and a card from another case', async () => {
    await expect(
      connections.create({ caseId, fromCardId: noteId, toCardId: MISSING_CARD_ID }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);

    const otherCase = await cases.createCase({ title: 'Other case' });
    const foreignCard = await cases.createCard({
      caseId: otherCase.id,
      type: 'source',
      title: 'Foreign source',
      position: { x: 0, y: 0 },
    });

    await expect(
      connections.create({ caseId, fromCardId: noteId, toCardId: foreignCard.id }),
    ).rejects.toBeInstanceOf(DomainValidationError);

    expect(await db.connections.count()).toBe(0);
  });

  it('reports a missing case before reading either endpoint', async () => {
    await expect(
      connections.create({
        caseId: MISSING_CASE_ID,
        fromCardId: noteId,
        toCardId: sourceId,
      }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);

    expect(await db.connections.count()).toBe(0);
  });

  it('enforces the unique pairKey index even for a direct write', async () => {
    const pairKey = buildPairKey(noteId, sourceId);

    await db.connections.add({
      id: RAW_CONNECTION_ID,
      caseId,
      fromCardId: noteId,
      toCardId: sourceId,
      pairKey,
      type: 'association',
    });

    await expect(
      db.connections.add({
        id: RAW_CONNECTION_TWO,
        caseId,
        fromCardId: sourceId,
        toCardId: noteId,
        pairKey,
        type: 'association',
      }),
    ).rejects.toThrow();

    expect(await db.connections.count()).toBe(1);
  });
});

describe('retyping connections', () => {
  it('updates the existing row and preserves its ID', async () => {
    const created = await connections.create({
      caseId,
      fromCardId: noteId,
      toCardId: sourceId,
    });
    if (created.status !== 'created') {
      throw new Error('expected a created connection');
    }

    const retyped = await connections.retype(created.connection.id, 'provenance');

    expect(retyped.id).toBe(created.connection.id);
    expect(retyped.type).toBe('provenance');
    expect(retyped.pairKey).toBe(created.connection.pairKey);
    expect(await db.connections.count()).toBe(1);
    expect((await connections.listByCase(caseId))[0]?.type).toBe('provenance');
  });

  it('keeps the same row when retyped to its current type', async () => {
    const created = await connections.create({
      caseId,
      fromCardId: noteId,
      toCardId: sourceId,
    });
    if (created.status !== 'created') {
      throw new Error('expected a created connection');
    }

    const unchanged = await connections.retype(created.connection.id, 'association');

    expect(unchanged).toEqual(created.connection);
    expect(await db.connections.count()).toBe(1);
  });

  it('rejects an invalid provenance retype and leaves the association intact', async () => {
    const created = await connections.create({
      caseId,
      fromCardId: noteId,
      toCardId: topicId,
    });
    if (created.status !== 'created') {
      throw new Error('expected a created connection');
    }

    await expect(connections.retype(created.connection.id, 'provenance')).rejects.toBeInstanceOf(
      DomainValidationError,
    );

    const row = await requireRow(db.connections.get(created.connection.id));
    expect(row.type).toBe('association');
    expect(row.id).toBe(created.connection.id);
  });

  it('reports a missing connection instead of inventing a row', async () => {
    await expect(connections.retype(RAW_CONNECTION_ID, 'provenance')).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    expect(await db.connections.count()).toBe(0);
  });
});

describe('deleting connections', () => {
  it('deletes one row and reports an already-gone connection as false', async () => {
    const created = await connections.create({ caseId, fromCardId: noteId, toCardId: sourceId });
    if (created.status !== 'created') {
      throw new Error('expected a created connection');
    }

    expect(await connections.delete(created.connection.id)).toBe(true);
    expect(await db.connections.count()).toBe(0);
    expect(await connections.delete(created.connection.id)).toBe(false);
    expect(await connections.listByCase(caseId)).toEqual([]);
  });

  it('removes both orientations for a deleted card and leaves unrelated strings', async () => {
    const noteToTopic = await connections.create({
      caseId,
      fromCardId: noteId,
      toCardId: topicId,
    });
    const noteToSource = await connections.create({
      caseId,
      fromCardId: sourceId,
      toCardId: noteId,
      type: 'provenance',
    });
    const sourceToTopic = await connections.create({
      caseId,
      fromCardId: sourceId,
      toCardId: topicId,
    });
    if (
      noteToTopic.status !== 'created' ||
      noteToSource.status !== 'created' ||
      sourceToTopic.status !== 'created'
    ) {
      throw new Error('expected all three strings to be created');
    }

    expect(await connections.deleteByCard(noteId)).toBe(2);

    const remaining = await connections.listByCase(caseId);
    expect(remaining.map((connection) => connection.id)).toEqual([sourceToTopic.connection.id]);
    expect(await connections.deleteByCard(MISSING_CARD_ID)).toBe(0);
    expect(await connections.listByCard(noteId)).toEqual([]);
  });

  it('cascades card deletion with its connections in one transaction', async () => {
    const noteToTopic = await connections.create({
      caseId,
      fromCardId: noteId,
      toCardId: topicId,
    });
    const noteToSource = await connections.create({
      caseId,
      fromCardId: noteId,
      toCardId: sourceId,
      type: 'provenance',
    });
    const sourceToTopic = await connections.create({
      caseId,
      fromCardId: sourceId,
      toCardId: topicId,
    });
    if (
      noteToTopic.status !== 'created' ||
      noteToSource.status !== 'created' ||
      sourceToTopic.status !== 'created'
    ) {
      throw new Error('expected all three strings to be created');
    }

    expect(await cases.deleteCard(noteId)).toBe(true);

    expect(await db.connections.count()).toBe(1);
    expect(await db.connections.where('fromCardId').equals(noteId).count()).toBe(0);
    expect(await db.connections.where('toCardId').equals(noteId).count()).toBe(0);
    const remaining = await connections.listByCase(caseId);
    expect(remaining.map((connection) => connection.id)).toEqual([sourceToTopic.connection.id]);
  });

  it('rolls the card and its strings back when the cascade write fails', async () => {
    await connections.create({ caseId, fromCardId: noteId, toCardId: topicId });
    await connections.create({
      caseId,
      fromCardId: noteId,
      toCardId: sourceId,
      type: 'provenance',
    });

    const rejectDelete = vi
      .spyOn(db.connections, 'bulkDelete')
      .mockRejectedValueOnce(new Error('injected storage failure'));

    await expect(cases.deleteCard(noteId)).rejects.toThrow('injected storage failure');
    rejectDelete.mockRestore();

    expect(await cases.getCard(noteId)).not.toBeNull();
    expect(await db.connections.count()).toBe(2);
    expect(await connections.listByCard(noteId)).toHaveLength(2);
  });
});

describe('transaction atomicity', () => {
  it('rolls back the connection row when the case timestamp write fails', async () => {
    const before = await cases.getCase(caseId);
    const rejectPut = vi
      .spyOn(db.cases, 'put')
      .mockRejectedValueOnce(new Error('injected storage failure'));

    await expect(
      connections.create({ caseId, fromCardId: noteId, toCardId: sourceId }),
    ).rejects.toThrow('injected storage failure');
    rejectPut.mockRestore();

    expect(await db.connections.count()).toBe(0);
    expect((await cases.getCase(caseId))?.updatedAt).toBe(before?.updatedAt);
  });

  it('does not touch the case when a duplicate is returned', async () => {
    const first = await connections.create({ caseId, fromCardId: noteId, toCardId: sourceId });
    if (first.status !== 'created') {
      throw new Error('expected a created connection');
    }
    const afterFirst = await cases.getCase(caseId);

    const second = await connections.create({
      caseId,
      fromCardId: sourceId,
      toCardId: noteId,
    });

    expect(second.status).toBe('duplicate');
    expect((await cases.getCase(caseId))?.updatedAt).toBe(afterFirst?.updatedAt);
  });
});

describe('validated reads', () => {
  it('returns empty lists for a missing case or card', async () => {
    expect(await connections.listByCase(MISSING_CASE_ID)).toEqual([]);
    expect(await connections.listByCard(MISSING_CARD_ID)).toEqual([]);
  });

  it('rejects a malformed stored row instead of trusting it', async () => {
    const created = await connections.create({ caseId, fromCardId: noteId, toCardId: sourceId });
    if (created.status !== 'created') {
      throw new Error('expected a created connection');
    }

    const row = await requireRow(db.connections.get(created.connection.id));
    await db.connections.put({
      ...row,
      pairKey: buildPairKey(noteId, topicId),
    });

    await expect(connections.listByCase(caseId)).rejects.toBeInstanceOf(StorageReadError);
    await expect(connections.listByCard(noteId)).rejects.toBeInstanceOf(StorageReadError);
  });

  it('rejects a dangling endpoint stored outside the repository', async () => {
    const row: ConnectionRecord = {
      id: RAW_CONNECTION_ID,
      caseId,
      fromCardId: noteId,
      toCardId: MISSING_CARD_ID,
      pairKey: buildPairKey(noteId, MISSING_CARD_ID),
      type: 'association',
    };
    await db.connections.add(row);

    await expect(connections.listByCase(caseId)).rejects.toBeInstanceOf(StorageReadError);
  });

  it('rejects a cross-case endpoint on read', async () => {
    const otherCase = await cases.createCase({ title: 'Other case' });
    const foreignCard = await cases.createCard({
      caseId: otherCase.id,
      type: 'source',
      title: 'Foreign source',
      position: { x: 0, y: 0 },
    });
    await db.connections.add({
      id: RAW_CONNECTION_ID,
      caseId,
      fromCardId: noteId,
      toCardId: foreignCard.id,
      pairKey: buildPairKey(noteId, foreignCard.id),
      type: 'association',
    });

    await expect(connections.listByCase(caseId)).rejects.toBeInstanceOf(StorageReadError);
  });
});

describe('restore and in-memory parity', () => {
  it('restores a deleted connection with its original ID', async () => {
    const created = await connections.create({
      caseId,
      fromCardId: noteId,
      toCardId: sourceId,
      type: 'provenance',
    });
    if (created.status !== 'created') {
      throw new Error('expected a created connection');
    }

    await connections.delete(created.connection.id);
    const restored = await connections.restore(created.connection);

    expect(restored).toEqual(created.connection);
    expect((await connections.listByCase(caseId))[0]?.id).toBe(created.connection.id);
  });

  it('rejects restoring a duplicate pair with a different ID', async () => {
    const created = await connections.create({ caseId, fromCardId: noteId, toCardId: sourceId });
    if (created.status !== 'created') {
      throw new Error('expected a created connection');
    }

    await expect(
      connections.restore({
        ...created.connection,
        id: RAW_CONNECTION_TWO,
      }),
    ).rejects.toThrow(/already exists/);
    expect(await db.connections.count()).toBe(1);
  });

  it('applies the same rules through the in-memory repository', async () => {
    const cards: ConnectionEndpointCard[] = [
      { id: noteId, caseId, type: 'note' },
      { id: sourceId, caseId, type: 'source' },
      { id: topicId, caseId, type: 'topic' },
    ];
    const fake = new InMemoryConnectionRepository({ cards });

    const first = await fake.create({
      caseId,
      fromCardId: noteId,
      toCardId: sourceId,
      type: 'provenance',
    });
    if (first.status !== 'created') {
      throw new Error('expected a created connection');
    }

    const duplicate = await fake.create({
      caseId,
      fromCardId: sourceId,
      toCardId: noteId,
    });
    expect(duplicate.status).toBe('duplicate');
    expect(duplicate.connection.id).toBe(first.connection.id);
    expect(await fake.listByCase(caseId)).toHaveLength(1);

    const retyped = await fake.retype(first.connection.id, 'association');
    expect(retyped.id).toBe(first.connection.id);
    expect(retyped.type).toBe('association');

    await expect(
      fake.create({ caseId, fromCardId: noteId, toCardId: topicId, type: 'provenance' }),
    ).rejects.toBeInstanceOf(DomainValidationError);
    await expect(
      fake.create({ caseId, fromCardId: noteId, toCardId: noteId }),
    ).rejects.toBeInstanceOf(DomainValidationError);
    await expect(
      fake.create({ caseId, fromCardId: noteId, toCardId: MISSING_CARD_ID }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);

    const second = await fake.create({ caseId, fromCardId: noteId, toCardId: topicId });
    if (second.status !== 'created') {
      throw new Error('expected a created connection');
    }

    expect(await fake.deleteByCard(noteId)).toBe(2);
    expect(await fake.listByCard(noteId)).toEqual([]);
    expect(await fake.listByCase(caseId)).toEqual([]);

    await fake.restore(first.connection);
    expect((await fake.listByCase(caseId))[0]?.id).toBe(first.connection.id);
    expect(await fake.delete(first.connection.id)).toBe(true);
    expect(await fake.delete(first.connection.id)).toBe(false);
  });

  it('seeds and enforces the same edge cases without IndexedDB', async () => {
    const cards: ConnectionEndpointCard[] = [
      { id: noteId, caseId, type: 'note' },
      { id: sourceId, caseId, type: 'source' },
      { id: topicId, caseId, type: 'topic' },
    ];
    const seeded: ConnectionRecord = {
      id: RAW_CONNECTION_ID,
      caseId,
      fromCardId: noteId,
      toCardId: sourceId,
      pairKey: buildPairKey(noteId, sourceId),
      type: 'association',
    };
    const fake = new InMemoryConnectionRepository({ cards, connections: [seeded] });

    expect(await fake.listByCase(caseId)).toEqual([seeded]);
    expect(await fake.retype(seeded.id, 'association')).toEqual(seeded);
    expect(await fake.listByCard(noteId)).toEqual([seeded]);
    expect(await fake.listByCard(MISSING_CARD_ID)).toEqual([]);
    expect(await fake.deleteByCard(MISSING_CARD_ID)).toBe(0);

    await expect(fake.retype(MISSING_CONNECTION_ID, 'association')).rejects.toBeInstanceOf(
      RecordNotFoundError,
    );
    await expect(
      fake.create({ caseId, fromCardId: MISSING_CARD_ID, toCardId: sourceId }),
    ).rejects.toBeInstanceOf(RecordNotFoundError);
    await expect(fake.restore({ ...seeded, id: RAW_CONNECTION_TWO })).rejects.toBeInstanceOf(
      DuplicateConnectionError,
    );

    expect(
      () =>
        new InMemoryConnectionRepository({
          cards,
          connections: [seeded, { ...seeded, id: RAW_CONNECTION_TWO }],
        }),
    ).toThrow(DuplicateConnectionError);
  });
});
