import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { StateMessage, Text, WizardStepTemplate } from '@/design-system';
import { ReviewSummary, type ReviewGate } from '@/design-system/organisms/ReviewSummary';
import { errorText } from '@/services/api/error-text';
import { AdaApiError } from '@/services/api/errors';
import { inspectionKeys } from '@/services/api/inspection-reads';
import { roundQueryKey, useInspectionRound, useRoundSync } from '@/services/inspection/queries';
import { STEP_TITLES, rememberStep, roundNotice } from '@/services/inspection/rounds';
import { submitRound } from '@/services/inspection/submit';

// Step 4 of 4 (`187:875`). Read-only summary of what the office holds, then Submit.
export function InspectionReviewScreen() {
  const { caseRef } = useLocalSearchParams<{ caseRef: string }>();
  const router = useRouter();
  const navigation = useNavigation();
  const queryClient = useQueryClient();
  const round = useInspectionRound(caseRef);
  const inspectionRef = round.data?.inspectionRef ?? null;
  const [gate, setGate] = useState<ReviewGate>({ ready: false, reason: null });
  const onGateChange = useCallback((next: ReviewGate) => setGate(next), []);
  const [submitting, setSubmitting] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const notice = roundNotice(round.data, round.error, round.isPlaceholderData);

  useRoundSync(caseRef, inspectionRef);
  useEffect(() => {
    rememberStep(caseRef, 'review');
  }, [caseRef, inspectionRef]);

  /*
   * One tap, one key: the key is minted on the first tap and kept across every retry,
   * so pressing Submit again after a lost answer is answered with the round already
   * submitted, never a second one.
   */
  const onSubmit = async () => {
    if (inspectionRef === null || submitting) return;
    setSubmitting(true);
    setFailure(null);
    try {
      const detail = await submitRound(caseRef, inspectionRef);
      queryClient.setQueryData(inspectionKeys.detail(inspectionRef), detail);
      void queryClient.invalidateQueries({ queryKey: roundQueryKey(caseRef) });
      router.replace({ pathname: '/inspection/[caseRef]/done', params: { caseRef } });
    } catch (error) {
      const text = errorText(error);
      setFailure(
        text.offline
          ? 'Not sent — there is no signal. Your inspection is kept on this device; press Submit again when you have signal. It will not create a second inspection.'
          : `The office did not accept the submission: ${text.message}${error instanceof AdaApiError ? ` (${error.code})` : ''}${text.requestId ? ` — reference ${text.requestId}` : ''}`,
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <WizardStepTemplate
      title="Ground inspection"
      steps={STEP_TITLES}
      current={4}
      onExit={() => navigation.getParent()?.goBack()}
      onBack={() => router.dismissTo({ pathname: '/inspection/[caseRef]/findings', params: { caseRef } })}
      onNext={() => void onSubmit()}
      nextLabel="Submit Findings"
      nextDisabled={inspectionRef === null || !gate.ready}
      nextLoading={submitting}
      blockedReason={
        inspectionRef === null
          ? 'The inspection round is not open yet, so there is nothing on the server to submit.'
          : (gate.reason ?? undefined)
      }
      banner={
        notice !== null ? (
          <Text variant="caption" color="syncPending" accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : undefined
      }
    >
      {failure !== null ? (
        <Text variant="body" color="statusOverdue" accessibilityLiveRegion="polite">
          {failure}
        </Text>
      ) : null}
      {inspectionRef === null ? (
        <StateMessage
          tone="offline"
          title="The round is not open yet"
          message="Everything you captured is safe on this device. The review is built from what the office holds, so it appears once the round opens."
          actionLabel="Try again"
          onAction={() => void round.refetch()}
        />
      ) : (
        <ReviewSummary caseRef={caseRef} inspectionRef={inspectionRef} onGateChange={onGateChange} />
      )}
    </WizardStepTemplate>
  );
}
