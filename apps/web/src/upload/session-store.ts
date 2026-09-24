import type { StoredSession, UploadId } from "./types.ts";

const PREFIX = "ada.uploads.";

/** The Storage members this module touches, so tests can pass a Map-backed one. */
export type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// localStorage can be absent or throw (private mode, blocked site data); every access goes through here.
function defaultStorage(): KeyValueStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function keyFor(projectId: UploadId): string {
  return `${PREFIX}${String(projectId)}`;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    (typeof v.upload_id === "string" || typeof v.upload_id === "number") &&
    typeof v.fingerprint === "string" &&
    typeof v.name === "string" &&
    typeof v.size === "number"
  );
}

// Sessions for one project; a corrupt or unreadable entry reads as none.
export function listSessions(
  projectId: UploadId,
  storage: KeyValueStorage | null = defaultStorage(),
): StoredSession[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(keyFor(projectId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isStoredSession) : [];
  } catch {
    return [];
  }
}

// Quota or blocked storage loses resume-after-reload, never the upload itself.
function write(projectId: UploadId, sessions: StoredSession[], storage: KeyValueStorage | null): void {
  if (!storage) return;
  try {
    if (sessions.length === 0) storage.removeItem(keyFor(projectId));
    else storage.setItem(keyFor(projectId), JSON.stringify(sessions));
  } catch {
    return;
  }
}

// Replaces any entry with the same upload id.
export function saveSession(
  session: StoredSession,
  storage: KeyValueStorage | null = defaultStorage(),
): void {
  const others = listSessions(session.project_id, storage).filter(
    (s) => String(s.upload_id) !== String(session.upload_id),
  );
  write(session.project_id, [...others, session], storage);
}

export function removeSession(
  projectId: UploadId,
  uploadId: UploadId,
  storage: KeyValueStorage | null = defaultStorage(),
): void {
  const rest = listSessions(projectId, storage).filter(
    (s) => String(s.upload_id) !== String(uploadId),
  );
  write(projectId, rest, storage);
}

// Drops local records whose session the server no longer lists (expired, completed, discarded elsewhere).
export function pruneSessions(
  projectId: UploadId,
  liveIds: UploadId[],
  storage: KeyValueStorage | null = defaultStorage(),
): void {
  const live = new Set(liveIds.map(String));
  const all = listSessions(projectId, storage);
  const kept = all.filter((s) => live.has(String(s.upload_id)));
  if (kept.length !== all.length) write(projectId, kept, storage);
}

export function findSession(
  projectId: UploadId,
  uploadId: UploadId,
  storage: KeyValueStorage | null = defaultStorage(),
): StoredSession | null {
  return listSessions(projectId, storage).find((s) => String(s.upload_id) === String(uploadId)) ?? null;
}
