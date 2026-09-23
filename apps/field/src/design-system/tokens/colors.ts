/**
 * Colour tokens. Transcribed from docs/Agents-Mobile/ui-tokens.md §1 and nothing else.
 * This file and its siblings in tokens/ are the only place a colour literal may appear.
 * Parity with the portal (docs/Agents/ui-tokens.md) is contractual: change both together.
 */

// Dark is the only theme the tokens define; the app is read outdoors and ships dark-only.
export const colors = {
  // Surfaces — ui-tokens.md §1 Surfaces
  surface0: '#1E1A15', // derived — app background
  surface1: '#2D261E', // Figma `brown 2` — cards, sheets, tab bar
  surface2: '#42382E', // Figma `dark brown` — inputs, raised rows, GPS panel
  surface3: '#4E4236', // derived — pressed state on a raised surface
  surfaceMuted: '#9C8E7C', // derived — light card treatment on complaint cards and findings

  // Ink and line — ui-tokens.md §1 Ink and line
  ink0: '#FFFFFF', // Figma `Earthy` start — titles, card headings, values
  ink1: '#E8E0D6', // derived — body text
  ink2: '#B9AC9C', // derived — labels, secondary meta
  ink3: '#806C5B', // Figma `Earthy` end — placeholders, captions, disabled text
  inkOnMuted: '#2A2018', // derived — text on surfaceMuted, never ink1
  line1: '#564B3E', // derived — input borders, row dividers
  line2: '#3A3128', // derived — hairlines

  // Brand and action — ui-tokens.md §1 Brand and action
  brand: '#CE862E', // Figma `color 1`
  brandPressed: '#B9762A', // derived
  brandTint: '#3A2C1B', // derived — active tab background, selected row
  focus: '#E2A75A', // derived — focus ring under a hardware keyboard

  // Status — ui-tokens.md §1 Status. Same mapping as the portal.
  statusNew: '#9B7BD4',
  statusScheduled: '#4F9CD9',
  statusProgress: '#5FBF6B',
  statusDone: '#5FBF6B',
  statusOverdue: '#E05C4B',

  // Priority — ui-tokens.md §1 Status
  priorityHigh: '#E05C4B',
  priorityMedium: '#E0A030',
  priorityLow: '#5FBF6B',

  // Field signals — ui-tokens.md §1 Signal colours, app only
  gpsLocked: '#5FBF6B',
  gpsWeak: '#E0A030',
  gpsNone: '#E05C4B',
  syncPending: '#E0A030',
  syncFailed: '#E05C4B',
  syncClear: '#5FBF6B',

  // Non-colour, needed where React Native demands a value
  transparent: 'transparent',
} as const;

export type ColorToken = keyof typeof colors;

// Resolves a colour token to its literal. The only sanctioned way out of the token set.
export function color(token: ColorToken): string {
  return colors[token];
}
