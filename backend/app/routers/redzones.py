from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..deps import current_user_id, get_owned_project
from ..models import RedZone
from ..schemas import RedZoneCreate, RedZoneOut

router = APIRouter(tags=["red-zones"])


@router.post("/projects/{project_id}/red-zones", response_model=RedZoneOut)
def create_red_zone(
    project_id: int,
    body: RedZoneCreate,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    get_owned_project(project_id, db, user_id)
    if body.geometry.get("type") not in ("Polygon", "MultiPolygon"):
        raise HTTPException(400, "geometry must be a GeoJSON Polygon/MultiPolygon")
    zone = RedZone(project_id=project_id, name=body.name, geometry=body.geometry)
    db.add(zone)
    db.commit()
    db.refresh(zone)
    return zone


@router.get("/projects/{project_id}/red-zones", response_model=list[RedZoneOut])
def list_red_zones(
    project_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    get_owned_project(project_id, db, user_id)
    return (db.query(RedZone).filter(RedZone.project_id == project_id)
            .order_by(RedZone.created_at).all())


@router.delete("/red-zones/{zone_id}")
def delete_red_zone(
    zone_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    zone = db.get(RedZone, zone_id)
    if zone is None:
        raise HTTPException(404, "Red zone not found")
    get_owned_project(zone.project_id, db, user_id)
    db.delete(zone)
    db.commit()
    return {"ok": True}
