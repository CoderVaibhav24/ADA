# ada-platform-sdk

Authenticate users and send notifications through ADA.

```bash
pip install -e ./backend/shared/ada-platform-sdk
```

```python
from ada_platform import ADAAuth, ADANotify, Principal
from fastapi import Depends, FastAPI

app    = FastAPI()
auth   = ADAAuth()      # ADA_ISSUER
notify = ADANotify()    # ADA_NOTIFY_URL, ADA_CLIENT_ID, ADA_CLIENT_SECRET

@app.post("/leave/{request_id}/approve")
def approve(request_id: str, user: Principal = Depends(auth.require_scope("leave:approve"))):
    record = approve_leave(request_id)
    notify.send(
        idempotency_key=f"leave-approved-{request_id}",
        recipient=user.subject,
        template_key="leave-approved",
        payload={"first_name": user.username, "days": record.days},
    )
    return record
```

Two behaviours to know before reading further:

- **Verification is local.** No network call per request. A Keycloak outage stops
  new logins and leaves existing sessions working.
- **`send()` never raises.** A notification is a side effect of something that
  already happened, and must not be able to fail the thing that happened. It
  returns a `SendOutcome`; ignoring it is a valid choice.

The full guide, including how to obtain a client id and secret, is at
[`docs/integration-guide.md`](../../docs/integration-guide.md).
