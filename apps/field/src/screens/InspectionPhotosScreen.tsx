import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { Text, WizardStepTemplate } from '@/design-system';
import { PhotoGrid, type PhotoGate } from '@/design-system/organisms/PhotoGrid';
import { useInspectionRound, useRoundSync } from '@/services/inspection/queries';
import { STEP_TITLES, rememberStep, roundNotice } from '@/services/inspection/rounds';

// Step 2 of 4 (`179:6402`). Captures land on the device first and upload in the background.
export function InspectionPhotosScreen() {
  const { caseRef } = useLocalSearchParams<{ caseRef: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const round = useInspectionRound(caseRef);
  const inspectionRef = round.data?.inspectionRef ?? null;
  const [gate, setGate] = useState<PhotoGate>({ ready: false, reason: null });
  const onGateChange = useCallback((next: PhotoGate) => setGate(next), []);
  const notice = roundNotice(round.data, round.error, round.isPlaceholderData);

  useRoundSync(caseRef, inspectionRef);
  useEffect(() => {
    rememberStep(caseRef, 'photos');
  }, [caseRef, inspectionRef]);

  return (
    <WizardStepTemplate
      title="Ground inspection"
      steps={STEP_TITLES}
      current={2}
      onExit={() => navigation.getParent()?.goBack()}
      onBack={() => router.dismissTo({ pathname: '/inspection/[caseRef]/check-in', params: { caseRef } })}
      onNext={() => router.push({ pathname: '/inspection/[caseRef]/findings', params: { caseRef } })}
      nextDisabled={!gate.ready}
      blockedReason={gate.reason ?? undefined}
      banner={
        notice !== null ? (
          <Text variant="caption" color="syncPending" accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : undefined
      }
    >
      <PhotoGrid caseRef={caseRef} inspectionRef={inspectionRef} onGateChange={onGateChange} />
    </WizardStepTemplate>
  );
}
