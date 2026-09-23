/**
 * Text — every string in the app renders through this. No screen sets fontSize.
 * ui-registry.md §3, ui-tokens.md §2.
 */

import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { textStyle, type ColorToken, type LayoutTextStyle, type TypographyVariant } from '../tokens';

export type TextProps = Omit<RNTextProps, 'style'> & {
  variant?: TypographyVariant;
  color?: ColorToken;
  align?: 'auto' | 'left' | 'right' | 'center';
  /** Layout only. The type forbids colour and type-scale values — code-standards.md rule 2. */
  style?: LayoutTextStyle;
  children?: React.ReactNode;
};

// Applies one type-scale variant and one ink token; nothing else may reach the text style.
export function Text({
  variant = 'body',
  color,
  align,
  style,
  children,
  ...rest
}: TextProps) {
  return (
    <RNText {...rest} style={[textStyle(variant, color), style, align ? { textAlign: align } : null]}>
      {children}
    </RNText>
  );
}
