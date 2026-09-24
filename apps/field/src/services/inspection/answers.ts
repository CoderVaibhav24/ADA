import type { FindingsPut, InspectionDetail } from '@/services/api/types';
import { en, translate, type MessageKey, type PlainKey } from '@/services/i18n';

/*
 * The structured answers of steps 3 and 4, and the rules between them — the same
 * R1–R6 the server runs (`services/api/app/icms/inspection_rules.py`), so the form
 * refuses what the server would refuse, with the reason in the surveyor's words.
 *
 * Pure functions over the stored text of each field. Nothing here reads storage
 * or the network; `findings.ts` does that.
 */
export const ENCROACHMENT_CODES = ['yes', 'partial', 'no_false_positive'] as const;
export const SUPPORT_CODES = ['none', 'police', 'survey_dept', 'legal'] as const;
export const RECOMMENDATION_CODES = [
  'issue_notice',
  'file_legal_case',
  'demolition_order',
  'further_investigation',
  'no_action_required',
  'impose_fine',
] as const;
// The six active `area_type` codes (migration 0011); the server's list wins when it is loaded.
export const AREA_TYPE_CODES = [
  'rcc',
  'semi_permanent',
  'shed_hutment',
  'agricultural',
  'land_levelling',
  'fencing',
] as const;
// The six `construction_stage` codes as seeded; the server's list wins when loaded.
export const CONSTRUCTION_STAGE_CODES = [
  'foundation_plinth',
  'under_construction',
  'structure_complete',
  'finishing',
  'completed_occupied',
  'completed_vacant',
] as const;
// The `property_type` codes the complaint form offered (migration 0001); the server's list wins when loaded.
export const PROPERTY_TYPE_CODES = ['residential', 'commercial', 'industrial', 'institutional', 'vacant_land'] as const;
// The `act` and `section` codes of migration 0006, each section under its act; the server's lists win when loaded.
export const ACT_CODES = ['up_upda_1973'] as const;
export const SECTION_CODES = ['sec_14', 'sec_26', 'sec_27', 'sec_28', 'sec_28a'] as const;
export const SECTION_PARENT: Readonly<Record<string, string>> = {
  sec_14: 'up_upda_1973',
  sec_26: 'up_upda_1973',
  sec_27: 'up_upda_1973',
  sec_28: 'up_upda_1973',
  sec_28a: 'up_upda_1973',
};
// The stored text of the yes/no notice answer (legacy is__notice_required).
export const NOTICE_CODES = ['yes', 'no'] as const;

export type Encroachment = (typeof ENCROACHMENT_CODES)[number];
export type Support = (typeof SUPPORT_CODES)[number];
export type Recommendation = (typeof RECOMMENDATION_CODES)[number];

export const NO_ACTION: Recommendation = 'no_action_required';
export const PARTIAL_DEFAULT: Recommendation = 'further_investigation';
const NOTICE_RECOMMENDATIONS: readonly Recommendation[] = ['issue_notice', 'demolition_order', 'impose_fine'];

// Form order on step 3, then step 4's recommendation and notice (docs/icms/inspection-findings-fields.md).
export const ANSWER_FIELDS = [
  'encroachment_confirmed_cd',
  'area_sqft',
  'length_ft',
  'width_ft',
  'area_type_cd',
  'construction_stage_cd',
  'external_support_cd',
  'occupant_name',
  'occupant_phone',
  'owner_name',
  'owner_phone',
  'property_type_cd',
  'floor_count',
  'police_station',
  'officer_note',
  'recommendation_cd',
  'notice_required',
  'notice_act_cd',
  'section_cds',
] as const;
export type AnswerField = (typeof ANSWER_FIELDS)[number];
// The fields step 4 asks for; the step-3 gate ignores them.
export const REVIEW_FIELDS: readonly AnswerField[] = ['recommendation_cd', 'notice_required', 'notice_act_cd', 'section_cds'];
export type Answers = Record<AnswerField, string>;
export type AnswerErrors = Partial<Record<AnswerField, PlainKey>>;

// Which step asks for a field; the step-3 gate ignores the recommendation.
export type AnswerStage = 'findings' | 'review';

export const SQFT_TO_SQM = 0.09290304;
export const MIN_AREA_SQM = 0.01;
export const FT_TO_M = 0.3048;
export const MAX_SIDE_M = 10_000;
export const AREA_MISMATCH = 0.1;
export const MAX_AREA_SQM = 10_000_000;
export const MAX_NAME = 200;
export const MAX_NOTE = 5000;
export const PHONE_DIGITS = 10;
export const MAX_FLOORS = 200;
export const MAX_PLACE = 200;
const PHONE_IN = /^[6-9]\d{9}$/;

export const EMPTY_ANSWERS: Answers = {
  encroachment_confirmed_cd: '',
  area_sqft: '',
  length_ft: '',
  width_ft: '',
  area_type_cd: '',
  construction_stage_cd: '',
  external_support_cd: '',
  occupant_name: '',
  occupant_phone: '',
  owner_name: '',
  owner_phone: '',
  property_type_cd: '',
  floor_count: '',
  police_station: '',
  officer_note: '',
  recommendation_cd: '',
  notice_required: '',
  notice_act_cd: '',
  section_cds: '',
};

// Narrows stored text to one of a closed code list.
function oneOf<T extends string>(codes: readonly T[], value: string): T | null {
  return (codes as readonly string[]).includes(value) ? (value as T) : null;
}

export function encroachmentOf(values: Answers): Encroachment | null {
  return oneOf(ENCROACHMENT_CODES, values.encroachment_confirmed_cd);
}

// Yes or partial: area, type, support and an enforcement recommendation are owed (R2).
export function isEnforcement(values: Answers): boolean {
  const answer = encroachmentOf(values);
  return answer === 'yes' || answer === 'partial';
}

const HIDDEN_ON_FALSE_POSITIVE: readonly AnswerField[] = [
  'area_sqft',
  'length_ft',
  'width_ft',
  'area_type_cd',
  'construction_stage_cd',
  'external_support_cd',
];

// R1: a false positive hides the area, its sides, the type, the stage and the support question; R7: no notice hides the act and sections.
export function isHidden(field: AnswerField, values: Answers): boolean {
  if (field === 'notice_act_cd' || field === 'section_cds') return noticeAnswer(values) !== true;
  if (encroachmentOf(values) !== 'no_false_positive') return false;
  return HIDDEN_ON_FALSE_POSITIVE.includes(field);
}

// The recommendations on offer for an answer: only "no action" for a false positive, never for yes/partial.
export function recommendationChoices(values: Answers): readonly Recommendation[] {
  const answer = encroachmentOf(values);
  if (answer === 'no_false_positive') return [NO_ACTION];
  return RECOMMENDATION_CODES.filter((code) => code !== NO_ACTION);
}

// True when the recommendation is fixed by the answer and not the surveyor's to choose.
export function recommendationFixed(values: Answers): boolean {
  return encroachmentOf(values) === 'no_false_positive';
}

/*
 * What else changes when the encroachment answer changes: a false positive fixes
 * the recommendation (R1), partial suggests further investigation (R3, still
 * editable), and yes/partial may not keep "no action".
 */
export function encroachmentPatch(values: Answers, next: string): Partial<Answers> {
  const patch: Partial<Answers> = { encroachment_confirmed_cd: next };
  const current = values.recommendation_cd;
  if (next === 'no_false_positive') {
    patch.recommendation_cd = NO_ACTION;
  } else if (next === 'partial') {
    if (current === '' || current === NO_ACTION) patch.recommendation_cd = PARTIAL_DEFAULT;
  } else if (next === 'yes' && current === NO_ACTION) {
    patch.recommendation_cd = '';
  }
  return patch;
}

// notice_required as the server derives it from the recommendation; null leaves it unset.
export function noticeRequired(recommendation: string): boolean | null {
  if (recommendation === NO_ACTION) return false;
  const code = oneOf(RECOMMENDATION_CODES, recommendation);
  if (code === null) return null;
  return NOTICE_RECOMMENDATIONS.includes(code) ? true : null;
}

// True when the recommendation decides the notice, so the surveyor is not asked.
export function noticeFixed(values: Answers): boolean {
  return noticeRequired(values.recommendation_cd) !== null;
}

// The notice answer in force: the recommendation's when it decides, else the surveyor's yes/no.
export function noticeAnswer(values: Answers): boolean | null {
  const derived = noticeRequired(values.recommendation_cd);
  if (derived !== null) return derived;
  if (values.notice_required === 'yes') return true;
  if (values.notice_required === 'no') return false;
  return null;
}

// The cited section codes, stored as one comma-separated text.
export function sectionsOf(values: Answers): string[] {
  return values.section_cds
    .split(',')
    .map((code) => code.trim())
    .filter((code) => code !== '');
}

// Adds or removes one section code, keeping the stored order stable.
export function toggleSection(values: Answers, code: string): string {
  const current = sectionsOf(values);
  const next = current.includes(code) ? current.filter((item) => item !== code) : [...current, code].sort();
  return next.join(',');
}

export type AreaParse =
  | { readonly ok: true; readonly sqft: number; readonly sqm: number }
  | { readonly ok: false; readonly error: 'empty' | 'notNumber' | 'decimals' | 'notPositive' | 'tooSmall' | 'tooLarge' };

// Square feet as typed: digits with one "." or "," as the decimal mark, at most 2 decimals.
export function parseArea(raw: string): AreaParse {
  const text = raw.replace(/\s+/g, '');
  if (text === '') return { ok: false, error: 'empty' };
  if (!/^\d*([.,]\d*)?$/.test(text) || !/\d/.test(text)) return { ok: false, error: 'notNumber' };
  const normal = text.replace(',', '.');
  const decimals = normal.includes('.') ? normal.split('.')[1].length : 0;
  if (decimals > 2) return { ok: false, error: 'decimals' };
  const sqft = Number(normal);
  if (!Number.isFinite(sqft)) return { ok: false, error: 'notNumber' };
  if (sqft <= 0) return { ok: false, error: 'notPositive' };
  const sqm = sqft * SQFT_TO_SQM;
  if (sqm < MIN_AREA_SQM) return { ok: false, error: 'tooSmall' };
  if (sqm > MAX_AREA_SQM) return { ok: false, error: 'tooLarge' };
  return { ok: true, sqft, sqm };
}

// The value sent as measured_area_sqm: 4 decimals keeps 0.01 m² honest without float noise.
export function roundSqm(sqm: number): number {
  return Math.round(sqm * 10_000) / 10_000;
}

// Square metres the server holds, back into the square feet the form shows.
export function sqmToSqft(sqm: number): number {
  return Math.round((sqm / SQFT_TO_SQM) * 100) / 100;
}

export type SideParse =
  | { readonly ok: true; readonly ft: number; readonly m: number }
  | { readonly ok: false; readonly error: 'empty' | 'notNumber' | 'decimals' | 'notPositive' | 'tooSmall' | 'tooLarge' };

// A length or width in feet as typed, with the metres sent (2 decimals, >0, at most MAX_SIDE_M).
export function parseSide(raw: string): SideParse {
  const text = raw.replace(/\s+/g, '');
  if (text === '') return { ok: false, error: 'empty' };
  if (!/^\d*([.,]\d*)?$/.test(text) || !/\d/.test(text)) return { ok: false, error: 'notNumber' };
  const normal = text.replace(',', '.');
  const decimals = normal.includes('.') ? normal.split('.')[1].length : 0;
  if (decimals > 2) return { ok: false, error: 'decimals' };
  const ft = Number(normal);
  if (!Number.isFinite(ft)) return { ok: false, error: 'notNumber' };
  if (ft <= 0) return { ok: false, error: 'notPositive' };
  const m = feetToMetres(ft);
  if (m <= 0) return { ok: false, error: 'tooSmall' };
  if (m > MAX_SIDE_M) return { ok: false, error: 'tooLarge' };
  return { ok: true, ft, m };
}

// Feet as metres, rounded to the centimetre the server keeps.
export function feetToMetres(ft: number): number {
  return Math.round(ft * FT_TO_M * 100) / 100;
}

// Metres the server holds, back into the feet the form shows.
export function metresToFeet(m: number): number {
  return Math.round((m / FT_TO_M) * 100) / 100;
}

// Length × width when both sides are valid: square feet as typed, square metres as the server derives them.
export function sidesArea(values: Answers): { readonly sqft: number; readonly sqm: number } | null {
  if (isHidden('length_ft', values)) return null;
  const length = parseSide(values.length_ft);
  const width = parseSide(values.width_ft);
  if (!length.ok || !width.ok) return null;
  return { sqft: length.ft * width.ft, sqm: Math.round(length.m * width.m * 100) / 100 };
}

// The area in m² the office will hold: the typed area, else length × width, else null.
export function effectiveAreaSqm(values: Answers): number | null {
  if (isHidden('area_sqft', values)) return null;
  const area = parseArea(values.area_sqft);
  if (area.ok) return roundSqm(area.sqm);
  return sidesArea(values)?.sqm ?? null;
}

// True when a typed area and length × width differ by more than AREA_MISMATCH.
export function areaMismatch(values: Answers): boolean {
  const area = isHidden('area_sqft', values) ? null : parseArea(values.area_sqft);
  const sides = sidesArea(values);
  if (area === null || !area.ok || sides === null || sides.sqft <= 0) return false;
  return Math.abs(area.sqft - sides.sqft) > AREA_MISMATCH * sides.sqft;
}

// Floors as typed: a whole number 0–200, or null when it is not one.
export function parseFloors(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,3}$/.test(text)) return null;
  const floors = Number(text);
  return floors <= MAX_FLOORS ? floors : null;
}

// Indian mobile numbers as the server's PhoneIN accepts them: country code and spacing stripped.
export function normalisePhone(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

const AREA_ERRORS = {
  empty: 'wizard.err.areaRequired',
  notNumber: 'wizard.err.areaNotNumber',
  decimals: 'wizard.err.areaDecimals',
  notPositive: 'wizard.err.areaNotPositive',
  tooSmall: 'wizard.err.areaTooSmall',
  tooLarge: 'wizard.err.areaTooLarge',
} as const satisfies Record<Exclude<AreaParse, { ok: true }>['error'], PlainKey>;

const SIDE_ERRORS = {
  empty: null,
  notNumber: 'wizard.err.sideNotNumber',
  decimals: 'wizard.err.areaDecimals',
  notPositive: 'wizard.err.sideNotPositive',
  tooSmall: 'wizard.err.sideTooSmall',
  tooLarge: 'wizard.err.sideTooLarge',
} as const satisfies Record<Exclude<SideParse, { ok: true }>['error'], PlainKey | null>;

// The problem with one field given every answer, or null. Mirrors the server's R1–R6.
export function validateAnswer(field: AnswerField, values: Answers, stage: AnswerStage): PlainKey | null {
  if (isHidden(field, values)) return null;
  const value = values[field].trim();
  const enforcement = isEnforcement(values);
  switch (field) {
    case 'encroachment_confirmed_cd':
      if (value === '') return 'wizard.err.encroachmentRequired';
      return oneOf(ENCROACHMENT_CODES, value) === null ? 'wizard.err.chooseAgain' : null;
    case 'area_sqft': {
      if (value === '' && (!enforcement || sidesArea(values) !== null)) return null;
      const parsed = parseArea(value);
      return parsed.ok ? null : AREA_ERRORS[parsed.error];
    }
    case 'length_ft':
    case 'width_ft': {
      const parsed = parseSide(value);
      return parsed.ok ? null : SIDE_ERRORS[parsed.error];
    }
    case 'area_type_cd':
      return value === '' && enforcement ? 'wizard.err.typeRequired' : null;
    case 'construction_stage_cd':
      return null;
    case 'external_support_cd':
      if (value === '') return enforcement ? 'wizard.err.supportRequired' : null;
      return oneOf(SUPPORT_CODES, value) === null ? 'wizard.err.chooseAgain' : null;
    case 'occupant_name':
      if (value.length > MAX_NAME) return 'wizard.err.nameTooLong';
      if (/[<>]/.test(value)) return 'wizard.err.nameChars';
      if (value === '' && values.occupant_phone.trim() !== '') return 'wizard.err.nameForPhone';
      return null;
    case 'owner_name':
      if (value.length > MAX_NAME) return 'wizard.err.nameTooLong';
      if (/[<>]/.test(value)) return 'wizard.err.nameChars';
      if (value === '' && values.owner_phone.trim() !== '') return 'wizard.err.ownerForPhone';
      return null;
    case 'occupant_phone':
    case 'owner_phone':
      if (value === '') return null;
      return PHONE_IN.test(normalisePhone(value)) ? null : 'wizard.err.phoneInvalid';
    case 'property_type_cd':
      return null;
    case 'floor_count':
      if (value === '') return null;
      return parseFloors(value) === null ? 'wizard.err.floorsInvalid' : null;
    case 'police_station':
      if (value.length > MAX_PLACE) return 'wizard.err.placeTooLong';
      return /[<>]/.test(value) ? 'wizard.err.placeChars' : null;
    case 'officer_note':
      if (value.length > MAX_NOTE) return 'wizard.err.noteTooLong';
      if (value === '' && values.external_support_cd === 'police' && !isHidden('external_support_cd', values)) {
        return 'wizard.err.noteForPolice';
      }
      return null;
    case 'recommendation_cd': {
      if (stage === 'findings') return null;
      if (value === '') return 'wizard.err.recommendationRequired';
      const code = oneOf(RECOMMENDATION_CODES, value);
      if (code === null) return 'wizard.err.chooseAgain';
      if (enforcement && code === NO_ACTION) return 'wizard.err.recommendationNeedsAction';
      if (encroachmentOf(values) === 'no_false_positive' && code !== NO_ACTION) {
        return 'wizard.err.recommendationFalsePositive';
      }
      return null;
    }
    case 'notice_required':
      if (stage === 'findings' || values.recommendation_cd === '') return null;
      return noticeAnswer(values) === null ? 'wizard.err.noticeRequired' : null;
    case 'notice_act_cd':
      if (stage === 'findings') return null;
      return value === '' ? 'wizard.err.noticeActRequired' : null;
    case 'section_cds':
      if (stage === 'findings') return null;
      return sectionsOf(values).length === 0 ? 'wizard.err.sectionsRequired' : null;
  }
}

// Every field's problem; empty when the answers can be sent at this stage.
export function validateAnswers(values: Answers, stage: AnswerStage): AnswerErrors {
  const errors: AnswerErrors = {};
  for (const field of ANSWER_FIELDS) {
    const problem = validateAnswer(field, values, stage);
    if (problem !== null) errors[field] = problem;
  }
  return errors;
}

export type OptionDomain =
  | 'encroachment'
  | 'support'
  | 'recommendation'
  | 'areaType'
  | 'constructionStage'
  | 'propertyType'
  | 'act'
  | 'section';

// The built-in label for a code, used offline before the server's list is cached.
export function builtInLabelKey(domain: OptionDomain, code: string): PlainKey | null {
  const key = `wizard.opt.${domain}.${code}`;
  return isMessageKey(key) ? (key as PlainKey) : null;
}

function isMessageKey(key: string): key is MessageKey {
  return Object.prototype.hasOwnProperty.call(en, key);
}

// English label for a generated finding: the office reads these lines, so they are one language.
function englishLabel(domain: OptionDomain, code: string, serverLabel?: (code: string) => string | null): string {
  const fromServer = serverLabel?.(code) ?? null;
  if (fromServer !== null && fromServer !== '') return fromServer;
  const key = builtInLabelKey(domain, code);
  return key === null ? code : translate('en', key);
}

export type EnglishLabels = Partial<Record<OptionDomain, (code: string) => string | null>>;

function formatNumber(value: number): string {
  return value.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/*
 * The `findings` lines the server requires (min 1), written from the answers so
 * nobody types them. English, one fact per line, the same order as the form.
 */
export function generateFindings(values: Answers, labels: EnglishLabels = {}): string[] {
  const lines: string[] = [];
  const answer = encroachmentOf(values);
  if (answer !== null) {
    lines.push(`Encroachment confirmed: ${englishLabel('encroachment', answer, labels.encroachment)}`);
  }
  if (!isHidden('area_sqft', values)) {
    const area = parseArea(values.area_sqft);
    if (area.ok) {
      lines.push(`Measured encroached area: ${formatNumber(area.sqft)} sq ft (${formatNumber(roundSqm(area.sqm))} sq m)`);
    }
  }
  const sides = sidesArea(values);
  if (sides !== null) {
    const length = parseSide(values.length_ft);
    const width = parseSide(values.width_ft);
    if (length.ok && width.ok) {
      lines.push(
        `Length × width: ${formatNumber(length.ft)} ft × ${formatNumber(width.ft)} ft (${formatNumber(length.m)} m × ${formatNumber(width.m)} m)`,
      );
    }
  }
  if (!isHidden('area_type_cd', values) && values.area_type_cd !== '') {
    lines.push(`Construction / occupation type: ${englishLabel('areaType', values.area_type_cd, labels.areaType)}`);
  }
  if (!isHidden('construction_stage_cd', values) && values.construction_stage_cd !== '') {
    lines.push(
      `Construction stage: ${englishLabel('constructionStage', values.construction_stage_cd, labels.constructionStage)}`,
    );
  }
  if (!isHidden('external_support_cd', values) && values.external_support_cd !== '') {
    lines.push(`External support required: ${englishLabel('support', values.external_support_cd, labels.support)}`);
  }
  if (values.occupant_name.trim() !== '' || values.occupant_phone.trim() !== '') {
    lines.push('Occupant found on site: details recorded');
  }
  if (values.owner_name.trim() !== '' || values.owner_phone.trim() !== '') {
    lines.push('Property owner: details recorded');
  }
  if (values.recommendation_cd !== '') {
    lines.push(`Recommendation: ${englishLabel('recommendation', values.recommendation_cd, labels.recommendation)}`);
  }
  const notice = noticeAnswer(values);
  if (notice !== null) lines.push(`Notice required: ${notice ? 'Yes' : 'No'}`);
  if (notice === true && values.notice_act_cd !== '') {
    const cited = sectionsOf(values).map((code) => englishLabel('section', code, labels.section));
    const act = englishLabel('act', values.notice_act_cd, labels.act);
    lines.push(cited.length > 0 ? `Notice under: ${act}; ${cited.join(', ')}` : `Notice under: ${act}`);
  }
  return lines;
}

// Trimmed text, or null so the server clears the column.
function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// The notice part of the body: left out while undecided, so the office's own citation is kept.
function noticePart(values: Answers): Pick<FindingsPut, 'notice_required' | 'notice_act_cd' | 'sections'> {
  const notice = noticeAnswer(values);
  if (notice === null) return {};
  if (!notice) return { notice_required: false, notice_act_cd: null, sections: [] };
  const act = optional(values.notice_act_cd);
  if (act === null) return { notice_required: true };
  return {
    notice_required: true,
    notice_act_cd: act,
    sections: sectionsOf(values).map((code) => ({ act_cd: act, section_cd: code })),
  };
}

// The PUT body, from stored answers only. Hidden fields go as null so the round holds no stale answer; the notice only when decided.
export function toFindingsPut(values: Answers, labels: EnglishLabels = {}): FindingsPut {
  const area = isHidden('area_sqft', values) ? null : parseArea(values.area_sqft);
  const phone = optional(values.occupant_phone);
  const ownerPhone = optional(values.owner_phone);
  const recommendation = oneOf(RECOMMENDATION_CODES, values.recommendation_cd);
  const side = (field: 'length_ft' | 'width_ft'): number | null => {
    if (isHidden(field, values)) return null;
    const parsed = parseSide(values[field]);
    return parsed.ok ? parsed.m : null;
  };
  return {
    findings: generateFindings(values, labels),
    encroachment_confirmed_cd: encroachmentOf(values),
    measured_area_sqm: area !== null && area.ok ? roundSqm(area.sqm) : null,
    length_m: side('length_ft'),
    width_m: side('width_ft'),
    area_type_cd: isHidden('area_type_cd', values) ? null : optional(values.area_type_cd),
    construction_stage_cd: isHidden('construction_stage_cd', values) ? null : optional(values.construction_stage_cd),
    external_support_cd: isHidden('external_support_cd', values)
      ? null
      : oneOf(SUPPORT_CODES, values.external_support_cd),
    recommendation_cd: recommendation,
    ...noticePart(values),
    occupant_name: optional(values.occupant_name),
    occupant_phone: phone === null ? null : normalisePhone(phone),
    owner_name: optional(values.owner_name),
    owner_phone: ownerPhone === null ? null : normalisePhone(ownerPhone),
    property_type_cd: optional(values.property_type_cd),
    floor_count: parseFloors(values.floor_count),
    police_station: optional(values.police_station),
    officer_note: optional(values.officer_note),
  };
}

// A side the server holds in metres, as the feet the form shows.
function feetText(m: number | null | undefined): string {
  return m === null || m === undefined ? '' : String(metresToFeet(m));
}

// The answers a round already holds on the server, for a round resumed on another handset.
export function answersFromServer(detail: InspectionDetail): Answers {
  const sqm = detail.measured_area_sqm;
  const act = detail.notice_act_cd ?? '';
  return {
    encroachment_confirmed_cd: detail.encroachment_confirmed_cd ?? '',
    area_sqft: sqm === null || sqm === undefined ? '' : String(sqmToSqft(sqm)),
    length_ft: feetText(detail.length_m),
    width_ft: feetText(detail.width_m),
    area_type_cd: detail.area_type_cd ?? '',
    construction_stage_cd: detail.construction_stage_cd ?? '',
    external_support_cd: detail.external_support_cd ?? '',
    occupant_name: detail.occupant_name ?? '',
    occupant_phone: detail.occupant_phone ?? '',
    owner_name: detail.owner_name ?? '',
    owner_phone: detail.owner_phone ?? '',
    property_type_cd: detail.property_type_cd ?? '',
    floor_count: detail.floor_count === null || detail.floor_count === undefined ? '' : String(detail.floor_count),
    police_station: detail.police_station ?? '',
    officer_note: detail.officer_note ?? '',
    recommendation_cd: detail.recommendation_cd ?? '',
    notice_required: detail.notice_required === true ? 'yes' : detail.notice_required === false ? 'no' : '',
    notice_act_cd: act,
    section_cds: (detail.sections ?? [])
      .filter((section) => section.act_cd === act)
      .map((section) => section.section_cd)
      .join(','),
  };
}

// True when the server holds any structured answer worth resuming from.
export function serverHasAnswers(detail: InspectionDetail): boolean {
  return (
    (detail.findings ?? []).length > 0 ||
    (detail.encroachment_confirmed_cd ?? null) !== null ||
    (detail.measured_area_sqm ?? null) !== null ||
    (detail.length_m ?? null) !== null ||
    (detail.width_m ?? null) !== null ||
    (detail.construction_stage_cd ?? null) !== null
  );
}
