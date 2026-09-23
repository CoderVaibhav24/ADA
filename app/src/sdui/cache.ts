import { cacheStore, readJson, writeJson } from '@/services/storage/kv';

import { SUPPORTED_SCHEMA_VERSIONS } from './contract';
import { asEnvelope, type ScreenEnvelope } from './types';

/*
 * The last good copy of each screen, in MMKV, so a screen opens offline and while
 * the server is down. Only envelopes this binary can render are written. It lives
 * in `cacheStore`, which sign-out clears, so one officer's screens never show for
 * the next.
 */
const PREFIX = 'sdui:screen:';

function isRenderable(value: unknown): value is ScreenEnvelope {
  const envelope = asEnvelope(value);
  return envelope !== null && SUPPORTED_SCHEMA_VERSIONS.includes(envelope.schema_version);
}

export function readCachedScreen(screenId: string): ScreenEnvelope | null {
  return readJson(cacheStore, `${PREFIX}${screenId}`, isRenderable);
}

export function writeCachedScreen(envelope: ScreenEnvelope): void {
  if (isRenderable(envelope)) writeJson(cacheStore, `${PREFIX}${envelope.screen_id}`, envelope);
}

// Forgets a screen the server now refuses this officer.
export function forgetCachedScreen(screenId: string): void {
  cacheStore.remove(`${PREFIX}${screenId}`);
}
