from __future__ import annotations

import asyncio
import contextlib
import logging
import os
import select
import threading
from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from types import MappingProxyType

import sqlalchemy as sa
from ada_core.models_icms import (
    Permission,
    PolicyRevision,
    PolicyRole,
    RolePermission,
    WorkflowTransition,
)
from sqlalchemy import Engine
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session
from sqlalchemy.pool import NullPool

from .workflow import AMEND_PERMISSION, TRANSITIONS, Action, Status, Transition

__all__ = [
    "AMEND_PERMISSION",
    "CHANNEL",
    "DEFAULT_GRANTS",
    "PERMISSIONS",
    "PolicySnapshot",
    "PolicyWatcher",
    "bump",
    "load",
    "refresh_if_stale",
    "reload",
    "reset",
    "revision_of",
    "snapshot",
]

log = logging.getLogger("ada.api.icms.policy")

CHANNEL = "icms_policy"
# A channel name cannot be a bind parameter, so both statements are literals and
# the channel never arrives from a request.
_LISTEN = 'LISTEN "icms_policy"'
_NOTIFY = sa.text("SELECT pg_notify('icms_policy', :payload)")

# The code side of the RBAC seed, mirroring 0003_policy_tables.py plus
# 0008_imagery_permissions.py, 0010_atomic_permissions.py and the revokes in
# 0012_change_detection_nodal_only.py. A test asserts
# the two still agree, so a grant changed in one place and not the other fails
# the build instead of behaving differently on an unmigrated database.
PERMISSIONS: tuple[str, ...] = (
    "reference.read", "zone.read", "zone.manage", "zone_assignment.read",
    "zone_assignment.manage", "case.read", "case.export", "inspection.read",
    "evidence.read", "notice.read", "dashboard.read", "policy.read",
    "policy.manage", "user.read", "user.manage", "imagery.read", "imagery.write",
    # 0010: atomic codes, seeded ahead of the checks that will read them.
    "dashboard.access", "change_detection.access", "complaint_create.access",
    "complaints.access", "inspections.access", "notices.access", "reports.access",
    "administration.access", "officers.access",
    "imagery.export", "imagery.run",
    "case.raise", "case.assign", "case.reassign", "case.reject", "case.amend",
    "case.hand_over", "case.confirm", "case.close",
    "evidence.write",
    "inspection.export", "inspection.open_round", "inspection.check_in",
    "inspection.record_findings", "inspection.submit", "inspection.verify",
    "inspection.request_resurvey",
    "notice.export", "notice.issue", "notice.download",
    "report.read", "report.export",
    "user.create", "user.update", "user.roles", "user.password", "user.disable",
)

DEFAULT_GRANTS: Mapping[str, frozenset[str]] = MappingProxyType({
    # Every permission, the enforcement READS included — `case.read`,
    # `case.export`, `inspection.read`, `evidence.read`, `notice.read` —
    # district-wide, by decision of 2026-09-23. Deliberate, not an oversight:
    # the administrator of a system that keeps the record must be able to read
    # the record. The WRITE side is refused elsewhere and stays refused: Super
    # Admin holds no transition in `workflow`, so it can act on no case. That
    # is what the router module docstrings mean by administration rather than
    # enforcement. Do not narrow this without changing that decision first.
    # The 0010 transition codes and `case.amend` are withheld for the same reason.
    "super-admin": frozenset(PERMISSIONS) - {
        AMEND_PERMISSION,
        "case.raise", "case.assign", "case.reassign", "case.reject", "case.hand_over",
        "case.confirm", "case.close", "evidence.write", "inspection.open_round",
        "inspection.check_in", "inspection.record_findings", "inspection.submit",
        "inspection.verify", "inspection.request_resurvey", "notice.issue",
        # 0012: change detection is the nodal officer's alone.
        "change_detection.access", "imagery.run", "imagery.write", "imagery.export",
    },
    "pcs-nodal-officer": frozenset({
        "reference.read", "zone.read", "zone_assignment.read", "case.read",
        "case.export", "inspection.read", "evidence.read", "notice.read",
        "dashboard.read", "imagery.read", "imagery.write",
        "dashboard.access", "change_detection.access", "complaint_create.access",
        "complaints.access", "inspections.access", "notices.access", "reports.access",
        "imagery.export", "imagery.run",
        "case.raise", "case.assign", "case.reassign", "case.reject", "case.amend",
        "case.hand_over",
        "inspection.export", "inspection.open_round", "inspection.verify",
        "inspection.request_resurvey",
        "notice.export", "notice.download", "report.read", "report.export",
    }),
    "field-surveyor": frozenset({
        "reference.read", "zone.read", "case.read", "inspection.read", "evidence.read",
        "imagery.read",
        "complaint_create.access", "complaints.access",
        "inspections.access", "case.raise", "evidence.write",
        "inspection.open_round", "inspection.check_in", "inspection.record_findings",
        "inspection.submit",
    }),
    "ada-project-lead": frozenset({
        "reference.read", "zone.read", "case.read", "case.export", "inspection.read",
        "evidence.read", "notice.read", "dashboard.read", "imagery.read",
        "dashboard.access", "complaint_create.access",
        "complaints.access", "inspections.access", "notices.access", "reports.access",
        "case.raise", "case.confirm", "case.close",
        "inspection.export", "notice.export", "notice.issue", "notice.download",
        "report.read", "report.export",
    }),
    "public": frozenset({"case.raise"}),
})

_CODE_REVISION = -1

# The code seed's action -> permission, for a row whose permission_cd is NULL.
_SEED_PERMISSION: Mapping[Action, str] = MappingProxyType(
    {t.action: t.permission for t in TRANSITIONS}
)


@dataclass(frozen=True, slots=True)
class PolicySnapshot:
    """One immutable answer to every policy question, swapped whole on reload."""

    revision: int
    source: str
    permissions: frozenset[str]
    grants: Mapping[str, frozenset[str]]
    transitions: tuple[Transition, ...]
    by_key: Mapping[tuple[Status | None, Action], Transition]
    by_source: Mapping[Status | None, tuple[Transition, ...]]

    # Role strings not in the grant table contribute nothing, which is how an
    # unrelated realm role (offline_access) stays harmless.
    def permitted(self, roles: Iterable[str]) -> frozenset[str]:
        held: set[str] = set()
        for role in roles:
            held |= self.grants.get(str(role), frozenset())
        return frozenset(held)

    # What a 403 names. Permission codes are meaningless to an officer; the role
    # they would have to be given is the actionable half.
    def roles_holding(self, codes: Iterable[str]) -> frozenset[str]:
        wanted = frozenset(codes)
        return frozenset(
            role for role, granted in self.grants.items() if wanted & granted
        )

    def transitions_from(self, source: Status | None) -> tuple[Transition, ...]:
        return self.by_source.get(source, ())

    def transition(self, source: Status | None, action: Action) -> Transition | None:
        return self.by_key.get((source, action))

    # Terminal means the table offers no way out, not a list kept beside it.
    def is_terminal(self, source: Status) -> bool:
        return not self.by_source.get(source)


def _assemble(
    *,
    revision: int,
    source: str,
    permissions: frozenset[str],
    grants: Mapping[str, frozenset[str]],
    transitions: tuple[Transition, ...],
) -> PolicySnapshot:
    by_key: dict[tuple[Status | None, Action], Transition] = {}
    by_source: dict[Status | None, list[Transition]] = {}
    for transition in transitions:
        key = (transition.source, transition.action)
        if key in by_key:
            log.warning("duplicate policy transition %s; keeping the first", key)
            continue
        by_key[key] = transition
        by_source.setdefault(transition.source, []).append(transition)

    return PolicySnapshot(
        revision=revision,
        source=source,
        permissions=permissions,
        grants=MappingProxyType(dict(grants)),
        transitions=transitions,
        by_key=MappingProxyType(by_key),
        by_source=MappingProxyType({k: tuple(v) for k, v in by_source.items()}),
    )


def from_code() -> PolicySnapshot:
    """The seed-of-record: what the process answers before it has read a row."""
    return _assemble(
        revision=_CODE_REVISION,
        source="code",
        permissions=frozenset(PERMISSIONS),
        grants=DEFAULT_GRANTS,
        transitions=TRANSITIONS,
    )


# A row the enums cannot spell, or whose permission is unknown, is dropped rather
# than raising: one bad row must not leave the process with no policy at all.
def _to_transition(row, permissions: frozenset[str]) -> Transition | None:
    try:
        action = Action(row.action_cd)
        transition = Transition(
            action=action,
            source=None if row.source_status is None else Status(row.source_status),
            target=Status(row.target_status),
            stage_no=int(row.stage_no),
            permission=row.permission_cd or _SEED_PERMISSION.get(action, ""),
            assignee_only=bool(row.assignee_only),
            requires=tuple(row.requires or ()),
            opens_round=bool(row.opens_round),
            note=row.note or "",
        )
    except ValueError:
        log.warning("policy transition %s is not a status or action this build knows", row.id)
        return None
    if transition.permission not in permissions:
        log.warning("policy transition %s names unknown permission %r",
                    row.id, transition.permission)
        return None
    return transition


def load(db: Session) -> PolicySnapshot:
    """Build a snapshot from the six tables, per slice, falling back to code."""
    revision = revision_of(db)

    permission_codes = frozenset(
        db.execute(sa.select(Permission.permission_cd)).scalars().all()
    )
    active_roles = frozenset(
        db.execute(
            sa.select(PolicyRole.role_cd).where(PolicyRole.active.is_(True))
        ).scalars().all()
    )
    grant_rows = db.execute(
        sa.select(RolePermission.role_cd, RolePermission.permission_cd)
    ).all()

    grants: dict[str, frozenset[str]] = {}
    if permission_codes:
        collected: dict[str, set[str]] = {role: set() for role in active_roles}
        for role_cd, permission_cd in grant_rows:
            if role_cd in collected and permission_cd in permission_codes:
                collected[role_cd].add(permission_cd)
        grants = {role: frozenset(codes) for role, codes in collected.items()}

    transition_rows = db.execute(
        sa.select(WorkflowTransition)
        .where(WorkflowTransition.active.is_(True))
        .order_by(WorkflowTransition.sort_order, WorkflowTransition.id)
    ).scalars().all()

    known = permission_codes or frozenset(PERMISSIONS)
    loaded: list[Transition] = []
    for row in transition_rows:
        built = _to_transition(row, known)
        if built is not None:
            loaded.append(built)

    from_db = [bool(permission_codes), bool(loaded)]
    return _assemble(
        revision=revision if revision is not None else _CODE_REVISION,
        source="database" if all(from_db) else "partial" if any(from_db) else "code",
        permissions=known,
        grants=grants or DEFAULT_GRANTS,
        transitions=tuple(loaded) or TRANSITIONS,
    )


# None when the table or its single row is absent, which is a database that has
# not run 0003 yet — the poll then does nothing rather than reloading forever.
def revision_of(db: Session) -> int | None:
    try:
        return db.execute(
            sa.select(PolicyRevision.revision).where(PolicyRevision.id == 1)
        ).scalar_one_or_none()
    except SQLAlchemyError:
        db.rollback()
        return None


_current: PolicySnapshot = from_code()
# Serialises reloads against each other only. A reader takes no lock at all: it
# reads one module global, and rebinding that global is atomic.
_reload_lock = threading.Lock()


def snapshot() -> PolicySnapshot:
    return _current


def _install(new: PolicySnapshot) -> PolicySnapshot:
    global _current
    _current = new
    return new


def reload(db: Session) -> PolicySnapshot:
    """Read the tables and swap the snapshot. The synchronous force, for tests."""
    with _reload_lock:
        return _install(load(db))


def refresh_if_stale(db: Session) -> PolicySnapshot:
    """The backstop: one cheap SELECT, and a reload only when the counter moved."""
    revision = revision_of(db)
    if revision is None or revision == _current.revision:
        return _current
    return reload(db)


def reset() -> PolicySnapshot:
    """Back to the code seed. Used by the suite and by a worker with no tables."""
    with _reload_lock:
        return _install(from_code())


# Both halves in the caller's transaction: a revision bumped in a transaction
# that then rolls back would leave every worker caching a policy that never was.
def bump(db: Session, *, actor: str | None = None) -> int:
    result = db.execute(
        sa.update(PolicyRevision)
        .where(PolicyRevision.id == 1)
        .values(
            revision=PolicyRevision.revision + 1,
            updated_at=datetime.now(UTC),
            updated_by=actor,
        )
    )
    if result.rowcount == 0:
        db.execute(
            sa.insert(PolicyRevision).values(
                id=1, revision=1, updated_at=datetime.now(UTC), updated_by=actor
            )
        )
    revision = db.execute(
        sa.select(PolicyRevision.revision).where(PolicyRevision.id == 1)
    ).scalar_one()
    if db.get_bind().dialect.name == "postgresql":
        db.execute(_NOTIFY, {"payload": str(revision)})
    return int(revision)


class PolicyWatcher:
    """Keeps one worker's snapshot current: LISTEN where it exists, poll always.

    Its connection is its own, from a NullPool engine. A connection parked in
    LISTEN cannot serve a query, so taking one from the request pool would
    quietly cost the service a slot per worker.
    """

    def __init__(
        self, engine: Engine, *, poll_seconds: float = 15.0, retry_seconds: float = 1.0
    ) -> None:
        self._url = engine.url
        self._dialect = engine.dialect.name
        self._poll = poll_seconds
        self._retry = retry_seconds
        self._side: Engine | None = None
        self._raw = None
        self._stopping = False
        self._wake_r, self._wake_w = os.pipe()
        self._task: asyncio.Task | None = None

    def start(self) -> asyncio.Task:
        self._task = asyncio.create_task(self.run())
        return self._task

    # Backoff rather than exit: a listener that dies on one dropped connection
    # leaves the worker serving a frozen policy with nothing in the log to say so.
    async def run(self) -> None:
        delay = self._retry
        while not self._stopping:
            try:
                await asyncio.to_thread(self._tick)
                delay = self._retry
            except Exception:
                log.warning("policy watcher cycle failed, retrying in %.0fs", delay,
                            exc_info=True)
                self._drop_listener()
                await asyncio.sleep(delay)
                delay = min(delay * 2, 60.0)

    async def stop(self) -> None:
        self._stopping = True
        with contextlib.suppress(OSError):
            os.write(self._wake_w, b"x")
        if self._task is not None:
            with contextlib.suppress(TimeoutError, asyncio.CancelledError):
                await asyncio.wait_for(asyncio.shield(self._task), 5.0)
            self._task.cancel()
        self.close()

    def close(self) -> None:
        self._drop_listener()
        if self._side is not None:
            self._side.dispose()
            self._side = None
        for fd in (self._wake_r, self._wake_w):
            with contextlib.suppress(OSError):
                os.close(fd)

    # One wait-and-check cycle, never longer than poll_seconds, and interruptible
    # through the wake pipe so shutdown does not sit out the interval.
    def _tick(self) -> None:
        listener = self._listener()
        waiting = [self._wake_r] + ([listener] if listener is not None else [])
        ready, _, _ = select.select(waiting, [], [], self._poll)
        if self._wake_r in ready:
            with contextlib.suppress(OSError):
                os.read(self._wake_r, 4096)
            return
        if listener is not None and listener in ready:
            listener.poll()
            listener.notifies.clear()
        self.refresh()

    def refresh(self) -> None:
        with Session(bind=self._engine()) as db:
            refresh_if_stale(db)

    # NullPool, so this shares nothing with the pool serving requests and a
    # pre-ping would only be a wasted round trip on a connection opened fresh.
    def _engine(self) -> Engine:
        if self._side is None:
            self._side = sa.create_engine(self._url, poolclass=NullPool)
        return self._side

    # None on SQLite and anything else without LISTEN/NOTIFY; the caller then
    # has nothing but the revision poll, which is the documented fallback.
    def _listener(self):
        if self._dialect != "postgresql":
            return None
        if self._raw is None:
            self._raw = self._engine().raw_connection()
            driver = self._raw.driver_connection
            # psycopg2 refuses autocommit inside a transaction, and a checkout
            # may have opened one; a rollback with none open is a no-op.
            driver.rollback()
            driver.autocommit = True
            with driver.cursor() as cur:
                cur.execute(_LISTEN)
        return self._raw.driver_connection

    def _drop_listener(self) -> None:
        if self._raw is not None:
            with contextlib.suppress(Exception):
                self._raw.close()
            self._raw = None
