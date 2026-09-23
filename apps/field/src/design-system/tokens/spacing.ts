/**
 * Spacing tokens. docs/Agents-Mobile/ui-tokens.md §3. 4pt base.
 * Screen gutter is space[4] on every screen.
 */

export const space = {
  0: 0,
  1: 4, // icon to label
  2: 8, // inside a chip, stacked labels
  3: 12, // input padding
  4: 16, // card padding, screen gutter
  5: 20, // between cards
  6: 24, // section separation
  8: 32, // above a footer action group
} as const;

export type SpaceToken = keyof typeof space;

export const gutter = space[4];
