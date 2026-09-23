/**
 * How a confidence band is coloured, in one place.
 *
 * A `.ts` file rather than part of parts.tsx because these are not components,
 * and a `.tsx` module exporting both breaks fast refresh — oxlint's
 * `react(only-export-components)`. Two consumers, one table: the list and the
 * detail meter cannot drift apart.
 *
 * Amber, not the frame's green, for `medium`: green means "resolved" in this
 * design system's legend, and one panel cannot use it for two things.
 */

import type { ConfidenceBand } from "./model";

export const BAND_TEXT: Record<ConfidenceBand, string> = {
  high: "text-danger-300",
  medium: "text-warning-400",
  low: "text-fg-faint",
};

/**
 * Colours shadcn's `Progress` indicator, which is `bg-primary` by default.
 *
 * Whole class strings, not `bg-${band}`: Tailwind scans source text, so an
 * interpolated utility is never generated and the meter renders uncoloured.
 * Reaching the indicator through its data-slot is why `Progress` itself stays
 * untouched.
 */
export const BAND_METER: Record<ConfidenceBand, string> = {
  high: "[&_[data-slot=progress-indicator]]:bg-danger-500",
  medium: "[&_[data-slot=progress-indicator]]:bg-warning-500",
  low: "[&_[data-slot=progress-indicator]]:bg-earth-600",
};
