import { newIdempotencyKey } from '@/services/api/idempotency';
import { retryCapture } from '@/services/api/uploads';
import {
  discardCapture,
  releaseHeldCaptures,
  saveCapture,
  type CaptureRecord,
} from '@/services/storage/captures';

import { syncRound } from './sync';

/*
 * Step 2: a photograph becomes evidence here.
 *
 * The five capture fields are attached at the shutter press — the position the
 * camera screen judged usable, the handset clock at the press, and `camera` as
 * the source — and the key is minted with them. `saveCapture` refuses anything
 * that is not evidence-grade before a byte is moved. Upload starts at once and,
 * without signal, waits on disk (`services/api/uploads.ts`).
 */
export type ShutterFix = {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyM: number;
};

// Records one camera capture with its geo stamp and starts sending it.
export async function recordPhoto(input: {
  readonly caseRef: string;
  readonly inspectionRef: string | null;
  readonly uri: string;
  readonly fix: ShutterFix;
  /** The handset clock at the shutter press. */
  readonly pressedAt: Date;
  /** True while the surveyor may still retake it in the camera; sent on `releasePhotos`. */
  readonly held?: boolean;
}): Promise<CaptureRecord> {
  const record = await saveCapture({
    caseRef: input.caseRef,
    inspectionRef: input.inspectionRef,
    kind: 'photo',
    sourceUri: input.uri,
    mimeType: 'image/jpeg',
    geo: {
      latitude: input.fix.latitude,
      longitude: input.fix.longitude,
      accuracyM: input.fix.accuracyM,
      deviceTimestamp: input.pressedAt.toISOString(),
      captureSource: 'camera',
    },
    idempotencyKey: newIdempotencyKey(),
    held: input.held === true,
  });
  if (input.held !== true) void syncRound(input.caseRef);
  return record;
}

// Sends every photo the surveyor kept in the camera for this case.
export function releasePhotos(caseRef: string): void {
  if (releaseHeldCaptures(caseRef)) void syncRound(caseRef);
}

// Removes a photograph the server never stored. False when it may have been stored.
export function removePhoto(record: CaptureRecord): boolean {
  return discardCapture(record.id);
}

// Sends a failed photograph again now, on the surveyor's tap, under its original key.
export function retryPhoto(record: CaptureRecord): void {
  retryCapture(record);
  void syncRound(record.caseRef);
}
