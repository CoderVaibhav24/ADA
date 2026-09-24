import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { BackHandler, ScrollView, StyleSheet, View } from 'react-native';

import { ScreenHeader, useTabBarInset } from '@/design-system';
import { ConfirmSheet, Glyph, Notice, WButton, WIcon, WText } from '@/design-system/organisms/wizard/kit';
import { useWizardOptions } from '@/design-system/organisms/wizard/options';
import { wizardColors, wizardMetrics as m } from '@/design-system/tokens/wizard';
import { useCaseDetail } from '@/services/api/case-reads';
import { useInspectionDetail } from '@/services/api/inspection-reads';
import { intlLocale, useT } from '@/services/i18n';
import { effectiveAreaSqm } from '@/services/inspection/answers';
import { answersOf, findingsFrom, findingsSnapshot, subscribeToFindings } from '@/services/inspection/findings';
import { useInspectionRound, useQueuedSubmit, useRoundSync, useStuckPhotos } from '@/services/inspection/queries';
import { explainRefusal } from '@/services/inspection/refusals';
import { discardRefusedSubmit, isRoundGone, refusalError } from '@/services/inspection/submit';
import { useIsOnline } from '@/services/net/connectivity';
import { COMPLAINT_IN_COMPLAINTS } from '@/services/navigation/complaint-route';

import { StuckPhotosNotice } from './inspection/StuckPhotosNotice';

// "No Action Required (False Positive)" → "No Action Required", as the 08 pill shows it.
function shortLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '');
}

// Splits a message around the case reference so the reference can be set in bold (193:1536).
function aroundRef(message: string, caseRef: string): [string, string] {
  const at = message.indexOf(caseRef);
  if (at < 0) return [message, ''];
  return [message.slice(0, at), message.slice(at + caseRef.length)];
}

// Shown once the submission is sent or held on the phone (`193:1534`), and says which.
export function InspectionDoneScreen() {
  const { caseRef } = useLocalSearchParams<{ caseRef: string }>();
  const t = useT();
  const router = useRouter();
  const online = useIsOnline();
  const tabInset = useTabBarInset();
  const round = useInspectionRound(caseRef);
  const inspectionRef = round.data?.inspectionRef ?? null;
  const detail = useInspectionDetail(inspectionRef);
  const caseDetail = useCaseDetail(caseRef);
  const queued = useQueuedSubmit(caseRef);
  const stuck = useStuckPhotos(caseRef, inspectionRef);
  const [asking, setAsking] = useState(false);
  const recommendations = useWizardOptions('recommendation');
  const subscribe = useCallback((listener: () => void) => subscribeToFindings(caseRef, listener), [caseRef]);
  const read = useCallback(() => findingsSnapshot(caseRef), [caseRef]);
  const snapshot = useSyncExternalStore(subscribe, read);
  const answers = useMemo(() => answersOf(findingsFrom(snapshot)?.values ?? {}), [snapshot]);

  // Keeps a held submit moving while this screen is open.
  useRoundSync(caseRef, inspectionRef);

  const backToComplaints = useCallback(() => router.dismissTo('/complaints'), [router]);

  // The submitted round is not a step to go back into; hardware back leaves for the list.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      backToComplaints();
      return true;
    });
    return () => subscription.remove();
  }, [backToComplaints]);

  const photoStuck = stuck.retake.length + stuck.retry.length > 0;
  const state: 'sent' | 'queued' | 'uploading' | 'stuck' | 'refused' | 'gone' =
    queued?.state === 'refused'
      ? isRoundGone(queued)
        ? 'gone'
        : 'refused'
      : queued?.state === 'queued'
        ? photoStuck
          ? 'stuck'
          : online
            ? 'uploading'
            : 'queued'
        : 'sent';
  const failed = state === 'refused' || state === 'gone';
  const sent = state === 'sent';
  const server = detail.data;

  // Sent: the office's values. Held: what is stored on this phone and will be sent.
  const recommendationCode = sent ? (server?.recommendation_cd ?? null) : answers.recommendation_cd || null;
  const sqm = sent
    ? (server?.measured_area_sqm ?? null)
    : effectiveAreaSqm(answers);
  const refusal = state === 'refused' ? explainRefusal(refusalError(queued)) : null;

  const message =
    state === 'sent'
      ? t('done.sent', { caseRef })
      : state === 'uploading'
        ? t('done.uploading', { caseRef })
        : state === 'stuck'
          ? t('done.stuck', { caseRef })
          : state === 'gone'
            ? t('done.gone')
            : t('done.queued', { caseRef });
  const [before, after] = aroundRef(message, caseRef);
  const title =
    state === 'refused'
      ? t('done.refusedTitle')
      : state === 'gone'
        ? t('done.goneTitle')
        : state === 'stuck'
          ? t('done.stuckTitle')
          : sent
            ? t('done.title')
            : t('done.titleQueued');
  const statusText = sent
    ? t('done.statusSent')
    : failed
      ? t('review.refused.title')
      : state === 'stuck'
        ? t('done.statusStuck')
        : state === 'uploading'
          ? t('done.statusUploading')
          : t('done.statusQueued');
  const statusIcon = sent ? 'ok' : failed || state === 'stuck' ? 'alert' : state === 'uploading' ? 'upload' : 'offline';
  const statusColor = sent ? 'ok' : failed ? 'error' : 'warn';

  // Removes the answers for a round the office took back, after the surveyor confirms.
  const onRemove = () => {
    setAsking(false);
    discardRefusedSubmit(caseRef);
    backToComplaints();
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader variant="compact" title={sent ? t('done.title') : t('done.titleQueued')} bell="none" />
      <ScrollView contentContainerStyle={[styles.body, { paddingBottom: m.padBottom + tabInset }]}>
        <View style={styles.hero}>
          <View style={styles.disc}>
            {sent ? <Glyph name="bigTick" color="accent" /> : <WIcon name={failed || state === 'stuck' ? 'alert' : 'upload'} size={40} color="accent" />}
          </View>
          <WText variant="doneTitle" align="center" accessibilityRole="header">
            {title}
          </WText>
          <WText variant="doneBody" color="doneBody" align="center" style={styles.lead}>
            {before}
            {message.includes(caseRef) ? (
              <WText variant="doneBodyBold" color="doneBold">
                {caseRef}
              </WText>
            ) : null}
            {after}
          </WText>
          <View style={styles.status} accessibilityLiveRegion="polite">
            <WIcon name={statusIcon} size={16} color={statusColor} />
            <WText variant="note" color={statusColor}>
              {statusText}
            </WText>
          </View>
          {sent ? (
            <WText variant="note" color="doneBody" align="center">
              {t('done.next')}
            </WText>
          ) : null}
        </View>

        {state === 'refused' && refusal !== null ? (
          <Notice tone="error" body={t(refusal.summary)}>
            <WButton label={t('done.fix')} onPress={() => router.replace({ pathname: '/inspection/[caseRef]/review', params: { caseRef } })} trailing={<Glyph name="chevronRight" />} />
          </Notice>
        ) : null}
        {state === 'gone' ? (
          <Notice tone="error" body={t('done.gone')}>
            <WButton label={t('done.remove')} variant="secondary" onPress={() => setAsking(true)} leading={<WIcon name="trash" size={18} color="error" />} />
          </Notice>
        ) : null}
        {state === 'stuck' ? (
          <StuckPhotosNotice
            stuck={stuck}
            onOpenPhotos={() => router.replace({ pathname: '/inspection/[caseRef]/photos', params: { caseRef } })}
          />
        ) : null}

        <View style={styles.card}>
          <View style={[styles.row, styles.rowRule]}>
            <WText variant="summaryLabel" color="doneLabel">
              {t('done.row.parcel')}
            </WText>
            <WText variant="summaryValue" selectable style={styles.value}>
              {caseDetail.data?.parcel_id ?? t('wizard.dash')}
            </WText>
          </View>
          <View style={[styles.row, styles.rowRule]}>
            <WText variant="summaryLabel" color="doneLabel">
              {t('done.row.recommendation')}
            </WText>
            {recommendationCode !== null ? (
              <View style={styles.pill}>
                <View style={styles.pillDot} />
                <WText variant="pill" color="accent" style={styles.shrink}>
                  {shortLabel(recommendations.labelOf(recommendationCode))}
                </WText>
              </View>
            ) : (
              <WText variant="summaryValue">{t('wizard.dash')}</WText>
            )}
          </View>
          <View style={styles.row}>
            <WText variant="summaryLabel" color="doneLabel">
              {t('done.row.area')}
            </WText>
            <WText variant="summaryValue" style={styles.value}>
              {sqm === null ? t('wizard.dash') : t('done.area', { sqm: sqm.toLocaleString(intlLocale(), { maximumFractionDigits: 2 }) })}
            </WText>
          </View>
        </View>

        <View style={styles.buttons}>
          <WButton
            label={t('done.back')}
            variant="secondary"
            inkColor="secondaryInkDone"
            onPress={backToComplaints}
            leading={<Glyph name="chevronLeft" color="secondaryInkDone" />}
            style={styles.fullButton}
          />
          <WButton
            label={t('done.report')}
            onPress={() =>
              router.push({
                pathname: COMPLAINT_IN_COMPLAINTS,
                params: inspectionRef === null ? { caseRef, from: 'report' } : { caseRef, from: 'report', round: inspectionRef },
              })
            }
            leading={<Glyph name="eye" />}
            style={styles.fullButton}
          />
          {!sent ? (
            <WText variant="caption" color="beige" align="center">
              {t('done.reportQueued')}
            </WText>
          ) : null}
        </View>
      </ScrollView>
      <ConfirmSheet
        visible={asking}
        title={t('shell.pending.removeTitle')}
        body={t('shell.pending.removeBody')}
        confirmLabel={t('shell.pending.remove')}
        cancelLabel={t('shell.pending.removeKeep')}
        destructive
        confirmIcon={<WIcon name="trash" size={18} />}
        onConfirm={onRemove}
        onCancel={() => setAsking(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: wizardColors.screen },
  body: { paddingHorizontal: m.padX + 2, paddingTop: 90 + m.padTop, gap: m.gap },
  hero: { alignItems: 'center' },
  disc: {
    width: m.doneDisc,
    height: m.doneDisc,
    borderRadius: m.doneDisc / 2,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
    backgroundColor: wizardColors.successDisc,
  },
  lead: { marginTop: 8, maxWidth: m.doneBodyMax },
  status: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10, marginBottom: 4 },
  card: {
    paddingHorizontal: 17,
    paddingVertical: 5,
    marginTop: 8,
    marginBottom: 8,
    borderRadius: m.controlRadius,
    borderWidth: m.hairline,
    borderColor: wizardColors.doneCardBorder,
    backgroundColor: wizardColors.summary,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingTop: 14,
    paddingBottom: 15,
  },
  rowRule: { borderBottomWidth: m.hairline, borderStyle: 'dashed', borderBottomColor: wizardColors.doneDivider },
  value: { flexShrink: 1, textAlign: 'right' },
  shrink: { flexShrink: 1 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
    paddingHorizontal: 10,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: wizardColors.pill,
  },
  pillDot: { width: m.pillDot, height: m.pillDot, borderRadius: m.pillDot / 2, backgroundColor: wizardColors.accent },
  buttons: { gap: m.buttonGap, paddingTop: 16 },
  fullButton: { flex: 0, alignSelf: 'stretch' },
});
