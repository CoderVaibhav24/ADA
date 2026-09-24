import {
  useInfiniteQuery,
  useQuery,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseQueryResult,
} from '@tanstack/react-query';

import { apiRequest } from './client';
import type { Schemas } from './types';

/*
 * Reads over the inspection register: `GET /api/icms/inspections`, one round, and
 * the evidence captured on it. The server narrows a Field Surveyor to their own
 * rounds (`_own_rounds_only` in `services/api/app/icms/inspections.py`), so the
 * list is the surveyor's work without a client-side filter.
 *
 * Writes for the inspection wizard live elsewhere; nothing here writes.
 */
export type InspectionRow = Schemas['InspectionRow'];
export type InspectionPage = Schemas['Page_InspectionRow_'];
export type InspectionDetail = Schemas['InspectionDetail'];
export type Evidence = Schemas['EvidenceOut'];

export type InspectionListFilter = {
  readonly caseRef?: readonly string[];
  /** Round statuses: scheduled, in_progress, submitted, accepted, rejected. */
  readonly status?: readonly string[];
  readonly surveyorUserId?: readonly string[];
  /** Inclusive IST day, `YYYY-MM-DD`. */
  readonly submittedFrom?: string;
  /** Inclusive IST day, `YYYY-MM-DD`. */
  readonly submittedTo?: string;
  readonly sort?: string;
};

export const INSPECTION_PAGE_SIZE = 25;

// The largest page the server accepts (`PageParams.size`, le=200). A case has a handful of rounds.
const ROUNDS_PER_CASE = 200;

export const inspectionKeys = {
  all: ['icms', 'inspections'] as const,
  list: (filter: InspectionListFilter) => ['icms', 'inspections', 'list', filter] as const,
  count: (filter: InspectionListFilter) => ['icms', 'inspections', 'count', filter] as const,
  forCase: (caseRef: string) => ['icms', 'inspections', 'case', caseRef] as const,
  detail: (ref: string) => ['icms', 'inspections', 'detail', ref] as const,
  evidence: (ref: string) => ['icms', 'inspections', 'evidence', ref] as const,
};

// One page of the inspection register under a filter.
export function fetchInspectionPage(
  filter: InspectionListFilter,
  page: number,
  size: number,
  signal?: AbortSignal,
): Promise<InspectionPage> {
  return apiRequest<InspectionPage>('/api/icms/inspections', {
    query: {
      case_ref: filter.caseRef,
      status: filter.status,
      surveyor_user_id: filter.surveyorUserId,
      submitted_from: filter.submittedFrom,
      submitted_to: filter.submittedTo,
      sort: filter.sort,
      page,
      size,
    },
    signal,
  });
}

// The next page number the server advertises, or undefined at the end.
function nextPage(last: InspectionPage): number | undefined {
  if (last.next_cursor === null || last.next_cursor === undefined) return undefined;
  const next = Number(last.next_cursor);
  return Number.isFinite(next) ? next : undefined;
}

export function useInspectionPages(
  filter: InspectionListFilter,
  enabled = true,
): UseInfiniteQueryResult<InfiniteData<InspectionPage, number>, Error> {
  return useInfiniteQuery({
    queryKey: inspectionKeys.list(filter),
    queryFn: ({ pageParam, signal }) =>
      fetchInspectionPage(filter, pageParam, INSPECTION_PAGE_SIZE, signal),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    enabled,
  });
}

// The register's `total` under a filter, as the server counted it.
export function useInspectionCount(
  filter: InspectionListFilter,
  enabled = true,
): UseQueryResult<number, Error> {
  return useQuery({
    queryKey: inspectionKeys.count(filter),
    queryFn: async ({ signal }) => (await fetchInspectionPage(filter, 1, 1, signal)).total,
    enabled,
  });
}

// Every round on one case, oldest first.
export function useCaseInspections(caseRef: string): UseQueryResult<InspectionRow[], Error> {
  return useQuery({
    queryKey: inspectionKeys.forCase(caseRef),
    queryFn: async ({ signal }) =>
      (
        await fetchInspectionPage(
          { caseRef: [caseRef], sort: 'round_no' },
          1,
          ROUNDS_PER_CASE,
          signal,
        )
      ).items,
    enabled: caseRef !== '',
  });
}

function fetchInspectionDetail(ref: string, signal?: AbortSignal): Promise<InspectionDetail> {
  return apiRequest<InspectionDetail>(`/api/icms/inspections/${encodeURIComponent(ref)}`, {
    signal,
  });
}

export function useInspectionDetail(ref: string | null): UseQueryResult<InspectionDetail, Error> {
  return useQuery({
    queryKey: inspectionKeys.detail(ref ?? ''),
    queryFn: ({ signal }) => fetchInspectionDetail(ref ?? '', signal),
    enabled: ref !== null && ref !== '',
  });
}

// One round's detail only if it is already cached; never fetches. The list reads its area from it.
export function useCachedInspectionDetail(ref: string): InspectionDetail | undefined {
  return useQuery({
    queryKey: inspectionKeys.detail(ref),
    queryFn: ({ signal }) => fetchInspectionDetail(ref, signal),
    enabled: false,
  }).data;
}

export function useInspectionEvidence(ref: string): UseQueryResult<Evidence[], Error> {
  return useQuery({
    queryKey: inspectionKeys.evidence(ref),
    queryFn: ({ signal }) =>
      apiRequest<Evidence[]>(`/api/icms/inspections/${encodeURIComponent(ref)}/evidence`, {
        signal,
      }),
    enabled: ref !== '',
  });
}
