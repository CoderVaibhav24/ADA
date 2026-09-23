"""The API's side of ada_core.uploads: load the policy row, translate a rejection."""

from __future__ import annotations

from typing import BinaryIO

from ada_core.models_icms import UploadPolicy
from ada_core.uploads import UploadResult, UploadRules, validate_upload
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import ApiError

__all__ = ["check_upload", "rules_for"]


# An inactive or absent kind rejects everything rather than falling back to a permissive default.
def rules_for(db: Session, kind: str) -> UploadRules:
    row = db.execute(
        select(UploadPolicy).where(UploadPolicy.kind == kind, UploadPolicy.active.is_(True))
    ).scalar_one_or_none()
    if row is None:
        allowed = db.execute(
            select(UploadPolicy.kind).where(UploadPolicy.active.is_(True))
        ).scalars().all()
        raise ApiError(400, "unknown_upload_kind",
                       f"{kind} is not an upload kind this system accepts",
                       field="kind", allowed=allowed)
    return UploadRules.from_row(row)


# The only upload entry point a router may use; bypassing it puts an unchecked file on disk.
def check_upload(
    db: Session,
    kind: str,
    stream: BinaryIO,
    *,
    filename: str | None = None,
    declared_type: str | None = None,
    sink: object | None = None,
) -> UploadResult:
    result = validate_upload(
        stream, rules_for(db, kind),
        filename=filename, declared_type=declared_type, sink=sink,
    )
    if not result.ok:
        raise ApiError(result.status_code, result.code, result.message,
                       field=result.field, allowed=result.allowed or None)
    return result
