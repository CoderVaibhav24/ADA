"""Per-parcel built area, tolerance verdict and change class for one analysis run.

Measures the per-epoch building probability maps inside every active cadastral
parcel (`icms_parcel`, read-only) that the scene covers, block by block so no
full-scene label raster is ever held, and writes one `analysis_parcel_result`
row per parcel. The summary goes into `AnalysisJob.stats["parcels"]`.
"""

from __future__ import annotations

import json
import logging
from collections import Counter
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

import numpy as np
import shapely
from ada_core.models import AnalysisParcelResult
from ada_core.models_icms import Parcel
from pyproj import CRS, Geod, Transformer
from rasterio.features import rasterize
from rasterio.transform import Affine, array_bounds
from rasterio.warp import transform_bounds
from shapely.geometry import box, shape
from sqlalchemy import Text, delete, func, select
from sqlalchemy.orm import Session

from .config import settings

log = logging.getLogger("ada.parcels")

__all__ = ["ParcelRecord", "ParcelSummary", "clear_rows", "load_parcels", "measure",
           "parcel_key", "run_parcel_stage"]

_GEOD = Geod(ellps="WGS84")
HISTOGRAM_BINS = 20


@dataclass(frozen=True)
class ParcelRecord:
    """One cadastral parcel as the stage needs it; geometry in EPSG:4326."""

    id: int
    parcel_key: str | None
    sanctioned_area_sqm: float | None
    geometry: object


@dataclass
class ParcelSummary:
    parcels_total: int = 0
    assessable: int = 0
    bias_offset_sqm: float | None = None
    histogram: dict = field(default_factory=lambda: {"bin_edges": [], "counts": []})
    counts_by_class: dict[str, int] = field(default_factory=dict)
    counts_by_verdict_t1: dict[str, int] = field(default_factory=dict)
    counts_by_verdict_t2: dict[str, int] = field(default_factory=dict)
    skipped: str | None = None
    records: list[ParcelRecord] | None = field(default=None, repr=False, compare=False)

    def as_stats(self) -> dict:
        if self.skipped:
            return {"skipped": self.skipped}
        return {
            "parcels_total": self.parcels_total,
            "assessable": self.assessable,
            "bias_offset_sqm": self.bias_offset_sqm,
            "histogram": self.histogram,
            "counts_by_class": self.counts_by_class,
            "counts_by_verdict_t1": self.counts_by_verdict_t1,
            "counts_by_verdict_t2": self.counts_by_verdict_t2,
        }


# Same rule as ada-api boundary_import.parcel_key: `lgd/khasra` or `SECTOR#plot`.
def parcel_key(village_lgd: str | None, khasra_no: str | None, sector: str | None,
               plot_no: str | None) -> str | None:
    if village_lgd and khasra_no:
        return f"{village_lgd}/{khasra_no}"
    if sector and plot_no:
        return f"{sector}#{plot_no}"
    return None


def _geojson(value) -> dict | None:
    if value in (None, ""):
        return None
    if isinstance(value, (bytes, bytearray)):
        value = value.decode()
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except ValueError:
            return None
    return value if isinstance(value, dict) and value.get("coordinates") else None


def load_parcels(db: Session, bounds_4326: tuple[float, float, float, float]
                 ) -> list[ParcelRecord]:
    """Active parcels intersecting [w, s, e, n]; PostGIS filters, SQLite (tests) filters here."""
    w, s, e, n = bounds_4326
    postgres = db.get_bind().dialect.name == "postgresql"
    geom = func.ST_AsGeoJSON(Parcel.geom, 9).cast(Text) if postgres else Parcel.geom
    query = select(Parcel.id, Parcel.village_lgd, Parcel.khasra_no, Parcel.sector,
                   Parcel.plot_no, Parcel.sanctioned_area_sqm, geom).where(
        Parcel.active.is_(True))
    if postgres:
        query = query.where(func.ST_Intersects(
            Parcel.geom, func.ST_MakeEnvelope(w, s, e, n, 4326)))
    extent = box(w, s, e, n)
    out: list[ParcelRecord] = []
    for pid, lgd, khasra, sector, plot, sanctioned, raw in db.execute(query):
        gj = _geojson(raw)
        if gj is None:
            continue
        geometry = shape(gj)
        if geometry.is_empty or not geometry.intersects(extent):
            continue
        out.append(ParcelRecord(
            id=int(pid), parcel_key=parcel_key(lgd, khasra, sector, plot),
            sanctioned_area_sqm=float(sanctioned) if sanctioned is not None else None,
            geometry=geometry))
    return out


def _scene_bounds_4326(pair) -> tuple[float, float, float, float]:
    known = getattr(pair, "grid_bounds_4326", None)
    if known:
        return tuple(float(v) for v in known)
    h, w = pair.valid.shape
    west, south, east, north = array_bounds(h, w, pair.transform)
    return tuple(transform_bounds(CRS.from_user_input(pair.crs), CRS.from_epsg(4326),
                                  west, south, east, north))


def _to_crs(geometries: list, crs) -> list:
    tr = Transformer.from_crs(CRS.from_epsg(4326), CRS.from_user_input(crs), always_xy=True)

    def fn(coords: np.ndarray) -> np.ndarray:
        x, y = tr.transform(coords[:, 0], coords[:, 1])
        return np.column_stack([x, y])

    return [shapely.transform(g, fn) for g in geometries]



def scene_parcels_in_crs(db_factory: Callable[[], Session], pair) -> list:
    """Active parcel geometries under the scene, in the grid CRS, for footprint regularisation."""
    with db_factory() as db:
        records = load_parcels(db, _scene_bounds_4326(pair))
    return _to_crs([r.geometry for r in records], pair.crs)


@dataclass
class _Counts:
    total: np.ndarray
    valid1: np.ndarray
    valid2: np.ndarray
    built1: np.ndarray
    built2: np.ndarray


def _bincount(flat: np.ndarray, mask: np.ndarray, n: int) -> np.ndarray:
    return np.bincount(flat[mask.ravel()], minlength=n)


# Indices of parcels that share area with another parcel (STRtree self-query).
def _overlapping(tree: shapely.STRtree, geoms: list) -> set[int]:
    left, right = tree.query(geoms, predicate="intersects")
    pairs = [(int(a), int(b)) for a, b in zip(left, right, strict=True) if a < b]
    if not pairs:
        return set()
    a_idx, b_idx = (np.array(v) for v in zip(*pairs, strict=True))
    shared = shapely.area(shapely.intersection(np.asarray(geoms, dtype=object)[a_idx],
                                               np.asarray(geoms, dtype=object)[b_idx]))
    out: set[int] = set()
    for a, b, area in zip(a_idx, b_idx, shared, strict=True):
        if area > 0:
            out.update((int(a), int(b)))
    return out


# Accumulates per-parcel pixel counts one block at a time; index 0 is "no parcel".
def _count_pixels(geoms: list, seg1: np.ndarray, seg2: np.ndarray, valid1: np.ndarray,
                  valid2: np.ndarray, transform: Affine, block: int,
                  threshold: float) -> _Counts:
    n = len(geoms) + 1
    counts = _Counts(*(np.zeros(n, np.int64) for _ in range(5)))
    height, width = valid1.shape
    tree = shapely.STRtree(geoms)
    overlapping = _overlapping(tree, geoms)
    for row in range(0, height, block):
        for col in range(0, width, block):
            h, w = min(block, height - row), min(block, width - col)
            block_transform = transform @ Affine.translation(col, row)
            west, south, east, north = array_bounds(h, w, block_transform)
            hits = tree.query(box(west, south, east, north))
            if not len(hits):
                continue
            window = (slice(row, row + h), slice(col, col + w))
            v1, v2 = valid1[window], valid2[window]
            b1 = (seg1[window] >= threshold) & v1
            b2 = (seg2[window] >= threshold) & v2
            fast = [int(i) for i in hits if int(i) not in overlapping]
            if fast:
                ids = rasterize(((geoms[i], i + 1) for i in fast), out_shape=(h, w),
                                transform=block_transform, fill=0, dtype=np.int32)
                if ids.any():
                    flat = ids.ravel()
                    counts.total += np.bincount(flat, minlength=n)
                    counts.valid1 += _bincount(flat, v1, n)
                    counts.valid2 += _bincount(flat, v2, n)
                    counts.built1 += _bincount(flat, b1, n)
                    counts.built2 += _bincount(flat, b2, n)
            # Overlapping parcels each get their own mask so neither loses shared pixels.
            for i in (int(i) for i in hits if int(i) in overlapping):
                mask = rasterize([(geoms[i], 1)], out_shape=(h, w), transform=block_transform,
                                 fill=0, dtype=np.uint8).astype(bool)
                if not mask.any():
                    continue
                counts.total[i + 1] += int(mask.sum())
                counts.valid1[i + 1] += int((mask & v1).sum())
                counts.valid2[i + 1] += int((mask & v2).sum())
                counts.built1[i + 1] += int((mask & b1).sum())
                counts.built2[i + 1] += int((mask & b2).sum())
    return counts


def verdict(imagery_frac: float, built_frac: float, built_sqm: float,
            sanctioned_sqm: float | None, tolerance_frac: float) -> str:
    """Tolerance verdict for one epoch of one parcel."""
    if imagery_frac < settings.parcel_min_imagery_frac:
        return "insufficient_imagery"
    if not sanctioned_sqm:
        return "not_assessable"
    if built_frac < settings.parcel_vacant_max_frac:
        return "vacant"
    if built_sqm > sanctioned_sqm * (1 + tolerance_frac):
        return "over_tolerance"
    return "within_tolerance"


def change_class(row: dict) -> str:
    """new_build | extension | demolition | unchanged | unassessable from the corrected delta."""
    corrected = row["delta_sqm_corrected"]
    if corrected is None:
        return "unassessable"
    floor = max(settings.parcel_change_min_sqm,
                settings.parcel_change_min_frac * row["parcel_area_sqm"])
    if abs(corrected) < floor:
        return "unchanged"
    if corrected > 0:
        return ("new_build" if row["built_frac_t1"] < settings.parcel_vacant_max_frac
                else "extension")
    return "demolition"


def _histogram(values: list[float]) -> dict:
    if not values:
        return {"bin_edges": [], "counts": []}
    counts, edges = np.histogram(np.asarray(values, dtype=np.float64), bins=HISTOGRAM_BINS)
    return {"bin_edges": [round(float(e), 2) for e in edges],
            "counts": [int(c) for c in counts]}


def measure(parcels: list[ParcelRecord], pair, seg1: np.ndarray, seg2: np.ndarray
            ) -> tuple[list[dict], ParcelSummary]:
    """Rows for analysis_parcel_result (without job_id) and the run summary."""
    valid1 = getattr(pair, "valid1", None)
    valid2 = getattr(pair, "valid2", None)
    valid1 = pair.valid if valid1 is None else valid1
    valid2 = pair.valid if valid2 is None else valid2
    # Pixel area in CRS units squared; each parcel converts it to m2 with its own scale.
    px_crs = abs(pair.transform.a * pair.transform.e)
    height, width = pair.valid.shape
    geoms = _to_crs([p.geometry for p in parcels], pair.crs)
    counts = _count_pixels(geoms, seg1, seg2, valid1, valid2, pair.transform,
                           max(64, int(settings.parcel_block_px)),
                           float(settings.building_threshold))
    grid = box(*array_bounds(height, width, pair.transform))
    tolerance = float(settings.parcel_tolerance_frac)

    rows: list[dict] = []
    for i, (parcel, geom) in enumerate(zip(parcels, geoms, strict=True), start=1):
        total = int(counts.total[i])
        if total == 0:
            continue
        # Share of the parcel inside the grid, exact; times the valid share of its in-grid pixels.
        inside = geom.intersection(grid).area / geom.area if geom.area > 0 else 0.0
        geodesic_sqm = abs(_GEOD.geometry_area_perimeter(parcel.geometry)[0])
        # m2 per CRS unit2 at this parcel: exact for degrees and Mercator, ~1 for UTM.
        px_sqm = (px_crs * geodesic_sqm / geom.area if geom.area > 0
                  else float(pair.resolution_m) ** 2)
        row = {
            "parcel_id": parcel.id,
            "parcel_key": parcel.parcel_key,
            "sanctioned_area_sqm": parcel.sanctioned_area_sqm,
            "parcel_area_sqm": round(geodesic_sqm, 2),
            "tolerance_frac": tolerance,
        }
        for epoch, valid_px, built_px in ((1, int(counts.valid1[i]), int(counts.built1[i])),
                                          (2, int(counts.valid2[i]), int(counts.built2[i]))):
            imagery = min(1.0, inside * valid_px / total)
            built_frac = built_px / valid_px if valid_px else 0.0
            built_sqm = built_px * px_sqm
            row[f"imagery_frac_t{epoch}"] = round(imagery, 4)
            row[f"built_frac_t{epoch}"] = round(built_frac, 4)
            row[f"built_sqm_t{epoch}"] = round(built_sqm, 2)
            row[f"verdict_t{epoch}"] = verdict(imagery, built_frac, built_sqm,
                                               parcel.sanctioned_area_sqm, tolerance)
        assessable = "insufficient_imagery" not in (row["verdict_t1"], row["verdict_t2"])
        row["delta_sqm"] = (round(row["built_sqm_t2"] - row["built_sqm_t1"], 2)
                            if assessable else None)
        rows.append(row)

    deltas = [r["delta_sqm"] for r in rows if r["delta_sqm"] is not None]
    offset = (round(float(np.median(deltas)), 2)
              if deltas and len(deltas) >= settings.parcel_bias_min_parcels else None)
    for row in rows:
        delta = row["delta_sqm"]
        row["delta_sqm_corrected"] = (None if delta is None
                                      else round(delta - (offset or 0.0), 2))
        row["change_class"] = change_class(row)

    summary = ParcelSummary(
        parcels_total=len(rows),
        assessable=len(deltas),
        bias_offset_sqm=offset,
        histogram=_histogram(deltas),
        counts_by_class=dict(Counter(r["change_class"] for r in rows)),
        counts_by_verdict_t1=dict(Counter(r["verdict_t1"] for r in rows)),
        counts_by_verdict_t2=dict(Counter(r["verdict_t2"] for r in rows)),
    )
    return rows, summary


def _write(db_factory: Callable[[], Session], job_id: int, rows: Iterable[dict]) -> None:
    with db_factory() as db:
        db.execute(delete(AnalysisParcelResult).where(AnalysisParcelResult.job_id == job_id))
        db.add_all(AnalysisParcelResult(job_id=job_id, **row) for row in rows)
        db.commit()


def clear_rows(db_factory: Callable[[], Session], job_id: int) -> None:
    """Drop the job's earlier parcel rows so a skipped or failed re-run leaves none behind."""
    _write(db_factory, job_id, [])


def run_parcel_stage(db_factory: Callable[[], Session], job_id: int, pair,
                     seg1: np.ndarray, seg2: np.ndarray, *,
                     parcels: list[ParcelRecord] | None = None) -> ParcelSummary:
    """Measure, classify and store every parcel under the scene; replaces earlier rows."""
    if parcels is None:
        with db_factory() as db:
            parcels = load_parcels(db, _scene_bounds_4326(pair))
    if not parcels:
        _write(db_factory, job_id, [])
        return ParcelSummary(skipped="no cadastral parcel intersects the scene", records=[])
    rows, summary = measure(parcels, pair, seg1, seg2)
    summary.records = parcels
    _write(db_factory, job_id, rows)
    log.info("parcels: job %s measured %d parcel(s), %d assessable, bias %s m2",
             job_id, summary.parcels_total, summary.assessable, summary.bias_offset_sqm)
    return summary
