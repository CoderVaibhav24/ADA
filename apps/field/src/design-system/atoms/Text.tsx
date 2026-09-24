/**
 * Text — every string in the app renders through this. No screen sets fontSize.
 * Picks Noto Sans Devanagari for Hindi text on its own. ui-registry.md §3, ui-tokens.md §2.
 */

import { Text as RNText, type TextProps as RNTextProps } from 'react-native';

import { useScriptOf } from '@/services/i18n';

import { textStyle, type ColorToken, type LayoutTextStyle, type TypographyVariant } from '../tokens';

export type TextProps = Omit<RNTextProps, 'style'> & {
  variant?: TypographyVariant;
  color?: ColorToken;
  align?: 'auto' | 'left' | 'right' | 'center';
  /** Layout only. The type forbids colour and type-scale values — code-standards.md rule 2. */
  style?: LayoutTextStyle;
  children?: React.ReactNode;
};

// Applies one type-scale variant, one ink token and the script's face; nothing else reaches the text style.
export function Text({
  variant = 'body',
  color,
  align,
  style,
  children,
  ...rest
}: TextProps) {
  const script = useScriptOf(children);
  return (
    <RNText {...rest} style={[textStyle(variant, color, script), style, align ? { textAlign: align } : null]}>
      {children}
    </RNText>
  );
}
