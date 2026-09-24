/**
 * The inspection wizard's building blocks, drawn to Figma frames 04–08 and 14–17 with the
 * wizard tokens (tokens/wizard.ts). Local to the wizard until the shared atoms carry the
 * Mobile-page styles; nothing here fetches.
 */

import { createElement } from 'react';
import { ActivityIndicator, Modal, Pressable, Text as RNText, StyleSheet, View, type TextProps } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { useScriptOf, useT } from '@/services/i18n';

import { iconGlyph, type IconName } from '../../atoms';
import {
  wizardColors,
  wizardMetrics as m,
  wizardText,
  type LayoutStyle,
  type LayoutTextStyle,
  type WizardColor,
  type WizardTextVariant,
} from '../../tokens';

// ---------------------------------------------------------------- text

export type WTextProps = Omit<TextProps, 'style'> & {
  variant: WizardTextVariant;
  color?: WizardColor;
  align?: 'left' | 'center' | 'right';
  style?: LayoutTextStyle;
  children?: React.ReactNode;
};

// Text in a wizard type style; Hindi switches to Noto with room for matras.
export function WText({ variant, color = 'white', align, style, children, ...rest }: WTextProps) {
  const script = useScriptOf(children);
  return (
    <RNText {...rest} style={[wizardText(variant, color, script), align ? { textAlign: align } : null, style]}>
      {children}
    </RNText>
  );
}

// ---------------------------------------------------------------- glyphs

type GlyphProps = { size?: number; color?: WizardColor };

// Figma assets drawn from their own path data (04–08); decorative, labels carry the meaning.
const figmaGlyphs = {
  pin: { box: 24, stroke: 2, paths: ['M21 10C21 17 12 23 12 23C12 23 3 17 3 10C3 5.03276 7.03276 1 12 1C16.9672 1 21 5.03276 21 10V10', 'M9 10C9 11.6557 10.3443 13 12 13C13.6557 13 15 11.6557 15 10C15 8.34425 13.6557 7 12 7C10.3443 7 9 8.34425 9 10V10'] },
  check: { box: 16, stroke: 1.66667, paths: ['M13.3333 4L6 11.3333L2.66667 8'] },
  tick: { box: 16, stroke: 2, paths: ['M3.33333 8.66667L6 11.3333L12.6667 4.66667'] },
  bigTick: { box: 40, stroke: 5.83333, paths: ['M8.33333 21.6667L15 28.3333L31.6667 11.6667'] },
  chevronLeft: { box: 14, stroke: 1.45833, paths: ['M9.1875 11.375L4.8125 7L9.1875 2.625'] },
  chevronRight: { box: 14, stroke: 1.45833, paths: ['M4.8125 2.625L9.1875 7L4.8125 11.375'] },
  chevronDown: { box: 16, stroke: 1.66667, paths: ['M12.6667 6L8 10.6667L3.33333 6'] },
  camera: { box: 24, stroke: 1.8, paths: ['M6.827 6.175C6.46262 6.75173 5.86195 7.1379 5.186 7.23C4.806 7.284 4.429 7.342 4.052 7.405C2.999 7.58 2.25 8.507 2.25 9.574V18C2.25 19.2418 3.25819 20.25 4.5 20.25H19.5C20.7418 20.25 21.75 19.2418 21.75 18V9.574C21.75 8.507 21 7.58 19.948 7.405C19.5707 7.34214 19.1927 7.2838 18.814 7.23C18.1384 7.13762 17.5382 6.75148 17.174 6.175L16.352 4.859C15.9773 4.25036 15.3294 3.8626 14.616 3.82C12.8733 3.72639 11.1267 3.72639 9.384 3.82C8.67055 3.8626 8.02267 4.25036 7.648 4.859L6.827 6.175V6.175', 'M16.5 12.75C16.5 15.2336 14.4836 17.25 12 17.25C9.51638 17.25 7.5 15.2336 7.5 12.75C7.5 10.2664 9.51638 8.25 12 8.25C14.4836 8.25 16.5 10.2664 16.5 12.75V12.75M18.75 10.5H18.758V10.508H18.75V10.5V10.5'] },
  // ffb4e.svg is a 21.23×16 group centred in a 24 box.
  eye: { box: 24, stroke: 2, origin: '-1.387 -4', paths: ['M19.8703 9.038C20.3443 8.419 20.3443 7.582 19.8703 6.962C18.3773 5.013 14.7953 1 10.6133 1C6.43134 1 2.84934 5.013 1.35634 6.962C1.12539 7.25873 1 7.62399 1 8C1 8.37601 1.12539 8.74127 1.35634 9.038C2.84934 10.987 6.43134 15 10.6133 15C14.7953 15 18.3773 10.987 19.8703 9.038Z', 'M10.6133 11C12.2702 11 13.6133 9.65685 13.6133 8C13.6133 6.34315 12.2702 5 10.6133 5C8.95648 5 7.61334 6.34315 7.61334 8C7.61334 9.65685 8.95648 11 10.6133 11Z'] },
  grip: { box: 10, stroke: 1.5, paths: ['M8 2L2 8', 'M8 5L5 8'] },
} as const;

export type FigmaGlyph = keyof typeof figmaGlyphs;

export function Glyph({ name, size, color = 'white' }: GlyphProps & { name: FigmaGlyph }) {
  const glyph: { box: number; stroke: number; origin?: string; paths: readonly string[] } = figmaGlyphs[name];
  const px = size ?? glyph.box;
  return (
    <Svg width={px} height={px} viewBox={`${glyph.origin ?? '0 0'} ${glyph.box} ${glyph.box}`} fill="none" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {glyph.paths.map((d) => (
        <Path key={d} d={d} stroke={wizardColors[color]} strokeWidth={glyph.stroke} strokeLinecap="round" strokeLinejoin="round" />
      ))}
    </Svg>
  );
}

// 899f0.svg, the red circled x on a photo tile (filled paths).
export function RemoveGlyph({ size = m.removeGlyph }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 14 14" accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Path d="M7 0.875C3.5875 0.875 0.875 3.5875 0.875 7C0.875 10.4125 3.5875 13.125 7 13.125C10.4125 13.125 13.125 10.4125 13.125 7C13.125 3.5875 10.4125 0.875 7 0.875ZM7 12.25C4.1125 12.25 1.75 9.8875 1.75 7C1.75 4.1125 4.1125 1.75 7 1.75C9.8875 1.75 12.25 4.1125 12.25 7C12.25 9.8875 9.8875 12.25 7 12.25Z" fill={wizardColors.remove} />
      <Path d="M9.3625 10.0625L7 7.7L4.6375 10.0625L3.9375 9.3625L6.3 7L3.9375 4.6375L4.6375 3.9375L7 6.3L9.3625 3.9375L10.0625 4.6375L7.7 7L10.0625 9.3625L9.3625 10.0625Z" fill={wizardColors.remove} />
    </Svg>
  );
}

// Glyphs for states and options that Figma does not draw: the Icon atom's Lucide set.
const lucide = {
  alert: 'alert',
  warning: 'warning',
  ok: 'success',
  info: 'info',
  offline: 'offline',
  sync: 'sync',
  upload: 'cloudUpload',
  clock: 'clock',
  storage: 'storage',
  retake: 'retake',
  trash: 'remove',
  settings: 'settings',
  location: 'location',
  signalGood: 'signalGood',
  signalFair: 'signalFair',
  signalWeak: 'signalWeak',
  user: 'user',
  phone: 'phone',
  note: 'note',
  measure: 'measure',
  // Encroachment Confirmed (179:7478)
  yes: 'success',
  partial: 'unsure',
  no: 'refused',
  // Construction / Occupation Type (179:7445)
  rcc: 'building',
  semiPermanent: 'home',
  shed: 'shed',
  agricultural: 'crop',
  levelling: 'land',
  fencing: 'fence',
  // External Support Required (179:7499)
  none: 'none',
  police: 'police',
  survey: 'measure',
  legal: 'legal',
  // Recommendation (179:7524)
  notice: 'noticeFile',
  legalCase: 'gavel',
  demolition: 'hammer',
  investigate: 'search',
  noAction: 'verified',
  fine: 'rupee',
} as const satisfies Record<string, IconName>;

export type WizardIconName = keyof typeof lucide;

export function WIcon({ name, size = 20, color = 'white' }: GlyphProps & { name: WizardIconName }) {
  // createElement, not a local <Icon />: the glyph is a lookup, not a component made per render.
  return createElement(iconGlyph(lucide[name]), {
    size,
    color: wizardColors[color],
    strokeWidth: 2,
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants',
  });
}

// ---------------------------------------------------------------- buttons

export type WButtonProps = {
  label: string;
  onPress: () => void;
  variant?: 'primary' | 'secondary';
  leading?: React.ReactNode;
  trailing?: React.ReactNode;
  disabled?: boolean;
  loading?: boolean;
  /** 12/16 label used by "Submit Findings" and "View Full Report" is raised to 14 here. */
  inkColor?: WizardColor;
  accessibilityHint?: string;
  style?: LayoutStyle;
};

// 179:7212 (primary) and 253:640 (secondary), at 48 tall.
export function WButton({
  label,
  onPress,
  variant = 'primary',
  leading,
  trailing,
  disabled = false,
  loading = false,
  inkColor = 'white',
  accessibilityHint,
  style,
}: WButtonProps) {
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => [
        styles.button,
        variant === 'primary' ? styles.primary : styles.secondary,
        pressed && !inactive ? (variant === 'primary' ? styles.primaryPressed : styles.secondaryPressed) : null,
        disabled ? styles.disabled : null,
        style,
      ]}
    >
      {loading ? <ActivityIndicator size="small" color={wizardColors[inkColor]} /> : leading}
      <WText variant="button" color={inkColor} numberOfLines={2} align="center" style={styles.buttonLabel}>
        {label}
      </WText>
      {loading ? null : trailing}
    </Pressable>
  );
}

// Back and Next side by side, equal widths, gap 14 (179:7205).
export function ActionRow({ children, style }: { children: React.ReactNode; style?: LayoutStyle }) {
  return <View style={[styles.actionRow, style]}>{children}</View>;
}

// ---------------------------------------------------------------- notices

export type NoticeTone = 'warn' | 'error' | 'ok' | 'info';

const toneStyle: Record<NoticeTone, { border: WizardColor; ink: WizardColor; icon: WizardIconName }> = {
  warn: { border: 'noticeBorderWarn', ink: 'warn', icon: 'warning' },
  error: { border: 'noticeBorderError', ink: 'error', icon: 'alert' },
  ok: { border: 'noticeBorderOk', ink: 'ok', icon: 'ok' },
  info: { border: 'noticeBorderInfo', ink: 'beige', icon: 'info' },
};

export type NoticeProps = {
  tone: NoticeTone;
  title?: string;
  body?: string;
  icon?: WizardIconName;
  children?: React.ReactNode;
  live?: boolean;
  style?: LayoutStyle;
};

// A state Figma does not draw: icon + words + next step, never colour alone.
export function Notice({ tone, title, body, icon, children, live = true, style }: NoticeProps) {
  const look = toneStyle[tone];
  return (
    <View
      style={[styles.notice, { borderColor: wizardColors[look.border] }, style]}
      accessibilityRole={tone === 'error' ? 'alert' : 'summary'}
      accessibilityLiveRegion={live ? 'polite' : 'none'}
    >
      <View style={styles.noticeRow}>
        <WIcon name={icon ?? look.icon} size={22} color={look.ink} />
        <View style={styles.flex}>
          {title ? (
            <WText variant="noteBold" color={look.ink}>
              {title}
            </WText>
          ) : null}
          {body ? (
            <WText variant="note" color="stepBody">
              {body}
            </WText>
          ) : null}
        </View>
      </View>
      {children ? <View style={styles.noticeActions}>{children}</View> : null}
    </View>
  );
}

// ---------------------------------------------------------------- progress + step header

// 179:6355: four 3.5px segments, done/current orange, pending dark.
export function ProgressSegments({ current, total }: { current: number; total: number }) {
  const t = useT();
  return (
    <View
      style={styles.progress}
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={t('wizard.progressA11y', { current, total })}
      accessibilityValue={{ min: 0, max: total, now: current }}
    >
      {Array.from({ length: total }, (_, index) => (
        <View
          key={index}
          style={[styles.segment, { backgroundColor: wizardColors[index < current ? 'progressDone' : 'progressTodo'] }]}
        />
      ))}
    </View>
  );
}

// 179:6364: "STEP n OF 4", the step title and its one-paragraph instruction.
export function StepHeader({
  current,
  total,
  title,
  body,
  bodyColor = 'stepBody',
}: {
  current: number;
  total: number;
  title: string;
  body: string;
  bodyColor?: WizardColor;
}) {
  const t = useT();
  return (
    <View style={styles.stepHeader}>
      <WText variant="stepLabel" color="accent">
        {t('wizard.step', { current, total })}
      </WText>
      <WText variant="stepTitle" accessibilityRole="header">
        {title}
      </WText>
      <WText variant="stepBody" color={bodyColor} style={styles.stepBody}>
        {body}
      </WText>
    </View>
  );
}

// ---------------------------------------------------------------- fields

// 179:7368 label, with an icon beside it (field-use rule) and a "required" mark for screen readers.
export function FieldLabel({ label, icon, required }: { label: string; icon: WizardIconName; required?: boolean }) {
  const t = useT();
  return (
    <View style={styles.labelRow} accessible accessibilityLabel={required ? `${label}, ${t('wizard.required')}` : label}>
      <WIcon name={icon} size={16} color="beige" />
      <WText variant="fieldLabel" color="beige" style={styles.flex}>
        {label}
        {required ? ' *' : ''}
      </WText>
    </View>
  );
}

// The problem under a field: icon + words, announced when it appears.
export function FieldError({ message }: { message: string | null | undefined }) {
  if (message === null || message === undefined) return null;
  return (
    <View style={styles.errorRow} accessibilityRole="alert" accessibilityLiveRegion="polite">
      <WIcon name="alert" size={16} color="error" />
      <WText variant="error" color="error" style={styles.flex}>
        {message}
      </WText>
    </View>
  );
}

// ---------------------------------------------------------------- confirm sheet

export type ConfirmSheetProps = {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  confirmIcon?: React.ReactNode;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

// Asks once before anything that cannot be undone. Two large buttons; Cancel is the safe default.
export function ConfirmSheet({
  visible,
  title,
  body,
  confirmLabel,
  cancelLabel,
  confirmIcon,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <View style={styles.scrim}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.sheetHead}>
            <WIcon name={destructive ? 'trash' : 'warning'} size={28} color={destructive ? 'error' : 'warn'} />
            <WText variant="sheetTitle" accessibilityRole="header" style={styles.flex}>
              {title}
            </WText>
          </View>
          <WText variant="stepBody" color="stepBody">
            {body}
          </WText>
          <View style={styles.sheetActions}>
            <WButton label={confirmLabel} onPress={onConfirm} leading={confirmIcon} />
            <WButton
              label={cancelLabel}
              variant="secondary"
              onPress={onCancel}
              leading={<Glyph name="chevronLeft" />}
              inkColor="secondaryInkDone"
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  button: {
    flex: 1,
    minHeight: m.control,
    borderRadius: m.controlRadius,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  buttonLabel: { flexShrink: 1 },
  primary: { backgroundColor: wizardColors.accent },
  primaryPressed: { backgroundColor: wizardColors.accentPressed },
  secondary: {
    backgroundColor: wizardColors.secondary,
    borderWidth: m.hairline,
    borderColor: wizardColors.secondaryBorder,
  },
  secondaryPressed: { backgroundColor: wizardColors.tile },
  disabled: { opacity: 0.5 },
  actionRow: { flexDirection: 'row', gap: m.buttonGap, alignItems: 'stretch' },
  notice: {
    gap: 10,
    padding: 14,
    borderRadius: m.controlRadius,
    borderWidth: m.hairline,
    backgroundColor: wizardColors.noticeFill,
  },
  noticeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  noticeActions: { gap: 10 },
  progress: { flexDirection: 'row', gap: m.progressGap, marginBottom: m.progressBottom },
  segment: { flex: 1, height: m.progressHeight, borderRadius: m.progressHeight / 2 },
  stepHeader: { gap: m.titleGap, paddingTop: 4 },
  stepBody: { paddingTop: 2 },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  errorRow: { flexDirection: 'row', gap: 6, alignItems: 'flex-start', paddingTop: 2 },
  scrim: {
    flex: 1,
    backgroundColor: wizardColors.scrim,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  sheet: {
    width: '100%',
    maxWidth: m.sheetMaxWidth,
    gap: 16,
    padding: 20,
    paddingBottom: 32,
    borderTopLeftRadius: m.sheetRadius,
    borderTopRightRadius: m.sheetRadius,
    backgroundColor: wizardColors.card,
    borderWidth: m.hairline,
    borderColor: wizardColors.cardBorder,
  },
  sheetHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetActions: { gap: 12 },
});
