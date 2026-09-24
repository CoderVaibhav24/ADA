import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { ResultCard, ScreenHeader, SearchBar, StateMessage, Text, colors, shell, space } from '@/design-system';
import { useCacheSearch } from '@/services/api/cache-search';
import { LABEL_DOMAINS, useCodeLabel } from '@/services/config/labels';
import { formatDate } from '@/services/format/datetime';
import { useT } from '@/services/i18n';
import { complaintPath } from '@/services/navigation/complaint-route';

/*
 * Search — opened from the header search pill (163:1026 has no destination in the
 * prototype; there is no frame). Searches the complaints and inspections this phone
 * already holds, by case number, place or plot, so it works with no signal. A result
 * opens the complaint inside the Complaints tab with the register under it.
 */
export function SearchScreen() {
  const router = useRouter();
  const t = useT();
  const [query, setQuery] = useState('');
  const hits = useCacheSearch(query);
  const caseStatus = useCodeLabel(LABEL_DOMAINS.caseStatus);
  const inspectionStatus = useCodeLabel(LABEL_DOMAINS.inspectionStatus);
  const typed = query.trim() !== '';
  const none = typed && hits.cases.length === 0 && hits.inspections.length === 0;

  // Closes Search, then opens the case in its own tab; dismissTo would drop the tab group and always pick Complaints.
  const openCase = (caseRef: string, from: 'complaints' | 'inspections') => {
    if (router.canDismiss()) router.dismiss();
    router.push({ pathname: complaintPath(from), params: { caseRef, from } }, { withAnchor: true });
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={t('shell.search.title')}
        onBack={() => (router.canGoBack() ? router.back() : router.navigate('/home'))}
      />
      <View style={styles.field}>
        <SearchBar
          appearance="pill"
          value={query}
          onChangeText={setQuery}
          placeholder={t('shell.search.placeholder')}
          accessibilityLabel={t('shell.search.a11y')}
          autoFocus
          testID="search-input"
        />
      </View>
      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag">
        {!typed ? (
          <StateMessage tone="empty" title={t('shell.search.intro')} message={t('shell.search.introBody')} />
        ) : null}
        {none ? (
          <StateMessage tone="empty" title={t('shell.search.none', { query: query.trim() })} message={t('shell.search.noneBody')} />
        ) : null}
        {hits.cases.length > 0 ? (
          <View style={styles.section}>
            <Text variant="figSection" color="figBeige" accessibilityRole="header" style={styles.heading}>
              {t('shell.search.complaints')}
            </Text>
            {hits.cases.map((hit) => (
              <ResultCard
                key={hit.caseRef}
                testID={`search-case-${hit.caseRef}`}
                icon="complaints"
                title={hit.caseRef}
                lines={[hit.title, hit.place, hit.parcel ? t('shell.home.parcel', { id: hit.parcel }) : null]}
                status={hit.status ? { icon: 'info', tone: 'figPillInk', text: caseStatus(hit.status) } : null}
                onPress={() => openCase(hit.caseRef, 'complaints')}
                accessibilityHint={t('shell.search.resultHint')}
              />
            ))}
          </View>
        ) : null}
        {hits.inspections.length > 0 ? (
          <View style={styles.section}>
            <Text variant="figSection" color="figBeige" accessibilityRole="header" style={styles.heading}>
              {t('shell.search.inspections')}
            </Text>
            {hits.inspections.map((hit) => (
              <ResultCard
                key={hit.inspectionRef}
                testID={`search-inspection-${hit.inspectionRef}`}
                icon="inspections"
                title={`${hit.caseRef} · ${hit.inspectionRef}`}
                lines={[
                  hit.place,
                  hit.roundNo !== null ? t('shell.search.round', { count: hit.roundNo }) : null,
                  hit.submittedAt ? t('shell.search.submitted', { date: formatDate(hit.submittedAt) ?? '' }) : null,
                ]}
                status={hit.status ? { icon: 'info', tone: 'figPillInk', text: inspectionStatus(hit.status) } : null}
                onPress={() => openCase(hit.caseRef, 'inspections')}
                accessibilityHint={t('shell.search.resultHint')}
              />
            ))}
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.figScreen },
  field: { paddingHorizontal: shell.gutter, paddingTop: shell.contentTop },
  body: { paddingHorizontal: shell.gutter, paddingTop: space[4], paddingBottom: space[8], gap: space[6] },
  section: { gap: space[3] },
  heading: { paddingHorizontal: space[1] },
});
