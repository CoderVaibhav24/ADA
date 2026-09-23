/**
 * StatCard — one of the three Home counts: assigned, completed today, overdue.
 * ui-registry.md §3.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '../atoms';
import {
  colors,
  layout,
  radius,
  space,
  type ColorToken,
  type LayoutStyle,
} from '../tokens';

export type StatCardProps = {
  label: string;
  value: string | number;
  icon?: IconName;
  /** Tints the value and the icon. Overdue is the only count that reads red. */
  tone?: ColorToken;
  onPress?: () => void;
  accessibilityHint?: string;
  testID?: string;
  style?: LayoutStyle;
};

// The card is a button only when it filters something; otherwise it is a plain readout.
export function StatCard({
  label,
  value,
  icon,
  tone = 'ink0',
  onPress,
  accessibilityHint,
  testID,
  style,
}: StatCardProps) {
  const body = (
    <>
      {icon ? <Icon name={icon} size="md" color={tone} /> : null}
      <Text variant="title" color={tone}>
        {value}
      </Text>
      <Text variant="label" color="ink2" numberOfLines={2}>
        {label}
      </Text>
    </>
  );
  if (!onPress) {
    return (
      <View accessible accessibilityLabel={`${label}: ${value}`} style={[styles.card, style]}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint={accessibilityHint}
      style={({ pressed }) => [
        styles.card,
        { backgroundColor: colors[pressed ? 'surface2' : 'surface1'] },
        style,
      ]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: layout.touchMin,
    gap: space[1],
    padding: space[4],
    borderRadius: radius.md,
    backgroundColor: colors.surface1,
  },
});
