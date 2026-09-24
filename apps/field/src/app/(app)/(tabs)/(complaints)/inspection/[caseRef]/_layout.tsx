import { Stack, useLocalSearchParams, useNavigation, usePathname, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';

import { ConfirmDialog, sceneBackground } from '@/design-system';
import { useT } from '@/services/i18n';
import { hasArrived } from '@/services/inspection/check-in';
import { useCheckInRecord } from '@/services/inspection/queries';
import { localRound } from '@/services/inspection/rounds';

const AFTER_CHECK_IN = /\/(photos|findings|review)$/;

/*
 * The inspection wizard, its own stack inside the Complaints tab so the four steps
 * share one round query and one exit confirmation (`ui-registry.md` §2), with the
 * tab bar still showing (04–08).
 *
 * The confirmation lives here and nowhere else: it listens for this wizard's route
 * being removed from the app stack, so the Exit button, the hardware back on the
 * first step and the iOS swipe all ask the same question once. Leaving keeps the
 * draft, the check-in and every capture (ui-rules.md §5). The confirmation screen
 * is the one exit that does not ask — the work is already with the office.
 */
export default function InspectionWizardLayout() {
  const t = useT();
  const navigation = useNavigation();
  const pathname = usePathname();
  const current = useRef(pathname);
  const leaving = useRef(false);
  // Replays the navigation the surveyor started; held while the dialog asks.
  const [held, setHeld] = useState<(() => void) | null>(null);
  const router = useRouter();
  const { caseRef } = useLocalSearchParams<{ caseRef: string }>();
  const arrived = hasArrived(useCheckInRecord(caseRef, localRound(caseRef)?.inspectionRef ?? null));

  useEffect(() => {
    current.current = pathname;
  }, [pathname]);

  // No step after check-in opens until arrival is recorded or held for this round.
  useEffect(() => {
    if (!arrived && AFTER_CHECK_IN.test(pathname)) {
      router.replace({ pathname: '/inspection/[caseRef]/check-in', params: { caseRef } });
    }
  }, [arrived, pathname, router, caseRef]);

  useEffect(
    () =>
      navigation.addListener('beforeRemove', (event) => {
        if (leaving.current || current.current.endsWith('/done')) return;
        event.preventDefault();
        const { action } = event.data;
        setHeld(() => () => navigation.dispatch(action));
      }),
    [navigation],
  );

  // Leaves for real, without asking again.
  const leave = () => {
    const replay = held;
    setHeld(null);
    if (replay === null) return;
    leaving.current = true;
    replay();
  };

  return (
    <>
      <Stack screenOptions={{ headerShown: false, contentStyle: sceneBackground }}>
        <Stack.Screen name="index" />
        <Stack.Screen name="check-in" />
        <Stack.Screen name="photos" />
        <Stack.Screen name="findings" />
        <Stack.Screen name="review" />
        <Stack.Screen name="done" options={{ gestureEnabled: false }} />
      </Stack>
      <ConfirmDialog
        testID="wizard-leave-dialog"
        visible={held !== null}
        icon="warning"
        title={t('shell.wizard.leaveTitle')}
        body={t('shell.wizard.leaveBody')}
        confirmLabel={t('shell.wizard.leave')}
        cancelLabel={t('shell.wizard.stay')}
        onConfirm={leave}
        onCancel={() => setHeld(null)}
      />
    </>
  );
}
