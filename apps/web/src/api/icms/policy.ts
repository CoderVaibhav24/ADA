/**
 * `/api/icms/me/capabilities` and `/api/icms/admin/policy/*` — the policy surface.
 *
 * Every type here is the generated one, from `@ada/api-types/ada-api`.
 * Nothing restates a field the server already publishes, so a rename in
 * `icms_admin.py` is a build error here rather than an empty cell.
 *
 * Two things about this contract a caller must not get wrong:
 *
 *   - **the grant write is per role and it REPLACES.** The route is
 *     `PUT /admin/policy/roles/{role_cd}/permissions` and the body carries the
 *     role's COMPLETE grant set. There is no delta form, deliberately: two
 *     admins patching the same role with add/remove deltas is how a revoked
 *     grant comes back from the dead. A matrix save is therefore one request
 *     per changed role, not one request for the matrix.
 *   - **every write bumps `icms_policy_revision` and fires `NOTIFY icms_policy`
 *     in the change's own transaction.** The writing worker reloads
 *     synchronously; every other worker learns on the notify, or within
 *     `ICMS_POLICY_POLL_SECONDS` (15 by default) if the notify is lost. So a
 *     save is durable immediately and uniformly enforced within 15 seconds —
 *     `POLICY_PROPAGATION_SECONDS` below is that bound, and screens are
 *     expected to say so rather than let it look instant.
 */

import type { components } from "@ada/api-types/ada-api";
import { IcmsApiError, icmsRequest } from "./http";

export type Capabilities = components["schemas"]["CapabilitiesOut"];
export type CapabilityAction = components["schemas"]["ActionOut"];
export type PolicyPermission = components["schemas"]["PermissionOut"];
export type RoleGrants = components["schemas"]["RoleGrantsOut"];
export type PolicyTransition = components["schemas"]["TransitionOut"];
export type TransitionPatch = components["schemas"]["TransitionUpdate"];
export type RoleCreateInput = components["schemas"]["RoleCreate"];

/** The backstop poll interval in `PolicyWatcher`. The worst case, not the usual one. */
export const POLICY_PROPAGATION_SECONDS = 15;

/** The codes that gate this whole area. Read from capabilities, enforced server-side. */
export const ADMINISTRATION_ACCESS = "administration.access";
export const POLICY_READ = "policy.read";
export const POLICY_MANAGE = "policy.manage";

/**
 * The error codes `icms_admin.py` can answer with that mean something specific
 * to a screen. Anything else is rendered from `error.message` as it arrives.
 */
export const POLICY_LOCKOUT = "policy_lockout";
export const PERMISSION_IS_SYSTEM = "permission_is_system";
/** 422 on PATCH /transitions/{id}: `permission_cd` names no catalogue row. */
export const UNKNOWN_PERMISSION = "unknown_permission";

const BASE = "/api/icms/admin/policy";

// A shape guard per endpoint: a proxy error page or a contract change must be a
// thrown error at the boundary, not a table of `undefined`.
function narrowList<T>(body: unknown, field: string, what: string): T[] {
  if (
    !Array.isArray(body) ||
    !body.every(
      (item) =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as Record<string, unknown>)[field] === "string",
    )
  ) {
    throw new IcmsApiError(200, {
      code: "malformed_response",
      message: `The ${what} response did not have the expected shape.`,
    });
  }
  return body as T[];
}

// Same reason, for the single-object answers.
function narrowObject<T>(body: unknown, field: string, what: string): T {
  if (
    typeof body !== "object" ||
    body === null ||
    !(field in (body as Record<string, unknown>))
  ) {
    throw new IcmsApiError(200, {
      code: "malformed_response",
      message: `The ${what} response did not have the expected shape.`,
    });
  }
  return body as T;
}

export async function fetchCapabilities(signal: AbortSignal): Promise<Capabilities> {
  const body = await icmsRequest("/api/icms/me/capabilities", { signal });
  return narrowObject<Capabilities>(body, "permissions", "capabilities");
}

export async function listPermissions(signal: AbortSignal): Promise<PolicyPermission[]> {
  const body = await icmsRequest(`${BASE}/permissions`, { signal });
  return narrowList<PolicyPermission>(body, "permission_cd", "permissions");
}

export async function listRoleGrants(signal: AbortSignal): Promise<RoleGrants[]> {
  const body = await icmsRequest(`${BASE}/roles`, { signal });
  return narrowList<RoleGrants>(body, "role_cd", "role grants");
}

export async function listTransitions(signal: AbortSignal): Promise<PolicyTransition[]> {
  const body = await icmsRequest(`${BASE}/transitions`, { signal });
  return narrowList<PolicyTransition>(body, "action_cd", "transitions");
}

/** Replaces the role's whole grant set — callers send every code the role KEEPS. */
export async function putRoleGrants(
  roleCd: string,
  permissionCds: readonly string[],
): Promise<RoleGrants> {
  const body = await icmsRequest(`${BASE}/roles/${encodeURIComponent(roleCd)}/permissions`, {
    method: "PUT",
    body: { permission_cds: [...permissionCds] },
  });
  return narrowObject<RoleGrants>(body, "permission_cds", "role grants");
}

/** Creates the Keycloak realm role and its row; 409 `role_exists` if the code is taken. */
export async function createRole(input: RoleCreateInput): Promise<RoleGrants> {
  const body = await icmsRequest(`${BASE}/roles`, { method: "POST", body: input });
  return narrowObject<RoleGrants>(body, "permission_cds", "role");
}

/** 204. Refused 409 `permission_is_system` for every seeded code, which is all of them. */
export async function deletePermission(permissionCd: string): Promise<void> {
  await icmsRequest(`${BASE}/permissions/${encodeURIComponent(permissionCd)}`, {
    method: "DELETE",
  });
}

/** Only permission_cd, requires, assignee_only, active and note. Sending `roles` is refused 422. */
export async function patchTransition(
  id: number,
  patch: TransitionPatch,
): Promise<PolicyTransition> {
  const body = await icmsRequest(`${BASE}/transitions/${String(id)}`, {
    method: "PATCH",
    body: patch,
  });
  return narrowObject<PolicyTransition>(body, "action_cd", "transition");
}
