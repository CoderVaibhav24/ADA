/**
 * ListScreenTemplate — Complaints, Inspections and Notifications.
 * Header, optional search, optional filter tabs, a banner slot that outranks the list, and
 * the list itself. The banner slot exists because the sync banner is visible from every
 * screen while anything is unsent (ui-rules.md §2).
 */

import { StyleSheet, View } from 'react-native';
import { SafeAreaView, type Edge } from 'react-native-safe-area-context';

import { Text } from '../atoms';
import { colors, control, space, type LayoutStyle } from '../tokens';
import { ScreenHeader, type ScreenHeaderProps } from './ScreenHeader';

export type ListScreenTemplateProps = Pick<ScreenHeaderProps, 'title' | 'onBack' | 'actions'> & {
  /** SearchBar, or nothing. */
  search?: React.ReactNode;
  /** The tab row. Tabs filter, they do not navigate (ui-rules.md §7). */
  filters?: React.ReactNode;
  /** SyncQueueBanner and offline notices. Rendered above the list, never over it. */
  banner?: React.ReactNode;
  /** "Updated 2 hours ago" whenever the list is not fresh (ui-rules.md §2). */
  freshnessLabel?: string;
  /** The FlatList or FlashList. The template does not own the data. */
  children: React.ReactNode;
  /** Sticks to the bottom above the safe area. */
  footer?: React.ReactNode;
  edges?: readonly Edge[];
  style?: LayoutStyle;
};

// Everything above the list is fixed; only the list scrolls.
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
  edges = ['top'],
  style,
}: ListScreenTemplateProps) {
  return (
    <SafeAreaView edges={edges} style={[styles.screen, style]}>
      <ScreenHeader title={title} onBack={onBack} actions={actions} />
      {search ? <View style={styles.block}>{search}</View> : null}
      {filters ? <View style={styles.filters}>{filters}</View> : null}
      {banner ? <View style={styles.block}>{banner}</View> : null}
      {freshnessLabel ? (
        <Text variant="caption" color="ink3" style={styles.freshness}>
          {freshnessLabel}
        </Text>
      ) : null}
      <View style={styles.list}>{children}</View>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  block: { paddingHorizontal: space[4], paddingBottom: space[3] },
  filters: { paddingBottom: space[3] },
  freshness: { paddingHorizontal: space[4], paddingBottom: space[2] },
  list: { flex: 1 },
  footer: {
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: space[6],
    borderTopWidth: control.hairline,
    borderTopColor: colors.line2,
    backgroundColor: colors.surface1,
  },
});
