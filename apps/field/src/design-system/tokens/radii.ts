/**
 * Radius and elevation tokens. docs/Agents-Mobile/ui-tokens.md §4.
 * Surface level distinguishes cards, not shadow. The tab bar and the login card are the only shadows in the app.
 */

import type { ViewStyle } from 'react-native';

import { colors } from './colors';

export const radius = {
  none: 0,
  sm: 8, // inputs, small chips
  md: 12, // cards, photo thumbnails
  lg: 16, // sheets, the GPS panel
  pill: 999, // status chips, priority chips, primary buttons
  figRow: 10, // profile rows 204:4228
  figHeader: 22.889, // header bottom corners 163:1013
} as const;

export type RadiusToken = keyof typeof radius;

type ElevationToken =
  | 'card'
  | 'tabbar'
  | 'loginCard'
  | 'loginButton'
  | 'loginFocus'
  | 'figCard'
  | 'figButton'
  | 'tabPill'
  | 'tabCircleGlow';

export const elevation: Record<ElevationToken, ViewStyle> = {
  card: {},
  // Web login, Figma 147:900: the card's drop shadow, the button's glow, the focus ring.
  loginCard: { boxShadow: `0 18.967px 37.934px -9.104px ${colors.loginCardShadow}` },
  loginButton: { boxShadow: `0 0 7.587px ${colors.loginAccentGlow}` },
  loginFocus: { boxShadow: `0 0 0 3px ${colors.loginFocusRing}` },
  // Mobile frames: cards 173:4645, the CTA 173:4660; the floating tab pill.
  figCard: { boxShadow: `0 10px 15px -3px ${colors.figShadow}, 0 4px 6px -4px ${colors.figShadow}` },
  figButton: { boxShadow: `0 4px 6px -1px ${colors.figShadow}, 0 2px 4px -2px ${colors.figShadow}` },
  tabPill: { boxShadow: `0 10px 30px 0 ${colors.tabShadow}` },
  tabCircleGlow: { boxShadow: `0 4px 18px ${colors.tabCircleGlow}` },
  tabbar: {
    shadowColor: colors.inkOnMuted,
    shadowOpacity: 0.32,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
};
