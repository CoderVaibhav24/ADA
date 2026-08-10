"""Per-polygon before/after preview renderer.

At analysis time the aligned T1/T2 scenes are persisted next to the
mask COG; this module window-reads the patch around a change polygon
from both epochs and composes a side-by-side PNG with the polygon
outlined — the evidence card shown in the map hover popup.
"""

from __future__ import annotations

import io

import numpy as np
import pyproj
import rasterio
from PIL import Image, ImageDraw
from rasterio.transform import rowcol
from rasterio.windows import Window
from shapely.geometry import shape
from shapely.ops import transform as shp_transform

from ..config import settings

PANEL = 200          # px, each epoch panel
HEADER = 18          # px, label strip
MIN_PATCH = 48       # px, minimum window around tiny polygons
PAD = 24             # px, context around the polygon


def aligned_paths(job_id: int):
    return (settings.masks_dir / f"job_{job_id}_t1.tif",
            settings.masks_dir / f"job_{job_id}_t2.tif")


def render_polygon_preview(job_id: int, geometry: dict) -> bytes | None:
    """Side-by-side T1/T2 crop PNG, or None if aligned rasters are absent
    (jobs that ran before this feature existed)."""
    p1, p2 = aligned_paths(job_id)
    if not (p1.is_file() and p2.is_file()):
        return None

    with rasterio.open(p1) as s1, rasterio.open(p2) as s2:
        inv = pyproj.Transformer.from_crs("EPSG:4326", s1.crs,
                                          always_xy=True).transform
        poly = shp_transform(inv, shape(geometry))
        minx, miny, maxx, maxy = poly.bounds
        r0, c0 = rowcol(s1.transform, minx, maxy)
        r1, c1 = rowcol(s1.transform, maxx, miny)
        half = max(r1 - r0, c1 - c0, MIN_PATCH) // 2 + PAD
        cy, cx = (r0 + r1) // 2, (c0 + c1) // 2
        y0, y1 = max(0, cy - half), min(s1.height, cy + half)
        x0, x1 = max(0, cx - half), min(s1.width, cx + half)
        if y1 - y0 < 8 or x1 - x0 < 8:
            return None
        win = Window(x0, y0, x1 - x0, y1 - y0)
        a1 = s1.read(window=win).transpose(1, 2, 0)
        a2 = s2.read(window=win).transpose(1, 2, 0)

        # polygon ring in panel pixel coords
        sx, sy = PANEL / (x1 - x0), PANEL / (y1 - y0)
        rings = []
        geoms = [poly] if poly.geom_type == "Polygon" else list(poly.geoms)
        for g in geoms:
            ring = []
            for X, Y in g.exterior.coords:
                rr, cc = rowcol(s1.transform, X, Y)
                ring.append(((cc - x0) * sx, (rr - y0) * sy + HEADER))
            rings.append(ring)

    card = Image.new("RGB", (PANEL * 2 + 12, PANEL + HEADER + 4), (12, 13, 17))
    for i, (arr, label) in enumerate([(a1, "BEFORE - T1"), (a2, "AFTER - T2")]):
        panel = Image.fromarray(arr.astype(np.uint8)).resize(
            (PANEL, PANEL), Image.LANCZOS)
        ox = 4 + i * (PANEL + 4)
        card.paste(panel, (ox, HEADER))
        d = ImageDraw.Draw(card)
        d.text((ox + 2, 3), label, fill=(255, 176, 66))
        for ring in rings:
            d.line([(x + ox, y) for x, y in ring] , fill=(255, 45, 45), width=2)

    buf = io.BytesIO()
    card.save(buf, format="PNG")
    return buf.getvalue()
