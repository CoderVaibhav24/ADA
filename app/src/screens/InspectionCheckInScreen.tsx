import { Redirect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { Text, StateMessage, WizardStepTemplate } from '@/design-system';
import { CheckInPanel, type StepGate } from '@/design-system/organisms/CheckInPanel';
import { useInspectionRound, useRoundSync } from '@/services/inspection/queries';
import { STEP_TITLES, isWorkable, rememberStep, roundNotice, roundRefused } from '@/services/inspection/rounds';

// Step 1 of 4 (`179:5884`). Opens or resumes the round, then gates on a check-in.
export function InspectionCheckInScreen() {
  const { caseRef } = useLocalSearchParams<{ caseRef: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const round = useInspectionRound(caseRef);
  const inspectionRef = round.data?.inspectionRef ?? null;
  const [gate, setGate] = useState<StepGate>({ ready: false, reason: null });
  const onGateChange = useCallback((next: StepGate) => setGate(next), []);

  useRoundSync(caseRef, inspectionRef);
  useEffect(() => {
    rememberStep(caseRef, 'check-in');
  }, [caseRef, inspectionRef]);

  // A round that is already submitted is shown as such, never reopened from here.
  if (round.data !== undefined && !round.isPlaceholderData && !isWorkable(round.data.status)) {
    return <Redirect href={{ pathname: '/inspection/[caseRef]/done', params: { caseRef } }} />;
  }

  const refused = roundRefused(round.data, round.error);
  const notice = roundNotice(round.data, round.error, round.isPlaceholderData);

  return (
    <WizardStepTemplate
      title="Ground inspection"
      steps={STEP_TITLES}
      current={1}
      onExit={() => navigation.getParent()?.goBack()}
      onNext={() => router.push({ pathname: '/inspection/[caseRef]/photos', params: { caseRef } })}
      nextDisabled={refused || !gate.ready}
      blockedReason={refused ? 'The round could not be opened, so arrival cannot be recorded.' : (gate.reason ?? undefined)}
      banner={
        notice !== null && !refused ? (
          <Text variant="caption" color="syncPending" accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : undefined
      }
    >
      <Text variant="mono" color="ink2" selectable>
        {inspectionRef === null ? caseRef : `${caseRef} · ${inspectionRef}`}
      </Text>
      {refused ? (
        <StateMessage
          tone="error"
          title="The inspection round could not be opened"
          message={notice ?? undefined}
          actionLabel="Try again"
          onAction={() => void round.refetch()}
        />
      ) : (
        <CheckInPanel caseRef={caseRef} inspectionRef={inspectionRef} onGateChange={onGateChange} />
      )}
    </WizardStepTemplate>
  );
}
