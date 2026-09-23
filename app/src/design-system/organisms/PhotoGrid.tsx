/**
 * PhotoGrid — step 2 (`179:6402`). The Add Photo tile, the captured photographs with
 * their geo badge and upload state, and the "n/min minimum photos captured" counter.
 * Next stays disabled below the minimum, and the reason is stated (ui-rules.md §4).
 *
 * Only camera captures exist here: there is no gallery path, so nothing from the
 * gallery can count toward the minimum. Remove is offered only while the server
 * cannot hold the photograph; once it may have landed there is no delete control.
 * Camera and location are primed inline before the OS dialogs (ui-rules.md §6).
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { useEffect, useRef, useState } from 'react';
import { Alert, Linking, Modal, Pressable, StyleSheet, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useInspectionDetail } from '@/services/api/inspection-reads';
import { useAppConfig } from '@/services/config/use-app-config';
import { formatDateTime } from '@/services/format/datetime';
import { gpsExif, recordPhoto, removePhoto, retryPhoto } from '@/services/inspection/evidence';
import { useRoundCaptures } from '@/services/inspection/queries';
import { judgeFix, useLiveFix, useLocationPermission } from '@/services/location/live-fix';
import { CaptureRejected, isRemovable, type CaptureRecord } from '@/services/storage/captures';
import { useSyncStore } from '@/store/sync-store';

import { Button, Icon, ProgressBar, Text } from '../atoms';
import { GpsReadout, PhotoThumb } from '../molecules';
import {
  colors,
  control,
  disabledOpacity,
  gutter,
  layout,
  radius,
  space,
  type ColorToken,
  type LayoutStyle,
} from '../tokens';

export type PhotoGate = { readonly ready: boolean; readonly reason: string | null };

export type PhotoGridProps = {
  caseRef: string;
  /** Null while the round is not yet known; captures are kept and bound when it is. */
  inspectionRef: string | null;
  /** Tells the screen whether Next may enable, and if not, why. Pass a stable function. */
  onGateChange: (gate: PhotoGate) => void;
  style?: LayoutStyle;
};

const COLUMNS = 3;

// The upload state of one capture, in words, with the tone the sync banner uses.
function uploadState(record: CaptureRecord): { text: string; tone: ColorToken } {
  switch (record.state) {
    case 'uploaded':
      return record.geotagFlagged === true
        ? { text: 'Received — location flagged by the office', tone: 'priorityMedium' }
        : { text: 'Received by the office', tone: 'syncClear' };
    case 'uploading':
      return { text: 'Sending…', tone: 'syncPending' };
    case 'pending':
      return { text: 'On this device — waiting to send', tone: 'syncPending' };
    case 'failed':
      return { text: `Not sent: ${record.lastError ?? 'the upload failed.'}`, tone: 'syncFailed' };
  }
}

// Whether a capture still held on the device is nearing or past the server's staleness limit.
function expiryCaption(deviceTimestamp: string, maxAgeHours: number): string | null {
  const takenAt = Date.parse(deviceTimestamp);
  if (Number.isNaN(takenAt)) return null;
  const remainingHours = maxAgeHours - (Date.now() - takenAt) / 3_600_000;
  if (remainingHours <= 0) {
    return 'Past the office’s time limit — it will be refused on upload. Retake it if possible.';
  }
  if (remainingHours <= 1) {
    return 'Expires within the hour — send it soon, or retake it.';
  }
  return null;
}

// One photograph with its state line, remove (before upload only) and retry (after a failure).
function PhotoTile({ record, size, deviceTimestampMaxAgeHours }: { record: CaptureRecord; size: number; deviceTimestampMaxAgeHours: number }) {
  const state = uploadState(record);
  const removable = isRemovable(record);
  // Only a capture still owed to the server can go stale before it sends.
  const expiry =
    record.state === 'pending' || record.state === 'failed'
      ? expiryCaption(record.geo.deviceTimestamp, deviceTimestampMaxAgeHours)
      : null;
  const onRemove = () =>
    Alert.alert(
      'Remove this photograph?',
      'It has not reached the office, so it is deleted from this device. This cannot be undone.',
      [
        { text: 'Keep', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => void removePhoto(record) },
      ],
    );
  return (
    <View style={[styles.tile, { width: size }]}>
      <PhotoThumb
        uri={record.fileUri}
        size={size}
        source={record.geo.captureSource}
        geotagged
        accuracyMeters={record.geo.accuracyM}
        onRemove={removable ? onRemove : undefined}
        accessibilityLabel={`Photograph taken ${formatDateTime(record.geo.deviceTimestamp) ?? ''}, accuracy ${Math.round(record.geo.accuracyM)} metres. ${state.text}`}
      />
      <Text variant="caption" color={state.tone} numberOfLines={3}>
        {state.text}
      </Text>
      {expiry !== null ? (
        <Text variant="caption" color="priorityMedium" numberOfLines={2}>
          {expiry}
        </Text>
      ) : null}
      {record.state === 'failed' ? (
        <Button
          label="Retry"
          size="sm"
          variant="secondary"
          onPress={() => retryPhoto(record)}
          accessibilityHint="Sends this photograph again under its original key, so it is never stored twice"
        />
      ) : null}
    </View>
  );
}

// The full-screen camera: live preview, the live fix, and a shutter gated on it.
function CaptureCamera({
  visible,
  caseRef,
  inspectionRef,
  remaining,
  onClose,
}: {
  visible: boolean;
  caseRef: string;
  inspectionRef: string | null;
  remaining: number;
  onClose: () => void;
}) {
  const { config } = useAppConfig();
  const camera = useRef<CameraView>(null);
  const live = useLiveFix(visible);
  const [now, setNow] = useState(() => Date.now());
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [visible]);

  const verdict = judgeFix(live.fix, config.gpsAccuracyGateM, config.gpsFixMaxAgeMs, now);
  // Usable but coarser than the flag threshold: allowed, but stored `geotag_flagged` by the server.
  const flaggedAccuracyM =
    verdict.usable && live.fix !== null && live.fix.accuracyM !== null && live.fix.accuracyM > config.gpsAccuracyFlagM
      ? live.fix.accuracyM
      : null;
  const full = remaining <= 0;

  // The preview is torn down with the modal, so the next opening waits for it to be ready again.
  const close = () => {
    setReady(false);
    setMessage(null);
    onClose();
  };

  const onShutter = async () => {
    const fix = live.fix;
    if (!verdict.usable || fix === null || fix.accuracyM === null || camera.current === null) return;
    // Stamped at the press: this position, this clock reading, this source.
    const pressedAt = new Date();
    const stamp = { latitude: fix.latitude, longitude: fix.longitude, accuracyM: fix.accuracyM };
    setBusy(true);
    setMessage(null);
    try {
      const picture = await camera.current.takePictureAsync({
        quality: config.photoJpegQuality,
        exif: true,
        additionalExif: gpsExif(stamp),
      });
      await recordPhoto({ caseRef, inspectionRef, uri: picture.uri, fix: stamp, pressedAt });
      setMessage('Photograph kept on this device and queued to send.');
    } catch (cause) {
      setMessage(
        cause instanceof CaptureRejected
          ? cause.message
          : `The photograph was not taken: ${cause instanceof Error ? cause.message : 'the camera failed'}. Take it again.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} presentationStyle="fullScreen">
      <SafeAreaView style={styles.cameraScreen}>
        <View style={styles.cameraHeader}>
          <Text variant="title" color="ink0" style={styles.flex}>
            Photograph the site
          </Text>
          <Button label="Done" variant="ghost" size="sm" fullWidth={false} onPress={close} />
        </View>
        <View style={styles.preview}>
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing="back"
            active={visible}
            onCameraReady={() => setReady(true)}
            onMountError={(event) => setMessage(`The camera could not start: ${event.message}`)}
          />
        </View>
        <View style={styles.cameraFooter}>
          <GpsReadout
            state={live.fix === null ? 'searching' : verdict.usable ? 'locked' : 'weak'}
            latitude={live.fix?.latitude}
            longitude={live.fix?.longitude}
            accuracyMeters={live.fix?.accuracyM ?? undefined}
            thresholdMeters={config.gpsAccuracyGateM}
          />
          {message !== null ? (
            <Text variant="caption" color="ink1" accessibilityLiveRegion="polite">
              {message}
            </Text>
          ) : null}
          {!verdict.usable ? (
            <Text variant="caption" color="priorityMedium" accessibilityLiveRegion="polite">
              {verdict.reason}
            </Text>
          ) : null}
          {flaggedAccuracyM !== null ? (
            <Text variant="caption" color="priorityMedium" accessibilityLiveRegion="polite">
              {`Accuracy is ±${Math.round(flaggedAccuracyM)} m. This photograph will be recorded as low accuracy — you can still take it.`}
            </Text>
          ) : null}
          {full ? (
            <Text variant="caption" color="priorityMedium">
              The maximum number of photographs for this inspection has been reached.
            </Text>
          ) : null}
          <Button
            label="Take photograph"
            onPress={() => void onShutter()}
            disabled={!ready || !verdict.usable || full}
            loading={busy}
            leadingIcon={<Icon name="camera" size="md" color="inkOnMuted" />}
            accessibilityHint="Takes a photograph stamped with this position and time"
          />
        </View>
      </SafeAreaView>
    </Modal>
  );
}

// Step 2: the capture grid. Enforces the minimum before Next enables.
export function PhotoGrid({ caseRef, inspectionRef, onGateChange, style }: PhotoGridProps) {
  const { config } = useAppConfig();
  const { width } = useWindowDimensions();
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const location = useLocationPermission();
  const records = useRoundCaptures(caseRef, inspectionRef);
  const detail = useInspectionDetail(inspectionRef);
  const [cameraOpen, setCameraOpen] = useState(false);
  const refreshSync = useSyncStore((state) => state.refresh);

  // Gallery images never count toward the minimum (ui-rules.md §4); none can be added here.
  const onDevice = records.filter((record) => record.kind === 'photo' && record.geo.captureSource === 'camera');
  const uploadedIds = new Set(onDevice.map((record) => record.serverEvidenceId).filter((id) => id !== null));
  // Photographs the office already holds for this round that are not on this handset (a resumed round).
  const serverOnly = (detail.data?.evidence ?? []).filter(
    (row) => row.kind === 'photo' && row.capture_source === 'camera' && !uploadedIds.has(String(row.id)),
  );
  const count = onDevice.length + serverOnly.length;
  const minimum = config.minimumPhotoCount;
  const maximum = config.maximumPhotoCount;
  const remaining = maximum - count;

  useEffect(() => {
    refreshSync();
  }, [records, refreshSync]);

  const ready = count >= minimum;
  const missing = minimum - count;
  const reason = ready
    ? null
    : `Take ${missing} more photograph${missing === 1 ? '' : 's'} — at least ${minimum} are needed.`;
  useEffect(() => {
    onGateChange({ ready, reason });
  }, [onGateChange, ready, reason]);

  const tile = Math.floor((width - gutter * 2 - space[3] * (COLUMNS - 1)) / COLUMNS);
  const cameraGranted = cameraPermission?.granted === true;
  const locationGranted = location.status === 'granted';
  const canCapture = cameraGranted && locationGranted;
  const blocked =
    (cameraPermission !== null && !cameraGranted && !cameraPermission.canAskAgain) ||
    location.status === 'denied';
  const needsPriming =
    !blocked && location.status !== 'checking' && cameraPermission !== null && !canCapture;

  // The primer's one button asks for both, camera first, each OS dialog in turn.
  const onAllow = async () => {
    if (!cameraGranted) await requestCamera();
    if (!locationGranted) await location.request();
  };

  return (
    <View style={[styles.stack, style]}>
      <View
        style={styles.counter}
        accessible
        accessibilityRole="progressbar"
        accessibilityLabel={`${count} of ${minimum} minimum photographs captured`}
      >
        <Text variant="subheading" color={ready ? 'syncClear' : 'ink0'}>
          {`${Math.min(count, minimum)}/${minimum} minimum photos captured`}
        </Text>
        <ProgressBar value={minimum > 0 ? count / minimum : 1} tone={ready ? 'syncClear' : 'brand'} />
        <Text variant="caption" color="ink3">
          {`Up to ${maximum} photographs. Each is stamped with its position and time when taken.`}
        </Text>
      </View>

      {inspectionRef === null ? (
        <Text variant="caption" color="syncPending">
          The inspection round is not open on this device yet. Photographs are kept here and sent once it is.
        </Text>
      ) : null}

      {needsPriming ? (
        <View style={[styles.callout, { borderColor: colors.brand }]}>
          <Text variant="subheading" color="ink0">
            Camera and location are needed
          </Text>
          <Text variant="body" color="ink1">
            ICMS records where each photograph was taken so the inspection can be verified later. The camera is
            used only on this step.
          </Text>
          <Button label="Allow camera and location" onPress={() => void onAllow()} />
        </View>
      ) : null}

      {blocked ? (
        <View style={[styles.callout, { borderColor: colors.statusOverdue }]}>
          <Text variant="subheading" color="ink0">
            {!cameraGranted ? 'Camera is off for ICMS' : 'Location is off for ICMS'}
          </Text>
          <Text variant="body" color="ink1">
            Photographs cannot be taken without both. Turn them on for ICMS in the system settings; findings can still
            be recorded meanwhile.
          </Text>
          <Button label="Open settings" variant="secondary" onPress={() => void Linking.openSettings()} />
        </View>
      ) : null}

      <View style={styles.grid}>
        {onDevice.map((record) => (
          <PhotoTile
            key={record.id}
            record={record}
            size={tile}
            deviceTimestampMaxAgeHours={config.deviceTimestampMaxAgeHours}
          />
        ))}
        {serverOnly.map((row) => (
          <View key={row.id} style={[styles.serverTile, { width: tile, height: tile }]}>
            <Icon name="verified" size="lg" color="syncClear" />
            <Text variant="caption" color="ink1" align="center">
              {`Held by the office${row.geotag_flagged ? ' — location flagged' : ''}`}
            </Text>
          </View>
        ))}
        {remaining > 0 ? (
          <Pressable
            onPress={() => setCameraOpen(true)}
            disabled={!canCapture}
            accessibilityRole="button"
            accessibilityLabel="Add photo"
            accessibilityHint="Opens the camera"
            accessibilityState={{ disabled: !canCapture }}
            style={({ pressed }) => [
              styles.addTile,
              {
                width: tile,
                height: tile,
                backgroundColor: colors[pressed ? 'surface3' : 'surface2'],
                opacity: canCapture ? 1 : disabledOpacity,
              },
            ]}
          >
            <Icon name="camera" size="xl" color="brand" />
            <Text variant="label" color="brand">
              Add Photo
            </Text>
          </Pressable>
        ) : (
          <Text variant="caption" color="ink2">
            {`The maximum of ${maximum} photographs has been reached.`}
          </Text>
        )}
      </View>

      <CaptureCamera
        visible={cameraOpen}
        caseRef={caseRef}
        inspectionRef={inspectionRef}
        remaining={remaining}
        onClose={() => setCameraOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space[4] },
  flex: { flex: 1 },
  counter: { gap: space[2] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  tile: { gap: space[1] },
  addTile: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    minHeight: layout.touchMin,
    borderRadius: radius.md,
    borderWidth: control.borderWidth,
    borderStyle: 'dashed',
    borderColor: colors.brand,
  },
  serverTile: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1],
    padding: space[2],
    borderRadius: radius.md,
    backgroundColor: colors.surface2,
  },
  callout: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.md,
    borderWidth: control.borderWidth,
    backgroundColor: colors.surface1,
  },
  cameraScreen: { flex: 1, backgroundColor: colors.surface0 },
  cameraHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    minHeight: layout.headerHeight,
    paddingHorizontal: gutter,
  },
  preview: { flex: 1, overflow: 'hidden', backgroundColor: colors.surface1 },
  cameraFooter: { gap: space[2], padding: gutter, backgroundColor: colors.surface1 },
});
