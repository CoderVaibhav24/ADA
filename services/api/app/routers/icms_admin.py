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
from ada_core.models_icms import (
    Permission,
    PolicyRole,
    RolePermission,
    TransitionRole,
    WorkflowTransition,
)
from ada_platform import Principal
from fastapi import APIRouter, Depends, Path
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy.orm import Session

from ..errors import ApiError
from ..icms import policy
from ..icms.security import (
    ICMS_ROLES,
    ZoneScope,
    require_icms_user,
    require_permission,
    zone_scope,
)
from ..icms.workflow import Role

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


class RoleGrantsOut(BaseModel):
    role_cd: str
    label: str
    active: bool
    permission_cds: list[str]


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
    roles: list[str]
    active: bool
    sort_order: int
    note: str | None


class TransitionUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    roles: list[RoleCode] | None = None
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
    roles = sorted(frozenset(user.roles) & ICMS_ROLES)
    held = frozenset(Role(role) for role in roles)
    return CapabilitiesOut(
        user_id=user.subject,
        roles=roles,
        permissions=sorted(snapshot.permitted(roles)),
        zone_ids=sorted(scope.zone_ids),
        unrestricted=scope.unrestricted,
        actions=[
            ActionOut(
                action=str(t.action),
                source_status=None if t.source is None else str(t.source),
                target_status=str(t.target),
                stage_no=t.stage_no,
                assignee_only=t.assignee_only,
                opens_round=t.opens_round,
                requires=list(t.requires),
            )
            for t in snapshot.transitions
            if t.roles & held
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
    roles: dict[int, list[str]] = {}
    for transition_id, role_cd in db.execute(
        sa.select(TransitionRole.transition_id, TransitionRole.role_cd)
    ).all():
        roles.setdefault(transition_id, []).append(role_cd)
    return [_transition_out(row, roles.get(row.id, ())) for row in rows]


# Which roles, what the payload must carry and whether the row is live are
# operational. The action, the two statuses and the stage are what the product
# means by a stage, so they are not editable here at all.
@router.patch(
    "/admin/policy/transitions/{transition_id}",
    response_model=TransitionOut,
    summary="Edit a transition's roles, payload requirements or active flag",
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

    known_roles = frozenset(db.execute(sa.select(PolicyRole.role_cd)).scalars().all())
    if body.roles is not None:
        unknown = frozenset(body.roles) - known_roles
        if unknown:
            raise ApiError(
                422,
                "unknown_role",
                f"no such role: {', '.join(sorted(unknown))}",
                field="roles",
                allowed=sorted(known_roles),
            )

    changes = body.model_dump(exclude_unset=True, exclude={"roles"})
    try:
        if changes:
            db.execute(
                sa.update(WorkflowTransition)
                .where(WorkflowTransition.id == transition_id)
                .values(**changes, updated_by=user.subject)
            )
        if body.roles is not None:
            db.execute(
                sa.delete(TransitionRole).where(TransitionRole.transition_id == transition_id)
            )
            if body.roles:
                db.execute(
                    sa.insert(TransitionRole),
                    [
                        {"transition_id": transition_id, "role_cd": role}
                        for role in sorted(frozenset(body.roles))
                    ],
                )
        policy.bump(db, actor=user.subject)
        db.commit()
    except Exception:
        db.rollback()
        raise
    policy.reload(db)

    db.expire_all()
    fresh = db.get(WorkflowTransition, transition_id)
    current = db.execute(
        sa.select(TransitionRole.role_cd).where(TransitionRole.transition_id == transition_id)
    ).scalars().all()
    return _transition_out(fresh, current)


def _transition_out(row: WorkflowTransition, roles) -> TransitionOut:
    return TransitionOut(
        id=row.id,
        action_cd=row.action_cd,
        source_status=row.source_status,
        target_status=row.target_status,
        stage_no=row.stage_no,
        assignee_only=row.assignee_only,
        opens_round=row.opens_round,
        requires=list(row.requires or ()),
        roles=sorted(roles),
        active=row.active,
        sort_order=row.sort_order,
        note=row.note,
    )
