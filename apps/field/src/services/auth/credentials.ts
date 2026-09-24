import type { PlainKey } from '@/services/i18n';

/*
 * Front-end checks on the login form, run before anything is sent. They catch
 * typing slips; the identity provider still decides. Each problem is an i18n key
 * so the screen shows it in the active language.
 */

export type UsernameCheck = {
  /** What is sent: trimmed, and a mobile number reduced to its 10 digits. */
  readonly value: string;
  /** True when the input is being read as an Indian mobile number. */
  readonly mobile: boolean;
  /** Digits typed so far, for the counter under a mobile number. */
  readonly digits: number;
  readonly problem: PlainKey | null;
};

const MOBILE_TYPING = /^\+?[\d\s-]+$/;
const USERNAME = /^[A-Za-z0-9._@-]+$/;
export const USERNAME_MIN = 3;
export const USERNAME_MAX = 64;
export const MOBILE_DIGITS = 10;
export const OTP_DIGITS = 6;

// Strips spaces, dashes and a leading +91, 91 or 0 from an all-digit entry.
function mobileDigits(raw: string): string {
  let digits = raw.replace(/[\s-]/g, '');
  if (digits.startsWith('+91')) digits = digits.slice(3);
  else if (digits.startsWith('+')) digits = digits.slice(1);
  else if (digits.length === MOBILE_DIGITS + 2 && digits.startsWith('91')) digits = digits.slice(2);
  else if (digits.length === MOBILE_DIGITS + 1 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

// Reads the username box: an Indian mobile number when it is all digits, a username otherwise.
export function checkUsername(raw: string): UsernameCheck {
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: '', mobile: false, digits: 0, problem: 'login.validation.usernameMissing' };
  }
  if (MOBILE_TYPING.test(trimmed)) {
    const digits = mobileDigits(trimmed);
    const problem: PlainKey | null =
      digits.length !== MOBILE_DIGITS
        ? 'login.validation.mobileLength'
        : /^[6-9]/.test(digits)
          ? null
          : 'login.validation.mobileStart';
    return { value: digits, mobile: true, digits: digits.length, problem };
  }
  const problem: PlainKey | null =
    trimmed.length < USERNAME_MIN || trimmed.length > USERNAME_MAX
      ? 'login.validation.usernameLength'
      : USERNAME.test(trimmed)
        ? null
        : 'login.validation.usernameChars';
  return { value: trimmed, mobile: false, digits: 0, problem };
}

// The password is required and sent exactly as typed: never trimmed, no policy revealed.
export function checkPassword(raw: string): PlainKey | null {
  return raw === '' ? 'login.validation.passwordMissing' : null;
}

// Keeps only digits, at most six: what the code box accepts as it is typed.
export function sanitiseOtp(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, OTP_DIGITS);
}

export function checkOtp(code: string): PlainKey | null {
  if (code === '') return 'login.validation.otpMissing';
  return code.length === OTP_DIGITS ? null : 'login.validation.otpLength';
}
