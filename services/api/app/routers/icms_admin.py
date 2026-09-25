"""The policy surface: what the signed-in officer may do, and editing the rules.

Every write here bumps `icms_policy_revision` and issues `NOTIFY icms_policy` in
the same transaction as the change, then reloads this worker. A revision raised
outside the transaction that carried the edit is how workers come to cache a
policy that never existed.
"""

from __future__ import annotations

from typing import Annotated, Literal

import sqlalchemy as sa
from ada_core.database import get_db
from ada_core.datetimes import IstDateTime
from ada_core.models_icms import (
    Permission,
    PolicyRole,
    RolePermission,
    WorkflowTransition,
)
from ada_platform import Principal
from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy.orm import Session

from ..clients.keycloak import KeycloakAdmin, KeycloakConflict, get_admin_client
from ..errors import ApiError
from ..icms import policy, runtime_settings
from ..icms.security import (
    ZoneScope,
    icms_roles,
    require_icms_user,
    require_permission,
    zone_scope,
)
from ..icms.workflow import TRANSITIONS

router = APIRouter(prefix="/icms", tags=["icms-policy"])

Code = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=64,
                      pattern=r"^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$"),
]
RoleCode = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=40,
                      pattern=r"^[a-z][a-z0-9-]*$"),
]


class ActionOut(BaseModel):
    action: str
    permission: str
    source_status: str | None
    target_status: str
    stage_no: int
    assignee_only: bool
    opens_round: bool
    requires: list[str]


class CapabilitiesOut(BaseModel):
    user_id: str
    roles: list[str]
    permissions: list[str]
    zone_ids: list[int]
    unrestricted: bool
    actions: list[ActionOut]
    policy_revision: int
    policy_source: str
    advisory: Literal[True] = True


class PermissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    permission_cd: str
    resource: str
    action: str
    label: str
    is_system: bool
    screen_cd: str | None = None


class RoleGrantsOut(BaseModel):
    role_cd: str
    label: str
    active: bool
    permission_cds: list[str]


# Realm roles Keycloak or the workflow already own; a created role may not take their name.
RESERVED_ROLES = frozenset({"public", "offline_access", "uma_authorization", "admin"})


class RoleCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role_cd: RoleCode = Field(description="The realm role name, e.g. zone-inspector.")
    label: Annotated[str, StringConstraints(strip_whitespace=True, min_length=2, max_length=80)]
    label_hi: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)
    ] | None = None
    description: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=300)] | None
    ) = None
    permission_cds: list[Code] = Field(default_factory=list)


class AssignableRoleOut(BaseModel):
    role_cd: str
    label: str
    label_hi: str | None
    description: str | None


class RoleGrantsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    permission_cds: list[Code] = Field(description="The complete grant set for this role.")


class TransitionOut(BaseModel):
    id: int
    action_cd: str
    source_status: str | None
    target_status: str
    stage_no: int
    assignee_only: bool
    opens_round: bool
    requires: list[str]
    permission_cd: str
    roles: list[str] = Field(description="Derived: the active roles granted permission_cd.")
    active: bool
    sort_order: int
    note: str | None


class TransitionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    permission_cd: Code | None = None
    requires: list[Code] | None = None
    assignee_only: bool | None = None
    active: bool | None = None
    note: str | None = Field(default=None, max_length=2000)


# Advisory only. It is what the browser renders buttons from; every answer it
# gives is decided again server-side, so a tampered response buys nothing.
@router.get(
    "/me/capabilities",
    response_model=CapabilitiesOut,
    summary="What the signed-in officer may do — a convenience, not a control",
)
def my_capabilities(
    user: Principal = Depends(require_icms_user),
    scope: ZoneScope = Depends(zone_scope),
) -> CapabilitiesOut:
    """Their own roles, resolved permissions, zones and actions. Never anyone else's."""
    snapshot = policy.snapshot()
    roles = sorted(frozenset(user.roles) & icms_roles())
    held = snapshot.permitted(roles)
    return CapabilitiesOut(
        user_id=user.subject,
        roles=roles,
        permissions=sorted(snapshot.permitted(roles)),
        zone_ids=sorted(scope.zone_ids),
        unrestricted=scope.unrestricted,
        actions=[
            ActionOut(
                action=str(t.action),
                permission=t.permission,
                source_status=None if t.source is None else str(t.source),
                target_status=str(t.target),
                stage_no=t.stage_no,
                assignee_only=t.assignee_only,
                opens_round=t.opens_round,
                requires=list(t.requires),
            )
            for t in snapshot.transitions
            if t.permission in held
        ],
        policy_revision=snapshot.revision,
        policy_source=snapshot.source,
    )


@router.get(
    "/admin/policy/permissions",
    response_model=list[PermissionOut],
    summary="Every permission an endpoint guards on",
)
def list_permissions(
    user: Principal = Depends(require_permission("policy.read")),
    db: Session = Depends(get_db),
) -> list[PermissionOut]:
    rows = db.execute(
        sa.select(Permission).order_by(Permission.resource, Permission.action)
    ).scalars().all()
    return [PermissionOut.model_validate(row) for row in rows]


@router.get(
    "/admin/policy/roles",
    response_model=list[RoleGrantsOut],
    summary="The role grants — this table is the whole of RBAC",
)
def list_role_grants(
    user: Principal = Depends(require_permission("policy.read")),
    db: Session = Depends(get_db),
) -> list[RoleGrantsOut]:
    roles = db.execute(sa.select(PolicyRole).order_by(PolicyRole.sort_order)).scalars().all()
    granted: dict[str, list[str]] = {}
    for role_cd, permission_cd in db.execute(
        sa.select(RolePermission.role_cd, RolePermission.permission_cd)
    ).all():
        granted.setdefault(role_cd, []).append(permission_cd)
    return [
        RoleGrantsOut(
            role_cd=role.role_cd,
            label=role.label,
            active=role.active,
            permission_cds=sorted(granted.get(role.role_cd, ())),
        )
        for role in roles
    ]


# The roles an officer can be given, for the Officers screen; `user.read`, not
# `policy.read`, because that screen must not need the policy area to draw a picker.
@router.get(
    "/admin/roles",
    response_model=list[AssignableRoleOut],
    summary="The roles an officer can be given",
)
def list_assignable_roles(
    user: Principal = Depends(require_permission("user.read")),
    db: Session = Depends(get_db),
) -> list[AssignableRoleOut]:
    ours = icms_roles()
    rows = db.execute(
        sa.select(PolicyRole)
        .where(PolicyRole.active.is_(True))
        .order_by(PolicyRole.sort_order, PolicyRole.role_cd)
    ).scalars().all()
    return [
        AssignableRoleOut(
            role_cd=row.role_cd, label=row.label, label_hi=row.label_hi,
            description=row.description,
        )
        for row in rows
        if row.role_cd in ours
    ]


# Keycloak first, then the table: a realm role without a row grants nothing, and
# a retry adopts it, whereas a row without a realm role could be granted to nobody.
@router.post(
    "/admin/policy/roles",
    response_model=RoleGrantsOut,
    status_code=201,
    summary="Create a role: a Keycloak realm role plus its grants",
)
def create_role(
    body: RoleCreate,
    user: Principal = Depends(require_permission("policy.manage")),
    db: Session = Depends(get_db),
    admin: KeycloakAdmin = Depends(get_admin_client),
) -> RoleGrantsOut:
    role_cd = body.role_cd
    if role_cd in RESERVED_ROLES or role_cd.startswith("default-roles-") or len(role_cd) < 3:
        raise ApiError(422, "role_code_reserved", f"{role_cd} cannot be used", field="role_cd")
    if db.get(PolicyRole, role_cd) is not None:
        raise ApiError(409, "role_exists", f"role {role_cd} already exists", field="role_cd")

    known = frozenset(db.execute(sa.select(Permission.permission_cd)).scalars().all())
    wanted = frozenset(body.permission_cds)
    unknown = wanted - known
    if unknown:
        raise ApiError(
            422,
            "unknown_permission",
            f"no such permission: {', '.join(sorted(unknown))}",
            field="permission_cds",
            allowed=sorted(known),
        )

    if admin.realm_role(role_cd) is None:
        try:
            admin.create_realm_role(role_cd, body.description or body.label)
        except KeycloakConflict:
            pass

    last = db.execute(sa.select(sa.func.max(PolicyRole.sort_order))).scalar_one_or_none() or 0
    try:
        db.add(PolicyRole(
            role_cd=role_cd, label=body.label, label_hi=body.label_hi,
            description=body.description, is_system=False, active=True,
            sort_order=last + 10,
        ))
        db.flush()
        if wanted:
            db.execute(
                sa.insert(RolePermission),
                [
                    {"role_cd": role_cd, "permission_cd": code, "granted_by": user.subject}
                    for code in sorted(wanted)
                ],
            )
        policy.bump(db, actor=user.subject)
        db.commit()
    except Exception:
        db.rollback()
        raise
    policy.reload(db)
    return RoleGrantsOut(
        role_cd=role_cd, label=body.label, active=True, permission_cds=sorted(wanted),
    )


# Replaces the set outright rather than patching it: two admins editing the same
# role with add/remove deltas is how a grant comes back from the dead.
@router.put(
    "/admin/policy/roles/{role_cd}/permissions",
    response_model=RoleGrantsOut,
    summary="Replace a role's permission grants",
)
def set_role_grants(
    role_cd: Annotated[RoleCode, Path()],
    body: RoleGrantsUpdate,
    user: Principal = Depends(require_permission("policy.manage")),
    db: Session = Depends(get_db),
) -> RoleGrantsOut:
    role = db.get(PolicyRole, role_cd)
    if role is None:
        raise ApiError(404, "role_not_found", f"no role {role_cd}")

    known = frozenset(db.execute(sa.select(Permission.permission_cd)).scalars().all())
    wanted = frozenset(body.permission_cds)
    unknown = wanted - known
    if unknown:
        raise ApiError(
            422,
            "unknown_permission",
            f"no such permission: {', '.join(sorted(unknown))}",
            field="permission_cds",
            allowed=sorted(known),
        )
    _refuse_lockout(db, role_cd, wanted)

    try:
        db.execute(sa.delete(RolePermission).where(RolePermission.role_cd == role_cd))
        if wanted:
            db.execute(
                sa.insert(RolePermission),
                [
                    {"role_cd": role_cd, "permission_cd": code, "granted_by": user.subject}
                    for code in sorted(wanted)
                ],
            )
        policy.bump(db, actor=user.subject)
        db.commit()
    except Exception:
        db.rollback()
        raise
    policy.reload(db)
    return RoleGrantsOut(
        role_cd=role_cd, label=role.label, active=role.active,
        permission_cds=sorted(wanted),
    )


# The one edit that can lock every officer out of the policy screen, so it is
# the one edit that is refused rather than logged.
def _refuse_lockout(db: Session, role_cd: str, wanted: frozenset[str]) -> None:
    if "policy.manage" in wanted:
        return
    others = db.execute(
        sa.select(sa.func.count())
        .select_from(RolePermission)
        .join(PolicyRole, PolicyRole.role_cd == RolePermission.role_cd)
        .where(
            RolePermission.permission_cd == "policy.manage",
            RolePermission.role_cd != role_cd,
            PolicyRole.active.is_(True),
        )
    ).scalar_one()
    if others == 0:
        raise ApiError(
            409,
            "policy_lockout",
            "this would leave no active role able to change the policy",
            field="permission_cds",
            allowed=["policy.manage"],
        )


# Seeded permissions are named by an endpoint in source. Deleting one would not
# remove the guard, it would only make the guard unsatisfiable.
@router.delete(
    "/admin/policy/permissions/{permission_cd}",
    status_code=204,
    summary="Delete a non-system permission",
)
def delete_permission(
    permission_cd: Annotated[Code, Path()],
    user: Principal = Depends(require_permission("policy.manage")),
    db: Session = Depends(get_db),
) -> None:
    row = db.get(Permission, permission_cd)
    if row is None:
        raise ApiError(404, "permission_not_found", f"no permission {permission_cd}")
    if row.is_system:
        raise ApiError(
            409,
            "permission_is_system",
            f"{permission_cd} is named by an endpoint in source and cannot be deleted",
            field="permission_cd",
        )
    try:
        db.execute(
            sa.delete(RolePermission).where(RolePermission.permission_cd == permission_cd)
        )
        db.execute(sa.delete(Permission).where(Permission.permission_cd == permission_cd))
        policy.bump(db, actor=user.subject)
        db.commit()
    except Exception:
        db.rollback()
        raise
    policy.reload(db)


@router.get(
    "/admin/policy/transitions",
    response_model=list[TransitionOut],
    summary="The case state machine as the database holds it",
)
def list_transitions(
    user: Principal = Depends(require_permission("policy.read")),
    db: Session = Depends(get_db),
) -> list[TransitionOut]:
    rows = db.execute(
        sa.select(WorkflowTransition)
        .order_by(WorkflowTransition.sort_order, WorkflowTransition.id)
    ).scalars().all()
    holders = _holders(db)
    return [_transition_out(row, holders) for row in rows]


# Which permission, what the payload must carry and whether the row is live are
# operational. The action, the two statuses and the stage are what the product
# means by a stage, so they are not editable here at all.
@router.patch(
    "/admin/policy/transitions/{transition_id}",
    response_model=TransitionOut,
    summary="Edit a transition's permission, payload requirements or active flag",
)
def update_transition(
    transition_id: int,
    body: TransitionUpdate,
    user: Principal = Depends(require_permission("policy.manage")),
    db: Session = Depends(get_db),
) -> TransitionOut:
    row = db.get(WorkflowTransition, transition_id)
    if row is None:
        raise ApiError(404, "transition_not_found", f"no transition {transition_id}")

    changes = body.model_dump(exclude_unset=True)
    if changes.get("permission_cd", "") is None:
        del changes["permission_cd"]
    if "permission_cd" in changes:
        known = frozenset(db.execute(sa.select(Permission.permission_cd)).scalars().all())
        if changes["permission_cd"] not in known:
            raise ApiError(
                422,
                "unknown_permission",
                f"no such permission: {changes['permission_cd']}",
                field="permission_cd",
                allowed=sorted(known),
            )

    try:
        if changes:
            db.execute(
                sa.update(WorkflowTransition)
                .where(WorkflowTransition.id == transition_id)
                .values(**changes, updated_by=user.subject)
            )
        policy.bump(db, actor=user.subject)
        db.commit()
    except Exception:
        db.rollback()
        raise
    policy.reload(db)

    db.expire_all()
    fresh = db.get(WorkflowTransition, transition_id)
    return _transition_out(fresh, _holders(db))


_SEED_PERMISSION = {str(t.action): t.permission for t in TRANSITIONS}


# permission_cd -> the active roles granted it, as the loader would resolve them.
def _holders(db: Session) -> dict[str, list[str]]:
    holders: dict[str, list[str]] = {}
    for role_cd, permission_cd in db.execute(
        sa.select(RolePermission.role_cd, RolePermission.permission_cd)
        .join(PolicyRole, PolicyRole.role_cd == RolePermission.role_cd)
        .where(PolicyRole.active.is_(True))
    ).all():
        holders.setdefault(permission_cd, []).append(role_cd)
    return holders


# A NULL permission_cd is read as the loader reads it: the code seed's mapping.
def _transition_out(row: WorkflowTransition, holders: dict[str, list[str]]) -> TransitionOut:
    permission = row.permission_cd or _SEED_PERMISSION.get(row.action_cd, "")
    return TransitionOut(
        id=row.id,
        action_cd=row.action_cd,
        source_status=row.source_status,
        target_status=row.target_status,
        stage_no=row.stage_no,
        assignee_only=row.assignee_only,
        opens_round=row.opens_round,
        requires=list(row.requires or ()),
        permission_cd=permission,
        roles=sorted(holders.get(permission, ())),
        active=row.active,
        sort_order=row.sort_order,
        note=row.note,
    )


class RuntimeSettingOut(BaseModel):
    key: str
    value: bool | float
    type: Literal["boolean", "number"]
    description: str
    is_default: bool = Field(description="True when no row is stored and the code default applies.")
    updated_by: str | None
    updated_at: IstDateTime | None


class RuntimeSettingPut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    value: bool | int | float


@router.get(
    "/admin/runtime-settings",
    response_model=list[RuntimeSettingOut],
    summary="Runtime switches held in icms_runtime_setting",
)
def list_runtime_settings(
    user: Principal = Depends(require_permission("policy.read")),
    db: Session = Depends(get_db),
) -> list[RuntimeSettingOut]:
    return [RuntimeSettingOut(**item) for item in runtime_settings.read_all(db)]


@router.put(
    "/admin/runtime-settings/{key}",
    response_model=RuntimeSettingOut,
    summary="Set one runtime switch; unknown keys and wrong types are refused",
)
def put_runtime_setting(
    body: RuntimeSettingPut,
    key: str = Path(max_length=64),
    user: Principal = Depends(require_permission("policy.manage")),
    db: Session = Depends(get_db),
) -> RuntimeSettingOut:
    try:
        item = runtime_settings.write(db, key, body.value, actor=user.subject)
    except Exception:
        db.rollback()
        raise
    return RuntimeSettingOut(**item)
