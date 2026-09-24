/**
 * The blocks of Complaint Detail (Figma 03 174:4991, 10 195:2657, 11 202:3867):
 * the parcel map card, the attribute card, text cards, the office's instruction,
 * the Inspection Findings card and the re-survey note. Presentational: the screen
 * passes data and callbacks in.
 */

import ClipboardList from 'lucide-react-native/icons/clipboard-list';
import MapIcon from 'lucide-react-native/icons/map';
import Phone from 'lucide-react-native/icons/phone';
import Undo2 from 'lucide-react-native/icons/undo-2';
import { Fragment } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { useT } from '@/services/i18n';

import { caseMetrics, casePalette, type CaseColor } from '../../tokens';
import type { MapPoint } from './basemap';
import { CaseMap } from './CaseMap';
import { MapPlaceholder } from './MapPlaceholder';
import { CaseIcon, CaseText, StatusBadge, TargetGlyph, type StatusTone } from './primitives';

/* ---------- Parcel map card (174:5544) ---------- */

export type MapCardProps = {
  title: string | null;
  statusTone: StatusTone;
  statusLabel: string;
  address: string | null;
  distance: string | null;
  /** The case's exact location; null draws the stylised grid instead of a map. */
  point: MapPoint | null;
  onOpenMap: () => void;
};

// Live map pinned to the case (grid when there is no point); tapping it opens the place in Maps.
export function MapCard({ title, statusTone, statusLabel, address, distance, point, onOpenMap }: MapCardProps) {
  const t = useT();
  const hasPoint = point !== null;
  return (
    <View style={styles.mapCard}>
      <Pressable
        onPress={onOpenMap}
        accessibilityRole="button"
        accessibilityLabel={t('caseDetail.map.openA11y')}
        style={styles.mapArea}
      >
        {point ? <CaseMap point={point} /> : <MapPlaceholder hasPoint={false} />}
        <View style={styles.mapChip}>
          <CaseIcon glyph={MapIcon} size={16} color="white" />
          <CaseText kind="cardMetaSmall">{t('caseDetail.map.open')}</CaseText>
        </View>
      </Pressable>
      <View style={styles.panel}>
        <View style={styles.panelRow}>
          {title ? (
            <CaseText kind="panelTitle" style={styles.shrink}>
              {title}
            </CaseText>
          ) : (
            <View style={styles.shrink} />
          )}
          <StatusBadge tone={statusTone} label={statusLabel} size="panel" />
        </View>
        {address ? (
          <CaseText kind="panelSub" color="muted">
            {address}
          </CaseText>
        ) : null}
        {distance ? (
          <View style={styles.inline}>
            <TargetGlyph />
            <CaseText kind="panelSub">{distance}</CaseText>
          </View>
        ) : null}
        {!hasPoint ? (
          <CaseText kind="panelSub" color="muted">
            {t('caseDetail.map.noPoint')}
          </CaseText>
        ) : null}
      </View>
    </View>
  );
}

/* ---------- Attribute card (174:5571) ---------- */

export type AttributeRow = {
  readonly label: string;
  readonly value: string;
  readonly mono?: boolean;
  /** Makes the value a call button. */
  readonly onCall?: () => void;
  readonly callLabel?: string;
};

export type AttributeCardProps = {
  rows: readonly AttributeRow[];
  labelColor?: CaseColor;
  /** Drawn under the last row: the priority pill on 03. */
  footer?: React.ReactNode;
  /** 10/11 end with a divider after the last row. */
  trailingDivider?: boolean;
};

export function AttributeCard({ rows, labelColor = 'rowLabel', footer, trailingDivider }: AttributeCardProps) {
  return (
    <View style={styles.lightCard}>
      {rows.map((row, index) => (
        <Fragment key={row.label}>
          <View style={[styles.attrRow, index > 0 ? styles.attrRowNext : null]}>
            <CaseText kind="rowLabel" color={labelColor} style={styles.attrLabel}>
              {row.label}
            </CaseText>
            {row.onCall ? (
              <Pressable
                onPress={row.onCall}
                accessibilityRole="button"
                accessibilityLabel={row.callLabel}
                hitSlop={{ top: 16, bottom: 16, left: 8, right: 8 }}
                style={styles.call}
              >
                <CaseIcon glyph={Phone} size={16} color="white" />
                <CaseText kind="rowValue" align="right" selectable>
                  {row.value}
                </CaseText>
              </Pressable>
            ) : (
              <CaseText kind={row.mono ? 'mono' : 'rowValue'} align="right" selectable style={styles.shrink}>
                {row.value}
              </CaseText>
            )}
          </View>
          {index < rows.length - 1 || trailingDivider ? <View style={styles.divider} /> : null}
        </Fragment>
      ))}
      {footer ? <View style={styles.attrFooter}>{footer}</View> : null}
    </View>
  );
}

/* ---------- Text card: description, remark ---------- */

export function TextCard({ text, trailingDivider }: { text: string; trailingDivider?: boolean }) {
  return (
    <View style={styles.lightCard}>
      <CaseText kind="body" selectable>
        {text}
      </CaseText>
      {trailingDivider ? <View style={styles.divider} /> : null}
    </View>
  );
}

/* ---------- Office instruction (web 46:4561) ---------- */

export type InstructionCardProps = {
  note: string | null;
  rows: readonly { label: string; value: string }[];
};

// What the office asked for and when; absent parts are left out.
export function InstructionCard({ note, rows }: InstructionCardProps) {
  const t = useT();
  return (
    <View style={[styles.lightCard, styles.instruction]}>
      <View style={styles.inline}>
        <CaseIcon glyph={ClipboardList} size={18} color="white" />
        <CaseText kind="sectionHead" accessibilityRole="header">
          {t('caseDetail.instruction')}
        </CaseText>
      </View>
      {note ? (
        <CaseText kind="body" selectable>
          {note}
        </CaseText>
      ) : null}
      {rows.map((row) => (
        <View key={row.label} style={styles.attrRow}>
          <CaseText kind="rowLabel" color="rowLabel">
            {row.label}
          </CaseText>
          <CaseText kind="rowValue" align="right" style={styles.shrink}>
            {row.value}
          </CaseText>
        </View>
      ))}
    </View>
  );
}

/* ---------- Inspection Findings (195:3137) ---------- */

export type FindingRow = {
  readonly label: string;
  readonly value: string;
  /** "(RCC)" under the value, as 10 draws it. */
  readonly caption?: string | null;
  readonly pill?: boolean;
  readonly mono?: boolean;
};

// The recommendation pill: dot plus word on a pale fill.
function RecommendationPill({ text }: { text: string }) {
  return (
    <View style={styles.pill}>
      <View style={styles.pillDot} />
      <CaseText kind="rowCaption" color="primary" style={styles.shrink}>
        {text}
      </CaseText>
    </View>
  );
}

export function FindingsCard({ rows, notes }: { rows: readonly FindingRow[]; notes?: readonly string[] }) {
  const t = useT();
  return (
    <View style={styles.findings}>
      {rows.map((row, index) => (
        <View
          key={row.label}
          style={[styles.findRow, index < rows.length - 1 ? styles.findDivider : null]}
        >
          <CaseText kind="rowLabel" color="findingsLabel" style={styles.attrLabel}>
            {row.label}
          </CaseText>
          <View style={styles.findValue}>
            {row.pill ? (
              <RecommendationPill text={row.value} />
            ) : (
              <CaseText kind={row.mono ? 'mono' : 'rowValue'} align="right" selectable>
                {row.value}
              </CaseText>
            )}
            {row.caption ? (
              <CaseText kind="rowCaption" color="typeCaption" align="right">
                {row.caption}
              </CaseText>
            ) : null}
          </View>
        </View>
      ))}
      {notes && notes.length > 0 ? (
        <View style={styles.notes}>
          <CaseText kind="rowLabel" color="findingsLabel">
            {t('caseDetail.findings.notes')}
          </CaseText>
          {notes.map((note, index) => (
            <CaseText key={`${index}-${note}`} kind="body">
              {`• ${note}`}
            </CaseText>
          ))}
        </View>
      ) : null}
    </View>
  );
}

/* ---------- Re-survey note ---------- */

export function ResurveyCard({ items }: { items: readonly { key: string; reason: string; when: string | null }[] }) {
  const t = useT();
  return (
    <View style={[styles.lightCard, styles.resurvey]} accessibilityRole="alert">
      <View style={styles.inline}>
        <CaseIcon glyph={Undo2} size={18} color="statusSentBack" />
        <CaseText kind="sectionHead">{t('caseDetail.resurvey')}</CaseText>
      </View>
      {items.map((item) => (
        <View key={item.key} style={styles.resurveyItem}>
          <CaseText kind="body">{item.reason}</CaseText>
          {item.when ? (
            <CaseText kind="cardFoot" color="refInk">
              {t('caseDetail.resurveyAsked', { date: item.when })}
            </CaseText>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  mapCard: {
    backgroundColor: casePalette.mapCard,
    borderWidth: caseMetrics.hairline,
    borderColor: casePalette.mapCardBorder,
    borderRadius: caseMetrics.bigRadius,
    overflow: 'hidden',
    boxShadow: `0 10px 15px -3px ${casePalette.shadow}, 0 4px 6px -4px ${casePalette.shadow}`,
  },
  mapArea: {
    height: caseMetrics.mapHeight,
    backgroundColor: casePalette.mapBackdrop,
    overflow: 'hidden',
  },
  mapChip: {
    position: 'absolute',
    right: 10,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: caseMetrics.buttonRadius,
    backgroundColor: casePalette.secondary,
    borderWidth: caseMetrics.hairline,
    borderColor: casePalette.secondaryBorder,
  },
  panel: {
    backgroundColor: casePalette.mapPanel,
    borderTopWidth: caseMetrics.hairline,
    borderTopColor: casePalette.mapPanelBorder,
    paddingTop: 15,
    paddingBottom: 14,
    paddingHorizontal: 14,
    gap: 4,
  },
  panelRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  shrink: { flexShrink: 1 },
  lightCard: {
    backgroundColor: casePalette.cardLight,
    borderWidth: caseMetrics.hairline,
    borderColor: casePalette.cardAttrBorder,
    borderRadius: caseMetrics.bigRadius,
    padding: caseMetrics.attrPad,
  },
  attrRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  attrRowNext: { paddingTop: caseMetrics.rowGap },
  attrLabel: { flexShrink: 0, maxWidth: '50%' },
  divider: { height: caseMetrics.hairline, marginTop: caseMetrics.rowGap, backgroundColor: casePalette.rowDivider },
  attrFooter: { paddingTop: caseMetrics.rowGap, alignItems: 'flex-start' },
  call: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  instruction: { gap: 10 },
  findings: {
    backgroundColor: casePalette.cardInspection,
    borderWidth: caseMetrics.hairline,
    borderColor: casePalette.findingsBorder,
    borderRadius: caseMetrics.bigRadius,
    padding: caseMetrics.attrPad,
    gap: 10,
  },
  findRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, paddingBottom: 10 },
  findDivider: { borderBottomWidth: caseMetrics.hairline, borderStyle: 'dashed', borderBottomColor: casePalette.findingsDivider },
  findValue: { flexShrink: 1, alignItems: 'flex-end', gap: 2 },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: casePalette.recommendationPill,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 2,
    flexShrink: 1,
  },
  pillDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: casePalette.primary },
  notes: { gap: 4 },
  resurvey: { gap: 10, borderColor: casePalette.bannerOfflineBorder },
  resurveyItem: { gap: 2 },
});
