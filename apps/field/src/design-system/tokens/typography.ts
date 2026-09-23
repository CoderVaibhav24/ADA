/**
 * Type tokens. docs/Agents-Mobile/ui-tokens.md §2.
 * Minimum rendered body size is 14; nothing carrying meaning is below 12.
 */

import { Platform, type TextStyle } from 'react-native';

import { colors, type ColorToken } from './colors';

const systemSans = Platform.select({ ios: 'System', android: 'sans-serif', default: 'System' });
const systemMono = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

// font.display is an open item in ui-tokens.md §2; it aliases the system face until confirmed.
export const fontFamily = {
  display: systemSans,
  body: systemSans,
  mono: systemMono,
} as const;

export type FontFamilyToken = keyof typeof fontFamily;

export const typography = {
  title: {
    fontFamily: fontFamily.display,
    fontSize: 26,
    lineHeight: 32,
    fontWeight: '700',
  },
  heading: {
    fontFamily: fontFamily.display,
    fontSize: 20,
    lineHeight: 26,
    fontWeight: '700',
  },
  subheading: {
    fontFamily: fontFamily.display,
    fontSize: 16,
    lineHeight: 22,
    fontWeight: '600',
  },
  label: {
    fontFamily: fontFamily.body,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '600',
    letterSpacing: 0.72, // 0.06em at 12pt
    textTransform: 'uppercase',
  },
  body: {
    fontFamily: fontFamily.body,
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '400',
  },
  caption: {
    fontFamily: fontFamily.body,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
  },
  mono: {
    fontFamily: fontFamily.mono,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  },
} as const satisfies Record<string, TextStyle>;

export type TypographyVariant = keyof typeof typography;

// The default ink for each variant, so a caller that omits `color` still lands on a token.
const variantColor: Record<TypographyVariant, ColorToken> = {
  title: 'ink0',
  heading: 'ink0',
  subheading: 'ink0',
  label: 'ink2',
  body: 'ink1',
  caption: 'ink2',
  mono: 'ink1',
};

// Builds a text style from tokens. Every atom uses this rather than restating the scale.
export function textStyle(variant: TypographyVariant, colorToken?: ColorToken): TextStyle {
  return { ...typography[variant], color: colors[colorToken ?? variantColor[variant]] };
}
