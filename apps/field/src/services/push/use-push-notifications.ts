import * as Notifications from 'expo-notifications';
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { queryClient } from '@/services/api/query-client';
import { getSession, onBeforeSignOut, subscribeToSession, type SessionSnapshot } from '@/services/auth/session';

import { enablePushFromSettings as askFromSettings, ensureNotificationChannel, primeAndRequestPushPermission } from './permission';
import { NOTIFY_PATHS } from './constants';
import { forgetRegistration, notifyRequest, syncRegistration, unregisterDevice } from './registration';
import { invalidateForNotification, routeFromPayload, type NotificationRoute } from './routing';

/*
 * Push, wired into the app in one call from the root layout.
 *
 * Nothing in here can stop the app: every step is fire-and-forget with its errors
 * swallowed. Push being broken, refused or unconfigured leaves a surveyor with
 * exactly the app they would have had without it (Architecture.md §6).
 */
const supported = Platform.OS === 'android' || Platform.OS === 'ios';

function signedIn(session: SessionSnapshot): boolean {
  return session.status === 'signedIn' || session.status === 'stale';
}

/*
 * Foreground display. A notification arriving while nobody is signed in is not
 * shown — it would name a case to whoever is holding the handset.
 */
if (supported) {
  Notifications.setNotificationHandler({
    handleNotification: () => {
      const show = signedIn(getSession());
      return Promise.resolve({
        shouldShowBanner: show,
        shouldShowList: show,
        shouldPlaySound: show,
        shouldSetBadge: false,
      });
    },
  });

  // Unregister while the bearer is still valid. A provider-ended session has no usable bearer.
  onBeforeSignOut(async (reason) => {
    if (reason === 'user') await unregisterDevice();
    else forgetRegistration();
  });
}

// Registers on sign-in (priming first if this was an interactive sign-in) and on every later session change.
function onSession(previous: SessionSnapshot, next: SessionSnapshot): void {
  if (!signedIn(next)) return;
  // The subject only keys the local "already registered" record; the server takes identity from the bearer.
  const subject = next.profile?.subject ?? '';
  const interactive = previous.status === 'signedOut';

  void (async () => {
    if (interactive) await primeAndRequestPushPermission().catch(() => false);
    await syncRegistration(subject);
  })();
}

export function usePushNotifications(): void {
  const [pending, setPending] = useState<NotificationRoute | null>(null);
  const [session, setSession] = useState<SessionSnapshot>(getSession);

  useEffect(() => {
    if (!supported) return undefined;

    void ensureNotificationChannel().catch(() => undefined);

    let last = getSession();
    const unsubscribeSession = subscribeToSession((next) => {
      onSession(last, next);
      last = next;
      setSession(next);
    });
    onSession({ status: 'restoring', profile: null, reason: 'none' }, last);

    const tokenSubscription = Notifications.addPushTokenListener((token) => {
      const current = getSession();
      if (signedIn(current) && typeof token.data === 'string') {
        void syncRegistration(current.profile?.subject ?? '', token.data);
      }
    });

    // A notification in the foreground: the lists it may have changed are refetched.
    const receivedSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const route = routeFromPayload(notification.request.content.data);
      if (route !== null) void invalidateForNotification(queryClient, route).catch(() => undefined);
    });

    const openRoute = (response: Notifications.NotificationResponse | null): void => {
      if (response === null) return;
      const route = routeFromPayload(response.notification.request.content.data);
      Notifications.clearLastNotificationResponse();
      if (route !== null) setPending(route);
    };

    // Cold start from a tap, then every tap after.
    openRoute(Notifications.getLastNotificationResponse());
    const responseSubscription = Notifications.addNotificationResponseReceivedListener(openRoute);

    // Notifications switched off in system settings after a grant: unregister on return, so ada-notify stops sending.
    const appStateSubscription = AppState.addEventListener('change', (next) => {
      const current = getSession();
      if (next === 'active' && signedIn(current)) void syncRegistration(current.profile?.subject ?? '');
    });

    return () => {
      unsubscribeSession();
      appStateSubscription.remove();
      tokenSubscription.remove();
      receivedSubscription.remove();
      responseSubscription.remove();
    };
  }, []);

  /*
   * The tap is acted on once someone is signed in and the authenticated stack
   * has rendered — this effect runs after that commit. A tap while signed out
   * waits for the sign-in rather than being dropped.
   */
  const ready = signedIn(session);
  useEffect(() => {
    if (!ready || pending === null) return undefined;
    const route = pending;
    let cancelled = false;
    void invalidateForNotification(queryClient, route)
      .catch(() => undefined)
      .finally(() => {
        if (cancelled) return;
        setPending((current) => (current === route ? null : current));
        // Fire-and-forget: a read receipt that fails must not hold up the navigation.
        if (route.notificationId !== null) {
          void notifyRequest(NOTIFY_PATHS.markRead(route.notificationId));
        }
        if (route.caseRef !== null) {
          router.push({ pathname: '/complaint/[caseRef]', params: { caseRef: route.caseRef } });
        } else {
          router.push('/notifications');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [ready, pending]);
}

/*
 * For a Profile "Notifications" switch: asks (or opens system settings if the OS
 * will not ask again), then registers. Answers whether push is now granted.
 */
export async function enablePushFromSettings(): Promise<boolean> {
  const granted = await askFromSettings().catch(() => false);
  const current = getSession();
  if (granted && signedIn(current)) {
    await syncRegistration(current.profile?.subject ?? '');
  }
  return granted;
}
