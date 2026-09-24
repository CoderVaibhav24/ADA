/**
 * ReviewSummary — step 4 (`187:875`). What will be submitted, read-only, assembled from
 * what is stored on the device (the answers draft, the check-in record, the captures),
 * so a value that failed to store shows as "Not filled" rather than being carried
 * (ui-rules.md §5). Then the Recommendation (list 17), fixed or suggested by the
 * encroachment answer, and a checklist of anything still owed before Submit.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';

import { useCaseDetail } from '@/services/api/case-reads';
import { useInspectionDetail } from '@/services/api/inspection-reads';
import { useAppConfig } from '@/services/config/use-app-config';
import { intlLocale, useT, useTPlural, type PlainKey } from '@/services/i18n';
import {
  PARTIAL_DEFAULT,
  encroachmentOf,
  isEnforcement,
  isHidden,
  noticeAnswer,
  noticeFixed,
  parseArea,
  parseSide,
  recommendationChoices,
  recommendationFixed,
  roundSqm,
  sectionsOf,
  sidesArea,
  toggleSection,
  validateAnswer,
  validateAnswers,
  type AnswerErrors,
} from '@/services/inspection/answers';
import { answersOf, findingsFrom, findingsSnapshot, saveAnswer, subscribeToFindings } from '@/services/inspection/findings';
import { useCheckInRecord, useRoundCaptures } from '@/services/inspection/queries';
import { cannotBeSent } from '@/services/storage/captures';

import { type LayoutStyle } from '../tokens';
import { wizardColors, wizardMetrics as m, type WizardColor } from '../tokens/wizard';
import { Field, OptionChecklist, OptionSelect } from './wizard/fields';
import { Glyph, WButton, WIcon, WText, type WizardIconName } from './wizard/kit';
import { optionIcon, useWizardOptions, type WizardOption } from './wizard/options';

export type ReviewBlocker = 'arrival' | 'photos' | 'answers' | 'recommendation' | 'notice';

export type ReviewGate = { readonly ready: boolean; readonly blockers: readonly ReviewBlocker[] };

export type ReviewSummaryProps = {
  caseRef: string;
  inspectionRef: string | null;
  /** Server refusals from the last submit, by field, already in words. */
  refusal?: AnswerErrors;
  /** Bumped on a blocked Submit: the recommendation's problem and the checklist are shown. */
  attempt: number;
  onGateChange: (gate: ReviewGate) => void;
  /** The checklist's "Go to step n". */
  onGoToStep: (step: 1 | 2 | 3) => void;
  /** While a submit is held or sending, nothing is editable. */
  locked?: boolean;
  style?: LayoutStyle;
};

// "Permanent Structure (RCC)" → ["Permanent Structure", "(RCC)"], as 187:1281 sets it on two lines.
function splitParenthetical(label: string): [string, string | null] {
  const match = /^(.*?)\s*(\([^)]*\))\s*$/.exec(label);
  return match === null ? [label, null] : [match[1], match[2]];
}

type RowValue = { text: string; sub?: string | null; tone?: WizardColor; icon?: WizardIconName };

// One label/value row with the dashed divider under it (187:1281).
function SummaryRow({ label, value }: { label: string; value: RowValue }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value.text}${value.sub ? ` ${value.sub}` : ''}`}>
      <WText variant="summaryLabel" color="summaryLabel" style={styles.rowLabel}>
        {label}
      </WText>
      <View style={styles.rowValue}>
        <View style={styles.valueLine}>
          {value.icon ? <WIcon name={value.icon} size={14} color={value.tone ?? 'white'} /> : null}
          <WText variant="summaryValue" color={value.tone ?? 'white'} align="right" style={styles.shrink}>
            {value.text}
          </WText>
        </View>
        {value.sub ? (
          <WText variant="summarySub" color="beige" align="right">
            {value.sub}
          </WText>
        ) : null}
      </View>
    </View>
  );
}

const BLOCKER_TEXT: Record<Exclude<ReviewBlocker, 'photos'>, PlainKey> = {
  arrival: 'review.check.arrival',
  answers: 'review.check.answers',
  recommendation: 'review.check.recommendation',
  notice: 'review.check.notice',
};
const BLOCKER_STEP: Record<ReviewBlocker, 1 | 2 | 3 | null> = {
  arrival: 1,
  photos: 2,
  answers: 3,
  recommendation: null,
  notice: null,
};
// Blockers answered on this step, shown under their own fields rather than in the checklist.
const INLINE_BLOCKERS: readonly ReviewBlocker[] = ['recommendation', 'notice'];

// Step 4: the stored answers, the recommendation, and what is still owed.
export function ReviewSummary({
  caseRef,
  inspectionRef,
  refusal,
  attempt,
  onGateChange,
  onGoToStep,
  locked = false,
  style,
}: ReviewSummaryProps) {
  const t = useT();
  const tp = useTPlural();
  const { config } = useAppConfig();
  const caseDetail = useCaseDetail(caseRef);
  const detail = useInspectionDetail(inspectionRef);
  const checkIn = useCheckInRecord(caseRef, inspectionRef);
  const captures = useRoundCaptures(caseRef, inspectionRef);
  const subscribe = useCallback((listener: () => void) => subscribeToFindings(caseRef, listener), [caseRef]);
  const read = useCallback(() => findingsSnapshot(caseRef), [caseRef]);
  const snapshot = useSyncExternalStore(subscribe, read);
  const answers = useMemo(() => answersOf(findingsFrom(snapshot)?.values ?? {}), [snapshot]);

  const encroachment = useWizardOptions('encroachment');
  const areaTypes = useWizardOptions('areaType');
  const stages = useWizardOptions('constructionStage');
  const propertyTypes = useWizardOptions('propertyType');
  const support = useWizardOptions('support');
  const choices = recommendationChoices(answers);
  const recommendation = useWizardOptions('recommendation', choices);
  const acts = useWizardOptions('act');
  const sections = useWizardOptions('section', undefined, answers.notice_act_cd === '' ? undefined : answers.notice_act_cd);
  const noticeOptions: readonly WizardOption[] = [
    { code: 'yes', label: t('wizard.opt.notice.yes'), icon: 'notice' },
    { code: 'no', label: t('wizard.opt.notice.no'), icon: 'noAction' },
  ];
  const notice = noticeAnswer(answers);
  const noticeLocked = noticeFixed(answers);

  // A false positive fixes "no action"; partial suggests further investigation (still editable).
  const fixed = recommendationFixed(answers);
  useEffect(() => {
    if (locked) return;
    if (fixed && answers.recommendation_cd !== 'no_action_required') saveAnswer(caseRef, 'recommendation_cd', 'no_action_required');
    if (encroachmentOf(answers) === 'partial' && answers.recommendation_cd === '') saveAnswer(caseRef, 'recommendation_cd', PARTIAL_DEFAULT);
  }, [answers, caseRef, fixed, locked]);

  // Photos that count: camera captures the office has not refused, plus any it holds that this phone does not.
  const onDevice = captures.filter((record) => record.kind === 'photo' && record.geo.captureSource === 'camera');
  const uploadedIds = new Set(onDevice.map((record) => record.serverEvidenceId).filter((id) => id !== null));
  const serverOnly = (detail.data?.evidence ?? []).filter(
    (row) => row.kind === 'photo' && row.capture_source === 'camera' && !uploadedIds.has(String(row.id)),
  );
  const photoCount =
    onDevice.filter((record) => !cannotBeSent(record)).length + serverOnly.length;
  const arrival: 'recorded' | 'held' | 'missing' =
    checkIn?.state === 'confirmed' || (detail.data?.check_ins ?? []).length > 0
      ? 'recorded'
      : checkIn?.state === 'held'
        ? 'held'
        : 'missing';

  const stepThree = validateAnswers(answers, 'findings');
  const recommendationProblem = validateAnswer('recommendation_cd', answers, 'review');
  const noticeProblems = {
    notice_required: validateAnswer('notice_required', answers, 'review'),
    notice_act_cd: validateAnswer('notice_act_cd', answers, 'review'),
    section_cds: validateAnswer('section_cds', answers, 'review'),
  };
  const blockers: ReviewBlocker[] = [];
  if (arrival === 'missing') blockers.push('arrival');
  if (photoCount < config.minimumPhotoCount) blockers.push('photos');
  if (Object.keys(stepThree).length > 0) blockers.push('answers');
  if (recommendationProblem !== null) blockers.push('recommendation');
  if (Object.values(noticeProblems).some((problem) => problem !== null)) blockers.push('notice');
  const blockerKey = blockers.join(',');
  useEffect(() => {
    onGateChange({ ready: blockerKey === '', blockers: blockerKey === '' ? [] : (blockerKey.split(',') as ReviewBlocker[]) });
  }, [onGateChange, blockerKey]);

  const missing: RowValue = { text: t('review.value.missing'), tone: 'missing', icon: 'alert' };
  const notNeeded: RowValue = { text: t('review.value.notNeeded') };
  const enforcement = isEnforcement(answers);

  const number = (value: number) => value.toLocaleString(intlLocale(), { maximumFractionDigits: 2 });
  const area = parseArea(answers.area_sqft);
  const sides = sidesArea(answers);
  const areaValue: RowValue = isHidden('area_sqft', answers)
    ? notNeeded
    : area.ok
      ? { text: t('review.value.area', { sqft: number(area.sqft), sqm: number(roundSqm(area.sqm)) }) }
      : sides !== null
        ? {
            text: t('review.value.area', { sqft: number(sides.sqft), sqm: number(sides.sqm) }),
            sub: t('review.value.areaFromSides'),
          }
        : enforcement
          ? missing
          : { text: t('wizard.dash') };
  const length = parseSide(answers.length_ft);
  const width = parseSide(answers.width_ft);
  const sidesValue: RowValue | null =
    isHidden('length_ft', answers) || (answers.length_ft === '' && answers.width_ft === '')
      ? null
      : {
          text: t('review.value.sides', {
            length: length.ok ? number(length.ft) : t('wizard.dash'),
            width: width.ok ? number(width.ft) : t('wizard.dash'),
          }),
          sub: t('review.value.sidesMetres', {
            length: length.ok ? number(length.m) : t('wizard.dash'),
            width: width.ok ? number(width.m) : t('wizard.dash'),
          }),
        };
  const stageValue: RowValue | null =
    isHidden('construction_stage_cd', answers) || answers.construction_stage_cd === ''
      ? null
      : { text: stages.labelOf(answers.construction_stage_cd) };
  const [typeMain, typeSub] = splitParenthetical(answers.area_type_cd === '' ? '' : areaTypes.labelOf(answers.area_type_cd));
  const typeValue: RowValue = isHidden('area_type_cd', answers)
    ? notNeeded
    : answers.area_type_cd !== ''
      ? { text: typeMain, sub: typeSub }
      : enforcement
        ? missing
        : { text: t('wizard.dash') };
  const encroachmentValue: RowValue =
    answers.encroachment_confirmed_cd !== '' ? { text: encroachment.labelOf(answers.encroachment_confirmed_cd) } : missing;
  const supportValue: RowValue = isHidden('external_support_cd', answers)
    ? notNeeded
    : answers.external_support_cd !== ''
      ? { text: support.labelOf(answers.external_support_cd) }
      : enforcement
        ? missing
        : { text: t('wizard.dash') };
  const photosValue: RowValue =
    photoCount >= config.minimumPhotoCount
      ? { text: tp('review.photos', photoCount) }
      : { text: tp('review.photos', photoCount), tone: 'missing', icon: 'alert' };
  const arrivalValue: RowValue =
    arrival === 'recorded'
      ? { text: t('review.arrival.recorded'), icon: 'ok' }
      : arrival === 'held'
        ? { text: t('review.arrival.held'), icon: 'clock' }
        : { text: t('review.arrival.missing'), tone: 'missing', icon: 'alert' };

  const propertyParts = [
    answers.property_type_cd === '' ? '' : propertyTypes.labelOf(answers.property_type_cd),
    answers.floor_count === '' ? '' : t('review.value.floors', { count: answers.floor_count }),
  ].filter((part) => part !== '');
  const propertyValue: RowValue | null =
    propertyParts.length > 0 || answers.police_station !== ''
      ? { text: propertyParts.join(', ') || t('wizard.dash'), sub: answers.police_station || null }
      : null;

  const recommendationError =
    refusal?.recommendation_cd ?? (attempt > 0 && recommendationProblem !== null ? recommendationProblem : undefined);
  const noticeError = (field: keyof typeof noticeProblems): string | null => {
    const key = refusal?.[field] ?? (attempt > 0 ? noticeProblems[field] ?? undefined : undefined);
    return key === undefined ? null : t(key);
  };
  const showChecklist = attempt > 0 && blockers.some((blocker) => !INLINE_BLOCKERS.includes(blocker));

  return (
    <View style={[styles.stack, style]}>
      <View style={styles.card}>
        <SummaryRow label={t('review.row.parcel')} value={{ text: caseDetail.data?.parcel_id ?? t('wizard.dash') }} />
        <SummaryRow label={t('review.row.area')} value={areaValue} />
        {sidesValue !== null ? <SummaryRow label={t('review.row.sides')} value={sidesValue} /> : null}
        <SummaryRow label={t('review.row.type')} value={typeValue} />
        {stageValue !== null ? <SummaryRow label={t('review.row.stage')} value={stageValue} /> : null}
        <SummaryRow label={t('review.row.encroachment')} value={encroachmentValue} />
        <SummaryRow label={t('review.row.support')} value={supportValue} />
        <SummaryRow label={t('review.row.photos')} value={photosValue} />
        <SummaryRow label={t('review.row.arrival')} value={arrivalValue} />
        {answers.occupant_name !== '' ? (
          <SummaryRow label={t('review.row.occupant')} value={{ text: answers.occupant_name, sub: answers.occupant_phone || null }} />
        ) : null}
        {answers.owner_name !== '' ? (
          <SummaryRow label={t('review.row.owner')} value={{ text: answers.owner_name, sub: answers.owner_phone || null }} />
        ) : null}
        {propertyValue !== null ? <SummaryRow label={t('review.row.property')} value={propertyValue} /> : null}
        {answers.officer_note !== '' ? (
          <SummaryRow label={t('review.row.remarks')} value={{ text: answers.officer_note.length > 120 ? `${answers.officer_note.slice(0, 117)}…` : answers.officer_note }} />
        ) : null}
      </View>

      <Field
        label={t('review.recommendation.label')}
        icon="notice"
        required
        error={recommendationError === undefined ? null : t(recommendationError)}
        hint={
          fixed
            ? t('review.recommendation.fixed')
            : encroachmentOf(answers) === 'partial' && answers.recommendation_cd === PARTIAL_DEFAULT
              ? t('review.recommendation.suggested')
              : null
        }
      >
        <OptionSelect
          label={t('review.recommendation.label')}
          value={answers.recommendation_cd}
          options={recommendation.options}
          labelOf={recommendation.labelOf}
          optionIcon={(code) => optionIcon('recommendation', code)}
          invalid={recommendationError !== undefined}
          locked={fixed || locked}
          onChange={(code) => saveAnswer(caseRef, 'recommendation_cd', code)}
        />
      </Field>

      <Field
        label={t('review.notice.label')}
        icon="notice"
        required={answers.recommendation_cd !== ''}
        error={noticeError('notice_required')}
        hint={noticeLocked ? t('review.notice.fixed') : null}
      >
        <OptionSelect
          label={t('review.notice.label')}
          value={notice === null ? '' : notice ? 'yes' : 'no'}
          options={noticeOptions}
          labelOf={(code) => noticeOptions.find((option) => option.code === code)?.label ?? code}
          optionIcon={(code) => (code === 'yes' ? 'notice' : 'noAction')}
          invalid={noticeError('notice_required') !== null}
          locked={noticeLocked || locked}
          onChange={(code) => saveAnswer(caseRef, 'notice_required', code)}
        />
      </Field>

      {notice === true ? (
        <Field
          label={t('review.act.label')}
          icon="legal"
          required
          error={noticeError('notice_act_cd')}
          hint={acts.fromServer ? null : t('findings.optionsOffline')}
        >
          <OptionSelect
            label={t('review.act.label')}
            value={answers.notice_act_cd}
            options={acts.options}
            labelOf={acts.labelOf}
            optionIcon={(code) => optionIcon('act', code)}
            invalid={noticeError('notice_act_cd') !== null}
            locked={locked}
            onChange={(code) => {
              if (code !== answers.notice_act_cd) saveAnswer(caseRef, 'section_cds', '');
              saveAnswer(caseRef, 'notice_act_cd', code);
            }}
          />
        </Field>
      ) : null}

      {notice === true && answers.notice_act_cd !== '' ? (
        <Field
          label={t('review.sections.label')}
          icon="note"
          required
          error={noticeError('section_cds')}
          hint={t('review.sections.hint')}
        >
          <OptionChecklist
            options={sections.options}
            selected={sectionsOf(answers)}
            invalid={noticeError('section_cds') !== null}
            locked={locked}
            onToggle={(code) => saveAnswer(caseRef, 'section_cds', toggleSection(answers, code))}
          />
        </Field>
      ) : null}

      {showChecklist ? (
        <View style={styles.checklist} accessibilityRole="summary" accessibilityLiveRegion="polite">
          <WText variant="noteBold" color="warn">
            {t('review.blocked.title')}
          </WText>
          {blockers
            .filter((blocker) => !INLINE_BLOCKERS.includes(blocker))
            .map((blocker) => {
              const step = BLOCKER_STEP[blocker];
              return (
                <View key={blocker} style={styles.checkRow}>
                  <WIcon name="alert" size={18} color="error" />
                  <WText variant="note" color="stepBody" style={styles.shrink}>
                    {blocker === 'photos'
                      ? t('review.check.photos', { min: config.minimumPhotoCount })
                      : t(BLOCKER_TEXT[blocker])}
                  </WText>
                  {step !== null ? (
                    <WButton
                      label={t('review.goStep', { step })}
                      variant="secondary"
                      onPress={() => onGoToStep(step)}
                      trailing={<Glyph name="chevronRight" />}
                      style={styles.goButton}
                    />
                  ) : null}
                </View>
              );
            })}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: m.fieldGap, paddingTop: 6 },
  shrink: { flexShrink: 1 },
  card: {
    padding: m.summaryPad,
    gap: m.summaryGap,
    borderRadius: m.cardRadius,
    borderWidth: m.hairline,
    borderColor: wizardColors.summaryBorder,
    backgroundColor: wizardColors.summary,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
    paddingBottom: 10,
    borderBottomWidth: m.hairline,
    borderStyle: 'dashed',
    borderBottomColor: wizardColors.summaryDivider,
  },
  rowLabel: { flexShrink: 1, flexBasis: '48%', paddingTop: 2 },
  rowValue: { flexShrink: 1, alignItems: 'flex-end', flexBasis: '50%' },
  valueLine: { flexDirection: 'row', alignItems: 'center', gap: 4, justifyContent: 'flex-end' },
  checklist: {
    gap: 10,
    padding: 14,
    borderRadius: m.controlRadius,
    borderWidth: m.hairline,
    borderColor: wizardColors.noticeBorderWarn,
    backgroundColor: wizardColors.noticeFill,
  },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  goButton: { flex: 0, minWidth: 140, marginLeft: 'auto' },
});
