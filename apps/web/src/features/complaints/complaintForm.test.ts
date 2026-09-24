import { strict as assert } from "node:assert";
import { test } from "node:test";

import {
  blankComplaintForm,
  firstProblem,
  forMode,
  initialMode,
  hasErrors,
  isDirty,
  isKhasraValid,
  isPhoneValid,
  localToday,
  lockedByProfile,
  officerContact,
  normalisePhone,
  requiredFields,
  detectionSentence,
  seedComplaintForm,
  setSource,
  toComplaintBody,
  validateComplaintForm,
  withOfficer,
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
  changeType: "new_construction",
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
  // A red-zone overlap is an encroachment, whatever the change type says.
  assert.equal(state.complaintTypeCd, "encroachment");
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

test("the surveyor's fields are neither asked for nor sent", () => {
  const body = toComplaintBody(fileable(), KEY);
  for (const key of ["owner_name", "owner_phone", "property_type_cd", "floor_count", "police_station"]) {
    assert.equal(key in body, false, key);
  }
});

test("the tab opens on the query string's choice, else detection only with a hand-off", () => {
  assert.equal(initialMode(null, true), "detection");
  assert.equal(initialMode(null, false), "manual");
  assert.equal(initialMode("manual", true), "manual");
  assert.equal(initialMode("detection", false), "detection");
  assert.equal(initialMode("bogus", false), "manual");
});

test("the detection tab files as the officer, with no address, landmark or phone", () => {
  const officer = officerContact({ name: "Priya Verma", email: "priya@ada.gov.in" });
  const shared: ComplaintFormState = {
    ...seedComplaintForm(DETECTION, "Detected."),
    // Typed on the Manual tab, then the officer switched back.
    complainantName: "Ramesh Lal",
    complainantPhone: "9876543210",
    propertyAddress: "12 Mall Road",
    district: "Agra",
    state: "Uttar Pradesh",
  };

  const detected = forMode(shared, "detection", officer);
  const errors = validateComplaintForm(detected);
  // Landmark is a Manual-tab field: a detection case is fileable without it.
  assert.equal(errors.landmark, undefined);
  assert.equal(hasErrors(errors), false);
  assert.equal(requiredFields(detected).has("landmark"), false);
  assert.equal(requiredFields(detected).has("district"), true);

  const body = toComplaintBody(detected, KEY);
  assert.equal(body.source, "detection");
  assert.equal(body.detection_id, 4471);
  assert.equal(body.complainant_name, "Priya Verma");
  assert.equal(body.complainant_email, "priya@ada.gov.in");
  assert.equal("complainant_phone" in body, false);
  assert.equal(body.property_address, undefined);
  // The shared state is untouched, so the Manual tab still has what was typed.
  assert.equal(shared.complainantName, "Ramesh Lal");
});

test("the manual tab never carries the polygon, and needs a landmark", () => {
  const seeded: ComplaintFormState = {
    ...seedComplaintForm(DETECTION, "Detected."),
    district: "Agra",
    state: "Uttar Pradesh",
  };
  const manual = forMode(seeded, "manual");

  assert.equal(manual.source, "office");
  assert.equal(manual.detectionId, "");
  const errors = validateComplaintForm(manual);
  assert.equal(errors.landmark, "required");
  assert.equal(errors.complainantName, "required");
  assert.equal(firstProblem(errors, "manual"), "complainantName");
  assert.equal("detection_id" in toComplaintBody(manual, KEY), false);
  // Back on the detection tab, the polygon id is still there.
  assert.equal(forMode(seeded, "detection").detectionId, "4471");
  // A chosen manual source survives.
  assert.equal(forMode({ ...seeded, source: "public" }, "manual").source, "public");
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

test("the complaint date defaults to today and may not be in the future", () => {
  const today = "2026-09-23";
  const state: ComplaintFormState = { ...fileable(), complaintDate: today };
  assert.equal(blankComplaintForm(today).complaintDate, today);
  assert.equal(validateComplaintForm(state, today).complaintDate, undefined);
  assert.equal(toComplaintBody(state, KEY).complaint_date, today);

  const back = { ...state, complaintDate: "2026-09-01" };
  assert.equal(validateComplaintForm(back, today).complaintDate, undefined);
  assert.equal(toComplaintBody(back, KEY).complaint_date, "2026-09-01");

  assert.equal(
    validateComplaintForm({ ...state, complaintDate: "2026-09-24" }, today).complaintDate,
    "future",
  );
  assert.equal(
    validateComplaintForm({ ...state, complaintDate: "2026-02-30" }, today).complaintDate,
    "invalid",
  );

  // Blank is absent: the server dates the complaint itself.
  const blank = { ...state, complaintDate: "" };
  assert.equal(validateComplaintForm(blank, today).complaintDate, undefined);
  assert.equal("complaint_date" in toComplaintBody(blank, KEY), false);
});

test("localToday uses the local calendar day, zero-padded", () => {
  assert.equal(localToday(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
});

test("the asterisks come from the same rules the validator applies", () => {
  const manual = requiredFields(blankComplaintForm());
  assert.equal(manual.has("complainantName"), true);
  assert.equal(manual.has("landmark"), true);
  assert.equal(manual.has("country"), false);
  // Parcel ID (khasra) stays optional: a parcel-less complaint is still fileable.
  assert.equal(manual.has("khasraNo"), false);

  const detected = requiredFields(seedComplaintForm(DETECTION, "Detected."));
  assert.equal(detected.has("complainantName"), false);
  assert.equal(detected.has("landmark"), false);
  assert.equal(requiredFields({ ...fileable(), complaintTypeCd: "other" }).has("otherType"), true);
});

test("the detection sentence leaves out what the detection does not know", () => {
  assert.equal(
    detectionSentence("From DET-7-0042", ["overlaps a red zone", "about 318 sq.m", "94% confidence"], ". "),
    "From DET-7-0042: overlaps a red zone, about 318 sq.m, 94% confidence. ",
  );
  assert.equal(detectionSentence("From DET-7-0042", [null, "", "94% confidence"], "."), "From DET-7-0042: 94% confidence.");
  assert.equal(detectionSentence("From DET-7-0042", [null, null], "."), "From DET-7-0042.");
});

test("the suggested type: red zone first, then the change type, else blank", () => {
  const typeOf = (status: DetectionSeed["status"], changeType: string | null) =>
    seedComplaintForm({ ...DETECTION, status, changeType }, "").complaintTypeCd;

  assert.equal(typeOf("illegal", "demolition"), "encroachment");
  assert.equal(typeOf("illegal", null), "encroachment");
  assert.equal(typeOf("change", "new_construction"), "unauthorised_construction");
  assert.equal(typeOf("change", "extension"), "deviation_from_plan");
  assert.equal(typeOf("change", "demolition"), "other");
  assert.equal(typeOf("change", "unchanged"), "");
  assert.equal(typeOf("change", null), "");
  assert.equal(typeOf(null, null), "");
});

test("the officer's profile becomes the complainant, and only valid claims count", () => {
  const officer = officerContact({
    name: "  Priya   Verma ",
    email: "Priya.Verma@ADA.gov.in",
    phone_number: "+91 98765 43210",
  });
  assert.deepEqual(officer, {
    name: "Priya Verma",
    email: "priya.verma@ada.gov.in",
    phone: "9876543210",
  });

  // Name claims fall back as the header does, but never to an email local-part.
  assert.equal(officerContact({ given_name: "Priya", family_name: "Verma" }).name, "Priya Verma");
  assert.equal(officerContact({ preferred_username: "pverma" }).name, "pverma");
  assert.equal(officerContact({ preferred_username: "p@ada.gov.in" }).name, "");
  // A value the server would refuse is not locked into a read-only box.
  assert.equal(officerContact({ name: "<b>x</b>", email: "admin@localhost" }).name, "");
  assert.equal(officerContact({ email: "admin@localhost" }).email, "");
  assert.deepEqual(officerContact(undefined), { name: "", email: "", phone: "" });
});

test("a prefilled complainant validates and is submitted", () => {
  const officer = officerContact({ name: "Priya Verma", email: "priya@ada.gov.in" });
  const state = withOfficer({ ...fileable(), complainantName: "", complainantEmail: "" }, officer);

  assert.equal(hasErrors(validateComplaintForm(state)), false);
  const body = toComplaintBody(state, KEY);
  assert.equal(body.complainant_name, "Priya Verma");
  assert.equal(body.complainant_email, "priya@ada.gov.in");
  // No phone claim: the one the officer typed stays, and stays editable.
  assert.equal(body.complainant_phone, "9876543210");
  assert.deepEqual([...lockedByProfile(officer)], ["complainantName", "complainantEmail"]);
  assert.equal(lockedByProfile(officerContact({})).size, 0);
  assert.equal(lockedByProfile(null).size, 0);
});
