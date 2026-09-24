"""The deep-link hint a client routes a notification by, shared by push and the inbox."""

from __future__ import annotations

# Payload keys copied into the routing hint; ids and a path only, never case detail.
_ROUTING_KEYS = ("case_ref", "inspection_ref", "notice_ref", "route")


def routing_data(*, template_key: str, payload: dict) -> dict[str, str]:
    """The deep-link hint shared by push data and the inbox: type plus any known refs."""
    data = {"type": template_key}
    for key in _ROUTING_KEYS:
        value = payload.get(key)
        if isinstance(value, (str, int)) and not isinstance(value, bool) and str(value):
            data[key] = str(value)[:64 if key != "route" else 200]
    return data
