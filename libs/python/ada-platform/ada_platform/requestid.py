"""X-Request-ID, accepted or minted, echoed, and bound for the logs.

Pure ASGI with no Starlette import, so the SDK keeps FastAPI optional.
"""

from __future__ import annotations

import re
import uuid
from typing import Any

import structlog

from ada_platform.logging import REQUEST_ID_KEY, get_request_id, reset_request_id, set_request_id

__all__ = [
    "REQUEST_ID_HEADER",
    "RequestIdMiddleware",
    "clean_request_id",
    "new_request_id",
    "outbound_headers",
]

REQUEST_ID_HEADER = "X-Request-ID"
_HEADER_KEY = REQUEST_ID_HEADER.lower().encode("latin-1")

# A control character in a header is a response split and in a log line a forged
# entry, so anything outside this set is dropped rather than echoed.
_UNSAFE_ID = re.compile(r"[^A-Za-z0-9._-]")
_MAX_ID_LENGTH = 64


def new_request_id() -> str:
    return uuid.uuid4().hex


def clean_request_id(value: str | None) -> str:
    """The inbound id made safe, or a fresh one when nothing usable arrived."""
    if not value:
        return new_request_id()
    cleaned = _UNSAFE_ID.sub("", value)[:_MAX_ID_LENGTH]
    return cleaned or new_request_id()


def outbound_headers(request_id: str | None = None) -> dict[str, str]:
    """{"X-Request-ID": ...} for a call to another service, or {} outside a request."""
    value = request_id or get_request_id()
    return {REQUEST_ID_HEADER: value} if value else {}


def _inbound(scope: dict) -> str | None:
    for key, value in scope.get("headers") or ():
        if key.lower() == _HEADER_KEY:
            return value.decode("latin-1")
    return None


class RequestIdMiddleware:
    """Bind the request id for the request's lifetime and echo it on the response.

    Not reset when the app raises: the framework's last-resort 500 handler runs
    outside this middleware and still needs the id for its log line and body.
    Each request runs in its own task, so nothing leaks into the next one.
    """

    def __init__(self, app: Any) -> None:
        self.app = app

    async def __call__(self, scope: dict, receive: Any, send: Any) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        request_id = clean_request_id(_inbound(scope))
        token = set_request_id(request_id)
        bound = structlog.contextvars.bind_contextvars(**{REQUEST_ID_KEY: request_id})
        encoded = request_id.encode("latin-1")

        async def send_with_id(message: dict) -> None:
            if message["type"] == "http.response.start":
                headers = [
                    (k, v) for k, v in message.get("headers") or () if k.lower() != _HEADER_KEY
                ]
                headers.append((_HEADER_KEY, encoded))
                message["headers"] = headers
            await send(message)

        await self.app(scope, receive, send_with_id)
        structlog.contextvars.reset_contextvars(**bound)
        reset_request_id(token)
