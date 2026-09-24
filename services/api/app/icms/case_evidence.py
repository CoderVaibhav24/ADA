"""Photographs attached to a complaint at filing time, before any inspection round."""

from __future__ import annotations

import logging
import uuid

from ada_core.models_icms import CASE_EVIDENCE_KIND, CaseEvent, Evidence
from fastapi import UploadFile
from sqlalchemy import Select, func, insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from ..errors import ApiError
from . import workflow as wf
from .case_schemas import CaseEvidenceCreate
from .cases import locate_case, move_case
from .evidence_store import StoredEvidence, discard_stored, store, stored_file
from .geo import as_geojson_column, parse_geojson, point_value
from .security import ZoneScope

__all__ = [
    "CASE_EVIDENCE_CONTENT_PATH",
    "add_case_evidence",
    "case_evidence",
    "case_evidence_content",
]

log = logging.getLogger("ada.api.icms.case_evidence")

CASE_EVIDENCE_CONTENT_PATH = "/api/icms/cases/{case_ref}/evidence/{evidence_id}/content"

_KNOWN_ROLES = frozenset(str(role) for role in wf.Role)


def _select(db: Session, case_id: int) -> Select:
    return (
        select(
            Evidence.id,
            Evidence.original_filename.label("filename"),
            Evidence.content_type,
            Evidence.byte_size.label("size_bytes"),
            Evidence.caption,
            Evidence.uploaded_at.label("created_at"),
            as_geojson_column(db, Evidence.location).label("_location"),
        )
        .where(
            Evidence.case_id == case_id,
            Evidence.inspection_id.is_(None),
            Evidence.kind == CASE_EVIDENCE_KIND,
        )
    )


def _as_dict(row, case_ref: str) -> dict:
    data = dict(row._mapping)
    coordinates = (parse_geojson(data.pop("_location")) or {}).get("coordinates") or []
    data["latitude"], data["longitude"] = (
        (float(coordinates[1]), float(coordinates[0])) if len(coordinates) >= 2
        else (None, None)
    )
    data["content_url"] = CASE_EVIDENCE_CONTENT_PATH.format(
        case_ref=case_ref, evidence_id=data["id"])
    return data


def _one(db: Session, case_id: int, case_ref: str, evidence_id: int) -> dict:
    row = db.execute(_select(db, case_id).where(Evidence.id == evidence_id)).first()
    return _as_dict(row, case_ref)


def case_evidence(
    db: Session, case_ref: str, scope: ZoneScope, *, roles, user_id: str
) -> list[dict] | None:
    found = locate_case(db, case_ref, scope, roles=roles, user_id=user_id)
    if found is None:
        return None
    rows = db.execute(_select(db, found.id).order_by(Evidence.id)).all()
    return [_as_dict(row, found.case_ref) for row in rows]


def case_evidence_content(
    db: Session, case_ref: str, evidence_id: int, scope: ZoneScope, *, roles, user_id: str
) -> StoredEvidence | None:
    found = locate_case(db, case_ref, scope, roles=roles, user_id=user_id)
    if found is None:
        return None
    row = db.execute(
        select(Evidence.storage_path, Evidence.original_filename,
               Evidence.content_type, Evidence.sha256)
        .where(
            Evidence.id == evidence_id,
            Evidence.case_id == found.id,
            Evidence.inspection_id.is_(None),
            Evidence.kind == CASE_EVIDENCE_KIND,
        )
    ).first()
    return None if row is None else stored_file(row, evidence_id)


def _count(db: Session, case_id: int) -> int:
    return int(
        db.execute(
            select(func.count()).select_from(Evidence).where(
                Evidence.case_id == case_id,
                Evidence.inspection_id.is_(None),
                Evidence.kind == CASE_EVIDENCE_KIND,
            )
        ).scalar_one()
    )


def _refuse_a_full_case(db: Session, case_id: int) -> None:
    ceiling = settings.icms_max_photos_per_case
    held = _count(db, case_id)
    if held >= ceiling:
        raise ApiError(
            422, "too_many_photos",
            f"this complaint already holds {held} photograph{'' if held == 1 else 's'} "
            f"and a complaint carries at most {ceiling}",
            field="file",
        )


def _replayed(db: Session, key: str, case_id: int, case_ref: str) -> dict | None:
    existing = db.execute(
        select(Evidence.id, Evidence.case_id, Evidence.inspection_id, Evidence.kind)
        .where(Evidence.idempotency_key == key)
    ).first()
    if existing is None:
        return None
    if (existing.case_id != case_id or existing.inspection_id is not None
            or existing.kind != CASE_EVIDENCE_KIND):
        raise ApiError(
            409, "idempotency_key_reused",
            "this Idempotency-Key already belongs to other evidence",
            field="idempotency_key",
        )
    return {"evidence": _one(db, case_id, case_ref, existing.id), "replayed": True}


def add_case_evidence(
    db: Session, case_ref: str, meta: CaseEvidenceCreate, upload: UploadFile,
    scope: ZoneScope, *, actor: str, roles, idempotency_key: uuid.UUID | None,
) -> dict | None:
    """Append-only, like inspection evidence; open only while the case is `raised`."""
    # Zone scope as the detail has it, but not narrowed to the assignee: a raised
    # case has none, and filing into a zone is the authority this mirrors.
    found = locate_case(db, case_ref, scope, roles=roles, user_id=actor, own_only=False)
    if found is None:
        return None

    # The authority that may file a complaint is the authority that may attach to one.
    wf.check(None, wf.Action.RAISE, roles,
             payload={"zone_id": found.zone_id, "source": found.source})

    key = str(idempotency_key or uuid.uuid4())
    if idempotency_key is not None:
        replayed = _replayed(db, key, found.id, found.case_ref)
        if replayed is not None:
            return replayed

    if found.status != str(wf.Status.RAISED):
        raise ApiError(
            409, "invalid_transition",
            f"{found.case_ref} is {found.status}; photographs are attached to a "
            "complaint only while it is raised",
        )
    _refuse_a_full_case(db, found.id)

    result, storage_path, created = store(db, found.case_ref, CASE_EVIDENCE_KIND, upload)
    located = meta.latitude is not None and meta.longitude is not None

    try:
        # Takes the case row's lock and proves it is still raised.
        move_case(db, found.id, found.status)
        _refuse_a_full_case(db, found.id)
        evidence_id = db.execute(
            insert(Evidence)
            .values(
                case_id=found.id,
                inspection_id=None,
                kind=CASE_EVIDENCE_KIND,
                storage_path=storage_path,
                original_filename=upload.filename,
                content_type=result.media_type,
                byte_size=result.byte_size,
                sha256=result.sha256,
                location=point_value(db, meta.latitude, meta.longitude) if located else None,
                capture_source="upload",
                caption=meta.caption,
                uploaded_by=actor,
                idempotency_key=key,
            )
            .returning(Evidence.id)
        ).scalar_one()
        db.execute(
            insert(CaseEvent).values(
                case_id=found.id,
                action=str(wf.Action.ADD_EVIDENCE),
                from_status=found.status,
                to_status=found.status,
                actor_user_id=actor,
                actor_role=",".join(sorted(frozenset(roles) & _KNOWN_ROLES)) or None,
                payload={"evidence_id": evidence_id, "kind": CASE_EVIDENCE_KIND,
                         "sha256": result.sha256},
            )
        )
        db.commit()
    except IntegrityError:
        db.rollback()
        discard_stored(db, storage_path, created)
        replayed = _replayed(db, key, found.id, found.case_ref)
        if replayed is not None:
            log.info("case evidence %s raced its own replay on %s", key, case_ref)
            return replayed
        raise
    except Exception:
        db.rollback()
        discard_stored(db, storage_path, created)
        raise

    return {"evidence": _one(db, found.id, found.case_ref, evidence_id), "replayed": False}
