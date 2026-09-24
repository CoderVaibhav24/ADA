import { Stack } from 'expo-router';

import { sceneBackground } from '@/design-system';

/*
 * The Complaints tab: the register, a complaint, and the inspection wizard that is
 * started from it (the wizard lives under Complaints in every frame, 04–08). The
 * register is the anchor, so a complaint opened from Home or a notification still
 * has the list under it and Back returns there.
 */
export const unstable_settings = { anchor: 'complaints' };

export default function ComplaintsStack() {
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: sceneBackground }}>
      <Stack.Screen name="complaints" />
      <Stack.Screen name="complaint/[caseRef]" />
      <Stack.Screen name="inspection/[caseRef]" />
    </Stack>
  );
}
