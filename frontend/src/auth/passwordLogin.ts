/**
 * Keycloak's direct access grant, driven from the ICMS sign-in form.
 *
 * The Figma screen types the password into the SPA, so the SPA has to exchange
 * it for tokens itself: POST username/password (and `otp` when the realm asks
 * for one) to the realm token endpoint, grant_type=password.
 *
 * Two things this module is careful about:
 *
 *   - It NEVER tells the caller whether a username exists. Keycloak already
 *     refuses to, and the wording layer must not invent the distinction.
 *   - It classifies the refusal. "Sign-in failed" is useless to an officer who
 *     has a drifted clock, an unenrolled authenticator, or an administrator who
 *     has not switched Direct Access Grants on yet — those need different
 *     sentences and, in the last case, a different person.
 *
 * Requires `directAccessGrantsEnabled: true` on the ada-web client. It is false
 * in infra/keycloak/realm-ada.json, so until that is turned on every attempt
 * comes back `unauthorized_client` and is reported as such rather than as a
 * credential problem.
 */

import { storeSessionTokens, type SessionEndpoints } from "./otpSession";

export type { SessionEndpoints };

/** Keycloak's own wording, matched loosely because it varies across versions. */
const DESCRIPTION_PATTERNS: ReadonlyArray<[RegExp, RejectionReason]> = [
  [/missing\s*(totp|otp)/i, "otp-required"],
  [/invalid\s*(totp|otp)/i, "bad-otp"],
  [/not\s+fully\s+set\s+up/i, "account-incomplete"],
  [/temporarily\s+disabled|temporarily\s+locked/i, "locked-out"],
  [/account\s+disabled|account\s+is\s+disabled/i, "account-disabled"],
  [/direct\s+access\s+grants?/i, "direct-grant-disabled"],
  [/invalid\s+origin/i, "invalid-origin"],
];

export type RejectionReason =
  /** Wrong password, or a required authenticator code that was not supplied. Keycloak does not separate these. */
  | "bad-credentials"
  /** A code was sent and refused: mistyped, already spent, or the device clock has drifted. */
  | "bad-otp"
  /** Keycloak asked for a 6-digit code before it will issue tokens. */
  | "otp-required"
  /** A required action is pending — TOTP enrolment, e-mail verification, a forced password change. */
  | "account-incomplete"
  | "account-disabled"
  /** Brute-force protection has closed the account for a while. */
  | "locked-out"
  /** directAccessGrantsEnabled is false on the client. The one failure an administrator must fix. */
  | "direct-grant-disabled"
  /** The page's origin is not in the client's Web Origins. Keycloak checks it on every browser token POST. */
  | "invalid-origin"
  /** Wrong client id, or a confidential client wanting a secret the browser must never hold. */
  | "client-misconfigured"
  | "rate-limited"
  | "network"
  | "unknown";

export type PasswordLoginResult =
  | { kind: "signed-in" }
  | { kind: "rejected"; reason: RejectionReason; detail?: string };

export interface PasswordLoginInput {
  username: string;
  password: string;
  /** Six digits, only once Keycloak has asked. Omitted, not sent empty — a blank `otp` is a failed code, not an absent one. */
  otp?: string;
  /** False keeps the session in sessionStorage, so closing the tab ends it. */
  remember: boolean;
}

interface AuthConfig {
  issuer: string;
  client_id: string;
}

interface TokenSuccess {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  token_type: string;
  /** Issued because `openid` is in the scope below; it is what carries the officer's name. */
  id_token?: string;
}

interface TokenFailure {
  error?: string;
  error_description?: string;
}

let configured: Promise<SessionEndpoints> | null = null;

/**
 * Same-origin endpoints, deliberately: the browser must not talk to Keycloak cross-origin.
 *
 * Both the vite dev server and the frontend container proxy /idp, and the issuer
 * is already served as an origin-relative path today. Rewriting it onto
 * window.location.origin keeps the token POST same-origin even if the API ever
 * starts advertising an absolute Keycloak host, which would otherwise need a
 * webOrigins CORS entry on the client for every deployment.
 */
async function discover(): Promise<SessionEndpoints> {
  const response = await fetch("/api/auth/config");
  if (!response.ok) throw new Error(`auth config ${response.status}`);
  const config = (await response.json()) as AuthConfig;
  const realm = new URL(config.issuer, window.location.origin).pathname.replace(/\/$/, "");
  return {
    tokenUrl: `${realm}/protocol/openid-connect/token`,
    logoutUrl: `${realm}/protocol/openid-connect/logout`,
    clientId: config.client_id,
  };
}

/** Cached, but the cache is dropped on failure so a late-starting API is retried rather than remembered as broken. */
export function authEndpoints(): Promise<SessionEndpoints> {
  if (!configured) {
    configured = discover().catch((error: unknown) => {
      configured = null;
      throw error;
    });
  }
  return configured;
}

/** Keycloak's refusals differ only in `error_description`, so the status code alone is never enough. */
function classify(status: number, body: TokenFailure): RejectionReason {
  const description = `${body.error_description ?? ""} ${body.error ?? ""}`;

  for (const [pattern, reason] of DESCRIPTION_PATTERNS) {
    if (pattern.test(description)) return reason;
  }

  switch (body.error) {
    case "unauthorized_client":
      return "direct-grant-disabled";
    case "invalid_client":
      return "client-misconfigured";
    case "invalid_grant":
      return "bad-credentials";
    default:
      break;
  }

  if (status === 429) return "rate-limited";
  if (status === 401 || status === 400) return "bad-credentials";
  return "unknown";
}

/**
 * Exchanges the typed credentials for realm tokens, or says why not.
 *
 * Never throws: a thrown network error reads as a crash to the screen, and the
 * officer on a dropped link needs "try again", not a stack trace.
 */
export async function signInWithPassword(
  input: PasswordLoginInput,
): Promise<PasswordLoginResult> {
  let target: SessionEndpoints;
  try {
    target = await authEndpoints();
  } catch {
    return { kind: "rejected", reason: "network" };
  }

  const form = new URLSearchParams({
    grant_type: "password",
    client_id: target.clientId,
    username: input.username,
    password: input.password,
    scope: "openid profile email",
  });
  // Keycloak reads a blank otp as a wrong code rather than an absent one, so an
  // empty field must not be sent at all.
  if (input.otp) form.set("otp", input.otp);

  let response: Response;
  try {
    response = await fetch(target.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    });
  } catch {
    return { kind: "rejected", reason: "network" };
  }

  if (response.ok) {
    const tokens = (await response.json()) as TokenSuccess;
    await storeSessionTokens(tokens, {
      origin: "keycloak",
      persist: input.remember,
      endpoints: target,
    });
    return { kind: "signed-in" };
  }

  let body: TokenFailure = {};
  try {
    body = (await response.json()) as TokenFailure;
  } catch {
    // An HTML error page from a proxy, not Keycloak. The status still classifies it.
  }

  const reason = classify(response.status, body);
  // The raw description is surfaced only for the reasons an administrator must
  // act on; a credential refusal must not echo Keycloak's wording at an officer.
  const actionable =
    reason === "direct-grant-disabled" ||
    reason === "client-misconfigured" ||
    reason === "invalid-origin";
  // The origin Keycloak rejected is the one an administrator has to paste in, so it is named.
  const detail =
    reason === "invalid-origin"
      ? window.location.origin
      : (body.error_description ?? body.error);
  return { kind: "rejected", reason, detail: actionable ? detail : undefined };
}
