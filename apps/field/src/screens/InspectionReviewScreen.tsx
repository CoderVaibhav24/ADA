import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ScrollView } from 'react-native';
import { StyleSheet, View } from 'react-native';

import { ReviewSummary, type ReviewGate } from '@/design-system/organisms/ReviewSummary';
import { ActionRow, ConfirmSheet, Glyph, Notice, WButton, WIcon, WText } from '@/design-system/organisms/wizard/kit';
import { inspectionKeys } from '@/services/api/inspection-reads';
import { useT } from '@/services/i18n';
import { REVIEW_FIELDS } from '@/services/inspection/answers';
import { useInspectionRound, useQueuedSubmit, useRoundSync, useStuckPhotos, roundQueryKey } from '@/services/inspection/queries';
import { explainRefusal } from '@/services/inspection/refusals';
import { rememberStep, roundNotice } from '@/services/inspection/rounds';
import { drainSubmit, queueSubmit, refusalError } from '@/services/inspection/submit';

import { StuckPhotosNotice } from './inspection/StuckPhotosNotice';
import { WizardFrame } from './inspection/WizardFrame';

const STEP_ROUTE = {
  1: '/inspection/[caseRef]/check-in',
  2: '/inspection/[caseRef]/photos',
  3: '/inspection/[caseRef]/findings',
} as const;

// Step 4 of 4 (`187:875`). The stored answers, the recommendation, then Submit — asked once, held when offline.
export function InspectionReviewScreen() {
  const { caseRef } = useLocalSearchParams<{ caseRef: string }>();
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const round = useInspectionRound(caseRef);
  const inspectionRef = round.data?.inspectionRef ?? null;
  const queued = useQueuedSubmit(caseRef);
  const stuck = useStuckPhotos(caseRef, inspectionRef);
  const scroll = useRef<ScrollView>(null);
  const [gate, setGate] = useState<ReviewGate>({ ready: false, blockers: [] });
  const onGateChange = useCallback((next: ReviewGate) => setGate(next), []);
  const [attempt, setAttempt] = useState(0);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  useRoundSync(caseRef, inspectionRef);
  useEffect(() => {
    rememberStep(caseRef, 'review');
  }, [caseRef, inspectionRef]);

  const toDone = useCallback(
    () => router.replace({ pathname: '/inspection/[caseRef]/done', params: { caseRef } }),
    [router, caseRef],
  );

  // A held submit that lands while this step is open moves on to the confirmation.
  const wasQueued = useRef(queued?.state === 'queued');
  useEffect(() => {
    if (wasQueued.current && queued === null) toDone();
    wasQueued.current = queued?.state === 'queued';
  }, [queued, toDone]);

  const refused = queued?.state === 'refused' ? explainRefusal(refusalError(queued)) : null;
  const held = queued?.state === 'queued';
  const heldOnPhoto = held && stuck.retake.length + stuck.retry.length > 0;
  const stepThreeFixes = useMemo(
    () =>
      refused === null
        ? []
        : Object.entries(refused.fields).filter(([field]) => !(REVIEW_FIELDS as readonly string[]).includes(field)),
    [refused],
  );

  const back = () => router.dismissTo({ pathname: '/inspection/[caseRef]/findings', params: { caseRef } });

  const onSubmitPress = () => {
    if (busy || held) return;
    if (!gate.ready) {
      setAttempt((count) => count + 1);
      scroll.current?.scrollToEnd({ animated: true });
      return;
    }
    setAsking(true);
  };

  // One tap, one key: the tap is recorded first, then sent; offline it stays held.
  const onConfirm = async () => {
    setAsking(false);
    if (inspectionRef === null || busy) return;
    setBusy(true);
    try {
      queueSubmit(caseRef, inspectionRef);
      const outcome = await drainSubmit(caseRef);
      if (outcome.kind === 'sent') {
        queryClient.setQueryData(inspectionKeys.detail(inspectionRef), outcome.detail);
        void queryClient.invalidateQueries({ queryKey: roundQueryKey(caseRef) });
        toDone();
      } else if (
        outcome.kind === 'offline' ||
        outcome.kind === 'uploading' ||
        outcome.kind === 'serverBusy' ||
        outcome.kind === 'evidenceStuck'
      ) {
        toDone();
      } else if (outcome.kind === 'refused') {
        setAttempt((count) => count + 1);
        scroll.current?.scrollTo({ y: 0, animated: true });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <WizardFrame
      ref={scroll}
      caseRef={caseRef}
      step={4}
      title={t('review.title')}
      body={t('review.body')}
      notice={roundNotice(round.data, round.error, round.isPlaceholderData)}
      onRetryRound={() => void round.refetch()}
      onBack={back}
    >
      {heldOnPhoto ? (
        <StuckPhotosNotice stuck={stuck} onOpenPhotos={() => router.dismissTo({ pathname: STEP_ROUTE[2], params: { caseRef } })} />
      ) : held ? (
        <Notice tone="warn" icon="offline" title={t('review.queued.title')} body={t('review.queued.body')} />
      ) : null}
      {refused !== null ? (
        <Notice tone="error" title={t('review.refused.title')} body={t(refused.summary)}>
          {stepThreeFixes.map(([field, key]) => (
            <View key={field} style={styles.fixRow}>
              <WIcon name="alert" size={16} color="error" />
              <WText variant="note" color="error" style={styles.shrink}>
                {key === undefined ? '' : t(key)}
              </WText>
            </View>
          ))}
          {refused.outside.map((key) => (
            <WText key={key} variant="note" color="error">
              {t(key)}
            </WText>
          ))}
          {stepThreeFixes.length > 0 ? (
            <WButton
              label={t('review.goStep', { step: 3 })}
              variant="secondary"
              onPress={back}
              trailing={<Glyph name="chevronRight" />}
            />
          ) : null}
          {refused.reference !== null ? (
            <WText variant="caption" color="beige" selectable>
              {t('wizard.reference', { id: refused.reference })}
            </WText>
          ) : null}
        </Notice>
      ) : null}

      <ReviewSummary
        caseRef={caseRef}
        inspectionRef={inspectionRef}
        refusal={refused?.fields}
        attempt={attempt}
        onGateChange={onGateChange}
        onGoToStep={(step) => router.dismissTo({ pathname: STEP_ROUTE[step], params: { caseRef } })}
        locked={held || busy}
      />

      {inspectionRef === null ? <Notice tone="warn" icon="offline" body={t('wizard.notice.offlineNotOpen')} /> : null}

      <ActionRow style={styles.actions}>
        <WButton label={t('common.back')} variant="secondary" onPress={back} leading={<Glyph name="chevronLeft" />} />
        <WButton
          label={busy ? t('review.sending') : t('review.submit')}
          onPress={onSubmitPress}
          disabled={held || inspectionRef === null}
          loading={busy}
          leading={<Glyph name="tick" />}
          accessibilityHint={t('review.submitHint')}
        />
      </ActionRow>

      <ConfirmSheet
        visible={asking}
        title={t('review.confirm.title')}
        body={t('review.confirm.body')}
        confirmLabel={t('review.confirm.yes')}
        cancelLabel={t('review.confirm.no')}
        confirmIcon={<Glyph name="tick" />}
        onConfirm={() => void onConfirm()}
        onCancel={() => setAsking(false)}
      />
    </WizardFrame>
  );
}

const styles = StyleSheet.create({
  fixRow: { flexDirection: 'row', gap: 6 },
  shrink: { flexShrink: 1 },
  // 187:884 pb 29 above the action row.
  actions: { paddingTop: 15 },
});
