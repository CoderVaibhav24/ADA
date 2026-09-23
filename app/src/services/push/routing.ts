import type { QueryClient } from '@tanstack/react-query';

import { caseKeys } from '@/services/api/case-reads';
import { notificationKeys } from '@/services/api/notification-reads';

import { NOTIFICATION_TYPES, type NotificationType } from './constants';

/*
 * A notification is a routing hint, not data (push-and-permissions.md §5.3).
 *
 * The payload is `{ case_ref, type }`. Nothing from it is rendered: it picks a
 * case, the cached copy of that case is invalidated, and the screen fetches the
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

// Reads `{ type, case_ref?, notification_id }`. Null when there is nothing to act on.
export function routeFromPayload(data: unknown): NotificationRoute | null {
  if (data === null || typeof data !== 'object') return null;
  const bag = data as Record<string, unknown>;
  const caseRef = typeof bag.case_ref === 'string' && CASE_REF.test(bag.case_ref) ? bag.case_ref : null;
  const notificationId =
    typeof bag.notification_id === 'string' && UUID.test(bag.notification_id) ? bag.notification_id : null;
  const type = bag.type;
  const known = typeof type === 'string' && (NOTIFICATION_TYPES as readonly string[]).includes(type);
  if (caseRef === null && notificationId === null) return null;
  return { caseRef, type: known ? (type as NotificationType) : null, notificationId };
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
