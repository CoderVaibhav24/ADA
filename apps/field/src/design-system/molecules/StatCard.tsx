/**
 * StatCard — one Home count tile (170:3830): JetBrains Mono number over a Poppins
 * label on `#30281F`. The icon beside the number is the field rule (an icon with every
 * label); the frame draws none.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '../atoms';
import { colors, control, figCard, radius, space, type ColorToken, type LayoutStyle } from '../tokens';

export type StatCardProps = {
  label: string;
  value: string | number;
  icon?: IconName;
  /** Tints the value and the icon: `#C87820` assigned, `#4A9A58` completed, `#D85A38` overdue. */
  tone?: ColorToken;
  onPress?: () => void;
  accessibilityHint?: string;
  testID?: string;
  style?: LayoutStyle;
};

// The card is a button only when it opens something; otherwise it is a plain readout.
export function StatCard({
  label,
  value,
  icon,
  tone = 'figAccent',
  onPress,
  accessibilityHint,
  testID,
  style,
}: StatCardProps) {
  const body = (
    <>
      <View style={styles.valueRow}>
        {icon ? <Icon name={icon} size="sm" color={tone} /> : null}
        <Text variant="figMetric" color={tone} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Text variant="figMetricLabel" color="figBeige" align="center" numberOfLines={2} style={styles.label}>
        {label}
      </Text>
    </>
  );
  if (!onPress) {
    return (
      <View testID={testID} accessible accessibilityLabel={`${label}: ${value}`} style={[styles.card, style]}>
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
        { backgroundColor: colors[pressed ? 'figControl' : 'figTile'] },
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
    minHeight: figCard.metricTileHeight,
    padding: figCard.metricPad,
    borderRadius: radius.md,
    borderWidth: control.hairline,
    borderColor: colors.figTileBorder,
    backgroundColor: colors.figTile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  valueRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  label: { paddingTop: figCard.labelGap },
});
