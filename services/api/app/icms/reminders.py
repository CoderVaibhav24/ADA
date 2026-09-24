"""Deadline reminders for open ICMS work (docs/icms/notifications.md, Reminders).

Runs inside ada-api beside the sweeper, under its own Postgres advisory lock so
one worker scans at a time. A reminder is recorded in icms_reminder_sent only
after ada-notify accepted every send, and the notify idempotency key is the
same (rule, subject, stage) triple, so a crash between the two never repeats one.
"""

from __future__ import annotations

import asyncio
import logging
import threading
from collections.abc import Callable, Iterator
from dataclasses import asdict, dataclass
from datetime import date, datetime, timedelta
from typing import Any

from ada_core.datetimes import IST, now_ist
from ada_core.models_icms import (
    Case,
    CaseAssignment,
    Inspection,
    Notice,
    ReminderSent,
    ResurveyRequest,
)
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..config import settings
from . import notifier
from . import runtime_settings as rs

log = logging.getLogger("ada.icms.reminders")

# Fixed key so every ada-api process contends for the same Postgres advisory lock.
REMINDER_LOCK_KEY = 0x0ADA4E11
DEFAULT_INTERVAL_SECONDS = 1800.0

SURVEY = "survey_not_started"
SURVEY_ESCALATION = "survey_overdue"
VERIFY = "verification_pending"
RESURVEY = "resurvey_decision_pending"
NOTICE = "notice_compliance_due"

CLOSED_CASE = ("closed", "rejected")
LIVE_NOTICE = ("issued", "delivered")

stop_event = threading.Event()


@dataclass
class Config:
    enabled: bool
    interval_minutes: float
    quiet_start: int
    quiet_end: int
    survey_due: float
    survey_overdue: float
    verify_due: float
    resurvey_due: float


@dataclass
class Due:
    rule: str
    subject: str
    stage: str
    event: notifier.Event


@dataclass
class Report:
    at: datetime
    skipped: str | None = None
    found: int = 0
    already: int = 0
    sent: int = 0
    unsent: int = 0
    errors: int = 0

    def as_dict(self) -> dict:
        body = asdict(self)
        body["at"] = self.at.isoformat()
        return body


last_report: Report | None = None


def read_config(db: Session) -> Config:
    return Config(
        enabled=rs.flag(db, rs.REMINDERS_ENABLED),
        interval_minutes=rs.number(db, rs.REMINDER_INTERVAL_MINUTES),
        quiet_start=int(rs.number(db, rs.QUIET_START_HOUR)),
        quiet_end=int(rs.number(db, rs.QUIET_END_HOUR)),
        survey_due=rs.number(db, rs.SURVEY_DUE_DAYS),
        survey_overdue=rs.number(db, rs.SURVEY_OVERDUE_DAYS),
        verify_due=rs.number(db, rs.VERIFICATION_DUE_DAYS),
        resurvey_due=rs.number(db, rs.RESURVEY_DECISION_DAYS),
    )


# Quiet hours wrap midnight when start > end (21 -> 8); equal hours mean never quiet.
def in_quiet_hours(now: datetime, start: int, end: int) -> bool:
    hour = now.astimezone(IST).hour
    if start == end:
        return False
    if start < end:
        return start <= hour < end
    return hour >= start or hour < end


# SQLite hands back naive datetimes; ada_core writes IST wall-clock, so naive means IST.
def _aware(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=IST) if value.tzinfo is None else value


def _days(now: datetime, since: datetime | None) -> float | None:
    since = _aware(since)
    return None if since is None else (now - since) / timedelta(days=1)


def _zone_event(db: Session, case: Case, template: str, permission: str,
                extra: dict | None = None) -> notifier.Event:
    return notifier.Event(
        template_key=template, event_key="", channels=notifier.INAPP, actor="",
        payload={"case_ref": case.case_ref, "zone_name": notifier._zone_name(db, case.zone_id),
                 "route": notifier._web(case.case_ref), **(extra or {})},
        zone_users=notifier._zone_users(db, case.zone_id), zone_permission=permission,
    )


def _surveyor_event(case: Case, surveyor: str, extra: dict) -> notifier.Event:
    return notifier.Event(
        template_key="inspection_reminder", event_key="", channels=notifier.PUSH, actor="",
        payload={"case_ref": case.case_ref, "route": notifier._field_inspection(case.case_ref),
                 **extra},
        recipients=[surveyor],
    )


# Only the highest stage reached is due, so a long-stalled survey is not reminded twice at once.
def _survey_dues(db: Session, case: Case, subject: str, surveyor: str, days: float,
                 cfg: Config, extra: dict) -> Iterator[Due]:
    if days < cfg.survey_due:
        return
    stage = "overdue" if days >= max(cfg.survey_due, cfg.survey_overdue) else "due"
    payload = {**extra, "days": str(int(days))}
    yield Due(SURVEY, subject, stage, _surveyor_event(case, surveyor, payload))
    if stage == "overdue":
        yield Due(SURVEY_ESCALATION, subject, stage,
                  _zone_event(db, case, "inspection_overdue", notifier.NODAL_PERMISSION,
                              payload))


def _survey(db: Session, now: datetime, cfg: Config) -> Iterator[Due]:
    rounds = db.execute(
        select(Inspection, Case).join(Case, Case.id == Inspection.case_id).where(
            Inspection.status == "scheduled", Inspection.started_at.is_(None),
            Case.status.not_in(CLOSED_CASE))
    ).all()
    for inspection, case in rounds:
        opened = [v for v in (_aware(inspection.created_at), _aware(inspection.scheduled_for))
                  if v is not None]
        days = _days(now, max(opened)) if opened else None
        if days is not None:
            yield from _survey_dues(db, case, inspection.inspection_ref,
                                    inspection.surveyor_user_id, days, cfg,
                                    {"inspection_ref": inspection.inspection_ref})
    waiting = db.execute(
        select(CaseAssignment, Case).join(Case, Case.id == CaseAssignment.case_id).where(
            CaseAssignment.active.is_(True), CaseAssignment.assignment_type == "survey",
            Case.status == "assigned")
    ).all()
    for assignment, case in waiting:
        days = _days(now, assignment.assigned_at)
        if days is not None:
            yield from _survey_dues(db, case, f"A{assignment.id}",
                                    assignment.assignee_user_id, days, cfg, {})


def _verify(db: Session, now: datetime, cfg: Config) -> Iterator[Due]:
    rows = db.execute(
        select(Inspection, Case).join(Case, Case.id == Inspection.case_id).where(
            Inspection.status == "submitted", Case.status.not_in(CLOSED_CASE))
    ).all()
    for inspection, case in rows:
        days = _days(now, inspection.submitted_at or inspection.updated_at)
        if days is None or days < cfg.verify_due:
            continue
        yield Due(VERIFY, inspection.inspection_ref, "due", _zone_event(
            db, case, "verification_pending", notifier.VERIFIER_PERMISSION,
            {"inspection_ref": inspection.inspection_ref, "days": str(int(days))}))


def _resurvey(db: Session, now: datetime, cfg: Config) -> Iterator[Due]:
    rows = db.execute(
        select(ResurveyRequest, Case).join(Case, Case.id == ResurveyRequest.case_id).where(
            ResurveyRequest.decision == "pending", Case.status.not_in(CLOSED_CASE))
    ).all()
    for request, case in rows:
        days = _days(now, request.requested_at)
        if days is None or days < cfg.resurvey_due:
            continue
        yield Due(RESURVEY, f"R{request.id}", "due", _zone_event(
            db, case, "resurvey_decision_pending", notifier.NODAL_PERMISSION,
            {"days": str(int(days))}))


def _notice(db: Session, now: datetime, cfg: Config) -> Iterator[Due]:
    today = now.astimezone(IST).date()
    rows = db.execute(
        select(Notice, Case).join(Case, Case.id == Notice.case_id).where(
            Notice.status.in_(LIVE_NOTICE), Notice.compliance_due.is_not(None),
            Case.status.not_in(CLOSED_CASE))
    ).all()
    for notice, case in rows:
        due: Any = notice.compliance_due
        due = due.date() if isinstance(due, datetime) else due
        if not isinstance(due, date) or today <= due:
            continue
        yield Due(NOTICE, notice.notice_ref, "due", _zone_event(
            db, case, "notice_compliance_due", notifier.ISSUER_PERMISSION,
            {"notice_ref": notice.notice_ref, "compliance_due": due.isoformat()}))


RULES: list[tuple[str, Callable[[Session, datetime, Config], Iterator[Due]]]] = [
    (SURVEY, _survey), (VERIFY, _verify), (RESURVEY, _resurvey), (NOTICE, _notice),
]


def _recorded(db: Session, due: Due) -> bool:
    return db.execute(select(ReminderSent.id).where(
        ReminderSent.rule == due.rule, ReminderSent.subject == due.subject,
        ReminderSent.stage == due.stage)).first() is not None


def _default_directory():
    from ..clients.keycloak import get_admin_client
    from ..errors import ApiError

    try:
        return get_admin_client()
    except ApiError:
        return None


# How many were told; 0 when anyone was refused or nobody is there yet, so the next tick retries.
def _send(due: Due, client, directory: Callable[[], Any]) -> int:
    event = due.event
    recipients = set(event.recipients)
    if event.zone_permission:
        recipients |= notifier.zone_officers(directory(), event.zone_users,
                                             event.zone_permission)
    recipients.discard("")
    if not recipients:
        log.info("%s %s has nobody to tell yet", due.rule, due.subject)
        return 0
    for recipient in sorted(recipients):
        outcome = client.send(
            idempotency_key=f"reminder-{due.rule}-{due.subject}-{due.stage}-{recipient}",
            recipient=recipient, template_key=event.template_key,
            payload=event.payload, channels=event.channels)
        if not outcome.accepted:
            log.warning("%s for %s NOT accepted: %s", event.template_key, due.subject,
                        outcome.error)
            return 0
    return len(recipients)


def _record(db: Session, due: Due, count: int, now: datetime) -> None:
    db.add(ReminderSent(rule=due.rule, subject=due.subject, stage=due.stage,
                        recipients=count, sent_at=now))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()


def _once(factory: Callable[[], Any]) -> Callable[[], Any]:
    cache: list = []

    def get():
        if not cache:
            cache.append(factory())
        return cache[0]

    return get


# One scan: read the switches, then every rule in turn; one bad rule never stops the rest.
def run_once(db_factory: Callable[[], Session], now: datetime, *, client=None,
             directory: Callable[[], Any] | None = None) -> Report:
    global last_report
    now = _aware(now) or now_ist()
    report = Report(at=now)
    db = db_factory()
    try:
        cfg = read_config(db)
        if not cfg.enabled:
            report.skipped = "disabled"
            return report
        if in_quiet_hours(now, cfg.quiet_start, cfg.quiet_end):
            report.skipped = "quiet_hours"
            return report
        if client is None:
            client = notifier._notifier() if settings.notify_enabled else None
        if client is None:
            report.skipped = "notify_unavailable"
            return report
        lookup = _once(directory or _default_directory)
        for name, rule in RULES:
            if stop_event.is_set():
                break
            try:
                dues = list(rule(db, now, cfg))
            except Exception:
                db.rollback()
                report.errors += 1
                log.exception("reminder rule %s failed", name)
                continue
            for due in dues:
                report.found += 1
                try:
                    if _recorded(db, due):
                        report.already += 1
                        continue
                    count = _send(due, client, lookup)
                    if count:
                        _record(db, due, count, now)
                        report.sent += 1
                    else:
                        report.unsent += 1
                except Exception:
                    db.rollback()
                    report.errors += 1
                    log.exception("reminder %s %s failed", due.rule, due.subject)
    finally:
        db.close()
        last_report = report
    return report


def _interval_seconds() -> float:
    from ada_core.database import SessionLocal

    try:
        with SessionLocal() as db:
            return 60.0 * rs.number(db, rs.REMINDER_INTERVAL_MINUTES)
    except Exception:
        log.warning("reminder interval unreadable; using the default", exc_info=True)
        return DEFAULT_INTERVAL_SECONDS


def _tick() -> float:
    from ada_core.database import SessionLocal

    from .. import sweeper

    acquired, release = sweeper._acquire_lock(REMINDER_LOCK_KEY)
    if acquired:
        try:
            log.info("reminders: %s", run_once(SessionLocal, now_ist()).as_dict())
        finally:
            release()
    else:
        log.debug("reminder scan skipped: another ada-api process holds the lock")
    return _interval_seconds()


# Awaiting each tick before sleeping is what keeps two scans from ever overlapping.
async def run_forever() -> None:
    stop_event.clear()
    try:
        while not stop_event.is_set():
            interval = DEFAULT_INTERVAL_SECONDS
            try:
                interval = await asyncio.to_thread(_tick)
            except asyncio.CancelledError:
                raise
            except Exception:
                log.exception("reminder tick failed")
            await asyncio.sleep(interval)
    finally:
        stop_event.set()
