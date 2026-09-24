import { useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import * as Network from 'expo-network';
import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';

import { AdaApiError } from '@/services/api/errors';
import { inspectionKeys } from '@/services/api/inspection-reads';
import { currentAppConfig } from '@/services/config/app-config';
import { capabilitiesQueryKey, fetchCapabilities } from '@/services/config/capabilities';
import {
  capturesSnapshot,
  roundCapturesIn,
  stuckReason,
  subscribeToCaptures,
  type CaptureRecord,
} from '@/services/storage/captures';

import { checkInFrom, checkInSnapshot, subscribeToCheckIns, type CheckInRecord } from './check-in';
import { localRound, resolveRound, type ResolvedRound } from './rounds';
import {
  drainAllSubmits,
  drainSubmit,
  queuedSubmitFrom,
  readQueuedSubmit,
  submitQueueSnapshot,
  subscribeToSubmitQueue,
  type QueuedSubmit,
} from './submit';
import { syncRound } from './sync';

/*
 * The wizard's reads. Every step asks the same query for the round, so the four
 * screens share one answer instead of four, and a relaunch renders the round the
 * device remembers while the server is asked again.
 *
 * The round's detail and the case are read through `services/api/inspection-reads.ts`
 * and `case-reads.ts`, so the wizard and the rest of the app share one cache entry.
 */
export const roundQueryKey = (caseRef: string) => ['icms', 'inspection-round', caseRef] as const;

// The round to work on — resumed or opened by the server, or the remembered one offline.
export function useInspectionRound(caseRef: string): UseQueryResult<ResolvedRound, Error> {
  const queryClient = useQueryClient();
  return useQuery({
    queryKey: roundQueryKey(caseRef),
    queryFn: async () => {
      let userId: string;
      try {
        // The server's own name for the caller: the value `surveyor_user_id` must carry.
        const capabilities = await queryClient.fetchQuery({
          queryKey: capabilitiesQueryKey,
          queryFn: ({ signal }) => fetchCapabilities(signal),
          staleTime: 10 * 60_000,
        });
        userId = capabilities.user_id;
      } catch (error) {
        const remembered = localRound(caseRef);
        if (error instanceof AdaApiError && error.isOffline && remembered !== null) {
          return { ...remembered, source: 'device' as const };
        }
        throw error;
      }
      return resolveRound(caseRef, userId);
    },
    placeholderData: () => {
      const remembered = localRound(caseRef);
      return remembered === null ? undefined : { ...remembered, source: 'device' as const };
    },
    staleTime: 60_000,
  });
}

/*
 * Keeps the round's held work moving while a wizard step is open: now, whenever
 * the network comes back, and on the backoff base interval. Afterwards the
 * round is re-read so the screen shows what the server now holds.
 */
export function useRoundSync(caseRef: string, inspectionRef: string | null): void {
  const queryClient = useQueryClient();

  useEffect(() => {
    let active = true;
    const run = () => {
      void syncRound(caseRef).then(async (outcome) => {
        // A submit held on the device follows its evidence out.
        if (readQueuedSubmit(caseRef)?.state === 'queued') {
          const sent = await drainSubmit(caseRef);
          if (active && sent.kind === 'sent') {
            queryClient.setQueryData(inspectionKeys.detail(sent.detail.inspection_ref), sent.detail);
            void queryClient.invalidateQueries({ queryKey: roundQueryKey(caseRef) });
            return;
          }
        }
        // Re-read only when something was actually sent; an idle tick costs no request.
        if (active && inspectionRef !== null && outcome === 'uploaded') {
          void queryClient.invalidateQueries({ queryKey: inspectionKeys.detail(inspectionRef) });
        }
      });
    };

    run();
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected === true) run();
    });
    const timer = setInterval(run, currentAppConfig().uploadBackoffBaseMs);
    return () => {
      active = false;
      network.remove();
      clearInterval(timer);
    };
  }, [caseRef, inspectionRef, queryClient]);
}

// The round's captures, re-rendered whenever the capture index changes.
export function useRoundCaptures(caseRef: string, inspectionRef: string | null): CaptureRecord[] {
  const snapshot = useSyncExternalStore(subscribeToCaptures, capturesSnapshot);
  return useMemo(() => roundCapturesIn(snapshot, caseRef, inspectionRef), [snapshot, caseRef, inspectionRef]);
}

export type StuckPhotos = {
  /** Photos whose file is gone: removed and taken again. */
  readonly retake: readonly CaptureRecord[];
  /** Photos out of automatic tries: one tap sends them again. */
  readonly retry: readonly CaptureRecord[];
};

// The round's photos that will not go without the surveyor; a held submit waits on them.
export function useStuckPhotos(caseRef: string, inspectionRef: string | null): StuckPhotos {
  const records = useRoundCaptures(caseRef, inspectionRef);
  return useMemo(
    () => ({
      retake: records.filter((record) => stuckReason(record) === 'retake'),
      retry: records.filter((record) => stuckReason(record) === 'retry'),
    }),
    [records],
  );
}

// The round's check-in record on this device, re-rendered whenever it changes.
export function useCheckInRecord(caseRef: string, inspectionRef: string | null): CheckInRecord | null {
  const read = useCallback(() => checkInSnapshot(caseRef), [caseRef]);
  const snapshot = useSyncExternalStore(subscribeToCheckIns, read);
  return useMemo(() => checkInFrom(snapshot, inspectionRef), [snapshot, inspectionRef]);
}

// The submit held on this device for a case, re-rendered whenever it changes.
export function useQueuedSubmit(caseRef: string): QueuedSubmit | null {
  const read = useCallback(() => submitQueueSnapshot(caseRef), [caseRef]);
  const snapshot = useSyncExternalStore(subscribeToSubmitQueue, read);
  return useMemo(() => queuedSubmitFrom(snapshot), [snapshot]);
}

/*
 * Sends every submit held on the device whenever the network comes back, from
 * anywhere in the app — mount once under the signed-in layout.
 */
export function useQueuedSubmitDrain(): void {
  const queryClient = useQueryClient();
  useEffect(() => {
    const run = () => {
      void drainAllSubmits().then((sent) => {
        if (sent > 0) void queryClient.invalidateQueries({ queryKey: ['icms'] });
      });
    };
    run();
    const network = Network.addNetworkStateListener((state) => {
      if (state.isConnected === true) run();
    });
    return () => network.remove();
  }, [queryClient]);
}
