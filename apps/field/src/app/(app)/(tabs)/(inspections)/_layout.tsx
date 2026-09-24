import { Stack } from 'expo-router';

import { sceneBackground } from '@/design-system';

/*
 * The Inspection tab: the surveyor's inspections, and a complaint opened from one
 * (10, "Back to Inspection List"). The complaint route is shared with the Complaints
 * tab; opened from here it stays here, with Inspection raised on the bar.
 */
export const unstable_settings = { anchor: 'inspections' };

export default function InspectionsStack() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: sceneBackground }}>
      <Stack.Screen name="inspections" />
      <Stack.Screen name="complaint/[caseRef]" />
    </Stack>
  );
}
