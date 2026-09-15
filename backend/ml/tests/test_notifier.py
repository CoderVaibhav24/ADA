"""Telling the officer their analysis ended — and never failing the job for it."""

from __future__ import annotations

import pytest


@pytest.fixture
def notifier(monkeypatch):
    """A fresh notifier module state per test.

    The SDK client is cached at module level so it is built once per process;
    a test that leaves one behind changes the outcome of the next.
    """
    from app import notifier as module

    monkeypatch.setattr(module, "_client", None)
    monkeypatch.setattr(module, "_unavailable_reason", None)
    return module


class Recorder:
    """Stands in for ADANotify. Records what was submitted."""

    def __init__(self, accepted: bool = True, error: str | None = None):
        self.sent: list[dict] = []
        self._accepted = accepted
        self._error = error

    def send(self, **kwargs):
        self.sent.append(kwargs)
        return type("Outcome", (), {"accepted": self._accepted, "error": self._error})()


@pytest.fixture
def recorder(notifier, monkeypatch):
    rec = Recorder()
    monkeypatch.setattr(notifier.settings, "notify_enabled", True)
    monkeypatch.setattr(notifier, "_notifier", lambda: rec)
    return rec


def test_nothing_is_sent_when_notifications_are_off(notifier, monkeypatch, db, job):
    """A deployment without ada-notify must not trail every finished analysis
    with a warning nobody can act on."""
    monkeypatch.setattr(notifier.settings, "notify_enabled", False)
    monkeypatch.setattr(notifier, "_notifier", lambda: pytest.fail("must not be built"))
    notifier.analysis_finished(job.id)


def test_a_finished_analysis_is_addressed_to_the_project_owner(recorder, notifier, db, job,
                                                              project):
    """The recipient is a Keycloak subject, never an email address — ada-notify
    reads the address off the account at delivery time, so an officer who
    changes it gets the next message at the new one."""
    notifier.analysis_finished(job.id)
    assert len(recorder.sent) == 1
    assert recorder.sent[0]["recipient"] == project.user_id
    assert recorder.sent[0]["template_key"] == "analysis-complete"


def test_a_failed_analysis_uses_the_other_template(recorder, notifier, db, job):
    job.status = "failed"
    job.error = "Source imagery for raster 7 is missing on disk"
    db.commit()
    notifier.analysis_failed(job.id)
    assert recorder.sent[0]["template_key"] == "analysis-failed"
    assert "missing on disk" in recorder.sent[0]["payload"]["error"]


def test_the_idempotency_key_is_natural_not_generated(recorder, notifier, db, job):
    """A generated key would make a retried submission a second email to a real
    person. Sent twice, this is one notification."""
    notifier.analysis_finished(job.id)
    notifier.analysis_finished(job.id)
    keys = {call["idempotency_key"] for call in recorder.sent}
    assert keys == {f"analysis-complete-{job.id}"}


def test_the_payload_carries_the_statistics_the_officer_cares_about(recorder, notifier, db, job):
    job.stats = {"polygons": 7, "changed_area_m2": 1420.25}
    db.commit()
    notifier.analysis_finished(job.id)
    payload = recorder.sent[0]["payload"]
    assert payload["polygon_count"] == "7"
    assert payload["changed_area_m2"] == "1420.25"
    assert payload["mode"] == "ai"


def test_the_link_points_at_the_browser_origin_not_a_container(recorder, notifier, db, job,
                                                               project, monkeypatch):
    """Neither service's own address is reachable from a person's laptop."""
    monkeypatch.setattr(notifier.settings, "app_origin", "https://ada.pcsmcpl.net/")
    notifier.analysis_finished(job.id)
    assert recorder.sent[0]["payload"]["project_url"] == (
        f"https://ada.pcsmcpl.net/projects/{project.id}"
    )


def test_every_payload_value_is_a_string(recorder, notifier, db, job):
    """The renderer substitutes text. A number left as an int renders as
    'None' or raises depending on the path, and the first anyone knows of it is
    a delivery marked failed."""
    job.stats = {"polygons": 7, "changed_area_m2": 1420.25}
    db.commit()
    notifier.analysis_finished(job.id)
    assert all(isinstance(v, str) for v in recorder.sent[0]["payload"].values())


class TestNothingHereCanFailTheAnalysis:
    """The analysis already finished. Its polygons are committed and the
    officer can see them. A notification problem must not undo that."""

    def test_a_job_that_no_longer_exists(self, recorder, notifier, db, engine):
        notifier.analysis_finished(99999)
        assert recorder.sent == []

    def test_a_project_with_no_owner(self, recorder, notifier, db, project, job):
        project.user_id = ""
        db.commit()
        notifier.analysis_finished(job.id)
        assert recorder.sent == []

    def test_a_rejected_submission(self, notifier, monkeypatch, db, job):
        monkeypatch.setattr(notifier.settings, "notify_enabled", True)
        monkeypatch.setattr(notifier, "_notifier", lambda: Recorder(accepted=False,
                                                                    error="503 from ada-notify"))
        notifier.analysis_finished(job.id)  # logs, does not raise

    def test_an_unconfigured_client(self, notifier, monkeypatch, db, job, caplog):
        """Enabled but with no secret. Reported once, not on every job — an
        analysis a minute would otherwise repeat it into the log forever."""
        monkeypatch.setattr(notifier.settings, "notify_enabled", True)
        monkeypatch.setattr(notifier.settings, "notify_client_secret", "")
        monkeypatch.setattr(notifier.settings, "notify_issuer", "")
        notifier.analysis_finished(job.id)
        notifier.analysis_finished(job.id)
        assert notifier._unavailable_reason is not None
