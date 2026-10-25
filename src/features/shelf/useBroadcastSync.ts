import { useCallback, useEffect, useRef, useState } from 'react';

import {
  CASE_SYNC_CHANNEL,
  createCaseBroadcastSync,
  createSyncTabId,
} from '../../data/useBroadcastSync';
import type {
  BroadcastChannelFactory,
  CaseBroadcastSync,
  CaseMutation,
  CaseMutationEvent,
} from '../../data/useBroadcastSync';

export type {
  BroadcastChannelFactory,
  CaseMutation,
  CaseMutationEvent,
} from '../../data/useBroadcastSync';

export interface UseBroadcastSyncOptions {
  /** Called for every mutation event from another tab, in arrival order. */
  readonly onMutation: (event: CaseMutationEvent) => void;
  readonly channelName?: string;
  /** Injectable factory for tests and unsupported environments. */
  readonly createChannel?: BroadcastChannelFactory;
}

export interface BroadcastSync {
  /** Broadcast a committed mutation. A no-op when no channel is available. */
  readonly broadcastMutation: (caseId: string, mutation: CaseMutation) => void;
}

/**
 * React adapter for the renderer-neutral case sync.
 *
 * Subscribing happens in an effect so React Strict Mode's development
 * double-invoke cleans up its first channel before opening the second one.
 * The hook keeps the latest `onMutation` in a ref, so a changing callback does
 * not churn the subscription, and the broadcaster remains stable for handlers.
 */
export function useBroadcastSync({
  onMutation,
  channelName = CASE_SYNC_CHANNEL,
  createChannel,
}: UseBroadcastSyncOptions): BroadcastSync {
  const [tabId] = useState(createSyncTabId);
  const onMutationRef = useRef(onMutation);
  const syncRef = useRef<CaseBroadcastSync | null>(null);

  useEffect(() => {
    onMutationRef.current = onMutation;
  }, [onMutation]);

  useEffect(() => {
    const sync = createCaseBroadcastSync({
      sourceId: tabId,
      onMutation: (event) => onMutationRef.current(event),
      channelName,
      ...(createChannel !== undefined ? { createChannel } : {}),
    });

    syncRef.current = sync;

    return () => {
      syncRef.current = null;
      sync.close();
    };
  }, [channelName, createChannel, tabId]);

  const broadcastMutation = useCallback((caseId: string, mutation: CaseMutation): void => {
    syncRef.current?.broadcastMutation(caseId, mutation);
  }, []);

  return { broadcastMutation };
}

export default useBroadcastSync;
