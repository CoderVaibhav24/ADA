/**
 * NotificationFeed — the surveyor's ada-notify inbox as NotificationRows: the full
 * cursor-paged list, or the newest few as a Home block. A tap marks the item read
 * (fire-and-forget) and hands its case reference to the caller, whose case screen
 * refetches; nothing in an item is rendered as case data (push-and-permissions.md §5).
 */

import { useCallback, useMemo } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, View } from 'react-native';

import { errorText } from '@/services/api/error-text';
import {
  inboxConfigured,
  markNotificationRead,
  useInbox,
  type InboxItem,
} from '@/services/api/notification-reads';
import { dataAge } from '@/services/api/query-client';
import { humanizeCode } from '@/services/config/labels';
import { formatAge } from '@/services/format/datetime';
import type { NotificationType } from '@/services/push/constants';

import { Button, Skeleton, Text } from '../atoms';
import { NotificationRow, StateMessage, type NotificationKind } from '../molecules';
import { colors, control, layout, radius, space, type LayoutStyle } from '../tokens';

export type NotificationFeedProps = {
  /** Called with the item's case reference after the read receipt is sent. */
  onOpen: (caseRef: string) => void;
  /** Show only the newest N items as a block, for Home. Omit for the full list. */
  preview?: number;
  /** The "View all" link in the preview heading. */
  onViewAll?: () => void;
  style?: LayoutStyle;
};

const kinds: Record<NotificationType, NotificationKind> = {
  case_assigned: 'assignment',
  inspection_reminder: 'reminder',
  findings_accepted: 'approved',
  resurvey_requested: 'resurvey',
};

const SKELETON_ROWS = 3;

// The row's icon for a template key; an unknown key gets the plain bell.
function kindOf(type: string): NotificationKind {
  return (kinds as Record<string, NotificationKind | undefined>)[type] ?? 'general';
}

// Heading and body from the server's text; with neither, the template key re-cased, never a made-up line.
function textOf(item: InboxItem): { title: string | undefined; body: string } {
  const title = item.title !== null && item.title !== '' ? item.title : null;
  const body = item.body !== null && item.body !== '' ? item.body : null;
  if (title !== null && body !== null) return { title, body };
  return { title: undefined, body: body ?? title ?? humanizeCode(item.type) };
}

function keyOf(item: InboxItem): string {
  return item.id;
}

// A row-shaped placeholder, so the list does not jump when items arrive.
function RowSkeleton() {
  return (
    <View style={styles.skeletonRow}>
      <Skeleton width={layout.touchMin} height={layout.touchMin} shape="pill" />
      <View style={styles.skeletonText}>
        <Skeleton height={space[4]} />
        <Skeleton height={space[3]} width="30%" />
      </View>
    </View>
  );
}

// A hairline between rows.
function Separator() {
  return <View style={styles.separator} />;
}

// One component, two forms: `preview` renders a Home block, otherwise the paged list.
export function NotificationFeed({ onOpen, preview, onViewAll, style }: NotificationFeedProps) {
  const query = useInbox();
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = query;
  const items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);

  // Marks read without waiting, then opens the case when the item names one.
  const onTap = useCallback(
    (item: InboxItem) => {
      markNotificationRead(item);
      if (item.case_ref !== null) onOpen(item.case_ref);
    },
    [onOpen],
  );

  const renderItem = useCallback(
    ({ item }: { item: InboxItem }) => {
      const text = textOf(item);
      return (
        <NotificationRow
          kind={kindOf(item.type)}
          title={text.title}
          body={text.body}
          caseRef={item.case_ref ?? undefined}
          timeLabel={formatAge(item.created_at) ?? ''}
          unread={!item.read}
          onPress={() => onTap(item)}
          testID={`notification-${item.id}`}
        />
      );
    },
    [onTap],
  );

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  let state: React.ReactNode = null;
  if (!inboxConfigured) {
    state = <StateMessage tone="empty" title="Notifications are not available in this build" />;
  } else if (query.isPending && query.error === null) {
    state = (
      <View style={preview === undefined ? styles.skeletons : styles.skeletonsInset}>
        {Array.from({ length: Math.min(preview ?? SKELETON_ROWS, SKELETON_ROWS) }, (_, index) => (
          <RowSkeleton key={index} />
        ))}
      </View>
    );
  } else if (query.error !== null && items.length === 0) {
    const failure = errorText(query.error);
    state = (
      <StateMessage
        tone={failure.offline ? 'offline' : 'error'}
        title="Notifications could not be loaded"
        message={failure.message}
        reference={failure.requestId}
        actionLabel="Try again"
        onAction={onRefresh}
      />
    );
  }

  const empty = <StateMessage tone="empty" title="No notifications yet" />;

  if (preview !== undefined) {
    const shown = items.slice(0, preview);
    return (
      <View style={[styles.card, style]}>
        <View style={styles.heading}>
          <Text variant="label" style={styles.flex}>
            Recent notifications
          </Text>
          {onViewAll ? (
            <Button
              label="View all"
              onPress={onViewAll}
              variant="ghost"
              size="sm"
              fullWidth={false}
              accessibilityHint="Opens all notifications"
            />
          ) : null}
        </View>
        {state ??
          (shown.length === 0
            ? empty
            : shown.map((item, index) => (
                <View key={item.id}>
                  {index > 0 ? <Separator /> : null}
                  {renderItem({ item })}
                </View>
              )))}
      </View>
    );
  }

  if (state !== null) return <View style={style}>{state}</View>;

  const age = dataAge(query.dataUpdatedAt);
  const staleLabel = age.isStale && age.fetchedAt ? `Updated ${formatAge(age.fetchedAt)}` : null;
  const refreshFailure = query.error !== null ? errorText(query.error) : null;

  return (
    <FlatList
      style={style}
      contentContainerStyle={styles.content}
      data={items}
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
        staleLabel !== null || refreshFailure !== null ? (
          <View style={styles.header}>
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
      ListEmptyComponent={empty}
      ListFooterComponent={
        isFetchingNextPage ? <ActivityIndicator color={colors.brand} style={styles.footer} /> : null
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: space[4], paddingBottom: space[8], flexGrow: 1 },
  card: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface1,
  },
  heading: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
  separator: { height: control.hairline, backgroundColor: colors.line2 },
  header: { gap: space[1], paddingBottom: space[2] },
  footer: { paddingVertical: space[4] },
  skeletons: { gap: space[3], paddingHorizontal: space[4] },
  skeletonsInset: { gap: space[3] },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], padding: space[3] },
  skeletonText: { flex: 1, gap: space[2] },
});
