/**
 * The decisions the Inspection detail screen makes, kept out of the JSX.
 *
 * Two of them are contract properties rather than presentation:
 *
 *   - **`geoStateOf` reads `geotag_flagged` and never recomputes it.** Contract
 *     §4.1 stores a capture with no fix, or an accuracy worse than the
 *     authority's threshold, FLAGGED; §3 puts the boolean on the wire precisely
 *     because that threshold is server configuration no browser can read. An
 *     accuracy of 400 m is trusted where the threshold is 500 m and flagged
 *     where it is 50 m, so a screen that infers the state from `accuracy_m` is
 *     wrong on one of them and cannot tell which.
 *   - **`orderedActions` sorts `available_actions`; it never extends it.** The
 *     server computed that list for this caller's roles in this row's status.
 *     A code this build does not know is kept and reported as unknown rather
 *     than dropped, because dropping it hides a workflow change.
 *
 * Every import here is `import type`, and that is load-bearing rather than
 * tidy: `npm test` runs this module under `node --experimental-strip-types`,
 * which erases type imports but cannot resolve the `@/` alias. A value
 * imported from `@/api/icms/inspections` would make the whole file untestable.
 */

import type {
  EvidenceOut,
  InspectionAction,
  InspectionDetail,
  InspectionRow,
  ResurveyRequestOut,
} from "@/api/icms/inspections";

/**
 * The order the action bar draws the workflow's eight actions in.
 *
 * `satisfies` checks every member is a real action and `ORDER_IS_COMPLETE`
 * checks none is missing, so a transition added to `workflow.py` and published
 * in `available_actions` is a build error here rather than a button that
 * quietly never appears.
 */
export const ACTION_ORDER = [
  "check_in",
  "add_evidence",
  "record_findings",
  "submit",
  "verify_accept",
  "verify_reject",
  "request_resurvey",
  "open_round",
] as const satisfies readonly InspectionAction[];

export const ORDER_IS_COMPLETE: Exclude<
  InspectionAction,
  (typeof ACTION_ORDER)[number]
> extends never
  ? true
  : false = true;

export type GeoState = {
  /** Exactly `!geotag_flagged`. Never derived from `accuracy_m`. */
  trusted: boolean;
  /** Whether there is a coordinate to show at all. Display only. */
  hasFix: boolean;
  accuracyM: number | null;
};

/** The server's verdict on one file's geo-tag, unpacked for rendering. */
export function geoStateOf(
  evidence: Pick<EvidenceOut, "geotag_flagged" | "lat" | "lon" | "accuracy_m">,
): GeoState {
  return {
    trusted: !evidence.geotag_flagged,
    hasFix: evidence.lat != null && evidence.lon != null,
    accuracyM: evidence.accuracy_m ?? null,
  };
}

export type ActionSet = {
  /** In `ACTION_ORDER`, so the bar does not reshuffle between two rows. */
  known: InspectionAction[];
  /** Offered by the server, unknown to this build. Drawn, disabled, by code. */
  unknown: string[];
};

/** Splits what the server offered into what this build can draw and what it cannot. */
export function orderedActions(available: readonly string[]): ActionSet {
  const offered = new Set(available);
  const known = ACTION_ORDER.filter((action) => offered.has(action));
  const unknown = available.filter(
    (code) => !(ACTION_ORDER as readonly string[]).includes(code),
  );
  return { known: [...known], unknown };
}

/**
 * Every round of this case, oldest first, with the open one guaranteed present.
 *
 * Ascending because the re-survey loop reads forwards — round 1 is what round 2
 * was opened to correct, and it has to stay legible after round 2 exists. The
 * detail's own row is merged in rather than assumed: the register query is
 * zone-scoped and paged, and a history that omits the round on screen reads as
 * data loss.
 */
export function roundsOf(
  rows: readonly InspectionRow[],
  detail: InspectionDetail,
): InspectionRow[] {
  const byRef = new Map<string, InspectionRow>();
  for (const row of rows) {
    if (row.case_ref === detail.case_ref) byRef.set(row.inspection_ref, row);
  }
  byRef.set(detail.inspection_ref, detail);

  return [...byRef.values()].sort(
    (a, b) => a.round_no - b.round_no || a.inspection_ref.localeCompare(b.inspection_ref),
  );
}

/**
 * The one request that can still be decided, if there is one.
 *
 * `pending` is the resting state of `icms_resurvey_request.decision`, and the
 * contract allows one open request per case, so this is a find rather than a sort.
 */
export function pendingResurvey(
  requests: readonly ResurveyRequestOut[],
): ResurveyRequestOut | null {
  return requests.find((request) => request.decision === "pending") ?? null;
}

/** Decided requests, newest first — the history under the pending one. */
export function decidedResurveys(
  requests: readonly ResurveyRequestOut[],
): ResurveyRequestOut[] {
  return requests
    .filter((request) => request.decision !== "pending")
    .sort((a, b) => b.requested_at.localeCompare(a.requested_at) || b.id - a.id);
}

/** A ten-digit mobile, the only shape a `tel:` link is offered for. */
export function telHref(phone: string | null | undefined): string | null {
  const digits = phone?.replace(/\D/g, "") ?? "";
  return digits.length === 10 ? `tel:+91${digits}` : null;
}
