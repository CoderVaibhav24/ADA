"""The retry ladder: base 10 s, cap 1 hour, five attempts, full jitter.

Roughly 10 s, 30 s, 2 min, 10 min, 1 hour (build-plan.md, Sunday 30 August).

## Why a table and not a formula

Those five numbers are not 10·2ⁿ, or 10·3ⁿ, or anything else tidy. They were
chosen for what they cover: a blip, a restart, a short outage, a long outage, and
"someone will have been paged by now". A formula reverse-engineered to produce
them would be less honest than the table, and it would drift the moment anyone
edited it.

The table scales with retry_base_seconds, so making everything ten times faster
for a test is one setting rather than five.

## Full jitter

The returned delay is uniform on [0, ladder_step], not ladder_step exactly. Each
rung is a ceiling, not a promise.

That matters because failures arrive in batches. A provider outage fails a
thousand messages within the same second; without jitter all thousand retry in
the same second, and in the same second at every later rung too — the load that
caused the outage is faithfully reproduced at every step. Full jitter spreads
those thousand across the whole window.

Full rather than equal jitter: equal jitter (half fixed, half random) preserves
more of the schedule's shape, and the shape is precisely what needs breaking up.
"""

from __future__ import annotations

import random
from datetime import UTC, datetime, timedelta

from app.config import Settings

# Multiples of retry_base_seconds. With the default base of 10 s this is
# 10 s, 30 s, 2 min, 10 min, 1 hour.
_LADDER = (1, 3, 12, 60, 360)


def is_exhausted(attempts: int, settings: Settings) -> bool:
    """Has this delivery used up its attempts?

    `attempts` is how many have already been made, including the one that just
    failed. Five attempts means five sends, not one send and five retries.
    """
    return attempts >= settings.retry_max_attempts


def delay_seconds(attempts: int, settings: Settings) -> float:
    """How long to wait before attempt number `attempts + 1`."""
    index = min(max(attempts, 1), len(_LADDER)) - 1
    ceiling = min(_LADDER[index] * settings.retry_base_seconds, settings.retry_cap_seconds)

    if not settings.retry_jitter:
        return ceiling
    # Not a security decision — this is load spreading, and the standard
    # generator is both fast enough and random enough for it.
    return random.uniform(0, ceiling)  # noqa: S311


def next_attempt_at(attempts: int, settings: Settings, *, now: datetime | None = None) -> datetime:
    """When attempt number `attempts + 1` becomes due."""
    now = now or datetime.now(UTC)
    return now + timedelta(seconds=delay_seconds(attempts, settings))


def describe_ladder(settings: Settings) -> list[float]:
    """The ceilings, in seconds — for a startup log line and for the guide.

    An operator reading "retries at up to 10/30/120/600/3600 s" knows what to
    expect without reading this file.
    """
    return [
        min(step * settings.retry_base_seconds, settings.retry_cap_seconds)
        for step in _LADDER[: settings.retry_max_attempts]
    ]
