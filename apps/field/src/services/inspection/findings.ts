import { WORKABLE_ROUND_STATUSES, putFindings } from '@/services/api/inspections';
import type { InspectionDetail } from '@/services/api/types';
import {
  clearDraft,
  draftKeyPrefix,
  draftSnapshot,
  moveDraft,
  parseDraft,
  readDraft,
  saveDraft,
  saveDraftFields,
  type Draft,
  type DraftScope,
  type DraftValues,
} from '@/services/storage/drafts';
import { draftStore } from '@/services/storage/kv';

import {
  ANSWER_FIELDS,
  EMPTY_ANSWERS,
  answersFromServer,
  encroachmentPatch,
  serverHasAnswers,
  sqmToSqft,
  toFindingsPut,
  validateAnswers,
  type AnswerErrors,
  type AnswerField,
  type AnswerStage,
  type Answers,
  type EnglishLabels,
} from './answers';
import { localRound } from './rounds';

/*
 * Steps 3 and 4: the answers, as a draft on the device, and the PUT that sends them.
 *
 * The draft is the form's only memory: every field is written on blur (a select on
 * choice), and what goes to the server is read back from the draft, never from
 * component state — so a value that failed to store is visibly missing on review.
 *
 * A PUT replaces the round's findings, and the server writes only the fields in
 * the body, so every answer field is sent — null for an empty or hidden one. The
 * one exception is notice_required, left out when the recommendation does not
 * decide it, so an officer's flag is not wiped.
 */
export type { AnswerErrors, AnswerField, Answers };

// Answers before the round is known, and older per-case drafts; moved into the round's draft on first write.
function unboundScope(caseRef: string): DraftScope {
  return { caseRef, step: 'findings' };
}

// The round's own answers draft, so answers left on one round are never sent to the next.
function roundScope(caseRef: string, inspectionRef: string): DraftScope {
  return { caseRef, step: `findings@${inspectionRef}` };
}

// Key recording which draft revision the server last accepted, beside the draft it belongs to.
function sentKey(scope: DraftScope): string {
  return `findings-sent:${scope.caseRef}:${scope.step}`;
}

// The case-keyed marker an older build wrote; moved with the unbound draft.
function legacySentKey(caseRef: string): string {
  return `findings-sent:${caseRef}`;
}

// The round the answers belong to: the one named, else the one this phone is working on.
function roundOf(caseRef: string, inspectionRef?: string | null): string | null {
  return inspectionRef ?? localRound(caseRef)?.inspectionRef ?? null;
}

// Where answers are read: the round's draft, or an unbound draft not yet moved into it.
function readScope(caseRef: string, inspectionRef?: string | null): DraftScope {
  const round = roundOf(caseRef, inspectionRef);
  if (round === null) return unboundScope(caseRef);
  const own = roundScope(caseRef, round);
  if (draftSnapshot(own) === '' && draftSnapshot(unboundScope(caseRef)) !== '') return unboundScope(caseRef);
  return own;
}

// Where answers are written: the round's draft, after an unbound draft has moved into it.
function writeScope(caseRef: string, inspectionRef?: string | null): DraftScope {
  const round = roundOf(caseRef, inspectionRef);
  const unbound = unboundScope(caseRef);
  if (round === null) return unbound;
  const own = roundScope(caseRef, round);
  if (draftSnapshot(unbound) !== '') {
    if (draftSnapshot(own) === '' && moveDraft(unbound, own)) {
      const sent = draftStore.getString(sentKey(unbound)) ?? draftStore.getString(legacySentKey(caseRef));
      if (sent !== undefined) draftStore.set(sentKey(own), sent);
    } else {
      clearDraft(unbound);
    }
    draftStore.remove(sentKey(unbound));
    draftStore.remove(legacySentKey(caseRef));
  }
  return own;
}

// A stored value as text, whatever type an older build wrote.
function text(values: DraftValues, field: string): string {
  const value = values[field];
  return value === null || value === undefined ? '' : String(value);
}

// The stored answers as form text. A draft from the m²-only build is read in square feet.
export function answersOf(values: DraftValues): Answers {
  const answers = { ...EMPTY_ANSWERS };
  for (const field of ANSWER_FIELDS) answers[field] = text(values, field);
  if (answers.area_sqft === '' && text(values, 'measured_area_sqm') !== '') {
    const sqm = Number(text(values, 'measured_area_sqm'));
    if (Number.isFinite(sqm) && sqm > 0) answers.area_sqft = String(sqmToSqft(sqm));
  }
  return answers;
}

export function readFindingsDraft(caseRef: string, inspectionRef?: string | null): Draft | null {
  return readDraft(readScope(caseRef, inspectionRef));
}

export function readAnswers(caseRef: string, inspectionRef?: string | null): Answers {
  return answersOf(readFindingsDraft(caseRef, inspectionRef)?.values ?? {});
}

// Writes one field (onBlur, or onChange for a select). The encroachment answer carries its dependants.
export function saveAnswer(caseRef: string, field: AnswerField, value: string): Draft {
  const scope = writeScope(caseRef);
  const trimmed = field === 'officer_note' ? value.replace(/\s+$/u, '') : value.trim();
  const patch: Partial<Answers> =
    field === 'encroachment_confirmed_cd'
      ? encroachmentPatch(answersOf(readDraft(scope)?.values ?? {}), trimmed)
      : { [field]: trimmed };
  const values: DraftValues = {};
  for (const [key, next] of Object.entries(patch)) values[key] = next === '' ? null : next;
  return saveDraftFields(scope, values);
}

// True when the round's stored draft has edits the server has not accepted.
export function hasUnsentFindings(caseRef: string, inspectionRef?: string | null): boolean {
  const scope = readScope(caseRef, inspectionRef);
  const draft = readDraft(scope);
  if (draft === null) return false;
  const sent = draftStore.getString(sentKey(scope)) ?? (scope.step === 'findings' ? draftStore.getString(legacySentKey(caseRef)) : undefined);
  return sent !== draft.updatedAt;
}

export class FindingsInvalid extends Error {
  readonly errors: AnswerErrors;

  constructor(errors: AnswerErrors) {
    super('The answers are incomplete.');
    this.name = 'FindingsInvalid';
    this.errors = errors;
  }
}

/*
 * Sends the stored answers. The draft is validated at the stage asking (step 3
 * leaves the recommendation to step 4); on success the revision is marked as
 * accepted, so review knows whether the office has the latest edits.
 */
export async function sendFindings(
  caseRef: string,
  inspectionRef: string,
  stage: AnswerStage,
  labels: EnglishLabels = {},
): Promise<InspectionDetail> {
  const scope = writeScope(caseRef, inspectionRef);
  const draft = readDraft(scope);
  const answers = answersOf(draft?.values ?? {});
  const errors = validateAnswers(answers, stage);
  if (Object.keys(errors).length > 0) throw new FindingsInvalid(errors);

  const detail = await putFindings(inspectionRef, toFindingsPut(answers, labels));
  if (draft !== null) draftStore.set(sentKey(scope), draft.updatedAt);
  return detail;
}

/*
 * Seeds an empty draft from answers the server already holds — a round resumed on
 * a reinstalled or different handset. Never overwrites a local draft, and never
 * seeds from a finished round, whose draft was cleared on purpose at submit.
 */
export function seedFindingsFromServer(caseRef: string, detail: InspectionDetail): Draft | null {
  if (!(WORKABLE_ROUND_STATUSES as readonly string[]).includes(detail.status)) return null;
  if (readFindingsDraft(caseRef, detail.inspection_ref) !== null || !serverHasAnswers(detail)) return null;
  const answers = answersFromServer(detail);
  const values: DraftValues = {};
  for (const field of ANSWER_FIELDS) values[field] = answers[field] === '' ? null : answers[field];
  const scope = roundScope(caseRef, detail.inspection_ref);
  const draft = saveDraft(scope, values);
  draftStore.set(sentKey(scope), draft.updatedAt);
  return draft;
}

// Forgets the round's draft, any unbound one, and their sent markers once the round is submitted or dropped.
export function clearFindings(caseRef: string, inspectionRef?: string | null): void {
  const round = roundOf(caseRef, inspectionRef);
  const scopes = round === null ? [unboundScope(caseRef)] : [roundScope(caseRef, round), unboundScope(caseRef)];
  for (const scope of scopes) {
    clearDraft(scope);
    draftStore.remove(sentKey(scope));
  }
  draftStore.remove(legacySentKey(caseRef));
}

// The answers draft as its raw string, for `useSyncExternalStore`.
export function findingsSnapshot(caseRef: string): string {
  return draftSnapshot(readScope(caseRef));
}

// Parses a snapshot taken by `findingsSnapshot`.
export function findingsFrom(snapshot: string): Draft | null {
  return parseDraft(snapshot);
}

// Calls `listener` whenever any of the case's answers drafts, or the round they belong to, changes.
export function subscribeToFindings(caseRef: string, listener: () => void): () => void {
  const drafts = `${draftKeyPrefix(caseRef)}findings`;
  const round = `round:${caseRef}`;
  const subscription = draftStore.addOnValueChangedListener((changed) => {
    if (changed.startsWith(drafts) || changed === round) listener();
  });
  return () => subscription.remove();
}
