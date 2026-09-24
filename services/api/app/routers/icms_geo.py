"""ICMS geography: suggest administrative fields for a pin, and load the boundary layers."""

from __future__ import annotations

from dataclasses import asdict

from ada_core.database import get_db
from ada_core.models_icms import BoundaryImport
from ada_platform import Principal
from fastapi import APIRouter, Depends, File, Query, UploadFile
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..clients.keycloak import KeycloakAdmin
from ..errors import ApiError
from ..icms.actors import actor_directory, fill_actor_names
from ..icms.boundary_import import MAX_FILE_BYTES, KmlRejected, run_import, safe_filename
from ..icms.geo import parcel_at
from ..icms.geo_schemas import BoundaryImportOut, BoundaryImportRow, ParcelAtOut
from ..icms.locator import Locator, get_locator
from ..icms.schemas import LocateOut
from ..icms.security import require_permission

router = APIRouter(prefix="/icms", tags=["icms-geo"])

IMPORT_HISTORY = 20


# Same claim order as the web header's profileName: name, given + family, username, email.
def principal_name(user: Principal) -> str | None:
    claim = {k: str(user.claims.get(k) or "").strip()
             for k in ("name", "given_name", "family_name")}
    joined = " ".join(p for p in (claim["given_name"], claim["family_name"]) if p)
    username = user.username if "@" not in user.username else ""
    return (claim["name"] or joined or username or user.email or None)


@router.get(
    "/geo/locate",
    response_model=LocateOut,
    summary="Suggest state, district, district LGD code and pin code for a point",
)
def locate(
    lat: float = Query(ge=-90, le=90, description="Latitude, WGS 84."),
    lon: float = Query(ge=-180, le=180, description="Longitude, WGS 84."),
    user: Principal = Depends(require_permission("case.raise")),
    locator: Locator = Depends(get_locator),
) -> LocateOut:
    """Always 200: an upstream failure is all-null with `source: "unavailable"`."""
    return LocateOut(**asdict(locator.locate(lat, lon)))


@router.get(
    "/geo/parcel",
    response_model=ParcelAtOut,
    summary="The zone, village and parcel the loaded KML layers put a point in",
)
def parcel(
    lat: float = Query(ge=-90, le=90, description="Latitude, WGS 84."),
    lon: float = Query(ge=-180, le=180, description="Longitude, WGS 84."),
    user: Principal = Depends(require_permission("case.raise")),
    db: Session = Depends(get_db),
) -> ParcelAtOut:
    """Always 200: nothing loaded, or nothing under the point, is all-null with `source: "none"`."""
    return ParcelAtOut(**parcel_at(db, lat, lon))


@router.post(
    "/admin/geo/import",
    response_model=BoundaryImportOut,
    summary="Load zones, villages, parcels and reserved areas from the authority's KML/KMZ",
)
def import_boundaries(
    file: UploadFile = File(description="One .kml or .kmz, at most 50 MB."),
    dry_run: bool = Query(False, description="Validate and count; write nothing."),
    user: Principal = Depends(require_permission("zone.manage")),
    db: Session = Depends(get_db),
) -> BoundaryImportOut:
    """docs/icms/kml-import-spec.md is the format. One transaction; rejected placemarks are
    listed and skipped, and a file that is not KML 2.2 is refused whole with 422."""
    filename = safe_filename(file.filename)
    if not filename.lower().endswith((".kml", ".kmz")):
        raise ApiError(415, "unsupported_media_type", "upload a .kml or .kmz file",
                       field="file", allowed=[".kml", ".kmz"])
    data = file.file.read(MAX_FILE_BYTES + 1)
    if len(data) > MAX_FILE_BYTES:
        raise ApiError(413, "payload_too_large",
                       f"the file is larger than {MAX_FILE_BYTES // (1024 * 1024)} MB",
                       field="file")
    try:
        result = run_import(db, data, filename, actor=user.subject,
                            actor_name=principal_name(user), dry_run=dry_run)
    except KmlRejected as exc:
        raise ApiError(422, "invalid_kml", str(exc), field="file") from exc
    return BoundaryImportOut(**asdict(result))


@router.get(
    "/admin/geo/imports",
    response_model=list[BoundaryImportRow],
    summary="The last twenty boundary imports, newest first",
)
def list_imports(
    user: Principal = Depends(require_permission("zone.manage")),
    directory: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
) -> list[BoundaryImportRow]:
    rows = db.execute(
        select(BoundaryImport)
        .order_by(BoundaryImport.imported_at.desc(), BoundaryImport.id.desc())
        .limit(IMPORT_HISTORY)
    ).scalars()
    items = [BoundaryImportRow(id=r.id, filename=r.filename, sha256=r.sha256,
                               imported_by=r.imported_by,
                               imported_by_name=r.imported_by_name, imported_at=r.imported_at,
                               counts=r.counts) for r in rows]
    fill_actor_names(directory, items, {"imported_by": "imported_by_name"})
    return items
