from __future__ import annotations

from datetime import date, datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base
from .datetimes import now_ist
from .models import Json
from .types import Geom, StringArray

CASE_STATUSES = (
    "raised",
    "assigned",
    "under_inspection",
    "inspection_submitted",
    "resurvey_requested",
    "verified",
    "handed_over",
    "confirmed",
    "notice_issued",
    "closed",
    "rejected",
)

CASE_PRIORITIES = ("high", "medium", "low")

EVIDENCE_KINDS = ("photo", "video", "document", "signature")

# Filed with the complaint, before any round exists; not a kind an inspection may upload.
CASE_EVIDENCE_KIND = "complaint_photo"
STORED_EVIDENCE_KINDS = (*EVIDENCE_KINDS, CASE_EVIDENCE_KIND)

# The surveyor's three structured answers on a round (web Figma 63:1054, 63:1087, 63:983).
ENCROACHMENT_CONFIRMED = ("yes", "partial", "no_false_positive")
EXTERNAL_SUPPORT = ("none", "police", "survey_dept", "legal")
RECOMMENDATIONS = (
    "issue_notice", "file_legal_case", "demolition_order",
    "further_investigation", "no_action_required", "impose_fine",
)
# Which client last saved a round's findings: the field app, or the web portal.
FINDINGS_SOURCES = ("field", "web")


def _in(column: str, values: tuple[str, ...]) -> str:
    joined = ", ".join(f"'{v}'" for v in values)
    return f"{column} IN ({joined})"

class CodeValue(Base):
    __tablename__ = "icms_code_value"
    __table_args__ = (UniqueConstraint("domain", "code", name="icms_code_value_uq"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    domain: Mapped[str] = mapped_column(String(40))
    code: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(Text)
    label_hi: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_code: Mapped[str | None] = mapped_column(String(40), nullable=True)
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0, server_default=text("0"))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))

class Zone(Base):
    __tablename__ = "icms_zone"
    __table_args__ = (
        Index("ix_icms_zone_geom", "geom", postgresql_using="gist"),
        Index("ix_icms_zone_parent", "parent_cd"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    zone_cd: Mapped[str] = mapped_column(String(40), unique=True)
    name: Mapped[str] = mapped_column(Text)
    name_hi: Mapped[str | None] = mapped_column(Text, nullable=True)
    parent_cd: Mapped[str | None] = mapped_column(String(40), nullable=True)
    geom: Mapped[object | None] = mapped_column(Geom("MultiPolygon"), nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())

    cases: Mapped[list[Case]] = relationship(back_populates="zone")


class CampusBoundary(Base):
    __tablename__ = "icms_campus_boundary"
    __table_args__ = (Index("ix_icms_campus_geom", "geom", postgresql_using="gist"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    name: Mapped[str] = mapped_column(Text, unique=True)
    geom: Mapped[object] = mapped_column(Geom("MultiPolygon"))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())


class ZoneAssignment(Base):
    __tablename__ = "icms_zone_assignment"
    __table_args__ = (
        Index(
            "uq_icms_zone_assignment_active",
            "zone_id", "user_id",
            unique=True,
            postgresql_where=text("active"),
            sqlite_where=text("active"),
        ),
        Index("ix_icms_zone_assignment_user", "user_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    zone_id: Mapped[int] = mapped_column(
        ForeignKey("icms_zone.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(String(64))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    assigned_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    revoked_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)

class Case(Base):
    __tablename__ = "icms_case"
    __table_args__ = (
        CheckConstraint(
            _in("source", ("detection", "public", "field", "office")),
            name="icms_case_source_ck"),
        CheckConstraint(_in("status", CASE_STATUSES), name="icms_case_status_ck"),
        CheckConstraint("stage_no BETWEEN 1 AND 7", name="icms_case_stage_ck"),
        CheckConstraint(
            _in("priority", CASE_PRIORITIES) + " OR priority IS NULL",
            name="icms_case_priority_ck"),
        CheckConstraint(
            "ulpin IS NULL OR length(ulpin) = 14", name="icms_case_ulpin_ck"),
        Index("ix_icms_case_zone", "zone_id"),
        Index("ix_icms_case_type", "complaint_type_cd"),
        Index("ix_icms_case_priority", "priority"),
        Index("ix_icms_case_parcel", "village_lgd_code", "khasra_no"),
        Index(
            "ix_icms_case_ulpin", "ulpin",
            postgresql_where=text("ulpin IS NOT NULL"),
            sqlite_where=text("ulpin IS NOT NULL")),
        Index("uq_icms_case_idempotency", "idempotency_key", unique=True),
        Index("ix_icms_case_status", "status"),
        Index("ix_icms_case_stage", "stage_no"),
        Index("ix_icms_case_raised", "raised_at"),
        Index("ix_icms_case_geom", "location", postgresql_using="gist"),
        Index("ix_icms_case_detect", "detection_id"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    case_ref: Mapped[str] = mapped_column(String(16), unique=True)
    zone_id: Mapped[int] = mapped_column(ForeignKey("icms_zone.id"))

    source: Mapped[str] = mapped_column(String(20))
    detection_id: Mapped[int | None] = mapped_column(
        ForeignKey("change_polygons.id", ondelete="SET NULL"), nullable=True)

    complaint_type_cd: Mapped[str | None] = mapped_column(String(40), nullable=True)
    other_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    detail: Mapped[str | None] = mapped_column(Text, nullable=True)

    complainant_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    complainant_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    complainant_email: Mapped[str | None] = mapped_column(Text, nullable=True)

    owner_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)

    property_address: Mapped[str | None] = mapped_column(Text, nullable=True)
    landmark: Mapped[str | None] = mapped_column(Text, nullable=True)
    police_station: Mapped[str | None] = mapped_column(Text, nullable=True)
    pin_code: Mapped[str | None] = mapped_column(String(10), nullable=True)
    district: Mapped[str | None] = mapped_column(Text, nullable=True)
    state: Mapped[str | None] = mapped_column(Text, nullable=True)
    country: Mapped[str | None] = mapped_column(
        Text, default="India", server_default=text("'India'"), nullable=True)
    property_type_cd: Mapped[str | None] = mapped_column(String(40), nullable=True)
    floor_count: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    ulpin: Mapped[str | None] = mapped_column(String(14), nullable=True)
    khasra_no: Mapped[str | None] = mapped_column(String(24), nullable=True)
    village_lgd_code: Mapped[str | None] = mapped_column(String(12), nullable=True)
    district_lgd_code: Mapped[str | None] = mapped_column(String(12), nullable=True)

    priority: Mapped[str | None] = mapped_column(String(10), nullable=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(36), nullable=True)

    location: Mapped[object | None] = mapped_column(Geom("Point"), nullable=True)

    stage_no: Mapped[int] = mapped_column(SmallInteger, default=1, server_default=text("1"))
    status: Mapped[str] = mapped_column(
        String(30), default="raised", server_default=text("'raised'"))
    current_round: Mapped[int] = mapped_column(SmallInteger, default=0, server_default=text("0"))

    raised_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    # The complainant's date, which may precede the filing; the API writes today when absent.
    complaint_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    closed_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    # Written by reject (case_reject_reason) or close (case_close_outcome); 0022.
    outcome_cd: Mapped[str | None] = mapped_column(String(40), nullable=True)
    outcome_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    closed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())

    zone: Mapped[Zone] = relationship(back_populates="cases")
    assignments: Mapped[list[CaseAssignment]] = relationship(
        back_populates="case", cascade="all, delete-orphan")
    inspections: Mapped[list[Inspection]] = relationship(
        back_populates="case", cascade="all, delete-orphan",
        order_by="Inspection.round_no")
    events: Mapped[list[CaseEvent]] = relationship(
        back_populates="case", cascade="all, delete-orphan")


class CaseAssignment(Base):
    __tablename__ = "icms_case_assignment"
    __table_args__ = (
        CheckConstraint(
            _in("assignment_type", ("survey", "verification", "handover")),
            name="icms_case_assignment_type_ck"),
        Index("ix_icms_case_assignment_case", "case_id"),
        Index(
            "ix_icms_case_assignment_user", "assignee_user_id",
            postgresql_where=text("active"), sqlite_where=text("active")),
        Index(
            "uq_icms_case_assignment_open", "case_id", "assignment_type",
            unique=True,
            postgresql_where=text("active"), sqlite_where=text("active")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("icms_case.id", ondelete="CASCADE"))
    assignee_user_id: Mapped[str] = mapped_column(String(64))
    assigned_by: Mapped[str] = mapped_column(String(64))
    assignment_type: Mapped[str] = mapped_column(
        String(20), default="survey", server_default=text("'survey'"))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    assigned_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    released_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)

    case: Mapped[Case] = relationship(back_populates="assignments")


class Inspection(Base):
    __tablename__ = "icms_inspection"
    __table_args__ = (
        UniqueConstraint("case_id", "round_no", name="icms_inspection_round_uq"),
        CheckConstraint("round_no >= 1", name="icms_inspection_round_ck"),
        CheckConstraint(
            _in("status", ("scheduled", "in_progress", "submitted",
                           "accepted", "rejected")),
            name="icms_inspection_status_ck"),
        CheckConstraint(
            _in("encroachment_confirmed_cd", ENCROACHMENT_CONFIRMED),
            name="icms_inspection_encroachment_ck"),
        CheckConstraint(
            _in("external_support_cd", EXTERNAL_SUPPORT),
            name="icms_inspection_external_support_ck"),
        CheckConstraint(
            _in("recommendation_cd", RECOMMENDATIONS),
            name="icms_inspection_recommendation_ck"),
        CheckConstraint(
            "floor_count BETWEEN 0 AND 200", name="icms_inspection_floor_count_ck"),
        CheckConstraint(
            "length_m > 0 AND length_m <= 10000", name="icms_inspection_length_ck"),
        CheckConstraint(
            "width_m > 0 AND width_m <= 10000", name="icms_inspection_width_ck"),
        CheckConstraint(
            _in("findings_source", FINDINGS_SOURCES),
            name="icms_inspection_findings_source_ck"),
        Index("ix_icms_inspection_case", "case_id"),
        Index("ix_icms_inspection_surveyor", "surveyor_user_id"),
        Index("ix_icms_inspection_status", "status"),
        Index("ix_icms_inspection_geom", "location", postgresql_using="gist"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    inspection_ref: Mapped[str] = mapped_column(String(16), unique=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("icms_case.id", ondelete="CASCADE"))
    round_no: Mapped[int] = mapped_column(SmallInteger, default=1, server_default=text("1"))
    surveyor_user_id: Mapped[str] = mapped_column(String(64))

    scheduled_for: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)

    status: Mapped[str] = mapped_column(
        String(20), default="scheduled", server_default=text("'scheduled'"))

    occupant_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    occupant_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Legacy inspection.owner_name / owner_mobile: who holds the property, not who was on site.
    owner_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_phone: Mapped[str | None] = mapped_column(String(20), nullable=True)
    property_type_cd: Mapped[str | None] = mapped_column(String(40), nullable=True)
    floor_count: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    police_station: Mapped[str | None] = mapped_column(Text, nullable=True)
    area_type_cd: Mapped[str | None] = mapped_column(String(40), nullable=True)
    measured_area_sqm: Mapped[float | None] = mapped_column(
        Numeric(12, 2), nullable=True)
    construction_stage_cd: Mapped[str | None] = mapped_column(String(40), nullable=True)
    length_m: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    width_m: Mapped[float | None] = mapped_column(Numeric(8, 2), nullable=True)
    # Which client last saved the findings (token azp); web rounds skip the act, sections, owner.
    findings_source: Mapped[str | None] = mapped_column(String(10), nullable=True)

    encroachment_confirmed_cd: Mapped[str | None] = mapped_column(String(40), nullable=True)
    external_support_cd: Mapped[str | None] = mapped_column(String(40), nullable=True)
    recommendation_cd: Mapped[str | None] = mapped_column(String(40), nullable=True)

    notice_required: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    notice_act_cd: Mapped[str | None] = mapped_column(String(40), nullable=True)
    officer_note: Mapped[str | None] = mapped_column(Text, nullable=True)

    location: Mapped[object | None] = mapped_column(Geom("Point"), nullable=True)
    location_accuracy_m: Mapped[float | None] = mapped_column(
        Numeric(6, 1), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())

    case: Mapped[Case] = relationship(back_populates="inspections")
    findings: Mapped[list[InspectionFinding]] = relationship(
        back_populates="inspection", cascade="all, delete-orphan",
        order_by="InspectionFinding.seq")
    sections: Mapped[list[InspectionSection]] = relationship(
        back_populates="inspection", cascade="all, delete-orphan")
    check_ins: Mapped[list[CheckIn]] = relationship(
        back_populates="inspection", cascade="all, delete-orphan")


class CheckIn(Base):
    __tablename__ = "icms_check_in"
    __table_args__ = (
        CheckConstraint(
            _in("capture_source", ("gps", "network", "fused", "manual")),
            name="icms_check_in_source_ck"),
        Index("ix_icms_check_in_inspection", "inspection_id"),
        Index("ix_icms_check_in_geom", "location", postgresql_using="gist"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    inspection_id: Mapped[int] = mapped_column(
        ForeignKey("icms_inspection.id", ondelete="CASCADE"))
    user_id: Mapped[str] = mapped_column(String(64))
    location: Mapped[object] = mapped_column(Geom("Point"))
    accuracy_m: Mapped[float] = mapped_column(Numeric(6, 1))
    device_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    server_timestamp: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    capture_source: Mapped[str] = mapped_column(
        String(20), default="gps", server_default=text("'gps'"))
    inside_zone: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    idempotency_key: Mapped[str] = mapped_column(String(36), unique=True)

    inspection: Mapped[Inspection] = relationship(back_populates="check_ins")


class InspectionFinding(Base):
    __tablename__ = "icms_inspection_finding"
    __table_args__ = (
        UniqueConstraint("inspection_id", "seq", name="icms_inspection_finding_uq"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    inspection_id: Mapped[int] = mapped_column(
        ForeignKey("icms_inspection.id", ondelete="CASCADE"))
    seq: Mapped[int] = mapped_column(SmallInteger, default=1, server_default=text("1"))
    finding: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())

    inspection: Mapped[Inspection] = relationship(back_populates="findings")


class InspectionSection(Base):
    __tablename__ = "icms_inspection_section"
    __table_args__ = (
        UniqueConstraint("inspection_id", "act_cd", "section_cd",
                         name="icms_inspection_section_uq"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    inspection_id: Mapped[int] = mapped_column(
        ForeignKey("icms_inspection.id", ondelete="CASCADE"))
    act_cd: Mapped[str] = mapped_column(String(40))
    section_cd: Mapped[str] = mapped_column(String(40))

    inspection: Mapped[Inspection] = relationship(back_populates="sections")


class Evidence(Base):
    __tablename__ = "icms_evidence"
    __table_args__ = (
        CheckConstraint(
            _in("kind", STORED_EVIDENCE_KINDS),
            name="icms_evidence_kind_ck"),
        CheckConstraint(
            _in("capture_source", ("camera", "gallery", "upload", "system"))
            + " OR capture_source IS NULL",
            name="icms_evidence_source_ck"),
        CheckConstraint(
            "kind <> 'photo' OR (location IS NOT NULL AND accuracy_m IS NOT NULL "
            "AND device_timestamp IS NOT NULL AND capture_source IS NOT NULL)",
            name="icms_evidence_geotag_ck"),
        Index("ix_icms_evidence_case", "case_id"),
        Index("ix_icms_evidence_inspection", "inspection_id"),
        Index("ix_icms_evidence_geom", "location", postgresql_using="gist"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("icms_case.id", ondelete="RESTRICT"))
    inspection_id: Mapped[int | None] = mapped_column(
        ForeignKey("icms_inspection.id", ondelete="RESTRICT"), nullable=True)
    round_no: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)

    kind: Mapped[str] = mapped_column(String(20))
    doc_type_cd: Mapped[str | None] = mapped_column(String(40), nullable=True)

    storage_path: Mapped[str] = mapped_column(Text)
    original_filename: Mapped[str | None] = mapped_column(Text, nullable=True)
    content_type: Mapped[str | None] = mapped_column(String(100), nullable=True)
    byte_size: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    location: Mapped[object | None] = mapped_column(Geom("Point"), nullable=True)
    accuracy_m: Mapped[float | None] = mapped_column(Numeric(6, 1), nullable=True)
    device_timestamp: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    capture_source: Mapped[str | None] = mapped_column(String(20), nullable=True)
    captured_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    caption: Mapped[str | None] = mapped_column(Text, nullable=True)

    # The server-stamped derivative; the original file and sha256 stay as uploaded.
    stamped_storage_key: Mapped[str | None] = mapped_column(String, nullable=True)
    geotag_flagged: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"))
    distance_to_site_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    exif_lat: Mapped[float | None] = mapped_column(Float, nullable=True)
    exif_lon: Mapped[float | None] = mapped_column(Float, nullable=True)

    uploaded_by: Mapped[str] = mapped_column(String(64))
    uploaded_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    idempotency_key: Mapped[str] = mapped_column(String(36), unique=True)


class CaseEvent(Base):
    __tablename__ = "icms_case_event"
    __table_args__ = (Index("ix_icms_case_event_case", "case_id", "created_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("icms_case.id", ondelete="CASCADE"))
    inspection_id: Mapped[int | None] = mapped_column(
        ForeignKey("icms_inspection.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(40))
    from_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    to_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    round_no: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    actor_user_id: Mapped[str] = mapped_column(String(64))
    actor_role: Mapped[str | None] = mapped_column(String(60), nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    payload: Mapped[dict | None] = mapped_column(Json, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())

    case: Mapped[Case] = relationship(back_populates="events")


class ResurveyRequest(Base):
    __tablename__ = "icms_resurvey_request"
    __table_args__ = (
        CheckConstraint(
            _in("decision", ("pending", "approved", "rejected")),
            name="icms_resurvey_decision_ck"),
        Index("ix_icms_resurvey_case", "case_id"),
        Index(
            "uq_icms_resurvey_pending", "case_id", unique=True,
            postgresql_where=text("decision = 'pending'"),
            sqlite_where=text("decision = 'pending'")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("icms_case.id", ondelete="CASCADE"))
    from_round: Mapped[int] = mapped_column(SmallInteger)
    reason: Mapped[str] = mapped_column(Text)
    requested_by: Mapped[str] = mapped_column(String(64))
    requested_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    decision: Mapped[str] = mapped_column(
        String(20), default="pending", server_default=text("'pending'"))
    decided_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    decided_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    resulting_round: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)


AUTHORITY_WIDE = "*"


class NoticeSequence(Base):
    __tablename__ = "icms_notice_sequence"

    series: Mapped[str] = mapped_column(
        String(3), primary_key=True, default="CMP", server_default=text("'CMP'"))
    scope_cd: Mapped[str] = mapped_column(
        String(40), primary_key=True, default=AUTHORITY_WIDE,
        server_default=text(f"'{AUTHORITY_WIDE}'"))
    year: Mapped[int] = mapped_column(SmallInteger, primary_key=True)
    last_seq: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))


class Notice(Base):
    __tablename__ = "icms_notice"
    __table_args__ = (
        CheckConstraint(
            _in("status", ("draft", "issued", "delivered", "failed", "withdrawn")),
            name="icms_notice_status_ck"),
        Index("ix_icms_notice_case", "case_id"),
        Index("ix_icms_notice_status", "status"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    notice_ref: Mapped[str] = mapped_column(String(16), unique=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("icms_case.id", ondelete="RESTRICT"))
    inspection_id: Mapped[int | None] = mapped_column(
        ForeignKey("icms_inspection.id", ondelete="RESTRICT"), nullable=True)

    act_cd: Mapped[str] = mapped_column(String(40))
    section_cds: Mapped[list | None] = mapped_column(StringArray, nullable=True)
    body: Mapped[dict | None] = mapped_column(Json, nullable=True)
    issuing_authority: Mapped[str | None] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(
        String(20), default="draft", server_default=text("'draft'"))
    issued_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    issued_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    compliance_due: Mapped[datetime | None] = mapped_column(Date, nullable=True)

    artefact_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    artefact_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())

    deliveries: Mapped[list[NoticeDelivery]] = relationship(
        back_populates="notice", cascade="all, delete-orphan")


class NoticeDelivery(Base):
    __tablename__ = "icms_notice_delivery"
    __table_args__ = (Index("ix_icms_notice_delivery_notice", "notice_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    notice_id: Mapped[int] = mapped_column(
        ForeignKey("icms_notice.id", ondelete="CASCADE"))
    mode_cd: Mapped[str] = mapped_column(String(40))
    delivered_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True)
    recipient_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    acknowledged: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    location: Mapped[object | None] = mapped_column(Geom("Point"), nullable=True)
    accuracy_m: Mapped[float | None] = mapped_column(Numeric(6, 1), nullable=True)
    officer_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    evidence_id: Mapped[int | None] = mapped_column(
        ForeignKey("icms_evidence.id"), nullable=True)
    recorded_by: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())

    notice: Mapped[Notice] = relationship(back_populates="deliveries")


class Feedback(Base):
    __tablename__ = "icms_feedback"
    __table_args__ = (Index("ix_icms_feedback_case", "case_id"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    case_id: Mapped[int] = mapped_column(
        ForeignKey("icms_case.id", ondelete="CASCADE"))
    description: Mapped[str] = mapped_column(Text)
    location: Mapped[object | None] = mapped_column(Geom("Point"), nullable=True)
    created_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())


# ---------------------------------------------------------------------------
# Policy tables: the workflow transition table and RBAC, held as data
#
# Everything below describes *rules*, not cases. It exists because the two
# things ADA changes most often after go-live — who may do what, and which
# moves a case is allowed to make — were previously a Python tuple and a set of
# `require_role(...)` literals, so changing either meant a release.
#
# What did NOT move here, deliberately: validation rules. A field width, a
# mandatory geo-tag, a 10-digit mobile number are enforced by the request models
# and mirrored in the browser. Putting them in a table would mean the client
# cannot validate without asking the server first, which is one round trip per
# keystroke on a form filled over a district-office connection.
# ---------------------------------------------------------------------------

CASE_ACTIONS = (
    "raise",
    "assign",
    "reassign",
    "reject",
    "open_round",
    "check_in",
    "add_evidence",
    "record_findings",
    "submit",
    "verify_accept",
    "verify_reject",
    "request_resurvey",
    "hand_over",
    "confirm",
    "issue_notice",
    "close",
)


class Permission(Base):
    """One thing a caller may be allowed to do, named `resource.action`.

    Permissions are seeded and are not user-created: a permission code is
    referenced by an endpoint in source, so inventing one in the admin UI would
    create a grant that guards nothing. `is_system` marks the seeded set, and
    the admin API refuses to delete those rows.
    """

    __tablename__ = "icms_permission"
    __table_args__ = (
        UniqueConstraint("resource", "action", name="icms_permission_uq"),
        Index("ix_icms_permission_resource", "resource"),
    )

    permission_cd: Mapped[str] = mapped_column(String(64), primary_key=True)
    resource: Mapped[str] = mapped_column(String(40))
    action: Mapped[str] = mapped_column(String(40))
    label: Mapped[str] = mapped_column(Text)
    label_hi: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    # The screen the Roles tab files this under (0013); NULL when several screens share it.
    screen_cd: Mapped[str | None] = mapped_column(String(40), nullable=True)


class PolicyRole(Base):
    """A realm role, mirrored so permissions and transitions can point at it.

    `role_cd` must match the role name Keycloak puts in the token — the strings
    in infra/keycloak/realm-ada.json. This table does not create roles in
    Keycloak and does not authenticate anybody; it is the local end of a join.
    A role present here and absent from the realm simply never matches a token.
    """

    __tablename__ = "icms_role"

    role_cd: Mapped[str] = mapped_column(String(40), primary_key=True)
    label: Mapped[str] = mapped_column(Text)
    label_hi: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_system: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0, server_default=text("0"))

    permissions: Mapped[list[RolePermission]] = relationship(
        back_populates="role", cascade="all, delete-orphan")


class RolePermission(Base):
    """A grant. The whole of RBAC is this table.

    Deliberately not hierarchical: no role inherits another. Inheritance reads
    well in a diagram and is unreadable in an incident, because answering "why
    could this person do that" means walking a tree rather than reading a row.
    Four roles and a few dozen permissions do not need it.
    """

    __tablename__ = "icms_role_permission"

    role_cd: Mapped[str] = mapped_column(
        ForeignKey("icms_role.role_cd", ondelete="CASCADE"), primary_key=True)
    permission_cd: Mapped[str] = mapped_column(
        ForeignKey("icms_permission.permission_cd", ondelete="CASCADE"), primary_key=True)
    granted_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())

    role: Mapped[PolicyRole] = relationship(back_populates="permissions")


class WorkflowTransition(Base):
    """One row of the case state machine.

    A `source_status` of NULL is the initial state — there is no case yet — and
    is how `raise` is expressed. That is why the uniqueness of (action, source)
    needs two indexes rather than one: PostgreSQL treats NULLs as distinct in a
    unique index, so a plain unique constraint would happily admit two `raise`
    rows and the loader would then have to pick one arbitrarily.

    `requires` holds the payload keys the transition cannot proceed without.
    They are checked for presence only. What a value must *look* like stays in
    the request models, where the browser can check it too.
    """

    __tablename__ = "icms_workflow_transition"
    __table_args__ = (
        CheckConstraint(_in("action_cd", CASE_ACTIONS), name="icms_wf_transition_action_ck"),
        CheckConstraint(_in("target_status", CASE_STATUSES), name="icms_wf_transition_target_ck"),
        CheckConstraint(
            f"source_status IS NULL OR {_in('source_status', CASE_STATUSES)}",
            name="icms_wf_transition_source_ck",
        ),
        CheckConstraint("stage_no BETWEEN 1 AND 7", name="icms_wf_transition_stage_ck"),
        Index(
            "uq_icms_wf_transition_src",
            "action_cd", "source_status",
            unique=True,
            postgresql_where=text("active AND source_status IS NOT NULL"),
            sqlite_where=text("active AND source_status IS NOT NULL"),
        ),
        Index(
            "uq_icms_wf_transition_initial",
            "action_cd",
            unique=True,
            postgresql_where=text("active AND source_status IS NULL"),
            sqlite_where=text("active AND source_status IS NULL"),
        ),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    action_cd: Mapped[str] = mapped_column(String(40))
    source_status: Mapped[str | None] = mapped_column(String(30), nullable=True)
    target_status: Mapped[str] = mapped_column(String(30))
    stage_no: Mapped[int] = mapped_column(SmallInteger)
    assignee_only: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"))
    opens_round: Mapped[bool] = mapped_column(
        Boolean, default=False, server_default=text("false"))
    requires: Mapped[list[str]] = mapped_column(
        StringArray, default=list, server_default=text("'{}'"))
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    sort_order: Mapped[int] = mapped_column(SmallInteger, default=0, server_default=text("0"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    updated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Seeded by 0010 for phase 2; the role table below still governs.
    permission_cd: Mapped[str | None] = mapped_column(
        ForeignKey("icms_permission.permission_cd", ondelete="RESTRICT",
                   name="icms_wf_transition_permission_fk"),
        nullable=True)

    roles: Mapped[list[TransitionRole]] = relationship(
        back_populates="transition", cascade="all, delete-orphan")


class TransitionRole(Base):
    """Which roles may make a transition. ORs together, like `require_role`."""

    __tablename__ = "icms_workflow_transition_role"

    transition_id: Mapped[int] = mapped_column(
        ForeignKey("icms_workflow_transition.id", ondelete="CASCADE"), primary_key=True)
    role_cd: Mapped[str] = mapped_column(
        ForeignKey("icms_role.role_cd", ondelete="CASCADE"), primary_key=True)

    transition: Mapped[WorkflowTransition] = relationship(back_populates="roles")


class PolicyRevision(Base):
    """A single row whose counter every worker compares its cache against.

    The workers are told to reload by `NOTIFY icms_policy`, which is immediate
    and cheap. This row is the answer to the case NOTIFY cannot cover: a worker
    that started after the change, or one whose listener connection dropped and
    reconnected, has missed the message entirely. It reads the revision on a
    cheap interval, sees a number ahead of its own, and reloads.

    `CHECK (id = 1)` is not decoration. A second row would give two workers two
    different answers to "is my cache current", and the symptom of that is a
    permission change that applies on some requests and not others.
    """

    __tablename__ = "icms_policy_revision"
    __table_args__ = (CheckConstraint("id = 1", name="icms_policy_revision_single_ck"),)

    id: Mapped[int] = mapped_column(
        SmallInteger, primary_key=True, autoincrement=False, default=1)
    revision: Mapped[int] = mapped_column(
        BigInteger, default=1, server_default=text("1"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    updated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


class UploadPolicy(Base):
    """Per-kind upload rules, in the database so a size or a format changes
    without a release. ada_core.uploads is the only thing that enforces them."""

    __tablename__ = "icms_upload_policy"
    __table_args__ = (
        CheckConstraint(
            _in("kind", STORED_EVIDENCE_KINDS), name="icms_upload_policy_kind_ck"),
        CheckConstraint("max_bytes > 0", name="icms_upload_policy_max_bytes_ck"),
        CheckConstraint(
            "max_pixels IS NULL OR max_pixels > 0", name="icms_upload_policy_max_pixels_ck"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    kind: Mapped[str] = mapped_column(String(20), unique=True)
    # Sniffed from the file's own magic bytes, never from the Content-Type the client sent.
    mime_types: Mapped[list[str]] = mapped_column(
        StringArray, default=list, server_default=text("'{}'"))
    # Lower case and dotted, '.jpg' not 'jpg', because that is what Path.suffix yields.
    extensions: Mapped[list[str]] = mapped_column(
        StringArray, default=list, server_default=text("'{}'"))
    max_bytes: Mapped[int] = mapped_column(BigInteger)
    # Width times height, the decompression-bomb guard. NULL means the kind has no raster.
    max_pixels: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    storage_backend: Mapped[str] = mapped_column(
        String(20), default="local", server_default=text("'local'"))
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    updated_by: Mapped[str | None] = mapped_column(String(64), nullable=True)


# Runtime switches a Super Admin flips without a release (revision 0018).
class RuntimeSetting(Base):
    __tablename__ = "icms_runtime_setting"

    key: Mapped[str] = mapped_column(Text, primary_key=True)
    value: Mapped[object] = mapped_column(Json)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_by: Mapped[str | None] = mapped_column(Text, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())


# One row per deadline reminder delivered, so a restart never repeats one (revision 0021).
class ReminderSent(Base):
    __tablename__ = "icms_reminder_sent"
    __table_args__ = (
        UniqueConstraint("rule", "subject", "stage", name="icms_reminder_sent_uq"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    rule: Mapped[str] = mapped_column(String(40))
    subject: Mapped[str] = mapped_column(String(64))
    stage: Mapped[str] = mapped_column(String(20))
    recipients: Mapped[int] = mapped_column(SmallInteger, default=0, server_default=text("0"))
    sent_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())


# Boundary layers loaded from the authority's KML (revision 0015; docs/icms/kml-import-spec.md).
class Village(Base):
    __tablename__ = "icms_village"
    __table_args__ = (Index("ix_icms_village_geom", "geom", postgresql_using="gist"),)

    village_lgd: Mapped[str] = mapped_column(String(12), primary_key=True)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    name_hi: Mapped[str | None] = mapped_column(Text, nullable=True)
    tehsil: Mapped[str | None] = mapped_column(Text, nullable=True)
    district_lgd: Mapped[str | None] = mapped_column(String(12), nullable=True)
    geom: Mapped[object] = mapped_column(Geom("MultiPolygon"))
    # Every ExtendedData field of the placemark, including ones ADA does not read yet.
    attributes: Mapped[dict | None] = mapped_column(Json, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())


PARCEL_REVENUE_KEY = "village_lgd IS NOT NULL AND khasra_no IS NOT NULL"
PARCEL_SCHEME_KEY = "sector IS NOT NULL AND plot_no IS NOT NULL"


class Parcel(Base):
    __tablename__ = "icms_parcel"
    __table_args__ = (
        # A revenue parcel is keyed by village + khasra, a scheme plot by sector + plot number.
        Index("uq_icms_parcel_village_khasra", "village_lgd", "khasra_no", unique=True,
              postgresql_where=text(PARCEL_REVENUE_KEY), sqlite_where=text(PARCEL_REVENUE_KEY)),
        Index("uq_icms_parcel_sector_plot", "sector", "plot_no", unique=True,
              postgresql_where=text(PARCEL_SCHEME_KEY), sqlite_where=text(PARCEL_SCHEME_KEY)),
        CheckConstraint(f"({PARCEL_REVENUE_KEY}) OR ({PARCEL_SCHEME_KEY})",
                        name="icms_parcel_key_ck"),
        CheckConstraint("ulpin IS NULL OR length(ulpin) = 14", name="icms_parcel_ulpin_ck"),
        CheckConstraint("area_sqm IS NULL OR area_sqm >= 0", name="icms_parcel_area_ck"),
        CheckConstraint("sanctioned_area_sqm IS NULL OR sanctioned_area_sqm >= 0",
                        name="icms_parcel_sanctioned_area_ck"),
        Index("ix_icms_parcel_geom", "geom", postgresql_using="gist"),
        Index("ix_icms_parcel_ulpin", "ulpin",
              postgresql_where=text("ulpin IS NOT NULL"),
              sqlite_where=text("ulpin IS NOT NULL")),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    village_lgd: Mapped[str | None] = mapped_column(
        ForeignKey("icms_village.village_lgd"), nullable=True)
    khasra_no: Mapped[str | None] = mapped_column(String(24), nullable=True)
    # Key form, e.g. SECTOR-4; `sector_name` keeps the land record's own spelling.
    sector: Mapped[str | None] = mapped_column(String(40), nullable=True)
    sector_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    plot_no: Mapped[str | None] = mapped_column(String(40), nullable=True)
    plot_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    tenure: Mapped[str | None] = mapped_column(Text, nullable=True)
    registration_no: Mapped[str | None] = mapped_column(Text, nullable=True)
    sanctioned_area_sqm: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    ulpin: Mapped[str | None] = mapped_column(String(14), nullable=True)
    land_use: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Personal data: never returned by the parcel lookup, see the KML import spec.
    owner_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    area_sqm: Mapped[float | None] = mapped_column(Numeric(14, 2), nullable=True)
    geom: Mapped[object] = mapped_column(Geom("MultiPolygon"))
    attributes: Mapped[dict | None] = mapped_column(Json, nullable=True)
    active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())


class BoundaryImport(Base):
    __tablename__ = "icms_boundary_import"
    __table_args__ = (Index("ix_icms_boundary_import_at", "imported_at"),)

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True)
    filename: Mapped[str] = mapped_column(Text)
    sha256: Mapped[str] = mapped_column(String(64))
    imported_by: Mapped[str] = mapped_column(String(64))
    # The importer's name from their token at the time, so the log reads without Keycloak.
    imported_by_name: Mapped[str | None] = mapped_column(String(200), nullable=True)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=now_ist, server_default=func.now())
    counts: Mapped[dict] = mapped_column(Json)
