import 'fake-indexeddb/auto';

import { IDBDatabase, IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryConnectionRepository,
  ConnectionRepository,
} from '../../src/data/connectionRepository';
import { buildPairKey } from '../../src/domain/model';
import type { ConnectionType } from '../../src/domain/model';
import { compareConnections } from '../../src/features/recall/compareConnections';
import {
  createRecallStore,
  recallStore,
  selectHasScratch,
  selectScratchConnection,
  selectScratchConnections,
  selectScratchCount,
} from '../../src/features/recall/recallStore';
import compareSource from '../../src/features/recall/compareConnections.ts?raw';
import recallStoreSource from '../../src/features/recall/recallStore.ts?raw';

const CARD_A = '11111111-1111-4111-8111-111111111111';
const CARD_B = '22222222-2222-4222-8222-222222222222';
const CARD_C = '33333333-3333-4333-8333-333333333333';
const CARD_D = '44444444-4444-4444-8444-444444444444';

function pairKey(cardIdA: string, cardIdB: string): string {
  return buildPairKey(cardIdA, cardIdB);
}

describe('recall store initial state', () => {
  it('starts with an empty scratch layer', () => {
    const state = createRecallStore().getState();

    expect(state.scratchConnections).toEqual([]);
    expect(selectScratchConnections(state)).toBe(state.scratchConnections);
    expect(selectScratchCount(state)).toBe(0);
    expect(selectHasScratch(state)).toBe(false);
    expect(selectScratchConnection(state, pairKey(CARD_A, CARD_B))).toBeNull();
  });

  it('creates isolated stores that never share scratch state', () => {
    const first = createRecallStore();
    const second = createRecallStore();

    first.getState().addScratchConnection({ fromCardId: CARD_A, toCardId: CARD_B });

    expect(first.getState().scratchConnections).toHaveLength(1);
    expect(second.getState().scratchConnections).toEqual([]);
    expect(recallStore.getState().scratchConnections).toEqual([]);
  });
});

describe('addScratchConnection', () => {
  it('adds a canonical undirected pair and defaults to association', () => {
    const store = createRecallStore();

    const result = store.getState().addScratchConnection({
      fromCardId: CARD_B,
      toCardId: CARD_A,
    });

    expect(result).toEqual({
      status: 'created',
      connection: {
        id: pairKey(CARD_A, CARD_B),
        fromCardId: CARD_A,
        toCardId: CARD_B,
        type: 'association',
      },
    });
    if (result.status !== 'created') {
      throw new Error('Expected the scratch pair to be created');
    }
    expect(store.getState().scratchConnections).toEqual([result.connection]);
    expect(selectScratchCount(store.getState())).toBe(1);
    expect(selectHasScratch(store.getState())).toBe(true);
  });

  it('stores a provenance scratch pair with its type', () => {
    const store = createRecallStore();

    const result = store.getState().addScratchConnection({
      fromCardId: CARD_A,
      toCardId: CARD_C,
      type: 'provenance',
    });

    expect(result.status).toBe('created');
    expect(result.status === 'created' ? result.connection.type : null).toBe('provenance');
  });

  it('returns the existing row for a duplicate draw in either orientation', () => {
    const store = createRecallStore();
    const first = store.getState().addScratchConnection({
      fromCardId: CARD_A,
      toCardId: CARD_B,
    });
    const before = store.getState();

    if (first.status !== 'created') {
      throw new Error('Expected the first scratch pair to be created');
    }

    const reversed = store.getState().addScratchConnection({
      fromCardId: CARD_B,
      toCardId: CARD_A,
      type: 'provenance',
    });

    expect(reversed).toEqual({ status: 'duplicate', connection: first.connection });
    expect(store.getState()).toBe(before);
    expect(store.getState().scratchConnections).toHaveLength(1);
  });

  it('rejects self-links, empty endpoints, and unknown types without changing state', () => {
    const store = createRecallStore();
    const before = store.getState();

    expect(store.getState().addScratchConnection({ fromCardId: CARD_A, toCardId: CARD_A })).toEqual(
      { status: 'invalid' },
    );
    expect(store.getState().addScratchConnection({ fromCardId: '', toCardId: CARD_A })).toEqual({
      status: 'invalid',
    });
    expect(
      store.getState().addScratchConnection({
        fromCardId: CARD_A,
        toCardId: CARD_B,
        type: 'unknown' as ConnectionType,
      }),
    ).toEqual({ status: 'invalid' });

    expect(store.getState()).toBe(before);
    expect(store.getState().scratchConnections).toEqual([]);
  });
});

describe('removeScratchConnection', () => {
  it('removes one scratch string by its canonical pair key', () => {
    const store = createRecallStore();
    store.getState().addScratchConnection({ fromCardId: CARD_A, toCardId: CARD_B });
    store.getState().addScratchConnection({ fromCardId: CARD_B, toCardId: CARD_C });

    expect(store.getState().removeScratchConnection(pairKey(CARD_A, CARD_B))).toBe(true);
    expect(store.getState().scratchConnections.map((connection) => connection.id)).toEqual([
      pairKey(CARD_B, CARD_C),
    ]);
    expect(store.getState().removeScratchConnection(pairKey(CARD_A, CARD_B))).toBe(false);
  });

  it('removes a pair from either endpoint orientation', () => {
    const store = createRecallStore();
    store.getState().addScratchConnection({ fromCardId: CARD_A, toCardId: CARD_B });

    expect(store.getState().removeScratchConnectionForPair(CARD_B, CARD_A)).toBe(true);
    expect(store.getState().scratchConnections).toEqual([]);
  });

  it('ignores invalid or missing pair removals', () => {
    const store = createRecallStore();

    expect(store.getState().removeScratchConnectionForPair(CARD_A, CARD_A)).toBe(false);
    expect(store.getState().removeScratchConnectionForPair('', CARD_A)).toBe(false);
    expect(store.getState().removeScratchConnection(pairKey(CARD_A, CARD_B))).toBe(false);
    expect(store.getState().scratchConnections).toEqual([]);
  });
});

describe('clear and reset', () => {
  it('clear returns the store to an empty scratch state', () => {
    const store = createRecallStore();
    store.getState().addScratchConnection({ fromCardId: CARD_A, toCardId: CARD_B });
    store.getState().addScratchConnection({
      fromCardId: CARD_C,
      toCardId: CARD_D,
      type: 'provenance',
    });

    store.getState().clearScratch();

    expect(store.getState().scratchConnections).toEqual([]);
    expect(selectScratchCount(store.getState())).toBe(0);
    expect(selectHasScratch(store.getState())).toBe(false);
  });

  it('resetOnExit discards every scratch trace', () => {
    const store = createRecallStore();
    store.getState().addScratchConnection({ fromCardId: CARD_A, toCardId: CARD_B });
    store.getState().addScratchConnection({ fromCardId: CARD_B, toCardId: CARD_C });

    store.getState().resetOnExit();

    expect(store.getState().scratchConnections).toEqual([]);
    expect(selectScratchCount(store.getState())).toBe(0);
  });

  it('keeps actions usable after clear and reset', () => {
    const store = createRecallStore();

    store.getState().clearScratch();
    expect(
      store.getState().addScratchConnection({ fromCardId: CARD_A, toCardId: CARD_B }).status,
    ).toBe('created');

    store.getState().resetOnExit();
    expect(
      store.getState().addScratchConnection({ fromCardId: CARD_C, toCardId: CARD_D }).status,
    ).toBe('created');
  });
});

describe('selectors', () => {
  it('return existing references or primitives and find one scratch string', () => {
    const store = createRecallStore();
    store.getState().addScratchConnection({ fromCardId: CARD_A, toCardId: CARD_B });
    const state = store.getState();
    const key = pairKey(CARD_A, CARD_B);

    expect(selectScratchConnections(state)).toBe(state.scratchConnections);
    expect(selectScratchCount(state)).toBe(1);
    expect(selectHasScratch(state)).toBe(true);
    expect(selectScratchConnection(state, key)).toBe(state.scratchConnections[0]);
    expect(selectScratchConnection(state, pairKey(CARD_A, CARD_C))).toBeNull();
  });
});

describe('storage write guard', () => {
  it('performs no repository or storage write during enter, draw, check, reset, or exit', () => {
    const storageSpies = [
      vi.spyOn(IDBFactory.prototype, 'open'),
      vi.spyOn(IDBDatabase.prototype, 'transaction'),
      vi.spyOn(IDBObjectStore.prototype, 'add'),
      vi.spyOn(IDBObjectStore.prototype, 'put'),
      vi.spyOn(IDBObjectStore.prototype, 'delete'),
      vi.spyOn(IDBObjectStore.prototype, 'clear'),
      vi.spyOn(IDBObjectStore.prototype, 'get'),
      vi.spyOn(IDBObjectStore.prototype, 'getAll'),
      vi.spyOn(IDBObjectStore.prototype, 'count'),
      vi.spyOn(IDBObjectStore.prototype, 'openCursor'),
      vi.spyOn(Storage.prototype, 'setItem'),
      vi.spyOn(Storage.prototype, 'removeItem'),
      vi.spyOn(Storage.prototype, 'clear'),
    ];
    const repositoryMethods = [
      'create',
      'retype',
      'restore',
      'delete',
      'listByCase',
      'listByCard',
      'deleteByCard',
    ] as const;
    const repositorySpies = [
      ...repositoryMethods.map((method) => vi.spyOn(ConnectionRepository.prototype, method)),
      ...repositoryMethods.map((method) =>
        vi.spyOn(InMemoryConnectionRepository.prototype, method),
      ),
    ];

    // Enter: a fresh in-memory store.
    const store = createRecallStore();

    // Draw two scratch strings, one reversed.
    store.getState().addScratchConnection({ fromCardId: CARD_A, toCardId: CARD_B });
    store.getState().addScratchConnection({
      fromCardId: CARD_C,
      toCardId: CARD_D,
      type: 'provenance',
    });

    // Check.
    const comparison = compareConnections(
      [{ fromCardId: CARD_A, toCardId: CARD_B, type: 'provenance' }],
      store.getState().scratchConnections,
    );
    expect(comparison.remembered).toHaveLength(1);
    expect(comparison.typeMismatch).toHaveLength(1);

    // Remove one scratch string, reset, draw again, then exit.
    store.getState().removeScratchConnection(pairKey(CARD_A, CARD_B));
    store.getState().clearScratch();
    store.getState().addScratchConnection({ fromCardId: CARD_B, toCardId: CARD_C });
    store.getState().resetOnExit();

    expect(store.getState().scratchConnections).toEqual([]);
    for (const spy of [...storageSpies, ...repositorySpies]) {
      expect(spy).not.toHaveBeenCalled();
    }
  });

  it('the storage guard observes a real localStorage write', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');

    localStorage.setItem('recall-write-probe', '1');
    localStorage.removeItem('recall-write-probe');

    expect(setItem).toHaveBeenCalledTimes(1);
  });
});

describe('module boundary', () => {
  const SOURCE_FILES = [
    ['recallStore.ts', recallStoreSource],
    ['compareConnections.ts', compareSource],
  ] as const;

  it('imports no storage, repository, React, PixiJS, or persist middleware', () => {
    const forbidden = [
      /from\s+['"]dexie['"]/u,
      /from\s+['"].*\/data\//u,
      /from\s+['"]react['"]/u,
      /from\s+['"]react-dom['"]/u,
      /from\s+['"]react-router['"]/u,
      /from\s+['"]pixi\.js['"]/u,
      /from\s+['"]zustand['"]/u,
      /\bindexedDB\s*\./u,
      /\blocalStorage\s*[.[]/u,
      /\bsessionStorage\s*[.[]/u,
      /\bpersist\s*\(/u,
    ];

    for (const [name, source] of SOURCE_FILES) {
      for (const pattern of forbidden) {
        expect(source, `${name} matched ${String(pattern)}`).not.toMatch(pattern);
      }
    }
  });

  it('keeps the scratch store on the vanilla Zustand runtime', () => {
    expect(recallStoreSource).toMatch(/from\s+['"]zustand\/vanilla['"]/u);
  });
});
