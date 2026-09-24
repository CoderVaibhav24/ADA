/**
 * Every user-visible string on the login screen, in one place.
 *
 * Mirrors the shape of routes/labels.en.ts so the i18n swap is mechanical: a
 * login-labels.hi.ts exports the same keys and the component picks one at
 * runtime. Nothing in Login.tsx may hardcode a string.
 *
 * The wording rule that outranks brevity: never say whether a username exists.
 * Keycloak refuses to distinguish a wrong password from an unknown account, and
 * these sentences must not reintroduce the distinction by implication.
 */

export const loginLabelsEn = {
  /* Figma 147:981 — one line, "ICMS-" ochre, the rest cream. */
  brandShort: "ICMS-",
  brandRest: "Illegal Construction Monitoring System",

  title: "Login",

  usernameLabel: "Email ID",
  usernamePlaceholder: "Enter here",
  passwordLabel: "Password",
  passwordPlaceholder: "••••••••",
  passwordShow: "Show password",
  passwordHide: "Hide password",

  rememberLabel: "Remember me",
  forgotLabel: "Forgot password ?",

  cta: "Login",
  ctaBusy: "Signing in…",

  supportPrefix: "Facing issues? Contact support at",
  supportNumber: "1800-123-4567",
  supportLinkLabel: "Call support on 1800 123 4567",

  checkingSession: "Checking your session…",

  /* Step two, the authenticator step. It is not in the Figma frame because the
     design never got as far as the second factor.

     Nothing here may claim the password was accepted: Keycloak answers a wrong
     password and a correct password awaiting a code with the same bytes, so the
     screen genuinely does not know. It asks for the code as the next step and
     keeps its judgement for an actual failure. */
  /* Replaces `title` in the card's heading slot; the password form is gone by
     the time this shows, so the card must say what it is now asking for. */
  otpTitle: "Verify it's you",
  otpStepBody: "Open your authenticator app and type the current 6-digit code for ICMS.",
  otpLabel: "Authenticator code",
  otpPlaceholder: "6-digit code",
  otpCta: "Verify",
  otpCtaBusy: "Verifying…",

  /* Step two names the account as plain text and carries the only way back, so
     a mistyped password is not a trap the officer can escape only by reloading. */
  accountPrefix: "Signing in as",
  backCta: "Back to password",

  /* Session notices, driven by the query string. */
  signedOut: "You have been signed out.",
  sessionExpired: "Your session ended. Sign in again to continue.",

  errorHeading: "Sign-in problem",

  /* One sentence per way this can fail. Keyed by passwordLogin.ts's
     RejectionReason so the component never composes a message itself.

     "bad-credentials" is reachable only from step two — at step one the same
     refusal simply opens the code field — which is why it names both halves of
     the ambiguity and points back at the password. There is no "otp-required"
     entry: that refusal is a step, not a failure, and never reaches this box. */
  errorByReason: {
    "bad-credentials":
      "Either the password or the code was not accepted — the sign-in service does not say which. A code lasts about 30 seconds and works only once, so wait for the next one and type it straight away. If the password may be wrong, go back and type it again.",
    "bad-otp":
      "That 6-digit code was not accepted. A code lasts about 30 seconds and each one works only once — wait for the next code and type it straight away.",
    "account-incomplete":
      "This account still has something to finish — setting up an authenticator, verifying an e-mail address, or changing a password. That can only be done on the secure ADA sign-in page.",
    "account-disabled": "This account is not active. Call support to have it re-enabled.",
    "locked-out":
      "Too many failed attempts, so this account is locked for about 15 minutes. Wait, then try again — or call support if you need in sooner.",
    "direct-grant-disabled":
      "This portal is not yet allowed to sign people in directly. An ADA administrator must switch on Direct Access Grants for the ada-web client in Keycloak. Until then, use the secure ADA sign-in page.",
    "invalid-origin":
      "This portal's web address is not on the sign-in service's allow-list. An ADA administrator must add the address below to Web Origins on the ada-web client in Keycloak.",
    "client-misconfigured":
      "The sign-in service does not recognise this portal. Call support — this is a configuration fault, not a problem with your account.",
    "rate-limited": "Too many attempts from this network. Wait a minute and try again.",
    network:
      "Could not reach the sign-in service. Check your connection and try again.",
    unknown: "Sign-in failed. Try again shortly, and call support if it keeps happening.",
  } as Record<string, string>,

  /* Returning from the hosted page with an error on the callback URL. Keys are
     the OIDC/Keycloak error codes as they arrive; anything unlisted falls back. */
  errorByCode: {
    access_denied: "Sign-in was cancelled or refused. Try again, or call support if this repeats.",
    login_required: "Sign-in did not complete. Try again.",
    interaction_required: "Sign-in needs finishing on the secure ADA sign-in page. Try again.",
    consent_required: "This account has not been granted access to ICMS. Call support.",
    invalid_request: "The sign-in request was rejected. Try again from this page.",
    unauthorized_client: "This portal is not registered with the sign-in service. Call support.",
    temporarily_unavailable: "The sign-in service is busy. Try again shortly.",
    server_error: "The sign-in service failed. Try again shortly.",
    /** oidc-client-ts could not finish the exchange: a reloaded callback, a stale tab, a dead network. */
    callback_failed:
      "Sign-in did not complete. This usually means the page was reloaded part-way through — start again from here.",
  } as Record<string, string>,
  errorFallback: "Sign-in failed. Try again shortly.",

  /* The escape hatches out to Keycloak's own page. Each exists because the
     typed form genuinely cannot do the job here. */
  hostedPageCta: "Open the secure ADA sign-in page",
  /* Shown while an account with a pending required action (new password,
     authenticator QR, e-mail check) is handed to the matching hosted page. */
  finishingSetup: "Finishing your account setup…",
  enrolmentCta: "Set up my authenticator",
  enrolmentHint:
    "No authenticator yet? The QR code can only be shown on the secure ADA sign-in page.",

  /* Required fields, checked before anything is sent. */
  usernameMissing: "Enter your username or mobile number.",
  passwordMissing: "Enter your password.",
  otpMissing: "Enter the 6-digit code from your authenticator app.",

  /* Clock drift. TOTP is derived from the device clock, so this is a different
     fault from a mistyped code and has a different fix. */
  clockSkewTitle: "Your device clock is out of step.",
  clockSkewBody:
    "Authenticator codes are worked out from the clock, so they will be refused until this is fixed. Set the date and time to update automatically, then sign in.",
  clockSkewDetail: (secondsOff: number) =>
    `This device is about ${Math.abs(secondsOff)} seconds ${secondsOff > 0 ? "ahead of" : "behind"} the server.`,
} as const;

export type LoginLabels = typeof loginLabelsEn;

/** The /auth/callback wait. Every failure there is worded by the login screen instead. */
export const authCallbackEn = {
  completing: "Completing sign-in…",
} as const;
