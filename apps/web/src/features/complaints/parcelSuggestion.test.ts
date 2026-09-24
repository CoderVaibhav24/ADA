import { strict as assert } from "node:assert";
import { test } from "node:test";

import { blankComplaintForm, isDirty } from "./complaintForm.ts";
import {
  EMPTY_PARCEL,
  applyParcel,
  foreignZone,
  parcelFields,
  parcelIsPlot,
  parcelSuggestionFrom,
  withoutParcel,
  type ParcelAnswer,
} from "./parcelSuggestion.ts";

const MINE = new Set(["Z01", "Z02"]);

const IN_Z01: ParcelAnswer = {
  zone_cd: "Z01",
  zone_name: "Tajganj",
  village_lgd: "123456",
  khasra_no: "45/2",
  plot_no: null,
  ulpin: "UP1234567890AB",
  source: "kml",
};

const SCHEME_PLOT: ParcelAnswer = {
  zone_cd: "Z01",
  zone_name: "Tajganj",
  village_lgd: null,
  khasra_no: null,
  plot_no: "4/285",
  ulpin: null,
  source: "kml",
};

test("a kml answer becomes form values, and none becomes nothing", () => {
  assert.deepEqual(parcelSuggestionFrom(IN_Z01, MINE), {
    zoneCd: "Z01",
    villageLgdCode: "123456",
    khasraNo: "45/2",
    ulpin: "UP1234567890AB",
    plotNo: false,
  });
  assert.deepEqual(parcelSuggestionFrom({ ...IN_Z01, source: "none" }, MINE), EMPTY_PARCEL);
});

test("a scheme plot fills Parcel ID with its plot number and leaves the village blank", () => {
  const suggestion = parcelSuggestionFrom(SCHEME_PLOT, MINE);
  assert.deepEqual(suggestion, {
    zoneCd: "Z01",
    villageLgdCode: "",
    khasraNo: "4/285",
    ulpin: "",
    plotNo: true,
  });
  const filled = applyParcel(blankComplaintForm(), null, suggestion);
  assert.equal(filled.khasraNo, "4/285");
  assert.equal(filled.villageLgdCode, "");
  assert.equal(parcelIsPlot(filled, suggestion), true);
  // Once the officer edits it, it is theirs and no longer the plot hint.
  assert.equal(parcelIsPlot({ ...filled, khasraNo: "4/286" }, suggestion), false);
});

test("a khasra wins over a plot number, and is not called a plot", () => {
  const both = { ...IN_Z01, plot_no: "CP-1" };
  const suggestion = parcelSuggestionFrom(both, MINE);
  assert.equal(suggestion.khasraNo, "45/2");
  assert.equal(suggestion.plotNo, false);
  assert.equal(parcelIsPlot(applyParcel(blankComplaintForm(), null, suggestion), suggestion), false);

  // A pin moved from a plot to a khasra replaces the plot number it filled.
  const plot = parcelSuggestionFrom(SCHEME_PLOT, MINE);
  const moved = applyParcel(applyParcel(blankComplaintForm(), null, plot), plot, suggestion);
  assert.equal(moved.khasraNo, "45/2");
  assert.equal(moved.villageLgdCode, "123456");
});

test("a zone the officer is not assigned is not filled, and is named instead", () => {
  const elsewhere = { ...IN_Z01, zone_cd: "Z09", zone_name: "Fatehabad" };
  assert.equal(parcelSuggestionFrom(elsewhere, MINE).zoneCd, "");
  assert.equal(parcelSuggestionFrom(elsewhere, MINE).khasraNo, "45/2");
  assert.deepEqual(foreignZone(elsewhere, MINE), { code: "Z09", name: "Fatehabad" });
  assert.equal(foreignZone(IN_Z01, MINE), null);
  // Unknown until the zone list has answered.
  assert.equal(parcelSuggestionFrom(elsewhere, null).zoneCd, "");
  assert.equal(foreignZone(elsewhere, null), null);
  assert.equal(foreignZone({ ...elsewhere, source: "none" }, MINE), null);
});

test("fills blank fields, keeps typed ones, and a moved pin replaces or clears its own values", () => {
  const first = parcelSuggestionFrom(IN_Z01, MINE);
  const typed = { ...blankComplaintForm(), khasraNo: "99" };
  const filled = applyParcel(typed, null, first);
  assert.equal(filled.zoneCd, "Z01");
  assert.equal(filled.khasraNo, "99");
  assert.deepEqual([...parcelFields(filled, first)].sort(), ["ulpin", "villageLgdCode", "zoneCd"]);

  const moved = parcelSuggestionFrom({ ...IN_Z01, zone_cd: "Z02", khasra_no: "7", ulpin: null }, MINE);
  const refilled = applyParcel(filled, first, moved);
  assert.equal(refilled.zoneCd, "Z02");
  assert.equal(refilled.ulpin, "");
  assert.equal(refilled.khasraNo, "99");

  const cleared = applyParcel(refilled, moved, EMPTY_PARCEL);
  assert.equal(cleared.zoneCd, "");
  assert.equal(cleared.villageLgdCode, "");
  assert.equal(cleared.khasraNo, "99");
});

test("a suggestion alone does not make the form unsaved", () => {
  const baseline = blankComplaintForm();
  const suggestion = parcelSuggestionFrom(IN_Z01, MINE);
  const filled = applyParcel(baseline, null, suggestion);
  assert.equal(isDirty(baseline, withoutParcel(filled, suggestion, baseline)), false);
  const edited = { ...filled, villageLgdCode: "654321" };
  assert.equal(isDirty(baseline, withoutParcel(edited, suggestion, baseline)), true);
});

test("a named plot the Parcel ID rule would refuse is not filled in", () => {
  for (const plot_no of ["CP-1", "NA-143", "NEW VISION SCHOOL"]) {
    const suggestion = parcelSuggestionFrom({ ...SCHEME_PLOT, plot_no }, MINE);
    assert.equal(suggestion.khasraNo, "");
    assert.equal(suggestion.plotNo, false);
  }
});
