import { Image } from 'expo-image';
import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  useWindowDimensions,
  type TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Icon,
  LanguageToggle,
  Text,
  colors,
  control,
  elevation,
  fontScaleMax,
  loginMetrics as m,
} from '@/design-system';
import { appContact, appIdentity, dialable } from '@/services/config/app-identity';
import { useT } from '@/services/i18n';
import { useSessionStore } from '@/store/session-store';

import { ForgotPasswordSheet } from './login/ForgotPasswordSheet';
import {
  EyeButton,
  LoginField,
  LoginFooter,
  LoginInput,
  LoginLink,
  LoginNotice,
  RememberBox,
  SubmitButton,
  SupportLine,
  SupportNoNumber,
} from './login/LoginParts';
import { useLoginForm } from './login/useLoginForm';

import aerialPlaceholder from '../../assets/images/login-aerial-placeholder.jpg';

/*
 * Sign-in, mirroring the portal's login (apps/web/src/routes/Login.tsx, Figma
 * 147:900) at phone width: aerial background, the ICMS- wordmark, and one card
 * that holds step one (username and password) and then, in place, step two (the
 * 6-digit authenticator code). No role selector, as on the web; the surveyor-only
 * check happens after sign-in in services/auth/session.ts. The footer is Figma 163:27's.
 *
 * PLACEHOLDER IMAGERY: the aerial is the web's placeholder. Replace the one import.
 */
export function LoginScreen() {
  const t = useT();
  const passwordRef = useRef<TextInput>(null);
  const otpRef = useRef<TextInput>(null);
  const form = useLoginForm({ passwordRef, otpRef });
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const sessionReason = useSessionStore((state) => state.reason);
  const [forgotOpen, setForgotOpen] = useState(false);
  const contact = appContact();
  const identity = appIdentity();

  const otpStep = form.step === 'otp';
  const call = () => {
    if (contact.supportPhone !== null) void Linking.openURL(`tel:${dialable(contact.supportPhone)}`);
  };
  // The web's pt max(2rem, min(111px, 14vh)), less the language toggle that sits above the wordmark.
  const topPad = Math.max(m.topMin, Math.min(m.topMax, height * m.topRatio));
  const wordmarkTop = Math.max(0, topPad - m.toggleInset - control.heightMd);
  const notice =
    sessionReason === 'refresh_rejected'
      ? t('login.notice.expired')
      : sessionReason === 'not_surveyor'
        ? t('login.error.notSurveyor')
      : sessionReason === 'user'
        ? t('login.notice.signedOut')
        : null;
  const usernameError = form.fieldError('username');
  const passwordError = form.fieldError('password');
  const otpError = form.fieldError('otp');

  return (
    <View style={styles.screen}>
      <Image source={aerialPlaceholder} contentFit="cover" style={StyleSheet.absoluteFill} accessible={false} />
      <View style={[StyleSheet.absoluteFill, styles.wash]} pointerEvents="none" />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <ScrollView
          contentContainerStyle={[
            styles.content,
            { paddingTop: insets.top + m.toggleInset, paddingBottom: insets.bottom + m.footerPadY },
          ]}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.toggleRow}>
            <LanguageToggle tone="overlay" testID="login-language" />
          </View>

          <Text
            variant="wordmark"
            align="center"
            accessibilityRole="header"
            maxFontSizeMultiplier={fontScaleMax}
            style={{ ...styles.wordmark, marginTop: wordmarkTop }}
          >
            <Text variant="wordmark" color="brand" maxFontSizeMultiplier={fontScaleMax}>
              {t('login.brandShort')}
            </Text>
            {t('login.brandRest')}
          </Text>

          <View style={[styles.card, elevation.loginCard]}>
            <Text variant="cardHeading" align="center" accessibilityRole="header" maxFontSizeMultiplier={fontScaleMax}>
              {otpStep ? t('login.otp.title') : t('login.title')}
            </Text>

            <View style={styles.form}>
              {form.online ? null : <LoginNotice tone="warn" icon="offline" lines={[t('login.offline')]} />}
              {form.error !== null && form.error !== 'login.offline' ? (
                <LoginNotice tone="error" title={t('login.error.heading')} lines={[t(form.error)]} />
              ) : null}
              {otpStep && form.error === null ? <LoginNotice tone="info" lines={[t('login.otp.body')]} /> : null}
              {notice !== null && !otpStep && form.error === null ? <LoginNotice tone="notice" lines={[notice]} /> : null}

              {otpStep ? (
                <>
                  <View style={styles.account}>
                    <Icon name="user" size="sm" color="loginAccent" />
                    <Text variant="note" color="loginLabel" numberOfLines={1} style={styles.flexShrink} maxFontSizeMultiplier={fontScaleMax}>
                      {`${t('login.otp.account')} `}
                      <Text variant="noteStrong" color="loginInputText" maxFontSizeMultiplier={fontScaleMax}>
                        {form.usernameCheck.value}
                      </Text>
                    </Text>
                  </View>

                  <LoginField
                    label={t('login.otp.label')}
                    error={otpError === null ? null : t(otpError)}
                    counter={t('login.otp.digits', { count: form.otp.length })}
                    hint={
                      <Text variant="note" color="loginLabel" maxFontSizeMultiplier={fontScaleMax}>
                        {t('login.otp.noApp')}
                      </Text>
                    }
                  >
                    <LoginInput
                      ref={otpRef}
                      variant="codeInput"
                      value={form.otp}
                      onChangeText={form.onChangeOtp}
                      onBlur={() => form.onBlur('otp')}
                      invalid={otpError !== null}
                      editable={!form.busy}
                      placeholder={t('login.otp.placeholder')}
                      accessibilityLabel={t('login.otp.label')}
                      keyboardType="number-pad"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      textContentType="oneTimeCode"
                      maxLength={6}
                      returnKeyType="go"
                      onSubmitEditing={form.submit}
                    />
                  </LoginField>

                  {form.skew !== null ? (
                    <LoginNotice
                      tone="warn"
                      title={t('login.skew.title')}
                      lines={[
                        t('login.skew.body'),
                        t(form.skew > 0 ? 'login.skew.ahead' : 'login.skew.behind', { seconds: Math.abs(form.skew) }),
                      ]}
                    />
                  ) : null}

                  <SubmitButton label={form.busy ? t('login.otp.ctaBusy') : t('login.otp.cta')} busy={form.busy} onPress={form.submit} />
                  <Text variant="note" color="loginLabel" align="center" maxFontSizeMultiplier={fontScaleMax}>
                    {t('login.otp.wrongPassword')}
                  </Text>
                  <LoginLink label={t('login.otp.back')} icon="arrowLeft" onPress={form.backToPassword} disabled={form.busy} />
                </>
              ) : (
                <>
                  <LoginField
                    label={t('login.username.label')}
                    error={usernameError === null ? null : t(usernameError)}
                    counter={form.usernameCheck.mobile ? t('login.username.digits', { count: form.usernameCheck.digits }) : null}
                  >
                    <LoginInput
                      value={form.username}
                      onChangeText={form.onChangeUsername}
                      onBlur={() => form.onBlur('username')}
                      invalid={usernameError !== null}
                      editable={!form.busy}
                      placeholder={t('login.username.placeholder')}
                      accessibilityLabel={t('login.username.label')}
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      autoComplete="username"
                      textContentType="username"
                      importantForAutofill="yes"
                      returnKeyType="next"
                      submitBehavior="submit"
                      onSubmitEditing={() => passwordRef.current?.focus()}
                    />
                  </LoginField>

                  <LoginField
                    label={t('login.password.label')}
                    labelVariant="fieldLabelLg"
                    error={passwordError === null ? null : t(passwordError)}
                  >
                    <LoginInput
                      ref={passwordRef}
                      value={form.password}
                      onChangeText={form.onChangePassword}
                      onBlur={() => form.onBlur('password')}
                      invalid={passwordError !== null}
                      editable={!form.busy}
                      placeholder={t('login.password.placeholder')}
                      accessibilityLabel={t('login.password.label')}
                      secureTextEntry={!form.revealed}
                      autoCapitalize="none"
                      autoCorrect={false}
                      spellCheck={false}
                      autoComplete="current-password"
                      textContentType="password"
                      importantForAutofill="yes"
                      returnKeyType="go"
                      onSubmitEditing={form.submit}
                      trailing={<EyeButton revealed={form.revealed} onPress={form.toggleRevealed} disabled={form.busy} />}
                    />
                  </LoginField>

                  <View style={styles.options}>
                    <RememberBox checked={form.remember} onChange={form.setRemember} disabled={form.busy} />
                    <LoginLink
                      label={t('login.forgot')}
                      icon="phone"
                      align="end"
                      onPress={() => setForgotOpen(true)}
                      disabled={form.busy}
                    />
                  </View>

                  <SubmitButton label={form.busy ? t('login.ctaBusy') : t('login.cta')} busy={form.busy} onPress={form.submit} />
                </>
              )}
            </View>

            {contact.supportPhone !== null ? <SupportLine phone={contact.supportPhone} onCall={call} /> : <SupportNoNumber />}
          </View>

          <View style={styles.spacer} />

          <LoginFooter
            version={identity.version}
            links={[
              { label: t('login.footer.security'), url: contact.securityPolicyUrl },
              { label: t('login.footer.gis'), url: contact.gisPortalUrl },
              { label: t('login.footer.terms'), url: contact.termsOfServiceUrl },
            ]}
          />
        </ScrollView>
      </KeyboardAvoidingView>

      <ForgotPasswordSheet
        visible={forgotOpen}
        phone={contact.supportPhone}
        onCall={call}
        onClose={() => setForgotOpen(false)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.loginBackdrop },
  wash: { backgroundColor: colors.loginWash },
  flex: { flex: 1 },
  flexShrink: { flexShrink: 1 },
  content: { flexGrow: 1, alignItems: 'center', paddingHorizontal: m.sidePad },
  toggleRow: { width: '100%', maxWidth: m.contentMaxWidth, alignItems: 'flex-end' },
  wordmark: { width: '100%', maxWidth: m.contentMaxWidth, marginBottom: m.wordmarkGap },
  card: {
    width: '100%',
    maxWidth: m.contentMaxWidth,
    alignItems: 'center',
    gap: m.cardGap,
    paddingHorizontal: m.cardPadX,
    paddingTop: m.cardPadTop,
    paddingBottom: m.cardPadBottom,
    borderRadius: m.cardRadius,
    borderWidth: m.cardBorder,
    borderColor: colors.loginCardBorder,
    backgroundColor: colors.loginCardFill,
  },
  form: { width: '100%', gap: m.formGap },
  account: { flexDirection: 'row', alignItems: 'center', gap: m.noticeGap },
  options: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: m.noticeGap },
  spacer: { flexGrow: 1, minHeight: m.cardGap },
});
