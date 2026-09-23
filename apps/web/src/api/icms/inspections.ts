/**
 * `/api/icms/inspections/*`, `/api/icms/evidence/*` and the two re-survey routes —
 * the whole of Batch 3, portal side.
 *
 * Written against `docs/icms/batch-3-contract.md`, which is binding on this file
 * and on the backend module being written beside it. Four things in that
 * contract a caller must not get wrong:
 *
 *   - **the register's filters are repeatable lists, not scalars.** `status`,
 *     `round_no`, `surveyor_user_id`, `zone_cd`, `case_ref` and `priority` all
 *     serialise one value per parameter (`?status=scheduled&status=submitted`), the way
 *     `CaseQuery` already does. Only `submitted_from` / `submitted_to` are
 *     single values. A comma-joined string is a 422.
 *   - **write permission is not a permission code.** `inspection.read` and
 *     `evidence.read` gate the four reads and nothing else; every write is gated
 *     by the transition table in `app/icms/workflow.py`. So a screen decides
 *     which write buttons to draw from `InspectionDetail.available_actions`,
 *     which the server computes for the caller's roles in the row's current
 *     status — never by comparing `status` to a string in a component.
 *   - **three writes carry an idempotency key and the database enforces it.**
 *     `icms_check_in.idempotency_key` and `icms_evidence.idempotency_key` are
 *     unique, and a replayed key returns the ORIGINAL row with 200 — not a
 *     duplicate, not a 409. `POST /submit` replayed returns the already
 *     submitted inspection. That is what lets the field app retry an upload it
 *     is not sure landed, so the key must be minted once per intent and reused
 *     across retries: `newIdempotencyKey()` where the officer presses the
 *     button, not inside the retry loop.
 *   - **evidence is append-only.** There is no update and no delete route here,
 *     in this batch or any later one. A re-survey adds a round; it never
 *     replaces one. Nothing in this module should ever grow a `deleteEvidence`.
 */

import { authHeader } from "@/api/client";
import type { components } from "@/api/generated/ada-api";
import { IcmsApiError, icmsRequest } from "./http";

/* -------------------------------------------------------------------------
   TEMPORARY LOCAL TYPES — transcribed from batch-3-contract.md §3.

   Every other client in this folder imports its types from
   `@/api/generated/ada-api`, so a renamed server field is a build error here
   rather than an empty cell. These cannot, yet: the routes do not exist, so
   FastAPI's document does not describe them and `npm run api:types` has nothing
   to emit. The moment the backend module lands, rerun

       npm run api:types

   and replace this entire block with the generated aliases —

       export type InspectionRow = components["schemas"]["InspectionRow"];
       export type InspectionDetail = components["schemas"]["InspectionDetail"];
       export type InspectionPage = components["schemas"]["Page_InspectionRow_"];
       export type CheckInOut = components["schemas"]["CheckInOut"];
       export type EvidenceOut = components["schemas"]["EvidenceOut"];
       export type FindingOut = components["schemas"]["FindingOut"];
       export type ResurveyRequestOut = components["schemas"]["ResurveyRequestOut"];
       export type InspectionListQuery = NonNullable<
         operations["list_inspections_api_icms_inspections_get"]["parameters"]["query"]
       >;

   — and delete nothing else. Everything below this block is written against
   these names and keeps working.
   ------------------------------------------------------------------------- */

/** One row of the register. The three counts are correlated subqueries. */
export type InspectionRow = {
  inspection_ref: string;
  case_ref: string;
  case_title: string | null;
  round_no: number;
  status: string;
  zone_cd: string | null;
  zone_name: string | null;
  /** The CASE's priority, joined onto the round. See `INSPECTION_PRIORITIES`. */
  priority: string | null;
  surveyor_user_id: string;
  surveyor_name: string | null;
  scheduled_for: string | null;
  started_at: string | null;
  submitted_at: string | null;
  evidence_count: number;
  finding_count: number;
  has_check_in: boolean;
};

export type InspectionLocation = { lat: number; lon: number };

export type FindingOut = {
  seq: number;
  finding: string;
  created_at: string;
};

export type InspectionSectionRef = {
  act_cd: string;
  section_cd: string;
};

export type CheckInOut = {
  id: number;
  inspection_ref: string;
  user_id: string;
  lat: number;
  lon: number;
  accuracy_m: number;
  device_timestamp: string;
  server_timestamp: string;
  capture_source: string;
  inside_zone: boolean | null;
};

export type EvidenceOut = {
  id: number;
  case_ref: string;
  inspection_ref: string | null;
  round_no: number | null;
  kind: string;
  doc_type_cd: string | null;
  original_filename: string | null;
  content_type: string | null;
  byte_size: number | null;
  sha256: string | null;
  lat: number | null;
  lon: number | null;
  accuracy_m: number | null;
  device_timestamp: string | null;
  capture_source: string | null;
  captured_at: string | null;
  uploaded_by: string;
  uploaded_at: string;
  content_url: string;
  /** Server-computed: no fix, or an accuracy worse than the configured threshold. */
  geotag_flagged: boolean;
};

export type ResurveyRequestOut = {
  id: number;
  case_ref: string;
  from_round: number;
  reason: string;
  requested_by: string;
  requested_at: string;
  decision: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  resulting_round: number | null;
};

/** The register row plus everything the detail screen renders. */
export type InspectionDetail = InspectionRow & {
  case_status: string;
  occupant_name: string | null;
  occupant_phone: string | null;
  area_type_cd: string | null;
  measured_area_sqm: number | null;
  notice_required: boolean | null;
  notice_act_cd: string | null;
  officer_note: string | null;
  location: InspectionLocation | null;
  location_accuracy_m: number | null;
  findings: FindingOut[];
  sections: InspectionSectionRef[];
  check_ins: CheckInOut[];
  evidence: EvidenceOut[];
  /** From the workflow, for THIS caller's roles, in THIS status. The only gate. */
  available_actions: string[];
};

/** `app/icms/collection.py` `Page[T]`, the same envelope as every other register. */
export type InspectionPage = {
  items: InspectionRow[];
  page: number;
  size: number;
  total: number;
  pages: number;
  sort: string;
  next_cursor?: string | null;
};

export type InspectionListQuery = {
  page?: number;
  size?: number;
  sort?: string;
  q?: string;
  case_ref?: readonly string[];
  status?: readonly string[];
  round_no?: readonly number[];
  surveyor_user_id?: readonly string[];
  zone_cd?: readonly string[];
  /** The CASE's priority. Repeatable like the other five; `INSPECTION_PRIORITIES`. */
  priority?: readonly string[];
  /** `YYYY-MM-DD`, inclusive, on `submitted_at`. */
  submitted_from?: string;
  submitted_to?: string;
};

/* ---- request bodies, contract §3 ---------------------------------------- */

export type InspectionOpen = {
  surveyor_user_id: string;
  scheduled_for?: string | null;
};

export type CheckInCreate = {
  latitude: number;
  longitude: number;
  accuracy_m: number;
  device_timestamp: string;
  capture_source: string;
  idempotency_key: string;
};

export type EvidenceCreate = {
  file: File;
  kind: string;
  idempotency_key: string;
  doc_type_cd?: string;
  latitude?: number;
  longitude?: number;
  accuracy_m?: number;
  device_timestamp?: string;
  capture_source?: string;
};

export type FindingsPut = {
  /** Replaces the whole list. An empty array is a 422, not a clear. */
  findings: readonly string[];
  sections?: readonly InspectionSectionRef[] | null;
  occupant_name?: string | null;
  occupant_phone?: string | null;
  area_type_cd?: string | null;
  measured_area_sqm?: number | null;
  notice_required?: boolean | null;
  notice_act_cd?: string | null;
  officer_note?: string | null;
};

export type SubmitRequest = { idempotency_key: string };

export type VerifyRequest = {
  decision: VerifyDecision;
  /** Required when the decision is `reject`. */
  reason?: string | null;
};

export type ResurveyCreate = { reason: string };

export type ResurveyDecide = {
  decision: ResurveyDecisionInput;
  note?: string | null;
  /** Required when the decision is `approve` — the new round needs a surveyor. */
  surveyor_user_id?: string | null;
};

/* ---- vocabularies -------------------------------------------------------- */

/**
 * The `icms_inspection.status` CHECK constraint, in its own order.
 *
 * NOT the case vocabulary. `icms_case.status` has eleven values and this has
 * five; the two travel together through the loop but are different columns, and
 * a screen that renders one with the other's labels is simply wrong.
 */
export const INSPECTION_STATUSES = [
  "scheduled",
  "in_progress",
  "submitted",
  "accepted",
  "rejected",
] as const;

export type InspectionStatus = (typeof INSPECTION_STATUSES)[number];

export function toInspectionStatus(raw: string | null | undefined): InspectionStatus | null {
  if (!raw) return null;
  return (INSPECTION_STATUSES as readonly string[]).includes(raw)
    ? (raw as InspectionStatus)
    : null;
}

/**
 * `CASE_PRIORITIES` from `ada_core/models_icms.py`, which the register's
 * `priority` filter is validated against — the CASE's column, joined onto the
 * round for display, not a vocabulary of the inspection's own.
 */
export const INSPECTION_PRIORITIES = ["high", "medium", "low"] as const;

export type InspectionPriority = (typeof INSPECTION_PRIORITIES)[number];

/** Null for a case with no priority set, and for a value outside the three. */
export function toInspectionPriority(
  raw: string | null | undefined,
): InspectionPriority | null {
  if (!raw) return null;
  return (INSPECTION_PRIORITIES as readonly string[]).includes(raw)
    ? (raw as InspectionPriority)
    : null;
}

/** `icms_resurvey_request.decision`. `pending` is the row's resting state. */
export const RESURVEY_DECISIONS = ["pending", "approved", "rejected"] as const;
export type ResurveyDecision = (typeof RESURVEY_DECISIONS)[number];

/** What `POST /resurvey-requests/{id}/decide` ACCEPTS — not what it stores. */
export const RESURVEY_DECISION_INPUTS = ["approve", "refuse"] as const;
export type ResurveyDecisionInput = (typeof RESURVEY_DECISION_INPUTS)[number];

export const VERIFY_DECISIONS = ["accept", "reject"] as const;
export type VerifyDecision = (typeof VERIFY_DECISIONS)[number];

/** `ada_core.models_icms.EVIDENCE_KINDS`. */
export const EVIDENCE_KINDS = ["photo", "video", "document", "signature"] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/** `icms_check_in.capture_source` — how the fix was obtained. */
export const CHECK_IN_SOURCES = ["gps", "network", "fused", "manual"] as const;
export type CheckInSource = (typeof CHECK_IN_SOURCES)[number];

/** `icms_evidence.capture_source` — where the file came from. A different set. */
export const EVIDENCE_SOURCES = ["camera", "gallery", "upload", "system"] as const;
export type EvidenceSource = (typeof EVIDENCE_SOURCES)[number];

/**
 * The eight workflow actions of this batch, as `available_actions` spells them.
 *
 * Verbatim from `app/icms/workflow.py` `Action`. No new transition is invented
 * by this batch, so the list is closed: an action arriving that is not here is a
 * workflow change, and a screen should render it as unknown rather than guess a
 * label for it.
 */
export const INSPECTION_ACTIONS = [
  "open_round",
  "check_in",
  "add_evidence",
  "record_findings",
  "submit",
  "verify_accept",
  "verify_reject",
  "request_resurvey",
] as const;

export type InspectionAction = (typeof INSPECTION_ACTIONS)[number];

/** Whether the server offered this action to THIS caller on THIS row. */
export function allows(
  detail: Pick<InspectionDetail, "available_actions"> | null | undefined,
  action: InspectionAction,
): boolean {
  return detail?.available_actions.includes(action) ?? false;
}

/* ---- sorting ------------------------------------------------------------- */

export const INSPECTION_SORT_KEYS = [
  "case_ref",
  "inspection_ref",
  "round_no",
  "scheduled_for",
  "started_at",
  "status",
  "submitted_at",
  "surveyor_user_id",
  "zone_cd",
] as const;

export type InspectionSortKey = (typeof INSPECTION_SORT_KEYS)[number];

/**
 * `-inspection_ref`, not `-submitted_at`.
 *
 * `INS-YYYY-NNNN` is allocated monotonically per series, so descending on it is
 * "newest first" and is never NULL — where `scheduled_for` and `submitted_at`
 * are both null on a round that has only just been opened, which is exactly the
 * row a work list has to show at the top.
 */
export const INSPECTION_DEFAULT_SORT = "-inspection_ref";

export function isInspectionSortKey(value: string): value is InspectionSortKey {
  return (INSPECTION_SORT_KEYS as readonly string[]).includes(value);
}

/** `PageParams.size` is refused above the cap server-side, not clamped. */
export const MAX_PAGE_SIZE = 200;

/* ---- permissions and error codes ----------------------------------------- */

/**
 * The two codes that gate this whole area, both seeded by migration 0003.
 *
 * Read from `/me/capabilities` to decide which doors are drawn; enforced by
 * `require_permission` on every route regardless. They cover the four READS
 * only — writes are gated by the transition table, so there is no
 * `inspection.manage` to import here and there never will be.
 */
export const INSPECTION_READ = "inspection.read";
export const EVIDENCE_READ = "evidence.read";

/**
 * The refusals that mean something specific to a screen. Anything else is
 * rendered from `error.message` as it arrives.
 */
export const POOR_ACCURACY = "poor_accuracy";
export const NO_FINDINGS = "no_findings";

const BASE = "/api/icms";

/* ---- shape guards --------------------------------------------------------
   One per endpoint, same reason as `policy.ts`: a proxy error page or a
   contract change must be a thrown error at the boundary rather than a table
   of `undefined`. -------------------------------------------------------- */

function malformed(what: string): IcmsApiError {
  return new IcmsApiError(200, {
    code: "malformed_response",
    message: `The ${what} response did not have the expected shape.`,
  });
}

function narrowObject<T>(body: unknown, field: string, what: string): T {
  if (typeof body !== "object" || body === null || !(field in body)) {
    throw malformed(what);
  }
  return body as T;
}

function narrowList<T>(body: unknown, field: string, what: string): T[] {
  if (
    !Array.isArray(body) ||
    !body.every((item) => typeof item === "object" && item !== null && field in item)
  ) {
    throw malformed(what);
  }
  return body as T[];
}

function narrowPage(body: unknown): InspectionPage {
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
  return body as InspectionPage;
}

/* ---- reads ---------------------------------------------------------------- */

/** `inspection.read`. Zone-scoped, and narrowed to their own rows for a surveyor. */
export async function listInspections(
  query: InspectionListQuery,
  signal: AbortSignal,
): Promise<InspectionPage> {
  const body = await icmsRequest(`${BASE}/inspections`, { query, signal });
  return narrowPage(body);
}

/** `inspection.read`. Carries `available_actions`, which is what gates every write. */
export async function fetchInspection(
  ref: string,
  signal: AbortSignal,
): Promise<InspectionDetail> {
  const body = await icmsRequest(`${BASE}/inspections/${encodeURIComponent(ref)}`, {
    signal,
  });
  return narrowObject<InspectionDetail>(body, "available_actions", "inspection");
}

/** `evidence.read`. Every round's evidence for this inspection, append-only. */
export async function listInspectionEvidence(
  ref: string,
  signal: AbortSignal,
): Promise<EvidenceOut[]> {
  const body = await icmsRequest(
    `${BASE}/inspections/${encodeURIComponent(ref)}/evidence`,
    { signal },
  );
  return narrowList<EvidenceOut>(body, "content_url", "evidence");
}

/**
 * The bytes of one evidence file, as a Blob.
 *
 * Not `icmsRequest`: that module parses JSON and hands back `unknown`, which is
 * right for every other endpoint and wrong for a download. The bearer token is
 * why this cannot simply be `<img src={content_url}>` — a browser sends no
 * Authorization header on an image request — so a gallery fetches here and
 * renders an object URL, and must revoke it when the item unmounts.
 */
export async function fetchEvidenceContent(
  id: number,
  signal: AbortSignal,
): Promise<Blob> {
  let response: Response;
  try {
    response = await fetch(evidenceContentPath(id), {
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
      code: "evidence_unavailable",
      message: `The file could not be downloaded (${String(response.status)}).`,
      request_id: response.headers.get("X-Request-ID"),
    });
  }
  return response.blob();
}

/** The path a download points at. The request still needs the bearer token. */
export function evidenceContentPath(id: number): string {
  return `${BASE}/evidence/${String(id)}/content`;
}

/** `inspection.read`. Every re-survey request raised on this case, any decision. */
export async function listResurveyRequests(
  caseRef: string,
  signal: AbortSignal,
): Promise<ResurveyRequestOut[]> {
  try {
    const body = await icmsRequest(
      `${BASE}/cases/${encodeURIComponent(caseRef)}/resurvey-requests`,
      { signal },
    );
    return narrowList<ResurveyRequestOut>(body, "from_round", "re-survey requests");
  } catch (cause) {
    // An empty list rather than an error, still: the route was mounted only on
    // 2026-09-22 (contract amendment 10) and a portal pointed at an API from
    // before that 404s on every case, where a red panel on every visit would
    // train officers to ignore the panel. It is no longer load-bearing — a
    // visible case with no requests now answers [] — so delete this branch once
    // the deployed API is known to carry the route, and let a 404 mean "no such
    // case, or not in your zones" as it does everywhere else.
    if (cause instanceof IcmsApiError && cause.status === 404) return [];
    throw cause;
  }
}

/* ---- writes: the loop -----------------------------------------------------
   Eight, in the order the contract lists them. None takes a permission code:
   every one is refused by `workflow.check` when the caller's roles do not hold
   the transition in the row's current status. ----------------------------- */

/** `OPEN_ROUND`. 201. Opens round 1, or the next round after a re-survey. */
export async function openInspectionRound(
  caseRef: string,
  body: InspectionOpen,
): Promise<InspectionDetail> {
  const result = await icmsRequest(
    `${BASE}/cases/${encodeURIComponent(caseRef)}/inspections`,
    { method: "POST", body },
  );
  return narrowObject<InspectionDetail>(result, "available_actions", "inspection");
}

/** `CHECK_IN`. 201. An accuracy worse than the threshold is refused 422 `poor_accuracy`. */
export async function checkIn(ref: string, body: CheckInCreate): Promise<CheckInOut> {
  const result = await icmsRequest(
    `${BASE}/inspections/${encodeURIComponent(ref)}/check-in`,
    { method: "POST", body },
  );
  return narrowObject<CheckInOut>(result, "server_timestamp", "check-in");
}

/**
 * `ADD_EVIDENCE`. 201, multipart.
 *
 * A capture with no fix is stored FLAGGED rather than refused — the officer
 * does not lose the photograph — and comes back with `geotag_flagged: true`.
 * The gallery has to show that; silently accepting it as geo-tagged is the one
 * thing contract §4.1 forbids.
 */
export async function addEvidence(
  ref: string,
  input: EvidenceCreate,
): Promise<EvidenceOut> {
  const form = new FormData();
  form.append("file", input.file, input.file.name);
  form.append("kind", input.kind);
  form.append("idempotency_key", input.idempotency_key);
  if (input.doc_type_cd !== undefined) form.append("doc_type_cd", input.doc_type_cd);
  if (input.latitude !== undefined) form.append("latitude", String(input.latitude));
  if (input.longitude !== undefined) form.append("longitude", String(input.longitude));
  if (input.accuracy_m !== undefined) form.append("accuracy_m", String(input.accuracy_m));
  if (input.device_timestamp !== undefined) {
    form.append("device_timestamp", input.device_timestamp);
  }
  if (input.capture_source !== undefined) {
    form.append("capture_source", input.capture_source);
  }

  const result = await icmsRequest(
    `${BASE}/inspections/${encodeURIComponent(ref)}/evidence`,
    { method: "POST", body: form },
  );
  return narrowObject<EvidenceOut>(result, "content_url", "evidence");
}

/** `RECORD_FINDINGS`. 200. REPLACES the findings list; an empty list is a 422. */
export async function putFindings(
  ref: string,
  body: FindingsPut,
): Promise<InspectionDetail> {
  const result = await icmsRequest(
    `${BASE}/inspections/${encodeURIComponent(ref)}/findings`,
    { method: "PUT", body },
  );
  return narrowObject<InspectionDetail>(result, "available_actions", "inspection");
}

/** `SUBMIT`. 200. A replayed key returns the already submitted row, not a 409. */
export async function submitInspection(
  ref: string,
  body: SubmitRequest,
): Promise<InspectionDetail> {
  const result = await icmsRequest(
    `${BASE}/inspections/${encodeURIComponent(ref)}/submit`,
    { method: "POST", body },
  );
  return narrowObject<InspectionDetail>(result, "available_actions", "inspection");
}

/** `VERIFY_ACCEPT` or `VERIFY_REJECT`, chosen by `decision`. 200. */
export async function verifyInspection(
  ref: string,
  body: VerifyRequest,
): Promise<InspectionDetail> {
  const result = await icmsRequest(
    `${BASE}/inspections/${encodeURIComponent(ref)}/verify`,
    { method: "POST", body },
  );
  return narrowObject<InspectionDetail>(result, "available_actions", "inspection");
}

/** `REQUEST_RESURVEY`. 201. One pending request per case — the index is unique. */
export async function createResurveyRequest(
  caseRef: string,
  body: ResurveyCreate,
): Promise<ResurveyRequestOut> {
  const result = await icmsRequest(
    `${BASE}/cases/${encodeURIComponent(caseRef)}/resurvey-requests`,
    { method: "POST", body },
  );
  return narrowObject<ResurveyRequestOut>(result, "from_round", "re-survey request");
}

/** 200. Approving runs `OPEN_ROUND` and fills `resulting_round`; refusing does not. */
export async function decideResurveyRequest(
  id: number,
  body: ResurveyDecide,
): Promise<ResurveyRequestOut> {
  const result = await icmsRequest(`${BASE}/resurvey-requests/${String(id)}/decide`, {
    method: "POST",
    body,
  });
  return narrowObject<ResurveyRequestOut>(result, "decision", "re-survey request");
}

/* ---- idempotency ---------------------------------------------------------- */

/**
 * One key per INTENT, minted where the officer presses the button.
 *
 * Reusing it across retries is the entire point: the unique index turns a
 * replay into "here is the row you already created" rather than a duplicate
 * photograph or a second check-in. Minting a fresh key inside a retry loop
 * defeats that silently, which is the failure worth naming here.
 *
 * `randomUUID` needs a secure context. The portal is HTTPS in every environment
 * it is deployed to; the fallback keeps a plain-HTTP dev server working instead
 * of throwing.
 */
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

// Keeps the generated module imported while the block above stands in for it,
// so the swap described there is a deletion rather than a rewrite.
export type GeneratedSchemas = components["schemas"];
