/**
 * The decisions the Complaint detail screen makes, kept out of the JSX.
 *
 * Three of them are contract properties rather than presentation:
 *
 *   - **`assignActionOf` mirrors `repository.assign_case` exactly.** One
 *     endpoint serves `assign` and `reassign`, and the server picks between
 *     them from the case's status; where both are legal it falls back to
 *     `assign`. This reproduces that choice so the dialog asks for the fields
 *     the transition the server will actually run demands.
 *   - **`reasonRequired` reads the server's own `requires`.** `/me/capabilities`
 *     publishes the live transition table for this caller, `requires` and all,
 *     so the reason box is driven by the policy an administrator can edit this
 *     afternoon rather than by a tuple compiled into the portal. The code
 *     default in `workflow.py` is the fallback and is named as one.
 *   - **`amendDiff` emits only what changed.** `CaseAmend.changes()` is
 *     `model_dump(exclude_unset=True)`, so every key present in the body is
 *     written — sending the untouched fields back would overwrite them.
 *
 * Every import here is `import type`, and that is load-bearing rather than
 * tidy: `npm test` runs this module under `node --experimental-strip-types`,
 * which erases type imports but cannot resolve the `@/` alias.
 */

import type { CaseAmend, CaseDetail, CaseRound } from "@/api/icms/cases";
import type { CapabilityAction } from "@/api/icms/policy";

export type { CaseRound };

/**
 * The order the action bar draws the workflow's case actions in.
 *
 * `raise` is absent because its source status is null — it can never appear on
 * a case that exists — and `amend` because it is not a transition at all.
 */
export const CASE_ACTION_ORDER = [
  "assign",
  "reassign",
  "reject",
  "open_round",
  "check_in",
  "add_evidence",
  "record_findings",
  "submit",
  "request_resurvey",
  "verify_accept",
  "verify_reject",
  "hand_over",
  "confirm",
  "issue_notice",
  "close",
] as const;

/** The assign pair, sharing one dialog. Reject and close are `ENDING_ACTIONS`. */
export const BUILT_ACTIONS = ["assign", "reassign"] as const;

export type BuiltAction = (typeof BUILT_ACTIONS)[number];

/** The two terminal actions, each with its own reason dialog on this screen. */
export const ENDING_ACTIONS = ["reject", "close"] as const;

export type EndingAction = (typeof ENDING_ACTIONS)[number];

/** `case_schemas.REJECT_REASONS` and `CLOSE_OUTCOMES`, the codes ada-core 0022 seeds. */
export const REJECT_REASONS = [
  "false_complaint",
  "duplicate",
  "outside_jurisdiction",
  "no_violation_found",
  "other",
] as const;

export const CLOSE_OUTCOMES = [
  "demolished_by_owner",
  "demolished_by_authority",
  "regularised",
  "court_case_filed",
  "sealed",
  "other",
] as const;

/** `case_schemas.OTHER_REMARKS_MIN`: remarks this long are required when the code is `other`. */
export const OTHER_REMARKS_MIN = 10;

/** Whether the ending form may be sent: a code chosen, and remarks when that code is `other`. */
export function endingIncomplete(code: string, remarks: string): boolean {
  if (code === "") return true;
  return code === "other" && remarks.trim().length < OTHER_REMARKS_MIN;
}

export type CaseActionSet = {
  /** Offered by the server AND buildable here. */
  built: BuiltAction[];
  /** Reject / close, offered by the server; each opens its own dialog. */
  endings: EndingAction[];
  /** Offered by the server, owned by another screen. Drawn, disabled, by code. */
  offered: string[];
};

/** Splits what the server offered into what this screen can do and what it cannot. */
export function orderedCaseActions(allowed: readonly string[]): CaseActionSet {
  const offeredSet = new Set(allowed);
  const built = BUILT_ACTIONS.filter((action) => offeredSet.has(action));
  const endings = ENDING_ACTIONS.filter((action) => offeredSet.has(action));
  const own: readonly string[] = [...BUILT_ACTIONS, ...ENDING_ACTIONS];

  const known = CASE_ACTION_ORDER.filter((code) => offeredSet.has(code) && !own.includes(code));
  // A transition added to the workflow after this build keeps its place at the
  // end rather than being dropped, because dropping it hides a policy change.
  const unlisted = allowed.filter(
    (code) => !(CASE_ACTION_ORDER as readonly string[]).includes(code),
  );

  return { built: [...built], endings: [...endings], offered: [...known, ...unlisted] };
}

/** Which transition the assign endpoint will run, decided the way the server decides it. */
export function assignActionOf(allowed: readonly string[]): BuiltAction | null {
  const candidates = BUILT_ACTIONS.filter((action) => allowed.includes(action));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];
  return "assign";
}

/** The `requires` the server published for this action out of this status. */
export function requirementsOf(
  actions: readonly CapabilityAction[] | undefined,
  action: string,
  sourceStatus: string,
): readonly string[] | null {
  const row = actions?.find(
    (candidate) => candidate.action === action && candidate.source_status === sourceStatus,
  );
  return row ? row.requires : null;
}

/** Whether the assign form must collect a reason — the server's answer, or the code default. */
export function reasonRequired(
  actions: readonly CapabilityAction[] | undefined,
  action: BuiltAction,
  sourceStatus: string,
): boolean {
  const requires = requirementsOf(actions, action, sourceStatus);
  if (requires === null) return action === "reassign";
  return requires.includes("reason");
}

/** The 422s `assign_case` answers that name the assignee rather than the request. */
export const ASSIGNEE_NOT_A_SURVEYOR = "assignee_not_a_surveyor";
export const ASSIGNEE_NOT_IN_ZONE = "assignee_not_in_zone";

/** 404 from every case route: no such case, or none this caller has authority over. */
export const CASE_NOT_FOUND = "case_not_found";

/**
 * Every round of the case, oldest first — round 1 is what round 2 was opened to
 * correct, and it has to stay legible after round 2 exists.
 */
/** The occupant and property facts a surveyor records on a round. */
export const SURVEYED_FIELDS = [
  "occupant_name",
  "occupant_phone",
  "property_type_cd",
  "floor_count",
  "police_station",
] as const;

// The newest round that recorded any surveyed fact, or null when none has.
export function surveyedRound(rounds: readonly CaseRound[]): CaseRound | null {
  const newestFirst = roundsAscending(rounds).reverse();
  return (
    newestFirst.find((round) =>
      SURVEYED_FIELDS.some((field) => round[field] !== null && round[field] !== undefined && round[field] !== ""),
    ) ?? null
  );
}

export function roundsAscending(rounds: readonly CaseRound[]): CaseRound[] {
  return [...rounds].sort(
    (a, b) => a.round_no - b.round_no || a.inspection_ref.localeCompare(b.inspection_ref),
  );
}

/**
 * The round the evidence count links to. `evidence_count` is counted per CASE,
 * so this is where new evidence lands rather than where all of it is.
 */
export function evidenceRound(
  rounds: readonly CaseRound[],
  currentRound: number,
): CaseRound | null {
  const ascending = roundsAscending(rounds);
  if (ascending.length === 0) return null;
  return (
    ascending.find((round) => round.round_no === currentRound) ??
    ascending[ascending.length - 1]
  );
}

export type CasePoint = { lat: number; lon: number };

/** `Case.location` arrives as GeoJSON from PostGIS, or as null. */
export function pointOf(location: CaseDetail["location"]): CasePoint | null {
  if (!location || typeof location !== "object") return null;
  const coordinates: unknown = (location as { coordinates?: unknown }).coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const [lon, lat] = coordinates as unknown[];
  if (typeof lon !== "number" || typeof lat !== "number") return null;
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return { lat, lon };
}

/** A ten-digit mobile, the only shape a `tel:` link is offered for. */
export function telHref(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits.length === 10 ? `tel:+91${digits}` : null;
}

/* ---- the amend form ------------------------------------------------------ */

/**
 * Every field `CaseAmend` accepts that holds text, in the order the form draws
 * them. `floor_count` and `priority` are not here: one is a number and one is a
 * closed vocabulary, and both are handled by name below.
 */
export const AMEND_TEXT_FIELDS = [
  "complaint_type_cd",
  "other_type",
  "detail",
  "complainant_name",
  "complainant_phone",
  "complainant_email",
  "owner_name",
  "owner_phone",
  "property_address",
  "landmark",
  "police_station",
  "pin_code",
  "district",
  "state",
  "country",
  "property_type_cd",
  "ulpin",
  "khasra_no",
  "village_lgd_code",
  "district_lgd_code",
] as const;

export type AmendTextField = (typeof AMEND_TEXT_FIELDS)[number];

export const AMEND_FIELDS = [...AMEND_TEXT_FIELDS, "floor_count", "priority"] as const;

export type AmendField = (typeof AMEND_FIELDS)[number];

/** The form's own state: every amendable field as the string an input holds. */
export type AmendDraft = Record<AmendField, string>;

/** The case as the form starts out — a null field is an empty input, not "null". */
export function draftFromCase(detail: CaseDetail): AmendDraft {
  const draft = {} as AmendDraft;
  for (const field of AMEND_FIELDS) {
    const value: unknown = detail[field as keyof CaseDetail];
    draft[field] = value === null || value === undefined ? "" : String(value);
  }
  return draft;
}

export type AmendDiff = {
  /** Only the fields the officer actually changed. Never the whole record. */
  changes: CaseAmend;
  /** Fields whose text cannot become the type the field holds. */
  invalid: AmendField[];
};

/** `floor_count` is 0–200 on the server; anything else is refused before it is sent. */
function floorCountOf(text: string): number | null | "invalid" {
  if (text.trim() === "") return null;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 200) return "invalid";
  return parsed;
}

/**
 * What to PATCH: the difference between the case and the form, and nothing else.
 * An emptied input is an explicit null; an input that was always empty is absent.
 */
export function amendDiff(detail: CaseDetail, draft: AmendDraft): AmendDiff {
  const original = draftFromCase(detail);
  const changes: Record<string, unknown> = {};
  const invalid: AmendField[] = [];

  for (const field of AMEND_TEXT_FIELDS) {
    const next = draft[field].trim();
    if (next === original[field].trim()) continue;
    changes[field] = next === "" ? null : next;
  }

  if (draft.floor_count.trim() !== original.floor_count.trim()) {
    const parsed = floorCountOf(draft.floor_count);
    if (parsed === "invalid") invalid.push("floor_count");
    else changes.floor_count = parsed;
  }

  if (draft.priority.trim() !== original.priority.trim()) {
    const next = draft.priority.trim();
    changes.priority = next === "" ? null : next;
  }

  return { changes: changes as CaseAmend, invalid };
}

/** The server refuses an empty body outright, so the button asks first. */
export function hasChanges(diff: AmendDiff): boolean {
  return Object.keys(diff.changes).length > 0;
}

/** `complaint_type_cd` of `other` without `other_type` is a contradiction the form states itself. */
export function otherTypeMissing(draft: AmendDraft): boolean {
  return draft.complaint_type_cd.trim() === "other" && draft.other_type.trim() === "";
}
