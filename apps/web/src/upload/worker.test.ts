import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { test } from "node:test";

import { listSessions, type KeyValueStorage } from "./session-store.ts";
import {
  UploadAbortedError,
  UploadCompletionTimeoutError,
  UploadHttpError,
  UploadPausedError,
  type UploadProgress,
} from "./types.ts";
import {
  CHUNK_SHA_HEADER,
  COMPLETE_POLL_MS,
  COMPLETE_TIMEOUT_MS,
  ChunkedUpload,
  type Connectivity,
  type UploadDeps,
} from "./worker.ts";

// Run with: npm run test -w @ada/web. fetch is a fake; nothing touches the network.

const CHUNK = 4;
const BYTES = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

type Call = { method: string; url: string; headers: Record<string, string>; body: unknown };
type Reply = (call: Call) => Response | Promise<Response>;

function memoryStorage(): KeyValueStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function session(received: number[] = []) {
  return { upload_id: 42, chunk_size: CHUNK, chunk_count: 3, received, status: "uploading", size_bytes: BYTES.length };
}

// A fake ada-api: default answers for every route, with per-test overrides for chunk PUTs.
function fakeApi(opts: { chunk?: Reply; received?: number[]; open?: Reply; complete?: Reply; session?: Reply } = {}) {
  const calls: Call[] = [];
  const fetch: UploadDeps["fetch"] = async (url, init) => {
    const headers = { ...((init?.headers ?? {}) as Record<string, string>) };
    const call: Call = { method: init?.method ?? "GET", url, headers, body: init?.body };
    calls.push(call);
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    if (call.method === "POST" && url.endsWith("/projects/7/uploads")) {
      return opts.open ? opts.open(call) : json(session(), 201);
    }
    if (call.method === "GET" && url.endsWith("/uploads/42")) {
      return opts.session ? opts.session(call) : json(session(opts.received ?? []));
    }
    if (call.method === "GET" && url.endsWith("/projects/7/rasters")) {
      return json([{ id: 41, project_id: 7, name: "old", status: "ready" }, { id: 42, project_id: 7, name: "flight", status: "processing" }]);
    }
    if (call.method === "PUT" && url.includes("/chunks/")) {
      const reply = opts.chunk ? await opts.chunk(call) : new Response(null, { status: 204 });
      if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
      return reply;
    }
    if (call.method === "PUT" && url.includes("/sidecars/")) return new Response(null, { status: 204 });
    if (call.method === "POST" && url.endsWith("/uploads/42/complete")) {
      if (opts.complete) return opts.complete(call);
      return json({ id: 42, project_id: 7, name: "flight", status: "processing" });
    }
    if (call.method === "DELETE") return new Response(null, { status: 204 });
    return new Response(null, { status: 404 });
  };
  const chunkPuts = (n?: number) =>
    calls.filter((c) => c.method === "PUT" && c.url.includes("/chunks/") && (n === undefined || c.url.endsWith(`/chunks/${n}`)));
  return { fetch, calls, chunkPuts };
}

function online(initial = true): Connectivity & { set: (v: boolean) => void } {
  let state = initial;
  const listeners = new Set<() => void>();
  return {
    isOnline: () => state,
    onOnline: (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    set: (v) => {
      state = v;
      if (v) for (const l of [...listeners]) l();
    },
  };
}

function build(
  api: ReturnType<typeof fakeApi>,
  extra: Partial<UploadDeps> = {},
  progress: UploadProgress[] = [],
  concurrency = 3,
  maxRetries = 5,
) {
  const storage = memoryStorage();
  const sleeps: number[] = [];
  const upload = new ChunkedUpload({
    projectId: 7,
    file: new File([BYTES], "flight.tif"),
    fingerprint: "10:abc",
    name: "flight",
    onProgress: (p) => progress.push(p),
    concurrency,
    maxRetries,
    deps: {
      fetch: api.fetch,
      authHeader: async () => ({ Authorization: "Bearer t" }),
      refreshAuth: async () => true,
      sleep: async (ms) => void sleeps.push(ms),
      random: () => 0.5,
      connectivity: online(),
      storage,
      baseUrl: "/api",
      ...extra,
    },
  });
  return { upload, storage, sleeps, progress };
}

test("a fresh upload sends every chunk with its range and hash, then completes", async () => {
  const api = fakeApi();
  const { upload, storage, progress } = build(api);
  await upload.start();
  assert.equal(api.chunkPuts().length, 3);
  const last = api.chunkPuts(2)[0];
  assert.equal(last?.headers["Content-Range"], "bytes 8-9/10");
  assert.equal(
    last?.headers[CHUNK_SHA_HEADER],
    createHash("sha256").update(Buffer.from([9, 10])).digest("hex"),
  );
  assert.equal(last?.headers.Authorization, "Bearer t");
  assert.equal(listSessions(7, storage).length, 1);
  assert.deepEqual(progress.at(-1), { bytesSent: 10, totalBytes: 10, percent: 100, chunkIndex: progress.at(-1)?.chunkIndex, paused: false });

  const raster = await upload.complete();
  assert.equal(raster.status, "processing");
  assert.equal(listSessions(7, storage).length, 0);
});

test("resume reads the bitmap and sends only the missing chunk", async () => {
  const api = fakeApi({ received: [0, 2] });
  const { upload, progress } = build(api);
  await upload.resume(42, new File([BYTES], "flight.tif"));
  assert.deepEqual(api.chunkPuts().map((c) => c.url), ["/api/uploads/42/chunks/1"]);
  assert.equal(progress[0]?.bytesSent, 6);
  assert.equal(progress.at(-1)?.percent, 100);
});

test("resume refuses a file whose size differs from the session", async () => {
  const api = fakeApi({ received: [0] });
  const { upload } = build(api);
  await assert.rejects(upload.resume(42, new File([new Uint8Array(3)], "other.tif")), UploadHttpError);
  assert.equal(api.chunkPuts().length, 0);
});

test("a 503 is retried with growing jittered backoff and then succeeds", async () => {
  let failures = 2;
  const api = fakeApi({
    chunk: (call) =>
      call.url.endsWith("/chunks/1") && failures-- > 0
        ? new Response(null, { status: 503 })
        : new Response(null, { status: 204 }),
  });
  const { upload, sleeps } = build(api);
  await upload.start();
  assert.equal(api.chunkPuts(1).length, 3);
  assert.deepEqual(sleeps, [750, 1500]);
});

test("a chunk that keeps failing gives up after five retries", async () => {
  const api = fakeApi({
    chunk: (call) =>
      call.url.endsWith("/chunks/0") ? new Response(null, { status: 500 }) : new Response(null, { status: 204 }),
  });
  const { upload, sleeps } = build(api);
  await assert.rejects(upload.start(), (e: unknown) => e instanceof UploadHttpError && e.status === 500);
  assert.equal(api.chunkPuts(0).length, 6);
  assert.equal(sleeps.length, 5);
});

test("a 401 refreshes the token once and resends only that chunk", async () => {
  let expired = true;
  let refreshes = 0;
  const api = fakeApi({
    chunk: (call) => {
      if (call.url.endsWith("/chunks/1") && expired) {
        expired = false;
        return new Response(null, { status: 401 });
      }
      return new Response(null, { status: 204 });
    },
  });
  const { upload, sleeps } = build(api, { refreshAuth: async () => (refreshes++, true) });
  await upload.start();
  assert.equal(refreshes, 1);
  assert.equal(api.chunkPuts(0).length, 1);
  assert.equal(api.chunkPuts(1).length, 2);
  assert.equal(api.chunkPuts(2).length, 1);
  assert.equal(sleeps.length, 0);
});

test("a second 401 after a refresh ends the upload as a sign-out", async () => {
  const api = fakeApi({ chunk: () => new Response(null, { status: 401 }) });
  const { upload } = build(api);
  await assert.rejects(upload.start(), (e: unknown) => e instanceof UploadHttpError && e.status === 401);
});

test("abort stops the transfer, deletes the server session and forgets it", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const api = fakeApi({
    chunk: async () => {
      await gate;
      return new Response(null, { status: 204 });
    },
  });
  const { upload, storage } = build(api);
  const running = upload.start();
  while (api.chunkPuts().length === 0) await new Promise((r) => setImmediate(r));
  assert.equal(listSessions(7, storage).length, 1);
  await upload.abort();
  release();
  await assert.rejects(running, UploadAbortedError);
  assert.ok(api.calls.some((c) => c.method === "DELETE" && c.url === "/api/uploads/42"));
  assert.equal(listSessions(7, storage).length, 0);
  assert.equal(api.chunkPuts().length, 3);
});

test("offline pauses before sending and online resumes without spending a retry", async () => {
  const link = online(false);
  const api = fakeApi();
  const progress: UploadProgress[] = [];
  const { upload, sleeps } = build(api, { connectivity: link }, progress);
  const running = upload.start();
  while (!progress.some((p) => p.paused)) await new Promise((r) => setImmediate(r));
  assert.equal(api.chunkPuts().length, 0);
  link.set(true);
  await running;
  assert.equal(api.chunkPuts().length, 3);
  assert.equal(progress.at(-1)?.paused, false);
  assert.equal(sleeps.length, 0);
});

test("a network error while the link is down waits for online instead of retrying", async () => {
  const link = online(true);
  let dropped = false;
  const api = fakeApi({
    chunk: (call) => {
      if (call.url.endsWith("/chunks/0") && !dropped) {
        dropped = true;
        link.set(false);
        throw new TypeError("Failed to fetch");
      }
      return new Response(null, { status: 204 });
    },
  });
  const { upload, sleeps } = build(api, { connectivity: link }, [], 1);
  const running = upload.start();
  while (!dropped) await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  link.set(true);
  await running;
  assert.equal(api.chunkPuts(0).length, 2);
  assert.equal(sleeps.length, 0);
});

test("a duplicate fingerprint surfaces the 409 body with the existing raster id", async () => {
  const api = fakeApi({
    open: () => json({ detail: "Already uploaded", existing_raster_id: 9 }, 409),
  });
  const { upload } = build(api);
  await assert.rejects(upload.start(), (e: unknown) => {
    assert.ok(e instanceof UploadHttpError);
    assert.equal(e.status, 409);
    assert.equal(e.message, "Already uploaded");
    assert.deepEqual(e.body, { detail: "Already uploaded", existing_raster_id: 9 });
    return true;
  });
  assert.equal(api.chunkPuts().length, 0);
});

test("a 422 at complete forgets the session and carries the reason", async () => {
  const api = fakeApi();
  const storage = memoryStorage();
  const upload = new ChunkedUpload({
    projectId: 7,
    file: new File([BYTES], "flight.tif"),
    fingerprint: "10:abc",
    name: "flight",
    deps: {
      storage,
      fetch: async (url, init) =>
        url.endsWith("/complete")
          ? json({ detail: "not a TIFF file", raster_id: 42 }, 422)
          : api.fetch(url, init),
    },
  });
  await upload.start();
  await assert.rejects(upload.complete(), (e: unknown) => e instanceof UploadHttpError && e.message === "not a TIFF file");
  assert.equal(listSessions(7, storage).length, 0);
});

const tick = () => new Promise((r) => setImmediate(r));

test("a 400 naming SHA-256 is resent; any other 400 fails at once", async () => {
  let bad = true;
  const sha = fakeApi({
    chunk: (call) =>
      call.url.endsWith("/chunks/1") && bad && !(bad = false)
        ? json({ detail: "X-Chunk-SHA256 mismatch" }, 400)
        : new Response(null, { status: 204 }),
  });
  await build(sha).upload.start();
  assert.equal(sha.chunkPuts(1).length, 2);

  const other = fakeApi({
    chunk: (call) =>
      call.url.endsWith("/chunks/1") ? json({ detail: "wrong body size" }, 400) : new Response(null, { status: 204 }),
  });
  const { upload, sleeps } = build(other);
  await assert.rejects(upload.start(), (e: unknown) => e instanceof UploadHttpError && e.status === 400);
  assert.equal(other.chunkPuts(1).length, 1);
  assert.equal(sleeps.length, 0);
});

test("complete retries a 503 with the same backoff", async () => {
  let failures = 2;
  const api = fakeApi({
    complete: () =>
      failures-- > 0 ? new Response(null, { status: 503 }) : json({ id: 42, project_id: 7, name: "flight", status: "processing" }),
  });
  const { upload, sleeps, storage } = build(api);
  await upload.start();
  const raster = await upload.complete();
  assert.equal(raster.id, 42);
  assert.deepEqual(sleeps, [750, 1500]);
  assert.equal(listSessions(7, storage).length, 0);
});

test("a 202 from complete polls the session every 3 s, then reads the raster from the list", async () => {
  const states = ["completing", "completing", "processing"];
  const api = fakeApi({
    complete: () => json({ detail: "completing" }, 202),
    session: () => json({ ...session([0, 1, 2]), status: states.shift() }),
  });
  const { upload, sleeps } = build(api);
  await upload.start();
  const raster = await upload.complete();
  assert.equal(raster.name, "flight");
  assert.deepEqual(sleeps, [COMPLETE_POLL_MS, COMPLETE_POLL_MS, COMPLETE_POLL_MS]);
  assert.ok(api.calls.some((c) => c.url === "/api/projects/7/rasters"));
});

test("a 202 whose session GET carries the raster uses it, and a rejected one surfaces as a 422", async () => {
  const carried = fakeApi({
    complete: () => json({ detail: "completing" }, 202),
    session: () => json({ ...session([0, 1, 2]), status: "processing", raster: { id: 42, project_id: 7, name: "carried", status: "processing" } }),
  });
  const first = build(carried).upload;
  await first.start();
  assert.equal((await first.complete()).name, "carried");

  const rejected = fakeApi({
    complete: () => json({ detail: "completing" }, 202),
    session: () => json({ ...session([0, 1, 2]), status: "rejected", reject_reason: "not a TIFF file" }),
  });
  const { upload, storage } = build(rejected);
  await upload.start();
  await assert.rejects(upload.complete(), (e: unknown) => e instanceof UploadHttpError && e.status === 422 && e.message === "not a TIFF file");
  assert.equal(listSessions(7, storage).length, 0);
});

test("a 422 without raster_id is a plain error and keeps the session", async () => {
  const api = fakeApi({ complete: () => json({ detail: "missing chunks: 1" }, 422) });
  const { upload, storage } = build(api);
  await upload.start();
  await assert.rejects(upload.complete(), (e: unknown) => e instanceof UploadHttpError && e.message === "missing chunks: 1");
  assert.equal(listSessions(7, storage).length, 1);
});

test("pause stops sending but keeps the server session and the local record", async () => {
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const api = fakeApi({ chunk: async () => (await gate, new Response(null, { status: 204 })) });
  const { upload, storage } = build(api);
  const running = upload.start();
  while (api.chunkPuts().length === 0) await tick();
  upload.pause();
  release();
  await assert.rejects(running, UploadPausedError);
  assert.equal(api.calls.some((c) => c.method === "DELETE"), false);
  assert.equal(listSessions(7, storage).length, 1);
});

test("abort during a backoff sleep ends at once instead of waiting it out", async () => {
  const api = fakeApi({ chunk: () => new Response(null, { status: 503 }) });
  let sleeping = false;
  const { upload } = build(api, {
    sleep: () => {
      sleeping = true;
      return new Promise<void>(() => undefined);
    },
  });
  const running = upload.start();
  while (!sleeping) await tick();
  await upload.abort();
  await assert.rejects(running, UploadAbortedError);
});

test("an offline pause starts the chunk's retry count afresh", async () => {
  const link = online(true);
  let calls = 0;
  const api = fakeApi({
    chunk: (call) => {
      if (!call.url.endsWith("/chunks/0")) return new Response(null, { status: 204 });
      calls += 1;
      if (calls === 2) link.set(false);
      return new Response(null, { status: calls <= 3 ? 503 : 204 });
    },
  });
  const progress: UploadProgress[] = [];
  const { upload } = build(api, { connectivity: link }, progress, 1, 2);
  const running = upload.start();
  while (!progress.some((p) => p.paused)) await tick();
  link.set(true);
  await running;
  assert.equal(api.chunkPuts(0).length, 4);
});

test("a poll that finds the session back in uploading re-sends complete", async () => {
  const states = ["uploading", "processing"];
  let posts = 0;
  const api = fakeApi({
    complete: () => (++posts === 1 ? json({ detail: "completing" }, 202) : json({ id: 42, project_id: 7, name: "again", status: "processing" })),
    session: () => json({ ...session([0, 1, 2]), status: states.shift() }),
  });
  const { upload } = build(api);
  await upload.start();
  assert.equal((await upload.complete()).name, "again");
  assert.equal(posts, 2);
});

test("completion that never settles times out after 2 h 10 min and keeps the session", async () => {
  let clock = 0;
  const api = fakeApi({
    complete: () => json({ detail: "completing" }, 202),
    session: () => json({ ...session([0, 1, 2]), status: "completing" }),
  });
  const { upload, storage, sleeps } = build(api, {
    now: () => clock,
    sleep: async (ms) => void (clock += ms),
  });
  await upload.start();
  await assert.rejects(upload.complete(), UploadCompletionTimeoutError);
  assert.equal(clock >= COMPLETE_TIMEOUT_MS, true);
  assert.equal(listSessions(7, storage).length, 1);
  assert.equal(sleeps.length, 0);
});

test("a rejected poll with no reject_reason falls back to the generic text", async () => {
  const api = fakeApi({
    complete: () => json({ detail: "completing" }, 202),
    session: () => json({ ...session([0, 1, 2]), status: "rejected" }),
  });
  const { upload } = build(api);
  await upload.start();
  await assert.rejects(upload.complete(), (e: unknown) => e instanceof UploadHttpError && e.message === "The server rejected the file.");
});
