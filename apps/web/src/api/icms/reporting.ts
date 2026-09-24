/**
 * `GET /api/icms/admin/reporting` — the reporting structure, read-only.
 *
 * Written against `reporting_structure` in `services/api/app/routers/icms_users.py`.
 * Every active ICMS role, most senior first, each with the officers Keycloak maps
 * to it and their active zone assignments. `reports_to` names the role one rung
 * up; it is null for the top and for a role created from Administration that
 * has not been placed on the ladder. Guarded by `user.read`, like the register.
 */

import type { components } from "@ada/api-types/ada-api";
import { IcmsApiError, icmsRequest } from "./http";

type Schemas = components["schemas"];

export type ReportingRole = Schemas["ReportingRole"];
export type ReportingMember = Schemas["ReportingMember"];
export type ReportingZone = Schemas["ReportingZone"];

/** A proxy error page or a contract change must throw here, not draw an empty chart. */
function narrowRoles(body: unknown): ReportingRole[] {
  const ok =
    Array.isArray(body) &&
    body.every(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        typeof (row as Record<string, unknown>).role_cd === "string" &&
        Array.isArray((row as Record<string, unknown>).members),
    );
  if (!ok) {
    throw new IcmsApiError(200, {
      code: "malformed_response",
      message: "The reporting structure response did not have the expected shape.",
    });
  }
  return body as ReportingRole[];
}

export async function getReportingStructure(signal: AbortSignal): Promise<ReportingRole[]> {
  return narrowRoles(await icmsRequest("/api/icms/admin/reporting", { signal }));
}
