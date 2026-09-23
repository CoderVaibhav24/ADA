/**
 * ComplaintList — the filtered, paginated register under one tab (`170:4173`).
 * Owns its read: pull-to-refresh, next page on scroll, a stated age when the cache is
 * not fresh, and designed loading, empty and error states. The error text is the
 * server's.
 */

import { useCallback, useMemo } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { useCasePages, type CaseListFilter, type CaseRow } from '@/services/api/case-reads';
import { errorText } from '@/services/api/error-text';
import { dataAge } from '@/services/api/query-client';
import { formatAge } from '@/services/format/datetime';

import { Skeleton, Text } from '../atoms';
import { StateMessage } from '../molecules';
import { colors, radius, space, type LayoutStyle } from '../tokens';
import { ComplaintCard } from './ComplaintCard';

export type ComplaintListProps = {
  filter: CaseListFilter;
  onOpen: (caseRef: string) => void;
  /** Names the filter that produced an empty list (ui-rules.md §7). */
  emptyTitle: string;
  emptyMessage?: string;
  /** Offered on an empty list when a filter or search narrowed it. */
  onClearFilter?: () => void;
  clearFilterLabel?: string;
  /** False while the filter is still being derived; the list shows its skeleton. */
  enabled?: boolean;
  style?: LayoutStyle;
};

const SKELETON_ROWS = 3;

// Stable key: the case reference is unique in the register.
function keyOf(row: CaseRow): string {
  return row.case_ref;
}

// The gap between cards.
function Separator() {
  return <View style={styles.separator} />;
}

// A card-shaped placeholder, so the list does not jump when rows arrive.
function CardSkeleton() {
  return (
    <View style={styles.skeletonCard}>
      <Skeleton height={space[5]} width="40%" tone="surface3" />
      <Skeleton height={space[5]} tone="surface3" />
      <Skeleton height={space[5]} width="70%" tone="surface3" />
    </View>
  );
}

export function ComplaintList({
  filter,
  onOpen,
  emptyTitle,
  emptyMessage,
  onClearFilter,
  clearFilterLabel,
  enabled = true,
  style,
}: ComplaintListProps) {
  const query = useCasePages(filter, enabled);
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = query;
  const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const total = data?.pages[0]?.total;

  const renderItem = useCallback(
    ({ item }: { item: CaseRow }) => (
      <ComplaintCard row={item} onOpen={onOpen} testID={`case-${item.case_ref}`} />
    ),
    [onOpen],
  );

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  if (!enabled || (query.isPending && query.error === null)) {
    return (
      <View style={[styles.padded, style]}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <CardSkeleton key={index} />
        ))}
      </View>
    );
  }

  if (query.error !== null && rows.length === 0) {
    const failure = errorText(query.error);
    return (
      <StateMessage
        tone={failure.offline ? 'offline' : 'error'}
        title="Complaints could not be loaded"
        message={failure.message}
        reference={failure.requestId}
        actionLabel="Try again"
        onAction={onRefresh}
        style={style}
      />
    );
  }

  const age = dataAge(query.dataUpdatedAt);
  const staleLabel = age.isStale && age.fetchedAt ? `Updated ${formatAge(age.fetchedAt)}` : null;
  const refreshFailure = query.error !== null ? errorText(query.error) : null;
  const showHeader = staleLabel !== null || refreshFailure !== null || rows.length > 0;

  return (
    <FlatList
      style={style}
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
        showHeader ? (
          <View style={styles.header}>
            {total !== undefined && rows.length > 0 ? (
              <Text variant="caption" color="ink3">
                {`${rows.length} of ${total}`}
              </Text>
            ) : null}
            {staleLabel ? (
              <Text variant="caption" color="ink3">
                {staleLabel}
              </Text>
            ) : null}
            {refreshFailure ? (
              <Text variant="caption" color="statusOverdue" accessibilityRole="alert">
                {refreshFailure.message}
              </Text>
            ) : null}
          </View>
        ) : null
      }
      ListEmptyComponent={
        <StateMessage
          tone="empty"
          title={emptyTitle}
          message={emptyMessage}
          actionLabel={onClearFilter ? clearFilterLabel : undefined}
          onAction={onClearFilter}
        />
      }
      ListFooterComponent={
        isFetchingNextPage ? <ActivityIndicator color={colors.brand} style={styles.footer} /> : null
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space[4], paddingBottom: space[8], flexGrow: 1 },
  padded: { paddingHorizontal: space[4], gap: space[3] },
  separator: { height: space[3] },
  header: { gap: space[1], paddingBottom: space[2] },
  footer: { paddingVertical: space[4] },
  skeletonCard: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
  },
});
