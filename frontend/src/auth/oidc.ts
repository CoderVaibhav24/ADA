/**
 * Keycloak sign-in for the console, over authorisation code + PKCE.
 *
 * This replaced SuperTokens. The difference the rest of the app can see is that
 * the session is no longer a cookie the browser attaches by itself: every
 * authenticated request now carries `Authorization: Bearer <access token>`, and
 * anything the browser fetches on its own — a map tile, an <img>, a download
 * link — has to be given that header explicitly. api/client.ts, MapView's
 * transformRequest and HoverPopup are the three places that matters.
 *
 * ## Why the configuration is fetched, not compiled in
 *
 * A built bundle is the one artefact that should be identical in every
 * environment. A realm URL baked into it means a separate build per
 * environment, and the usual symptom of getting that wrong is a production
 * bundle redirecting people to the staging login page. So the issuer and the
 * client id come from GET /api/auth/config at startup. Both are public by
 * definition — they are what the browser sends to Keycloak in the clear, and a
 * PKCE public client has no secret to leak.
 */

import {
  User,
  UserManager,
  WebStorageStateStore,
  type UserManagerSettings,
} from "oidc-client-ts";

import {
  endOtpSession,
  hasOtpSession,
  otpAccessToken,
} from "./otpSession";

/** Where Keycloak sends the browser back after a successful login. */
export const CALLBACK_PATH = "/auth/callback";
/** Where it sends the browser back after a sign-out. */
export const SIGNED_OUT_PATH = "/auth/signed-out";

interface AuthConfig {
  issuer: string;
  client_id: string;
}

let ready: Promise<UserManager> | null = null;

/**
 * The most recent access token, readable without awaiting.
 *
 * MapLibre's transformRequest is a synchronous callback, so it cannot await a
 * token and cannot be given one later — it captures what it can read at call
 * time. Every resolution of accessToken() writes here, and AuthGate calls it
 * once before rendering the console, so the cache is primed before the map is
 * ever constructed. Without that ordering the first screenful of tiles goes out
 * unauthenticated and comes back 401.
 */
let cached: string | null = null;

export function cachedAccessToken(): string | null {
  return cached;
}

async function build(): Promise<UserManager> {
  const res = await fetch("/api/auth/config");
  if (!res.ok) {
    throw new Error(
      `Could not read the sign-in configuration (${res.status}). The API is ` +
        `up but misconfigured — check OIDC_ISSUER on ada-api.`,
    );
  }
  const config = (await res.json()) as AuthConfig;

  const settings: UserManagerSettings = {
    authority: config.issuer,
    client_id: config.client_id,
    redirect_uri: `${window.location.origin}${CALLBACK_PATH}`,
    post_logout_redirect_uri: `${window.location.origin}${SIGNED_OUT_PATH}`,
    response_type: "code",
    // openid and profile for the subject and the username shown in the header;
    // email because an officer recognises themselves by address, not by UUID.
    scope: "openid profile email",
    // localStorage, not the default sessionStorage: an officer watching a
    // multi-hour ingest opens the project in a second tab, and a per-tab
    // session would ask them to sign in again in it.
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    // Renew in the background, well before expiry. The realm issues
    // short-lived access tokens, and a token that dies mid-upload is the one
    // failure this app can least afford — see uploadRaster in api/client.ts.
    automaticSilentRenew: true,
    accessTokenExpiringNotificationTimeInSeconds: 60,
    loadUserInfo: true,
  };

  return new UserManager(settings);
}

/** The UserManager, built once. */
export function auth(): Promise<UserManager> {
  if (!ready) {
    ready = build();
  }
  return ready;
}

/** True when any session is live, of either kind. */
export async function isSignedIn(): Promise<boolean> {
  if (await otpAccessToken()) return true;
  return (await currentUser()) !== null;
}

/** The signed-in user, or null. Never throws.
 *
 * OIDC sessions only — an OTP session carries tokens but no UserManager
 * profile, so the header falls back to the generic name for it.
 */
export async function currentUser(): Promise<User | null> {
  try {
    const m = await auth();
    const user = await m.getUser();
    // getUser returns an EXPIRED user rather than null, which would otherwise
    // send a dead token on every request until something noticed.
    return user && !user.expired ? user : null;
  } catch {
    return null;
  }
}

/**
 * The access token for an outgoing request, refreshed if it is about to die.
 *
 * Returns null rather than throwing when there is no session: the caller's job
 * is to send the request and let a 401 decide, not to reason about token state.
 */
export async function accessToken(): Promise<string | null> {
  // The OTP session first. Someone who signed in with a code has no
  // UserManager session at all, and asking oidc-client-ts about it would
  // return null and send them back to a login screen they already passed.
  const fromOtp = await otpAccessToken();
  if (fromOtp) {
    cached = fromOtp;
    return cached;
  }

  const user = await currentUser();
  if (user) {
    cached = user.access_token;
    return cached;
  }

  // No live user, but there may be a usable refresh token — a silent renew can
  // have failed once while the laptop was asleep.
  try {
    const m = await auth();
    const renewed = await m.signinSilent();
    cached = renewed?.access_token ?? null;
    return cached;
  } catch {
    cached = null;
    return null;
  }
}

export async function login(): Promise<void> {
  const m = await auth();
  // Where to come back to. Keycloak returns to CALLBACK_PATH regardless, and
  // this is what the callback then restores.
  await m.signinRedirect({
    state: { returnTo: window.location.pathname + window.location.search },
  });
}

/** Complete the redirect. Returns the path the user was on before signing in. */
export async function completeLogin(): Promise<string> {
  const m = await auth();
  const user = await m.signinRedirectCallback();
  const state = user.state as { returnTo?: string } | undefined;
  const returnTo = state?.returnTo;
  // Never honour an absolute URL out of the state — it is round-tripped
  // through the browser, and an open redirect is exactly what that enables.
  return returnTo && returnTo.startsWith("/") && !returnTo.startsWith("//")
    ? returnTo
    : "/";
}

export async function logout(): Promise<void> {
  cached = null;

  // An OTP session is not Keycloak's to end through signoutRedirect — there is
  // no browser session at the identity provider to clear, only a refresh token
  // to revoke. Doing both would bounce the user through a logout page for a
  // session that does not exist there.
  if (hasOtpSession()) {
    await endOtpSession();
    window.location.assign(SIGNED_OUT_PATH);
    return;
  }

  const m = await auth();
  // End the Keycloak session too, not just the local one. Clearing only local
  // storage leaves the browser signed in at the identity provider, so the next
  // "sign in" silently returns the same account — which reads as a broken
  // sign-out button.
  await m.signoutRedirect();
}

/** Best-effort display name for the header. */
export function displayName(user: User | null): string {
  const profile = user?.profile;
  return (
    (profile?.email as string | undefined) ??
    (profile?.preferred_username as string | undefined) ??
    "authenticated operator"
  );
}
