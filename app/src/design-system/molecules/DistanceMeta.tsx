/**
 * DistanceMeta — "2.4 km · 8 min" on a complaint card. Always labelled approximate, and
 * never shown as live when the fix behind it is stale (ui-rules.md §7).
 */

import { StyleSheet, View } from 'react-native';

import { Icon, Text } from '../atoms';
import { space, type LayoutStyle } from '../tokens';

export type DistanceMetaProps = {
  /** Straight-line or routed distance in metres, from the last known position. */
  distanceMeters: number;
  etaMinutes?: number;
  /** True when the position behind this estimate is old. Says so rather than implying live. */
  stale?: boolean;
  style?: LayoutStyle;
};

// Below a kilometre reads in metres; a surveyor standing 300 m away should not see "0.3 km".
function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${Math.round(meters / 10) * 10} m`;
  }
  return `${(meters / 1000).toFixed(1)} km`;
}

// Renders the pair with a leading navigation glyph and an approximation marker.
export function DistanceMeta({ distanceMeters, etaMinutes, stale = false, style }: DistanceMetaProps) {
  const parts = [formatDistance(distanceMeters)];
  if (etaMinutes !== undefined) {
    parts.push(`${Math.round(etaMinutes)} min`);
  }
  const text = `approx. ${parts.join(' · ')}`;
  return (
    <View
      accessible
      accessibilityLabel={stale ? `${text}, from your last known position` : text}
      style={[styles.row, style]}
    >
      <Icon name="navigate" size="sm" color={stale ? 'ink3' : 'ink2'} />
      <Text variant="caption" color={stale ? 'ink3' : 'ink2'} numberOfLines={1}>
        {text}
      </Text>
      {stale ? (
        <Text variant="caption" color="ink3" numberOfLines={1}>
          {'· last known'}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: space[1], flexShrink: 1 },
});
