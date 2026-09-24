from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

__all__ = [
    "AMEND_PERMISSION",
    "Action",
    "MissingPayload",
    "NotTheAssignee",
    "Role",
    "RoleNotPermitted",
    "Status",
    "Transition",
    "UnknownTransition",
    "WorkflowError",
    "allowed_actions",
    "check",
    "check_amendable",
    "require_permission",
    "stage_of",
    "transitions_for",
]


class Role(StrEnum):
    SUPER_ADMIN = "super-admin"
    PCS_NODAL_OFFICER = "pcs-nodal-officer"
    FIELD_SURVEYOR = "field-surveyor"
    ADA_PROJECT_LEAD = "ada-project-lead"
    PUBLIC = "public"


class Status(StrEnum):
    RAISED = "raised"
    ASSIGNED = "assigned"
    UNDER_INSPECTION = "under_inspection"
    INSPECTION_SUBMITTED = "inspection_submitted"
    RESURVEY_REQUESTED = "resurvey_requested"
    VERIFIED = "verified"
    HANDED_OVER = "handed_over"
    CONFIRMED = "confirmed"
    NOTICE_ISSUED = "notice_issued"
    CLOSED = "closed"
    REJECTED = "rejected"


class Action(StrEnum):
    RAISE = "raise"
    ASSIGN = "assign"
    REASSIGN = "reassign"
    REJECT = "reject"
    OPEN_ROUND = "open_round"
    CHECK_IN = "check_in"
    ADD_EVIDENCE = "add_evidence"
    RECORD_FINDINGS = "record_findings"
    SUBMIT = "submit"
    VERIFY_ACCEPT = "verify_accept"
    VERIFY_REJECT = "verify_reject"
    REQUEST_RESURVEY = "request_resurvey"
    HAND_OVER = "hand_over"
    CONFIRM = "confirm"
    ISSUE_NOTICE = "issue_notice"
    CLOSE = "close"
    AMEND = "amend"


TERMINAL: frozenset[Status] = frozenset({Status.CLOSED, Status.REJECTED})


class WorkflowError(Exception):
    status_code = 400


class UnknownTransition(WorkflowError):
    status_code = 409

    def __init__(self, source: Status | None, action: Action) -> None:
        super().__init__(f"cannot {action} a case that is {source or 'not yet raised'}")
        self.source = source
        self.action = action


# Carries the code that was missing and, materialised, the roles that hold it.
class RoleNotPermitted(WorkflowError):
    status_code = 403

    def __init__(
        self, action: Action, permission: str, held: Iterable[str], allowed: Iterable[str]
    ) -> None:
        allowed = tuple(sorted(frozenset(str(r) for r in allowed)))
        super().__init__(f"{action} requires one of: {', '.join(allowed)}")
        self.action = action
        self.permission = permission
        self.held = frozenset(str(r) for r in held)
        self.allowed = allowed


class NotTheAssignee(WorkflowError):
    status_code = 403

    def __init__(self, action: Action) -> None:
        super().__init__(f"{action} is permitted only to the officer the case is assigned to")
        self.action = action


class MissingPayload(WorkflowError):
    status_code = 422

    def __init__(self, action: Action, missing: Iterable[str]) -> None:
        missing = sorted(missing)
        super().__init__(f"{action} requires: {', '.join(missing)}")
        self.action = action
        self.missing = tuple(missing)


@dataclass(frozen=True)
class Transition:
    action: Action
    source: Status | None
    target: Status
    stage_no: int
    permission: str
    assignee_only: bool = False
    requires: tuple[str, ...] = ()
    opens_round: bool = False
    note: str = field(default="", compare=False)


TRANSITIONS: tuple[Transition, ...] = (
    Transition(
        Action.RAISE, None, Status.RAISED, 1, "case.raise",
        requires=("zone_id", "source"),
    ),
    Transition(
        Action.REJECT, Status.RAISED, Status.REJECTED, 1, "case.reject",
        requires=("reason",),
    ),
    Transition(
        Action.ASSIGN, Status.RAISED, Status.ASSIGNED, 2, "case.assign",
        requires=("assignee_user_id",),
    ),
    Transition(
        Action.REASSIGN, Status.ASSIGNED, Status.ASSIGNED, 2, "case.reassign",
        requires=("assignee_user_id", "reason"),
    ),
    Transition(
        Action.REJECT, Status.ASSIGNED, Status.REJECTED, 2, "case.reject",
        requires=("reason",),
    ),
    Transition(
        Action.OPEN_ROUND, Status.ASSIGNED, Status.UNDER_INSPECTION, 3,
        "inspection.open_round", opens_round=True,
        requires=("surveyor_user_id",),
    ),
    Transition(
        Action.CHECK_IN, Status.UNDER_INSPECTION, Status.UNDER_INSPECTION, 3,
        "inspection.check_in", assignee_only=True,
        requires=("latitude", "longitude", "accuracy_m", "device_timestamp",
                  "idempotency_key"),
    ),
    Transition(
        Action.ADD_EVIDENCE, Status.UNDER_INSPECTION, Status.UNDER_INSPECTION, 3,
        "evidence.write", assignee_only=True,
        requires=("kind", "idempotency_key"),
    ),
    Transition(
        Action.RECORD_FINDINGS, Status.UNDER_INSPECTION, Status.UNDER_INSPECTION, 4,
        "inspection.record_findings", assignee_only=True,
        requires=("findings",),
    ),
    Transition(
        Action.SUBMIT, Status.UNDER_INSPECTION, Status.INSPECTION_SUBMITTED, 4,
        "inspection.submit", assignee_only=True,
        requires=("idempotency_key",),
    ),
    Transition(
        Action.REQUEST_RESURVEY, Status.INSPECTION_SUBMITTED, Status.RESURVEY_REQUESTED, 4,
        "inspection.request_resurvey", requires=("reason",),
    ),
    Transition(
        Action.OPEN_ROUND, Status.RESURVEY_REQUESTED, Status.UNDER_INSPECTION, 3,
        "inspection.open_round", opens_round=True,
        requires=("surveyor_user_id",),
    ),
    Transition(
        Action.VERIFY_ACCEPT, Status.INSPECTION_SUBMITTED, Status.VERIFIED, 5,
        "inspection.verify",
    ),
    Transition(
        Action.VERIFY_REJECT, Status.INSPECTION_SUBMITTED, Status.RESURVEY_REQUESTED, 5,
        "inspection.verify", requires=("reason",),
    ),
    Transition(
        Action.HAND_OVER, Status.VERIFIED, Status.HANDED_OVER, 6, "case.hand_over",
    ),
    Transition(
        Action.CONFIRM, Status.HANDED_OVER, Status.CONFIRMED, 7, "case.confirm",
    ),
    Transition(
        Action.ISSUE_NOTICE, Status.CONFIRMED, Status.NOTICE_ISSUED, 7, "notice.issue",
        requires=("act_cd", "section_cds"),
    ),
    Transition(
        Action.CLOSE, Status.NOTICE_ISSUED, Status.CLOSED, 7, "case.close",
    ),
)


# The seed tuple is the record; two rows for one (source, action) would make the
# loader pick one arbitrarily, so it is a build failure here rather than a coin toss.
if len({(_t.source, _t.action) for _t in TRANSITIONS}) != len(TRANSITIONS):
    raise RuntimeError("duplicate transition in TRANSITIONS")


# Imported inside the call: policy imports this module, so a top-level import
# would be a cycle. One module global read, never a lock — a reload swaps it whole.
def _policy():
    from . import policy

    return policy.snapshot()


_STAGE_OF: dict[Status, int] = {
    Status.RAISED: 1,
    Status.ASSIGNED: 2,
    Status.UNDER_INSPECTION: 3,
    Status.INSPECTION_SUBMITTED: 4,
    Status.RESURVEY_REQUESTED: 4,
    Status.VERIFIED: 5,
    Status.HANDED_OVER: 6,
    Status.CONFIRMED: 7,
    Status.NOTICE_ISSUED: 7,
    Status.CLOSED: 7,
    Status.REJECTED: 1,
}


def stage_of(status: Status) -> int:
    return _STAGE_OF[Status(status)]


def transitions_for(source: Status | None) -> tuple[Transition, ...]:
    return _policy().transitions_from(None if source is None else Status(source))


def allowed_actions(
    source: Status | None,
    roles: Iterable[str],
    *,
    is_assignee: bool = False,
) -> tuple[Action, ...]:
    held = _policy().permitted(roles)
    return tuple(
        t.action for t in transitions_for(source)
        if t.permission in held and (is_assignee or not t.assignee_only)
    )


def check(
    source: Status | None,
    action: Action | str,
    roles: Iterable[str],
    *,
    is_assignee: bool = False,
    payload: Mapping[str, Any] | None = None,
) -> Transition:
    source = None if source is None else Status(source)
    action = Action(action)

    transition = _policy().transition(source, action)
    if transition is None:
        raise UnknownTransition(source, action)

    require_permission(action, transition.permission, roles)

    if transition.assignee_only and not is_assignee:
        raise NotTheAssignee(action)

    if transition.requires:
        data = payload or {}
        missing = [k for k in transition.requires if data.get(k) in (None, "", [], {})]
        if missing:
            raise MissingPayload(action, missing)

    return transition


AMEND_PERMISSION = "case.amend"


def check_amendable(source: Status | str, roles: Iterable[str]) -> None:
    source = Status(source)
    if _policy().is_terminal(source):
        raise UnknownTransition(source, Action.AMEND)
    require_permission(Action.AMEND, AMEND_PERMISSION, roles)


# Raises RoleNotPermitted naming the roles that would have held `permission`.
def require_permission(action: Action, permission: str, roles: Iterable[str]) -> None:
    roles = tuple(str(r) for r in roles)
    policy = _policy()
    if permission not in policy.permitted(roles):
        raise RoleNotPermitted(
            action, permission, roles, policy.roles_holding({permission}),
        )
