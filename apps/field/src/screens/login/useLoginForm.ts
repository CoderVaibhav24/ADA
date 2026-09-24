import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { Keyboard, type TextInput } from 'react-native';

import { isSkewed, measureClockSkew } from '@/services/auth/clock-skew';
import { checkOtp, checkPassword, checkUsername, OTP_DIGITS, sanitiseOtp } from '@/services/auth/credentials';
import { readRememberChoice, readRememberedUsername, saveRememberedLogin } from '@/services/auth/remembered-login';
import { SignInError, signInWithPassword, type SignInFailure } from '@/services/auth/session';
import type { PlainKey } from '@/services/i18n';
import { useIsOnline } from '@/services/net/connectivity';

/*
 * The login card's state, in two steps like the portal (apps/web/src/routes/Login.tsx):
 * password first, then the 6-digit authenticator code on the same card. Keycloak
 * answers a wrong password and a right password owing a code with the same bytes,
 * so a first refusal of that kind moves to step two instead of being shown as a
 * failure; only step two says both possibilities, and offers the way back.
 */
export type Step = 'password' | 'otp';

type Field = 'username' | 'password' | 'otp';

// Refusals step one cannot tell apart; they open the code step rather than an error.
const AMBIGUOUS: ReadonlySet<SignInFailure> = new Set<SignInFailure>(['bad-credentials', 'otp-required', 'bad-otp']);

// The one sentence per refusal. Administrator-only faults collapse into "App setup problem".
const FAILURE_KEYS: Record<SignInFailure, PlainKey> = {
  'bad-credentials': 'login.error.badCredentials',
  'otp-required': 'login.validation.otpMissing',
  'bad-otp': 'login.error.badOtp',
  'account-incomplete': 'login.error.accountIncomplete',
  'account-disabled': 'login.error.accountDisabled',
  'locked-out': 'login.error.lockedOut',
  'direct-grant-disabled': 'login.error.appSetup',
  'client-misconfigured': 'login.error.appSetup',
  'rate-limited': 'login.error.rateLimited',
  network: 'login.error.network',
  'not-surveyor': 'login.error.notSurveyor',
  unknown: 'login.error.unknown',
};

type Inputs = {
  readonly passwordRef: RefObject<TextInput | null>;
  readonly otpRef: RefObject<TextInput | null>;
};

// The screen owns the input refs and passes them in, so nothing it renders reads a ref.
export function useLoginForm({ passwordRef, otpRef }: Inputs) {
  const online = useIsOnline();
  const [step, setStep] = useState<Step>('password');
  const [username, setUsername] = useState(readRememberedUsername);
  const [password, setPassword] = useState('');
  const [otp, setOtp] = useState('');
  const [remember, setRemember] = useState(readRememberChoice);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<PlainKey | null>(null);
  const [shown, setShown] = useState<Record<Field, boolean>>({ username: false, password: false, otp: false });
  const [skew, setSkew] = useState<number | null>(null);
  const inFlight = useRef(false);
  const advanced = useRef(false);

  const usernameCheck = checkUsername(username);
  const problems: Record<Field, PlainKey | null> = {
    username: usernameCheck.problem,
    password: checkPassword(password),
    otp: checkOtp(otp),
  };

  // Measured up front, as the portal does: Keycloak cannot tell a drifted clock from a wrong code.
  useEffect(() => {
    let cancelled = false;
    void measureClockSkew().then((seconds) => {
      if (!cancelled) setSkew(seconds);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Focus follows the card: forward to the code, back to the password it replaced.
  useEffect(() => {
    if (step === 'otp') {
      advanced.current = true;
      otpRef.current?.focus();
    } else if (advanced.current) {
      passwordRef.current?.focus();
    }
  }, [otpRef, passwordRef, step]);

  // A field's problem shows after it is left or on submit, and hides again while it is edited.
  const reveal = useCallback((field: Field, visible: boolean) => {
    setShown((current) => (current[field] === visible ? current : { ...current, [field]: visible }));
  }, []);

  const submit = useCallback(
    async (codeOverride?: string) => {
      if (inFlight.current) return;
      Keyboard.dismiss();
      const code = codeOverride ?? otp;

      if (step === 'password') {
        setShown((current) => ({ ...current, username: true, password: true }));
        if (usernameCheck.problem !== null || checkPassword(password) !== null) return;
      } else {
        setShown((current) => ({ ...current, otp: true }));
        if (checkOtp(code) !== null) return;
      }
      if (!online) {
        setError('login.offline');
        return;
      }

      inFlight.current = true;
      setError(null);
      setBusy(true);
      try {
        await signInWithPassword({
          username: usernameCheck.value,
          password,
          otp: step === 'otp' ? code : undefined,
        });
        // Busy stays set: the navigator is replacing this screen, and a live button invites a second tap.
        saveRememberedLogin(remember, usernameCheck.value);
      } catch (cause) {
        inFlight.current = false;
        setBusy(false);
        const reason: SignInFailure = cause instanceof SignInError ? cause.reason : 'unknown';
        if (__DEV__ && cause instanceof SignInError && cause.detail) console.warn(`sign-in: ${cause.detail}`);
        if (step === 'password' && AMBIGUOUS.has(reason)) {
          setStep('otp');
          return;
        }
        const shownReason = step === 'otp' && reason === 'otp-required' ? 'bad-credentials' : reason;
        setError(FAILURE_KEYS[shownReason]);
        if (step === 'otp') {
          setOtp('');
          reveal('otp', false);
        }
      }
    },
    [online, otp, password, remember, reveal, step, usernameCheck.problem, usernameCheck.value],
  );

  const onChangeUsername = useCallback(
    (value: string) => {
      setUsername(value);
      reveal('username', false);
    },
    [reveal],
  );

  const onChangePassword = useCallback(
    (value: string) => {
      setPassword(value);
      reveal('password', false);
    },
    [reveal],
  );

  // Digits only, six at most; the sixth digit submits on its own.
  const onChangeOtp = useCallback(
    (value: string) => {
      const next = sanitiseOtp(value);
      setOtp(next);
      reveal('otp', false);
      if (next.length === OTP_DIGITS && next !== otp) void submit(next);
    },
    [otp, reveal, submit],
  );

  // The only way back to a mistyped password, which step two cannot tell from a mistyped code.
  const backToPassword = useCallback(() => {
    setError(null);
    setOtp('');
    reveal('otp', false);
    setStep('password');
  }, [reveal]);

  return {
    step,
    online,
    busy,
    error,
    skew: isSkewed(skew) ? skew : null,
    username,
    usernameCheck,
    password,
    otp,
    remember,
    revealed,
    fieldError: (field: Field): PlainKey | null => (shown[field] ? problems[field] : null),
    onChangeUsername,
    onChangePassword,
    onChangeOtp,
    onBlur: (field: Field) => reveal(field, true),
    setRemember,
    toggleRevealed: () => setRevealed((value) => !value),
    submit: () => void submit(),
    backToPassword,
  };
}

export type LoginForm = ReturnType<typeof useLoginForm>;
