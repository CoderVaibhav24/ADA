import * as Network from 'expo-network';

import { fetchWithTimeout, TIMEOUT_MS } from '@/services/net/fetch-with-timeout';
import { cacheStore } from '@/services/storage/kv';

import { profileFromIdToken, type Profile } from './claims';
import { cachedTokenEndpoint, clientId, resolveTokenEndpoint } from './discovery';
import { clearTokens, readProfile, readTokens, writeProfile, writeTokens } from './tokens';

/*
 * The session. Keycloak's direct access grant (`grant_type=password`) against the
 * portal's realm, typed into the app's own form exactly as the portal's is
 * (`apps/web/src/auth/passwordLogin.ts`) — the same realm, the same issuer, no
 * parallel login scheme (Architecture.md §5). The password is held only for the
 * one request and is never logged or stored.
 *
 * The rule that shapes this file: **a refresh that fails without a network does
 * not sign anybody out.** A field day is longer than an access token and a
 * surveyor in a village with no signal still has a morning's captures on the
 * handset. Losing the session there would mean losing the evidence with it. So a
 * failure is classified: the provider refusing the grant ends the session; the
 * network being absent moves it to `stale`, which holds tokens, holds captures,
 * and refreshes on reconnect.
 */
export type SessionStatus = 'restoring' | 'signedOut' | 'signedIn' | 'stale';

export type SignOutReason = 'user' | 'refresh_rejected' | 'none';

export type SessionSnapshot = {
  readonly status: SessionStatus;
  readonly profile: Profile | null;
  readonly reason: SignOutReason;
};

export type RefreshOutcome = 'refreshed' | 'offline' | 'rejected' | 'no_session';

/*
 * `offline_access` is not decoration. Without it Keycloak binds the refresh token
 * to the SSO session idle timeout, which defaults to 30 minutes — shorter than a
 * walk between two parcels. With it the refresh token survives the gap and the
 * surveyor stays signed in across the day — until the realm's 30-day offline idle.
 */
const SCOPE = 'openid profile email offline_access';

// Refresh this long before expiry, so a request never leaves with a token that dies in flight.
const REFRESH_SKEW_MS = 60_000;

// Provider answers that mean the grant is gone. Everything else is treated as a network problem.
const FATAL_TOKEN_ERRORS = new Set([
  'invalid_grant',
  'invalid_client',
  'unauthorized_client',
  'unsupported_grant_type',
]);

let snapshot: SessionSnapshot = { status: 'restoring', profile: null, reason: 'none' };
const listeners = new Set<(next: SessionSnapshot) => void>();
let refreshInFlight: Promise<RefreshOutcome> | null = null;

export function getSession(): SessionSnapshot {
  return snapshot;
}

// Subscribes to session changes. The store mirrors this; nothing else should need it.
export function subscribeToSession(listener: (next: SessionSnapshot) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function publish(next: SessionSnapshot): SessionSnapshot {
  snapshot = next;
  for (const listener of listeners) listener(next);
  return next;
}

// True when the handset has no usable connection, which is the normal case in the field.
async function isOffline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return state.isConnected === false || state.isInternetReachable === false;
  } catch {
    return false;
  }
}

type TokenResponse = {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly expires_in?: number;
  readonly scope?: string;
  readonly id_token?: string;
};

type TokenFailure = {
  readonly error?: string;
  readonly error_description?: string;
};

function isTokenResponse(value: unknown): value is TokenResponse {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { access_token?: unknown }).access_token === 'string'
  );
}

// Turns a token endpoint response into the shape stored on disk.
function toTokenSet(response: TokenResponse): {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  scope: string | null;
} {
  const lifetimeSeconds = response.expires_in ?? 300;
  return {
    accessToken: response.access_token,
    refreshToken: response.refresh_token ?? null,
    expiresAt: Date.now() + lifetimeSeconds * 1000,
    scope: response.scope ?? null,
  };
}

// The error body of a refused token request, or an empty object when it is not Keycloak's JSON.
async function readFailure(response: Response): Promise<TokenFailure> {
  try {
    const body: unknown = await response.json();
    return body !== null && typeof body === 'object' ? (body as TokenFailure) : {};
  } catch {
    return {};
  }
}

// POSTs a form to the token endpoint. Throws only on transport failure.
function postToken(tokenEndpoint: string, form: Record<string, string>): Promise<Response> {
  return fetchWithTimeout(
    tokenEndpoint,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body: new URLSearchParams(form).toString(),
    },
    TIMEOUT_MS.auth,
  );
}

/*
 * Restores the session at launch. Reads what is on disk and, if the access token
 * has expired, tries one refresh — which may end in `stale` and must not end in a
 * sign-out just because the app was opened out of coverage.
 */
export async function restoreSession(): Promise<SessionSnapshot> {
  const [tokens, profile] = await Promise.all([readTokens(), readProfile()]);

  if (tokens === null) {
    return publish({ status: 'signedOut', profile: null, reason: 'none' });
  }

  if (Date.now() < tokens.expiresAt - REFRESH_SKEW_MS) {
    return publish({ status: 'signedIn', profile, reason: 'none' });
  }

  publish({ status: 'stale', profile, reason: 'none' });
  await refreshSession();
  return snapshot;
}

/*
 * One refresh at a time, whoever asks. Two screens mounting at once must not send
 * two refresh requests, because Keycloak rotates refresh tokens and the loser of
 * that race gets `invalid_grant` for a session that is perfectly healthy.
 */
export function refreshSession(): Promise<RefreshOutcome> {
  refreshInFlight ??= runRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function runRefresh(): Promise<RefreshOutcome> {
  const tokens = await readTokens();
  const profile = await readProfile();

  if (tokens === null || tokens.refreshToken === null) {
    publish({ status: 'signedOut', profile: null, reason: 'none' });
    return 'no_session';
  }

  if (await isOffline()) {
    publish({ status: 'stale', profile, reason: 'none' });
    return 'offline';
  }

  const tokenEndpoint = cachedTokenEndpoint() ?? (await resolveTokenEndpoint().catch(() => null));
  if (tokenEndpoint === null) {
    publish({ status: 'stale', profile, reason: 'none' });
    return 'offline';
  }

  let response: Response;
  try {
    response = await postToken(tokenEndpoint, {
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: tokens.refreshToken,
      scope: SCOPE,
    });
  } catch {
    /*
     * A timeout, a captive portal, a DNS failure on a train. The session holds:
     * the tokens stay on disk, the captures stay on disk, and the next
     * connectivity change tries again.
     */
    publish({ status: 'stale', profile, reason: 'none' });
    return 'offline';
  }

  const body: unknown = response.ok ? await response.json().catch(() => null) : null;
  if (response.ok && isTokenResponse(body)) {
    const next = toTokenSet(body);
    await writeTokens({
      ...next,
      refreshToken: next.refreshToken ?? tokens.refreshToken,
    });
    publish({ status: 'signedIn', profile, reason: 'none' });
    return 'refreshed';
  }

  const failure: TokenFailure = response.ok ? {} : await readFailure(response);
  const fatal = failure.error !== undefined && FATAL_TOKEN_ERRORS.has(failure.error);
  if (!fatal) {
    // A 5xx, a proxy's HTML page, a malformed body: not the provider refusing the grant.
    publish({ status: 'stale', profile, reason: 'none' });
    return 'offline';
  }
  await endSession('refresh_rejected');
  return 'rejected';
}

/*
 * The bearer for the next request, refreshing first if the current one is about
 * to expire. Answers null when there is nothing usable — the caller decides
 * whether that is fatal; for a cached read it is not.
 */
export async function getAccessToken(): Promise<string | null> {
  const tokens = await readTokens();
  if (tokens === null) return null;
  if (Date.now() < tokens.expiresAt - REFRESH_SKEW_MS) return tokens.accessToken;

  const outcome = await refreshSession();
  if (outcome !== 'refreshed') return null;
  return (await readTokens())?.accessToken ?? null;
}

/*
 * Why a sign-in was refused, classified the way the portal classifies it
 * (`apps/web/src/auth/passwordLogin.ts`). The screen owns the wording; this owns
 * the meaning. A username is never confirmed or denied: Keycloak does not say,
 * and neither does this.
 */
export type SignInFailure =
  | 'bad-credentials'
  | 'second-factor-required'
  | 'account-incomplete'
  | 'account-disabled'
  | 'locked-out'
  | 'direct-grant-disabled'
  | 'client-misconfigured'
  | 'rate-limited'
  | 'network'
  | 'unknown';

export class SignInError extends Error {
  readonly reason: SignInFailure;
  /** Keycloak's own wording, kept only for the faults an administrator must fix. */
  readonly detail: string | undefined;

  constructor(reason: SignInFailure, detail?: string) {
    super(`Sign-in refused: ${reason}`);
    this.name = 'SignInError';
    this.reason = reason;
    this.detail = detail;
  }
}

// Keycloak's wording, matched loosely because it varies across versions. Same patterns as the portal.
const DESCRIPTION_PATTERNS: readonly (readonly [RegExp, SignInFailure])[] = [
  [/missing\s*(totp|otp)|invalid\s*(totp|otp)/i, 'second-factor-required'],
  [/not\s+fully\s+set\s+up/i, 'account-incomplete'],
  [/temporarily\s+disabled|temporarily\s+locked/i, 'locked-out'],
  [/account\s+disabled|account\s+is\s+disabled/i, 'account-disabled'],
  [/direct\s+access\s+grants?/i, 'direct-grant-disabled'],
];

// Keycloak's refusals differ only in `error_description`, so the status alone is never enough.
function classifyRefusal(status: number, body: TokenFailure): SignInFailure {
  const description = `${body.error_description ?? ''} ${body.error ?? ''}`;
  for (const [pattern, reason] of DESCRIPTION_PATTERNS) {
    if (pattern.test(description)) return reason;
  }
  switch (body.error) {
    case 'unauthorized_client':
      return 'direct-grant-disabled';
    case 'invalid_client':
      return 'client-misconfigured';
    case 'invalid_grant':
      return 'bad-credentials';
    default:
      break;
  }
  if (status === 429) return 'rate-limited';
  if (status === 401 || status === 400) return 'bad-credentials';
  return 'unknown';
}

// Exchanges typed credentials for realm tokens; throws SignInError with the reason when refused.
export async function signInWithPassword(username: string, password: string): Promise<SessionSnapshot> {
  let tokenEndpoint: string;
  try {
    tokenEndpoint = await resolveTokenEndpoint();
  } catch {
    throw new SignInError('network');
  }

  let response: Response;
  try {
    response = await postToken(tokenEndpoint, {
      grant_type: 'password',
      client_id: clientId,
      username,
      password,
      scope: SCOPE,
    });
  } catch {
    throw new SignInError('network');
  }

  if (!response.ok) {
    const body = await readFailure(response);
    const reason = classifyRefusal(response.status, body);
    // Only the faults an administrator must fix carry Keycloak's wording; a credential refusal never does.
    const actionable = reason === 'direct-grant-disabled' || reason === 'client-misconfigured';
    throw new SignInError(reason, actionable ? (body.error_description ?? body.error) : undefined);
  }

  const body: unknown = await response.json().catch(() => null);
  if (!isTokenResponse(body)) throw new SignInError('unknown');

  await writeTokens(toTokenSet(body));

  const profile = body.id_token === undefined ? null : profileFromIdToken(body.id_token);
  if (profile !== null) await writeProfile(profile);

  return publish({ status: 'signedIn', profile, reason: 'none' });
}

// Work that needs the bearer one last time (push unregistration). Bounded, and never blocks sign-out.
type BeforeSignOutHook = (reason: SignOutReason) => Promise<void>;
const beforeSignOutHooks = new Set<BeforeSignOutHook>();
const BEFORE_SIGN_OUT_BUDGET_MS = 3000;

export function onBeforeSignOut(hook: BeforeSignOutHook): () => void {
  beforeSignOutHooks.add(hook);
  return () => beforeSignOutHooks.delete(hook);
}

async function runBeforeSignOut(reason: SignOutReason): Promise<void> {
  if (beforeSignOutHooks.size === 0) return;
  const hooks = [...beforeSignOutHooks].map((hook) => hook(reason).catch(() => undefined));
  await Promise.race([
    Promise.all(hooks),
    new Promise<void>((resolve) => setTimeout(resolve, BEFORE_SIGN_OUT_BUDGET_MS)),
  ]);
}

/*
 * Ends the session. Clears tokens and the cached server config — and nothing
 * else. Drafts and captures are deliberately left alone: they are the surveyor's
 * work, not the session's, and a sign-out is not consent to discard evidence.
 */
async function endSession(reason: SignOutReason): Promise<SessionSnapshot> {
  await runBeforeSignOut(reason);
  await clearTokens();

  /*
   * The cached server data goes — another officer may sign in on this handset and
   * must not see the last one's cases. The cached issuer stays: it is public,
   * it is not theirs, and without it a first sign-in needs a network round trip
   * the next person may not have.
   */
  for (const key of cacheStore.getAllKeys()) {
    if (!key.startsWith('auth:')) cacheStore.remove(key);
  }

  return publish({ status: 'signedOut', profile: null, reason });
}

export function signOut(): Promise<SessionSnapshot> {
  return endSession('user');
}

// Called by the API client when the server rejects a bearer it cannot refresh.
export function signOutAfterRejectedRefresh(): Promise<SessionSnapshot> {
  return endSession('refresh_rejected');
}
