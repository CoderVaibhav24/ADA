/**
 * PhotoThumb — a captured photograph with its geo badge and, before submission only, a
 * remove affordance. Evidence is append-only after submission (ui-rules.md §4), so
 * `removable` is the caller's assertion that nothing has been submitted yet.
 */

import { Image, Pressable, StyleSheet, View } from 'react-native';

import { Icon, Text } from '../atoms';
import {
  colors,
  layout,
  radius,
  space,
  type LayoutStyle,
} from '../tokens';

/** A gallery image is not a field capture and never counts toward the minimum. */
export type CaptureSource = 'camera' | 'gallery';

export type PhotoThumbProps = {
  uri: string;
  /** Square edge in points. The grid decides; the thumbnail does not assume a column count. */
  size: number;
  source?: CaptureSource;
  /** False when the capture has no resolved position — it is marked, never shown as geotagged. */
  geotagged?: boolean;
  accuracyMeters?: number;
  onPress?: () => void;
  /** Present only before submission. Absent after, with no delete path anywhere. */
  onRemove?: () => void;
  accessibilityLabel?: string;
  testID?: string;
  style?: LayoutStyle;
};

// The badge states the capture's provenance; the remove button keeps a full 44pt target.
export function PhotoThumb({
  uri,
  size,
  source = 'camera',
  geotagged = true,
  accuracyMeters,
  onPress,
  onRemove,
  accessibilityLabel,
  testID,
  style,
}: PhotoThumbProps) {
  const provenance = source === 'gallery' ? 'From gallery' : geotagged ? 'Geotagged' : 'No location';
  const label =
    accessibilityLabel ??
    `Photograph, ${provenance}${accuracyMeters !== undefined ? `, accuracy ${Math.round(accuracyMeters)} metres` : ''}`;
  return (
    <View style={[{ width: size, height: size }, styles.frame, style]}>
      <Pressable
        testID={testID}
        onPress={onPress}
        disabled={!onPress}
        accessibilityRole={onPress ? 'button' : 'image'}
        accessibilityLabel={label}
        style={styles.fill}
      >
        <Image source={{ uri }} style={styles.fill} resizeMode="cover" />
      </Pressable>

      <View style={styles.badge}>
        <Icon
          name={source === 'gallery' ? 'gallery' : geotagged ? 'location' : 'warning'}
          size="sm"
          color={source === 'gallery' ? 'ink2' : geotagged ? 'gpsLocked' : 'gpsNone'}
        />
        <Text variant="caption" color="ink0" numberOfLines={1}>
          {provenance}
        </Text>
      </View>

      {onRemove ? (
        <Pressable
          onPress={onRemove}
          accessibilityRole="button"
          accessibilityLabel="Remove photograph"
          accessibilityHint="Removes this photograph from the inspection. Only possible before submission."
          style={styles.remove}
        >
          <Icon name="close" size="md" color="ink0" />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface2,
  },
  fill: { width: '100%', height: '100%' },
  badge: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1],
    paddingHorizontal: space[2],
    paddingVertical: space[1],
    backgroundColor: colors.surface0,
    opacity: 0.9,
  },
  remove: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: layout.touchMin,
    height: layout.touchMin,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
