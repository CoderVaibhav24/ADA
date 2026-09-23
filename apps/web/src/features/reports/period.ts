/**
 * The report window, counted the way `GET /dashboard/trend` counts it.
 *
 * `TrendQuery.days` is 1–365 and the repository reads it as INCLUSIVE of today
 * — `start = end - (days - 1)` in `app/icms/dashboard.py` — so "Last 7 days" is
 * today and the six before it.
 *
 * Every function here is pure and takes the IST date key rather than reading
 * the clock, so the module is testable under Node without a timezone.
 *
 * Figma 134:2479 draws five options and one of them, "All Time", is not among
 * these: `days` is bounded 1-365, there is no since-date and no unbounded mode,
 * so an all-time window would be a 422 rather than a long query.
 */

/** `dashboard_schemas.MAX_TREND_DAYS`. A longer window is a 422, not a slow query. */
export const MAX_TREND_DAYS = 365;

/** `dashboard_schemas.DEFAULT_TREND_DAYS`. */
export const DEFAULT_TREND_DAYS = 30;

export const PERIOD_IDS = [
  "last7",
  "last30",
  "last90",
  "financialYear",
  "last365",
] as const;

export type PeriodId = (typeof PERIOD_IDS)[number];

export const DEFAULT_PERIOD: PeriodId = "last30";

/** `dashboard_schemas.Bucket`. A week starts Monday, a month on the 1st — server-side. */
export const BUCKETS = ["day", "week", "month"] as const;

export type Bucket = (typeof BUCKETS)[number];

export const DEFAULT_BUCKET: Bucket = "day";

/** The Indian financial year opens on 1 April. */
const FINANCIAL_YEAR_START_MONTH = 4;

const MS_PER_DAY = 86_400_000;

export function isPeriodId(value: string | null | undefined): value is PeriodId {
  return value != null && (PERIOD_IDS as readonly string[]).includes(value);
}

export function isBucket(value: string | null | undefined): value is Bucket {
  return value != null && (BUCKETS as readonly string[]).includes(value);
}

// Epoch days for a `YYYY-MM-DD`, parsed as UTC so no local zone can shift the day.
function epochDay(key: string): number {
  const [year, month, day] = key.split("-").map((part) => Number.parseInt(part, 10));
  return Date.UTC(year, month - 1, day) / MS_PER_DAY;
}

/** Days from 1 April of the running financial year to `todayKey`, inclusive. */
export function financialYearDays(todayKey: string): number {
  const [year, month] = todayKey.split("-").map((part) => Number.parseInt(part, 10));
  const startYear = month >= FINANCIAL_YEAR_START_MONTH ? year : year - 1;
  const start = Date.UTC(startYear, FINANCIAL_YEAR_START_MONTH - 1, 1) / MS_PER_DAY;
  // A leap financial year is 366 days and the endpoint refuses 366. Clamping
  // loses 1 April rather than the whole report.
  return Math.min(Math.max(epochDay(todayKey) - start + 1, 1), MAX_TREND_DAYS);
}

/** The `days` parameter for a chosen period. Always 1–365, so never a 422. */
export function periodDays(period: PeriodId, todayKey: string): number {
  switch (period) {
    case "last7":
      return 7;
    case "last30":
      return DEFAULT_TREND_DAYS;
    case "last90":
      return 90;
    case "last365":
      return MAX_TREND_DAYS;
    case "financialYear":
      return financialYearDays(todayKey);
  }
}

export type TrendTotals = { raised: number; resolved: number };

/** Sums the points the server returned — never a window the server was not asked for. */
export function totalsOf(
  points: readonly { raised: number; resolved: number }[],
): TrendTotals {
  return points.reduce<TrendTotals>(
    (sum, point) => ({
      raised: sum.raised + point.raised,
      resolved: sum.resolved + point.resolved,
    }),
    { raised: 0, resolved: 0 },
  );
}

/** Null rather than 0 when nothing was raised: a report must not print 0% of nothing. */
export function resolutionRate(raised: number, resolved: number): number | null {
  if (raised <= 0) return null;
  return (resolved / raised) * 100;
}

/** Null rather than 0 on an empty denominator, for the same reason. */
export function share(part: number, total: number): number | null {
  if (total <= 0) return null;
  return (part / total) * 100;
}

/** Weekly and monthly reports have partial outer buckets; daily ones cannot. */
export function hasPartialBuckets(bucket: Bucket): boolean {
  return bucket !== "day";
}
