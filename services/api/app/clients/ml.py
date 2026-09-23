"""Handing a piece of work to the model service.

This replaces the in-process `jobs.submit_*` calls. The difference that matters
is not the network hop — it is that the handoff can now fail, and the row is
already committed when it does.

So a failure here is reported to the officer as a 503 with the row left in
'queued'/'processing' rather than rolled back. That is deliberate: the work IS
wanted, the row records that it is wanted, and ada-ml's `requeue_stale` sweep
picks up exactly those rows when it next starts. Deleting the row on a failed
handoff would turn a temporary outage into lost work.
"""

from __future__ import annotations

import logging

import httpx
from ada_platform.requestid import outbound_headers
from fastapi import HTTPException

from ..config import settings

log = logging.getLogger("ada.api.ml")

_UNAVAILABLE = (
    "The model service is not reachable. The request has been recorded and will "
    "be picked up when it returns; nothing needs to be re-uploaded."
)


# X-Request-ID rides along so the worker's log lines for this job carry the id
# of the officer's request that queued it.
def _headers() -> dict[str, str]:
    headers = outbound_headers()
    if settings.ml_service_token:
        headers["X-ADA-Service-Token"] = settings.ml_service_token
    return headers


def _post(path: str, body: dict, what: str) -> None:
    try:
        response = httpx.post(
            f"{settings.ml_service_url.rstrip('/')}{path}",
            json=body,
            headers=_headers(),
            timeout=settings.ml_timeout_seconds,
        )
    except httpx.HTTPError as exc:
        log.error("could not queue %s with ada-ml: %s", what, exc)
        raise HTTPException(status_code=503, detail=_UNAVAILABLE) from exc

    if response.status_code == 202:
        return

    # A 401 here is a configuration fault between two of our own services, and
    # it presents to the officer as "the model service refused the request" —
    # so the real reason goes to the log, where an operator will look.
    log.error("ada-ml answered %s queueing %s: %s",
              response.status_code, what, response.text[:300])
    raise HTTPException(status_code=503, detail=_UNAVAILABLE)


def submit_ingest(raster_id: int) -> None:
    _post("/v1/ingests", {"raster_id": raster_id}, f"ingest of raster {raster_id}")


def submit_analysis(job_id: int) -> None:
    _post("/v1/analyses", {"job_id": job_id}, f"analysis job {job_id}")
