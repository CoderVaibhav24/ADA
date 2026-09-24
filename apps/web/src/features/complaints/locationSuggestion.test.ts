import { strict as assert } from "node:assert";
import { test } from "node:test";

import { blankComplaintForm, isDirty } from "./complaintForm.ts";
import {
  applySuggestion,
  pinPoint,
  suggestedFields,
  suggestionFrom,
  withoutSuggestion,
  type LocationSuggestion,
} from "./locationSuggestion.ts";

const AGRA: LocationSuggestion = {
  state: "Uttar Pradesh",
  district: "Agra",
  districtLgdCode: "118",
  pinCode: "282001",
};

const MATHURA: LocationSuggestion = {
  state: "Uttar Pradesh",
  district: "Mathura",
  districtLgdCode: "167",
  pinCode: "",
};

test("the answer becomes form values, and an unavailable lookup becomes nothing", () => {
  assert.deepEqual(
    suggestionFrom({
      state: "Uttar Pradesh",
      district: "Agra",
      district_lgd: "118",
      pincode: null,
      source: "nominatim",
    }),
    { ...AGRA, pinCode: "" },
  );
  assert.equal(
    suggestionFrom({
      state: null,
      district: null,
      district_lgd: null,
      pincode: null,
      source: "unavailable",
    }),
    null,
  );
});

test("a pin is a rounded point only when both halves are real coordinates", () => {
  assert.deepEqual(pinPoint("27.175144", "78.042142"), { lat: 27.1751, lon: 78.0421 });
  assert.equal(pinPoint("", "78.04"), null);
  assert.equal(pinPoint("27.", "abc"), null);
  assert.equal(pinPoint("91", "78"), null);
});

test("blank fields are filled", () => {
  const filled = applySuggestion(blankComplaintForm("2026-09-24"), null, AGRA);
  assert.equal(filled.state, "Uttar Pradesh");
  assert.equal(filled.district, "Agra");
  assert.equal(filled.districtLgdCode, "118");
  assert.equal(filled.pinCode, "282001");
});

test("what the officer typed is never overwritten", () => {
  const typed = { ...blankComplaintForm("2026-09-24"), district: "Firozabad" };
  const filled = applySuggestion(typed, null, AGRA);
  assert.equal(filled.district, "Firozabad");
  assert.equal(filled.state, "Uttar Pradesh");
});

test("a moved pin replaces the last suggestion, but not an edit of it", () => {
  const first = applySuggestion(blankComplaintForm("2026-09-24"), null, AGRA);
  const edited = { ...first, pinCode: "282002" };
  const moved = applySuggestion(edited, AGRA, MATHURA);
  assert.equal(moved.district, "Mathura");
  assert.equal(moved.districtLgdCode, "167");
  assert.equal(moved.pinCode, "282002");
});

test("a moved pin clears a stale suggestion the new one has nothing for", () => {
  const first = applySuggestion(blankComplaintForm("2026-09-24"), null, AGRA);
  assert.equal(applySuggestion(first, AGRA, MATHURA).pinCode, "");
});

test("the hint follows the field until it is edited", () => {
  const filled = applySuggestion(blankComplaintForm("2026-09-24"), null, AGRA);
  assert.deepEqual(
    [...suggestedFields(filled, AGRA)].sort(),
    ["district", "districtLgdCode", "pinCode", "state"],
  );
  assert.equal(suggestedFields({ ...filled, district: "Agra City" }, AGRA).has("district"), false);
  assert.equal(suggestedFields(filled, null).size, 0);
});

test("a suggestion alone does not make the form unsaved", () => {
  const baseline = blankComplaintForm("2026-09-24");
  const filled = applySuggestion(baseline, null, AGRA);
  assert.equal(isDirty(baseline, withoutSuggestion(filled, AGRA, baseline)), false);
  const edited = { ...filled, district: "Agra City" };
  assert.equal(isDirty(baseline, withoutSuggestion(edited, AGRA, baseline)), true);
});
