"""Keycloak subjects to the names officers are listed under, for read responses.

ICMS rows store the Keycloak subject and nothing else about a person, so every
"who" a screen shows has to be looked up at read time — which also means rows
written before a name was stored still come back with one. Keycloak is a
network call that can be down while PostgreSQL is fine, so a failed lookup is
never the request's failure: the name is simply null and the screen shows the
id. See docs/icms/actor-names.md.
"""

from __future__ import annotations

import logging
import threading
import time
from collections import OrderedDict
from collections.abc import Iterable
from typing import Any

from ..clients.keycloak import KeycloakAdmin, get_admin_client
from ..errors import ApiError

log = logging.getLogger("ada.api.actors")

__all__ = [
    "TTL_SECONDS",
    "actor_directory",
    "display_name",
    "fill_actor_names",
    "reset_actor_cache",
    "resolve_actor_names",
]

TTL_SECONDS = 600.0
MAX_ENTRIES = 2048
# After a failed lookup, no more are tried for this long: a register page must
# not wait out one Keycloak timeout per row while the identity service is down.
OUTAGE_BACKOFF_SECONDS = 30.0
# Enough for any page the registers serve; the rest stay ids rather than stall.
MAX_LOOKUPS_PER_CALL = 100

_lock = threading.Lock()
# subject -> (name, or None for a deleted account; monotonic expiry)
_cache: OrderedDict[str, tuple[str | None, float]] = OrderedDict()
_down_until = 0.0


# None where administration is unconfigured; a read must not stop with it.
def actor_directory() -> KeycloakAdmin | None:
    try:
        return get_admin_client()
    except ApiError:
        return None


# The web header's order: full name, given + family, username, email.
def display_name(representation: dict[str, Any]) -> str | None:
    def text(key: str) -> str:
        return str(representation.get(key) or "").strip()

    joined = " ".join(p for p in (text("firstName"), text("lastName")) if p)
    username = text("username")
    username = "" if "@" in username else username
    return text("name") or joined or username or text("email") or None


def reset_actor_cache() -> None:
    global _down_until
    with _lock:
        _cache.clear()
        _down_until = 0.0


def _cached(user_id: str, now: float) -> tuple[bool, str | None]:
    entry = _cache.get(user_id)
    if entry is None or entry[1] <= now:
        return False, None
    return True, entry[0]


def _store(user_id: str, name: str | None, now: float) -> None:
    _cache[user_id] = (name, now + TTL_SECONDS)
    _cache.move_to_end(user_id)
    while len(_cache) > MAX_ENTRIES:
        _cache.popitem(last=False)


def resolve_actor_names(
    admin: KeycloakAdmin | None, user_ids: Iterable[str | None]
) -> dict[str, str]:
    """{subject: name} for every subject Keycloak knows; unknown ones are absent."""
    global _down_until
    wanted = list(dict.fromkeys(u for u in user_ids if u))
    names: dict[str, str] = {}
    missing: list[str] = []
    now = time.monotonic()
    with _lock:
        for user_id in wanted:
            hit, name = _cached(user_id, now)
            if not hit:
                missing.append(user_id)
            elif name:
                names[user_id] = name
        if admin is None or not missing or now < _down_until:
            return names

    for user_id in missing[:MAX_LOOKUPS_PER_CALL]:
        try:
            representation = admin.get_user(user_id)
        except Exception as exc:  # noqa: BLE001 — a name is never worth a failed read
            log.warning("cannot resolve officer names from Keycloak: %s", exc)
            with _lock:
                _down_until = time.monotonic() + OUTAGE_BACKOFF_SECONDS
            break
        name = display_name(representation) if representation else None
        with _lock:
            _store(user_id, name, time.monotonic())
        if name:
            names[user_id] = name
    return names


def _get(row: Any, field: str) -> Any:
    return row.get(field) if isinstance(row, dict) else getattr(row, field, None)


def _set(row: Any, field: str, value: Any) -> None:
    if isinstance(row, dict):
        row[field] = value
    else:
        setattr(row, field, value)


def fill_actor_names(
    admin: KeycloakAdmin | None, rows: Iterable[Any], fields: dict[str, str]
) -> None:
    """Set each row's name field from its id field, unless it already holds a name."""
    rows = [r for r in rows if r is not None]
    ids = [_get(r, id_field) for r in rows for id_field in fields]
    if not any(ids):
        return
    names = resolve_actor_names(admin, ids)
    for row in rows:
        for id_field, name_field in fields.items():
            if _get(row, name_field):
                continue
            _set(row, name_field, names.get(_get(row, id_field) or ""))
