/**
 * The officer-administration data layer.
 *
 * Same shape as `features/policy/usePolicy.ts`: TanStack Query, an
 * `AbortSignal` through to `fetch`, and no retry on a 4xx because a 403 is a
 * verdict rather than a blip. Three rules are specific to this area.
 *
 * ## A credential is never a value the query client holds
 *
 * `useMutation` keeps its `variables` on the mutation object until the mutation
 * is reset, and the devtools render them. A temporary password sitting there is
 * a credential in a place nobody thought to look at, so the two calls that
 * carry one — create with `temporary_password`, and the password reset — are
 * plain async submits with local status state instead. Everything else is a
 * mutation. `PasswordResetOut` carries no credential either, so nothing that
 * comes back can leak one.
 *
 * ## Every write invalidates the capabilities query
 *
 * An admin can replace their OWN role set, and `super-admin` is the only role
 * holding `user.manage`. If the rail and the buttons kept rendering from a
 * stale capability set the screen would go on offering controls the next
 * request refuses. `/me/capabilities` is queried through
 * `features/policy/usePolicy`, not re-declared here, so both areas share one
 * cache entry and one request — the hook is not policy-specific, it simply
 * lives there for now.
 *
 * ## The role write replaces, so it is never optimistic
 *
 * `PUT /roles` sends the complete set. Nothing leaves the browser until Save is
 * pressed, and the answer — a fresh `UserDetail` — is what the screen then
 * shows, because the server's copy decides who may sign in where.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { IcmsApiError } from "@/api/icms/http";
import {
  USER_MANAGE,
  USER_READ,
  type PasswordResetOut,
  type UserCreateInput,
  type UserDetail,
  type UserListQuery,
  type UserPage,
  type UserUpdate,
  createUser,
  getUser,
  listUsers,
  resetPassword,
  setUserRoles,
  updateUser,
} from "@/api/icms/users";
import { CAPABILITIES_KEY, useCapabilities } from "@/features/policy/usePolicy";

const USERS_KEY = ["icms", "users"] as const;
const LIST_KEY = ["icms", "users", "list"] as const;

export function userDetailKey(userId: string): readonly unknown[] {
  return ["icms", "users", "detail", userId];
}

/** A 4xx is a verdict. Retrying a 403 only asks the server to refuse again. */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof IcmsApiError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export type UserGate = {
  loading: boolean;
  /** True only once capabilities have actually answered. Never optimistic. */
  canRead: boolean;
  canManage: boolean;
  /** The signed-in officer's own Keycloak subject, for the self-edit warnings. */
  selfUserId: string | null;
  /** The area is unreachable and we know why — a refusal, not a network blip. */
  refused: IcmsApiError | null;
};

/** What the render-level guard and every write control on this screen read. */
export function useUserGate(): UserGate {
  const { data, isPending, error } = useCapabilities();
  const permissions = data?.permissions ?? [];
  return {
    loading: isPending,
    canRead: permissions.includes(USER_READ),
    canManage: permissions.includes(USER_MANAGE),
    selfUserId: data?.user_id ?? null,
    refused:
      error instanceof IcmsApiError && (error.status === 401 || error.status === 403)
        ? error
        : null,
  };
}

/** `placeholderData` keeps the previous page on screen while the next one loads. */
export function useUserList(query: UserListQuery) {
  return useQuery<UserPage, Error>({
    queryKey: [...LIST_KEY, query],
    queryFn: ({ signal }) => listUsers(query, signal),
    // Short: a colleague can disable an account at any moment, and the register
    // is the screen an admin opens precisely when they suspect that happened.
    staleTime: 15_000,
    placeholderData: (previous) => previous,
    retry: shouldRetry,
  });
}

/** Disabled until a row is actually open, so the register costs one request. */
export function useUserDetail(userId: string | null) {
  return useQuery<UserDetail, Error>({
    queryKey: userDetailKey(userId ?? ""),
    queryFn: ({ signal }) => getUser(userId ?? "", signal),
    enabled: userId !== null,
    staleTime: 15_000,
    retry: shouldRetry,
  });
}

// Capabilities go with it every time — see the note at the top of this file.
function useInvalidateUsers(): (userId?: string) => Promise<void> {
  const client = useQueryClient();
  return useCallback(
    async (userId?: string) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: USERS_KEY }),
        client.invalidateQueries({ queryKey: CAPABILITIES_KEY }),
        userId === undefined
          ? Promise.resolve()
          : client.invalidateQueries({ queryKey: userDetailKey(userId) }),
      ]);
    },
    [client],
  );
}

/** Only the keys that actually changed: an empty PATCH is a 422, not a no-op. */
export function useUpdateUser() {
  const invalidate = useInvalidateUsers();
  return useMutation<UserDetail, Error, { userId: string; patch: UserUpdate }>({
    mutationFn: ({ userId, patch }) => updateUser(userId, patch),
    onSettled: (_data, _error, variables) => invalidate(variables.userId),
  });
}

/** The COMPLETE role set the officer keeps, never a delta. */
export function useSetUserRoles() {
  const invalidate = useInvalidateUsers();
  return useMutation<UserDetail, Error, { userId: string; realmRoles: readonly string[] }>({
    mutationFn: ({ userId, realmRoles }) => setUserRoles(userId, realmRoles),
    onSettled: (_data, _error, variables) => invalidate(variables.userId),
  });
}

/** The status of a hand-rolled submit — the shape the two credential calls return. */
export type Submit<TArgs extends unknown[], TResult> = {
  submit: (...args: TArgs) => Promise<TResult | null>;
  pending: boolean;
  error: Error | null;
  result: TResult | null;
  reset: () => void;
};

// Not `useMutation`: its `variables` would retain the password until reset.
function useSubmit<TArgs extends unknown[], TResult>(
  run: (...args: TArgs) => Promise<TResult>,
  after: (result: TResult) => Promise<void>,
): Submit<TArgs, TResult> {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [result, setResult] = useState<TResult | null>(null);

  const submit = useCallback(
    async (...args: TArgs) => {
      setPending(true);
      setError(null);
      try {
        const answer = await run(...args);
        setResult(answer);
        await after(answer);
        return answer;
      } catch (cause) {
        setError(cause instanceof Error ? cause : new Error(String(cause)));
        return null;
      } finally {
        setPending(false);
      }
    },
    [run, after],
  );

  const reset = useCallback(() => {
    setError(null);
    setResult(null);
  }, []);

  return { submit, pending, error, result, reset };
}

/** 201, or a 503 `user_partially_created` that must not be retried. */
export function useCreateUser(): Submit<[UserCreateInput], UserDetail> {
  const invalidate = useInvalidateUsers();
  const after = useCallback(
    async (created: UserDetail) => {
      await invalidate(created.id);
    },
    [invalidate],
  );
  return useSubmit(createUser, after);
}

export type PasswordResetArgs = {
  userId: string;
  password: string;
  temporary: boolean;
};

/** The answer names the officer and the required actions, never the credential. */
export function useResetPassword(): Submit<[PasswordResetArgs], PasswordResetOut> {
  const invalidate = useInvalidateUsers();
  const run = useCallback(
    ({ userId, password, temporary }: PasswordResetArgs) =>
      resetPassword(userId, { password, temporary }),
    [],
  );
  const after = useCallback(
    async (answer: PasswordResetOut) => {
      await invalidate(answer.id);
    },
    [invalidate],
  );
  return useSubmit(run, after);
}
