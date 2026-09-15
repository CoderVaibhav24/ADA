"""The two instructions ada-api gives this service.

Both are deliberately thin. The request carries an id and nothing else: the row
it names is already in PostgreSQL, written by ada-api inside the same
transaction that validated the officer's ownership of the project, so passing
the parameters again over HTTP would create a second copy of the truth that
could disagree with the first.

Both answer 202 and return immediately. An ingest of a multi-gigabyte upload and
a full seg-diff analysis both run for minutes to hours; holding the connection
open for that would tie ada-api's threadpool to this service's pace and give the
frontend nothing it does not already get by polling the row.
"""

from __future__ import annotations

from ada_core.database import SessionLocal
from ada_core.models import AnalysisJob, Raster
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from ... import jobs
from ...security import require_service_token

router = APIRouter(prefix="/v1", tags=["work"], dependencies=[Depends(require_service_token)])


class IngestRequest(BaseModel):
    raster_id: int = Field(gt=0)


class AnalysisRequest(BaseModel):
    job_id: int = Field(gt=0)


class Accepted(BaseModel):
    accepted: bool = True
    queue_depth: int


@router.post("/ingests", status_code=status.HTTP_202_ACCEPTED, response_model=Accepted)
def enqueue_ingest(body: IngestRequest) -> Accepted:
    """Ingest an uploaded raster: warp, build the COG, record its geometry.

    The row is checked for existence and nothing else. Ingest is idempotent — it
    rewrites the COG from the original upload — so re-submitting one that is
    already queued costs a repeat of work rather than a corrupt result, and
    refusing it here would break the retry the officer expects from the UI.
    """
    with SessionLocal() as db:
        if db.get(Raster, body.raster_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND,
                                f"No raster {body.raster_id}")
    jobs.submit_ingest(body.raster_id)
    return Accepted(queue_depth=jobs.queue_depth())


@router.post("/analyses", status_code=status.HTTP_202_ACCEPTED, response_model=Accepted)
def enqueue_analysis(body: AnalysisRequest) -> Accepted:
    with SessionLocal() as db:
        if db.get(AnalysisJob, body.job_id) is None:
            raise HTTPException(status.HTTP_404_NOT_FOUND,
                                f"No analysis job {body.job_id}")
    jobs.submit_analysis(body.job_id)
    return Accepted(queue_depth=jobs.queue_depth())
