/**
 * ListScreenTemplate — Complaints (02), Inspection (09) and Notifications (13).
 * Header, optional page title, optional search, optional filter tabs, a banner slot that
 * outranks the list, and the list itself. The banner slot always carries PendingBanner:
 * the offline and waiting-upload line is visible from every list (ui-rules.md §2).
 */

import { StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { Text } from '../atoms';
import { PendingBanner } from '../organisms/PendingBanner';
import { colors, shell, space, type LayoutStyle } from '../tokens';
import { ScreenHeader, type ScreenHeaderProps } from './ScreenHeader';
import { useTabBarInset } from './TabBarInset';

export type ListScreenTemplateProps = Pick<ScreenHeaderProps, 'title' | 'onBack' | 'actions'> & {
  /** SearchBar, or nothing. */
  search?: React.ReactNode;
  /** The tab row. Tabs filter, they do not navigate (ui-rules.md §7). */
  filters?: React.ReactNode;
  /** Extra notices under the pending-upload banner. Rendered above the list, never over it. */
  banner?: React.ReactNode;
  /** "Updated 2 hours ago" whenever the list is not fresh (ui-rules.md §2). */
  freshnessLabel?: string;
  /** The FlatList or FlashList. The template does not own the data. */
  children: React.ReactNode;
  /** Sticks to the bottom, above the tab bar. */
  footer?: React.ReactNode;
  /** Only `bottom`/`left`/`right` apply; the header handles the top inset itself. */
  edges?: readonly Edge[];
  style?: LayoutStyle;
  /** Header layout. `search` (02, 09) draws back + search pill + bell and puts `title` under it as the page title. Default `title`. */
  headerVariant?: ScreenHeaderProps['variant'];
  /** Anything else ScreenHeader takes: subtitle, bell mode, search/avatar overrides. */
  headerProps?: Omit<ScreenHeaderProps, 'title' | 'onBack' | 'actions' | 'variant'>;
  /** Default true. */
  showPendingBanner?: boolean;
};

// Everything above the list is fixed; only the list scrolls. The list ends above the tab bar.
export function ListScreenTemplate({
  title,
  onBack,
  actions,
  search,
  filters,
  banner,
  freshnessLabel,
  children,
  footer,
  edges = [],
  style,
  headerVariant = 'title',
  headerProps,
  showPendingBanner = true,
}: ListScreenTemplateProps) {
  const tabInset = useTabBarInset();
  const sideEdges = edges.filter((edge) => edge !== 'top');
  return (
    <SafeAreaView edges={sideEdges} style={[styles.screen, style]}>
      <ScreenHeader {...headerProps} title={title} onBack={onBack} actions={actions} variant={headerVariant} />
      {headerVariant === 'search' || headerVariant === 'home' ? (
        <View style={styles.pageTitle}>
          <Text variant="figHeaderTitle" color="white" accessibilityRole="header" numberOfLines={2}>
            {title}
          </Text>
        </View>
      ) : (
        <View style={styles.titledGap} />
      )}
      {search ? <View style={styles.block}>{search}</View> : null}
      {filters ? <View style={styles.filters}>{filters}</View> : null}
      {showPendingBanner ? <PendingBanner style={styles.banner} /> : null}
      {banner ? <View style={styles.block}>{banner}</View> : null}
      {freshnessLabel ? (
        <Text variant="figTime" color="figMuted" style={styles.freshness}>
          {freshnessLabel}
        </Text>
      ) : null}
      <View style={[styles.list, { paddingBottom: footer ? 0 : tabInset }]}>{children}</View>
      {footer ? <View style={[styles.footer, { marginBottom: tabInset }]}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.figScreen },
  // 02: "Complaints" sits in a 56pt box under the header, x 18.
  pageTitle: { minHeight: shell.pageTitle, justifyContent: 'center', paddingHorizontal: shell.gutter },
  titledGap: { height: shell.contentTopTitled },
  block: { paddingHorizontal: shell.gutter, paddingBottom: space[3] },
  banner: { marginHorizontal: shell.gutter, marginBottom: space[3] },
  filters: { paddingBottom: space[3] },
  freshness: { paddingHorizontal: shell.gutter, paddingBottom: space[2] },
  list: { flex: 1 },
  footer: { paddingHorizontal: shell.gutter, paddingTop: space[3], paddingBottom: space[4] },
});
