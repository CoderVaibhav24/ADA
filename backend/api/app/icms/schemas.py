from __future__ import annotations

from typing import Annotated

from ada_core.datetimes import IstDateTime
from ada_core.validation import Code, GeoPolygon, PlaceName, SafeText
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from .collection import CollectionParams

__all__ = [
    "AppConfigOut",
    "CodeValueOut",
    "CodeValueQuery",
    "ZoneAssignmentCreate",
    "ZoneAssignmentOut",
    "ZoneAssignmentQuery",
    "ZoneAssignmentRevoked",
    "ZoneAssignmentTarget",
    "ZoneCreate",
    "ZoneDetail",
    "ZoneOut",
    "ZoneUpdate",
]


def _strip(value: object) -> object:
    return value.strip() if isinstance(value, str) else value


ZoneCode = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=40,
                      pattern=r"^[A-Za-z0-9][A-Za-z0-9_.\-/]{0,39}$"),
]

UserId = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=64,
                      pattern=r"^[A-Za-z0-9][A-Za-z0-9._@:\-]{0,63}$"),
]


class AppConfigOut(BaseModel):
    """The server-side rules a field client would otherwise have to mirror.

    Flat and snake_case on purpose: it is read once at start-up by clients that
    do not share this codebase's types. A field is here only when the server
    genuinely enforces it, and every value is read from the setting or constant
    the enforcing code reads.
    """

    gps_accuracy_gate_m: float = Field(
        description="A check-in with a fix worse than this is refused 422 "
                    "`poor_accuracy`. Do not send one; nothing is stored.",
    )
    gps_accuracy_flag_m: float = Field(
        description="Evidence with a fix worse than this is stored and marked "
                    "`geotag_flagged`. Capture it anyway — this is an annotation, "
                    "not a refusal.",
    )
    device_timestamp_max_age_hours: float = Field(
        description="How far `device_timestamp` may differ from the server clock "
                    "in either direction before the request is refused 422.",
    )
    minimum_photo_count: int = Field(
        description="A round holding fewer photographs than this is refused 422 "
                    "`missing_payload` on submit. Capture them before submitting.",
    )
    maximum_photo_count: int = Field(
        description="A photograph past this is refused 422 `too_many_photos` and "
                    "nothing is stored. Evidence is append-only, so the ceiling "
                    "is final — stop the capture flow at it.",
    )


class CodeValueQuery(CollectionParams):
    size: int = Field(default=200, ge=1, le=200)
    domain: list[Code] | None = Field(default=None, description="Repeatable; values OR together.")
    code: list[Code] | None = None
    parent_code: list[Code] | None = None
    active: bool | None = Field(
        default=True,
        description="Active values only by default. Pass false for the retired ones.",
    )


class CodeValueOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    domain: str
    code: str
    label: str
    label_hi: str | None = None
    parent_code: str | None = None
    sort_order: int
    active: bool


class ZoneQuery(CollectionParams):
    zone_cd: list[ZoneCode] | None = Field(default=None, description="Repeatable; OR.")
    parent_cd: list[ZoneCode] | None = None
    active: bool | None = True


class ZoneOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    zone_cd: str
    name: str
    name_hi: str | None = None
    parent_cd: str | None = None
    active: bool
    has_geometry: bool = False
    created_at: IstDateTime
    updated_at: IstDateTime


class ZoneDetail(ZoneOut):
    geometry: dict | None = None


class ZoneWrite(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: PlaceName
    name_hi: SafeText | None = None
    parent_cd: ZoneCode | None = None
    active: bool = True
    geometry: GeoPolygon | None = Field(
        default=None,
        description="Polygon or MultiPolygon, EPSG:4326. A Polygon is stored as a "
                    "single-part MultiPolygon, which is what the column is typed for.",
    )


class ZoneCreate(ZoneWrite):
    zone_cd: ZoneCode


class ZoneUpdate(ZoneWrite):
    @property
    def geometry_supplied(self) -> bool:
        return "geometry" in self.model_fields_set


class ZoneAssignmentQuery(CollectionParams):
    zone_cd: list[ZoneCode] | None = Field(default=None, description="Repeatable; OR.")
    user_id: list[UserId] | None = None
    active: bool | None = True


class ZoneAssignmentCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    zone_cd: ZoneCode
    user_id: UserId


class ZoneAssignmentTarget(BaseModel):
    model_config = ConfigDict(extra="forbid")

    zone_cd: ZoneCode
    user_id: UserId


class ZoneAssignmentOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    zone_id: int
    zone_cd: str
    zone_name: str
    user_id: str
    active: bool
    assigned_by: str | None = None
    created_at: IstDateTime
    revoked_at: IstDateTime | None = None


class ZoneAssignmentRevoked(BaseModel):
    zone_cd: str
    user_id: str
    revoked: bool
    revoked_at: IstDateTime | None = None
