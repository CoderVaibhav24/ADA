import type { Raster } from "../api/types.ts";
import { sha256Hex, type Fingerprintable } from "./fingerprint.ts";
import { removeSession, saveSession, type KeyValueStorage } from "./session-store.ts";
import {
  UploadAbortedError,
  UploadCompletionTimeoutError,
  UploadHttpError,
  UploadPausedError,
  type OpenUploadRequest,
  type UploadId,
  type UploadProgress,
  type UploadSession,
} from "./types.ts";

export const CHUNK_SHA_HEADER = "X-Chunk-SHA256";
export const COMPLETE_POLL_MS = 3000;
/** 2 h 10 min: longer than the server's worst-case hash and validate of a 64 GiB upload. */
export const COMPLETE_TIMEOUT_MS = 130 * 60 * 1000;

/** Browser online state, injectable so tests can drop and restore the link. */
export interface Connectivity {
  isOnline: () => boolean;
  onOnline: (listener: () => void) => () => void;
}

export interface UploadDeps {
  fetch: (input: string, init?: RequestInit) => Promise<Response>;
  authHeader: () => Promise<Record<string, string>>;
  /** Forces a new access token after a 401; false means the session is gone. */
  refreshAuth: () => Promise<boolean>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  random: () => number;
  connectivity: Connectivity;
  /** Null disables resume-after-reload; omitted means localStorage. */
  storage?: KeyValueStorage | null;
  baseUrl: string;
}

export type UploadFile = Fingerprintable;

export interface ChunkedUploadOptions {
  projectId: UploadId;
  file: UploadFile;
  fingerprint: string;
  name: string;
  capturedAt?: string | null;
  crsEpsg?: number | null;
  tfw?: Blob | null;
  prj?: Blob | null;
  onProgress?: (progress: UploadProgress) => void;
  concurrency?: number;
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  deps?: Partial<UploadDeps>;
}

const RETRYABLE = new Set([0, 408, 425, 429, 500, 502, 503, 504]);

// A 400 is only worth resending when the server says the chunk hash did not match (corruption in transit).
function isRetryable(error: UploadHttpError): boolean {
  return RETRYABLE.has(error.status) || (error.status === 400 && /sha-?256/i.test(error.message));
}

// A 422 is a rejection only when it names the raster; any other 422 is a plain request error.
export function isRejection(error: unknown): boolean {
  if (!(error instanceof UploadHttpError) || error.status !== 422) return false;
  const body = error.body;
  return Boolean(body && typeof body === "object" && "raster_id" in body);
}

// Navigator.onLine false means offline; anything else (including Node, where it is undefined) is online.
function browserConnectivity(): Connectivity {
  return {
    isOnline: () => typeof navigator === "undefined" || navigator.onLine !== false,
    onOnline: (listener) => {
      if (typeof window === "undefined") return () => undefined;
      window.addEventListener("online", listener);
      return () => window.removeEventListener("online", listener);
    },
  };
}

function defaultDeps(): UploadDeps {
  return {
    fetch: (input, init) => globalThis.fetch(input, init),
    authHeader: async () => ({}),
    refreshAuth: async () => false,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    random: Math.random,
    connectivity: browserConnectivity(),
    baseUrl: "/api",
  };
}

// FastAPI's {"detail": ...}: a string detail is the message, anything else is shown as JSON.
async function readError(res: Response): Promise<UploadHttpError> {
  let body: unknown = null;
  let message = res.statusText || `HTTP ${res.status}`;
  try {
    const text = await res.text();
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    message = typeof detail === "string" ? detail : JSON.stringify(detail);
  }
  return new UploadHttpError(res.status, message, body, res.headers.get("X-Request-ID"));
}

// The session GET after a 202 may carry the RasterOut itself, nested or flat; null means fetch it.
function rasterFrom(body: Record<string, unknown>): Raster | null {
  const nested = body.raster;
  if (nested && typeof nested === "object" && "id" in nested) return nested as Raster;
  if ("id" in body && "project_id" in body && "name" in body) return body as unknown as Raster;
  return null;
}

/** Chunked, resumable upload of one GeoTIFF to the upload session API. */
export class ChunkedUpload {
  private readonly opts: ChunkedUploadOptions;
  private readonly deps: UploadDeps;
  private readonly controller = new AbortController();
  private file: UploadFile;
  private current: UploadSession | null = null;
  private received = new Set<number>();
  private paused = false;
  private stopped: "paused" | "aborted" | null = null;

  constructor(options: ChunkedUploadOptions) {
    this.opts = options;
    this.file = options.file;
    this.deps = { ...defaultDeps(), ...options.deps };
  }

  get uploadId(): UploadId | null {
    return this.current?.upload_id ?? null;
  }

  get session(): UploadSession | null {
    return this.current;
  }

  // Opens the session, sends sidecars, then every chunk; complete() is a separate step.
  async start(): Promise<UploadSession> {
    const body: OpenUploadRequest = {
      name: this.opts.name,
      size_bytes: this.file.size,
      fingerprint: this.opts.fingerprint,
      captured_at: this.opts.capturedAt ?? null,
      crs_epsg: this.opts.crsEpsg ?? null,
      has_tfw: Boolean(this.opts.tfw),
      has_prj: Boolean(this.opts.prj),
    };
    const res = await this.call(`/projects/${this.opts.projectId}/uploads`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    this.adopt((await res.json()) as UploadSession);
    this.remember();
    await this.sendSidecars();
    await this.sendMissing();
    return this.current as UploadSession;
  }

  // Reads the server's bitmap for an existing session and sends only the chunks it lacks.
  async resume(uploadId: UploadId, file: UploadFile = this.file): Promise<UploadSession> {
    this.file = file;
    const res = await this.call(`/uploads/${uploadId}`, { method: "GET" });
    const session = (await res.json()) as UploadSession;
    if (session.size_bytes !== undefined && session.size_bytes !== file.size) {
      throw new UploadHttpError(409, "The picked file is not the one this upload started with.");
    }
    this.adopt(session);
    this.remember();
    await this.sendSidecars();
    await this.sendMissing();
    return this.current as UploadSession;
  }

  // Idempotent on the server, so transient failures retry; a 202 means an earlier complete is still hashing.
  async complete(sha256?: string): Promise<Raster> {
    const id = this.requireId();
    try {
      const res = await this.postComplete(id, sha256);
      const raster = res.status === 202 ? await this.awaitCompletion(id, sha256) : ((await res.json()) as Raster);
      this.forget();
      return raster;
    } catch (cause) {
      if (isRejection(cause)) this.forget();
      throw cause;
    }
  }

  // Stops sending but keeps the server session and the local record, so the banner can offer resume.
  pause(): void {
    if (this.stopped) return;
    this.stopped = "paused";
    this.controller.abort();
  }

  // Stops every chunk, deletes the server session and forgets it locally.
  async abort(): Promise<void> {
    if (this.stopped === "aborted") return;
    this.stopped = "aborted";
    this.controller.abort();
    const id = this.uploadId;
    this.forget();
    if (id === null) return;
    try {
      await this.deps.fetch(`${this.deps.baseUrl}/uploads/${id}`, {
        method: "DELETE",
        headers: await this.deps.authHeader(),
      });
    } catch {
      return;
    }
  }

  private postComplete(id: UploadId, sha256?: string): Promise<Response> {
    return this.callRetrying(`/uploads/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sha256 ? { sha256 } : {}),
    });
  }

  // Polls a 202'd complete; "uploading" means the winning complete died, so it is re-sent; capped at 2 h 10 min.
  private async awaitCompletion(id: UploadId, sha256?: string): Promise<Raster> {
    const deadline = this.deps.now() + COMPLETE_TIMEOUT_MS;
    for (;;) {
      if (this.deps.now() >= deadline) throw new UploadCompletionTimeoutError();
      await this.pauseFor(COMPLETE_POLL_MS);
      const res = await this.callRetrying(`/uploads/${id}`, { method: "GET" });
      const body = (await res.json()) as Record<string, unknown>;
      if (body.status === "completing") continue;
      if (body.status === "uploading") {
        const again = await this.postComplete(id, sha256);
        if (again.status === 202) continue;
        return (await again.json()) as Raster;
      }
      if (body.status === "rejected") {
        const reason =
          typeof body.reject_reason === "string"
            ? body.reject_reason
            : typeof body.detail === "string"
              ? body.detail
              : "The server rejected the file.";
        throw new UploadHttpError(422, reason, { detail: reason, raster_id: id });
      }
      return rasterFrom(body) ?? (await this.fetchRaster(id));
    }
  }

  private async fetchRaster(id: UploadId): Promise<Raster> {
    const res = await this.callRetrying(`/projects/${this.opts.projectId}/rasters`, { method: "GET" });
    const list = (await res.json()) as Raster[];
    const found = list.find((r) => String(r.id) === String(id));
    if (!found) throw new UploadHttpError(404, "The upload finished but its flight was not found.");
    return found;
  }

  private adopt(session: UploadSession): void {
    this.current = session;
    this.received = new Set(session.received);
    this.emit(null);
  }

  private remember(): void {
    if (!this.current) return;
    saveSession(
      {
        upload_id: this.current.upload_id,
        project_id: this.opts.projectId,
        fingerprint: this.opts.fingerprint,
        name: this.opts.name,
        size: this.file.size,
      },
      this.storage(),
    );
  }

  private forget(): void {
    if (this.current) removeSession(this.opts.projectId, this.current.upload_id, this.storage());
  }

  private storage(): KeyValueStorage | null | undefined {
    return "storage" in this.deps ? this.deps.storage : undefined;
  }

  private requireId(): UploadId {
    const id = this.uploadId;
    if (id === null) throw new Error("No upload session is open.");
    return id;
  }

  private async sendSidecars(): Promise<void> {
    const id = this.requireId();
    for (const [kind, blob] of [["tfw", this.opts.tfw], ["prj", this.opts.prj]] as const) {
      if (!blob) continue;
      await this.call(`/uploads/${id}/sidecars/${kind}`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: blob,
      });
    }
  }

  private async sendMissing(): Promise<void> {
    const session = this.current;
    if (!session) return;
    const queue: number[] = [];
    for (let n = 0; n < session.chunk_count; n++) if (!this.received.has(n)) queue.push(n);
    let failure: unknown = null;
    const lane = async () => {
      while (failure === null && queue.length > 0) {
        const n = queue.shift() as number;
        try {
          await this.sendChunk(n);
        } catch (cause) {
          failure ??= cause;
        }
      }
    };
    const lanes = Math.max(1, this.opts.concurrency ?? 3);
    await Promise.all(Array.from({ length: lanes }, lane));
    if (failure !== null) throw failure;
  }

  private chunkBounds(n: number): { start: number; end: number } {
    const size = (this.current as UploadSession).chunk_size;
    const start = n * size;
    return { start, end: Math.min(this.file.size, start + size) };
  }

  // One chunk: retries with backoff, refreshes once on 401, and an offline spell starts the retry count afresh.
  private async sendChunk(n: number): Promise<void> {
    const id = this.requireId();
    const { start, end } = this.chunkBounds(n);
    const body = this.file.slice(start, end);
    const digest = await sha256Hex(new Uint8Array(await body.arrayBuffer()));
    const maxRetries = this.opts.maxRetries ?? 5;
    let attempt = 0;
    let refreshed = false;
    for (;;) {
      if (await this.waitOnline()) attempt = 0;
      this.checkStopped();
      let res: Response | null = null;
      try {
        res = await this.deps.fetch(`${this.deps.baseUrl}/uploads/${id}/chunks/${n}`, {
          method: "PUT",
          headers: {
            ...(await this.deps.authHeader()),
            "Content-Type": "application/octet-stream",
            "Content-Range": `bytes ${start}-${end - 1}/${this.file.size}`,
            [CHUNK_SHA_HEADER]: digest,
          },
          body,
          signal: this.controller.signal,
        });
      } catch {
        this.checkStopped();
        if (!this.deps.connectivity.isOnline()) continue;
      }
      if (res && res.ok) {
        this.received.add(n);
        this.emit(n);
        return;
      }
      if (res && res.status === 401) {
        if (refreshed) throw new UploadHttpError(401, "Session expired");
        refreshed = true;
        if (!(await this.deps.refreshAuth())) throw new UploadHttpError(401, "Session expired");
        continue;
      }
      const error = res ? await readError(res) : new UploadHttpError(0, "Upload failed — network error");
      if (!isRetryable(error) || attempt >= maxRetries) throw error;
      attempt += 1;
      await this.pauseFor(this.backoff(attempt));
    }
  }

  // Exponential with half jitter: attempt 1 waits 0.5-1 x base, doubling to the cap.
  private backoff(attempt: number): number {
    const base = this.opts.baseDelayMs ?? 1000;
    const cap = this.opts.maxDelayMs ?? 30_000;
    const ceiling = Math.min(cap, base * 2 ** (attempt - 1));
    return ceiling / 2 + this.deps.random() * (ceiling / 2);
  }

  // A sleep that pause() or abort() cuts short, so Stop never waits out a 30 s backoff.
  private async pauseFor(ms: number): Promise<void> {
    this.checkStopped();
    const signal = this.controller.signal;
    await new Promise<void>((resolve) => {
      const done = () => {
        signal.removeEventListener("abort", done);
        resolve();
      };
      signal.addEventListener("abort", done);
      void this.deps.sleep(ms).then(done);
    });
    this.checkStopped();
  }

  // True when it actually waited, so the caller can reset its retry count.
  private async waitOnline(): Promise<boolean> {
    if (this.deps.connectivity.isOnline()) return false;
    this.paused = true;
    this.emit(null);
    await new Promise<void>((resolve) => {
      const done = () => {
        off();
        this.controller.signal.removeEventListener("abort", done);
        resolve();
      };
      const off = this.deps.connectivity.onOnline(done);
      this.controller.signal.addEventListener("abort", done);
    });
    this.paused = false;
    this.checkStopped();
    this.emit(null);
    return true;
  }

  private checkStopped(): void {
    if (this.stopped === "aborted") throw new UploadAbortedError();
    if (this.stopped === "paused") throw new UploadPausedError();
  }

  // call() plus backoff on transient statuses; only for requests the server treats as idempotent.
  private async callRetrying(path: string, init: RequestInit): Promise<Response> {
    const maxRetries = this.opts.maxRetries ?? 5;
    for (let attempt = 0; ; ) {
      if (await this.waitOnline()) attempt = 0;
      try {
        return await this.call(path, init);
      } catch (cause) {
        if (!(cause instanceof UploadHttpError) || !RETRYABLE.has(cause.status) || attempt >= maxRetries) {
          throw cause;
        }
        attempt += 1;
        await this.pauseFor(this.backoff(attempt));
      }
    }
  }

  // Non-chunk calls: one forced refresh-and-retry on 401, every other failure surfaces with its body.
  private async call(path: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      this.checkStopped();
      let res: Response;
      try {
        res = await this.deps.fetch(`${this.deps.baseUrl}${path}`, {
          ...init,
          headers: { ...(await this.deps.authHeader()), ...(init.headers ?? {}) },
          signal: this.controller.signal,
        });
      } catch {
        this.checkStopped();
        throw new UploadHttpError(0, "Network error — backend unreachable");
      }
      if (res.status === 401 && attempt === 0 && (await this.deps.refreshAuth())) continue;
      if (res.status === 401) throw new UploadHttpError(401, "Session expired");
      if (!res.ok) throw await readError(res);
      return res;
    }
  }

  private emit(chunkIndex: number | null): void {
    const session = this.current;
    if (!session || !this.opts.onProgress) return;
    const total = this.file.size;
    let sent = 0;
    for (const n of this.received) {
      const { start, end } = this.chunkBounds(n);
      sent += Math.max(0, end - start);
    }
    this.opts.onProgress({
      bytesSent: sent,
      totalBytes: total,
      percent: total > 0 ? Math.min(100, Math.floor((sent / total) * 100)) : 100,
      chunkIndex,
      paused: this.paused,
    });
  }
}
