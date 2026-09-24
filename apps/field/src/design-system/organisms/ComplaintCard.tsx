/**
 * ComplaintCard — one case in the Complaints list (Figma 02, 170:4214): reference,
 * place, status (icon + word + colour), age, type, area, priority, distance and OPEN.
 * The whole card is the touch target. Distance shows only when the case's map point is
 * already on the phone and location permission was given earlier (never prompts).
 */

import { Pressable, StyleSheet, View } from 'react-native';

import type { CaseDetail, CaseRow } from '@/services/api/case-reads';
import { useCachedCaseDetail, caseCoordinates } from '@/services/api/case-reads';
import type { InspectionRow } from '@/services/api/inspection-reads';
import { useCodeValues } from '@/services/config/code-values';
import { LABEL_DOMAINS, useCodeLabel } from '@/services/config/labels';
import { phaseOf, useWorkStatuses, type WorkPhase } from '@/services/config/work-statuses';
import { formatDate } from '@/services/format/datetime';
import { intlLocale, useLocale, useT, useTPlural } from '@/services/i18n';
import { haversineMeters, type LastKnownPosition } from '@/services/location/last-known';

import { caseMetrics, casePalette } from './cases/palette';
import {
  CaseText,
  OpenChevron,
  PriorityBadge,
  StatusBadge,
  TargetGlyph,
  distanceText,
  toneOfRoundStatus,
  type StatusTone,
} from './cases/primitives';
import { Chip } from '../atoms';
import { PriorityChip, StatusChip, type CaseStatus } from '../molecules';
import type { LayoutStyle } from '../tokens';

const DAY_MS = 24 * 60 * 60 * 1000;

// Where the case sits in this officer's work decides the look; the word is the server's label.
const phaseTone: Record<WorkPhase, StatusTone> = {
  to_start: 'new',
  underway: 'in_progress',
  handed_in: 'completed',
  other: 'other',
};

export type ComplaintCardModel = {
  readonly caseRef: string;
  readonly place: string | null;
  readonly statusTone: StatusTone;
  readonly statusLabel: string;
  readonly age: string | null;
  readonly type: string | null;
  readonly area: string | null;
  readonly priority: string | null | undefined;
  /** "about 2.4 km away", or a visit date on the Scheduled tab. */
  readonly footnote: string | null;
  readonly footnoteIsDistance: boolean;
};

export type ComplaintCardProps = {
  model: ComplaintCardModel;
  onOpen: (caseRef: string) => void;
  testID?: string;
  style?: LayoutStyle;
};

// The card as drawn in 02; grows past 138 when Hindi or long places wrap.
export function ComplaintCard({ model, onOpen, testID, style }: ComplaintCardProps) {
  const t = useT();
  return (
    <Pressable
      testID={testID}
      onPress={() => onOpen(model.caseRef)}
      accessibilityRole="button"
      accessibilityLabel={t('cases.card.openA11y', { ref: model.caseRef })}
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.85 : 1 }, style]}
    >
      <View style={styles.top}>
        <View style={styles.topLeft}>
          <CaseText kind="cardRef" color="refInk" selectable>
            {model.caseRef}
          </CaseText>
          {model.place ? (
            <CaseText kind="cardTitle" numberOfLines={2} style={styles.place}>
              {model.place}
            </CaseText>
          ) : null}
        </View>
        <View style={styles.topRight}>
          <StatusBadge tone={model.statusTone} label={model.statusLabel} />
          {model.age ? (
            <CaseText kind="cardRef" color="ageInk">
              {model.age}
            </CaseText>
          ) : null}
        </View>
      </View>

      <View style={styles.meta}>
        {model.type ? (
          <CaseText kind="cardMeta" numberOfLines={2} style={styles.shrink}>
            {model.type}
          </CaseText>
        ) : null}
        {model.type && model.area ? <View style={styles.metaDivider} /> : null}
        {model.area ? (
          <CaseText kind="cardMetaSmall" style={styles.noShrink}>
            {model.area}
          </CaseText>
        ) : null}
        <View style={styles.spacer} />
        <PriorityBadge priority={model.priority} />
      </View>

      <View style={styles.footer}>
        <View style={styles.footLeft}>
          {model.footnote ? (
            <>
              {model.footnoteIsDistance ? <TargetGlyph /> : null}
              <CaseText kind="cardFoot" numberOfLines={1} style={styles.shrink}>
                {model.footnote}
              </CaseText>
            </>
          ) : null}
        </View>
        <View style={styles.open} importantForAccessibility="no-hide-descendants">
          <CaseText kind="pillLabel">{t('cases.card.open')}</CaseText>
          <OpenChevron />
        </View>
      </View>
    </Pressable>
  );
}

// Whole days since the complaint was raised: "Today", "3 days old".
function useAgeLabel(): (iso: string | null | undefined) => string | null {
  const t = useT();
  const tp = useTPlural();
  return (iso) => {
    if (!iso) return null;
    const time = new Date(iso).getTime();
    if (Number.isNaN(time)) return null;
    const days = Math.floor(Math.max(0, Date.now() - time) / DAY_MS);
    return days === 0 ? t('cases.card.ageToday') : tp('cases.card.age', days);
  };
}

// The complaint type in the app's language: the code-value's Hindi when seeded, else the server's text.
export function useComplaintTypeLabel(): (
  row: Pick<CaseRow, 'complaint_type_cd' | 'complaint_type_label' | 'other_type'>,
) => string | null {
  const { data } = useCodeValues('complaint_type');
  const locale = useLocale();
  return (row) => {
    if (row.complaint_type_cd && row.complaint_type_cd !== 'other') {
      const seeded = data?.find((value) => value.code === row.complaint_type_cd);
      if (locale === 'hi' && seeded?.label_hi) return seeded.label_hi;
      if (seeded?.label) return seeded.label;
    }
    return row.complaint_type_label ?? row.other_type ?? null;
  };
}

// "482 sq.m" in the app's language.
export function useSqmLabel(): (sqm: number | null | undefined) => string | null {
  const t = useT();
  return (sqm) => {
    if (sqm === null || sqm === undefined || !Number.isFinite(sqm)) return null;
    const value = sqm.toLocaleString(intlLocale(), { maximumFractionDigits: 1 });
    return t('cases.area.sqm', { value });
  };
}

// Distance from the last known fix to a cached case, or null.
function useDistance(detail: CaseDetail | undefined, position: LastKnownPosition | null): string | null {
  const t = useT();
  const point = caseCoordinates(detail);
  if (point === null || position === null) return null;
  return distanceText(haversineMeters(position, point), t);
}

export type RowCardProps = {
  row: CaseRow;
  position: LastKnownPosition | null;
  onOpen: (caseRef: string) => void;
};

// A register row as a card (All / New / In progress tabs).
export function CaseRowCard({ row, position, onOpen }: RowCardProps) {
  const work = useWorkStatuses();
  const statusLabel = useCodeLabel(LABEL_DOMAINS.caseStatus);
  const typeLabel = useComplaintTypeLabel();
  const sqm = useSqmLabel();
  const age = useAgeLabel();
  const cached = useCachedCaseDetail(row.case_ref);
  const distance = useDistance(cached, position);
  const model: ComplaintCardModel = {
    caseRef: row.case_ref,
    place: row.property_address ?? row.landmark ?? row.zone_name,
    statusTone: phaseTone[phaseOf(work.data, row.status)],
    statusLabel: statusLabel(row.status),
    age: age(row.raised_at),
    type: typeLabel(row),
    area: sqm(row.measured_area_sqm),
    priority: row.priority,
    footnote: distance,
    footnoteIsDistance: distance !== null,
  };
  return <ComplaintCard model={model} onOpen={onOpen} testID={`case-${row.case_ref}`} />;
}

export type RoundCardProps = {
  row: InspectionRow;
  position: LastKnownPosition | null;
  onOpen: (caseRef: string) => void;
};

// A scheduled round as a complaint card (Scheduled tab). Type and age come from the cached case, if any.
export function ScheduledRoundCard({ row, position, onOpen }: RoundCardProps) {
  const t = useT();
  const statusLabel = useCodeLabel(LABEL_DOMAINS.inspectionStatus);
  const typeLabel = useComplaintTypeLabel();
  const sqm = useSqmLabel();
  const age = useAgeLabel();
  const cached = useCachedCaseDetail(row.case_ref);
  const distance = useDistance(cached, position);
  const visit = formatDate(row.scheduled_for);
  const model: ComplaintCardModel = {
    caseRef: row.case_ref,
    place: row.case_title ?? row.zone_name ?? null,
    statusTone: toneOfRoundStatus(row.status),
    statusLabel: statusLabel(row.status),
    age: age(cached?.raised_at),
    type: cached ? typeLabel(cached) : null,
    area: sqm(cached?.measured_area_sqm),
    priority: row.priority,
    footnote: distance ?? (visit ? t('cases.card.visitOn', { date: visit }) : null),
    footnoteIsDistance: distance !== null,
  };
  return <ComplaintCard model={model} onOpen={onOpen} testID={`round-${row.inspection_ref}`} />;
}

const styles = StyleSheet.create({
  card: {
    minHeight: 138,
    backgroundColor: casePalette.cardLight,
    borderWidth: caseMetrics.hairline,
    borderColor: casePalette.cardLightBorder,
    borderRadius: caseMetrics.cardRadius,
    overflow: 'hidden',
  },
  top: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingTop: caseMetrics.cardPadTop,
    paddingHorizontal: caseMetrics.cardPadX,
    gap: 8,
  },
  topLeft: { flex: 1 },
  place: { paddingTop: 3 },
  topRight: { alignItems: 'flex-end', gap: 5, maxWidth: '45%' },
  meta: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: caseMetrics.cardPadX,
    paddingVertical: 8,
    gap: 10,
  },
  metaDivider: { width: 1, height: 10, backgroundColor: casePalette.metaDivider },
  spacer: { flex: 1 },
  shrink: { flexShrink: 1 },
  noShrink: { flexShrink: 0 },
  footer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: caseMetrics.hairline,
    borderTopColor: casePalette.footerLine,
    backgroundColor: casePalette.footerTint,
    paddingHorizontal: caseMetrics.cardPadX,
    paddingVertical: 9,
    gap: 8,
    marginTop: 'auto',
  },
  footLeft: { flexDirection: 'row', alignItems: 'center', gap: 5, flex: 1 },
  open: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: casePalette.open,
    borderRadius: caseMetrics.openRadius,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});

/* ---------- Kept for other screens (NextUpCard): the app-token chips ---------- */

const chipTone: Record<Exclude<WorkPhase, 'other'>, CaseStatus> = {
  to_start: 'new',
  underway: 'in_progress',
  handed_in: 'completed',
};

export type CaseStatusChipProps = { status: string; style?: LayoutStyle };

// A status the officer has no part in renders neutral rather than borrowing a colour.
export function CaseStatusChip({ status, style }: CaseStatusChipProps) {
  const work = useWorkStatuses();
  const label = useCodeLabel(LABEL_DOMAINS.caseStatus)(status);
  const phase = phaseOf(work.data, status);
  if (phase === 'other') {
    return <Chip label={label} tone="ink2" dot size="sm" style={style} />;
  }
  return <StatusChip status={chipTone[phase]} label={label} size="sm" style={style} />;
}

// Renders nothing when the case carries no priority; an unknown value shows as itself, neutral.
export function CasePriorityChip({ priority }: { priority: string | null | undefined }) {
  if (priority === null || priority === undefined || priority === '') return null;
  if (priority === 'high' || priority === 'medium' || priority === 'low') {
    return <PriorityChip priority={priority} />;
  }
  return <Chip label={priority.toUpperCase()} tone="ink2" size="sm" />;
}
