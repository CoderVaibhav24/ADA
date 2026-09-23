import { createMMKV, type MMKV } from 'react-native-mmkv';

/*
 * Durable key-value storage for everything that is not a token.
 *
 * Three stores rather than one, because they have different lifetimes and
 * different rules about being cleared:
 *
 *   cacheStore   server-driven config and the persisted TanStack Query cache.
 *                Safe to clear: it is a copy of something the server holds.
 *   draftStore   findings drafts, saved on every field blur. Cleared only when
 *                the round they belong to has been submitted and confirmed.
 *   evidenceStore capture records and their upload state. Append-only
 *                (code-standards.md rule 6) — nothing here is cleared by the app.
 *
 * Sign-out clears `cacheStore` only. A surveyor whose token expired in a field
 * with no signal must not lose a morning's captures to it.
 */
export const cacheStore = createMMKV({ id: 'ada.cache' });
export const draftStore = createMMKV({ id: 'ada.drafts' });
export const evidenceStore = createMMKV({ id: 'ada.evidence' });

export type JsonStore = MMKV;

// Reads and parses a JSON value, answering null for absent or corrupt entries.
export function readJson<T>(store: JsonStore, key: string, guard: (value: unknown) => value is T): T | null {
  const raw = store.getString(key);
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Writes a JSON value.
export function writeJson(store: JsonStore, key: string, value: unknown): void {
  store.set(key, JSON.stringify(value));
}
