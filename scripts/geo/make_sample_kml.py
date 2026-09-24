"""Write data/samples/agra-boundaries-sample.kml: the importer's fixture and the authority's example.

Synthetic geometry around Agra, standard library only. Run from the repo root:

    python scripts/geo/make_sample_kml.py
"""

from __future__ import annotations

import itertools
import math
from pathlib import Path
from xml.sax.saxutils import escape

OUT = Path(__file__).resolve().parents[2] / "data" / "samples" / "agra-boundaries-sample.kml"

DESCRIPTION = (
    "SAMPLE ONLY - NOT SURVEY DATA. Synthetic rectangles and hexagons placed near Agra "
    "to show the layout docs/icms/kml-import-spec.md asks for. Codes, khasra numbers, "
    "ULPINs and owner names are invented. An OpenStreetMap Overpass query for Agra ward "
    "boundaries (boundary=administrative, admin_level=10) returned nothing on 2026-09-24, "
    "so no real outline is used and no ODbL attribution is needed."
)


def box(west: float, south: float, east: float, north: float) -> list[tuple[float, float]]:
    return [(west, south), (east, south), (east, north), (west, north), (west, south)]


def hexagon(lon: float, lat: float, r: float) -> list[tuple[float, float]]:
    ring = [(round(lon + r * math.cos(math.radians(a)), 6),
             round(lat + r * math.sin(math.radians(a)), 6)) for a in range(0, 360, 60)]
    return [*ring, ring[0]]


def area_sqm(ring: list[tuple[float, float]]) -> float:
    lat = math.radians(sum(y for _, y in ring[:-1]) / (len(ring) - 1))
    twice = sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in itertools.pairwise(ring))
    return round(abs(twice) / 2 * 111_320 * math.cos(lat) * 110_540, 2)


ZONES = [
    ("LOHAMANDI", "Lohamandi (sample)", "लोहामंडी (नमूना)",
     [(77.960, 27.170), (78.010, 27.170), (78.010, 27.230), (77.985, 27.235),
      (77.960, 27.230), (77.960, 27.170)]),
    ("HARIPARVAT", "Hari Parvat (sample)", "हरीपर्वत (नमूना)",
     [(78.010, 27.180), (78.060, 27.180), (78.060, 27.230), (78.035, 27.233),
      (78.010, 27.230), (78.010, 27.180)]),
    ("TAJGANJ", "Taj Ganj (sample)", "ताजगंज (नमूना)",
     [(78.010, 27.110), (78.040, 27.107), (78.070, 27.110), (78.070, 27.180),
      (78.010, 27.180), (78.010, 27.110)]),
]

VILLAGES = [
    ("900101", "Sample Village A", "नमूना गाँव क", "Agra Sadar", box(77.970, 27.180, 78.000, 27.215)),
    ("900102", "Sample Village B", "नमूना गाँव ख", "Agra Sadar", box(78.020, 27.190, 78.050, 27.222)),
    ("900103", "Sample Village C", "नमूना गाँव ग", "Agra Sadar", box(78.020, 27.120, 78.036, 27.160)),
    ("900104", "Sample Village D", "नमूना गाँव घ", "Etmadpur", box(78.045, 27.120, 78.065, 27.160)),
]

LAND_USES = ["residential", "agricultural", "commercial", "residential"]


def parcels() -> list[dict]:
    rows = []
    for n, (lgd, _, _, _, ring) in enumerate(VILLAGES):
        west, south = ring[0]
        for k in range(2):
            x = west + 0.002 + k * 0.001
            polys = [box(x, south + 0.003, x + 0.0006, south + 0.0035)]
            if n == 3 and k == 1:
                # One parcel in two pieces, so the fixture exercises MultiGeometry.
                polys.append(box(x, south + 0.0038, x + 0.0003, south + 0.0041))
            rows.append({
                "khasra_no": f"{101 + n * 10 + k}" if k == 0 else f"{101 + n * 10 + k}/1",
                "village_lgd": lgd,
                "ulpin": f"0911890{n + 1:02d}00{k + 1:03d}",
                "land_use": LAND_USES[n],
                "owner_name": f"SAMPLE Owner {n * 2 + k + 1}",
                "area_sqm": f"{sum(area_sqm(p) for p in polys):.2f}",
                "polys": polys,
            })
    return rows


RESERVED = [
    ("heritage", "Taj Mahal buffer (sample)", "SAMPLE/ASI-BUFFER/001",
     [hexagon(78.0421, 27.1751, 0.003)]),
    ("park", "Sample Park", "SAMPLE/ADA-PARK/014", [box(78.050, 27.165, 78.054, 27.169)]),
    ("water", "Sample Pond", "SAMPLE/REV-POND/007", [box(78.040, 27.212, 78.046, 27.218)]),
]


def coordinates(ring: list[tuple[float, float]]) -> str:
    return " ".join(f"{x:.6f},{y:.6f}" for x, y in ring)


def polygon(ring: list[tuple[float, float]]) -> str:
    return ("<Polygon><outerBoundaryIs><LinearRing><coordinates>"
            f"{coordinates(ring)}</coordinates></LinearRing></outerBoundaryIs></Polygon>")


def placemark(name: str, data: dict[str, str], rings: list[list[tuple[float, float]]]) -> str:
    fields = "".join(f'<Data name="{k}"><value>{escape(v)}</value></Data>' for k, v in data.items())
    geometry = polygon(rings[0]) if len(rings) == 1 else (
        "<MultiGeometry>" + "".join(polygon(r) for r in rings) + "</MultiGeometry>")
    return (f"    <Placemark>\n      <name>{escape(name)}</name>\n"
            f"      <ExtendedData>{fields}</ExtendedData>\n      {geometry}\n    </Placemark>\n")


def folder(name: str, marks: list[str]) -> str:
    return f"  <Folder>\n    <name>{name}</name>\n{''.join(marks)}  </Folder>\n"


def build() -> str:
    zones = [placemark(name, {"zone_cd": cd, "zone_name": name, "zone_name_hi": hi}, [ring])
             for cd, name, hi, ring in ZONES]
    villages = [placemark(name, {"village_lgd": lgd, "village_name": name, "village_name_hi": hi,
                                 "tehsil": tehsil, "district_lgd": "118"}, [ring])
                for lgd, name, hi, tehsil, ring in VILLAGES]
    plots = [placemark(f"Khasra {p['khasra_no']}",
                       {k: v for k, v in p.items() if k != "polys"}, p["polys"])
             for p in parcels()]
    reserved = [placemark(name, {"feature_type": kind, "name": name, "source_ref": ref}, rings)
                for kind, name, ref, rings in RESERVED]
    return (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<kml xmlns="http://www.opengis.net/kml/2.2">\n<Document>\n'
        "  <name>SAMPLE - Agra Development Authority boundary layers</name>\n"
        f"  <description>{escape(DESCRIPTION)}</description>\n"
        + folder("zones", zones) + folder("villages", villages)
        + folder("parcels", plots) + folder("reserved", reserved)
        + "</Document>\n</kml>\n"
    )


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(build(), encoding="utf-8")
    print(f"wrote {OUT}")
