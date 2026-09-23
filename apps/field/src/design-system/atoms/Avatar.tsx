/**
 * Avatar — the header face and the profile screen. Falls back to initials, which is the
 * common case on a government handset with no uploaded photograph.
 */

import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import {
  avatarSize,
  colors,
  control,
  radius,
  textStyle,
  type AvatarSizeToken,
  type LayoutStyle,
  type TypographyVariant,
} from '../tokens';

export type AvatarProps = {
  name: string;
  source?: ImageSourcePropType;
  size?: AvatarSizeToken;
  /** A ring marks the signed-in user in the header. */
  ringed?: boolean;
  style?: LayoutStyle;
};

const initialsVariant: Record<AvatarSizeToken, TypographyVariant> = {
  sm: 'caption',
  md: 'subheading',
  lg: 'title',
};

// Takes at most two initials; more is unreadable at 36pt.
function initialsOf(name: string): string {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

// Image when there is one, initials when there is not; the label is the name either way.
export function Avatar({ name, source, size = 'md', ringed = false, style }: AvatarProps) {
  const dimension = avatarSize[size];
  const frame = [
    styles.frame,
    {
      width: dimension,
      height: dimension,
      borderRadius: radius.pill,
      borderWidth: ringed ? control.borderWidthFocused : 0,
      borderColor: colors.brand,
    },
    style,
  ];
  if (source) {
    return (
      <View style={frame} accessible accessibilityRole="image" accessibilityLabel={name}>
        <Image source={source} style={[styles.image, { borderRadius: radius.pill }]} />
      </View>
    );
  }
  return (
    <View style={frame} accessible accessibilityRole="image" accessibilityLabel={name}>
      <Text style={textStyle(initialsVariant[size], 'brand')}>{initialsOf(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    backgroundColor: colors.brandTint,
  },
  image: { width: '100%', height: '100%' },
});
