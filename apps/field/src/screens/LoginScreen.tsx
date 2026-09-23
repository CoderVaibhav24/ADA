import { useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  Button,
  FormField,
  Icon,
  InProgressBlock,
  Input,
  Text,
  colors,
  space,
} from '@/design-system';
import { SignInError, signInWithPassword, type SignInFailure } from '@/services/auth/session';
import { appIdentity } from '@/services/config/app-identity';
import { useSessionStore } from '@/store/session-store';

/*
 * Sign-in, `163:27`. The brand, a username and password form posted straight to
 * the portal's Keycloak realm (direct access grant, `services/auth/session.ts`),
 * and the support and footer area. No role select: roles come from the token. No
 * remember-me: the session persists on the device regardless. The support contact
 * has no source yet and shows as in progress rather than a number typed into the app.
 */

// The portal's wording (apps/web/src/routes/login-labels.en.ts), with the OTP and browser-only cases dropped.
const FAILURE_MESSAGES: Record<SignInFailure, string> = {
  'bad-credentials': 'The username or password was not accepted. Check both and try again.',
  'second-factor-required':
    'This account needs a second sign-in step, which the field app does not support. Call support.',
  'account-incomplete':
    'This account still has something to finish — setting up an authenticator, verifying an ' +
    'e-mail address, or changing a password. Sign in to the ADA web portal once to finish it, ' +
    'then try again here.',
  'account-disabled': 'This account is not active. Call support to have it re-enabled.',
  'locked-out':
    'Too many failed attempts, so this account is locked for a short while. Wait a minute, then ' +
    'try again — or call support if it stays locked.',
  'direct-grant-disabled':
    'This app is not yet allowed to sign people in directly. An ADA administrator must switch ' +
    'on Direct Access Grants for the ada-field client in Keycloak.',
  'client-misconfigured':
    'The sign-in service does not recognise this app. Call support — this is a configuration ' +
    'fault, not a problem with your account.',
  'rate-limited': 'Too many attempts from this network. Wait a minute and try again.',
  network: 'Could not reach the sign-in service. Check your connection and try again.',
  unknown: 'Sign-in failed. Try again shortly, and call support if it keeps happening.',
};

type ScreenError = { readonly message: string; readonly detail?: string };

// Turns whatever the session service threw into words for the officer.
function describe(cause: unknown): ScreenError {
  if (cause instanceof SignInError) {
    return { message: FAILURE_MESSAGES[cause.reason], detail: cause.detail };
  }
  return { message: FAILURE_MESSAGES.unknown };
}

type Missing = { readonly username?: string; readonly password?: string };

export function LoginScreen() {
  const reason = useSessionStore((state) => state.reason);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [missing, setMissing] = useState<Missing>({});
  const [error, setError] = useState<ScreenError | null>(null);
  const passwordRef = useRef<TextInput>(null);
  const identity = appIdentity();

  // Validates locally, then hands the credentials to the session service; the password is not kept.
  const onSubmit = async () => {
    if (busy) return;
    const name = username.trim();
    const nextMissing: Missing = {
      username: name === '' ? 'Enter your username.' : undefined,
      password: password === '' ? 'Enter your password.' : undefined,
    };
    setMissing(nextMissing);
    setError(null);
    if (nextMissing.username !== undefined || nextMissing.password !== undefined) return;

    setBusy(true);
    try {
      await signInWithPassword(name, password);
    } catch (cause) {
      setError(describe(cause));
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
        >
          <View style={styles.brand}>
            {identity.name ? (
              <Text variant="title" align="center">
                {identity.name}
              </Text>
            ) : null}
          </View>

          <View style={styles.form}>
            {reason === 'refresh_rejected' ? (
              <Text variant="body" color="ink1" align="center" accessibilityRole="alert">
                Your session ended. Sign in again to continue.
              </Text>
            ) : null}

            <FormField label="Username" error={missing.username}>
              <Input
                value={username}
                onChangeText={setUsername}
                invalid={missing.username !== undefined}
                disabled={busy}
                accessibilityLabel="Username"
                placeholder="Username"
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="username"
                textContentType="username"
                importantForAutofill="yes"
                returnKeyType="next"
                submitBehavior="submit"
                onSubmitEditing={() => passwordRef.current?.focus()}
                leadingIcon={<Icon name="user" size="md" color="ink3" />}
              />
            </FormField>

            <FormField label="Password" error={missing.password}>
              <Input
                ref={passwordRef}
                value={password}
                onChangeText={setPassword}
                invalid={missing.password !== undefined}
                disabled={busy}
                accessibilityLabel="Password"
                placeholder="Password"
                secureTextEntry={!revealed}
                autoCapitalize="none"
                autoCorrect={false}
                spellCheck={false}
                autoComplete="current-password"
                textContentType="password"
                importantForAutofill="yes"
                returnKeyType="go"
                onSubmitEditing={() => void onSubmit()}
                trailingIcon={
                  <Button
                    label={revealed ? 'Hide' : 'Show'}
                    variant="ghost"
                    size="sm"
                    fullWidth={false}
                    onPress={() => setRevealed((shown) => !shown)}
                    accessibilityLabel={revealed ? 'Hide password' : 'Show password'}
                    leadingIcon={<Icon name="view" size="sm" color="brand" />}
                  />
                }
              />
            </FormField>

            {error === null ? null : (
              <View style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="polite">
                <Icon name="alert" size="md" color="statusOverdue" />
                <View style={styles.errorText}>
                  <Text variant="body" color="ink1">
                    {error.message}
                  </Text>
                  {error.detail ? (
                    <Text variant="mono" color="ink3">
                      {error.detail}
                    </Text>
                  ) : null}
                </View>
              </View>
            )}

            <Button
              label="Sign in"
              onPress={() => void onSubmit()}
              loading={busy}
              size="lg"
              leadingIcon={<Icon name="verified" size="md" color="inkOnMuted" />}
            />
          </View>

          <View style={styles.footer}>
            <InProgressBlock title="Support" />
            {identity.version ? (
              <Text variant="caption" color="ink3" align="center">
                {`Version ${identity.version}`}
              </Text>
            ) : null}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface0 },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    paddingHorizontal: space[4],
    paddingVertical: space[6],
    justifyContent: 'space-between',
    gap: space[6],
  },
  brand: { alignItems: 'center', gap: space[4], paddingTop: space[8] },
  form: { gap: space[4] },
  error: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2] },
  errorText: { flex: 1, gap: space[1] },
  footer: { gap: space[3] },
});
