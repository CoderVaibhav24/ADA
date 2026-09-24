"""Deadline reminders (app/icms/reminders.py, docs/icms/notifications.md Reminders).

Driven synchronously with a fixed IST clock; the ada-notify client is a recorder
and zone recipients come from the realm double's role mappings.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

import pytest
from ada_core.database import SessionLocal
from ada_core.datetimes import IST

from tests.conftest import LEAD_ID, NODAL_ID, SUPER_ADMIN, SURVEYOR_B_ID, SURVEYOR_ID

BASE = datetime(2026, 9, 20, 10, 0, tzinfo=IST)
PUSH = ["push", "inapp"]
INAPP = ["inapp"]


def at(days: float, hour: int = 11) -> datetime:
    return (BASE + timedelta(days=days)).replace(hour=hour, minute=0)


class _Recorder:
    def __init__(self) -> None:
        self.calls: list[dict] = []
        self.refuse = False

    def send(self, **kwargs):
        from ada_platform.notify import SendOutcome

        self.calls.append(kwargs)
        if self.refuse:
            return SendOutcome(accepted=False, status_code=503, error="down")
        return SendOutcome(accepted=True, status_code=202)

    def who(self) -> list[tuple[str, str]]:
        return sorted((c["template_key"], c["recipient"]) for c in self.calls)

    def take(self) -> list[tuple[str, str]]:
        taken = self.who()
        self.calls = []
        return taken


@pytest.fixture
def notify():
    from app.icms import notifier

    notifier.reset_role_cache()
    yield _Recorder()
    notifier.reset_role_cache()


@pytest.fixture
def world(db, cases):
    """CMP-2026-0002 (TAJ, Surveyor B) and CMP-2026-0003 (CANT, Surveyor), both
    assigned at BASE with no round opened."""
    from ada_core.models_icms import CaseAssignment

    for row in db.query(CaseAssignment).all():
        row.assigned_at = BASE
    db.commit()
    return cases


@pytest.fixture
def run(keycloak, notify):
    from app.icms import reminders

    def scan(now: datetime):
        return reminders.run_once(SessionLocal, now, client=notify, directory=lambda: keycloak)

    return scan


def _only_taj(db, cases, status: str):
    """Park CMP-2026-0003 out of every rule and move CMP-2026-0002 to `status`."""
    cases["CMP-2026-0003"].status = "closed"
    cases["CMP-2026-0002"].status = status
    db.commit()
    return cases["CMP-2026-0002"]


class TestSurveyNotStarted:
    def test_nothing_before_the_due_day(self, world, run, notify):
        report = run(at(1.5))
        assert report.found == 0 and notify.calls == []

    def test_the_assignee_is_pushed_at_two_days(self, world, run, notify):
        report = run(at(2))

        assert report.sent == 2
        assert notify.who() == [("inspection_reminder", SURVEYOR_ID),
                                ("inspection_reminder", SURVEYOR_B_ID)]
        call = next(c for c in notify.calls if c["recipient"] == SURVEYOR_B_ID)
        assert call["channels"] == PUSH
        assert call["payload"] == {"case_ref": "CMP-2026-0002", "days": "2",
                                   "route": "/inspection/CMP-2026-0002"}
        assert call["idempotency_key"].startswith("reminder-survey_not_started-A")

    def test_overdue_also_tells_the_zone_nodal_officers(self, world, run, notify):
        run(at(2))
        notify.take()
        run(at(5))

        assert ("inspection_overdue", NODAL_ID) in notify.who()
        assert ("inspection_reminder", SURVEYOR_B_ID) in notify.who()
        overdue = next(c for c in notify.calls if c["template_key"] == "inspection_overdue")
        assert overdue["channels"] == INAPP
        assert overdue["payload"]["zone_name"] == "Taj Ganj"
        assert overdue["payload"]["route"] == "/complaints/CMP-2026-0002"

    def test_a_long_stalled_survey_gets_only_the_highest_stage(self, world, run, db):
        from ada_core.models_icms import ReminderSent

        run(at(9))
        stages = {(r.rule, r.stage) for r in db.query(ReminderSent).all()}
        assert stages == {("survey_not_started", "overdue"), ("survey_overdue", "overdue")}

    def test_an_opened_but_unstarted_round_counts_from_its_opening(
            self, db, world, run, notify):
        from ada_core.models_icms import Inspection

        case = _only_taj(db, world, "under_inspection")
        db.add(Inspection(inspection_ref="INS-2026-0901", case_id=case.id, round_no=1,
                          surveyor_user_id=SURVEYOR_B_ID, status="scheduled",
                          created_at=BASE + timedelta(days=1)))
        db.commit()

        assert run(at(2.5)).found == 0
        run(at(3.5))
        assert notify.who() == [("inspection_reminder", SURVEYOR_B_ID)]
        assert notify.calls[0]["payload"]["inspection_ref"] == "INS-2026-0901"

    def test_a_started_round_is_never_reminded(self, db, world, run, notify):
        from ada_core.models_icms import Inspection

        case = _only_taj(db, world, "under_inspection")
        db.add(Inspection(inspection_ref="INS-2026-0902", case_id=case.id, round_no=1,
                          surveyor_user_id=SURVEYOR_B_ID, status="in_progress",
                          created_at=BASE, started_at=BASE + timedelta(hours=1)))
        db.commit()

        assert run(at(9)).found == 0


class TestVerificationPending:
    def test_the_zone_verifiers_are_told_after_three_days(self, db, world, run, notify):
        from ada_core.models_icms import Inspection

        case = _only_taj(db, world, "inspection_submitted")
        db.add(Inspection(inspection_ref="INS-2026-0903", case_id=case.id, round_no=1,
                          surveyor_user_id=SURVEYOR_B_ID, status="submitted",
                          created_at=BASE, submitted_at=BASE))
        db.commit()

        assert run(at(2)).found == 0
        run(at(3))
        assert notify.who() == [("verification_pending", NODAL_ID)]
        assert notify.calls[0]["payload"]["inspection_ref"] == "INS-2026-0903"


class TestResurveyDecision:
    def test_an_undecided_request_reaches_the_zone(self, db, world, run, notify):
        from ada_core.models_icms import ResurveyRequest

        case = _only_taj(db, world, "inspection_submitted")
        db.add(ResurveyRequest(case_id=case.id, from_round=1, reason="blurred",
                               requested_by=SURVEYOR_B_ID, requested_at=BASE))
        db.commit()

        run(at(3))
        assert ("resurvey_decision_pending", NODAL_ID) in notify.who()

    def test_a_decided_request_is_left_alone(self, db, world, run, notify):
        from ada_core.models_icms import ResurveyRequest

        case = _only_taj(db, world, "inspection_submitted")
        db.add(ResurveyRequest(case_id=case.id, from_round=1, reason="blurred",
                               requested_by=SURVEYOR_B_ID, requested_at=BASE,
                               decision="rejected"))
        db.commit()

        assert run(at(9)).found == 0


class TestNoticeCompliance:
    def _notice(self, db, world, status: str = "issued"):
        from ada_core.models_icms import Notice

        case = _only_taj(db, world, "notice_issued")
        db.add(Notice(notice_ref="NOT-2026-0901", case_id=case.id, act_cd="up_upda_1973",
                      status=status, issued_at=BASE, compliance_due=date(2026, 9, 22)))
        db.commit()

    def test_the_project_leads_are_told_the_day_after_it_passes(
            self, db, world, run, notify):
        self._notice(db, world)

        assert run(at(2, hour=20)).found == 0
        run(at(3, hour=9))
        assert notify.who() == [("notice_compliance_due", LEAD_ID)]
        assert notify.calls[0]["payload"]["compliance_due"] == "2026-09-22"

    def test_a_withdrawn_notice_is_not_chased(self, db, world, run):
        self._notice(db, world, status="withdrawn")
        assert run(at(9)).found == 0


class TestIdempotency:
    def test_a_second_scan_sends_nothing(self, world, run, notify):
        first = run(at(2))
        notify.take()
        second = run(at(2, hour=15))

        assert first.sent == 2
        assert second.already == 2 and second.sent == 0 and notify.calls == []

    def test_a_refused_send_is_not_recorded_and_is_retried(self, world, run, notify):
        notify.refuse = True
        assert run(at(2)).unsent == 2
        notify.refuse = False
        notify.take()

        assert run(at(2, hour=15)).sent == 2
        assert len(notify.calls) == 2

    def test_a_zone_with_nobody_to_tell_is_retried(self, db, world, run, notify, keycloak):
        from app.icms import notifier

        held = keycloak.role_mappings.pop(NODAL_ID)
        run(at(5))
        assert ("inspection_overdue", NODAL_ID) not in notify.who()

        keycloak.role_mappings[NODAL_ID] = held
        notifier.reset_role_cache()
        notify.take()
        run(at(5, hour=15))
        assert notify.who() == [("inspection_overdue", NODAL_ID)]


class TestQuietHoursAndSwitch:
    @pytest.mark.parametrize("hour", [21, 23, 0, 7])
    def test_nothing_is_sent_at_night(self, world, run, notify, hour):
        report = run(at(3, hour=hour))
        assert report.skipped == "quiet_hours" and notify.calls == []

    @pytest.mark.parametrize("hour", [8, 20])
    def test_the_day_edges_send(self, world, run, hour):
        assert run(at(3, hour=hour)).sent == 2

    def test_a_utc_clock_is_read_in_ist(self, world, run):
        # 16:00 UTC is 21:30 IST.
        assert run(at(3).astimezone(UTC).replace(hour=16)).skipped == "quiet_hours"

    def test_quiet_hours_are_configurable(self, db, world, run):
        from app.icms import runtime_settings as rs

        rs.write(db, rs.QUIET_START_HOUR, 10, actor="t")
        assert run(at(3, hour=11)).skipped == "quiet_hours"

    def test_the_switch_turns_every_rule_off(self, db, world, run, notify):
        from app.icms import runtime_settings as rs

        rs.write(db, rs.REMINDERS_ENABLED, False, actor="t")
        assert run(at(9)).skipped == "disabled"
        assert notify.calls == []

    def test_the_sla_days_are_read_from_the_settings(self, db, world, run):
        from app.icms import runtime_settings as rs

        rs.write(db, rs.SURVEY_DUE_DAYS, 4, actor="t")
        assert run(at(3)).found == 0
        assert run(at(4)).sent == 2

    def test_notify_off_sends_nothing(self, db, world):
        from app.icms import reminders

        assert reminders.run_once(SessionLocal, at(3)).skipped == "notify_unavailable"


class TestAdmin:
    PATH = "/api/icms/admin/runtime-settings"

    def test_the_reminder_keys_are_listed_and_validated(self, icms_client):
        admin = icms_client.sign_in(SUPER_ADMIN)
        keys = {r["key"] for r in admin.get(self.PATH).json()}
        assert {"reminders.enabled", "reminders.interval_minutes",
                "reminders.survey_due_days", "reminders.quiet_start_hour"} <= keys

        assert admin.put(f"{self.PATH}/reminders.survey_due_days",
                         json={"value": 4}).status_code == 200
        assert admin.put(f"{self.PATH}/reminders.quiet_start_hour",
                         json={"value": 24}).status_code == 422
        assert admin.put(f"{self.PATH}/reminders.enabled",
                         json={"value": 1}).status_code == 422
