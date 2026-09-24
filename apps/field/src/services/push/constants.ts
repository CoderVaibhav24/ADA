import { env } from '@/services/config/env';

/*
 * Everything push needs to know about the world outside the handset, in one file.
 *
 * The sender is `ada-notify`, calling FCM HTTP v1 and APNs directly
 * (push-and-permissions.md §3, "the alternative" — now the chosen path). There is
 * no Expo Push Service and no Expo account: the token registered here is the
 * native FCM or APNs token, never an ExponentPushToken.
 *
 * Contract: ada-notify `/v1/me/*`, authenticated with the surveyor's own Keycloak
 * access token from the `ada-field` client. Errors are `{ error, detail }`.
 */
export const NOTIFY_PATHS = {
  // POST {platform, token, apns_environment, app_version}. Idempotent upsert keyed on token.
  registerDevice: '/v1/me/devices',
  // POST {token} → 204 always. Must run before the access token is discarded.
  unregisterDevice: '/v1/me/devices/unregister',
  // GET ?limit&cursor&project=ada → {items, next_cursor, unread_count}. For the Notifications screen.
  notifications: '/v1/me/notifications',
  // POST → 204, idempotent.
  markRead: (notificationId: string): string => `/v1/me/notifications/${encodeURIComponent(notificationId)}/read`,
} as const;

// The `project` filter for the notifications list.
export const NOTIFY_PROJECT = 'ada';

// Android channel for every ICMS notification. ada-notify sets android.notification.channel_id to this.
export const PUSH_CHANNEL_ID = 'case-updates';

/*
 * Template keys ada-notify sends as `type` (§4). The data payload is
 * `{ type, notification_id, case_ref?, inspection_ref?, notice_ref?, route? }`, all
 * strings (§5); an unknown type is still routed by its case reference.
 */
export const NOTIFICATION_TYPES = [
  'case_assigned',
  'case_unassigned',
  'case_rejected',
  'inspection_assigned',
  'inspection_reminder',
  'findings_accepted',
  'resurvey_requested',
  'resurvey_request_raised',
  'resurvey_approved',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export type ApnsEnvironment = 'development' | 'production';

// Bounded so a dead notify host never holds up sign-in or sign-out.
export const NOTIFY_TIMEOUT_MS = 10_000;

// A healthy registration is refreshed this often even if nothing changed, so `last_seen` stays true.
export const REREGISTER_AFTER_MS = 24 * 60 * 60 * 1000;

type PushEnv = {
  readonly notifyBaseUrl: string | null;
  readonly apnsEnvironment: ApnsEnvironment;
};

/*
 * The push half of the build config. The ada-notify URL comes from `ada.config.ts`
 * (ACTIVE_ENV) via `src/services/config/env.ts`; it is never written here. A null URL
 * is not fatal: push is a convenience, never the only path (Architecture.md §6), so
 * a build without it runs with push switched off.
 */
export const pushEnv: PushEnv = {
  notifyBaseUrl: env.notifyBaseUrl,
  apnsEnvironment: env.apnsEnvironment,
};
