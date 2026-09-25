import type {
  Analysis,
  AnalysisMode,
  ChangeFeatureCollection,
  Id,
  ParcelFeatureCollectionOut,
  ParcelFilters,
  ParcelResultPage,
  Project,
  Raster,
  RedZone,
  ReviewStatus,
  TileInfo,
} from "./types";
import { accessToken, notifySessionEnded, renewAccessToken } from "../auth/oidc";
import { fingerprintFile } from "../upload/fingerprint";
import { pruneSessions, removeSession } from "../upload/session-store";
import {
  UploadHttpError,
  type MlRuntime,
  type OpenUpload,
  type RestoreResponse,
  type UploadId,
  type UploadProgress,
} from "../upload/types";
import { ChunkedUpload } from "../upload/worker";

import type { Polygon } from "geojson";

export class ApiError extends Error {
  readonly status: number;
  /**
   * The `X-Request-ID` the server put on the response, when there was one.
   *
   * These older routes answer FastAPI's `{"detail": ...}`, which carries no
   * correlation id in the BODY the way the ICMS envelope does — but
   * RequestIdMiddleware puts one on the header of every response and CORS
   * exposes it. Reading it here is the difference between "it broke" and a
   * support call somebody can answer from the log.
   */
  readonly requestId: string | null;
  /** The parsed error body, for callers that need a field beyond the message (409 existing_raster_id). */
  readonly body: unknown;

  constructor(
    status: number,
    message: string,
    requestId: string | null = null,
    body: unknown = null,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestId = requestId;
    this.body = body;
  }
}

/** The correlation id, or null on a response that never reached the server. */
function requestIdOf(res: Response): string | null {
  return res.headers.get("X-Request-ID");
}

function sessionExpired(): void {
  notifySessionEnded();
}

export async function authHeader(): Promise<Record<string, string>> {
  const token = await accessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  const headers = { ...(await authHeader()), ...(init?.headers ?? {}) };
  try {
    res = await fetch(path, { ...init, headers });
  } catch {
    throw new ApiError(0, "Network error — backend unreachable");
  }

  if (res.status === 401) {
    sessionExpired();
    throw new ApiError(401, "Session expired", requestIdOf(res));
  }
  if (!res.ok) {
    let detail = res.statusText;
    let body: unknown = null;
    try {
      body = await res.json();
      if (body && typeof body === "object" && "detail" in body) {
        detail = JSON.stringify((body as { detail: unknown }).detail);
      }
    } catch {
    }
    throw new ApiError(res.status, `${res.status}: ${detail}`, requestIdOf(res), body);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// The parcel endpoints' shared filters as a query string; empty values are left out.
function parcelQuery(filters: ParcelFilters = {}): string {
  const params = new URLSearchParams();
  if (filters.change_class) params.set("change_class", filters.change_class);
  if (filters.verdict) params.set("verdict", filters.verdict);
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (filters.offset !== undefined) params.set("offset", String(filters.offset));
  const query = params.toString();
  return query ? `?${query}` : "";
}

function json(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export const api = {
  health: () => request<{ status: string }>("/api/health"),

  // ---- projects ----
  listProjects: () => request<Project[]>("/api/projects"),
  createProject: (name: string, description?: string) =>
    request<Project>("/api/projects", json({ name, description })),
  deleteProject: (id: Id) =>
    request<void>(`/api/projects/${id}`, { method: "DELETE" }),

  // ---- rasters ----
  listRasters: (pid: Id) => request<Raster[]>(`/api/projects/${pid}/rasters`),
  deleteRaster: (id: Id) =>
    request<void>(`/api/rasters/${id}`, { method: "DELETE" }),
  rasterTileInfo: (id: Id) => request<TileInfo>(`/api/tiles/raster/${id}/info`),

  // ---- red zones ----
  listRedZones: (pid: Id) =>
    request<RedZone[]>(`/api/projects/${pid}/red-zones`),
  createRedZone: (pid: Id, name: string, geometry: Polygon) =>
    request<RedZone>(`/api/projects/${pid}/red-zones`, json({ name, geometry })),
  deleteRedZone: (id: Id) =>
    request<void>(`/api/red-zones/${id}`, { method: "DELETE" }),

  // ---- analyses ----
  listAnalyses: (pid: Id) =>
    request<Analysis[]>(`/api/projects/${pid}/analyses`),
  createAnalysis: (
    pid: Id,
    raster_t1_id: Id,
    raster_t2_id: Id,
    mode: AnalysisMode = "ai",
  ) =>
    request<Analysis>(
      `/api/projects/${pid}/analyses`,
      json({ raster_t1_id, raster_t2_id, mode }),
    ),
  getAnalysis: (id: Id) => request<Analysis>(`/api/analyses/${id}`),
  getAnalysisFeatures: (id: Id) =>
    request<ChangeFeatureCollection>(`/api/analyses/${id}/features`),
  listAnalysisParcels: (id: Id, filters?: ParcelFilters, signal?: AbortSignal) =>
    request<ParcelResultPage>(`/api/analyses/${id}/parcels${parcelQuery(filters)}`, { signal }),
  getAnalysisParcelsGeojson: (id: Id, filters?: ParcelFilters, signal?: AbortSignal) =>
    request<ParcelFeatureCollectionOut>(
      `/api/analyses/${id}/parcels.geojson${parcelQuery(filters)}`,
      { signal },
    ),
  deleteAnalysis: (id: Id) =>
    request<void>(`/api/analyses/${id}`, { method: "DELETE" }),

  // ---- officer review (human-in-the-loop feedback loop) ----
  reviewPolygon: (
    jobId: Id,
    polygonId: Id,
    status: ReviewStatus,
    note?: string,
  ) =>
    request<{ id: number; review_status: ReviewStatus }>(
      `/api/analyses/${jobId}/polygons/${polygonId}/review`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status, note: note ?? null }),
      },
    ),
};

/**
 * Report paths.
 *
 * These used to be plain <a href> links, which worked because a cookie went
 * with them. A bearer token does not: the browser attaches nothing to a link,
 * so a direct href now answers 401 and the officer gets a downloaded error
 * page. Use `download()` below, which fetches with the header and hands the
 * bytes to the save dialog through a blob URL.
 */
export const downloadUrl = {
  reportGeojson: (jobId: Id) => `/api/analyses/${jobId}/report.geojson`,
  reportCsv: (jobId: Id) => `/api/analyses/${jobId}/report.csv`,
  parcelsCsv: (jobId: Id, filters?: ParcelFilters) =>
    `/api/analyses/${jobId}/parcels.csv${parcelQuery(filters)}`,
  feedbackDataset: (pid: Id) => `/api/projects/${pid}/feedback-dataset`,
};

/** Fetch an authenticated file and save it under `filename`. */
export async function download(path: string, filename: string): Promise<void> {
  const res = await fetch(path, { headers: await authHeader() });
  if (res.status === 401) {
    sessionExpired();
    throw new ApiError(401, "Session expired", requestIdOf(res));
  }
  if (!res.ok) {
    throw new ApiError(res.status, `${res.status}: ${res.statusText}`, requestIdOf(res));
  }

  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick, not immediately: Safari has not finished reading
  // the blob when click() returns, and revoking synchronously saves an empty
  // file.
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/**
 * An authenticated URL for an <img> or any other browser-issued GET.
 *
 * Returns a blob URL the caller must revoke. Used by the per-polygon preview,
 * which is an <img src> and therefore cannot carry a header.
 */
export async function objectUrl(path: string): Promise<string> {
  const res = await fetch(path, { headers: await authHeader() });
  if (!res.ok) {
    throw new ApiError(res.status, `${res.status}: ${res.statusText}`, requestIdOf(res));
  }
  return URL.createObjectURL(await res.blob());
}

export interface RasterUploadFields {
  name: string;
  capturedAt?: string;
  crsEpsg?: string;
  file: File;
  tfw?: File | null;
  prj?: File | null;
}

export interface UploadHooks {
  /** Called once the session object exists, so the caller can abort it or guard the tab. */
  onStart?: (upload: ChunkedUpload) => void;
}

/** Refresh the access token, reporting whether a session survives. */
async function refreshSession(): Promise<boolean> {
  return (await accessToken()) !== null;
}

// A chunk's 401 means the cached token was refused, so renewal must go to the issuer, not the cache.
async function forceRenewal(): Promise<boolean> {
  return (await renewAccessToken()) !== null;
}

// The worker's own errors become ApiError so every screen keeps one error type.
function toApiError(cause: unknown): unknown {
  if (!(cause instanceof UploadHttpError)) return cause;
  if (cause.status === 401) sessionExpired();
  return new ApiError(cause.status, cause.message, cause.requestId, cause.body);
}

function createUpload(
  pid: Id,
  fields: RasterUploadFields,
  fingerprint: string,
  onProgress: (fraction: number, progress: UploadProgress) => void,
): ChunkedUpload {
  const epsg = fields.crsEpsg ? Number(fields.crsEpsg) : null;
  return new ChunkedUpload({
    projectId: pid,
    file: fields.file,
    fingerprint,
    name: fields.name,
    capturedAt: fields.capturedAt ?? null,
    crsEpsg: epsg !== null && Number.isFinite(epsg) ? epsg : null,
    tfw: fields.tfw ?? null,
    prj: fields.prj ?? null,
    onProgress: (p) => onProgress(p.totalBytes > 0 ? p.bytesSent / p.totalBytes : 1, p),
    deps: { authHeader, refreshAuth: forceRenewal },
  });
}

// Refuses before any byte goes out when no token survives; gigabytes certain to be refused are the worst way to learn that.
async function requireSession(): Promise<void> {
  if (!(await refreshSession())) {
    sessionExpired();
    throw new ApiError(401, "Session expired");
  }
}

async function finish(upload: ChunkedUpload, send: () => Promise<unknown>): Promise<Raster> {
  try {
    await send();
    return await upload.complete();
  } catch (cause) {
    throw toApiError(cause);
  }
}

// Chunked, resumable upload; onProgress gets bytes received by the server as 0..1.
export async function uploadRaster(
  pid: Id,
  fields: RasterUploadFields,
  onProgress: (fraction: number, progress: UploadProgress) => void,
  hooks: UploadHooks = {},
): Promise<Raster> {
  await requireSession();
  const upload = createUpload(pid, fields, await fingerprintFile(fields.file), onProgress);
  hooks.onStart?.(upload);
  return finish(upload, () => upload.start());
}

// Continues an open session with the re-picked file; the caller has already matched its fingerprint.
export async function resumeUpload(
  pid: Id,
  open: OpenUpload,
  fields: RasterUploadFields,
  onProgress: (fraction: number, progress: UploadProgress) => void,
  hooks: UploadHooks = {},
): Promise<Raster> {
  await requireSession();
  const fingerprint = open.fingerprint ?? (await fingerprintFile(fields.file));
  const upload = createUpload(pid, { ...fields, name: open.name }, fingerprint, onProgress);
  hooks.onStart?.(upload);
  return finish(upload, () => upload.resume(open.upload_id, fields.file));
}

// The server's open sessions; local resume records the server no longer has are pruned on the way.
export async function listOpenUploads(projectId: Id): Promise<OpenUpload[]> {
  const list = await request<OpenUpload[]>(`/api/projects/${projectId}/uploads`);
  pruneSessions(projectId, list.map((u) => u.upload_id));
  return list;
}

// Deletes the server session and, when the project is known, the browser's resume record.
export async function abortUpload(uploadId: UploadId, projectId?: Id): Promise<void> {
  await request<void>(`/api/uploads/${uploadId}`, { method: "DELETE" });
  if (projectId !== undefined) removeSession(projectId, uploadId);
}

export function restoreRaster(rasterId: Id): Promise<RestoreResponse> {
  return request<RestoreResponse>(`/api/rasters/${rasterId}/restore`, { method: "POST" });
}

export function getRuntime(): Promise<MlRuntime> {
  return request<MlRuntime>("/api/ml/runtime");
}
