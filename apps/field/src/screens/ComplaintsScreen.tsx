import { useLocalSearchParams, useRouter } from 'expo-router';
import CalendarClock from 'lucide-react-native/icons/calendar-clock';
import Hourglass from 'lucide-react-native/icons/hourglass';
import LayoutList from 'lucide-react-native/icons/layout-list';
import Sparkles from 'lucide-react-native/icons/sparkles';
import X from 'lucide-react-native/icons/x';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { ListScreenTemplate } from '@/design-system';
import { ComplaintList, ScheduledList, type ListEmpty } from '@/design-system/organisms/ComplaintList';
import { CaseState } from '@/design-system/organisms/cases/CaseStates';
import { CaseTabs, type CaseTab } from '@/design-system/organisms/cases/CaseTabs';
import { caseMetrics, casePalette } from '@/design-system/organisms/cases/palette';
import { CaseIcon, CaseText } from '@/design-system/organisms/cases/primitives';
import type { CaseListFilter } from '@/services/api/case-reads';
import { useWorkStatuses, type WorkStatuses } from '@/services/config/work-statuses';
import { useT } from '@/services/i18n';
import { COMPLAINT_IN_COMPLAINTS } from '@/services/navigation/complaint-route';

/*
 * Complaints, Figma 02 (170:4173).
 *
 *   All          GET /api/icms/cases?mine=true
 *   New          mine=true, status in the statuses a round can be opened from
 *   Scheduled    GET /api/icms/inspections?status=scheduled (the surveyor's own rounds)
 *   In progress  mine=true, status in the statuses only the assignee can act at
 *
 * Statuses come from /api/icms/me/capabilities via useWorkStatuses, never a literal list.
 * A search handed over as `?q=` (Home, the header search) narrows the case tabs.
 * Each visited tab stays mounted so its scroll position survives a switch.
 */
type TabKey = 'all' | 'new' | 'scheduled' | 'in_progress';

const STATUSES: Partial<Record<TabKey, (work: WorkStatuses) => readonly string[]>> = {
  new: (work) => work.toStart,
  in_progress: (work) => work.underway,
};

export function ComplaintsScreen() {
  const t = useT();
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const work = useWorkStatuses();

  const incoming = typeof params.q === 'string' ? params.q.trim() : '';
  const [query, setQuery] = useState(incoming);
  const [handedOver, setHandedOver] = useState(incoming);
  const [active, setActive] = useState<TabKey>('all');
  const [visited, setVisited] = useState<ReadonlySet<TabKey>>(() => new Set<TabKey>(['all']));

  // A search handed over from elsewhere replaces the current one (adjusted during render).
  if (handedOver !== incoming) {
    setHandedOver(incoming);
    setQuery(incoming);
  }

  const selectTab = useCallback((key: TabKey) => {
    setActive(key);
    setVisited((previous) => (previous.has(key) ? previous : new Set([...previous, key])));
  }, []);

  const openCase = useCallback(
    (caseRef: string) =>
      router.push({ pathname: COMPLAINT_IN_COMPLAINTS, params: { caseRef, from: 'complaints' } }),
    [router],
  );

  const allTabs = useMemo<readonly CaseTab<TabKey>[]>(
    () => [
      { key: 'all', label: t('cases.tab.all'), glyph: LayoutList },
      { key: 'new', label: t('cases.tab.new'), glyph: Sparkles },
      { key: 'scheduled', label: t('cases.tab.scheduled'), glyph: CalendarClock },
      { key: 'in_progress', label: t('cases.tab.inProgress'), glyph: Hourglass },
    ],
    [t],
  );

  // A status tab the officer's role gives nothing to is not shown.
  const tabs = useMemo(
    () =>
      allTabs.filter((tab) => {
        const statuses = STATUSES[tab.key];
        if (statuses === undefined || work.data === undefined) return true;
        return statuses(work.data).length > 0;
      }),
    [allTabs, work.data],
  );

  const q = query === '' ? undefined : query;

  // The register filter behind a case tab, or null while the statuses are still loading.
  const filterFor = (key: TabKey): CaseListFilter | null => {
    const statuses = STATUSES[key];
    if (statuses === undefined) return { mine: true, q };
    if (work.data === undefined) return null;
    return { mine: true, status: statuses(work.data), q };
  };

  const emptyFor = (tab: CaseTab<TabKey>): ListEmpty => {
    if (q !== undefined && tab.key !== 'scheduled') {
      return {
        title: t('cases.empty.search.title', { query: q }),
        body: t('cases.empty.search.body'),
        actionLabel: t('common.clearSearch'),
        onAction: () => setQuery(''),
      };
    }
    if (tab.key === 'all') {
      return { title: t('cases.empty.all.title'), body: t('cases.empty.all.body') };
    }
    if (tab.key === 'scheduled') {
      return {
        title: t('cases.empty.scheduled.title'),
        body: t('cases.empty.scheduled.body'),
        actionLabel: t('cases.empty.tab.action'),
        onAction: () => selectTab('all'),
      };
    }
    return {
      title: t('cases.empty.tab.title', { tab: tab.label }),
      body: t('cases.empty.tab.body'),
      actionLabel: t('cases.empty.tab.action'),
      onAction: () => selectTab('all'),
    };
  };

  // One tab's body: a failed status read, the scheduled rounds, or the case list.
  const renderTab = (tab: CaseTab<TabKey>) => {
    if (tab.key === 'scheduled') return <ScheduledList onOpen={openCase} empty={emptyFor(tab)} />;
    if (tab.key !== 'all' && work.data === undefined && work.error !== null) {
      return (
        <CaseState kind="error" title={t('cases.error.tab')} error={work.error} onAction={work.refetch} />
      );
    }
    const filter = filterFor(tab.key);
    return (
      <ComplaintList
        filter={filter ?? { mine: true }}
        enabled={filter !== null}
        onOpen={openCase}
        empty={emptyFor(tab)}
      />
    );
  };

  // Back returns to where the tab was entered from; with no history, Home.
  const onBack = () => {
    if (router.canGoBack()) router.back();
    else router.navigate('/home');
  };

  return (
    <ListScreenTemplate
      title={t('cases.list.title')}
      headerVariant="search"
      onBack={onBack}
      search={
        q !== undefined ? (
          <View style={styles.searchRow}>
            <CaseText kind="cardMeta" numberOfLines={1} style={styles.flex}>
              {t('cases.search.showing', { query: q })}
            </CaseText>
            <Pressable
              onPress={() => setQuery('')}
              accessibilityRole="button"
              accessibilityLabel={t('common.clearSearch')}
              style={styles.clear}
              hitSlop={8}
            >
              <CaseIcon glyph={X} size={18} color="white" />
              <CaseText kind="cardMetaSmall">{t('common.clearSearch')}</CaseText>
            </Pressable>
          </View>
        ) : undefined
      }
      filters={<CaseTabs tabs={tabs} active={active} onSelect={selectTab} />}
    >
      <View style={styles.screen}>
        {tabs
          .filter((tab) => visited.has(tab.key))
          .map((tab) => (
            <View key={tab.key} style={tab.key === active ? styles.panel : styles.hidden}>
              {renderTab(tab)}
            </View>
          ))}
      </View>
    </ListScreenTemplate>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: casePalette.screen },
  panel: { flex: 1 },
  hidden: { display: 'none' },
  flex: { flex: 1 },
  searchRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: caseMetrics.touch },
  clear: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: caseMetrics.touch,
    paddingHorizontal: 12,
    borderRadius: caseMetrics.cardRadius,
    backgroundColor: casePalette.secondary,
  },
});
