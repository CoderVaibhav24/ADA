"""Who the caller is, and whether the project is theirs.

Both questions were here before the split and both still are; what changed is
the answer to the first. It used to come from a SuperTokens session cookie
verified against a SuperTokens core over the network. It now comes from a
Keycloak access token verified locally against the realm's JWKS — no call to
Keycloak per request, so a Keycloak outage stops new logins and leaves every
signed-in officer working.

The verification itself moved to app/security.py, where JWTMiddleware enforces
it as a floor on every path. `require_user` is re-exported from there rather
than rebuilt here: the middleware and the dependency have to be the same
callable, or the two could refuse different requests.

`current_user_id` still returns a plain string, and `get_owned_project` is
untouched, so every router that depended on them did not have to change. The
string it returns is now the Keycloak subject (a UUID) rather than a SuperTokens
user id — see scripts/remap_user_ids.py for what that means for rows written
before the swap.
"""

from __future__ import annotations

from functools import cache

from ada_core.models import Project
from ada_platform import Principal
from fastapi import Depends, HTTPException, Request
from sqlalchemy.orm import Session

# Re-exported, not redefined. The same callable is what JWTMiddleware enforces
# as the floor, and a second one here could answer differently from the first.
from .security import auth, require_user  # noqa: F401

__all__ = [
    "auth", "current_user_id", "get_owned_project", "require_imagery", "require_user",
]

_READ_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


async def current_user_id(user: Principal = Depends(require_user)) -> str:
    """The Keycloak subject of the signed-in officer."""
    return user.subject


def get_owned_project(
    project_id: int, db: Session, user_id: str,
) -> Project:
    project = db.get(Project, project_id)
    if project is None or project.user_id != user_id:
        raise HTTPException(status_code=404, detail="Project not found")
    return project


# Imported late: app.icms.security imports this module for require_user.
@cache
def _imagery_checks():
    from .icms.security import require_permission

    return require_permission("imagery.read"), require_permission("imagery.write")


@cache
def _imagery_run_check():
    from .icms.security import require_permission

    return require_permission("imagery.run")


def require_imagery(
    request: Request, user: Principal = Depends(require_user),
) -> Principal:
    """imagery.read for GET, imagery.write for every other method."""
    read, write = _imagery_checks()
    check = read if request.method in _READ_METHODS else write
    return check(user)


def require_imagery_run(user: Principal = Depends(require_user)) -> Principal:
    """imagery.run: starting a change-detection analysis."""
    return _imagery_run_check()(user)
