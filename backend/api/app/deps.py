"""Who the caller is, and whether the project is theirs.

Both questions were here before the split and both still are; what changed is
the answer to the first. It used to come from a SuperTokens session cookie
verified against a SuperTokens core over the network. It now comes from a
Keycloak access token verified locally against the realm's JWKS — no call to
Keycloak per request, so a Keycloak outage stops new logins and leaves every
signed-in officer working.

`current_user_id` still returns a plain string, and `get_owned_project` is
untouched, so every router that depended on them did not have to change. The
string it returns is now the Keycloak subject (a UUID) rather than a SuperTokens
user id — see scripts/remap_user_ids.py for what that means for rows written
before the swap.
"""

from __future__ import annotations

from ada_core.models import Project
from ada_platform import ADAAuth, Principal
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from .config import settings

# One verifier for the process. It owns the JWKS cache, so constructing it per
# request would refetch the realm's keys on every call — which is the coupling
# local verification exists to remove.
auth = ADAAuth(
    issuer=settings.oidc_issuer,
    internal_issuer_url=settings.oidc_internal_issuer_url,
)

require_user = auth.require_user


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
