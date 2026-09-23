import { AdaApiError } from '@/services/api/errors';
import { idempotencyKeyFor, releaseIdempotencyKey } from '@/services/api/idempotency';
import { postCheckIn } from '@/services/api/inspections';
import type { CheckInCreate, CheckInOut } from '@/services/api/types';
import { draftStore, readJson, writeJson } from '@/services/storage/kv';

/*
 * The check-in: "this officer stood at this property at this time".
 *
 * The server is the authority on accuracy — it refuses a fix worse than its
 * threshold with `422 poor_accuracy` — and the client gates on the same number
 * (`app-config.ts`) so a refusal is the exception, not the flow.
 *
 * The key is minted when the surveyor taps Confirm Arrival and kept until the
 * server confirms, so a retry after a lost answer is folded onto the first row
 * (200) rather than recorded twice. Offline, the tap is held on the device with
 * its fix and key, stated as not yet received, and sent when the round and the
 * network are both available.
 */
export type CheckInState = 'held' | 'confirmed' | 'refused';

export type CheckInRecord = {
  readonly caseRef: string;
  /** Null when the tap happened before the round was known on the device. */
  readonly inspectionRef: string | null;
  readonly latitude: number | null;
  readonly longitude: number | null;
  readonly accuracyM: number;
  /** The fix's own time, ISO 8601. */
  readonly deviceTimestamp: string;
  /** As sent (`fused` from this device) or as the server reports it for an adopted check-in. */
  readonly captureSource: string;
  readonly idempotencyKey: string;
  readonly state: CheckInState;
  readonly confirmed: CheckInOut | null;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly recordedAt: string;
};

export type ArrivalFix = {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyM: number;
  readonly timestamp: number;
};

/*
 * `fused`, the honest value on both platforms: expo-location reads Android's
 * FusedLocationProvider and iOS Core Location, both of which blend GPS, Wi-Fi and
 * cell. Claiming `gps` would overstate what the handset reports.
 */
const CAPTURE_SOURCE: CheckInCreate['capture_source'] = 'fused';

// Storage key for one case's check-in record.
function recordKey(caseRef: string): string {
  return `check-in:${caseRef}`;
}

// Idempotency scope: one Confirm Arrival action per case until the server confirms it.
function keyScope(caseRef: string): string {
  return `check-in:${caseRef}`;
}

function isRecord(value: unknown): value is CheckInRecord {
  if (value === null || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.idempotencyKey === 'string' && typeof candidate.state === 'string';
}

const listeners = new Set<() => void>();

function write(record: CheckInRecord): CheckInRecord {
  writeJson(draftStore, recordKey(record.caseRef), record);
  for (const listener of listeners) listener();
  return record;
}

// Subscribes to changes in any check-in record.
export function subscribeToCheckIns(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Keeps a record for this round, or one taken before the round was known. Another round's is ignored.
function forRound(record: CheckInRecord | null, inspectionRef: string | null): CheckInRecord | null {
  if (record === null) return null;
  if (record.inspectionRef !== null && inspectionRef !== null && record.inspectionRef !== inspectionRef) {
    return null;
  }
  return record;
}

// The check-in for this round on this device, or null.
export function readCheckIn(caseRef: string, inspectionRef: string | null): CheckInRecord | null {
  return forRound(readJson(draftStore, recordKey(caseRef), isRecord), inspectionRef);
}

// The stored record as its raw string: stable by value, so React can subscribe to it.
export function checkInSnapshot(caseRef: string): string {
  return draftStore.getString(recordKey(caseRef)) ?? '';
}

// Parses a snapshot taken by `checkInSnapshot` for one round.
export function checkInFrom(snapshot: string, inspectionRef: string | null): CheckInRecord | null {
  if (snapshot === '') return null;
  try {
    const parsed: unknown = JSON.parse(snapshot);
    return forRound(isRecord(parsed) ? parsed : null, inspectionRef);
  } catch {
    return null;
  }
}

/*
 * Confirm Arrival. Records the tap with its fix and key first, then sends it when
 * the round is known. The caller has already gated on the client threshold.
 */
export async function confirmArrival(
  caseRef: string,
  inspectionRef: string | null,
  fix: ArrivalFix,
): Promise<CheckInRecord> {
  const record = write({
    caseRef,
    inspectionRef,
    latitude: fix.latitude,
    longitude: fix.longitude,
    accuracyM: fix.accuracyM,
    deviceTimestamp: new Date(fix.timestamp).toISOString(),
    captureSource: CAPTURE_SOURCE,
    idempotencyKey: idempotencyKeyFor(keyScope(caseRef)),
    state: 'held',
    confirmed: null,
    error: null,
    recordedAt: new Date().toISOString(),
  });
  if (inspectionRef === null) return record;
  return (await sendHeldCheckIn(caseRef, inspectionRef)) ?? record;
}

/*
 * Sends a held check-in. Confirmed: the key is released. Offline: still held.
 * Refused: the server's code and message are kept for the panel to state, and the
 * surveyor may try again with a fresh fix under the same key (nothing was stored).
 */
export async function sendHeldCheckIn(caseRef: string, inspectionRef: string): Promise<CheckInRecord | null> {
  const record = readCheckIn(caseRef, inspectionRef);
  if (record === null || record.state !== 'held') return record;
  if (record.latitude === null || record.longitude === null) return record;

  const bound = write({ ...record, inspectionRef });
  try {
    const confirmed = await postCheckIn(
      inspectionRef,
      {
        latitude: record.latitude,
        longitude: record.longitude,
        accuracy_m: bound.accuracyM,
        device_timestamp: bound.deviceTimestamp,
        capture_source: CAPTURE_SOURCE,
      },
      bound.idempotencyKey,
    );
    releaseIdempotencyKey(keyScope(caseRef));
    return write({ ...bound, state: 'confirmed', confirmed, error: null });
  } catch (error) {
    if (error instanceof AdaApiError && error.isOffline) {
      return write({ ...bound, error: { code: error.code, message: error.message } });
    }
    if (error instanceof AdaApiError) {
      // A key that belongs to another round can never succeed here; the next tap mints a new one.
      if (error.code === 'idempotency_key_reused') releaseIdempotencyKey(keyScope(caseRef));
      return write({ ...bound, state: 'refused', error: { code: error.code, message: error.message } });
    }
    throw error;
  }
}

// Records a check-in the server already holds (resume on this or another device).
export function adoptServerCheckIn(caseRef: string, confirmed: CheckInOut): CheckInRecord {
  const existing = readCheckIn(caseRef, confirmed.inspection_ref);
  if (existing?.state === 'confirmed') return existing;
  // The server already holds a check-in for this round; a held tap's key is no longer needed.
  releaseIdempotencyKey(keyScope(caseRef));
  return write({
    caseRef,
    inspectionRef: confirmed.inspection_ref,
    latitude: confirmed.lat ?? null,
    longitude: confirmed.lon ?? null,
    accuracyM: confirmed.accuracy_m,
    deviceTimestamp: confirmed.device_timestamp,
    captureSource: confirmed.capture_source,
    idempotencyKey: existing?.idempotencyKey ?? '',
    state: 'confirmed',
    confirmed,
    error: null,
    recordedAt: confirmed.server_timestamp,
  });
}

// Forgets the case's check-in once its round has been submitted.
export function clearCheckIn(caseRef: string): void {
  draftStore.remove(recordKey(caseRef));
  for (const listener of listeners) listener();
}
