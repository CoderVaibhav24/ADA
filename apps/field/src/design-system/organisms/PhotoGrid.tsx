/**
 * PhotoGrid — step 2 (`179:6402`). What to photograph, the captured tiles with their
 * upload state in words, the Add Photo tile and the "n/min minimum photos captured"
 * counter. Next stays disabled below the minimum, with the reason (ui-rules.md §4).
 *
 * Camera only: nothing from the gallery can be added, so nothing from it counts.
 * Delete and Retake are offered only while the office cannot hold the photo, and
 * ask first; once it may have landed there is no delete control (evidence rule 6).
 * Storage is checked before the camera opens; permissions are primed first (§6).
 */

import { CameraView, useCameraPermissions } from 'expo-camera';
import { Image } from 'expo-image';
import { useEffect, useRef, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useInspectionDetail } from '@/services/api/inspection-reads';
import { useAppConfig } from '@/services/config/use-app-config';
import { formatDateTime } from '@/services/format/datetime';
import { useT, useTPlural, type PlainKey } from '@/services/i18n';
import { recordPhoto, releasePhotos, removePhoto, retryPhoto, type ShutterFix } from '@/services/inspection/evidence';
import { useRoundCaptures } from '@/services/inspection/queries';
import { uploadRefusalKey } from '@/services/inspection/refusals';
import { signalQuality } from '@/services/inspection/site';
import { discardFile, embedGps, looksRendered, normalizePhoto, stampAddress, stampLines } from '@/services/inspection/stamp';
import { judgeFix, useLiveFix, useLocationPermission } from '@/services/location/live-fix';
import {
  CaptureRejected,
  cannotBeSent,
  hasRoomForCapture,
  isRemovable,
  stuckReason,
  type CaptureRecord,
  type CaptureRejectionReason,
} from '@/services/storage/captures';
import { useSyncStore } from '@/store/sync-store';

import { type LayoutStyle } from '../tokens';
import { wizardColors, wizardMetrics as m, type WizardColor } from '../tokens/wizard';
import { PhotoStamper, type PhotoStamperHandle } from './PhotoStamper';
import { ConfirmSheet, Glyph, Notice, RemoveGlyph, WButton, WIcon, WText, type WizardIconName } from './wizard/kit';

export type PhotoGate = { readonly ready: boolean; readonly missing: number };

export type PhotoGridProps = {
  caseRef: string;
  /** Null while the round is not yet known; captures are kept and bound when it is. */
  inspectionRef: string | null;
  /** Tells the screen whether Next may enable. Pass a stable function. */
  onGateChange: (gate: PhotoGate) => void;
  style?: LayoutStyle;
};

const REJECTED: Record<CaptureRejectionReason, PlainKey> = {
  no_location: 'photos.rejected.noLocation',
  poor_accuracy: 'photos.rejected.poorAccuracy',
  no_timestamp: 'photos.rejected.noTimestamp',
  gallery_not_allowed: 'photos.rejected.gallery',
  file_missing: 'photos.rejected.fileMissing',
};

type TileState = { word: PlainKey; icon: WizardIconName; color: WizardColor };

// A capture's upload state as an icon, a colour and a word — never colour alone.
function tileState(record: CaptureRecord): TileState {
  switch (record.state) {
    case 'uploaded':
      return record.geotagFlagged === true
        ? { word: 'photos.state.flagged', icon: 'warning', color: 'gpsWeak' }
        : { word: 'photos.state.sent', icon: 'ok', color: 'ok' };
    case 'uploading':
      return { word: 'photos.state.sending', icon: 'upload', color: 'warn' };
    case 'pending':
      return { word: 'photos.state.waiting', icon: 'clock', color: 'warn' };
    case 'failed':
      return { word: 'photos.state.failed', icon: 'alert', color: 'error' };
  }
}

// One 96px tile (179:7172): the photo in its dark inner frame, the remove mark while it can go.
function PhotoTile({
  record,
  index,
  onOpen,
  onRemove,
}: {
  record: CaptureRecord;
  index: number;
  onOpen: () => void;
  onRemove: () => void;
}) {
  const t = useT();
  const state = tileState(record);
  return (
    <View style={styles.tileWrap}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="imagebutton"
        accessibilityLabel={t('photos.tileA11y', { index, state: t(state.word) })}
        accessibilityHint={t('photos.tileHint')}
        style={styles.tile}
      >
        <View style={styles.tileInner}>
          <Image source={{ uri: record.fileUri }} contentFit="cover" style={styles.fill} recyclingKey={record.id} />
        </View>
        <View style={styles.badge}>
          <WIcon name={state.icon} size={14} color={state.color} />
        </View>
      </Pressable>
      {isRemovable(record) ? (
        <Pressable
          onPress={onRemove}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={t('photos.remove')}
          style={styles.remove}
        >
          <RemoveGlyph />
        </Pressable>
      ) : null}
      <WText variant="caption" color={state.color} numberOfLines={2} align="center">
        {t(state.word)}
      </WText>
    </View>
  );
}

type PreviewAction = 'retake' | 'delete';

// The full view of one photo: the stamped picture, when and how precisely it was taken, and Keep / Retake / Delete.
function PhotoPreview({
  record,
  index,
  onClose,
  onRetake,
  onDelete,
}: {
  record: CaptureRecord;
  index: number;
  onClose: () => void;
  onRetake: () => void;
  onDelete: () => void;
}) {
  const t = useT();
  const [confirming, setConfirming] = useState<PreviewAction | null>(null);
  const state = tileState(record);
  const removable = isRemovable(record);
  const failure =
    record.state === 'failed'
      ? stuckReason(record) === 'retry'
        ? 'photos.failed.stuck'
        : uploadRefusalKey(record.lastErrorCode, record.lastErrorField, record.refusedByServer === true)
      : null;
  return (
    <SafeAreaView style={styles.modal}>
      <View style={styles.modalHead}>
        <WText variant="sheetTitle" accessibilityRole="header" style={styles.flex}>
          {t('photos.view.title', { index })}
        </WText>
        <WButton label={t('common.close')} variant="secondary" onPress={onClose} style={styles.headButton} />
      </View>
      <View style={styles.viewer}>
        <Image source={{ uri: record.fileUri }} contentFit="contain" style={styles.fill} />
      </View>
      <View style={styles.modalFoot}>
        <View style={styles.inline}>
          <WIcon name={state.icon} size={18} color={state.color} />
          <WText variant="noteBold" color={state.color}>
            {t(state.word)}
          </WText>
        </View>
        <WText variant="note" color="stepBody">
          {t('photos.view.taken', { time: formatDateTime(record.geo.deviceTimestamp) ?? '' })}
        </WText>
        <WText variant="note" color="stepBody">
          {t('photos.view.accuracy', { meters: Math.round(record.geo.accuracyM) })}
        </WText>
        {failure !== null ? <Notice tone="error" body={t(failure)} /> : null}
        {removable && confirming !== null ? (
          <Notice
            tone="warn"
            icon={confirming === 'retake' ? 'retake' : 'trash'}
            title={t(confirming === 'retake' ? 'photos.retake.title' : 'photos.remove.title')}
            body={t(confirming === 'retake' ? 'photos.retake.body' : 'photos.remove.body')}
          >
            <View style={styles.pair}>
              <WButton
                label={t(confirming === 'retake' ? 'photos.retake' : 'photos.remove.confirm')}
                onPress={confirming === 'retake' ? onRetake : onDelete}
                leading={<WIcon name={confirming === 'retake' ? 'retake' : 'trash'} size={18} />}
              />
              <WButton label={t('photos.remove.keep')} variant="secondary" onPress={() => setConfirming(null)} />
            </View>
          </Notice>
        ) : removable ? (
          <>
            <View style={styles.pair}>
              <WButton label={t('photos.retake')} onPress={() => setConfirming('retake')} leading={<WIcon name="retake" size={18} />} />
              <WButton
                label={t('photos.remove.confirm')}
                variant="secondary"
                onPress={() => setConfirming('delete')}
                leading={<WIcon name="trash" size={18} color="error" />}
              />
            </View>
            <WButton label={t('photos.remove.keep')} variant="secondary" onPress={onClose} leading={<Glyph name="check" />} />
          </>
        ) : record.state === 'failed' ? (
          <WButton label={t('photos.retry')} onPress={() => retryPhoto(record)} leading={<WIcon name="sync" size={18} />} />
        ) : (
          <View style={styles.inline}>
            <WIcon name="info" size={16} color="beige" />
            <WText variant="caption" color="beige" style={styles.flex}>
              {t('photos.view.locked')}
            </WText>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

// The preview as its own full-screen sheet, for the grid.
function PhotoViewer({
  record,
  index,
  onClose,
  onRetake,
  onDelete,
}: {
  record: CaptureRecord | null;
  index: number;
  onClose: () => void;
  onRetake: () => void;
  onDelete: () => void;
}) {
  if (record === null) return null;
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <PhotoPreview key={record.id} record={record} index={index} onClose={onClose} onRetake={onRetake} onDelete={onDelete} />
    </Modal>
  );
}

// Camera quality before the stamp re-encode; the stamp's own JPEG uses the served quality.
const CAMERA_QUALITY = 0.92;

// The full-screen camera: live preview, GPS in words, a shutter gated on the fix, and the shots so far.
function CaptureCamera({
  visible,
  caseRef,
  inspectionRef,
  remaining,
  captures,
  count,
  onClose,
}: {
  visible: boolean;
  caseRef: string;
  inspectionRef: string | null;
  remaining: number;
  captures: CaptureRecord[];
  count: number;
  onClose: () => void;
}) {
  const t = useT();
  const tp = useTPlural();
  const { config } = useAppConfig();
  const camera = useRef<CameraView>(null);
  const stamper = useRef<PhotoStamperHandle>(null);
  const live = useLiveFix(visible);
  const [now, setNow] = useState(() => Date.now());
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ key: PlainKey; tone: 'ok' | 'error' } | null>(null);
  const [lowStorage, setLowStorage] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);

  useEffect(() => {
    if (!visible) return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [visible]);

  const verdict = judgeFix(live.fix, config.gpsAccuracyGateM, config.gpsFixMaxAgeMs, now);
  const quality = live.fix === null ? 'searching' : signalQuality(live.fix.accuracyM, config.gpsAccuracyGateM, config.gpsAccuracyFlagM);
  const full = remaining <= 0;
  const missing = Math.max(0, config.minimumPhotoCount - count);
  const previewed = previewId === null ? null : (captures.find((record) => record.id === previewId) ?? null);

  const close = () => {
    setReady(false);
    setMessage(null);
    setPreviewId(null);
    onClose();
  };

  const removeFromPreview = () => {
    if (previewed !== null) removePhoto(previewed);
    setPreviewId(null);
  };

  const onShutter = async () => {
    const fix = live.fix;
    if (!verdict.usable || fix === null || fix.accuracyM === null || camera.current === null || busy) return;
    if (!hasRoomForCapture()) {
      setLowStorage(true);
      return;
    }
    // Stamped at the press: this position, this clock reading, this source.
    const pressedAt = new Date();
    const stamp = { latitude: fix.latitude, longitude: fix.longitude, accuracyM: fix.accuracyM };
    setBusy(true);
    setMessage(null);
    try {
      const picture = await camera.current.takePictureAsync({ quality: CAMERA_QUALITY, imageType: 'jpg', exif: false });
      const uri = await burnStamp(picture, stamp, pressedAt);
      await recordPhoto({ caseRef, inspectionRef, uri, fix: stamp, pressedAt, held: true });
      setMessage({ key: 'photos.camera.kept', tone: 'ok' });
    } catch (cause) {
      setMessage({ key: cause instanceof CaptureRejected ? REJECTED[cause.reason] : 'photos.camera.failed', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // Upright JPEG with its location bar and GPS EXIF; the plain upright shot if stamping fails, since the server stamps too.
  const burnStamp = async (picture: { uri: string }, fix: ShutterFix, pressedAt: Date) => {
    let plain;
    try {
      plain = await normalizePhoto(picture.uri, config.photoMaxEdgePx, config.photoJpegQuality);
    } catch (cause) {
      if (__DEV__) console.warn('[photos] normalise failed, keeping the camera file', cause);
      return picture.uri;
    }
    discardFile(picture.uri);
    try {
      if (stamper.current === null) throw new Error('stamper not mounted');
      const address = await stampAddress(fix.latitude, fix.longitude);
      const stamped = await stamper.current.stamp({
        uri: plain.uri,
        width: plain.width,
        height: plain.height,
        quality: config.photoJpegQuality,
        lines: stampLines(caseRef, fix, pressedAt, address),
      });
      if (!looksRendered(stamped, plain.uri)) {
        discardFile(stamped);
        throw new Error('stamp came out blank');
      }
      await embedGps(stamped, fix, pressedAt);
      discardFile(plain.uri);
      return stamped;
    } catch (cause) {
      if (__DEV__) console.warn('[photos] stamp failed, keeping the plain photo', cause);
      await embedGps(plain.uri, fix, pressedAt).catch(() => undefined);
      return plain.uri;
    }
  };

  const signalText =
    quality === 'good' || quality === 'fair'
      ? t(quality === 'good' ? 'checkin.signal.good' : 'checkin.signal.fair', { meters: Math.round(live.fix?.accuracyM ?? 0) })
      : quality === 'weak'
        ? t('checkin.signal.weak')
        : t('checkin.signal.searching');

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={previewed !== null ? () => setPreviewId(null) : close} presentationStyle="fullScreen">
      <SafeAreaView style={styles.modal}>
        {visible ? <PhotoStamper ref={stamper} /> : null}
        <View style={[styles.modalHead, styles.cover]}>
          <WIcon name="location" size={20} color="beige" />
          <WText variant="sheetTitle" accessibilityRole="header" style={styles.flex}>
            {t('photos.camera.title')}
          </WText>
          <WButton
            label={t('photos.camera.doneCount', { count: captures.length })}
            variant="secondary"
            onPress={close}
            leading={<Glyph name="check" />}
            style={styles.headButton}
          />
        </View>
        <View style={styles.preview}>
          {visible ? (
            <CameraView
              ref={camera}
              style={StyleSheet.absoluteFill}
              facing="back"
              active={visible}
              onCameraReady={() => setReady(true)}
              onMountError={() => setMessage({ key: 'photos.camera.startFailed', tone: 'error' })}
            />
          ) : null}
        </View>
        <View style={styles.modalFoot}>
          <View style={styles.inline} accessibilityLiveRegion="polite">
            <WIcon
              name={quality === 'good' ? 'signalGood' : quality === 'fair' ? 'signalFair' : 'warning'}
              size={18}
              color={quality === 'good' ? 'gpsLocked' : quality === 'searching' ? 'beige' : 'gpsWeak'}
            />
            <WText variant="noteBold" color={quality === 'good' ? 'gpsLocked' : quality === 'searching' ? 'beige' : 'gpsWeak'} style={styles.flex}>
              {signalText}
            </WText>
          </View>
          {!verdict.usable ? (
            <WText variant="note" color="warn">
              {t('photos.camera.gpsWait')}
            </WText>
          ) : null}
          {lowStorage ? <Notice tone="error" icon="storage" title={t('photos.lowStorage.title')} body={t('photos.lowStorage.body')} /> : null}
          {message !== null ? <Notice tone={message.tone} body={t(message.key)} /> : null}
          {full ? <Notice tone="ok" body={t('photos.maxReached', { max: config.maximumPhotoCount })} /> : null}
          {captures.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
              {captures.map((record, index) => (
                <Pressable
                  key={record.id}
                  onPress={() => setPreviewId(record.id)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={t('photos.camera.stripA11y', { index: index + 1 })}
                  style={styles.lastThumb}
                >
                  <Image source={{ uri: record.fileUri }} contentFit="cover" style={styles.fill} recyclingKey={record.id} />
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <View style={styles.shutterRow}>
            <View style={styles.lastSlot}>
              <WText variant="caption" color={missing > 0 ? 'warn' : 'ok'} align="center">
                {missing > 0 ? tp('photos.needMore', missing) : t('photos.counter', { count: Math.min(count, config.minimumPhotoCount), min: config.minimumPhotoCount })}
              </WText>
            </View>
            <Pressable
              onPress={() => void onShutter()}
              disabled={!ready || !verdict.usable || full || busy}
              accessibilityRole="button"
              accessibilityLabel={t('photos.camera.shutter')}
              accessibilityHint={t('photos.camera.shutterHint')}
              accessibilityState={{ disabled: !ready || !verdict.usable || full, busy }}
              style={({ pressed }) => [
                styles.shutter,
                pressed ? styles.shutterPressed : null,
                !ready || !verdict.usable || full || busy ? styles.dim : null,
              ]}
            >
              <View style={styles.shutterCore}>
                <Glyph name="camera" size={30} color="white" />
              </View>
            </Pressable>
            <View style={styles.lastSlot} />
          </View>
          <WText variant="noteBold" align="center">
            {busy ? t('photos.camera.stamping') : t('photos.camera.shutter')}
          </WText>
        </View>
        {previewed !== null ? (
          <View style={StyleSheet.absoluteFill}>
            <PhotoPreview
              key={previewed.id}
              record={previewed}
              index={captures.indexOf(previewed) + 1}
              onClose={() => setPreviewId(null)}
              onRetake={removeFromPreview}
              onDelete={removeFromPreview}
            />
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

// Step 2: guidance, tiles, the minimum, and every capture state.
export function PhotoGrid({ caseRef, inspectionRef, onGateChange, style }: PhotoGridProps) {
  const t = useT();
  const tp = useTPlural();
  const { config } = useAppConfig();
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const location = useLocationPermission();
  const records = useRoundCaptures(caseRef, inspectionRef);
  const detail = useInspectionDetail(inspectionRef);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<{ record: CaptureRecord; retake: boolean } | null>(null);
  const [lowStorage, setLowStorage] = useState(false);
  const refreshSync = useSyncStore((state) => state.refresh);

  // Gallery images never count toward the minimum (ui-rules.md §4); none can be added here.
  const onDevice = records.filter((record) => record.kind === 'photo' && record.geo.captureSource === 'camera');
  const uploadedIds = new Set(onDevice.map((record) => record.serverEvidenceId).filter((id) => id !== null));
  // Photographs the office already holds for this round that are not on this handset (a resumed round).
  const serverOnly = (detail.data?.evidence ?? []).filter(
    (row) => row.kind === 'photo' && row.capture_source === 'camera' && !uploadedIds.has(String(row.id)),
  );
  // A photo the office refused will never count; it stays visible so it can be retaken.
  const counted = onDevice.filter((record) => !cannotBeSent(record));
  const count = counted.length + serverOnly.length;
  const minimum = config.minimumPhotoCount;
  const maximum = config.maximumPhotoCount;
  const remaining = maximum - onDevice.length - serverOnly.length;
  const missing = Math.max(0, minimum - count);
  // Refused by the office: sending again gets the same answer, so it is retaken, not retried.
  const refused = onDevice.filter(cannotBeSent);
  const failed = onDevice.filter((record) => record.state === 'failed' && !cannotBeSent(record));
  const waiting = onDevice.filter((record) => record.state !== 'uploaded');

  useEffect(() => {
    refreshSync();
  }, [records, refreshSync]);

  useEffect(() => {
    onGateChange({ ready: missing === 0, missing });
  }, [onGateChange, missing]);

  // Photos kept in the camera go to the upload queue once it closes (and after a restart mid-session).
  useEffect(() => {
    if (!cameraOpen) releasePhotos(caseRef);
  }, [cameraOpen, caseRef, records]);

  const cameraGranted = cameraPermission?.granted === true;
  const locationGranted = location.status === 'granted';
  const canCapture = cameraGranted && locationGranted;
  const cameraBlocked = cameraPermission !== null && !cameraGranted && !cameraPermission.canAskAgain;
  const locationBlocked = location.status === 'denied' && !location.canAskAgain;
  const blocked = cameraBlocked || locationBlocked;
  const needsPriming = !blocked && location.status !== 'checking' && cameraPermission !== null && !canCapture;

  // The primer's one button asks for both, camera first, each OS dialog in turn.
  const onAllow = async () => {
    if (!cameraGranted) await requestCamera();
    if (!locationGranted) await location.request();
  };

  const openCamera = () => {
    if (!hasRoomForCapture()) {
      setLowStorage(true);
      return;
    }
    setLowStorage(false);
    setCameraOpen(true);
  };

  const confirmAndRemove = () => {
    if (confirmRemove === null) return;
    const { record, retake } = confirmRemove;
    setConfirmRemove(null);
    setViewing(null);
    removePhoto(record);
    if (retake) openCamera();
  };

  // From the preview, which has already asked.
  const removeViewed = (retake: boolean) => {
    if (viewed === null) return;
    setViewing(null);
    removePhoto(viewed);
    if (retake) openCamera();
  };

  const viewed = viewing === null ? null : (onDevice.find((record) => record.id === viewing) ?? null);
  const viewedIndex = viewed === null ? 0 : onDevice.indexOf(viewed) + 1;

  const guides: { key: PlainKey; icon: WizardIconName }[] = [
    { key: 'photos.guide.encroachment', icon: 'rcc' },
    { key: 'photos.guide.boundary', icon: 'fencing' },
    { key: 'photos.guide.wide', icon: 'levelling' },
  ];

  return (
    <View style={[styles.stack, style]}>
      <View style={styles.guides}>
        {guides.map((guide, index) => (
          <View key={guide.key} style={styles.inline}>
            <View style={styles.guideNumber}>
              <WText variant="caption" color="accent">
                {String(index + 1)}
              </WText>
            </View>
            <WIcon name={guide.icon} size={18} color="beige" />
            <WText variant="note" color="stepBodyPhotos" style={styles.flex}>
              {t(guide.key)}
            </WText>
          </View>
        ))}
      </View>

      {inspectionRef === null ? <Notice tone="warn" icon="offline" body={t('photos.roundNotOpen')} /> : null}

      {needsPriming ? (
        <Notice tone="info" icon="location" title={t('photos.perm.title')} body={t('photos.perm.body')}>
          <WButton label={t('photos.perm.allow')} onPress={() => void onAllow()} leading={<Glyph name="camera" size={20} />} />
        </Notice>
      ) : null}

      {blocked ? (
        <Notice
          tone="error"
          title={cameraBlocked ? t('photos.perm.cameraOff') : t('photos.perm.locationOff')}
          body={t('photos.perm.deniedBody')}
        >
          <WButton label={t('checkin.perm.settings')} variant="secondary" onPress={() => void Linking.openSettings()} leading={<WIcon name="settings" size={18} />} />
        </Notice>
      ) : null}

      {lowStorage ? <Notice tone="error" icon="storage" title={t('photos.lowStorage.title')} body={t('photos.lowStorage.body')} /> : null}

      <View style={styles.section}>
        <View style={styles.grid}>
          {onDevice.map((record, index) => (
            <PhotoTile
              key={record.id}
              record={record}
              index={index + 1}
              onOpen={() => setViewing(record.id)}
              onRemove={() => setConfirmRemove({ record, retake: false })}
            />
          ))}
          {serverOnly.map((row) => (
            <View key={row.id} style={styles.tileWrap}>
              <View style={[styles.tile, styles.officeTile]}>
                <WIcon name="noAction" size={28} color="ok" />
              </View>
              <WText variant="caption" color="ok" numberOfLines={2} align="center">
                {t('photos.state.office')}
              </WText>
            </View>
          ))}
          {remaining > 0 ? (
            <Pressable
              onPress={openCamera}
              disabled={!canCapture}
              accessibilityRole="button"
              accessibilityLabel={t('photos.add')}
              accessibilityHint={t('photos.addHint')}
              accessibilityState={{ disabled: !canCapture }}
              style={({ pressed }) => [styles.addTile, pressed ? styles.addPressed : null, !canCapture ? styles.dim : null]}
            >
              <Glyph name="camera" color="accent" />
              <WText variant="addPhoto" color="accent" align="center">
                {t('photos.add')}
              </WText>
            </Pressable>
          ) : null}
        </View>

        <WText variant="counter" color="beige" accessibilityLiveRegion="polite">
          {t('photos.counter', { count: Math.min(count, minimum), min: minimum })}
        </WText>
        <WText variant="caption" color="beige">
          {remaining > 0 ? t('photos.max', { max: maximum }) : t('photos.maxReached', { max: maximum })}
        </WText>
      </View>

      {missing > 0 && canCapture ? (
        <View style={styles.inline} accessibilityLiveRegion="polite">
          <WIcon name="info" size={18} color="warn" />
          <WText variant="note" color="warn" style={styles.flex}>
            {tp('photos.needMore', missing)}
          </WText>
        </View>
      ) : null}

      {refused.length > 0 ? (
        <Notice
          tone="error"
          icon="retake"
          body={t(uploadRefusalKey(refused[0].lastErrorCode, refused[0].lastErrorField, true))}
        />
      ) : null}
      {failed.length > 0 ? (
        <Notice tone="error" icon="upload" body={t(failed.some((record) => stuckReason(record) === 'retry') ? 'photos.failed.stuck' : 'photos.failed.retrying')}>
          <WButton
            label={t('photos.retryAll')}
            variant="secondary"
            onPress={() => failed.forEach((record) => retryPhoto(record))}
            leading={<WIcon name="sync" size={18} />}
          />
        </Notice>
      ) : waiting.length > refused.length ? (
        <Notice tone="warn" icon="upload" body={t('photos.pendingNote')} />
      ) : null}

      <CaptureCamera
        visible={cameraOpen}
        caseRef={caseRef}
        inspectionRef={inspectionRef}
        remaining={remaining}
        captures={onDevice}
        count={count}
        onClose={() => setCameraOpen(false)}
      />
      <PhotoViewer
        record={viewed}
        index={viewedIndex}
        onClose={() => setViewing(null)}
        onRetake={() => removeViewed(true)}
        onDelete={() => removeViewed(false)}
      />
      <ConfirmSheet
        visible={confirmRemove !== null}
        destructive
        title={t('photos.remove.title')}
        body={t('photos.remove.body')}
        confirmLabel={confirmRemove?.retake === true ? t('photos.retake') : t('photos.remove.confirm')}
        cancelLabel={t('photos.remove.keep')}
        confirmIcon={<WIcon name={confirmRemove?.retake === true ? 'retake' : 'trash'} size={18} />}
        onConfirm={confirmAndRemove}
        onCancel={() => setConfirmRemove(null)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  fill: { width: '100%', height: '100%' },
  stack: { gap: m.gap },
  section: { gap: 12, paddingTop: 10, paddingBottom: 10 },
  guides: { gap: 8 },
  guideNumber: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: m.hairline,
    borderColor: wizardColors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inline: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: m.photoGap },
  tileWrap: { width: m.photoTile, gap: 4 },
  tile: {
    width: m.photoTile,
    height: m.photoTile,
    borderRadius: m.cardRadius,
    backgroundColor: wizardColors.tile,
    alignItems: 'center',
    justifyContent: 'center',
  },
  officeTile: { borderWidth: m.hairline, borderColor: wizardColors.noticeBorderOk },
  tileInner: {
    width: m.photoInnerW,
    height: m.photoInnerH,
    borderRadius: m.photoInnerRadius,
    overflow: 'hidden',
    backgroundColor: wizardColors.tileInner,
  },
  badge: {
    position: 'absolute',
    left: 10,
    bottom: 10,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: wizardColors.tile,
  },
  remove: {
    position: 'absolute',
    top: 2,
    right: 4,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addTile: {
    width: m.photoTile,
    height: m.photoTile,
    borderRadius: m.cardRadius,
    borderWidth: m.hairline,
    borderStyle: 'dashed',
    borderColor: wizardColors.addTileBorder,
    backgroundColor: wizardColors.addTile,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: 4,
  },
  addPressed: { backgroundColor: wizardColors.tile },
  dim: { opacity: 0.5 },
  modal: { flex: 1, backgroundColor: wizardColors.screen },
  modalHead: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: m.padX },
  headButton: { flex: 0, minWidth: 96 },
  preview: { flex: 1, overflow: 'hidden', backgroundColor: wizardColors.tileInner },
  viewer: { flex: 1, backgroundColor: wizardColors.tileInner },
  modalFoot: { gap: 10, padding: m.padX, backgroundColor: wizardColors.card },
  pair: { flexDirection: 'row', gap: m.buttonGap },
  shutterRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  lastSlot: { width: 72, alignItems: 'center', gap: 4 },
  lastThumb: { width: 56, height: 56, borderRadius: 10, overflow: 'hidden', backgroundColor: wizardColors.tileInner },
  strip: { gap: 8 },
  cover: { backgroundColor: wizardColors.screen },
  shutter: {
    width: 80,
    height: 80,
    borderRadius: 40,
    borderWidth: 4,
    borderColor: wizardColors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterPressed: { transform: [{ scale: 0.95 }] },
  shutterCore: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: wizardColors.accent,
  },
});
