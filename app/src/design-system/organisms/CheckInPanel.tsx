/**
 * CheckInPanel — step 1 (`179:5884`). Live coordinates, accuracy and lock state, and
 * Confirm Arrival, which stays disabled below the accuracy threshold with the reason
 * stated: the current accuracy, what is needed and what to do (ui-rules.md §3).
 *
 * The server is the authority — it refuses a poor fix with `poor_accuracy` — and this
 * panel states that refusal in the server's own words rather than spinning.
 * Permission is primed inline before the OS dialog (ui-rules.md §6).
 */

import { useEffect, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';

import { useInspectionDetail } from '@/services/api/inspection-reads';
import { useAppConfig } from '@/services/config/use-app-config';
import { formatDateTime } from '@/services/format/datetime';
import { adoptServerCheckIn, confirmArrival, type CheckInRecord } from '@/services/inspection/check-in';
import { useCheckInRecord } from '@/services/inspection/queries';
import { isWorkable } from '@/services/inspection/rounds';
import {
  judgeFix,
  preciseLocationHowTo,
  useLiveFix,
  useLocationPermission,
  type LiveFix,
} from '@/services/location/live-fix';

import { Button, Icon, Skeleton, Text, type IconName } from '../atoms';
import { GpsReadout, ListRow, SectionCard, type GpsFixState } from '../molecules';
import { colors, control, radius, space, type ColorToken, type LayoutStyle } from '../tokens';

export type StepGate = { readonly ready: boolean; readonly reason: string | null };

export type CheckInPanelProps = {
  caseRef: string;
  /** Null while the round is not yet known on the device; the tap is then held. */
  inspectionRef: string | null;
  /** Tells the screen whether Next may enable, and if not, why. Pass a stable function. */
  onGateChange: (gate: StepGate) => void;
  style?: LayoutStyle;
};

// A bordered callout: icon, title, body and an optional action.
function Callout({
  icon,
  tone,
  title,
  body,
  children,
}: {
  icon: IconName;
  tone: ColorToken;
  title: string;
  body?: string;
  children?: React.ReactNode;
}) {
  return (
    <View style={[styles.callout, { borderColor: colors[tone] }]} accessibilityRole="summary">
      <View style={styles.row}>
        <Icon name={icon} size="md" color={tone} />
        <Text variant="subheading" color="ink0" style={styles.flex}>
          {title}
        </Text>
      </View>
      {body ? (
        <Text variant="body" color="ink1">
          {body}
        </Text>
      ) : null}
      {children}
    </View>
  );
}

// The readout's state word from the fix and the verdict on it.
function readoutState(fix: LiveFix | null, usable: boolean, failed: boolean): GpsFixState {
  if (failed) return 'none';
  if (fix === null) return 'searching';
  return usable ? 'locked' : 'weak';
}

// What the server said about the fix's position against the case's zone.
function zoneLine(insideZone: boolean | null | undefined): string {
  if (insideZone === true) return 'Inside the case zone';
  if (insideZone === false) return 'Outside the case zone boundary';
  return 'Not checked — the zone has no boundary on the server';
}

// Whether a check-in still held on the device is nearing or past the server's staleness limit.
function expiryCaption(deviceTimestamp: string, maxAgeHours: number, now: number): string | null {
  const takenAt = Date.parse(deviceTimestamp);
  if (Number.isNaN(takenAt)) return null;
  const remainingHours = maxAgeHours - (now - takenAt) / 3_600_000;
  if (remainingHours <= 0) {
    return 'Past the office’s time limit — it will be refused when it sends. Confirm arrival again for a fresh fix.';
  }
  if (remainingHours <= 1) {
    return 'Expires within the hour — send it soon, or confirm arrival again for a fresh fix.';
  }
  return null;
}

// The confirmed check-in, from the server's record of it.
function ConfirmedCheckIn({ record, gateM }: { record: CheckInRecord; gateM: number }) {
  const confirmed = record.confirmed;
  const accuracy = confirmed?.accuracy_m ?? record.accuracyM;
  const lat = confirmed?.lat ?? record.latitude;
  const lon = confirmed?.lon ?? record.longitude;
  return (
    <SectionCard title="Checked in">
      <View style={styles.row}>
        <Icon name="success" size="md" color="syncClear" />
        <Text variant="subheading" color="syncClear">
          Received by the office
        </Text>
      </View>
      {lat !== null && lon !== null ? (
        <ListRow label="Position" value={`${lat.toFixed(6)}, ${lon.toFixed(6)}`} monospaceValue showDivider />
      ) : null}
      <ListRow
        label="Accuracy"
        value={`±${Math.round(accuracy)} m (limit ±${Math.round(gateM)} m)`}
        showDivider
      />
      <ListRow
        label="Fix taken"
        value={formatDateTime(confirmed?.device_timestamp ?? record.deviceTimestamp) ?? '—'}
        showDivider
      />
      <ListRow label="Recorded by server" value={formatDateTime(confirmed?.server_timestamp) ?? '—'} showDivider />
      <ListRow label="Zone" value={zoneLine(confirmed?.inside_zone)} />
    </SectionCard>
  );
}

// Step 1: the accuracy gate. Blocks below threshold with the reason stated on screen.
export function CheckInPanel({ caseRef, inspectionRef, onGateChange, style }: CheckInPanelProps) {
  const { config } = useAppConfig();
  const gateM = config.gpsAccuracyGateM;
  const flagM = config.gpsAccuracyFlagM;
  const permission = useLocationPermission();
  const record = useCheckInRecord(caseRef, inspectionRef);
  const detail = useInspectionDetail(inspectionRef);

  const confirmed = record?.state === 'confirmed';
  const live = useLiveFix(permission.status === 'granted' && !confirmed);
  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState(false);

  // The fix's age is judged every second, so a watch that goes quiet stops being "live".
  useEffect(() => {
    if (confirmed) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [confirmed]);

  // A check-in the server already holds (resumed round) is adopted rather than repeated.
  const serverCheckIns = detail.data?.check_ins ?? [];
  const latestServerCheckIn = serverCheckIns.length > 0 ? serverCheckIns[serverCheckIns.length - 1] : null;
  const workable = detail.data !== undefined && isWorkable(detail.data.status);
  useEffect(() => {
    if (workable && latestServerCheckIn !== null && record?.state !== 'confirmed') {
      adoptServerCheckIn(caseRef, latestServerCheckIn);
    }
  }, [caseRef, latestServerCheckIn, record?.state, workable]);

  const verdict = judgeFix(live.fix, gateM, config.gpsFixMaxAgeMs, now);
  // Usable but coarser than the flag threshold: allowed, but the office will see it as low-accuracy.
  const flaggedAccuracyM =
    verdict.usable && live.fix !== null && live.fix.accuracyM !== null && live.fix.accuracyM > flagM
      ? live.fix.accuracyM
      : null;
  // A held check-in ages toward the server's device_timestamp limit while it waits to send.
  const heldExpiry =
    record?.state === 'held'
      ? expiryCaption(record.deviceTimestamp, config.deviceTimestampMaxAgeHours, now)
      : null;

  const ready = record?.state === 'confirmed' || record?.state === 'held';
  // Granted, but approximate only: every fix is ~km, so it would fail the gate with a confusing number.
  const approximateOnly = permission.status === 'granted' && (permission.precise === false || live.approximate);
  const reason = ready
    ? null
    : permission.status === 'denied'
      ? 'Location permission is off, so arrival cannot be recorded.'
      : approximateOnly
        ? 'Precise location is off, so arrival cannot be recorded.'
        : 'Confirm your arrival at the property to continue.';
  useEffect(() => {
    onGateChange({ ready, reason });
  }, [onGateChange, ready, reason]);

  const onConfirm = async () => {
    const fix = live.fix;
    if (!verdict.usable || fix === null || fix.accuracyM === null) return;
    setSending(true);
    try {
      await confirmArrival(caseRef, inspectionRef, {
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracyM: fix.accuracyM,
        timestamp: fix.timestamp,
      });
    } finally {
      setSending(false);
    }
  };

  if (record?.state === 'confirmed') {
    return (
      <View style={[styles.stack, style]}>
        <ConfirmedCheckIn record={record} gateM={gateM} />
      </View>
    );
  }

  if (permission.status === 'checking') {
    return <Skeleton height={control.textAreaMinHeight} shape="lg" style={style} />;
  }

  if (permission.status === 'undetermined') {
    return (
      <View style={[styles.stack, style]}>
        <Callout
          icon="location"
          tone="brand"
          title="Location is needed to check in"
          body={
            'ICMS records where each check-in and photograph was taken so the inspection can ' +
            'be verified later. Your position is read only while an inspection step is open.'
          }
        >
          <Button
            label="Allow location"
            onPress={() => void permission.request()}
            accessibilityHint="Shows the system permission dialog"
          />
        </Callout>
      </View>
    );
  }

  if (permission.status === 'denied') {
    return (
      <View style={[styles.stack, style]}>
        <Callout
          icon="warning"
          tone="statusOverdue"
          title="Location is off for ICMS"
          body={
            'Arrival cannot be recorded without your position, and photographs need it too. ' +
            (permission.canAskAgain
              ? 'Allow location to continue.'
              : 'Turn on location for ICMS in the system settings, then come back here.')
          }
        >
          {permission.canAskAgain ? (
            <Button label="Allow location" onPress={() => void permission.request()} />
          ) : (
            <Button label="Open settings" variant="secondary" onPress={permission.openSettings} />
          )}
        </Callout>
      </View>
    );
  }

  if (approximateOnly) {
    // Android 12+ re-asks with an upgrade-to-precise dialog; iOS only changes it in Settings.
    const canUpgradeInApp = Platform.OS === 'android' && permission.canAskAgain;
    return (
      <View style={[styles.stack, style]}>
        <Callout
          icon="warning"
          tone="statusOverdue"
          title="Precise location is needed"
          body={
            'ICMS has been given only your approximate location, which is accurate to about a ' +
            `kilometre. A check-in must be accurate to ±${Math.round(gateM)} m, so arrival cannot ` +
            'be recorded. ' +
            (canUpgradeInApp ? 'Tap Allow precise location, or turn it on in Settings.' : preciseLocationHowTo())
          }
        >
          {canUpgradeInApp ? (
            <Button label="Allow precise location" onPress={() => void permission.request()} />
          ) : null}
          <Button label="Open settings" variant="secondary" onPress={permission.openSettings} />
        </Callout>
      </View>
    );
  }

  return (
    <View style={[styles.stack, style]}>
      {live.servicesEnabled === false ? (
        <Callout
          icon="offline"
          tone="statusOverdue"
          title="Location services are switched off"
          body="Turn on Location in the handset's quick settings. This screen picks up the fix as soon as it is on."
        />
      ) : null}

      <GpsReadout
        state={readoutState(live.fix, verdict.usable, live.error !== null)}
        latitude={live.fix?.latitude}
        longitude={live.fix?.longitude}
        accuracyMeters={live.fix?.accuracyM ?? undefined}
        thresholdMeters={gateM}
        capturedAtLabel={
          live.fix ? (formatDateTime(new Date(live.fix.timestamp).toISOString()) ?? undefined) : undefined
        }
      />

      {flaggedAccuracyM !== null ? (
        <Text variant="caption" color="priorityMedium" accessibilityLiveRegion="polite">
          {`Accuracy is ±${Math.round(flaggedAccuracyM)} m. This location will be recorded as low accuracy — you can still confirm arrival.`}
        </Text>
      ) : null}

      {live.error !== null ? (
        <Text variant="caption" color="statusOverdue" accessibilityLiveRegion="polite">
          {`The position could not be read: ${live.error}`}
        </Text>
      ) : null}

      {record?.state === 'held' ? (
        <Callout
          icon="sync"
          tone="syncPending"
          title="Arrival saved on this device — not yet received by the office"
          body={
            (record.error?.message ?? 'It will be sent as soon as the inspection round is open.') +
            ' It is sent automatically when you have signal; you can carry on meanwhile.'
          }
        >
          {heldExpiry !== null ? (
            <Text variant="caption" color="priorityMedium" accessibilityLiveRegion="polite">
              {heldExpiry}
            </Text>
          ) : null}
        </Callout>
      ) : null}

      {record?.state === 'refused' && record.error !== null ? (
        <Callout
          icon="alert"
          tone="statusOverdue"
          title={record.error.code === 'poor_accuracy' ? 'The office refused this fix' : 'Check-in was not accepted'}
          body={`${record.error.message} (${record.error.code})`}
        >
          <Text variant="caption" color="ink2">
            {record.error.code === 'poor_accuracy'
              ? 'Wait for the accuracy reading above to improve, then confirm again.'
              : 'Nothing was recorded. Resolve the problem above, then confirm again.'}
          </Text>
        </Callout>
      ) : null}

      {record?.state !== 'held' ? (
        <View style={styles.stack}>
          <Button
            label="Confirm Arrival"
            onPress={() => void onConfirm()}
            disabled={!verdict.usable}
            loading={sending}
            leadingIcon={<Icon name="location" size="md" color="inkOnMuted" />}
            accessibilityHint="Records that you are at the property, with this position and time"
          />
          {!verdict.usable ? (
            <Text variant="caption" color="priorityMedium" accessibilityLiveRegion="polite">
              {verdict.reason}
            </Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[3] },
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
