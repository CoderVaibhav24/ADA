/**
 * NextUpCard — the first case in the officer's active work, with its open action
 * (`158:3829`). The row is whatever the register returned first; nothing is picked on
 * the handset.
 */

import { StyleSheet, View } from 'react-native';

import type { CaseRow } from '@/services/api/case-reads';
import { formatAge } from '@/services/format/datetime';

import { Button, Icon, Skeleton, Text } from '../atoms';
import { colors, layout, radius, space, type LayoutStyle } from '../tokens';
import { CasePriorityChip, CaseStatusChip } from './ComplaintCard';

export type NextUpCardProps = {
  /** undefined while loading; null when there is nothing waiting. */
  row: CaseRow | null | undefined;
  /** The server's message when the read failed. */
  errorMessage?: string | null;
  onOpen: (caseRef: string) => void;
  onRetry?: () => void;
  style?: LayoutStyle;
};

// Four states in one frame: loading, failed, nothing waiting, and the case itself.
export function NextUpCard({ row, errorMessage, onOpen, onRetry, style }: NextUpCardProps) {
  if (errorMessage) {
    return (
      <View style={[styles.card, style]} accessibilityRole="alert">
        <Text variant="label">Next up</Text>
        <View style={styles.row}>
          <Icon name="alert" size="md" color="statusOverdue" />
          <Text variant="body" color="ink1" style={styles.flex}>
            {errorMessage}
          </Text>
        </View>
        {onRetry ? (
          <Button label="Try again" onPress={onRetry} variant="secondary" size="sm" fullWidth={false} />
        ) : null}
      </View>
    );
  }

  if (row === undefined) {
    return (
      <View style={[styles.card, style]}>
        <Text variant="label">Next up</Text>
        <Skeleton height={layout.touchMin / 2} width="50%" />
        <Skeleton height={layout.touchMin / 2} />
        <Skeleton height={layout.touchMin} shape="pill" />
      </View>
    );
  }

  if (row === null) {
    return (
      <View style={[styles.card, style]}>
        <Text variant="label">Next up</Text>
        <Text variant="body" color="ink2">
          Nothing is waiting for you.
        </Text>
      </View>
    );
  }

  const type = row.complaint_type_label ?? row.other_type ?? null;
  const place = row.property_address ?? row.landmark ?? row.zone_name;
  const age = formatAge(row.raised_at);

  return (
    <View style={[styles.card, style]}>
      <View style={styles.row}>
        <Text variant="label" style={styles.flex}>
          Next up
        </Text>
        <CasePriorityChip priority={row.priority} />
      </View>
      <Text variant="mono" color="ink0" selectable>
        {row.case_ref}
      </Text>
      {type ? <Text variant="heading">{type}</Text> : null}
      {place ? (
        <View style={styles.row}>
          <Icon name="location" size="sm" color="ink2" />
          <Text variant="body" color="ink2" style={styles.flex}>
            {place}
          </Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <CaseStatusChip status={row.status} />
        {age ? (
          <Text variant="caption" color="ink3">
            {`Raised ${age}`}
          </Text>
        ) : null}
      </View>
      <Button
        label="Open"
        onPress={() => onOpen(row.case_ref)}
        accessibilityLabel={`Open ${row.case_ref}`}
        trailingIcon={<Icon name="arrowRight" size="md" color="inkOnMuted" />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface1,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
});
