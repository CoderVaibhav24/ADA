/**
 * DetailScreenTemplate — Complaint Detail (03, 10, 11), Submitted (08) and any detail
 * screen. The back action is a prop, not a hard-coded route: `195:2657` and `202:3867`
 * are one screen with two entry points (ui-registry.md §1).
 */

import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';

import { Text } from '../atoms';
import { PendingBanner } from '../organisms/PendingBanner';
import { colors, shell, space, type LayoutStyle } from '../tokens';
import { ScreenHeader, type ScreenHeaderProps } from './ScreenHeader';
import { useTabBarInset } from './TabBarInset';

export type DetailScreenTemplateProps = Pick<ScreenHeaderProps, 'title' | 'actions'> & {
  /** Supplied by the screen, which knows which list it was opened from. */
  onBack: () => void;
  backAccessibilityLabel?: string;
  /** Under the title: the case reference (string, drawn `#94A3B8`), or a node. */
  subtitle?: React.ReactNode;
  /** Renders above the content, never over it. */
  banner?: React.ReactNode;
  /** "Updated 2 hours ago" whenever the record is not fresh (ui-rules.md §2). */
  freshnessLabel?: string;
  children: React.ReactNode;
  /** The screen's primary action: "Start Ground Inspection". Sits above the tab bar. */
  footer?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  style?: LayoutStyle;
  /** Default `title`; `compact` is 08's 72pt strip. */
  headerVariant?: ScreenHeaderProps['variant'];
  /** Anything else ScreenHeader takes: bell mode and overrides. */
  headerProps?: Omit<ScreenHeaderProps, 'title' | 'onBack' | 'actions' | 'variant' | 'subtitle' | 'backAccessibilityLabel'>;
  /** Default false: lists carry the pending banner; opt in here. */
  showPendingBanner?: boolean;
};

// Scrolls the body only; the header and the primary action stay put.
export function DetailScreenTemplate({
  title,
  actions,
  onBack,
  backAccessibilityLabel,
  subtitle,
  banner,
  freshnessLabel,
  children,
  footer,
  onRefresh,
  refreshing = false,
  style,
  headerVariant = 'title',
  headerProps,
  showPendingBanner = false,
}: DetailScreenTemplateProps) {
  const tabInset = useTabBarInset();
  return (
    <View style={[styles.screen, style]}>
      <ScreenHeader
        {...headerProps}
        variant={headerVariant}
        title={title}
        onBack={onBack}
        backAccessibilityLabel={backAccessibilityLabel}
        actions={actions}
        subtitle={subtitle}
      />
      {showPendingBanner ? <PendingBanner style={styles.banner} /> : null}
      {banner ? <View style={styles.bannerSlot}>{banner}</View> : null}
      <ScrollView
        contentContainerStyle={[styles.body, { paddingBottom: space[6] + (footer ? 0 : tabInset) }]}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.figAccent}
              colors={[colors.figAccent]}
              progressBackgroundColor={colors.figPanel}
            />
          ) : undefined
        }
      >
        {freshnessLabel ? (
          <Text variant="figTime" color="figMuted">
            {freshnessLabel}
          </Text>
        ) : null}
        {children}
      </ScrollView>
      {footer ? <View style={[styles.footer, { marginBottom: tabInset }]}>{footer}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.figScreen },
  banner: { marginHorizontal: shell.gutter, marginTop: space[3] },
  bannerSlot: { paddingHorizontal: shell.gutter, paddingTop: space[3] },
  // 03: content column px 16 inside the x-18 frame, top 170, gap 14.
  body: { paddingHorizontal: shell.detailPadX, paddingTop: shell.detailTop, gap: shell.detailGap },
  footer: { paddingHorizontal: shell.detailPadX, paddingTop: space[3], paddingBottom: space[3] },
});
