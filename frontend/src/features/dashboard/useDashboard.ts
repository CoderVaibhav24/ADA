/**
 * The dashboard's data layer.
 *
 * Same shape as `features/users/useUsers.ts`: TanStack Query, an `AbortSignal`
 * through to `fetch`, and no retry on a 4xx because a 403 is a verdict rather
 * than a blip. Three things are specific to this screen.
 *
 * ## Four queries, not one
 *
 * The four panels are four endpoints, and they are kept four queries so that a
 * slow zone breakdown does not hold the counter cards off the screen, and one
 * panel failing does not blank the other three. Each panel therefore renders
 * its own loading, empty and error state from its own query.
 *
 * ## Nothing fetches until the gate has answered
 *
 * All four are `enabled` on `canRead`. Without that the screen fires four
 * requests it already knows will be refused and the officer sees four error
 * panels where the correct answer is one refusal. `/me/capabilities` is queried
 * through `features/policy/usePolicy`, not re-declared here, so every area
 * shares one cache entry and one request.
 *
 * ## `loadedAt` is the OLDEST of the four, not the newest
 *
 * The line under the heading claims the whole page was loaded at that moment.
 * Taking the newest would date the page by whichever panel happened to refetch
 * last and quietly overstate the other three, so the oldest is shown:
 * everything on screen is at least that fresh.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
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
import { useCapabilities } from "@/features/policy/usePolicy";

const DASHBOARD_KEY = ["icms", "dashboard"] as const;

/**
 * Aggregates over the whole register, so a minute stale is a minute stale for
 * every panel at once, and the screen carries its own refresh control. Longer
 * than the registers' 15 s deliberately: nobody opens a dashboard to watch one
 * case move, and four requests per window focus is four too many.
 */
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
};

/** What the render-level guard reads. Advisory: ada-api refuses regardless. */
export function useDashboardGate(): DashboardGate {
  const { data, isPending, error } = useCapabilities();
  const permissions = data?.permissions ?? [];
  return {
    loading: isPending,
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

/** One control refreshes all four panels; a per-panel refresh would date them apart. */
export function useRefreshDashboard(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(async () => {
    await client.invalidateQueries({ queryKey: DASHBOARD_KEY });
  }, [client]);
}

/** The oldest non-zero timestamp — see the note at the top of this file. */
export function oldestLoadedAt(stamps: readonly number[]): number | null {
  const real = stamps.filter((stamp) => stamp > 0);
  return real.length === 0 ? null : Math.min(...real);
}

/** `IcmsApiError` carries the correlation id; a plain Error carries none. */
export function requestIdOf(error: unknown): string | null {
  return error instanceof IcmsApiError ? error.requestId : null;
}
