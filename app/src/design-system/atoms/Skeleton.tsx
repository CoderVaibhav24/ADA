/**
 * Skeleton — a loading placeholder shaped like the content it replaces.
 * Animated with React Native's own Animated rather than a library, and held still when the
 * device asks for reduced motion (ui-tokens.md §6).
 */

import { useEffect, useState } from 'react';
import { AccessibilityInfo, Animated, StyleSheet, type DimensionValue } from 'react-native';

import {
  colors,
  motion,
  radius,
  type ColorToken,
  type LayoutStyle,
  type RadiusToken,
} from '../tokens';

export type SkeletonProps = {
  width?: DimensionValue;
  height: number;
  shape?: RadiusToken;
  tone?: ColorToken;
  style?: LayoutStyle;
};

// Pulses opacity between two fixed points; no shimmer gradient, no extra dependency.
export function Skeleton({ width = '100%', height, shape = 'sm', tone = 'surface2', style }: SkeletonProps) {
  // Lazy state rather than a ref: the value is created once and never read during render.
  const [opacity] = useState(() => new Animated.Value(1));
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (active) {
        setReduceMotion(enabled);
      }
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      active = false;
      subscription.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      opacity.setValue(1);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0.45, duration: motion.slow, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: motion.slow, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [opacity, reduceMotion]);

  return (
    <Animated.View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={[
        styles.block,
        { width, height, borderRadius: radius[shape], backgroundColor: colors[tone], opacity },
        style,
      ]}
    />
  );
}

const styles = StyleSheet.create({
  block: { overflow: 'hidden' },
});
