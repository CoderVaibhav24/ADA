/**
 * ListRow — label left, value right. Every detail card in the app is built from these.
 * Identifiers render monospace and stay selectable, per ui-rules.md §8.
 */

import { Pressable, StyleSheet, View } from 'react-native';

import { Divider, Icon, Text } from '../atoms';
import { colors, layout, radius, space, type LayoutStyle } from '../tokens';

export type ListRowProps = {
  label: string;
  /** A string renders through Text; a node lets a chip or a readout sit in the value slot. */
  value?: React.ReactNode;
  /** Case refs, parcel IDs and employee IDs. Selectable, because they get read aloud. */
  monospaceValue?: boolean;
  onPress?: () => void;
  showDivider?: boolean;
  accessibilityHint?: string;
  testID?: string;
  style?: LayoutStyle;
};

// Wraps rather than truncates: a reference cut in the middle is worse than a taller row.
export function ListRow({
  label,
  value,
  monospaceValue = false,
  onPress,
  showDivider = false,
  accessibilityHint,
  testID,
  style,
}: ListRowProps) {
  const rendered =
    typeof value === 'string' || typeof value === 'number' ? (
      <Text
        variant={monospaceValue ? 'mono' : 'subheading'}
        color="ink0"
        align="right"
        selectable={monospaceValue}
        style={styles.value}
      >
        {value}
      </Text>
    ) : (
      value
    );

  const content = (
    <View style={styles.row}>
      <Text variant="label" color="ink2" style={styles.label}>
        {label}
      </Text>
      <View style={styles.valueSlot}>{rendered}</View>
      {onPress ? <Icon name="forward" size="sm" color="ink3" /> : null}
    </View>
  );

  return (
    <View style={style}>
      {onPress ? (
        <Pressable
          testID={testID}
          onPress={onPress}
          accessibilityRole="button"
          accessibilityLabel={label}
          accessibilityHint={accessibilityHint}
          style={({ pressed }) => [
            styles.pressable,
            { backgroundColor: colors[pressed ? 'surface2' : 'transparent'] },
          ]}
        >
          {content}
        </Pressable>
      ) : (
        content
      )}
      {showDivider ? <Divider /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  pressable: { borderRadius: radius.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    minHeight: layout.touchMin,
    paddingVertical: space[2],
  },
  label: { flexShrink: 1 },
  valueSlot: { flex: 1, alignItems: 'flex-end' },
  value: { flexShrink: 1 },
});
