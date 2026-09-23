import { WORKABLE_ROUND_STATUSES, putFindings } from '@/services/api/inspections';
import type { FindingsPut, InspectionDetail } from '@/services/api/types';
import {
  clearDraft,
  draftSnapshot,
  parseDraft,
  readDraft,
  saveDraft,
  saveDraftField,
  subscribeToDraft,
  type Draft,
  type DraftScope,
  type DraftValues,
} from '@/services/storage/drafts';
import { draftStore } from '@/services/storage/kv';

/*
 * Step 3: the findings form, as `FindingsPut` accepts it.
 *
 * The draft is the form's only memory: every field is written on blur, and what
 * goes to the server is read back from the draft, never from component state, so
 * a value that failed to store is visibly missing on review rather than carried.
 *
 * A PUT replaces the round's findings and, because the server writes only the
 * fields present in the body, every field is sent — null for an empty one — so
 * clearing a field on the form clears it on the round.
 */
export const FINDINGS_FIELDS = [
  'findings',
  'measured_area_sqm',
  'area_type_cd',
  'occupant_name',
  'occupant_phone',
  'notice_required',
  'officer_note',
] as const;
export type FindingsField = (typeof FINDINGS_FIELDS)[number];

export type FindingsErrors = Partial<Record<FindingsField, string>>;

// The server's limits (`inspection_schemas.py`, `ada_core/validation.py`).
const MAX_FINDINGS = 50;
const MAX_LONG_TEXT = 5000;
const MAX_NAME = 200;
const MAX_AREA_SQM = 10_000_000;
const PHONE_IN = /^[6-9]\d{9}$/;

// Scope of the findings draft for a case.
export function findingsScope(caseRef: string): DraftScope {
  return { caseRef, step: 'findings' };
}

// Key recording which draft revision the server last accepted.
function sentKey(caseRef: string): string {
  return `findings-sent:${caseRef}`;
}

export function readFindingsDraft(caseRef: string): Draft | null {
  return readDraft(findingsScope(caseRef));
}

// Writes one field. Call from onBlur (or onChange for a select, which has no blur).
export function saveFindingsField(caseRef: string, field: FindingsField, value: string | null): Draft {
  return saveDraftField(findingsScope(caseRef), field, value === '' ? null : value);
}

// A stored value as text, whatever type an older build wrote.
export function draftText(values: DraftValues, field: FindingsField): string {
  const value = values[field];
  return value === null || value === undefined ? '' : String(value);
}

// Findings are one statement per line; blank lines are not statements.
export function splitFindings(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');
}

// Indian mobile numbers as the server's PhoneIN accepts them: country code and spacing stripped.
export function normalisePhone(value: string): string {
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length === 12 && digits.startsWith('91')) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) return digits.slice(1);
  return digits;
}

// The message for one field, or null when the value is acceptable. Specific, per code-standards.md §5.
export function validateFindingsField(field: FindingsField, raw: string): string | null {
  const value = raw.trim();
  switch (field) {
    case 'findings': {
      const lines = splitFindings(raw);
      if (lines.length === 0) return 'Record at least one finding — what you observed at the site.';
      if (lines.length > MAX_FINDINGS) return `Record at most ${MAX_FINDINGS} findings, one per line.`;
      if (lines.some((line) => line.length > MAX_LONG_TEXT)) {
        return `Keep each finding under ${MAX_LONG_TEXT} characters.`;
      }
      return null;
    }
    case 'measured_area_sqm': {
      if (value === '') return null;
      const area = Number(value);
      if (!Number.isFinite(area) || area < 0) return 'Enter the measured area in square metres, as a number.';
      if (area > MAX_AREA_SQM) return 'That area is larger than the system accepts. Check the units are square metres.';
      return null;
    }
    case 'occupant_name':
      return value.length > MAX_NAME ? `Keep the name under ${MAX_NAME} characters.` : null;
    case 'occupant_phone':
      if (value === '') return null;
      return PHONE_IN.test(normalisePhone(value))
        ? null
        : 'Enter a 10-digit Indian mobile number starting with 6, 7, 8 or 9.';
    case 'officer_note':
      return value.length > MAX_LONG_TEXT ? `Keep remarks under ${MAX_LONG_TEXT} characters.` : null;
    case 'area_type_cd':
    case 'notice_required':
      return null;
  }
}

// Every field's message for the stored draft; empty when the draft can be sent.
export function validateFindings(values: DraftValues): FindingsErrors {
  const errors: FindingsErrors = {};
  for (const field of FINDINGS_FIELDS) {
    const message = validateFindingsField(field, draftText(values, field));
    if (message !== null) errors[field] = message;
  }
  return errors;
}

// Nullable text: empty means "nothing recorded", sent as null so the server clears it.
function optional(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

// The PUT body, built from stored values only. Assumes `validateFindings` passed.
export function toFindingsPut(values: DraftValues): FindingsPut {
  const area = optional(draftText(values, 'measured_area_sqm'));
  const phone = optional(draftText(values, 'occupant_phone'));
  const notice = draftText(values, 'notice_required');
  return {
    findings: splitFindings(draftText(values, 'findings')),
    measured_area_sqm: area === null ? null : Number(area),
    area_type_cd: optional(draftText(values, 'area_type_cd')),
    occupant_name: optional(draftText(values, 'occupant_name')),
    occupant_phone: phone === null ? null : normalisePhone(phone),
    notice_required: notice === 'yes' ? true : notice === 'no' ? false : null,
    officer_note: optional(draftText(values, 'officer_note')),
  };
}

// True when the stored draft has edits the server has not accepted.
export function hasUnsentFindings(caseRef: string): boolean {
  const draft = readFindingsDraft(caseRef);
  if (draft === null) return false;
  return draftStore.getString(sentKey(caseRef)) !== draft.updatedAt;
}

export class FindingsInvalid extends Error {
  readonly errors: FindingsErrors;

  constructor(errors: FindingsErrors) {
    super(Object.values(errors)[0] ?? 'The findings are incomplete.');
    this.name = 'FindingsInvalid';
    this.errors = errors;
  }
}

/*
 * Sends the stored draft. On success the draft revision is marked as accepted, so
 * review can tell the surveyor whether the office has their latest edits.
 */
export async function sendFindings(caseRef: string, inspectionRef: string): Promise<InspectionDetail> {
  const draft = readFindingsDraft(caseRef);
  const values = draft?.values ?? {};
  const errors = validateFindings(values);
  if (Object.keys(errors).length > 0) throw new FindingsInvalid(errors);

  const detail = await putFindings(inspectionRef, toFindingsPut(values));
  if (draft !== null) draftStore.set(sentKey(caseRef), draft.updatedAt);
  return detail;
}

/*
 * Seeds an empty draft from findings the server already holds — a round resumed
 * on a reinstalled or different handset. Never overwrites a local draft, and never
 * seeds from a finished round, whose draft was cleared on purpose at submit.
 */
export function seedFindingsFromServer(caseRef: string, detail: InspectionDetail): Draft | null {
  const findings = detail.findings ?? [];
  if (!(WORKABLE_ROUND_STATUSES as readonly string[]).includes(detail.status)) return null;
  if (readFindingsDraft(caseRef) !== null || findings.length === 0) return null;
  const draft = saveDraft(findingsScope(caseRef), {
    findings: findings.map((item) => item.finding).join('\n'),
    measured_area_sqm:
      detail.measured_area_sqm === null || detail.measured_area_sqm === undefined
        ? null
        : String(detail.measured_area_sqm),
    area_type_cd: detail.area_type_cd ?? null,
    occupant_name: detail.occupant_name ?? null,
    occupant_phone: detail.occupant_phone ?? null,
    notice_required:
      detail.notice_required === true ? 'yes' : detail.notice_required === false ? 'no' : null,
    officer_note: detail.officer_note ?? null,
  });
  draftStore.set(sentKey(caseRef), draft.updatedAt);
  return draft;
}

// Forgets the draft and its sent marker once the round has been submitted.
export function clearFindings(caseRef: string): void {
  clearDraft(findingsScope(caseRef));
  draftStore.remove(sentKey(caseRef));
}

// The findings draft as its raw string, for `useSyncExternalStore`.
export function findingsSnapshot(caseRef: string): string {
  return draftSnapshot(findingsScope(caseRef));
}

// Parses a snapshot taken by `findingsSnapshot`.
export function findingsFrom(snapshot: string): Draft | null {
  return parseDraft(snapshot);
}

// Calls `listener` whenever the case's findings draft changes.
export function subscribeToFindings(caseRef: string, listener: () => void): () => void {
  return subscribeToDraft(findingsScope(caseRef), listener);
}
