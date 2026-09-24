/**
 * The Create Complaint form as data: state, seeding, validation, request body.
 *
 * No React and no `@/` import in this file, deliberately: `npm test` runs
 * `node --test` over `src/**` with type stripping and no bundler, so the rules
 * that decide whether a complaint may be filed are testable without a DOM. The
 * screen renders this and nothing else decides.
 *
 * Three properties of `POST /api/icms/cases` shape all of it —
 * `CaseCreate` in `services/api/app/icms/case_schemas.py`:
 *
 *   - **`zone_cd` or `location`, at least one.** `_locatable_and_coherent`
 *     refuses a body with neither. A location is preferred when there is one,
 *     because the server resolves the zone from it with `ST_Contains` and that
 *     answer beats an officer's guess; but a point outside every active
 *     boundary comes back 422 `zone_unresolved` asking for a zone, so the form
 *     collects both and sends both.
 *   - **`source` and `detection_id` are coherent or the body is refused.**
 *     `detection` requires a `detection_id`; any other source must not carry
 *     one. So the hand-off from Change Detection pins the source, and changing
 *     the source away from `detection` drops the id rather than sending a pair
 *     the server will reject.
 *   - **`complaint_type_cd` of `other` requires `other_type`.** A server rule,
 *     not a house style, and the only conditional field on the form.
 *
 * Everything blank is OMITTED rather than sent as null. This is a create, not
 * an amend: an absent optional field takes the model's own default, and
 * `country` defaults to "India" server-side — which is why `country` is the one
 * optional column always present in the body, since `CaseCreate` declares it
 * non-optional with a default rather than as absent.
 *
 * The string constraints mirrored below are `ada_core/validation.py`. They are
 * duplicated here so the officer is told in their own language before the round
 * trip; the server validates them again regardless, and its refusal is what the
 * screen renders when the two ever disagree.
 */

/** `SafeText`. Address and the free-text `other_type`. */
export const MAX_SAFE_TEXT = 500;
/** `SafeLongText`, which the description is. */
export const MAX_LONG_TEXT = 5000;
/** `Name` and `PlaceName`. */
export const MAX_NAME = 200;
/** `Email`. */
export const MAX_EMAIL = 254;
/** `KhasraNo`. */
export const MAX_KHASRA = 24;

/** `case_schemas.SOURCES`, in the order the picker offers them. */
export const COMPLAINT_SOURCES = ["office", "public", "field", "detection"] as const;
export type ComplaintSource = (typeof COMPLAINT_SOURCES)[number];

/** `CASE_PRIORITIES`. The CHECK constraint is lower case; the capitals are CSS. */
export const COMPLAINT_PRIORITIES = ["high", "medium", "low"] as const;
export type ComplaintPriority = (typeof COMPLAINT_PRIORITIES)[number];

/** The two tabs of the form: raised from a detection hand-off, or typed in by hand. */
export const COMPLAINT_MODES = ["detection", "manual"] as const;
export type ComplaintMode = (typeof COMPLAINT_MODES)[number];

/** The `complaint_type_cd` whose presence makes `other_type` mandatory. */
export const OTHER_TYPE_CODE = "other";

/**
 * Every field is a string, including the numbers and the coordinates.
 *
 * "12." and "" are states a `number` cannot hold, and a partially typed
 * latitude is a state an officer is routinely in. Parsing happens once, on the
 * way to the body.
 */
export type ComplaintFormState = {
  source: string;
  /** The change polygon's feature id. Only meaningful when source is detection. */
  detectionId: string;
  zoneCd: string;
  latitude: string;
  longitude: string;

  complaintTypeCd: string;
  otherType: string;
  detail: string;

  complainantName: string;
  complainantPhone: string;
  complainantEmail: string;

  propertyAddress: string;
  landmark: string;
  pinCode: string;
  district: string;
  state: string;
  country: string;

  ulpin: string;
  khasraNo: string;
  villageLgdCode: string;
  districtLgdCode: string;

  priority: string;
  /** `complaint_date`, ISO yyyy-mm-dd. Blank lets the server default it. */
  complaintDate: string;
};

export type ComplaintField = keyof ComplaintFormState;

export type ComplaintFieldError = "required" | "invalid" | "tooLong" | "range" | "future";

export type ComplaintFormErrors = Partial<Record<ComplaintField, ComplaintFieldError>>;

/**
 * The Manual tab's screen order, which is also the order a refused submit looks
 * for a problem. Moving a field on screen means moving it here, so the cursor
 * never jumps backwards past something the officer can already see is wrong.
 */
export const COMPLAINT_FIELD_ORDER: readonly ComplaintField[] = [
  "complainantName",
  "complainantPhone",
  "complainantEmail",
  "source",
  "propertyAddress",
  "landmark",
  "pinCode",
  "villageLgdCode",
  "khasraNo",
  "district",
  "state",
  "country",
  "complaintTypeCd",
  "otherType",
  "detail",
  "priority",
  "complaintDate",
  // The collapsed "More details" group, below the date row.
  "ulpin",
  "districtLgdCode",
  // The map column, which sits after the form card in the DOM.
  "zoneCd",
  "latitude",
  "longitude",
  // Never on screen in this tab; last so the unsaved guard still sees it.
  "detectionId",
];

/** The "From detection" tab's screen order; the locked origin block leads. */
export const DETECTION_FIELD_ORDER: readonly ComplaintField[] = [
  "detectionId",
  "complaintTypeCd",
  "otherType",
  "detail",
  "priority",
  "complaintDate",
  "villageLgdCode",
  "khasraNo",
  "district",
  "state",
  "pinCode",
  "ulpin",
  "districtLgdCode",
  "zoneCd",
  "latitude",
  "longitude",
];

/** Fields that live in the collapsed "More details" group, in both tabs. */
export const MORE_DETAIL_FIELDS: readonly ComplaintField[] = ["ulpin", "districtLgdCode"];

/** The DOM id of one field's control, so a refusal can move the focus to it. */
export function fieldId(field: ComplaintField): string {
  return `complaint-${field}`;
}

/** The first field in the tab's screen order that a refused submit should focus, if any. */
export function firstProblem(
  errors: ComplaintFormErrors,
  mode: ComplaintMode = "manual",
): ComplaintField | null {
  const order = mode === "detection" ? DETECTION_FIELD_ORDER : COMPLAINT_FIELD_ORDER;
  for (const field of order) {
    if (errors[field] !== undefined) return field;
  }
  return null;
}

/**
 * What this form reads off `parseComplaintHandoff`'s answer.
 *
 * Declared structurally rather than imported so this module stays free of the
 * `@/` alias. `ComplaintHandoff` satisfies it, and the compiler checks that at
 * the call site.
 */
export type DetectionSeed = {
  detectionRef: string;
  polygonId: string;
  areaM2: number | null;
  confidence: number | null;
  lat: number | null;
  lon: number | null;
  status: "change" | "illegal" | null;
  /** The ML worker's `change_type`, or null when the model named none. */
  changeType: string | null;
};

/** The request body, as `CaseCreate` spells it on the wire. Assignable to it. */
export type ComplaintBody = {
  source: string;
  /** Not optional in `CaseCreate`: it is declared with a default, not as absent. */
  country: string | null;
  zone_cd?: string;
  location?: { latitude: number; longitude: number };
  detection_id?: number;
  complaint_type_cd?: string;
  other_type?: string;
  detail?: string;
  complainant_name?: string;
  complainant_phone?: string;
  complainant_email?: string;
  /** Collected by the surveyor on site; never sent from this form. */
  owner_name?: string;
  owner_phone?: string;
  property_address?: string;
  landmark?: string;
  police_station?: string;
  pin_code?: string;
  district?: string;
  state?: string;
  property_type_cd?: string;
  floor_count?: number;
  ulpin?: string;
  khasra_no?: string;
  village_lgd_code?: string;
  district_lgd_code?: string;
  priority?: ComplaintPriority;
  complaint_date?: string;
  idempotency_key?: string;
};

/** Today's date in the browser's own time zone, as yyyy-mm-dd. */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${String(now.getFullYear())}-${month}-${day}`;
}

/** A real calendar date written as yyyy-mm-dd; "2026-02-30" is not one. */
export function isIsoDate(raw: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** A manual complaint: blank, source `office`, country India, priority medium, dated today. */
export function blankComplaintForm(today: string = localToday()): ComplaintFormState {
  return {
    source: "office",
    detectionId: "",
    zoneCd: "",
    latitude: "",
    longitude: "",
    complaintTypeCd: "",
    otherType: "",
    detail: "",
    complainantName: "",
    complainantPhone: "",
    complainantEmail: "",
    propertyAddress: "",
    landmark: "",
    pinCode: "",
    district: "",
    state: "",
    // `CaseCreate.country` defaults to "India"; showing it beats a blank box
    // the officer has to guess the convention for.
    country: "India",
    ulpin: "",
    khasraNo: "",
    villageLgdCode: "",
    districtLgdCode: "",
    priority: "medium",
    complaintDate: today,
  };
}

/** Six decimal places is about a tenth of a metre; more is false precision. */
function coordinate(value: number | null): string {
  return value === null ? "" : value.toFixed(6);
}

/**
 * `complaint_type_cd` for a detection that overlaps a red zone: building inside
 * one is what an encroachment is.
 */
export const RED_ZONE_TYPE_CODE = "encroachment";

/** `complaint_type_cd` suggested by each `change_type`; codes from migration 0001's seed. */
export const CHANGE_TYPE_CODES: Readonly<Record<string, string>> = {
  new_construction: "unauthorised_construction",
  extension: "deviation_from_plan",
  demolition: OTHER_TYPE_CODE,
};

/** The type a detection suggests: a red-zone overlap first, then the change type, else blank. */
export function suggestedTypeCode(seed: Pick<DetectionSeed, "status" | "changeType">): string {
  if (seed.status === "illegal") return RED_ZONE_TYPE_CODE;
  if (seed.changeType === null) return "";
  return CHANGE_TYPE_CODES[seed.changeType] ?? "";
}

/**
 * The form a detection hands over: source, polygon, point, a description and
 * the type the detection suggests.
 *
 * Only the fields the hand-off can actually fill are filled. The area, the
 * confidence and the detection's own reference have no column on `CaseCreate` —
 * they are facts about the detection, not about the case — so they are shown on
 * the screen as the case's origin and composed into `detailText` by the caller,
 * which owns the officer's language. The type is a suggestion the officer can
 * change or clear; everything else stays blank and is the officer's to enter.
 */
export function seedComplaintForm(
  seed: DetectionSeed,
  detailText: string,
  today: string = localToday(),
): ComplaintFormState {
  return {
    ...blankComplaintForm(today),
    source: "detection",
    detectionId: seed.polygonId,
    latitude: coordinate(seed.lat),
    longitude: coordinate(seed.lon),
    complaintTypeCd: suggestedTypeCode(seed),
    detail: detailText,
  };
}

/** The signed-in officer as complainant; a blank value is one the profile lacks or fails validation. */
export type OfficerContact = { name: string; phone: string; email: string };

/** Name, phone and email from the ID token's claims, each blanked unless the server would accept it. */
export function officerContact(
  profile: Readonly<Record<string, unknown>> | null | undefined,
): OfficerContact {
  const claim = (key: string): string => {
    const value = profile?.[key];
    return typeof value === "string" ? normaliseText(value) : "";
  };

  // Same claim order as the header's `profileName`, less its email local-part
  // fallback: an address fragment is not a complainant's name.
  const preferred = claim("preferred_username");
  const joined = normaliseText(`${claim("given_name")} ${claim("family_name")}`);
  const rawName =
    claim("name") || joined || (preferred.includes("@") ? "" : preferred);
  const name = placeError(rawName, false) === undefined ? rawName : "";

  const rawPhone = claim("phone_number") || claim("phoneNumber");
  const phone = rawPhone !== "" && isPhoneValid(rawPhone) ? normalisePhone(rawPhone) : "";

  const rawEmail = claim("email");
  const email = rawEmail !== "" && isEmailValid(rawEmail) ? rawEmail.toLowerCase() : "";

  return { name, phone, email };
}

/** The officer written in as complainant; a phone already typed is kept, a blank one filled. */
export function withOfficer(state: ComplaintFormState, officer: OfficerContact): ComplaintFormState {
  return {
    ...state,
    complainantName: officer.name || state.complainantName,
    complainantEmail: officer.email || state.complainantEmail,
    complainantPhone: state.complainantPhone.trim() === "" ? officer.phone : state.complainantPhone,
  };
}

/** Complainant fields shown read-only: the ones the officer's profile actually filled. */
export function lockedByProfile(officer: OfficerContact | null): ReadonlySet<ComplaintField> {
  const locked = new Set<ComplaintField>();
  if (officer?.name) locked.add("complainantName");
  if (officer?.email) locked.add("complainantEmail");
  return locked;
}

/** A `?mode=` value when it names a tab. */
export function isComplaintMode(value: string | null): value is ComplaintMode {
  return (COMPLAINT_MODES as readonly (string | null)[]).includes(value);
}

/** The tab a visit opens on: the query string's when it names one, else detection only with a hand-off. */
export function initialMode(raw: string | null, hasHandoff: boolean): ComplaintMode {
  if (isComplaintMode(raw)) return raw;
  return hasHandoff ? "detection" : "manual";
}

/**
 * The state a tab submits, derived from the one shared state.
 *
 * Both tabs edit the same state so switching loses nothing typed; what each
 * tab does not show is blanked here rather than in the state. Detection pins
 * its source and makes the officer the complainant; Manual never carries a
 * polygon id, which on any other source is a 422.
 */
export function forMode(
  state: ComplaintFormState,
  mode: ComplaintMode,
  officer: OfficerContact | null = null,
): ComplaintFormState {
  if (mode === "detection") {
    return {
      ...state,
      source: "detection",
      complainantName: officer?.name ?? "",
      complainantEmail: officer?.email ?? "",
      complainantPhone: "",
      propertyAddress: "",
      landmark: "",
    };
  }
  return {
    ...state,
    source: state.source === "detection" ? "office" : state.source,
    detectionId: "",
  };
}

/** "Lead: fact, fact." — the facts a detection has, the missing ones left out. */
export function detectionSentence(
  lead: string,
  facts: readonly (string | null)[],
  end: string,
): string {
  const known = facts.filter((fact): fact is string => fact !== null && fact !== "");
  return known.length === 0 ? `${lead}${end}` : `${lead}: ${known.join(", ")}${end}`;
}

/* ---- normalisation and field rules --------------------------------------- */

/** `normalise_text`: collapse runs of whitespace, trim the ends. */
export function normaliseText(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** `_normalise_phone_in`: digits only, less a 91 / 0 trunk prefix. */
export function normalisePhone(raw: string): string {
  let digits = raw.replace(/\D/g, "");
  if (digits.length > 10 && /^(?:91|091|0091)/.test(digits)) {
    digits = digits.slice(-10);
  } else if (digits.length === 11 && digits.startsWith("0")) {
    digits = digits.slice(1);
  }
  return digits;
}

/** `PhoneIN`: ten digits, the first one 6-9. */
export function isPhoneValid(raw: string): boolean {
  return /^[6-9]\d{9}$/.test(normalisePhone(raw));
}

/** `Email`, and the length ceiling that goes with it. */
export function isEmailValid(raw: string): boolean {
  const value = raw.trim();
  return (
    value.length <= MAX_EMAIL &&
    /^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value)
  );
}

/** `PinCode`: six digits, never a leading zero. */
export function isPinValid(raw: string): boolean {
  return /^[1-9]\d{5}$/.test(raw.trim());
}

/** `ULPIN`: the Bhu-Aadhaar, fourteen upper-case alphanumerics. */
export function isUlpinValid(raw: string): boolean {
  return /^[A-Z0-9]{14}$/.test(raw.trim().toUpperCase());
}

/** `_normalise_khasra`: no space on either side of a separator. */
export function normaliseKhasra(raw: string): string {
  return normaliseText(raw).replace(/\s*([/-])\s*/g, "$1");
}

/** `KhasraNo`: digit groups separated by `/`, with an optional `-suffix`. */
export function isKhasraValid(raw: string): boolean {
  const value = normaliseKhasra(raw);
  return value.length <= MAX_KHASRA && /^[0-9]+(\/[0-9]+)*(-[^\s/]{1,8})?$/.test(value);
}

/** `LGDCode`: up to twelve digits. */
export function isLgdValid(raw: string): boolean {
  return /^[0-9]{1,12}$/.test(raw.trim());
}

/** `_reject_markup`: the two characters that would make a stored string HTML. */
export function hasMarkup(raw: string): boolean {
  return raw.includes("<") || raw.includes(">");
}

/** A latitude or longitude as typed, or null when it is not a finite number. */
export function parseCoordinate(raw: string): number | null {
  const value = raw.trim();
  if (value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** True when the officer has started giving a point — either half of it. */
export function hasLocation(state: ComplaintFormState): boolean {
  return state.latitude.trim() !== "" || state.longitude.trim() !== "";
}

/* ---- validation ----------------------------------------------------------
   Figma 23:1343 marks eight controls with a red asterisk. Six are honoured
   verbatim; the two deviations are deliberate and are:

     - **Parcel ID is NOT required here.** `parcelId.ts` already records that a
       parcel with no land-records identity is a real case — "the building
       behind the bus stand", filed by telephone — and the register renders
       `kind: "none"` for it. A create screen that refused one would make a
       whole class of genuine complaint unfileable.
     - **Complainant name and contact are required only when a person
       complained.** A detection-sourced case has no complainant: the model
       raised it. Requiring a name there would be requiring an invented one.

   Owner name and number, property type, floors and police station are not on
   this form at all: the surveyor collects them on site. Address and landmark
   belong to the Manual tab only, so a detection case needs neither.
   ---------------------------------------------------------------------- */

// One rule for every short place name: present, inside `PlaceName`, no markup.
function placeError(raw: string, required: boolean): ComplaintFieldError | undefined {
  const value = normaliseText(raw);
  if (value === "") return required ? "required" : undefined;
  if (value.length > MAX_NAME) return "tooLong";
  if (hasMarkup(value)) return "invalid";
  return undefined;
}

/** `today` is injectable so the "not in the future" rule is testable. */
export function validateComplaintForm(
  state: ComplaintFormState,
  today: string = localToday(),
): ComplaintFormErrors {
  const errors: ComplaintFormErrors = {};
  const byDetection = state.source === "detection";

  if (!(COMPLAINT_SOURCES as readonly string[]).includes(state.source)) {
    errors.source = "required";
  }
  if (byDetection && !/^\d+$/.test(state.detectionId.trim())) {
    errors.detectionId = "invalid";
  }

  const name = placeError(state.complainantName, !byDetection);
  if (name) errors.complainantName = name;

  if (state.complainantPhone.trim() === "") {
    if (!byDetection) errors.complainantPhone = "required";
  } else if (!isPhoneValid(state.complainantPhone)) {
    errors.complainantPhone = "invalid";
  }

  if (state.complainantEmail.trim() !== "" && !isEmailValid(state.complainantEmail)) {
    errors.complainantEmail = "invalid";
  }

  // `_locatable_and_coherent`: neither is a 422 before the request is worth
  // making. A point is enough on its own — the server resolves the zone from it.
  const lat = parseCoordinate(state.latitude);
  const lon = parseCoordinate(state.longitude);
  if (hasLocation(state)) {
    if (lat === null) errors.latitude = "invalid";
    else if (lat < -90 || lat > 90) errors.latitude = "range";
    if (lon === null) errors.longitude = "invalid";
    else if (lon < -180 || lon > 180) errors.longitude = "range";
  }
  const locatable =
    lat !== null &&
    lon !== null &&
    errors.latitude === undefined &&
    errors.longitude === undefined;
  if (state.zoneCd.trim() === "" && !locatable) errors.zoneCd = "required";

  // A server rule, not a house style: `complaint_type_cd` of `other` with no
  // `other_type` is refused, and that refusal reads as a malfunction here.
  if (state.complaintTypeCd === OTHER_TYPE_CODE) {
    const other = normaliseText(state.otherType);
    if (other === "") errors.otherType = "required";
    else if (other.length > MAX_SAFE_TEXT) errors.otherType = "tooLong";
    else if (hasMarkup(other)) errors.otherType = "invalid";
  }

  const address = normaliseText(state.propertyAddress);
  if (address !== "") {
    if (address.length > MAX_SAFE_TEXT) errors.propertyAddress = "tooLong";
    else if (hasMarkup(address)) errors.propertyAddress = "invalid";
  }

  const landmark = placeError(state.landmark, !byDetection);
  if (landmark) errors.landmark = landmark;
  const district = placeError(state.district, true);
  if (district) errors.district = district;
  const region = placeError(state.state, true);
  if (region) errors.state = region;
  // Not on screen: seeded "India", so only a hand-edited state can fail it.
  const country = placeError(state.country, false);
  if (country) errors.country = country;

  if (state.pinCode.trim() !== "" && !isPinValid(state.pinCode)) {
    errors.pinCode = "invalid";
  }

  if (state.ulpin.trim() !== "" && !isUlpinValid(state.ulpin)) errors.ulpin = "invalid";
  if (state.khasraNo.trim() !== "" && !isKhasraValid(state.khasraNo)) {
    errors.khasraNo = "invalid";
  }
  if (state.villageLgdCode.trim() !== "" && !isLgdValid(state.villageLgdCode)) {
    errors.villageLgdCode = "invalid";
  }
  if (state.districtLgdCode.trim() !== "" && !isLgdValid(state.districtLgdCode)) {
    errors.districtLgdCode = "invalid";
  }

  const detail = state.detail.trim();
  if (detail === "") errors.detail = "required";
  else if (detail.length > MAX_LONG_TEXT) errors.detail = "tooLong";
  else if (hasMarkup(detail)) errors.detail = "invalid";

  if (
    state.priority !== "" &&
    !(COMPLAINT_PRIORITIES as readonly string[]).includes(state.priority)
  ) {
    errors.priority = "invalid";
  }

  // ISO strings compare correctly as strings, so no Date arithmetic is needed.
  const dated = state.complaintDate.trim();
  if (dated !== "") {
    if (!isIsoDate(dated)) errors.complaintDate = "invalid";
    else if (dated > today) errors.complaintDate = "future";
  }

  return errors;
}

/** The fields `validateComplaintForm` would call "required" for this state. */
export function requiredFields(state: ComplaintFormState): ReadonlySet<ComplaintField> {
  const required = new Set<ComplaintField>(["source", "district", "state", "detail"]);
  if (state.source !== "detection") {
    required.add("complainantName");
    required.add("complainantPhone");
    required.add("landmark");
  }
  if (state.complaintTypeCd === OTHER_TYPE_CODE) required.add("otherType");
  return required;
}

export function hasErrors(errors: ComplaintFormErrors): boolean {
  return Object.values(errors).some((value) => value !== undefined);
}

/* ---- the body ------------------------------------------------------------ */

// Blank is ABSENT on a create: an omitted optional field takes the model's own
// default, where an explicit null would overwrite that default with nothing.
function textOrOmit(raw: string): string | undefined {
  const value = normaliseText(raw);
  return value === "" ? undefined : value;
}

/**
 * The request body. `key` is the caller's, minted once per submit attempt.
 *
 * Passing the key in is what makes a retry a replay rather than a second
 * complaint, so it is a parameter here instead of being generated inside: a
 * body rebuilt with a fresh key on every attempt would file the case twice.
 */
export function toComplaintBody(state: ComplaintFormState, key: string): ComplaintBody {
  const lat = parseCoordinate(state.latitude);
  const lon = parseCoordinate(state.longitude);
  const byDetection = state.source === "detection";
  const detectionId = Number(state.detectionId.trim());

  const body: ComplaintBody = {
    source: state.source,
    country: textOrOmit(state.country) ?? "India",
    idempotency_key: key,
  };

  if (state.zoneCd.trim() !== "") body.zone_cd = state.zoneCd.trim();
  if (lat !== null && lon !== null) body.location = { latitude: lat, longitude: lon };
  // `detection_id` on a non-detection source is a 422, so the id travels with
  // the source that gives it meaning and with no other.
  if (byDetection && Number.isInteger(detectionId)) body.detection_id = detectionId;

  if (state.complaintTypeCd !== "") body.complaint_type_cd = state.complaintTypeCd;
  if (state.complaintTypeCd === OTHER_TYPE_CODE) {
    body.other_type = textOrOmit(state.otherType);
  }
  body.detail = textOrOmit(state.detail);

  body.complainant_name = textOrOmit(state.complainantName);
  if (state.complainantPhone.trim() !== "") {
    body.complainant_phone = normalisePhone(state.complainantPhone);
  }
  if (state.complainantEmail.trim() !== "") {
    body.complainant_email = state.complainantEmail.trim().toLowerCase();
  }

  body.property_address = textOrOmit(state.propertyAddress);
  body.landmark = textOrOmit(state.landmark);
  if (state.pinCode.trim() !== "") body.pin_code = state.pinCode.trim();
  body.district = textOrOmit(state.district);
  body.state = textOrOmit(state.state);

  if (state.ulpin.trim() !== "") body.ulpin = state.ulpin.trim().toUpperCase();
  if (state.khasraNo.trim() !== "") body.khasra_no = normaliseKhasra(state.khasraNo);
  if (state.villageLgdCode.trim() !== "") {
    body.village_lgd_code = state.villageLgdCode.trim();
  }
  if (state.districtLgdCode.trim() !== "") {
    body.district_lgd_code = state.districtLgdCode.trim();
  }

  if ((COMPLAINT_PRIORITIES as readonly string[]).includes(state.priority)) {
    body.priority = state.priority as ComplaintPriority;
  }

  if (isIsoDate(state.complaintDate.trim())) body.complaint_date = state.complaintDate.trim();

  return body;
}

/* ---- the unsaved guard --------------------------------------------------- */

// Field order is fixed by the type, so a plain join is a stable signature and
// two states compare in one string comparison.
function signature(state: ComplaintFormState): string {
  return COMPLAINT_FIELD_ORDER.map((field) => state[field]).join("\u001f");
}

/** Whether anything has been typed since the form was seeded. */
export function isDirty(
  baseline: ComplaintFormState,
  state: ComplaintFormState,
): boolean {
  return signature(baseline) !== signature(state);
}

/**
 * Changing the source away from `detection` drops the polygon id with it.
 *
 * The pair is validated together server-side, so the two move together here
 * rather than leaving an orphan id behind for the 422 to find.
 */
export function setSource(state: ComplaintFormState, source: string): ComplaintFormState {
  if (source === state.source) return state;
  return {
    ...state,
    source,
    detectionId: source === "detection" ? state.detectionId : "",
  };
}
