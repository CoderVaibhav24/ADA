"""What makes an upload acceptable to ingest (design doc §3.2)."""

from __future__ import annotations

from app import uploads_bitmap
from app.raster_validation import NO_CRS, NOT_A_TIFF, validate_raster_file
from tests.geotiffs import write_geotiff


def test_a_georeferenced_geotiff_passes(tmp_path):
    assert validate_raster_file(write_geotiff(tmp_path / "a.tif"), False, False, None) is None


def test_a_compressed_geotiff_passes(tmp_path):
    path = write_geotiff(tmp_path / "a.tif", compress="deflate")
    assert validate_raster_file(path, False, False, None) is None


def test_no_crs_is_rejected(tmp_path):
    path = write_geotiff(tmp_path / "a.tif", crs=None)
    assert validate_raster_file(path, False, False, None) == NO_CRS


def test_no_crs_passes_with_sidecars_or_an_epsg(tmp_path):
    path = write_geotiff(tmp_path / "a.tif", crs=None)
    assert validate_raster_file(path, True, True, None) is None
    assert validate_raster_file(path, False, False, 32644) is None
    assert validate_raster_file(path, True, False, None) == NO_CRS


def test_a_renamed_jpeg_is_not_a_tiff(tmp_path):
    path = tmp_path / "photo.tif"
    path.write_bytes(b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + b"\x00" * 512)
    assert validate_raster_file(path, False, False, None) == NOT_A_TIFF


def test_a_truncated_geotiff_is_rejected(tmp_path):
    path = write_geotiff(tmp_path / "a.tif", size=128)
    data = path.read_bytes()
    path.write_bytes(data[: len(data) // 2])
    reason = validate_raster_file(path, False, False, None)
    assert reason is not None and ("truncated" in reason or "could not be read" in reason)


def test_a_truncated_compressed_geotiff_is_rejected(tmp_path):
    path = write_geotiff(tmp_path / "a.tif", size=128, compress="deflate")
    data = path.read_bytes()
    path.write_bytes(data[: len(data) - 200])
    assert validate_raster_file(path, False, False, None) is not None


def test_five_bands_are_refused(tmp_path):
    path = write_geotiff(tmp_path / "a.tif", bands=5)
    assert "5 bands" in validate_raster_file(path, False, False, None)


def test_a_missing_file_is_not_a_tiff(tmp_path):
    assert validate_raster_file(tmp_path / "nope.tif", False, False, None) == NOT_A_TIFF


def test_bigtiff_magic_is_accepted(tmp_path):
    import numpy as np
    import rasterio
    from rasterio.transform import from_origin

    path = tmp_path / "big.tif"
    with rasterio.open(path, "w", driver="GTiff", width=16, height=16, count=1, dtype="uint8",
                       crs="EPSG:4326", transform=from_origin(78, 27, 0.001, 0.001),
                       BIGTIFF="YES") as ds:
        ds.write(np.zeros((1, 16, 16), dtype="uint8"))
    assert path.read_bytes()[:4] == b"II+\x00"
    assert validate_raster_file(path, False, False, None) is None


# ------------------------------------------------------------------ bitmap
def test_bitmap_set_get_count_missing():
    bitmap = ""
    for n in (0, 3, 9):
        bitmap = uploads_bitmap.set_bit(bitmap, n)
    assert uploads_bitmap.get_bit(bitmap, 3)
    assert not uploads_bitmap.get_bit(bitmap, 4)
    assert not uploads_bitmap.get_bit(bitmap, 100)
    assert uploads_bitmap.count(bitmap) == 3
    assert uploads_bitmap.received(bitmap, 12) == [0, 3, 9]
    assert uploads_bitmap.missing(bitmap, 12) == [1, 2, 4, 5, 6, 7, 8, 10, 11]


def test_bitmap_set_is_idempotent_and_empty_is_nothing():
    once = uploads_bitmap.set_bit(None, 5)
    assert uploads_bitmap.set_bit(once, 5) == once
    assert uploads_bitmap.count("") == 0 and uploads_bitmap.count(None) == 0
    assert uploads_bitmap.missing(None, 3) == [0, 1, 2]


def test_bitmap_holds_a_64_gib_upload():
    bitmap = ""
    for n in range(1024):
        bitmap = uploads_bitmap.set_bit(bitmap, n)
    assert uploads_bitmap.missing(bitmap, 1024) == []
    assert len(bitmap) == 256
