import { Redirect, useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import { useEffect } from 'react';

import { CheckInPanel } from '@/design-system/organisms/CheckInPanel';
import { useT } from '@/services/i18n';
import { caseCoordinates, useCaseDetail } from '@/services/api/case-reads';
import { useInspectionRound, useRoundSync } from '@/services/inspection/queries';
import { isWorkable, rememberStep, roundNotice, roundRefused } from '@/services/inspection/rounds';

import { WizardFrame } from './inspection/WizardFrame';

// Step 1 of 4 (`179:5884`). Opens or resumes the round, then records arrival at the site.
export function InspectionCheckInScreen() {
  const { caseRef } = useLocalSearchParams<{ caseRef: string }>();
  const t = useT();
  const router = useRouter();
  const navigation = useNavigation();
  const round = useInspectionRound(caseRef);
  const caseDetail = useCaseDetail(caseRef);
  const inspectionRef = round.data?.inspectionRef ?? null;

  useRoundSync(caseRef, inspectionRef);
  useEffect(() => {
    rememberStep(caseRef, 'check-in');
  }, [caseRef, inspectionRef]);

  // A round that is already submitted is shown as such, never reopened from here.
  if (round.data !== undefined && !round.isPlaceholderData && !isWorkable(round.data.status)) {
    return <Redirect href={{ pathname: '/inspection/[caseRef]/done', params: { caseRef } }} />;
  }

  const refused = roundRefused(round.data, round.error);
  const place = caseDetail.data?.landmark ?? caseDetail.data?.zone_name ?? null;

  return (
    <WizardFrame
      caseRef={caseRef}
      step={1}
      title={t('checkin.title')}
      body={place ? t('checkin.body', { caseRef, place }) : t('checkin.bodyNoPlace', { caseRef })}
      bodyColor="stepBodyCheckIn"
      notice={roundNotice(round.data, round.error, round.isPlaceholderData)}
      onRetryRound={() => void round.refetch()}
      onBack={() => navigation.getParent()?.goBack()}
    >
      {refused ? null : (
        <CheckInPanel
          caseRef={caseRef}
          inspectionRef={inspectionRef}
          site={caseCoordinates(caseDetail.data)}
          onArrived={() => router.push({ pathname: '/inspection/[caseRef]/photos', params: { caseRef } })}
        />
      )}
    </WizardFrame>
  );
}
