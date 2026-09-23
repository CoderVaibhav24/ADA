import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import {
  Button,
  Chip,
  Icon,
  ListScreenTemplate,
  Skeleton,
  StateMessage,
  Text,
  colors,
  radius,
  space,
} from '@/design-system';
import { CasePriorityChip } from '@/design-system/organisms/ComplaintCard';
import { errorText } from '@/services/api/error-text';
import { useInspectionPages, type InspectionRow } from '@/services/api/inspection-reads';
import { dataAge } from '@/services/api/query-client';
import { LABEL_DOMAINS, useCodeLabel } from '@/services/config/labels';
import { formatAge, formatDate } from '@/services/format/datetime';

/*
 * Inspections, `195:1961`. `GET /api/icms/inspections` — the server narrows a Field
 * Surveyor to their own rounds, newest first. "View" opens the one Complaint Detail
 * screen with this list as its return target.
 *
 * The design's parcel, village and area columns are not on `InspectionRow`; the row
 * shows the case reference and title instead, and the detail screen carries the rest.
 */
const SKELETON_ROWS = 3;

// The most meaningful date a round has: submitted, then started, then scheduled.
function whenOf(row: InspectionRow): string | null {
  const submitted = formatDate(row.submitted_at);
  if (submitted) return `Submitted ${submitted}`;
  const started = formatDate(row.started_at);
  if (started) return `Started ${started}`;
  const scheduled = formatDate(row.scheduled_for);
  if (scheduled) return `Scheduled ${scheduled}`;
  return null;
}

type InspectionItemProps = {
  row: InspectionRow;
  statusLabel: string;
  onView: (caseRef: string) => void;
};

// One round: case, round, title, zone, counts, status and the View action.
function InspectionItem({ row, statusLabel, onView }: InspectionItemProps) {
  const when = whenOf(row);
  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text variant="mono" color="ink0" selectable style={styles.flex}>
          {row.case_ref}
        </Text>
        <CasePriorityChip priority={row.priority} />
      </View>
      <View style={styles.row}>
        <Text variant="mono" color="ink2" selectable>
          {row.inspection_ref}
        </Text>
        <Text variant="caption" color="ink3">
          {`Round ${row.round_no}`}
        </Text>
      </View>
      {row.case_title ? <Text variant="subheading">{row.case_title}</Text> : null}
      {row.zone_name ? (
        <View style={styles.row}>
          <Icon name="location" size="sm" color="ink2" />
          <Text variant="body" color="ink2" style={styles.flex}>
            {row.zone_name}
          </Text>
        </View>
      ) : null}
      <View style={styles.row}>
        <Icon name="photo" size="sm" color="ink3" />
        <Text variant="caption" color="ink2">
          {`${row.evidence_count} evidence · ${row.finding_count} findings`}
        </Text>
      </View>
      <View style={styles.footer}>
        <View style={styles.statusCol}>
          <Chip label={statusLabel} tone="ink2" dot size="sm" />
          {when ? (
            <Text variant="caption" color="ink3">
              {when}
            </Text>
          ) : null}
        </View>
        <Button
          label="View"
          size="sm"
          fullWidth={false}
          onPress={() => onView(row.case_ref)}
          accessibilityLabel={`View ${row.case_ref}`}
        />
      </View>
    </View>
  );
}

// The gap between cards.
function Separator() {
  return <View style={styles.separator} />;
}

// Stable key: the inspection reference is unique.
function keyOf(row: InspectionRow): string {
  return row.inspection_ref;
}

export function InspectionsScreen() {
  const router = useRouter();
  const statusLabel = useCodeLabel(LABEL_DOMAINS.inspectionStatus);
  const query = useInspectionPages({});
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = query;
  const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);

  const onView = useCallback(
    (caseRef: string) =>
      router.push({ pathname: '/complaint/[caseRef]', params: { caseRef, from: 'inspections' } }),
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: InspectionRow }) => (
      <InspectionItem row={item} statusLabel={statusLabel(item.status)} onView={onView} />
    ),
    [onView, statusLabel],
  );

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const age = dataAge(query.dataUpdatedAt);
  const freshness =
    age.isStale && age.fetchedAt ? `Updated ${formatAge(age.fetchedAt) ?? ''}` : undefined;

  let body: React.ReactNode;
  if (query.isPending && query.error === null) {
    body = (
      <View style={styles.padded}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <Skeleton key={index} height={space[8] * 3} shape="md" />
        ))}
      </View>
    );
  } else if (query.error !== null && rows.length === 0) {
    const failure = errorText(query.error);
    body = (
      <StateMessage
        tone={failure.offline ? 'offline' : 'error'}
        title="Inspections could not be loaded"
        message={failure.message}
        reference={failure.requestId}
        actionLabel="Try again"
        onAction={onRefresh}
      />
    );
  } else {
    const refreshFailure = query.error !== null ? errorText(query.error) : null;
    body = (
      <FlatList
        contentContainerStyle={styles.content}
        data={rows}
        keyExtractor={keyOf}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={query.isRefetching && !isFetchingNextPage}
            onRefresh={onRefresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface1}
          />
        }
        ListHeaderComponent={
          refreshFailure ? (
            <Text
              variant="caption"
              color="statusOverdue"
              accessibilityRole="alert"
              style={styles.header}
            >
              {refreshFailure.message}
            </Text>
          ) : null
        }
        ListEmptyComponent={
          <StateMessage
            tone="empty"
            title="No inspections yet"
            message="Rounds opened on your assigned complaints appear here."
          />
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <ActivityIndicator color={colors.brand} style={styles.footerSpinner} />
          ) : null
        }
      />
    );
  }

  return (
    <ListScreenTemplate title="Inspections" freshnessLabel={freshness}>
      {body}
    </ListScreenTemplate>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space[4], paddingBottom: space[8], flexGrow: 1 },
  padded: { paddingHorizontal: space[4], gap: space[3] },
  separator: { height: space[3] },
  header: { paddingBottom: space[2] },
  footerSpinner: { paddingVertical: space[4] },
  card: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
  footer: { flexDirection: 'row', alignItems: 'center', gap: space[3], marginTop: space[1] },
  statusCol: { flex: 1, gap: space[1] },
});
