import { describe, expect, it, vi } from 'vitest';

import {
  createPersistenceClient,
  readPersistenceState,
  requestPersistentStorage,
  UNSUPPORTED_PERSISTENCE,
} from '../../src/data/persistence';

type PersistFn = () => Promise<boolean>;

describe('persistence', () => {
  it('reads an already-granted persistence state without asking again', async () => {
    const persist = vi.fn<PersistFn>();
    const persisted = vi.fn<PersistFn>().mockResolvedValue(true);

    const result = await readPersistenceState({ persist, persisted });

    expect(result).toEqual({
      state: 'persistent',
      supported: true,
      requested: false,
      granted: true,
    });
    expect(persist).not.toHaveBeenCalled();
    expect(persisted).toHaveBeenCalledTimes(1);
  });

  it('requests persistence and reports the granted answer', async () => {
    const persist = vi.fn<PersistFn>().mockResolvedValue(true);

    const result = await requestPersistentStorage({ persist });

    expect(result).toEqual({
      state: 'persistent',
      supported: true,
      requested: true,
      granted: true,
    });
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('reports a denied request as best effort but still supported', async () => {
    const persist = vi.fn<PersistFn>().mockResolvedValue(false);

    const result = await requestPersistentStorage({ persist });

    expect(result).toEqual({
      state: 'best-effort',
      supported: true,
      requested: true,
      granted: false,
    });
  });

  it('reports missing storage APIs as unsupported best effort', async () => {
    expect(await readPersistenceState(null)).toEqual(UNSUPPORTED_PERSISTENCE);
    expect(await requestPersistentStorage(null)).toEqual(UNSUPPORTED_PERSISTENCE);
    expect(await readPersistenceState({})).toEqual(UNSUPPORTED_PERSISTENCE);
    expect(await requestPersistentStorage({})).toEqual(UNSUPPORTED_PERSISTENCE);
  });

  it('treats a rejected persist promise as best effort instead of throwing', async () => {
    const persist = vi.fn<PersistFn>().mockRejectedValue(new Error('permission denied'));

    const result = await requestPersistentStorage({ persist });

    expect(result).toEqual({
      state: 'best-effort',
      supported: true,
      requested: true,
      granted: false,
    });
  });

  it('treats a rejected persisted read as best effort but still supported', async () => {
    const persisted = vi.fn<PersistFn>().mockRejectedValue(new Error('blocked'));

    const result = await readPersistenceState({ persisted });

    expect(result).toEqual({
      state: 'best-effort',
      supported: true,
      requested: false,
      granted: false,
    });
  });

  it('asks the browser exactly once per client and caches the answer', async () => {
    const persist = vi.fn<PersistFn>().mockResolvedValue(true);
    const client = createPersistenceClient({ persist });

    const [first, second] = await Promise.all([client.request(), client.request()]);

    expect(first.state).toBe('persistent');
    expect(second.state).toBe('persistent');
    expect(persist).toHaveBeenCalledTimes(1);
    expect(client.snapshot()).toEqual(first);
  });

  it('keeps the latest answer from read and a later request', async () => {
    const client = createPersistenceClient({
      persist: async () => true,
      persisted: async () => false,
    });

    expect((await client.read()).state).toBe('best-effort');
    expect(client.snapshot()?.state).toBe('best-effort');

    expect((await client.request()).state).toBe('persistent');
    expect(client.snapshot()?.state).toBe('persistent');
  });
});
