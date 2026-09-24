/**
 * ProfileRow — a Profile key/value row (204:4228): label left, value right, on the sand
 * card `#9D8E71`. An icon leads the label (the field rule); a row that opens something
 * shows a chevron and is a 48dp button.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text, type IconName } from '../atoms';
import { colors, control, figCard, layout, radius, space, type LayoutStyle } from '../tokens';

export type ProfileRowProps = {
  icon: IconName;
  label: string;
  /** Text value; omit when `trailing` carries the right side. */
  value?: string;
  /** A control on the right: the language toggle, a Turn on button. */
  trailing?: React.ReactNode;
  onPress?: () => void;
  /** Set on a row that shows or hides content below it: swaps the forward chevron for up/down. */
  expanded?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: LayoutStyle;
};

// Wraps rather than truncates: a reference is never cut in the middle (ui-rules.md §8).
export function ProfileRow({ icon, label, value, trailing, onPress, expanded, accessibilityHint, testID, style }: ProfileRowProps) {
  const chevron: IconName = expanded === undefined ? 'forward' : expanded ? 'chevronUp' : 'chevronDown';
  const body = (
    <>
      <View style={styles.labelSide}>
        <Icon name={icon} size="sm" color="white" />
        <Text variant="figRowLabel" color="white" style={styles.flex}>
          {label}
        </Text>
      </View>
      {value !== undefined ? (
        <Text variant="figRowValue" color="figSandValue" align="right" selectable style={styles.value}>
          {value}
        </Text>
      ) : null}
      {trailing}
      {onPress ? <Icon name={chevron} size="sm" color="figSandValue" /> : null}
    </>
  );
  if (!onPress) {
    return (
      <View testID={testID} style={[styles.row, style]} accessible={trailing === undefined} accessibilityLabel={value ? `${label}: ${value}` : label}>
        {body}
      </View>
    );
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={value ? `${label}: ${value}` : label}
      accessibilityHint={accessibilityHint}
      accessibilityState={expanded === undefined ? undefined : { expanded }}
      style={({ pressed }) => [styles.row, { backgroundColor: colors[pressed ? 'figSandPressed' : 'figSand'] }, style]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.touchMin,
    paddingHorizontal: figCard.rowPadX,
    paddingVertical: figCard.rowPadY,
    borderRadius: radius.figRow,
    borderWidth: control.hairline,
    borderColor: colors.figSandBorder,
    backgroundColor: colors.figSand,
  },
  labelSide: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
  value: { flexShrink: 1, maxWidth: '55%' },
});
