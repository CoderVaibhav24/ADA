/**
 * NotificationFeed — the surveyor's ada-notify inbox: the full cursor-paged list as
 * separate cards (204:4659), or the newest few in one card for Home (173:4666). A tap
 * marks the item read (fire-and-forget) and hands its case reference to the caller,
 * whose case screen refetches; nothing in an item is rendered as case data
 * (push-and-permissions.md §5).
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
import { useT, type PlainKey, type TFunction } from '@/services/i18n';
import type { NotificationType } from '@/services/push/constants';
import { knownType, notificationTarget, safeCaseRef, type NotificationTarget } from '@/services/push/routing';

import { Button, Icon, Skeleton, Text } from '../atoms';
import { NotificationRow, StateMessage, type NotificationKind } from '../molecules';
import { colors, control, elevation, figCard, shell, space, type LayoutStyle } from '../tokens';

export type NotificationFeedProps = {
  /** Called with where the item leads after the read receipt is sent. */
  onOpen: (target: NotificationTarget) => void;
  /** Show only the newest N items as a block, for Home. Omit for the full list. */
  preview?: number;
  /** The "View all" link beside the preview heading. */
  onViewAll?: () => void;
  /** Extra space under the full list, to clear a floating tab bar. */
  bottomInset?: number;
  style?: LayoutStyle;
};

const kinds: Record<NotificationType, NotificationKind> = {
  case_assigned: 'assignment',
  case_unassigned: 'general',
  case_rejected: 'general',
  inspection_assigned: 'assignment',
  inspection_reminder: 'reminder',
  findings_accepted: 'approved',
  resurvey_requested: 'resurvey',
  resurvey_request_raised: 'resurvey',
  resurvey_approved: 'schedule',
};

const fallbackTitles: Record<NotificationType, PlainKey> = {
  case_assigned: 'shell.notifications.type.case_assigned',
  case_unassigned: 'shell.notifications.type.case_unassigned',
  case_rejected: 'shell.notifications.type.case_rejected',
  inspection_assigned: 'shell.notifications.type.inspection_assigned',
  inspection_reminder: 'shell.notifications.type.inspection_reminder',
  findings_accepted: 'shell.notifications.type.findings_accepted',
  resurvey_requested: 'shell.notifications.type.resurvey_requested',
  resurvey_request_raised: 'shell.notifications.type.resurvey_request_raised',
  resurvey_approved: 'shell.notifications.type.resurvey_approved',
};

const SKELETON_ROWS = 3;

// The template key, preferring `data.type`; older servers send only the top-level one.
function typeOf(item: InboxItem): string {
  return item.data?.type ?? item.type;
}

// The row's look for a template key; an unknown key gets the reminder box.
function kindOf(type: string): NotificationKind {
  return (kinds as Record<string, NotificationKind | undefined>)[type] ?? 'general';
}

// Where a row leads: `data` first, then the top-level fields.
function targetOf(item: InboxItem): NotificationTarget {
  return notificationTarget(knownType(typeOf(item)), safeCaseRef(item.data?.case_ref ?? item.case_ref));
}

// Heading and body from the server's text; with neither, the type's own label, else the key re-cased.
function textOf(item: InboxItem, t: TFunction): { title: string | undefined; body: string } {
  const title = item.title !== null && item.title !== '' ? item.title : null;
  const body = item.body !== null && item.body !== '' ? item.body : null;
  if (title !== null && body !== null) return { title, body };
  const type = typeOf(item);
  const known = knownType(type);
  return { title: undefined, body: body ?? title ?? (known !== null ? t(fallbackTitles[known]) : humanizeCode(type)) };
}

function keyOf(item: InboxItem): string {
  return item.id;
}

// A row-shaped placeholder, so the list does not jump when items arrive.
function RowSkeleton() {
  return (
    <View style={styles.skeletonRow}>
      <Skeleton width={figCard.noteIconBox} height={figCard.noteIconBox} shape="md" tone="figControl" />
      <View style={styles.skeletonText}>
        <Skeleton height={space[4]} tone="figControl" />
        <Skeleton height={space[3]} width="30%" tone="figControl" />
      </View>
    </View>
  );
}

// A gap between the separate cards of the full list (204:4659, gap 22).
function CardGap() {
  return <View style={styles.cardGap} />;
}

// One component, two forms: `preview` renders the Home block, otherwise the paged list.
export function NotificationFeed({ onOpen, preview, onViewAll, bottomInset = 0, style }: NotificationFeedProps) {
  const t = useT();
  const query = useInbox();
  const { data, hasNextPage, isFetchingNextPage, fetchNextPage, refetch } = query;
  const items = useMemo(() => data?.pages.flatMap((page) => page.items) ?? [], [data]);
  const grouped = preview !== undefined;

  // Marks read without waiting, then opens the screen the item's type points at.
  const onTap = useCallback(
    (item: InboxItem) => {
      markNotificationRead(item);
      onOpen(targetOf(item));
    },
    [onOpen],
  );

  const renderRow = useCallback(
    (item: InboxItem, showDivider: boolean) => {
      const text = textOf(item, t);
      const caseRef = item.data?.case_ref ?? item.case_ref;
      return (
        <NotificationRow
          kind={kindOf(typeOf(item))}
          title={text.title}
          body={text.body}
          caseRef={caseRef ?? undefined}
          timeLabel={formatAge(item.created_at) ?? ''}
          unread={!item.read}
          onPress={() => onTap(item)}
          appearance={grouped ? 'grouped' : 'card'}
          showDivider={showDivider}
          testID={`notification-${item.id}`}
        />
      );
    },
    [onTap, grouped, t],
  );

  const renderItem = useCallback(({ item }: { item: InboxItem }) => renderRow(item, false), [renderRow]);

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  let state: React.ReactNode = null;
  if (!inboxConfigured) {
    state = <StateMessage tone="empty" title={t('shell.notifications.notAvailable')} />;
  } else if (query.isPending && query.error === null) {
    state = (
      <View style={styles.skeletons}>
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
        title={t('shell.notifications.failed')}
        message={t(failure.offline ? 'shell.error.offline' : 'shell.error.generic')}
        reference={failure.requestId}
        actionLabel={t('common.retry')}
        onAction={onRefresh}
      />
    );
  }

  const empty = (
    <StateMessage tone="empty" title={t('shell.notifications.empty')} message={t('shell.notifications.emptyBody')} />
  );

  if (grouped) {
    const shown = items.slice(0, preview);
    return (
      <View style={[styles.section, style]}>
        <View style={styles.heading}>
          <Text variant="figSection" color="figBeige" accessibilityRole="header" style={styles.flex}>
            {t('shell.home.recent')}
          </Text>
          {onViewAll && shown.length > 0 ? (
            <Button
              label={t('shell.home.viewAll')}
              onPress={onViewAll}
              variant="ghost"
              size="sm"
              fullWidth={false}
              accessibilityHint={t('shell.home.viewAllHint')}
              trailingIcon={<Icon name="forward" size="sm" color="figAccent" />}
            />
          ) : null}
        </View>
        <View style={styles.panel}>
          {state ??
            (shown.length === 0
              ? empty
              : shown.map((item, index) => (
                  <View key={item.id}>{renderRow(item, index < shown.length - 1)}</View>
                )))}
        </View>
      </View>
    );
  }

  if (state !== null) return <View style={[styles.stateFrame, style]}>{state}</View>;

  const age = dataAge(query.dataUpdatedAt);
  const staleLabel = age.isStale && age.fetchedAt ? t('shell.home.updated', { age: formatAge(age.fetchedAt) ?? '' }) : null;
  const refreshFailure = query.error !== null ? errorText(query.error) : null;

  return (
    <FlatList
      style={style}
      contentContainerStyle={[styles.content, { paddingBottom: space[8] + bottomInset }]}
      data={items}
      keyExtractor={keyOf}
      renderItem={renderItem}
      ItemSeparatorComponent={CardGap}
      onEndReached={onEndReached}
      onEndReachedThreshold={0.4}
      refreshControl={
        <RefreshControl
          refreshing={query.isRefetching && !isFetchingNextPage}
          onRefresh={onRefresh}
          tintColor={colors.figAccent}
          colors={[colors.figAccent]}
          progressBackgroundColor={colors.figPanel}
        />
      }
      ListHeaderComponent={
        staleLabel !== null || refreshFailure !== null ? (
          <View style={styles.header}>
            {staleLabel ? (
              <Text variant="figTime" color="figMuted">
                {staleLabel}
              </Text>
            ) : null}
            {refreshFailure ? (
              <Text variant="figBody" color="figDanger" accessibilityRole="alert">
                {t(refreshFailure.offline ? 'shell.error.offline' : 'shell.error.generic')}
              </Text>
            ) : null}
          </View>
        ) : null
      }
      ListEmptyComponent={empty}
      ListFooterComponent={
        isFetchingNextPage ? <ActivityIndicator color={colors.figAccent} style={styles.footer} /> : null
      }
    />
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: shell.gutter, flexGrow: 1 },
  section: { gap: figCard.recentGap },
  heading: { flexDirection: 'row', alignItems: 'center', gap: space[2], paddingLeft: space[1] },
  panel: {
    gap: figCard.panelGap,
    padding: figCard.panelPad,
    borderRadius: figCard.cardRadius,
    borderWidth: control.hairline,
    borderColor: colors.figMuted,
    backgroundColor: colors.figPanelCard,
    ...elevation.figCard,
  },
  flex: { flex: 1 },
  cardGap: { height: figCard.noteListGap },
  header: { gap: space[1], paddingBottom: space[2] },
  footer: { paddingVertical: space[4] },
  stateFrame: { paddingHorizontal: shell.gutter },
  skeletons: { gap: space[3] },
  skeletonRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[2] },
  skeletonText: { flex: 1, gap: space[2] },
});
