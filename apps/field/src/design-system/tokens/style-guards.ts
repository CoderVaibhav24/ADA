/**
 * Type-level enforcement of code-standards.md rule 2, in place of a runtime theme library.
 * A style prop typed this way cannot carry a colour or a font value, so the only route to
 * either is a token. Rationale is in docs/Agents-Mobile/ui-tokens.md §1.
 */

import type { ImageStyle, TextStyle, ViewStyle } from 'react-native';

type ColourKeys =
  | 'backgroundColor'
  | 'borderColor'
  | 'borderTopColor'
  | 'borderBottomColor'
  | 'borderLeftColor'
  | 'borderRightColor'
  | 'borderStartColor'
  | 'borderEndColor'
  | 'borderBlockColor'
  | 'borderBlockEndColor'
  | 'borderBlockStartColor'
  | 'shadowColor'
  | 'overlayColor'
  | 'tintColor';

type FontKeys =
  | 'color'
  | 'fontFamily'
  | 'fontSize'
  | 'fontWeight'
  | 'lineHeight'
  | 'letterSpacing'
  | 'textTransform'
  | 'textShadowColor'
  | 'textDecorationColor';

/** Layout-only view style: positioning and flex, never colour. */
export type LayoutStyle = Omit<ViewStyle, ColourKeys>;

/** Layout-only text style: alignment and spacing, never colour or type scale. */
export type LayoutTextStyle = Omit<TextStyle, ColourKeys | FontKeys>;

/** Layout-only image style: size and fit, never tint. */
export type LayoutImageStyle = Omit<ImageStyle, ColourKeys>;
