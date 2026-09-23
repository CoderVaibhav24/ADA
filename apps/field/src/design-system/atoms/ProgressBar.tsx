/**
 * ProgressBar — one wizard step segment, and any other 0..1 measure.
 * Determinate only: an indeterminate bar in this app would be a spinner waiting on the
 * network, which ui-rules.md §2 forbids.
 */

import { StyleSheet, View } from 'react-native';

import {
  colors,
  indicator,
  radius,
  type ColorToken,
  type LayoutStyle,
} from '../tokens';

export type ProgressBarProps = {
  /** 0 to 1. Values outside the range are clamped rather than overflowing the track. */
  value: number;
  tone?: ColorToken;
  trackTone?: ColorToken;
  height?: number;
  accessibilityLabel?: string;
  style?: LayoutStyle;
};

// Clamps and renders; the parent owns the width.
export function ProgressBar({
  value,
  tone = 'brand',
  trackTone = 'surface2',
  height = indicator.progressHeight,
  accessibilityLabel,
  style,
}: ProgressBarProps) {
  const clamped = Math.min(1, Math.max(0, value));
  return (
    <View
      accessible={accessibilityLabel !== undefined}
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
      style={[styles.track, { height, backgroundColor: colors[trackTone] }, style]}
    >
      <View
        style={[
          styles.fill,
          { width: `${clamped * 100}%`, backgroundColor: colors[tone] },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { flex: 1, borderRadius: radius.pill, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
});
