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
import { CALLBACK_PATH, LOGIN_PATH, safeReturnTo } from "../routes/paths";
import { useStore } from "../state/store";

export { CALLBACK_PATH, LOGIN_PATH };

interface AuthConfig {
  issuer: string;
  client_id: string;
}

let ready: Promise<UserManager> | null = null;

let cached: string | null = null;

export function cachedAccessToken(): string | null {
  return cached;
}

type SessionEndedListener = () => void;
const sessionEndedListeners = new Set<SessionEndedListener>();

export function onSessionEnded(listener: SessionEndedListener): () => void {
  sessionEndedListeners.add(listener);
  return () => {
    sessionEndedListeners.delete(listener);
  };
}

export function notifySessionEnded(): void {
  cached = null;
  for (const listener of sessionEndedListeners) {
    try {
      listener();
    } catch {
    }
  }
}

function clearInMemorySession(): void {
  cached = null;
  useStore.getState().resetAll();
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
    post_logout_redirect_uri: `${window.location.origin}${LOGIN_PATH}?signedout=1`,
    response_type: "code",
    scope: "openid profile email",
    userStore: new WebStorageStateStore({ store: window.localStorage }),
    automaticSilentRenew: true,
    accessTokenExpiringNotificationTimeInSeconds: 20,
    loadUserInfo: true,
  };

  const manager = new UserManager(settings);

  manager.events.addAccessTokenExpired(() => {
    notifySessionEnded();
  });

  manager.events.addSilentRenewError(() => {
    cached = null;
  });

  return manager;
}

export function auth(): Promise<UserManager> {
  if (!ready) {
    ready = build();
  }
  return ready;
}

export async function isSignedIn(): Promise<boolean> {
  if (await otpAccessToken()) return true;
  return (await currentUser()) !== null;
}

export async function currentUser(): Promise<User | null> {
  try {
    const m = await auth();
    const user = await m.getUser();
    return user && !user.expired ? user : null;
  } catch {
    return null;
  }
}

export async function accessToken(): Promise<string | null> {
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

  return renewOnce();
}

// After a server 401 the cached token is the one it refused; this always asks the issuer for a new one.
export async function renewAccessToken(): Promise<string | null> {
  if (hasOtpSession()) {
    const renewed = await otpAccessToken(true);
    cached = renewed;
    return renewed;
  }
  return renewOnce();
}

let renewing: Promise<string | null> | null = null;

function renewOnce(): Promise<string | null> {
  if (renewing) return renewing;
  renewing = (async () => {
    try {
      const m = await auth();
      const renewed = await m.signinSilent();
      cached = renewed?.access_token ?? null;
      return cached;
    } catch {
      cached = null;
      return null;
    } finally {
      renewing = null;
    }
  })();
  return renewing;
}

/**
 * A Keycloak application-initiated action to run once the password step passes.
 *
 * CONFIGURE_TOTP is the only one the sign-in screen offers: it is how an
 * officer enrols or replaces an authenticator, and the QR code only ever
 * renders on Keycloak's own page.
 */
export type LoginAction = "CONFIGURE_TOTP";

export interface LoginOptions {
  action?: LoginAction;
  /** Prefills Keycloak's username field so the officer is not asked for it twice. */
  loginHint?: string;
}

// kc_action and login_hint are omitted rather than sent empty: Keycloak rejects a blank kc_action.
export async function login(returnTo?: string, options?: LoginOptions): Promise<void> {
  const m = await auth();
  const target = safeReturnTo(
    returnTo ?? window.location.pathname + window.location.search,
  );
  const hint = options?.loginHint?.trim();
  await m.signinRedirect({
    state: { returnTo: target },
    ...(hint ? { login_hint: hint } : {}),
    ...(options?.action ? { extraQueryParams: { kc_action: options.action } } : {}),
  });
}

export async function completeLogin(): Promise<string> {
  const m = await auth();
  const user = await m.signinRedirectCallback();
  cached = user.access_token;
  const state = user.state as { returnTo?: string } | undefined;
  return safeReturnTo(state?.returnTo);
}

export type LogoutOutcome = "local" | "redirecting";

export async function logout(): Promise<LogoutOutcome> {
  clearInMemorySession();

  if (hasOtpSession()) {
    await endOtpSession();
    return "local";
  }

  try {
    const m = await auth();
    await m.signoutRedirect();
    return "redirecting";
  } catch {
    try {
      const m = await auth();
      await m.removeUser();
    } catch {
    }
    return "local";
  }
}

// Claim order must match profileName() in ProtectedLayout.tsx, or the rail and the
// top bar name the same officer differently. Email is last: it is an address, not a person.
export function displayName(user: User | null): string {
  const profile = user?.profile;
  const given = profile?.given_name as string | undefined;
  const family = profile?.family_name as string | undefined;
  const full = [given, family].filter(Boolean).join(" ").trim();
  const email = profile?.email as string | undefined;
  return (
    (profile?.name as string | undefined) ||
    full ||
    (profile?.preferred_username as string | undefined) ||
    email?.split("@")[0] ||
    "authenticated operator"
  );
}
