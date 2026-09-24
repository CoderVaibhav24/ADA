"""Server-side checks and the server-stamped derivative of an evidence photograph."""

from __future__ import annotations

import math
import os
import tempfile
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

from ada_core.datetimes import IST
from PIL import Image, ImageDraw, ImageFont, ImageOps

from ..config import settings

__all__ = ["StampFacts", "exif_gps", "haversine_m", "write_stamped"]

_GPS_IFD = 0x8825
_EARTH_RADIUS_M = 6_371_008.8


@dataclass(frozen=True)
class StampFacts:
    case_ref: str
    inspection_ref: str
    latitude: float
    longitude: float
    accuracy_m: float | None
    device_timestamp: datetime | None
    received_at: datetime
    distance_to_site_m: float | None


# Great-circle distance in metres between two WGS84 points.
def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * _EARTH_RADIUS_M * math.asin(math.sqrt(min(1.0, a)))


def _degrees(dms, ref) -> float | None:
    try:
        d, m, s = (float(part) for part in dms)
    except (TypeError, ValueError, ZeroDivisionError):
        return None
    value = d + m / 60 + s / 3600
    if isinstance(ref, bytes):
        ref = ref.decode(errors="ignore")
    return -value if str(ref).strip().upper() in ("S", "W") else value


# (lat, lon) from the file's EXIF GPS IFD; (None, None) when absent. Raises when undecodable.
def exif_gps(path: Path) -> tuple[float | None, float | None]:
    with Image.open(path) as image:
        gps = image.getexif().get_ifd(_GPS_IFD)
    if not gps or 2 not in gps or 4 not in gps:
        return None, None
    lat, lon = _degrees(gps[2], gps.get(1, "N")), _degrees(gps[4], gps.get(3, "E"))
    if lat is None or lon is None or not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return None, None
    return lat, lon


def _font(size: int):
    try:
        return ImageFont.load_default(size=size)
    except TypeError:
        return ImageFont.load_default()


def _ist(value: datetime | None) -> str:
    if value is None:
        return "-"
    if value.tzinfo is not None:
        value = value.astimezone(IST)
    return value.strftime("%d-%m-%Y %H:%M:%S IST")


def _lines(facts: StampFacts) -> list[str]:
    accuracy = "-" if facts.accuracy_m is None else f"±{float(facts.accuracy_m):.1f} m"
    distance = ("-" if facts.distance_to_site_m is None
                else f"{facts.distance_to_site_m:.1f} m")
    return [
        f"{facts.case_ref}  |  {facts.inspection_ref}",
        f"Lat {facts.latitude:.6f}  Long {facts.longitude:.6f}  Accuracy {accuracy}",
        f"Server {_ist(facts.received_at)}  |  Device {_ist(facts.device_timestamp)}",
        f"Distance to site {distance}",
    ]


# Writes the original plus a bottom bar as JPEG under the evidence root; returns the key.
def write_stamped(original: Path, key: str, facts: StampFacts) -> str:
    with Image.open(original) as opened:
        image = ImageOps.exif_transpose(opened).convert("RGB")
    width, height = image.size
    size = max(12, width // 45)
    font = _font(size)
    lines = _lines(facts)
    pad = size // 2
    line_h = int(size * 1.35)
    bar_h = pad * 2 + line_h * len(lines)

    canvas = Image.new("RGB", (width, height + bar_h), (0, 0, 0))
    canvas.paste(image, (0, 0))
    draw = ImageDraw.Draw(canvas)
    for index, line in enumerate(lines):
        draw.text((pad, height + pad + index * line_h), line, fill=(255, 255, 255), font=font)

    target = settings.icms_evidence_dir / key
    target.parent.mkdir(parents=True, exist_ok=True)
    handle = tempfile.NamedTemporaryFile(dir=target.parent, suffix=".part", delete=False)
    try:
        with handle as sink:
            canvas.save(sink, format="JPEG", quality=90)
        os.replace(handle.name, target)
    except BaseException:
        Path(handle.name).unlink(missing_ok=True)
        raise
    return key
