/**
 * The Reports screen's data layer.
 *
 * Nothing here is new API surface. The aggregates come from `api/icms/dashboard.ts`
 * and the three register counts from the same `list*` calls the registers page
 * with — asked for one row, so `total` is the only thing paid for.
 *
 * Two rules this screen inherits from every other:
 *
 *   - **capabilities live under the shared `["icms","capabilities"]` key.** One
 *     small request answers "may this officer read the aggregates" and "may
 *     they export the case register"; separate keys would mean separate
 *     requests and separate chances to disagree after a grant changes.
 *   - **a 4xx is a verdict, not a blip**, so it is not retried. A 403 on
 *     `dashboard.read` must reach the screen as a refusal it can explain.
 */

import { useQuery } from "@tanstack/react-query";
import { CASE_EXPORT, CASE_READ, listCases, type CaseListQuery } from "@/api/icms/cases";
import {
  DASHBOARD_READ,
  fetchByType,
  fetchByZone,
  fetchTrend,
  type DashboardTrend,
  type TrendQuery,
  type TypeCount,
  type ZoneCount,
} from "@/api/icms/dashboard";
import { IcmsApiError } from "@/api/icms/http";
import {
  INSPECTION_READ,
  listInspections,
  type InspectionListQuery,
} from "@/api/icms/inspections";
import { NOTICE_READ, listNotices, type NoticeListQuery } from "@/api/icms/notices";
import { fetchCapabilities, type Capabilities } from "@/api/icms/policy";

function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof IcmsApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export type ReportsGate = {
  loading: boolean;
  /** `dashboard.read` — the three aggregate panels. */
  canReadAggregates: boolean;
  canReadCases: boolean;
  /** `case.export` — the only export permission `policy.py` seeds. */
  canExportCases: boolean;
  canReadInspections: boolean;
  canReadNotices: boolean;
  /** Refused, and we know why. A network blip is not this. */
  refused: IcmsApiError | null;
};

/** Advisory, like every capabilities read: it decides which doors are drawn. */
export function useReportsGate(): ReportsGate {
  const { data, isPending, error } = useQuery<Capabilities, Error>({
    queryKey: ["icms", "capabilities"],
    queryFn: ({ signal }) => fetchCapabilities(signal),
    staleTime: 30_000,
    retry: shouldRetry,
  });

  const held = data?.permissions ?? [];
  return {
    loading: isPending,
    canReadAggregates: held.includes(DASHBOARD_READ),
    canReadCases: held.includes(CASE_READ),
    canExportCases: held.includes(CASE_EXPORT),
    canReadInspections: held.includes(INSPECTION_READ),
    canReadNotices: held.includes(NOTICE_READ),
    refused:
      error instanceof IcmsApiError && (error.status === 401 || error.status === 403)
        ? error
        : null,
  };
}

/** The window is the server's: `days` and `bucket` go out, points come back bucketed. */
export function useTrendReport(query: TrendQuery, enabled: boolean) {
  return useQuery<DashboardTrend, Error>({
    queryKey: ["icms", "dashboard", "trend", query.days, query.bucket],
    queryFn: ({ signal }) => fetchTrend(query, signal),
    enabled,
    // A case raised a minute ago does not change a period report; the officer
    // pressing Refresh does.
    staleTime: 60_000,
    retry: shouldRetry,
  });
}

export function useTypeReport(enabled: boolean) {
  return useQuery<TypeCount[], Error>({
    queryKey: ["icms", "dashboard", "by-type"],
    queryFn: ({ signal }) => fetchByType(signal),
    enabled,
    staleTime: 60_000,
    retry: shouldRetry,
  });
}

export function useZoneReport(enabled: boolean) {
  return useQuery<ZoneCount[], Error>({
    queryKey: ["icms", "dashboard", "by-zone"],
    queryFn: ({ signal }) => fetchByZone(signal),
    enabled,
    staleTime: 60_000,
    retry: shouldRetry,
  });
}

export type RegisterCount = {
  total: number | null;
  loading: boolean;
  error: Error | null;
};

// One row is enough to learn `total`, so a count costs a page of one rather
// than a walk of the register.
function useCount(
  key: readonly unknown[],
  fetchTotal: (signal: AbortSignal) => Promise<number>,
  enabled: boolean,
): RegisterCount {
  const { data, isPending, error } = useQuery<number, Error>({
    queryKey: key,
    queryFn: ({ signal }) => fetchTotal(signal),
    enabled,
    staleTime: 30_000,
    retry: shouldRetry,
  });
  return {
    total: data ?? null,
    loading: enabled && isPending,
    error: error ?? null,
  };
}

/** How many rows the case export would write, under the filters chosen here. */
export function useCaseCount(query: CaseListQuery, enabled: boolean): RegisterCount {
  return useCount(
    ["icms", "reports", "count", "cases", JSON.stringify(query)],
    async (signal) => (await listCases({ ...query, page: 1, size: 1 }, signal)).total,
    enabled,
  );
}

/** The same question of the inspections register. */
export function useInspectionCount(
  query: InspectionListQuery,
  enabled: boolean,
): RegisterCount {
  return useCount(
    ["icms", "reports", "count", "inspections", JSON.stringify(query)],
    async (signal) => (await listInspections({ ...query, page: 1, size: 1 }, signal)).total,
    enabled,
  );
}

/** And of the notices register. */
export function useNoticeCount(query: NoticeListQuery, enabled: boolean): RegisterCount {
  return useCount(
    ["icms", "reports", "count", "notices", JSON.stringify(query)],
    async (signal) => (await listNotices({ ...query, page: 1, size: 1 }, signal)).total,
    enabled,
  );
}
