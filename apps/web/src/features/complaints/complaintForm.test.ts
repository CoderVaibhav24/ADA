import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  MAX_FLOORS,
  blankComplaintForm,
  firstProblem,
  hasErrors,
  isDirty,
  isKhasraValid,
  isPhoneValid,
  normalisePhone,
  seedComplaintForm,
  setSource,
  toComplaintBody,
  validateComplaintForm,
  type ComplaintFormState,
  type DetectionSeed,
} from "./complaintForm.ts";

// Run with: npm test -w frontend
// complaintForm.ts imports nothing, so Node's type stripping is enough — no
// bundler, no React, no DOM.

const KEY = "3f1c9a6e-0c2b-4e6f-9d1a-7b5e8c4d2a10";

// The smallest form the server will accept from an officer: a zone, a
// description, the three required place names and a complainant.
function fileable(): ComplaintFormState {
  return {
    ...blankComplaintForm(),
    zoneCd: "Z-TAJ",
    complainantName: "Ramesh Lal",
    complainantPhone: "9876543210",
    landmark: "Behind the bus stand",
    district: "Agra",
    state: "Uttar Pradesh",
    detail: "Boundary wall raised onto the service lane.",
  };
}

const DETECTION: DetectionSeed = {
  detectionRef: "DET-7-0042",
  polygonId: "4471",
  areaM2: 318,
  confidence: 0.94,
  lat: 27.1767,
  lon: 78.0081,
  status: "illegal",
};

test("a blank form is not fileable, and says so field by field", () => {
  const errors = validateComplaintForm(blankComplaintForm());

  assert.equal(hasErrors(errors), true);
  // `_locatable_and_coherent`: neither a zone nor a point.
  assert.equal(errors.zoneCd, "required");
  assert.equal(errors.complainantName, "required");
  assert.equal(errors.complainantPhone, "required");
  assert.equal(errors.landmark, "required");
  assert.equal(errors.district, "required");
  assert.equal(errors.state, "required");
  assert.equal(errors.detail, "required");
  // Country is seeded, not blank, so it is not among the complaints.
  assert.equal(errors.country, undefined);
  // The cursor lands on the first problem in SCREEN order, not object order.
  assert.equal(firstProblem(errors), "complainantName");
});

test("a filled form passes, and the body omits every blank column", () => {
  const state = fileable();
  assert.equal(hasErrors(validateComplaintForm(state)), false);

  const body = toComplaintBody(state, KEY);
  assert.equal(body.source, "office");
  assert.equal(body.zone_cd, "Z-TAJ");
  assert.equal(body.country, "India");
  assert.equal(body.priority, "medium");
  assert.equal(body.idempotency_key, KEY);
  // Absent, not null: a create takes the model's default for what it omits.
  assert.equal("ulpin" in body, false);
  assert.equal("location" in body, false);
  assert.equal("detection_id" in body, false);
  assert.equal("other_type" in body, false);
});

test("a point alone satisfies the locatable rule — the server resolves the zone", () => {
  const state: ComplaintFormState = {
    ...fileable(),
    zoneCd: "",
    latitude: "27.176700",
    longitude: "78.008100",
  };

  assert.equal(validateComplaintForm(state).zoneCd, undefined);
  const body = toComplaintBody(state, KEY);
  assert.deepEqual(body.location, { latitude: 27.1767, longitude: 78.0081 });
  assert.equal("zone_cd" in body, false);
});

test("half a point is not a point, and does not satisfy the rule on its own", () => {
  const errors = validateComplaintForm({ ...fileable(), zoneCd: "", latitude: "27.1767" });

  assert.equal(errors.longitude, "invalid");
  assert.equal(errors.zoneCd, "required");
});

test("a coordinate outside its range is refused before the request", () => {
  const errors = validateComplaintForm({
    ...fileable(),
    latitude: "127.5",
    longitude: "-181",
  });

  assert.equal(errors.latitude, "range");
  assert.equal(errors.longitude, "range");
});

test("the detection hand-off seeds the four fields it can actually fill", () => {
  const state = seedComplaintForm(DETECTION, "Raised from change detection DET-7-0042.");

  assert.equal(state.source, "detection");
  assert.equal(state.detectionId, "4471");
  assert.equal(state.latitude, "27.176700");
  assert.equal(state.longitude, "78.008100");
  assert.equal(state.detail, "Raised from change detection DET-7-0042.");
  // The officer still enters the rest; a detection knows none of it.
  assert.equal(state.complainantName, "");
  assert.equal(state.landmark, "");
});

test("a detection-sourced case needs no complainant, because there is none", () => {
  const state: ComplaintFormState = {
    ...seedComplaintForm(DETECTION, "Encroachment detected on the service lane."),
    landmark: "Behind the bus stand",
    district: "Agra",
    state: "Uttar Pradesh",
  };

  const errors = validateComplaintForm(state);
  assert.equal(errors.complainantName, undefined);
  assert.equal(errors.complainantPhone, undefined);
  assert.equal(hasErrors(errors), false);

  const body = toComplaintBody(state, KEY);
  assert.equal(body.source, "detection");
  assert.equal(body.detection_id, 4471);
});

test("changing the source away from detection drops the polygon id with it", () => {
  const seeded = seedComplaintForm(DETECTION, "Detected.");
  const moved = setSource(seeded, "public");

  assert.equal(moved.detectionId, "");
  // `detection_id` on a non-detection source is a 422; it must not survive.
  assert.equal("detection_id" in toComplaintBody(moved, KEY), false);
});

test("complaint type 'other' makes other_type mandatory, as the server does", () => {
  const state: ComplaintFormState = { ...fileable(), complaintTypeCd: "other" };
  assert.equal(validateComplaintForm(state).otherType, "required");

  const named: ComplaintFormState = { ...state, otherType: "Illegal borewell" };
  assert.equal(validateComplaintForm(named).otherType, undefined);
  assert.equal(toComplaintBody(named, KEY).other_type, "Illegal borewell");
});

test("a phone is normalised the way PhoneIN normalises it", () => {
  assert.equal(normalisePhone("+91 98765 43210"), "9876543210");
  assert.equal(normalisePhone("098765-43210"), "9876543210");
  assert.equal(isPhoneValid("+91 98765 43210"), true);
  // The first digit must be 6-9: a landline-shaped number is not a mobile.
  assert.equal(isPhoneValid("1234567890"), false);

  const body = toComplaintBody({ ...fileable(), complainantPhone: "+91 98765 43210" }, KEY);
  assert.equal(body.complainant_phone, "9876543210");
});

test("markup is refused in a stored string, the way _reject_markup is", () => {
  const errors = validateComplaintForm({ ...fileable(), landmark: "<script>x</script>" });
  assert.equal(errors.landmark, "invalid");
});

test("the land-record identifiers are optional but validated when given", () => {
  assert.equal(validateComplaintForm(fileable()).ulpin, undefined);

  const errors = validateComplaintForm({
    ...fileable(),
    ulpin: "TOO-SHORT",
    khasraNo: "142//B",
    villageLgdCode: "not-a-code",
  });
  assert.equal(errors.ulpin, "invalid");
  assert.equal(errors.khasraNo, "invalid");
  assert.equal(errors.villageLgdCode, "invalid");

  assert.equal(isKhasraValid("142 / 3 - B"), true);
  const body = toComplaintBody({ ...fileable(), khasraNo: "142 / 3 - B" }, KEY);
  assert.equal(body.khasra_no, "142/3-B");
});

test("floor count is a whole number inside the column's range", () => {
  assert.equal(
    validateComplaintForm({ ...fileable(), floorCount: "2.5" }).floorCount,
    "invalid",
  );
  assert.equal(
    validateComplaintForm({ ...fileable(), floorCount: String(MAX_FLOORS + 1) }).floorCount,
    "range",
  );
  assert.equal(toComplaintBody({ ...fileable(), floorCount: "3" }, KEY).floor_count, 3);
});

test("the body carries the key it is given, so a retry replays one attempt", () => {
  const state = fileable();
  const first = toComplaintBody(state, KEY);
  const retry = toComplaintBody(state, KEY);

  // Same intent, same key: the server answers with the case the first attempt
  // created rather than raising a second one.
  assert.equal(first.idempotency_key, retry.idempotency_key);
});

test("the unsaved guard sees typing and ignores an untouched form", () => {
  const baseline = blankComplaintForm();

  assert.equal(isDirty(baseline, blankComplaintForm()), false);
  assert.equal(isDirty(baseline, { ...baseline, landmark: "Bus stand" }), true);
  assert.equal(isDirty(baseline, setSource(baseline, "public")), true);
});
