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
from ada_core.models_icms import CASE_PRIORITIES, EVIDENCE_KINDS
from ada_core.validation import (
    AccuracyMetres,
    CaseRef,
    Code,
    IdempotencyKey,
    Latitude,
    Longitude,
    Name,
    PhoneIN,
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
        description="Replaces the cited sections when present; omit to leave them alone.",
    )

    occupant_name: Name | None = None
    occupant_phone: PhoneIN | None = None
    area_type_cd: Code | None = None
    measured_area_sqm: float | None = Field(default=None, ge=0, le=10_000_000)
    notice_required: bool | None = None
    notice_act_cd: Code | None = None
    officer_note: SafeLongText | None = None

    def observations(self) -> dict:
        """The Inspection columns the form actually carried, and no others."""
        return {
            name: getattr(self, name)
            for name in (
                "occupant_name", "occupant_phone", "area_type_cd", "measured_area_sqm",
                "notice_required", "notice_act_cd", "officer_note",
            )
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
    uploaded_at: IstDateTime
    content_url: str
    geotag_flagged: bool = Field(
        default=False,
        description="True when the capture carried no position, or one worse than the "
                    "accuracy threshold. Computed at write time and stored nowhere: "
                    "the threshold is server configuration a browser cannot read, so "
                    "the flag has to come over the wire. The gallery shows it.",
    )


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
        description="Null: Keycloak is the user store and there is no local users "
                    "table to join. Resolve it from /api/icms/admin/users.",
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
    requested_at: IstDateTime
    decision: str
    decided_by: str | None = None
    decided_at: IstDateTime | None = None
    decision_note: str | None = None
    resulting_round: int | None = None


class InspectionDetail(InspectionRow):
    case_status: str
    occupant_name: str | None = None
    occupant_phone: str | None = None
    area_type_cd: str | None = None
    measured_area_sqm: float | None = None
    notice_required: bool | None = None
    notice_act_cd: str | None = None
    officer_note: str | None = None
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
