import { idempotencyKeyFor, releaseIdempotencyKey } from '@/services/api/idempotency';
import { postSubmit } from '@/services/api/inspections';
import type { InspectionDetail } from '@/services/api/types';

import { clearCheckIn } from './check-in';
import { clearFindings } from './findings';
import { rememberRoundDetail, rememberStep } from './rounds';

// One Submit action per round; the scope names the round, so round 2 never reuses round 1's key.
function submitScope(inspectionRef: string): string {
  return `submit:${inspectionRef}`;
}

/*
 * Submits the round. The key is minted on the first tap and survives every retry,
 * a process death and a reboot; the server answers a replay with 200 and the
 * round already submitted, so two taps are one inspection. Only after the server
 * has answered are the key, the findings draft and the check-in record released.
 */
export async function submitRound(caseRef: string, inspectionRef: string): Promise<InspectionDetail> {
  const scope = submitScope(inspectionRef);
  const detail = await postSubmit(inspectionRef, idempotencyKeyFor(scope));

  releaseIdempotencyKey(scope);
  clearFindings(caseRef);
  clearCheckIn(caseRef);
  rememberRoundDetail(caseRef, detail);
  rememberStep(caseRef, 'done');
  return detail;
}
