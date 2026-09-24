/**
 * Input — a single-line control. Label, hint and error belong to FormField, so this stays
 * an atom and the form row has one owner. ui-registry.md §3.
 */

import { forwardRef, useState } from 'react';
import {
  StyleSheet,
  TextInput,
  View,
  type TextInputProps as RNTextInputProps,
} from 'react-native';

import { useScriptOf } from '@/services/i18n';

import {
  colors,
  control,
  disabledOpacity,
  radius,
  space,
  textStyle,
  type LayoutStyle,
  type TypographyVariant,
} from '../tokens';

export type InputProps = Omit<RNTextInputProps, 'style' | 'placeholderTextColor'> & {
  invalid?: boolean;
  disabled?: boolean;
  /** Case refs, parcel IDs and coordinates render monospace — ui-rules.md §8. */
  monospace?: boolean;
  /** Injected by the caller so an atom never imports another atom. */
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  style?: LayoutStyle;
};

// A framed text field whose border states are focus, error and disabled.
export const Input = forwardRef<TextInput, InputProps>(function Input(
  { invalid = false, disabled = false, monospace = false, leadingIcon, trailingIcon, style, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const script = useScriptOf(rest.value || rest.placeholder);
  const variant: TypographyVariant = monospace ? 'mono' : 'body';
  const border = invalid ? 'statusOverdue' : focused ? 'focus' : 'line1';
  return (
    <View
      style={[
        styles.frame,
        {
          borderColor: colors[border],
          borderWidth: focused ? control.borderWidthFocused : control.borderWidth,
          opacity: disabled ? disabledOpacity : 1,
        },
        style,
      ]}
    >
      {leadingIcon}
      <TextInput
        ref={ref}
        editable={!disabled}
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
        style={[textStyle(variant, 'ink0', script), styles.field]}
        {...rest}
      />
      {trailingIcon}
    </View>
  );
});

const styles = StyleSheet.create({
  frame: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: control.heightMd,
    paddingHorizontal: space[3],
    borderRadius: radius.sm,
    backgroundColor: colors.surface2,
  },
  field: { flex: 1, paddingVertical: space[2] },
});
