import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  MAX_LONG_TEXT,
  MAX_SAFE_TEXT,
  NOTICE_PROBLEMS,
  blankNoticeForm,
  fieldId,
  firstProblem,
  hasErrors,
  isDirty,
  setAct,
  toNoticeBody,
  toggleSection,
  validateNoticeForm,
  type NoticeFormState,
} from "./noticeForm.ts";

// Run with: npm run test -w frontend
// noticeForm.ts imports one TYPE and nothing else, so Node's type stripping is
// enough — no bundler, no React, no DOM.

const TODAY = "2026-09-23";
const SECTION_ORDER = ["14", "26", "27", "28", "28-A"] as const;

function ready(overrides: Partial<NoticeFormState> = {}): NoticeFormState {
  return {
    ...blankNoticeForm("CMP-2026-0395"),
    actCd: "up_upda_1973",
    sectionCds: ["14"],
    ...overrides,
  };
}

test("a blank form names every field that is required", () => {
  const errors = validateNoticeForm(blankNoticeForm(), TODAY);
  assert.equal(errors.caseRef, NOTICE_PROBLEMS.caseRequired);
  assert.equal(errors.actCd, NOTICE_PROBLEMS.actRequired);
  assert.equal(errors.sectionCds, NOTICE_PROBLEMS.sectionsRequired);
  assert.equal(firstProblem(errors), "caseRef");
  assert.equal(hasErrors(errors), true);
});

test("an act and one section is enough to issue", () => {
  assert.equal(hasErrors(validateNoticeForm(ready(), TODAY)), false);
});

test("a compliance date already past is refused, today is not", () => {
  assert.equal(
    validateNoticeForm(ready({ complianceDue: "2026-09-22" }), TODAY).complianceDue,
    NOTICE_PROBLEMS.duePast,
  );
  assert.equal(
    validateNoticeForm(ready({ complianceDue: TODAY }), TODAY).complianceDue,
    undefined,
  );
  assert.equal(
    validateNoticeForm(ready({ complianceDue: "15-09-2026" }), TODAY).complianceDue,
    NOTICE_PROBLEMS.dueMalformed,
  );
});

test("the two length limits are the server's", () => {
  assert.equal(
    validateNoticeForm(ready({ issuingAuthority: "x".repeat(MAX_SAFE_TEXT + 1) }), TODAY)
      .issuingAuthority,
    NOTICE_PROBLEMS.authorityTooLong,
  );
  assert.equal(
    validateNoticeForm(ready({ grounds: "x".repeat(MAX_LONG_TEXT + 1) }), TODAY).grounds,
    NOTICE_PROBLEMS.groundsTooLong,
  );
});

test("changing the act drops the sections that belonged to the old one", () => {
  const before = ready({ sectionCds: ["14", "28-A"] });
  const after = setAct(before, "up_upda_1974");
  assert.deepEqual(after.sectionCds, []);
  // Re-selecting the same act is not a change and must not clear anything.
  assert.equal(setAct(before, "up_upda_1973"), before);
});

test("sections come back in the vocabulary's order, not the order of clicking", () => {
  let state = blankNoticeForm("CMP-2026-0395");
  state = toggleSection(state, "28-A", SECTION_ORDER);
  state = toggleSection(state, "14", SECTION_ORDER);
  state = toggleSection(state, "27", SECTION_ORDER);
  assert.deepEqual(state.sectionCds, ["14", "27", "28-A"]);

  state = toggleSection(state, "27", SECTION_ORDER);
  assert.deepEqual(state.sectionCds, ["14", "28-A"]);
});

test("a section the vocabulary no longer offers is kept rather than dropped", () => {
  const state = toggleSection(ready({ sectionCds: ["14", "99-Z"] }), "26", SECTION_ORDER);
  assert.deepEqual(state.sectionCds, ["14", "26", "99-Z"]);
});

test("an empty optional field is omitted from the body, never sent blank", () => {
  const body = toNoticeBody(ready(), "grounds");
  assert.deepEqual(body, { act_cd: "up_upda_1973", section_cds: ["14"] });
  assert.equal("compliance_due" in body, false);
  assert.equal("issuing_authority" in body, false);
  assert.equal("body_overrides" in body, false);
});

test("the grounds paragraph rides in body_overrides under the one agreed key", () => {
  const body = toNoticeBody(
    ready({ complianceDue: "2026-10-08", issuingAuthority: "  Vice Chairman  ", grounds: " x " }),
    "grounds",
  );
  assert.equal(body.compliance_due, "2026-10-08");
  assert.equal(body.issuing_authority, "Vice Chairman");
  assert.deepEqual(body.body_overrides, { grounds: "x" });
});

test("isDirty and fieldId", () => {
  const initial = blankNoticeForm("CMP-2026-0395");
  assert.equal(isDirty(initial, initial), false);
  assert.equal(isDirty({ ...initial, grounds: "a" }, initial), true);
  assert.equal(isDirty({ ...initial, sectionCds: ["14"] }, initial), true);
  assert.equal(fieldId("actCd"), "notice-actCd");
});
