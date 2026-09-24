/**
 * The findings form as data: the state, the edits, the validation and the body.
 *
 * No React and no `@/` import in this file, deliberately: `npm test` runs
 * `node --test` over `src/**` with type stripping and no bundler, so the rules
 * that decide whether a round may be saved are testable without a DOM. The
 * component above it renders this and nothing else decides.
 *
 * Three properties of `PUT /inspections/{ref}/findings` shape all of it —
 * `docs/icms/batch-3-contract.md` §3 and `FindingsPut` in
 * `services/api/app/icms/inspection_schemas.py`:
 *
 *   - **`findings` replaces the round's list and `min_length=1` makes an empty
 *     list a 422.** A save with nothing written is therefore refused here, with
 *     the reason said out loud, rather than sent and bounced. `max_length=50`
 *     is the other end of the same constraint.
 *   - **`sections` is `null` for "leave them alone" and `[]` for "clear
 *     them".** The form omits it until the officer touches the picker, then
 *     sends only the pairs under the notice's act. The server sorts and
 *     de-duplicates the pairs it stores, so the form keeps them sorted and
 *     unique too — otherwise a save would silently reorder the screen.
 *   - **every other column is applied only when the body carries it**
 *     (`model_fields_set`), so a field the officer emptied is sent as an
 *     explicit `null` to clear it, never omitted.
 *
 * The string constraints mirrored below are `ada_core/validation.py`. They are
 * duplicated here so the officer is told in their own language before the round
 * trip; the server validates them again regardless, and its refusal is what the
 * screen renders when the two ever disagree.
 */

/** `FindingsPut.findings`, `min_length=1, max_length=50`. */
export const MAX_FINDINGS = 50;
export const MAX_SECTIONS = 50;
/** `SafeLongText`, which both a finding and the officer's note are. */
export const MAX_LONG_TEXT = 5000;
/** `Name`. */
export const MAX_NAME = 200;
/** `measured_area_sqm: ge=0, le=10_000_000`. */
export const MAX_AREA_SQM = 10_000_000;
/** `length_m` / `width_m`: `gt=0, le=MAX_SIDE_M`. */
export const MAX_SIDE_M = 10_000;

export type FindingDraft = {
  /** Stable across a reorder. An array index as a React key loses focus. */
  id: string;
  text: string;
};

export type SectionDraft = { actCd: string; sectionCd: string };

export type FindingsFormState = {
  findings: readonly FindingDraft[];
  sections: readonly SectionDraft[];
  /** False until the picker is used; an untouched list is omitted from the body. */
  sectionsTouched: boolean;
  occupantName: string;
  occupantPhone: string;
  ownerName: string;
  ownerPhone: string;
  areaTypeCd: string;
  constructionStageCd: string;
  /** Text as typed, not a number: "12." and "" are states a number cannot hold. */
  measuredArea: string;
  lengthM: string;
  widthM: string;
  noticeRequired: boolean;
  noticeActCd: string;
  officerNote: string;
};

/**
 * What this form reads off `InspectionDetail`.
 *
 * Declared structurally rather than imported so this module stays free of the
 * `@/` alias. `InspectionDetail` satisfies it, and the compiler checks that at
 * every call site.
 */
export type FindingsSource = {
  findings?: readonly { seq: number; finding: string }[];
  sections?: readonly { act_cd: string; section_cd: string }[];
  occupant_name?: string | null;
  occupant_phone?: string | null;
  owner_name?: string | null;
  owner_phone?: string | null;
  area_type_cd?: string | null;
  construction_stage_cd?: string | null;
  measured_area_sqm?: number | null;
  length_m?: number | null;
  width_m?: number | null;
  notice_required?: boolean | null;
  notice_act_cd?: string | null;
  officer_note?: string | null;
};

/** The request body, as `FindingsPut` spells it on the wire. */
export type FindingsBody = {
  findings: string[];
  sections?: { act_cd: string; section_cd: string }[];
  occupant_name: string | null;
  occupant_phone: string | null;
  owner_name: string | null;
  owner_phone: string | null;
  area_type_cd: string | null;
  construction_stage_cd: string | null;
  measured_area_sqm: number | null;
  length_m: number | null;
  width_m: number | null;
  notice_required: boolean;
  notice_act_cd: string | null;
  officer_note: string | null;
};

export type FindingsFormErrors = {
  findings?: "required" | "tooMany";
  phone?: "invalid";
  ownerPhone?: "invalid";
  area?: "invalid";
  length?: "invalid";
  width?: "invalid";
};

let sequence = 0;

// Module-scoped rather than crypto: this id never leaves the browser, and a
// counter is what makes the reorder tests deterministic.
function nextId(): string {
  sequence += 1;
  return `fd${String(sequence)}`;
}

export function newFindingDraft(text = ""): FindingDraft {
  return { id: nextId(), text };
}

// (act, section) ascending — the order the server stores them in.
function sortSections(sections: readonly SectionDraft[]): SectionDraft[] {
  return [...sections].sort((a, b) =>
    a.actCd === b.actCd
      ? a.sectionCd.localeCompare(b.sectionCd)
      : a.actCd.localeCompare(b.actCd),
  );
}

/** The server's state, as the form holds it. One round trip's starting point. */
export function findingsFormFrom(source: FindingsSource): FindingsFormState {
  const findings = [...(source.findings ?? [])]
    .sort((a, b) => a.seq - b.seq)
    .map((item) => newFindingDraft(item.finding));

  return {
    // One empty row on a round with nothing recorded, so the first thing on
    // screen is a place to write rather than a button that makes one.
    findings: findings.length > 0 ? findings : [newFindingDraft()],
    sections: sortSections(
      (source.sections ?? []).map((item) => ({ actCd: item.act_cd, sectionCd: item.section_cd })),
    ),
    sectionsTouched: false,
    occupantName: source.occupant_name ?? "",
    occupantPhone: source.occupant_phone ?? "",
    ownerName: source.owner_name ?? "",
    ownerPhone: source.owner_phone ?? "",
    areaTypeCd: source.area_type_cd ?? "",
    constructionStageCd: source.construction_stage_cd ?? "",
    measuredArea:
      source.measured_area_sqm == null ? "" : String(source.measured_area_sqm),
    lengthM: source.length_m == null ? "" : String(source.length_m),
    widthM: source.width_m == null ? "" : String(source.width_m),
    noticeRequired: source.notice_required ?? false,
    noticeActCd: source.notice_act_cd ?? "",
    officerNote: source.officer_note ?? "",
  };
}

export function addFinding(state: FindingsFormState): FindingsFormState {
  if (state.findings.length >= MAX_FINDINGS) return state;
  return { ...state, findings: [...state.findings, newFindingDraft()] };
}

export function setFindingText(
  state: FindingsFormState,
  id: string,
  text: string,
): FindingsFormState {
  return {
    ...state,
    findings: state.findings.map((item) =>
      item.id === id ? { ...item, text: text.slice(0, MAX_LONG_TEXT) } : item,
    ),
  };
}

/** Removing the last row leaves one empty row, never a list with no editor. */
export function removeFinding(state: FindingsFormState, id: string): FindingsFormState {
  const kept = state.findings.filter((item) => item.id !== id);
  return { ...state, findings: kept.length > 0 ? kept : [newFindingDraft()] };
}

/** `delta` of -1 or 1. Out of range is a no-op, so the ends are not special-cased. */
export function moveFinding(
  state: FindingsFormState,
  id: string,
  delta: number,
): FindingsFormState {
  const from = state.findings.findIndex((item) => item.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= state.findings.length) return state;

  const findings = [...state.findings];
  const [moved] = findings.splice(from, 1);
  findings.splice(to, 0, moved);
  return { ...state, findings };
}

export function hasSection(
  state: FindingsFormState,
  actCd: string,
  sectionCd: string,
): boolean {
  return state.sections.some(
    (item) => item.actCd === actCd && item.sectionCd === sectionCd,
  );
}

/** De-duplicating and re-sorting, because that is what the server will store. */
export function addSection(
  state: FindingsFormState,
  actCd: string,
  sectionCd: string,
): FindingsFormState {
  if (hasSection(state, actCd, sectionCd)) return state;
  if (state.sections.length >= MAX_SECTIONS) return state;
  return {
    ...state,
    sections: sortSections([...state.sections, { actCd, sectionCd }]),
    sectionsTouched: true,
  };
}

export function removeSection(
  state: FindingsFormState,
  actCd: string,
  sectionCd: string,
): FindingsFormState {
  return {
    ...state,
    sections: state.sections.filter(
      (item) => !(item.actCd === actCd && item.sectionCd === sectionCd),
    ),
    sectionsTouched: true,
  };
}

/** Sections outside the new act are dropped: citations belong to the notice's act. */
export function setNoticeAct(state: FindingsFormState, actCd: string): FindingsFormState {
  const kept = state.sections.filter((item) => item.actCd === actCd);
  return {
    ...state,
    noticeActCd: actCd,
    sections: kept,
    sectionsTouched: state.sectionsTouched || kept.length !== state.sections.length,
  };
}

/** No notice means no act and no sections; the server refuses an act without one. */
export function setNoticeRequired(
  state: FindingsFormState,
  required: boolean,
): FindingsFormState {
  if (required) return { ...state, noticeRequired: true };
  return {
    ...state,
    noticeRequired: false,
    noticeActCd: "",
    sections: [],
    sectionsTouched: state.sectionsTouched || state.sections.length > 0,
  };
}

/**
 * `_normalise_phone_in` from `ada_core/validation.py`, in the browser.
 *
 * Mirrored rather than approximated: the officer is told "ten digits" before
 * the round trip only if the client and the server agree on what ten means.
 */
export function normalisePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.length > 10 && /^(?:0091|091|91)/.test(digits)) return digits.slice(-10);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

/** `PhoneIN`: ten digits, 6-9 first. Blank passes — the field is optional. */
export function isPhoneValid(raw: string): boolean {
  if (raw.trim() === "") return true;
  return /^[6-9]\d{9}$/.test(normalisePhone(raw));
}

/** Square metres as a number, or `null` for an empty field and for nonsense. */
export function parseArea(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > MAX_AREA_SQM) return null;
  return value;
}

export function isAreaValid(raw: string): boolean {
  return raw.trim() === "" || parseArea(raw) !== null;
}

/** Metres as a number, or `null` for an empty field and for nonsense. */
export function parseSide(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_SIDE_M) return null;
  return value;
}

export function isSideValid(raw: string): boolean {
  return raw.trim() === "" || parseSide(raw) !== null;
}

/** length × width in m², rounded as the server rounds it, or `null` unless both are valid. */
export function sideArea(state: FindingsFormState): number | null {
  const length = parseSide(state.lengthM);
  const width = parseSide(state.widthM);
  if (length === null || width === null) return null;
  return Math.round(length * width * 100) / 100;
}

/** The findings actually written down. A blank row is not an observation. */
export function writtenFindings(state: FindingsFormState): string[] {
  return state.findings.map((item) => item.text.trim()).filter((text) => text !== "");
}

/**
 * Everything that would make the server refuse, decided before the request.
 *
 * Returns codes, not sentences: this module holds no English, and the screen
 * looks each code up in `inspectionFindings.*`.
 */
export function validateFindingsForm(state: FindingsFormState): FindingsFormErrors {
  const errors: FindingsFormErrors = {};
  const written = writtenFindings(state);

  if (written.length === 0) errors.findings = "required";
  else if (written.length > MAX_FINDINGS) errors.findings = "tooMany";

  if (!isPhoneValid(state.occupantPhone)) errors.phone = "invalid";
  if (!isPhoneValid(state.ownerPhone)) errors.ownerPhone = "invalid";
  if (!isAreaValid(state.measuredArea)) errors.area = "invalid";
  if (!isSideValid(state.lengthM)) errors.length = "invalid";
  if (!isSideValid(state.widthM)) errors.width = "invalid";

  return errors;
}

export function hasErrors(errors: FindingsFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

// An emptied field is "" on screen and must be null on the wire.
function blankToNull(value: string): string | null {
  return value === "" ? null : value;
}

/**
 * The body, with a cleared field as an explicit `null`.
 *
 * `observations()` server-side applies only the keys the JSON carried, so
 * omitting an emptied field would leave yesterday's occupant name in the row.
 */
export function toFindingsBody(state: FindingsFormState): FindingsBody {
  const body: FindingsBody = {
    findings: writtenFindings(state),
    occupant_name: blankToNull(state.occupantName.trim()),
    occupant_phone: blankToNull(normalisePhone(state.occupantPhone)),
    owner_name: blankToNull(state.ownerName.trim()),
    owner_phone: blankToNull(normalisePhone(state.ownerPhone)),
    area_type_cd: blankToNull(state.areaTypeCd),
    construction_stage_cd: blankToNull(state.constructionStageCd),
    measured_area_sqm: parseArea(state.measuredArea),
    length_m: parseSide(state.lengthM),
    width_m: parseSide(state.widthM),
    notice_required: state.noticeRequired,
    // A notice that is not required cites no act, whatever the select last held.
    notice_act_cd: state.noticeRequired ? blankToNull(state.noticeActCd) : null,
    officer_note: blankToNull(state.officerNote.trim()),
  };
  if (state.sectionsTouched) body.sections = citedSections(state);
  return body;
}

// Only the pairs under the notice's act; none at all without a notice.
function citedSections(state: FindingsFormState): { act_cd: string; section_cd: string }[] {
  if (!state.noticeRequired || state.noticeActCd === "") return [];
  return state.sections
    .filter((item) => item.actCd === state.noticeActCd)
    .map((item) => ({ act_cd: item.actCd, section_cd: item.sectionCd }));
}

// Draft ids are per-session and must not count as a change; the text and its
// order are the whole of what a save sends.
function signature(state: FindingsFormState): string {
  return JSON.stringify([
    writtenFindings(state),
    state.sections.map((item) => [item.actCd, item.sectionCd]),
    state.occupantName.trim(),
    normalisePhone(state.occupantPhone),
    state.ownerName.trim(),
    normalisePhone(state.ownerPhone),
    state.areaTypeCd,
    state.constructionStageCd,
    parseArea(state.measuredArea),
    parseSide(state.lengthM),
    parseSide(state.widthM),
    state.noticeRequired,
    state.noticeRequired ? state.noticeActCd : "",
    state.officerNote.trim(),
  ]);
}

/** Whether anything on screen would change the record if it were saved. */
export function isDirty(
  baseline: FindingsFormState,
  current: FindingsFormState,
): boolean {
  return signature(baseline) !== signature(current);
}
