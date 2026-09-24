import { env } from '@/services/config/env';
import { fetchWithTimeout, TIMEOUT_MS } from '@/services/net/fetch-with-timeout';

/*
 * Phone-clock drift against the API, measured before the authenticator step.
 * TOTP codes come from the clock, so a drifted phone makes codes Keycloak refuses
 * while the surveyor is sure they typed it right. Mirrors apps/web/src/auth/clockSkew.ts.
 */

/** Realm otpPolicyPeriod in infra/keycloak/realm-ada.json. A code rolls this often. */
export const TOTP_PERIOD_SECONDS = 30;

// Past half a step, a refusal is more likely the clock than the typing.
const SKEW_TOLERANCE_SECONDS = TOTP_PERIOD_SECONDS / 2;

// Seconds the phone is ahead (+) or behind (-) the server, or null when it cannot be measured.
export async function measureClockSkew(): Promise<number | null> {
  const sentAt = Date.now();
  try {
    const response = await fetchWithTimeout(
      `${env.apiBaseUrl}/api/auth/config`,
      { method: 'GET', headers: { 'Cache-Control': 'no-cache' } },
      TIMEOUT_MS.auth,
    );
    const header = response.headers.get('Date');
    if (header === null) return null;
    const serverMs = Date.parse(header);
    if (!Number.isFinite(serverMs)) return null;
    const midpoint = sentAt + (Date.now() - sentAt) / 2;
    return Math.round((midpoint - serverMs) / 1000);
  } catch {
    // Unmeasurable is not the same as fine, so callers must not warn on null.
    return null;
  }
}

// Narrows to number so a caller cannot format a null into the warning.
export function isSkewed(secondsOff: number | null): secondsOff is number {
  return secondsOff !== null && Math.abs(secondsOff) > SKEW_TOLERANCE_SECONDS;
}
