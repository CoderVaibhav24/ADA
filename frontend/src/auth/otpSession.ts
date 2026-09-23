/**
 * The session a non-redirect login produces, which oidc-client-ts knows nothing about.
 *
 * Four ways into ADA end in a token, and only one of them is an OIDC redirect:
 *
 *   password + TOTP  -> Keycloak's token endpoint -> nothing owns them but this
 *   phone  + code    -> ada-auth mints tokens     -> nothing owns them but this
 *   email  + code    -> ada-auth mints tokens     -> nothing owns them but this
 *   hosted page      -> Keycloak's login page     -> UserManager owns the session
 *
 * Every one of those tokens is an ORDINARY realm token — same issuer, same
 * signing key, same `iss` — so ada-api verifies them identically. The difference
 * is purely custodial: no UserManager minted them, so no UserManager will renew
 * them, and this module is what does. `origin` records which service to ask,
 * because a refresh token is bound to the client that issued it and posting an
 * ada-auth one at Keycloak (or the reverse) is a silent sign-out.
 *
 * Kept deliberately small. It stores the tokens and knows how to renew and end
 * them; deciding WHICH session is live belongs in oidc.ts, where both kinds are
 * visible at once.
 */

const KEY = "ada.otp.session";

/** Refresh this long before expiry, so no request goes out with a dead token. */
const HEADROOM_SECONDS = 30;

/** Where a Keycloak-minted session goes to be renewed or ended. Same-origin paths; see passwordLogin.ts. */
export interface SessionEndpoints {
  tokenUrl: string;
  logoutUrl: string;
  clientId: string;
}

export type SessionOrigin = "ada-auth" | "keycloak";

export interface OtpTokens {
  access_token: string;
  refresh_token: string | null;
  /** Unix epoch seconds — the shape oidc-client-ts stores, so every session kind ages alike. */
  expires_at: number;
  /** Absent on entries written before the password form existed; those are all ada-auth. */
  origin?: SessionOrigin;
  endpoints?: SessionEndpoints;
  /** Carries the officer's name. Kept because nothing else in a password session does. */
  id_token?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  token_type: string;
  /** Present whenever `openid` was in scope. ada-auth's OTP grant does not issue one. */
  id_token?: string | null;
}

export interface StoreOptions {
  origin: SessionOrigin;
  /** REMEMBER ME. False puts the session in sessionStorage, so closing the tab ends it. */
  persist: boolean;
  endpoints?: SessionEndpoints;
}

/** Both stores are searched, because REMEMBER ME decides which one the last login wrote to. */
function stores(): Storage[] {
  const found: Storage[] = [];
  try {
    found.push(window.localStorage);
  } catch {
    /* private window, blocked site data */
  }
  try {
    found.push(window.sessionStorage);
  } catch {
    /* as above */
  }
  return found;
}

function read(): OtpTokens | null {
  for (const store of stores()) {
    try {
      const raw = store.getItem(KEY);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as OtpTokens;
      // A half-written or hand-edited entry must not authenticate anybody.
      if (typeof parsed?.access_token !== "string" || typeof parsed?.expires_at !== "number") {
        continue;
      }
      return parsed;
    } catch {
      // Private windows and cleared site data both throw rather than return null.
    }
  }
  return null;
}

// Writes one store and clears the other, so unticking REMEMBER ME cannot leave a
// persistent session behind on a shared machine.
function write(tokens: OtpTokens, persist: boolean): void {
  try {
    const keep = persist ? window.localStorage : window.sessionStorage;
    const drop = persist ? window.sessionStorage : window.localStorage;
    drop.removeItem(KEY);
    keep.setItem(KEY, JSON.stringify(tokens));
  } catch {
    // Storage unavailable. The session survives for this page only, which is
    // worse than persisting it and far better than failing the login.
  }
}

/**
 * The ID token's claims, read for display only.
 *
 * Never a security decision: ada-api verifies every token it is given, and
 * auth/roles.ts reads roles from the access token. This only feeds a name into
 * the top bar, so an unreadable token is a missing name, not a failed sign-in.
 */
function idTokenClaims(idToken: string): Record<string, unknown> | null {
  try {
    const payload = idToken.split(".")[1];
    if (!payload) return null;
    const bytes = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    // atob yields bytes, not characters: a name with a non-ASCII letter mojibakes without this.
    const text = new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0)));
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Mirrors the session into oidc-client-ts's user store, for the profile alone.
 *
 * `currentUser()` is the only place any screen reads the officer's name from,
 * and it looks nowhere but that store — so a password sign-in that skips this
 * leaves the top bar nameless. The mirror carries the ID token's claims and
 * deliberately NO expires_at: this module owns the session's life and renews
 * it, while an expiry here would arm oidc-client-ts's own expired-token timer
 * and sign the officer out at a boundary it could have refreshed straight
 * through. The refresh token is not copied either; one owner is enough.
 *
 * Imported lazily because auth/oidc.ts imports this module, and a static import
 * back would close the cycle.
 */
async function mirrorProfile(idToken: string, accessToken: string): Promise<void> {
  const claims = idTokenClaims(idToken);
  if (!claims) return;
  try {
    const [{ User }, { auth }] = await Promise.all([import("oidc-client-ts"), import("./oidc")]);
    const manager = await auth();
    await manager.storeUser(
      new User({
        access_token: accessToken,
        id_token: idToken,
        token_type: "Bearer",
        profile: claims as unknown as ConstructorParameters<typeof User>[0]["profile"],
      }),
    );
  } catch {
    // A name is cosmetic. Failing the sign-in over it would not be.
  }
}

/** Paired with mirrorProfile: a cleared session that leaves a profile behind reads as still signed in. */
async function forgetProfile(): Promise<void> {
  try {
    const { auth } = await import("./oidc");
    await (await auth()).removeUser();
  } catch {
    // Nothing stored, or the config is unreachable. Either way there is nothing to undo.
  }
}

export function clearOtpSession(): void {
  for (const store of stores()) {
    try {
      store.removeItem(KEY);
    } catch {
      /* nothing to do */
    }
  }
  void forgetProfile();
}

export function hasOtpSession(): boolean {
  return read() !== null;
}

/** What ada-auth just returned. Kept for OtpForm, which offers no REMEMBER ME of its own. */
export function storeOtpTokens(response: TokenResponse): void {
  void storeSessionTokens(response, { origin: "ada-auth", persist: true });
}

/**
 * Stores the session, then settles the profile mirror.
 *
 * The session itself is written synchronously, before the first await, so it is
 * live the instant this is called. The returned promise covers only the mirror,
 * and a caller that is about to navigate must await it: the protected layout
 * reads the profile as it mounts, and a mirror still in flight renders a
 * nameless top bar for the rest of the session.
 *
 * A refresh does not always re-issue an ID token, so the previous one is kept
 * rather than dropped — losing it would blank the name mid-session.
 */
export async function storeSessionTokens(
  response: TokenResponse,
  options: StoreOptions,
): Promise<void> {
  const idToken = response.id_token ?? read()?.id_token;
  write(
    {
      access_token: response.access_token,
      refresh_token: response.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + response.expires_in,
      origin: options.origin,
      ...(options.endpoints ? { endpoints: options.endpoints } : {}),
      ...(idToken ? { id_token: idToken } : {}),
    },
    options.persist,
  );
  if (idToken) await mirrorProfile(idToken, response.access_token);
}

/** A refresh token is bound to its issuing client, so the renewal has to go back where it came from. */
async function renew(tokens: OtpTokens, refreshToken: string): Promise<Response> {
  if (tokens.origin === "keycloak" && tokens.endpoints) {
    return fetch(tokens.endpoints.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: tokens.endpoints.clientId,
        refresh_token: refreshToken,
      }).toString(),
    });
  }
  return fetch("/auth-api/v1/auth/refresh", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
}

/** True when the live session is the persistent one, so a renewal cannot promote a tab-only session. */
function isPersisted(): boolean {
  try {
    return window.localStorage.getItem(KEY) !== null;
  } catch {
    return true;
  }
}

/**
 * A usable access token from the stored session, or null.
 *
 * Renews when the current one is close to expiry. Returns null — and clears the
 * session — when the refresh token is spent, because a session that cannot be
 * renewed is over, and pretending otherwise produces a 401 on every later
 * request instead of a sign-in prompt.
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

  const persist = isPersisted();

  try {
    const response = await renew(tokens, tokens.refresh_token);
    if (!response.ok) {
      // 400/401 means the refresh token is genuinely dead — revoked, or the
      // realm session expired. Anything else is transient, and clearing the
      // session over a blip would sign the officer out mid-upload.
      if (response.status === 401 || response.status === 400) clearOtpSession();
      return null;
    }
    const refreshed = (await response.json()) as TokenResponse;
    await storeSessionTokens(refreshed, {
      origin: tokens.origin ?? "ada-auth",
      persist,
      endpoints: tokens.endpoints,
    });
    return refreshed.access_token;
  } catch {
    // Network failure. Keep the session; the next call tries again.
    return null;
  }
}

/** End the session at the issuer as well as locally. Never throws. */
export async function endOtpSession(): Promise<void> {
  const tokens = read();
  clearOtpSession();
  if (!tokens?.refresh_token) return;
  try {
    if (tokens.origin === "keycloak" && tokens.endpoints) {
      await fetch(tokens.endpoints.logoutUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: tokens.endpoints.clientId,
          refresh_token: tokens.refresh_token,
        }).toString(),
      });
      return;
    }
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
