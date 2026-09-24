from __future__ import annotations

import logging
from collections.abc import Iterable, Sequence

from ada_platform.logging import get_request_id as current_request_id
from ada_platform.requestid import REQUEST_ID_HEADER, RequestIdMiddleware
from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .icms.workflow import (
    MissingPayload,
    NotTheAssignee,
    RoleNotPermitted,
    UnknownTransition,
    WorkflowError,
)

__all__ = [
    "ApiError",
    "ICMS_PREFIX",
    "REQUEST_ID_HEADER",
    "RequestIdMiddleware",
    "current_request_id",
    "envelope",
    "install_error_handlers",
]

log = logging.getLogger("ada.api.errors")

ICMS_PREFIX = "/api/icms"


def envelope(
    code: str,
    message: str,
    *,
    field: str | None = None,
    allowed: Sequence[str] | None = None,
    details: dict | None = None,
) -> dict:
    error = {
        "code": code,
        "message": message,
        "field": field,
        "allowed": list(allowed) if allowed is not None else None,
        "request_id": current_request_id(),
    }
    if details is not None:
        error["details"] = details
    return {"error": error}


class ApiError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        *,
        field: str | None = None,
        allowed: Iterable[str] | None = None,
        details: dict | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        self.field = field
        self.allowed = sorted(allowed) if allowed is not None else None
        self.details = details

    def body(self) -> dict:
        return envelope(self.code, self.message, field=self.field, allowed=self.allowed,
                        details=self.details)


_WORKFLOW_CODES: dict[type[WorkflowError], str] = {
    UnknownTransition: "invalid_transition",
    RoleNotPermitted: "role_not_permitted",
    NotTheAssignee: "not_the_assignee",
    MissingPayload: "missing_payload",
}

_STATUS_CODES = {
    400: "bad_request",
    401: "unauthenticated",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    413: "payload_too_large",
    422: "unprocessable_entity",
    429: "too_many_requests",
    500: "internal_error",
    503: "unavailable",
}


def _is_icms(request: Request) -> bool:
    return request.url.path.startswith(ICMS_PREFIX)


def _field_of(error: dict) -> str | None:
    location = [str(part) for part in error.get("loc", ()) if part not in ("body", "query", "path")]
    return ".".join(location) or None


# The pre-ICMS body. `detail` keeps its shape because the console parses it;
# request_id rides alongside so a reported failure can be found in the logs.
def _detail(detail: object) -> dict:
    return {"detail": detail, "request_id": current_request_id()}


def install_error_handlers(app: FastAPI) -> None:
    app.add_middleware(RequestIdMiddleware)

    @app.exception_handler(ApiError)
    async def _api_error(request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content=exc.body())

    @app.exception_handler(WorkflowError)
    async def _workflow_error(request: Request, exc: WorkflowError) -> JSONResponse:
        code = _WORKFLOW_CODES.get(type(exc), "workflow_error")
        allowed: list[str] | None = None
        field: str | None = None
        if isinstance(exc, RoleNotPermitted):
            allowed = list(exc.allowed)
        elif isinstance(exc, MissingPayload):
            allowed = list(exc.missing)
            field = exc.missing[0] if exc.missing else None
        return JSONResponse(
            status_code=exc.status_code,
            content=envelope(code, str(exc), field=field, allowed=allowed),
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(
        request: Request, exc: RequestValidationError
    ) -> JSONResponse:
        errors = jsonable_encoder(exc.errors())
        if not _is_icms(request):
            return JSONResponse(status_code=422, content=_detail(errors))
        first = errors[0] if errors else {}
        return JSONResponse(
            status_code=422,
            content=envelope(
                "validation_failed",
                first.get("msg", "the request could not be validated"),
                field=_field_of(first),
            ),
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        headers = getattr(exc, "headers", None)
        if not _is_icms(request):
            return JSONResponse(
                status_code=exc.status_code, content=_detail(exc.detail), headers=headers
            )
        code = _STATUS_CODES.get(exc.status_code, "error")
        detail = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
        return JSONResponse(
            status_code=exc.status_code,
            content=envelope(code, detail),
            headers=headers,
        )

    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        # request_id is on the line already: the logging config reads it from
        # the same contextvar the middleware set.
        log.exception("unhandled error serving %s %s", request.method, request.url.path)
        headers = {REQUEST_ID_HEADER: current_request_id()}
        if not _is_icms(request):
            return JSONResponse(
                status_code=500, content=_detail("Internal Server Error"), headers=headers
            )
        return JSONResponse(
            status_code=500,
            content=envelope("internal_error", "The request could not be completed."),
            headers=headers,
        )
