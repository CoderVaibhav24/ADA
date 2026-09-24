from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any

from ada_core.datetimes import now_ist
from ada_core.models_icms import RuntimeSetting
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..errors import ApiError

__all__ = [
    "GEOFENCE_ENFORCED",
    "GEOFENCE_RADIUS_M",
    "KNOWN",
    "REMINDERS_ENABLED",
    "REMINDER_INTERVAL_MINUTES",
    "QUIET_END_HOUR",
    "QUIET_START_HOUR",
    "RESURVEY_DECISION_DAYS",
    "SURVEY_DUE_DAYS",
    "SURVEY_OVERDUE_DAYS",
    "VERIFICATION_DUE_DAYS",
    "clear_cache",
    "flag",
    "geofence_enforced",
    "geofence_radius_m",
    "number",
    "read_all",
    "write",
]

GEOFENCE_ENFORCED = "checkin.geofence_enforced"
GEOFENCE_RADIUS_M = "checkin.geofence_radius_m"

REMINDERS_ENABLED = "reminders.enabled"
REMINDER_INTERVAL_MINUTES = "reminders.interval_minutes"
QUIET_START_HOUR = "reminders.quiet_start_hour"
QUIET_END_HOUR = "reminders.quiet_end_hour"
SURVEY_DUE_DAYS = "reminders.survey_due_days"
SURVEY_OVERDUE_DAYS = "reminders.survey_overdue_days"
VERIFICATION_DUE_DAYS = "reminders.verification_due_days"
RESURVEY_DECISION_DAYS = "reminders.resurvey_decision_days"

TTL_SECONDS = 30.0


@dataclass(frozen=True)
class Known:
    kind: type
    default: Any
    description: str
    minimum: float | None = None
    maximum: float | None = None


KNOWN: dict[str, Known] = {
    GEOFENCE_ENFORCED: Known(
        bool, True,
        "Refuse a check-in whose fix is farther than checkin.geofence_radius_m "
        "from the case point"),
    GEOFENCE_RADIUS_M: Known(
        float, 30.0, "Check-in geofence radius around the case point, in metres",
        minimum=1.0, maximum=5000.0),
    REMINDERS_ENABLED: Known(bool, True, "Send deadline reminders for open cases"),
    REMINDER_INTERVAL_MINUTES: Known(
        float, 30.0, "Minutes between reminder scans", minimum=5.0, maximum=1440.0),
    QUIET_START_HOUR: Known(
        float, 21.0, "IST hour at which reminders stop for the night",
        minimum=0.0, maximum=23.0),
    QUIET_END_HOUR: Known(
        float, 8.0, "IST hour at which reminders resume in the morning",
        minimum=0.0, maximum=23.0),
    SURVEY_DUE_DAYS: Known(
        float, 2.0, "Days after assignment before an unstarted survey reminds the surveyor",
        minimum=0.5, maximum=90.0),
    SURVEY_OVERDUE_DAYS: Known(
        float, 5.0, "Days after assignment before an unstarted survey is escalated to the zone",
        minimum=0.5, maximum=180.0),
    VERIFICATION_DUE_DAYS: Known(
        float, 3.0,
        "Days a submitted inspection may wait for verification before the zone is reminded",
        minimum=0.5, maximum=90.0),
    RESURVEY_DECISION_DAYS: Known(
        float, 3.0,
        "Days a re-survey request may wait for a decision before the zone is reminded",
        minimum=0.5, maximum=90.0),
}

_lock = threading.Lock()
_cache: dict[str, Any] | None = None
_loaded_at = 0.0


def clear_cache() -> None:
    global _cache
    with _lock:
        _cache = None


def _rows(db: Session) -> dict[str, Any]:
    global _cache, _loaded_at
    with _lock:
        if _cache is not None and time.monotonic() - _loaded_at < TTL_SECONDS:
            return _cache
    rows = {k: v for k, v in db.execute(select(RuntimeSetting.key, RuntimeSetting.value))}
    with _lock:
        _cache, _loaded_at = rows, time.monotonic()
    return rows


# A stored value of the wrong type is ignored in favour of the default, never raised.
def _coerce(key: str, value: Any) -> Any:
    known = KNOWN[key]
    if known.kind is bool:
        return value if isinstance(value, bool) else known.default
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return known.default
    return float(value)


def _get(db: Session, key: str) -> Any:
    rows = _rows(db)
    return _coerce(key, rows[key]) if key in rows else KNOWN[key].default


def flag(db: Session, key: str) -> bool:
    return bool(_get(db, key))


def number(db: Session, key: str) -> float:
    return float(_get(db, key))


def geofence_enforced(db: Session) -> bool:
    return bool(_get(db, GEOFENCE_ENFORCED))


def geofence_radius_m(db: Session) -> float:
    return float(_get(db, GEOFENCE_RADIUS_M))


def read_all(db: Session) -> list[dict]:
    stored = {row.key: row for row in db.execute(select(RuntimeSetting)).scalars()}
    out = []
    for key, known in KNOWN.items():
        row = stored.get(key)
        out.append({
            "key": key,
            "value": _coerce(key, row.value) if row is not None else known.default,
            "type": "boolean" if known.kind is bool else "number",
            "description": (row.description if row is not None else None) or known.description,
            "is_default": row is None,
            "updated_by": row.updated_by if row is not None else None,
            "updated_at": row.updated_at if row is not None else None,
        })
    return out


def _validated(key: str, value: Any) -> Any:
    known = KNOWN.get(key)
    if known is None:
        raise ApiError(404, "not_found", f"no runtime setting is called {key!r}",
                       field="key", allowed=KNOWN)
    if known.kind is bool:
        if not isinstance(value, bool):
            raise ApiError(422, "invalid_value", f"{key} takes true or false", field="value")
        return value
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ApiError(422, "invalid_value", f"{key} takes a number", field="value")
    if (known.minimum is not None and value < known.minimum) or (
            known.maximum is not None and value > known.maximum):
        raise ApiError(422, "invalid_value",
                       f"{key} must be between {known.minimum:g} and {known.maximum:g}",
                       field="value")
    return value


def write(db: Session, key: str, value: Any, *, actor: str) -> dict:
    value = _validated(key, value)
    row = db.get(RuntimeSetting, key)
    if row is None:
        row = RuntimeSetting(key=key, description=KNOWN[key].description)
        db.add(row)
    row.value = value
    row.updated_by = actor
    row.updated_at = now_ist()
    db.commit()
    clear_cache()
    return next(item for item in read_all(db) if item["key"] == key)
