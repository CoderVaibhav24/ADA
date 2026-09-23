/**
 * TextArea — remarks and descriptions. Multiline, with an optional character counter.
 * ui-registry.md §3.
 */

import { forwardRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps as RNTextInputProps,
} from 'react-native';

import {
  colors,
  control,
  disabledOpacity,
  radius,
  space,
  textStyle,
  type LayoutStyle,
} from '../tokens';

export type TextAreaProps = Omit<RNTextInputProps, 'style' | 'multiline' | 'placeholderTextColor'> & {
  invalid?: boolean;
  disabled?: boolean;
  rows?: number;
  showCounter?: boolean;
  style?: LayoutStyle;
};

// A multiline field that grows from a token minimum height and never hides its counter.
export const TextArea = forwardRef<TextInput, TextAreaProps>(function TextArea(
  { invalid = false, disabled = false, rows = 4, showCounter = false, maxLength, value, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const border = invalid ? 'statusOverdue' : focused ? 'focus' : 'line1';
  return (
    <View style={style}>
      <View
        style={[
          styles.frame,
          {
            borderColor: colors[border],
            borderWidth: focused ? control.borderWidthFocused : control.borderWidth,
            opacity: disabled ? disabledOpacity : 1,
            minHeight: Math.max(control.textAreaMinHeight, rows * space[6]),
          },
        ]}
      >
        <TextInput
          ref={ref}
          multiline
          textAlignVertical="top"
          editable={!disabled}
          maxLength={maxLength}
          value={value}
          placeholderTextColor={colors.ink3}
          selectionColor={colors.brand}
          accessibilityState={{ disabled }}
          onFocus={(event) => {
            setFocused(true);
            onFocus?.(event);
          }}
          onBlur={(event) => {
            setFocused(false);
            onBlur?.(event);
          }}
          style={[textStyle('body', 'ink0'), styles.field]}
          {...rest}
        />
      </View>
      {showCounter && maxLength !== undefined ? (
        <Text style={[textStyle('caption', 'ink3'), styles.counter]}>
          {`${value?.length ?? 0}/${maxLength}`}
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  frame: {
    padding: space[3],
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
  },
  field: { flex: 1 },
  counter: { marginTop: space[1], textAlign: 'right' },
});
