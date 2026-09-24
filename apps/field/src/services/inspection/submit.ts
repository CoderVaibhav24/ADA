import * as Network from 'expo-network';

import { AdaApiError } from '@/services/api/errors';
import { idempotencyKeyFor, releaseIdempotencyKey } from '@/services/api/idempotency';
import { postSubmit } from '@/services/api/inspections';
import type { InspectionDetail } from '@/services/api/types';
import { capturesForCase, isInFlight, stuckReason, type CaptureRecord } from '@/services/storage/captures';
import { draftStore, readJson, writeJson } from '@/services/storage/kv';

import { clearCheckIn, discardCheckIn, readCheckIn } from './check-in';
import { FindingsInvalid, clearFindings, hasUnsentFindings, sendFindings } from './findings';
import { isNotAllowedCode } from './refusals';
import { forgetRound, rememberRoundDetail, rememberStep } from './rounds';
import { syncRound } from './sync';

/*
 * Submit, held on the device until it lands.
 *
 * The surveyor's tap is recorded first — with the idempotency key minted at that
 * tap — and then sent: the held check-in and photographs go first (sync.ts), then
 * any unsent answers, then the submit itself. Without signal the tap stays held
 * and is sent when signal returns; the screen says so instead of failing. The key
 * survives every retry, a kill and a reboot, and the server answers a replay with
 * the round already submitted, so two taps are one inspection.
 *
 * A refusal (a 4xx) is not retried: it is kept, with the server's field and
 * allowed values, until the surveyor fixes the answer and sends again.
 */
export type QueuedSubmitState = 'queued' | 'refused';

export type StoredRefusal = {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  readonly field: string | null;
  readonly allowed: readonly string[] | null;
  readonly requestId: string | null;
};

export type QueuedSubmit = {
  readonly caseRef: string;
  readonly inspectionRef: string;
  readonly queuedAt: string;
  readonly state: QueuedSubmitState;
  readonly lastTriedAt: string | null;
  readonly refusal: StoredRefusal | null;
};

export type SubmitOutcome =
  | { readonly kind: 'sent'; readonly detail: InspectionDetail }
  /** No signal: held, sent when it returns. */
  | { readonly kind: 'offline' }
  /** Online, but the check-in or photographs are still on their way; submit follows them. */
  | { readonly kind: 'uploading' }
  /** A photograph will not go by itself: gone from the phone (retake) or out of tries (retry). Held until fixed. */
  | { readonly kind: 'evidenceStuck'; readonly retake: number; readonly retry: number }
  /** The server could not answer (5xx): held and tried again. */
  | { readonly kind: 'serverBusy' }
  | { readonly kind: 'refused'; readonly error: AdaApiError }
  | { readonly kind: 'none' };

const PREFIX = 'submit-queue:';

function queueKey(caseRef: string): string {
  return `${PREFIX}${caseRef}`;
}

// One Submit action per round; the scope names the round, so round 2 never reuses round 1's key.
function submitScope(inspectionRef: string): string {
  return `submit:${inspectionRef}`;
}

function isQueued(value: unknown): value is QueuedSubmit {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.inspectionRef === 'string' && typeof candidate.state === 'string';
}

const listeners = new Set<() => void>();

function write(record: QueuedSubmit | null, caseRef: string): void {
  if (record === null) draftStore.remove(queueKey(caseRef));
  else writeJson(draftStore, queueKey(caseRef), record);
  for (const listener of listeners) listener();
}

export function subscribeToSubmitQueue(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function readQueuedSubmit(caseRef: string): QueuedSubmit | null {
  return readJson(draftStore, queueKey(caseRef), isQueued);
}

// The stored record as its raw string, for `useSyncExternalStore`.
export function submitQueueSnapshot(caseRef: string): string {
  return draftStore.getString(queueKey(caseRef)) ?? '';
}

export function queuedSubmitFrom(snapshot: string): QueuedSubmit | null {
  if (snapshot === '') return null;
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return isQueued(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Every case with a submit held on this device.
export function queuedSubmitCases(): string[] {
  return draftStore
    .getAllKeys()
    .filter((key) => key.startsWith(PREFIX))
    .map((key) => key.slice(PREFIX.length));
}

// The stored refusal as the error the screens explain.
export function refusalError(record: QueuedSubmit | null): AdaApiError | null {
  const refusal = record?.refusal ?? null;
  if (refusal === null) return null;
  return new AdaApiError(refusal.status, {
    code: refusal.code,
    message: refusal.message,
    field: refusal.field,
    allowed: refusal.allowed === null ? null : [...refusal.allowed],
    request_id: refusal.requestId,
  });
}

/*
 * Records the Submit tap. The key is minted here, at the tap, and kept; a second
 * tap while one is held changes nothing.
 */
export function queueSubmit(caseRef: string, inspectionRef: string): QueuedSubmit {
  idempotencyKeyFor(submitScope(inspectionRef));
  const existing = readQueuedSubmit(caseRef);
  if (existing !== null && existing.inspectionRef === inspectionRef && existing.state === 'queued') return existing;
  const record: QueuedSubmit = {
    caseRef,
    inspectionRef,
    queuedAt: new Date().toISOString(),
    state: 'queued',
    lastTriedAt: null,
    refusal: null,
  };
  write(record, caseRef);
  return record;
}

// Drops a refused submit so the surveyor can fix the answers and send again.
export function clearRefusedSubmit(caseRef: string): void {
  const record = readQueuedSubmit(caseRef);
  if (record?.state === 'refused') write(null, caseRef);
}

// True when the office refused because the round is no longer this surveyor's; no fix on the phone can send it.
export function isRoundGone(record: QueuedSubmit | null): boolean {
  if (record?.state !== 'refused' || record.refusal === null) return false;
  const { status, code } = record.refusal;
  return status === 403 || status === 404 || status === 409 || isNotAllowedCode(code);
}

// On a confirmed "Remove": drops a refused submit with its round's answers and arrival; photos follow captures.ts rules.
export function discardRefusedSubmit(caseRef: string): boolean {
  const record = readQueuedSubmit(caseRef);
  if (record?.state !== 'refused') return false;
  releaseIdempotencyKey(submitScope(record.inspectionRef));
  clearFindings(caseRef, record.inspectionRef);
  if (readCheckIn(caseRef, record.inspectionRef) !== null) discardCheckIn(caseRef);
  forgetRound(caseRef, record.inspectionRef);
  clearRefusedSubmit(caseRef);
  return true;
}

// On a confirmed sign-out: held submits go; a taken-back round loses its answers, any other is submitted again later.
export function forgetSubmitsOnSignOut(): void {
  for (const caseRef of queuedSubmitCases()) {
    const record = readQueuedSubmit(caseRef);
    if (record !== null && isRoundGone(record)) discardRefusedSubmit(caseRef);
    else write(null, caseRef);
  }
}

// The round's captures on this phone, including any not yet bound to a round.
function roundCaptures(caseRef: string, inspectionRef: string): CaptureRecord[] {
  return capturesForCase(caseRef).filter((record) => {
    const bound = record.inspectionRef ?? null;
    return bound === null || bound === inspectionRef;
  });
}

// True while the check-in or a photograph for the round is still on its way by itself.
function evidenceInFlight(caseRef: string, inspectionRef: string): boolean {
  if (readCheckIn(caseRef, inspectionRef)?.state === 'held') return true;
  return roundCaptures(caseRef, inspectionRef).some(isInFlight);
}

// Photographs that will never go without the surveyor; the submit waits for them, and says so.
function evidenceStuck(caseRef: string, inspectionRef: string): SubmitOutcome | null {
  let retake = 0;
  let retry = 0;
  for (const record of roundCaptures(caseRef, inspectionRef)) {
    const reason = stuckReason(record);
    if (reason === 'retake') retake += 1;
    else if (reason === 'retry') retry += 1;
  }
  return retake + retry > 0 ? { kind: 'evidenceStuck', retake, retry } : null;
}

// A thrown send, classified: held for later, or refused with the server's reasons.
function classify(error: unknown, record: QueuedSubmit): SubmitOutcome {
  if (error instanceof AdaApiError) {
    if (error.isOffline) return { kind: 'offline' };
    if (error.status >= 500 || error.status === 408 || error.status === 429) return { kind: 'serverBusy' };
    write(
      {
        ...record,
        state: 'refused',
        refusal: {
          status: error.status,
          code: error.code,
          message: error.message,
          field: error.field,
          allowed: error.allowed,
          requestId: error.requestId,
        },
      },
      record.caseRef,
    );
    return { kind: 'refused', error };
  }
  if (error instanceof FindingsInvalid) {
    const field = Object.keys(error.errors)[0] ?? null;
    const local = new AdaApiError(422, {
      code: 'missing_payload',
      message: 'answers incomplete on the device',
      field: field === 'area_sqft' ? 'measured_area_sqm' : field,
      allowed: Object.keys(error.errors).map((name) => (name === 'area_sqft' ? 'measured_area_sqm' : name)),
    });
    return classify(local, record);
  }
  return { kind: 'serverBusy' };
}

const inFlight = new Set<string>();

/*
 * Sends a held submit if it can go now. Safe to call as often as a screen likes:
 * one drain per case at a time, and every step is a replay-safe call.
 */
export async function drainSubmit(caseRef: string): Promise<SubmitOutcome> {
  const record = readQueuedSubmit(caseRef);
  if (record === null) return { kind: 'none' };
  if (record.state === 'refused') {
    const error = refusalError(record);
    return error === null ? { kind: 'none' } : { kind: 'refused', error };
  }
  if (inFlight.has(caseRef)) return { kind: 'uploading' };
  inFlight.add(caseRef);
  try {
    const network = await Network.getNetworkStateAsync().catch(() => null);
    if (network !== null && network.isConnected === false) return { kind: 'offline' };

    write({ ...record, lastTriedAt: new Date().toISOString() }, caseRef);
    await syncRound(caseRef);
    const stuck = evidenceStuck(caseRef, record.inspectionRef);
    if (stuck !== null) return stuck;
    if (evidenceInFlight(caseRef, record.inspectionRef)) {
      const after = await Network.getNetworkStateAsync().catch(() => null);
      return after !== null && after.isConnected === false ? { kind: 'offline' } : { kind: 'uploading' };
    }

    try {
      if (hasUnsentFindings(caseRef, record.inspectionRef)) await sendFindings(caseRef, record.inspectionRef, 'review');
      const scope = submitScope(record.inspectionRef);
      const detail = await postSubmit(record.inspectionRef, idempotencyKeyFor(scope));
      // Only after the server has answered are the key, the draft and the check-in released.
      releaseIdempotencyKey(scope);
      clearFindings(caseRef, record.inspectionRef);
      clearCheckIn(caseRef);
      rememberRoundDetail(caseRef, detail);
      rememberStep(caseRef, 'done');
      write(null, caseRef);
      return { kind: 'sent', detail };
    } catch (error) {
      return classify(error, readQueuedSubmit(caseRef) ?? record);
    }
  } finally {
    inFlight.delete(caseRef);
  }
}

// Sends every held submit on the device; for an app-level network listener.
export async function drainAllSubmits(): Promise<number> {
  let sent = 0;
  for (const caseRef of queuedSubmitCases()) {
    const outcome = await drainSubmit(caseRef).catch(() => null);
    if (outcome?.kind === 'sent') sent += 1;
  }
  return sent;
}
