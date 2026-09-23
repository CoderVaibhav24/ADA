/**
 * ComplaintCard — one case in the Complaints list (`170:4173`): reference, parcel,
 * type, area, priority, status, age, and the OPEN action. Every value is the row the
 * register returned. Distance and ETA are left out: the list payload carries no
 * coordinates, and a distance without them would be invented (ui-rules.md §7).
 *
 * Also exports CaseStatusChip and CasePriorityChip, the one place a case status or
 * priority becomes a chip.
 */

import { StyleSheet, View } from 'react-native';

import type { CaseRow } from '@/services/api/case-reads';
import { LABEL_DOMAINS, useCodeLabel } from '@/services/config/labels';
import { phaseOf, useWorkStatuses, type WorkPhase } from '@/services/config/work-statuses';
import { formatAge } from '@/services/format/datetime';

import { Button, Chip, Icon, Text } from '../atoms';
import { PriorityChip, StatusChip, type CasePriority, type CaseStatus } from '../molecules';
import { colors, radius, space, type LayoutStyle } from '../tokens';

// Where the case sits in this officer's work decides the chip colour; the label is the server's.
const phaseTone: Record<Exclude<WorkPhase, 'other'>, CaseStatus> = {
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
  return <StatusChip status={phaseTone[phase]} label={label} size="sm" style={style} />;
}

// The fixed priority palette of ui-tokens.md §1; an unknown value shows as itself, neutral.
function isKnownPriority(value: string): value is CasePriority {
  return value === 'high' || value === 'medium' || value === 'low';
}

// Renders nothing when the case carries no priority.
export function CasePriorityChip({ priority }: { priority: string | null | undefined }) {
  if (priority === null || priority === undefined || priority === '') return null;
  if (isKnownPriority(priority)) return <PriorityChip priority={priority} />;
  return <Chip label={priority.toUpperCase()} tone="ink2" size="sm" />;
}

export type ComplaintCardProps = {
  row: CaseRow;
  onOpen: (caseRef: string) => void;
  testID?: string;
  style?: LayoutStyle;
};

// The type line: the vocabulary label, or the free text an "other" complaint carries.
function typeOf(row: CaseRow): string | null {
  return row.complaint_type_label ?? row.other_type ?? null;
}

// The area line: address, then landmark, then the zone the case sits in.
function areaOf(row: CaseRow): string {
  return [row.property_address, row.landmark, row.zone_name]
    .filter((part): part is string => typeof part === 'string' && part !== '')
    .join(' · ');
}

export function ComplaintCard({ row, onOpen, testID, style }: ComplaintCardProps) {
  const type = typeOf(row);
  const area = areaOf(row);
  const age = formatAge(row.raised_at);

  return (
    <View testID={testID} style={[styles.card, style]}>
      <View style={styles.topRow}>
        <Text variant="mono" color="inkOnMuted" selectable style={styles.ref}>
          {row.case_ref}
        </Text>
        <CasePriorityChip priority={row.priority} />
      </View>

      {row.parcel_id ? (
        <View style={styles.metaRow}>
          <Icon name="area" size="sm" color="inkOnMuted" />
          <Text variant="mono" color="inkOnMuted" selectable style={styles.flex}>
            {row.parcel_id}
          </Text>
        </View>
      ) : null}

      {type ? (
        <Text variant="subheading" color="inkOnMuted">
          {type}
        </Text>
      ) : null}

      {area !== '' ? (
        <View style={styles.metaRow}>
          <Icon name="location" size="sm" color="inkOnMuted" />
          <Text variant="body" color="inkOnMuted" style={styles.flex}>
            {area}
          </Text>
        </View>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.statusCol}>
          <CaseStatusChip status={row.status} />
          {age ? (
            <Text variant="caption" color="inkOnMuted">
              {`Raised ${age}`}
            </Text>
          ) : null}
        </View>
        <Button
          label="OPEN"
          onPress={() => onOpen(row.case_ref)}
          size="sm"
          fullWidth={false}
          accessibilityLabel={`Open ${row.case_ref}`}
          trailingIcon={<Icon name="forward" size="sm" color="inkOnMuted" />}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  ref: { flex: 1 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  flex: { flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[1] },
  statusCol: { flex: 1, gap: space[1] },
});
