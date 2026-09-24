"""Validation of an uploaded raster before it is handed to ingest (design doc §3.2)."""

from __future__ import annotations

from pathlib import Path

TIFF_MAGICS = (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")

NOT_A_TIFF = "not a TIFF file"
NO_CRS = (
    "The image has no coordinate reference system. Upload it with its .tfw and .prj "
    "sidecar files, or give the EPSG code."
)
# Uncompressed pixel bytes may exceed the file by this fraction before it is called truncated.
_SIZE_TOLERANCE = 0.10


def _has_magic(path: Path) -> bool:
    with path.open("rb") as handle:
        return handle.read(4) in TIFF_MAGICS


# The last block of each band ends furthest into the file; past EOF means the upload was cut off.
def _last_block_end(ds) -> int:
    end = 0
    rows, cols = ds.block_shapes[0]
    x, y = (ds.width - 1) // cols, (ds.height - 1) // rows
    for band in range(1, ds.count + 1):
        offset = ds.get_tag_item(f"BLOCK_OFFSET_{x}_{y}", "TIFF", bidx=band)
        size = ds.get_tag_item(f"BLOCK_SIZE_{x}_{y}", "TIFF", bidx=band)
        if offset and size:
            end = max(end, int(offset) + int(size))
    return end


# The reason is shown to the officer verbatim; None lets the file go on to ingest.
def validate_raster_file(
    path: Path, has_tfw: bool, has_prj: bool, crs_epsg: int | None,
) -> str | None:
    """None when the file can go to ingest, else the reason it is rejected."""
    path = Path(path)
    try:
        if not path.is_file() or not _has_magic(path):
            return NOT_A_TIFF
    except OSError:
        return NOT_A_TIFF

    import rasterio
    from rasterio.errors import RasterioError

    try:
        with rasterio.open(path) as ds:
            width, height, bands = ds.width, ds.height, ds.count
            dtype = ds.dtypes[0] if ds.dtypes else "uint8"
            crs = ds.crs
            compression = ds.compression
            driver = ds.driver
            block_end = _last_block_end(ds) if ds.count else 0
    except (RasterioError, OSError) as exc:
        return f"the file could not be read as a GeoTIFF ({exc})"

    if driver != "GTiff":
        return NOT_A_TIFF
    if width <= 0 or height <= 0:
        return "the image has no pixels"
    if not 1 <= bands <= 4:
        return f"the image has {bands} bands; 1 to 4 are supported"
    if crs is None and not (has_tfw and has_prj) and not crs_epsg:
        return NO_CRS

    actual = path.stat().st_size
    if block_end > actual:
        return f"the file is truncated: {actual} bytes on disk, pixel data runs to {block_end}"
    if compression is None:
        import numpy as np

        expected = width * height * bands * np.dtype(dtype).itemsize
        if actual < expected * (1 - _SIZE_TOLERANCE):
            return (f"the file is truncated: {actual} bytes on disk for "
                    f"{expected} bytes of uncompressed pixels")
    return None
