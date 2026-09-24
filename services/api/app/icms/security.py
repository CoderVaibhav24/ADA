"""Who may call an ICMS endpoint, and which zones they may see.

Two questions, two mechanisms: the token's realm roles answer "may you act",
`icms_zone_assignment` answers "what may you see", and neither stands in for the
other — several officers work the same case at different stages, so ownership
would exclude the nodal officer who must verify what a surveyor submitted.
"""

from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass

from ada_core.database import get_db
from ada_core.models_icms import ZoneAssignment
from ada_platform import Principal
from fastapi import Depends
from sqlalchemy import Select, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from ..deps import require_user
from ..errors import ApiError
from . import policy
from .workflow import Role

__all__ = [
    "ICMS_ROLES",
    "icms_roles",
    "ZoneScope",
    "require_icms_user",
    "require_permission",
    "require_role",
    "require_super_admin",
    "zone_scope",
]

# The four roles the realm was seeded with (infra/keycloak/realm-ada.json).
# `icms_roles()` is what the checks read; this is only the seed it grows from.
ICMS_ROLES: frozenset[str] = frozenset({
    Role.SUPER_ADMIN,
    Role.PCS_NODAL_OFFICER,
    Role.FIELD_SURVEYOR,
    Role.ADA_PROJECT_LEAD,
})


def icms_roles() -> frozenset[str]:
    """Every active role in `icms_role`, so a role created from Administration counts."""
    return (frozenset(policy.snapshot().grants) | ICMS_ROLES) - {str(Role.PUBLIC)}


# 403 and not 401: `require_user` answers 401 when the token is unusable, which
# tells the client to refresh. Refreshing produces the same roles, so a client
# that retried this one on 401 would loop for ever.
def require_role(*roles: str):
    """Admits a caller holding any one of `roles`; the refusal names them all."""
    required = frozenset(str(role) for role in roles)

    def dependency(user: Principal = Depends(require_user)) -> Principal:
        if not (required & user.roles):
            raise ApiError(
                403,
                "role_not_permitted",
                f"this endpoint requires one of: {', '.join(sorted(required))}",
                allowed=required,
            )
        return user

    return dependency


# Resolved from the cached snapshot, so this costs no query. The refusal names
# roles rather than permission codes: a permission is not something an officer
# can be given, and "ask for one of these roles" is the actionable half.
def require_permission(*codes: str):
    """Admits a caller whose roles grant any one of `codes` in the loaded policy."""
    required = frozenset(codes)

    def dependency(user: Principal = Depends(require_user)) -> Principal:
        current = policy.snapshot()
        if required & current.permitted(user.roles):
            return user
        allowed = current.roles_holding(required) & icms_roles()
        raise ApiError(
            403,
            "role_not_permitted",
            f"this endpoint requires one of: {', '.join(sorted(allowed or required))}",
            allowed=allowed or required,
        )

    return dependency


# Any officer of the authority. A form that cannot load its dropdowns is a form
# nobody fills, and this is the gate on the endpoints a transition governs.
def require_icms_user(user: Principal = Depends(require_user)) -> Principal:
    """Admits a caller holding any active ICMS role, created ones included."""
    allowed = icms_roles()
    if not (allowed & user.roles):
        raise ApiError(
            403,
            "role_not_permitted",
            f"this endpoint requires one of: {', '.join(sorted(allowed))}",
            allowed=allowed,
        )
    return user

# Kept for callers that guard on the role itself rather than on a permission.
require_super_admin = require_role(Role.SUPER_ADMIN)


@dataclass(frozen=True)
class ZoneScope:
    """The zones this caller may read, as a filter rather than as a list.

    `unrestricted` is Super Admin and only Super Admin; an officer with no
    assignment sees an empty register rather than the whole district.
    """

    user_id: str
    roles: frozenset[str]
    unrestricted: bool
    zone_ids: frozenset[int]

    def allows(self, zone_id: int | None) -> bool:
        if self.unrestricted:
            return True
        return zone_id is not None and zone_id in self.zone_ids

    # Composes with the endpoint's own filters and is applied to the statement
    # the total is counted over, so `total` cannot count an unreadable row.
    def apply(self, statement: Select, column: ColumnElement) -> Select:
        if self.unrestricted:
            return statement
        if not self.zone_ids:
            # `IN ()` is not portable and an empty IN is an optimiser trap on
            # some backends. A literal false is unambiguous on both.
            return statement.where(column.in_([]))
        return statement.where(column.in_(sorted(self.zone_ids)))


# One indexed query per request, deliberately not cached: an assignment revoked
# at 10:00 that keeps working until a cache expires is what an audit finds.
def zone_scope(
    user: Principal = Depends(require_user),
    db: Session = Depends(get_db),
) -> ZoneScope:
    roles = frozenset(user.roles)
    # Unrestricted across every zone, by the same decision of 2026-09-23 that
    # leaves Super Admin the enforcement reads: an authority-wide administrator
    # bounded by zone assignments could not administer the zones. Deliberate,
    # not an oversight, and it widens READS only — the transition table refuses
    # Super Admin every write whatever this scope admits.
    if str(Role.SUPER_ADMIN) in roles:
        return ZoneScope(user.subject, roles, unrestricted=True, zone_ids=frozenset())

    rows = db.execute(
        select(ZoneAssignment.zone_id).where(
            ZoneAssignment.user_id == user.subject,
            ZoneAssignment.active.is_(True),
        )
    ).scalars().all()
    return ZoneScope(user.subject, roles, unrestricted=False, zone_ids=frozenset(rows))


def held_roles(user: Principal) -> Iterable[str]:
    """The ICMS roles in a token, for an event row's `actor_role`."""
    return sorted(frozenset(user.roles) & icms_roles())
