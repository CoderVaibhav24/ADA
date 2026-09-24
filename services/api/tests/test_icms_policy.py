"""The policy cache: what it loads, when it swaps, and what it answers meanwhile.

The seed-agreement tests are the load-bearing ones. `workflow.TRANSITIONS` is
the record and `0003_policy_tables.py` is the copy in the database; a rule added
to one and not the other must fail the build rather than exist in one
environment and not the other.
"""

from __future__ import annotations

import asyncio
import threading
import time
from types import SimpleNamespace

import pytest
import sqlalchemy as sa
from ada_core.models_icms import PolicyRevision, RolePermission, WorkflowTransition

from app.icms import policy
from app.icms import workflow as wf
from tests.conftest import _load_revision, policy_seed

SURVEYOR = [wf.Role.FIELD_SURVEYOR]
NODAL = [wf.Role.PCS_NODAL_OFFICER]
LEAD = [wf.Role.ADA_PROJECT_LEAD]
ADMIN = [wf.Role.SUPER_ADMIN]

ROUND_PAYLOAD = {"surveyor_user_id": "user-b"}
ASSIGN_PAYLOAD = {"assignee_user_id": "user-b"}


# --- the seed and the code are one fact stated twice -----------------------

def test_the_seeded_transitions_and_the_code_tuple_agree():
    """0003's role lists are now what the code grants resolve each permission to."""
    seed = policy_seed()
    grants = policy.from_code()
    coded = {
        (t.action.value, None if t.source is None else t.source.value): (
            t.target.value, t.stage_no, t.assignee_only, t.opens_round,
            tuple(t.requires), grants.roles_holding({t.permission}),
        )
        for t in wf.TRANSITIONS
    }
    seeded = {
        (row["action_cd"], row["source_status"]): (
            row["target_status"], row["stage_no"], row["assignee_only"],
            row["opens_round"], tuple(row["requires"]), frozenset(row["roles"]),
        )
        for row in seed.TRANSITIONS
    }
    assert seeded == coded


def test_the_backfilled_permission_is_the_code_tuple_permission():
    codes = _load_revision("0010_atomic_permissions").TRANSITION_CODES
    assert {t.action.value: t.permission for t in wf.TRANSITIONS} == codes


def test_a_null_permission_falls_back_to_the_code_seed(db, policy_tables):
    db.execute(sa.update(WorkflowTransition).values(permission_cd=None))
    db.commit()
    snapshot = policy.reload(db)

    assert snapshot.source == "database"
    assert {(t.source, t.action): t.permission for t in snapshot.transitions} == {
        (t.source, t.action): t.permission for t in wf.TRANSITIONS
    }


def test_a_row_naming_an_unknown_permission_is_dropped(db, policy_tables):
    row = db.execute(
        sa.select(WorkflowTransition).where(WorkflowTransition.action_cd == "assign")
    ).scalar_one()
    snapshot = policy.snapshot()
    known = frozenset(snapshot.permissions) - {"case.assign"}

    assert policy._to_transition(row, known) is None
    assert policy._to_transition(row, snapshot.permissions).permission == "case.assign"


def test_moving_a_transition_to_another_permission_moves_who_may_act(db, policy_tables):
    db.execute(
        sa.update(WorkflowTransition)
        .where(WorkflowTransition.action_cd == "assign")
        .values(permission_cd="case.confirm")
    )
    db.commit()
    policy.reload(db)

    wf.check(wf.Status.RAISED, wf.Action.ASSIGN, LEAD, payload=ASSIGN_PAYLOAD)
    with pytest.raises(wf.RoleNotPermitted) as exc:
        wf.check(wf.Status.RAISED, wf.Action.ASSIGN, NODAL, payload=ASSIGN_PAYLOAD)
    assert exc.value.permission == "case.confirm"
    assert exc.value.allowed == ("ada-project-lead",)


def test_the_seed_order_matches_the_tuple_order():
    """`allowed_actions` returns them in table order, and the portal renders that
    order as its button row."""
    seed = policy_seed()
    ordered = sorted(seed.TRANSITIONS, key=lambda row: row["sort_order"])
    assert [row["action_cd"] for row in ordered] == [t.action.value for t in wf.TRANSITIONS]


def test_the_seeded_grants_and_the_code_defaults_agree():
    seed = policy_seed()
    assert {code for code, *_ in seed.PERMISSIONS} == set(policy.PERMISSIONS)
    assert {role: frozenset(codes) for role, codes in seed.GRANTS.items()} == dict(
        policy.DEFAULT_GRANTS
    )


def test_every_seeded_role_is_a_role_the_workflow_knows():
    seed = policy_seed()
    assert {cd for cd, *_ in seed.ROLES} == {role.value for role in wf.Role}


# --- what the loader builds ------------------------------------------------

def test_an_unseeded_database_answers_from_the_code_seed(db):
    """The six tables are empty until 0003 runs. A worker in that state must
    still enforce something, and the something is the tuple in source."""
    snapshot = policy.reload(db)

    assert snapshot.source == "code"
    assert snapshot.transitions == wf.TRANSITIONS
    assert snapshot.permitted(["super-admin"]) == policy.DEFAULT_GRANTS["super-admin"]


def test_the_snapshot_matches_the_seed(db, policy_tables):
    snapshot = policy.snapshot()

    assert snapshot.source == "database"
    assert snapshot.revision == 1
    assert snapshot.permissions == frozenset(policy.PERMISSIONS)
    assert dict(snapshot.grants) == dict(policy.DEFAULT_GRANTS)


def test_the_loaded_transitions_match_the_code_tuple(db, policy_tables):
    """Same rules, arrived at down the other path. `note` is compare=False on the
    dataclass, so this is an equality over the rules themselves."""
    assert policy.snapshot().transitions == wf.TRANSITIONS


def test_a_deactivated_role_grants_nothing(db, policy_tables):
    from ada_core.models_icms import PolicyRole

    db.execute(
        sa.update(PolicyRole).where(PolicyRole.role_cd == "field-surveyor").values(active=False)
    )
    db.commit()

    assert policy.reload(db).permitted(["field-surveyor"]) == frozenset()


def test_a_row_the_enums_cannot_spell_is_dropped_not_fatal():
    """One bad row must cost one rule, not the whole policy. The CHECK constraint
    stops this being written; a build that has since retired a status would not."""
    row = SimpleNamespace(
        id=99, action_cd="close", source_status="notice_issued", target_status="archived",
        stage_no=7, assignee_only=False, opens_round=False, requires=[], note=None,
    )

    assert policy._to_transition(row, ["ada-project-lead"]) is None


# --- the table drives the state machine ------------------------------------

def test_the_full_seven_stage_path_from_the_database(db, policy_tables):
    steps = [
        (None, wf.Action.RAISE, NODAL, {"zone_id": 1, "source": "field"}, wf.Status.RAISED),
        (wf.Status.RAISED, wf.Action.ASSIGN, NODAL, ASSIGN_PAYLOAD, wf.Status.ASSIGNED),
        (wf.Status.ASSIGNED, wf.Action.OPEN_ROUND, NODAL, ROUND_PAYLOAD,
         wf.Status.UNDER_INSPECTION),
        (wf.Status.UNDER_INSPECTION, wf.Action.SUBMIT, SURVEYOR,
         {"idempotency_key": "k"}, wf.Status.INSPECTION_SUBMITTED),
        (wf.Status.INSPECTION_SUBMITTED, wf.Action.VERIFY_ACCEPT, NODAL, None,
         wf.Status.VERIFIED),
        (wf.Status.VERIFIED, wf.Action.HAND_OVER, NODAL, None, wf.Status.HANDED_OVER),
        (wf.Status.HANDED_OVER, wf.Action.CONFIRM, LEAD, None, wf.Status.CONFIRMED),
        (wf.Status.CONFIRMED, wf.Action.ISSUE_NOTICE, LEAD,
         {"act_cd": "up_urban_planning_act", "section_cds": ["27"]}, wf.Status.NOTICE_ISSUED),
        (wf.Status.NOTICE_ISSUED, wf.Action.CLOSE, LEAD, None, wf.Status.CLOSED),
    ]
    for source, action, roles, payload, expected in steps:
        assert wf.check(source, action, roles, is_assignee=True,
                        payload=payload).target == expected


@pytest.mark.parametrize(
    ("source", "action", "wrong_roles", "payload"),
    [
        (wf.Status.RAISED, wf.Action.ASSIGN, SURVEYOR, ASSIGN_PAYLOAD),
        (wf.Status.ASSIGNED, wf.Action.OPEN_ROUND, LEAD, ROUND_PAYLOAD),
        (wf.Status.INSPECTION_SUBMITTED, wf.Action.VERIFY_ACCEPT, SURVEYOR, None),
        (wf.Status.HANDED_OVER, wf.Action.CONFIRM, NODAL, None),
        (wf.Status.NOTICE_ISSUED, wf.Action.CLOSE, NODAL, None),
    ],
)
def test_the_wrong_role_is_still_refused_from_the_database(
    db, policy_tables, source, action, wrong_roles, payload
):
    with pytest.raises(wf.RoleNotPermitted) as exc:
        wf.check(source, action, wrong_roles, is_assignee=True, payload=payload)
    assert exc.value.status_code == 403


def test_the_four_exception_types_survive_the_move(db, policy_tables):
    with pytest.raises(wf.UnknownTransition) as unknown:
        wf.check(wf.Status.RAISED, wf.Action.SUBMIT, SURVEYOR, is_assignee=True,
                 payload={"idempotency_key": "k"})
    assert unknown.value.status_code == 409

    with pytest.raises(wf.NotTheAssignee) as assignee:
        wf.check(wf.Status.UNDER_INSPECTION, wf.Action.SUBMIT, SURVEYOR,
                 is_assignee=False, payload={"idempotency_key": "k"})
    assert assignee.value.status_code == 403

    with pytest.raises(wf.MissingPayload) as missing:
        wf.check(wf.Status.RAISED, wf.Action.ASSIGN, NODAL, payload={})
    assert missing.value.status_code == 422
    assert missing.value.missing == ("assignee_user_id",)


def test_allowed_actions_keeps_its_table_order(db, policy_tables):
    assert wf.allowed_actions(wf.Status.RAISED, NODAL) == (wf.Action.REJECT, wf.Action.ASSIGN)
    assert wf.allowed_actions(wf.Status.RAISED, ADMIN) == ()


def test_terminal_still_means_no_row_out(db, policy_tables):
    for status in wf.TERMINAL:
        assert wf.transitions_for(status) == ()
        assert policy.snapshot().is_terminal(status)


def test_deactivating_a_row_removes_the_move(db, policy_tables):
    db.execute(
        sa.update(WorkflowTransition)
        .where(WorkflowTransition.action_cd == "assign")
        .values(active=False)
    )
    db.commit()
    policy.reload(db)

    with pytest.raises(wf.UnknownTransition):
        wf.check(wf.Status.RAISED, wf.Action.ASSIGN, NODAL, payload=ASSIGN_PAYLOAD)


def test_the_grant_table_governs_amendment(db, policy_tables):
    """The seeded `case.amend` grant is the nodal officer's; move it and the table decides."""
    assert policy.snapshot().roles_holding({wf.AMEND_PERMISSION}) == {"pcs-nodal-officer"}

    db.execute(sa.delete(RolePermission).where(
        RolePermission.permission_cd == policy.AMEND_PERMISSION))
    db.add(RolePermission(role_cd="ada-project-lead",
                          permission_cd=policy.AMEND_PERMISSION))
    db.commit()
    policy.reload(db)

    assert policy.snapshot().roles_holding({wf.AMEND_PERMISSION}) == {"ada-project-lead"}
    wf.check_amendable(wf.Status.RAISED, LEAD)
    with pytest.raises(wf.RoleNotPermitted):
        wf.check_amendable(wf.Status.RAISED, NODAL)


# --- when the answer changes ----------------------------------------------

def test_a_revoked_grant_changes_the_answer_after_reload_and_not_before(db, policy_tables):
    assert "case.export" in policy.snapshot().permitted(["pcs-nodal-officer"])

    db.execute(
        sa.delete(RolePermission).where(
            RolePermission.role_cd == "pcs-nodal-officer",
            RolePermission.permission_cd == "case.export",
        )
    )
    db.commit()
    assert "case.export" in policy.snapshot().permitted(["pcs-nodal-officer"])

    policy.reload(db)
    assert "case.export" not in policy.snapshot().permitted(["pcs-nodal-officer"])


def test_a_revision_bump_is_what_the_poll_notices(db, policy_tables):
    db.execute(
        sa.delete(RolePermission).where(RolePermission.permission_cd == "case.export")
    )
    policy.bump(db)
    db.commit()

    assert policy.refresh_if_stale(db).revision == 2
    assert "case.export" not in policy.snapshot().permitted(["pcs-nodal-officer"])


def test_an_unmoved_revision_costs_one_select_and_no_reload(db, policy_tables):
    before = policy.snapshot()

    assert policy.refresh_if_stale(db) is before


def test_a_database_without_the_revision_row_never_reloads_in_a_loop(db):
    """Pre-0003 there is no counter. The poll must do nothing rather than treat
    every pass as a change and reload on every tick for ever."""
    before = policy.snapshot()

    assert policy.refresh_if_stale(db) is before


def test_bump_creates_the_counter_when_it_is_missing(db):
    assert policy.bump(db, actor="tester") == 1
    db.commit()

    assert db.execute(sa.select(PolicyRevision.revision)).scalar_one() == 1


# --- concurrency -----------------------------------------------------------

def test_a_reload_swaps_the_whole_snapshot_at_once(db, policy_tables):
    """Readers take no lock, so the only thing protecting them is that the swap
    is one rebinding. A field-by-field update would show up here as a reader
    seeing one load's transitions beside another load's grants."""
    full = policy.snapshot()
    db.execute(
        sa.delete(RolePermission).where(RolePermission.permission_cd == "case.read")
    )
    db.execute(
        sa.update(WorkflowTransition)
        .where(WorkflowTransition.action_cd == "close")
        .values(active=False)
    )
    db.commit()
    trimmed = policy.load(db)

    legal = {
        (len(full.transitions), True),
        (len(trimmed.transitions), False),
    }
    seen: set[tuple[int, bool]] = set()
    stop = threading.Event()

    def read() -> None:
        while not stop.is_set():
            current = policy.snapshot()
            seen.add((
                len(current.transitions),
                "case.read" in current.grants["field-surveyor"],
            ))

    readers = [threading.Thread(target=read) for _ in range(4)]
    for reader in readers:
        reader.start()
    deadline = time.monotonic() + 0.3
    while time.monotonic() < deadline:
        policy._install(trimmed)
        policy._install(full)
    stop.set()
    for reader in readers:
        reader.join()

    assert seen and seen <= legal


# --- the watcher -----------------------------------------------------------

def test_sqlite_gets_the_poll_and_no_listener(engine):
    """There is no LISTEN/NOTIFY here, so the revision counter is the only
    mechanism left and the watcher must not pretend otherwise."""
    watcher = policy.PolicyWatcher(engine, poll_seconds=0.01)
    try:
        assert watcher._listener() is None
    finally:
        watcher.close()


def test_the_watcher_stops_without_sitting_out_the_interval(engine):
    watcher = policy.PolicyWatcher(engine, poll_seconds=30.0)

    async def drive() -> None:
        watcher.start()
        await asyncio.sleep(0.05)
        await watcher.stop()

    started = time.monotonic()
    asyncio.run(drive())

    assert time.monotonic() - started < 5.0


def test_a_failing_cycle_backs_off_instead_of_dying_quietly(engine, monkeypatch):
    """A listener that exits on one dropped connection leaves the worker serving
    a frozen policy with nothing in the log to say so."""
    watcher = policy.PolicyWatcher(engine, poll_seconds=0.01, retry_seconds=0.01)
    calls: list[int] = []

    def tick() -> None:
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("connection dropped")

    monkeypatch.setattr(watcher, "_tick", tick)

    async def drive() -> None:
        watcher.start()
        for _ in range(200):
            if len(calls) >= 3:
                break
            await asyncio.sleep(0.01)
        await watcher.stop()

    asyncio.run(drive())

    assert len(calls) >= 3


# --- boot ------------------------------------------------------------------

def test_the_boot_load_reads_the_tables(db, policy_tables):
    from app import main

    policy.reset()
    assert policy.snapshot().source == "code"

    main._load_policy()

    assert policy.snapshot().source == "database"


def test_a_database_without_the_tables_does_not_stop_the_worker(db, monkeypatch):
    from app import main

    def explode(_db):
        raise sa.exc.OperationalError("SELECT 1", {}, Exception("no such table"))

    monkeypatch.setattr(policy, "reload", explode)
    main._load_policy()

    assert policy.snapshot().source == "code"


def test_the_listener_takes_its_own_connection_and_listens_once(engine, monkeypatch):
    """The only path that never runs on SQLite, so it is asserted rather than
    assumed: LISTEN on a connection of its own, opened once and not per tick."""
    executed: list[str] = []

    class Cursor:
        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def execute(self, statement):
            executed.append(statement)

    class Driver:
        autocommit = False

        def rollback(self):
            executed.append("ROLLBACK")

        def cursor(self):
            return Cursor()

    class Raw:
        driver_connection = Driver()

        def close(self):
            executed.append("CLOSE")

    watcher = policy.PolicyWatcher(engine, poll_seconds=0.01)
    watcher._dialect = "postgresql"
    monkeypatch.setattr(
        watcher, "_engine", lambda: SimpleNamespace(raw_connection=Raw)
    )
    try:
        driver = watcher._listener()

        assert driver.autocommit is True
        assert executed == ["ROLLBACK", 'LISTEN "icms_policy"']
        assert watcher._listener() is driver
    finally:
        watcher.close()


def test_the_notify_is_parameter_bound_and_names_the_listened_channel():
    """`NOTIFY` cannot take a bind parameter; `pg_notify` can, so the payload
    never reaches the statement by concatenation."""
    statement = str(policy._NOTIFY)

    assert "pg_notify" in statement
    assert ":payload" in statement
    assert policy.CHANNEL in statement
