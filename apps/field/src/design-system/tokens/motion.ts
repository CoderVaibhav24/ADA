/**
 * Motion tokens. docs/Agents-Mobile/ui-tokens.md §6.
 * No state in this app is communicated by animation alone; respect reduce-motion.
 */

export const motion = {
  fast: 120, // press feedback, chip selection
  base: 200, // screen transition, sheet open
  slow: 320, // stepper progress advance
} as const;

export type MotionToken = keyof typeof motion;

// Press opacity is the one visual constant motion needs and ui-tokens.md does not name.
export const pressedOpacity = 0.72;
export const disabledOpacity = 0.45;
