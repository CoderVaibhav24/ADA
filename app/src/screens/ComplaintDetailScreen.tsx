import { useLocalSearchParams, useRouter } from 'expo-router';
import { StyleSheet, View } from 'react-native';

import {
  Button,
  Chip,
  DetailScreenTemplate,
  DistanceMeta,
  Icon,
  InProgressBlock,
  ListRow,
  SectionCard,
  Skeleton,
  StateMessage,
  Text,
  layout,
  space,
} from '@/design-system';
import { CasePriorityChip, CaseStatusChip } from '@/design-system/organisms/ComplaintCard';
import { EvidenceStrip } from '@/design-system/organisms/EvidenceStrip';
import {
  caseCoordinates,
  useCaseDetail,
  useResurveyRequests,
  type CaseDetail,
  type ResurveyRequest,
} from '@/services/api/case-reads';
import { errorText, isNotFound } from '@/services/api/error-text';
import {
  useCaseInspections,
  useInspectionDetail,
  type InspectionDetail,
  type InspectionRow,
} from '@/services/api/inspection-reads';
import { dataAge } from '@/services/api/query-client';
import { useCapabilities } from '@/services/config/capabilities';
import { LABEL_DOMAINS, useCodeLabel } from '@/services/config/labels';
import { fieldEntryFor } from '@/services/config/work-statuses';
import { formatAge, formatArea, formatDateTime } from '@/services/format/datetime';
import { haversineMeters, useLastKnownPosition } from '@/services/location/last-known';

/*
 * Complaint Detail — `174:4991`, `195:2657` and `202:3867` are one screen with two
 * entry points. `from` names the list it was opened from; only the back action
 * differs.
 *
 *   GET /api/icms/cases/{case_ref}
 *   GET /api/icms/inspections?case_ref={case_ref}    the case's rounds
 *   GET /api/icms/inspections/{ref}/evidence         per round, in EvidenceStrip
 *   GET /api/icms/evidence/{id}/content              the bytes, with the bearer
 *   GET /api/icms/inspections/{ref}                  the latest submitted round's findings
 *   GET /api/icms/cases/{case_ref}/resurvey-requests
 *
 * The map thumbnail is in progress: there is no static tile endpoint for a parcel.
 * "Start Ground Inspection" appears only when the case's own `allowed_actions` holds
 * an action the capabilities say opens or runs the round.
 */
type Origin = 'complaints' | 'inspections' | 'home';

const BACK: Record<Origin, { label: string; href: '/complaints' | '/inspections' | '/home' }> = {
  complaints: { label: 'Back to Complaints', href: '/complaints' },
  inspections: { label: 'Back to Inspection List', href: '/inspections' },
  home: { label: 'Back to Home', href: '/home' },
};

// The entry point, from the route param; anything unrecognised returns to Complaints.
function originOf(value: string | string[] | undefined): Origin {
  return value === 'inspections' || value === 'home' ? value : 'complaints';
}

type RowSpec = { label: string; value: string | null | undefined; mono?: boolean };

// ListRows for the values the payload carries; an absent value is left out, not blanked.
function Rows({ rows }: { rows: readonly RowSpec[] }) {
  const present = rows.filter(
    (row): row is RowSpec & { value: string } => typeof row.value === 'string' && row.value !== '',
  );
  return (
    <>
      {present.map((row, index) => (
        <ListRow
          key={row.label}
          label={row.label}
          value={row.value}
          monospaceValue={row.mono === true}
          showDivider={index < present.length - 1}
        />
      ))}
    </>
  );
}

// "Yes" / "No" for a recorded boolean; null when nothing was recorded.
function yesNo(value: boolean | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  return value ? 'Yes' : 'No';
}

// The case's own facts: what, where, when, how big, and how far from the last known fix.
function OverviewCard({ detail }: { detail: CaseDetail }) {
  const propertyType = useCodeLabel(LABEL_DOMAINS.propertyType);
  const coordinates = caseCoordinates(detail);
  const position = useLastKnownPosition(coordinates !== null);
  const distance =
    coordinates !== null && position !== null ? haversineMeters(position, coordinates) : null;

  return (
    <SectionCard
      title="Complaint"
      accessory={
        <View style={styles.chips}>
          <CasePriorityChip priority={detail.priority} />
          <CaseStatusChip status={detail.status} />
        </View>
      }
    >
      <Rows
        rows={[
          { label: 'Type', value: detail.complaint_type_label ?? detail.other_type },
          { label: 'Parcel', value: detail.parcel_id, mono: true },
          { label: 'Khasra', value: detail.khasra_no, mono: true },
          { label: 'ULPIN', value: detail.ulpin, mono: true },
          { label: 'Zone', value: detail.zone_name },
          { label: 'Address', value: detail.property_address },
          { label: 'Landmark', value: detail.landmark },
          { label: 'Police station', value: detail.police_station },
          { label: 'District', value: detail.district },
          { label: 'PIN code', value: detail.pin_code, mono: true },
          {
            label: 'Property type',
            value: detail.property_type_cd ? propertyType(detail.property_type_cd) : null,
          },
          {
            label: 'Floors',
            value:
              detail.floor_count === null || detail.floor_count === undefined
                ? null
                : String(detail.floor_count),
          },
          { label: 'Measured area', value: formatArea(detail.measured_area_sqm) },
          { label: 'Raised', value: formatDateTime(detail.raised_at) },
        ]}
      />
      {distance !== null ? <DistanceMeta distanceMeters={distance} stale /> : null}
    </SectionCard>
  );
}

// Who complained, as far as the case records it.
function ComplainantCard({ detail }: { detail: CaseDetail }) {
  const recorded = detail.complainant_name ?? detail.complainant_phone ?? detail.complainant_email;
  return (
    <SectionCard title="Complainant">
      {recorded ? (
        <Rows
          rows={[
            { label: 'Name', value: detail.complainant_name },
            { label: 'Phone', value: detail.complainant_phone, mono: true },
            { label: 'Email', value: detail.complainant_email, mono: true },
          ]}
        />
      ) : (
        <Text variant="body" color="ink3">
          No complainant details are recorded on this case.
        </Text>
      )}
    </SectionCard>
  );
}

// One round with its evidence strip. Append-only: nothing here removes a capture.
function RoundBlock({ round, statusLabel }: { round: InspectionRow; statusLabel: string }) {
  const when = formatDateTime(round.submitted_at ?? round.started_at ?? round.scheduled_for);
  return (
    <View style={styles.block}>
      <View style={styles.inline}>
        <Text variant="subheading" style={styles.flex}>
          {`Round ${round.round_no}`}
        </Text>
        <Chip label={statusLabel} tone="ink2" dot size="sm" />
      </View>
      <Text variant="mono" color="ink2" selectable>
        {round.inspection_ref}
      </Text>
      {when ? (
        <Text variant="caption" color="ink3">
          {when}
        </Text>
      ) : null}
      <EvidenceStrip inspectionRef={round.inspection_ref} />
    </View>
  );
}

// Every round on the case, oldest first, each with what was captured on it.
function RoundsCard({ caseRef }: { caseRef: string }) {
  const rounds = useCaseInspections(caseRef);
  const statusLabel = useCodeLabel(LABEL_DOMAINS.inspectionStatus);

  let body: React.ReactNode;
  if (rounds.isPending) {
    body = <Skeleton height={layout.touchMin * 2} />;
  } else if (rounds.error !== null && rounds.data === undefined) {
    const failure = errorText(rounds.error);
    body = (
      <StateMessage
        tone={failure.offline ? 'offline' : 'error'}
        title="Rounds could not be loaded"
        message={failure.message}
        reference={failure.requestId}
        actionLabel="Try again"
        onAction={() => void rounds.refetch()}
      />
    );
  } else if ((rounds.data ?? []).length === 0) {
    body = (
      <Text variant="body" color="ink3">
        No inspection round has been opened on this case yet.
      </Text>
    );
  } else {
    body = (rounds.data ?? []).map((round) => (
      <RoundBlock
        key={round.inspection_ref}
        round={round}
        statusLabel={statusLabel(round.status)}
      />
    ));
  }

  return <SectionCard title="Submitted evidence">{body}</SectionCard>;
}

// The findings and remark of one submitted round (`195:2657`).
function FindingsCard({ inspection }: { inspection: InspectionDetail }) {
  const areaType = useCodeLabel(LABEL_DOMAINS.areaType);
  const findings = inspection.findings ?? [];
  return (
    <SectionCard title={`Inspection findings · Round ${inspection.round_no}`}>
      <Rows
        rows={[
          { label: 'Submitted', value: formatDateTime(inspection.submitted_at) },
          { label: 'Measured area', value: formatArea(inspection.measured_area_sqm) },
          {
            label: 'Area type',
            value: inspection.area_type_cd ? areaType(inspection.area_type_cd) : null,
          },
          { label: 'Occupant', value: inspection.occupant_name },
          { label: 'Occupant phone', value: inspection.occupant_phone, mono: true },
          { label: 'Notice required', value: yesNo(inspection.notice_required) },
        ]}
      />
      {findings.length > 0 ? (
        <View style={styles.block}>
          <Text variant="label">Findings</Text>
          {findings.map((finding) => (
            <View key={finding.seq} style={styles.inline}>
              <Icon name="check" size="sm" color="ink2" />
              <Text variant="body" style={styles.flex}>
                {finding.finding}
              </Text>
            </View>
          ))}
        </View>
      ) : null}
      {inspection.officer_note ? (
        <View style={styles.block}>
          <Text variant="label">Remark</Text>
          <Text variant="body">{inspection.officer_note}</Text>
        </View>
      ) : null}
    </SectionCard>
  );
}

// The latest round that has been submitted, or null.
function latestSubmitted(rounds: readonly InspectionRow[] | undefined): InspectionRow | null {
  const submitted = (rounds ?? []).filter(
    (round) => round.submitted_at !== null && round.submitted_at !== undefined,
  );
  return submitted.length === 0 ? null : submitted[submitted.length - 1];
}

// Loads the latest submitted round and shows its findings; nothing while no round is submitted.
function LatestFindings({ caseRef }: { caseRef: string }) {
  const rounds = useCaseInspections(caseRef);
  const latest = latestSubmitted(rounds.data);
  const detail = useInspectionDetail(latest?.inspection_ref ?? null);

  if (latest === null) return null;
  if (detail.isPending) {
    return (
      <SectionCard title="Inspection findings">
        <Skeleton height={layout.touchMin * 2} />
      </SectionCard>
    );
  }
  if (detail.error !== null && detail.data === undefined) {
    // Narrowed away from this caller (a reassigned round, or a stale cached reference):
    // this block degrades on its own; the rest of the case still reads fine.
    if (isNotFound(detail.error)) {
      return (
        <SectionCard title="Inspection findings">
          <Text variant="body" color="ink3">
            Not available to you.
          </Text>
        </SectionCard>
      );
    }
    const failure = errorText(detail.error);
    return (
      <SectionCard title="Inspection findings">
        <StateMessage
          tone={failure.offline ? 'offline' : 'error'}
          title="Findings could not be loaded"
          message={failure.message}
          reference={failure.requestId}
          actionLabel="Try again"
          onAction={() => void detail.refetch()}
        />
      </SectionCard>
    );
  }
  return detail.data ? <FindingsCard inspection={detail.data} /> : null;
}

// One re-survey request: why, when, and what was decided.
function ResurveyItem({
  request,
  decisionLabel,
}: {
  request: ResurveyRequest;
  decisionLabel: string;
}) {
  const requested = formatDateTime(request.requested_at);
  return (
    <View style={styles.block}>
      <View style={styles.inline}>
        <Text variant="subheading" style={styles.flex}>
          {`After round ${request.from_round}`}
        </Text>
        <Chip label={decisionLabel} tone="ink2" size="sm" />
      </View>
      <Text variant="body">{request.reason}</Text>
      {requested ? (
        <Text variant="caption" color="ink3">
          {`Requested ${requested}`}
        </Text>
      ) : null}
      {request.decision_note ? (
        <Text variant="body" color="ink2">
          {request.decision_note}
        </Text>
      ) : null}
      {request.resulting_round !== null && request.resulting_round !== undefined ? (
        <Text variant="caption" color="ink3">
          {`Opened round ${request.resulting_round}`}
        </Text>
      ) : null}
    </View>
  );
}

// Every re-survey request on the case, newest first; absent when there are none.
function ResurveyCard({ caseRef }: { caseRef: string }) {
  const requests = useResurveyRequests(caseRef);
  const decisionLabel = useCodeLabel(LABEL_DOMAINS.resurveyDecision);

  if (requests.isPending) {
    return (
      <SectionCard title="Re-survey requests">
        <Skeleton height={layout.touchMin} />
      </SectionCard>
    );
  }
  if (requests.error !== null && requests.data === undefined) {
    return (
      <SectionCard title="Re-survey requests">
        <Text variant="body" color="ink1" accessibilityRole="alert">
          {errorText(requests.error).message}
        </Text>
      </SectionCard>
    );
  }
  const items = requests.data ?? [];
  if (items.length === 0) return null;
  return (
    <SectionCard title="Re-survey requests">
      {items.map((request) => (
        <ResurveyItem
          key={request.id}
          request={request}
          decisionLabel={decisionLabel(request.decision)}
        />
      ))}
    </SectionCard>
  );
}

export function ComplaintDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ caseRef: string; from?: string }>();
  const caseRef = typeof params.caseRef === 'string' ? params.caseRef : '';
  const origin = originOf(params.from);
  const back = BACK[origin];

  const detail = useCaseDetail(caseRef);
  const capabilities = useCapabilities();
  const rounds = useCaseInspections(caseRef);
  const resurvey = useResurveyRequests(caseRef);

  // Returns to the list the screen was opened from.
  const onBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace(back.href);
  };

  // Refetches the case and everything hanging off it.
  const onRefresh = () => {
    void detail.refetch();
    void rounds.refetch();
    void resurvey.refetch();
    void capabilities.refetch();
  };

  const entry = detail.data
    ? fieldEntryFor(capabilities.data, detail.data.allowed_actions, detail.data.status)
    : null;

  const age = dataAge(detail.dataUpdatedAt);
  const freshness =
    age.isStale && age.fetchedAt ? `Updated ${formatAge(age.fetchedAt) ?? ''}` : undefined;

  let body: React.ReactNode;
  if (detail.isPending) {
    body = (
      <>
        <Skeleton height={layout.touchMin * 3} shape="md" />
        <Skeleton height={layout.touchMin * 4} shape="md" />
        <Skeleton height={layout.touchMin * 2} shape="md" />
      </>
    );
  } else if (detail.error !== null && detail.data === undefined) {
    const failure = errorText(detail.error);
    body = (
      <StateMessage
        tone={failure.offline ? 'offline' : 'error'}
        title="This complaint could not be loaded"
        message={failure.message}
        reference={failure.requestId}
        actionLabel="Try again"
        onAction={() => void detail.refetch()}
      />
    );
  } else if (detail.data) {
    const data = detail.data;
    body = (
      <>
        {detail.error !== null ? (
          <Text variant="caption" color="statusOverdue" accessibilityRole="alert">
            {errorText(detail.error).message}
          </Text>
        ) : null}
        <InProgressBlock title="Parcel map" />
        <OverviewCard detail={data} />
        <ComplainantCard detail={data} />
        <SectionCard title="Description">
          <Text variant="body" color={data.detail ? 'ink1' : 'ink3'}>
            {data.detail ?? 'No description is recorded on this case.'}
          </Text>
        </SectionCard>
        <RoundsCard caseRef={caseRef} />
        <LatestFindings caseRef={caseRef} />
        <ResurveyCard caseRef={caseRef} />
      </>
    );
  }

  return (
    <DetailScreenTemplate
      title="Complaint Details"
      onBack={onBack}
      backAccessibilityLabel={back.label}
      subtitle={
        caseRef !== '' ? (
          <Text variant="mono" color="ink2" selectable>
            {caseRef}
          </Text>
        ) : undefined
      }
      freshnessLabel={freshness}
      onRefresh={onRefresh}
      refreshing={detail.isRefetching}
      footer={
        entry !== null ? (
          <Button
            label={entry.kind === 'start' ? 'Start Ground Inspection' : 'Continue Ground Inspection'}
            size="lg"
            onPress={() =>
              router.push({ pathname: '/inspection/[caseRef]', params: { caseRef } })
            }
            leadingIcon={<Icon name="navigate" size="md" color="inkOnMuted" />}
          />
        ) : origin === 'inspections' ? (
          <Button label={back.label} variant="secondary" onPress={onBack} />
        ) : undefined
      }
    >
      {body}
    </DetailScreenTemplate>
  );
}

const styles = StyleSheet.create({
  chips: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  inline: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  flex: { flex: 1 },
  block: { gap: space[2], paddingTop: space[2] },
});
