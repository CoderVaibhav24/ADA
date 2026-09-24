import { env } from '@/services/config/env';
import { fetchWithTimeout, TIMEOUT_MS } from '@/services/net/fetch-with-timeout';
import { cacheStore, readJson, writeJson } from '@/services/storage/kv';

/*
 * Where the identity provider is.
 *
 * The issuer is read from the API's `/api/auth/config`, the same endpoint the
 * portal reads (`apps/web/src/auth/oidc.ts`). One deployment therefore cannot
 * drift from the other, and a realm URL is not compiled into a binary that is
 * supposed to be identical in every environment.
 *
 * The client id is *not* taken from that endpoint: it answers `ada-web`, the
 * portal's client. The native client (`ada-field`) comes from the build
 * (`ada.config.ts`), so the two can be tuned and revoked separately.
 *
 * The issuer is cached, because a refresh at 7am in a village needs the token
 * endpoint and may not be able to ask for it. The token endpoint is derived from
 * the issuer (Keycloak's fixed layout), so no discovery round trip is needed.
 */
const ISSUER_KEY = 'auth:issuer';

function isString(value: unknown): value is string {
  return typeof value === 'string' && value !== '';
}

// The issuer this device last saw, or null before the first successful fetch.
export function cachedIssuer(): string | null {
  if (env.authIssuerOverride !== null) return env.authIssuerOverride;
  return readJson(cacheStore, ISSUER_KEY, isString);
}

/*
 * The issuer, from the API, falling back to the cached value when the API is
 * unreachable. An override in the build wins over both — it is how a UAT build
 * points at a different realm without a backend change.
 */
export async function resolveIssuer(): Promise<string> {
  if (env.authIssuerOverride !== null) return env.authIssuerOverride;

  try {
    const response = await fetchWithTimeout(
      `${env.apiBaseUrl}/api/auth/config`,
      {},
      TIMEOUT_MS.auth,
    );
    if (response.ok) {
      const body: unknown = await response.json();
      const issuer = (body as { issuer?: unknown } | null)?.issuer;
      if (isString(issuer)) {
        writeJson(cacheStore, ISSUER_KEY, issuer);
        return issuer;
      }
    }
  } catch {
    // Fall through to the cache: offline is normal here, not exceptional.
  }

  const cached = cachedIssuer();
  if (cached !== null) return cached;

  throw new Error(
    'The sign-in configuration has never been read on this device and the API ' +
      'cannot be reached. Connect to a network once to sign in for the first time.',
  );
}

// Keycloak's token endpoint for an issuer; used for the password grant and every refresh.
export function tokenEndpointFor(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}/protocol/openid-connect/token`;
}

// Keycloak's end-session endpoint for an issuer (its discovery `end_session_endpoint`), same fixed layout.
export function logoutEndpointFor(issuer: string): string {
  return `${issuer.replace(/\/+$/, '')}/protocol/openid-connect/logout`;
}

// The token endpoint, from the API's issuer or the cached one when the API is unreachable.
export async function resolveTokenEndpoint(): Promise<string> {
  return tokenEndpointFor(await resolveIssuer());
}

// The token endpoint from the issuer already on disk, for a refresh that must not wait on the network.
export function cachedTokenEndpoint(): string | null {
  const issuer = cachedIssuer();
  return issuer === null ? null : tokenEndpointFor(issuer);
}

export const clientId = env.authClientId;
