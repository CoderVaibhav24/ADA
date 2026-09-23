/**
 * The Inspections register's data layer.
 *
 * Same shape as `features/complaints/useCases.ts` — TanStack Query, an
 * `AbortSignal` through to `fetch`, `keepPreviousData` so paging does not flash
 * a skeleton, and no retry on a 4xx because a 403 is a verdict rather than a
 * blip. Nothing is filtered, sorted or sliced in the browser.
 *
 * Two things specific to this register:
 *
 *   - **the URL carries eight filters and the API takes two shapes.** Six are
 *     repeatable lists; `submitted_from` and `submitted_to` are single dates.
 *     `useRegisterState` models every filter as a string array, so the two date
 *     bounds ride in the URL as one-element arrays and `buildInspectionQuery`
 *     unwraps them. That keeps all eight in one place rather than bolting two
 *     `useState`s onto the side of the register and losing them from the link.
 *   - **capabilities are fetched under the SAME query key as the policy
 *     area's.** `["icms","capabilities"]`, deliberately: one small request
 *     answers both "may this officer open inspections" and "may they open
 *     administration", and two keys would mean two requests and two chances to
 *     disagree after a grant changes.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  INSPECTION_READ,
  listInspections,
  type InspectionListQuery,
  type InspectionPage,
  type InspectionRow,
} from "@/api/icms/inspections";
import { IcmsApiError, toSearchParams, type QueryParams } from "@/api/icms/http";
import { fetchCapabilities, type Capabilities } from "@/api/icms/policy";
import { listZones } from "@/api/icms/reference";
import type { RegisterState } from "@/components/data-table/types";

/**
 * The filter ids, which are deliberately the API's own parameter names.
 *
 * So the URL an officer shares — `?status=submitted&round_no=2` — reads as the
 * query it performs, and no translation table has to be kept in step with it.
 *
 * `submitted_from` and `submitted_to` are in this list because the URL is where
 * they belong, not because they are facets: the grid draws no dropdown for
 * them, the toolbar's date range does.
 */
export const INSPECTION_FACET_KEYS = [
  "status",
  "round_no",
  "priority",
  "zone_cd",
  "surveyor_user_id",
  "case_ref",
  "submitted_from",
  "submitted_to",
] as const;

export type InspectionFacetKey = (typeof INSPECTION_FACET_KEYS)[number];

// A one-element array is how a scalar filter rides in `RegisterState.filters`.
function single(values: readonly string[] | undefined): string | undefined {
  return values && values.length > 0 ? values[0] : undefined;
}

/** Grid state -> the exact query the register's endpoint whitelists. */
export function buildInspectionQuery(state: RegisterState): InspectionListQuery {
  const query: InspectionListQuery = {
    page: state.page,
    size: state.size,
    sort: state.sort,
  };

  // An empty search is the ABSENCE of a search. `?q=` asks the server to ILIKE
  // '%%' across two columns, which matches everything and costs a scan.
  if (state.q !== "") query.q = state.q;

  const status = state.filters.status;
  if (status && status.length > 0) query.status = [...status];

  // The URL is text and `round_no` is an integer list server-side. A
  // hand-edited `?round_no=abc` is dropped here rather than turned into a 422.
  const rounds = (state.filters.round_no ?? [])
    .map((value) => Number.parseInt(value, 10))
    .filter((value) => Number.isFinite(value) && value >= 1);
  if (rounds.length > 0) query.round_no = rounds;

  // The CASE's priority, validated server-side against `CASE_PRIORITIES`. Sent
  // as it arrives from the URL; an unknown value is the server's 422 to give.
  const priority = state.filters.priority;
  if (priority && priority.length > 0) query.priority = [...priority];

  const zone = state.filters.zone_cd;
  if (zone && zone.length > 0) query.zone_cd = [...zone];

  const surveyor = state.filters.surveyor_user_id;
  if (surveyor && surveyor.length > 0) query.surveyor_user_id = [...surveyor];

  const caseRef = state.filters.case_ref;
  if (caseRef && caseRef.length > 0) query.case_ref = [...caseRef];

  const from = single(state.filters.submitted_from);
  if (from) query.submitted_from = from;
  const to = single(state.filters.submitted_to);
  if (to) query.submitted_to = to;

  return query;
}

/**
 * A stable cache key.
 *
 * Built from the serialised query rather than the object, because two
 * structurally identical objects are different cache keys and the register
 * rebuilds its query object on every render.
 */
export function inspectionListKey(query: InspectionListQuery): readonly unknown[] {
  return ["icms", "inspections", toSearchParams(query as QueryParams).toString()];
}

/**
 * A 4xx is a verdict, not a blip.
 *
 * Retrying a 422 produces the same 422 three times and delays the error state
 * by several seconds; retrying a 403 asks the server to refuse again.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof IcmsApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function useInspectionList(query: InspectionListQuery, enabled: boolean) {
  return useQuery<InspectionPage, Error>({
    queryKey: inspectionListKey(query),
    queryFn: ({ signal }) => listInspections(query, signal),
    // Held until capabilities answer: without the gate the register would
    // request a page it is about to refuse to render, and every officer without
    // `inspection.read` would deposit a 403 in the server's log on every visit.
    enabled,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    retry: shouldRetry,
  });
}

/**
 * One page of the register, outside React Query's cache.
 *
 * Used by the export, which walks the whole result set with the active filters
 * and must not deposit twenty pages into the cache on its way through.
 */
export async function fetchInspectionPage(
  query: InspectionListQuery,
  page: number,
  size: number,
  signal: AbortSignal,
): Promise<{ items: readonly InspectionRow[]; total: number }> {
  const result = await listInspections({ ...query, page, size }, signal);
  return { items: result.items, total: result.total };
}

/** The zone facet. Already narrowed server-side to this caller's assignments. */
export function useInspectionZones(enabled: boolean) {
  return useQuery({
    queryKey: ["icms", "zones"],
    queryFn: ({ signal }) => listZones(signal),
    enabled,
    // A zone list changes when someone edits a settings screen, not between two
    // page views. An hour is generous and still not "forever".
    staleTime: 60 * 60 * 1000,
    retry: shouldRetry,
  });
}

export type InspectionGate = {
  loading: boolean;
  /** True only once capabilities have actually answered. Never optimistic. */
  canRead: boolean;
  /** The signed-in officer, for the "Assigned to me" filter. */
  userId: string | null;
  /** The area is unreachable and we know why — a refusal, not a network blip. */
  refused: IcmsApiError | null;
};

/**
 * What the register, the detail screen and the findings form all gate on.
 *
 * Advisory, like everything built from capabilities: it decides which doors are
 * drawn. `require_permission("inspection.read")` on every route decides which
 * ones open, and `/me/capabilities` carries `advisory: true` in its own payload
 * for exactly this reason.
 */
export function useInspectionGate(): InspectionGate {
  const { data, isPending, error } = useQuery<Capabilities, Error>({
    queryKey: ["icms", "capabilities"],
    queryFn: ({ signal }) => fetchCapabilities(signal),
    // Short: a colleague can change this officer's grants at any moment, and
    // the cost is one small request.
    staleTime: 30_000,
    retry: shouldRetry,
  });

  return {
    loading: isPending,
    canRead: (data?.permissions ?? []).includes(INSPECTION_READ),
    userId: data?.user_id ?? null,
    refused:
      error instanceof IcmsApiError && (error.status === 401 || error.status === 403)
        ? error
        : null,
  };
}
