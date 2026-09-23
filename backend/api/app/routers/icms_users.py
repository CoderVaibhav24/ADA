"""Officer administration, straight onto Keycloak.

Keycloak is the user store. There is no `icms_user` table and nothing is
mirrored into PostgreSQL: a second copy of "who exists" would be a second thing
to be wrong, and the token the browser already carries is minted from the first.

Two properties of that choice run through every handler here.

## Disable, never delete

Five ICMS columns hold a Keycloak subject — `icms_case.created_by`,
`icms_case_assignment.assignee_user_id`, `icms_evidence.uploaded_by`,
`icms_case_event.actor_user_id` and `icms_zone_assignment.user_id`. None is a
foreign key into Keycloak and none can be, so deleting an account does not fail
loudly; it silently orphans the audit trail behind a notice that has to stand up
in an enforcement context. An officer who has left is `enabled: false`: they
cannot sign in, and every row they wrote still names them. There is therefore no
DELETE on this router and no delete method on the admin client.

## Creation is three round trips and cannot be a transaction

Keycloak has no batch endpoint. The account, its roles and its credential are
separate calls, and the network can stop between any two. The order below makes
the half-states safe rather than pretending they cannot happen:

    resolve the realm roles  ->  create DISABLED  ->  assign roles
    ->  set the credential   ->  enable

The account is created disabled whatever the caller asked for, and enabling is
the last call. Every partial failure therefore leaves an officer who cannot sign
in, and the refusal names the username and id so an operator can finish or
remove it. Nothing is rolled back: the compensating action for "roles failed"
would be the delete this file refuses to have.

## The last Super Admin cannot be shut out

Two edits here can leave nobody able to reach this screen or the policy one:
taking `super-admin` off the last enabled account holding it, and disabling that
account. Both are refused 409 `user_lockout`, the sibling of `policy_lockout` in
`icms_admin.py`, and both are refused HERE rather than warned about in the
browser — `list_users` fetches no role mappings per row, so `UserRow` carries no
roles and a client cannot count who else holds the role. The count exists only
on the server.
"""

from __future__ import annotations

from typing import Annotated

from ada_core.datetimes import now_ist
from ada_platform import Principal
from fastapi import APIRouter, Depends, Path, Query

from ..clients.keycloak import (
    KeycloakAdmin,
    KeycloakConflict,
    KeycloakRejected,
    get_admin_client,
)
from ..errors import ApiError
from ..icms.collection import Page, PageResult
from ..icms.security import require_permission
from ..icms.user_schemas import (
    ASSIGNABLE_ROLES,
    KeycloakUserId,
    PasswordReset,
    PasswordResetOut,
    UserCreate,
    UserDetail,
    UserQuery,
    UserRolesUpdate,
    UserRow,
    UserUpdate,
    user_detail,
    user_row,
)

router = APIRouter(prefix="/icms", tags=["icms-users"])

UserIdPath = Annotated[
    KeycloakUserId,
    Path(description="The Keycloak subject — the same value ICMS rows store."),
]

# S105 is a false positive here: the value is a Keycloak required-action name.
UPDATE_PASSWORD = "UPDATE_PASSWORD"  # noqa: S105

# The role that reaches both administration screens, and so the one the guard
# below counts holders of.
SUPER_ADMIN = "super-admin"


@router.get(
    "/admin/users",
    response_model=Page[UserRow],
    summary="The officer register, read live from Keycloak",
)
def list_users(
    params: Annotated[UserQuery, Query()],
    user: Principal = Depends(require_permission("user.read")),
    admin: KeycloakAdmin = Depends(get_admin_client),
) -> Page[UserRow]:
    """Two calls: `/users` for the page and `/users/count` for the total.

    The count is Keycloak's own over the same search, not an estimate and not
    the length of the page — a register whose last page is unreachable because
    `total` was guessed is worse than one with no paging at all.
    """
    search = params.q or None
    total = admin.count_users(search=search)
    rows = admin.list_users(
        first=params.offset, max_results=params.limit, search=search
    )
    # No role mappings here on purpose: Keycloak returns none with a user list,
    # so carrying them would be one extra round trip per row. Roles are on detail.
    return Page[UserRow].of(
        [user_row(row) for row in rows],
        PageResult(rows=(), total=total, page=params.page, size=params.size,
                   sort="username"),
    )


@router.post(
    "/admin/users",
    response_model=UserDetail,
    status_code=201,
    summary="Create an officer — Super Admin only",
)
def create_user(
    body: UserCreate,
    user: Principal = Depends(require_permission("user.manage")),
    admin: KeycloakAdmin = Depends(get_admin_client),
) -> UserDetail:
    """Created disabled, enabled last. See the module docstring for why."""
    wanted = _resolve_roles(admin, body.realm_roles)

    payload = {
        "username": body.username,
        "email": body.email,
        "firstName": body.first_name or "",
        "lastName": body.last_name or "",
        # Not body.enabled: the account must not be signable-in until its roles
        # and credential are on it, and the last call below is what flips it.
        "enabled": False,
        "emailVerified": False,
    }
    try:
        user_id = admin.create_user(payload)
    except KeycloakConflict as exc:
        raise _already_taken(exc) from exc
    except KeycloakRejected as exc:
        raise ApiError(422, "identity_rejected", str(exc), field="username") from exc

    done: list[str] = ["the account was created"]
    try:
        admin.add_realm_roles(user_id, wanted)
        if wanted:
            done.append(f"roles assigned ({', '.join(sorted(body.realm_roles))})")

        if body.password is not None:
            # temporary=True makes Keycloak add UPDATE_PASSWORD itself, which is
            # why the read below happens after this call and not before it.
            admin.reset_password(
                user_id, body.password.get_secret_value(), temporary=True
            )
            done.append("a temporary password was set")

        # Read-modify-write, never a bare list: CONFIGURE_TOTP is a realm default
        # already on this account, and sending only UPDATE_PASSWORD removes it.
        representation = admin.get_user(user_id) or payload
        required = set(representation.get("requiredActions") or ())
        if body.password is None:
            required.add(UPDATE_PASSWORD)

        admin.update_user(
            user_id,
            {**representation, "enabled": body.enabled,
             "requiredActions": sorted(required)},
        )
    except KeycloakRejected as exc:
        raise ApiError(422, "identity_rejected", str(exc), field="password") from exc
    except ApiError as exc:
        raise _half_made(body.username, user_id, done) from exc

    return _detail(admin, user_id)


@router.get(
    "/admin/users/{user_id}",
    response_model=UserDetail,
    summary="One officer, with the ICMS roles they hold",
)
def get_user(
    user_id: UserIdPath,
    user: Principal = Depends(require_permission("user.read")),
    admin: KeycloakAdmin = Depends(get_admin_client),
) -> UserDetail:
    return _detail(admin, user_id)


@router.patch(
    "/admin/users/{user_id}",
    response_model=UserDetail,
    summary="Amend an officer's name, email or enabled flag — Super Admin only",
)
def update_user(
    user_id: UserIdPath,
    body: UserUpdate,
    user: Principal = Depends(require_permission("user.manage")),
    admin: KeycloakAdmin = Depends(get_admin_client),
) -> UserDetail:
    """`enabled: false` is how an officer leaves. There is no delete."""
    representation = admin.get_user(user_id)
    if representation is None:
        raise ApiError(404, "user_not_found", f"no officer {user_id}")

    changes = body.model_dump(exclude_unset=True)
    if changes.get("enabled") is False:
        _refuse_lockout(admin, user_id, field="enabled")

    merged = dict(representation)
    if "first_name" in changes:
        merged["firstName"] = changes["first_name"] or ""
    if "last_name" in changes:
        merged["lastName"] = changes["last_name"] or ""
    if changes.get("email") is not None:
        merged["email"] = changes["email"]
    if changes.get("enabled") is not None:
        merged["enabled"] = changes["enabled"]

    # Merged onto what Keycloak holds rather than sent as a patch: a PUT carrying
    # only the changed keys clears the user-profile attributes it omits.
    try:
        admin.update_user(user_id, merged)
    except KeycloakConflict as exc:
        raise _already_taken(exc) from exc
    except KeycloakRejected as exc:
        raise ApiError(422, "identity_rejected", str(exc), field="email") from exc

    return _detail(admin, user_id)


@router.put(
    "/admin/users/{user_id}/roles",
    response_model=UserDetail,
    summary="Replace an officer's ICMS roles — Super Admin only",
)
def set_user_roles(
    user_id: UserIdPath,
    body: UserRolesUpdate,
    user: Principal = Depends(require_permission("user.manage")),
    admin: KeycloakAdmin = Depends(get_admin_client),
) -> UserDetail:
    """The whole set, not a delta: add/remove deltas from two admins editing the
    same officer is how a revoked role comes back."""
    if admin.get_user(user_id) is None:
        raise ApiError(404, "user_not_found", f"no officer {user_id}")

    wanted = _resolve_roles(admin, body.realm_roles)
    wanted_names = {role["name"] for role in wanted}
    if SUPER_ADMIN not in wanted_names:
        _refuse_lockout(admin, user_id, field="realm_roles")

    # Only ICMS roles are touched. `default-roles-pcsmcpl` is what carries the
    # account's standard client scopes; stripping it breaks the login itself.
    current = admin.user_realm_roles(user_id)
    held = {role.get("name") for role in current}
    stale = [
        role for role in current
        if role.get("name") in ASSIGNABLE_ROLES and role["name"] not in wanted_names
    ]
    admin.remove_realm_roles(user_id, stale)
    admin.add_realm_roles(user_id, [r for r in wanted if r["name"] not in held])

    return _detail(admin, user_id)


@router.post(
    "/admin/users/{user_id}/reset-password",
    response_model=PasswordResetOut,
    summary="Set an officer's credential — Super Admin only",
)
def reset_password(
    user_id: UserIdPath,
    body: PasswordReset,
    user: Principal = Depends(require_permission("user.manage")),
    admin: KeycloakAdmin = Depends(get_admin_client),
) -> PasswordResetOut:
    """The answer carries no credential. Hand the one you sent over out of band."""
    representation = admin.get_user(user_id)
    if representation is None:
        raise ApiError(404, "user_not_found", f"no officer {user_id}")

    try:
        admin.reset_password(
            user_id, body.password.get_secret_value(), temporary=body.temporary
        )
    except KeycloakRejected as exc:
        raise ApiError(422, "identity_rejected", str(exc), field="password") from exc

    fresh = admin.get_user(user_id) or representation
    return PasswordResetOut(
        id=user_id,
        username=fresh.get("username", ""),
        temporary=body.temporary,
        required_actions=sorted(fresh.get("requiredActions") or ()),
        reset_at=now_ist(),
    )


# Refused rather than passed through: Keycloak would happily assign
# realm-management roles to an officer, and this endpoint is reachable by
# anybody holding user.manage.
def _resolve_roles(admin: KeycloakAdmin, names: list[str]) -> list[dict]:
    """The Keycloak representations of `names`, or a 422 naming what is allowed."""
    wanted = sorted(set(names))
    unknown = [name for name in wanted if name not in ASSIGNABLE_ROLES]
    if unknown:
        raise ApiError(
            422,
            "unknown_role",
            f"not an ICMS role: {', '.join(unknown)}",
            field="realm_roles",
            allowed=sorted(ASSIGNABLE_ROLES),
        )
    if not wanted:
        return []

    available = {role["name"]: role for role in admin.realm_roles()}
    missing = [name for name in wanted if name not in available]
    if missing:
        raise ApiError(
            503,
            "realm_role_missing",
            f"the realm does not declare {', '.join(missing)}; it is configured "
            "differently from what ICMS expects",
            field="realm_roles",
            allowed=sorted(available),
        )
    return [available[name] for name in wanted]


def _detail(admin: KeycloakAdmin, user_id: str) -> UserDetail:
    representation = admin.get_user(user_id)
    if representation is None:
        raise ApiError(404, "user_not_found", f"no officer {user_id}")
    return user_detail(representation, admin.user_realm_roles(user_id))


# One extra round trip, and only on the two edits that can cause the lockout:
# every other edit here skips it without asking Keycloak anything.
def _refuse_lockout(admin: KeycloakAdmin, user_id: str, *, field: str) -> None:
    """Refuses an edit that would leave no ENABLED account holding `super-admin`."""
    enabled = [
        row.get("id") for row in admin.role_members(SUPER_ADMIN) if row.get("enabled")
    ]
    # Somebody else can still sign in, or this account was never what was holding
    # the door open. A disabled holder is not a way back in and is not counted.
    if any(held != user_id for held in enabled) or user_id not in enabled:
        return
    raise ApiError(
        409,
        "user_lockout",
        "this is the last enabled account holding super-admin, and the change "
        "would leave nobody able to administer officers or the policy. Give "
        "another enabled officer the role first.",
        field=field,
        allowed=[SUPER_ADMIN],
    )


# Keycloak says which of the two collided in prose and nowhere else, so the
# field the form should highlight has to be read back out of the message.
def _already_taken(exc: KeycloakConflict) -> ApiError:
    message = str(exc)
    field = "email" if "email" in message.lower() else "username"
    return ApiError(
        409,
        "user_exists",
        f"that {field} already belongs to an account in this realm",
        field=field,
    )


def _half_made(username: str, user_id: str, done: list[str]) -> ApiError:
    """Names exactly what survived, because retrying will now collide on the username."""
    return ApiError(
        503,
        "user_partially_created",
        f"{username} exists in Keycloak as {user_id} and has been left DISABLED, "
        f"so nobody can sign in as it. Completed: {'; '.join(done)}. The identity "
        "service then stopped answering. Finish or remove the account in Keycloak — "
        "sending this form again will be refused as a duplicate username.",
    )
