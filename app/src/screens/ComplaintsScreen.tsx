import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import {
  Chip,
  InProgressBlock,
  ListScreenTemplate,
  SearchBar,
  StateMessage,
  space,
} from '@/design-system';
import { ComplaintList } from '@/design-system/organisms/ComplaintList';
import type { CaseListFilter } from '@/services/api/case-reads';
import { errorText } from '@/services/api/error-text';
import { useWorkStatuses, type WorkStatuses } from '@/services/config/work-statuses';

/*
 * Complaints, `170:4173`. `GET /api/icms/cases?mine=true`, one list per tab.
 *
 * The tabs are the designs'; the statuses behind them are the officer's, read off
 * `/api/icms/me/capabilities` by `useWorkStatuses` — never a literal list here.
 *
 *   All          mine=true
 *   New          mine=true, status in the statuses a round can be opened from
 *   Scheduled    in progress — "scheduled" is an inspection-round status, and the
 *                case register cannot filter on a round's status
 *   In progress  mine=true, status in the statuses only the assignee can act at
 *
 * Tabs filter, they do not navigate; each visited tab keeps its list mounted so
 * its scroll position survives a switch (ui-rules.md §7).
 */
type TabKey = 'all' | 'new' | 'scheduled' | 'in_progress';

type Tab = {
  readonly key: TabKey;
  readonly label: string;
  /** undefined for a tab with no filter the API supports. */
  readonly statuses?: (work: WorkStatuses) => readonly string[];
};

const TABS: readonly Tab[] = [
  { key: 'all', label: 'All', statuses: () => [] },
  { key: 'new', label: 'New', statuses: (work) => work.toStart },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'in_progress', label: 'In progress', statuses: (work) => work.underway },
];

export function ComplaintsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ q?: string }>();
  const work = useWorkStatuses();

  const incoming = typeof params.q === 'string' ? params.q : '';
  const [draft, setDraft] = useState(incoming);
  const [query, setQuery] = useState(incoming);
  const [active, setActive] = useState<TabKey>('all');
  const [visited, setVisited] = useState<ReadonlySet<TabKey>>(() => new Set<TabKey>(['all']));
  const [handedOver, setHandedOver] = useState(incoming);

  // A search handed over from Home replaces the current one (adjusted during render, not in an effect).
  if (handedOver !== incoming) {
    setHandedOver(incoming);
    setDraft(incoming);
    setQuery(incoming);
  }

  const selectTab = useCallback((key: TabKey) => {
    setActive(key);
    setVisited((previous) => (previous.has(key) ? previous : new Set([...previous, key])));
  }, []);

  const openCase = useCallback(
    (caseRef: string) =>
      router.push({ pathname: '/complaint/[caseRef]', params: { caseRef, from: 'complaints' } }),
    [router],
  );

  const clearSearch = useCallback(() => {
    setDraft('');
    setQuery('');
  }, []);

  // A status tab the officer's role gives nothing to is not shown at all.
  const tabs = useMemo(
    () =>
      TABS.filter((tab) => {
        if (tab.key === 'all' || tab.statuses === undefined || work.data === undefined) return true;
        return tab.statuses(work.data).length > 0;
      }),
    [work.data],
  );

  // The register filter behind a tab, or null while the statuses are still loading.
  const filterFor = (tab: Tab): CaseListFilter | null => {
    if (tab.statuses === undefined) return null;
    const q = query.trim() === '' ? undefined : query.trim();
    if (tab.key === 'all') return { mine: true, q };
    if (work.data === undefined) return null;
    return { mine: true, status: tab.statuses(work.data), q };
  };

  // One tab's body: in progress, a failed filter, or the list.
  const renderTab = (tab: Tab) => {
    if (tab.statuses === undefined) {
      return <InProgressBlock title={tab.label} style={styles.inProgress} />;
    }
    if (tab.key !== 'all' && work.data === undefined && work.error !== null) {
      const failure = errorText(work.error);
      return (
        <StateMessage
          tone={failure.offline ? 'offline' : 'error'}
          title="Your work filters could not be loaded"
          message={failure.message}
          reference={failure.requestId}
          actionLabel="Try again"
          onAction={work.refetch}
        />
      );
    }
    const filter = filterFor(tab);
    const searched = filter?.q;
    return (
      <ComplaintList
        filter={filter ?? { mine: true }}
        enabled={filter !== null}
        onOpen={openCase}
        emptyTitle={
          searched === undefined
            ? `No complaints under ${tab.label}`
            : `No complaints match "${searched}"`
        }
        emptyMessage={
          searched === undefined ? 'Cases assigned to you appear here.' : `Searched the ${tab.label} tab.`
        }
        onClearFilter={searched === undefined ? undefined : clearSearch}
        clearFilterLabel="Clear search"
      />
    );
  };

  return (
    <ListScreenTemplate
      title="Complaints"
      search={
        <SearchBar
          value={draft}
          onChangeText={setDraft}
          onSubmit={() => setQuery(draft)}
          onClear={clearSearch}
          placeholder="Search by case, parcel, address"
          accessibilityLabel="Search complaints"
        />
      }
      filters={
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.tabs}
          accessibilityRole="tablist"
        >
          {tabs.map((tab) => (
            <Chip
              key={tab.key}
              label={tab.label}
              selected={tab.key === active}
              tone={tab.key === active ? 'brand' : 'ink2'}
              appearance={tab.key === active ? 'solid' : 'outline'}
              onPress={() => selectTab(tab.key)}
              accessibilityLabel={`${tab.label} complaints`}
            />
          ))}
        </ScrollView>
      }
    >
      {tabs
        .filter((tab) => visited.has(tab.key))
        .map((tab) => (
          <View key={tab.key} style={tab.key === active ? styles.panel : styles.hidden}>
            {renderTab(tab)}
          </View>
        ))}
    </ListScreenTemplate>
  );
}

const styles = StyleSheet.create({
  tabs: { gap: space[2], paddingHorizontal: space[4] },
  panel: { flex: 1 },
  hidden: { display: 'none' },
  inProgress: { marginHorizontal: space[4] },
});
