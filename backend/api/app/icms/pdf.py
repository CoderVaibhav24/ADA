"""A deterministic PDF writer, in the standard library and nothing else.

Why not a library. A notice is an artefact that has to reproduce byte for byte
on reprint — the document served is the document a court sees — and every PDF
writer reachable from pip stamps a creation timestamp into the file by default.
Two renders of the same notice then differ in bytes while being identical in
content, which is exactly the property the artefact store exists to deny. This
writer has no clock in it: the only bytes it emits come from its arguments.

What it costs. Base-14 fonts only, WinAnsi-encoded, so nothing is embedded and
nothing is fetched. Devanagari cannot be drawn — a character outside cp1252
becomes `?`. That is the first thing ADA's official template will need and it
is named in `notice_template.py`'s swap list.

This module knows nothing about notices. It draws text, rules and boxes on A4.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field

__all__ = [
    "A4_HEIGHT",
    "A4_WIDTH",
    "FONTS",
    "Document",
    "Page",
    "text_width",
    "wrap",
]

# A4 in PostScript points, which is the only unit a PDF has.
A4_WIDTH = 595.276
A4_HEIGHT = 841.89

# The faces this writer draws with, by the name a caller uses. Insertion order
# fixes the /F1../F4 tags, so the resource dictionary is stable across renders.
FONTS: dict[str, str] = {
    "sans": "Helvetica",
    "sans-bold": "Helvetica-Bold",
    "sans-italic": "Helvetica-Oblique",
    "serif-bold": "Times-Bold",
}

_TAGS: dict[str, str] = {name: f"F{index}" for index, name in enumerate(FONTS, start=1)}

# Approximate advance widths, in ems. The real answer is an AFM metrics table per
# face; this is within a few per cent and only decides where a line wraps, which
# is a layout question and not a legal one. A measured table is part of the swap.
_NARROW = frozenset(" .,:;'`|!()[]{}/\\-iljtfIr")
_WIDE = frozenset("MWmw@%")
_BOLD_FACTOR = 1.06


def _char_width(character: str) -> float:
    if character in _NARROW:
        return 0.28
    if character in _WIDE:
        return 0.85
    if character.isupper():
        return 0.70
    if character.isdigit():
        return 0.556
    return 0.53


def text_width(value: str, size: float, *, bold: bool = False) -> float:
    """The drawn width of `value` in points, near enough to wrap a paragraph by."""
    total = sum(_char_width(character) for character in value) * size
    return total * _BOLD_FACTOR if bold else total


# Greedy, and a word longer than the column is cut rather than allowed to run off
# the page: a khasra number that overflows the margin is a notice that looks forged.
def wrap(value: str, width: float, size: float, *, bold: bool = False) -> list[str]:
    """`value` broken into lines that fit `width` points."""
    lines: list[str] = []
    for paragraph in value.split("\n"):
        current = ""
        for word in paragraph.split():
            candidate = f"{current} {word}".strip()
            if current and text_width(candidate, size, bold=bold) > width:
                lines.append(current)
                current = word
            else:
                current = candidate
            while text_width(current, size, bold=bold) > width and len(current) > 1:
                cut = max(1, int(len(current) * width / text_width(current, size, bold=bold)))
                lines.append(current[:cut])
                current = current[cut:]
        lines.append(current)
    return lines


_ESCAPES = str.maketrans({"\\": r"\\", "(": r"\(", ")": r"\)"})


def _literal(value: str) -> bytes:
    return value.translate(_ESCAPES).encode("cp1252", errors="replace")


# Trailing zeros dropped so the same coordinate is always the same bytes.
def _num(value: float) -> bytes:
    text = f"{value:.3f}".rstrip("0").rstrip(".")
    return (text or "0").encode("ascii")


@dataclass
class Page:
    """One A4 side, in PDF user space: the origin is the BOTTOM left corner."""

    width: float = A4_WIDTH
    height: float = A4_HEIGHT
    ops: list[bytes] = field(default_factory=list)

    def text(self, x: float, y: float, value: str, *, font: str = "sans",
             size: float = 10.0) -> None:
        tag = _TAGS[font].encode("ascii")
        self.ops.append(
            b"BT /%s %s Tf %s %s Td (%s) Tj ET"
            % (tag, _num(size), _num(x), _num(y), _literal(value))
        )

    def line(self, x1: float, y1: float, x2: float, y2: float, *, width: float = 0.6) -> None:
        self.ops.append(
            b"%s w %s %s m %s %s l S"
            % (_num(width), _num(x1), _num(y1), _num(x2), _num(y2))
        )

    def rect(self, x: float, y: float, width: float, height: float, *,
             stroke: float = 0.6) -> None:
        self.ops.append(
            b"%s w %s %s %s %s re S"
            % (_num(stroke), _num(x), _num(y), _num(width), _num(height))
        )

    def stream(self) -> bytes:
        return b"\n".join(self.ops)


class Document:
    """A whole PDF, assembled in memory and serialised once."""

    def __init__(self, title: str = "") -> None:
        self.title = title
        self.pages: list[Page] = []

    def page(self) -> Page:
        page = Page()
        self.pages.append(page)
        return page

    # Objects are numbered before they are filled, because a page has to name its
    # content stream and the stream is not written until the page is laid out.
    def tobytes(self) -> bytes:
        objects: list[bytes] = []

        def reserve() -> int:
            objects.append(b"")
            return len(objects)

        catalog = reserve()
        pages = reserve()
        page_ids = [reserve() for _ in self.pages]
        stream_ids = [reserve() for _ in self.pages]
        font_ids = {name: reserve() for name in FONTS}
        info = reserve()

        objects[catalog - 1] = b"<< /Type /Catalog /Pages %d 0 R >>" % pages
        kids = b" ".join(b"%d 0 R" % number for number in page_ids)
        objects[pages - 1] = (
            b"<< /Type /Pages /Count %d /Kids [%s] >>" % (len(page_ids), kids)
        )

        resources = (
            b"<< /Font << "
            + b" ".join(
                b"/%s %d 0 R" % (_TAGS[name].encode("ascii"), font_ids[name])
                for name in FONTS
            )
            + b" >> >>"
        )

        for index, page in enumerate(self.pages):
            objects[page_ids[index] - 1] = (
                b"<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %s %s] "
                b"/Resources %s /Contents %d 0 R >>"
                % (pages, _num(page.width), _num(page.height), resources, stream_ids[index])
            )
            body = page.stream()
            objects[stream_ids[index] - 1] = (
                b"<< /Length %d >>\nstream\n%s\nendstream" % (len(body), body)
            )

        for name, base in FONTS.items():
            objects[font_ids[name] - 1] = (
                b"<< /Type /Font /Subtype /Type1 /BaseFont /%s /Encoding /WinAnsiEncoding >>"
                % base.encode("ascii")
            )

        # No /CreationDate and no /ModDate: that pair is what makes every other
        # writer produce different bytes for the same document.
        objects[info - 1] = (
            b"<< /Title (%s) /Producer (ADA ICMS) >>" % _literal(self.title)
        )

        out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
        offsets: list[int] = []
        for number, body in enumerate(objects, start=1):
            offsets.append(len(out))
            out += b"%d 0 obj\n" % number + body + b"\nendobj\n"

        start_xref = len(out)
        out += b"xref\n0 %d\n" % (len(objects) + 1)
        out += b"0000000000 65535 f \n"
        for offset in offsets:
            out += b"%010d 00000 n \n" % offset

        # /ID is a file identifier, normally random. Derived from the body here so
        # that it, too, is a function of the content and of nothing else.
        digest = hashlib.sha256(bytes(out)).hexdigest()[:32].upper().encode("ascii")
        out += (
            b"trailer\n<< /Size %d /Root %d 0 R /Info %d 0 R /ID [<%s> <%s>] >>\n"
            % (len(objects) + 1, catalog, info, digest, digest)
        )
        out += b"startxref\n%d\n%%%%EOF\n" % start_xref
        return bytes(out)
