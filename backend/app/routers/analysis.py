import csv
import io
import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import current_user_id, get_owned_project
from ..models import AnalysisJob, ChangePolygon, Raster
from ..schemas import (AnalysisCreate, AnalysisOut, PolygonReview,
                       PolygonReviewOut)
from ..services import jobs

router = APIRouter(tags=["analysis"])


def _centroid(geom: dict) -> tuple[float | None, float | None]:
    """Representative lon/lat for a GeoJSON Polygon/MultiPolygon."""
    try:
        from shapely.geometry import shape
        pt = shape(geom).representative_point()
        return pt.x, pt.y
    except Exception:
        return None, None


@router.post("/projects/{project_id}/analyses", response_model=AnalysisOut)
def create_analysis(
    project_id: int,
    body: AnalysisCreate,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    get_owned_project(project_id, db, user_id)
    if body.raster_t1_id == body.raster_t2_id:
        raise HTTPException(400, "Pick two different maps for T1 and T2")
    for rid in (body.raster_t1_id, body.raster_t2_id):
        raster = db.get(Raster, rid)
        if raster is None or raster.project_id != project_id:
            raise HTTPException(404, f"Raster {rid} not found in this project")
        if raster.status != "ready":
            raise HTTPException(400, f"Raster '{raster.name}' is not ready yet")

    job = AnalysisJob(project_id=project_id, raster_t1_id=body.raster_t1_id,
                      raster_t2_id=body.raster_t2_id, mode=body.mode)
    db.add(job)
    db.commit()
    db.refresh(job)
    jobs.submit_analysis(job.id)
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


def _as_feature(p: ChangePolygon) -> dict:
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
            "reviewed_at": p.reviewed_at.isoformat() if p.reviewed_at else None,
        },
    }


@router.get("/analyses/{job_id}", response_model=AnalysisOut)
def get_analysis(
    job_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    return _get_owned_job(job_id, db, user_id)


@router.get("/analyses/{job_id}/features")
def get_analysis_features(
    job_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    _get_owned_job(job_id, db, user_id)
    polys = db.query(ChangePolygon).filter(ChangePolygon.job_id == job_id).all()
    return {
        "type": "FeatureCollection",
        "features": [_as_feature(p) for p in polys],
    }


@router.get("/analyses/{job_id}/polygons/{polygon_id}/preview.png")
def polygon_preview(
    job_id: int,
    polygon_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    from ..services.preview import render_polygon_preview
    job = _get_owned_job(job_id, db, user_id)
    poly = db.get(ChangePolygon, polygon_id)
    if poly is None or poly.job_id != job.id:
        raise HTTPException(404, "Polygon not found")
    png = render_polygon_preview(job.id, poly.geometry)
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
        poly.reviewed_at = datetime.now(timezone.utc)
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
            "generated_at": datetime.now(timezone.utc).isoformat(),
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
            "exported_at": datetime.now(timezone.utc).isoformat(),
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
