/**
 * Radius and elevation tokens. docs/Agents-Mobile/ui-tokens.md §4.
 * Surface level distinguishes cards, not shadow. The tab bar is the only shadow in the app.
 */

import type { ViewStyle } from 'react-native';

import { colors } from './colors';

export const radius = {
  none: 0,
  sm: 8, // inputs, small chips
  md: 12, // cards, photo thumbnails
  lg: 16, // sheets, the GPS panel
  pill: 999, // status chips, priority chips, primary buttons
} as const;

export type RadiusToken = keyof typeof radius;

export const elevation: Record<'card' | 'tabbar', ViewStyle> = {
  card: {},
  tabbar: {
    shadowColor: colors.inkOnMuted,
    shadowOpacity: 0.32,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
};
