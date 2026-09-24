// Pure dashboard arithmetic. Type-only imports: `npm test` runs this under Node type stripping.
// PERIODS stays inside the API's 1-365 day range; nothing here re-buckets.

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

/** Count-axis ticks from 0 ending on the scale top; an all-zero series gets [0, 1]. */
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

/** Thinned x-axis label indexes; the last bucket only when it clears its neighbour. */
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

/** Whole-percent share of the rows returned (the endpoints cap at 100 groups). */
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

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;

// IST calendar-day index of a timestamp.
function istDay(ms: number): number {
  return Math.floor((ms + IST_OFFSET_MS) / DAY_MS);
}

/** Whole IST calendar days from `iso` to `now`; 0 for today or a future stamp, null if unparseable. */
export function daysAgo(iso: string, now: Date | number): number | null {
  const then = Date.parse(iso);
  const current = typeof now === "number" ? now : now.getTime();
  if (Number.isNaN(then) || Number.isNaN(current)) return null;
  return Math.max(0, istDay(current) - istDay(then));
}
