/**
 * Chip — the pill behind every status and priority. Status is never colour alone, so a
 * chip always carries its text (ui-rules.md §9).
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { useScriptOf } from '@/services/i18n';

import {
  colors,
  control,
  layout,
  radius,
  space,
  textStyle,
  type ColorToken,
  type LayoutStyle,
} from '../tokens';

export type ChipAppearance = 'soft' | 'solid' | 'outline';
export type ChipSize = 'sm' | 'md';

export type ChipProps = {
  label: string;
  /** The tone token. Domain-to-colour mapping lives in StatusChip and PriorityChip. */
  tone?: ColorToken;
  appearance?: ChipAppearance;
  size?: ChipSize;
  /** A leading dot repeats the tone for readers who scan shape before text. */
  dot?: boolean;
  selected?: boolean;
  onPress?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  style?: LayoutStyle;
};

// Tappable when onPress is given, in which case the target grows to the 44pt minimum.
export function Chip({
  label,
  tone = 'brand',
  appearance = 'soft',
  size = 'md',
  dot = false,
  selected = false,
  onPress,
  accessibilityLabel,
  testID,
  style,
}: ChipProps) {
  const solid = appearance === 'solid';
  const script = useScriptOf(label);
  const background: ColorToken = solid ? tone : appearance === 'outline' ? 'transparent' : 'surface2';
  const foreground: ColorToken = solid ? 'inkOnMuted' : tone;
  const body = (
    <>
      {dot ? <View style={[styles.dot, { backgroundColor: colors[foreground] }]} /> : null}
      <Text numberOfLines={1} style={textStyle(size === 'sm' ? 'caption' : 'label', foreground, script)}>
        {label}
      </Text>
    </>
  );
  const frame = [
    styles.frame,
    size === 'sm' ? styles.sm : styles.md,
    {
      backgroundColor: colors[background],
      borderColor: colors[selected ? 'brand' : tone],
    },
    style,
  ];

  if (!onPress) {
    return <View style={frame}>{body}</View>;
  }
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected }}
      style={[frame, styles.tappable]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  frame: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: space[1],
    borderRadius: radius.pill,
    borderWidth: control.borderWidth,
  },
  sm: { paddingHorizontal: space[2], paddingVertical: space[0] },
  md: { paddingHorizontal: space[3], paddingVertical: space[1] },
  tappable: { minHeight: layout.touchMin, justifyContent: 'center' },
  dot: { width: space[2], height: space[2], borderRadius: radius.pill },
});
