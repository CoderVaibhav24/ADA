"""The one check on the model service's door.

ada-ml holds no user sessions and makes no authorisation decision about a
project: by the time work reaches it, ada-api has already verified the caller's
Keycloak token and confirmed that the project is theirs. What this service needs
is the narrower guarantee that the caller is ada-api and not something else on
the network, because "run this job id" is an expensive instruction and the
service is not on a public interface.

A shared token does that. It is not a substitute for the network boundary — the
service binds to loopback in compose — but a flat network is exactly the
condition under which a missing check is discovered too late.
"""

from __future__ import annotations

import hmac

from fastapi import Header, HTTPException

from .config import settings

HEADER = "X-ADA-Service-Token"


async def require_service_token(
    x_ada_service_token: str = Header(default="", alias=HEADER),
) -> None:
    """Reject anything that is not ada-api.

    An unset ML_SERVICE_TOKEN skips the check only with ADA_ENV=local; the
    settings refuse to load otherwise, and this refuses again in case they
    were changed after load.
    """
    expected = settings.ml_service_token
    if not expected:
        if settings.ada_env != "local":
            raise HTTPException(status_code=503, detail="Service token not configured")
        return
    # compare_digest, not ==: a plain comparison returns as soon as two bytes
    # differ, and the time it took says how long the matching prefix was.
    if not hmac.compare_digest(x_ada_service_token, expected):
        raise HTTPException(status_code=401, detail="Bad or missing service token")
