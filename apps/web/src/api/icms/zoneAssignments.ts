/**
 * `/api/icms/zone-assignments` — which officers cover which zones.
 *
 * Written against `services/api/app/routers/icms.py`. Many-to-many: an officer
 * may hold many zones and a zone many officers. Every route is guarded by
 * `zone_assignment.manage`; POST answers 201 when it opened an assignment and
 * 200 when one was already open, and DELETE revokes rather than deletes.
 */

import type { components } from "@ada/api-types/ada-api";
import { IcmsApiError, icmsRequest } from "./http";

type Schemas = components["schemas"];

export type ZoneAssignment = Schemas["ZoneAssignmentOut"];
export type ZoneAssignmentRevoked = Schemas["ZoneAssignmentRevoked"];

export const ZONE_ASSIGNMENT_READ = "zone_assignment.read";
export const ZONE_ASSIGNMENT_MANAGE = "zone_assignment.manage";

const BASE = "/api/icms/zone-assignments";
const PAGE_SIZE = 200;

function malformed(what: string): IcmsApiError {
  return new IcmsApiError(200, {
    code: "malformed_response",
    message: `The ${what} response did not have the expected shape.`,
  });
}

function isAssignment(value: unknown): value is ZoneAssignment {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.zone_cd === "string" && typeof row.user_id === "string";
}

/** An officer's active assignments, zone code order. */
export async function listOfficerZones(
  userId: string,
  signal: AbortSignal,
): Promise<ZoneAssignment[]> {
  const body = await icmsRequest(BASE, {
    query: { user_id: [userId], active: true, size: PAGE_SIZE, sort: "zone_cd" },
    signal,
  });
  const items: unknown =
    typeof body === "object" && body !== null ? (body as { items?: unknown }).items : null;
  if (!Array.isArray(items) || !items.every(isAssignment)) throw malformed("zone assignment");
  return items;
}

/** 201 opened, 200 already open — both leave the officer covering the zone. */
export async function assignZone(userId: string, zoneCd: string): Promise<ZoneAssignment> {
  const body = await icmsRequest(BASE, {
    method: "POST",
    body: { zone_cd: zoneCd, user_id: userId },
  });
  if (!isAssignment(body)) throw malformed("zone assignment");
  return body;
}

/** Closes the open assignment; `revoked: false` means there was none open. */
export async function revokeZone(
  userId: string,
  zoneCd: string,
): Promise<ZoneAssignmentRevoked> {
  const body = await icmsRequest(BASE, {
    method: "DELETE",
    query: { zone_cd: zoneCd, user_id: userId },
  });
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).revoked !== "boolean"
  ) {
    throw malformed("zone revocation");
  }
  return body as ZoneAssignmentRevoked;
}
