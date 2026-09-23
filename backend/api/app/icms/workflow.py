from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from enum import StrEnum
from typing import Any

__all__ = [
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


class RoleNotPermitted(WorkflowError):
    status_code = 403

    def __init__(self, action: Action, held: Iterable[str], required: Iterable[str]) -> None:
        super().__init__(f"{action} requires one of: {', '.join(sorted(required))}")
        self.action = action
        self.held = frozenset(held)
        self.required = frozenset(required)


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
    roles: frozenset[Role]
    assignee_only: bool = False
    requires: tuple[str, ...] = ()
    opens_round: bool = False
    note: str = field(default="", compare=False)


_NODAL = frozenset({Role.PCS_NODAL_OFFICER})
_SURVEYOR = frozenset({Role.FIELD_SURVEYOR})
_LEAD = frozenset({Role.ADA_PROJECT_LEAD})
_ANYONE = frozenset({
    Role.PUBLIC, Role.FIELD_SURVEYOR, Role.PCS_NODAL_OFFICER, Role.ADA_PROJECT_LEAD,
})

TRANSITIONS: tuple[Transition, ...] = (
    Transition(
        Action.RAISE, None, Status.RAISED, 1, _ANYONE,
        requires=("zone_id", "source"),
    ),
    Transition(
        Action.REJECT, Status.RAISED, Status.REJECTED, 1, _NODAL,
        requires=("reason",),
    ),
    Transition(
        Action.ASSIGN, Status.RAISED, Status.ASSIGNED, 2, _NODAL,
        requires=("assignee_user_id",),
    ),
    Transition(
        Action.REASSIGN, Status.ASSIGNED, Status.ASSIGNED, 2, _NODAL,
        requires=("assignee_user_id", "reason"),
    ),
    Transition(
        Action.REJECT, Status.ASSIGNED, Status.REJECTED, 2, _NODAL,
        requires=("reason",),
    ),
    Transition(
        Action.OPEN_ROUND, Status.ASSIGNED, Status.UNDER_INSPECTION, 3,
        _NODAL | _SURVEYOR, opens_round=True,
        requires=("surveyor_user_id",),
    ),
    Transition(
        Action.CHECK_IN, Status.UNDER_INSPECTION, Status.UNDER_INSPECTION, 3,
        _SURVEYOR, assignee_only=True,
        requires=("latitude", "longitude", "accuracy_m", "device_timestamp",
                  "idempotency_key"),
    ),
    Transition(
        Action.ADD_EVIDENCE, Status.UNDER_INSPECTION, Status.UNDER_INSPECTION, 3,
        _SURVEYOR, assignee_only=True,
        requires=("kind", "idempotency_key"),
    ),
    Transition(
        Action.RECORD_FINDINGS, Status.UNDER_INSPECTION, Status.UNDER_INSPECTION, 4,
        _SURVEYOR, assignee_only=True,
        requires=("findings",),
    ),
    Transition(
        Action.SUBMIT, Status.UNDER_INSPECTION, Status.INSPECTION_SUBMITTED, 4,
        _SURVEYOR, assignee_only=True,
        requires=("idempotency_key",),
    ),
    Transition(
        Action.REQUEST_RESURVEY, Status.INSPECTION_SUBMITTED, Status.RESURVEY_REQUESTED, 4,
        _NODAL, requires=("reason",),
    ),
    Transition(
        Action.OPEN_ROUND, Status.RESURVEY_REQUESTED, Status.UNDER_INSPECTION, 3,
        _NODAL | _SURVEYOR, opens_round=True,
        requires=("surveyor_user_id",),
    ),
    Transition(
        Action.VERIFY_ACCEPT, Status.INSPECTION_SUBMITTED, Status.VERIFIED, 5, _NODAL,
    ),
    Transition(
        Action.VERIFY_REJECT, Status.INSPECTION_SUBMITTED, Status.RESURVEY_REQUESTED, 5,
        _NODAL, requires=("reason",),
    ),
    Transition(
        Action.HAND_OVER, Status.VERIFIED, Status.HANDED_OVER, 6, _NODAL,
    ),
    Transition(
        Action.CONFIRM, Status.HANDED_OVER, Status.CONFIRMED, 7, _LEAD,
    ),
    Transition(
        Action.ISSUE_NOTICE, Status.CONFIRMED, Status.NOTICE_ISSUED, 7, _LEAD,
        requires=("act_cd", "section_cds"),
    ),
    Transition(
        Action.CLOSE, Status.NOTICE_ISSUED, Status.CLOSED, 7, _LEAD,
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
    held = _held_roles(roles)
    return tuple(
        t.action for t in transitions_for(source)
        if (t.roles & held) and (is_assignee or not t.assignee_only)
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

    held = _held_roles(roles)
    if not (transition.roles & held):
        raise RoleNotPermitted(action, (str(r) for r in held), (str(r) for r in transition.roles))

    if transition.assignee_only and not is_assignee:
        raise NotTheAssignee(action)

    if transition.requires:
        data = payload or {}
        missing = [k for k in transition.requires if data.get(k) in (None, "", [], {})]
        if missing:
            raise MissingPayload(action, missing)

    return transition


# The code default, and the fallback the snapshot uses until a migration seeds
# the `case.amend` permission the grant table would otherwise resolve this from.
AMENDABLE_ROLES: frozenset[Role] = frozenset({Role.PCS_NODAL_OFFICER})


def check_amendable(source: Status | str, roles: Iterable[str]) -> None:
    source = Status(source)
    policy = _policy()
    if policy.is_terminal(source):
        raise UnknownTransition(source, Action.AMEND)

    required = policy.amendable_roles
    held = _held_roles(roles)
    if not (required & held):
        raise RoleNotPermitted(
            Action.AMEND, (str(r) for r in held), (str(r) for r in required)
        )


def _held_roles(roles: Iterable[str]) -> frozenset[Role]:
    known = set()
    for role in roles:
        try:
            known.add(Role(role))
        except ValueError:
            continue
    return frozenset(known)
