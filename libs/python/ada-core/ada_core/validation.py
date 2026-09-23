from __future__ import annotations

import html
import re
import unicodedata
from datetime import datetime, timedelta
from typing import Annotated, Any
from uuid import UUID

from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

__all__ = [
    "AccuracyMetres",
    "BBox",
    "Code",
    "CaseRef",
    "Email",
    "GeoPoint",
    "GeoPolygon",
    "IdempotencyKey",
    "InspectionRef",
    "KhasraNo",
    "LGDCode",
    "Latitude",
    "Longitude",
    "Name",
    "NoMarkupText",
    "NoticeRef",
    "PageParams",
    "PhoneIN",
    "PinCode",
    "PlaceName",
    "SafeLongText",
    "SafeText",
    "ULPIN",
    "canonical_name",
    "check_device_timestamp",
    "dedupe_key",
    "escape_html",
    "escape_like",
    "parse_legacy_bool",
    "redact",
    "round_coordinate",
    "safe_filename",
    "safe_sort",
]


_ALLOWED_CONTROL = {"\n", "\r", "\t"}


def _strip_control(value: str) -> str:
    return "".join(
        ch for ch in value
        if ch in _ALLOWED_CONTROL or unicodedata.category(ch) not in ("Cc", "Cf")
    )


def normalise_text(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    value = unicodedata.normalize("NFKC", value)
    value = _strip_control(value)
    return re.sub(r"\s+", " ", value).strip()


def normalise_multiline(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    value = unicodedata.normalize("NFKC", value)
    value = _strip_control(value).replace("\r\n", "\n").replace("\r", "\n")
    value = "\n".join(line.rstrip() for line in value.split("\n"))
    return re.sub(r"\n{3,}", "\n\n", value).strip()


def _reject_markup(value: Any) -> Any:
    if isinstance(value, str) and ("<" in value or ">" in value):
        raise ValueError("must not contain '<' or '>'")
    return value


SafeText = Annotated[
    str,
    BeforeValidator(normalise_text),
    StringConstraints(min_length=1, max_length=500),
]

SafeLongText = Annotated[
    str,
    BeforeValidator(normalise_multiline),
    StringConstraints(min_length=1, max_length=5000),
]

_LATIN_RUN = re.compile(r"[A-Za-z]+")


def canonical_name(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    value = normalise_text(value)
    if not value:
        return value
    if not (value.isupper() or value.islower()):
        return value
    return _LATIN_RUN.sub(lambda m: m.group(0).capitalize(), value)


Name = Annotated[
    str,
    BeforeValidator(canonical_name),
    BeforeValidator(_reject_markup),
    StringConstraints(min_length=1, max_length=200),
]

PlaceName = Annotated[
    str,
    BeforeValidator(canonical_name),
    BeforeValidator(_reject_markup),
    StringConstraints(min_length=1, max_length=200),
]

NoMarkupText = Annotated[
    str,
    BeforeValidator(normalise_text),
    BeforeValidator(_reject_markup),
    StringConstraints(min_length=1, max_length=500),
]

Code = Annotated[
    str,
    BeforeValidator(lambda v: v.strip().lower() if isinstance(v, str) else v),
    StringConstraints(pattern=r"^[a-z0-9][a-z0-9_]{0,39}$"),
]


def _normalise_ref(value: Any) -> Any:
    return value.strip().upper() if isinstance(value, str) else value


CaseRef = Annotated[
    str, BeforeValidator(_normalise_ref), StringConstraints(pattern=r"^CMP-\d{4}-\d{4}$")
]
InspectionRef = Annotated[
    str, BeforeValidator(_normalise_ref), StringConstraints(pattern=r"^INS-\d{4}-\d{4}$")
]
NoticeRef = Annotated[
    str, BeforeValidator(_normalise_ref), StringConstraints(pattern=r"^NTC-\d{4}-\d{4}$")
]

IdempotencyKey = UUID


def _normalise_khasra(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    value = normalise_text(value)
    return re.sub(r"\s*([/-])\s*", r"\1", value)


ULPIN = Annotated[
    str,
    BeforeValidator(lambda v: v.strip().upper() if isinstance(v, str) else v),
    StringConstraints(pattern=r"^[A-Z0-9]{14}$"),
]

KhasraNo = Annotated[
    str,
    BeforeValidator(_normalise_khasra),
    StringConstraints(min_length=1, max_length=24,
                      pattern=r"^[0-9]+(/[0-9]+)*(-[^\s/]{1,8})?$"),
]

LGDCode = Annotated[
    str,
    BeforeValidator(lambda v: v.strip() if isinstance(v, str) else v),
    StringConstraints(pattern=r"^[0-9]{1,12}$"),
]


def _normalise_phone_in(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    digits = re.sub(r"\D", "", value)
    if len(digits) > 10 and digits.startswith(("91", "091", "0091")):
        digits = digits[-10:]
    elif len(digits) == 11 and digits.startswith("0"):
        digits = digits[1:]
    return digits


PhoneIN = Annotated[
    str,
    BeforeValidator(_normalise_phone_in),
    StringConstraints(pattern=r"^[6-9]\d{9}$"),
]

PinCode = Annotated[
    str,
    BeforeValidator(lambda v: v.strip() if isinstance(v, str) else v),
    StringConstraints(pattern=r"^[1-9]\d{5}$"),
]

Email = Annotated[
    str,
    BeforeValidator(lambda v: v.strip().lower() if isinstance(v, str) else v),
    StringConstraints(
        max_length=254,
        pattern=r"^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$",
    ),
]


Latitude = Annotated[float, Field(ge=-90, le=90)]
Longitude = Annotated[float, Field(ge=-180, le=180)]
AccuracyMetres = Annotated[float, Field(ge=0, le=10_000)]

MAX_RING_VERTICES = 10_000
MAX_POLYGON_RINGS = 50


class GeoPoint(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = "Point"
    coordinates: tuple[Longitude, Latitude]

    @field_validator("type")
    @classmethod
    def _is_point(cls, v: str) -> str:
        if v != "Point":
            raise ValueError("type must be 'Point'")
        return v


class GeoPolygon(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: str = "Polygon"
    coordinates: list[Any]

    @field_validator("type")
    @classmethod
    def _known_type(cls, v: str) -> str:
        if v not in ("Polygon", "MultiPolygon"):
            raise ValueError("type must be 'Polygon' or 'MultiPolygon'")
        return v

    @model_validator(mode="after")
    def _check_rings(self) -> GeoPolygon:
        polygons = self.coordinates if self.type == "MultiPolygon" else [self.coordinates]
        if not polygons:
            raise ValueError("coordinates must not be empty")
        for polygon in polygons:
            if not isinstance(polygon, list) or not polygon:
                raise ValueError("each polygon must be a non-empty list of rings")
            if len(polygon) > MAX_POLYGON_RINGS:
                raise ValueError(f"at most {MAX_POLYGON_RINGS} rings per polygon")
            for ring in polygon:
                if not isinstance(ring, list) or len(ring) < 4:
                    raise ValueError("a ring needs at least four positions")
                if len(ring) > MAX_RING_VERTICES:
                    raise ValueError(f"at most {MAX_RING_VERTICES} vertices per ring")
                for position in ring:
                    if (not isinstance(position, (list, tuple))) or len(position) < 2:
                        raise ValueError("a position is [longitude, latitude]")
                    lon, lat = float(position[0]), float(position[1])
                    if not (-180 <= lon <= 180 and -90 <= lat <= 90):
                        raise ValueError(f"position out of range: [{lon}, {lat}]")
                if list(ring[0][:2]) != list(ring[-1][:2]):
                    raise ValueError("ring must close: first position repeated at the end")
        return self


class BBox(BaseModel):
    model_config = ConfigDict(extra="forbid")

    west: Longitude
    south: Latitude
    east: Longitude
    north: Latitude

    max_span_degrees: float = Field(default=10.0, exclude=True)

    @model_validator(mode="after")
    def _ordered_and_bounded(self) -> BBox:
        if self.west >= self.east:
            raise ValueError("west must be less than east")
        if self.south >= self.north:
            raise ValueError("south must be less than north")
        if (self.east - self.west) > self.max_span_degrees or (
            self.north - self.south
        ) > self.max_span_degrees:
            raise ValueError(f"extent must not exceed {self.max_span_degrees} degrees")
        return self

    @classmethod
    def parse(cls, value: str, max_span_degrees: float = 10.0) -> BBox:
        parts = [p.strip() for p in value.split(",")]
        if len(parts) != 4:
            raise ValueError("bbox must be 'west,south,east,north'")
        west, south, east, north = (float(p) for p in parts)
        return cls(west=west, south=south, east=east, north=north,
                   max_span_degrees=max_span_degrees)


class PageParams(BaseModel):
    model_config = ConfigDict(extra="forbid")

    page: int = Field(default=1, ge=1, le=100_000)
    size: int = Field(default=25, ge=1, le=200)

    @property
    def offset(self) -> int:
        return (self.page - 1) * self.size

    @property
    def limit(self) -> int:
        return self.size


def safe_sort(field: str | None, allowed: dict[str, str], default: str) -> tuple[str, bool]:
    if not field:
        return default, False
    descending = field.startswith("-")
    key = field[1:] if descending else field
    column = allowed.get(key)
    if column is None:
        raise ValueError(f"cannot sort by '{key}'; allowed: {', '.join(sorted(allowed))}")
    return column, descending


def escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


IMAGE_TYPES = frozenset({"image/jpeg", "image/png", "image/webp", "image/heic"})
VIDEO_TYPES = frozenset({"video/mp4", "video/quicktime"})
DOCUMENT_TYPES = frozenset({"application/pdf"})
RASTER_TYPES = frozenset({"image/tiff", "application/octet-stream"})

MAX_IMAGE_BYTES = 15 * 1024 * 1024
MAX_VIDEO_BYTES = 200 * 1024 * 1024
MAX_DOCUMENT_BYTES = 25 * 1024 * 1024

_FILENAME_SAFE = re.compile(r"[^A-Za-z0-9._-]")


def safe_filename(name: str | None, *, fallback: str = "upload", max_length: int = 120) -> str:
    if not name:
        return fallback
    name = unicodedata.normalize("NFKC", name)
    name = _strip_control(name)
    name = name.replace("\\", "/").rsplit("/", 1)[-1]
    name = _FILENAME_SAFE.sub("_", name)
    name = re.sub(r"_{2,}", "_", name)
    name = re.sub(r"_+\.", ".", name)
    name = re.sub(r"\.{2,}", ".", name).strip("._")
    if not name:
        return fallback
    if len(name) > max_length:
        stem, dot, ext = name.rpartition(".")
        if dot and len(ext) <= 10:
            name = stem[: max_length - len(ext) - 1] + "." + ext
        else:
            name = name[:max_length]
    return name


def check_upload(
    *,
    content_type: str | None,
    byte_size: int | None,
    allowed_types: frozenset[str],
    max_bytes: int,
) -> None:
    if content_type not in allowed_types:
        raise ValueError(
            f"unsupported content type {content_type!r}; "
            f"allowed: {', '.join(sorted(allowed_types))}"
        )
    if byte_size is not None and byte_size > max_bytes:
        raise ValueError(f"file exceeds {max_bytes // (1024 * 1024)} MB")


def escape_html(value: str) -> str:
    return html.escape(value, quote=True)


_SENSITIVE_KEY = re.compile(
    r"(name|phone|mobile|email|address|latitude|longitude|coord|password|token|secret|"
    r"authorization|aadhaar|otp)",
    re.IGNORECASE,
)
REDACTED = "[redacted]"


def redact(payload: Any, *, _depth: int = 0) -> Any:
    if _depth > 10:
        return REDACTED
    if isinstance(payload, dict):
        return {
            key: REDACTED if _SENSITIVE_KEY.search(str(key)) else redact(value, _depth=_depth + 1)
            for key, value in payload.items()
        }
    if isinstance(payload, (list, tuple)):
        return type(payload)(redact(item, _depth=_depth + 1) for item in payload)
    return payload


COORDINATE_PRECISION = 7


def round_coordinate(value: float, precision: int = COORDINATE_PRECISION) -> float:
    return round(float(value), precision)


_TRUE_TOKENS = frozenset({"yes", "y", "true", "t", "1", "active", "on"})
_FALSE_TOKENS = frozenset({"no", "n", "false", "f", "0", "inactive", "off", ""})


def parse_legacy_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    if value is None:
        return None
    token = str(value).strip().lower()
    if token in _TRUE_TOKENS:
        return True
    if token in _FALSE_TOKENS:
        return False
    return None


def dedupe_key(*parts: Any) -> str:
    keys = []
    for part in parts:
        if part is None:
            keys.append("")
            continue
        text = unicodedata.normalize("NFKC", str(part)).casefold()
        keys.append(re.sub(r"[^0-9a-zऀ-ॿ]+", "", text))
    return "|".join(keys)


MAX_CLOCK_SKEW = timedelta(hours=12)


def check_device_timestamp(
    value: datetime,
    *,
    now: datetime | None = None,
    max_skew: timedelta = MAX_CLOCK_SKEW,
) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("device_timestamp must carry a timezone offset (ISO 8601)")
    reference = now or datetime.now(value.tzinfo)
    if value - reference > max_skew:
        raise ValueError("device_timestamp is in the future beyond the allowed clock skew")
    if reference - value > max_skew:
        raise ValueError("device_timestamp is too far in the past for a live capture")
    return value
