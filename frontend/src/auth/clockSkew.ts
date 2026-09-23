/**
 * Device-clock drift, measured before the officer is handed to Keycloak.
 *
 * TOTP is derived from the clock, so a drifted device produces codes Keycloak
 * refuses while the officer swears they typed the right one. The realm's
 * otpPolicyLookAheadWindow is 1 — about one 30-second step of tolerance — and
 * Keycloak's own page never explains a rejection that way, so the warning has
 * to be raised here, before the redirect.
 */

/** Realm otpPolicyPeriod in infra/keycloak/realm-ada.json. A code rolls this often. */
export const TOTP_PERIOD_SECONDS = 30;

/** Past half a step, a rejection is more likely the clock than the typing. */
const SKEW_TOLERANCE_SECONDS = TOTP_PERIOD_SECONDS / 2;

/** Cheap, anonymous and served in every environment, so the probe never 401s. */
const CLOCK_PROBE_PATH = "/api/auth/config";

// Halves the round trip out of the estimate; a slow link otherwise reads as skew.
export async function measureClockSkew(): Promise<number | null> {
  const sentAt = Date.now();
  try {
    const response = await fetch(CLOCK_PROBE_PATH, { method: "GET", cache: "no-store" });
    const header = response.headers.get("Date");
    if (!header) return null;
    const serverMs = Date.parse(header);
    if (!Number.isFinite(serverMs)) return null;

    const receivedAt = Date.now();
    const midpoint = sentAt + (receivedAt - sentAt) / 2;
    return Math.round((midpoint - serverMs) / 1000);
  } catch {
    // Unmeasurable is not the same as fine, so callers must not warn on null.
    return null;
  }
}

/** Narrows to number so a caller cannot format a null into the warning text. */
export function isSkewed(secondsOff: number | null): secondsOff is number {
  return secondsOff !== null && Math.abs(secondsOff) > SKEW_TOLERANCE_SECONDS;
}
