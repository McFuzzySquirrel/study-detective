/**
 * Cross-tab case invalidation (renderer-neutral).
 *
 * A tab that commits a case mutation broadcasts the case id and the kind of
 * change. Other tabs re-read the repository rather than applying the payload,
 * so IndexedDB stays authoritative and a stale event can never overwrite a
 * newer persisted write. Local UI state (including an unsaved form draft) is
 * never replaced by a background refresh.
 *
 * BroadcastChannel is optional. When it is unavailable the sync becomes a
 * no-op instead of throwing. This module deliberately has no React import and
 * performs no network calls; the React hook lives in `src/features/shelf`.
 */

export const CASE_SYNC_CHANNEL = 'notes-detective:case-sync';

export const CASE_MUTATIONS = ['created', 'updated', 'deleted'] as const;

export type CaseMutation = (typeof CASE_MUTATIONS)[number];

export interface CaseMutationEvent {
  readonly type: 'case-mutation';
  readonly caseId: string;
  readonly mutation: CaseMutation;
  /** Identifies the emitting tab so it can ignore its own echo. */
  readonly sourceId: string;
  readonly emittedAt: string;
}

/**
 * The narrow channel contract the hook depends on. Tests supply a fake version
 * so no browser BroadcastChannel is needed, and unsupported environments can
 * return null.
 */
export interface CaseSyncChannel {
  post(event: CaseMutationEvent): void;
  subscribe(listener: (event: CaseMutationEvent) => void): () => void;
  close(): void;
}

export type BroadcastChannelFactory = (name: string) => CaseSyncChannel | null;

export interface CaseBroadcastSyncOptions {
  /** This tab's identity, used to ignore its own echoed events. */
  readonly sourceId: string;
  /** Called for every mutation event from another tab, in arrival order. */
  readonly onMutation: (event: CaseMutationEvent) => void;
  readonly channelName?: string;
  /** Injectable factory for tests and unsupported environments. */
  readonly createChannel?: BroadcastChannelFactory;
}

export interface CaseBroadcastSync {
  /** Broadcast a committed mutation. A no-op when no channel is available. */
  readonly broadcastMutation: (caseId: string, mutation: CaseMutation) => void;
  /** Unsubscribe and release the underlying channel. */
  readonly close: () => void;
}

function isCaseMutation(value: unknown): value is CaseMutation {
  return typeof value === 'string' && (CASE_MUTATIONS as readonly string[]).includes(value);
}

/**
 * Defensive message validation. Another tab (or a stale build) may post a
 * malformed payload; it is ignored rather than trusted.
 */
export function isCaseMutationEvent(value: unknown): value is CaseMutationEvent {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const event = value as Record<string, unknown>;

  return (
    event.type === 'case-mutation' &&
    typeof event.caseId === 'string' &&
    event.caseId.length > 0 &&
    typeof event.sourceId === 'string' &&
    event.sourceId.length > 0 &&
    typeof event.emittedAt === 'string' &&
    isCaseMutation(event.mutation)
  );
}

export function createCaseMutationEvent(
  caseId: string,
  mutation: CaseMutation,
  sourceId: string,
  emittedAt: string = new Date().toISOString(),
): CaseMutationEvent {
  return {
    type: 'case-mutation',
    caseId,
    mutation,
    sourceId,
    emittedAt,
  };
}

/**
 * Wrap the browser BroadcastChannel. Returns null when the API is missing or
 * construction fails (for example in a restricted iframe).
 */
export function openCaseMutationChannel(name: string = CASE_SYNC_CHANNEL): CaseSyncChannel | null {
  if (typeof globalThis.BroadcastChannel !== 'function') {
    return null;
  }

  let channel: BroadcastChannel;

  try {
    channel = new globalThis.BroadcastChannel(name);
  } catch {
    return null;
  }

  return {
    post(event) {
      try {
        channel.postMessage(event);
      } catch {
        // A closed channel must not break the write that triggered the event.
      }
    },
    subscribe(listener) {
      const handleMessage = (message: MessageEvent): void => {
        if (isCaseMutationEvent(message.data)) {
          listener(message.data);
        }
      };

      channel.addEventListener('message', handleMessage);
      return () => {
        channel.removeEventListener('message', handleMessage);
      };
    },
    close() {
      try {
        channel.close();
      } catch {
        // Already closed.
      }
    },
  };
}

/**
 * Create a renderer-neutral sync: subscribe once, ignore this tab's own echo,
 * and expose a broadcaster for committed mutations. The caller owns `close`.
 */
export function createCaseBroadcastSync({
  sourceId,
  onMutation,
  channelName = CASE_SYNC_CHANNEL,
  createChannel = openCaseMutationChannel,
}: CaseBroadcastSyncOptions): CaseBroadcastSync {
  const channel = createChannel(channelName);

  if (channel === null) {
    return {
      broadcastMutation: () => {
        // No cross-tab channel in this browser; single-tab use still works.
      },
      close: () => {
        // Nothing to release.
      },
    };
  }

  const unsubscribe = channel.subscribe((event) => {
    if (event.sourceId === sourceId) {
      return;
    }
    onMutation(event);
  });

  return {
    broadcastMutation(caseId, mutation) {
      if (caseId.length === 0) {
        return;
      }
      channel.post(createCaseMutationEvent(caseId, mutation, sourceId));
    },
    close() {
      unsubscribe();
      channel.close();
    },
  };
}

/** A per-tab identity for echo suppression. */
export function createSyncTabId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}
