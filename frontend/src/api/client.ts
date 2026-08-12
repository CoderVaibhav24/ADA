import type {
  Analysis,
  AnalysisMode,
  ChangeFeatureCollection,
  Id,
  Project,
  Raster,
  RedZone,
  ReviewStatus,
  TileInfo,
} from "./types";
import Session from "supertokens-auth-react/recipe/session";

import type { Polygon } from "geojson";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function redirectToAuth(): void {
  if (!window.location.pathname.startsWith("/auth")) {
    window.location.assign("/auth");
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: "same-origin", ...init });
  } catch {
    throw new ApiError(0, "Network error — backend unreachable");
  }

  if (res.status === 401) {
    redirectToAuth();
    throw new ApiError(401, "Session expired");
  }
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body: unknown = await res.json();
      if (body && typeof body === "object" && "detail" in body) {
        detail = JSON.stringify((body as { detail: unknown }).detail);
      }
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, `${res.status}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
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

/** Download URLs — plain links so the browser handles the file save dialog. */
export const downloadUrl = {
  reportGeojson: (jobId: Id) => `/api/analyses/${jobId}/report.geojson`,
  reportCsv: (jobId: Id) => `/api/analyses/${jobId}/report.csv`,
  feedbackDataset: (pid: Id) => `/api/projects/${pid}/feedback-dataset`,
};

export interface RasterUploadFields {
  name: string;
  capturedAt?: string;
  crsEpsg?: string;
  file: File;
  tfw?: File | null;
  prj?: File | null;
}

/** Refresh the access token, reporting whether a session survives. */
async function refreshSession(): Promise<boolean> {
  try {
    return await Session.attemptRefreshingSession();
  } catch {
    return false;
  }
}

/**
 * Multipart upload via XHR so we can report real upload progress
 * (fetch has no upload progress events).
 *
 * Wrapped by `uploadRaster`, which handles the access token, because this is
 * the one request where an expired token is expensive rather than merely
 * annoying: ADA's grid tiles run to 18 GB, and the old code answered a 401 by
 * bouncing the user to /auth — throwing away the entire transfer AND signing
 * them out, while their refresh token was still perfectly valid.
 */
function sendUpload(
  pid: Id,
  fields: RasterUploadFields,
  onProgress: (fraction: number) => void,
): Promise<Raster> {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append("name", fields.name);
    if (fields.capturedAt) fd.append("captured_at", fields.capturedAt);
    if (fields.crsEpsg) fd.append("crs_epsg", fields.crsEpsg);
    fd.append("file", fields.file);
    if (fields.tfw) fd.append("tfw", fields.tfw);
    if (fields.prj) fd.append("prj", fields.prj);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/projects/${pid}/rasters`);
    xhr.withCredentials = true;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status === 401) {
        // Reported, not acted on — uploadRaster decides whether this is a
        // recoverable expiry or a real sign-out.
        reject(new ApiError(401, "Session expired"));
      } else if (xhr.status >= 200 && xhr.status < 300) {
        try {
          resolve(JSON.parse(xhr.responseText) as Raster);
        } catch {
          reject(new ApiError(xhr.status, "Malformed server response"));
        }
      } else {
        reject(new ApiError(xhr.status, xhr.responseText || xhr.statusText));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, "Upload failed — network error"));
    xhr.send(fd);
  });
}

export async function uploadRaster(
  pid: Id,
  fields: RasterUploadFields,
  onProgress: (fraction: number) => void,
): Promise<Raster> {
  // Refresh BEFORE the body goes out. A multi-gigabyte upload can easily run
  // past the access token's lifetime, and one cheap round trip up front beats
  // discovering it after sending every byte.
  await refreshSession();
  try {
    return await sendUpload(pid, fields, onProgress);
  } catch (err) {
    if (!(err instanceof ApiError) || err.status !== 401) throw err;
    // Raced the expiry anyway. Refresh once and re-send; only a refresh token
    // that is genuinely dead means the user has to sign in again.
    if (!(await refreshSession())) {
      redirectToAuth();
      throw err;
    }
    onProgress(0);
    return await sendUpload(pid, fields, onProgress);
  }
}
