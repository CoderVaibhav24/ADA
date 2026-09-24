/*
 * ID token claims, read for display only.
 *
 * The app never authorises anything on a locally-read claim: that is
 * `/api/icms/me/capabilities`, which the server signs off on. This exists so
 * the Profile screen can show a name while offline, and so sign-in can turn a
 * non-surveyor away with a clear message instead of an app full of refusals.
 */
export type IdTokenClaims = {
  readonly sub: string;
  readonly name?: string;
  readonly given_name?: string;
  readonly family_name?: string;
  readonly preferred_username?: string;
  readonly email?: string;
  /** Keycloak realm roles; the same claim ada-platform's Principal.roles reads. */
  readonly realm_access?: { readonly roles?: readonly string[] };
};

// The realm role this app is for (services/api/app/icms/workflow.py Role.FIELD_SURVEYOR).
export const SURVEYOR_ROLE = 'field-surveyor';

// True when the token carries the field-surveyor realm role. A UX gate only; the API still enforces.
export function isSurveyor(claims: IdTokenClaims | null): boolean {
  const roles = claims?.realm_access?.roles;
  return Array.isArray(roles) && roles.includes(SURVEYOR_ROLE);
}

// True only when the token lists its roles and the surveyor role is not among them; an unreadable token is not proof.
export function isKnownNonSurveyor(claims: IdTokenClaims | null): boolean {
  const roles = claims?.realm_access?.roles;
  return Array.isArray(roles) && !roles.includes(SURVEYOR_ROLE);
}

export type Profile = {
  readonly subject: string;
  readonly displayName: string;
};

const BASE64URL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

// Decodes base64url to a UTF-8 string without depending on a platform global.
function decodeBase64Url(input: string): string {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;

  for (const character of input) {
    const value = BASE64URL.indexOf(character);
    if (value < 0) continue;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }

  let text = '';
  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index];
    if (byte < 0x80) {
      text += String.fromCharCode(byte);
    } else if (byte < 0xe0) {
      text += String.fromCharCode(((byte & 0x1f) << 6) | (bytes[++index] & 0x3f));
      } else {
      text += String.fromCharCode(
        ((byte & 0x0f) << 12) | ((bytes[++index] & 0x3f) << 6) | (bytes[++index] & 0x3f),
      );
    }
  }
  return text;
}

// Reads the payload of a JWT. No signature check: the server does that on every call.
export function readIdTokenClaims(idToken: string): IdTokenClaims | null {
  const parts = idToken.split('.');
  if (parts.length < 2) return null;
  try {
    const payload: unknown = JSON.parse(decodeBase64Url(parts[1]));
    if (payload === null || typeof payload !== 'object') return null;
    const claims = payload as Record<string, unknown>;
    if (typeof claims.sub !== 'string') return null;
    return claims as IdTokenClaims;
  } catch {
    return null;
  }
}

/*
 * The claim order matches `apps/web/src/auth/oidc.ts` `displayName()`. The portal
 * and the app must not name the same officer differently. Email is last: it is an
 * address, not a person.
 */
export function displayName(claims: IdTokenClaims | null): string {
  if (claims === null) return 'signed-in surveyor';
  const full = [claims.given_name, claims.family_name].filter(Boolean).join(' ').trim();
  return (
    claims.name ??
    (full !== '' ? full : undefined) ??
    claims.preferred_username ??
    claims.email?.split('@')[0] ??
    'signed-in surveyor'
  );
}

// The subset of the claims the app keeps on disk. Nothing else is stored.
export function profileFromIdToken(idToken: string): Profile | null {
  const claims = readIdTokenClaims(idToken);
  if (claims === null) return null;
  return { subject: claims.sub, displayName: displayName(claims) };
}
