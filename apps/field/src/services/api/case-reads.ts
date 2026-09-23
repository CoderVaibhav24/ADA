import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { apiRequest } from './client';
import type { CaseDetail, CasePage, CaseRow, Schemas } from './types';

/*
 * Reads over the case register: `GET /api/icms/cases`, `GET /api/icms/cases/{ref}`
 * and `GET /api/icms/cases/{ref}/resurvey-requests`. Screens use the hooks; nothing
 * here writes.
 *
 * The filters are exactly `CaseQuery` in `services/api/app/icms/case_schemas.py`.
 * A filter the server does not have is not faked here by filtering a page on the
 * handset — a page is not the register, and a count computed from one is wrong.
 */
export type ResurveyRequest = Schemas['ResurveyRequestOut'];
export type { CaseDetail, CasePage, CaseRow };

export type CaseListFilter = {
  /** Only cases whose open survey assignment is the caller's. */
  readonly mine?: boolean;
  readonly status?: readonly string[];
  readonly q?: string;
  /** A key from the server's sort whitelist; `-key` sorts descending. */
  readonly sort?: string;
};

export const CASE_PAGE_SIZE = 25;

export const caseKeys = {
  all: ['icms', 'cases'] as const,
  list: (filter: CaseListFilter) => ['icms', 'cases', 'list', filter] as const,
  count: (filter: CaseListFilter) => ['icms', 'cases', 'count', filter] as const,
  first: (filter: CaseListFilter) => ['icms', 'cases', 'first', filter] as const,
  detail: (caseRef: string) => ['icms', 'cases', 'detail', caseRef] as const,
  resurvey: (caseRef: string) => ['icms', 'cases', 'resurvey', caseRef] as const,
};

// One page of the register under a filter.
export function fetchCasePage(
  filter: CaseListFilter,
  page: number,
  size: number,
  signal?: AbortSignal,
): Promise<CasePage> {
  return apiRequest<CasePage>('/api/icms/cases', {
    query: {
      mine: filter.mine === true ? true : undefined,
      status: filter.status,
      q: filter.q,
      sort: filter.sort,
      page,
      size,
    },
    signal,
  });
}

// The next page number the server advertises, or undefined at the end of the register.
function nextPage(last: CasePage): number | undefined {
  if (last.next_cursor === null || last.next_cursor === undefined) return undefined;
  const next = Number(last.next_cursor);
  return Number.isFinite(next) ? next : undefined;
}

export function useCasePages(
  filter: CaseListFilter,
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<CasePage, number>, Error> {
  return useInfiniteQuery({
    queryKey: caseKeys.list(filter),
    queryFn: ({ pageParam, signal }) => fetchCasePage(filter, pageParam, CASE_PAGE_SIZE, signal),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    enabled,
  });
}

// The register's `total` under a filter — a count the server computed, not the length of a page.
export function useCaseCount(filter: CaseListFilter, enabled = true): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: caseKeys.count(filter),
    queryFn: async ({ signal }) => (await fetchCasePage(filter, 1, 1, signal)).total,
    enabled,
  });
}

// The first row under a filter and sort, or null when the register is empty.
export function useFirstCase(
  filter: CaseListFilter,
  enabled = true,
): UseQueryResult<CaseRow | null, Error> {
  return useQuery({
    queryKey: caseKeys.first(filter),
    queryFn: async ({ signal }) => (await fetchCasePage(filter, 1, 1, signal)).items[0] ?? null,
    enabled,
  });
}

export function fetchCaseDetail(caseRef: string, signal?: AbortSignal): Promise<CaseDetail> {
  return apiRequest<CaseDetail>(`/api/icms/cases/${encodeURIComponent(caseRef)}`, { signal });
}

export function useCaseDetail(caseRef: string): UseQueryResult<CaseDetail, Error> {
  return useQuery({
    queryKey: caseKeys.detail(caseRef),
    queryFn: ({ signal }) => fetchCaseDetail(caseRef, signal),
    enabled: caseRef !== '',
  });
}

export function useResurveyRequests(caseRef: string): UseQueryResult<ResurveyRequest[], Error> {
  return useQuery({
    queryKey: caseKeys.resurvey(caseRef),
    queryFn: ({ signal }) =>
      apiRequest<ResurveyRequest[]>(
        `/api/icms/cases/${encodeURIComponent(caseRef)}/resurvey-requests`,
        { signal },
      ),
    enabled: caseRef !== '',
  });
}

export type Coordinates = { readonly latitude: number; readonly longitude: number };

// Reads a GeoJSON Point off `CaseDetail.location`; anything else answers null, never a guess.
export function caseCoordinates(detail: CaseDetail | undefined): Coordinates | null {
  const location = detail?.location;
  if (location === null || location === undefined) return null;
  if (location.type !== 'Point' || !Array.isArray(location.coordinates)) return null;
  const [longitude, latitude] = location.coordinates as unknown[];
  if (typeof latitude !== 'number' || typeof longitude !== 'number') return null;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return { latitude, longitude };
}
