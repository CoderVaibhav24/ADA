/**
 * ComplaintList — the cards under one Complaints tab (Figma 02). Owns its read:
 * pull-to-refresh, next page on scroll, the cache's age when it is not fresh, and
 * loading, empty, error and offline states. `ScheduledList` is the Scheduled tab: the
 * surveyor's rounds with status "scheduled", read from the inspection register.
 */

import { useCallback, useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { useCasePages, type CaseListFilter, type CaseRow } from '@/services/api/case-reads';
import { useInspectionPages, type InspectionRow } from '@/services/api/inspection-reads';
import { dataAge } from '@/services/api/query-client';
import { formatAge } from '@/services/format/datetime';
import { useT } from '@/services/i18n';
import { useLastKnownPosition, type LastKnownPosition } from '@/services/location/last-known';

import type { LayoutStyle } from '../tokens';
import { CaseState } from './cases/CaseStates';
import { caseMetrics, casePalette } from './cases/palette';
import { CaseText, ListSpinner, SkeletonBlock } from './cases/primitives';
import { CaseRowCard, ScheduledRoundCard } from './ComplaintCard';

export type ListEmpty = {
  title: string;
  body?: string;
  actionLabel?: string;
  onAction?: () => void;
};

type Page<T> = { items: T[]; total: number };

type QueryLike<T> = {
  data: { pages: Page<T>[] } | undefined;
  error: Error | null;
  isPending: boolean;
  isRefetching: boolean;
  isFetchingNextPage: boolean;
  hasNextPage: boolean;
  dataUpdatedAt: number;
  fetchNextPage: () => unknown;
  refetch: () => unknown;
};

const SKELETON_ROWS = 3;

// The gap between cards (02: 10 + the 10 top margin each card carries).
function Separator() {
  return <View style={styles.separator} />;
}

type CardListProps<T> = {
  query: QueryLike<T>;
  enabled: boolean;
  keyOf: (row: T) => string;
  renderCard: (row: T, position: LastKnownPosition | null) => React.ReactElement;
  errorTitle: string;
  empty: ListEmpty;
  style?: LayoutStyle;
};

// Shared body of both lists: states, header and the FlatList.
function CardList<T>({ query, enabled, keyOf, renderCard, errorTitle, empty, style }: CardListProps<T>) {
  const t = useT();
  const position = useLastKnownPosition(true);
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = query;
  const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const total = data?.pages[0]?.total;

  const renderItem = useCallback(
    ({ item }: { item: T }) => renderCard(item, position),
    [renderCard, position],
  );
  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  if (!enabled || (query.isPending && query.error === null)) {
    return (
      <View style={[styles.padded, style]} accessibilityLabel={t('common.loading')}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <SkeletonBlock key={index} height={138} />
        ))}
      </View>
    );
  }

  if (query.error !== null && rows.length === 0) {
    return <CaseState kind="error" title={errorTitle} error={query.error} onAction={onRefresh} style={style} />;
  }

  const age = dataAge(query.dataUpdatedAt);
  const stale = age.isStale && age.fetchedAt ? t('cases.updated', { age: formatAge(age.fetchedAt) ?? '' }) : null;
  const refreshFailed = query.error !== null;
  const counted = total !== undefined && rows.length > 0 && rows.length < total;

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
          tintColor={casePalette.open}
          colors={[casePalette.open]}
        />
      }
      ListHeaderComponent={
        stale || refreshFailed || counted ? (
          <View style={styles.header}>
            {counted ? (
              <CaseText kind="cardFoot" color="viewInk">
                {t('cases.count', { shown: rows.length, total: total ?? rows.length })}
              </CaseText>
            ) : null}
            {stale ? (
              <CaseText kind="cardFoot" color="viewInk">
                {stale}
              </CaseText>
            ) : null}
            {refreshFailed ? (
              <CaseText kind="cardFoot" color="statusSentBack" accessibilityRole="alert">
                {t('cases.refreshFailed')}
              </CaseText>
            ) : null}
          </View>
        ) : null
      }
      ListEmptyComponent={
        <CaseState
          kind="empty"
          title={empty.title}
          body={empty.body}
          actionLabel={empty.actionLabel}
          onAction={empty.onAction}
        />
      }
      ListFooterComponent={isFetchingNextPage ? <ListSpinner /> : null}
    />
  );
}

export type ComplaintListProps = {
  filter: CaseListFilter;
  onOpen: (caseRef: string) => void;
  empty: ListEmpty;
  /** False while the filter is still being derived; the list shows its skeleton. */
  enabled?: boolean;
  style?: LayoutStyle;
};

// Stable key: the case reference is unique in the register.
function caseKey(row: CaseRow): string {
  return row.case_ref;
}

export function ComplaintList({ filter, onOpen, empty, enabled = true, style }: ComplaintListProps) {
  const t = useT();
  const query = useCasePages(filter, enabled);
  const renderCard = useCallback(
    (row: CaseRow, position: LastKnownPosition | null) => (
      <CaseRowCard row={row} position={position} onOpen={onOpen} />
    ),
    [onOpen],
  );
  return (
    <CardList
      query={query}
      enabled={enabled}
      keyOf={caseKey}
      renderCard={renderCard}
      errorTitle={t('cases.error.list')}
      empty={empty}
      style={style}
    />
  );
}

export type ScheduledListProps = {
  onOpen: (caseRef: string) => void;
  empty: ListEmpty;
  style?: LayoutStyle;
};

const SCHEDULED = { status: ['scheduled'], sort: 'scheduled_for' } as const;

// Stable key: one card per round.
function roundKey(row: InspectionRow): string {
  return row.inspection_ref;
}

export function ScheduledList({ onOpen, empty, style }: ScheduledListProps) {
  const t = useT();
  const query = useInspectionPages(SCHEDULED);
  const renderCard = useCallback(
    (row: InspectionRow, position: LastKnownPosition | null) => (
      <ScheduledRoundCard row={row} position={position} onOpen={onOpen} />
    ),
    [onOpen],
  );
  return (
    <CardList
      query={query}
      enabled
      keyOf={roundKey}
      renderCard={renderCard}
      errorTitle={t('cases.error.list')}
      empty={empty}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: caseMetrics.gutter, paddingTop: caseMetrics.cardGap, paddingBottom: 32, flexGrow: 1 },
  padded: { paddingHorizontal: caseMetrics.gutter, paddingTop: caseMetrics.cardGap, gap: 20 },
  separator: { height: 20 },
  header: { gap: 4, paddingBottom: 8 },
});
