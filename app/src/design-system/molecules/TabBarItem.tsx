/**
 * TabBarItem — icon, label and the raised hexagon that marks the active tab.
 * One component with a state, not four components (ui-registry.md §2). The hexagon is a
 * react-native-svg polygon rather than an image asset, so it costs no bytes at any density.
 */

import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';

import { Badge, Icon, Text, type IconName } from '../atoms';
import {
  colors,
  indicator,
  layout,
  space,
  type LayoutStyle,
} from '../tokens';

export type TabBarItemProps = {
  icon: IconName;
  label: string;
  active: boolean;
  onPress: () => void;
  /** Unread count on the tab, if the tab carries one. */
  badgeCount?: number;
  testID?: string;
  style?: LayoutStyle;
};

// A pointy-top hexagon in a 100x100 box, so it scales with the token without new points.
const HEXAGON_POINTS = '50,2 95,26 95,74 50,98 5,74 5,26';

// Active raises the hexagon behind the glyph; inactive is a plain icon and label.
export function TabBarItem({ icon, label, active, onPress, badgeCount, testID, style }: TabBarItemProps) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="tab"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      style={[styles.item, style]}
    >
      <View style={styles.glyphWell}>
        {active ? (
          <Svg
            width={indicator.hexagon}
            height={indicator.hexagon}
            viewBox="0 0 100 100"
            style={StyleSheet.absoluteFill}
          >
            <Polygon points={HEXAGON_POINTS} fill={colors.brand} />
          </Svg>
        ) : null}
        <Icon name={icon} size="lg" color={active ? 'inkOnMuted' : 'ink2'} />
        {badgeCount !== undefined && badgeCount > 0 ? (
          <View style={styles.badge}>
            <Badge count={badgeCount} accessibilityLabel={`${badgeCount} unread in ${label}`} />
          </View>
        ) : null}
      </View>
      <Text variant="caption" color={active ? 'brand' : 'ink2'} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  item: {
    flex: 1,
    minWidth: layout.touchMin,
    minHeight: layout.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    paddingVertical: space[1],
  },
  glyphWell: {
    width: indicator.hexagon,
    height: indicator.hexagon,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: { position: 'absolute', top: space[2], right: space[2] },
});
