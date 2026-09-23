/**
 * `/api/icms/dashboard/*` — Batch 5, portal side. Four reads, no writes.
 *
 * Written against `backend/api/app/routers/icms_dashboard.py` and
 * `app/icms/dashboard_schemas.py`.
 *
 * ## Why these types are hand-written when every other module's are generated
 *
 * `src/api/generated/ada-api.ts` predates this router: it carries no
 * `DashboardSummary`, no `TrendPoint`, no `ZoneCount`. `scripts/generate-api-types.mjs`
 * warns about exactly this situation — the served spec can lag the source app,
 * and regenerating against a stale one LOSES types rather than gaining them.
 * So the shapes below mirror `dashboard_schemas.py` field for field, and this
 * comment is the marker for whoever next runs `npm run api:types`: delete them
 * and re-export from `components["schemas"]` once the spec carries them.
 *
 * ## Four things about this contract a caller must not get wrong
 *
 *   - **`resolved` is a COHORT, not a closure count.** In `trend` it is: of the
 *     cases RAISED in this bucket, how many have since reached `closed` or
 *     `rejected`. It is not "cases closed on that day", and a chart that labels
 *     it so draws a different series from the one the server sent. The same
 *     word in `by-type` and `by-zone` means the same predicate — terminal
 *     status — and there `total === open + resolved` exactly, because the two
 *     server-side predicates are complements.
 *   - **empty buckets come back as ZEROES, not omitted.** `_bucket_starts`
 *     enumerates every bucket in the window. Plot the series as given; do not
 *     infer a gap, and do not re-bucket. The buckets are IST calendar days,
 *     weeks from Monday and months from the 1st, all computed server-side.
 *   - **`days` is 1–365, and there is no since-date and no unbounded mode.**
 *     Anything outside the range is a 422. `PERIODS` in
 *     `features/dashboard/trendModel.ts` is the whitelist the UI offers.
 *   - **every count is scoped to what the CALLER may read.** `zone_scope`
 *     narrows to the caller's zones, and a field surveyor holding no
 *     supervisory role is narrowed again to the cases assigned to them. A
 *     number on this screen is therefore "cases this account can see" and never
 *     "the zone's total" — see `_own_cases_only` in `app/icms/dashboard.py`.
 *
 * `GET /cases.geojson` is deliberately absent from this module. It is a fifth
 * endpoint in the same router, but the Figma dashboard (`3:1302`) draws no map,
 * and it requires a bbox no wider than one degree that this screen has nothing
 * to derive it from. It belongs to whichever screen actually draws a map.
 */

import { IcmsApiError, icmsRequest } from "./http";

export type Bucket = "day" | "week" | "month";

export type StatusCount = {
  status: string;
  count: number;
  high_priority: number;
};

export type DashboardSummary = {
  total: number;
  open: number;
  closed: number;
  rejected: number;
  high_priority: number;
  by_status: StatusCount[];
};

export type TrendPoint = {
  /** The first day of the bucket, `YYYY-MM-DD` in IST. */
  period: string;
  raised: number;
  /** Of the cases raised in THIS bucket, how many have since closed or been rejected. */
  resolved: number;
};

export type DashboardTrend = {
  bucket: Bucket;
  days: number;
  start: string;
  end: string;
  points: TrendPoint[];
};

export type TypeCount = {
  complaint_type_cd: string | null;
  label: string | null;
  total: number;
  open: number;
  resolved: number;
};

export type ZoneCount = {
  zone_cd: string;
  zone_name: string;
  total: number;
  open: number;
  resolved: number;
};

export type TrendQuery = { days: number; bucket: Bucket };

/** The one code gating all four reads. Read from capabilities, enforced server-side. */
export const DASHBOARD_READ = "dashboard.read";

/** `TrendQuery.days` in `dashboard_schemas.py`. Outside it the request is a 422. */
export const MIN_TREND_DAYS = 1;
export const MAX_TREND_DAYS = 365;

/** Both breakdowns are `LIMIT 100`, by descending count, so a cut drops the smallest. */
export const MAX_GROUPS = 100;

const BASE = "/api/icms/dashboard";

// A shape guard per endpoint: a proxy error page or a contract change must be a
// thrown error at the boundary, not a panel of `undefined`.
function malformed(what: string): IcmsApiError {
  return new IcmsApiError(200, {
    code: "malformed_response",
    message: `The ${what} response did not have the expected shape.`,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasNumbers(value: unknown, fields: readonly string[]): boolean {
  return isRecord(value) && fields.every((field) => typeof value[field] === "number");
}

function narrowRows<T>(body: unknown, fields: readonly string[], what: string): T[] {
  if (!Array.isArray(body) || !body.every((row) => hasNumbers(row, fields))) {
    throw malformed(what);
  }
  return body as T[];
}

export async function fetchSummary(signal: AbortSignal): Promise<DashboardSummary> {
  const body = await icmsRequest(`${BASE}/summary`, { signal });
  if (!hasNumbers(body, ["total", "open", "closed", "rejected", "high_priority"])) {
    throw malformed("dashboard summary");
  }
  const summary = body as unknown as DashboardSummary;
  narrowRows<StatusCount>(summary.by_status, ["count", "high_priority"], "dashboard summary");
  return summary;
}

/** `days` and `bucket` are sent explicitly; the server's own defaults are 30 and `day`. */
export async function fetchTrend(
  query: TrendQuery,
  signal: AbortSignal,
): Promise<DashboardTrend> {
  const body = await icmsRequest(`${BASE}/trend`, { query: { ...query }, signal });
  if (!isRecord(body) || typeof body.bucket !== "string") throw malformed("dashboard trend");
  narrowRows<TrendPoint>(body.points, ["raised", "resolved"], "dashboard trend");
  return body as unknown as DashboardTrend;
}

export async function fetchByType(signal: AbortSignal): Promise<TypeCount[]> {
  const body = await icmsRequest(`${BASE}/by-type`, { signal });
  return narrowRows<TypeCount>(body, ["total", "open", "resolved"], "complaint-type breakdown");
}

export async function fetchByZone(signal: AbortSignal): Promise<ZoneCount[]> {
  const body = await icmsRequest(`${BASE}/by-zone`, { signal });
  return narrowRows<ZoneCount>(body, ["total", "open", "resolved"], "zone breakdown");
}
