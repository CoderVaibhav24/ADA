import { strict as assert } from "node:assert";
import { test } from "node:test";

import type { CaseDetail, CaseRound } from "../../api/icms/cases.ts";
import type { CapabilityAction } from "../../api/icms/policy.ts";
import {
  amendDiff,
  assignActionOf,
  draftFromCase,
  endingIncomplete,
  evidenceRound,
  hasChanges,
  orderedCaseActions,
  otherTypeMissing,
  pointOf,
  reasonRequired,
  requirementsOf,
  roundsAscending,
  surveyedRound,
  telHref,
} from "./ComplaintDetailModel.ts";

// Run with: npm run test -w @ada/web
// ComplaintDetailModel.ts imports types only, so Node's type stripping is
// enough — no bundler, no React, no DOM, and no `@/` alias to resolve.

type Round = CaseRound;

function round(over: Partial<Round> & Pick<Round, "inspection_ref" | "round_no">): Round {
  return {
    surveyor_user_id: "u1",
    status: "submitted",
    submitted_at: null,
    measured_area_sqm: null,
    ...over,
  };
}

function caseDetail(over: Partial<CaseDetail> = {}): CaseDetail {
  return {
    case_ref: "CMP-2026-0412",
    zone_cd: "Z1",
    zone_name: "Tajganj",
    status: "raised",
    stage_no: 1,
    current_round: 0,
    source: "public",
    raised_at: "2026-09-01T10:00:00+05:30",
    updated_at: "2026-09-02T10:00:00+05:30",
    evidence_count: 0,
    parcel_id: null,
    rounds: [],
    allowed_actions: [],
    assignment: null,
    ...over,
  } as CaseDetail;
}

function action(over: Partial<CapabilityAction> & Pick<CapabilityAction, "action">) {
  return {
    source_status: "raised",
    target_status: "assigned",
    stage_no: 2,
    assignee_only: false,
    opens_round: false,
    requires: [],
    ...over,
  } as CapabilityAction;
}

/* ---- the action bar ------------------------------------------------------ */

test("orderedCaseActions splits what this screen builds from what it does not", () => {
  const set = orderedCaseActions(["verify_accept", "assign", "reject"]);
  assert.deepEqual(set.built, ["assign"]);
  assert.deepEqual(set.endings, ["reject"]);
  assert.deepEqual(set.offered, ["verify_accept"]);
});

test("orderedCaseActions draws in a fixed order, not the server's", () => {
  const set = orderedCaseActions(["close", "hand_over", "reject", "confirm"]);
  assert.deepEqual(set.endings, ["reject", "close"]);
  assert.deepEqual(set.offered, ["hand_over", "confirm"]);
});

test("orderedCaseActions keeps a code this build has never seen", () => {
  const set = orderedCaseActions(["hand_over", "verify_escalate"]);
  assert.deepEqual(set.offered, ["hand_over", "verify_escalate"]);
});

test("orderedCaseActions offers nothing when the server offered nothing", () => {
  const set = orderedCaseActions([]);
  assert.deepEqual(set.built, []);
  assert.deepEqual(set.endings, []);
  assert.deepEqual(set.offered, []);
});

test("endingIncomplete asks for a code, and remarks only when the code is other", () => {
  assert.equal(endingIncomplete("", ""), true);
  assert.equal(endingIncomplete("duplicate", ""), false);
  assert.equal(endingIncomplete("other", "too short"), true);
  assert.equal(endingIncomplete("other", "Owner produced a sanction."), false);
});

/* ---- which transition the assign endpoint will run ----------------------- */

test("assignActionOf takes the single candidate the status admits", () => {
  assert.equal(assignActionOf(["assign", "reject"]), "assign");
  assert.equal(assignActionOf(["reassign", "open_round"]), "reassign");
});

test("assignActionOf falls back to assign when both are legal, as the server does", () => {
  assert.equal(assignActionOf(["assign", "reassign"]), "assign");
});

test("assignActionOf is null when the server offered neither", () => {
  assert.equal(assignActionOf(["verify_accept"]), null);
});

/* ---- what the form must collect ------------------------------------------ */

test("requirementsOf matches on the action AND the status it is legal from", () => {
  const actions = [
    action({ action: "assign", source_status: "raised", requires: ["assignee_user_id"] }),
    action({
      action: "reassign",
      source_status: "assigned",
      requires: ["assignee_user_id", "reason"],
    }),
  ];
  assert.deepEqual(requirementsOf(actions, "assign", "raised"), ["assignee_user_id"]);
  assert.equal(requirementsOf(actions, "assign", "assigned"), null);
});

test("reasonRequired reads the server's requires rather than the action's name", () => {
  const actions = [
    action({ action: "assign", source_status: "raised", requires: ["assignee_user_id"] }),
    action({
      action: "reassign",
      source_status: "assigned",
      requires: ["assignee_user_id", "reason"],
    }),
  ];
  assert.equal(reasonRequired(actions, "assign", "raised"), false);
  assert.equal(reasonRequired(actions, "reassign", "assigned"), true);
});

test("reasonRequired follows a policy that starts demanding a reason to assign", () => {
  const actions = [
    action({
      action: "assign",
      source_status: "raised",
      requires: ["assignee_user_id", "reason"],
    }),
  ];
  assert.equal(reasonRequired(actions, "assign", "raised"), true);
});

test("reasonRequired falls back to the workflow default when capabilities are silent", () => {
  assert.equal(reasonRequired(undefined, "assign", "raised"), false);
  assert.equal(reasonRequired(undefined, "reassign", "assigned"), true);
  assert.equal(reasonRequired([], "reassign", "assigned"), true);
});

/* ---- the rounds ---------------------------------------------------------- */

test("roundsAscending reads forwards, oldest round first", () => {
  const ordered = roundsAscending([
    round({ inspection_ref: "INS-2", round_no: 2 }),
    round({ inspection_ref: "INS-1", round_no: 1 }),
  ]);
  assert.deepEqual(
    ordered.map((r) => r.inspection_ref),
    ["INS-1", "INS-2"],
  );
});

test("roundsAscending breaks a tie on the reference so the table never reshuffles", () => {
  const ordered = roundsAscending([
    round({ inspection_ref: "INS-9", round_no: 1 }),
    round({ inspection_ref: "INS-3", round_no: 1 }),
  ]);
  assert.deepEqual(
    ordered.map((r) => r.inspection_ref),
    ["INS-3", "INS-9"],
  );
});

test("evidenceRound points at the open round", () => {
  const rounds = [
    round({ inspection_ref: "INS-1", round_no: 1 }),
    round({ inspection_ref: "INS-2", round_no: 2 }),
  ];
  assert.equal(evidenceRound(rounds, 2)?.inspection_ref, "INS-2");
});

test("evidenceRound falls back to the latest round that exists", () => {
  const rounds = [round({ inspection_ref: "INS-1", round_no: 1 })];
  assert.equal(evidenceRound(rounds, 7)?.inspection_ref, "INS-1");
});

test("evidenceRound is null on a case nobody has surveyed", () => {
  assert.equal(evidenceRound([], 0), null);
});

/* ---- the small readings -------------------------------------------------- */

test("pointOf reads GeoJSON longitude-first", () => {
  assert.deepEqual(pointOf({ type: "Point", coordinates: [78.0081, 27.1751] }), {
    lat: 27.1751,
    lon: 78.0081,
  });
});

test("pointOf refuses anything that is not a coordinate pair", () => {
  assert.equal(pointOf(null), null);
  assert.equal(pointOf({ type: "Point" }), null);
  assert.equal(pointOf({ coordinates: [78.0081] }), null);
  assert.equal(pointOf({ coordinates: ["78", "27"] }), null);
});

test("telHref offers a link only for a ten-digit mobile", () => {
  assert.equal(telHref("9876543210"), "tel:+919876543210");
  assert.equal(telHref("1800123"), null);
  assert.equal(telHref(null), null);
});

/* ---- the amend body ------------------------------------------------------ */

test("draftFromCase renders an absent field as an empty input, never as 'null'", () => {
  const draft = draftFromCase(caseDetail({ landmark: null, district: "Agra" }));
  assert.equal(draft.landmark, "");
  assert.equal(draft.district, "Agra");
});

test("amendDiff sends only the field that changed", () => {
  const detail = caseDetail({ owner_name: "A Sharma", district: "Agra" });
  const draft = { ...draftFromCase(detail), owner_name: "B Sharma" };
  const diff = amendDiff(detail, draft);
  assert.deepEqual(diff.changes, { owner_name: "B Sharma" });
  assert.deepEqual(Object.keys(diff.changes), ["owner_name"]);
});

test("amendDiff sends nothing at all when nothing was touched", () => {
  const detail = caseDetail({ owner_name: "A Sharma" });
  const diff = amendDiff(detail, draftFromCase(detail));
  assert.deepEqual(diff.changes, {});
  assert.equal(hasChanges(diff), false);
});

test("amendDiff turns a cleared input into an explicit null", () => {
  const detail = caseDetail({ landmark: "Near the bus stand" });
  const draft = { ...draftFromCase(detail), landmark: "   " };
  assert.deepEqual(amendDiff(detail, draft).changes, { landmark: null });
});

test("amendDiff leaves a field that was already empty out of the body", () => {
  const detail = caseDetail({ landmark: null });
  const draft = { ...draftFromCase(detail), landmark: "  " };
  assert.deepEqual(amendDiff(detail, draft).changes, {});
});

test("amendDiff parses floor_count and refuses what the server would", () => {
  const detail = caseDetail({ floor_count: 2 });

  const ok = amendDiff(detail, { ...draftFromCase(detail), floor_count: "4" });
  assert.deepEqual(ok.changes, { floor_count: 4 });
  assert.deepEqual(ok.invalid, []);

  const cleared = amendDiff(detail, { ...draftFromCase(detail), floor_count: "" });
  assert.deepEqual(cleared.changes, { floor_count: null });

  for (const bad of ["-1", "201", "2.5", "two"]) {
    const diff = amendDiff(detail, { ...draftFromCase(detail), floor_count: bad });
    assert.deepEqual(diff.invalid, ["floor_count"], `expected ${bad} to be refused`);
    assert.deepEqual(diff.changes, {});
  }
});

test("amendDiff carries a priority change and nothing beside it", () => {
  const detail = caseDetail({ priority: "low" });
  const draft = { ...draftFromCase(detail), priority: "high" };
  assert.deepEqual(amendDiff(detail, draft).changes, { priority: "high" });
});

test("otherTypeMissing catches the one pairing the create model already refuses", () => {
  const detail = caseDetail({ complaint_type_cd: "encroachment" });
  const base = draftFromCase(detail);
  assert.equal(otherTypeMissing({ ...base, complaint_type_cd: "other" }), true);
  assert.equal(
    otherTypeMissing({ ...base, complaint_type_cd: "other", other_type: "Boundary wall" }),
    false,
  );
  assert.equal(otherTypeMissing(base), false);
});

test("surveyedRound picks the newest round that recorded occupant or property facts", () => {
  const rounds = [
    round({ inspection_ref: "INS-1", round_no: 1, police_station: "Tajganj", floor_count: 2 }),
    round({ inspection_ref: "INS-2", round_no: 2, occupant_name: "R Kumar" }),
    round({ inspection_ref: "INS-3", round_no: 3 }),
  ];
  assert.equal(surveyedRound(rounds)?.inspection_ref, "INS-2");
  assert.equal(surveyedRound([round({ inspection_ref: "INS-1", round_no: 1, floor_count: 0 })])?.round_no, 1);
  assert.equal(surveyedRound([round({ inspection_ref: "INS-1", round_no: 1 })]), null);
  assert.equal(surveyedRound([]), null);
});
