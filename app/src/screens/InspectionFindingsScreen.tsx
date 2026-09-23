import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { Text, WizardStepTemplate } from '@/design-system';
import { FindingsForm, type FindingsGate } from '@/design-system/organisms/FindingsForm';
import { AdaApiError } from '@/services/api/errors';
import { inspectionKeys } from '@/services/api/inspection-reads';
import {
  FINDINGS_FIELDS,
  FindingsInvalid,
  sendFindings,
  type FindingsErrors,
  type FindingsField,
} from '@/services/inspection/findings';
import { useInspectionRound, useRoundSync } from '@/services/inspection/queries';
import { STEP_TITLES, rememberStep, roundNotice } from '@/services/inspection/rounds';

// Narrows the field the server named to one of the form's own.
function isFindingsField(field: string | null): field is FindingsField {
  return field !== null && (FINDINGS_FIELDS as readonly string[]).includes(field);
}

// Step 3 of 4 (`179:7242`). Drafts on blur; Next sends the stored draft with PUT.
export function InspectionFindingsScreen() {
  const { caseRef } = useLocalSearchParams<{ caseRef: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const round = useInspectionRound(caseRef);
  const inspectionRef = round.data?.inspectionRef ?? null;
  const [gate, setGate] = useState<FindingsGate>({ ready: false, reason: null });
  const onGateChange = useCallback((next: FindingsGate) => setGate(next), []);
  const [sending, setSending] = useState(false);
  const [serverErrors, setServerErrors] = useState<FindingsErrors>({});
  const [message, setMessage] = useState<{ text: string; failed: boolean } | null>(null);
  const notice = roundNotice(round.data, round.error, round.isPlaceholderData);

  useRoundSync(caseRef, inspectionRef);
  useEffect(() => {
    rememberStep(caseRef, 'findings');
  }, [caseRef, inspectionRef]);

  const toReview = () => router.push({ pathname: '/inspection/[caseRef]/review', params: { caseRef } });

  // Sends the stored draft. Without signal or a round it stays on the device and review sends it.
  const onNext = async () => {
    setMessage(null);
    setServerErrors({});
    if (inspectionRef === null) {
      toReview();
      return;
    }
    setSending(true);
    try {
      const detail = await sendFindings(caseRef, inspectionRef);
      queryClient.setQueryData(inspectionKeys.detail(inspectionRef), detail);
      toReview();
    } catch (error) {
      if (error instanceof FindingsInvalid) {
        setServerErrors(error.errors);
        setMessage({ text: error.message, failed: true });
      } else if (error instanceof AdaApiError && error.isOffline) {
        setMessage({ text: 'Saved on this device. It will be sent from the review step when you have signal.', failed: false });
        toReview();
      } else if (error instanceof AdaApiError) {
        if (isFindingsField(error.field)) setServerErrors({ [error.field]: error.message });
        setMessage({ text: `The office did not accept the findings: ${error.message} (${error.code})`, failed: true });
      } else {
        setMessage({ text: error instanceof Error ? error.message : String(error), failed: true });
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <WizardStepTemplate
      title="Ground inspection"
      steps={STEP_TITLES}
      current={3}
      onExit={() => navigation.getParent()?.goBack()}
      onBack={() => router.dismissTo({ pathname: '/inspection/[caseRef]/photos', params: { caseRef } })}
      onNext={() => void onNext()}
      nextDisabled={!gate.ready}
      nextLoading={sending}
      blockedReason={gate.reason ?? undefined}
      banner={
        notice !== null ? (
          <Text variant="caption" color="syncPending" accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : undefined
      }
    >
      {message !== null ? (
        <Text
          variant="body"
          color={message.failed ? 'statusOverdue' : 'syncPending'}
          accessibilityLiveRegion="polite"
        >
          {message.text}
        </Text>
      ) : null}
      <FindingsForm
        caseRef={caseRef}
        inspectionRef={inspectionRef}
        serverErrors={serverErrors}
        onGateChange={onGateChange}
      />
    </WizardStepTemplate>
  );
}
