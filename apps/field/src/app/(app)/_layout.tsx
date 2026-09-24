import { Stack } from 'expo-router';

import { sceneBackground } from '@/design-system';
import { useQueuedSubmitDrain } from '@/services/inspection/queries';

/*
 * The authenticated stack. The tab navigator is one child; every section's own
 * screens — a complaint, the inspection wizard — live inside their tab so the tab
 * bar stays on screen, as the frames draw it (03–08, 10, 11). Notifications (13),
 * Search and Pending uploads cover the tabs: 13 hides the bar in the design, and
 * the two new screens follow it.
 */
export default function AppLayout() {
  // Held offline submits go by themselves once signed in, now and whenever the signal returns.
  useQueuedSubmitDrain();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: sceneBackground }}>
      <Stack.Screen name="(tabs)" />
      <Stack.Screen name="notifications" />
      <Stack.Screen name="search" />
      <Stack.Screen name="pending-uploads" />
      <Stack.Screen name="s/[screenId]" options={{ headerShown: true }} />
    </Stack>
  );
}
