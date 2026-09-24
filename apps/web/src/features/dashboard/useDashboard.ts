// The dashboard's data layer: one query per panel/tile so one slow or failing read
// never blanks the others. Nothing fetches until the capability gate has answered.

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import {
  DASHBOARD_READ,
  fetchByType,
  fetchByZone,
  fetchSummary,
  fetchTrend,
  type DashboardSummary,
  type DashboardTrend,
  type TrendQuery,
  type TypeCount,
  type ZoneCount,
} from "@/api/icms/dashboard";
import { IcmsApiError } from "@/api/icms/http";
import { listCases, type CasePage } from "@/api/icms/cases";
import { listInspections, type InspectionStatus } from "@/api/icms/inspections";
import { listNotices, type NoticeStatus } from "@/api/icms/notices";
import { useCapabilities } from "@/features/policy/usePolicy";
import { toIstDateKey } from "@ada/shared/dates";

const DASHBOARD_KEY = ["icms", "dashboard"] as const;

/** A minute stale for every panel at once; the screen has its own refresh control. */
const STALE_MS = 60_000;

/** A 4xx is a verdict. Retrying a 403 only asks the server to refuse again. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof IcmsApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export type DashboardGate = {
  loading: boolean;
  /** True only once capabilities have actually answered. Never optimistic. */
  canRead: boolean;
  /** The area is unreachable and we know why — a refusal, not a network blip. */
  refused: IcmsApiError | null;
  /** Every permission the caller holds; gates the tiles that read other registers. */
  permissions: string[];
};

/** What the render-level guard reads. Advisory: ada-api refuses regardless. */
export function useDashboardGate(): DashboardGate {
  const { data, isPending, error } = useCapabilities();
  const permissions = data?.permissions ?? [];
  return {
    loading: isPending,
    permissions,
    canRead: permissions.includes(DASHBOARD_READ),
    refused:
      error instanceof IcmsApiError && (error.status === 401 || error.status === 403)
        ? error
        : null,
  };
}

export function useSummary(enabled: boolean) {
  return useQuery<DashboardSummary, Error>({
    queryKey: [...DASHBOARD_KEY, "summary"],
    queryFn: ({ signal }) => fetchSummary(signal),
    enabled,
    staleTime: STALE_MS,
    retry: shouldRetry,
  });
}

/** `placeholderData` keeps the old series on screen while a new window loads. */
export function useTrend(query: TrendQuery, enabled: boolean) {
  return useQuery<DashboardTrend, Error>({
    queryKey: [...DASHBOARD_KEY, "trend", query.days, query.bucket],
    queryFn: ({ signal }) => fetchTrend(query, signal),
    enabled,
    staleTime: STALE_MS,
    placeholderData: (previous) => previous,
    retry: shouldRetry,
  });
}

export function useByType(enabled: boolean) {
  return useQuery<TypeCount[], Error>({
    queryKey: [...DASHBOARD_KEY, "by-type"],
    queryFn: ({ signal }) => fetchByType(signal),
    enabled,
    staleTime: STALE_MS,
    retry: shouldRetry,
  });
}

export function useByZone(enabled: boolean) {
  return useQuery<ZoneCount[], Error>({
    queryKey: [...DASHBOARD_KEY, "by-zone"],
    queryFn: ({ signal }) => fetchByZone(signal),
    enabled,
    staleTime: STALE_MS,
    retry: shouldRetry,
  });
}

/** Inspection rounds not yet submitted: the "scheduled" tile. */
export const PENDING_INSPECTION_STATUSES: readonly InspectionStatus[] = ["scheduled", "in_progress"];

/** Notices that have left the office: drafts and withdrawn ones excluded. */
export const ISSUED_NOTICE_STATUSES: readonly NoticeStatus[] = ["issued", "delivered", "failed"];

const NEW_DETECTION_DAYS = 30;

// A register's `total` for a filter, fetched as a one-row page.
function useCountQuery(
  name: string,
  fetchPage: (signal: AbortSignal) => Promise<{ total: number }>,
  enabled: boolean,
  keyParts: readonly unknown[] = [],
) {
  return useQuery<number, Error>({
    queryKey: [...DASHBOARD_KEY, "count", name, ...keyParts],
    queryFn: async ({ signal }) => (await fetchPage(signal)).total,
    enabled,
    staleTime: STALE_MS,
    retry: shouldRetry,
  });
}

/** Detection-sourced cases filed in the last 30 IST days, today included. */
export function useNewDetections(enabled: boolean) {
  // Fixed at mount: a calendar date keeps the query key stable across renders.
  const [filedFrom] = useState(() =>
    toIstDateKey(Date.now() - (NEW_DETECTION_DAYS - 1) * 86_400_000),
  );
  return useCountQuery(
    "new-detections",
    (signal) => listCases({ source: ["detection"], filed_from: filedFrom, size: 1 }, signal),
    enabled,
    [filedFrom],
  );
}

export function useInspectionsScheduled(enabled: boolean) {
  return useCountQuery(
    "inspections-scheduled",
    (signal) => listInspections({ status: [...PENDING_INSPECTION_STATUSES], size: 1 }, signal),
    enabled,
  );
}

export function useNoticesIssued(enabled: boolean) {
  return useCountQuery(
    "notices-issued",
    (signal) => listNotices({ status: [...ISSUED_NOTICE_STATUSES], size: 1 }, signal),
    enabled,
  );
}

export const RECENT_CASES = 5;

/** The newest cases for the status feed. Needs `case.read`, not only `dashboard.read`. */
export function useRecentCases(enabled: boolean) {
  return useQuery<CasePage, Error>({
    queryKey: [...DASHBOARD_KEY, "recent-cases", RECENT_CASES],
    queryFn: ({ signal }) => listCases({ size: RECENT_CASES, sort: "-raised_at" }, signal),
    enabled,
    staleTime: STALE_MS,
    retry: shouldRetry,
  });
}

/** One control refreshes every panel; a per-panel refresh would date them apart. */
export function useRefreshDashboard(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(async () => {
    await client.invalidateQueries({ queryKey: DASHBOARD_KEY });
  }, [client]);
}

/** The oldest non-zero timestamp, so the page is never dated fresher than its stalest panel. */
export function oldestLoadedAt(stamps: readonly number[]): number | null {
  const real = stamps.filter((stamp) => stamp > 0);
  return real.length === 0 ? null : Math.min(...real);
}

/** `IcmsApiError` carries the correlation id; a plain Error carries none. */
export function requestIdOf(error: unknown): string | null {
  return error instanceof IcmsApiError ? error.requestId : null;
}
