import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';

import { PhotoGrid, type PhotoGate } from '@/design-system/organisms/PhotoGrid';
import { ActionRow, Glyph, WButton } from '@/design-system/organisms/wizard/kit';
import { useAppConfig } from '@/services/config/use-app-config';
import { useT } from '@/services/i18n';
import { useInspectionRound, useRoundSync } from '@/services/inspection/queries';
import { rememberStep, roundNotice } from '@/services/inspection/rounds';

import { WizardFrame } from './inspection/WizardFrame';

// Step 2 of 4 (`179:6402`). Captures land on the device first and upload in the background.
export function InspectionPhotosScreen() {
  const { caseRef } = useLocalSearchParams<{ caseRef: string }>();
  const t = useT();
  const router = useRouter();
  const { config } = useAppConfig();
  const round = useInspectionRound(caseRef);
  const inspectionRef = round.data?.inspectionRef ?? null;
  const [gate, setGate] = useState<PhotoGate>({ ready: false, missing: config.minimumPhotoCount });
  const onGateChange = useCallback((next: PhotoGate) => setGate(next), []);

  useRoundSync(caseRef, inspectionRef);
  useEffect(() => {
    rememberStep(caseRef, 'photos');
  }, [caseRef, inspectionRef]);

  const back = () => router.dismissTo({ pathname: '/inspection/[caseRef]/check-in', params: { caseRef } });

  return (
    <WizardFrame
      caseRef={caseRef}
      step={2}
      title={t('photos.title')}
      body={t('photos.body', { min: config.minimumPhotoCount })}
      bodyColor="stepBodyPhotos"
      notice={roundNotice(round.data, round.error, round.isPlaceholderData)}
      onRetryRound={() => void round.refetch()}
      onBack={back}
    >
      <PhotoGrid caseRef={caseRef} inspectionRef={inspectionRef} onGateChange={onGateChange} />
      <ActionRow>
        <WButton label={t('common.back')} variant="secondary" onPress={back} leading={<Glyph name="chevronLeft" />} />
        <WButton
          label={t('common.next')}
          onPress={() => router.push({ pathname: '/inspection/[caseRef]/findings', params: { caseRef } })}
          disabled={!gate.ready}
          trailing={<Glyph name="chevronRight" />}
        />
      </ActionRow>
    </WizardFrame>
  );
}
