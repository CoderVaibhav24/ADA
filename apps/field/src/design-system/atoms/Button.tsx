/**
 * Button — primary (Confirm Arrival, Next, Submit), secondary (Back), ghost, destructive.
 * Loading disables the button and swaps the label for a spinner. ui-registry.md §3.
 */

import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  type AccessibilityProps,
} from 'react-native';

import {
  colors,
  control,
  disabledOpacity,
  layout,
  radius,
  space,
  textStyle,
  type ColorToken,
  type LayoutStyle,
} from '../tokens';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

export type ButtonProps = Pick<AccessibilityProps, 'accessibilityHint'> & {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  /** Injected by the caller so an atom never imports another atom. */
  leadingIcon?: React.ReactNode;
  trailingIcon?: React.ReactNode;
  accessibilityLabel?: string;
  testID?: string;
  style?: LayoutStyle;
};

type Skin = { bg: ColorToken; bgPressed: ColorToken; fg: ColorToken; border: ColorToken };

const skins: Record<ButtonVariant, Skin> = {
  primary: { bg: 'brand', bgPressed: 'brandPressed', fg: 'inkOnMuted', border: 'brand' },
  secondary: { bg: 'surface2', bgPressed: 'surface3', fg: 'ink0', border: 'line1' },
  ghost: { bg: 'transparent', bgPressed: 'surface2', fg: 'brand', border: 'transparent' },
  destructive: { bg: 'surface2', bgPressed: 'surface3', fg: 'statusOverdue', border: 'statusOverdue' },
};

const heights: Record<ButtonSize, number> = {
  sm: control.heightSm,
  md: control.heightMd,
  lg: control.heightLg,
};

// One pressable, four skins, three heights; every height clears the 44pt minimum.
export function Button({
  label,
  onPress,
  variant = 'primary',
  size = 'md',
  disabled = false,
  loading = false,
  fullWidth = true,
  leadingIcon,
  trailingIcon,
  accessibilityLabel,
  accessibilityHint,
  testID,
  style,
}: ButtonProps) {
  const skin = skins[variant];
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      hitSlop={0}
      style={({ pressed }) => [
        styles.base,
        {
          minHeight: heights[size],
          backgroundColor: colors[pressed && !inactive ? skin.bgPressed : skin.bg],
          borderColor: colors[skin.border],
          opacity: inactive ? disabledOpacity : 1,
          alignSelf: fullWidth ? 'stretch' : 'flex-start',
        },
        style,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={colors[skin.fg]} />
      ) : (
        <View style={styles.content}>
          {leadingIcon}
          <Text style={[textStyle('subheading', skin.fg), styles.label]} numberOfLines={1}>
            {label}
          </Text>
          {trailingIcon}
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minWidth: layout.touchMin,
    paddingHorizontal: space[5],
    borderRadius: radius.pill,
    borderWidth: control.borderWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[2],
  },
  label: { textAlign: 'center' },
});
