/**
 * `/api/icms/app-config` — the rules the server enforces, published so that no
 * client has to keep a copy of one.
 *
 * `require_icms_user` and no permission code: every signed-in ICMS role may read
 * it. Flat snake_case, no envelope.
 *
 * The whole point of the endpoint is that these numbers live in one place. So
 * nothing in the portal may name a threshold or a count of its own — not as a
 * default, not as a fallback when this request fails, not "just for the message
 * while it loads". A bound the server has not published arrives here as `null`
 * and the screens say they do not know it; a bound this file invented would be
 * the stale second copy the endpoint exists to end, and it would be believed.
 *
 * `minimum_photo_count` and `maximum_photo_count` are typed nullable for the
 * same reason: a server that has not published them yet is not an error, it is
 * an unknown rule, and an unknown rule is the server's alone to apply.
 */

import { IcmsApiError, icmsRequest } from "./http";

/* -------------------------------------------------------------------------
   TEMPORARY LOCAL TYPE — the shape agreed with `routers/icms.py:71`.

   `AppConfigOut` is not in `src/api/generated/ada-api.ts` yet. The moment the
   server publishes the two photograph counts, rerun

       npm run api:types

   and this becomes

       export type AppConfig = components["schemas"]["AppConfigOut"];

   — at which point the two counts stop being nullable, which every reader
   below already handles.
   ------------------------------------------------------------------------- */

export type AppConfig = {
  /** Metres. A check-in with a worse fix is refused `poor_accuracy`. */
  gps_accuracy_gate_m: number;
  /** Metres. A capture worse than this is stored, and stored flagged. */
  gps_accuracy_flag_m: number;
  /** Hours. A device clock further out than this is refused. */
  device_timestamp_max_age_hours: number;
  /** Photographs a round needs before it may be submitted. `null` = not published. */
  minimum_photo_count: number | null;
  /** Photographs a round may hold at all. `null` = not published. */
  maximum_photo_count: number | null;
};

const PATH = "/api/icms/app-config";

// The three metres-and-hours fields have been published since the route landed.
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// A count is a whole number of files or it is not a count: anything else is
// unknown here, never rounded and never defaulted.
function asCount(value: unknown): number | null {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0 ? value : null;
}

/** The server's own rules. A shape change is a thrown error, not a screen of `undefined`. */
export async function fetchAppConfig(signal: AbortSignal): Promise<AppConfig> {
  const body = await icmsRequest(PATH, { signal });
  const raw =
    typeof body === "object" && body !== null ? (body as Record<string, unknown>) : null;

  if (
    raw === null ||
    !isFiniteNumber(raw.gps_accuracy_gate_m) ||
    !isFiniteNumber(raw.gps_accuracy_flag_m) ||
    !isFiniteNumber(raw.device_timestamp_max_age_hours)
  ) {
    throw new IcmsApiError(200, {
      code: "malformed_response",
      message: "The application configuration response did not have the expected shape.",
    });
  }

  return {
    gps_accuracy_gate_m: raw.gps_accuracy_gate_m,
    gps_accuracy_flag_m: raw.gps_accuracy_flag_m,
    device_timestamp_max_age_hours: raw.device_timestamp_max_age_hours,
    minimum_photo_count: asCount(raw.minimum_photo_count),
    maximum_photo_count: asCount(raw.maximum_photo_count),
  };
}
