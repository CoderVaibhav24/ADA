import { strict as assert } from "node:assert";
import { test } from "node:test";

import type {
  EvidenceOut,
  InspectionDetail,
  InspectionRow,
  ResurveyRequestOut,
} from "../../api/icms/inspections.ts";
import {
  ACTION_ORDER,
  decidedResurveys,
  geoStateOf,
  orderedActions,
  pendingResurvey,
  roundsOf,
  telHref,
} from "./detailModel.ts";

// Run with: npm run test -w @ada/web
// detailModel.ts imports types only, so Node's type stripping is enough — no
// bundler, no React, no DOM, and no `@/` alias to resolve.

function row(over: Partial<InspectionRow> & Pick<InspectionRow, "inspection_ref">): InspectionRow {
  return {
    case_ref: "CMP-2026-0412",
    case_title: null,
    round_no: 1,
    status: "submitted",
    zone_cd: "Z1",
    zone_name: null,
    priority: null,
    surveyor_user_id: "u1",
    surveyor_name: null,
    scheduled_for: null,
    started_at: null,
    submitted_at: null,
    evidence_count: 0,
    finding_count: 0,
    has_check_in: false,
    ...over,
  };
}

function detail(over: Partial<InspectionDetail> = {}): InspectionDetail {
  return {
    ...row({ inspection_ref: "INS-2026-0089", round_no: 2 }),
    case_status: "under_inspection",
    occupant_name: null,
    occupant_phone: null,
    area_type_cd: null,
    measured_area_sqm: null,
    notice_required: null,
    notice_act_cd: null,
    officer_note: null,
    location: null,
    location_accuracy_m: null,
    findings: [],
    sections: [],
    check_ins: [],
    evidence: [],
    available_actions: [],
    ...over,
  };
}

function evidence(over: Partial<EvidenceOut>): EvidenceOut {
  return {
    id: 1,
    case_ref: "CMP-2026-0412",
    inspection_ref: "INS-2026-0089",
    round_no: 1,
    kind: "photo",
    doc_type_cd: null,
    original_filename: "site.jpg",
    content_type: "image/jpeg",
    byte_size: 1024,
    sha256: null,
    lat: 28.6139,
    lon: 77.209,
    accuracy_m: 8,
    device_timestamp: null,
    capture_source: "camera",
    captured_at: null,
    uploaded_by: "u1",
    uploaded_at: "2026-09-20T10:00:00Z",
    content_url: "/api/icms/evidence/1/content",
    geotag_flagged: false,
    ...over,
  };
}

function request(over: Partial<ResurveyRequestOut> & Pick<ResurveyRequestOut, "id">): ResurveyRequestOut {
  return {
    case_ref: "CMP-2026-0412",
    from_round: 1,
    reason: "Measurement disputed",
    requested_by: "u2",
    requested_at: "2026-09-18T09:00:00Z",
    decision: "pending",
    decided_by: null,
    decided_at: null,
    decision_note: null,
    resulting_round: null,
    ...over,
  };
}

/* ---- the rule the whole screen turns on --------------------------------- */

test("a flagged geo-tag comes from the server, never from the accuracy", () => {
  // 400 m and NOT flagged: the authority's threshold is wider than that, which
  // the browser cannot know. Trusting the boolean is the only correct answer.
  const wide = geoStateOf(evidence({ accuracy_m: 400, geotag_flagged: false }));
  assert.equal(wide.trusted, true);
  assert.equal(wide.accuracyM, 400);

  // 4 m and flagged: the server saw something this screen did not. Still flagged.
  const tight = geoStateOf(evidence({ accuracy_m: 4, geotag_flagged: true }));
  assert.equal(tight.trusted, false);
});

test("evidence with no fix reports no fix, and the flag still decides trust", () => {
  const state = geoStateOf(
    evidence({ lat: null, lon: null, accuracy_m: null, geotag_flagged: true }),
  );
  assert.equal(state.hasFix, false);
  assert.equal(state.trusted, false);
  assert.equal(state.accuracyM, null);
});

/* ---- actions ------------------------------------------------------------- */

test("the bar draws only what the server offered, in a fixed order", () => {
  const set = orderedActions(["verify_reject", "check_in", "verify_accept"]);
  assert.deepEqual(set.known, ["check_in", "verify_accept", "verify_reject"]);
  assert.deepEqual(set.unknown, []);
});

test("an action this build does not know is kept, not dropped", () => {
  const set = orderedActions(["submit", "verify_escalate"]);
  assert.deepEqual(set.known, ["submit"]);
  assert.deepEqual(set.unknown, ["verify_escalate"]);
});

test("no status string can add an action", () => {
  assert.deepEqual(orderedActions([]).known, []);
  assert.equal(ACTION_ORDER.length, 8);
});

/* ---- the re-survey loop --------------------------------------------------- */

test("round 1 stays in the history after round 2 opens, oldest first", () => {
  const rounds = roundsOf(
    [
      row({ inspection_ref: "INS-2026-0089", round_no: 2 }),
      row({ inspection_ref: "INS-2026-0031", round_no: 1, status: "rejected" }),
    ],
    detail(),
  );
  assert.deepEqual(
    rounds.map((r) => [r.round_no, r.inspection_ref]),
    [
      [1, "INS-2026-0031"],
      [2, "INS-2026-0089"],
    ],
  );
});

test("the round on screen is in its own history even when the list omits it", () => {
  const rounds = roundsOf([], detail());
  assert.deepEqual(rounds.map((r) => r.inspection_ref), ["INS-2026-0089"]);
});

test("another case's rows never leak into this history", () => {
  const rounds = roundsOf(
    [row({ inspection_ref: "INS-2026-0500", case_ref: "CMP-2026-0999" })],
    detail(),
  );
  assert.deepEqual(rounds.map((r) => r.inspection_ref), ["INS-2026-0089"]);
});

test("one request is decidable and the decided ones are history", () => {
  const requests = [
    request({ id: 1, decision: "approved", requested_at: "2026-09-10T09:00:00Z" }),
    request({ id: 2 }),
    request({ id: 3, decision: "rejected", requested_at: "2026-09-12T09:00:00Z" }),
  ];
  assert.equal(pendingResurvey(requests)?.id, 2);
  assert.deepEqual(decidedResurveys(requests).map((r) => r.id), [3, 1]);
  assert.equal(pendingResurvey(decidedResurveys(requests)), null);
});

/* ---- small things -------------------------------------------------------- */

test("only a ten-digit number becomes a dialable link", () => {
  assert.equal(telHref("9987987777"), "tel:+919987987777");
  assert.equal(telHref("99879 87777"), "tel:+919987987777");
  assert.equal(telHref("12345"), null);
  assert.equal(telHref(null), null);
});
