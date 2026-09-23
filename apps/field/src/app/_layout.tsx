import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect } from 'react';

import { persistOptions, queryClient, wireQueryLifecycle } from '@/services/api/query-client';
import { restoreSession } from '@/services/auth/session';
import { usePushNotifications } from '@/services/push';
import { useSessionStore } from '@/store/session-store';

/*
 * The root of the navigation tree (`ui-registry.md` §2).
 *
 *   /            redirects on session state
 *   (auth)       Login — unauthenticated
 *   (app)        Tabs, plus ComplaintDetail, Notifications and the inspection
 *                wizard as stack routes
 *
 * `Stack.Protected` is the guard, not a redirect inside a screen: a screen that
 * redirects has already mounted, and a screen that has mounted has already asked
 * the API for something it is not entitled to.
 *
 * A `stale` session — tokens expired, no network — counts as signed in. That is
 * the whole point of Architecture.md §5: a surveyor out of coverage keeps working.
 */
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const status = useSessionStore((state) => state.status);
  const signedIn = status === 'signedIn' || status === 'stale';
  usePushNotifications();

  useEffect(() => {
    const unwire = wireQueryLifecycle();
    void restoreSession().finally(() => {
      void SplashScreen.hideAsync();
    });
    return unwire;
  }, []);

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="index" />
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn}>
          <Stack.Screen name="(app)" />
        </Stack.Protected>
      </Stack>
    </PersistQueryClientProvider>
  );
}
