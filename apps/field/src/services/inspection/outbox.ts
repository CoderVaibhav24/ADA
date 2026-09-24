import * as Network from 'expo-network';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';

import { retryCapture } from '@/services/api/uploads';
import {
  cannotBeSent,
  capturesSnapshot,
  stuckReason,
  subscribeToCaptures,
  type CaptureRecord,
} from '@/services/storage/captures';
import { draftStore } from '@/services/storage/kv';

import { subscribeToCheckIns, type CheckInRecord } from './check-in';
import { isWorkable, localRound, type LocalRound } from './rounds';
import { drainAllSubmits, subscribeToSubmitQueue, type QueuedSubmit } from './submit';
import { syncRound } from './sync';

/*
 * Everything this handset holds that the office does not have yet, across every
 * case: captures still owing bytes, check-ins held offline, and rounds opened but
 * not submitted. Read from the capture index and the MMKV records — the same disk
 * state the drain works from — so the counts survive a kill and cannot drift from
 * what is actually waiting (ui-rules.md §2).
 */

export type UploadState = 'waiting' | 'later' | 'sending' | 'failed';

export type OutboxUpload =
  | { readonly kind: 'photo'; readonly id: string; readonly caseRef: string; readonly state: UploadState; readonly at: string; readonly record: CaptureRecord }
  | { readonly kind: 'checkIn'; readonly id: string; readonly caseRef: string; readonly state: UploadState; readonly at: string; readonly record: CheckInRecord };

export type OutboxRound = { readonly caseRef: string; readonly round: LocalRound };

/** A pressed Submit held on the phone: `queued` goes by itself, `refused` needs the surveyor. */
export type OutboxSubmit = QueuedSubmit;

export type Outbox = {
  readonly uploads: readonly OutboxUpload[];
  readonly rounds: readonly OutboxRound[];
  readonly submits: readonly OutboxSubmit[];
  readonly photos: number;
  readonly checkIns: number;
  readonly failed: number;
  readonly sending: boolean;
};

const CHECK_IN_PREFIX = 'check-in:';
const ROUND_PREFIX = 'round:';
const SUBMIT_PREFIX = 'submit-queue:';

// Every held submit on the device, as one stable string so React can subscribe to it.
function submitsSnapshot(): string {
  return draftStore
    .getAllKeys()
    .filter((key) => key.startsWith(SUBMIT_PREFIX))
    .sort()
    .map((key) => draftStore.getString(key) ?? '')
    .join('\n');
}

function parseSubmits(snapshot: string): QueuedSubmit[] {
  if (snapshot === '') return [];
  return snapshot.split('\n').flatMap((line) => {
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== 'object') return [];
      const record = parsed as QueuedSubmit;
      return typeof record.caseRef === 'string' && typeof record.state === 'string' ? [record] : [];
    } catch {
      return [];
    }
  });
}

function parseCaptures(snapshot: string): CaptureRecord[] {
  if (snapshot === '') return [];
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return Array.isArray(parsed) ? (parsed as CaptureRecord[]) : [];
  } catch {
    return [];
  }
}

// Every check-in record on the device, as one stable string so React can subscribe to it.
function checkInsSnapshot(): string {
  return draftStore
    .getAllKeys()
    .filter((key) => key.startsWith(CHECK_IN_PREFIX))
    .sort()
    .map((key) => draftStore.getString(key) ?? '')
    .join('\n');
}

function parseCheckIns(snapshot: string): CheckInRecord[] {
  if (snapshot === '') return [];
  return snapshot.split('\n').flatMap((line) => {
    try {
      const parsed: unknown = JSON.parse(line);
      if (parsed === null || typeof parsed !== 'object') return [];
      const record = parsed as CheckInRecord;
      return typeof record.caseRef === 'string' && typeof record.state === 'string' ? [record] : [];
    } catch {
      return [];
    }
  });
}

// Rounds opened on this device and not yet submitted.
function openRounds(): OutboxRound[] {
  return draftStore
    .getAllKeys()
    .filter((key) => key.startsWith(ROUND_PREFIX))
    .map((key) => key.slice(ROUND_PREFIX.length))
    .flatMap((caseRef) => {
      const round = localRound(caseRef);
      return round !== null && round.step !== 'done' && isWorkable(round.status) ? [{ caseRef, round }] : [];
    });
}

// A capture's state in the words the surveyor sees.
function captureState(record: CaptureRecord, online: boolean): UploadState {
  if (record.state === 'uploading') return 'sending';
  if (record.state === 'failed' && (stuckReason(record) !== null || cannotBeSent(record))) return 'failed';
  if (!online) return 'waiting';
  return record.attempts > 0 ? 'later' : 'waiting';
}

// Builds the outbox from the disk snapshots.
function buildOutbox(captures: string, checkIns: string, submitsRaw: string, online: boolean): Outbox {
  const submits = parseSubmits(submitsRaw);
  const held = new Set(submits.map((record) => record.caseRef));
  const photos: OutboxUpload[] = parseCaptures(captures)
    .filter((record) => record.state !== 'uploaded')
    .map((record) => ({
      kind: 'photo' as const,
      id: record.id,
      caseRef: record.caseRef,
      state: captureState(record, online),
      at: record.createdAt,
      record,
    }));
  const arrivals: OutboxUpload[] = parseCheckIns(checkIns)
    .filter((record) => record.state === 'held')
    .map((record) => ({
      kind: 'checkIn' as const,
      id: `check-in:${record.caseRef}`,
      caseRef: record.caseRef,
      state: record.error !== null ? ('failed' as const) : online ? ('later' as const) : ('waiting' as const),
      at: record.recordedAt,
      record,
    }));
  const uploads = [...arrivals, ...photos].sort((a, b) => a.at.localeCompare(b.at));
  return {
    uploads,
    rounds: openRounds().filter((entry) => !held.has(entry.caseRef)),
    submits,
    photos: photos.length,
    checkIns: arrivals.length,
    failed: uploads.filter((item) => item.state === 'failed').length,
    sending: uploads.some((item) => item.state === 'sending'),
  };
}

// Whether the handset reports a connection; unknown counts as online so nothing is hidden.
function useConnected(): boolean {
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let active = true;
    void Network.getNetworkStateAsync()
      .then((state) => {
        if (active) setOnline(state.isConnected !== false);
      })
      .catch(() => undefined);
    const subscription = Network.addNetworkStateListener((state) => setOnline(state.isConnected !== false));
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);
  return online;
}

// The outbox, re-rendered whenever a capture or a check-in record changes on disk.
export function useOutbox(): Outbox & { readonly online: boolean } {
  const captures = useSyncExternalStore(subscribeToCaptures, capturesSnapshot);
  const checkIns = useSyncExternalStore(subscribeToCheckIns, checkInsSnapshot);
  const submits = useSyncExternalStore(subscribeToSubmitQueue, submitsSnapshot);
  const online = useConnected();
  const outbox = useMemo(() => buildOutbox(captures, checkIns, submits, online), [captures, checkIns, submits, online]);
  return useMemo(() => ({ ...outbox, online }), [outbox, online]);
}

// The same numbers outside React, for the logout confirmation.
export function readOutbox(): Outbox {
  return buildOutbox(capturesSnapshot(), checkInsSnapshot(), submitsSnapshot(), true);
}

// Sends everything held for each case, one case at a time; the drain itself refuses to run twice.
async function syncCases(caseRefs: readonly string[]): Promise<void> {
  for (const caseRef of new Set(caseRefs)) {
    await syncRound(caseRef).catch(() => null);
  }
}

// The surveyor's "try again": failed captures go back to the front of the queue, then everything is sent.
export async function retryUploads(items: readonly OutboxUpload[]): Promise<void> {
  for (const item of items) {
    if (item.kind === 'photo' && item.record.state === 'failed') retryCapture(item.record);
  }
  await syncCases(items.map((item) => item.caseRef));
  // Held submits follow their photographs; the drain skips any still waiting on uploads.
  await drainAllSubmits().catch(() => 0);
}

/*
 * Keeps the outbox moving while a screen that shows it is open: now, and whenever
 * the network comes back. Every write carries the key minted at the tap, so a
 * repeat is a replay (code-standards.md rule 4).
 */
export function useOutboxDrain(caseRefs: readonly string[]): () => Promise<void> {
  const key = [...new Set(caseRefs)].sort().join('|');
  const run = useCallback(async () => {
    await syncCases(key === '' ? [] : key.split('|'));
    await drainAllSubmits().catch(() => 0);
  }, [key]);
  useEffect(() => {
    void run();
    const subscription = Network.addNetworkStateListener((state) => {
      if (state.isConnected === true) void run();
    });
    return () => subscription.remove();
  }, [run]);
  return run;
}
