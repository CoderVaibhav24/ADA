import { create } from 'zustand';

import { capturesForCase, dueCaptures, stuckCaptures } from '@/services/storage/captures';

/*
 * What the sync banner shows.
 *
 * Counts only, recomputed from the capture index — which is on disk, so the
 * numbers survive a kill and a reboot. The banner is non-dismissible while the
 * count is non-zero (`ui-registry.md` §3), which only works if the count is real.
 */
export type SyncState = {
  readonly pending: number;
  readonly failed: number;
  readonly refresh: () => void;
  readonly refreshForCase: (caseRef: string) => void;
};

export const useSyncStore = create<SyncState>((set) => ({
  pending: 0,
  failed: 0,
  refresh: () => {
    set({ pending: dueCaptures().length, failed: stuckCaptures().length });
  },
  refreshForCase: (caseRef: string) => {
    const records = capturesForCase(caseRef);
    set({
      pending: records.filter((record) => record.state !== 'uploaded').length,
      failed: records.filter((record) => record.state === 'failed').length,
    });
  },
}));
