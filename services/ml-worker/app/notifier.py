"""Telling the officer that their analysis finished.

The worker is the only process that can do this. ada-api hands over a job id and
returns immediately; nothing on the request path is still watching an hour later
when the pipeline ends, so the notification has to be emitted from where the
work actually completed.

Two properties are load-bearing here, and both come from the SDK rather than
from this module:

  * send() never raises. An analysis that finished has finished — the polygons
    are committed and the officer can see them in the UI. Failing the job
    because a notification could not be submitted would turn a completed
    analysis into a failed one, which is a worse outcome than a missing email.
  * the idempotency key is natural, not generated. `analysis-complete-{job_id}`
    sent twice — a retried submission, a worker restart mid-send — is one email.
    A uuid4 key would make every retry a second email to a real person.

The recipient is a Keycloak subject id, never an address. ada-notify reads the
address off the account at delivery time, so an officer who changes their email
in Keycloak gets the next one at the new address and nothing here has to know.
"""

from __future__ import annotations

import logging

from ada_core.database import SessionLocal
from ada_core.models import AnalysisJob, Project

from .config import settings

log = logging.getLogger("ada.notifier")

_client = None
_unavailable_reason: str | None = None


def _notifier():
    """The SDK client, built once and reused.

    Built lazily rather than at import: the ML service must start and run
    analyses on a machine with no ada-notify and no Keycloak, and a client
    constructed at import would make a missing secret a startup failure.
    """
    global _client, _unavailable_reason
    if _client is not None or _unavailable_reason is not None:
        return _client

    from ada_platform import ADAConfigError, ADANotify

    try:
        _client = ADANotify(
            base_url=settings.notify_url,
            issuer=settings.notify_issuer,
            client_id=settings.notify_client_id,
            client_secret=settings.notify_client_secret,
        )
    except ADAConfigError as exc:
        # Recorded once, not on every job: an analysis a minute would otherwise
        # repeat the same configuration message into the log forever.
        _unavailable_reason = str(exc)
        log.warning("notifications are enabled but not configured: %s", _unavailable_reason)
    return _client


def _context(job_id: int) -> tuple[str, dict] | None:
    """The recipient and the payload, read in one session and then released.

    Returns None when there is nobody to tell — a job whose row has since been
    deleted, or a project with no owner. Both are ordinary, and neither is
    worth an exception on a path that exists to send an email.
    """
    with SessionLocal() as db:
        job = db.get(AnalysisJob, job_id)
        if job is None:
            return None
        project = db.get(Project, job.project_id)
        if project is None or not project.user_id:
            return None
        stats = job.stats or {}
        payload = {
            "project_name": project.name,
            "project_url": f"{settings.app_origin.rstrip('/')}/projects/{project.id}",
            "mode": job.mode,
            "polygon_count": str(stats.get("polygons", 0)),
            "changed_area_m2": str(stats.get("changed_area_m2", 0)),
            "error": job.error or "",
        }
        return project.user_id, payload


def _send(job_id: int, template_key: str) -> None:
    if not settings.notify_enabled:
        return
    client = _notifier()
    if client is None:
        return
    context = _context(job_id)
    if context is None:
        log.debug("job %s has no notifiable owner; skipping %s", job_id, template_key)
        return
    recipient, payload = context

    outcome = client.send(
        idempotency_key=f"{template_key}-{job_id}",
        recipient=recipient,
        template_key=template_key,
        payload=payload,
    )
    if outcome.accepted:
        log.info("notification %s accepted for job %s", template_key, job_id)
    else:
        # send() has already logged the reason at warning. This line ties it to
        # a job id, which is what somebody asking "why did I not get an email
        # for job 412" actually searches for.
        log.warning("notification %s NOT accepted for job %s: %s",
                    template_key, job_id, outcome.error)


def analysis_finished(job_id: int) -> None:
    _send(job_id, "analysis-complete")


def analysis_failed(job_id: int) -> None:
    _send(job_id, "analysis-failed")
