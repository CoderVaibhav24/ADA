import { Stack, useNavigation, usePathname } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';

/*
 * The inspection wizard, its own stack so the four steps share one round query and
 * one exit confirmation (`ui-registry.md` §2).
 *
 * The confirmation lives here and nowhere else: it listens for this wizard's route
 * being removed from the app stack, so the Exit button, the hardware back on the
 * first step and the iOS swipe all ask the same question once. Leaving keeps the
 * draft, the check-in and every capture (ui-rules.md §5). The confirmation screen
 * is the one exit that does not ask — the work is already with the office.
 */
export default function InspectionWizardLayout() {
  const navigation = useNavigation();
  const pathname = usePathname();
  const current = useRef(pathname);
  const leaving = useRef(false);

  useEffect(() => {
    current.current = pathname;
  }, [pathname]);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (leaving.current || current.current.endsWith('/done')) return;
        event.preventDefault();
        Alert.alert(
          'Leave this inspection?',
          'Everything you have entered and photographed is kept on this device. Open the complaint again to carry on where you left off.',
          [
            { text: 'Stay', style: 'cancel' },
            {
              text: 'Leave',
              style: 'destructive',
              onPress: () => {
                leaving.current = true;
                navigation.dispatch(event.data.action);
              },
            },
          ],
        );
      }),
    [navigation],
  );

  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="check-in" />
      <Stack.Screen name="photos" />
      <Stack.Screen name="findings" />
      <Stack.Screen name="review" />
      <Stack.Screen name="done" options={{ gestureEnabled: false }} />
    </Stack>
  );
}
