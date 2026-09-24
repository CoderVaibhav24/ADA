/**
 * TabBarItem — one slot of the notched glass tab bar. Inactive: a muted outline glyph.
 * Active: the glyph has risen into the bar's floating circle, so the slot shows only its label.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import Animated, {
  FadeOut,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';

import { useT } from '@/services/i18n';

import { Badge, Glyph, Icon, Text, type GlyphName, type IconName } from '../atoms';
import { layout, motion, pressedOpacity, shell, space, spring, type LayoutStyle } from '../tokens';

export type TabBarItemProps = {
  /** Lucide fallback, for a tab without a drawn glyph. */
  icon?: IconName;
  /** The drawn glyph; wins over `icon`. */
  glyph?: GlyphName;
  /** Drawn width of the glyph (tokens `shell.tabGlyph*`). */
  glyphWidth?: number;
  label: string;
  active: boolean;
  onPress: () => void;
  /** Unread count on the tab, if the tab carries one. */
  badgeCount?: number;
  testID?: string;
  style?: LayoutStyle;
};

// The label fades in while rising `shell.tabLabelRise` into place.
const labelEntering: EntryExitAnimationFunction = () => {
  'worklet';
  return {
    initialValues: { opacity: 0, transform: [{ translateY: shell.tabLabelRise }] },
    animations: {
      opacity: withTiming(1, { duration: motion.fast }),
      transform: [{ translateY: withTiming(0, { duration: motion.fast }) }],
    },
  };
};
const labelExiting = FadeOut.duration(motion.fast);

// The band under the notch: from the dip's bottom (circle centre + notch radius, below the bar top) to the bar's bottom.
const LABEL_BAND = shell.tabBarBody - (shell.tabCircle / 2 - shell.tabCircleOverhang + shell.tabNotchRadius);

// Press-scale for the slot; off under reduce motion, where the press dims instead.
function usePressMotion() {
  const reduceMotion = useReducedMotion();
  const press = useSharedValue(1);
  const pressStyle = useAnimatedStyle(() => ({ transform: [{ scale: press.value }] }));
  const onPressIn = () => {
    if (!reduceMotion) press.set(withTiming(shell.tabPressScale, { duration: motion.fast }));
  };
  const onPressOut = () => {
    if (!reduceMotion) press.set(withSpring(1, spring.tabIndicator));
  };
  return { reduceMotion, pressStyle, onPressIn, onPressOut };
}

// A flexible slot the height of the bar; the badge stays top-right of the slot whether or not it is active.
export function TabBarItem({ icon, glyph, glyphWidth, label, active, onPress, badgeCount, testID, style }: TabBarItemProps) {
  const t = useT();
  const { reduceMotion, pressStyle, onPressIn, onPressOut } = usePressMotion();
  const hasBadge = badgeCount !== undefined && badgeCount > 0;
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityHint={active ? undefined : t('shell.tabs.a11y', { label })}
      accessibilityState={{ selected: active }}
      style={({ pressed }) => [styles.item, { opacity: pressed && reduceMotion ? pressedOpacity : 1 }, style]}
    >
      <Animated.View style={[styles.content, pressStyle]}>
        {active ? (
          <Animated.View entering={labelEntering} exiting={labelExiting} style={styles.label}>
            <Text variant="figTabLabel" color="ink1" align="center" numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
              {label}
            </Text>
          </Animated.View>
        ) : glyph ? (
          <Glyph name={glyph} width={glyphWidth} color="ink2" />
        ) : (
          <Icon name={icon ?? 'home'} size="lg" color="ink2" />
        )}
        {hasBadge ? (
          <View style={styles.badge}>
            <Badge count={badgeCount} accessibilityLabel={t('tabs.badgeA11y', { count: badgeCount, label })} />
          </View>
        ) : null}
      </Animated.View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    flex: 1,
    alignSelf: 'stretch',
    minHeight: layout.touchMin,
  },
  content: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  label: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: LABEL_BAND,
    justifyContent: 'center',
    paddingHorizontal: space[1],
  },
  badge: { position: 'absolute', top: space[1], right: space[1] },
});
