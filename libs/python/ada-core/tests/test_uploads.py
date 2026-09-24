"""The shared validator: what it refuses, and what it never reads into memory."""

from __future__ import annotations

import io

import pytest

from ada_core.uploads import CHUNK_BYTES, UploadRules, dimensions, sniff, validate_upload

PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
PNG_END = b"\x00\x00\x00\x00IEND\xaeB`\x82"


def jpeg(width: int = 640, height: int = 480, body: bytes = b"\x00" * 64) -> bytes:
    sof = (b"\xff\xc0\x00\x11\x08"
           + height.to_bytes(2, "big") + width.to_bytes(2, "big")
           + b"\x03\x01\x22\x00\x02\x11\x01\x03\x11\x01")
    return b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" \
        + sof + body + b"\xff\xd9"


def png(width: int = 100, height: int = 100, body: bytes = b"\x00" * 64) -> bytes:
    ihdr = (b"\x00\x00\x00\rIHDR"
            + width.to_bytes(4, "big") + height.to_bytes(4, "big")
            + b"\x08\x06\x00\x00\x00\x00\x00\x00\x00")
    return PNG_MAGIC + ihdr + body + PNG_END


def pdf(body: bytes = b"\x00" * 64) -> bytes:
    return b"%PDF-1.7\n" + body + b"\ntrailer\n%%EOF\n"


def mp4(brand: bytes = b"isom", body: bytes = b"\x00" * 64) -> bytes:
    box = b"\x00\x00\x00\x18ftyp" + brand + b"\x00\x00\x02\x00" + brand
    return box + body


def webp(chunk: bytes = b"VP8X", width: int = 800, height: int = 600) -> bytes:
    if chunk == b"VP8X":
        payload = (b"\x00" * 4 + (width - 1).to_bytes(3, "little")
                   + (height - 1).to_bytes(3, "little"))
    elif chunk == b"VP8L":
        bits = (width - 1) | ((height - 1) << 14)
        payload = b"\x2f" + bits.to_bytes(4, "little") + b"\x00"
    else:
        payload = (b"\x00" * 3 + b"\x9d\x01\x2a" + width.to_bytes(2, "little")
                   + height.to_bytes(2, "little"))
    body = b"WEBP" + chunk + len(payload).to_bytes(4, "little") + payload
    return b"RIFF" + len(body).to_bytes(4, "little") + body


COMPLAINT_PHOTO = UploadRules(
    kind="complaint_photo",
    mime_types=("image/jpeg", "image/png", "image/webp"),
    extensions=(".jpg", ".jpeg", ".png", ".webp"),
    max_bytes=15 * 1024 * 1024,
    max_pixels=40_000_000,
)

PHOTO = UploadRules(
    kind="photo",
    mime_types=("image/jpeg", "image/png", "image/heic"),
    extensions=(".jpg", ".jpeg", ".png", ".heic"),
    max_bytes=15 * 1024 * 1024,
    max_pixels=40_000_000,
)
DOCUMENT = UploadRules(
    kind="document", mime_types=("application/pdf",), extensions=(".pdf",),
    max_bytes=25 * 1024 * 1024,
)
VIDEO = UploadRules(
    kind="video", mime_types=("video/mp4", "video/quicktime"), extensions=(".mp4", ".mov"),
    max_bytes=200 * 1024 * 1024,
)


def check(data: bytes, rules: UploadRules = PHOTO, **kw):
    return validate_upload(io.BytesIO(data), rules, **kw)


# --- sniffing --------------------------------------------------------------

@pytest.mark.parametrize(("data", "expected"), [
    (jpeg(), "image/jpeg"),
    (png(), "image/png"),
    (pdf(), "application/pdf"),
    (mp4(b"isom"), "video/mp4"),
    (mp4(b"mp42"), "video/mp4"),
    (mp4(b"qt  "), "video/quicktime"),
    (mp4(b"heic"), "image/heic"),
    (mp4(b"mif1"), "image/heic"),
    (webp(), "image/webp"),
])
def test_the_format_is_read_off_the_bytes(data, expected):
    assert sniff(data) == expected


def test_an_unknown_format_sniffs_as_nothing():
    """Not "probably fine". A format nothing here recognises is a format the
    thumbnailer and the PDF renderer downstream have never been tested against."""
    assert sniff(b"MZ\x90\x00this is a windows executable") is None
    assert sniff(b"") is None


def test_dimensions_come_out_of_the_header():
    assert dimensions("image/png", png(1920, 1080)) == (1920, 1080)
    assert dimensions("image/jpeg", jpeg(4032, 3024)) == (4032, 3024)
    assert dimensions("application/pdf", pdf()) is None


@pytest.mark.parametrize("chunk", [b"VP8X", b"VP8L", b"VP8 "])
def test_webp_dimensions_come_out_of_each_chunk_form(chunk):
    assert dimensions("image/webp", webp(chunk, 1920, 1080)) == (1920, 1080)


def test_a_webp_passes_a_policy_that_admits_it_and_not_the_photo_policy():
    assert check(webp(), COMPLAINT_PHOTO, filename="a.webp").media_type == "image/webp"
    assert check(webp(), PHOTO).code == "unsupported_media_type"


def test_a_truncated_webp_is_refused():
    assert check(webp()[:-4], COMPLAINT_PHOTO).code == "corrupt_file"


def test_a_webp_above_the_pixel_ceiling_is_refused():
    assert check(webp(width=10000, height=10000), COMPLAINT_PHOTO).code == "image_too_large"


# --- what gets refused -----------------------------------------------------

def test_a_jpg_that_is_really_a_pdf_is_refused():
    """The client's filename and Content-Type both say JPEG; the bytes say PDF.
    Trusting either is how a renderer ends up parsing something it cannot."""
    result = check(pdf(), filename="site-photo.jpg", declared_type="image/jpeg")
    assert not result.ok
    assert result.status_code == 415
    assert result.code in ("unsupported_media_type", "content_type_mismatch")


def test_a_png_declared_as_jpeg_is_refused_as_a_mismatch():
    result = check(png(), filename="x.png", declared_type="image/jpeg")
    assert not result.ok
    assert result.code == "content_type_mismatch"
    assert result.field == "content_type"


def test_an_extension_outside_the_allowlist_is_refused():
    result = check(jpeg(), filename="payload.exe", declared_type="image/jpeg")
    assert not result.ok
    assert result.code == "extension_not_allowed"
    assert ".jpg" in result.allowed


def test_a_file_with_no_extension_is_refused():
    assert check(jpeg(), filename="photo").code == "extension_not_allowed"


def test_a_pdf_is_refused_for_the_photo_kind():
    """Per-kind rules, from the database. A document is fine — as a document."""
    assert not check(pdf(), filename="deed.pdf").ok
    assert check(pdf(), DOCUMENT, filename="deed.pdf", declared_type="application/pdf").ok


def test_a_zero_byte_file_is_refused():
    """A failed handset upload writes an empty file rather than none at all."""
    result = check(b"", filename="photo.jpg")
    assert result.code == "empty_file"
    assert result.status_code == 422


def test_a_truncated_jpeg_is_refused():
    """It sniffs as a JPEG because the first three bytes are right. It has no
    end-of-image marker, so it decodes to a grey band on the officer's screen."""
    result = check(jpeg()[:-2], filename="photo.jpg")
    assert result.code == "corrupt_file"
    assert result.status_code == 422


def test_a_truncated_pdf_is_refused():
    assert check(pdf()[:-8], DOCUMENT, filename="deed.pdf").code == "corrupt_file"


def test_an_image_above_the_pixel_ceiling_is_refused():
    """A 30000x30000 PNG is four megabytes on the wire and 3.6 GB decoded."""
    rules = UploadRules(kind="photo", mime_types=("image/png",), extensions=(".png",),
                        max_bytes=15 * 1024 * 1024, max_pixels=40_000_000)
    assert check(png(30000, 30000), rules, filename="bomb.png").code == "image_too_large"


def test_a_kind_with_no_policy_row_refuses_everything():
    """The fail-closed direction: an unseeded kind accepts nothing rather than
    falling through to a permissive default."""
    result = check(jpeg(), UploadRules(kind="signature"), filename="sig.png")
    assert result.code == "upload_policy_missing"
    assert result.status_code == 503


# --- size, counted rather than buffered ------------------------------------

class CountingStream(io.BytesIO):
    """Records how much of itself was actually pulled."""

    def __init__(self, data: bytes) -> None:
        super().__init__(data)
        self.bytes_read = 0

    def read(self, size: int = -1) -> bytes:
        block = super().read(size)
        self.bytes_read += len(block)
        return block


def test_an_oversize_file_is_refused():
    rules = UploadRules(kind="photo", mime_types=("image/jpeg",), extensions=(".jpg",),
                        max_bytes=1024)
    result = check(jpeg(body=b"\x00" * 4096), rules, filename="big.jpg")
    assert result.code == "payload_too_large"
    assert result.status_code == 413


def test_an_oversize_file_is_refused_without_reading_all_of_it():
    """The requirement behind the whole streaming design: a 2 GB upload against
    a 15 MB limit must not become 2 GB of resident memory before it is refused."""
    rules = UploadRules(kind="photo", mime_types=("image/jpeg",), extensions=(".jpg",),
                        max_bytes=64 * 1024)
    stream = CountingStream(jpeg(body=b"\x00" * (8 * 1024 * 1024)))
    result = validate_upload(stream, rules, filename="big.jpg")
    assert result.code == "payload_too_large"
    assert stream.bytes_read < 8 * 1024 * 1024
    # At most the head plus the one chunk that crossed the limit.
    assert stream.bytes_read <= rules.max_bytes + CHUNK_BYTES


def test_nothing_reaches_the_sink_until_the_type_is_proven():
    """The user's requirement, literally: no corrupted file ever lands on the
    server. A rejected upload must not have been written anywhere first."""
    sink = io.BytesIO()
    assert not check(pdf(), filename="photo.jpg", declared_type="image/jpeg", sink=sink).ok
    assert sink.getvalue() == b""


def test_an_accepted_file_is_written_whole_and_hashed():
    data = jpeg(body=b"\x11" * (200 * 1024))
    sink = io.BytesIO()
    result = check(data, filename="photo.jpg", declared_type="image/jpeg", sink=sink)
    assert result.ok
    assert sink.getvalue() == data
    assert result.byte_size == len(data)
    assert result.media_type == "image/jpeg"
    assert result.extension == ".jpg"
    assert len(result.sha256) == 64


def test_a_video_passes_its_own_rules():
    assert check(mp4(), VIDEO, filename="clip.mp4", declared_type="video/mp4").ok


# --- the policy row --------------------------------------------------------

def test_rules_are_normalised_off_the_row():
    """'JPG' and 'IMAGE/JPEG' in the database would otherwise match nothing,
    and the failure would look like a broken client rather than a bad row."""

    class Row:
        kind = "photo"
        mime_types = ["IMAGE/JPEG", " image/png "]
        extensions = ["JPG", ".PNG"]
        max_bytes = 100
        max_pixels = None
        storage_backend = None

    rules = UploadRules.from_row(Row())
    assert rules.mime_types == ("image/jpeg", "image/png")
    assert rules.extensions == (".jpg", ".png")
    assert rules.max_pixels is None
    assert rules.storage_backend == "local"
