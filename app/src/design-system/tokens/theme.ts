/**
 * The assembled theme. Import this, or the individual token modules; never a literal.
 *
 * Dark only. ui-tokens.md §1 publishes one palette and ui-rules.md §9 states the theme is
 * dark because the app is read in sunlight. A light palette would be invented values, so
 * the structure allows a second scheme without any component change and carries none.
 */

import { colors } from './colors';
import { avatarSize, control, iconSize, indicator, layout } from './layout';
import { motion, disabledOpacity, pressedOpacity } from './motion';
import { elevation, radius } from './radii';
import { space } from './spacing';
import { fontFamily, typography } from './typography';

export const theme = {
  colors,
  space,
  radius,
  elevation,
  typography,
  fontFamily,
  layout,
  control,
  iconSize,
  avatarSize,
  indicator,
  motion,
  pressedOpacity,
  disabledOpacity,
} as const;

export type Theme = typeof theme;

export type ColorScheme = 'dark';

export const colorScheme: ColorScheme = 'dark';
