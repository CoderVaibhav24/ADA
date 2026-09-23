/**
 * Checkbox — Remember me on login, and any yes/no a form needs.
 * The tick is drawn from view borders so this atom imports no icon.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import {
  colors,
  control,
  disabledOpacity,
  layout,
  radius,
  space,
  textStyle,
  type LayoutStyle,
} from '../tokens';

export type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  testID?: string;
  style?: LayoutStyle;
};

// The whole row is the target, so the 44pt minimum holds even with a 20pt box.
export function Checkbox({
  checked,
  onChange,
  label,
  disabled = false,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: CheckboxProps) {
  return (
    <Pressable
      testID={testID}
      disabled={disabled}
      onPress={() => onChange(!checked)}
      accessibilityRole="checkbox"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ checked, disabled }}
      style={[styles.row, { opacity: disabled ? disabledOpacity : 1 }, style]}
    >
      <View
        style={[
          styles.box,
          {
            backgroundColor: colors[checked ? 'brand' : 'surface2'],
            borderColor: colors[checked ? 'brand' : 'line1'],
          },
        ]}
      >
        {checked ? <View style={styles.tick} /> : null}
      </View>
      {label ? <Text style={textStyle('body', 'ink1')}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: layout.touchMin,
  },
  box: {
    width: space[5],
    height: space[5],
    borderRadius: radius.sm,
    borderWidth: control.borderWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tick: {
    width: control.checkmark.width,
    height: control.checkmark.height,
    borderRightWidth: control.checkmark.stroke,
    borderBottomWidth: control.checkmark.stroke,
    borderColor: colors.inkOnMuted,
    transform: [{ rotate: '45deg' }, { translateY: -control.checkmark.stroke / 2 }],
  },
});
