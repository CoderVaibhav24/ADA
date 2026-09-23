/**
 * ScreenHeader — the 64pt bar the three templates share: optional back, title, actions.
 * Not in ui-registry.md §3 as a molecule; it exists so the templates do not each restate
 * the same header and drift. Templates only.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text } from '../atoms';
import { colors, layout, space, type LayoutStyle } from '../tokens';

export type ScreenHeaderProps = {
  title: string;
  /** Passed by the screen; a template never imports navigation. */
  onBack?: () => void;
  backAccessibilityLabel?: string;
  /** Right-hand controls: the bell, a search toggle, an overflow. */
  actions?: React.ReactNode;
  /** Sits under the title: "CMP-4512", a village, a cached-at line. */
  subtitle?: React.ReactNode;
  style?: LayoutStyle;
};

// Title truncates before the back target does; the back target is never smaller than 44pt.
export function ScreenHeader({
  title,
  onBack,
  backAccessibilityLabel = 'Go back',
  actions,
  subtitle,
  style,
}: ScreenHeaderProps) {
  return (
    <View style={[styles.header, style]}>
      <View style={styles.bar}>
        {onBack ? (
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel={backAccessibilityLabel}
            style={({ pressed }) => [
              styles.back,
              { backgroundColor: colors[pressed ? 'surface2' : 'transparent'] },
            ]}
          >
            <Icon name="back" size="lg" color="ink0" />
          </Pressable>
        ) : null}
        <Text variant="title" color="ink0" numberOfLines={1} style={styles.title}>
          {title}
        </Text>
        {actions ? <View style={styles.actions}>{actions}</View> : null}
      </View>
      {subtitle}
    </View>
  );
}

const styles = StyleSheet.create({
  header: { gap: space[2], paddingHorizontal: space[4], paddingBottom: space[3] },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: layout.headerHeight,
  },
  back: {
    width: layout.touchMin,
    height: layout.touchMin,
    marginLeft: -space[3],
    borderRadius: layout.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1 },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
});
