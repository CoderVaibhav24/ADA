/**
 * `/api/icms/notices/*` and `POST /api/icms/cases/{case_ref}/notices` — Batch 6,
 * portal side.
 *
 * Written against `docs/icms/batch-6-contract.md`, which is binding on this file
 * and on the backend module being written beside it. Four things in that
 * contract a caller must not get wrong:
 *
 *   - **`deliveries` is always empty and there is no delivery endpoint.** The
 *     Parivartan App owns delivery tracking and every case status after issue
 *     (`docs/ICMS-API-Build-Order-and-Workflow.md` §3a, decided 23 September
 *     2026). `icms_notice_delivery` stays as a table and gains no route and no
 *     screen. Nothing should render a column out of `deliveries`.
 *   - **issuing a notice is a workflow transition, not a permission.**
 *     `notice.read` gates the three READS and nothing else. `POST
 *     /cases/{ref}/notices` is gated by `ISSUE_NOTICE` in the transition table
 *     (`confirmed` -> `notice_issued`), so a screen decides whether to draw the
 *     form from `CaseDetail.allowed_actions` — **`allowed_actions`, which is the
 *     case's field name; `available_actions` is the inspection row's** — and
 *     never by comparing `case.status` to `"confirmed"`.
 *   - **`NTC-YYYY-NNNN` is allocated inside the persisting transaction** by
 *     `numbering.allocate` (build-order §2 rule 2). There is no client-side
 *     number, no optimistic reference and no way to reserve one: the reference
 *     exists when the 201 arrives and not before.
 *   - **the PDF needs the bearer token.** `GET /notices/{ref}/pdf` answers
 *     `application/pdf`, so it cannot be an `<a href>` or an `<iframe src>` —
 *     the browser sends no Authorization header on either. `fetchNoticePdf`
 *     returns a Blob and the screen makes an object URL it must revoke.
 */

import { authHeader } from "@/api/client";
import type { components, operations } from "@ada/api-types/ada-api";
import { IcmsApiError, icmsRequest } from "./http";

/* ---- types: generated from ada-api's OpenAPI document (@ada/api-types) ---- */

type Schemas = components["schemas"];

/** One row of the notice register. `zone_cd` and the address are joined from the case. */
export type NoticeRow = Schemas["NoticeRow"];
/** The row plus the rendered `body`. `deliveries` is always `[]`: Parivartan owns delivery. */
export type NoticeDetail = Schemas["NoticeDetail"];
export type NoticePage = Schemas["Page_NoticeRow_"];
/** Repeatable lists for case_ref/status/act_cd/zone_cd. The page-size parameter is `size`. */
export type NoticeListQuery = NonNullable<
  operations["list_notices_api_icms_notices_get"]["parameters"]["query"]
>;

/**
 * `NoticeBodyOverrides`, except `grounds`: the server's `BeforeValidator` also
 * accepts a single string (split on blank lines), which its OpenAPI document
 * does not describe, and a string is what the portal sends.
 */
export type NoticeBodyOverrides = Omit<Schemas["NoticeBodyOverrides"], "grounds"> & {
  grounds?: string | string[] | null;
};

/** `POST /cases/{case_ref}/notices`. 201 `NoticeDetail`. */
export type NoticeCreate = Omit<Schemas["NoticeCreate"], "body_overrides"> & {
  body_overrides?: NoticeBodyOverrides | null;
};

/** The one `body_overrides` key the portal writes — Figma's "Reason / Grounds". */
export const GROUNDS_KEY = "grounds" satisfies keyof NoticeBodyOverrides;

/* ---- vocabularies -------------------------------------------------------- */

/**
 * The `icms_notice.status` CHECK constraint, in its own order.
 *
 * Verbatim from `ada_core/models_icms.py` `Notice.__table_args__`. NOT the case
 * vocabulary and NOT the inspection's: `icms_case.status` has eleven values and
 * one of them is `notice_issued`, which is the CASE's state once a notice
 * exists — a different column on a different table from this one.
 *
 * `delivered` and `failed` are in the constraint and are reachable only through
 * Parivartan, which writes no rows here today. They are offered as filters
 * anyway, because a register that cannot show a value its own table may hold is
 * a register with a blind spot.
 */
export const NOTICE_STATUSES = [
  "draft",
  "issued",
  "delivered",
  "failed",
  "withdrawn",
] as const;

export type NoticeStatus = (typeof NOTICE_STATUSES)[number];

/** Null for a value outside the five, so an unknown status renders as unknown. */
export function toNoticeStatus(raw: string | null | undefined): NoticeStatus | null {
  if (!raw) return null;
  return (NOTICE_STATUSES as readonly string[]).includes(raw)
    ? (raw as NoticeStatus)
    : null;
}

/** `icms_code_value.domain` for the two vocabularies Notice Create reads. */
export const ACT_DOMAIN = "act";
export const SECTION_DOMAIN = "section";

/**
 * `workflow.Action.ISSUE_NOTICE`, as `CaseDetail.allowed_actions` spells it.
 *
 * Not added to `CASE_ACTIONS` in `cases.ts`: that list is Batch 2's closed set
 * and this transition arrives with Batch 6. It lives here until the generated
 * document carries the whole vocabulary.
 */
export const ISSUE_NOTICE = "issue_notice";

/** Whether the server offered `issue_notice` to THIS caller on THIS case. */
export function allowsIssueNotice(
  detail: { allowed_actions?: string[] | null } | null | undefined,
): boolean {
  return detail?.allowed_actions?.includes(ISSUE_NOTICE) ?? false;
}

/* ---- sorting ------------------------------------------------------------- */

export const NOTICE_SORT_KEYS = [
  "notice_ref",
  "case_ref",
  "act_cd",
  "status",
  "issued_at",
  "compliance_due",
  "zone_cd",
] as const;

export type NoticeSortKey = (typeof NOTICE_SORT_KEYS)[number];

/**
 * `-notice_ref`, not `-issued_at`.
 *
 * `NTC-YYYY-NNNN` is allocated monotonically per year, so descending on it is
 * "newest first" and is never NULL — where `issued_at` is null on every draft,
 * and a draft is exactly the row an officer needs at the top of the register.
 * The same reasoning as `INSPECTION_DEFAULT_SORT`.
 */
export const NOTICE_DEFAULT_SORT = "-notice_ref";

export function isNoticeSortKey(value: string): value is NoticeSortKey {
  return (NOTICE_SORT_KEYS as readonly string[]).includes(value);
}

/** `PageParams.size` is refused above the cap server-side, not clamped. */
export const MAX_PAGE_SIZE = 200;

/* ---- permissions and error codes ----------------------------------------- */

/**
 * The one code that gates this area, seeded by migration 0003.
 *
 * It covers the THREE READS only. Issuing is gated by the transition table, so
 * there is no `notice.manage` to import here and there never will be.
 */
export const NOTICE_READ = "notice.read";

/** The refusals that mean something specific to a screen. */
export const NOTICE_NOT_FOUND = "notice_not_found";
export const ARTEFACT_NOT_READY = "artefact_not_ready";

const BASE = "/api/icms";

/* ---- shape guards --------------------------------------------------------
   One per endpoint, same reason as `inspections.ts`: a proxy error page or a
   contract change must be a thrown error at the boundary rather than a table
   of `undefined`. -------------------------------------------------------- */

function malformed(what: string): IcmsApiError {
  return new IcmsApiError(200, {
    code: "malformed_response",
    message: `The ${what} response did not have the expected shape.`,
  });
}

function narrowDetail(body: unknown): NoticeDetail {
  if (
    typeof body !== "object" ||
    body === null ||
    !("notice_ref" in body) ||
    !("deliveries" in body)
  ) {
    throw malformed("notice");
  }
  return body as NoticeDetail;
}

function narrowPage(body: unknown): NoticePage {
  if (typeof body !== "object" || body === null) throw malformed("register");
  const page = body as Record<string, unknown>;
  if (
    !Array.isArray(page.items) ||
    typeof page.page !== "number" ||
    typeof page.size !== "number" ||
    typeof page.total !== "number" ||
    typeof page.pages !== "number" ||
    typeof page.sort !== "string"
  ) {
    throw malformed("register");
  }
  return body as NoticePage;
}

/* ---- reads ---------------------------------------------------------------- */

/** `notice.read`. Zone-scoped by the same rule the other two registers use. */
export async function listNotices(
  query: NoticeListQuery,
  signal: AbortSignal,
): Promise<NoticePage> {
  const body = await icmsRequest(`${BASE}/notices`, { query, signal });
  return narrowPage(body);
}

/** `notice.read`. 404 for a notice outside the caller's zones as well as an absent one. */
export async function fetchNotice(
  ref: string,
  signal: AbortSignal,
): Promise<NoticeDetail> {
  const body = await icmsRequest(`${BASE}/notices/${encodeURIComponent(ref)}`, { signal });
  return narrowDetail(body);
}

/** The path the PDF lives at. The request still needs the bearer token. */
export function noticePdfPath(ref: string): string {
  return `${BASE}/notices/${encodeURIComponent(ref)}/pdf`;
}

/**
 * The rendered notice, as a Blob.
 *
 * Not `icmsRequest`: that parses JSON and hands back `unknown`, which is right
 * for every other endpoint and wrong for a document. Same shape as
 * `fetchEvidenceContent` in `inspections.ts`, for the same reason — a browser
 * sends no Authorization header on an `<iframe src>`.
 */
export async function fetchNoticePdf(ref: string, signal: AbortSignal): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(noticePdfPath(ref), {
      headers: { ...(await authHeader()) },
      signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
    throw new IcmsApiError(0, {
      code: "network_unreachable",
      message: "The server could not be reached.",
    });
  }

  if (!response.ok) {
    throw new IcmsApiError(response.status, {
      code: response.status === 404 ? NOTICE_NOT_FOUND : ARTEFACT_NOT_READY,
      message: `The notice document could not be downloaded (${String(response.status)}).`,
      request_id: response.headers.get("X-Request-ID"),
    });
  }
  return response.blob();
}

/* ---- the one write --------------------------------------------------------- */

/**
 * `ISSUE_NOTICE`. 201 `NoticeDetail`, with `notice_ref` already allocated.
 *
 * Takes no permission code and no idempotency key. No key, because unlike
 * `POST /cases` and the evidence upload there is no unique constraint behind
 * one here: `icms_notice` has no `idempotency_key` column, and the transition
 * itself is the guard — a case in `notice_issued` no longer offers
 * `issue_notice`, so a replayed submit is refused by the workflow rather than
 * filing a second statutory notice. That is why this screen must not retry the
 * request automatically.
 */
export async function createNotice(
  caseRef: string,
  body: NoticeCreate,
): Promise<NoticeDetail> {
  const result = await icmsRequest(
    `${BASE}/cases/${encodeURIComponent(caseRef)}/notices`,
    { method: "POST", body },
  );
  return narrowDetail(result);
}
