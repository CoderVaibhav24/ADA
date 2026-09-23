from __future__ import annotations

from datetime import datetime
from enum import StrEnum

from ada_core.datetimes import IST, now_ist
from ada_core.models_icms import AUTHORITY_WIDE, NoticeSequence
from sqlalchemy import update
from sqlalchemy.orm import Session

from ..errors import ApiError

__all__ = [
    "AUTHORITY_WIDE",
    "Series",
    "allocate",
    "current_year",
    "next_sequence",
]


class Series(StrEnum):
    CASE = "CMP"
    INSPECTION = "INS"
    NOTICE = "NTC"


MAX_SEQUENCE = 9999


# The reference year is the Indian calendar year; taking it from UTC misfiles every
# complaint raised between midnight and 05:30 IST into the previous year.
def current_year(now: datetime | None = None) -> int:
    return (now or now_ist()).astimezone(IST).year


def next_sequence(
    db: Session, year: int, *, series: str = Series.CASE, scope_cd: str = AUTHORITY_WIDE
) -> int:
    if db.get_bind().dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        from sqlalchemy.dialects.sqlite import insert

    db.execute(
        insert(NoticeSequence)
        .values(series=str(series), scope_cd=scope_cd, year=year, last_seq=0)
        .on_conflict_do_nothing(index_elements=["series", "scope_cd", "year"])
    )
    sequence = db.execute(
        update(NoticeSequence)
        .where(
            NoticeSequence.series == str(series),
            NoticeSequence.scope_cd == scope_cd,
            NoticeSequence.year == year,
        )
        .values(last_seq=NoticeSequence.last_seq + 1)
        .returning(NoticeSequence.last_seq)
    ).scalar_one()
    return int(sequence)


def allocate(
    db: Session,
    series: Series | str,
    *,
    year: int | None = None,
    scope_cd: str = AUTHORITY_WIDE,
) -> str:
    series = Series(series)
    year = year if year is not None else current_year()
    sequence = next_sequence(db, year, series=series, scope_cd=scope_cd)
    if sequence > MAX_SEQUENCE:
        scope = "" if scope_cd == AUTHORITY_WIDE else f" in {scope_cd}"
        raise ApiError(
            409,
            "sequence_exhausted",
            f"the {series} series for {year}{scope} is full at {MAX_SEQUENCE} "
            "references; the reference format needs a fifth digit",
        )
    return f"{series}-{year}-{sequence:04d}"
