import { drainCaptures, type UploadOutcome } from '@/services/api/uploads';

import { readCheckIn, sendHeldCheckIn } from './check-in';
import { inspectionRefForCase } from './rounds';

/*
 * Sends whatever the device holds for a case's round: a held check-in first,
 * then captures in the order they were taken (Architecture.md §3, rule 1).
 *
 * Safe to call as often as a screen likes: the check-in and every capture carry
 * the key minted at the surveyor's tap, so a repeat is a replay, and the capture
 * drain refuses to run twice at once.
 */
export async function syncRound(caseRef: string): Promise<UploadOutcome> {
  const inspectionRef = inspectionRefForCase(caseRef);
  if (inspectionRef !== null && readCheckIn(caseRef, inspectionRef)?.state === 'held') {
    // A failure is recorded on the check-in record itself; the drain still runs.
    await sendHeldCheckIn(caseRef, inspectionRef).catch(() => null);
  }
  return drainCaptures(inspectionRefForCase);
}
