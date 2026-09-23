/**
 * The dashboard's arithmetic, kept out of the components so it can be tested.
 *
 * Every import here is `import type`, and that is load-bearing rather than
 * stylistic: `npm test` runs these modules under Node's type stripping, which
 * erases type imports but cannot resolve the `@/` alias. A value imported from
 * `@/api/icms/dashboard` would make the whole file untestable.
 *
 * ## The period whitelist is the API's range, not the design's list
 *
 * Figma's period menu (`134:2479`) offers five options: Last 7 / 30 / 90 days,
 * This Financial Year, All Time. `TrendQuery.days` is `ge=1, le=365` with no
 * since-date parameter and no unbounded mode, so the last two cannot be asked
 * for — a financial year that has run more than 365 days and "all time" are
 * both a 422, and clamping either one silently mislabels the answer. `PERIODS`
 * therefore carries the three day-windows Figma names plus a twelve-month one,
 * and each option fixes its own bucket so the chart never has to draw 365
 * points at three pixels apart.
 *
 * ## Nothing here re-buckets
 *
 * The server buckets in IST and returns every bucket in the window, empty ones
 * as zeroes. `trendTotals` sums what came back and `labelledIndexes` decides
 * which of those buckets get an x-axis label. Neither invents, merges nor drops
 * a point.
 */

import type { Bucket } from "@/api/icms/dashboard";

export type PeriodId = "7d" | "30d" | "90d" | "365d";

export type Period = {
  id: PeriodId;
  /** `days` for `GET /dashboard/trend`. Always within the server's 1–365. */
  days: number;
  /** Fixed per option so the point count stays readable at every window. */
  bucket: Bucket;
};

export const PERIODS: readonly Period[] = [
  { id: "7d", days: 7, bucket: "day" },
  { id: "30d", days: 30, bucket: "day" },
  { id: "90d", days: 90, bucket: "week" },
  { id: "365d", days: 365, bucket: "month" },
];

/** Figma's own default, and the server's. */
export const DEFAULT_PERIOD: PeriodId = "30d";

/** Falls back to the default rather than throwing: the id can arrive from a URL. */
export function periodById(id: string | null | undefined): Period {
  return (
    PERIODS.find((period) => period.id === id) ??
    PERIODS.find((period) => period.id === DEFAULT_PERIOD) ??
    PERIODS[0]
  );
}

export type Counted = { raised: number; resolved: number };

/** Sums the buckets the server returned. A window total, never a re-bucketing. */
export function trendTotals(points: readonly Counted[]): Counted {
  let raised = 0;
  let resolved = 0;
  for (const point of points) {
    raised += point.raised;
    resolved += point.resolved;
  }
  return { raised, resolved };
}

// The smallest 1/2/5×10^k step that spans `max` in at most `maxSteps` intervals.
function niceStep(max: number, maxSteps: number): number {
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(max / maxSteps, 1)));
  for (const multiple of [1, 2, 5]) {
    const step = multiple * magnitude;
    if (step * maxSteps >= max) return step;
  }
  return 10 * magnitude;
}

/**
 * Axis ticks for a count: always from 0, always ending ON the top of the scale.
 *
 * The caller sets the domain to the last tick, so every label names a value the
 * drawn axis reaches and no mark falls outside the plot. An all-zero series
 * gets `[0, 1]` — a count axis has no negative half to borrow headroom from.
 */
export function niceTicks(max: number, maxSteps = 5): number[] {
  if (!Number.isFinite(max) || max <= 0) return [0, 1];
  const step = niceStep(max, maxSteps);
  const steps = Math.ceil(max / step);
  return Array.from({ length: steps + 1 }, (_, index) => index * step);
}

/** The domain top that goes with `niceTicks`, so the top label sits on the frame. */
export function axisMax(ticks: readonly number[]): number {
  return ticks.length === 0 ? 1 : ticks[ticks.length - 1];
}

/**
 * Which bucket indexes get an x-axis label.
 *
 * Thirty daily buckets cannot carry thirty dates at panel width, so the labels
 * are thinned. The last bucket is labelled only when it would not collide with
 * the one before it — a label overlapping its neighbour is worse than absent.
 */
export function labelledIndexes(count: number, maxLabels = 7): number[] {
  if (count <= 0) return [];
  if (count <= maxLabels) return Array.from({ length: count }, (_, index) => index);

  const stride = Math.ceil((count - 1) / (maxLabels - 1));
  const chosen: number[] = [];
  for (let index = 0; index < count; index += stride) chosen.push(index);

  const last = count - 1;
  const previous = chosen[chosen.length - 1];
  if (previous !== last && last - previous >= stride / 2) chosen.push(last);
  return chosen;
}

/**
 * A group's share of the groups that came back, to the nearest whole percent.
 *
 * `by-type` and `by-zone` are `LIMIT 100`, so the denominator is the total of
 * the rows RETURNED and not necessarily the register's total. Callers say so.
 */
export function shareOf(value: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((value / total) * 100);
}

export type Grouped = { total: number };

export function groupTotal(rows: readonly Grouped[]): number {
  return rows.reduce((sum, row) => sum + row.total, 0);
}

/** Cycles the five chart tokens so a sixth group is drawn rather than dropped. */
export function seriesVar(index: number): string {
  return `var(--color-chart-${String((index % 5) + 1)})`;
}
