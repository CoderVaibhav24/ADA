/**
 * GpsReadout — coordinates, accuracy, lock state and capture time. The pattern the designs
 * set is a number and a state, not a tick (ui-rules.md §3). When the fix is a last-known
 * position rather than a live one, this says so.
 */

import { StyleSheet, View } from 'react-native';

import { useT, type MessageKey } from '@/services/i18n';

import { Icon, Text } from '../atoms';
import {
  colors,
  radius,
  space,
  type ColorToken,
  type LayoutStyle,
} from '../tokens';

export type GpsFixState = 'locked' | 'weak' | 'none' | 'searching';

export type GpsReadoutProps = {
  state: GpsFixState;
  latitude?: number;
  longitude?: number;
  /** Metres. Undefined while searching. */
  accuracyMeters?: number;
  /** The server policy threshold, not a constant in the app (ui-rules.md §3). */
  thresholdMeters?: number;
  /** Preformatted at the render edge; this molecule does not own date formatting. */
  capturedAtLabel?: string;
  /** True when the position is the last known one rather than a live fix. */
  lastKnown?: boolean;
  style?: LayoutStyle;
};

const tones: Record<GpsFixState, ColorToken> = {
  locked: 'gpsLocked',
  weak: 'gpsWeak',
  none: 'gpsNone',
  searching: 'ink2',
};

const stateLabels = {
  locked: 'gps.state.locked',
  weak: 'gps.state.weak',
  none: 'gps.state.none',
  searching: 'gps.state.searching',
} as const satisfies Record<GpsFixState, MessageKey>;

// Degrees with a hemisphere letter, the way the designs and a field notebook both write it.
function formatCoordinate(value: number, positive: string, negative: string): string {
  return `${Math.abs(value).toFixed(4)}° ${value >= 0 ? positive : negative}`;
}

// The panel that gates Confirm Arrival; it states the number, the state and what is needed.
export function GpsReadout({
  state,
  latitude,
  longitude,
  accuracyMeters,
  thresholdMeters,
  capturedAtLabel,
  lastKnown = false,
  style,
}: GpsReadoutProps) {
  const t = useT();
  const tone = tones[state];
  const hasPosition = latitude !== undefined && longitude !== undefined;
  const coordinates = hasPosition
    ? `${formatCoordinate(latitude, 'N', 'S')}, ${formatCoordinate(longitude, 'E', 'W')}`
    : t('gps.coordinatesUnavailable');
  return (
    <View style={[styles.panel, style]}>
      <View style={styles.header}>
        <Icon name="gps" size="md" color={tone} />
        <Text variant="label" color={tone}>
          {t(stateLabels[state])}
        </Text>
        {lastKnown ? (
          <Text variant="caption" color="ink3">
            {t('gps.lastKnown')}
          </Text>
        ) : null}
      </View>

      <Text variant="mono" color="ink0" selectable>
        {coordinates}
      </Text>

      <View style={styles.meta}>
        <Text variant="caption" color="ink2">
          {accuracyMeters === undefined
            ? t('gps.accuracyPending')
            : t('gps.accuracy', { meters: Math.round(accuracyMeters) })}
        </Text>
        {thresholdMeters !== undefined ? (
          <Text variant="caption" color="ink3">
            {t('gps.required', { meters: Math.round(thresholdMeters) })}
          </Text>
        ) : null}
      </View>

      {capturedAtLabel ? (
        <Text variant="caption" color="ink3">
          {t('gps.captured', { time: capturedAtLabel })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    gap: space[2],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: colors.surface2,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: space[2], flexWrap: 'wrap' },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space[1], flexWrap: 'wrap' },
});
