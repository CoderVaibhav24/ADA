"""Dynamic XYZ tile endpoints (rio-tiler, the engine behind TiTiler).

Serves the uploaded display COGs and the change-mask COGs as standard
WebMercator tiles that MapLibre consumes directly.

The endpoints are `def`, not `async def`, and that is load-bearing here: a tile
is a blocking GDAL read, and MapLibre asks for a dozen at once. On the event
loop those serialised behind each other AND blocked every other request in the
process; in FastAPI's threadpool they overlap, because GDAL releases the GIL
while it reads.
"""

from contextlib import contextmanager

from fastapi import APIRouter, Depends, HTTPException, Response
from rasterio.errors import RasterioError  # base class of RasterioIOError
from rio_tiler.errors import TileOutsideBounds
from rio_tiler.io import Reader
from sqlalchemy.orm import Session

from ..config import settings
from ..database import get_db
from ..deps import current_user_id, get_owned_project
from ..models import AnalysisJob, Raster
from ..services.storage import MissingImageryError, require_file

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


@contextmanager
def _open_raster(path: str, what: str):
    """Open a stored raster, turning I/O failures into clean HTTP errors.

    A row can outlive its file (see services.storage), and an unreadable
    file is a server-side data problem — neither should reach the client as
    an ASGI traceback.
    """
    try:
        checked = require_file(path, what)
    except MissingImageryError as exc:
        raise HTTPException(404, str(exc)) from exc
    try:
        with Reader(str(checked)) as reader:
            yield reader
    except RasterioError as exc:
        raise HTTPException(500, f"{what} could not be read: {exc}") from exc


def _tile_response(path: str, what: str, z: int, x: int, y: int,
                   colormap: dict | None = None) -> Response:
    with _open_raster(path, what) as reader:
        try:
            img = reader.tile(x, y, z)
        except TileOutsideBounds:
            raise HTTPException(404, "Tile outside raster bounds")
    content = img.render(img_format="PNG", colormap=colormap)
    return Response(content, media_type="image/png",
                    headers={"Cache-Control": "private, max-age=3600"})


def _resolve_raster(raster_id: int, db: Session, user_id: str) -> tuple[str, str]:
    """Authorise, take the COG path, and hand the DB connection straight back.

    This is the hot path of the whole application: MapLibre asks for a dozen
    tiles at once and keeps asking as the user pans. The row lookup takes
    microseconds and the GDAL read that follows takes hundreds of milliseconds,
    so holding a pooled connection across the read means concurrent tile
    requests pin one connection each for their whole duration.

    That is what starved the pool. With the request threadpool 40 wide and the
    pool 20+20, a tile storm could hold every connection; one more request —
    a raster list, an analysis delete — then blocked on `pool_timeout` for 30 s
    and the dev proxy gave up with a 408 long before that. Releasing here keeps
    connection demand proportional to queries rather than to pixels.
    """
    raster = db.get(Raster, raster_id)
    if raster is None:
        raise HTTPException(404, "Raster not found")
    get_owned_project(raster.project_id, db, user_id)
    if not raster.cog_path:
        raise HTTPException(409, "Raster is still processing")
    # Read every attribute BEFORE closing — the instance is detached after.
    path = raster.cog_path
    label = f"Imagery for raster {raster.id} ('{raster.name}')"
    db.close()
    return path, label


@router.get("/raster/{raster_id}/info")
def raster_tile_info(
    raster_id: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    path, label = _resolve_raster(raster_id, db, user_id)
    with _open_raster(path, label) as reader:
        return {
            "bounds": list(reader.get_geographic_bounds("EPSG:4326")),
            "minzoom": reader.minzoom,
            "maxzoom": reader.maxzoom,
        }


@router.get("/raster/{raster_id}/{z}/{x}/{y}.png")
def raster_tile(
    raster_id: int, z: int, x: int, y: int,
    user_id: str = Depends(current_user_id),
    db: Session = Depends(get_db),
):
    path, label = _resolve_raster(raster_id, db, user_id)
    return _tile_response(path, label, z, x, y)


@router.get("/mask/{job_id}/{z}/{x}/{y}.png")
def mask_tile(
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
    path, label = job.mask_cog_path, f"Change mask for analysis {job.id}"
    db.close()          # see _resolve_raster — never hold a connection over a read
    return _tile_response(path, label, z, x, y, colormap=_MASK_COLORMAP)
