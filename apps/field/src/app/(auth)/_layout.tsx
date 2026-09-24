import { Stack } from 'expo-router';

import { sceneBackground } from '@/design-system';

/*
 * The unauthenticated stack. Mirrors `(app)/_layout.tsx`: a headerless `Stack`
 * whose only job is to make the group name `(auth)` resolve to a route. Without
 * this file the route is `(auth)/login` with no `(auth)` layout backing it, the
 * root `Stack.Protected` guard for `(auth)` matches nothing, and a sign-in can
 * leave the app stuck on Login even after the session becomes signed in.
 */
export default function AuthLayout() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: sceneBackground }}>
      <Stack.Screen name="language" />
      <Stack.Screen name="login" />
    </Stack>
  );
}
