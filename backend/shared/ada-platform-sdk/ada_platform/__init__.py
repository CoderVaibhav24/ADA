"""The ADA SDK.

Two things an application needs, and nothing else:

    from ada_platform import ADAAuth, ADANotify

    auth   = ADAAuth()      # reads ADA_ISSUER
    notify = ADANotify()    # reads ADA_NOTIFY_URL, ADA_CLIENT_ID, ...

    @app.post("/leave/{id}/approve")
    async def approve(id: str, user: Principal = Depends(auth.require_scope("leave:approve"))):
        record = approve_leave(id)                 # the thing that actually happened
        notify.send(                               # telling someone about it
            idempotency_key=f"leave-approved-{id}",
            recipient=user.subject,
            template_key="leave-approved",
            payload={"first_name": user.username, "days": record.days},
        )
        return record

Two behaviours worth knowing before you read any further:

  * verification is local. No network call per request, so a Keycloak outage
    stops new logins and leaves existing sessions working (AD-4).
  * send() never raises. A notification is a side effect of something that has
    already happened, and it must not be able to fail the thing that happened.
"""

from ada_platform.auth import ADAAuth
from ada_platform.errors import (
    ADAAuthError,
    ADAConfigError,
    ADAError,
    ADAScopeError,
    ADAUnavailable,
)
from ada_platform.notify import ADANotify, SendOutcome
from ada_platform.verify import Principal, TokenVerifier

__version__ = "0.1.0"

__all__ = [
    "ADAAuth",
    "ADAAuthError",
    "ADAConfigError",
    "ADAError",
    "ADANotify",
    "ADAScopeError",
    "ADAUnavailable",
    "Principal",
    "SendOutcome",
    "TokenVerifier",
    "__version__",
]
