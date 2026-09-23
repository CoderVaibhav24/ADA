/**
 * DetailScreenTemplate — Complaint Detail and Profile.
 * The back action is a prop, not a hard-coded route: `195:2657` and `202:3867` are one
 * screen with two entry points (ui-registry.md §1).
 */

import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Text } from '../atoms';
import { colors, control, space, type LayoutStyle } from '../tokens';
import { ScreenHeader, type ScreenHeaderProps } from './ScreenHeader';

export type DetailScreenTemplateProps = Pick<ScreenHeaderProps, 'title' | 'actions'> & {
  /** Supplied by the screen, which knows which list it was opened from. */
  onBack: () => void;
  backAccessibilityLabel?: string;
  /** Sits under the title: the case reference, a status chip. */
  subtitle?: React.ReactNode;
  /** Renders above the content, never over it. */
  banner?: React.ReactNode;
  /** "Updated 2 hours ago" whenever the record is not fresh (ui-rules.md §2). */
  freshnessLabel?: string;
  children: React.ReactNode;
  /** The screen's primary action: "Start Ground Inspection", "Logout". */
  footer?: React.ReactNode;
  onRefresh?: () => void;
  refreshing?: boolean;
  style?: LayoutStyle;
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
}: DetailScreenTemplateProps) {
  return (
    <SafeAreaView edges={['top']} style={[styles.screen, style]}>
      <ScreenHeader
        title={title}
        onBack={onBack}
        backAccessibilityLabel={backAccessibilityLabel}
        actions={actions}
        subtitle={subtitle}
      />
      {banner ? <View style={styles.banner}>{banner}</View> : null}
      <ScrollView
        contentContainerStyle={styles.body}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.brand}
              colors={[colors.brand]}
              progressBackgroundColor={colors.surface1}
            />
          ) : undefined
        }
      >
        {freshnessLabel ? (
          <Text variant="caption" color="ink3">
            {freshnessLabel}
          </Text>
        ) : null}
        {children}
      </ScrollView>
      {footer ? <View style={styles.footer}>{footer}</View> : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  banner: { paddingHorizontal: space[4], paddingBottom: space[3] },
  body: { padding: space[4], gap: space[5], paddingBottom: space[8] },
  footer: {
    paddingHorizontal: space[4],
    paddingTop: space[3],
    paddingBottom: space[6],
    borderTopWidth: control.hairline,
    borderTopColor: colors.line2,
    backgroundColor: colors.surface1,
  },
});
