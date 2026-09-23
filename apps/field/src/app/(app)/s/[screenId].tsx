import { Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';

import { SduiScreen, hasOwnHeader, useScreenDefinition } from '@/sdui';

/*
 * Any published server-driven screen, by id: `/s/home_sdui`. Every other search
 * param is handed to the definition as `{{params.<name>}}`. The navigator's header
 * shows only when the definition does not draw its own.
 */
export default function SduiRoute() {
  const raw = useLocalSearchParams();
  const screenId = typeof raw.screenId === 'string' ? raw.screenId : '';

  const params = useMemo(() => {
    const flat: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'screenId') continue;
      const first = Array.isArray(value) ? value[0] : value;
      if (typeof first === 'string') flat[key] = first;
    }
    return flat;
  }, [raw]);

  const { envelope } = useScreenDefinition(screenId);

  return (
    <>
      <Stack.Screen options={{ headerShown: !hasOwnHeader(envelope), title: envelope?.title ?? '' }} />
      <SduiScreen screenId={screenId} params={params} />
    </>
  );
}
