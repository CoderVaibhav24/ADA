"""Lost updates, stale rounds and count-then-insert: the enterprise review's D-01/02/06/07.

Every race here is simulated the same way: the function the service calls
between its read and its write is wrapped so that, the first time it runs, a
"concurrent officer" moves the row and commits. The service then writes against
a case that is no longer where it read it, which is exactly the interleaving two
browsers produce. The lost update must be a 409 with no event row, never a
silent overwrite.

The code for a lost race is `invalid_transition`, deliberately the same one the
transition table produces (batch-3 contract, 2026-09-23 amendment): a client
cannot act differently on the two, and both mean "read the case again".
"""

from __future__ import annotations

import pytest
from ada_core.models_icms import (
    Case,
    CaseEvent,
    CheckIn,
    Evidence,
    Inspection,
    InspectionFinding,
    NoticeSequence,
    ResurveyRequest,
)
from sqlalchemy import func, insert, select, update
from sqlalchemy.dialects import postgresql

from tests.conftest import LEAD, NODAL, SURVEYOR, SURVEYOR_B_ID, SURVEYOR_ID
from tests.test_icms_evidence import fields, jpeg, key
from tests.test_icms_inspections import check_in_body
from tests.test_icms_reference import error_of

ICMS = "/api/icms"
CASES = f"{ICMS}/cases"
INSPECTIONS = f"{ICMS}/inspections"
REQUESTS = f"{ICMS}/resurvey-requests"

# Seeded by `inspection_world`.
UNDER_INSPECTION, ROUND_OF_0006 = "CMP-2026-0006", "INS-2026-0001"
SUBMITTED, ROUND_OF_0007 = "CMP-2026-0007", "INS-2026-0002"
RESURVEY, ROUND_OF_0008 = "CMP-2026-0008", "INS-2026-0003"
SUBMIT_KEY = "6f1d6dd9-8443-4b90-9a86-0f65c42b7001"


@pytest.fixture
def race(monkeypatch, db):
    """Wrap `module.name` so its first call is followed by a committed concurrent write."""

    def arm(module, name: str, **moved) -> None:
        real = getattr(module, name)
        fired: list[bool] = []

        def hooked(*args, **kwargs):
            result = real(*args, **kwargs)
            if not fired:
                fired.append(True)
                for statement in moved.values():
                    db.execute(statement)
                db.commit()
            return result

        monkeypatch.setattr(module, name, hooked)

    return arm


def move(case_ref: str, **values):
    return update(Case).where(Case.case_ref == case_ref).values(**values)


def case_of(db, case_ref: str):
    db.expire_all()
    return db.execute(
        select(Case.id, Case.status, Case.current_round).where(Case.case_ref == case_ref)
    ).one()


def count(db, model, *where) -> int:
    db.expire_all()
    return int(db.execute(select(func.count()).select_from(model).where(*where)).scalar_one())


def concurrent_submit(case_id: int, idempotency_key: str) -> dict:
    """What a winning submit commits: the case, the round, and its event with its key."""
    round_id = (select(Inspection.id).where(Inspection.inspection_ref == ROUND_OF_0006)
                .scalar_subquery())
    return {
        "case": move(UNDER_INSPECTION, status="inspection_submitted", stage_no=4),
        "round": update(Inspection).where(Inspection.inspection_ref == ROUND_OF_0006)
        .values(status="submitted"),
        "event": insert(CaseEvent).values(
            case_id=case_id, inspection_id=round_id, action="submit",
            from_status="under_inspection", to_status="inspection_submitted",
            actor_user_id=SURVEYOR_ID, payload={"idempotency_key": idempotency_key},
        ),
    }


# Bytes no other test uploads, so the content-addressed file is new to this one.
UNIQUE_JPEG = (b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
               + b"\x07\x02" * 32 + b"\xff\xd9")


def evidence_files(root) -> set[str]:
    return {str(path.relative_to(root)) for path in root.rglob("*") if path.is_file()}


def assert_lost_race(response, code: str = "invalid_transition") -> None:
    assert response.status_code == 409, response.text
    assert error_of(response)["code"] == code


# ------------------------------------------------------------------ D-01 cases
class TestCaseTransitionsAreCompareAndSet:
    def test_amend_on_a_case_closed_meanwhile_is_a_409(
        self, icms_client, cases, race, events, db
    ):
        from app.icms import workflow as wf

        race(wf, "check_amendable", closed=move("CMP-2026-0001", status="closed"))
        response = icms_client.sign_in(NODAL).patch(
            f"{CASES}/CMP-2026-0001", json={"landmark": "Opposite the post office"})

        assert_lost_race(response)
        assert events(cases["CMP-2026-0001"].id) == []

    def test_assign_on_a_case_moved_meanwhile_is_a_409(
        self, icms_client, cases, race, events, db
    ):
        from ada_core.models_icms import CaseAssignment

        from app.icms import workflow as wf

        race(wf, "check", moved=move("CMP-2026-0001", status="rejected"))
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0001/assign", json={"assignee_user_id": SURVEYOR_B_ID})

        assert_lost_race(response)
        assert case_of(db, "CMP-2026-0001").status == "rejected"
        assert count(db, CaseAssignment,
                     CaseAssignment.case_id == cases["CMP-2026-0001"].id) == 0
        assert events(cases["CMP-2026-0001"].id) == []

    def test_reassign_on_a_case_whose_round_opened_meanwhile_is_a_409(
        self, icms_client, cases, race, events, db
    ):
        from app.icms import workflow as wf

        race(wf, "check", moved=move("CMP-2026-0002", status="under_inspection",
                                     current_round=1))
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0002/assign",
            json={"assignee_user_id": SURVEYOR_B_ID, "reason": "Rebalancing the zone."})

        assert_lost_race(response)
        assert case_of(db, "CMP-2026-0002").status == "under_inspection"
        assert events(cases["CMP-2026-0002"].id) == []

    def test_open_round_twice_at_once_opens_one_round(
        self, icms_client, inspection_ready, race, events, db
    ):
        from app.icms import workflow as wf

        race(wf, "check", moved=move("CMP-2026-0002", status="under_inspection",
                                     current_round=1))
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/CMP-2026-0002/inspections", json={"surveyor_user_id": SURVEYOR_ID})

        assert_lost_race(response)
        case_id = inspection_ready["CMP-2026-0002"].id
        assert count(db, Inspection, Inspection.case_id == case_id) == 0
        assert events(case_id) == []


# ----------------------------------------------------------- D-01 inspections
class TestInspectionWritesAreCompareAndSet:
    def test_check_in_after_a_concurrent_submit_is_a_409(
        self, icms_client, inspection_loop, race, events, db
    ):
        from app.icms import workflow as wf

        race(wf, "check", moved=move(UNDER_INSPECTION, status="inspection_submitted"))
        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ROUND_OF_0006}/check-in", json=check_in_body())

        assert_lost_race(response)
        assert count(db, CheckIn) == 0
        assert events(inspection_loop[UNDER_INSPECTION].id) == []

    def test_evidence_after_a_concurrent_submit_is_a_409(
        self, icms_client, inspection_loop, race, events, db
    ):
        from app.icms import workflow as wf

        race(wf, "check", moved=move(UNDER_INSPECTION, status="inspection_submitted"))
        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ROUND_OF_0006}/evidence",
            data=fields(idempotency_key=key("701")), files=jpeg())

        assert_lost_race(response)
        assert count(db, Evidence) == 1, "only the seeded photograph"
        assert events(inspection_loop[UNDER_INSPECTION].id) == []

    def test_a_refused_upload_leaves_no_file_behind(
        self, icms_client, inspection_loop, race, db
    ):
        """The file is written before the transaction; a 409 must not orphan it."""
        from app.config import settings
        from app.icms import workflow as wf

        before = evidence_files(settings.icms_evidence_dir)
        race(wf, "check", moved=move(UNDER_INSPECTION, status="inspection_submitted"))
        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ROUND_OF_0006}/evidence",
            data=fields(idempotency_key=key("702")),
            files={"file": ("x.jpg", UNIQUE_JPEG, "image/jpeg")})

        assert_lost_race(response)
        assert evidence_files(settings.icms_evidence_dir) == before

    def test_a_refused_duplicate_keeps_the_file_an_earlier_upload_owns(
        self, icms_client, inspection_loop, race, db
    ):
        """Content-addressed: identical bytes share one file, so the refusal of the
        second upload must not delete the first one's."""
        from app.config import settings
        from app.icms import workflow as wf

        client = icms_client.sign_in(SURVEYOR)
        first = client.post(f"{INSPECTIONS}/{ROUND_OF_0006}/evidence",
                            data=fields(idempotency_key=key("703")), files=jpeg())
        assert first.status_code == 201, first.text
        stored = db.execute(select(Evidence.storage_path).where(
            Evidence.id == first.json()["id"])).scalar_one()

        race(wf, "check", moved=move(UNDER_INSPECTION, status="inspection_submitted"))
        response = client.post(f"{INSPECTIONS}/{ROUND_OF_0006}/evidence",
                               data=fields(idempotency_key=key("704")), files=jpeg())

        assert_lost_race(response)
        assert (settings.icms_evidence_dir / stored).is_file()

    def test_findings_after_a_concurrent_submit_do_not_reopen_the_case(
        self, icms_client, inspection_loop, race, events, db
    ):
        from app.icms import workflow as wf

        race(wf, "check", moved=move(UNDER_INSPECTION, status="inspection_submitted"))
        response = icms_client.sign_in(SURVEYOR).put(
            f"{INSPECTIONS}/{ROUND_OF_0006}/findings", json={"findings": ["Late."]})

        assert_lost_race(response)
        assert case_of(db, UNDER_INSPECTION).status == "inspection_submitted"
        assert count(db, InspectionFinding) == 0
        assert events(inspection_loop[UNDER_INSPECTION].id) == []

    def test_submit_on_a_case_moved_meanwhile_is_a_409(
        self, icms_client, inspection_loop, race, events, db
    ):
        from app.icms import workflow as wf

        race(wf, "check", moved=move(UNDER_INSPECTION, status="verified"))
        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ROUND_OF_0006}/submit", json={"idempotency_key": SUBMIT_KEY})

        assert_lost_race(response)
        assert case_of(db, UNDER_INSPECTION).status == "verified"
        assert events(inspection_loop[UNDER_INSPECTION].id) == []

    def test_a_submit_that_lost_to_its_own_retry_is_a_replay(
        self, icms_client, inspection_loop, race, events, db
    ):
        """Two copies of one submit from a flaky handset: one move, one event, and
        the loser answered as the replay it is rather than as an error."""
        from app.icms import workflow as wf

        case_id = inspection_loop[UNDER_INSPECTION].id
        race(wf, "check", **concurrent_submit(case_id, SUBMIT_KEY))
        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ROUND_OF_0006}/submit", json={"idempotency_key": SUBMIT_KEY})

        assert response.status_code == 200, response.text
        assert response.json()["status"] == "submitted"
        assert len(events(case_id)) == 1, "the replay moves nothing"

    def test_a_submit_that_lost_to_a_different_submit_is_a_409(
        self, icms_client, inspection_loop, race, events, db
    ):
        """Another device submitted the round meanwhile under its own key: this
        request is not a replay of that one, so it must not be told it succeeded."""
        from app.icms import workflow as wf

        case_id = inspection_loop[UNDER_INSPECTION].id
        race(wf, "check", **concurrent_submit(case_id, "6f1d6dd9-8443-4b90-9a86-0f65c42b7999"))
        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ROUND_OF_0006}/submit", json={"idempotency_key": SUBMIT_KEY})

        assert_lost_race(response)
        assert len(events(case_id)) == 1

    @pytest.mark.parametrize("decision", [
        {"decision": "accept"},
        {"decision": "reject", "reason": "The rear setback was not measured."},
    ])
    def test_verify_twice_at_once_moves_the_case_once(
        self, icms_client, inspection_loop, race, events, db, decision
    ):
        from app.icms import workflow as wf

        race(wf, "check", moved=move(SUBMITTED, status="resurvey_requested"))
        response = icms_client.sign_in(NODAL).post(
            f"{INSPECTIONS}/{ROUND_OF_0007}/verify", json=decision)

        assert_lost_race(response)
        assert case_of(db, SUBMITTED).status == "resurvey_requested"
        db.expire_all()
        assert db.execute(select(Inspection.status).where(
            Inspection.inspection_ref == ROUND_OF_0007)).scalar_one() == "submitted"
        assert events(inspection_loop[SUBMITTED].id) == []

    def test_request_resurvey_on_a_case_verified_meanwhile_is_a_409(
        self, icms_client, inspection_loop, race, events, db
    ):
        from app.icms import workflow as wf

        race(wf, "check", moved=move(SUBMITTED, status="verified"))
        response = icms_client.sign_in(NODAL).post(
            f"{CASES}/{SUBMITTED}/resurvey-requests", json={"reason": "Re-measure it."})

        assert_lost_race(response)
        case_id = inspection_loop[SUBMITTED].id
        assert count(db, ResurveyRequest, ResurveyRequest.case_id == case_id) == 0
        assert events(case_id) == []


# ------------------------------------------------------------------- D-06
class TestDecidingAResurvey:
    def test_two_approvals_at_once_open_one_round(
        self, icms_client, inspection_loop, race, events, db
    ):
        """Was a 500 on icms_inspection_round_uq; the decision is now itself a
        compare-and-set on `decision = 'pending'`."""
        from app.icms import workflow as wf

        race(wf, "check", decided=update(ResurveyRequest)
             .where(ResurveyRequest.id == 1).values(decision="approved"))
        response = icms_client.sign_in(NODAL).post(
            f"{REQUESTS}/1/decide",
            json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID})

        assert_lost_race(response, "resurvey_already_decided")
        case_id = inspection_loop[RESURVEY].id
        assert count(db, Inspection, Inspection.case_id == case_id) == 1
        assert events(case_id) == []

    def test_approval_after_a_round_was_opened_directly_is_a_409(
        self, icms_client, inspection_loop, race, events, db
    ):
        from app.icms import workflow as wf

        race(wf, "check", moved=move(RESURVEY, status="under_inspection", current_round=2))
        response = icms_client.sign_in(NODAL).post(
            f"{REQUESTS}/1/decide",
            json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID})

        assert_lost_race(response)
        db.expire_all()
        assert db.execute(select(ResurveyRequest.decision)
                          .where(ResurveyRequest.id == 1)).scalar_one() == "pending"

    def test_a_refusal_writes_its_event_row(self, icms_client, inspection_loop, events):
        """Rule 1: a decision with no event row is a decision nobody can account for."""
        response = icms_client.sign_in(NODAL).post(
            f"{REQUESTS}/1/decide", json={"decision": "refuse", "note": "Round 1 stands."})

        assert response.status_code == 200, response.text
        trail = events(inspection_loop[RESURVEY].id)
        assert len(trail) == 1
        assert trail[0]["action"] == "refuse_resurvey"
        assert (trail[0]["from_status"], trail[0]["to_status"]) == (
            "resurvey_requested", "resurvey_requested")
        assert trail[0]["note"] == "Round 1 stands."
        assert trail[0]["round_no"] == 1
        assert trail[0]["payload"] == {"resurvey_request_id": 1, "decision": "rejected"}

    def test_a_refusal_racing_an_approval_is_a_409(
        self, icms_client, inspection_loop, race, events, db
    ):
        from app.icms import inspections

        race(inspections, "_refuse_unless_own_round", decided=update(ResurveyRequest)
             .where(ResurveyRequest.id == 1).values(decision="approved"))
        response = icms_client.sign_in(NODAL).post(
            f"{REQUESTS}/1/decide", json={"decision": "refuse", "note": "No."})

        assert_lost_race(response, "resurvey_already_decided")
        assert events(inspection_loop[RESURVEY].id) == []


# ------------------------------------------------------------------- D-02
@pytest.fixture
def round_two(icms_client, inspection_loop):
    """CMP-2026-0008 approved into round 2; INS-2026-0003 is now its superseded round 1."""
    response = icms_client.sign_in(NODAL).post(
        f"{REQUESTS}/1/decide", json={"decision": "approve", "surveyor_user_id": SURVEYOR_ID})
    assert response.status_code == 200, response.text
    return inspection_loop


class TestASupersededRoundTakesNoWrites:
    def test_the_case_is_on_round_two(self, db, round_two):
        row = case_of(db, RESURVEY)
        assert (row.status, row.current_round) == ("under_inspection", 2)

    def test_check_in_on_the_old_round_is_a_409(self, icms_client, round_two, db):
        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ROUND_OF_0008}/check-in", json=check_in_body())

        assert_lost_race(response)
        assert count(db, CheckIn) == 0

    def test_evidence_on_the_old_round_is_a_409(self, icms_client, round_two, db):
        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ROUND_OF_0008}/evidence",
            data=fields(idempotency_key=key("702")), files=jpeg())

        assert_lost_race(response)
        assert count(db, Evidence, Evidence.round_no == 1,
                     Evidence.case_id == round_two[RESURVEY].id) == 0

    def test_findings_on_the_old_round_are_a_409(self, icms_client, round_two, db):
        response = icms_client.sign_in(SURVEYOR).put(
            f"{INSPECTIONS}/{ROUND_OF_0008}/findings", json={"findings": ["Stale."]})

        assert_lost_race(response)
        assert count(db, InspectionFinding) == 0

    def test_verify_through_the_old_round_is_a_409(self, icms_client, round_two, db):
        """Round 2 submitted, then an accept aimed at round 1: it would mark the
        wrong round accepted and verify the case on evidence it never reviewed."""
        client = icms_client.sign_in(SURVEYOR)
        new_ref = db.execute(select(Inspection.inspection_ref).where(
            Inspection.case_id == round_two[RESURVEY].id,
            Inspection.round_no == 2)).scalar_one()
        submitted = client.post(f"{INSPECTIONS}/{new_ref}/submit",
                                json={"idempotency_key": SUBMIT_KEY})
        assert submitted.status_code == 200, submitted.text

        response = icms_client.sign_in(NODAL).post(
            f"{INSPECTIONS}/{ROUND_OF_0008}/verify", json={"decision": "accept"})

        assert_lost_race(response)
        assert case_of(db, RESURVEY).status == "inspection_submitted"

    def test_the_old_round_still_reads(self, icms_client, round_two):
        response = icms_client.sign_in(NODAL).get(f"{INSPECTIONS}/{ROUND_OF_0008}")
        assert response.status_code == 200, response.text
        assert response.json()["round_no"] == 1


# ------------------------------------------------------------------- D-07
class TestThePhotoCeilingIsCountedUnderTheLock:
    def test_a_photo_landing_between_count_and_insert_is_refused(
        self, icms_client, inspection_loop, db, monkeypatch
    ):
        """The early count passes, a concurrent upload fills the round while this
        one streams to disk, and the count under the lock refuses it."""
        from app.config import settings
        from app.icms import inspections

        monkeypatch.setattr(settings, "icms_max_photos_per_round", 2)
        real_store = inspections._store
        seeded = db.execute(select(Evidence).limit(1)).scalar_one()

        def store_then_race(*args, **kwargs):
            stored = real_store(*args, **kwargs)
            db.execute(insert(Evidence).values(
                case_id=seeded.case_id, inspection_id=seeded.inspection_id, round_no=1,
                kind="photo", storage_path=seeded.storage_path, sha256="1" * 64,
                byte_size=seeded.byte_size, location=seeded.location, accuracy_m=6.0,
                device_timestamp=seeded.device_timestamp, capture_source="camera",
                uploaded_by=SURVEYOR_ID,
                idempotency_key="22222222-2222-4222-8222-222222222222"))
            db.commit()
            return stored

        monkeypatch.setattr(inspections, "_store", store_then_race)
        response = icms_client.sign_in(SURVEYOR).post(
            f"{INSPECTIONS}/{ROUND_OF_0006}/evidence",
            data=fields(idempotency_key=key("703")), files=jpeg())

        assert response.status_code == 422, response.text
        assert error_of(response)["code"] == "too_many_photos"
        assert count(db, Evidence, Evidence.kind == "photo") == 2

    def test_the_round_lock_is_a_row_lock_on_postgres(self):
        from app.icms.inspections import _round_lock

        sql = str(_round_lock(7).compile(dialect=postgresql.dialect()))
        assert "FOR UPDATE" in sql
        assert "icms_inspection.id =" in sql


# --------------------------------------------------------- stages 6 and 7
class TestConfirmAndIssueAreCompareAndSet:
    def test_confirm_on_a_case_moved_meanwhile_is_a_409(
        self, icms_client, notice_world, race, events, db
    ):
        from app.icms import workflow as wf

        db.execute(move("CMP-2026-0011", status="handed_over", stage_no=6))
        db.commit()
        race(wf, "check", moved=move("CMP-2026-0011", status="confirmed", stage_no=7))
        response = icms_client.sign_in(LEAD).post(f"{CASES}/CMP-2026-0011/confirm")

        assert_lost_race(response)
        assert events(notice_world["CMP-2026-0011"].id) == []

    def test_a_notice_raced_by_another_issuer_mints_no_number(
        self, icms_client, notice_world, race, events, db
    ):
        from ada_core.models_icms import Notice

        from app.icms import workflow as wf

        before = db.execute(select(NoticeSequence.last_seq)
                            .where(NoticeSequence.series == "NTC")).scalar_one_or_none()
        notices_before = count(db, Notice)
        race(wf, "check", moved=move("CMP-2026-0011", status="notice_issued"))
        response = icms_client.sign_in(LEAD).post(
            f"{CASES}/CMP-2026-0011/notices",
            json={"act_cd": "up_upda_1973", "section_cds": ["sec_27"]})

        assert_lost_race(response)
        assert count(db, Notice) == notices_before
        db.expire_all()
        assert db.execute(select(NoticeSequence.last_seq)
                          .where(NoticeSequence.series == "NTC")).scalar_one_or_none() == before
        assert events(notice_world["CMP-2026-0011"].id) == []

    def test_a_second_notice_on_an_issued_case_is_a_409(self, icms_client, notice_world, db):
        from ada_core.models_icms import Notice

        notices_before = count(db, Notice)
        response = icms_client.sign_in(LEAD).post(
            f"{CASES}/CMP-2026-0012/notices",
            json={"act_cd": "up_upda_1973", "section_cds": ["sec_27"]})

        assert_lost_race(response)
        assert count(db, Notice) == notices_before

    def test_a_failure_after_allocation_gives_the_number_back(
        self, icms_client, notice_world, monkeypatch
    ):
        """The reference, the row and the move are one transaction: a render that
        fails after the number is drawn must not leave the counter advanced."""
        from app.icms import notices

        real_render = notices.render

        def fail_once(*_args, **_kwargs):
            monkeypatch.setattr(notices, "render", real_render)
            raise RuntimeError("the renderer fell over")

        monkeypatch.setattr(notices, "render", fail_once)
        client = icms_client.sign_in(LEAD)
        body = {"act_cd": "up_upda_1973", "section_cds": ["sec_27"]}

        with pytest.raises(RuntimeError, match="renderer fell over"):
            client.post(f"{CASES}/CMP-2026-0011/notices", json=body)

        retried = client.post(f"{CASES}/CMP-2026-0011/notices", json=body)
        assert retried.status_code == 201, retried.text
        assert retried.json()["notice_ref"] == "NTC-2026-0004"
