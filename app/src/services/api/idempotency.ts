import * as Crypto from 'expo-crypto';

import { evidenceStore } from '@/services/storage/kv';

/*
 * Idempotency keys, minted at user action time.
 *
 * This is the rule that survives the offline write queue being dropped from this
 * build (progress-tracker.md §6, 2026-09-22). Without a queue, a submit on a
 * flaky connection is retried by the user or by TanStack Query, and a retry that
 * carries a new key creates a second inspection against the same case. The key is
 * therefore generated when the surveyor taps — not when the request is sent — and
 * persisted, so the same tap keeps the same key across a retry, a process death
 * and a reboot.
 *
 * The server reads `idempotency_key` from the request body
 * (`backend/api/app/icms/inspection_schemas.py`), so that is where the client
 * puts it; the header is sent as well for proxy-level logging.
 */
export const IDEMPOTENCY_HEADER = 'Idempotency-Key';

const KEY_PREFIX = 'idempotency:';

// A fresh key. UUID v4 from the platform's CSPRNG.
export function newIdempotencyKey(): string {
  return Crypto.randomUUID();
}

/*
 * The key for one user action, minted on first call and stable afterwards.
 *
 * `scope` names the action, not the request: `submit:CMP-2026-0007:round-3`. Two
 * taps of the same button on the same round are one action and one key; the
 * server answers the second with the record the first created.
 */
export function idempotencyKeyFor(scope: string): string {
  const storageKey = `${KEY_PREFIX}${scope}`;
  const existing = evidenceStore.getString(storageKey);
  if (existing !== undefined) return existing;

  const key = newIdempotencyKey();
  evidenceStore.set(storageKey, key);
  return key;
}

/*
 * Forgets the key for an action the server has confirmed.
 *
 * Call this only after a success. Forgetting early is how a retry becomes a
 * duplicate record, which is the one thing this module exists to prevent.
 */
export function releaseIdempotencyKey(scope: string): void {
  evidenceStore.remove(`${KEY_PREFIX}${scope}`);
}
