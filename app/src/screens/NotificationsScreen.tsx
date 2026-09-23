import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { ListScreenTemplate } from '@/design-system';
import { NotificationFeed } from '@/design-system/organisms/NotificationFeed';

/*
 * Notifications, `204:4317`. ada-notify `GET /v1/me/notifications?project=ada`,
 * cursor-paged, newest first. A tap marks the item read and opens its case, which
 * the case screen fetches from ada-api; the item's text is never taken as case data.
 */
export function NotificationsScreen() {
  const router = useRouter();

  // Opens the case; back returns here through the stack.
  const openCase = useCallback(
    (caseRef: string) =>
      router.push({ pathname: '/complaint/[caseRef]', params: { caseRef, from: 'home' } }),
    [router],
  );

  return (
    <ListScreenTemplate title="Notifications" onBack={() => router.back()}>
      <NotificationFeed onOpen={openCase} />
    </ListScreenTemplate>
  );
}
