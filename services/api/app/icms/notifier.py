"""ICMS workflow notifications via ada-notify: in-app for the portal, push + in-app for the handset.

The event matrix is docs/icms/notifications.md. Every public function here is
called by a router after its commit: facts are read from the request's session
there, and the send (plus any Keycloak role lookup) runs as a BackgroundTask.
Nothing here raises, and nobody is told about their own action.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field

from ada_core.models_icms import (
    Case,
    CaseAssignment,
    CaseEvent,
    Inspection,
    ResurveyRequest,
    Zone,
    ZoneAssignment,
)
from fastapi import BackgroundTasks
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..clients.keycloak import KeycloakAdmin
from ..config import settings
from . import policy
from .security import icms_roles

log = logging.getLogger("ada.icms.notifier")

TEMPLATE_CASE_ASSIGNED = "case_assigned"

PUSH = ["push", "inapp"]
INAPP = ["inapp"]

# Who a zone-wide event reaches: the zone's officers whose roles hold this permission.
NODAL_PERMISSION = "case.assign"
VERIFIER_PERMISSION = "inspection.verify"
CONFIRMER_PERMISSION = "case.confirm"
ISSUER_PERMISSION = "notice.issue"

ROLE_CACHE_SECONDS = 60.0
REASON_LIMIT = 200

_client = None
_unavailable_reason: str | None = None

_role_lock = threading.Lock()
_role_cache: dict[str, tuple[frozenset[str], float]] = {}


@dataclass
class Event:
    """One notification to send, before its zone recipients are resolved."""

    template_key: str
    event_key: str
    payload: dict
    channels: list[str]
    actor: str
    recipients: list[str] = field(default_factory=list)
    zone_users: frozenset[str] = frozenset()
    zone_permission: str | None = None


# The SDK client, built on first use so a missing secret is a log line, not a startup failure.
def _notifier():
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
        _unavailable_reason = str(exc)
        log.warning("notifications are enabled but not configured: %s", _unavailable_reason)
    return _client


def reset_role_cache() -> None:
    with _role_lock:
        _role_cache.clear()


# Enabled members of one realm role, cached briefly; an outage is an empty set.
def _role_members(directory: KeycloakAdmin, role: str) -> frozenset[str]:
    now = time.monotonic()
    with _role_lock:
        hit = _role_cache.get(role)
        if hit is not None and hit[1] > now:
            return hit[0]
    try:
        members = frozenset(
            str(m.get("id")) for m in directory.role_members(role)
            if m.get("id") and m.get("enabled") is not False
        )
    except Exception:  # noqa: BLE001 — a directory outage drops recipients, not the request
        log.warning("role %s could not be listed; its members are not notified", role)
        return frozenset()
    with _role_lock:
        _role_cache[role] = (members, now + ROLE_CACHE_SECONDS)
    return members


# The zone's officers whose roles grant `permission` (ZoneAssignment ∩ Keycloak role members).
def zone_officers(
    directory: KeycloakAdmin | None, zone_users: frozenset[str], permission: str
) -> set[str]:
    if directory is None or not zone_users:
        return set()
    roles = policy.snapshot().roles_holding({permission}) & icms_roles()
    found: set[str] = set()
    for role in sorted(roles):
        found |= _role_members(directory, role) & zone_users
    return found


# Background: resolve, drop the actor, send one per recipient. Never raises.
def deliver(events: list[Event], directory: KeycloakAdmin | None) -> None:
    for event in events:
        try:
            recipients = set(event.recipients)
            if event.zone_permission:
                recipients |= zone_officers(directory, event.zone_users, event.zone_permission)
            recipients.discard(event.actor)
            recipients.discard("")
            client = _notifier() if recipients else None
            if client is None:
                continue
            for recipient in sorted(recipients):
                _send_one(client, event, recipient)
        except Exception:  # noqa: BLE001 — the workflow step has already committed
            log.exception("%s notification failed for %s", event.template_key, event.event_key)


def _send_one(client, event: Event, recipient: str) -> None:
    key = f"{event.template_key}-{event.event_key}"
    if event.zone_permission or len(event.recipients) > 1:
        key = f"{key}-{recipient}"
    outcome = client.send(
        idempotency_key=key,
        recipient=recipient,
        template_key=event.template_key,
        payload=event.payload,
        channels=event.channels,
    )
    if outcome.accepted:
        log.info("%s accepted for %s", event.template_key, event.event_key)
    else:
        log.warning("%s NOT accepted for %s: %s",
                    event.template_key, event.event_key, outcome.error)


def _case(db: Session, case_ref: str) -> Case | None:
    return db.execute(select(Case).where(Case.case_ref == case_ref)).scalar_one_or_none()


def _zone_users(db: Session, zone_id: int) -> frozenset[str]:
    return frozenset(db.execute(
        select(ZoneAssignment.user_id).where(
            ZoneAssignment.zone_id == zone_id, ZoneAssignment.active.is_(True))
    ).scalars())


def _zone_name(db: Session, zone_id: int) -> str:
    name = db.execute(select(Zone.name).where(Zone.id == zone_id)).scalar_one_or_none()
    return str(name or zone_id)


# The latest event row makes a repeatable case-level step's key unique per occurrence.
def _last_event_id(db: Session, case_id: int) -> int:
    value = db.execute(
        select(CaseEvent.id).where(CaseEvent.case_id == case_id)
        .order_by(CaseEvent.id.desc()).limit(1)
    ).scalar_one_or_none()
    return int(value or 0)


def _reason(text: str | None) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= REASON_LIMIT else text[: REASON_LIMIT - 1] + "…"


def _web(case_ref: str) -> str:
    return f"/complaints/{case_ref}"


def _field_case(case_ref: str) -> str:
    return f"/complaint/{case_ref}"


def _field_inspection(case_ref: str) -> str:
    return f"/inspection/{case_ref}"


# Guards every public entry point: off, or any failure reading facts, sends nothing.
def _plan(background: BackgroundTasks, directory, build, *args) -> None:
    if not settings.notify_enabled:
        return
    try:
        events = build(*args)
    except Exception:  # noqa: BLE001 — the workflow step has already committed
        log.exception("notification facts could not be read for %s", build.__name__)
        return
    if events:
        background.add_task(deliver, events, directory)


def _zone_event(db: Session, case: Case, template_key: str, permission: str, *,
                actor: str, event_key: str, extra: dict | None = None,
                recipients: list[str] | None = None) -> Event:
    return Event(
        template_key=template_key,
        event_key=event_key,
        payload={"case_ref": case.case_ref, "zone_name": _zone_name(db, case.zone_id),
                 "route": _web(case.case_ref), **(extra or {})},
        channels=INAPP,
        actor=actor,
        recipients=recipients or [],
        zone_users=_zone_users(db, case.zone_id),
        zone_permission=permission,
    )


def _surveyor_event(case: Case, inspection: Inspection, template_key: str,
                    channels: list[str], *, actor: str, extra: dict | None = None) -> Event:
    return Event(
        template_key=template_key,
        event_key=inspection.inspection_ref,
        payload={"case_ref": case.case_ref, "inspection_ref": inspection.inspection_ref,
                 "route": _field_inspection(case.case_ref), **(extra or {})},
        channels=channels, actor=actor, recipients=[inspection.surveyor_user_id],
    )


def _inspection(db: Session, inspection_ref: str) -> tuple[Inspection, Case] | None:
    row = db.execute(
        select(Inspection, Case).join(Case, Case.id == Inspection.case_id)
        .where(Inspection.inspection_ref == inspection_ref)
    ).first()
    return (row[0], row[1]) if row else None


# --------------------------------------------------------------- the events

def case_raised(background: BackgroundTasks, db: Session, directory: KeycloakAdmin | None,
                *, case_ref: str, actor: str) -> None:
    _plan(background, directory, _case_raised, db, case_ref, actor)


def _case_raised(db: Session, case_ref: str, actor: str) -> list[Event]:
    case = _case(db, case_ref)
    if case is None:
        return []
    return [_zone_event(db, case, "case_raised", NODAL_PERMISSION,
                        actor=actor, event_key=case_ref)]


def case_assigned(background: BackgroundTasks, db: Session, directory: KeycloakAdmin | None,
                  *, case_ref: str, assignment_id: int, actor: str) -> None:
    _plan(background, directory, _case_assigned, db, case_ref, assignment_id, actor)


def _case_assigned(db: Session, case_ref: str, assignment_id: int, actor: str) -> list[Event]:
    current = db.get(CaseAssignment, assignment_id)
    if current is None:
        return []
    events = [Event(
        template_key=TEMPLATE_CASE_ASSIGNED,
        event_key=f"{case_ref}-{assignment_id}",
        payload={"case_ref": case_ref, "route": _field_case(case_ref)},
        channels=PUSH, actor=actor, recipients=[current.assignee_user_id],
    )]
    previous = db.execute(
        select(CaseAssignment.assignee_user_id).where(
            CaseAssignment.case_id == current.case_id, CaseAssignment.id < assignment_id)
        .order_by(CaseAssignment.id.desc()).limit(1)
    ).scalar_one_or_none()
    if previous and previous != current.assignee_user_id:
        events.append(Event(
            template_key="case_unassigned",
            event_key=f"{case_ref}-{assignment_id}",
            payload={"case_ref": case_ref, "route": "/complaints"},
            channels=PUSH, actor=actor, recipients=[previous],
        ))
    return events


def round_opened(background: BackgroundTasks, db: Session, directory: KeycloakAdmin | None,
                 *, inspection_ref: str, actor: str) -> None:
    _plan(background, directory, _round_opened, db, inspection_ref, actor)


def _round_opened(db: Session, inspection_ref: str, actor: str) -> list[Event]:
    found = _inspection(db, inspection_ref)
    if found is None:
        return []
    inspection, case = found
    return [_surveyor_event(case, inspection, "inspection_assigned", PUSH, actor=actor)]


def inspection_submitted(background: BackgroundTasks, db: Session,
                         directory: KeycloakAdmin | None, *, inspection_ref: str,
                         actor: str) -> None:
    _plan(background, directory, _inspection_submitted, db, inspection_ref, actor)


def _inspection_submitted(db: Session, inspection_ref: str, actor: str) -> list[Event]:
    found = _inspection(db, inspection_ref)
    if found is None:
        return []
    _inspection_row, case = found
    return [_zone_event(db, case, "inspection_submitted", VERIFIER_PERMISSION, actor=actor,
                        event_key=inspection_ref, extra={"inspection_ref": inspection_ref})]


def inspection_verified(background: BackgroundTasks, db: Session,
                        directory: KeycloakAdmin | None, *, inspection_ref: str,
                        decision: str, reason: str | None, actor: str) -> None:
    _plan(background, directory, _inspection_verified, db, inspection_ref, decision,
          reason, actor)


def _inspection_verified(db: Session, inspection_ref: str, decision: str,
                         reason: str | None, actor: str) -> list[Event]:
    found = _inspection(db, inspection_ref)
    if found is None:
        return []
    inspection, case = found
    if decision == "accept":
        event = _surveyor_event(case, inspection, "findings_accepted", INAPP, actor=actor)
        event.payload["route"] = _field_case(case.case_ref)
        return [event]
    return [_surveyor_event(case, inspection, "resurvey_requested", PUSH, actor=actor,
                            extra={"reason": _reason(reason)})]


def resurvey_requested(background: BackgroundTasks, db: Session,
                       directory: KeycloakAdmin | None, *, request_id: int,
                       actor: str) -> None:
    _plan(background, directory, _resurvey_requested, db, request_id, actor)


def _resurvey_requested(db: Session, request_id: int, actor: str) -> list[Event]:
    request = db.get(ResurveyRequest, request_id)
    case = db.get(Case, request.case_id) if request else None
    if request is None or case is None:
        return []
    assignee = db.execute(
        select(CaseAssignment.assignee_user_id).where(
            CaseAssignment.case_id == case.id, CaseAssignment.active.is_(True))
        .order_by(CaseAssignment.id.desc()).limit(1)
    ).scalar_one_or_none() or db.execute(
        select(Inspection.surveyor_user_id).where(Inspection.case_id == case.id)
        .order_by(Inspection.round_no.desc()).limit(1)
    ).scalar_one_or_none()
    if not assignee:
        return []
    return [Event(
        template_key="resurvey_request_raised",
        event_key=str(request_id),
        payload={"case_ref": case.case_ref, "reason": _reason(request.reason),
                 "route": _field_case(case.case_ref)},
        channels=PUSH, actor=actor, recipients=[assignee],
    )]


def resurvey_decided(background: BackgroundTasks, db: Session,
                     directory: KeycloakAdmin | None, *, request_id: int, actor: str) -> None:
    _plan(background, directory, _resurvey_decided, db, request_id, actor)


def _resurvey_decided(db: Session, request_id: int, actor: str) -> list[Event]:
    request = db.get(ResurveyRequest, request_id)
    case = db.get(Case, request.case_id) if request else None
    if request is None or case is None:
        return []
    if request.decision == "rejected":
        return [Event(
            template_key="resurvey_refused",
            event_key=str(request_id),
            payload={"case_ref": case.case_ref, "route": _web(case.case_ref)},
            channels=INAPP, actor=actor, recipients=[request.requested_by],
        )]
    if request.decision != "approved" or request.resulting_round is None:
        return []
    inspection = db.execute(
        select(Inspection).where(
            Inspection.case_id == case.id, Inspection.round_no == request.resulting_round)
    ).scalar_one_or_none()
    if inspection is None:
        return []
    event = _surveyor_event(case, inspection, "resurvey_approved", PUSH, actor=actor)
    event.event_key = str(request_id)
    return [event]


def case_handed_over(background: BackgroundTasks, db: Session,
                     directory: KeycloakAdmin | None, *, case_ref: str, actor: str) -> None:
    _plan(background, directory, _case_stage, db, case_ref, actor, "case_handed_over",
          CONFIRMER_PERMISSION)


def case_confirmed(background: BackgroundTasks, db: Session,
                   directory: KeycloakAdmin | None, *, case_ref: str, actor: str) -> None:
    _plan(background, directory, _case_stage, db, case_ref, actor, "case_confirmed",
          ISSUER_PERMISSION)


def _case_stage(db: Session, case_ref: str, actor: str, template_key: str,
                permission: str) -> list[Event]:
    case = _case(db, case_ref)
    if case is None:
        return []
    return [_zone_event(db, case, template_key, permission, actor=actor,
                        event_key=f"{case_ref}-{_last_event_id(db, case.id)}")]


def notice_issued(background: BackgroundTasks, db: Session, directory: KeycloakAdmin | None,
                  *, case_ref: str, notice_ref: str, actor: str) -> None:
    _plan(background, directory, _notice_issued, db, case_ref, notice_ref, actor)


def _notice_issued(db: Session, case_ref: str, notice_ref: str, actor: str) -> list[Event]:
    case = _case(db, case_ref)
    if case is None:
        return []
    return [_zone_event(db, case, "notice_issued", NODAL_PERMISSION, actor=actor,
                        event_key=notice_ref, extra={"notice_ref": notice_ref},
                        recipients=[case.created_by] if case.created_by else [])]


def _outcome_payload(db: Session, case: Case) -> dict:
    from .cases import outcome_labels

    label, label_hi = outcome_labels(db, case.status, case.outcome_cd)
    return {"outcome_cd": case.outcome_cd, "outcome_label": label,
            "outcome_label_hi": label_hi}


def case_rejected(background: BackgroundTasks, db: Session, directory: KeycloakAdmin | None,
                  *, case_ref: str, released_assignee: str | None, actor: str) -> None:
    _plan(background, directory, _case_rejected, db, case_ref, released_assignee, actor)


def _case_rejected(db: Session, case_ref: str, released_assignee: str | None,
                   actor: str) -> list[Event]:
    case = _case(db, case_ref)
    if case is None:
        return []
    payload = {"case_ref": case_ref, "zone_name": _zone_name(db, case.zone_id),
               **_outcome_payload(db, case)}
    events = []
    # A surveyor who filed the case and held it gets the handset copy only.
    if case.created_by and case.created_by != released_assignee:
        events.append(Event(
            template_key="case_rejected", event_key=case_ref,
            payload={**payload, "route": _web(case_ref)},
            channels=INAPP, actor=actor, recipients=[case.created_by]))
    if released_assignee:
        events.append(Event(
            template_key="case_rejected", event_key=f"{case_ref}-assignee",
            payload={**payload, "route": "/complaints"},
            channels=PUSH, actor=actor, recipients=[released_assignee]))
    return events


def case_closed(background: BackgroundTasks, db: Session, directory: KeycloakAdmin | None,
                *, case_ref: str, actor: str) -> None:
    _plan(background, directory, _case_closed, db, case_ref, actor)


def _case_closed(db: Session, case_ref: str, actor: str) -> list[Event]:
    case = _case(db, case_ref)
    if case is None:
        return []
    return [_zone_event(db, case, "case_closed", NODAL_PERMISSION, actor=actor,
                        event_key=case_ref, extra=_outcome_payload(db, case),
                        recipients=[case.created_by] if case.created_by else [])]
