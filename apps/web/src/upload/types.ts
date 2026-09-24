// Hand-written upload and runtime API shapes; swap for @ada/api-types once regenerated (one import).

export type UploadId = string | number;

/** Every state a raster row can be in; the first three are the pre-upload ones. */
export type RasterLifecycleStatus =
  | "processing"
  | "ready"
  | "failed"
  | "uploading"
  | "rejected"
  | "failed_retryable"
  | "cold"
  | "restoring"
  | "expired";

/** Fields RasterOut gained with the upload and storage work; all optional until every row has them. */
export interface RasterLifecycleFields {
  size_bytes?: number | null;
  fingerprint?: string | null;
  sha256?: string | null;
  tier?: RuntimeTier | null;
  last_used_at?: string | null;
  cold_at?: string | null;
  restore_eta_hours?: number | null;
  reject_reason?: string | null;
  archive_bytes?: number | null;
  chunk_count?: number | null;
  received_count?: number | null;
}

/** POST /projects/{project_id}/uploads */
export interface OpenUploadRequest {
  name: string;
  size_bytes: number;
  fingerprint: string;
  captured_at?: string | null;
  crs_epsg?: number | null;
  has_tfw: boolean;
  has_prj: boolean;
}

/** "completing" while a 202'd complete is still hashing and validating. */
export type UploadSessionStatus = RasterLifecycleStatus | "completing";

/** 201 from POST /projects/{id}/uploads, and GET /uploads/{id}. */
export interface UploadSession {
  upload_id: UploadId;
  chunk_size: number;
  chunk_count: number;
  received: number[];
  status: UploadSessionStatus;
  size_bytes?: number;
}

/** One entry of GET /projects/{id}/uploads. */
export interface OpenUpload extends UploadSession {
  name: string;
  /** Null when the server has none; it can then never match a picked file. */
  fingerprint: string | null;
  size_bytes: number;
}

/** 409 body from POST /projects/{id}/uploads. */
export interface DuplicateUploadBody {
  detail: string;
  existing_raster_id: UploadId;
}

/** 422 body from POST /uploads/{id}/complete. */
export interface RejectedUploadBody {
  detail: string;
  raster_id: UploadId;
}

/** 202 from POST /rasters/{id}/restore. */
export interface RestoreResponse {
  status: "restoring";
  eta_hours: number;
}

export type RuntimeTier = "cuda" | "metal" | "cpu";

/** GET /api/ml/runtime: ml-worker's /health/ready proxied by ada-api. */
export interface MlRuntime {
  backend: "CUDA" | "Metal" | "CPU" | string;
  device_name: string | null;
  tier: RuntimeTier;
  fp16: boolean;
  ort_provider: string | null;
  gpu_budget_gb: number | null;
  disk_free_gb: number | null;
  queue_depth: number;
  /** Seconds per megapixel of analysis grid on this tier; absent means no ETA is shown. */
  eta_s_per_mpx?: number | null;
  /** Longest side of the analysis grid on this tier, in pixels. */
  grid_cap_px?: number | null;
  /** Seconds for a full grid at the cap; the ETA when no pair is selected. */
  eta_s_at_grid_cap?: number | null;
}

/** What the browser keeps per open session so a reload can offer to resume. */
export interface StoredSession {
  upload_id: UploadId;
  project_id: UploadId;
  fingerprint: string;
  name: string;
  size: number;
}

export interface UploadProgress {
  bytesSent: number;
  totalBytes: number;
  /** 0..100, whole number. */
  percent: number;
  /** The chunk that just landed, or null for a snapshot (open, resume). */
  chunkIndex: number | null;
  paused: boolean;
}

/** A non-2xx answer from the upload API, with its parsed body when there was one. */
export class UploadHttpError extends Error {
  readonly status: number;
  readonly body: unknown;
  readonly requestId: string | null;

  constructor(status: number, message: string, body: unknown = null, requestId: string | null = null) {
    super(message);
    this.name = "UploadHttpError";
    this.status = status;
    this.body = body;
    this.requestId = requestId;
  }
}

/** A 202'd complete never settled within the cap; the session is kept so the officer can resume later. */
export class UploadCompletionTimeoutError extends Error {
  constructor() {
    super("Completion timed out");
    this.name = "UploadCompletionTimeoutError";
  }
}

/** Thrown into every pending call once pause() runs; the server session is kept for resume. */
export class UploadPausedError extends Error {
  constructor() {
    super("Upload paused");
    this.name = "UploadPausedError";
  }
}

/** Thrown into every pending call once abort() runs. */
export class UploadAbortedError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadAbortedError";
  }
}
