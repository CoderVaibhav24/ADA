"""One clock for the whole stack: Asia/Kolkata, from stdlib zoneinfo."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from pydantic import AfterValidator, PlainSerializer

__all__ = [
    "IST",
    "IST_NAME",
    "IST_OFFSET",
    "IstDateTime",
    "from_ist",
    "isoformat_ist",
    "now_ist",
    "parse_ist",
    "to_ist",
]

IST_NAME = "Asia/Kolkata"
IST = ZoneInfo(IST_NAME)
IST_OFFSET = "+05:30"


# Every stored timestamp starts here; a naive datetime.now() is read back in the server's zone.
def now_ist() -> datetime:
    return datetime.now(IST)


# A naive value is read as UTC, which is what every column was written with before this module.
def to_ist(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        value = value.replace(tzinfo=UTC)
    return value.astimezone(IST)


# The way out of IST: a naive value is a local wall-clock reading, so it is pinned before shifting.
def from_ist(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        value = value.replace(tzinfo=IST)
    return value.astimezone(UTC)


# An offset-less string is a local reading and is pinned to IST, never to UTC.
def parse_ist(text: str) -> datetime:
    parsed = datetime.fromisoformat(text.strip())
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        parsed = parsed.replace(tzinfo=IST)
    return parsed.astimezone(IST)


# The only serializer a response may use: it always ends in +05:30 and never in Z.
def isoformat_ist(value: datetime) -> str:
    return to_ist(value).isoformat()


# Annotate a response field with this, not plain datetime, or it serializes in whatever zone
# the row came back in.
IstDateTime = Annotated[
    datetime,
    AfterValidator(to_ist),
    PlainSerializer(isoformat_ist, return_type=str, when_used="json"),
]
