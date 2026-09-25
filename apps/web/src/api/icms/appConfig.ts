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
 * while it loads". While the request is in flight there is no config at all,
 * and the screens say they do not know it; a bound this file invented would be
 * the stale second copy the endpoint exists to end, and it would be believed.
 *
 * All five fields are required integers or numbers in `AppConfigOut`; a
 * response missing one is a thrown error, never a defaulted value.
 */

import type { components } from "@ada/api-types/ada-api";
import { IcmsApiError, icmsRequest } from "./http";

/** Generated `AppConfigOut`. Metres for the two accuracy bounds, hours for the clock skew. */
export type AppConfig = components["schemas"]["AppConfigOut"];

const PATH = "/api/icms/app-config";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// A count is a whole number of files or it is not a count: never rounded, never defaulted.
function isCount(value: unknown): value is number {
  return isFiniteNumber(value) && Number.isInteger(value) && value >= 0;
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
    !isFiniteNumber(raw.device_timestamp_max_age_hours) ||
    !isCount(raw.minimum_photo_count) ||
    !isCount(raw.maximum_photo_count) ||
    typeof raw.geofence_enforced !== "boolean" ||
    !isFiniteNumber(raw.geofence_radius_m)
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
    minimum_photo_count: raw.minimum_photo_count,
    maximum_photo_count: raw.maximum_photo_count,
    geofence_enforced: raw.geofence_enforced,
    geofence_radius_m: raw.geofence_radius_m,
  };
}
