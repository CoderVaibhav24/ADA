/**
 * The policy area's data layer.
 *
 * Same shape as `features/complaints/useCases.ts`: TanStack Query, an
 * `AbortSignal` through to `fetch`, and no retry on a 4xx because a 403 is a
 * verdict rather than a blip.
 *
 * Two rules specific to this area:
 *
 *   - **every write invalidates the capabilities query.** The signed-in admin
 *     can revoke their own `policy.manage`; if the rail and the buttons kept
 *     rendering from a stale capability set, the screen would keep offering
 *     controls the next request refuses.
 *   - **the matrix save is one request per changed role.** `PUT
 *     /roles/{role_cd}/permissions` replaces that role's whole grant list, so
 *     `useSaveRoleGrants` walks the changed roles in order and stops at the
 *     first refusal — which is what makes a 409 `policy_lockout` attributable
 *     to one named role instead of to "the save".
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { IcmsApiError } from "@/api/icms/http";
import {
  POLICY_MANAGE,
  POLICY_READ,
  type Capabilities,
  type PolicyPermission,
  type PolicyTransition,
  type RoleGrants,
  type TransitionPatch,
  deletePermission,
  fetchCapabilities,
  listPermissions,
  listRoleGrants,
  listTransitions,
  patchTransition,
  putRoleGrants,
} from "@/api/icms/policy";

export const CAPABILITIES_KEY = ["icms", "capabilities"] as const;
const PERMISSIONS_KEY = ["icms", "policy", "permissions"] as const;
const ROLE_GRANTS_KEY = ["icms", "policy", "role-grants"] as const;
const TRANSITIONS_KEY = ["icms", "policy", "transitions"] as const;

/** A 4xx is a verdict. Retrying a 403 only asks the server to refuse again. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof IcmsApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

/**
 * The signed-in officer's own capabilities.
 *
 * `advisory: true` is in the payload for a reason: this decides which controls
 * are drawn and nothing else. Every request is decided again server-side.
 */
export function useCapabilities() {
  return useQuery<Capabilities, Error>({
    queryKey: CAPABILITIES_KEY,
    queryFn: ({ signal }) => fetchCapabilities(signal),
    // Short: a colleague can change this officer's grants at any moment, and
    // the cost is one small request.
    staleTime: 30_000,
    retry: shouldRetry,
  });
}

export type CapabilityGate = {
  loading: boolean;
  /** True only once capabilities have actually answered. Never optimistic. */
  canRead: boolean;
  canManage: boolean;
  permissions: readonly string[];
  policyRevision: number | null;
  policySource: string | null;
  /** The area is unreachable and we know why — a refusal, not a network blip. */
  refused: IcmsApiError | null;
};

/** What the rail, the route guard and every write control read. */
export function useCapabilityGate(): CapabilityGate {
  const { data, isPending, error } = useCapabilities();
  const permissions = data?.permissions ?? [];
  return {
    loading: isPending,
    canRead: permissions.includes(POLICY_READ),
    canManage: permissions.includes(POLICY_MANAGE),
    permissions,
    policyRevision: data?.policy_revision ?? null,
    policySource: data?.policy_source ?? null,
    refused:
      error instanceof IcmsApiError && (error.status === 401 || error.status === 403)
        ? error
        : null,
  };
}

export function usePermissionCatalogue() {
  return useQuery<PolicyPermission[], Error>({
    queryKey: PERMISSIONS_KEY,
    queryFn: ({ signal }) => listPermissions(signal),
    staleTime: 60_000,
    retry: shouldRetry,
  });
}

export function useRoleGrants() {
  return useQuery<RoleGrants[], Error>({
    queryKey: ROLE_GRANTS_KEY,
    queryFn: ({ signal }) => listRoleGrants(signal),
    staleTime: 60_000,
    retry: shouldRetry,
  });
}

export function useTransitions() {
  return useQuery<PolicyTransition[], Error>({
    queryKey: TRANSITIONS_KEY,
    queryFn: ({ signal }) => listTransitions(signal),
    staleTime: 60_000,
    retry: shouldRetry,
  });
}

/** One role's complete grant list, as the PUT body wants it. */
export type RoleGrantWrite = { roleCd: string; permissionCds: readonly string[] };

/**
 * A partial matrix save.
 *
 * Carries the roles that DID land, because the screen has to mark their
 * checkboxes saved and leave only the refused role dirty. Losing that
 * distinction is how an admin re-sends a write that already succeeded.
 */
export class RoleGrantSaveError extends Error {
  readonly saved: readonly string[];
  readonly roleCd: string;
  readonly reason: IcmsApiError | Error;

  constructor(saved: readonly string[], roleCd: string, reason: IcmsApiError | Error) {
    super(reason.message);
    this.name = "RoleGrantSaveError";
    this.saved = saved;
    this.roleCd = roleCd;
    this.reason = reason;
  }
}

export type PolicyWriteResult = {
  /** Roles whose grants were replaced, in the order they were sent. */
  savedRoles: readonly string[];
};

// Invalidating capabilities alongside the policy queries is not optional — see
// the note at the top of this file.
function useInvalidatePolicy(): () => Promise<void> {
  const client = useQueryClient();
  return useCallback(async () => {
    await Promise.all([
      client.invalidateQueries({ queryKey: ["icms", "policy"] }),
      client.invalidateQueries({ queryKey: CAPABILITIES_KEY }),
    ]);
  }, [client]);
}

/** Sequential on purpose: a refusal has to name the role that caused it. */
export function useSaveRoleGrants() {
  const invalidate = useInvalidatePolicy();
  return useMutation<PolicyWriteResult, RoleGrantSaveError, readonly RoleGrantWrite[]>({
    mutationFn: async (writes) => {
      const savedRoles: string[] = [];
      for (const write of writes) {
        try {
          await putRoleGrants(write.roleCd, write.permissionCds);
        } catch (cause) {
          throw new RoleGrantSaveError(
            savedRoles,
            write.roleCd,
            cause instanceof Error ? cause : new Error(String(cause)),
          );
        }
        savedRoles.push(write.roleCd);
      }
      return { savedRoles };
    },
    // Runs on success AND on a partial failure: the roles that landed before
    // the refusal are already committed server-side.
    onSettled: () => invalidate(),
  });
}

export function useDeletePermission() {
  const invalidate = useInvalidatePolicy();
  return useMutation<void, Error, string>({
    mutationFn: (permissionCd) => deletePermission(permissionCd),
    onSettled: () => invalidate(),
  });
}

export function usePatchTransition() {
  const invalidate = useInvalidatePolicy();
  return useMutation<PolicyTransition, Error, { id: number; patch: TransitionPatch }>({
    mutationFn: ({ id, patch }) => patchTransition(id, patch),
    onSettled: () => invalidate(),
  });
}
