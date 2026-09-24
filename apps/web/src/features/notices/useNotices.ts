/**
 * The notice area's data layer — the register, the detail, the two vocabularies
 * and the one write.
 *
 * Same shape as `features/inspections/useInspections.ts` — TanStack Query, an
 * `AbortSignal` through to `fetch`, `keepPreviousData` so paging does not flash
 * a skeleton, and no retry on a 4xx because a 403 is a verdict rather than a
 * blip. Nothing is filtered, sorted or sliced in the browser.
 *
 * Four things specific to notices:
 *
 *   - **the URL carries six filters and the API takes two shapes.** Four are
 *     repeatable lists; `issued_from` and `issued_to` are single dates.
 *     `useRegisterState` models every filter as a string array, so the two date
 *     bounds ride in the URL as one-element arrays and `buildNoticeQuery`
 *     unwraps them.
 *   - **capabilities are fetched under the SAME query key as every other
 *     screen's.** `["icms","capabilities"]`, deliberately: one small request
 *     answers "may this officer open notices", "may they raise a complaint" and
 *     "may they open administration", and separate keys would mean separate
 *     requests and separate chances to disagree after a grant changes.
 *   - **the sections vocabulary is a CHILD of the act.** `icms_code_value`
 *     carries `parent_code`, and `?domain=section` returns every section of
 *     every act, so the picker filters on the chosen act rather than asking the
 *     server twice. With no act chosen there is nothing to offer, and the
 *     screen says so instead of listing sections that may belong elsewhere.
 *   - **the write is never retried by the library.** `POST
 *     /cases/{ref}/notices` carries no idempotency key — there is no
 *     `idempotency_key` column on `icms_notice` — so the only thing stopping a
 *     replay filing a second statutory notice is the transition itself, and a
 *     library retrying quietly is exactly what must not happen. Retrying is the
 *     officer's decision, taken after reading what the server said.
 */

import { useMemo } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CASE_READ, fetchCase, listCases, type CaseDetail, type CaseRow } from "@/api/icms/cases";
import { IcmsApiError, toSearchParams, type QueryParams } from "@/api/icms/http";
import {
  ACT_DOMAIN,
  NOTICES_ACCESS,
  NOTICE_ISSUE,
  NOTICE_READ,
  SECTION_DOMAIN,
  createNotice,
  fetchNotice,
  listNotices,
  type NoticeCreate,
  type NoticeDetail,
  type NoticeListQuery,
  type NoticePage,
  type NoticeRow,
} from "@/api/icms/notices";
import { fetchCapabilities, type Capabilities } from "@/api/icms/policy";
import { listCodeValues, listZones, type CodeValue } from "@/api/icms/reference";
import type { RegisterState } from "@/components/data-table/types";

/**
 * The filter ids, which are deliberately the API's own parameter names.
 *
 * So the URL an officer shares — `?status=issued&act_cd=up_upda_1973` — reads
 * as the query it performs, and no translation table has to be kept in step
 * with it.
 *
 * `issued_from` and `issued_to` are in this list because the URL is where they
 * belong, not because they are facets: the grid draws no dropdown for them, the
 * toolbar's date range does.
 */
export const NOTICE_FACET_KEYS = [
  "status",
  "act_cd",
  "zone_cd",
  "case_ref",
  "issued_from",
  "issued_to",
] as const;

export type NoticeFacetKey = (typeof NOTICE_FACET_KEYS)[number];

// A one-element array is how a scalar filter rides in `RegisterState.filters`.
function single(values: readonly string[] | undefined): string | undefined {
  return values && values.length > 0 ? values[0] : undefined;
}

/** Grid state -> the exact query the register's endpoint whitelists. */
export function buildNoticeQuery(state: RegisterState): NoticeListQuery {
  const query: NoticeListQuery = {
    page: state.page,
    // `size`, not `page_size`. There is no `page_size` parameter anywhere in
    // this API and sending one is a 422.
    size: state.size,
    sort: state.sort,
  };

  // An empty search is the ABSENCE of a search. `?q=` asks the server to ILIKE
  // '%%' across the searchable columns, which matches everything and costs a scan.
  if (state.q !== "") query.q = state.q;

  const status = state.filters.status;
  if (status && status.length > 0) query.status = [...status];

  const act = state.filters.act_cd;
  if (act && act.length > 0) query.act_cd = [...act];

  const zone = state.filters.zone_cd;
  if (zone && zone.length > 0) query.zone_cd = [...zone];

  const caseRef = state.filters.case_ref;
  if (caseRef && caseRef.length > 0) query.case_ref = [...caseRef];

  const from = single(state.filters.issued_from);
  if (from) query.issued_from = from;
  const to = single(state.filters.issued_to);
  if (to) query.issued_to = to;

  return query;
}

/**
 * A stable cache key.
 *
 * Built from the serialised query rather than the object, because two
 * structurally identical objects are different cache keys and the register
 * rebuilds its query object on every render.
 */
export function noticeListKey(query: NoticeListQuery): readonly unknown[] {
  return ["icms", "notices", toSearchParams(query as QueryParams).toString()];
}

/** The single-notice key, the natural one the detail screen reads. */
export function noticeQueryKey(ref: string): readonly unknown[] {
  return ["icms", "notice", ref];
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

export function useNoticeList(query: NoticeListQuery, enabled: boolean) {
  return useQuery<NoticePage, Error>({
    queryKey: noticeListKey(query),
    queryFn: ({ signal }) => listNotices(query, signal),
    // Held until capabilities answer: without the gate the register would
    // request a page it is about to refuse to render, and every officer without
    // `notice.read` would deposit a 403 in the server's log on every visit.
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
export async function fetchNoticePage(
  query: NoticeListQuery,
  page: number,
  size: number,
  signal: AbortSignal,
): Promise<{ items: readonly NoticeRow[]; total: number }> {
  const result = await listNotices({ ...query, page, size }, signal);
  return { items: result.items, total: result.total };
}

/** One notice. A 404 is "no such notice, OR one outside your zones" — the same refusal. */
export function useNotice(ref: string, enabled: boolean) {
  return useQuery<NoticeDetail, Error>({
    queryKey: noticeQueryKey(ref),
    queryFn: ({ signal }) => fetchNotice(ref, signal),
    enabled: enabled && ref !== "",
    staleTime: 30_000,
    retry: shouldRetry,
  });
}

/** The zone facet. Already narrowed server-side to this caller's assignments. */
export function useNoticeZones(enabled: boolean) {
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

export type NoticeGate = {
  loading: boolean;
  /** True only once capabilities have actually answered. Never optimistic. */
  canRead: boolean;
  /** `notices.access`. The route guard checks it too; exposed for in-screen links. */
  canAccess: boolean;
  /** `notice.issue`. Notice Create also needs `issue_notice` in the case's `allowed_actions`. */
  canIssue: boolean;
  /** `case.read`. Whether the confirmed-case picker on Notice Create may be drawn. */
  canReadCases: boolean;
  /** The signed-in officer, for "Issued by me". */
  userId: string | null;
  /** The area is unreachable and we know why — a refusal, not a network blip. */
  refused: IcmsApiError | null;
};

/**
 * What the register and the detail screen gate on.
 *
 * Advisory, like everything built from capabilities: it decides which doors are
 * drawn. `require_permission("notice.read")` on every route decides which ones
 * open, and `/me/capabilities` carries `advisory: true` in its own payload for
 * exactly this reason.
 */
export function useNoticeGate(): NoticeGate {
  const { data, isPending, error } = useQuery<Capabilities, Error>({
    queryKey: ["icms", "capabilities"],
    queryFn: ({ signal }) => fetchCapabilities(signal),
    // Short: a colleague can change this officer's grants at any moment, and
    // the cost is one small request.
    staleTime: 30_000,
    retry: shouldRetry,
  });

  const permissions = data?.permissions ?? [];
  return {
    loading: isPending,
    canRead: permissions.includes(NOTICE_READ),
    canAccess: permissions.includes(NOTICES_ACCESS),
    canIssue: permissions.includes(NOTICE_ISSUE),
    canReadCases: permissions.includes(CASE_READ),
    userId: data?.user_id ?? null,
    refused:
      error instanceof IcmsApiError && (error.status === 401 || error.status === 403)
        ? error
        : null,
  };
}

/* ---- the two vocabularies ------------------------------------------------- */

export type CodeOption = { value: string; label: string };

export type Vocabulary = {
  options: readonly CodeOption[];
  loading: boolean;
  /** Answered empty, or failed. Either way there is nothing here to pick. */
  unavailable: boolean;
};

// `label_hi` is nullable, so a row nobody has translated falls back to English
// rather than to a blank option.
function pickLabel(language: string, english: string, hindi: string | null | undefined): string {
  return language.startsWith("hi") && hindi ? hindi : english;
}

function useCodeValues(domain: string, enabled: boolean) {
  return useQuery<CodeValue[], Error>({
    // The same key the complaint form uses for its own domains, so two screens
    // reading one vocabulary share one entry.
    queryKey: ["icms", "code-values", domain],
    queryFn: ({ signal }) => listCodeValues(domain, signal),
    enabled,
    // A vocabulary changes when someone edits a settings screen, not between
    // two page views.
    staleTime: 60 * 60 * 1000,
    retry: shouldRetry,
  });
}

/** `?domain=act`. One row today — `up_upda_1973` — and the picker does not assume it. */
export function useActOptions(enabled: boolean, language: string): Vocabulary {
  const { data, isPending, error } = useCodeValues(ACT_DOMAIN, enabled);
  return useMemo(() => {
    const options = (data ?? []).map((value) => ({
      value: value.code,
      label: pickLabel(language, value.label, value.label_hi),
    }));
    const loading = enabled && isPending;
    return {
      options,
      loading,
      unavailable: enabled && !loading && (error !== null || options.length === 0),
    };
  }, [data, enabled, error, isPending, language]);
}

/**
 * `?domain=section`, narrowed to the sections of ONE act.
 *
 * `parent_code` is the tie. Filtering here rather than server-side is deliberate:
 * the whole vocabulary is a handful of rows behind one cached request, and
 * re-fetching on every act change would put a network round trip inside a
 * dropdown. With no act chosen the list is empty — offering sections that may
 * belong to another act is worse than offering none.
 */
export function useSectionOptions(
  actCd: string,
  enabled: boolean,
  language: string,
): Vocabulary {
  const { data, isPending, error } = useCodeValues(SECTION_DOMAIN, enabled);
  return useMemo(() => {
    const options =
      actCd === ""
        ? []
        : (data ?? [])
            .filter((value) => value.parent_code === actCd)
            .map((value) => ({
              value: value.code,
              label: pickLabel(language, value.label, value.label_hi),
            }));
    const loading = enabled && actCd !== "" && isPending;
    return {
      options,
      loading,
      unavailable:
        enabled && actCd !== "" && !loading && (error !== null || options.length === 0),
    };
  }, [actCd, data, enabled, error, isPending, language]);
}

/* ---- the cases a notice may be issued against ----------------------------- */

/**
 * The confirmed cases, for Notice Create's "Complaint Reference" picker.
 *
 * `?status=confirmed` and nothing else. `confirmed` is the ONLY source status
 * `ISSUE_NOTICE` moves from (build-order §5, `confirmed` -> `notice_issued`),
 * so every other case in the register is one the server would refuse — and a
 * picker that offers a refusal is a picker that lies.
 *
 * This is the one place a status string appears in a query rather than in a
 * gate, and the distinction matters: it narrows a LIST the server would happily
 * return in full, it does not decide whether a button may be pressed. That
 * decision is still `allowed_actions` on the case the officer picks, read by
 * `useCaseForNotice` below.
 *
 * `size` is pinned to the register's ceiling so the dropdown is one request
 * rather than a paging problem of its own. An authority with more than 200
 * confirmed cases waiting for a notice has a backlog, not a UI problem, and the
 * officer arrives here from the complaint itself in that case.
 */
export const CONFIRMED_STATUS = "confirmed";
const CASE_PICKER_SIZE = 200;

export function useConfirmedCases(enabled: boolean) {
  return useQuery<readonly CaseRow[], Error>({
    queryKey: ["icms", "cases", "confirmed-picker"],
    queryFn: async ({ signal }) => {
      const page = await listCases(
        { status: [CONFIRMED_STATUS], size: CASE_PICKER_SIZE, sort: "-raised_at" },
        signal,
      );
      return page.items;
    },
    enabled,
    staleTime: 30_000,
    retry: shouldRetry,
  });
}

/* ---- the case a notice is issued against ---------------------------------- */

/** The case's key, spelled the same way the complaint screens spell it. */
export function caseQueryKey(ref: string): readonly unknown[] {
  return ["icms", "case", ref];
}

/**
 * The case, read for ONE field: `allowed_actions`.
 *
 * Not `status`. The server computes `allowed_actions` from the transition table
 * for this caller's roles in this case's state, and `issue_notice` being in it
 * is the only thing that says the form may be submitted. Comparing `status` to
 * `"confirmed"` would reimplement a table this screen cannot see, and would
 * draw the button for a role the server is about to refuse.
 *
 * Note the field is `allowed_actions` — the CASE's name for it. The inspection
 * row calls its own list `available_actions`; they are different fields on
 * different resources and mixing them up reads as "no actions available".
 */
export function useCaseForNotice(caseRef: string, enabled: boolean) {
  return useQuery<CaseDetail, Error>({
    queryKey: caseQueryKey(caseRef),
    queryFn: ({ signal }) => fetchCase(caseRef, signal),
    enabled: enabled && caseRef !== "",
    staleTime: 30_000,
    retry: shouldRetry,
  });
}

/* ---- the one write --------------------------------------------------------- */

/**
 * `ISSUE_NOTICE`. 201 with the allocated `notice_ref`.
 *
 * `retry: false` is load-bearing rather than conservative: there is no
 * idempotency key on this endpoint, so a library retry after a timeout would
 * file a second statutory notice against the same case if the first one landed.
 */
export function useCreateNotice(caseRef: string) {
  const client = useQueryClient();
  return useMutation<NoticeDetail, Error, NoticeCreate>({
    mutationFn: (body) => createNotice(caseRef, body),
    retry: false,
    onSuccess: (detail) => {
      // The detail screen this navigates to reads the same key, so it opens on
      // what the server just answered rather than fetching it again.
      client.setQueryData(noticeQueryKey(detail.notice_ref), detail);
      // The register gained a row, and the case moved to `notice_issued`, so
      // every page and filter combination of both is now out of date.
      void client.invalidateQueries({ queryKey: ["icms", "notices"] });
      void client.invalidateQueries({ queryKey: caseQueryKey(caseRef) });
      void client.invalidateQueries({ queryKey: ["icms", "cases"] });
    },
  });
}
