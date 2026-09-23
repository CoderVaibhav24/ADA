"""Structured logs for every ADA service, in one shape.

    from ada_platform.logging import configure
    configure("ada-api", settings.log_level)

Every line carries `timestamp` (ISO 8601, UTC), `level`, `logger`, `service`
and — while a request is being served — `request_id`. Third-party loggers that
use the stdlib (uvicorn, sqlalchemy, httpx) go through the same processors via
the stdlib bridge, so an access line and an application line are the same JSON.

Compatible with the structlog setup in services/notify and services/auth-otp:
both bind `request_id` with `structlog.contextvars`, which `merge_contextvars`
below picks up exactly as their own configuration does.
"""

from __future__ import annotations

import logging
import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar, Token
from typing import IO, Any

import structlog

__all__ = [
    "REQUEST_ID_KEY",
    "add_request_id",
    "configure",
    "default_json",
    "get_logger",
    "get_request_id",
    "request_id_bound",
    "reset_request_id",
    "set_request_id",
]

REQUEST_ID_KEY = "request_id"

_request_id: ContextVar[str] = ContextVar("ada_request_id", default="")

_UVICORN_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access")


def get_request_id() -> str:
    """The id of the request being served, or "" outside one."""
    return _request_id.get()


def set_request_id(value: str) -> Token[str]:
    return _request_id.set(value or "")


def reset_request_id(token: Token[str]) -> None:
    _request_id.reset(token)


@contextmanager
def request_id_bound(value: str) -> Iterator[str]:
    """Bind a request id for the duration of a block, e.g. one job on a worker thread."""
    token = set_request_id(value)
    try:
        yield value
    finally:
        reset_request_id(token)


def add_request_id(_logger: Any, _method: str, event_dict: dict) -> dict:
    """structlog processor: copy the current request id onto the event."""
    if not event_dict.get(REQUEST_ID_KEY):
        request_id = _request_id.get()
        if request_id:
            event_dict[REQUEST_ID_KEY] = request_id
    return event_dict


def _add_service(service: str):
    def processor(_logger: Any, _method: str, event_dict: dict) -> dict:
        event_dict.setdefault("service", service)
        return event_dict

    return processor


# Looks sys.stdout up per line rather than holding the object it saw at
# configure time: test runners and some supervisors swap stdout, and a handler
# holding a closed stream turns every log line into a "Logging error" trace.
class _StdoutHandler(logging.StreamHandler):
    def __init__(self) -> None:
        super().__init__(sys.stdout)

    @property  # type: ignore[override]
    def stream(self) -> IO[str]:
        return sys.stdout

    @stream.setter
    def stream(self, _value: IO[str]) -> None:
        pass


def default_json() -> bool:
    """JSON unless ADA_LOG_FORMAT says otherwise or ADA_ENV is exactly "local".

    An unset ADA_ENV counts as not-local, matching auth-otp: a deployment that
    forgot the variable gets machine-readable logs rather than ANSI colour codes.
    """
    fmt = os.environ.get("ADA_LOG_FORMAT", "").strip().lower()
    if fmt:
        return fmt == "json"
    return os.environ.get("ADA_ENV", "").strip().lower() != "local"


def _level(level: str | int) -> int:
    if isinstance(level, int):
        return level
    value = logging.getLevelName(str(level).strip().upper())
    return value if isinstance(value, int) else logging.INFO


def configure(
    service: str,
    level: str | int = "INFO",
    json: bool | None = None,
    *,
    stream: IO[str] | None = None,
) -> None:
    """Route structlog and stdlib logging through one renderer. Safe to call twice."""
    numeric = _level(level)
    use_json = default_json() if json is None else json

    shared: list[Any] = [
        structlog.contextvars.merge_contextvars,
        add_request_id,
        structlog.stdlib.add_log_level,
        structlog.stdlib.add_logger_name,
        _add_service(service),
        structlog.processors.TimeStamper(fmt="iso", utc=True),
        structlog.processors.StackInfoRenderer(),
    ]
    # ConsoleRenderer pretty-prints exc_info itself and warns if it was already
    # flattened to a string, so format_exc_info is JSON-only.
    final: list[Any] = [structlog.stdlib.ProcessorFormatter.remove_processors_meta]
    if use_json:
        final += [structlog.processors.format_exc_info, structlog.processors.JSONRenderer()]
    else:
        final.append(structlog.dev.ConsoleRenderer())

    structlog.configure(
        processors=[*shared, structlog.stdlib.ProcessorFormatter.wrap_for_formatter],
        wrapper_class=structlog.make_filtering_bound_logger(numeric),
        logger_factory=structlog.stdlib.LoggerFactory(),
        cache_logger_on_first_use=True,
    )

    handler = logging.StreamHandler(stream) if stream is not None else _StdoutHandler()
    handler.setFormatter(
        structlog.stdlib.ProcessorFormatter(foreign_pre_chain=shared, processors=final)
    )
    handler._ada_logging = True  # type: ignore[attr-defined]

    root = logging.getLogger()
    for existing in list(root.handlers):
        # Ours from an earlier call, or a plain basicConfig handler. Subclasses
        # (pytest's capture handlers among them) are left alone.
        if getattr(existing, "_ada_logging", False) or type(existing) is logging.StreamHandler:
            root.removeHandler(existing)
    root.addHandler(handler)
    root.setLevel(numeric)

    # uvicorn's default dictConfig gives these their own handlers and stops
    # propagation; leaving that in place prints every access line un-JSON'd.
    for name in _UVICORN_LOGGERS:
        uvicorn_logger = logging.getLogger(name)
        uvicorn_logger.handlers.clear()
        uvicorn_logger.propagate = True


def get_logger(name: str | None = None) -> Any:
    return structlog.get_logger(name)
