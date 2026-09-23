"""One clock: everything stored and returned carries +05:30, never Z."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from pydantic import BaseModel

from ada_core import models, models_icms
from ada_core.datetimes import (
    IST,
    IST_NAME,
    IstDateTime,
    from_ist,
    isoformat_ist,
    now_ist,
    parse_ist,
    to_ist,
)

HALF_PAST_FIVE = timedelta(hours=5, minutes=30)


def test_now_ist_carries_the_india_offset():
    stamped = now_ist()
    assert stamped.tzinfo is not None
    assert stamped.utcoffset() == HALF_PAST_FIVE


def test_india_keeps_one_offset_all_year():
    """No DST, so +05:30 in January and +05:30 in July. Every conversion here
    relies on that; a zone with DST would need the instant, not the offset."""
    for month in range(1, 13):
        assert datetime(2026, month, 15, 12, tzinfo=IST).utcoffset() == HALF_PAST_FIVE


def test_a_naive_value_is_read_as_utc():
    """Every column was written with datetime.now(UTC) before this module, so a
    naive value coming back is a UTC reading — reading it as local shifts it 5.5h."""
    assert to_ist(datetime(2026, 1, 1, 0, 0)) == datetime(2026, 1, 1, 5, 30, tzinfo=IST)


def test_an_aware_utc_value_converts_to_the_same_instant():
    utc = datetime(2026, 12, 31, 23, 30, tzinfo=UTC)
    converted = to_ist(utc)
    assert converted.utcoffset() == HALF_PAST_FIVE
    # The new year in India, still the old one in UTC. This is the reference-number bug.
    assert (converted.year, converted.month, converted.day) == (2027, 1, 1)
    assert converted == utc


def test_from_ist_reads_a_naive_value_as_local_wall_clock():
    assert from_ist(datetime(2026, 1, 1, 5, 30)) == datetime(2026, 1, 1, 0, 0, tzinfo=UTC)


def test_the_round_trip_preserves_the_instant():
    instant = datetime(2026, 6, 1, 9, 15, 30, tzinfo=UTC)
    assert from_ist(to_ist(instant)) == instant


def test_parse_pins_an_offsetless_string_to_ist():
    """A handset sends local time. Reading it as UTC back-dates the capture by
    five and a half hours, which the device-timestamp skew check then rejects."""
    assert parse_ist("2026-09-22T14:05:00") == datetime(2026, 9, 22, 14, 5, tzinfo=IST)


def test_parse_respects_an_explicit_offset():
    assert parse_ist("2026-09-22T08:35:00Z") == datetime(2026, 9, 22, 14, 5, tzinfo=IST)


def test_parse_rejects_something_that_is_not_a_timestamp():
    with pytest.raises(ValueError):
        parse_ist("yesterday")


def test_the_serializer_always_ends_in_the_offset():
    assert isoformat_ist(datetime(2026, 9, 22, 8, 35, tzinfo=UTC)).endswith("+05:30")
    assert isoformat_ist(datetime(2026, 9, 22, 8, 35)).endswith("+05:30")
    assert "Z" not in isoformat_ist(now_ist())


def test_a_response_field_serializes_in_ist():
    """The annotation is what a router gets right or wrong; a plain datetime
    serializes in whatever zone the row happened to come back in."""

    class Row(BaseModel):
        created_at: IstDateTime

    row = Row(created_at=datetime(2026, 9, 22, 8, 35, tzinfo=UTC))
    assert row.model_dump(mode="json")["created_at"] == "2026-09-22T14:05:00+05:30"


def test_every_timestamp_default_stamps_in_ist():
    """The defaults are the whole mechanism. One column still on a UTC default
    would be the only row in the register an officer has to convert by hand."""
    for module in (models, models_icms):
        for table in module.Base.metadata.tables.values():
            for column in table.columns:
                if getattr(column.type, "timezone", False) and column.default is not None:
                    # SQLAlchemy wraps a zero-argument default, so unwrap before comparing.
                    arg = column.default.arg
                    assert getattr(arg, "__wrapped__", arg) is now_ist, \
                        f"{table.name}.{column.name}"


def test_the_zone_is_named_not_offset_hardcoded():
    """The PostgreSQL session is pinned by name, so the database and Python
    agree by construction rather than by two copies of '+05:30'."""
    assert IST_NAME == "Asia/Kolkata"
    assert str(IST) == "Asia/Kolkata"
