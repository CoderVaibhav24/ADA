/**
 * The Notice Create form as data: the state, the validation and the body.
 *
 * No React and no VALUE import in this file, deliberately: `npm test` runs
 * `node --test` over `src/**` with type stripping and no bundler, so the rules
 * that decide whether a notice may be issued are testable without a DOM. The
 * component above it renders this and nothing else decides.
 *
 * Three properties of `POST /cases/{case_ref}/notices` shape all of it —
 * `docs/icms/batch-6-contract.md`:
 *
 *   - **`act_cd` and `section_cds` are required and everything else is not.**
 *     The act and the sections are what make the document a legal instrument;
 *     the server fills its own default compliance period and its own issuing
 *     authority when neither is sent, so an empty box must be OMITTED from the
 *     body rather than sent as `""`, which would overwrite a configured default
 *     with a blank.
 *   - **a section belongs to an act.** `icms_code_value.parent_code` ties each
 *     section row to its act, so changing the act invalidates every section
 *     already ticked. `setAct` clears them rather than leaving a section of the
 *     1973 Act attached to a different one.
 *   - **`compliance_due` is a DATE the notice is measured against.** A date in
 *     the past is refused here, because a notice whose compliance period has
 *     already expired at the moment of issue is not a thing an officer means to
 *     create, and the server has no way to tell that from a deliberate
 *     back-dating.
 *
 * The string limits mirrored below are `ada_core/validation.py`. They are
 * duplicated here so the officer is told in their own language before the round
 * trip; the server validates them again regardless, and its refusal is what the
 * screen renders when the two ever disagree.
 */

import type { NoticeCreate } from "@/api/icms/notices";

/** `SafeLongText`, which the grounds paragraph is. */
export const MAX_LONG_TEXT = 5000;
/** `SafeText`, which the issuing authority line is. */
export const MAX_SAFE_TEXT = 500;
/** `icms_notice.section_cds` is a text[]; nothing sane cites more than this. */
export const MAX_SECTIONS = 20;

export type NoticeFormState = {
  /** The CONFIRMED case the notice is issued against. Part of the path, not the body. */
  caseRef: string;
  actCd: string;
  sectionCds: readonly string[];
  /** `YYYY-MM-DD`, or `""` for "use the server's configured period". */
  complianceDue: string;
  issuingAuthority: string;
  /** Figma's "Reason / Grounds for Notice". Rides in `body_overrides`. */
  grounds: string;
};

export type NoticeField = keyof NoticeFormState;

export type NoticeFormErrors = Partial<Record<NoticeField, string>>;

/** A problem code, not a sentence: the screen owns the words in two languages. */
export const NOTICE_PROBLEMS = {
  caseRequired: "caseRequired",
  actRequired: "actRequired",
  sectionsRequired: "sectionsRequired",
  tooManySections: "tooManySections",
  dueMalformed: "dueMalformed",
  duePast: "duePast",
  authorityTooLong: "authorityTooLong",
  groundsTooLong: "groundsTooLong",
} as const;

export type NoticeProblem = (typeof NOTICE_PROBLEMS)[keyof typeof NOTICE_PROBLEMS];

/** An empty form, optionally already pointed at a case arrived at by a link. */
export function blankNoticeForm(caseRef = ""): NoticeFormState {
  return {
    caseRef,
    actCd: "",
    sectionCds: [],
    complianceDue: "",
    issuingAuthority: "",
    grounds: "",
  };
}

/** Changing the act drops the sections: a section belongs to exactly one act. */
export function setAct(state: NoticeFormState, actCd: string): NoticeFormState {
  if (state.actCd === actCd) return state;
  return { ...state, actCd, sectionCds: [] };
}

/** Ticking and unticking one section. Order is the vocabulary's, not the clicks'. */
export function toggleSection(
  state: NoticeFormState,
  sectionCd: string,
  order: readonly string[],
): NoticeFormState {
  const held = new Set(state.sectionCds);
  if (held.has(sectionCd)) held.delete(sectionCd);
  else held.add(sectionCd);
  const next = order.filter((code) => held.has(code));
  // A code the vocabulary no longer offers is kept rather than silently
  // dropped: it arrived from somewhere, and losing it without saying so would
  // change what the notice cites behind the officer's back.
  for (const code of state.sectionCds) {
    if (!order.includes(code) && held.has(code)) next.push(code);
  }
  return { ...state, sectionCds: next };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every problem the form can see, keyed by field.
 *
 * `todayIsoDate` is passed in rather than read from the clock so the rule is
 * testable and so the comparison happens on the IST calendar day the rest of
 * the portal uses — see `toIstDateKey`.
 */
export function validateNoticeForm(
  state: NoticeFormState,
  todayIsoDate: string,
): NoticeFormErrors {
  const errors: NoticeFormErrors = {};

  if (state.caseRef.trim() === "") errors.caseRef = NOTICE_PROBLEMS.caseRequired;
  if (state.actCd.trim() === "") errors.actCd = NOTICE_PROBLEMS.actRequired;

  if (state.sectionCds.length === 0) {
    errors.sectionCds = NOTICE_PROBLEMS.sectionsRequired;
  } else if (state.sectionCds.length > MAX_SECTIONS) {
    errors.sectionCds = NOTICE_PROBLEMS.tooManySections;
  }

  const due = state.complianceDue.trim();
  if (due !== "") {
    if (!ISO_DATE.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`))) {
      errors.complianceDue = NOTICE_PROBLEMS.dueMalformed;
    } else if (due < todayIsoDate) {
      errors.complianceDue = NOTICE_PROBLEMS.duePast;
    }
  }

  if (state.issuingAuthority.length > MAX_SAFE_TEXT) {
    errors.issuingAuthority = NOTICE_PROBLEMS.authorityTooLong;
  }
  if (state.grounds.length > MAX_LONG_TEXT) {
    errors.grounds = NOTICE_PROBLEMS.groundsTooLong;
  }

  return errors;
}

export function hasErrors(errors: NoticeFormErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** The first field in FORM order that is wrong, so focus lands where reading starts. */
export function firstProblem(errors: NoticeFormErrors): NoticeField | null {
  const order: readonly NoticeField[] = [
    "caseRef",
    "actCd",
    "sectionCds",
    "complianceDue",
    "issuingAuthority",
    "grounds",
  ];
  return order.find((field) => errors[field] !== undefined) ?? null;
}

/** Whether anything has been typed. Drives the "discard?" prompt, nothing else. */
export function isDirty(state: NoticeFormState, initial: NoticeFormState): boolean {
  return (
    state.caseRef !== initial.caseRef ||
    state.actCd !== initial.actCd ||
    state.sectionCds.join(",") !== initial.sectionCds.join(",") ||
    state.complianceDue !== initial.complianceDue ||
    state.issuingAuthority !== initial.issuingAuthority ||
    state.grounds !== initial.grounds
  );
}

/** A stable DOM id per field, shared by the label, the input and its error. */
export function fieldId(field: NoticeField): string {
  return `notice-${field}`;
}

/**
 * The request body.
 *
 * An optional field the officer left empty is OMITTED, never sent as `""` or
 * `null`: the server applies its configured default only when the key is
 * absent, so a blank string would replace a real default with nothing. The
 * grounds paragraph is the single `body_overrides` key this portal writes, and
 * `groundsKey` is passed in from `GROUNDS_KEY` rather than spelled here so one
 * module owns the spelling.
 */
export function toNoticeBody(state: NoticeFormState, groundsKey: string): NoticeCreate {
  const body: NoticeCreate = {
    act_cd: state.actCd.trim(),
    section_cds: [...state.sectionCds],
  };

  const due = state.complianceDue.trim();
  if (due !== "") body.compliance_due = due;

  const authority = state.issuingAuthority.trim();
  if (authority !== "") body.issuing_authority = authority;

  const grounds = state.grounds.trim();
  if (grounds !== "") body.body_overrides = { [groundsKey]: grounds };

  return body;
}
