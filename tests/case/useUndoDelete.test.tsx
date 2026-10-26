import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import type {
  AttachmentRecord,
  CardRecord,
  CaseRecord,
  ConnectionRecord,
} from '../../src/domain/model';
import { DEFAULT_VIEWPORT, buildPairKey } from '../../src/domain/model';
import { UNDO_DELETE_TIMEOUT_MS, useUndoDelete } from '../../src/features/case/useUndoDelete';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const NOTE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TOPIC_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const CONNECTION_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ATTACHMENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const SHA_256 = 'a'.repeat(64);

const CASE: CaseRecord = {
  id: CASE_ID,
  title: 'Cell Biology',
  subject: 'Biology',
  createdAt: '2026-09-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  viewport: DEFAULT_VIEWPORT,
  closedAt: null,
  isDemo: false,
  backupPromptedAt: null,
};

function makeNote(): CardRecord {
  return {
    id: NOTE_ID,
    caseId: CASE_ID,
    type: 'note',
    title: 'Membrane transport',
    position: { x: 180, y: 240 },
    tags: ['lecture'],
    createdAt: '2026-09-02T09:00:00.000Z',
    updatedAt: '2026-09-02T09:00:00.000Z',
  };
}

function makeTopic(): CardRecord {
  return {
    id: TOPIC_ID,
    caseId: CASE_ID,
    type: 'topic',
    title: 'Osmosis',
    position: { x: 460, y: 240 },
    tags: [],
    createdAt: '2026-09-02T09:05:00.000Z',
    updatedAt: '2026-09-02T09:05:00.000Z',
  };
}

function makeConnection(): ConnectionRecord {
  return {
    id: CONNECTION_ID,
    caseId: CASE_ID,
    fromCardId: NOTE_ID,
    toCardId: TOPIC_ID,
    pairKey: buildPairKey(NOTE_ID, TOPIC_ID),
    type: 'association',
  };
}

function makeAttachment(): AttachmentRecord {
  const blob = new Blob(['display-bytes'], { type: 'image/png' });
  return {
    id: ATTACHMENT_ID,
    cardId: NOTE_ID,
    kind: 'display',
    mime: 'image/png',
    width: 1200,
    height: 800,
    bytes: blob.size,
    sha256: SHA_256,
    blob,
  };
}

function makeRepository(attachments: readonly AttachmentRecord[] = [makeAttachment()]) {
  return new InMemoryCaseRepository({
    seed: {
      cases: [CASE],
      cards: [makeNote(), makeTopic()],
      connections: [makeConnection()],
      attachments,
    },
  });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useUndoDelete', () => {
  it('deletes immediately, exposes one undo slot, and restores the exact snapshot', async () => {
    const repository = makeRepository();
    const { result } = renderHook(() => useUndoDelete({ repository }));

    await act(async () => {
      await result.current.deleteWithUndo(NOTE_ID);
    });

    expect(await repository.getCard(NOTE_ID)).toBeNull();
    expect(await repository.listConnections(CASE_ID)).toHaveLength(0);
    expect(await repository.listAttachments(NOTE_ID)).toHaveLength(0);

    expect(result.current.pending).not.toBeNull();
    expect(result.current.pending?.cardId).toBe(NOTE_ID);
    expect(result.current.pending?.stringCount).toBe(1);
    expect(result.current.message).toContain('1 string removed');
    expect(result.current.message).toContain('Undo within 8 seconds');

    let restored = false;
    await act(async () => {
      restored = await result.current.undo();
    });

    expect(restored).toBe(true);
    expect(result.current.pending).toBeNull();

    const card = await repository.getCard(NOTE_ID);
    expect(card?.title).toBe('Membrane transport');
    expect(card?.position).toEqual({ x: 180, y: 240 });
    expect(card?.tags).toEqual(['lecture']);

    const connections = await repository.listConnections(CASE_ID);
    expect(connections.map((connection) => connection.id)).toEqual([CONNECTION_ID]);

    const attachments = await repository.listAttachments(NOTE_ID);
    expect(attachments.map((attachment) => attachment.id)).toEqual([ATTACHMENT_ID]);
    expect(attachments[0]?.blob.size).toBe(new Blob(['display-bytes']).size);

    // There is no redo: the same snapshot cannot be restored twice.
    let secondUndo = null;
    await act(async () => {
      secondUndo = await result.current.undo();
    });
    expect(secondUndo).toBe(false);
  });

  it('clears the snapshot when the 8-second window closes', async () => {
    vi.useFakeTimers();
    const repository = makeRepository();
    const { result } = renderHook(() => useUndoDelete({ repository }));

    await act(async () => {
      await result.current.deleteWithUndo(NOTE_ID);
    });
    expect(result.current.pending).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(UNDO_DELETE_TIMEOUT_MS - 1);
    });
    expect(result.current.pending).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(result.current.pending).toBeNull();
    expect(result.current.message).toBeNull();

    let restored = true;
    await act(async () => {
      restored = await result.current.undo();
    });
    expect(restored).toBe(false);
    expect(await repository.getCard(NOTE_ID)).toBeNull();
  });

  it('replaces the undo slot on a second delete and cannot restore the first card', async () => {
    const repository = makeRepository();
    const { result } = renderHook(() => useUndoDelete({ repository }));

    await act(async () => {
      await result.current.deleteWithUndo(NOTE_ID);
    });
    expect(result.current.pending?.cardId).toBe(NOTE_ID);

    await act(async () => {
      await result.current.deleteWithUndo(TOPIC_ID);
    });
    expect(result.current.pending?.cardId).toBe(TOPIC_ID);

    await act(async () => {
      await result.current.undo();
    });

    expect(await repository.getCard(TOPIC_ID)).not.toBeNull();
    expect(await repository.getCard(NOTE_ID)).toBeNull();
  });

  it('drops the snapshot when the toast is dismissed', async () => {
    const repository = makeRepository([]);
    const { result } = renderHook(() => useUndoDelete({ repository }));

    await act(async () => {
      await result.current.deleteWithUndo(NOTE_ID);
    });
    expect(result.current.pending).not.toBeNull();

    act(() => {
      result.current.dismiss();
    });
    expect(result.current.pending).toBeNull();

    let restored = true;
    await act(async () => {
      restored = await result.current.undo();
    });
    expect(restored).toBe(false);
  });
});
