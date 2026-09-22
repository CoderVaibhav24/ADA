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

export async function login(returnTo?: string): Promise<void> {
  const m = await auth();
  const target = safeReturnTo(
    returnTo ?? window.location.pathname + window.location.search,
  );
  await m.signinRedirect({ state: { returnTo: target } });
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

export function displayName(user: User | null): string {
  const profile = user?.profile;
  return (
    (profile?.email as string | undefined) ??
    (profile?.preferred_username as string | undefined) ??
    "authenticated operator"
  );
}
