/**
 * ICMS sign-in — Figma node 147:900, built as a real credential form, in two steps.
 *
 * Step one takes username and password and calls Keycloak's direct access grant
 * with no code. A token means the account has no authenticator and the officer
 * is in. A refusal means one of two things Keycloak refuses to separate — wrong
 * password, or right password with a code still owed — so step two asks for the
 * code as an ordinary next step. Only step two can fail out loud, and when it
 * does it says both possibilities and offers the way back to the password.
 *
 * Step two REPLACES the form block. The background, the wordmark and the card
 * stay exactly where they are; inside the card the heading, the credential
 * fields, the REMEMBER ME row and the LOGIN button are gone, and the code view
 * stands in their place. The password is kept in component state so the second
 * submission can send it, and is never rendered again.
 *
 * The password is exchanged for realm tokens by auth/passwordLogin.ts, so the
 * officer stays on this screen for the ordinary case. Keycloak's own hosted
 * page is kept for the three things a typed form cannot do: draw the
 * CONFIGURE_TOTP enrolment QR, verify an e-mail address, and reset a forgotten
 * password.
 *
 * Figma's role selector is dropped on instruction. No role is collected and
 * none is sent; what the officer may do comes from /me/capabilities.
 *
 * Measurements are Figma's to the sub-pixel, which is why so many of them are
 * fractional: the card was drawn at 1.318x and scaled down. The one deliberate
 * colour departure is the LOGIN button's text — Figma puts white on the ochre,
 * which is 2.97:1 and fails WCAG AA, so it carries the dark earth instead.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";

import { isSkewed, measureClockSkew } from "../auth/clockSkew";
import { isSignedIn, login, type LoginOptions } from "../auth/oidc";
import { signInWithPassword, type RejectionReason } from "../auth/passwordLogin";
import { Icon } from "../lib/icons";
import { loginLabelsEn as t } from "./login-labels.en";
import { safeReturnTo } from "./paths";

// PLACEHOLDER IMAGERY — the Figma frame's own aerial (County Road B, A30, N 51.48 E 4.61,
// an English landscape). Replace this one import with real Agra imagery; nothing else changes.
import aerialPlaceholder from "../assets/login/aerial-map-placeholder.jpg";

const LOGIN_BACKGROUND_IMAGE: string = aerialPlaceholder;

/** The three Figma faces. Declared once because Tailwind has no utility for a font-stretch axis. */
const FACE = {
  wordmark: {
    fontFamily: '"Open Sans", "IBM Plex Sans", ui-sans-serif, sans-serif',
    fontStretch: "75%",
  },
  heading: { fontFamily: '"Siemreap", "Inter", ui-sans-serif, sans-serif' },
  ui: { fontFamily: '"Inter", ui-sans-serif, sans-serif' },
  action: { fontFamily: '"Manrope", "Inter", ui-sans-serif, sans-serif' },
} as const;

/** Figma 147:989 — the uppercase letterspaced field label, identical on every field. */
const LABEL_CLASS =
  "font-semibold text-[13px] leading-[12.139px] tracking-[0.4552px] text-[#94a3b8] uppercase";

/** Figma 147:1006 — the input well. Focus ring is added; the design has none and a keyboard user needs one. */
const INPUT_CLASS =
  "h-[37.934px] w-full rounded-[9.104px] border-[0.759px] border-[#334155] bg-[rgba(15,23,42,0.5)] " +
  "px-[12.898px] text-[12px] text-[#f8fafc] placeholder:text-[#475569] outline-none " +
  "focus-visible:border-[#d97736] focus-visible:ring-[3px] focus-visible:ring-[#d97736]/35 " +
  "disabled:opacity-60";

/** The entrance for whichever view the card is showing. Killed under prefers-reduced-motion. */
const SWAP_CLASS =
  "flex w-full flex-col gap-[18.208px] animate-in fade-in slide-in-from-bottom-2 " +
  "duration-200 motion-reduce:animate-none";

type SessionStatus = "checking" | "anonymous" | "signed-in";

/** Password first, code second. Never both on screen at once. */
type Step = "password" | "otp";

interface LoginLocationState {
  from?: string;
}

interface ScreenError {
  /** One or more whole sentences, already worded. The component never composes them. */
  lines: string[];
  /** Keycloak's raw words, shown only for faults an administrator has to fix. */
  detail?: string;
  /** Whether the hosted page is worth offering for this particular failure. */
  offerHostedPage: boolean;
}

/** Reasons where the answer is "finish this on Keycloak's own page", not "try again here". account-incomplete is not here: it continues there automatically. */
const HOSTED_PAGE_REASONS: ReadonlySet<RejectionReason> = new Set<RejectionReason>([
  "direct-grant-disabled",
  "invalid-origin",
  "client-misconfigured",
  "unknown",
]);

/**
 * The refusals a first submit cannot interpret.
 *
 * Verified against this realm: a wrong password and a correct password with an
 * enrolled authenticator both come back `invalid_grant / Invalid user
 * credentials`, byte for byte. Classifying them would be a guess, so step one
 * stops trying and asks for the code instead.
 */
const AMBIGUOUS: ReadonlySet<RejectionReason> = new Set<RejectionReason>([
  "bad-credentials",
  "otp-required",
  "bad-otp",
]);

function reasonText(reason: RejectionReason): string {
  return t.errorByReason[reason] ?? t.errorFallback;
}

/** One place where a Keycloak callback error code becomes words, so none is invented in JSX. */
function describeCode(code: string): ScreenError {
  const known = t.errorByCode[code];
  return known
    ? { lines: [known], offerHostedPage: false }
    : { lines: [t.errorFallback], detail: code, offerHostedPage: true };
}

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();

  const [status, setStatus] = useState<SessionStatus>("checking");
  const [busy, setBusy] = useState(false);
  const [thrown, setThrown] = useState<ScreenError | null>(null);
  const [skew, setSkew] = useState<number | null>(null);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [remember, setRemember] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [step, setStep] = useState<Step>("password");
  /** Set while the card hands over to Keycloak's required actions (set password, scan QR, verify e-mail). */
  const [finishing, setFinishing] = useState(false);

  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const otpRef = useRef<HTMLInputElement>(null);
  /** Stops the step-one focus rule from grabbing the password box on first paint. */
  const advanced = useRef(false);

  const from = safeReturnTo((location.state as LoginLocationState | null)?.from);
  const signedOut = params.get("signedout") === "1";
  const expired = params.get("expired") === "1";
  const failedCode = params.get("error");

  // An expired or signed-out landing must be READ, so those two never bounce the
  // officer onward even when a session is somehow still live.
  const shouldAutoResume = !expired && !signedOut && !failedCode;

  const fromCallback = useMemo(
    () => (failedCode ? describeCode(failedCode) : null),
    [failedCode],
  );
  const error = thrown ?? fromCallback;

  const check = useCallback(async () => {
    const live = await isSignedIn();
    setStatus(live ? "signed-in" : "anonymous");
  }, []);

  useEffect(() => {
    // setStatus lands after an await, so this synchronises with an external
    // system rather than cascading a render, which is what the rule guards.
    // oxlint-disable-next-line react/set-state-in-effect
    void check();
  }, [check]);

  useEffect(() => {
    if (status === "signed-in" && shouldAutoResume) {
      navigate(from, { replace: true });
    }
  }, [status, shouldAutoResume, from, navigate]);

  // Measured up front, not after a refusal: Keycloak cannot tell a drifted clock
  // from a wrong code, and neither can the officer.
  useEffect(() => {
    if (status !== "anonymous") return;
    let cancelled = false;
    void measureClockSkew().then((seconds) => {
      if (!cancelled) setSkew(seconds);
    });
    return () => {
      cancelled = true;
    };
  }, [status]);

  // The views are swapped, so focus is what tells the officer where the card
  // went — forward to the code, back to the password it replaced.
  useEffect(() => {
    if (step === "otp") {
      advanced.current = true;
      otpRef.current?.focus();
    } else if (advanced.current) {
      passwordRef.current?.focus();
      passwordRef.current?.select();
    }
  }, [step]);

  /** Leaves busy set on success: the tab is navigating away, and a re-enabled button invites a second submit. */
  const toHostedPage = useCallback(
    async (options?: LoginOptions) => {
      setThrown(null);
      setBusy(true);
      try {
        await login(from, options);
      } catch (err: unknown) {
        setBusy(false);
        setFinishing(false);
        setThrown({
          lines: [t.errorFallback],
          detail: err instanceof Error ? err.message : undefined,
          offerHostedPage: false,
        });
      }
    },
    [from],
  );

  /** The only escape for a mistyped password, which step two cannot tell from a mistyped code. */
  const backToPassword = useCallback(() => {
    setThrown(null);
    setOtp("");
    setStep("password");
  }, []);

  const submit = useCallback(async () => {
    const user = username.trim();
    const code = otp.trim();

    if (step === "password") {
      if (!user) {
        setThrown({ lines: [t.usernameMissing], offerHostedPage: false });
        usernameRef.current?.focus();
        return;
      }
      if (!password) {
        setThrown({ lines: [t.passwordMissing], offerHostedPage: false });
        passwordRef.current?.focus();
        return;
      }
    } else if (!code) {
      setThrown({ lines: [t.otpMissing], offerHostedPage: false });
      otpRef.current?.focus();
      return;
    }

    setThrown(null);
    setBusy(true);
    const result = await signInWithPassword({
      username: user,
      password,
      otp: step === "otp" ? code : undefined,
      remember,
    });

    if (result.kind === "signed-in") {
      navigate(from, { replace: true });
      return;
    }

    // Keycloak wants a required action finished first. The hosted pages wear this
    // same card, so the officer continues there straight away with the name prefilled.
    if (result.reason === "account-incomplete") {
      setFinishing(true);
      void toHostedPage({ loginHint: user });
      return;
    }

    setBusy(false);

    // A first refusal is not something the officer can act on, so it is never
    // shown as one: the card moves on and asks for the code.
    if (step === "password" && AMBIGUOUS.has(result.reason)) {
      setStep("otp");
      return;
    }

    // At step two the ambiguity is finally worth saying out loud, and
    // bad-credentials is the reason carrying those words.
    const reason =
      step === "otp" && result.reason === "otp-required" ? "bad-credentials" : result.reason;

    setThrown({
      lines: [reasonText(reason)],
      detail: result.detail,
      offerHostedPage: HOSTED_PAGE_REASONS.has(result.reason),
    });
  }, [username, password, otp, step, remember, from, navigate, toHostedPage]);

  if (status === "checking" || (status === "signed-in" && shouldAutoResume)) {
    return (
      <main className="grid min-h-dvh place-items-center bg-[#1c1610] px-4">
        <p className="text-sm text-[#94a3b8]" role="status" style={FACE.ui}>
          {t.checkingSession}
        </p>
      </main>
    );
  }

  const otpStep = step === "otp";
  const notice = expired ? t.sessionExpired : signedOut ? t.signedOut : null;
  const showSkewWarning = otpStep && isSkewed(skew);

  // One button ends both steps, so it is written once and only its words change.
  const submitButton = (
    <div className="w-full pt-[12.139px]">
      <button
        type="submit"
        disabled={busy}
        className="flex w-full items-center justify-center gap-[20px] rounded-[9.104px] bg-[#d97736] py-[12.139px] outline-none drop-shadow-[0_0_7.587px_rgba(21,93,252,0.4)] hover:bg-[#e08544] focus-visible:ring-[3px] focus-visible:ring-[#f2ae63]/70 disabled:opacity-70"
      >
        <span
          className="text-[20px] leading-[18.208px] font-extrabold tracking-[1.2139px] text-[#150b03] uppercase"
          style={FACE.action}
        >
          {otpStep ? (busy ? t.otpCtaBusy : t.otpCta) : busy ? t.ctaBusy : t.cta}
        </span>
        <Icon
          name={busy ? "feedback.loading" : "action.forward"}
          spin={busy}
          className="size-[17px] shrink-0 text-[#150b03]"
        />
      </button>
    </div>
  );

  return (
    <main className="relative min-h-dvh w-full overflow-x-hidden bg-[#1c1610]">
      <img
        src={LOGIN_BACKGROUND_IMAGE}
        alt=""
        aria-hidden="true"
        className="pointer-events-none fixed inset-0 size-full object-cover select-none"
      />
      {/* Figma 152:1054 — the flat wash that keeps the map from fighting the card. */}
      <div aria-hidden="true" className="pointer-events-none fixed inset-0 bg-[rgba(56,56,56,0.2)]" />

      {/* Top-anchored, not centred: the frame puts the wordmark at y=111 and the card at
          y=199, and 14vh reproduces that at the 792px design height without pinning it.
          The lg nudge is Figma's own left-[calc(50%+29.88px)], dropped on narrow screens. */}
      <div className="relative flex min-h-dvh w-full flex-col items-center justify-start px-4 pt-[max(2rem,min(111px,14vh))] pb-8 lg:translate-x-[29.88px]">
        <h1
          className="mb-[clamp(20px,3.2vw,46.2px)] w-full text-center text-[clamp(17px,4.9vw,38px)] leading-[1.1] font-bold text-[#e8d4a8]"
          style={FACE.wordmark}
        >
          <span className="text-[#ce862e]">{t.brandShort}</span>
          {t.brandRest}
        </h1>

        <div
          className="flex w-full max-w-[525.76px] flex-col items-center gap-[30.347px] rounded-[12.139px]
                     border-[0.759px] border-[rgba(21,93,252,0.3)] bg-[rgba(9,3,0,0.2)]
                     px-[31.106px] pt-[25.759px] pb-[31.106px] backdrop-blur-[6.069px]
                     shadow-[0_18.967px_37.934px_-9.104px_rgba(0,0,0,0.25)]
                     max-[420px]:px-5 max-[420px]:gap-6"
        >
          {/* One heading slot, two headings. Swapping the words rather than the
              element is what keeps step two reading as this card's next state
              instead of a page the officer was sent to. */}
          <h2
            className="h-[52px] w-full text-center text-[38px] leading-[41.8px] font-normal text-[#e8d4a8] max-[420px]:h-auto max-[420px]:text-[32px]"
            style={FACE.heading}
          >
            {otpStep ? t.otpTitle : t.title}
          </h2>

          <form
            className="flex w-full flex-col gap-[18.208px]"
            style={FACE.ui}
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            {/* Always mounted so a screen reader announces into a region that already
                exists; an alert inserted at the same moment it gains text is announced
                unreliably. Both regions sit outside the swap, so neither is torn down
                when the card changes view. */}
            <div aria-live="assertive" aria-atomic="true" className="empty:hidden">
              {error && (
                <div
                  role="alert"
                  className="flex w-full flex-col gap-[6px] rounded-[9.104px] border-[0.759px] border-[rgba(220,38,38,0.45)] bg-[rgba(69,10,10,0.55)] px-[12.898px] py-[10px]"
                >
                  <p className="flex items-start gap-[7px] text-[11px] leading-[15px] font-semibold text-[#fecaca]">
                    <Icon name="feedback.error" className="mt-[1px] size-[13px] shrink-0" />
                    <span>{t.errorHeading}</span>
                  </p>
                  {error.lines.map((line) => (
                    <p key={line} className="text-[11px] leading-[15px] text-[#f3c9c9]">
                      {line}
                    </p>
                  ))}
                  {error.detail && (
                    <p className="font-mono text-[10px] leading-[14px] break-all text-[#e2a3a3]">
                      {error.detail}
                    </p>
                  )}
                  {error.offerHostedPage && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void toHostedPage()}
                      className="mt-[2px] self-start text-[11px] leading-[15px] font-semibold text-[#f2ae63] underline underline-offset-2 disabled:opacity-60"
                    >
                      {t.hostedPageCta}
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* The calm counterpart. Step two arrives here, never in the red box. */}
            <div aria-live="polite" aria-atomic="true" className="empty:hidden">
              {finishing && !error && (
                <div
                  role="status"
                  className="flex w-full flex-col gap-[6px] rounded-[9.104px] border-[0.759px] border-[rgba(217,119,54,0.4)] bg-[rgba(15,23,42,0.55)] px-[12.898px] py-[10px]"
                >
                  <p className="flex items-start gap-[7px] text-[11px] leading-[15px] font-semibold text-[#cbd5e1]">
                    <Icon name="feedback.loading" spin className="mt-[1px] size-[13px] shrink-0 text-[#f2ae63]" />
                    <span>{t.finishingSetup}</span>
                  </p>
                  {/* Fallback for a blocked or stalled redirect; deliberately not disabled by busy. */}
                  <button
                    type="button"
                    onClick={() => void toHostedPage({ loginHint: username.trim() })}
                    className="mt-[2px] self-start text-[11px] leading-[15px] font-semibold text-[#f2ae63] underline underline-offset-2"
                  >
                    {t.hostedPageCta}
                  </button>
                </div>
              )}
              {otpStep && !error && !finishing && (
                <p className="flex w-full items-start gap-[7px] rounded-[9.104px] border-[0.759px] border-[rgba(217,119,54,0.4)] bg-[rgba(15,23,42,0.55)] px-[12.898px] py-[10px] text-[11px] leading-[15px] text-[#cbd5e1]">
                  <Icon name="feedback.info" className="mt-[1px] size-[13px] shrink-0 text-[#f2ae63]" />
                  <span>{t.otpStepBody}</span>
                </p>
              )}
              {notice && !otpStep && !error && (
                <p className="rounded-[9.104px] border-[0.759px] border-[rgba(51,65,85,0.6)] bg-[rgba(15,23,42,0.5)] px-[12.898px] py-[9px] text-[11px] leading-[15px] text-[#cbd5e1]">
                  {notice}
                </p>
              )}
            </div>

            {/* key={step} replays the entrance, so the card reads as changing its
                contents rather than as a page the officer was navigated to. */}
            <div key={step} className={SWAP_CLASS}>
              {otpStep ? (
                <>
                  <p className="flex w-full min-w-0 items-center gap-[7px] text-[11px] leading-[15px] text-[#94a3b8]">
                    <Icon name="user.single" className="size-[13px] shrink-0 text-[#d97736]" />
                    <span className="truncate">
                      {t.accountPrefix}{" "}
                      <span className="font-semibold text-[#e2e8f0]">{username.trim()}</span>
                    </span>
                  </p>

                  <div className="flex w-full flex-col gap-[6.069px]">
                    <label htmlFor="login-otp" className={LABEL_CLASS}>
                      {t.otpLabel}
                    </label>
                    <input
                      id="login-otp"
                      ref={otpRef}
                      className={`${INPUT_CLASS} tracking-[3px]`}
                      type="text"
                      name="otp"
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      disabled={busy}
                      placeholder={t.otpPlaceholder}
                      value={otp}
                      onChange={(event) => setOtp(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    />
                    <p className="text-[10px] leading-[14px] text-[#94a3b8]">
                      {t.enrolmentHint}{" "}
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void toHostedPage({ action: "CONFIGURE_TOTP", loginHint: username.trim() })}
                        className="font-semibold text-[#d97736] underline underline-offset-2 disabled:opacity-60"
                      >
                        {t.enrolmentCta}
                      </button>
                    </p>
                  </div>

                  {showSkewWarning && (
                    <p
                      role="status"
                      className="flex items-start gap-[7px] rounded-[9.104px] border-[0.759px] border-[rgba(217,119,54,0.5)] bg-[rgba(69,39,10,0.55)] px-[12.898px] py-[9px] text-[10px] leading-[14px] text-[#fbd9b5]"
                    >
                      <Icon name="feedback.warning" className="mt-[1px] size-[13px] shrink-0" />
                      <span>
                        <span className="font-semibold">{t.clockSkewTitle}</span> {t.clockSkewBody}{" "}
                        {t.clockSkewDetail(skew ?? 0)}
                      </span>
                    </p>
                  )}

                  {submitButton}

                  {/* The credential fields are gone, so this is the only way back
                      to a mistyped password. Without it the officer is stuck
                      typing codes at a password that will never be accepted. */}
                  <button
                    type="button"
                    disabled={busy}
                    onClick={backToPassword}
                    className="mx-auto flex items-center gap-[6px] rounded-[6px] px-[6px] py-[4px] text-[11px] leading-[15px] font-semibold text-[#d97736] uppercase tracking-[0.4px] outline-none hover:underline focus-visible:ring-[2px] focus-visible:ring-[#d97736]/60 disabled:opacity-60"
                  >
                    <Icon name="action.back" className="size-[13px]" />
                    {t.backCta}
                  </button>
                </>
              ) : (
                <>
                  <div className="flex w-full flex-col gap-[6.069px]">
                    <label htmlFor="login-username" className={LABEL_CLASS}>
                      {t.usernameLabel}
                    </label>
                    <input
                      id="login-username"
                      ref={usernameRef}
                      className={INPUT_CLASS}
                      type="text"
                      name="username"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      disabled={busy}
                      placeholder={t.usernamePlaceholder}
                      value={username}
                      onChange={(event) => setUsername(event.target.value)}
                    />
                  </div>

                  <div className="flex w-full flex-col gap-[6.069px]">
                    {/* Figma 147:1012 sets this one label a pixel larger than the others; matched, not tidied. */}
                    <label htmlFor="login-password" className={`${LABEL_CLASS} text-[14px]`}>
                      {t.passwordLabel}
                    </label>
                    <div className="relative w-full">
                      <input
                        id="login-password"
                        ref={passwordRef}
                        className={`${INPUT_CLASS} pr-[34px]`}
                        type={revealed ? "text" : "password"}
                        name="password"
                        autoComplete="current-password"
                        disabled={busy}
                        placeholder={t.passwordPlaceholder}
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                      />
                      <button
                        type="button"
                        aria-label={revealed ? t.passwordHide : t.passwordShow}
                        aria-pressed={revealed}
                        disabled={busy}
                        onClick={() => setRevealed((shown) => !shown)}
                        className="absolute top-1/2 right-[4px] grid size-[27px] -translate-y-1/2 place-items-center rounded-[6px] text-[#6b7280] outline-none hover:text-[#cbd5e1] focus-visible:ring-[2px] focus-visible:ring-[#d97736]/60"
                      >
                        <Icon
                          name={revealed ? "action.hide" : "action.view"}
                          className="size-[15px]"
                        />
                      </button>
                    </div>
                  </div>

                  <div className="flex w-full items-center justify-between gap-3">
                    <label
                      htmlFor="login-remember"
                      className="flex cursor-pointer items-center gap-[9.104px] select-none"
                    >
                      <span className="relative grid size-[15.173px] shrink-0 place-items-center rounded-[3.035px] border-[0.759px] border-white bg-[#22252f]">
                        <input
                          id="login-remember"
                          type="checkbox"
                          disabled={busy}
                          checked={remember}
                          onChange={(event) => setRemember(event.target.checked)}
                          className="peer absolute inset-0 size-full cursor-pointer appearance-none rounded-[3.035px] outline-none focus-visible:ring-[2px] focus-visible:ring-[#d97736]/70"
                        />
                        <Icon
                          name="form.check"
                          className="pointer-events-none size-[11px] text-[#d97736] opacity-0 peer-checked:opacity-100"
                        />
                      </span>
                      <span className="text-[11px] leading-[11.38px] font-semibold tracking-[-0.3793px] text-[#94a3b8] uppercase">
                        {t.rememberLabel}
                      </span>
                    </label>

                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void toHostedPage()}
                      className="-my-[6px] py-[6px] text-right text-[9.104px] leading-[11.38px] font-semibold tracking-[-0.3793px] text-[#d97736] uppercase outline-none hover:underline focus-visible:underline disabled:opacity-60"
                    >
                      {t.forgotLabel}
                    </button>
                  </div>

                  {submitButton}
                </>
              )}
            </div>
          </form>

          {/* Kept on both steps: the step where someone is stuck on a code is the
              step where the support number is most needed. */}
          <div
            className="w-full border-t-[0.759px] border-[rgba(51,65,85,0.3)] pt-[18.967px]"
            style={FACE.ui}
          >
            <div className="flex items-center justify-center gap-[9.104px]">
              <Icon name="user.phone" className="size-[18px] shrink-0 text-[#d97736]" />
              <p className="text-[8.345px] leading-[12.518px] tracking-[0.2086px] text-[#94a3b8] max-[640px]:text-[10px] max-[640px]:leading-[14px]">
                {t.supportPrefix}{" "}
                <a
                  href={`tel:${t.supportNumber.replace(/\D/g, "")}`}
                  aria-label={t.supportLinkLabel}
                  className="font-semibold whitespace-nowrap text-white underline-offset-2 hover:underline focus-visible:underline"
                >
                  {t.supportNumber}
                </a>
              </p>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
