import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { useFonts } from 'expo-font';
import { Stack, ThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useState } from 'react';
import { View } from 'react-native';

import { fontAssets, navigationTheme, sceneBackground } from '@/design-system';
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
 *
 * The splash stays up until the session is restored and the fonts are loaded, so
 * no text is ever drawn in a fallback face first. A font that fails to load is not
 * fatal: the platform face stands in.
 */
void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const status = useSessionStore((state) => state.status);
  const signedIn = status === 'signedIn' || status === 'stale';
  const [fontsLoaded, fontError] = useFonts(fontAssets);
  const fontsSettled = fontsLoaded || fontError !== null;
  const [restored, setRestored] = useState(false);
  usePushNotifications();

  useEffect(() => {
    const unwire = wireQueryLifecycle();
    void restoreSession().finally(() => setRestored(true));
    return unwire;
  }, []);

  useEffect(() => {
    if (restored && fontsSettled) void SplashScreen.hideAsync();
  }, [restored, fontsSettled]);

  /*
   * The navigator mounts only once the session is known. Mounted earlier, the guard
   * sees `restoring` as signed out and sends a cold deep link (a push, /profile) to
   * the entry route, losing it; mounted now, the URL resolves straight into (app).
   */
  if (!fontsSettled || !restored) return <View style={[{ flex: 1 }, sceneBackground]} />;

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <ThemeProvider value={navigationTheme}>
        <Stack screenOptions={{ headerShown: false, contentStyle: sceneBackground }}>
          <Stack.Screen name="index" />
          <Stack.Protected guard={!signedIn}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
          <Stack.Protected guard={signedIn}>
            <Stack.Screen name="(app)" />
          </Stack.Protected>
        </Stack>
      </ThemeProvider>
    </PersistQueryClientProvider>
  );
}
