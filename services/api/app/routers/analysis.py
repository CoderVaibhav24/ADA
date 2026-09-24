import csv
import io
import json
from datetime import UTC, datetime

from ada_core.database import get_db
from ada_core.datetimes import now_ist
from ada_core.models import AnalysisJob, ChangePolygon, Raster
from ada_core.models_icms import Case as IcmsCase
from ada_core.validation import BBox
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from .. import bbox as bbox_rules
from ..analysis_schemas import ChangeFeatureCollection
from ..clients import ml as ml_client
from ..clients.keycloak import KeycloakAdmin
from ..deps import current_user_id, get_owned_project, require_imagery, require_imagery_run
from ..icms.actors import actor_directory, resolve_actor_names
from ..schemas import AnalysisCreate, AnalysisOut, PolygonReview, PolygonReviewOut

router = APIRouter(tags=["analysis"], dependencies=[Depends(require_imagery)])

# The detection panel stops at 200 rows and the map draws the rest; this is the
# ceiling on one fetch, not on a run. A client wanting more sends an offset.
DEFAULT_FEATURE_LIMIT = 1000
MAX_FEATURE_LIMIT = 5000


# A malformed or oversized extent is the caller's mistake, not a scan to attempt.
def _parse_bbox(value: str | None) -> BBox | None:
    if value is None:
        return None
    try:
        return bbox_rules.parse(value)
    except ValueError as exc:
        raise HTTPException(400, f"bbox: {exc}") from exc


def _centroid(geom: dict) -> tuple[float | None, float | None]:
    """Representative lon/lat for a GeoJSON Polygon/MultiPolygon."""
    try:
        from shapely.geometry import shape
        pt = shape(geom).representative_point()
        return pt.x, pt.y
    except Exception:
        return None, None


@router.post(
    "/projects/{project_id}/analyses",
    response_model=AnalysisOut,
    dependencies=[Depends(require_imagery_run)],
)
def create_analysis(
    project_id: int,
    body: AnalysisCreate,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    get_owned_project(project_id, db, user_id)
    if body.raster_t1_id == body.raster_t2_id:
        raise HTTPException(400, "Pick two different maps for T1 and T2")
    rasters = []
    for rid in (body.raster_t1_id, body.raster_t2_id):
        raster = db.get(Raster, rid)
        if raster is None or raster.project_id != project_id:
            raise HTTPException(404, f"Raster {rid} not found in this project")
        if raster.status != "ready":
            raise HTTPException(400, f"Raster '{raster.name}' is not ready yet")
        rasters.append(raster)

    # The sweeper's cold move checks this under a row lock, so use here keeps the archive local.
    used_at = now_ist()
    for raster in rasters:
        raster.last_used_at = used_at
    job = AnalysisJob(project_id=project_id, raster_t1_id=body.raster_t1_id,
                      raster_t2_id=body.raster_t2_id, mode=body.mode)
    db.add(job)
    db.commit()
    db.refresh(job)
    ml_client.submit_analysis(job.id)
    return job


@router.get("/projects/{project_id}/analyses", response_model=list[AnalysisOut])
def list_analyses(
    project_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    get_owned_project(project_id, db, user_id)
    return (db.query(AnalysisJob).filter(AnalysisJob.project_id == project_id)
            .order_by(AnalysisJob.created_at.desc()).all())


def _get_owned_job(job_id: int, db: Session, user_id: str) -> AnalysisJob:
    job = db.get(AnalysisJob, job_id)
    if job is None:
        raise HTTPException(404, "Analysis not found")
    get_owned_project(job.project_id, db, user_id)
    return job


def _linked_cases(db: Session, polygon_ids: list[int]) -> dict[int, tuple[str, str]]:
    """Newest complaint raised from each polygon, as (case_ref, status)."""
    if not polygon_ids:
        return {}
    rows = (db.query(IcmsCase.detection_id, IcmsCase.case_ref, IcmsCase.status)
            .filter(IcmsCase.detection_id.in_(polygon_ids))
            .order_by(IcmsCase.id)
            .all())
    return {detection_id: (ref, status) for detection_id, ref, status in rows}


def _as_feature(p: ChangePolygon, names: dict[str, str] | None = None,
                case: tuple[str, str] | None = None) -> dict:
    """GeoJSON Feature with the officer-review state folded into properties,
    so the map, the review queue and the exports all read the same object."""
    return {
        "type": "Feature",
        "id": p.id,
        "geometry": p.geometry,
        "properties": {
            **p.properties,
            "review_status": p.review_status or "pending",
            "review_note": p.review_note,
            "reviewed_by": p.reviewed_by,
            "reviewed_by_name": (names or {}).get(p.reviewed_by or ""),
            "reviewed_at": p.reviewed_at.isoformat() if p.reviewed_at else None,
            "case_ref": case[0] if case else None,
            "case_status": case[1] if case else None,
        },
    }


@router.get("/analyses/{job_id}", response_model=AnalysisOut)
def get_analysis(
    job_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    return _get_owned_job(job_id, db, user_id)


@router.get("/analyses/{job_id}/features", response_model=ChangeFeatureCollection)
def get_analysis_features(
    job_id: int,
    limit: int = Query(DEFAULT_FEATURE_LIMIT, ge=1, le=MAX_FEATURE_LIMIT),
    offset: int = Query(0, ge=0, le=1_000_000),
    bbox: str | None = Query(
        None, description="west,south,east,north in EPSG:4326, no wider than "
                          f"{bbox_rules.MAX_SPAN_DEGREES} degrees a side."),
    user_id: str = Depends(current_user_id),
    directory: KeycloakAdmin | None = Depends(actor_directory),
    db: Session = Depends(get_db),
):
    """What the Change Detection screen draws its detection list from.

    A run can produce thousands of polygons and this read used to return every
    one of them — `.all()` with no limit, no offset and no extent, the one place
    the project's "no unbounded map query" rule was still broken and the only
    one of them on the server side. It is a window now, and `metadata.total` is
    how many exist behind it, so a client can page honestly rather than guess
    whether it already has everything.

    The FeatureCollection shape is unchanged: `metadata` is additive and the
    portal reads `features` alone today.
    """
    _get_owned_job(job_id, db, user_id)
    query = db.query(ChangePolygon).filter(ChangePolygon.job_id == job_id)
    box = _parse_bbox(bbox)
    if box is not None:
        query = query.filter(bbox_rules.intersects(
            ChangePolygon.geometry, box, dialect=bbox_rules.dialect_of(db), geojson=True))

    total = query.count()
    polys = query.order_by(ChangePolygon.id).offset(offset).limit(limit).all()
    names = resolve_actor_names(directory, (p.reviewed_by for p in polys))
    cases = _linked_cases(db, [p.id for p in polys])
    return {
        "type": "FeatureCollection",
        "features": [_as_feature(p, names, cases.get(p.id)) for p in polys],
        "metadata": {
            "count": len(polys), "total": total, "limit": limit, "offset": offset,
            "bbox": [box.west, box.south, box.east, box.north] if box else None,
        },
    }


@router.get("/analyses/{job_id}/polygons/{polygon_id}/preview.png")
def polygon_preview(
    job_id: int,
    polygon_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    from ..preview import render_polygon_preview
    job = _get_owned_job(job_id, db, user_id)
    poly = db.get(ChangePolygon, polygon_id)
    if poly is None or poly.job_id != job.id:
        raise HTTPException(404, "Polygon not found")
    # Same rule as the tile routes: the window reads and PNG compositing below
    # take orders of magnitude longer than the two queries above, and hovering
    # a result list fires these in bursts. Release before rendering.
    geometry, jid = poly.geometry, job.id
    db.close()
    png = render_polygon_preview(jid, geometry)
    if png is None:
        raise HTTPException(404, "No aligned rasters stored — re-run the analysis")
    return Response(png, media_type="image/png",
                    headers={"Cache-Control": "private, max-age=86400"})


@router.patch("/analyses/{job_id}/polygons/{polygon_id}/review",
              response_model=PolygonReviewOut)
def review_polygon(
    job_id: int,
    polygon_id: int,
    body: PolygonReview,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    """Officer adjudication: confirm a real violation or mark a false positive.

    This is the human-in-the-loop step. Confirmed/rejected polygons become the
    labelled examples exported by /feedback-dataset for the next fine-tuning
    cycle — the model is never retrained on its own unverified output.
    """
    job = _get_owned_job(job_id, db, user_id)
    poly = db.get(ChangePolygon, polygon_id)
    if poly is None or poly.job_id != job.id:
        raise HTTPException(404, "Polygon not found")

    poly.review_status = body.status
    poly.review_note = body.note
    if body.status == "pending":
        poly.reviewed_by = None
        poly.reviewed_at = None
    else:
        poly.reviewed_by = user_id
        poly.reviewed_at = datetime.now(UTC)
    db.commit()
    db.refresh(poly)
    return poly


@router.get("/analyses/{job_id}/report.geojson")
def download_report_geojson(
    job_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    """Full evidence pack for one run, as GeoJSON (EPSG:4326)."""
    job = _get_owned_job(job_id, db, user_id)
    polys = db.query(ChangePolygon).filter(ChangePolygon.job_id == job_id).all()
    fc = {
        "type": "FeatureCollection",
        "crs": {"type": "name",
                "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
        "metadata": {
            "analysis_id": job.id,
            "project_id": job.project_id,
            "mode": job.mode,
            "raster_t1_id": job.raster_t1_id,
            "raster_t2_id": job.raster_t2_id,
            "generated_at": datetime.now(UTC).isoformat(),
            "finished_at": job.finished_at.isoformat() if job.finished_at else None,
            "stats": job.stats,
        },
        "features": [_as_feature(p) for p in polys],
    }
    return Response(
        json.dumps(fc, indent=2), media_type="application/geo+json",
        headers={"Content-Disposition":
                 f'attachment; filename="ada_analysis_{job_id}.geojson"'})


@router.get("/analyses/{job_id}/report.csv")
def download_report_csv(
    job_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    """Tabular violation register — the sheet an enforcement officer works from."""
    _get_owned_job(job_id, db, user_id)
    polys = db.query(ChangePolygon).filter(ChangePolygon.job_id == job_id).all()

    buf = io.StringIO()
    writer = csv.writer(buf, lineterminator="\n")
    writer.writerow([
        "polygon_id", "label", "status", "area_m2", "confidence",
        "red_zone_overlap_pct", "centroid_lon", "centroid_lat",
        "review_status", "reviewed_by", "reviewed_at", "review_note",
    ])
    for p in polys:
        lon, lat = _centroid(p.geometry)
        props = p.properties or {}
        writer.writerow([
            p.id, props.get("label", ""), props.get("status", ""),
            props.get("area_m2", ""), props.get("confidence", ""),
            props.get("red_zone_overlap_pct", ""),
            f"{lon:.7f}" if lon is not None else "",
            f"{lat:.7f}" if lat is not None else "",
            p.review_status or "pending", p.reviewed_by or "",
            p.reviewed_at.isoformat() if p.reviewed_at else "",
            (p.review_note or "").replace("\n", " "),
        ])
    return Response(
        buf.getvalue(), media_type="text/csv",
        headers={"Content-Disposition":
                 f'attachment; filename="ada_violations_{job_id}.csv"'})


@router.get("/projects/{project_id}/feedback-dataset")
def feedback_dataset(
    project_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    """Officer-verified labels accumulated across every run in this project.

    Positives = confirmed violations, negatives = rejected false positives.
    This is the input to the periodic fine-tuning cycle; it is deliberately a
    plain GeoJSON export so retraining can happen offline, on any machine,
    without coupling the training job to this API.
    """
    get_owned_project(project_id, db, user_id)
    rows = (db.query(ChangePolygon)
            .join(AnalysisJob, ChangePolygon.job_id == AnalysisJob.id)
            .filter(AnalysisJob.project_id == project_id,
                    ChangePolygon.review_status.in_(("confirmed", "rejected")))
            .all())
    features = []
    for p in rows:
        f = _as_feature(p)
        f["properties"]["analysis_id"] = p.job_id
        # supervised target for the next fine-tune: 1 = real change, 0 = FP
        f["properties"]["training_label"] = (
            1 if p.review_status == "confirmed" else 0)
        features.append(f)
    confirmed = sum(1 for f in features if f["properties"]["training_label"] == 1)
    return {
        "type": "FeatureCollection",
        "metadata": {
            "project_id": project_id,
            "exported_at": datetime.now(UTC).isoformat(),
            "labelled": len(features),
            "confirmed": confirmed,
            "rejected": len(features) - confirmed,
        },
        "features": features,
    }


@router.delete("/analyses/{job_id}")
def delete_analysis(
    job_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    from pathlib import Path
    job = _get_owned_job(job_id, db, user_id)
    if job.mask_cog_path:
        Path(job.mask_cog_path).unlink(missing_ok=True)
    db.delete(job)
    db.commit()
    return {"ok": True}
