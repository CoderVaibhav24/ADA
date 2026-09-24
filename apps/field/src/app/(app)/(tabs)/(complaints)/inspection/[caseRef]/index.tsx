import { Redirect, useLocalSearchParams } from 'expo-router';

import { hasArrived, readCheckIn } from '@/services/inspection/check-in';
import { localRound } from '@/services/inspection/rounds';

/*
 * The wizard's entry: `/inspection/{caseRef}`. Resumes at the step that was open
 * when the app was last left (ui-rules.md §5). A finished round goes through
 * check-in, where the round is resolved again — it may be a new re-survey round.
 */
export default function InspectionEntry() {
  const { caseRef } = useLocalSearchParams<{ caseRef: string }>();
  const round = localRound(caseRef);
  const step = round?.step ?? 'check-in';
  const arrived = hasArrived(readCheckIn(caseRef, round?.inspectionRef ?? null));
  const target = step === 'done' || !arrived ? 'check-in' : step;
  return <Redirect href={{ pathname: `/inspection/[caseRef]/${target}`, params: { caseRef } }} />;
}
