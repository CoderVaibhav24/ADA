import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { BackHandler, StyleSheet, View } from 'react-native';

import {
  Button,
  DetailScreenTemplate,
  Icon,
  InProgressBlock,
  ListRow,
  SectionCard,
  Skeleton,
  StateMessage,
  Text,
  control,
  space,
} from '@/design-system';
import { useCaseDetail } from '@/services/api/case-reads';
import { errorText } from '@/services/api/error-text';
import { useInspectionDetail } from '@/services/api/inspection-reads';
import { LABEL_DOMAINS, useCodeLabel } from '@/services/config/labels';
import { formatArea, formatDateTime } from '@/services/format/datetime';
import { useInspectionRound } from '@/services/inspection/queries';

// Shown once the office has the submission (`193:1534`); every value is the server's.
export function InspectionDoneScreen() {
  const { caseRef } = useLocalSearchParams<{ caseRef: string }>();
  const router = useRouter();
  const round = useInspectionRound(caseRef);
  const inspectionRef = round.data?.inspectionRef ?? null;
  const detail = useInspectionDetail(inspectionRef);
  const caseDetail = useCaseDetail(caseRef);
  const inspectionStatusLabel = useCodeLabel(LABEL_DOMAINS.inspectionStatus);
  const caseStatusLabel = useCodeLabel(LABEL_DOMAINS.caseStatus);

  const backToComplaints = useCallback(() => router.dismissTo('/complaints'), [router]);

  // The submitted round is not a step to go back into; hardware back leaves for the list.
  useEffect(() => {
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      backToComplaints();
      return true;
    });
    return () => subscription.remove();
  }, [backToComplaints]);

  const inspection = detail.data;
  const submitted = inspection?.submitted_at !== null && inspection?.submitted_at !== undefined;

  return (
    <DetailScreenTemplate
      title="Inspection Submitted"
      onBack={backToComplaints}
      backAccessibilityLabel="Back to Complaints"
      subtitle={
        <Text variant="mono" color="ink2" selectable>
          {inspectionRef === null ? caseRef : `${caseRef} · ${inspectionRef}`}
        </Text>
      }
      footer={
        <View style={styles.footer}>
          <Button label="Back to Complaints" onPress={backToComplaints} />
          <InProgressBlock title="View Full Report" />
        </View>
      }
    >
      {inspection === undefined ? (
        detail.isError ? (
          <StateMessage
            tone={errorText(detail.error).offline ? 'offline' : 'error'}
            title="The submitted round could not be read"
            message={errorText(detail.error).message}
            reference={errorText(detail.error).requestId}
            actionLabel="Try again"
            onAction={() => void detail.refetch()}
          />
        ) : (
          <Skeleton height={control.textAreaMinHeight} shape="md" />
        )
      ) : (
        <View style={styles.stack}>
          <View style={styles.row}>
            <Icon name="success" size="xl" color={submitted ? 'syncClear' : 'priorityMedium'} />
            <View style={styles.flex}>
              <Text variant="heading" color="ink0">
                {submitted ? 'Received by the office' : inspectionStatusLabel(inspection.status)}
              </Text>
              <Text variant="caption" color="ink2">
                {submitted
                  ? `Submitted ${formatDateTime(inspection.submitted_at) ?? ''}. It now waits for the Nodal Officer's confirmation.`
                  : `The round is ${inspectionStatusLabel(inspection.status).toLowerCase()} on the server.`}
              </Text>
            </View>
          </View>

          <SectionCard title="Inspection">
            <ListRow label="Inspection" value={inspection.inspection_ref} monospaceValue showDivider />
            <ListRow label="Round" value={String(inspection.round_no)} showDivider />
            <ListRow
              label="Parcel"
              value={
                caseDetail.data !== undefined
                  ? (caseDetail.data.parcel_id ?? 'No parcel recorded on the case')
                  : caseDetail.isError
                    ? `Could not be read: ${errorText(caseDetail.error).message}`
                    : 'Reading the case…'
              }
              monospaceValue={caseDetail.data?.parcel_id !== undefined && caseDetail.data.parcel_id !== null}
              showDivider
            />
            <ListRow label="Measured area" value={formatArea(inspection.measured_area_sqm) ?? 'Not recorded'} showDivider />
            <ListRow label="Case status" value={caseStatusLabel(inspection.case_status)} />
          </SectionCard>

          <InProgressBlock title="Recommendation" />
        </View>
      )}
    </DetailScreenTemplate>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[4] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  flex: { flex: 1 },
  footer: { gap: space[3] },
});
