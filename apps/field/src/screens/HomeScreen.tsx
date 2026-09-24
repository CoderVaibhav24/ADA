import { useNavigation, useRouter } from 'expo-router';
import { useCallback } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { ScreenHeader, colors, figCard, shell, space, useTabBarInset } from '@/design-system';
import { NextUpCard } from '@/design-system/organisms/NextUpCard';
import { NotificationFeed } from '@/design-system/organisms/NotificationFeed';
import { notificationHref, type NotificationTarget } from '@/services/push/routing';
import { PendingBanner } from '@/design-system/organisms/PendingBanner';
import { StatStrip, type StatState } from '@/design-system/organisms/StatStrip';
import { useCaseCount, useFirstCase } from '@/services/api/case-reads';
import { errorText } from '@/services/api/error-text';
import { useInspectionCount } from '@/services/api/inspection-reads';
import { inboxConfigured, useInbox } from '@/services/api/notification-reads';
import { useCapabilities } from '@/services/config/capabilities';
import { useWorkStatuses } from '@/services/config/work-statuses';
import { localIsoDay } from '@/services/format/datetime';
import { useT, type TFunction } from '@/services/i18n';
import { COMPLAINT_IN_COMPLAINTS } from '@/services/navigation/complaint-route';

/*
 * Home, `158:3829`.
 *
 *   Assigned         GET /api/icms/cases?mine=true — `total`
 *   Completed today  GET /api/icms/inspections?surveyor_user_id=<me>&submitted_from=<today>
 *                    &submitted_to=<today> — `total`. The case register has no
 *                    completion-date filter; the inspection register's submitted
 *                    day is the honest source.
 *   Overdue          not ready: no due date or SLA exists on a case, and the
 *                    inspection register cannot filter unsubmitted rounds by
 *                    `scheduled_for`. A count from one page would be a guess.
 *   Next up          the first case in the officer's active statuses, by priority.
 *   Notifications    ada-notify GET /v1/me/notifications — the newest three; the
 *                    header bell reads `unread_count` from the same query.
 */

// A failure in plain words: offline or not, never the server's own line.
function plainError(error: Error, t: TFunction): string {
  return t(errorText(error).offline ? 'shell.error.offline' : 'shell.error.generic');
}

// A query's state as a count slot; the server's total or a stated failure.
function countState(query: { data: number | undefined; error: Error | null }, t: TFunction): StatState {
  if (query.data !== undefined) return { kind: 'value', value: query.data };
  if (query.error !== null) return { kind: 'error', message: plainError(query.error, t) };
  return { kind: 'loading' };
}

export function HomeScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const t = useT();
  const tabInset = useTabBarInset();
  const capabilities = useCapabilities();
  const work = useWorkStatuses();

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

  const completedState: StatState =
    capabilities.error !== null && userId === undefined
      ? { kind: 'error', message: plainError(capabilities.error, t) }
      : countState(completedToday, t);

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

  // Opens the case inside the Complaints tab (03 keeps Complaints raised), with the register under it.
  const openCase = useCallback(
    (caseRef: string) =>
      router.push({ pathname: COMPLAINT_IN_COMPLAINTS, params: { caseRef, from: 'complaints' } }, { withAnchor: true }),
    [router],
  );

  // Opens where a notification leads; a no-case item opens the full inbox.
  const openNotification = useCallback(
    (target: NotificationTarget) => router.push(notificationHref(target), { withAnchor: true }),
    [router],
  );

  // Switches tab, keeping whatever that tab had open; a path would push a second list.
  const openTab = (tab: '(complaints)' | '(inspections)') => navigation.navigate(tab as never);

  return (
    <View style={styles.screen}>
      <ScreenHeader variant="home" title={t('shell.tabs.home')} />
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: space[6] + tabInset }]}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={colors.figAccent}
            colors={[colors.figAccent]}
            progressBackgroundColor={colors.figPanel}
          />
        }
      >
        <PendingBanner />

        <StatStrip
          items={[
            {
              key: 'assigned',
              label: t('shell.home.assigned'),
              icon: 'complaints',
              tone: 'figAccent',
              state: countState(assigned, t),
              onPress: () => openTab('(complaints)'),
              accessibilityHint: t('shell.home.assignedHint'),
            },
            {
              key: 'completed-today',
              label: t('shell.home.completedToday'),
              icon: 'success',
              tone: 'figSuccess',
              state: completedState,
              onPress: () => openTab('(inspections)'),
              accessibilityHint: t('shell.home.completedHint'),
            },
            { key: 'overdue', label: t('shell.home.overdue'), icon: 'clock', tone: 'figDanger', state: { kind: 'in_progress' } },
          ]}
        />

        <NextUpCard
          row={nextUpRow}
          errorMessage={nextUpError === null ? null : plainError(nextUpError, t)}
          onOpen={openCase}
          onRetry={() => {
            work.refetch();
            if (active.length > 0) void nextUp.refetch();
          }}
        />

        <NotificationFeed preview={3} onOpen={openNotification} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.figScreen },
  // 170:3828: x 18, 25 below the header, gap 24.
  body: { paddingHorizontal: shell.gutter, paddingTop: shell.contentTop, gap: figCard.sectionGap },
});
