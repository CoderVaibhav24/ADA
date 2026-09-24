import { AdaApiError } from '@/services/api/errors';
import type { PlainKey } from '@/services/i18n';

import { ANSWER_FIELDS, NO_ACTION, type AnswerErrors, type AnswerField } from './answers';

/*
 * A server refusal in the surveyor's words. The 422 envelope names a `field` and,
 * for `missing_payload`, every missing field in `allowed`; each is placed under the
 * form field it belongs to. No server code ever reaches the screen.
 */
export type Refusal = {
  /** Messages to show under the fields they belong to. */
  readonly fields: AnswerErrors;
  /** One line for the top of the step: what went wrong and what to do. */
  readonly summary: PlainKey;
  /** Things owed that are not a form field: the check-in, the photographs. */
  readonly outside: readonly PlainKey[];
  /** The server's log reference, for a call to support. */
  readonly reference: string | null;
  readonly offline: boolean;
};

// Server column → form field. The findings list is written from the encroachment answer.
const FIELD_OF: Record<string, AnswerField> = {
  encroachment_confirmed_cd: 'encroachment_confirmed_cd',
  measured_area_sqm: 'area_sqft',
  length_m: 'length_ft',
  width_m: 'width_ft',
  area_type_cd: 'area_type_cd',
  construction_stage_cd: 'construction_stage_cd',
  external_support_cd: 'external_support_cd',
  occupant_name: 'occupant_name',
  occupant_phone: 'occupant_phone',
  owner_name: 'owner_name',
  owner_phone: 'owner_phone',
  property_type_cd: 'property_type_cd',
  floor_count: 'floor_count',
  police_station: 'police_station',
  officer_note: 'officer_note',
  recommendation_cd: 'recommendation_cd',
  notice_required: 'notice_required',
  notice_act_cd: 'notice_act_cd',
  sections: 'section_cds',
  findings: 'encroachment_confirmed_cd',
};

// What a missing answer means, field by field.
const MISSING: Record<AnswerField, PlainKey> = {
  encroachment_confirmed_cd: 'wizard.err.encroachmentRequired',
  area_sqft: 'wizard.err.areaRequired',
  length_ft: 'wizard.err.sideNotNumber',
  width_ft: 'wizard.err.sideNotNumber',
  area_type_cd: 'wizard.err.typeRequired',
  construction_stage_cd: 'wizard.err.stageNotOffered',
  external_support_cd: 'wizard.err.supportRequired',
  occupant_name: 'wizard.err.nameForPhone',
  occupant_phone: 'wizard.err.phoneInvalid',
  owner_name: 'wizard.err.ownerForPhone',
  owner_phone: 'wizard.err.phoneInvalid',
  property_type_cd: 'wizard.err.chooseAgain',
  floor_count: 'wizard.err.floorsInvalid',
  police_station: 'wizard.err.placeChars',
  officer_note: 'wizard.err.noteForPolice',
  recommendation_cd: 'wizard.err.recommendationRequired',
  notice_required: 'wizard.err.noticeRequired',
  notice_act_cd: 'wizard.err.noticeActRequired',
  section_cds: 'wizard.err.sectionsRequired',
};

// What an answer the server would not take means, field by field.
function invalid(field: AnswerField, allowed: readonly string[] | null): PlainKey {
  switch (field) {
    case 'area_sqft':
      return 'wizard.err.areaTooLarge';
    case 'length_ft':
    case 'width_ft':
      return 'wizard.err.sideTooLarge';
    case 'area_type_cd':
      return 'wizard.err.typeNotOffered';
    case 'construction_stage_cd':
      return 'wizard.err.stageNotOffered';
    case 'occupant_name':
    case 'owner_name':
      return 'wizard.err.nameChars';
    case 'occupant_phone':
    case 'owner_phone':
      return 'wizard.err.phoneInvalid';
    case 'notice_required':
      return 'wizard.err.noticeConflict';
    case 'notice_act_cd':
    case 'section_cds':
      return 'wizard.err.citationNotOffered';
    case 'floor_count':
      return 'wizard.err.floorsInvalid';
    case 'police_station':
      return 'wizard.err.placeChars';
    case 'officer_note':
      return 'wizard.err.noteTooLong';
    case 'recommendation_cd':
      if (allowed !== null && allowed.length === 1 && allowed[0] === NO_ACTION) {
        return 'wizard.err.recommendationFalsePositive';
      }
      return allowed === null ? 'wizard.err.chooseAgain' : 'wizard.err.recommendationNeedsAction';
    default:
      return 'wizard.err.chooseAgain';
  }
}

// Owed items that live on other steps.
function outsideKey(name: string): PlainKey | null {
  if (name === 'check_in') return 'wizard.err.server.checkIn';
  if (name === 'evidence') return 'wizard.err.server.photos';
  return null;
}

// "occupant_phone" from "occupant_phone" or "findings.0".
function rootField(name: string | null): string | null {
  if (name === null) return null;
  return name.split('.')[0] ?? null;
}

function isAnswerField(name: string): name is AnswerField {
  return (ANSWER_FIELDS as readonly string[]).includes(name);
}

// Reads any failure of a findings save or a submit into words.
export function explainRefusal(error: unknown): Refusal {
  if (!(error instanceof AdaApiError)) {
    return { fields: {}, summary: 'wizard.err.server.unknown', outside: [], reference: null, offline: false };
  }
  if (error.isOffline) {
    return { fields: {}, summary: 'wizard.err.server.offline', outside: [], reference: null, offline: true };
  }
  const reference = error.requestId;
  const fields: AnswerErrors = {};
  const outside: PlainKey[] = [];

  if (error.code === 'missing_payload') {
    const names = error.allowed ?? (error.field === null ? [] : [error.field]);
    for (const name of names) {
      const mapped = FIELD_OF[name] ?? (isAnswerField(name) ? name : null);
      if (mapped !== null) {
        fields[mapped] ??= MISSING[mapped];
        continue;
      }
      const other = outsideKey(rootField(name) ?? '');
      if (other !== null && !outside.includes(other)) outside.push(other);
    }
    return {
      fields,
      summary: Object.keys(fields).length > 0 ? 'wizard.err.server.missing' : (outside[0] ?? 'wizard.err.server.missing'),
      outside,
      reference,
      offline: false,
    };
  }

  if (error.status === 422) {
    const root = rootField(error.field);
    const mapped = root === null ? null : (FIELD_OF[root] ?? null);
    if (mapped !== null) {
      fields[mapped] = invalid(mapped, error.allowed);
      return { fields, summary: 'wizard.err.server.fix', outside, reference, offline: false };
    }
    const other = outsideKey(root ?? '');
    if (other !== null) return { fields, summary: other, outside: [other], reference, offline: false };
    return { fields, summary: 'wizard.err.server.fixGeneric', outside, reference, offline: false };
  }

  if (error.status === 401) {
    return { fields, summary: 'wizard.err.server.loggedOut', outside, reference, offline: false };
  }
  if (error.status === 403 || error.status === 404 || error.status === 409) {
    return { fields, summary: 'wizard.err.server.notAllowed', outside, reference, offline: false };
  }
  return { fields, summary: 'wizard.err.server.unknown', outside, reference, offline: false };
}

// Server codes that mean "this round is not yours to work on now".
const NOT_ALLOWED = new Set(['invalid_transition', 'role_not_permitted', 'forbidden', 'not_found', 'not_the_assignee', 'assignee_not_in_zone']);

// True for a server code that means the round is no longer this surveyor's to send.
export function isNotAllowedCode(code: string): boolean {
  return NOT_ALLOWED.has(code);
}

// A check-in refusal in words. `poor_accuracy` is the common one; a bad clock comes back on `device_timestamp`.
export function checkInRefusalKey(code: string, field: string | null = null): PlainKey {
  if (code === 'poor_accuracy') return 'checkin.refused.accuracy';
  if (code === 'outside_geofence') return 'checkin.refused.outsideGeofence';
  if (field === 'device_timestamp') return 'checkin.refused.clock';
  if (NOT_ALLOWED.has(code)) return 'checkin.refused.notAllowed';
  return 'checkin.refused.generic';
}

// A photograph upload refusal in words, from the code and field kept on the capture record.
export function uploadRefusalKey(code: string | null | undefined, field: string | null | undefined, refused: boolean): PlainKey {
  if (code === 'poor_accuracy' || code === 'geotag_required') return 'photos.failed.accuracy';
  if (field === 'device_timestamp') return 'photos.failed.clock';
  if (code === 'file_missing') return 'photos.failed.fileMissing';
  if (code === 'payload_too_large' || code === 'image_too_large') return 'photos.failed.tooLarge';
  if (code === 'too_many_photos') return 'photos.failed.tooMany';
  if (code !== null && code !== undefined && NOT_ALLOWED.has(code)) return 'photos.failed.notAllowed';
  return refused ? 'photos.failed.refused' : 'photos.failed.retrying';
}
