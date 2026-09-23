/**
 * Layout tokens. docs/Agents-Mobile/ui-tokens.md §5, plus control sizing derived here.
 * Designs are drawn at 412x917; 360 is the real floor on mid-range government handsets.
 */

export const layout = {
  headerHeight: 64, // back, search, notification bell
  tabbarHeight: 72, // four items plus the raised hexagon
  touchMin: 44, // minimum target, everywhere, no exceptions
  footerActions: 64, // wizard Back / Next row
  designWidth: 412,
  minWidth: 360,
} as const;

// Derived: ui-tokens.md fixes touch.min but not control heights. Every value is >= touchMin.
export const control = {
  heightSm: 44,
  heightMd: 48,
  heightLg: 56,
  textAreaMinHeight: 112,
  borderWidth: 1,
  borderWidthFocused: 2,
  hairline: 1,
  // Geometry for the tick drawn from React Native views, so Checkbox needs no icon import.
  checkmark: { width: 6, height: 11, stroke: 2 },
  // Geometry for the caret drawn from React Native views, so Select needs no icon import.
  caret: { size: 8, stroke: 1.5 },
} as const;

// Derived: icon sizes are not in ui-tokens.md; three steps cover every frame read so far.
export const iconSize = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 32,
} as const;

export type IconSizeToken = keyof typeof iconSize;

// Derived: avatar sizes are not in ui-tokens.md. sm is the header, lg is the profile screen.
export const avatarSize = {
  sm: 36,
  md: 44,
  lg: 88,
} as const;

export type AvatarSizeToken = keyof typeof avatarSize;

// Derived: the wizard progress segment and the notification dot.
export const indicator = {
  progressHeight: 6,
  badgeDot: 10,
  badgeCount: 18,
  hexagon: 56,
} as const;

// Derived: submitted-evidence tiles on a detail screen. Square; above touchMin so a tile is a target.
export const media = {
  thumbnail: 96,
} as const;
