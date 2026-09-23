"""The shapes of Batch 6, from `docs/icms/batch-6-contract.md` section 3.

Two things read oddly here and are deliberate, so they are named rather than
left to be discovered.

`status` is DERIVED. `overdue` is never a stored value — it is what the read
computes when the compliance date has passed and the stored status is still
`issued`. A stored `overdue` would be correct on the day it was written and
wrong every day after, and nothing sweeps it.

`deliveries` is always empty. Delivery tracking belongs to the Parivartan App
by section 3a of the build-order document, so `icms_notice_delivery` has a
table and no endpoint. The field is in the shape from the start so that the
moment Parivartan writes a row, the client already has somewhere to put it.
"""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from ada_core.datetimes import IstDateTime
from ada_core.validation import CaseRef, Code, Name, NoMarkupText, SafeLongText
from pydantic import BaseModel, BeforeValidator, ConfigDict, Field, model_validator

from .collection import CollectionParams
from .schemas import UserId, ZoneCode

__all__ = [
    "COMPLIANCE_DEFAULT_DAYS",
    "COMPLIANCE_MAX_DAYS",
    "COMPLIANCE_MIN_DAYS",
    "DERIVED_STATUSES",
    "NOTICE_STATUSES",
    "REPRESENTATION_DAYS",
    "STORED_STATUSES",
    "NoticeBodyOverrides",
    "NoticeCreate",
    "NoticeDelivery",
    "NoticeDetail",
    "NoticeQuery",
    "NoticeRow",
]

# icms_notice_status_ck, in the order a notice moves through them. Nothing in
# this service writes anything but `issued`; the rest are Parivartan's to set.
STORED_STATUSES = ("draft", "issued", "delivered", "failed", "withdrawn")
# Computed at read time from `compliance_due`, never stored. See the docstring.
DERIVED_STATUSES = ("overdue",)
NOTICE_STATUSES = STORED_STATUSES + DERIVED_STATUSES

# Section 27 of the Act: not less than 15 and not more than 40 days. Statutory
# rather than configurable, which is why these are constants and not settings.
COMPLIANCE_MIN_DAYS = 15
COMPLIANCE_MAX_DAYS = 40
# The default when the issuer sends none. Thirty leaves ten days of delivery lag
# before the served period could fall under the statutory floor — the Act counts
# from DELIVERY and delivery is the Parivartan App's to record, not ours.
COMPLIANCE_DEFAULT_DAYS = 30
# Appendix A.7 of the contract: the period to make a representation against the
# notice, which the Figma frame hard-codes at 7 days. Beside the compliance
# constants because it is the same kind of number — statutory, not an officer's
# choice — and it is carried in `body` so a stored notice keeps the period it
# was issued under when this value changes.
REPRESENTATION_DAYS = 7

PostalAddress = Annotated[str, Field(min_length=1, max_length=500)]


# The Notice Create form's "Reason / Grounds" control is ONE textarea, so the
# portal sends a string; `body` numbers grounds separately. Blank lines are the
# break — a single paragraph stays a single ground.
def _as_grounds(value: Any) -> Any:
    if isinstance(value, str):
        return [part.strip() for part in value.split("\n\n") if part.strip()]
    return value


Grounds = Annotated[list[SafeLongText], BeforeValidator(_as_grounds)]


class NoticeBodyOverrides(BaseModel):
    """What the Notice Create form may set on the document itself.

    A whitelist and not a free JSON blob: `body` is the text of a legal
    instrument, and an issuer who can put arbitrary keys into it can put
    arbitrary keys into what a court reads. Everything omitted is resolved from
    the case and its last inspection.
    """

    model_config = ConfigDict(extra="forbid")

    notice_type: NoMarkupText | None = Field(
        default=None,
        description="The heading. Defaults to the wording for the leading section cited.",
    )
    recipient_name: Name | None = Field(
        default=None,
        description="Defaults to the case's owner, then the recorded occupant.")
    recipient_address: PostalAddress | None = Field(
        default=None,
        description="Defaults to the property address and its postal parts.")
    khasra_no: NoMarkupText | None = Field(
        default=None, description="Defaults to the case's khasra_no.")
    encroached_area_sqm: float | None = Field(
        default=None, ge=0, le=10_000_000,
        description="Defaults to the last round's measured_area_sqm.")
    grounds: Grounds | None = Field(
        default=None, max_length=50,
        description="A string or a list of strings. A string is split on blank lines "
                    "into separate numbered grounds. Defaults to the last round's "
                    "recorded findings, in order.")


class NoticeCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    act_cd: Code = Field(
        description="Must name an active row in `icms_code_value` domain `act`.")
    section_cds: list[Code] = Field(
        min_length=1, max_length=10,
        description="Sections of that act. Each must be an active `section` row whose "
                    "`parent_code` is `act_cd`; an unknown code is refused, never stored.",
    )
    compliance_due: date | None = Field(
        default=None,
        description=f"Between {COMPLIANCE_MIN_DAYS} and {COMPLIANCE_MAX_DAYS} days after "
                    f"the issue date, per Section 27. Omit for "
                    f"{COMPLIANCE_DEFAULT_DAYS} days.",
    )
    issuing_authority: NoMarkupText | None = Field(
        default=None,
        description="The officer the notice is issued over. Provisional default until "
                    "ADA confirms the authority.",
    )
    body_overrides: NoticeBodyOverrides | None = None

    @model_validator(mode="after")
    def _sections_are_distinct(self) -> NoticeCreate:
        if len(set(self.section_cds)) != len(self.section_cds):
            raise ValueError("the same section is cited twice")
        return self


class NoticeQuery(CollectionParams):
    case_ref: list[CaseRef] | None = Field(default=None, description="Repeatable; OR.")
    status: list[str] | None = Field(
        default=None,
        description=f"Repeatable. One of: {', '.join(NOTICE_STATUSES)}. `overdue` is "
                    "derived from compliance_due and matches no stored value.")
    act_cd: list[Code] | None = Field(default=None, description="Repeatable.")
    zone_cd: list[ZoneCode] | None = Field(default=None, description="Repeatable.")
    issued_by: list[UserId] | None = Field(default=None, description="Repeatable.")
    issued_from: date | None = Field(default=None, description="Inclusive, IST day.")
    issued_to: date | None = Field(default=None, description="Inclusive, IST day.")

    @model_validator(mode="after")
    def _known_vocabulary(self) -> NoticeQuery:
        for value in self.status or ():
            if value not in NOTICE_STATUSES:
                raise ValueError(
                    f"unknown status '{value}'; one of: {', '.join(NOTICE_STATUSES)}")
        if self.issued_from and self.issued_to and self.issued_from > self.issued_to:
            raise ValueError("issued_from must not be after issued_to")
        return self


class NoticeDelivery(BaseModel):
    """One delivery attempt. The Parivartan App's to write; see the module docstring.

    Declared so the shape does not change when it starts arriving. `POST
    /notices/{ref}/deliveries` is cut, and `NoticeDetail.deliveries` is `[]`.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int
    mode_cd: str
    delivered_at: IstDateTime | None = None
    recipient_name: str | None = None
    acknowledged: bool = False
    officer_note: str | None = None
    recorded_by: str
    created_at: IstDateTime


class NoticeRow(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    notice_ref: str
    case_ref: str
    act_cd: str
    section_cds: list[str] = Field(default_factory=list)
    status: str = Field(
        description="One of: " + ", ".join(NOTICE_STATUSES) + ". `overdue` is computed "
                    "from compliance_due on every read and is never stored.",
    )
    issued_by: str | None = None
    issued_at: IstDateTime | None = None
    compliance_due: date | None = Field(
        default=None,
        description="ISO 8601 in storage; the register renders `01 Sep 2026`.")
    zone_cd: str | None = None
    property_address: str | None = Field(
        default=None,
        description="The case's property address — the line an officer recognises a "
                    "notice by. There is no separate location column.",
    )
    has_artefact: bool = Field(
        default=False,
        description="Whether a rendered PDF is in the store. False means /pdf answers "
                    "404: the document is never re-rendered to fill the gap.",
    )


class NoticeDetail(NoticeRow):
    body: dict[str, Any] | None = Field(
        default=None,
        description="The document as data, written once at generation. The PDF is drawn "
                    "from this and from nothing else, which is what makes a reprint "
                    "reproduce the instrument that was served.",
    )
    issuing_authority: str | None = None
    artefact_sha256: str | None = None
    inspection_ref: str | None = None
    deliveries: list[NoticeDelivery] = Field(
        default_factory=list,
        description="Always empty. Delivery tracking is the Parivartan App's by section "
                    "3a of the build-order document; the field exists so the shape does "
                    "not change when Parivartan starts writing to the table.",
    )
