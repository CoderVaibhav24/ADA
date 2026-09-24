import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import { ListScreenTemplate } from '@/design-system';
import { NotificationFeed } from '@/design-system/organisms/NotificationFeed';
import { useT } from '@/services/i18n';
import { notificationHref, type NotificationTarget } from '@/services/push/routing';

/*
 * Notifications, `204:4317`. ada-notify `GET /v1/me/notifications?project=ada`,
 * cursor-paged, newest first, each item its own card. No tab bar, as drawn; the bell
 * is drawn but is not a link here. A tap marks the item read and opens the screen its
 * type points at, which fetches from ada-api; the item's text is never case data.
 */
export function NotificationsScreen() {
  const router = useRouter();
  const t = useT();

  // Closes this screen and opens where the item leads, with its tab's register under it; a no-case item stays here.
  const openTarget = useCallback(
    (target: NotificationTarget) => {
      if (target.screen === 'notifications') return;
      router.dismissTo(notificationHref(target), { withAnchor: true });
    },
    [router],
  );

  return (
    <ListScreenTemplate
      title={t('shell.notifications.title')}
      onBack={() => (router.canGoBack() ? router.back() : router.navigate('/home'))}
      headerProps={{ bell: 'static' }}
    >
      <NotificationFeed onOpen={openTarget} />
    </ListScreenTemplate>
  );
}
