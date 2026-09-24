"""Reverse geocoding for the Create Complaint pin: state, district, LGD code, pin code.

A suggestion, never a gate: every failure is an all-null answer, not an error.
Why Nominatim and what replaces it in production: docs/icms/geo-locate.md.
"""

from __future__ import annotations

import logging
import re
import threading
import time
from collections import OrderedDict
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache
from importlib.metadata import PackageNotFoundError, version
from typing import Any, Protocol

import httpx

from ..config import settings
from .lgd_districts import canonical_district, district_lgd_code

log = logging.getLogger("ada.api.locator")

__all__ = [
    "Located",
    "Locator",
    "NominatimLocator",
    "NullLocator",
    "get_locator",
    "located_from_nominatim",
]

UP_STATE = "uttar pradesh"
_PINCODE = re.compile(r"^[1-9]\d{5}$")
_DISTRICT_SUFFIX = re.compile(r"\s+district$", re.IGNORECASE)


@dataclass(frozen=True)
class Located:
    state: str | None = None
    district: str | None = None
    district_lgd: str | None = None
    pincode: str | None = None
    source: str = "none"


class Locator(Protocol):
    def locate(self, lat: float, lon: float) -> Located: ...


class NullLocator:
    """Answers nothing; used when GEO_LOCATE_BASE_URL is empty."""

    def locate(self, lat: float, lon: float) -> Located:
        return Located(source="none")


def _text(value: Any) -> str | None:
    return (value.strip() or None) if isinstance(value, str) else None


# Nominatim's `address` block as the four fields the form suggests.
def located_from_nominatim(payload: Any) -> Located:
    address = payload.get("address") if isinstance(payload, dict) else None
    if not isinstance(address, dict):
        return Located(source="nominatim")

    state = _text(address.get("state"))
    raw_district = _text(address.get("state_district")) or _text(address.get("county"))
    district = _DISTRICT_SUFFIX.sub("", raw_district).strip() if raw_district else None

    lgd = None
    if district and (state is None or state.lower() == UP_STATE):
        lgd = district_lgd_code(district)
        district = canonical_district(district) or district

    postcode = (_text(address.get("postcode")) or "").replace(" ", "")
    pincode = postcode if _PINCODE.match(postcode) else None

    return Located(state=state, district=district, district_lgd=lgd, pincode=pincode,
                   source="nominatim")


def _default_user_agent() -> str:
    try:
        release = version("ada-api")
    except PackageNotFoundError:
        release = "0"
    contact = settings.geo_locate_contact.strip()
    return f"ADA-ICMS/{release}" + (f" ({contact})" if contact else "")


class NominatimLocator:
    """Nominatim's /reverse, throttled to one request a second and cached per ~11 m."""

    CACHE_SIZE = 2048

    def __init__(
        self,
        base_url: str,
        user_agent: str,
        timeout_s: float,
        *,
        min_interval_s: float = 1.0,
        transport: httpx.BaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._client = httpx.Client(
            base_url=base_url.rstrip("/"),
            headers={"User-Agent": user_agent, "Accept-Language": "en"},
            timeout=timeout_s,
            transport=transport,
        )
        self._min_interval = min_interval_s
        self._clock = clock
        self._sleep = sleep
        self._last_call: float | None = None
        self._throttle = threading.Lock()
        self._cache: OrderedDict[tuple[float, float], Located] = OrderedDict()
        self._cache_lock = threading.Lock()

    def locate(self, lat: float, lon: float) -> Located:
        key = (round(lat, 4), round(lon, 4))
        with self._cache_lock:
            if key in self._cache:
                self._cache.move_to_end(key)
                return self._cache[key]

        try:
            payload = self._fetch(*key)
        except (httpx.HTTPError, ValueError) as exc:
            log.warning("reverse geocode failed: %s", type(exc).__name__)
            return Located(source="unavailable")

        found = located_from_nominatim(payload)
        with self._cache_lock:
            self._cache[key] = found
            while len(self._cache) > self.CACHE_SIZE:
                self._cache.popitem(last=False)
        return found

    # Held across the sleep on purpose: concurrent callers queue, one a second.
    def _fetch(self, lat: float, lon: float) -> Any:
        with self._throttle:
            if self._last_call is not None:
                wait = self._min_interval - (self._clock() - self._last_call)
                if wait > 0:
                    self._sleep(wait)
            try:
                response = self._client.get(
                    "/reverse",
                    params={"format": "jsonv2", "lat": lat, "lon": lon, "zoom": 16,
                            "addressdetails": 1},
                )
            finally:
                self._last_call = self._clock()
        response.raise_for_status()
        return response.json()


@lru_cache(maxsize=1)
def get_locator() -> Locator:
    """The process-wide locator; the null one when no base URL is configured."""
    base = settings.geo_locate_base_url.strip()
    if not base:
        return NullLocator()
    return NominatimLocator(
        base,
        settings.geo_locate_user_agent.strip() or _default_user_agent(),
        settings.geo_locate_timeout_s,
    )
