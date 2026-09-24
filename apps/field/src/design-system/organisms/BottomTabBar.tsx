/**
 * BottomTabBar — a floating frosted-glass bar with a concave notch in its top edge. The active
 * tab's glyph rises out of the bar into a glass circle sitting in the notch; notch and circle
 * spring together to whichever tab is active. Screens pad by the TabBarInsetContext value.
 */

import MaskedView from '@react-native-masked-view/masked-view';
import { BlurView } from 'expo-blur';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Keyboard, Platform, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import Svg, { ClipPath, Defs, G, LinearGradient, Path, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { useT } from '@/services/i18n';

import { Glyph, type GlyphName } from '../atoms';
import { TabBarItem } from '../molecules';
import { colors, control, elevation, shell, spring } from '../tokens';
import { barSidesPath, clampNotchX, notchHalfWidth, wideNotchEdge, wideNotchPath, type NotchGeometry } from './tabbar/notchPath';

export type BottomTabKey = 'home' | 'complaints' | 'inspection' | 'profile';

export type BottomTabBarProps = {
  active: BottomTabKey;
  onSelect: (key: BottomTabKey) => void;
  /** The safe-area inset under the bar (gesture area or 3-button nav). */
  bottomInset: number;
};

type Slot = { key: BottomTabKey; glyph: GlyphName; width: number };

const TABS: readonly Slot[] = [
  { key: 'home', glyph: 'house', width: shell.tabGlyphHome },
  { key: 'complaints', glyph: 'fileReport', width: shell.tabGlyphFile },
  { key: 'inspection', glyph: 'inspection', width: shell.tabGlyphInspection },
  { key: 'profile', glyph: 'person', width: shell.tabGlyphPerson },
];

const LABEL_KEYS = {
  home: 'shell.tabs.home',
  complaints: 'shell.tabs.complaints',
  inspection: 'shell.tabs.inspection',
  profile: 'shell.tabs.profile',
} as const;

const IS_ANDROID = Platform.OS === 'android';
const BODY = shell.tabBarBody;
const CIRCLE_R = shell.tabCircle / 2;
// The dip's geometry: an arc about the circle's centre, which sits this far below the bar's top edge.
const NOTCH = { notchR: shell.tabNotchRadius, centreY: CIRCLE_R - shell.tabCircleOverhang, shoulder: shell.tabNotchShoulder };
const HALF = notchHalfWidth(NOTCH);
const HIGHLIGHT = shell.tabHighlightWidth;
const EDGE = control.hairline;

// Hidden while the keyboard is up on Android, where the window resizes and the bar would ride on it.
function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!IS_ANDROID) return;
    const show = Keyboard.addListener('keyboardDidShow', () => setOpen(true));
    const hide = Keyboard.addListener('keyboardDidHide', () => setOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return open;
}

// Side padding that keeps the outer slots' notch clear of the bar's rounded corners, and the slot width left over.
function slotGeometry(width: number) {
  const n = shell.tabCount;
  const needed = shell.tabBarRadius + HALF - width / (2 * n);
  const padX = width > 0 ? Math.max(0, needed / (1 - 1 / n)) : 0;
  return { padX, slotWidth: (width - 2 * padX) / n };
}

// Springs the notch centre to `target` and hops the circle on a tab change; the first placement and reduce motion jump.
function useNotch(target: number, index: number, ready: boolean) {
  const reduceMotion = useReducedMotion();
  const notchX = useSharedValue(0);
  const lift = useSharedValue(1);
  const placed = useRef(false);
  const lastIndex = useRef(index);
  useEffect(() => {
    if (!ready) return;
    const changed = lastIndex.current !== index;
    lastIndex.current = index;
    if (reduceMotion || !placed.current) {
      placed.current = true;
      notchX.value = withTiming(target, { duration: 0 });
      return;
    }
    notchX.value = withSpring(target, spring.tabIndicator);
    if (changed) lift.value = withSequence(withSpring(shell.tabCircleLift, spring.tabIndicator), withSpring(1, spring.tabIndicator));
  }, [target, index, ready, reduceMotion, notchX, lift]);
  return { notchX, lift };
}

// The notch geometry for a line drawn `inset` below the top edge.
function insetNotch(inset: number): NotchGeometry {
  return { notchR: NOTCH.notchR + inset, centreY: NOTCH.centreY - inset, shoulder: NOTCH.shoulder - inset };
}

// The only per-frame work: a translate from the notch centre, clamped clear of the corners. Strip and circle share it.
function useSlide(notchX: SharedValue<number>, width: number, shift: number, scale?: SharedValue<number>) {
  return useAnimatedStyle(() => {
    const x = clampNotchX(notchX.value, width, shell.tabBarRadius, HALF) - shift;
    return { transform: scale ? [{ translateX: x }, { scale: scale.value }] : [{ translateX: x }] };
  });
}

type StripProps = { width: number; notchX: SharedValue<number>; clipLeft?: number; children: ReactNode };

// An SVG twice the bar's width with the notch at its centre, slid so the notch sits under `notchX`.
function Strip({ width, notchX, clipLeft = 0, children }: StripProps) {
  const slide = useSlide(notchX, width, width + clipLeft);
  return (
    <Animated.View style={[styles.strip, { width: 2 * width }, slide]}>
      <Svg width={2 * width} height={BODY}>
        {children}
      </Svg>
    </Animated.View>
  );
}

// Android has no blur: a BlurView targeting an ancestor that contains it recurses the render thread into a crash.
function Frost({ glass, solid }: { glass: string; solid: string }) {
  return (
    <>
      {IS_ANDROID ? null : <BlurView intensity={shell.tabBlur} tint="dark" style={StyleSheet.absoluteFill} />}
      <View style={[StyleSheet.absoluteFill, { backgroundColor: IS_ANDROID ? solid : glass }]} />
    </>
  );
}

/*
 * The bar body. Paths are built once per width; the notch moves by sliding them. A rounded clip makes
 * the corners, the sides' edge is drawn still, and the top edge slides in a clip between the corners.
 * iOS masks its blur with the same sliding strip; Android has no blur, so no mask.
 */
function NotchedGlass({ width, notchX }: { width: number; notchX: SharedValue<number> }) {
  const paths = useMemo(
    () => ({
      fill: wideNotchPath(2 * width, BODY, NOTCH),
      edge: wideNotchEdge(2 * width, insetNotch(EDGE / 2)),
      highlight: wideNotchEdge(2 * width, insetNotch(HIGHLIGHT / 2)),
      sidesEdge: barSidesPath(width, BODY, shell.tabBarRadius, EDGE / 2),
      sidesHighlight: barSidesPath(width, BODY, shell.tabBarRadius, HIGHLIGHT / 2),
    }),
    [width],
  );
  return (
    <>
      <View style={styles.clip}>
        {IS_ANDROID ? null : (
          <MaskedView
            style={StyleSheet.absoluteFill}
            maskElement={
              <Strip width={width} notchX={notchX}>
                {/* The mask reads alpha only; any opaque colour cuts the shape. */}
                <Path d={paths.fill} fill={colors.white} />
              </Strip>
            }
          >
            <BlurView intensity={shell.tabBlur} tint="dark" style={StyleSheet.absoluteFill} />
          </MaskedView>
        )}
        <Strip width={width} notchX={notchX}>
          <Defs>
            {/* A top sheen fading out by `sheenEnd`, plus a dark band from `shadeStart` down: curved glass. */}
            <LinearGradient id="tab-glass-sheen" x1="0" y1="0" x2="0" y2="1">
              <Stop offset={0} stopColor={colors.tabGlassSheen} stopOpacity={shell.tabSheenOpacity} />
              <Stop offset={shell.tabSheenEnd} stopColor={colors.tabGlassSheen} stopOpacity={0} />
              <Stop offset={shell.tabShadeStart} stopColor={colors.tabGlassShade} stopOpacity={0} />
              <Stop offset={1} stopColor={colors.tabGlassShade} stopOpacity={shell.tabShadeOpacity} />
            </LinearGradient>
          </Defs>
          <Path d={paths.fill} fill={IS_ANDROID ? colors.tabGlassSolid : colors.tabGlass} />
          <Path d={paths.fill} fill="url(#tab-glass-sheen)" />
        </Strip>
        <View style={styles.innerShadow} />
      </View>
      <Svg style={StyleSheet.absoluteFill} width={width} height={BODY}>
        <Defs>
          <ClipPath id="tab-sides-upper">
            <Rect x="0" y="0" width={width} height={BODY / 2} />
          </ClipPath>
        </Defs>
        <Path d={paths.sidesEdge} fill="none" stroke={colors.tabGlassBorder} strokeWidth={EDGE} />
        <G clipPath="url(#tab-sides-upper)">
          <Path d={paths.sidesHighlight} fill="none" stroke={colors.tabGlassHighlight} strokeWidth={HIGHLIGHT} />
        </G>
      </Svg>
      <View style={styles.topClip}>
        <Strip width={width} notchX={notchX} clipLeft={shell.tabBarRadius}>
          <Defs>
            <ClipPath id="tab-top-upper">
              <Rect x="0" y="0" width={2 * width} height={BODY / 2} />
            </ClipPath>
          </Defs>
          <G y={EDGE / 2}>
            <Path d={paths.edge} fill="none" stroke={colors.tabGlassBorder} strokeWidth={EDGE} />
          </G>
          <G clipPath="url(#tab-top-upper)">
            <G y={HIGHLIGHT / 2}>
              <Path d={paths.highlight} fill="none" stroke={colors.tabGlassHighlight} strokeWidth={HIGHLIGHT} />
            </G>
          </G>
        </Strip>
      </View>
    </>
  );
}

type CircleProps = { slot: Slot; width: number; notchX: SharedValue<number>; lift: SharedValue<number> };

// The floating glass circle holding the active glyph; it rides the same clamped notch centre as the strip.
function Circle({ slot, width, notchX, lift }: CircleProps) {
  const style = useSlide(notchX, width, CIRCLE_R, lift);
  return (
    <Animated.View style={[styles.circle, style]} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={styles.circleGlass}>
        <Frost glass={colors.tabCircleGlass} solid={colors.tabCircleFill} />
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <RadialGradient id="tab-circle-sheen" cx="50%" cy="25%" r="75%">
              <Stop offset={0} stopColor={colors.tabCircleSheen} stopOpacity={shell.tabCircleSheenOpacity} />
              <Stop offset={1} stopColor={colors.tabCircleSheen} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Rect x="0" y="0" width="100%" height="100%" fill="url(#tab-circle-sheen)" />
        </Svg>
        <Glyph name={slot.glyph} width={slot.width} color="white" />
      </View>
    </Animated.View>
  );
}

// The navigator owns which tab is active; the bar draws it and reports taps.
export function BottomTabBar({ active, onSelect, bottomInset }: BottomTabBarProps) {
  const t = useT();
  const keyboardOpen = useKeyboardOpen();
  const [width, setWidth] = useState(0);
  const index = Math.max(0, TABS.findIndex((slot) => slot.key === active));
  const { padX, slotWidth } = slotGeometry(width);
  const { notchX, lift } = useNotch(padX + index * slotWidth + slotWidth / 2, index, width > 0);

  if (keyboardOpen) return null;

  const onLayout = (event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width);

  return (
    <View pointerEvents="box-none" style={[styles.frame, { height: shell.tabBarHeight + shell.tabBarGap + bottomInset }]}>
      <View style={[styles.bar, { bottom: shell.tabBarGap + bottomInset }]} onLayout={onLayout} accessibilityRole="tablist">
        {width > 0 ? (
          <>
            <View style={styles.body} pointerEvents="none">
              <NotchedGlass width={width} notchX={notchX} />
            </View>
            <Circle slot={TABS[index] ?? TABS[0]!} width={width} notchX={notchX} lift={lift} />
          </>
        ) : null}
        <View style={[styles.row, { paddingHorizontal: padX }]}>
          {TABS.map((item) => (
            <TabBarItem
              key={item.key}
              testID={`tab-${item.key}`}
              glyph={item.glyph}
              glyphWidth={item.width}
              label={t(LABEL_KEYS[item.key])}
              active={item.key === active}
              onPress={() => onSelect(item.key)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  bar: {
    position: 'absolute',
    left: shell.tabBarMarginX,
    right: shell.tabBarMarginX,
    height: shell.tabBarHeight,
  },
  // Holds the shadow outside the mask, which would clip it.
  body: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: shell.tabCircleOverhang,
    height: BODY,
    borderRadius: shell.tabBarRadius,
    ...elevation.tabPill,
  },
  clip: { ...StyleSheet.absoluteFill, borderRadius: shell.tabBarRadius, overflow: 'hidden' },
  // The top edge's strokes, between the corners the still sides path draws.
  topClip: { position: 'absolute', top: 0, bottom: 0, left: shell.tabBarRadius, right: shell.tabBarRadius, overflow: 'hidden' },
  strip: { position: 'absolute', top: 0, left: 0, height: BODY },
  innerShadow: {
    ...StyleSheet.absoluteFill,
    borderRadius: shell.tabBarRadius,
    borderBottomWidth: control.hairline,
    borderBottomColor: colors.tabGlassInnerShadow,
  },
  circle: {
    position: 'absolute',
    top: 0,
    left: 0,
    width: shell.tabCircle,
    height: shell.tabCircle,
    borderRadius: CIRCLE_R,
    ...elevation.tabCircleGlow,
  },
  circleGlass: {
    flex: 1,
    borderRadius: CIRCLE_R,
    borderWidth: control.hairline,
    borderColor: colors.tabGlassBorder,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  row: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: shell.tabCircleOverhang,
    height: BODY,
    flexDirection: 'row',
  },
});
