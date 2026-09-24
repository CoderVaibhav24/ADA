import { forwardRef, useState, type ReactNode } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';

import {
  Icon,
  Text,
  colors,
  disabledOpacity,
  elevation,
  fontScaleMax,
  loginMetrics as m,
  pressedOpacity,
  textStyle,
  type ColorToken,
  type IconName,
  type TypographyVariant,
} from '@/design-system';
import { useScriptOf, useT } from '@/services/i18n';

/*
 * The web login's controls (apps/web/src/routes/Login.tsx, Figma 147:900), drawn
 * with tokens. Login-only: the rest of the app uses the design-system atoms.
 */

type FieldProps = {
  label: string;
  labelVariant?: TypographyVariant;
  /** Inline problem under the control, already translated. */
  error?: string | null;
  /** Right-aligned helper under the control, e.g. "7/10 digits". */
  counter?: string | null;
  hint?: ReactNode;
  children: ReactNode;
};

// Label, control, then one line for the problem or the counter.
export function LoginField({ label, labelVariant = 'fieldLabel', error, counter, hint, children }: FieldProps) {
  return (
    <View style={styles.field}>
      <Text variant={labelVariant} maxFontSizeMultiplier={fontScaleMax}>
        {label}
      </Text>
      {children}
      {error || counter ? (
        <View style={styles.fieldMeta}>
          {error ? (
            <View style={styles.inlineError} accessibilityLiveRegion="polite">
              <Icon name="alert" size="sm" color="loginErrorTitle" />
              <Text variant="note" color="loginErrorTitle" style={styles.flex} maxFontSizeMultiplier={fontScaleMax}>
                {error}
              </Text>
            </View>
          ) : (
            <View style={styles.flex} />
          )}
          {counter ? (
            <Text variant="note" color="loginLabel" maxFontSizeMultiplier={fontScaleMax}>
              {counter}
            </Text>
          ) : null}
        </View>
      ) : null}
      {hint}
    </View>
  );
}

type WellProps = Omit<TextInputProps, 'style' | 'placeholderTextColor'> & {
  invalid?: boolean;
  variant?: TypographyVariant;
  /** Room on the right for the eye button. */
  trailing?: ReactNode;
};

// The input well: translucent navy, slate border, ochre border and ring on focus.
export const LoginInput = forwardRef<TextInput, WellProps>(function LoginInput(
  { invalid = false, variant = 'fieldInput', trailing, onFocus, onBlur, ...rest },
  ref,
) {
  const [focused, setFocused] = useState(false);
  const script = useScriptOf(rest.value || rest.placeholder);
  const border: ColorToken = invalid ? 'loginErrorTitle' : focused ? 'loginAccent' : 'loginInputBorder';
  return (
    <View style={[styles.well, { borderColor: colors[border] }, focused ? elevation.loginFocus : null]}>
      <TextInput
        ref={ref}
        placeholderTextColor={colors.loginPlaceholder}
        selectionColor={colors.loginAccent}
        maxFontSizeMultiplier={fontScaleMax}
        onFocus={(event) => {
          setFocused(true);
          onFocus?.(event);
        }}
        onBlur={(event) => {
          setFocused(false);
          onBlur?.(event);
        }}
        style={[textStyle(variant, 'loginInputText', script), styles.input]}
        {...rest}
      />
      {trailing}
    </View>
  );
});

// Show / hide password, a full 48dp target inside the well.
export function EyeButton({ revealed, onPress, disabled }: { revealed: boolean; onPress: () => void; disabled: boolean }) {
  const t = useT();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="togglebutton"
      accessibilityLabel={t(revealed ? 'login.password.hide' : 'login.password.show')}
      accessibilityState={{ checked: revealed, disabled }}
      style={styles.eye}
    >
      <Icon name={revealed ? 'hide' : 'view'} size="md" color="loginEye" />
    </Pressable>
  );
}

// Remember me: white-bordered dark box with an ochre tick; the whole row is the target.
export function RememberBox({ checked, onChange, disabled }: { checked: boolean; onChange: (next: boolean) => void; disabled: boolean }) {
  const t = useT();
  return (
    <Pressable
      onPress={() => onChange(!checked)}
      disabled={disabled}
      accessibilityRole="checkbox"
      accessibilityLabel={t('login.remember')}
      accessibilityHint={t('login.rememberHint')}
      accessibilityState={{ checked, disabled }}
      style={styles.remember}
    >
      <View style={styles.box}>{checked ? <Icon name="check" size="sm" color="loginAccent" strokeWidth={3} /> : null}</View>
      <Text variant="smallCaps" color="loginLabel" maxFontSizeMultiplier={fontScaleMax}>
        {t('login.remember')}
      </Text>
    </Pressable>
  );
}

type LinkProps = {
  label: string;
  icon: IconName;
  onPress: () => void;
  disabled?: boolean;
  accessibilityLabel?: string;
  align?: 'start' | 'end' | 'center';
};

// An ochre text action with its icon, at least 48dp tall.
export function LoginLink({ label, icon, onPress, disabled = false, accessibilityLabel, align = 'center' }: LinkProps) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      style={({ pressed }) => [
        styles.link,
        { justifyContent: align === 'start' ? 'flex-start' : align === 'end' ? 'flex-end' : 'center' },
        { opacity: disabled ? disabledOpacity : pressed ? pressedOpacity : 1 },
      ]}
    >
      <Icon name={icon} size="sm" color="loginAccent" />
      <Text variant="smallCaps" color="loginAccent" maxFontSizeMultiplier={fontScaleMax}>
        {label}
      </Text>
    </Pressable>
  );
}

// LOGIN / VERIFY: ochre, dark-earth label and arrow; a spinner and the busy words while waiting.
export function SubmitButton({ label, busy, onPress }: { label: string; busy: boolean; onPress: () => void }) {
  return (
    <View style={styles.submitWrap}>
      <Pressable
        onPress={onPress}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ disabled: busy, busy }}
        style={({ pressed }) => [
          styles.submit,
          elevation.loginButton,
          { backgroundColor: colors[pressed ? 'loginAccentPressed' : 'loginAccent'], opacity: busy ? disabledOpacity : 1 },
        ]}
      >
        <Text variant="action" color="loginAccentText" numberOfLines={1} maxFontSizeMultiplier={fontScaleMax}>
          {label}
        </Text>
        {busy ? <ActivityIndicator color={colors.loginAccentText} /> : <Icon name="arrowRight" size="md" color="loginAccentText" strokeWidth={2.5} />}
      </Pressable>
    </View>
  );
}

type Tone = 'error' | 'info' | 'notice' | 'warn';

const tones: Record<Tone, { fill: ColorToken; border: ColorToken; ink: ColorToken; icon: IconName; iconInk: ColorToken }> = {
  error: { fill: 'loginErrorFill', border: 'loginErrorBorder', ink: 'loginErrorText', icon: 'alert', iconInk: 'loginErrorTitle' },
  info: { fill: 'loginInfoFill', border: 'loginInfoBorder', ink: 'loginInfoText', icon: 'info', iconInk: 'loginInfoIcon' },
  notice: { fill: 'loginInputFill', border: 'loginNoticeBorder', ink: 'loginInfoText', icon: 'info', iconInk: 'loginInfoText' },
  warn: { fill: 'loginWarnFill', border: 'loginWarnBorder', ink: 'loginWarnText', icon: 'warning', iconInk: 'loginWarnText' },
};

// The web's boxed messages: red for a failure, ochre-edged for the code step, amber for the clock.
export function LoginNotice({ tone, title, lines, icon }: { tone: Tone; title?: string; lines: readonly string[]; icon?: IconName }) {
  const skin = tones[tone];
  return (
    <View
      accessibilityRole={tone === 'error' ? 'alert' : 'text'}
      accessibilityLiveRegion={tone === 'error' ? 'assertive' : 'polite'}
      style={[styles.notice, { backgroundColor: colors[skin.fill], borderColor: colors[skin.border] }]}
    >
      <Icon name={icon ?? skin.icon} size="sm" color={skin.iconInk} />
      <View style={styles.noticeBody}>
        {title ? (
          <Text variant="noteStrong" color={tone === 'error' ? 'loginErrorTitle' : skin.ink} maxFontSizeMultiplier={fontScaleMax}>
            {title}
          </Text>
        ) : null}
        {lines.map((line) => (
          <Text key={line} variant="note" color={skin.ink} maxFontSizeMultiplier={fontScaleMax}>
            {line}
          </Text>
        ))}
      </View>
    </View>
  );
}

// "Facing issues? Contact support at 1800-123-4567"; the whole row dials.
export function SupportLine({ phone, onCall }: { phone: string; onCall: () => void }) {
  const t = useT();
  return (
    <View style={styles.support}>
      <Pressable
        onPress={onCall}
        accessibilityRole="link"
        accessibilityLabel={t('login.support.callA11y', { number: phone })}
        style={({ pressed }) => [styles.supportRow, { opacity: pressed ? pressedOpacity : 1 }]}
      >
        <Icon name="phone" size="md" color="loginAccent" />
        <Text variant="note" color="loginLabel" style={styles.supportText} maxFontSizeMultiplier={fontScaleMax}>
          {`${t('login.support.prefix')} `}
          <Text variant="noteStrong" color="ink0" maxFontSizeMultiplier={fontScaleMax}>
            {phone}
          </Text>
        </Text>
      </Pressable>
    </View>
  );
}

// No number configured: say who to ask, with nothing to dial.
export function SupportNoNumber() {
  const t = useT();
  return (
    <View style={styles.support}>
      <View style={styles.supportRow}>
        <Icon name="phone" size="md" color="loginAccent" />
        <Text variant="note" color="loginLabel" style={styles.supportText} maxFontSizeMultiplier={fontScaleMax}>
          {t('login.support.noNumber')}
        </Text>
      </View>
    </View>
  );
}

type FooterLink = { readonly label: string; readonly url: string | null };

// Figma 163:27 footer. A link with no configured URL is plain text, never a dead link.
export function LoginFooter({ links, version }: { links: readonly FooterLink[]; version: string | null }) {
  const t = useT();
  return (
    <View style={styles.footer}>
      <Text variant="legal" color="loginLabel" align="center" maxFontSizeMultiplier={fontScaleMax}>
        {t('login.footer.copyright')}
      </Text>
      <View style={styles.footerRow}>
        {links.map((link, index) => (
          <View key={link.label} style={styles.footerItem}>
            {index > 0 ? (
              <Text variant="legal" color="loginLabel" maxFontSizeMultiplier={fontScaleMax}>
                {'•'}
              </Text>
            ) : null}
            {link.url === null ? (
              <Text variant="legal" color="loginLabel" maxFontSizeMultiplier={fontScaleMax}>
                {link.label}
              </Text>
            ) : (
              <Pressable
                onPress={() => void Linking.openURL(link.url as string)}
                accessibilityRole="link"
                accessibilityLabel={link.label}
                style={styles.footerLink}
              >
                <Text variant="legal" color="loginInfoText" maxFontSizeMultiplier={fontScaleMax}>
                  {link.label}
                </Text>
              </Pressable>
            )}
          </View>
        ))}
      </View>
      {version ? (
        <Text variant="legal" color="loginLabel" align="center" maxFontSizeMultiplier={fontScaleMax}>
          {t('login.version', { version })}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  field: { width: '100%', gap: m.fieldGap },
  fieldMeta: { flexDirection: 'row', alignItems: 'flex-start', gap: m.noticeGap },
  inlineError: { flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: m.noticeGap },
  well: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: m.controlHeight,
    borderRadius: m.controlRadius,
    borderWidth: m.controlBorder,
    backgroundColor: colors.loginInputFill,
  },
  input: { flex: 1, alignSelf: 'stretch', paddingHorizontal: m.controlPadX },
  eye: { width: m.controlHeight, height: m.controlHeight, alignItems: 'center', justifyContent: 'center' },
  remember: { flexDirection: 'row', alignItems: 'center', gap: m.checkboxGap, minHeight: m.controlHeight, flexShrink: 1 },
  box: {
    width: m.checkbox,
    height: m.checkbox,
    borderRadius: m.checkboxRadius,
    borderWidth: m.controlBorder,
    borderColor: colors.ink0,
    backgroundColor: colors.loginCheckboxFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  link: { flexDirection: 'row', alignItems: 'center', gap: m.noticeGap, minHeight: m.controlHeight, flexShrink: 1 },
  submitWrap: { width: '100%', paddingTop: m.submitTopPad },
  submit: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: m.buttonGap,
    minHeight: m.buttonMinHeight,
    paddingVertical: m.buttonPadY,
    paddingHorizontal: m.controlPadX,
    borderRadius: m.controlRadius,
  },
  notice: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: m.noticeGap,
    paddingHorizontal: m.controlPadX,
    paddingVertical: m.noticePadY,
    borderRadius: m.controlRadius,
    borderWidth: m.cardBorder,
  },
  noticeBody: { flex: 1, gap: m.noticeGap / 2 },
  support: { width: '100%', borderTopWidth: m.cardBorder, borderTopColor: colors.loginDivider, paddingTop: m.supportPadTop },
  supportRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: m.supportGap, minHeight: m.controlHeight },
  supportText: { flexShrink: 1 },
  footer: { alignItems: 'center', gap: m.footerGap, paddingVertical: m.footerPadY },
  footerRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center' },
  footerItem: { flexDirection: 'row', alignItems: 'center', gap: m.footerItemGap, paddingLeft: m.footerItemGap / 2, paddingRight: m.footerItemGap / 2 },
  footerLink: { minHeight: m.controlHeight, justifyContent: 'center' },
});
