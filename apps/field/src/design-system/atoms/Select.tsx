/**
 * Select — occupation type, confirmed, external support, recommendation, role.
 * Built from a Modal and a Pressable list rather than a picker package: no native module,
 * no extra bytes, and the sheet is styled from tokens like every other surface.
 */

import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

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

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  disabled?: boolean;
};

export type SelectProps<T extends string = string> = {
  options: readonly SelectOption<T>[];
  value?: T;
  onChange: (value: T) => void;
  placeholder?: string;
  /** Title on the sheet. Defaults to the placeholder so the sheet is never unlabelled. */
  sheetTitle?: string;
  invalid?: boolean;
  disabled?: boolean;
  accessibilityLabel: string;
  testID?: string;
  style?: LayoutStyle;
};

// Closed it is a framed row; open it is a bottom sheet of 44pt rows.
export function Select<T extends string = string>({
  options,
  value,
  onChange,
  placeholder = 'Select',
  sheetTitle,
  invalid = false,
  disabled = false,
  accessibilityLabel,
  testID,
  style,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return (
    <View style={style}>
      <Pressable
        testID={testID}
        disabled={disabled}
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityValue={{ text: selected?.label ?? placeholder }}
        accessibilityState={{ disabled, expanded: open }}
        style={({ pressed }) => [
          styles.trigger,
          {
            borderColor: colors[invalid ? 'statusOverdue' : 'line1'],
            backgroundColor: colors[pressed ? 'surface3' : 'surface2'],
            opacity: disabled ? disabledOpacity : 1,
          },
        ]}
      >
        <Text
          numberOfLines={1}
          style={[textStyle('body', selected ? 'ink0' : 'ink3'), styles.triggerLabel]}
        >
          {selected?.label ?? placeholder}
        </Text>
        <View style={styles.caret} />
      </Pressable>

      <Modal
        visible={open}
        transparent
        animationType="fade"
        onRequestClose={() => setOpen(false)}
      >
        <Pressable style={styles.scrim} onPress={() => setOpen(false)} accessibilityRole="button" accessibilityLabel="Close" />
        <View style={styles.sheet}>
          <Text style={[textStyle('label', 'ink2'), styles.sheetTitle]}>
            {sheetTitle ?? accessibilityLabel}
          </Text>
          <ScrollView bounces={false}>
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <Pressable
                  key={option.value}
                  disabled={option.disabled}
                  accessibilityRole="button"
                  accessibilityLabel={option.label}
                  accessibilityState={{ selected: isSelected, disabled: option.disabled }}
                  onPress={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  style={({ pressed }) => [
                    styles.option,
                    {
                      backgroundColor: colors[isSelected ? 'brandTint' : pressed ? 'surface3' : 'transparent'],
                      opacity: option.disabled ? disabledOpacity : 1,
                    },
                  ]}
                >
                  <Text style={textStyle('body', isSelected ? 'brand' : 'ink1')}>{option.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: control.heightMd,
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
    borderWidth: control.borderWidth,
  },
  triggerLabel: { flex: 1 },
  // A caret drawn from view borders, so this atom needs no icon import.
  caret: {
    width: control.caret.size,
    height: control.caret.size,
    borderRightWidth: control.caret.stroke,
    borderBottomWidth: control.caret.stroke,
    borderColor: colors.ink2,
    transform: [{ rotate: '45deg' }, { translateY: -control.caret.stroke }],
  },
  scrim: { flex: 1, backgroundColor: colors.surface0, opacity: 0.72 },
  sheet: {
    maxHeight: '60%',
    paddingTop: space[4],
    paddingBottom: space[6],
    paddingHorizontal: space[4],
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    backgroundColor: colors.surface1,
  },
  sheetTitle: { marginBottom: space[3] },
  option: {
    minHeight: layout.touchMin,
    justifyContent: 'center',
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
  },
});
