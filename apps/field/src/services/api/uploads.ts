import { File, UploadType } from 'expo-file-system';
import * as Network from 'expo-network';

import { getAccessToken, refreshSession } from '@/services/auth/session';
import { currentAppConfig } from '@/services/config/app-config';
import { env } from '@/services/config/env';
import { TIMEOUT_MS, withTimeoutSignal } from '@/services/net/fetch-with-timeout';
import {
  dueCaptures,
  recoverInterruptedUploads,
  updateCapture,
  type CaptureRecord,
} from '@/services/storage/captures';

import { isErrorEnvelope } from './errors';
import { IDEMPOTENCY_HEADER } from './idempotency';

/*
 * The one background writer in this build.
 *
 * There is no offline write queue here (progress-tracker.md §6, 2026-09-22):
 * findings and submissions go straight to the API. Captures are the exception,
 * and the reason is that a photograph cannot be redone later. The surveyor is a
 * kilometre away by the time the upload fails, the parcel looks different
 * tomorrow, and the case may be litigated on that image. So bytes land on the
 * filesystem first, and this drains them whenever the network allows.
 *
 * Properties that make a retry safe:
 *   - the idempotency key was minted at the shutter press and never changes, so
 *     the server folds a replay onto the record the first attempt created;
 *   - the next attempt time is persisted, not held in memory, so a process death
 *     does not reset the schedule;
 *   - nothing is deleted. A capture past the attempt ceiling stays `failed` and
 *     visible, with its error (code-standards.md rules 4 and 6).
 *
 * The endpoint is `POST /api/icms/inspections/{ref}/evidence`
 * (`services/api/app/routers/icms_inspections.py`, `add_evidence`): one flat
 * multipart form, `file` plus the `EvidenceCreate` fields. A replayed key is
 * answered 200 with the row the first attempt wrote — never 409. A 409 here is
 * `idempotency_key_reused`, a key belonging to another round, and is a real error.
 */
const EVIDENCE_PATH = (inspectionRef: string): string =>
  `/api/icms/inspections/${encodeURIComponent(inspectionRef)}/evidence`;

export type UploadOutcome = 'uploaded' | 'retry_scheduled' | 'refused' | 'offline' | 'no_work';

// Exponential backoff with a ceiling, computed from the attempt count on disk.
function nextAttemptAt(attempts: number): string {
  const { uploadBackoffBaseMs, uploadBackoffCeilingMs } = currentAppConfig();
  const delay = Math.min(uploadBackoffBaseMs * 2 ** attempts, uploadBackoffCeilingMs);
  return new Date(Date.now() + delay).toISOString();
}

// The non-file half of the multipart body, as `EvidenceCreate` expects it.
function evidenceFields(record: CaptureRecord): Record<string, string> {
  return {
    kind: record.kind,
    latitude: String(record.geo.latitude),
    longitude: String(record.geo.longitude),
    accuracy_m: String(record.geo.accuracyM),
    device_timestamp: record.geo.deviceTimestamp,
    capture_source: record.geo.captureSource,
    idempotency_key: record.idempotencyKey,
  };
}

/*
 * Uploads one capture. The round comes from the record when it was bound at
 * capture time, otherwise from the caller: a capture taken before the round was
 * known on the device still has to be kept, and is sent once it is.
 */
export async function uploadCapture(
  record: CaptureRecord,
  inspectionRef: string,
): Promise<UploadOutcome> {
  const file = new File(record.fileUri);
  if (!file.exists) {
    updateCapture(record.id, {
      state: 'failed',
      lastError: 'The file is no longer on the device.',
      nextAttemptAt: null,
    });
    return 'retry_scheduled';
  }

  const target = record.inspectionRef ?? inspectionRef;
  updateCapture(record.id, { state: 'uploading', inspectionRef: target });

  try {
    let result = await send(file, record, target);
    // One refresh and one replay, as the JSON client does. Same key, so no duplicate.
    if (result !== null && result.status === 401 && (await refreshSession()) === 'refreshed') {
      result = await send(file, record, target);
    }
    if (result === null) {
      updateCapture(record.id, { state: 'pending' });
      return 'offline';
    }

    if (result.status >= 200 && result.status < 300) {
      const stored = parseEvidence(result.body);
      updateCapture(record.id, {
        state: 'uploaded',
        uploadedAt: new Date().toISOString(),
        lastError: null,
        nextAttemptAt: null,
        refusedByServer: false,
        serverEvidenceId: stored === null ? null : String(stored.id),
        geotagFlagged: stored?.geotagFlagged ?? null,
      });
      return 'uploaded';
    }

    /*
     * A 4xx other than 401/408/429 is the server's considered refusal: nothing was
     * stored, and sending the same bytes again gets the same answer. It stays
     * `failed` with the server's own message and is not retried on a timer.
     */
    const refused =
      result.status >= 400 &&
      result.status < 500 &&
      result.status !== 401 &&
      result.status !== 408 &&
      result.status !== 429;
    const attempts = record.attempts + 1;
    updateCapture(record.id, {
      state: 'failed',
      attempts,
      refusedByServer: refused,
      lastError: errorMessage(result.status, result.body),
      nextAttemptAt:
        refused || attempts >= currentAppConfig().uploadMaxAttempts ? null : nextAttemptAt(attempts),
    });
    return refused ? 'refused' : 'retry_scheduled';
  } catch (cause) {
    const attempts = record.attempts + 1;
    updateCapture(record.id, {
      state: 'failed',
      attempts,
      refusedByServer: false,
      lastError: cause instanceof Error ? cause.message : 'The upload failed.',
      nextAttemptAt:
        attempts >= currentAppConfig().uploadMaxAttempts ? null : nextAttemptAt(attempts),
    });
    return 'retry_scheduled';
  }
}

// One multipart POST; null when there is no token to send it with.
async function send(file: File, record: CaptureRecord, inspectionRef: string) {
  const token = await getAccessToken();
  if (token === null) return null;
  // A photo is large and the field connection is often poor: 120s, not the API's 20s default.
  const { signal, clear } = withTimeoutSignal(TIMEOUT_MS.evidenceUpload);
  try {
    return await file.upload(`${env.apiBaseUrl}${EVIDENCE_PATH(inspectionRef)}`, {
      httpMethod: 'POST',
      uploadType: UploadType.MULTIPART,
      fieldName: 'file',
      mimeType: record.mimeType,
      parameters: evidenceFields(record),
      headers: {
        Authorization: `Bearer ${token}`,
        [IDEMPOTENCY_HEADER]: record.idempotencyKey,
      },
      // iOS continues the transfer while the app is backgrounded.
      sessionType: 'background',
      signal,
    });
  } finally {
    clear();
  }
}

// The two fields of `EvidenceOut` this device keeps: the row id and the geotag flag.
function parseEvidence(body: string): { id: number; geotagFlagged: boolean } | null {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed === null || typeof parsed !== 'object') return null;
    const row = parsed as { id?: unknown; geotag_flagged?: unknown };
    if (typeof row.id !== 'number') return null;
    return { id: row.id, geotagFlagged: row.geotag_flagged === true };
  } catch {
    return null;
  }
}

// The server's own message from the `/api/icms/*` envelope, with its code for support.
function errorMessage(status: number, body: string): string {
  try {
    const parsed: unknown = JSON.parse(body);
    if (isErrorEnvelope(parsed)) return `${parsed.error.message} (${parsed.error.code})`;
  } catch {
    // Not JSON: a proxy page. Fall through to the status line.
  }
  return `The server answered ${status}.`;
}

// Moves a failed capture back to the front of the queue, on the surveyor's say-so.
export function retryCapture(record: CaptureRecord): void {
  if (record.state !== 'failed') return;
  updateCapture(record.id, {
    state: 'pending',
    refusedByServer: false,
    nextAttemptAt: new Date().toISOString(),
  });
}

let draining = false;

/*
 * Drains everything due, one at a time, in the order it was captured.
 *
 * Serial on purpose: a field connection that carries one 300 KB photograph will
 * not carry four, and four parallel failures burn four attempts instead of one.
 */
export async function drainCaptures(
  inspectionRefFor: (caseRef: string) => string | null,
): Promise<UploadOutcome> {
  if (draining) return 'no_work';
  // Claimed before the first await, so two callers cannot both start a drain.
  draining = true;
  try {
    const state = await Network.getNetworkStateAsync().catch(() => null);
    if (state !== null && state.isConnected === false) return 'offline';

    recoverInterruptedUploads();
    const due = dueCaptures();
    if (due.length === 0) return 'no_work';

    for (const record of due) {
      const inspectionRef = record.inspectionRef ?? inspectionRefFor(record.caseRef);
      // A capture whose round has not been opened yet waits; it is not an error.
      if (inspectionRef === null) continue;
      const outcome = await uploadCapture(record, inspectionRef);
      if (outcome === 'offline') return 'offline';
    }
    return 'uploaded';
  } finally {
    draining = false;
  }
}
