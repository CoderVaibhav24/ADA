/**
 * Phone or email, then a six-digit code. One component, two channels.
 *
 * The interaction is modelled on the HRMS login screen, because that is the
 * one people here already know and because its details are the ones that
 * matter on a phone: six separate boxes rather than one field, a paste that
 * fills all six, Backspace that steps back through them, and a Resend that
 * stays disabled for the length of the server's own cooldown.
 *
 * The cooldown constant is 60 seconds because ada-auth's
 * otp_request_cooldown_seconds is 60 and it is FLAT, not exponential. That was
 * a deliberate choice there — a doubling backoff means the second Resend
 * always fails after the client's countdown has already reached zero, so the
 * button can never be used — and this side has to match it or the button lies.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { storeOtpTokens } from "./otpSession";

const OTP_LENGTH = 6;
const RESEND_COOLDOWN_SECONDS = 60;

export type OtpChannel = "phone" | "email";

interface Copy {
  title: string;
  label: string;
  placeholder: string;
  hint: string;
  inputMode: "numeric" | "email";
  autoComplete: string;
  requestPath: string;
  verifyPath: string;
  field: "phone" | "email";
  validate: (value: string) => string | null;
}

const COPY: Record<OtpChannel, Copy> = {
  phone: {
    title: "Sign in with your phone",
    label: "Mobile number",
    placeholder: "919990001234",
    // Said plainly because ada-auth searches Keycloak for exactly this form: a
    // number stored as "+91 99900 01234" is not found by a search for
    // "919990001234", and the answer is the same generic 202 either way.
    hint: "Digits only, including the country code — no spaces and no +.",
    inputMode: "numeric",
    autoComplete: "tel",
    requestPath: "/auth-api/v1/auth/request-otp",
    verifyPath: "/auth-api/v1/auth/verify-otp",
    field: "phone",
    validate: (value) =>
      /^\d{10,15}$/.test(value) ? null : "Enter 10 to 15 digits, including the country code.",
  },
  email: {
    title: "Sign in with your email",
    label: "Email address",
    placeholder: "officer@pcsmcpl.net",
    hint: "The address on your ADA account.",
    inputMode: "email",
    autoComplete: "email",
    requestPath: "/auth-api/v1/auth/email/request-otp",
    verifyPath: "/auth-api/v1/auth/email/verify-otp",
    field: "email",
    validate: (value) =>
      /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) ? null : "Enter a valid email address.",
  },
};

export interface OtpFormProps {
  channel: OtpChannel;
  /** Called once tokens are stored, so the gate can re-check and render the console. */
  onSignedIn: () => void;
  onCancel: () => void;
}

export default function OtpForm({ channel, onSignedIn, onCancel }: OtpFormProps) {
  const copy = COPY[channel];

  const [identifier, setIdentifier] = useState("");
  const [digits, setDigits] = useState<string[]>(() => Array(OTP_LENGTH).fill(""));
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const boxes = useRef<Array<HTMLInputElement | null>>([]);

  // Reset everything when the officer switches channel, or a half-typed phone
  // code would sit in the email form.
  useEffect(() => {
    setIdentifier("");
    setDigits(Array(OTP_LENGTH).fill(""));
    setSent(false);
    setCooldown(0);
    setError(null);
    setNotice(null);
  }, [channel]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((n) => n - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  const request = useCallback(async () => {
    const invalid = copy.validate(identifier);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(copy.requestPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [copy.field]: identifier }),
      });

      if (response.status === 429) {
        // Start the countdown from the server's own Retry-After rather than
        // the local constant, so it can never expire while ada-auth is still
        // refusing.
        const retryAfter = Number(response.headers.get("Retry-After")) || RESEND_COOLDOWN_SECONDS;
        setCooldown(retryAfter);
        setError(`Too many requests. Try again in ${retryAfter} seconds.`);
        return;
      }
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { detail?: string } | null;
        setError(body?.detail ?? "Could not send the code. Try again shortly.");
        return;
      }

      setSent(true);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      // Deliberately the same wording whether or not the identifier is
      // registered — ada-auth answers identically on purpose, and a more
      // specific message here would undo that.
      setNotice("If that account exists, a code is on its way.");
      window.setTimeout(() => boxes.current[0]?.focus(), 0);
    } catch {
      setError("Network error — the sign-in service is unreachable.");
    } finally {
      setBusy(false);
    }
  }, [copy, identifier]);

  const verify = useCallback(
    async (code: string) => {
      setBusy(true);
      setError(null);
      try {
        const response = await fetch(copy.verifyPath, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [copy.field]: identifier, code }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { detail?: string } | null;
          setError(body?.detail ?? "That code is invalid or has expired.");
          setDigits(Array(OTP_LENGTH).fill(""));
          boxes.current[0]?.focus();
          return;
        }

        storeOtpTokens(await response.json());
        onSignedIn();
      } catch {
        setError("Network error — the sign-in service is unreachable.");
      } finally {
        setBusy(false);
      }
    },
    [copy, identifier, onSignedIn],
  );

  const setDigit = useCallback(
    (index: number, value: string) => {
      setDigits((current) => {
        const next = [...current];
        next[index] = value;
        const code = next.join("");
        // Submit as soon as the sixth box is filled. Nobody types six digits
        // and then hunts for a button.
        if (code.length === OTP_LENGTH) void verify(code);
        return next;
      });
    },
    [verify],
  );

  const onDigitChange = (index: number, raw: string) => {
    const cleaned = raw.replace(/\D/g, "");
    if (!cleaned) {
      setDigit(index, "");
      return;
    }
    if (cleaned.length > 1) {
      // A paste landing in one box fills the rest.
      const spread = cleaned.slice(0, OTP_LENGTH - index).split("");
      setDigits((current) => {
        const next = [...current];
        spread.forEach((digit, offset) => {
          next[index + offset] = digit;
        });
        const code = next.join("");
        if (code.length === OTP_LENGTH) void verify(code);
        return next;
      });
      boxes.current[Math.min(index + spread.length, OTP_LENGTH - 1)]?.focus();
      return;
    }
    setDigit(index, cleaned);
    if (index < OTP_LENGTH - 1) boxes.current[index + 1]?.focus();
  };

  const onDigitKeyDown = (index: number, event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Backspace" && !digits[index] && index > 0) {
      // Backspace in an empty box steps back and clears the previous one,
      // which is what every OTP field people have already used does.
      event.preventDefault();
      setDigit(index - 1, "");
      boxes.current[index - 1]?.focus();
    } else if (event.key === "ArrowLeft" && index > 0) {
      boxes.current[index - 1]?.focus();
    } else if (event.key === "ArrowRight" && index < OTP_LENGTH - 1) {
      boxes.current[index + 1]?.focus();
    }
  };

  return (
    <form
      className="otp-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!sent) void request();
      }}
    >
      <h1>{copy.title}</h1>

      <label className="otp-label" htmlFor="otp-identifier">
        {copy.label}
      </label>
      <input
        id="otp-identifier"
        className="input"
        type="text"
        inputMode={copy.inputMode}
        autoComplete={copy.autoComplete}
        placeholder={copy.placeholder}
        value={identifier}
        disabled={sent || busy}
        onChange={(event) =>
          setIdentifier(
            channel === "phone"
              ? event.target.value.replace(/\D/g, "")
              : event.target.value.trim(),
          )
        }
      />
      <p className="otp-hint">{copy.hint}</p>

      {sent && (
        <>
          <label className="otp-label" htmlFor="otp-digit-0">
            Six-digit code
          </label>
          <div className="otp-digits">
            {digits.map((digit, index) => (
              <input
                key={index}
                id={`otp-digit-${index}`}
                ref={(element) => {
                  boxes.current[index] = element;
                }}
                className="otp-digit"
                type="text"
                inputMode="numeric"
                // one-time-code lets iOS and Android offer the SMS straight
                // from the keyboard, which is most of the value of OTP on a
                // phone.
                autoComplete="one-time-code"
                maxLength={1}
                value={digit}
                disabled={busy}
                onChange={(event) => onDigitChange(index, event.target.value)}
                onKeyDown={(event) => onDigitKeyDown(index, event)}
              />
            ))}
          </div>
        </>
      )}

      {notice && !error && <p className="otp-notice">{notice}</p>}
      {error && <p className="auth-error">{error}</p>}

      <div className="otp-actions">
        {!sent ? (
          <button type="submit" className="btn btn-primary" disabled={busy || !identifier}>
            {busy ? "Sending…" : "Send code"}
          </button>
        ) : (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={busy || cooldown > 0}
            onClick={() => void request()}
          >
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
        )}
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>
          Back
        </button>
      </div>
    </form>
  );
}
