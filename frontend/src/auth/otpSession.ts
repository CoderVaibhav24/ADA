/**
 * The session an OTP login produces, which oidc-client-ts knows nothing about.
 *
 * Two ways into ADA end in a token, and only one of them is an OIDC redirect:
 *
 *   password + TOTP  -> Keycloak's login page -> UserManager owns the session
 *   phone  + code    -> ada-auth mints tokens -> nothing owns them but this
 *   email  + code    -> ada-auth mints tokens -> nothing owns them but this
 *
 * The tokens ada-auth returns are ORDINARY realm tokens — same issuer, same
 * signing key, same `iss` — so ada-api verifies them exactly as it verifies a
 * redirect-obtained one. The difference is purely custodial: no UserManager
 * minted them, so no UserManager will renew them, and this module is what does.
 *
 * Kept deliberately small. It stores three things and knows how to refresh
 * them; deciding WHICH session is live belongs in oidc.ts, where both kinds
 * are visible at once.
 */

const KEY = "ada.otp.session";

/** Refresh this long before expiry, so no request goes out with a dead token. */
const HEADROOM_SECONDS = 30;

export interface OtpTokens {
  access_token: string;
  refresh_token: string | null;
  /** Unix epoch seconds — the shape oidc-client-ts stores, so both session kinds age alike. */
  expires_at: number;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  token_type: string;
}

function read(): OtpTokens | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as OtpTokens;
    // A half-written or hand-edited entry must not authenticate anybody.
    if (typeof parsed?.access_token !== "string" || typeof parsed?.expires_at !== "number") {
      return null;
    }
    return parsed;
  } catch {
    // Private windows and cleared site data both throw rather than return null.
    return null;
  }
}

function write(tokens: OtpTokens): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(tokens));
  } catch {
    // Storage unavailable. The session survives for this page only, which is
    // worse than persisting it and far better than failing the login.
  }
}

export function clearOtpSession(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* nothing to do */
  }
}

export function hasOtpSession(): boolean {
  return read() !== null;
}

/** Store what ada-auth just returned. */
export function storeOtpTokens(response: TokenResponse): void {
  write({
    access_token: response.access_token,
    refresh_token: response.refresh_token,
    expires_at: Math.floor(Date.now() / 1000) + response.expires_in,
  });
}

/**
 * A usable access token from the OTP session, or null.
 *
 * Refreshes through ada-auth when the current one is close to expiry. Returns
 * null — and clears the session — when the refresh token is spent, because a
 * session that cannot be renewed is over, and pretending otherwise produces a
 * 401 on every later request instead of a sign-in prompt.
 */
export async function otpAccessToken(): Promise<string | null> {
  const tokens = read();
  if (!tokens) return null;

  const now = Math.floor(Date.now() / 1000);
  if (now < tokens.expires_at - HEADROOM_SECONDS) {
    return tokens.access_token;
  }

  if (!tokens.refresh_token) {
    clearOtpSession();
    return null;
  }

  try {
    const response = await fetch("/auth-api/v1/auth/refresh", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }),
    });
    if (!response.ok) {
      // 400/401 means the refresh token is genuinely dead — revoked, or the
      // realm session expired. Anything else is transient, and clearing the
      // session over a blip would sign the officer out mid-upload.
      if (response.status === 401 || response.status === 400) clearOtpSession();
      return null;
    }
    const refreshed = (await response.json()) as TokenResponse;
    storeOtpTokens(refreshed);
    return refreshed.access_token;
  } catch {
    // Network failure. Keep the session; the next call tries again.
    return null;
  }
}

/** End the session at ada-auth as well as locally. Never throws. */
export async function endOtpSession(): Promise<void> {
  const tokens = read();
  clearOtpSession();
  if (!tokens?.refresh_token) return;
  try {
    await fetch("/auth-api/v1/auth/logout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refresh_token: tokens.refresh_token }),
    });
  } catch {
    // Local state is already gone, which is the part that matters to this
    // browser. An un-revoked refresh token expires on the realm's own schedule.
  }
}
