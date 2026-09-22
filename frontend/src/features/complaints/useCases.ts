/**
 * The register's data layer.
 *
 * Every narrowing the officer performs is a query parameter, and the server
 * answers with one page. Nothing is filtered, sorted or sliced in the browser.
 * That is the single most important difference from the system this replaces,
 * where all 305 grids download the entire table on mount and then
 * substring-match it in memory.
 *
 * React Query supplies the three things the legacy `HttpClient` + `.toPromise()`
 * call style cannot:
 *
 *   - **cancellation.** `queryFn` receives an `AbortSignal` and passes it
 *     through, so the request for "142" is aborted the moment "142/B" is typed.
 *     Without it the last request to *resolve* wins, which on a slow connection
 *     is routinely the wrong one;
 *   - **a previous page to look at.** `keepPreviousData` leaves the current
 *     rows on screen while the next page loads, so paging does not flash a
 *     skeleton and lose the officer's place;
 *   - **a cache that survives navigation**, so opening a case and coming back
 *     does not refetch the register.
 */

import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { listCases, type CaseListQuery, type CasePage, type CaseRow } from "@/api/icms/cases";
import { COMPLAINT_TYPE_DOMAIN, listCodeValues, listZones } from "@/api/icms/reference";
import { IcmsApiError, toSearchParams, type QueryParams } from "@/api/icms/http";
import type { RegisterState } from "@/components/data-table/types";

/**
 * The facet ids, which are deliberately the API's own parameter names.
 *
 * That makes the URL the officer shares — `?status=raised&priority=high` — read
 * as the query it actually performs, and it removes a translation table that
 * would otherwise have to be kept in step with `CaseQuery`.
 */
export const COMPLAINT_FACET_KEYS = [
  "status",
  "priority",
  "complaint_type_cd",
  "zone_cd",
] as const;

export type ComplaintFacetKey = (typeof COMPLAINT_FACET_KEYS)[number];

/** Grid state -> the exact query `CaseQuery` whitelists. */
export function buildCaseQuery(state: RegisterState): CaseListQuery {
  const query: CaseListQuery = {
    page: state.page,
    size: state.size,
    sort: state.sort,
  };

  // An empty search is the ABSENCE of a search. `?q=` asks the server to ILIKE
  // '%%' across seven columns, which matches everything and costs a scan.
  if (state.q !== "") query.q = state.q;

  const status = state.filters.status;
  if (status && status.length > 0) query.status = [...status];

  // Lower case, always: the CHECK constraint is ('high','medium','low') and the
  // request model validates against the same tuple. The capitals are CSS.
  const priority = state.filters.priority;
  if (priority && priority.length > 0) query.priority = [...priority];

  const complaintType = state.filters.complaint_type_cd;
  if (complaintType && complaintType.length > 0) query.complaint_type_cd = [...complaintType];

  const zone = state.filters.zone_cd;
  if (zone && zone.length > 0) query.zone_cd = [...zone];

  return query;
}

/**
 * A stable cache key.
 *
 * Built from the serialised query rather than from the object, because two
 * structurally identical objects are different cache keys and the register
 * rebuilds its query object on every render.
 */
export function caseListKey(query: CaseListQuery): readonly unknown[] {
  return ["icms", "cases", toSearchParams(query as QueryParams).toString()];
}

/**
 * A 4xx is a verdict, not a blip.
 *
 * Retrying a 422 produces the same 422 three times and delays the error state
 * by several seconds; retrying a 403 asks the server to refuse again. Only
 * transport failures and 5xx are worth a second attempt.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof IcmsApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function useCaseList(query: CaseListQuery) {
  return useQuery<CasePage, Error>({
    queryKey: caseListKey(query),
    queryFn: ({ signal }) => listCases(query, signal),
    // Keeps the page that is on screen visible while the next one loads. The
    // grid reports `isFetching` so the officer still knows it is working.
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
export async function fetchCasePage(
  query: CaseListQuery,
  page: number,
  size: number,
  signal: AbortSignal,
): Promise<{ items: readonly CaseRow[]; total: number }> {
  const result = await listCases({ ...query, page, size }, signal);
  return { items: result.items, total: result.total };
}

/** The "Complaint Type" dropdown's options, with their Hindi labels attached. */
export function useComplaintTypes() {
  return useQuery({
    queryKey: ["icms", "code-values", COMPLAINT_TYPE_DOMAIN],
    queryFn: ({ signal }) => listCodeValues(COMPLAINT_TYPE_DOMAIN, signal),
    // A controlled vocabulary changes when someone edits a settings screen, not
    // between two page views. An hour is generous and still not "forever".
    staleTime: 60 * 60 * 1000,
    retry: shouldRetry,
  });
}

/** The zone facet. Already narrowed server-side to this caller's assignments. */
export function useZones() {
  return useQuery({
    queryKey: ["icms", "zones"],
    queryFn: ({ signal }) => listZones(signal),
    staleTime: 60 * 60 * 1000,
    retry: shouldRetry,
  });
}
