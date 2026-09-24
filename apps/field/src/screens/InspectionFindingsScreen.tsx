import { useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ScrollView } from 'react-native';
import { View } from 'react-native';

import { FindingsForm } from '@/design-system/organisms/FindingsForm';
import { ActionRow, Glyph, Notice, WButton, WText } from '@/design-system/organisms/wizard/kit';
import { useEnglishLabels } from '@/design-system/organisms/wizard/options';
import { inspectionKeys } from '@/services/api/inspection-reads';
import { useT, type PlainKey } from '@/services/i18n';
import { ANSWER_FIELDS, validateAnswers, type AnswerErrors, type AnswerField } from '@/services/inspection/answers';
import { FindingsInvalid, readAnswers, sendFindings } from '@/services/inspection/findings';
import { useInspectionRound, useRoundSync } from '@/services/inspection/queries';
import { explainRefusal } from '@/services/inspection/refusals';
import { rememberStep, roundNotice } from '@/services/inspection/rounds';
import { useIsOnline } from '@/services/net/connectivity';

import { WizardFrame } from './inspection/WizardFrame';

// Step 3 of 4 (`179:7242`). Drafts on blur; Next checks every answer, then sends the stored draft.
export function InspectionFindingsScreen() {
  const { caseRef } = useLocalSearchParams<{ caseRef: string }>();
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const online = useIsOnline();
  const labels = useEnglishLabels();
  const round = useInspectionRound(caseRef);
  const inspectionRef = round.data?.inspectionRef ?? null;
  const scroll = useRef<ScrollView>(null);
  const formTop = useRef(0);
  // Where each field sits in the form, filled by onLayout; a Map so layout never re-renders.
  const [positions] = useState(() => new Map<AnswerField, number>());
  const [focusField, setFocusField] = useState<AnswerField | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [sending, setSending] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [serverErrors, setServerErrors] = useState<AnswerErrors>({});
  const [message, setMessage] = useState<{ key: PlainKey; tone: 'error' | 'warn'; reference: string | null } | null>(null);

  useRoundSync(caseRef, inspectionRef);
  useEffect(() => {
    rememberStep(caseRef, 'findings');
  }, [caseRef, inspectionRef]);

  const back = () => router.dismissTo({ pathname: '/inspection/[caseRef]/photos', params: { caseRef } });
  const toReview = useCallback(
    () => router.push({ pathname: '/inspection/[caseRef]/review', params: { caseRef } }),
    [router, caseRef],
  );

  const showProblem = (field: AnswerField) => {
    setFocusField(field);
    scroll.current?.scrollTo({ y: Math.max(0, formTop.current + (positions.get(field) ?? 0) - 16), animated: true });
  };

  // Sends the stored draft. Without signal or a round it stays on the device and review sends it.
  const send = async () => {
    if (inspectionRef === null || !online) {
      toReview();
      return;
    }
    setSending(true);
    try {
      const detail = await sendFindings(caseRef, inspectionRef, 'findings', labels);
      queryClient.setQueryData(inspectionKeys.detail(inspectionRef), detail);
      toReview();
    } catch (error) {
      if (error instanceof FindingsInvalid) {
        setInvalid(true);
        return;
      }
      const refusal = explainRefusal(error);
      if (refusal.offline) {
        toReview();
        return;
      }
      setServerErrors(refusal.fields);
      setMessage({ key: refusal.summary, tone: 'error', reference: refusal.reference });
      const first = ANSWER_FIELDS.find((field) => refusal.fields[field] !== undefined);
      if (first !== undefined) showProblem(first);
    } finally {
      setSending(false);
    }
  };

  // Next: every answer is checked against the stored draft; the first problem is scrolled to and focused.
  const onNext = () => {
    if (sending) return;
    setMessage(null);
    setAttempt((count) => count + 1);
    const errors = validateAnswers(readAnswers(caseRef), 'findings');
    const first = ANSWER_FIELDS.find((field) => errors[field] !== undefined || serverErrors[field] !== undefined);
    setInvalid(first !== undefined);
    if (first !== undefined) {
      showProblem(first);
      return;
    }
    void send();
  };

  return (
    <WizardFrame
      ref={scroll}
      caseRef={caseRef}
      step={3}
      title={t('findings.title')}
      body={t('findings.body')}
      notice={roundNotice(round.data, round.error, round.isPlaceholderData)}
      onRetryRound={() => void round.refetch()}
      onBack={back}
    >
      <View onLayout={(event) => (formTop.current = event.nativeEvent.layout.y)}>
        <FindingsForm
          caseRef={caseRef}
          inspectionRef={inspectionRef}
          serverErrors={serverErrors}
          onServerErrorSeen={(field: AnswerField) =>
            setServerErrors((previous) => {
              const next = { ...previous };
              delete next[field];
              return next;
            })
          }
          attempt={attempt}
          focusField={focusField}
          onFieldLayout={(field, y) => positions.set(field, y)}
        />
      </View>
      {invalid ? <Notice tone="error" body={t('findings.fixErrors')} /> : null}
      {message !== null ? (
        <Notice tone={message.tone} body={t(message.key)}>
          {message.reference !== null ? (
            <WText variant="caption" color="beige" selectable>
              {t('wizard.reference', { id: message.reference })}
            </WText>
          ) : null}
        </Notice>
      ) : null}
      <ActionRow>
        <WButton label={t('common.back')} variant="secondary" onPress={back} leading={<Glyph name="chevronLeft" />} />
        <WButton label={t('common.next')} onPress={onNext} loading={sending} trailing={<Glyph name="chevronRight" />} />
      </ActionRow>
    </WizardFrame>
  );
}
