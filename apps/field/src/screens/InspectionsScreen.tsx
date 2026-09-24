import { useRouter } from 'expo-router';
import { useCallback, useMemo } from 'react';
import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { ListScreenTemplate } from '@/design-system';
import { CaseState } from '@/design-system/organisms/cases/CaseStates';
import { InspectionCard } from '@/design-system/organisms/cases/InspectionCard';
import { caseMetrics, casePalette } from '@/design-system/organisms/cases/palette';
import { CaseText, ListSpinner, SkeletonBlock } from '@/design-system/organisms/cases/primitives';
import { useInspectionPages, type InspectionRow } from '@/services/api/inspection-reads';
import { dataAge } from '@/services/api/query-client';
import { formatAge } from '@/services/format/datetime';
import { useT } from '@/services/i18n';
import { COMPLAINT_IN_INSPECTIONS } from '@/services/navigation/complaint-route';

/*
 * Inspections, Figma 09 (195:1961). GET /api/icms/inspections — the server narrows a
 * Field Surveyor to their own rounds, newest first. Every card opens the one Complaint
 * Detail screen in its completed form (10, 195:2657) for that round, with this list as
 * the return target. (The prototype wires cards 2 and 3 to 03; that is a slip.)
 */
const SKELETON_ROWS = 3;
const ALL_ROUNDS = {} as const;

// Stable key: the inspection reference is unique.
function keyOf(row: InspectionRow): string {
  return row.inspection_ref;
}

// The gap between cards (09: 10 + the 10 top margin of cards 2 and 3).
function Separator() {
  return <View style={styles.separator} />;
}

export function InspectionsScreen() {
  const t = useT();
  const router = useRouter();
  const query = useInspectionPages(ALL_ROUNDS);
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = query;
  const rows = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);

  const onView = useCallback(
    (row: InspectionRow) =>
      router.push({
        pathname: COMPLAINT_IN_INSPECTIONS,
        params: { caseRef: row.case_ref, from: 'inspections', round: row.inspection_ref },
      }),
    [router],
  );

  const renderItem = useCallback(
    ({ item }: { item: InspectionRow }) => <InspectionCard row={item} onView={onView} />,
    [onView],
  );

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const age = dataAge(query.dataUpdatedAt);
  const freshness =
    age.isStale && age.fetchedAt ? t('cases.updated', { age: formatAge(age.fetchedAt) ?? '' }) : undefined;

  let body: React.ReactNode;
  if (query.isPending && query.error === null) {
    body = (
      <View style={styles.padded} accessibilityLabel={t('common.loading')}>
        {Array.from({ length: SKELETON_ROWS }, (_, index) => (
          <SkeletonBlock key={index} height={122} />
        ))}
      </View>
    );
  } else if (query.error !== null && rows.length === 0) {
    body = (
      <CaseState kind="error" title={t('inspections.error.title')} error={query.error} onAction={onRefresh} />
    );
  } else {
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
            tintColor={casePalette.open}
            colors={[casePalette.open]}
          />
        }
        ListHeaderComponent={
          query.error !== null ? (
            <CaseText kind="cardFoot" color="statusSentBack" accessibilityRole="alert" style={styles.header}>
              {t('cases.refreshFailed')}
            </CaseText>
          ) : null
        }
        ListEmptyComponent={
          <CaseState
            kind="empty"
            title={t('inspections.empty.title')}
            body={t('inspections.empty.body')}
            actionLabel={t('inspections.empty.action')}
            onAction={() => router.navigate('/complaints')}
          />
        }
        ListFooterComponent={isFetchingNextPage ? <ListSpinner /> : null}
      />
    );
  }

  return (
    <ListScreenTemplate
      title={t('inspections.list.title')}
      headerVariant="search"
      onBack={() => (router.canGoBack() ? router.back() : router.navigate('/home'))}
      freshnessLabel={freshness}
    >
      <View style={styles.screen}>{body}</View>
    </ListScreenTemplate>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: casePalette.screen },
  content: { paddingHorizontal: caseMetrics.gutter, paddingTop: caseMetrics.cardGap, paddingBottom: 32, flexGrow: 1 },
  padded: { paddingHorizontal: caseMetrics.gutter, paddingTop: caseMetrics.cardGap, gap: 20 },
  separator: { height: 20 },
  header: { paddingBottom: 8 },
});
