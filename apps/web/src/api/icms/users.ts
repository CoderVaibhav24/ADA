/**
 * `/api/icms/admin/users/*` — officer administration, straight onto Keycloak.
 *
 * Written against `services/api/app/routers/icms_users.py` and
 * `services/api/app/icms/user_schemas.py`, which are binding on this file. Five
 * things in that contract a caller must not get wrong:
 *
 *   - **there is no delete, and there must never be one.** Five ICMS columns
 *     hold a Keycloak subject (`icms_case.created_by`,
 *     `icms_case_assignment.assignee_user_id`, `icms_evidence.uploaded_by`,
 *     `icms_case_event.actor_user_id`, `icms_zone_assignment.user_id`) and none
 *     is a foreign key into Keycloak, so removing an account does not fail
 *     loudly — it silently orphans the audit trail behind a notice that has to
 *     stand up in an enforcement context. An officer who has left is
 *     `enabled: false`. The router has no DELETE; nothing here should grow one.
 *   - **the role write REPLACES.** `PUT /admin/users/{id}/roles` carries the
 *     officer's COMPLETE ICMS role set, and there is no delta form on purpose:
 *     two admins patching the same officer with add/remove deltas is how a
 *     revoked role comes back from the dead. `setUserRoles` therefore takes
 *     every role the officer KEEPS, and the screen is a set editor, not a pair
 *     of grant/revoke buttons. The server only ever touches the four codes in
 *     `ASSIGNABLE_ROLES`; `default-roles-pcsmcpl` and `offline_access` are not
 *     ours to send and are refused with 422 `unknown_role`.
 *   - **creation is three round trips and cannot be a transaction.** Keycloak
 *     has no batch endpoint, so the account, its roles and its credential are
 *     separate calls. The router creates the account DISABLED whatever was
 *     asked and enables it last, so every partial failure leaves an officer who
 *     cannot sign in — answered as 503 `USER_PARTIALLY_CREATED`, whose message
 *     names the username and id. That refusal is NOT retryable: sending the
 *     same form again collides on the username. A screen must render it as its
 *     own outcome rather than as a generic failure.
 *   - **no response carries a credential.** `POST /reset-password` answers with
 *     the username, whether the credential was temporary, the resulting
 *     required actions and a timestamp — never the password. The password
 *     travels in a request body and nowhere else: never a query parameter,
 *     never a path segment, never a log line, never an echo back to the screen.
 *   - **the register carries no roles.** Keycloak returns no role mappings with
 *     a user list, so `UserRow` deliberately omits them rather than costing one
 *     extra round trip per row; roles arrive with `UserDetail`. There is
 *     consequently no role filter and no role column on the register, and no
 *     amount of client code can invent one.
 */

import type { components, operations } from "@ada/api-types/ada-api";
import { IcmsApiError, icmsRequest } from "./http";

/* ---- types: generated from ada-api's OpenAPI document (@ada/api-types) ---- */

type Schemas = components["schemas"];

/** One row of the officer register. No roles: see the note at the top. */
export type UserRow = Schemas["UserRow"];
/** The row plus the officer's ICMS roles and Keycloak required actions. */
export type UserDetail = Schemas["UserDetail"];
export type UserPage = Schemas["Page_UserRow_"];
/** `UserQuery`: page, size, q, sort — `CollectionParams` forbids extras. */
export type UserListQuery = NonNullable<
  operations["list_users_api_icms_admin_users_get"]["parameters"]["query"]
>;
/** The create body as it goes on the wire. Build it with `UserCreateInput`. */
export type UserCreateBody = Schemas["UserCreate"];
/** Only these four. `username` is not amendable and the body forbids extras. */
export type UserUpdate = Schemas["UserUpdate"];
export type UserRolesUpdate = Schemas["UserRolesUpdate"];
export type PasswordReset = Schemas["PasswordReset"];
/** Deliberately carries no credential — only that one was set, and when. */
export type PasswordResetOut = Schemas["PasswordResetOut"];

/* ---- vocabularies -------------------------------------------------------- */

/**
 * `user_schemas.ASSIGNABLE_ROLES`, in that file's own order rather than sorted.
 *
 * The four the realm declares and the only four this API will assign.
 * `default-roles-pcsmcpl` and `offline_access` sit on every account, are not
 * reported by `UserDetail`, and are refused by name if sent.
 */
export const ASSIGNABLE_ROLES = [
  "super-admin",
  "pcs-nodal-officer",
  "field-surveyor",
  "ada-project-lead",
] as const;

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

export function isAssignableRole(value: string): value is AssignableRole {
  return (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

/**
 * How the new account gets a credential.
 *
 * `update_password` sends none at all: Keycloak adds the `UPDATE_PASSWORD`
 * required action and the officer chooses their own at first sign-in, so no
 * credential is ever handled by this portal. `temporary_password` requires one
 * in the body, which Keycloak stores as temporary — the officer must still
 * replace it — and it has to be handed over out of band.
 */
export const CREDENTIAL_CHOICES = ["update_password", "temporary_password"] as const;

export type CredentialChoice = (typeof CREDENTIAL_CHOICES)[number];

/** The required action both credential flows end in, spelled as Keycloak spells it. */
export const UPDATE_PASSWORD = "UPDATE_PASSWORD";

/** The realm's password policy, mirrored so a short one is a field message, not a 422. */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

/** `Username` in `user_schemas.py`: lower-cased, 3–64, first character alphanumeric. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._@-]{2,63}$/;

/**
 * Looser than `ada_core.validation.Email` on purpose.
 *
 * The server's pattern is the one that decides; this only catches the obvious
 * miss early enough to put a message under the input instead of round-tripping
 * a 422. Anything this admits and the server refuses comes back as
 * `identity_rejected` with `field: "email"`, which lands on the same input.
 */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** `PageParams.size` is refused above the cap server-side, not clamped. */
export const MAX_PAGE_SIZE = 200;

/* ---- permissions and error codes ----------------------------------------- */

/**
 * The two codes that gate this area, both seeded by migration 0003 and held by
 * `super-admin` alone today.
 *
 * `user.read` guards the list and the detail; `user.manage` guards create,
 * amend, the role replacement and the password reset. Read from
 * `/me/capabilities` to decide which controls are drawn; `require_permission`
 * decides every request again regardless.
 */
export const USER_READ = "user.read";
export const USER_MANAGE = "user.manage";

/* The refusals that mean something specific to a screen. Anything else is
   rendered from `error.message` as it arrives. */

/** 409, `field` is `username` or `email` — read back out of Keycloak's prose. */
export const USER_EXISTS = "user_exists";
/** 404 from every route that takes a `{user_id}`. */
export const USER_NOT_FOUND = "user_not_found";
/** 422 on `realm_roles`; `allowed` carries the four that are legal. */
export const UNKNOWN_ROLE = "unknown_role";
/** 503: the realm is configured differently from what ICMS expects. */
export const REALM_ROLE_MISSING = "realm_role_missing";
/** 422 from Keycloak's own validation; `field` names the input to highlight. */
export const IDENTITY_REJECTED = "identity_rejected";
/**
 * 503, and NOT retryable: the account exists and is disabled, so re-sending the
 * form is refused as a duplicate username. The message names what survived.
 */
export const USER_PARTIALLY_CREATED = "user_partially_created";

const BASE = "/api/icms/admin/users";

/* ---- shape guards --------------------------------------------------------
   One per endpoint, same reason as `policy.ts`: a proxy error page or a
   contract change must be a thrown error at the boundary rather than a table
   of `undefined`. -------------------------------------------------------- */

function malformed(what: string): IcmsApiError {
  return new IcmsApiError(200, {
    code: "malformed_response",
    message: `The ${what} response did not have the expected shape.`,
  });
}

function narrowDetail(body: unknown): UserDetail {
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).id !== "string" ||
    !Array.isArray((body as Record<string, unknown>).realm_roles)
  ) {
    throw malformed("officer");
  }
  return body as UserDetail;
}

function narrowPage(body: unknown): UserPage {
  if (typeof body !== "object" || body === null) throw malformed("officer register");
  const page = body as Record<string, unknown>;
  if (
    !Array.isArray(page.items) ||
    typeof page.page !== "number" ||
    typeof page.size !== "number" ||
    typeof page.total !== "number" ||
    typeof page.pages !== "number"
  ) {
    throw malformed("officer register");
  }
  return body as UserPage;
}

function narrowReset(body: unknown): PasswordResetOut {
  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).reset_at !== "string"
  ) {
    throw malformed("password reset");
  }
  return body as PasswordResetOut;
}

/* ---- reads --------------------------------------------------------------- */

/** `GET /admin/users` — Keycloak's own count over the same search, not an estimate. */
export async function listUsers(
  query: UserListQuery,
  signal: AbortSignal,
): Promise<UserPage> {
  return narrowPage(await icmsRequest(BASE, { query, signal }));
}

/** `GET /admin/users/{id}` — the only place an officer's roles are reported. */
export async function getUser(userId: string, signal: AbortSignal): Promise<UserDetail> {
  return narrowDetail(
    await icmsRequest(`${BASE}/${encodeURIComponent(userId)}`, { signal }),
  );
}

/* ---- writes -------------------------------------------------------------- */

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * What a create form holds, shaped so the 422 cannot be built.
 *
 * `password` exists only on the temporary branch: the server refuses a password
 * sent with `update_password` and refuses its absence with `temporary_password`,
 * and a union makes both states unrepresentable rather than merely unlikely.
 */
export type UserCreateInput = {
  username: string;
  email: string;
  firstName?: string;
  lastName?: string;
  enabled: boolean;
  /** The complete set the new officer starts with. Empty is legal and visible. */
  realmRoles: readonly string[];
} & (
  | { credential: "update_password" }
  | { credential: "temporary_password"; password: string }
);

/** 201. Created disabled and enabled last, so a partial failure cannot sign in. */
export async function createUser(input: UserCreateInput): Promise<UserDetail> {
  const body: UserCreateBody = {
    username: input.username,
    email: input.email,
    // `Name` is min_length=1, so a blank has to go as null. An empty string is
    // a 422 on a field the officer deliberately left empty.
    first_name: blankToNull(input.firstName),
    last_name: blankToNull(input.lastName),
    enabled: input.enabled,
    realm_roles: [...input.realmRoles],
    credential: input.credential,
    ...(input.credential === "temporary_password" ? { password: input.password } : {}),
  };
  return narrowDetail(await icmsRequest(BASE, { method: "POST", body }));
}

/** PATCH. An empty patch is a 422, so callers send only what actually changed. */
export async function updateUser(userId: string, patch: UserUpdate): Promise<UserDetail> {
  return narrowDetail(
    await icmsRequest(`${BASE}/${encodeURIComponent(userId)}`, {
      method: "PATCH",
      body: patch,
    }),
  );
}

/** Replaces the officer's whole ICMS role set — callers send every role they KEEP. */
export async function setUserRoles(
  userId: string,
  realmRoles: readonly string[],
): Promise<UserDetail> {
  const body: UserRolesUpdate = { realm_roles: [...realmRoles] };
  return narrowDetail(
    await icmsRequest(`${BASE}/${encodeURIComponent(userId)}/roles`, {
      method: "PUT",
      body,
    }),
  );
}

/** Sets a credential. The answer carries none; hand yours over out of band. */
export async function resetPassword(
  userId: string,
  body: PasswordReset,
): Promise<PasswordResetOut> {
  return narrowReset(
    await icmsRequest(`${BASE}/${encodeURIComponent(userId)}/reset-password`, {
      method: "POST",
      body,
    }),
  );
}
