/**
 * One round on the Inspections list (Figma 09, 195:2487): "CMP-4471 · submitted date",
 * the place, and a footer of zone, parcel and area with View. A status badge (icon +
 * word + colour) is added to the first line; 09 draws none. Parcel and area come from
 * the case or round already cached on the phone — the list payload does not carry them.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { useCachedCaseDetail } from '@/services/api/case-reads';
import { useCachedInspectionDetail, type InspectionRow } from '@/services/api/inspection-reads';
import { LABEL_DOMAINS, useCodeLabel } from '@/services/config/labels';
import { formatDate } from '@/services/format/datetime';
import { intlLocale, useT } from '@/services/i18n';

import { caseMetrics, casePalette } from '../../tokens';
import { AreaGlyph, CaseText, PinGlyph, StatusBadge, toneOfRoundStatus } from './primitives';

export type InspectionCardProps = {
  row: InspectionRow;
  onView: (row: InspectionRow) => void;
};

// The line under the reference: submitted, else started, else the visit date.
function useWhen(row: InspectionRow): string | null {
  const t = useT();
  const submitted = formatDate(row.submitted_at);
  if (submitted) return t('inspections.card.submitted', { date: submitted });
  const started = formatDate(row.started_at);
  if (started) return t('inspections.card.started', { date: started });
  const scheduled = formatDate(row.scheduled_for);
  if (scheduled) return t('inspections.card.scheduled', { date: scheduled });
  return null;
}

export function InspectionCard({ row, onView }: InspectionCardProps) {
  const t = useT();
  const statusLabel = useCodeLabel(LABEL_DOMAINS.inspectionStatus);
  const when = useWhen(row);
  const caseDetail = useCachedCaseDetail(row.case_ref);
  const round = useCachedInspectionDetail(row.inspection_ref);
  const sqm = round?.measured_area_sqm ?? caseDetail?.measured_area_sqm;
  const area =
    sqm === null || sqm === undefined
      ? null
      : t('cases.area.sqm', { value: sqm.toLocaleString(intlLocale(), { maximumFractionDigits: 1 }) });
  const parcel = caseDetail?.parcel_id ?? null;

  return (
    <Pressable
      onPress={() => onView(row)}
      accessibilityRole="button"
      accessibilityLabel={t('inspections.card.viewA11y', { ref: row.case_ref })}
      style={({ pressed }) => [styles.card, { opacity: pressed ? 0.85 : 1 }]}
      testID={`inspection-${row.inspection_ref}`}
    >
      <View style={styles.firstLine}>
        <CaseText kind="inspLine" color="refInk" style={styles.flex}>
          {when ? `${row.case_ref}  ·  ${when}` : row.case_ref}
        </CaseText>
        <StatusBadge tone={toneOfRoundStatus(row.status)} label={statusLabel(row.status)} backdrop />
      </View>
      {row.case_title ? (
        <CaseText kind="inspTitle" numberOfLines={2}>
          {row.case_title}
        </CaseText>
      ) : null}
      <View style={styles.footer}>
        <View style={styles.facts}>
          {row.zone_name ? (
            <View style={styles.fact}>
              <PinGlyph />
              <CaseText kind="inspLine">{row.zone_name}</CaseText>
            </View>
          ) : null}
          {parcel ? (
            <CaseText kind="inspLine" selectable>
              {parcel}
            </CaseText>
          ) : null}
          {area ? (
            <View style={styles.fact}>
              <AreaGlyph />
              <CaseText kind="inspLine">{area}</CaseText>
            </View>
          ) : null}
        </View>
        <View style={styles.view} importantForAccessibility="no-hide-descendants">
          <CaseText kind="viewLabel" color="viewInk">
            {t('inspections.card.view')}
          </CaseText>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: 122,
    backgroundColor: casePalette.cardInspection,
    borderWidth: caseMetrics.hairline,
    borderColor: casePalette.cardInspectionBorder,
    borderRadius: caseMetrics.bigRadius,
    padding: caseMetrics.attrPad,
    gap: 6,
    justifyContent: 'center',
    boxShadow: `0 1px 1px ${casePalette.shadow}`,
  },
  firstLine: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  flex: { flex: 1 },
  footer: {
    minHeight: 30,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: caseMetrics.hairline,
    borderTopColor: casePalette.footerLineInspection,
    backgroundColor: casePalette.footerTint,
    paddingLeft: caseMetrics.cardPadX,
    paddingTop: 9,
    gap: 8,
  },
  facts: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 12, rowGap: 4 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  view: {
    minWidth: 60,
    alignItems: 'center',
    backgroundColor: casePalette.open,
    borderRadius: caseMetrics.openRadius,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
});
