/**
 * `/api/icms/cases/*` — the case spine, Batch 2, portal side.
 *
 * Five endpoints: raise one, list the register, read one, correct its
 * descriptive fields, assign it to a surveyor. Written against
 * `services/api/app/routers/icms_cases.py` and `app/icms/case_schemas.py`.
 *
 * Every type here is the generated one. `CaseRow`, `CaseDetail`, the four
 * request bodies, the `Page` envelope and the whole query bag come from
 * `@ada/api-types/ada-api`, which `npm run api:types` (repo root) emits from
 * FastAPI's own document. Nothing in this file restates a field name that the
 * server already publishes, so renaming a column in `case_schemas.py` breaks
 * the build here instead of rendering an empty cell.
 *
 * Four things about this contract a caller must not get wrong:
 *
 *   - **an out-of-scope zone and a zone that does not exist are THE SAME
 *     REFUSAL.** `POST /cases` answers 404 `zone_not_found` with one message
 *     for absent, inactive and not-yours alike, deliberately, so the refusal
 *     enumerates no zone the caller cannot already see. Nothing in this module
 *     or above it may try to tell those apart: there is no information in the
 *     response to tell them apart WITH, and a screen that guessed would be
 *     guessing about someone else's jurisdiction.
 *   - **`zone_unresolved` is a different refusal and a different remedy.** 422,
 *     raised when a location was given, fell outside every active zone
 *     boundary, and no `zone_cd` came with it. The answer is to name a zone —
 *     which is why the form collects both.
 *   - **`idempotency_key` is minted at user-action time and held across every
 *     retry of that one attempt.** A replay returns the case the FIRST attempt
 *     created, with **200 instead of 201**; both carry the same `CaseDetail`,
 *     so both are success and neither needs special handling. Minting a fresh
 *     key per request destroys the property silently and files the complaint
 *     twice, which is exactly what the key exists to prevent.
 *   - **`allowed_actions` is what gates a write button, never `status`.** The
 *     server computes it from the transition table for THIS caller's roles in
 *     THIS case's state; `workflow.check` runs again on every request
 *     regardless. A component comparing `status` to a string is reimplementing
 *     a table it cannot see.
 */

import type { components, operations } from "@ada/api-types/ada-api";
import { IcmsApiError, icmsRequest } from "./http";
export type CaseRow = components["schemas"]["CaseRow"];
export type CaseDetail = components["schemas"]["CaseDetail"];
export type CaseCreate = components["schemas"]["CaseCreate"];
export type CaseAmend = components["schemas"]["CaseAmend"];
export type CaseAssign = components["schemas"]["CaseAssign"];
export type CaseReject = components["schemas"]["CaseReject"];
export type CaseClose = components["schemas"]["CaseClose"];
export type AssigneeOptions = components["schemas"]["AssigneeOptions"];
export type AssigneeRole = components["schemas"]["AssigneeRole"];
export type AssigneeCandidate = components["schemas"]["AssigneeCandidate"];
export type CaseLocation = components["schemas"]["CaseLocation"];
export type CaseAssignment = components["schemas"]["CaseAssignmentOut"];
export type CaseRound = components["schemas"]["InspectionRoundOut"];
export type CasePage = components["schemas"]["Page_CaseRow_"];
export type CaseListQuery = NonNullable<
  operations["list_cases_api_icms_cases_get"]["parameters"]["query"]
>;
export const CASE_SORT_KEYS = [
  "case_ref",
  "complainant_name",
  "complaint_type_cd",
  "khasra_no",
  "priority",
  "property_address",
  "raised_at",
  "stage_no",
  "status",
  "ulpin",
  "updated_at",
  "zone_cd",
] as const;

export type CaseSortKey = (typeof CASE_SORT_KEYS)[number];
export const CASE_DEFAULT_SORT = "-raised_at";

export function isCaseSortKey(value: string): value is CaseSortKey {
  return (CASE_SORT_KEYS as readonly string[]).includes(value);
}

export const CASE_STATUSES = [
  "raised",
  "assigned",
  "under_inspection",
  "inspection_submitted",
  "resurvey_requested",
  "verified",
  "handed_over",
  "confirmed",
  "notice_issued",
  "closed",
  "rejected",
] as const;

export type CaseStatus = (typeof CASE_STATUSES)[number];
export const CASE_PRIORITIES = ["high", "medium", "low"] as const;
export type CasePriority = (typeof CASE_PRIORITIES)[number];
export const MAX_PAGE_SIZE = 200;

/** `case_schemas.SOURCES` — where the complaint came from. Validated server-side. */
export const CASE_SOURCES = ["detection", "public", "field", "office"] as const;
export type CaseSource = (typeof CASE_SOURCES)[number];

/** Null for a value outside the four, so an unknown source renders as unknown. */
export function toCaseSource(raw: string | null | undefined): CaseSource | null {
  if (!raw) return null;
  return (CASE_SOURCES as readonly string[]).includes(raw) ? (raw as CaseSource) : null;
}

/**
 * `workflow.Action`, as `CaseDetail.allowed_actions` spells the stage 1-7 moves.
 *
 * Verbatim from `app/icms/workflow.py`. The inspection-loop actions travel on
 * `InspectionDetail.available_actions` instead and are listed in
 * `inspections.ts`; this list is the case's own.
 */
export const CASE_ACTIONS = [
  "raise",
  "assign",
  "reassign",
  "reject",
  "hand_over",
  "confirm",
] as const;

export type CaseAction = (typeof CASE_ACTIONS)[number];

/** Whether the server offered this action to THIS caller on THIS case. */
export function allowsCase(
  detail: Pick<CaseDetail, "allowed_actions"> | null | undefined,
  action: CaseAction,
): boolean {
  return detail?.allowed_actions?.includes(action) ?? false;
}

/** Screen gates, the read gate and the amend code; other writes follow the transition table. */
export const COMPLAINTS_ACCESS = "complaints.access";
export const COMPLAINT_CREATE_ACCESS = "complaint_create.access";
/** The Change Detection screen raises cases from detections, so its gate sits here. */
export const CHANGE_DETECTION_ACCESS = "change_detection.access";
export const CASE_READ = "case.read";
export const CASE_EXPORT = "case.export";
export const CASE_AMEND = "case.amend";

/**
 * The refusals that mean something specific to a screen.
 *
 * `ZONE_NOT_FOUND` is answered identically for a zone outside the caller's
 * scope and a zone that does not exist. Both are one sentence here for the same
 * reason the server gives one: there is nothing to distinguish, and a screen
 * that offered two different remedies would be inventing the difference.
 */
export const ZONE_NOT_FOUND = "zone_not_found";
export const ZONE_UNRESOLVED = "zone_unresolved";
export const ASSIGNEE_NOT_A_SURVEYOR = "assignee_not_a_surveyor";
export const ASSIGNEE_NOT_IN_ZONE = "assignee_not_in_zone";
export const CASE_NOT_FOUND = "case_not_found";

const BASE = "/api/icms/cases";

function isCasePage(value: unknown): value is CasePage {
  if (typeof value !== "object" || value === null) return false;
  const page = value as Record<string, unknown>;
  return (
    Array.isArray(page.items) &&
    typeof page.page === "number" &&
    typeof page.size === "number" &&
    typeof page.total === "number" &&
    typeof page.pages === "number" &&
    typeof page.sort === "string"
  );
}

export async function listCases(
  query: CaseListQuery,
  signal: AbortSignal,
): Promise<CasePage> {
  const body = await icmsRequest(BASE, { query, signal });
  if (!isCasePage(body)) {
    throw new IcmsApiError(200, {
      code: "malformed_page",
      message: "The register response did not have the expected shape.",
    });
  }
  return body;
}

/* ---- one case: read and the three writes ---------------------------------
   Same shape guard on all four, for the same reason `listCases` has one: a
   proxy error page or a contract change must be a thrown error at the boundary
   rather than a detail screen full of `undefined`. `case_ref` is the field
   checked because it is required on `CaseDetail` and on nothing else the
   server could plausibly answer with. ------------------------------------ */

function narrowDetail(body: unknown): CaseDetail {
  if (typeof body !== "object" || body === null || !("case_ref" in body)) {
    throw new IcmsApiError(200, {
      code: "malformed_response",
      message: "The case response did not have the expected shape.",
    });
  }
  return body as CaseDetail;
}

/** `RAISE`. 201, or 200 with the original when `idempotency_key` is replayed. */
export async function createCase(
  body: CaseCreate,
  signal?: AbortSignal,
): Promise<CaseDetail> {
  const result = await icmsRequest(BASE, { method: "POST", body, signal });
  return narrowDetail(result);
}

/** `case.read`. Zone-scoped: a case outside the caller's zones is a 404. */
export async function fetchCase(
  caseRef: string,
  signal?: AbortSignal,
): Promise<CaseDetail> {
  const result = await icmsRequest(`${BASE}/${encodeURIComponent(caseRef)}`, { signal });
  return narrowDetail(result);
}

/** Descriptive fields only. A closed or rejected case is refused 409. */
export async function amendCase(
  caseRef: string,
  body: CaseAmend,
): Promise<CaseDetail> {
  const result = await icmsRequest(`${BASE}/${encodeURIComponent(caseRef)}`, {
    method: "PATCH",
    body,
  });
  return narrowDetail(result);
}

/** The roles the workflow admits as assignee, and the zone's officers holding them. */
export async function fetchAssignees(
  caseRef: string,
  signal?: AbortSignal,
): Promise<AssigneeOptions> {
  const result = await icmsRequest(`${BASE}/${encodeURIComponent(caseRef)}/assignees`, {
    signal,
  });
  if (typeof result !== "object" || result === null || !("candidates" in result)) {
    throw new IcmsApiError(200, {
      code: "malformed_response",
      message: "The assignee response did not have the expected shape.",
    });
  }
  return result as AssigneeOptions;
}

/** `ASSIGN` or `REASSIGN`, chosen server-side from the case's current status. */
export async function assignCase(
  caseRef: string,
  body: CaseAssign,
): Promise<CaseDetail> {
  const result = await icmsRequest(`${BASE}/${encodeURIComponent(caseRef)}/assign`, {
    method: "POST",
    body,
  });
  return narrowDetail(result);
}

/** `REJECT`, from raised or assigned. 200 again, unchanged, on a replayed idempotency key. */
export async function rejectCase(caseRef: string, body: CaseReject): Promise<CaseDetail> {
  const result = await icmsRequest(`${BASE}/${encodeURIComponent(caseRef)}/reject`, {
    method: "POST",
    body,
  });
  return narrowDetail(result);
}

/** `CLOSE`, from notice_issued. 200 again, unchanged, on a replayed idempotency key. */
export async function closeCase(caseRef: string, body: CaseClose): Promise<CaseDetail> {
  const result = await icmsRequest(`${BASE}/${encodeURIComponent(caseRef)}/close`, {
    method: "POST",
    body,
  });
  return narrowDetail(result);
}

/* ---- case evidence -------------------------------------------------------
   Photos attached to the case itself, before any inspection round exists.
   Hand-typed until `npm run api:types` picks the routes up from the server. */

export type CaseEvidence = {
  id: number;
  filename: string;
  content_type: string;
  size_bytes: number;
  caption: string | null;
  latitude: number | null;
  longitude: number | null;
  created_at: string;
  content_url: string;
};

export type CaseEvidenceUpload = { evidence: CaseEvidence; replayed: boolean };

export type CaseEvidenceOptions = {
  /** One per file, held across retries, so a retry replays rather than duplicates. */
  idempotencyKey: string;
  caption?: string;
  latitude?: number;
  longitude?: number;
  signal?: AbortSignal;
};

function isCaseEvidence(value: unknown): value is CaseEvidence {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { id?: unknown }).id === "number" &&
    typeof (value as { content_url?: unknown }).content_url === "string"
  );
}

function malformedEvidence(): IcmsApiError {
  return new IcmsApiError(200, {
    code: "malformed_response",
    message: "The evidence response did not have the expected shape.",
  });
}

/** Images only (jpeg/png/webp), at most ten per case. 201, or 200 on a replay. */
export async function uploadCaseEvidence(
  caseKey: string,
  file: File,
  opts: CaseEvidenceOptions,
): Promise<CaseEvidenceUpload> {
  const form = new FormData();
  form.append("file", file, file.name);
  if (opts.caption !== undefined && opts.caption !== "") form.append("caption", opts.caption);
  if (opts.latitude !== undefined) form.append("latitude", String(opts.latitude));
  if (opts.longitude !== undefined) form.append("longitude", String(opts.longitude));

  const result = await icmsRequest(`${BASE}/${encodeURIComponent(caseKey)}/evidence`, {
    method: "POST",
    body: form,
    headers: { "Idempotency-Key": opts.idempotencyKey },
    signal: opts.signal,
  });
  const upload = result as { evidence?: unknown; replayed?: unknown } | undefined;
  if (!isCaseEvidence(upload?.evidence) || typeof upload.replayed !== "boolean") {
    throw malformedEvidence();
  }
  return { evidence: upload.evidence, replayed: upload.replayed };
}

/** Every photo attached to the case. */
export async function listCaseEvidence(
  caseKey: string,
  signal?: AbortSignal,
): Promise<CaseEvidence[]> {
  const result = await icmsRequest(`${BASE}/${encodeURIComponent(caseKey)}/evidence`, {
    signal,
  });
  const items: unknown = (result as { items?: unknown } | undefined)?.items;
  if (!Array.isArray(items) || !items.every(isCaseEvidence)) throw malformedEvidence();
  return items;
}

/* ---- idempotency ---------------------------------------------------------
   The twin of `inspections.ts` `newIdempotencyKey`, duplicated rather than
   imported so neither client depends on the other's batch.

   One key per INTENT, minted where the officer presses the button and reused
   across every retry of that press. `icms_case.idempotency_key` is unique, so a
   replay comes back as "here is the case you already raised" with 200 instead
   of a second complaint. Minting inside a retry loop defeats that silently,
   which is the failure worth naming.

   `randomUUID` needs a secure context; the portal is HTTPS everywhere it is
   deployed and the fallback keeps a plain-HTTP dev server working.
   ------------------------------------------------------------------------ */

/** A v4 UUID, which is what `IdempotencyKey` is server-side. */
export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();

  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join("-");
}
