import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  MAX_FINDINGS,
  addFinding,
  addSection,
  findingsFormFrom,
  hasErrors,
  isDirty,
  moveFinding,
  normalisePhone,
  parseArea,
  removeFinding,
  removeSection,
  setFindingText,
  toFindingsBody,
  validateFindingsForm,
  type FindingsFormState,
  type FindingsSource,
} from "./findingsForm.ts";

// Run with: npm run test -w @ada/web
// findingsForm.ts imports nothing, so Node's type stripping is enough — no
// bundler, no React, no DOM.

const EMPTY_ROUND: FindingsSource = {
  findings: [],
  sections: [],
  occupant_name: null,
  occupant_phone: null,
  area_type_cd: null,
  measured_area_sqm: null,
  notice_required: null,
  notice_act_cd: null,
  officer_note: null,
};

const RECORDED_ROUND: FindingsSource = {
  // Deliberately out of sequence: the server orders by `seq`, not by array
  // position, and the form must render the officer's order rather than the
  // JSON's.
  findings: [
    { seq: 2, finding: "Second floor slab cast without sanction" },
    { seq: 1, finding: "Boundary wall raised by 1.2 m" },
  ],
  sections: [
    { act_cd: "up_urban_planning_act", section_cd: "s_28" },
    { act_cd: "up_urban_planning_act", section_cd: "s_27" },
  ],
  occupant_name: "Ramesh Lal",
  occupant_phone: "9876543210",
  area_type_cd: "built_up",
  measured_area_sqm: 185.5,
  notice_required: true,
  notice_act_cd: "up_urban_planning_act",
  officer_note: "Owner was present and was shown the sanctioned plan.",
};

function withFindings(...texts: string[]): FindingsFormState {
  let state = findingsFormFrom(EMPTY_ROUND);
  state = setFindingText(state, state.findings[0].id, texts[0] ?? "");
  for (const text of texts.slice(1)) {
    state = addFinding(state);
    state = setFindingText(state, state.findings[state.findings.length - 1].id, text);
  }
  return state;
}

test("a round with nothing recorded opens with one empty row to write in", () => {
  const state = findingsFormFrom(EMPTY_ROUND);
  assert.equal(state.findings.length, 1);
  assert.equal(state.findings[0].text, "");
  assert.deepEqual(state.sections, []);
  assert.equal(state.noticeRequired, false);
});

test("findings are ordered by seq and sections by (act, section)", () => {
  const state = findingsFormFrom(RECORDED_ROUND);
  assert.deepEqual(
    state.findings.map((item) => item.text),
    ["Boundary wall raised by 1.2 m", "Second floor slab cast without sanction"],
  );
  assert.deepEqual(
    state.sections.map((item) => item.sectionCd),
    ["s_27", "s_28"],
  );
});

// The reason the contract's empty-list 422 never reaches the wire.
test("a form with nothing written cannot be saved, and says which field", () => {
  const errors = validateFindingsForm(findingsFormFrom(EMPTY_ROUND));
  assert.equal(errors.findings, "required");
  assert.equal(hasErrors(errors), true);
});

test("whitespace is not an observation", () => {
  const errors = validateFindingsForm(withFindings("   \n  "));
  assert.equal(errors.findings, "required");
});

test("one written finding is enough", () => {
  const errors = validateFindingsForm(withFindings("", "Shed erected on the setback"));
  assert.deepEqual(errors, {});
});

test("the list stops at the server's fifty", () => {
  let state = findingsFormFrom(EMPTY_ROUND);
  for (let i = 0; i < MAX_FINDINGS + 10; i += 1) state = addFinding(state);
  assert.equal(state.findings.length, MAX_FINDINGS);
});

test("removing the last row leaves an editor, not an empty list", () => {
  const state = findingsFormFrom(EMPTY_ROUND);
  const after = removeFinding(state, state.findings[0].id);
  assert.equal(after.findings.length, 1);
  assert.equal(after.findings[0].text, "");
});

test("a finding keeps its identity when it moves, so focus survives a reorder", () => {
  const state = withFindings("first", "second", "third");
  const target = state.findings[2];
  const moved = moveFinding(state, target.id, -1);

  assert.deepEqual(
    moved.findings.map((item) => item.text),
    ["first", "third", "second"],
  );
  assert.equal(moved.findings[1].id, target.id);
});

test("moving off either end is a no-op rather than a lost row", () => {
  const state = withFindings("first", "second");
  assert.equal(moveFinding(state, state.findings[0].id, -1), state);
  assert.equal(moveFinding(state, state.findings[1].id, 1), state);
});

test("a repeated section is refused and the list stays sorted", () => {
  let state = findingsFormFrom(EMPTY_ROUND);
  state = addSection(state, "up_urban_planning_act", "s_28");
  state = addSection(state, "up_urban_planning_act", "s_27");
  state = addSection(state, "up_urban_planning_act", "s_27");

  assert.deepEqual(
    state.sections.map((item) => item.sectionCd),
    ["s_27", "s_28"],
  );

  state = removeSection(state, "up_urban_planning_act", "s_27");
  assert.deepEqual(
    state.sections.map((item) => item.sectionCd),
    ["s_28"],
  );
});

test("the phone normaliser matches PhoneIN on the server", () => {
  assert.equal(normalisePhone("+91 98765 43210"), "9876543210");
  assert.equal(normalisePhone("09876543210"), "9876543210");
  assert.equal(normalisePhone("0091-9876543210"), "9876543210");

  const bad = validateFindingsForm({
    ...withFindings("Shed erected on the setback"),
    occupantPhone: "12345",
  });
  assert.equal(bad.phone, "invalid");
});

test("the area is square metres or nothing — never NaN on the wire", () => {
  assert.equal(parseArea(""), null);
  assert.equal(parseArea("185.5"), 185.5);
  assert.equal(parseArea("-1"), null);
  assert.equal(parseArea("twelve"), null);
  assert.equal(parseArea("10000001"), null);

  const bad = validateFindingsForm({
    ...withFindings("Shed erected on the setback"),
    measuredArea: "twelve",
  });
  assert.equal(bad.area, "invalid");
});

test("a required notice must name the act it would be issued under", () => {
  const base = withFindings("Shed erected on the setback");
  assert.equal(
    validateFindingsForm({ ...base, noticeRequired: true, noticeActCd: "" }).noticeAct,
    "required",
  );
  assert.deepEqual(
    validateFindingsForm({
      ...base,
      noticeRequired: true,
      noticeActCd: "up_urban_planning_act",
    }),
    {},
  );
});

test("the body sends an emptied field as null, so the column is cleared", () => {
  const state = findingsFormFrom(RECORDED_ROUND);
  const body = toFindingsBody({
    ...state,
    occupantName: "   ",
    officerNote: "",
    measuredArea: "",
  });

  assert.equal(body.occupant_name, null);
  assert.equal(body.officer_note, null);
  assert.equal(body.measured_area_sqm, null);
  assert.equal(body.occupant_phone, "9876543210");
});

// `sections: null` means "leave them alone" server-side; this form owns the
// list on screen, so clearing it must clear the record.
test("the body always carries a sections array, empty included", () => {
  let state = findingsFormFrom(RECORDED_ROUND);
  assert.deepEqual(toFindingsBody(state).sections, [
    { act_cd: "up_urban_planning_act", section_cd: "s_27" },
    { act_cd: "up_urban_planning_act", section_cd: "s_28" },
  ]);

  state = removeSection(state, "up_urban_planning_act", "s_27");
  state = removeSection(state, "up_urban_planning_act", "s_28");
  assert.deepEqual(toFindingsBody(state).sections, []);
});

test("an act is not cited when no notice is required", () => {
  const state = findingsFormFrom(RECORDED_ROUND);
  const body = toFindingsBody({ ...state, noticeRequired: false });
  assert.equal(body.notice_required, false);
  assert.equal(body.notice_act_cd, null);
});

test("blank rows are dropped from the body but are not an edit", () => {
  const state = findingsFormFrom(RECORDED_ROUND);
  const withBlank = addFinding(state);

  assert.equal(toFindingsBody(withBlank).findings.length, 2);
  assert.equal(isDirty(state, withBlank), false);
});

test("the unsaved-changes guard sees a real edit and ignores a reformat", () => {
  const baseline = findingsFormFrom(RECORDED_ROUND);

  assert.equal(isDirty(baseline, { ...baseline, occupantName: "Ramesh Lal  " }), false);
  assert.equal(isDirty(baseline, { ...baseline, occupantPhone: "+91 98765 43210" }), false);
  assert.equal(isDirty(baseline, { ...baseline, occupantName: "Suresh Lal" }), true);
  assert.equal(isDirty(baseline, moveFinding(baseline, baseline.findings[0].id, 1)), true);
  assert.equal(
    isDirty(baseline, removeSection(baseline, "up_urban_planning_act", "s_27")),
    true,
  );
});
