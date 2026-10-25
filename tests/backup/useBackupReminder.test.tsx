import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InMemoryCaseRepository } from '../../src/data/caseRepository';
import { fixedClock } from '../../src/domain/ids';
import { DEFAULT_VIEWPORT, buildPairKey } from '../../src/domain/model';
import type { CardRecord, CaseRecord, ConnectionRecord } from '../../src/domain/model';
import {
  BACKUP_REMINDER_MIN_CARDS,
  BACKUP_REMINDER_MIN_CONNECTIONS,
  useBackupReminder,
} from '../../src/features/backup/useBackupReminder';
import { readRepositoryFile } from '../helpers/css-contract';

const CASE_ID = '11111111-1111-4111-8111-111111111111';
const PROMPTED_AT = '2026-10-02T09:00:00.000Z';

const CARD_IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  'ffffffff-ffff-4fff-8fff-ffffffffffff',
] as const;

const CONNECTION_IDS = [
  '12121212-1212-4212-8212-121212121212',
  '34343434-3434-4343-8343-343434343434',
] as const;

function makeCase(backupPromptedAt: string | null = null): CaseRecord {
  return {
    id: CASE_ID,
    title: 'Tudor England',
    subject: 'History',
    createdAt: '2026-09-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    viewport: DEFAULT_VIEWPORT,
    closedAt: null,
    isDemo: false,
    backupPromptedAt,
  };
}

function makeCards(count: number): CardRecord[] {
  return CARD_IDS.slice(0, count).map((id, index) => ({
    id,
    caseId: CASE_ID,
    type: index === 0 ? 'topic' : 'note',
    title: `Evidence ${index + 1}`,
    position: { x: index * 80, y: 0 },
    tags: [],
    createdAt: `2026-09-02T09:0${index}:00.000Z`,
    updatedAt: `2026-09-02T09:0${index}:00.000Z`,
  }));
}

function makeConnections(count: number, cards: readonly CardRecord[]): ConnectionRecord[] {
  const first = cards[0];
  const second = cards[1];
  if (first === undefined || second === undefined) {
    return [];
  }

  return CONNECTION_IDS.slice(0, count).map((id, index) => {
    const from = cards[index] ?? first;
    const to = cards[index + 1] ?? second;
    return {
      id,
      caseId: CASE_ID,
      fromCardId: from.id,
      toCardId: to.id,
      pairKey: buildPairKey(from.id, to.id),
      type: 'association',
    };
  });
}

function makeRepository(
  options: {
    readonly backupPromptedAt?: string | null;
    readonly cardCount?: number;
    readonly connectionCount?: number;
  } = {},
): InMemoryCaseRepository {
  const caseRecord = makeCase(options.backupPromptedAt ?? null);
  const cards = makeCards(options.cardCount ?? BACKUP_REMINDER_MIN_CARDS);
  const connections = makeConnections(
    options.connectionCount ?? BACKUP_REMINDER_MIN_CONNECTIONS,
    cards,
  );

  return new InMemoryCaseRepository({
    clock: fixedClock(PROMPTED_AT),
    seed: { cases: [caseRecord], cards, connections },
  });
}

afterEach(() => {
  cleanup();
});

describe('useBackupReminder', () => {
  it('appears at five cards and one connection', async () => {
    const repository = makeRepository();

    const { result } = renderHook(() =>
      useBackupReminder({ repository, caseId: CASE_ID, clock: fixedClock(PROMPTED_AT) }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.visible).toBe(true);
    expect(result.current.error).toBeNull();
  });

  it('stays hidden below either threshold', async () => {
    const tooFewCards = makeRepository({
      cardCount: BACKUP_REMINDER_MIN_CARDS - 1,
      connectionCount: 1,
    });
    const noConnections = makeRepository({
      cardCount: BACKUP_REMINDER_MIN_CARDS,
      connectionCount: 0,
    });

    const first = renderHook(() =>
      useBackupReminder({
        repository: tooFewCards,
        caseId: CASE_ID,
        clock: fixedClock(PROMPTED_AT),
      }),
    );
    const second = renderHook(() =>
      useBackupReminder({
        repository: noConnections,
        caseId: CASE_ID,
        clock: fixedClock(PROMPTED_AT),
      }),
    );

    await waitFor(() => {
      expect(first.result.current.loading).toBe(false);
      expect(second.result.current.loading).toBe(false);
    });
    expect(first.result.current.visible).toBe(false);
    expect(second.result.current.visible).toBe(false);
  });

  it('never appears again once backupPromptedAt is set', async () => {
    const repository = makeRepository({ backupPromptedAt: PROMPTED_AT });

    const { result } = renderHook(() =>
      useBackupReminder({ repository, caseId: CASE_ID, clock: fixedClock(PROMPTED_AT) }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.visible).toBe(false);
  });

  it('persists a dismissal and does not repeat on a later mount', async () => {
    const repository = makeRepository();
    const first = renderHook(() =>
      useBackupReminder({ repository, caseId: CASE_ID, clock: fixedClock(PROMPTED_AT) }),
    );

    await waitFor(() => {
      expect(first.result.current.visible).toBe(true);
    });

    let persisted = false;
    await act(async () => {
      persisted = await first.result.current.dismiss();
    });

    expect(persisted).toBe(true);
    expect(first.result.current.visible).toBe(false);
    expect((await repository.getCase(CASE_ID))?.backupPromptedAt).toBe(PROMPTED_AT);

    first.unmount();

    const second = renderHook(() =>
      useBackupReminder({ repository, caseId: CASE_ID, clock: fixedClock(PROMPTED_AT) }),
    );
    await waitFor(() => {
      expect(second.result.current.loading).toBe(false);
    });
    expect(second.result.current.visible).toBe(false);
  });

  it('persists a successful export and does not repeat on a later mount', async () => {
    const repository = makeRepository();
    const first = renderHook(() =>
      useBackupReminder({ repository, caseId: CASE_ID, clock: fixedClock(PROMPTED_AT) }),
    );

    await waitFor(() => {
      expect(first.result.current.visible).toBe(true);
    });

    let persisted = false;
    await act(async () => {
      persisted = await first.result.current.complete();
    });

    expect(persisted).toBe(true);
    expect(first.result.current.visible).toBe(false);
    expect((await repository.getCase(CASE_ID))?.backupPromptedAt).toBe(PROMPTED_AT);

    first.unmount();

    const second = renderHook(() =>
      useBackupReminder({ repository, caseId: CASE_ID, clock: fixedClock(PROMPTED_AT) }),
    );
    await waitFor(() => {
      expect(second.result.current.loading).toBe(false);
    });
    expect(second.result.current.visible).toBe(false);
  });

  it('keeps the banner visible and reports a recoverable write failure', async () => {
    const repository = makeRepository();
    const updateCase = vi
      .spyOn(repository, 'updateCase')
      .mockRejectedValue(new Error('quota exceeded'));

    const { result } = renderHook(() =>
      useBackupReminder({ repository, caseId: CASE_ID, clock: fixedClock(PROMPTED_AT) }),
    );

    await waitFor(() => {
      expect(result.current.visible).toBe(true);
    });

    let persisted = true;
    await act(async () => {
      persisted = await result.current.dismiss();
    });

    expect(persisted).toBe(false);
    expect(result.current.visible).toBe(true);
    expect(result.current.saving).toBe(false);
    expect(result.current.error).toMatch(/could not be saved/i);
    expect(updateCase).toHaveBeenCalled();
  });

  it('does not read or write when disabled', async () => {
    const repository = makeRepository();
    const getCase = vi.spyOn(repository, 'getCase');

    const { result } = renderHook(() =>
      useBackupReminder({
        repository,
        caseId: CASE_ID,
        clock: fixedClock(PROMPTED_AT),
        enabled: false,
      }),
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });
    expect(result.current.visible).toBe(false);
    expect(getCase).not.toHaveBeenCalled();
  });

  it('uses the repository boundary only', () => {
    const source = readSource('src/features/backup/useBackupReminder.ts');

    expect(source).not.toContain('dangerouslySetInnerHTML');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/from ['"]dexie['"]/);
  });
});

function readSource(relativePath: string): string {
  return readRepositoryFile(relativePath);
}
