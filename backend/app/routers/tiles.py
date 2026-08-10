"""Dynamic XYZ tile endpoints (rio-tiler, the engine behind TiTiler).

Serves the uploaded display COGs and the change-mask COGs as standard
WebMercator tiles that MapLibre consumes directly.
"""

from fastapi import APIRouter, Depends, HTTPException, Response
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.io import Reader
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import current_user_id, get_owned_project
from ..models import AnalysisJob, Raster

router = APIRouter(prefix="/tiles", tags=["tiles"])

# Change-heat colormap: transparent below threshold, amber->red ramp above.
_MASK_COLORMAP: dict[int, tuple[int, int, int, int]] = {}
for v in range(101):
    if v < int(settings.change_threshold * 100):
        _MASK_COLORMAP[v] = (0, 0, 0, 0)
    else:
        t = (v - settings.change_threshold * 100) / max(1, 100 - settings.change_threshold * 100)
        _MASK_COLORMAP[v] = (255, int(140 - 100 * t), 40, int(90 + 130 * t))
_MASK_COLORMAP[255] = (0, 0, 0, 0)  # nodata


def _tile_response(path: str, z: int, x: int, y: int,
                   colormap: dict | None = None) -> Response:
    try:
        with Reader(path) as reader:
            img = reader.tile(x, y, z)
    except TileOutsideBounds:
        raise HTTPException(404, "Tile outside raster bounds")
    content = img.render(img_format="PNG", colormap=colormap)
    return Response(content, media_type="image/png",
                    headers={"Cache-Control": "private, max-age=3600"})


def _get_owned_raster(raster_id: int, db: Session, user_id: str) -> Raster:
    raster = db.get(Raster, raster_id)
    if raster is None:
        raise HTTPException(404, "Raster not found")
    get_owned_project(raster.project_id, db, user_id)
    if not raster.cog_path:
        raise HTTPException(409, "Raster is still processing")
    return raster


@router.get("/raster/{raster_id}/info")
async def raster_tile_info(
    raster_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    raster = _get_owned_raster(raster_id, db, user_id)
    with Reader(raster.cog_path) as reader:
        return {
            "bounds": list(reader.get_geographic_bounds("EPSG:4326")),
            "minzoom": reader.minzoom,
            "maxzoom": reader.maxzoom,
        }


@router.get("/raster/{raster_id}/{z}/{x}/{y}.png")
async def raster_tile(
    raster_id: int, z: int, x: int, y: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    raster = _get_owned_raster(raster_id, db, user_id)
    return _tile_response(raster.cog_path, z, x, y)


@router.get("/mask/{job_id}/{z}/{x}/{y}.png")
async def mask_tile(
    job_id: int, z: int, x: int, y: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    job = db.get(AnalysisJob, job_id)
    if job is None:
        raise HTTPException(404, "Analysis not found")
    get_owned_project(job.project_id, db, user_id)
    if not job.mask_cog_path:
        raise HTTPException(409, "Analysis has no mask yet")
    return _tile_response(job.mask_cog_path, z, x, y, colormap=_MASK_COLORMAP)
