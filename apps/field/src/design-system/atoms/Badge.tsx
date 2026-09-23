/**
 * Badge — the unread dot on the notification bell, and the count beside it.
 * Colour alone says nothing, so a count badge always renders its number and a bare dot
 * always carries an accessibility label.
 */

import { StyleSheet, Text, View } from 'react-native';

import {
  colors,
  indicator,
  radius,
  space,
  textStyle,
  type ColorToken,
  type LayoutStyle,
} from '../tokens';

export type BadgeProps = {
  /** Omit for a bare dot. 0 renders nothing. */
  count?: number;
  max?: number;
  tone?: ColorToken;
  accessibilityLabel?: string;
  style?: LayoutStyle;
};

// Returns null at zero: an empty badge is a lie about unread state.
export function Badge({ count, max = 99, tone = 'statusOverdue', accessibilityLabel, style }: BadgeProps) {
  if (count === 0) {
    return null;
  }
  const isDot = count === undefined;
  if (isDot) {
    return (
      <View
        accessible={accessibilityLabel !== undefined}
        accessibilityLabel={accessibilityLabel}
        style={[styles.dot, { backgroundColor: colors[tone] }, style]}
      />
    );
  }
  const shown = count > max ? `${max}+` : `${count}`;
  return (
    <View
      accessible
      accessibilityLabel={accessibilityLabel ?? `${shown} unread`}
      style={[styles.count, { backgroundColor: colors[tone] }, style]}
    >
      <Text style={textStyle('caption', 'ink0')}>{shown}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  dot: {
    width: indicator.badgeDot,
    height: indicator.badgeDot,
    borderRadius: radius.pill,
  },
  count: {
    minWidth: indicator.badgeCount,
    height: indicator.badgeCount,
    paddingHorizontal: space[1],
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
