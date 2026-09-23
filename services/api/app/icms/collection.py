from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from ada_core.validation import PageParams, escape_like, safe_sort
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import Row, Select, func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.sql.elements import ColumnElement

from ..errors import ApiError

__all__ = [
    "CollectionParams",
    "Page",
    "PageResult",
    "Sortable",
    "paginate",
    "search_clause",
]

TOTAL_LABEL = "__total"


class CollectionParams(PageParams):
    model_config = ConfigDict(extra="forbid")

    sort: str | None = Field(
        default=None,
        max_length=64,
        description="A sort key from this endpoint's whitelist. '-key' sorts descending.",
    )
    q: str | None = Field(
        default=None,
        max_length=120,
        description="Free-text search across this endpoint's searchable columns.",
    )


@dataclass(frozen=True)
class Sortable:
    columns: Mapping[str, ColumnElement]
    default: str
    tiebreaker: ColumnElement

    @property
    def keys(self) -> list[str]:
        return sorted(self.columns)


@dataclass(frozen=True)
class PageResult:
    rows: Sequence[Row]
    total: int
    page: int
    size: int
    sort: str

    @property
    def pages(self) -> int:
        if self.size <= 0:
            return 0
        return (self.total + self.size - 1) // self.size

    @property
    def next_cursor(self) -> str | None:
        return str(self.page + 1) if self.page < self.pages else None


class Page[T](BaseModel):
    items: list[T]
    page: int
    size: int
    total: int
    pages: int
    sort: str
    next_cursor: str | None = None

    @classmethod
    def of(cls, items: list[T], result: PageResult) -> Page[T]:
        return cls(
            items=items,
            page=result.page,
            size=result.size,
            total=result.total,
            pages=result.pages,
            sort=result.sort,
            next_cursor=result.next_cursor,
        )


def resolve_sort(params: CollectionParams, sortable: Sortable) -> tuple[str, list[Any]]:
    requested = params.sort or sortable.default
    keys = {key: key for key in sortable.columns}
    try:
        key, descending = safe_sort(requested, keys, sortable.default.lstrip("-"))
    except ValueError as exc:
        raise ApiError(
            400, "unknown_sort_field", str(exc), field="sort", allowed=sortable.keys
        ) from exc

    column = sortable.columns[key]
    order = [column.desc() if descending else column.asc()]
    if column is not sortable.tiebreaker:
        order.append(
            sortable.tiebreaker.desc() if descending else sortable.tiebreaker.asc()
        )
    return (f"-{key}" if descending else key), order


def search_clause(term: str, columns: Sequence[ColumnElement]) -> ColumnElement:
    pattern = f"%{escape_like(term)}%"
    return or_(*[column.ilike(pattern, escape="\\") for column in columns])


def paginate(
    db: Session,
    statement: Select,
    params: CollectionParams,
    sortable: Sortable,
) -> PageResult:
    sort_label, order = resolve_sort(params, sortable)

    paged = (
        statement.add_columns(func.count().over().label(TOTAL_LABEL))
        .order_by(*order)
        .offset(params.offset)
        .limit(params.limit)
    )
    rows = db.execute(paged).all()

    if rows:
        total = int(rows[0]._mapping[TOTAL_LABEL])
    else:
        total = int(
            db.execute(
                select(func.count()).select_from(statement.order_by(None).subquery())
            ).scalar_one()
        )

    return PageResult(
        rows=rows, total=total, page=params.page, size=params.size, sort=sort_label
    )


def row_dict(row: Row) -> dict:
    return {key: value for key, value in row._mapping.items() if key != TOTAL_LABEL}
