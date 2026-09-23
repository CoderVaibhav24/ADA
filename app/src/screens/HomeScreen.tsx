import { useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Avatar,
  Badge,
  Icon,
  SearchBar,
  Skeleton,
  Text,
  colors,
  layout,
  space,
} from '@/design-system';
import { NextUpCard } from '@/design-system/organisms/NextUpCard';
import { NotificationFeed } from '@/design-system/organisms/NotificationFeed';
import { StatStrip, type StatState } from '@/design-system/organisms/StatStrip';
import { useCaseCount, useFirstCase } from '@/services/api/case-reads';
import { errorText } from '@/services/api/error-text';
import { useInspectionCount } from '@/services/api/inspection-reads';
import { inboxConfigured, useInbox } from '@/services/api/notification-reads';
import { displayName } from '@/services/auth/claims';
import { useTokenClaims } from '@/services/auth/use-token-claims';
import { useCapabilities } from '@/services/config/capabilities';
import { useWorkStatuses } from '@/services/config/work-statuses';
import { localIsoDay } from '@/services/format/datetime';

/*
 * Home, `158:3829`.
 *
 *   Assigned         GET /api/icms/cases?mine=true — `total`
 *   Completed today  GET /api/icms/inspections?surveyor_user_id=<me>&submitted_from=<today>
 *                    &submitted_to=<today> — `total`. The case register has no
 *                    completion-date filter; the inspection register's submitted
 *                    day is the honest source.
 *   Overdue          in progress — no due date or SLA exists on a case or a round.
 *   Next up          the first case in the officer's active statuses, by priority.
 *   Notifications    ada-notify GET /v1/me/notifications — the newest three, and
 *                    `unread_count` for the bell's dot.
 */

// A query's state as a count slot; the server's total or the server's message.
function countState(query: { data: number | undefined; error: Error | null }): StatState {
  if (query.data !== undefined) return { kind: 'value', value: query.data };
  if (query.error !== null) return { kind: 'error', message: errorText(query.error).message };
  return { kind: 'loading' };
}

export function HomeScreen() {
  const router = useRouter();
  const claims = useTokenClaims();
  const capabilities = useCapabilities();
  const work = useWorkStatuses();
  const [search, setSearch] = useState('');

  const userId = capabilities.data?.user_id;
  const today = localIsoDay();
  const active = work.data?.active ?? [];

  const assigned = useCaseCount({ mine: true });
  const completedToday = useInspectionCount(
    {
      surveyorUserId: userId === undefined ? undefined : [userId],
      submittedFrom: today,
      submittedTo: today,
    },
    userId !== undefined,
  );
  const nextUp = useFirstCase({ mine: true, status: active, sort: 'priority' }, active.length > 0);
  const inbox = useInbox();
  const unread = inbox.data?.pages[0]?.unread_count ?? 0;

  const completedState: StatState =
    capabilities.error !== null && userId === undefined
      ? { kind: 'error', message: errorText(capabilities.error).message }
      : countState(completedToday);

  const nextUpRow = work.data !== undefined && active.length === 0 ? null : nextUp.data;
  const nextUpError = nextUp.error ?? (work.data === undefined ? work.error : null);

  const refreshing =
    assigned.isRefetching || completedToday.isRefetching || nextUp.isRefetching || inbox.isRefetching;

  // Refetches every read on the screen; a disabled read stays disabled.
  const onRefresh = () => {
    void assigned.refetch();
    void capabilities.refetch();
    if (userId !== undefined) void completedToday.refetch();
    if (active.length > 0) void nextUp.refetch();
    if (inboxConfigured) void inbox.refetch();
  };

  const openCase = useCallback(
    (caseRef: string) =>
      router.push({ pathname: '/complaint/[caseRef]', params: { caseRef, from: 'home' } }),
    [router],
  );

  // Hands the search to the Complaints tab, which runs it against the register.
  const submitSearch = () => {
    const q = search.trim();
    router.push({ pathname: '/complaints', params: q === '' ? {} : { q } });
  };

  const name = claims.status === 'ready' ? displayName(claims.claims) : null;

  return (
    <SafeAreaView edges={['top']} style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.surface1}
          />
        }
      >
        <View style={styles.header}>
          {name === null ? (
            <Skeleton width={layout.touchMin} height={layout.touchMin} shape="pill" />
          ) : (
            <Avatar name={name} size="md" ringed />
          )}
          <View style={styles.greeting}>
            {name === null ? (
              <Skeleton height={space[5]} width="60%" />
            ) : (
              <Text variant="subheading" numberOfLines={1}>
                {name}
              </Text>
            )}
          </View>
          <Pressable
            onPress={() => router.push('/notifications')}
            accessibilityRole="button"
            accessibilityLabel={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
            style={({ pressed }) => [
              styles.bell,
              { backgroundColor: colors[pressed ? 'surface2' : 'surface1'] },
            ]}
          >
            <Icon name="bell" size="lg" color="ink0" />
            {unread > 0 ? <Badge style={styles.bellDot} /> : null}
          </Pressable>
        </View>

        <SearchBar
          value={search}
          onChangeText={setSearch}
          onSubmit={submitSearch}
          placeholder="Search complaints"
          accessibilityLabel="Search complaints"
        />

        <StatStrip
          items={[
            {
              key: 'assigned',
              label: 'Assigned',
              icon: 'complaints',
              state: countState(assigned),
              onPress: () => router.push('/complaints'),
              accessibilityHint: 'Opens your complaints',
            },
            {
              key: 'completed-today',
              label: 'Completed today',
              icon: 'success',
              tone: 'statusDone',
              state: completedState,
              onPress: () => router.push('/inspections'),
              accessibilityHint: 'Opens your inspections',
            },
            { key: 'overdue', label: 'Overdue', icon: 'clock', state: { kind: 'in_progress' } },
          ]}
        />

        <NextUpCard
          row={nextUpRow}
          errorMessage={nextUpError === null ? null : errorText(nextUpError).message}
          onOpen={openCase}
          onRetry={() => {
            work.refetch();
            if (active.length > 0) void nextUp.refetch();
          }}
        />

        <NotificationFeed preview={3} onOpen={openCase} onViewAll={() => router.push('/notifications')} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  body: { padding: space[4], gap: space[5], paddingBottom: space[8] },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.headerHeight,
  },
  greeting: { flex: 1 },
  bell: {
    width: layout.touchMin,
    height: layout.touchMin,
    borderRadius: layout.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: { position: 'absolute', top: space[2], right: space[2] },
});
