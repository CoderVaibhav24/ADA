import { apiRequest } from './client';
import type {
  CheckInCreate,
  CheckInOut,
  FindingsPut,
  InspectionDetail,
  InspectionOpen,
  InspectionPage,
  InspectionRow,
} from './types';

/*
 * The inspection loop's writes, and the one list read the wizard needs to find
 * its round — Batch 3, `backend/api/app/routers/icms_inspections.py`. The other
 * reads (one round, its evidence, the case) are in `inspection-reads.ts` and
 * `case-reads.ts`.
 *
 * One function per endpoint, typed against the generated schema, nothing else.
 * Where a round comes from, what is held on the device and when a retry is safe
 * are decided in `services/inspection/`; this file only speaks HTTP.
 */

// Path segments are server identifiers, never trusted to be URL-safe.
function segment(value: string): string {
  return encodeURIComponent(value);
}

// The statuses a round can still be worked in; anything else is finished.
export const WORKABLE_ROUND_STATUSES = ['scheduled', 'in_progress'] as const;

// The caller's rounds on one case, newest first. A Field Surveyor only ever sees their own.
export async function fetchRoundsForCase(
  caseRef: string,
  filters: { readonly status?: readonly string[]; readonly surveyorUserId?: string },
  signal?: AbortSignal,
): Promise<InspectionRow[]> {
  const page = await apiRequest<InspectionPage>('/api/icms/inspections', {
    query: {
      case_ref: [caseRef],
      status: filters.status,
      surveyor_user_id: filters.surveyorUserId === undefined ? undefined : [filters.surveyorUserId],
      sort: '-round_no',
      size: 25,
    },
    signal,
  });
  return page.items;
}

/*
 * Opens a round. Not idempotent by key: the server makes a duplicate impossible
 * instead, because opening moves the case out of `assigned` and a second open is
 * answered `409 invalid_transition`. `services/inspection/rounds.ts` reads that
 * answer as "already open" and resumes.
 */
export function openRound(caseRef: string, body: InspectionOpen): Promise<InspectionDetail> {
  return apiRequest<InspectionDetail>(`/api/icms/cases/${segment(caseRef)}/inspections`, {
    method: 'POST',
    body,
  });
}

// Records the surveyor at the property. A replayed key answers 200 with the first check-in.
export function postCheckIn(
  inspectionRef: string,
  body: Omit<CheckInCreate, 'idempotency_key'>,
  idempotencyKey: string,
): Promise<CheckInOut> {
  return apiRequest<CheckInOut>(`/api/icms/inspections/${segment(inspectionRef)}/check-in`, {
    method: 'POST',
    body,
    idempotencyKey,
  });
}

// Replaces the round's findings with the form's whole content.
export function putFindings(inspectionRef: string, body: FindingsPut): Promise<InspectionDetail> {
  return apiRequest<InspectionDetail>(`/api/icms/inspections/${segment(inspectionRef)}/findings`, {
    method: 'PUT',
    body,
  });
}

// Submits the round. A replay answers 200 with the round already submitted.
export function postSubmit(inspectionRef: string, idempotencyKey: string): Promise<InspectionDetail> {
  return apiRequest<InspectionDetail>(`/api/icms/inspections/${segment(inspectionRef)}/submit`, {
    method: 'POST',
    idempotencyKey,
  });
}
