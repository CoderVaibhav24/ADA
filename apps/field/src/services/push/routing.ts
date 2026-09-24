import type { QueryClient } from '@tanstack/react-query';
import type { Href } from 'expo-router';

import { caseKeys } from '@/services/api/case-reads';
import { notificationKeys } from '@/services/api/notification-reads';
import { COMPLAINT_IN_COMPLAINTS } from '@/services/navigation/complaint-route';

import { NOTIFICATION_TYPES, type NotificationType } from './constants';

/*
 * A notification is a routing hint, not data (push-and-permissions.md §5.3).
 *
 * The payload is `{ type, case_ref?, ... }`. Nothing from it is rendered: it picks a
 * case and a screen, the cached copy of that case is invalidated, and the screen fetches the
 * truth from the API under the surveyor's own token.
 */
export type NotificationRoute = {
  // Absent for a notification about no particular case; the tap then opens the list.
  readonly caseRef: string | null;
  readonly type: NotificationType | null;
  readonly notificationId: string | null;
};

// Case references are short identifiers like CMP-4512. Anything else is not routed.
const CASE_REF = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A case reference that passes the shape check, else null.
export function safeCaseRef(value: unknown): string | null {
  return typeof value === 'string' && CASE_REF.test(value) ? value : null;
}

// A known template key, else null.
export function knownType(value: unknown): NotificationType | null {
  return typeof value === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(value)
    ? (value as NotificationType)
    : null;
}

// Reads `{ type, notification_id, case_ref?, ... }`. Null when there is nothing to act on.
export function routeFromPayload(data: unknown): NotificationRoute | null {
  if (data === null || typeof data !== 'object') return null;
  const bag = data as Record<string, unknown>;
  const caseRef = safeCaseRef(bag.case_ref);
  const notificationId =
    typeof bag.notification_id === 'string' && UUID.test(bag.notification_id) ? bag.notification_id : null;
  if (caseRef === null && notificationId === null) return null;
  return { caseRef, type: knownType(bag.type), notificationId };
}

// Where a tap lands. The server's `route` hint is never followed; the type and case pick the screen.
export type NotificationTarget =
  | { readonly screen: 'complaint'; readonly caseRef: string }
  | { readonly screen: 'inspection'; readonly caseRef: string }
  | { readonly screen: 'complaints' }
  | { readonly screen: 'notifications' };

const INSPECTION_TYPES: ReadonlySet<NotificationType> = new Set([
  'inspection_assigned',
  'inspection_reminder',
  'resurvey_requested',
  'resurvey_approved',
]);

// The one type -> screen mapping, shared by push taps and inbox rows.
export function notificationTarget(type: NotificationType | null, caseRef: string | null): NotificationTarget {
  if (type === 'case_unassigned' || type === 'case_rejected') return { screen: 'complaints' };
  if (caseRef === null) return { screen: 'notifications' };
  if (type !== null && INSPECTION_TYPES.has(type)) return { screen: 'inspection', caseRef };
  return { screen: 'complaint', caseRef };
}

// The expo-router href for a target; callers choose push, navigate or dismissTo.
export function notificationHref(target: NotificationTarget): Href {
  switch (target.screen) {
    case 'complaint':
      return { pathname: COMPLAINT_IN_COMPLAINTS, params: { caseRef: target.caseRef, from: 'complaints' } };
    case 'inspection':
      return { pathname: '/inspection/[caseRef]', params: { caseRef: target.caseRef } };
    case 'complaints':
      return '/complaints';
    case 'notifications':
      return '/notifications';
  }
}

// Marks everything the notification may have changed as stale, so the next read goes to the server.
export async function invalidateForNotification(client: QueryClient, route: NotificationRoute): Promise<void> {
  const caseRef = route.caseRef;
  await Promise.all([
    ...(caseRef === null
      ? []
      : [
          client.invalidateQueries({ queryKey: caseKeys.detail(caseRef) }),
          client.invalidateQueries({ queryKey: caseKeys.resurvey(caseRef) }),
        ]),
    client.invalidateQueries({ queryKey: [...caseKeys.all, 'list'] }),
    client.invalidateQueries({ queryKey: [...caseKeys.all, 'count'] }),
    client.invalidateQueries({ queryKey: [...caseKeys.all, 'first'] }),
    client.invalidateQueries({ queryKey: notificationKeys.all }),
  ]);
}
