"""The notice template — PROVISIONAL, dated 2026-09-23.

This module is the only thing in the codebase that knows what a notice looks
like. It replicates the Notice Create layout in Figma node `69:2961` pending
ADA's official template and issuing authority, which are open item 3 of the
build-order document's blocker table and are to be confirmed by ADA. Every
string of legal wording below is drafted from the Act text checked on
2026-09-23 (migration 0006's SEED carries the citation) and none of it has been
approved by ADA. Treat the output as a working instrument, not a served one.

## What a swap has to preserve

  * `build_body(facts) -> dict` and `render(body) -> bytes` are the seam. The
    repository calls the first at generation time and stores the result in
    `icms_notice.body`; `/pdf` never calls either, because it serves the stored
    artefact. Keep both signatures and a new template needs no migration.
  * `render` must stay a pure function of `body`. It may read nothing else — not
    the case, not the clock, not a setting. A reprint of a notice issued in 2026
    has to produce the bytes served in 2026, and the case has moved on since.
  * `body` must stay self-contained. Anything the document prints is a key in
    it. A template that reaches back to `icms_case` for the owner's name prints
    whatever the name is today, which is not what was served.
  * `TEMPLATE_ID`/`TEMPLATE_VERSION` go into `body["template"]`, so a stored
    notice always says which template drew it. Bump the version on any change
    to the drawn output; change the id if the layout is replaced outright.

## What the official template will have to add

  * Devanagari. `pdf.py` draws base-14 fonts only and a character outside cp1252
    becomes `?`, so a bilingual notice needs an embedded Devanagari face. Every
    `label_hi` in `icms_code_value` is already carried and is unused here.
  * The real letterhead artwork, seal image and authorised signatory block.
  * The map extract and the acknowledgement slip. Both are NAMED HOLES here,
    by decision of 2026-09-23 — see MAP_EXTRACT_UNAVAILABLE and
    ACKNOWLEDGEMENT_UNAVAILABLE. The map needs a tile server and a legal
    document renderer does not get an outbound HTTP dependency; the slip needs
    wording only ADA can give, and an acknowledgement of service carrying
    invented wording is worse than none. Each becomes `available: true` plus a
    block of data when its answer arrives.
  * Measured font metrics. `pdf.wrap` estimates advance widths.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import date
from typing import Any

from . import pdf

__all__ = [
    "MAP_EXTRACT_UNAVAILABLE",
    "NOTICE_TYPES",
    "TEMPLATE_ID",
    "TEMPLATE_VERSION",
    "NoticeFacts",
    "build_body",
    "notice_type_for",
    "render",
]

TEMPLATE_ID = "icms-notice-provisional"
TEMPLATE_VERSION = 1
TEMPLATE_SOURCE = "figma:69:2961"

# Provisional, like everything else here. The legacy system resolved the signing
# officer by looking up the 'VP' role (case_details.js, `getVpRole`), which is
# the Vice Chairman. `NoticeCreate.issuing_authority` overrides it per notice.
DEFAULT_ISSUING_AUTHORITY = "Vice Chairman, Agra Development Authority"

LETTERHEAD = {
    "authority": "AGRA DEVELOPMENT AUTHORITY",
    "subtitle": "Government of Uttar Pradesh | Illegal Construction Monitoring System",
    "address": "Jaipur House, Agra, Uttar Pradesh 282010",
    "line": "Office of the Enforcement Wing",
}

MAP_EXTRACT_UNAVAILABLE = (
    "Map extract not attached. Producing one requires a basemap tile service, "
    "and this document is rendered without any outbound network call. The "
    "co-ordinates recorded on inspection are printed above in its place."
)

# What the notice is called, by the section it leads on. The first match in this
# order wins, so a notice citing 27 and 14 together is a removal notice.
NOTICE_TYPES: tuple[tuple[str, str], ...] = (
    ("sec_27", "Notice for Removal of Unauthorised Development"),
    ("sec_28", "Order to Discontinue Development"),
    ("sec_28a", "Notice of Sealing of Unauthorised Development"),
    ("sec_26", "Notice to Show Cause Before Demolition"),
    ("sec_14", "Notice under Section 14 - Permission for Development"),
)

# One directive sentence per section. Drafted from the Act, not from ADA wording.
DIRECTIVES: Mapping[str, str] = {
    "sec_14": (
        "produce the written permission for the said development granted under "
        "Section 14 of the Act, or, in its absence, cease the development forthwith"
    ),
    "sec_26": (
        "show cause in writing why the unauthorised development described above "
        "should not be demolished"
    ),
    "sec_27": (
        "remove the unauthorised development described above by demolition, "
        "filling or otherwise, and restore the land to its condition before the "
        "development was carried out"
    ),
    "sec_28": (
        "discontinue the development described above, and discontinue the use of "
        "the land or building for the purpose of that development"
    ),
    "sec_28a": (
        "take notice that the unauthorised development described above is liable "
        "to be sealed under Section 28-A of the Act"
    ),
}

CONSEQUENCE = (
    "Take notice that on failure to comply within the period stated above, the "
    "Authority shall proceed to carry out the removal itself and recover the "
    "expenses of doing so from you as arrears of land revenue, and shall take "
    "such further action under the Act, including sealing under Section 28-A, "
    "as the case may require."
)

SHOW_CAUSE = (
    "You may appear before the undersigned in person or by a representative and "
    "show cause in writing why the direction given in this notice should not be "
    "enforced."
)

# Appendix A.7. `{days}` is filled from `notice_schemas.REPRESENTATION_DAYS` at
# generation and then lives in `body`, so a stored notice keeps the period it was
# issued under rather than picking up whatever the constant says at reprint.
REPRESENTATION = (
    "Any representation against this notice must be submitted in writing to the "
    "undersigned within {days} days of receipt."
)

# Named, not drawn — the same treatment as the map extract, and for the same
# reason. Figma's Notice Create checklist (69:2961) promises a slip; the document
# frame (72:4743) draws none, so there is nothing to transcribe and any wording
# here would be invented. An acknowledgement OF SERVICE with the wrong wording on
# it is worse than a notice without one. Decided 2026-09-23; see contract A.9.
ACKNOWLEDGEMENT_UNAVAILABLE = (
    "Acknowledgement slip not attached. Its wording is to be confirmed by the "
    "Authority; service is recorded separately and nothing on this document "
    "records it."
)

FOOTNOTE = (
    "Generated by the ADA Integrated Complaint Management System. The stored "
    "artefact is the document served; a reprint reproduces it exactly."
)

PROVISIONAL_MARK = (
    "PROVISIONAL TEMPLATE - replicates Figma 69:2961 pending ADA's official "
    "notice template and issuing authority (blocker B3)."
)


@dataclass(frozen=True)
class NoticeFacts:
    """Everything the template draws, resolved by the repository before it is called."""

    notice_ref: str
    case_ref: str
    issued_on: date
    compliance_due: date
    compliance_days: int
    representation_days: int
    issued_by: str
    issuing_authority: str
    act_cd: str
    act_label: str
    sections: tuple[tuple[str, str], ...] = ()
    notice_type: str | None = None
    recipient_name: str | None = None
    recipient_address: str | None = None
    property_address: str | None = None
    landmark: str | None = None
    khasra_no: str | None = None
    village_lgd_code: str | None = None
    ulpin: str | None = None
    police_station: str | None = None
    district: str | None = None
    pin_code: str | None = None
    zone_cd: str | None = None
    zone_name: str | None = None
    encroached_area_sqm: float | None = None
    latitude: float | None = None
    longitude: float | None = None
    inspection_ref: str | None = None
    grounds: tuple[str, ...] = ()


# The leading section decides the heading; an unrecognised set gets the generic one.
def notice_type_for(section_cds: Sequence[str]) -> str:
    held = frozenset(section_cds)
    for code, title in NOTICE_TYPES:
        if code in held:
            return title
    return "Enforcement Notice"


def _directives(section_cds: Sequence[str]) -> list[str]:
    known = [DIRECTIVES[code] for code in section_cds if code in DIRECTIVES]
    return known or [
        "comply with the provisions of the Act cited above in respect of the "
        "development described in this notice"
    ]


def build_body(facts: NoticeFacts) -> dict:
    """The JSON stored in `icms_notice.body`, and the only input `render` reads."""
    section_cds = [code for code, _ in facts.sections]
    return {
        "template": {
            "id": TEMPLATE_ID,
            "version": TEMPLATE_VERSION,
            "source": TEMPLATE_SOURCE,
            "provisional": True,
        },
        "letterhead": dict(LETTERHEAD),
        "notice": {
            "notice_ref": facts.notice_ref,
            "notice_type": facts.notice_type or notice_type_for(section_cds),
            "case_ref": facts.case_ref,
            "inspection_ref": facts.inspection_ref,
            "issued_on": facts.issued_on.isoformat(),
            "compliance_due": facts.compliance_due.isoformat(),
            "compliance_days": facts.compliance_days,
            "representation_days": facts.representation_days,
        },
        "recipient": {
            "name": facts.recipient_name,
            "address": facts.recipient_address,
        },
        "property": {
            "address": facts.property_address,
            "landmark": facts.landmark,
            "khasra_no": facts.khasra_no,
            "village_lgd_code": facts.village_lgd_code,
            "ulpin": facts.ulpin,
            "police_station": facts.police_station,
            "district": facts.district,
            "pin_code": facts.pin_code,
            "zone_cd": facts.zone_cd,
            "zone_name": facts.zone_name,
            "encroached_area_sqm": facts.encroached_area_sqm,
            "latitude": facts.latitude,
            "longitude": facts.longitude,
        },
        "legal": {
            "act_cd": facts.act_cd,
            "act_label": facts.act_label,
            "sections": [{"code": code, "label": label} for code, label in facts.sections],
            "directives": _directives(section_cds),
            "consequence": CONSEQUENCE,
            "representation": REPRESENTATION.format(days=facts.representation_days),
            "show_cause": SHOW_CAUSE,
        },
        "grounds": list(facts.grounds),
        "authority": {
            "issuing_authority": facts.issuing_authority,
            "issued_by": facts.issued_by,
        },
        "map_extract": {"available": False, "reason": MAP_EXTRACT_UNAVAILABLE},
        "acknowledgement": {"available": False, "reason": ACKNOWLEDGEMENT_UNAVAILABLE},
        "footnote": FOOTNOTE,
        "provisional_mark": PROVISIONAL_MARK,
    }


# --------------------------------------------------------------------- drawing

MARGIN = 56.0
TOP = pdf.A4_HEIGHT - 48.0
FLOOR = 64.0
COLUMN = pdf.A4_WIDTH - 2 * MARGIN
LABEL_WIDTH = 132.0

_MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun",
           "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")


# The UI renders `01 Sep 2026` and so does the document; ISO stays in storage.
def _day(value: Any) -> str:
    if not value:
        return "-"
    parsed = date.fromisoformat(str(value)[:10])
    return f"{parsed.day:02d} {_MONTHS[parsed.month - 1]} {parsed.year}"


def _blank(value: Any) -> str:
    if value is None or value == "":
        return "-"
    return str(value)


def _area(value: Any) -> str:
    if value in (None, ""):
        return "-"
    return f"{float(value):.2f} sq m"


class _Flow:
    """A cursor down the page that opens a new one when it runs out of room."""

    def __init__(self, document: pdf.Document) -> None:
        self.document = document
        self.page = document.page()
        self.y = TOP

    def room(self, height: float) -> bool:
        return self.y - height >= FLOOR

    def feed(self, height: float) -> None:
        if not self.room(height):
            self.page = self.document.page()
            self.y = TOP
        self.y -= height

    def text(self, value: str, *, font: str = "sans", size: float = 9.5,
             x: float = MARGIN, leading: float = 13.0) -> None:
        self.feed(leading)
        self.page.text(x, self.y, value, font=font, size=size)

    def centred(self, value: str, *, font: str = "sans", size: float = 9.5,
                leading: float = 13.0) -> None:
        bold = font.endswith("bold")
        offset = (pdf.A4_WIDTH - pdf.text_width(value, size, bold=bold)) / 2
        self.feed(leading)
        self.page.text(offset, self.y, value, font=font, size=size)

    def paragraph(self, value: str, *, font: str = "sans", size: float = 9.5,
                  x: float = MARGIN, width: float | None = None,
                  leading: float = 12.5) -> None:
        bold = font.endswith("bold")
        for line in pdf.wrap(value, width or (COLUMN - (x - MARGIN)), size, bold=bold):
            self.feed(leading)
            self.page.text(x, self.y, line, font=font, size=size)

    def field(self, label: str, value: str) -> None:
        self.feed(12.5)
        self.page.text(MARGIN, self.y, f"{label}:", font="sans-bold", size=9.0)
        for index, line in enumerate(pdf.wrap(value, COLUMN - LABEL_WIDTH, 9.0)):
            if index:
                self.feed(11.0)
            self.page.text(MARGIN + LABEL_WIDTH, self.y, line, size=9.0)

    def rule(self, *, gap: float = 8.0, width: float = 0.6) -> None:
        self.feed(gap)
        self.page.line(MARGIN, self.y, pdf.A4_WIDTH - MARGIN, self.y, width=width)

    def gap(self, height: float = 8.0) -> None:
        self.feed(height)


def _letterhead(flow: _Flow, body: Mapping[str, Any]) -> None:
    head = body["letterhead"]
    notice = body["notice"]
    flow.centred(head["authority"], font="serif-bold", size=17.0, leading=22.0)
    flow.centred(head["subtitle"], font="sans", size=9.5, leading=13.0)
    flow.centred(head["address"], font="sans", size=8.5, leading=11.0)
    # Appendix A.2 line 3: the kind and the reference together, because the
    # reference is what an officer reads aloud over a telephone.
    flow.centred(f"{notice['notice_type'].upper()} - {notice['notice_ref']}",
                 font="sans-bold", size=9.5, leading=14.0)
    flow.rule(gap=10.0, width=1.1)


def _heading(flow: _Flow, body: Mapping[str, Any]) -> None:
    legal = body["legal"]
    cited = ", ".join(section["label"] for section in legal["sections"]) or "-"
    flow.centred(f"NOTICE UNDER {legal['act_label'].upper()}", font="sans-bold",
                 size=11.5, leading=22.0)
    flow.paragraph(f"Cited: {cited}",
                   font="sans-italic", size=9.0, x=MARGIN + 40.0,
                   width=COLUMN - 80.0, leading=11.5)
    flow.rule(gap=8.0)


def _reference(flow: _Flow, body: Mapping[str, Any]) -> None:
    notice = body["notice"]
    right = pdf.A4_WIDTH - MARGIN - 190.0
    flow.feed(14.0)
    flow.page.text(MARGIN, flow.y, f"Notice No.: {notice['notice_ref']}",
                   font="sans-bold", size=9.5)
    flow.page.text(right, flow.y, f"Date of issue: {_day(notice['issued_on'])}",
                   font="sans-bold", size=9.5)
    flow.feed(12.0)
    flow.page.text(MARGIN, flow.y, f"Complaint No.: {notice['case_ref']}", size=9.0)
    flow.page.text(right, flow.y,
                   f"Inspection No.: {_blank(notice['inspection_ref'])}", size=9.0)
    flow.feed(12.0)
    zone = body["property"]
    flow.page.text(MARGIN, flow.y,
                   f"Zone: {_blank(zone['zone_name'])} ({_blank(zone['zone_cd'])})",
                   size=9.0)
    flow.page.text(right, flow.y,
                   f"Compliance due: {_day(notice['compliance_due'])}",
                   font="sans-bold", size=9.0)


def _recipient(flow: _Flow, body: Mapping[str, Any]) -> None:
    recipient = body["recipient"]
    flow.gap(14.0)
    flow.text("To,", font="sans-bold", size=9.5)
    flow.paragraph(_blank(recipient["name"]), font="sans-bold", size=9.5,
                   x=MARGIN + 14.0, leading=12.0)
    flow.paragraph(_blank(recipient["address"]), size=9.0, x=MARGIN + 14.0, leading=11.5)


# Appendix A.5: the area clause is DROPPED when no round measured one, rather
# than printed as "approximately sq m" with a hole in it.
def _recital(flow: _Flow, body: Mapping[str, Any]) -> None:
    legal = body["legal"]
    notice = body["notice"]
    prop = body["property"]
    parcel = prop["khasra_no"] or prop["address"] or "the property described below"
    area = ("" if prop["encroached_area_sqm"] in (None, "")
            else f", to an extent of approximately {_area(prop['encroached_area_sqm'])}")
    flow.gap(12.0)
    flow.paragraph(
        "WHEREAS it has been brought to the notice of this Authority through "
        "satellite-based change detection analysis and field inspection "
        f"(Reference: {notice['case_ref']}) that unauthorised development has been "
        f"carried out on the land bearing Survey/Khasra No. {parcel}{area}, without "
        f"the permission required under the {legal['act_label']};",
        size=9.5,
    )


def _property(flow: _Flow, body: Mapping[str, Any]) -> None:
    prop = body["property"]
    flow.gap(10.0)
    flow.text("PARTICULARS OF THE PROPERTY", font="sans-bold", size=9.5)
    flow.rule(gap=4.0, width=0.4)
    flow.gap(2.0)
    flow.field("Property address", _blank(prop["address"]))
    flow.field("Landmark", _blank(prop["landmark"]))
    flow.field("Khasra / survey no.", _blank(prop["khasra_no"]))
    flow.field("Village (LGD)", _blank(prop["village_lgd_code"]))
    flow.field("ULPIN", _blank(prop["ulpin"]))
    flow.field("Police station", _blank(prop["police_station"]))
    flow.field("District / PIN",
               f"{_blank(prop['district'])} / {_blank(prop['pin_code'])}")
    flow.field("Encroached area", _area(prop["encroached_area_sqm"]))
    flow.field(
        "Co-ordinates",
        "-" if prop["latitude"] is None
        else f"{float(prop['latitude']):.6f} N, {float(prop['longitude']):.6f} E",
    )


def _map_extract(flow: _Flow, body: Mapping[str, Any]) -> None:
    extract = body["map_extract"]
    height = 108.0
    flow.gap(12.0)
    flow.text("MAP EXTRACT OF THE ENCROACHED AREA", font="sans-bold", size=9.5)
    flow.feed(height + 6.0)
    flow.page.rect(MARGIN, flow.y, COLUMN, height, stroke=0.5)
    if not extract["available"]:
        for index, line in enumerate(pdf.wrap(extract["reason"], COLUMN - 28.0, 8.5)):
            flow.page.text(MARGIN + 14.0, flow.y + height - 20.0 - index * 11.0,
                           line, font="sans-italic", size=8.5)


def _grounds(flow: _Flow, body: Mapping[str, Any]) -> None:
    grounds = body["grounds"]
    flow.gap(14.0)
    flow.paragraph(
        "AND WHEREAS the following has been found and recorded on inspection:",
        size=9.5,
    )
    flow.gap(2.0)
    if not grounds:
        flow.paragraph("No inspection finding was recorded on the case.",
                       font="sans-italic", size=9.0, x=MARGIN + 16.0)
        return
    for index, ground in enumerate(grounds, start=1):
        flow.feed(12.0)
        flow.page.text(MARGIN + 6.0, flow.y, f"{index}.", size=9.0)
        for offset, line in enumerate(pdf.wrap(ground, COLUMN - 26.0, 9.0)):
            if offset:
                flow.feed(11.5)
            flow.page.text(MARGIN + 26.0, flow.y, line, size=9.0)


def _direction(flow: _Flow, body: Mapping[str, Any]) -> None:
    legal = body["legal"]
    notice = body["notice"]
    cited = ", ".join(section["label"] for section in legal["sections"]) or "the Act"
    flow.gap(12.0)
    flow.paragraph(
        f"NOW THEREFORE, in exercise of the powers conferred by {cited} of the "
        f"{legal['act_label']}, you are hereby directed to:",
        size=9.5,
    )
    flow.gap(2.0)
    for index, directive in enumerate(legal["directives"], start=1):
        flow.feed(12.0)
        flow.page.text(MARGIN + 6.0, flow.y, f"({index})", size=9.0)
        for offset, line in enumerate(pdf.wrap(directive, COLUMN - 30.0, 9.0)):
            if offset:
                flow.feed(11.5)
            flow.page.text(MARGIN + 30.0, flow.y, line, size=9.0)

    flow.gap(6.0)
    flow.paragraph(
        f"on or before {_day(notice['compliance_due'])}, being a period of "
        f"{notice['compliance_days']} days from the date of this notice.",
        font="sans-bold", size=9.5,
    )
    flow.gap(6.0)
    flow.paragraph(legal["consequence"], size=9.5)
    flow.gap(6.0)
    flow.paragraph(legal["representation"], font="sans-bold", size=9.5)
    flow.gap(4.0)
    flow.paragraph(legal["show_cause"], size=9.5)


def _signature(flow: _Flow, body: Mapping[str, Any]) -> None:
    authority = body["authority"]
    block = 82.0
    flow.gap(22.0)
    if not flow.room(block):
        flow.feed(block)
    seal_top = flow.y
    flow.page.rect(MARGIN, seal_top - block + 16.0, 118.0, block - 16.0, stroke=0.5)
    flow.page.text(MARGIN + 34.0, seal_top - block / 2.0, "(SEAL)",
                   font="sans-italic", size=9.0)

    right = pdf.A4_WIDTH - MARGIN - 210.0
    flow.page.line(right, seal_top - 34.0, pdf.A4_WIDTH - MARGIN, seal_top - 34.0,
                   width=0.5)
    flow.page.text(right, seal_top - 48.0, "Signature of the issuing authority",
                   font="sans-italic", size=8.5)
    flow.page.text(right, seal_top - 62.0, _blank(authority["issuing_authority"]),
                   font="sans-bold", size=9.5)
    flow.page.text(right, seal_top - 74.0,
                   f"Issued by: {_blank(authority['issued_by'])}", size=8.0)
    flow.y = seal_top - block


# Two named holes drawn the same way: a one-line statement of what is absent and
# why. Data, so ADA's confirmed slip becomes `available: true` plus a block of
# fields here, and nothing else in the codebase changes.
def _acknowledgement(flow: _Flow, body: Mapping[str, Any]) -> None:
    slip = body.get("acknowledgement") or {}
    if slip.get("available"):
        return
    flow.gap(16.0)
    flow.rule(gap=2.0, width=0.4)
    flow.paragraph(slip.get("reason", ""), font="sans-italic", size=8.0, leading=10.0)


def _footer(flow: _Flow, body: Mapping[str, Any]) -> None:
    flow.gap(16.0)
    flow.rule(gap=2.0, width=0.4)
    flow.paragraph(body["provisional_mark"], font="sans-italic", size=7.5, leading=9.5)
    flow.paragraph(body["footnote"], font="sans-italic", size=7.5, leading=9.5)


# Pure: every string drawn comes out of `body` and nothing is read from the clock,
# the database or a setting, which is what makes a reprint byte-identical.
def render(body: Mapping[str, Any]) -> bytes:
    """The notice as PDF bytes, from the stored `body` and nothing else."""
    document = pdf.Document(title=body["notice"]["notice_ref"])
    flow = _Flow(document)

    _letterhead(flow, body)
    _heading(flow, body)
    _reference(flow, body)
    _recipient(flow, body)
    _recital(flow, body)
    _property(flow, body)
    _map_extract(flow, body)
    _grounds(flow, body)
    _direction(flow, body)
    _signature(flow, body)
    _acknowledgement(flow, body)
    _footer(flow, body)

    return document.tobytes()
