import { Stack } from 'expo-router';

/*
 * The authenticated stack. The tab bar is one child of it; everything reached
 * from a tab — a complaint, the notification list, the inspection wizard — is a
 * sibling, so it covers the tabs rather than living inside one. Complaint and
 * Notifications draw their own header from the design system's templates.
 */
export default function AppLayout() {
  return (
    <Stack>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="complaint/[caseRef]" options={{ headerShown: false }} />
      <Stack.Screen name="notifications" options={{ headerShown: false }} />
      <Stack.Screen name="inspection/[caseRef]" options={{ headerShown: false }} />
    </Stack>
  );
}
