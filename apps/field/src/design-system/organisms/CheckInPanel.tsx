/**
 * CheckInPanel — step 1 (`179:5884`). The location card (marker, coordinates, signal in
 * words, time), how far the surveyor stands from the case point, and Confirm Arrival,
 * which stays disabled until the fix meets the server's accuracy gate, with the reason
 * and the next thing to do stated under it (ui-rules.md §3). When the served geofence is
 * enforced it also stays disabled until the fix is within the radius; otherwise distance only warns.
 *
 * Permission is primed before the OS dialog; a denial degrades to a settings route
 * (ui-rules.md §6). A refusal from the office is said in words, never as a code.
 */

import { useEffect, useState } from 'react';
import { ActivityIndicator, Animated, Easing, Platform, StyleSheet, View } from 'react-native';

import { useInspectionDetail } from '@/services/api/inspection-reads';
import { useAppConfig } from '@/services/config/use-app-config';
import { formatDateTime } from '@/services/format/datetime';
import { useT, type PlainKey, type TFunction } from '@/services/i18n';
import { adoptServerCheckIn, confirmArrival } from '@/services/inspection/check-in';
import { useCheckInRecord } from '@/services/inspection/queries';
import { checkInRefusalKey } from '@/services/inspection/refusals';
import { isWorkable } from '@/services/inspection/rounds';
import { SLOW_FIX_MS, formatCoordinates, signalQuality, siteDistance, type SignalQuality } from '@/services/inspection/site';
import { judgeFix, useLiveFix, useLocationPermission, type LiveFix } from '@/services/location/live-fix';

import { type LayoutStyle } from '../tokens';
import { wizardColors, wizardMetrics as m, wizardShadow, type WizardColor } from '../tokens/wizard';
import { Glyph, Notice, WButton, WIcon, WText, type WizardIconName } from './wizard/kit';

export type CheckInPanelProps = {
  caseRef: string;
  /** Null while the round is not yet known on the device; the tap is then held. */
  inspectionRef: string | null;
  /** The case's filed point, for the distance warning; null when the case has none. */
  site: { readonly latitude: number; readonly longitude: number } | null;
  /** Called once arrival is saved (held or recorded): the screen moves to step 2. */
  onArrived: () => void;
  style?: LayoutStyle;
};

// "1.2 km" / "40 m" with the shared distance words.
function distanceText(meters: number, t: TFunction): string {
  if (meters >= 1000) return t('distance.km', { value: (meters / 1000).toFixed(1) });
  return t('distance.meters', { value: Math.max(1, Math.round(meters / 10) * 10) });
}

const QUALITY: Record<SignalQuality, { color: WizardColor; icon: WizardIconName | null }> = {
  good: { color: 'gpsLocked', icon: null },
  fair: { color: 'gpsWeak', icon: 'signalFair' },
  weak: { color: 'gpsWeak', icon: 'warning' },
  searching: { color: 'beige', icon: null },
};

// The status line under the coordinates: a glyph and the signal in words (179:6378).
function SignalLine({ quality, accuracyM, t }: { quality: SignalQuality; accuracyM: number | null; t: TFunction }) {
  const look = QUALITY[quality];
  const meters = Math.round(accuracyM ?? 0);
  const text =
    quality === 'good'
      ? t('checkin.signal.good', { meters })
      : quality === 'fair'
        ? t('checkin.signal.fair', { meters })
        : quality === 'weak'
          ? t('checkin.signal.weak')
          : t('checkin.signal.searching');
  return (
    <View style={styles.signal} accessibilityLiveRegion="polite">
      {quality === 'good' ? (
        <Glyph name="check" color="gpsLocked" />
      ) : quality === 'searching' ? (
        <ActivityIndicator size="small" color={wizardColors.beige} />
      ) : look.icon !== null ? (
        <WIcon name={look.icon} size={16} color={look.color} />
      ) : null}
      <WText variant="lock" color={look.color} align="center" style={styles.shrink}>
        {text}
      </WText>
    </View>
  );
}

// The 80px marker: a pulsing beige ring around the pin disc (179:6386).
function Marker({ still }: { still: boolean }) {
  const t = useT();
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (still) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1100, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(pulse, { toValue: 0, duration: 1100, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, still]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1.04] });
  return (
    <View style={styles.marker} accessible accessibilityRole="image" accessibilityLabel={t('checkin.markerA11y')}>
      <Animated.View style={[styles.ring, { transform: [{ scale: still ? 1 : scale }] }]} />
      <View style={styles.disc}>
        <Glyph name="pin" color="accent" />
      </View>
    </View>
  );
}

// The location card (179:6372): marker, coordinates, signal, time.
function LocationCard({
  latitude,
  longitude,
  line,
  time,
  still,
}: {
  latitude: number | null;
  longitude: number | null;
  line: React.ReactNode;
  time: string | null;
  still: boolean;
}) {
  const t = useT();
  return (
    <View style={[styles.card, wizardShadow]}>
      <Marker still={still} />
      <WText variant="coords" align="center" selectable>
        {latitude !== null && longitude !== null ? formatCoordinates(latitude, longitude) : t('gps.coordinatesUnavailable')}
      </WText>
      {line}
      {time !== null ? (
        <WText variant="timestamp" color="timestamp" align="center">
          {t('checkin.capturedAt', { time })}
        </WText>
      ) : null}
    </View>
  );
}

// After a minute without a usable fix: the "step outside" tips, with the time waited.
function SlowFixHint({ usable, now }: { usable: boolean; now: number }) {
  const t = useT();
  const [since] = useState(() => Date.now());
  if (usable || now - since <= SLOW_FIX_MS) return null;
  return <Notice tone="warn" icon="warning" body={t('checkin.detail.slow', { seconds: Math.floor((now - since) / 1000) })} />;
}

// Whether a held check-in is nearing or past the server's staleness limit.
function heldExpiry(deviceTimestamp: string, maxAgeHours: number, now: number): PlainKey | null {
  const takenAt = Date.parse(deviceTimestamp);
  if (Number.isNaN(takenAt)) return null;
  const remainingHours = maxAgeHours - (now - takenAt) / 3_600_000;
  if (remainingHours <= 0) return 'checkin.held.expired';
  if (remainingHours <= 1) return 'checkin.held.expiring';
  return null;
}

// What the verdict on a live fix means, and what to do next.
function detailKey(fix: LiveFix | null, quality: SignalQuality, usable: boolean, stale: boolean): PlainKey | null {
  if (fix === null) return 'checkin.detail.searching';
  if (fix.mocked) return 'checkin.detail.mocked';
  if (fix.accuracyM === null) return 'checkin.detail.noAccuracy';
  if (stale) return 'checkin.detail.stale';
  if (quality === 'fair' && usable) return 'checkin.detail.fair';
  return null;
}

// Step 1: the accuracy gate and the arrival record.
export function CheckInPanel({ caseRef, inspectionRef, site, onArrived, style }: CheckInPanelProps) {
  const t = useT();
  const { config, refetch: refetchConfig } = useAppConfig();
  const gateM = config.gpsAccuracyGateM;
  const flagM = config.gpsAccuracyFlagM;
  const radiusM = config.geofenceRadiusM;
  const enforced = config.geofenceEnforced;

  // The geofence switch can change at any time, so step 1 reads it fresh.
  useEffect(() => {
    void refetchConfig();
  }, [refetchConfig]);
  const permission = useLocationPermission();
  const record = useCheckInRecord(caseRef, inspectionRef);
  const detail = useInspectionDetail(inspectionRef);

  const saved = record?.state === 'confirmed' || record?.state === 'held';
  const live = useLiveFix(permission.status === 'granted' && record?.state !== 'confirmed');
  const [now, setNow] = useState(() => Date.now());
  const [sending, setSending] = useState(false);

  // The fix's age is judged every second, so a watch that goes quiet stops being "live".
  useEffect(() => {
    if (record?.state === 'confirmed') return undefined;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [record?.state]);

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
  const accuracy = live.fix?.accuracyM ?? null;
  const quality = live.fix === null ? 'searching' : signalQuality(accuracy, gateM, flagM);
  const stale = live.fix !== null && now - live.fix.timestamp > config.gpsFixMaxAgeMs;
  const distance = siteDistance(live.fix, site, radiusM);
  const outsideFence = enforced && distance !== null && distance.far;
  const canConfirm = verdict.usable && !outsideFence;

  const onConfirm = async () => {
    const fix = live.fix;
    if (!canConfirm || fix === null || fix.accuracyM === null || sending) return;
    setSending(true);
    try {
      const next = await confirmArrival(caseRef, inspectionRef, {
        latitude: fix.latitude,
        longitude: fix.longitude,
        accuracyM: fix.accuracyM,
        timestamp: fix.timestamp,
      });
      if (next.state !== 'refused') onArrived();
    } finally {
      setSending(false);
    }
  };

  // Recorded or held: the card shows what was saved, and the one action moves on.
  if (saved && record !== null) {
    const confirmed = record.confirmed;
    const expiry = record.state === 'held' ? heldExpiry(record.deviceTimestamp, config.deviceTimestampMaxAgeHours, now) : null;
    return (
      <View style={[styles.stack, style]}>
        <LocationCard
          latitude={confirmed?.lat ?? record.latitude}
          longitude={confirmed?.lon ?? record.longitude}
          still
          time={formatDateTime(confirmed?.device_timestamp ?? record.deviceTimestamp)}
          line={
            <View style={styles.signal}>
              {record.state === 'confirmed' ? <Glyph name="check" color="gpsLocked" /> : <WIcon name="clock" size={16} color="gpsWeak" />}
              <WText variant="lock" color={record.state === 'confirmed' ? 'gpsLocked' : 'gpsWeak'} align="center" style={styles.shrink}>
                {record.state === 'confirmed' ? t('checkin.confirmed') : t('checkin.held.title')}
              </WText>
            </View>
          }
        />
        {record.state === 'held' ? (
          <Notice tone="warn" icon="upload" title={t('checkin.held.title')} body={t('checkin.held.body')}>
            {expiry !== null ? (
              <WText variant="note" color="warn">
                {t(expiry)}
              </WText>
            ) : null}
          </Notice>
        ) : confirmed?.inside_zone === false ? (
          <Notice tone="warn" icon="location" body={t('checkin.zone.outside')} />
        ) : null}
        <WButton
          label={expiry === 'checkin.held.expired' ? t('checkin.cta') : t('common.next')}
          onPress={expiry === 'checkin.held.expired' ? () => void onConfirm() : onArrived}
          disabled={expiry === 'checkin.held.expired' && !canConfirm}
          loading={sending}
          trailing={<Glyph name="chevronRight" />}
          style={styles.cta}
        />
      </View>
    );
  }

  if (permission.status === 'undetermined' || permission.status === 'checking') {
    return (
      <View style={[styles.stack, style]}>
        <Notice tone="info" icon="location" title={t('checkin.perm.title')} body={t('checkin.perm.body')}>
          <WButton
            label={t('checkin.perm.allow')}
            onPress={() => void permission.request()}
            disabled={permission.status === 'checking'}
            leading={<WIcon name="location" size={18} />}
          />
        </Notice>
      </View>
    );
  }

  if (permission.status === 'denied') {
    return (
      <View style={[styles.stack, style]}>
        <Notice tone="error" icon="location" title={t('checkin.perm.deniedTitle')} body={t('checkin.perm.deniedBody')}>
          {permission.canAskAgain ? (
            <WButton label={t('checkin.perm.allow')} onPress={() => void permission.request()} leading={<WIcon name="location" size={18} />} />
          ) : (
            <WButton label={t('checkin.perm.settings')} variant="secondary" onPress={permission.openSettings} leading={<WIcon name="settings" size={18} />} />
          )}
        </Notice>
      </View>
    );
  }

  const approximateOnly = permission.precise === false || live.approximate;
  if (approximateOnly) {
    const canUpgradeInApp = Platform.OS === 'android' && permission.canAskAgain;
    return (
      <View style={[styles.stack, style]}>
        <Notice tone="error" icon="location" title={t('checkin.perm.preciseTitle')} body={t('checkin.perm.preciseBody')}>
          {canUpgradeInApp ? (
            <WButton label={t('checkin.perm.allowPrecise')} onPress={() => void permission.request()} leading={<WIcon name="location" size={18} />} />
          ) : null}
          <WButton label={t('checkin.perm.settings')} variant="secondary" onPress={permission.openSettings} leading={<WIcon name="settings" size={18} />} />
        </Notice>
      </View>
    );
  }

  const detailLine = detailKey(live.fix, quality, verdict.usable, stale);
  const refusal = record?.state === 'refused' && record.error !== null ? checkInRefusalKey(record.error.code, record.error.field ?? null) : null;

  return (
    <View style={[styles.stack, style]}>
      {live.servicesEnabled === false ? <Notice tone="error" icon="offline" body={t('checkin.servicesOff')} /> : null}
      {refusal !== null ? <Notice tone="error" title={t('checkin.refused.title')} body={t(refusal)} /> : null}

      <LocationCard
        latitude={live.fix?.latitude ?? null}
        longitude={live.fix?.longitude ?? null}
        still={verdict.usable}
        time={live.fix ? formatDateTime(new Date(live.fix.timestamp).toISOString()) : null}
        line={<SignalLine quality={quality} accuracyM={accuracy} t={t} />}
      />

      {quality === 'weak' && live.fix !== null ? (
        <Notice
          tone="warn"
          icon="warning"
          body={t('checkin.detail.weak', { meters: Math.round(accuracy ?? 0), needed: Math.round(gateM) })}
        />
      ) : null}
      {/* Remounted whenever the fix turns usable or unusable, so it times the current spell. */}
      <SlowFixHint key={String(verdict.usable)} usable={verdict.usable} now={now} />
      {detailLine !== null ? (
        <WText variant="note" color={quality === 'fair' ? 'warn' : 'beige'} align="center" accessibilityLiveRegion="polite">
          {t(detailLine)}
        </WText>
      ) : null}
      {live.error !== null ? <Notice tone="error" body={t('checkin.readError')} /> : null}
      {distance !== null && enforced ? (
        distance.far ? (
          <Notice
            tone="warn"
            icon="location"
            body={t('checkin.distance.gate', { meters: Math.round(distance.meters), radius: Math.round(radiusM) })}
          />
        ) : (
          <View style={styles.near}>
            <WIcon name="location" size={16} color="ok" />
            <WText variant="note" color="ok" style={styles.shrink}>
              {t('checkin.distance.within', { meters: Math.round(distance.meters), radius: Math.round(radiusM) })}
            </WText>
          </View>
        )
      ) : distance !== null ? (
        distance.far ? (
          <Notice tone="warn" icon="location" body={t('checkin.distance.far', { distance: distanceText(distance.meters, t) })} />
        ) : (
          <View style={styles.near}>
            <WIcon name="location" size={16} color="ok" />
            <WText variant="note" color="ok" style={styles.shrink}>
              {t('checkin.distance.near', { distance: distanceText(distance.meters, t) })}
            </WText>
          </View>
        )
      ) : null}

      <WButton
        label={t('checkin.cta')}
        onPress={() => void onConfirm()}
        disabled={!canConfirm}
        loading={sending}
        trailing={<Glyph name="chevronRight" />}
        accessibilityHint={t('checkin.ctaHint')}
        style={styles.cta}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: m.gap },
  shrink: { flexShrink: 1 },
  card: {
    minHeight: m.locationCard,
    marginTop: m.locationCardTop - m.gap,
    marginBottom: 24,
    paddingTop: 24,
    paddingBottom: 22,
    paddingHorizontal: 16,
    gap: 6,
    alignItems: 'center',
    borderRadius: m.cardRadius,
    borderWidth: m.hairline,
    borderColor: wizardColors.cardBorder,
    backgroundColor: wizardColors.card,
  },
  marker: { width: m.marker, height: m.marker, alignItems: 'center', justifyContent: 'center', marginBottom: 10 },
  ring: {
    position: 'absolute',
    width: m.marker,
    height: m.marker,
    borderRadius: m.marker / 2,
    backgroundColor: wizardColors.pulse,
    opacity: 0.6,
  },
  disc: {
    width: m.markerDisc,
    height: m.markerDisc,
    borderRadius: m.markerDisc / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: m.hairline,
    borderColor: wizardColors.pinDiscBorder,
    backgroundColor: wizardColors.pinDisc,
  },
  signal: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  near: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  cta: { flex: 0, alignSelf: 'stretch' },
});
