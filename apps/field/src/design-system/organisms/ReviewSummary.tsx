/**
 * ReviewSummary — step 4 (`187:875`). What will be submitted, read-only.
 *
 * A submit sends nothing but its key: the server submits the round it holds. So this
 * summary is built from `GET /api/icms/inspections/{ref}` — the round as the office
 * has it — and from what is stored on the device and not yet sent, which is called
 * out as missing rather than carried (ui-rules.md §5, code-standards.md §5). Nothing
 * here reads form state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { errorText } from '@/services/api/error-text';
import { useInspectionDetail } from '@/services/api/inspection-reads';
import { LABEL_DOMAINS, useCodeLabel } from '@/services/config/labels';
import { useAppConfig } from '@/services/config/use-app-config';
import { formatArea, formatDateTime } from '@/services/format/datetime';
import {
  draftText,
  hasUnsentFindings,
  readFindingsDraft,
  sendFindings,
  splitFindings,
} from '@/services/inspection/findings';
import { useCheckInRecord, useRoundCaptures } from '@/services/inspection/queries';
import { syncRound } from '@/services/inspection/sync';

import { Button, Icon, Skeleton, Text, type IconName } from '../atoms';
import { InProgressBlock, ListRow, SectionCard, StateMessage } from '../molecules';
import { colors, control, radius, space, type ColorToken, type LayoutStyle } from '../tokens';

export type ReviewGate = { readonly ready: boolean; readonly reason: string | null };

export type ReviewSummaryProps = {
  caseRef: string;
  inspectionRef: string;
  /** Tells the screen whether Submit may enable, and if not, why. Pass a stable function. */
  onGateChange: (gate: ReviewGate) => void;
  style?: LayoutStyle;
};

// A one-line status with an icon, for "received" and "not yet sent" states.
function StatusLine({ icon, tone, text }: { icon: IconName; tone: ColorToken; text: string }) {
  return (
    <View style={styles.row}>
      <Icon name={icon} size="sm" color={tone} />
      <Text variant="caption" color={tone} style={styles.flex}>
        {text}
      </Text>
    </View>
  );
}

// "Yes" / "No" / "Not recorded" for the round's boolean.
function yesNo(value: boolean | null | undefined): string {
  if (value === true) return 'Yes';
  if (value === false) return 'No';
  return 'Not recorded';
}

// Step 4: the round as the office holds it, plus anything still on the device.
export function ReviewSummary({ caseRef, inspectionRef, onGateChange, style }: ReviewSummaryProps) {
  const { config } = useAppConfig();
  const detail = useInspectionDetail(inspectionRef);
  const { refetch } = detail;
  const areaLabel = useCodeLabel('area_type');
  const caseStatusLabel = useCodeLabel(LABEL_DOMAINS.caseStatus);
  const inspectionStatusLabel = useCodeLabel(LABEL_DOMAINS.inspectionStatus);
  const checkIn = useCheckInRecord(caseRef, inspectionRef);
  const captures = useRoundCaptures(caseRef, inspectionRef);
  const [syncing, setSyncing] = useState(false);
  const [findingsError, setFindingsError] = useState<string | null>(null);
  // Bumped after a send so the draft-versus-server comparison is read again.
  const [, setDraftVersion] = useState(0);

  // Sends what the device holds — check-in, photographs, findings — then re-reads the round.
  const sendHeld = useCallback(async () => {
    setSyncing(true);
    setFindingsError(null);
    try {
      await syncRound(caseRef);
      if (hasUnsentFindings(caseRef)) {
        try {
          await sendFindings(caseRef, inspectionRef);
        } catch (error) {
          setFindingsError(errorText(error).message);
        }
      }
      await refetch();
    } finally {
      setSyncing(false);
      setDraftVersion((version) => version + 1);
    }
  }, [caseRef, inspectionRef, refetch]);

  // Once per round on arrival; after that, sends are the surveyor's "Send findings now".
  const sentFor = useRef<string | null>(null);
  useEffect(() => {
    if (sentFor.current === inspectionRef) return;
    sentFor.current = inspectionRef;
    void sendHeld();
  }, [inspectionRef, sendHeld]);

  const round = detail.data;
  const draft = readFindingsDraft(caseRef);
  const unsentFindings = hasUnsentFindings(caseRef);
  const serverPhotos = (round?.evidence ?? []).filter((row) => row.kind === 'photo');
  const cameraPhotos = serverPhotos.filter((row) => row.capture_source === 'camera');
  const flaggedPhotos = serverPhotos.filter((row) => row.geotag_flagged);
  const unsentCaptures = captures.filter((record) => record.state !== 'uploaded');
  const failedCaptures = captures.filter((record) => record.state === 'failed');
  const serverCheckIns = round?.check_ins ?? [];
  const lastCheckIn = serverCheckIns.length > 0 ? serverCheckIns[serverCheckIns.length - 1] : null;
  const findings = round?.findings ?? [];
  const minimum = config.minimumPhotoCount;

  // The first thing standing between this round and a submit, in the order a surveyor fixes them.
  let reason: string | null = null;
  if (round === undefined) {
    reason = detail.isError
      ? `The round could not be read from the server: ${errorText(detail.error).message}`
      : 'Reading the round from the server.';
  } else if (!(round.available_actions ?? []).includes('submit')) {
    reason = `The server does not offer Submit for this case while it is ${caseStatusLabel(round.case_status).toLowerCase()}.`;
  } else if (lastCheckIn === null) {
    reason =
      checkIn?.state === 'held'
        ? 'Your arrival is saved on this device but has not reached the office yet.'
        : 'There is no check-in on this round. Go back to Check-in.';
  } else if (unsentCaptures.length > 0) {
    reason = `${unsentCaptures.length} photograph${unsentCaptures.length === 1 ? ' has' : 's have'} not reached the office yet.`;
  } else if (cameraPhotos.length < minimum) {
    reason = `The office holds ${cameraPhotos.length} of the ${minimum} photographs needed.`;
  } else if (unsentFindings) {
    reason = 'Your latest findings are on this device but have not reached the office yet.';
  } else if (findings.length === 0) {
    reason = 'The office holds no findings for this round. Go back to Findings.';
  }
  const ready = reason === null;
  useEffect(() => {
    onGateChange({ ready, reason });
  }, [onGateChange, ready, reason]);

  if (round === undefined) {
    if (detail.isError) {
      const text = errorText(detail.error);
      return (
        <StateMessage
          tone={text.offline ? 'offline' : 'error'}
          title={text.offline ? 'No signal' : 'The round could not be read'}
          message={
            text.offline
              ? 'The review is built from what the office holds, so it needs the server. Everything you captured is safe on this device.'
              : text.message
          }
          reference={text.requestId}
          actionLabel="Try again"
          onAction={() => void sendHeld()}
          style={style}
        />
      );
    }
    return (
      <View style={[styles.stack, style]}>
        <Skeleton height={control.textAreaMinHeight} shape="md" />
        <Skeleton height={control.textAreaMinHeight} shape="md" />
      </View>
    );
  }

  return (
    <View style={[styles.stack, style]}>
      {syncing ? (
        <StatusLine icon="sync" tone="syncPending" text="Sending what is held on this device, then re-reading the round…" />
      ) : null}

      <SectionCard title="Round">
        <ListRow label="Inspection" value={round.inspection_ref} monospaceValue showDivider />
        <ListRow label="Case" value={round.case_ref} monospaceValue showDivider />
        <ListRow label="Round" value={String(round.round_no)} showDivider />
        <ListRow label="Status" value={inspectionStatusLabel(round.status)} />
      </SectionCard>

      <SectionCard title="Check-in">
        {lastCheckIn !== null ? (
          <>
            <StatusLine icon="success" tone="syncClear" text="Received by the office" />
            {typeof lastCheckIn.lat === 'number' && typeof lastCheckIn.lon === 'number' ? (
              <ListRow
                label="Position"
                value={`${lastCheckIn.lat.toFixed(6)}, ${lastCheckIn.lon.toFixed(6)}`}
                monospaceValue
                showDivider
              />
            ) : null}
            <ListRow label="Accuracy" value={`±${Math.round(lastCheckIn.accuracy_m)} m`} showDivider />
            <ListRow label="Fix taken" value={formatDateTime(lastCheckIn.device_timestamp) ?? '—'} />
          </>
        ) : checkIn?.state === 'held' ? (
          <StatusLine icon="sync" tone="syncPending" text="Saved on this device — not yet received by the office." />
        ) : (
          <StatusLine icon="warning" tone="statusOverdue" text="Missing — no check-in is recorded for this round." />
        )}
      </SectionCard>

      <SectionCard title="Photographs">
        <ListRow label="Received by the office" value={`${cameraPhotos.length} (minimum ${minimum})`} showDivider />
        {flaggedPhotos.length > 0 ? (
          <StatusLine
            icon="warning"
            tone="priorityMedium"
            text={`${flaggedPhotos.length} flagged by the office for location accuracy.`}
          />
        ) : null}
        {unsentCaptures.length > 0 ? (
          <StatusLine
            icon="sync"
            tone={failedCaptures.length > 0 ? 'syncFailed' : 'syncPending'}
            text={
              failedCaptures.length > 0
                ? `${failedCaptures.length} failed to send. Go back to Photographs to retry them.`
                : `${unsentCaptures.length} still on this device, waiting to send.`
            }
          />
        ) : (
          <StatusLine icon="success" tone="syncClear" text="Nothing waiting on this device." />
        )}
      </SectionCard>

      <SectionCard title="Findings">
        {findings.length > 0 ? (
          findings.map((item) => (
            <Text key={item.seq} variant="body" color="ink0">
              {`${item.seq}. ${item.finding}`}
            </Text>
          ))
        ) : (
          <StatusLine icon="warning" tone="statusOverdue" text="Missing — the office holds no findings for this round." />
        )}
        <ListRow label="Measured area" value={formatArea(round.measured_area_sqm) ?? 'Not recorded'} showDivider />
        <ListRow
          label="Area type"
          value={round.area_type_cd ? areaLabel(round.area_type_cd) : 'Not recorded'}
          showDivider
        />
        <ListRow label="Occupant name" value={round.occupant_name ?? 'Not recorded'} showDivider />
        <ListRow label="Occupant contact" value={round.occupant_phone ?? 'Not recorded'} monospaceValue showDivider />
        <ListRow label="Notice required" value={yesNo(round.notice_required)} showDivider />
        <ListRow label="Remarks" value={round.officer_note ?? 'Not recorded'} />
      </SectionCard>

      {unsentFindings && draft !== null ? (
        <View style={[styles.callout, { borderColor: colors.syncPending }]}>
          <StatusLine
            icon="sync"
            tone="syncPending"
            text={`Edits saved on this device ${formatDateTime(draft.updatedAt) ?? ''} have not reached the office. The summary above is what the office holds.`}
          />
          {splitFindings(draftText(draft.values, 'findings')).map((line, index) => (
            <Text key={`${index}-${line}`} variant="caption" color="ink2">
              {`${index + 1}. ${line}`}
            </Text>
          ))}
          {findingsError !== null ? (
            <Text variant="caption" color="statusOverdue" accessibilityLiveRegion="polite">
              {`Not sent: ${findingsError}`}
            </Text>
          ) : null}
          <Button label="Send findings now" variant="secondary" onPress={() => void sendHeld()} loading={syncing} />
        </View>
      ) : null}

      <InProgressBlock title="Recommendation" />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[4] },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  callout: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.md,
    borderWidth: control.borderWidth,
    backgroundColor: colors.surface1,
  },
});
