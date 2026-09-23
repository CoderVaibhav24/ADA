"""Tests for the shared validation layer.

Each test names the thing that goes wrong without the rule, because a
validation test that only asserts "rejects bad input" is deleted the first time
it is inconvenient.
"""

from __future__ import annotations

import pytest
from pydantic import BaseModel, ValidationError

from ada_core.validation import (
    IMAGE_TYPES,
    MAX_IMAGE_BYTES,
    BBox,
    CaseRef,
    Code,
    Email,
    GeoPoint,
    GeoPolygon,
    Name,
    PageParams,
    PhoneIN,
    PinCode,
    SafeLongText,
    SafeText,
    check_upload,
    escape_html,
    escape_like,
    normalise_multiline,
    normalise_text,
    redact,
    safe_filename,
    safe_sort,
)


class TextModel(BaseModel):
    note: SafeText
    detail: SafeLongText | None = None
    owner: Name | None = None


# --- text ------------------------------------------------------------------

def test_nul_byte_is_removed_before_it_reaches_postgres():
    # psycopg2 raises "A string literal cannot contain NUL (0x00) characters"
    # at insert time, which surfaces as a 500 on an ordinary request.
    assert normalise_text("ab\x00cd") == "abcd"


def test_bidirectional_override_is_removed():
    # A Cf character reverses the text an officer signs in the rendered notice.
    assert normalise_text("Agra\u202eNoticed") == "AgraNoticed"


def test_whitespace_collapses_on_single_line_text():
    assert TextModel(note="  two   words \n here ").note == "two words here"


def test_newlines_survive_in_long_text_but_blank_runs_do_not():
    assert normalise_multiline("a\n\n\n\nb   \n") == "a\n\nb"


def test_nfkc_makes_two_keyboards_agree():
    # Composed and decomposed forms look identical and compare unequal, which
    # lets a unique index accept a visible duplicate.
    assert normalise_text("\u0928\u093f") == normalise_text("\u0928\u093f")
    assert normalise_text("\ufb01le") == "file"


def test_empty_after_normalisation_is_refused():
    with pytest.raises(ValidationError):
        TextModel(note="   \t  ")


def test_name_refuses_markup():
    with pytest.raises(ValidationError):
        TextModel(note="ok", owner="<script>alert(1)</script>")


def test_free_text_keeps_what_the_officer_typed():
    # Storage does not alter; the render edge escapes. Anything else silently
    # rewrites a record somebody may have to stand behind.
    assert TextModel(note="width < 3 m").note == "width < 3 m"


def test_code_is_lowercased_and_bounded():
    class M(BaseModel):
        code: Code

    assert M(code="  Unauthorised_Construction ").code == "unauthorised_construction"
    with pytest.raises(ValidationError):
        M(code="has space")


# --- identifiers -----------------------------------------------------------

@pytest.mark.parametrize("value", ["CMP-2026-0001", "CMP-1999-9999"])
def test_case_ref_accepts_the_agreed_format(value):
    class M(BaseModel):
        ref: CaseRef

    assert M(ref=value).ref == value


# "cmp-2026-0001" is deliberately absent: a reference arrives lower case from an
# email or a printed notice, and it is upper-cased before matching rather than
# refused. See test_reference_is_upper_cased_before_matching.
@pytest.mark.parametrize("value", ["CMP-26-0001", "CMP-2026-1", "INS-2026-0001", "CMP-2026-00011"])
def test_case_ref_refuses_everything_else(value):
    class M(BaseModel):
        ref: CaseRef

    with pytest.raises(ValidationError):
        M(ref=value)


# --- contact ---------------------------------------------------------------

class Contact(BaseModel):
    phone: PhoneIN | None = None
    pin: PinCode | None = None
    email: Email | None = None


@pytest.mark.parametrize(
    "raw",
    ["9876543210", "+91 98765 43210", "091-9876543210", "09876543210", "+919876543210"],
)
def test_phone_normalises_to_ten_digits(raw):
    assert Contact(phone=raw).phone == "9876543210"


@pytest.mark.parametrize("raw", ["1234567890", "98765", "5876543210", "98765432101234"])
def test_phone_refuses_what_cannot_be_called(raw):
    with pytest.raises(ValidationError):
        Contact(phone=raw)


def test_pin_code_refuses_a_leading_zero():
    assert Contact(pin="282001").pin == "282001"
    with pytest.raises(ValidationError):
        Contact(pin="082001")


def test_email_is_lowercased_and_header_injection_is_refused():
    assert Contact(email=" Officer@ADA.GOV.IN ").email == "officer@ada.gov.in"
    with pytest.raises(ValidationError):
        Contact(email="a@b.com\nBcc: victim@example.com")


# --- geography -------------------------------------------------------------

def test_geo_point_bounds_are_enforced():
    assert GeoPoint(coordinates=(78.0, 27.1)).coordinates == (78.0, 27.1)
    with pytest.raises(ValidationError):
        GeoPoint(coordinates=(278.0, 27.1))


def test_polygon_ring_must_close():
    with pytest.raises(ValidationError):
        GeoPolygon(coordinates=[[[78.0, 27.0], [78.1, 27.0], [78.1, 27.1]]])


def test_polygon_accepts_a_closed_ring():
    poly = GeoPolygon(
        coordinates=[[[78.0, 27.0], [78.1, 27.0], [78.1, 27.1], [78.0, 27.0]]]
    )
    assert poly.type == "Polygon"


def test_polygon_vertex_count_is_capped():
    # An unbounded ring is a denial of service against PostGIS and MapLibre
    # alike, and no boundary ADA draws needs ten thousand vertices.
    ring = [[78.0 + i * 1e-6, 27.0] for i in range(10_001)] + [[78.0, 27.0]]
    with pytest.raises(ValidationError):
        GeoPolygon(coordinates=[ring])


def test_bbox_parses_and_refuses_an_unbounded_extent():
    box = BBox.parse("78.0,27.0,78.1,27.1")
    assert (box.west, box.north) == (78.0, 27.1)
    with pytest.raises(ValidationError):
        BBox.parse("-180,-90,180,90")


def test_bbox_refuses_reversed_corners():
    with pytest.raises(ValidationError):
        BBox.parse("78.1,27.0,78.0,27.1")


# --- query shaping ---------------------------------------------------------

def test_page_params_cap_the_page_size():
    params = PageParams(page=3, size=50)
    assert (params.offset, params.limit) == (100, 50)
    with pytest.raises(ValidationError):
        PageParams(size=5000)


def test_safe_sort_whitelists_the_column():
    allowed = {"raised_at": "raised_at", "status": "status"}
    assert safe_sort("-raised_at", allowed, "raised_at") == ("raised_at", True)
    assert safe_sort(None, allowed, "raised_at") == ("raised_at", False)


def test_safe_sort_refuses_an_unknown_key():
    # This is the one place a request value could still reach the SQL text.
    with pytest.raises(ValueError, match="cannot sort by"):
        safe_sort("id; DROP TABLE icms_case", {"raised_at": "raised_at"}, "raised_at")


def test_escape_like_stops_a_search_term_acting_as_a_wildcard():
    assert escape_like("100%") == r"100\%"
    assert escape_like("a_b") == r"a\_b"
    assert escape_like(r"back\slash") == r"back\\slash"


# --- files -----------------------------------------------------------------

@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("../../etc/passwd", "passwd"),
        (r"C:\Users\x\IMG_1.jpg", "IMG_1.jpg"),
        ("IMG 0001 (1).jpg", "IMG_0001_1.jpg"),
        ("...", "upload"),
        (None, "upload"),
    ],
)
def test_safe_filename(raw, expected):
    assert safe_filename(raw) == expected


def test_safe_filename_keeps_the_extension_when_truncating():
    name = safe_filename("a" * 300 + ".jpg")
    assert name.endswith(".jpg")
    assert len(name) <= 120


def test_check_upload_refuses_type_and_size():
    check_upload(
        content_type="image/jpeg", byte_size=1024,
        allowed_types=IMAGE_TYPES, max_bytes=MAX_IMAGE_BYTES,
    )
    with pytest.raises(ValueError, match="unsupported content type"):
        check_upload(
            content_type="application/x-msdownload", byte_size=1024,
            allowed_types=IMAGE_TYPES, max_bytes=MAX_IMAGE_BYTES,
        )
    with pytest.raises(ValueError, match="exceeds"):
        check_upload(
            content_type="image/jpeg", byte_size=MAX_IMAGE_BYTES + 1,
            allowed_types=IMAGE_TYPES, max_bytes=MAX_IMAGE_BYTES,
        )


# --- output edges ----------------------------------------------------------

def test_escape_html_is_applied_at_render_not_at_storage():
    assert escape_html('width < 3 m & "open"') == "width &lt; 3 m &amp; &quot;open&quot;"


def test_redact_removes_personal_data_but_keeps_the_shape():
    payload = {
        "case_ref": "CMP-2026-0001",
        "owner_name": "Someone",
        "complainant_phone": "9876543210",
        "location": {"latitude": 27.1, "longitude": 78.0},
        "findings": [{"finding": "ok", "occupant_email": "a@b.com"}],
    }
    out = redact(payload)
    assert out["case_ref"] == "CMP-2026-0001"
    assert out["owner_name"] == "[redacted]"
    assert out["complainant_phone"] == "[redacted]"
    assert out["location"]["latitude"] == "[redacted]"
    assert out["findings"][0]["finding"] == "ok"
    assert out["findings"][0]["occupant_email"] == "[redacted]"


def test_redact_does_not_recurse_forever():
    payload: dict = {}
    node = payload
    for _ in range(50):
        node["child"] = {}
        node = node["child"]
    redact(payload)  # must return rather than hit the recursion limit


# --- canonical forms -------------------------------------------------------

from datetime import datetime, timedelta, timezone  # noqa: E402

from ada_core.validation import (  # noqa: E402
    PlaceName,
    canonical_name,
    check_device_timestamp,
    dedupe_key,
    parse_legacy_bool,
    round_coordinate,
)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("VAIBHAV", "Vaibhav"),
        ("vaibhav", "Vaibhav"),
        ("VAIBHAV SAHAY", "Vaibhav Sahay"),
        ("  vaibhav   sahay  ", "Vaibhav Sahay"),
        ("r.k. sharma", "R.K. Sharma"),
        ("MOHD. ASLAM", "Mohd. Aslam"),
        ("ram-kumar", "Ram-Kumar"),
        ("d'souza", "D'Souza"),
    ],
)
def test_single_case_names_are_canonicalised(raw, expected):
    # Three officers typing the same person three ways is three rows in the
    # register that look like three people.
    assert canonical_name(raw) == expected


@pytest.mark.parametrize("raw", ["McDonald", "d'Souza", "Vaibhav Sahay", "DeSilva"])
def test_mixed_case_names_are_left_exactly_alone(raw):
    # Already typed deliberately. Re-casing these is how a system corrupts a
    # name somebody has to spell in court.
    assert canonical_name(raw) == raw


def test_devanagari_is_untouched():
    # No cased characters, so isupper() and islower() are both False and the
    # rewrite never runs.
    assert canonical_name("मोहन कुमार") == "मोहन कुमार"


def test_name_field_applies_canonicalisation():
    assert TextModel(note="ok", owner="VAIBHAV SAHAY").owner == "Vaibhav Sahay"


def test_place_name_uses_the_same_rule():
    class M(BaseModel):
        district: PlaceName

    assert M(district="AGRA").district == "Agra"


def test_reference_is_upper_cased_before_matching():
    # A reference is copied out of an email or a printed notice at least as
    # often as it is typed clean.
    class M(BaseModel):
        ref: CaseRef

    assert M(ref=" cmp-2026-0001 ").ref == "CMP-2026-0001"


def test_coordinate_precision_is_capped():
    # The eighth decimal is under a millimetre. A phone fix is metres at best,
    # so it is noise that makes two readings of one spot compare unequal.
    assert round_coordinate(78.04567891234) == 78.0456789


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("YES", True), ("Active", True), ("1", True), ("NO", False), ("INACTIVE", False),
     ("", False), ("maybe", None), (None, None), (True, True)],
)
def test_legacy_flags_parse_to_one_boolean(raw, expected):
    assert parse_legacy_bool(raw) is expected


def test_dedupe_key_ignores_case_spacing_and_punctuation():
    assert dedupe_key("VAIBHAV  SAHAY.", "9876543210") == "vaibhavsahay|9876543210"
    assert dedupe_key("Vaibhav Sahay", "9876543210") == dedupe_key("vaibhav sahay", "9876543210")


def test_device_timestamp_must_be_timezone_aware():
    # A naive timestamp is why a capture appears five and a half hours in the
    # past: the phone sends local time and the server assumes UTC.
    with pytest.raises(ValueError, match="timezone offset"):
        check_device_timestamp(datetime(2026, 9, 18, 10, 15))


def test_device_timestamp_rejects_a_wrong_clock():
    ist = timezone(timedelta(hours=5, minutes=30))
    now = datetime(2026, 9, 18, 10, 15, tzinfo=ist)
    assert check_device_timestamp(now, now=now) == now
    with pytest.raises(ValueError, match="future"):
        check_device_timestamp(now + timedelta(days=1), now=now)
    with pytest.raises(ValueError, match="past"):
        check_device_timestamp(now - timedelta(days=365), now=now)
