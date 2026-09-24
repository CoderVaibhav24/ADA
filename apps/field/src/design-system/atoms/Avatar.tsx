/**
 * Avatar — the header face and the profile screen. Falls back to initials, which is the
 * common case on a government handset with no uploaded photograph.
 */

import { Image, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';

import defaultPortrait from '../../../assets/images/avatar-inspector.png';
import { useScriptOf } from '@/services/i18n';

import {
  avatarSize,
  colors,
  control,
  radius,
  shell,
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
  /**
   * `framed` is the mobile frames' avatar (163:1032, 204:4277): a 45.78 circle in a
   * 4.58 `#635540` ring, showing the Figma inspector illustration when there is no photo.
   */
  appearance?: 'initials' | 'framed';
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
export function Avatar({ name, source, size = 'md', ringed = false, appearance = 'initials', style }: AvatarProps) {
  const initials = initialsOf(name);
  const script = useScriptOf(initials);
  if (appearance === 'framed') {
    return (
      <View style={[styles.framed, style]} accessible accessibilityRole="image" accessibilityLabel={name}>
        <Image source={source ?? defaultPortrait} style={styles.framedImage} resizeMode="contain" />
      </View>
    );
  }
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
      <Text style={textStyle(initialsVariant[size], 'brand', script)}>{initials}</Text>
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
  framed: {
    width: shell.control,
    height: shell.control,
    borderRadius: radius.pill,
    borderWidth: shell.avatarRing,
    borderColor: colors.figControl,
    backgroundColor: colors.figControl,
    overflow: 'hidden',
  },
  framedImage: { width: '100%', height: '100%', borderRadius: radius.pill },
});
