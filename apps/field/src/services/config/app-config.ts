import { cacheStore, readJson, writeJson } from '@/services/storage/kv';

/*
 * The thresholds and counts the workflow owns.
 *
 * No screen hard-codes any of these. The GPS accuracy numbers in particular are
 * an open question with the authority (progress-tracker.md §5, B4) and will be
 * answered after this build ships, so they have to be served values rather than
 * constants somebody has to find.
 *
 * `gpsAccuracyGateM`, `gpsAccuracyFlagM`, `deviceTimestampMaxAgeHours`,
 * `minimumPhotoCount` and `maximumPhotoCount` are served by
 * `GET /api/icms/app-config`; the values below are the offline fallback when
 * a device has never fetched it or a server 404s (older server). The server
 * enforces the photo counts too — `submit` below the minimum and
 * `add_evidence` past the maximum are both refused — so a served count is
 * the authority, not just a wizard hint.
 */
export type AppConfig = {
  /** A check-in fix worse than this, in metres, is refused outright. Placeholder until B4 is answered. */
  readonly gpsAccuracyGateM: number;
  /** Evidence worse than this, in metres, is kept but stored `geotag_flagged`, not refused. */
  readonly gpsAccuracyFlagM: number;
  /** A fix older than this, in milliseconds, is not "live" and cannot stamp a check-in or a capture. */
  readonly gpsFixMaxAgeMs: number;
  /** A `device_timestamp` older than this, in hours, is refused by the server as stale. */
  readonly deviceTimestampMaxAgeHours: number;
  /** The wizard's photograph counter. The design shows three. */
  readonly minimumPhotoCount: number;
  /** The legacy app's `maxPic`. */
  readonly maximumPhotoCount: number;
  /** Longest edge, in pixels, a capture is downscaled to before upload (code-standards.md §7). */
  readonly photoMaxEdgePx: number;
  /** JPEG quality for that downscale, 0 to 1. */
  readonly photoJpegQuality: number;
  /** How many times a capture upload is retried before it stays `failed` and visible. */
  readonly uploadMaxAttempts: number;
  /** First retry delay, in milliseconds. Doubles each attempt. */
  readonly uploadBackoffBaseMs: number;
  /** The ceiling that doubling stops at. */
  readonly uploadBackoffCeilingMs: number;
  /** Cached list data older than this is shown with its age called out. */
  readonly staleAfterMs: number;
};

export const DEFAULT_APP_CONFIG: AppConfig = {
  // Mirrors the server's icms_accuracy_gate_m (services/api/app/config.py) until GET /api/icms/app-config exists.
  gpsAccuracyGateM: 50,
  // Mirrors the server's icms_accuracy_flag_m.
  gpsAccuracyFlagM: 15,
  gpsFixMaxAgeMs: 30_000,
  deviceTimestampMaxAgeHours: 12,
  minimumPhotoCount: 3,
  maximumPhotoCount: 5,
  photoMaxEdgePx: 1600,
  photoJpegQuality: 0.7,
  uploadMaxAttempts: 8,
  uploadBackoffBaseMs: 5_000,
  uploadBackoffCeilingMs: 15 * 60_000,
  staleAfterMs: 30 * 60_000,
};

const CACHE_KEY = 'config:app-config';

// The served endpoint answers snake_case; this is the only place that knows it.
const SERVED_KEY_MAP: Record<string, keyof AppConfig> = {
  gps_accuracy_gate_m: 'gpsAccuracyGateM',
  gps_accuracy_flag_m: 'gpsAccuracyFlagM',
  device_timestamp_max_age_hours: 'deviceTimestampMaxAgeHours',
  minimum_photo_count: 'minimumPhotoCount',
  maximum_photo_count: 'maximumPhotoCount',
};

// Runtime guard. A served config that does not parse is ignored in favour of the defaults.
function isPartialAppConfig(value: unknown): value is Partial<AppConfig> {
  return value !== null && typeof value === 'object';
}

// Merges a served config over the defaults, mapping snake_case keys and keeping every value numeric.
function merge(partial: Partial<AppConfig>): AppConfig {
  const merged: Record<string, number> = { ...DEFAULT_APP_CONFIG };
  for (const [key, value] of Object.entries(partial)) {
    const target = SERVED_KEY_MAP[key] ?? key;
    if (typeof value === 'number' && Number.isFinite(value) && target in DEFAULT_APP_CONFIG) {
      merged[target] = value;
    }
  }
  return merged as unknown as AppConfig;
}

/*
 * The config as this device last knew it, read synchronously.
 *
 * Services gate on thresholds outside React — the capture validator is the
 * example — so this cannot be hook-only.
 */
export function currentAppConfig(): AppConfig {
  const cached = readJson(cacheStore, CACHE_KEY, isPartialAppConfig);
  return cached === null ? DEFAULT_APP_CONFIG : merge(cached);
}

// Stores a served config for offline reads.
export function cacheAppConfig(partial: Partial<AppConfig>): AppConfig {
  writeJson(cacheStore, CACHE_KEY, partial);
  return merge(partial);
}
