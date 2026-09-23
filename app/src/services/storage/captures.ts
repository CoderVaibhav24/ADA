import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

import { currentAppConfig } from '@/services/config/app-config';
import { evidenceStore, readJson, writeJson } from '@/services/storage/kv';

/*
 * Captured evidence on the device: bytes on the filesystem, metadata in this
 * index. Never the other way round (Architecture.md §3, code-standards.md rule 9).
 *
 * The five fields in `GeoStamp` are what make a photograph evidence rather than a
 * picture. A capture missing any of them, or carrying a fix worse than the served
 * threshold, is refused here — before it can reach a screen, a queue or a server
 * (code-standards.md rule 5).
 *
 * This store is append-only once anything may have reached the server. The one
 * removal is `discardCapture`, for a capture that provably never left the device
 * (never attempted) or that the server refused outright — there is no delete for
 * an uploaded record, or for one whose upload outcome is unknown: the case may be
 * litigated.
 */
export type CaptureSource = 'camera' | 'gallery';
export type CaptureKind = 'photo' | 'video';
export type CaptureState = 'pending' | 'uploading' | 'uploaded' | 'failed';

export type GeoStamp = {
  readonly latitude: number;
  readonly longitude: number;
  readonly accuracyM: number;
  /** The handset's clock at the moment of capture, ISO 8601. */
  readonly deviceTimestamp: string;
  readonly captureSource: CaptureSource;
};

export type CaptureRecord = {
  readonly id: string;
  readonly caseRef: string;
  readonly kind: CaptureKind;
  readonly fileUri: string;
  readonly mimeType: string;
  readonly byteSize: number;
  readonly geo: GeoStamp;
  /** Minted when the surveyor pressed the shutter, not when the upload starts. */
  readonly idempotencyKey: string;
  readonly state: CaptureState;
  readonly attempts: number;
  readonly nextAttemptAt: string | null;
  readonly lastError: string | null;
  readonly createdAt: string;
  readonly uploadedAt: string | null;
  readonly serverEvidenceId: string | null;
  /**
   * The round this capture belongs to. Null while the round is not yet known on the
   * device (captured offline before the round opened); bound by `bindCapturesToRound`.
   * Absent on records written before rounds were tracked, which reads as null.
   */
  readonly inspectionRef?: string | null;
  /** True when the server answered 4xx: nothing was stored, so the capture may be removed. */
  readonly refusedByServer?: boolean;
  /** The server's `geotag_flagged` on the stored evidence row. Null until uploaded. */
  readonly geotagFlagged?: boolean | null;
};

export type CaptureRejectionReason =
  | 'no_location'
  | 'poor_accuracy'
  | 'no_timestamp'
  | 'gallery_not_allowed'
  | 'file_missing';

/** A capture that cannot become evidence, with a message that says what to do next. */
export class CaptureRejected extends Error {
  readonly reason: CaptureRejectionReason;

  constructor(reason: CaptureRejectionReason, message: string) {
    super(message);
    this.name = 'CaptureRejected';
    this.reason = reason;
  }
}

export type NewCapture = {
  readonly caseRef: string;
  readonly kind: CaptureKind;
  /** Where the camera wrote the file. It is moved into the app's own directory. */
  readonly sourceUri: string;
  readonly mimeType: string;
  readonly geo: GeoStamp;
  readonly idempotencyKey: string;
  /** The round, when the device already knows it. */
  readonly inspectionRef?: string | null;
  /**
   * Gallery images are not field captures. Only a workflow that explicitly permits
   * one may pass this, and the record is marked `captureSource: 'gallery'` forever.
   */
  readonly allowGallery?: boolean;
};

const INDEX_KEY = 'captures:index';

// The directory captures live in, created on first use.
function capturesDirectory(): Directory {
  const directory = new Directory(Paths.document, 'captures');
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

function isRecordArray(value: unknown): value is CaptureRecord[] {
  return Array.isArray(value);
}

// The whole index. Small enough to rewrite on every change; a day is tens of rows.
function readIndex(): CaptureRecord[] {
  return readJson(evidenceStore, INDEX_KEY, isRecordArray) ?? [];
}

const listeners = new Set<() => void>();

function writeIndex(records: CaptureRecord[]): void {
  writeJson(evidenceStore, INDEX_KEY, records);
  for (const listener of listeners) listener();
}

// Subscribes to any change in the index. The write lands before the listener runs.
export function subscribeToCaptures(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Refuses a capture that cannot be evidence. Called before anything touches the filesystem.
function assertEvidenceGrade(input: NewCapture): void {
  const { geo } = input;
  const gate = currentAppConfig().gpsAccuracyGateM;

  if (!Number.isFinite(geo.latitude) || !Number.isFinite(geo.longitude)) {
    throw new CaptureRejected(
      'no_location',
      'This capture has no location fix. Move to an open area, wait for the ' +
        'coordinates to appear, and take it again.',
    );
  }
  if (!Number.isFinite(geo.accuracyM) || geo.accuracyM > gate) {
    throw new CaptureRejected(
      'poor_accuracy',
      `The location is accurate to ${Math.round(geo.accuracyM)} m and this ` +
        `inspection needs ${gate} m or better. Move away from walls and ` +
        'trees, wait for the reading to improve, and take it again.',
    );
  }
  if (geo.deviceTimestamp === '' || Number.isNaN(Date.parse(geo.deviceTimestamp))) {
    throw new CaptureRejected(
      'no_timestamp',
      'This capture has no valid time. Check the handset clock is set ' +
        'automatically, then take it again.',
    );
  }
  if (geo.captureSource === 'gallery' && input.allowGallery !== true) {
    throw new CaptureRejected(
      'gallery_not_allowed',
      'A picture chosen from the gallery is not a field capture. Use the camera.',
    );
  }
}

/*
 * Downscales a photo to `photoMaxEdgePx` at `photoJpegQuality` and writes the
 * result over `destination`, deleting the full-size original (code-standards.md
 * §7). Never upscales: an image already at or under the limit is moved as-is. A
 * manipulation failure falls back to the original bytes — a capture is never lost.
 */
async function downscalePhotoInto(source: File, destination: File): Promise<void> {
  const { photoMaxEdgePx, photoJpegQuality } = currentAppConfig();
  try {
    const context = ImageManipulator.manipulate(source.uri);
    const original = await context.renderAsync();
    if (Math.max(original.width, original.height) <= photoMaxEdgePx) {
      await source.move(destination);
      return;
    }
    const longEdge =
      original.width >= original.height ? { width: photoMaxEdgePx } : { height: photoMaxEdgePx };
    const resized = await context.reset().resize(longEdge).renderAsync();
    const saved = await resized.saveAsync({ compress: photoJpegQuality, format: SaveFormat.JPEG });
    await new File(saved.uri).move(destination);
    if (source.exists) source.delete();
  } catch (cause) {
    console.warn('[captures] downscale failed, keeping the original capture', cause);
    if (!destination.exists && source.exists) {
      await source.move(destination);
    }
  }
}

/*
 * Validates a capture, moves its bytes into the app's own directory and records
 * it. The move matters: a camera's temporary file is deleted by the OS, and a
 * record pointing at a deleted file is evidence that no longer exists.
 */
export async function saveCapture(input: NewCapture): Promise<CaptureRecord> {
  assertEvidenceGrade(input);

  const source = new File(input.sourceUri);
  if (!source.exists) {
    throw new CaptureRejected(
      'file_missing',
      'The photograph was not written to storage. Check the device has free ' +
        'space and take it again.',
    );
  }

  const extension = source.extension !== '' ? source.extension : '.jpg';
  const destination = new File(capturesDirectory(), `${input.idempotencyKey}${extension}`);
  if (!destination.exists) {
    if (input.kind === 'photo') {
      await downscalePhotoInto(source, destination);
    } else {
      await source.move(destination);
    }
  }

  const info = destination.info();
  const record: CaptureRecord = {
    id: input.idempotencyKey,
    caseRef: input.caseRef,
    kind: input.kind,
    fileUri: destination.uri,
    mimeType: input.mimeType,
    byteSize: info.exists ? (info.size ?? 0) : 0,
    geo: input.geo,
    idempotencyKey: input.idempotencyKey,
    state: 'pending',
    attempts: 0,
    nextAttemptAt: new Date().toISOString(),
    lastError: null,
    createdAt: new Date().toISOString(),
    uploadedAt: null,
    serverEvidenceId: null,
    inspectionRef: input.inspectionRef ?? null,
    refusedByServer: false,
    geotagFlagged: null,
  };

  const index = readIndex();
  const existing = index.findIndex((row) => row.id === record.id);
  if (existing >= 0) {
    // A replayed save of the same action is the same capture, not a second one.
    return index[existing];
  }
  writeIndex([...index, record]);
  return record;
}

// Every capture held for a case, oldest first — the order they were taken in.
export function capturesForCase(caseRef: string): CaptureRecord[] {
  return readIndex()
    .filter((record) => record.caseRef === caseRef)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

// Captures that still owe the server bytes, due now or overdue.
export function dueCaptures(now: Date = new Date()): CaptureRecord[] {
  return readIndex().filter(
    (record) =>
      (record.state === 'pending' || record.state === 'failed') &&
      record.nextAttemptAt !== null &&
      Date.parse(record.nextAttemptAt) <= now.getTime(),
  );
}

// Captures that failed past the attempt ceiling. The sync banner reads this.
export function stuckCaptures(): CaptureRecord[] {
  const { uploadMaxAttempts } = currentAppConfig();
  return readIndex().filter(
    (record) => record.state === 'failed' && record.attempts >= uploadMaxAttempts,
  );
}

// Replaces one record. The only way state changes; every change is written before the UI sees it.
export function updateCapture(id: string, patch: Partial<CaptureRecord>): CaptureRecord | null {
  const index = readIndex();
  const position = index.findIndex((record) => record.id === id);
  if (position < 0) return null;

  const updated: CaptureRecord = { ...index[position], ...patch, id: index[position].id };
  const next = [...index];
  next[position] = updated;
  writeIndex(next);
  return updated;
}

// Binds a case's unbound captures to the round the server has now named.
export function bindCapturesToRound(caseRef: string, inspectionRef: string): void {
  const index = readIndex();
  let changed = false;
  const next = index.map((record) => {
    if (record.caseRef !== caseRef || (record.inspectionRef ?? null) !== null) return record;
    changed = true;
    return { ...record, inspectionRef };
  });
  if (changed) writeIndex(next);
}

// True only when the server cannot hold this capture: never attempted, or refused outright.
export function isRemovable(record: CaptureRecord): boolean {
  if (record.state === 'pending' && record.attempts === 0) return true;
  return record.state === 'failed' && record.refusedByServer === true;
}

/*
 * Removes a capture the server never stored, bytes and record both. Anything that
 * may have landed — uploading, uploaded, or failed with an unknown outcome — is
 * refused, because a record the server holds must stay traceable to its file.
 */
export function discardCapture(id: string): boolean {
  const index = readIndex();
  const record = index.find((row) => row.id === id);
  if (record === undefined || !isRemovable(record)) return false;

  const file = new File(record.fileUri);
  if (file.exists) file.delete();
  writeIndex(index.filter((row) => row.id !== id));
  return true;
}

/*
 * A record left `uploading` by a killed process goes back to `pending`. Only the
 * drain calls this, and only when no drain is running, so nothing live is reset;
 * the key is unchanged, so if the bytes did land the retry is answered as a replay.
 */
export function recoverInterruptedUploads(): void {
  const index = readIndex();
  if (!index.some((record) => record.state === 'uploading')) return;
  writeIndex(
    index.map((record) =>
      record.state === 'uploading'
        ? { ...record, state: 'pending', nextAttemptAt: new Date().toISOString() }
        : record,
    ),
  );
}

// The index as its raw string: stable by value, so React can subscribe to it.
export function capturesSnapshot(): string {
  return evidenceStore.getString(INDEX_KEY) ?? '';
}

// One round's captures from a snapshot taken by `capturesSnapshot`, oldest first.
export function roundCapturesIn(
  snapshot: string,
  caseRef: string,
  inspectionRef: string | null,
): CaptureRecord[] {
  let records: CaptureRecord[] = [];
  try {
    const parsed: unknown = snapshot === '' ? [] : JSON.parse(snapshot);
    records = isRecordArray(parsed) ? parsed : [];
  } catch {
    records = [];
  }
  return records
    .filter((record) => record.caseRef === caseRef)
    .filter((record) => {
      const bound = record.inspectionRef ?? null;
      return bound === null || bound === inspectionRef;
    })
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
