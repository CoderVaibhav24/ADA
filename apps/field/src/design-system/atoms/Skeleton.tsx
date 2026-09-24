/**
 * Skeleton — a loading placeholder shaped like the content it replaces.
 * A soft highlight sweeps left to right across the block; every skeleton sweeps in step so a
 * list reads as one surface. Held still when the device asks for reduced motion (ui-tokens.md §6).
 */

import { useEffect, useId, useState } from 'react';
import { StyleSheet, View, type DimensionValue, type LayoutChangeEvent } from 'react-native';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

import { useT } from '@/services/i18n';

import { colors, radius, type ColorToken, type LayoutStyle, type RadiusToken } from '../tokens';

export type SkeletonProps = {
  width?: DimensionValue;
  height: number;
  shape?: RadiusToken;
  tone?: ColorToken;
  style?: LayoutStyle;
};

// One sweep across the block; no motion token is this long.
const SWEEP_MS = 1200;
// The highlight band, as a share of the block's width.
const BAND_SHARE = 0.6;
// White over any tone lifts it evenly, light or translucent.
const HIGHLIGHT_OPACITY = 0.14;

// A base block with a gradient band looping across it on the UI thread.
export function Skeleton({ width = '100%', height, shape = 'sm', tone = 'surface2', style }: SkeletonProps) {
  const t = useT();
  const reduceMotion = useReducedMotion();
  const gradientId = `skeleton-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const [blockWidth, setBlockWidth] = useState(0);
  const bandWidth = blockWidth * BAND_SHARE;
  const offset = useSharedValue(0);

  useEffect(() => {
    if (reduceMotion || blockWidth === 0) return;
    offset.value = -bandWidth;
    offset.value = withDelay(
      0,
      withRepeat(withTiming(blockWidth, { duration: SWEEP_MS, easing: Easing.inOut(Easing.ease) }), -1, false),
    );
    return () => cancelAnimation(offset);
  }, [offset, reduceMotion, blockWidth, bandWidth]);

  const bandStyle = useAnimatedStyle(() => ({ transform: [{ translateX: offset.value }] }));

  const onLayout = (event: LayoutChangeEvent) => setBlockWidth(event.nativeEvent.layout.width);

  return (
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('common.loading')}
      onLayout={onLayout}
      style={[styles.block, { width, height, borderRadius: radius[shape], backgroundColor: colors[tone] }, style]}
    >
      {!reduceMotion && bandWidth > 0 ? (
        <Animated.View pointerEvents="none" style={[styles.band, { width: bandWidth }, bandStyle]}>
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                <Stop offset="0" stopColor={colors.white} stopOpacity={0} />
                <Stop offset="0.5" stopColor={colors.white} stopOpacity={HIGHLIGHT_OPACITY} />
                <Stop offset="1" stopColor={colors.white} stopOpacity={0} />
              </LinearGradient>
            </Defs>
            <Rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId})`} />
          </Svg>
        </Animated.View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { overflow: 'hidden' },
  band: { position: 'absolute', top: 0, bottom: 0, left: 0 },
});
