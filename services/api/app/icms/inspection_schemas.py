"""The shapes of the inspection loop, from `docs/icms/batch-3-contract.md` §3.

Two vocabularies that read alike and are not the same thing, so they are named
apart here rather than in a comment at the call site: `capture_source` on a
check-in is how the handset got its FIX (gps, network, fused, manual), and
`capture_source` on evidence is where the FILE came from (camera, gallery,
upload, system). The database enforces both, on two different CHECK constraints.
"""

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal

from ada_core.datetimes import IstDateTime, isoformat_ist, to_ist
from ada_core.models_icms import (
    CASE_PRIORITIES,
    ENCROACHMENT_CONFIRMED,
    EVIDENCE_KINDS,
    EXTERNAL_SUPPORT,
    FINDINGS_SOURCES,
    RECOMMENDATIONS,
)
from ada_core.validation import (
    AccuracyMetres,
    CaseRef,
    Code,
    IdempotencyKey,
    Latitude,
    Longitude,
    Name,
    PhoneIN,
    PlaceName,
    SafeLongText,
    check_device_timestamp,
)
from fastapi import UploadFile
from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    PlainSerializer,
    model_validator,
)

from .collection import CollectionParams
from .schemas import UserId, ZoneCode

__all__ = [
    "CHECK_IN_SOURCES",
    "EVIDENCE_SOURCES",
    "INSPECTION_STATUSES",
    "PRIORITIES",
    "CheckInCreate",
    "CheckInOut",
    "EvidenceCreate",
    "EvidenceOut",
    "FindingOut",
    "FindingsPut",
    "InspectionDetail",
    "InspectionOpen",
    "InspectionQuery",
    "InspectionRow",
    "LatLon",
    "ResurveyCreate",
    "ResurveyDecide",
    "ResurveyRequestOut",
    "SectionOut",
    "SubmitRequest",
    "VerifyRequest",
]

# icms_inspection_status_ck, in the order a round moves through them.
INSPECTION_STATUSES = ("scheduled", "in_progress", "submitted", "accepted", "rejected")
# icms_check_in_source_ck — how the position was obtained.
CHECK_IN_SOURCES = ("gps", "network", "fused", "manual")
# icms_evidence_source_ck — where the file was obtained.
EVIDENCE_SOURCES = ("camera", "gallery", "upload", "system")
# icms_case_priority_ck. The register shows the CASE's priority, not the round's.
PRIORITIES = CASE_PRIORITIES


# One function rather than two stacked AfterValidators, whose order inside
# Annotated is a thing to look up rather than a thing to read.
def _live_capture(value: datetime) -> datetime:
    return to_ist(check_device_timestamp(value))


DeviceTimestamp = Annotated[
    datetime,
    AfterValidator(_live_capture),
    PlainSerializer(isoformat_ist, return_type=str, when_used="json"),
]


class LatLon(BaseModel):
    """A position as the field app speaks it, not as PostGIS stores it."""

    model_config = ConfigDict(extra="forbid")

    lat: float
    lon: float


# ------------------------------------------------------------------ requests
class InspectionOpen(BaseModel):
    model_config = ConfigDict(extra="forbid")

    surveyor_user_id: UserId
    scheduled_for: IstDateTime | None = Field(
        default=None,
        description="When the visit is planned. A round with no date is one the "
                    "surveyor is expected to start now.",
    )


class CheckInCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    latitude: Latitude
    longitude: Longitude
    accuracy_m: AccuracyMetres = Field(
        description="The handset's own estimate, in metres. Above the configured "
                    "threshold the check-in is refused with `poor_accuracy`.",
    )
    device_timestamp: DeviceTimestamp
    capture_source: Literal[CHECK_IN_SOURCES]  # type: ignore[valid-type]
    idempotency_key: IdempotencyKey = Field(
        description="Generated when the surveyor taps, not when the request is sent. "
                    "A replay returns the check-in the first attempt wrote.",
    )


class EvidenceCreate(BaseModel):
    """The whole multipart body, the file included.

    The file is a field rather than a parameter beside the model on purpose:
    with two body parameters FastAPI embeds them, and the form would then have
    to carry a JSON blob under a key called `meta`. One model keeps the form
    flat, which is what a handset posts.
    """

    model_config = ConfigDict(extra="forbid")

    file: UploadFile = Field(description="The photograph, video or document.")
    kind: Literal[EVIDENCE_KINDS]  # type: ignore[valid-type]
    doc_type_cd: Code | None = None
    latitude: Latitude | None = None
    longitude: Longitude | None = None
    accuracy_m: AccuracyMetres | None = None
    device_timestamp: DeviceTimestamp | None = None
    capture_source: Literal[EVIDENCE_SOURCES] | None = None  # type: ignore[valid-type]
    idempotency_key: IdempotencyKey

    @model_validator(mode="after")
    def _a_position_is_both_halves(self) -> EvidenceCreate:
        if (self.latitude is None) != (self.longitude is None):
            raise ValueError("send both latitude and longitude, or neither")
        return self

    @property
    def located(self) -> bool:
        return self.latitude is not None and self.longitude is not None


class SectionOut(BaseModel):
    """One statutory section the round cites. The same shape in and out."""

    model_config = ConfigDict(extra="forbid", from_attributes=True)

    act_cd: Code
    section_cd: Code


EncroachmentConfirmed = Literal[ENCROACHMENT_CONFIRMED]
ExternalSupport = Literal[EXTERNAL_SUPPORT]
Recommendation = Literal[RECOMMENDATIONS]

# 1,000 hectares: far past any single encroachment, short of a typo in sq ft.
MAX_AREA_SQM = 10_000_000
# Ten kilometres on one side; matches icms_inspection_length_ck / _width_ck.
MAX_SIDE_M = 10_000

OBSERVED_COLUMNS = (
    "occupant_name", "occupant_phone", "owner_name", "owner_phone", "property_type_cd",
    "floor_count",
    "police_station", "encroachment_confirmed_cd", "area_type_cd",
    "measured_area_sqm", "external_support_cd", "recommendation_cd",
    "notice_required", "notice_act_cd", "officer_note",
    "construction_stage_cd", "length_m", "width_m",
)


class FindingsPut(BaseModel):
    model_config = ConfigDict(extra="forbid")

    findings: list[SafeLongText] = Field(
        min_length=1,
        max_length=50,
        description="Replaces the round's findings outright. An empty list is a 422: "
                    "a round with no finding is a round that was not carried out.",
    )
    sections: list[SectionOut] | None = Field(
        default=None,
        max_length=50,
        description="Replaces the cited sections when present; omit to leave them alone. "
                    "Each pair must be an active `section` code under its `act`. At submit "
                    "a round with notice_required needs at least one under notice_act_cd.",
    )

    occupant_name: Name | None = Field(
        default=None, description="The person found on site. Required at submit when "
                                  "occupant_phone is given.")
    occupant_phone: PhoneIN | None = None
    owner_name: Name | None = Field(
        default=None, description="Who holds the property (legacy owner_name). Required "
                                  "at submit when owner_phone is given.")
    owner_phone: PhoneIN | None = None
    property_type_cd: Code | None = Field(
        default=None, description="An active `property_type` code value.")
    floor_count: int | None = Field(default=None, ge=0, le=200)
    police_station: PlaceName | None = None
    encroachment_confirmed_cd: EncroachmentConfirmed | None = Field(
        default=None,
        description="Required at submit. no_false_positive forces recommendation_cd "
                    "no_action_required and notice_required false.")
    area_type_cd: Code | None = Field(
        default=None,
        description="An active `area_type` code value. Required at submit when "
                    "encroachment_confirmed_cd is yes or partial.")
    measured_area_sqm: float | None = Field(
        default=None, ge=0.01, le=MAX_AREA_SQM,
        description="Square metres; the client converts sq ft or gaj. Required at "
                    "submit when encroachment_confirmed_cd is yes or partial.")
    external_support_cd: ExternalSupport | None = Field(
        default=None,
        description="Single select. Required at submit when encroachment_confirmed_cd "
                    "is yes or partial; police makes officer_note required.")
    recommendation_cd: Recommendation | None = Field(
        default=None,
        description="Required at submit. no_action_required only with no_false_positive. "
                    "issue_notice, demolition_order and impose_fine set notice_required.")
    notice_required: bool | None = Field(
        default=None,
        description="Required at submit once recommendation_cd is set; derived for "
                    "no_action_required and the three notice recommendations.")
    notice_act_cd: Code | None = Field(
        default=None,
        description="An active `act` code value. Required at submit when notice_required; "
                    "cleared when notice_required is false.")
    officer_note: SafeLongText | None = None
    construction_stage_cd: Code | None = Field(
        default=None, description="An active `construction_stage` code value. Optional.")
    length_m: float | None = Field(
        default=None, gt=0, le=MAX_SIDE_M,
        description="Metres; the field app converts feet. Optional. With width_m and "
                    "no measured_area_sqm, the area is derived as length × width.")
    width_m: float | None = Field(
        default=None, gt=0, le=MAX_SIDE_M, description="Metres. Optional.")

    def observations(self) -> dict:
        """The Inspection columns the form actually carried, and no others."""
        return {
            name: getattr(self, name)
            for name in OBSERVED_COLUMNS
            if name in self.model_fields_set
        }


class SubmitRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    idempotency_key: IdempotencyKey = Field(
        description="A replay returns the round already submitted, with 200.",
    )


class VerifyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["accept", "reject"]
    reason: SafeLongText | None = None

    @model_validator(mode="after")
    def _a_rejection_says_why(self) -> VerifyRequest:
        if self.decision == "reject" and not self.reason:
            raise ValueError(
                "a rejection must carry a reason; the surveyor has to act on it")
        return self


class ResurveyCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: SafeLongText


class ResurveyDecide(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["approve", "refuse"]
    note: SafeLongText | None = None
    surveyor_user_id: UserId | None = None

    @model_validator(mode="after")
    def _an_approval_names_the_surveyor(self) -> ResurveyDecide:
        if self.decision == "approve" and not self.surveyor_user_id:
            raise ValueError("approving opens a round, which needs surveyor_user_id")
        return self


class InspectionQuery(CollectionParams):
    case_ref: list[CaseRef] | None = Field(default=None, description="Repeatable; OR.")
    status: list[str] | None = Field(
        default=None,
        description=f"Repeatable. One of: {', '.join(INSPECTION_STATUSES)}")
    round_no: list[int] | None = Field(default=None, description="Repeatable.")
    surveyor_user_id: list[UserId] | None = Field(default=None, description="Repeatable.")
    zone_cd: list[ZoneCode] | None = Field(default=None, description="Repeatable.")
    priority: list[str] | None = Field(
        default=None, description=f"Repeatable. One of: {', '.join(PRIORITIES)}")
    submitted_from: date | None = Field(default=None, description="Inclusive, IST day.")
    submitted_to: date | None = Field(default=None, description="Inclusive, IST day.")

    @model_validator(mode="after")
    def _known_vocabulary(self) -> InspectionQuery:
        for value in self.status or ():
            if value not in INSPECTION_STATUSES:
                raise ValueError(
                    f"unknown status '{value}'; one of: {', '.join(INSPECTION_STATUSES)}")
        for value in self.round_no or ():
            if not 1 <= value <= 100:
                raise ValueError("round_no is between 1 and 100")
        for value in self.priority or ():
            if value not in PRIORITIES:
                raise ValueError(
                    f"unknown priority '{value}'; one of: {', '.join(PRIORITIES)}")
        if (self.submitted_from and self.submitted_to
                and self.submitted_from > self.submitted_to):
            raise ValueError("submitted_from must not be after submitted_to")
        return self


# ----------------------------------------------------------------- responses
class FindingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    seq: int
    finding: str
    created_at: IstDateTime


class CheckInOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    inspection_ref: str
    user_id: str
    user_name: str | None = Field(
        default=None, description="From Keycloak at read time; null when it cannot say.")
    lat: float | None = None
    lon: float | None = None
    accuracy_m: float
    device_timestamp: IstDateTime
    server_timestamp: IstDateTime
    capture_source: str
    inside_zone: bool | None = Field(
        default=None,
        description="Whether the fix falls inside the case's zone boundary. Null when "
                    "the zone has no boundary, or on a build without PostGIS.",
    )


class EvidenceOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    case_ref: str
    inspection_ref: str | None = None
    round_no: int | None = None
    kind: str
    doc_type_cd: str | None = None
    original_filename: str | None = None
    content_type: str | None = None
    byte_size: int | None = None
    sha256: str | None = None
    lat: float | None = None
    lon: float | None = None
    accuracy_m: float | None = None
    device_timestamp: IstDateTime | None = None
    capture_source: str | None = None
    captured_at: IstDateTime | None = None
    uploaded_by: str
    uploaded_by_name: str | None = Field(
        default=None, description="From Keycloak at read time; null when it cannot say.")
    uploaded_at: IstDateTime
    content_url: str
    stamped_url: str | None = Field(
        default=None,
        description="The server-stamped JPEG (location bar added by the API), or null "
                    "when none was made. The original at content_url is untouched.",
    )
    geotag_flagged: bool = Field(
        default=False,
        description="True when the capture carried no position, one worse than the "
                    "accuracy threshold, or (photos) EXIF GPS missing or farther than "
                    "icms_exif_mismatch_m from the submitted fix. The EXIF part is "
                    "stored at upload; the accuracy part is recomputed on read.",
    )
    distance_to_site_m: float | None = Field(
        default=None,
        description="Metres from the submitted fix to the case point; null without one.")
    exif_lat: float | None = Field(default=None, description="Latitude read from EXIF GPS.")
    exif_lon: float | None = Field(default=None, description="Longitude read from EXIF GPS.")


class InspectionRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    inspection_ref: str
    case_ref: str
    case_title: str | None = Field(
        default=None,
        description="The case's property address — the line an officer recognises a "
                    "case by. There is no separate title column.",
    )
    round_no: int
    status: str
    zone_cd: str | None = None
    zone_name: str | None = None
    priority: str | None = Field(
        default=None,
        description="The CASE's priority, carried on the round so the register can "
                    "show and filter it without a second call.",
    )
    surveyor_user_id: str
    surveyor_name: str | None = Field(
        default=None,
        description="From Keycloak at read time; null when it cannot say, and the "
                    "screen shows the id.",
    )
    scheduled_for: IstDateTime | None = None
    started_at: IstDateTime | None = None
    submitted_at: IstDateTime | None = None
    evidence_count: int = 0
    finding_count: int = 0
    has_check_in: bool = False


class ResurveyRequestOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    case_ref: str
    from_round: int
    reason: str
    requested_by: str
    requested_by_name: str | None = Field(
        default=None, description="From Keycloak at read time; null when it cannot say.")
    requested_at: IstDateTime
    decision: str
    decided_by: str | None = None
    decided_by_name: str | None = Field(
        default=None, description="From Keycloak at read time; null when it cannot say.")
    decided_at: IstDateTime | None = None
    decision_note: str | None = None
    resulting_round: int | None = None


class InspectionDetail(InspectionRow):
    case_status: str
    occupant_name: str | None = None
    occupant_phone: str | None = None
    owner_name: str | None = None
    owner_phone: str | None = None
    property_type_cd: str | None = None
    floor_count: int | None = None
    police_station: str | None = None
    encroachment_confirmed_cd: EncroachmentConfirmed | None = Field(
        default=None, description="Null on rounds recorded before it existed.")
    area_type_cd: str | None = Field(
        default=None, description="May be an inactive legacy `area_type` code.")
    measured_area_sqm: float | None = None
    external_support_cd: ExternalSupport | None = None
    recommendation_cd: Recommendation | None = None
    notice_required: bool | None = None
    notice_act_cd: str | None = None
    officer_note: str | None = None
    construction_stage_cd: str | None = None
    length_m: float | None = None
    width_m: float | None = None
    area_mismatch: bool = Field(
        default=False,
        description="True when measured_area_sqm and length × width are both held and "
                    "differ by more than 10% of length × width. Accepted, not refused.")
    findings_source: Literal[FINDINGS_SOURCES] | None = Field(  # type: ignore[valid-type]
        default=None,
        description="Which client last saved the findings, from the token's azp. A web "
                    "round is not held to the notice act, sections or owner at submit.")
    location: LatLon | None = None
    location_accuracy_m: float | None = None

    findings: list[FindingOut] = Field(default_factory=list)
    sections: list[SectionOut] = Field(default_factory=list)
    check_ins: list[CheckInOut] = Field(default_factory=list)
    evidence: list[EvidenceOut] = Field(default_factory=list)
    available_actions: list[str] = Field(
        default_factory=list,
        description="What THIS caller may do next, from workflow.allowed_actions, for "
                    "the CASE's status. A convenience for rendering buttons, never a "
                    "control: workflow.check runs on every request regardless.",
    )
