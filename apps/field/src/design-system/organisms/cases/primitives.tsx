/**
 * Building blocks for the case screens, drawn to Figma 02/03/09/10/11: text in the
 * frames' type roles, the SVG glyphs from the frames' assets, status and priority
 * badges, and the buttons. Colours come from ./palette only.
 */

import CalendarClock from 'lucide-react-native/icons/calendar-clock';
import CircleCheck from 'lucide-react-native/icons/circle-check';
import CircleDot from 'lucide-react-native/icons/circle-dot';
import Hourglass from 'lucide-react-native/icons/hourglass';
import Sparkles from 'lucide-react-native/icons/sparkles';
import Undo2 from 'lucide-react-native/icons/undo-2';
import type { LucideIcon } from 'lucide-react-native';
import {
  ActivityIndicator,
  Pressable,
  Text as RNText,
  StyleSheet,
  View,
  type AccessibilityProps,
  type TextProps as RNTextProps,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useScriptOf, useT, type TFunction } from '@/services/i18n';

import { Skeleton } from '../../atoms/Skeleton';
import {
  caseDevanagari,
  caseFonts,
  caseInter,
  caseMetrics,
  casePalette,
  caseType,
  type CaseColor,
  type CaseFace,
  type CaseTypeRole,
  type CaseWeight,
  type LayoutStyle,
  type LayoutTextStyle,
} from '../../tokens';

// Noto Sans Devanagari needs about 1.6x the size to clear matras.
const DEVANAGARI_LINE_RATIO = 1.6;

export type CaseTextProps = Omit<RNTextProps, 'style' | 'role'> & {
  kind: CaseTypeRole;
  uppercase?: boolean;
  color?: CaseColor;
  align?: 'left' | 'right' | 'center';
  style?: LayoutTextStyle;
  children?: React.ReactNode;
};

// Text in one of the frames' type roles; switches to Devanagari faces for Hindi.
export function CaseText({ kind, color = 'white', align, uppercase, style, children, ...rest }: CaseTextProps) {
  const script = useScriptOf(children);
  const spec: { weight: CaseWeight; size: number; line: number; track?: number; face?: CaseFace } = caseType[kind];
  const latin = spec.face === 'inter' ? caseInter : caseFonts;
  const hindi = script === 'devanagari';
  return (
    <RNText
      {...rest}
      style={[
        {
          fontFamily: hindi ? caseDevanagari[spec.weight] : latin[spec.weight],
          fontSize: spec.size,
          lineHeight: hindi
            ? Math.max(spec.line, Math.ceil(spec.size * DEVANAGARI_LINE_RATIO))
            : spec.line,
          letterSpacing: hindi ? 0 : spec.track,
          color: casePalette[color],
          textAlign: align,
          textTransform: uppercase ? 'uppercase' : undefined,
        },
        style,
      ]}
    >
      {children}
    </RNText>
  );
}

/* ---------- Glyphs, path data copied from the frames' assets ---------- */

type GlyphProps = { size?: number; color?: CaseColor };

// c65a9.svg — the green target beside the distance.
export function TargetGlyph({ size = caseMetrics.glyphSm, color = 'distance' }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="-0.5 -0.5 12.9167 12.9167">
      <Path
        d="M5.95833 3.79167C4.76125 3.79167 3.79167 4.76125 3.79167 5.95833C3.79167 7.15542 4.76125 8.125 5.95833 8.125C7.15542 8.125 8.125 7.15542 8.125 5.95833C8.125 4.76125 7.15542 3.79167 5.95833 3.79167ZM10.8008 5.41667C10.5517 3.15792 8.75875 1.365 6.5 1.11583V0H5.41667V1.11583C3.15792 1.365 1.365 3.15792 1.11583 5.41667H0V6.5H1.11583C1.365 8.75875 3.15792 10.5517 5.41667 10.8008V11.9167H6.5V10.8008C8.75875 10.5517 10.5517 8.75875 10.8008 6.5H11.9167V5.41667H10.8008ZM5.95833 9.75C3.86208 9.75 2.16667 8.05458 2.16667 5.95833C2.16667 3.86208 3.86208 2.16667 5.95833 2.16667C8.05458 2.16667 9.75 3.86208 9.75 5.95833C9.75 8.05458 8.05458 9.75 5.95833 9.75Z"
        fill={casePalette[color]}
      />
    </Svg>
  );
}

// a6611.svg — the small filled chevron on OPEN.
export function OpenChevron({ color = 'white' }: GlyphProps) {
  return (
    <Svg width={caseMetrics.glyphSm} height={caseMetrics.glyphSm} viewBox="-4.5 -3.25 13 13">
      <Path
        d="M0.76375 0L0 0.76375L2.48083 3.25L0 5.73625L0.76375 6.5L4.01375 3.25L0.76375 0Z"
        fill={casePalette[color]}
      />
    </Svg>
  );
}

// 96be9.svg — location pin on the inspection card footer.
export function PinGlyph({ size = caseMetrics.glyph, color = 'white' }: GlyphProps) {
  const stroke = casePalette[color];
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path
        d="M7 12.25C7 12.25 2.91667 9.04167 2.91667 5.83333C2.91667 3.57968 4.74635 1.75 7 1.75C9.25365 1.75 11.0833 3.57968 11.0833 5.83333C11.0833 9.04167 7 12.25 7 12.25V12.25"
        stroke={stroke}
        strokeWidth={1.05}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M5.54167 5.83333C5.54167 6.63821 6.19512 7.29167 7 7.29167C7.80488 7.29167 8.45833 6.63821 8.45833 5.83333C8.45833 5.02846 7.80488 4.375 7 4.375C6.19512 4.375 5.54167 5.02846 5.54167 5.83333V5.83333"
        stroke={stroke}
        strokeWidth={1.05}
      />
    </Svg>
  );
}

// 34013.svg — the dashed square for an area.
export function AreaGlyph({ size = caseMetrics.glyph, color = 'white' }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path
        d="M2.91667 1.75H11.0833C11.7272 1.75 12.25 2.27277 12.25 2.91667V11.0833C12.25 11.7272 11.7272 12.25 11.0833 12.25H2.91667C2.27277 12.25 1.75 11.7272 1.75 11.0833V2.91667C1.75 2.27277 2.27277 1.75 2.91667 1.75V1.75"
        stroke={casePalette[color]}
        strokeWidth={1.05}
        strokeDasharray="1.17 1.17"
      />
    </Svg>
  );
}

// 2ba0e.svg — the navigation arrow (Figma draws it on the CTA; here it marks "Navigate to site").
export function NavigateGlyph({ size = 18, color = 'white' }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <Path
        d="M8 12.6667L14 14L8 2L2 14L8 12.6667V12.6667M8 12.6667V7.33333"
        stroke={casePalette[color]}
        strokeWidth={1.46667}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// b0567.svg / 6eda1.svg — chevron-left on the bottom Back buttons.
export function BackGlyph({ size = caseMetrics.glyph, color = 'white' }: GlyphProps) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <Path
        d="M9.1875 11.375L4.8125 7L9.1875 2.625"
        stroke={casePalette[color]}
        strokeWidth={1.45833}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

// A lucide glyph in a palette colour (the Icon atom only takes app tokens).
export function CaseIcon({
  glyph: Glyph,
  size = caseMetrics.glyph,
  color = 'white',
}: {
  glyph: LucideIcon;
  size?: number;
  color?: CaseColor;
}) {
  return (
    <Glyph
      size={size}
      color={casePalette[color]}
      strokeWidth={2}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

/* ---------- Status and priority ---------- */

export type StatusTone = 'new' | 'scheduled' | 'in_progress' | 'completed' | 'sent_back' | 'other';

const statusLook: Record<StatusTone, { color: CaseColor; glyph: LucideIcon }> = {
  new: { color: 'statusNew', glyph: Sparkles },
  scheduled: { color: 'statusScheduled', glyph: CalendarClock },
  in_progress: { color: 'statusProgress', glyph: Hourglass },
  completed: { color: 'statusDone', glyph: CircleCheck },
  sent_back: { color: 'statusSentBack', glyph: Undo2 },
  other: { color: 'statusOther', glyph: CircleDot },
};

// Round statuses the inspection register writes, mapped to a look. Unknown reads neutral.
export function toneOfRoundStatus(status: string): StatusTone {
  switch (status) {
    case 'scheduled':
      return 'scheduled';
    case 'in_progress':
      return 'in_progress';
    case 'submitted':
    case 'accepted':
      return 'completed';
    case 'rejected':
      return 'sent_back';
    default:
      return 'other';
  }
}

export type StatusBadgeProps = {
  tone: StatusTone;
  label: string;
  /** 'card' = 02's card style; 'panel' = the map card's style. */
  size?: 'card' | 'panel';
  /** A dark pill behind it, for light cards Figma draws no status on (09). */
  backdrop?: boolean;
  style?: LayoutStyle;
};

// Icon + word + colour, so status never rests on colour alone.
export function StatusBadge({ tone, label, size = 'card', backdrop, style }: StatusBadgeProps) {
  const t = useT();
  const look = statusLook[tone];
  return (
    <View
      accessible
      accessibilityLabel={t('cases.status.a11y', { label })}
      style={[styles.status, size === 'panel' ? styles.noShrink : null, backdrop ? styles.backdrop : null, style]}
    >
      <CaseIcon glyph={look.glyph} size={size === 'card' ? 13 : 14} color={look.color} />
      <CaseText
        kind={size === 'card' ? 'cardStatus' : 'panelStatus'}
        color={look.color}
        numberOfLines={1}
        style={styles.flexShrink}
      >
        {label}
      </CaseText>
    </View>
  );
}

type Priority = 'high' | 'medium' | 'low';

const priorityLook: Record<Priority, { ink: CaseColor; fill: CaseColor; border: CaseColor }> = {
  high: { ink: 'highInk', fill: 'highFill', border: 'highBorder' },
  medium: { ink: 'mediumInk', fill: 'mediumFill', border: 'mediumBorder' },
  low: { ink: 'lowInk', fill: 'lowFill', border: 'lowBorder' },
};

const priorityKey = {
  high: 'priority.high',
  medium: 'priority.medium',
  low: 'priority.low',
} as const;

// 02's priority pill. Unknown or missing priority renders nothing.
export function PriorityBadge({ priority }: { priority: string | null | undefined }) {
  const t = useT();
  if (priority !== 'high' && priority !== 'medium' && priority !== 'low') return null;
  const look = priorityLook[priority];
  const word = t(priorityKey[priority]);
  return (
    <View
      accessible
      accessibilityLabel={t('cases.priority.a11y', { level: word })}
      style={[
        styles.priority,
        { backgroundColor: casePalette[look.fill], borderColor: casePalette[look.border] },
      ]}
    >
      <CaseText kind="priority" color={look.ink} uppercase>
        {word}
      </CaseText>
    </View>
  );
}

/* ---------- Buttons ---------- */

type ButtonBase = Pick<AccessibilityProps, 'accessibilityHint' | 'accessibilityLabel'> & {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  testID?: string;
  style?: LayoutStyle;
};

// 03's "Start Ground Inspection": the screen's one dominant action.
export function PrimaryButton({
  label,
  onPress,
  icon,
  disabled,
  style,
  ...rest
}: ButtonBase & { icon?: React.ReactNode }) {
  return (
    <Pressable
      {...rest}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      style={({ pressed }) => [
        styles.primary,
        { opacity: disabled ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}
    >
      {icon}
      <CaseText kind="button" align="center" style={styles.flexShrink}>
        {label}
      </CaseText>
    </Pressable>
  );
}

// 10/11's Back buttons and "Navigate to site": dark fill, light border.
export function SecondaryButton({
  label,
  onPress,
  icon,
  ink = 'white',
  fullWidth = false,
  disabled,
  style,
  ...rest
}: ButtonBase & { icon?: React.ReactNode; ink?: CaseColor; fullWidth?: boolean }) {
  return (
    <Pressable
      {...rest}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled === true }}
      style={({ pressed }) => [
        styles.secondary,
        fullWidth ? styles.full : styles.hug,
        { opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
        style,
      ]}
    >
      {icon}
      <CaseText kind="buttonBack" color={ink} align="center" style={styles.flexShrink}>
        {label}
      </CaseText>
    </Pressable>
  );
}

// A section title: "Complaint Description", "Inspection Findings".
export function SectionHeading({ children }: { children: string }) {
  return (
    <CaseText kind="sectionHead" accessibilityRole="header">
      {children}
    </CaseText>
  );
}

// A card-shaped shimmer placeholder while a read is pending.
export function SkeletonBlock({ height }: { height: number }) {
  return <Skeleton height={height} shape="md" tone="figDivider" />;
}

// A busy spinner in the palette, for "loading more" at the end of a list.
export function ListSpinner() {
  return <ActivityIndicator color={casePalette.open} style={styles.spinner} />;
}

/* ---------- Distance ---------- */

// "about 2.4 km away": straight line from the last known fix, labelled approximate.
export function distanceText(meters: number, t: TFunction): string {
  const value =
    meters < 1000
      ? t('distance.meters', { value: Math.round(meters / 10) * 10 })
      : t('distance.km', { value: (meters / 1000).toFixed(1) });
  return t('cases.card.distance', { value });
}

const styles = StyleSheet.create({
  status: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  noShrink: { flexShrink: 0 },
  backdrop: {
    backgroundColor: casePalette.mapPanel,
    borderRadius: caseMetrics.pillRadius,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  priority: {
    borderRadius: caseMetrics.pillRadius,
    borderWidth: caseMetrics.hairline,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'center',
  },
  primary: {
    minHeight: caseMetrics.primaryHeight,
    borderRadius: caseMetrics.primaryRadius,
    backgroundColor: casePalette.primary,
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    boxShadow: `0 10px 15px -3px ${casePalette.shadow}, 0 4px 6px -4px ${casePalette.shadow}`,
  },
  secondary: {
    minHeight: caseMetrics.secondaryHeight,
    borderRadius: caseMetrics.buttonRadius,
    backgroundColor: casePalette.secondary,
    borderWidth: caseMetrics.hairline,
    borderColor: casePalette.secondaryBorder,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 8,
  },
  hug: { alignSelf: 'center', paddingHorizontal: 24 },
  full: { alignSelf: 'stretch', paddingHorizontal: 16 },
  flexShrink: { flexShrink: 1 },
  spinner: { paddingVertical: 16 },
});
