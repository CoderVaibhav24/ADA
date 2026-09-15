"""Handing work to ada-ml: the one call that crosses the service boundary.

What used to be an in-process function call is now a network hop that can fail
after the row is committed. The contract that matters is what happens then.
"""

from __future__ import annotations

import httpx
import pytest
from fastapi import HTTPException

from app.clients import ml


@pytest.fixture
def capture(monkeypatch):
    """Record the request ada-api would send, and reply however a test wants."""
    sent: list[httpx.Request] = []

    def install(response: httpx.Response | Exception):
        def fake_post(url, *, json, headers, timeout):
            request = httpx.Request("POST", url, json=json, headers=headers)
            sent.append(request)
            if isinstance(response, Exception):
                raise response
            response.request = request
            return response

        monkeypatch.setattr(ml.httpx, "post", fake_post)
        return sent

    return install


def test_an_accepted_ingest_is_silent(capture):
    sent = capture(httpx.Response(202, json={"accepted": True, "queue_depth": 0}))
    ml.submit_ingest(42)
    assert len(sent) == 1
    assert sent[0].url.path == "/v1/ingests"


def test_it_sends_only_the_id(capture):
    """The row is already in PostgreSQL, written inside the transaction that
    checked the officer owns the project. Re-sending its fields would create a
    second copy of the truth that can disagree with the first."""
    import json as json_module

    sent = capture(httpx.Response(202, json={"accepted": True, "queue_depth": 0}))
    ml.submit_analysis(412)
    assert json_module.loads(sent[0].content) == {"job_id": 412}


def test_it_presents_the_service_token(capture):
    sent = capture(httpx.Response(202, json={"accepted": True, "queue_depth": 0}))
    ml.submit_ingest(1)
    assert sent[0].headers["X-ADA-Service-Token"] == "service-token"


def test_no_token_configured_sends_no_header(capture, monkeypatch):
    """Empty disables the check on both sides. Sending an empty header instead
    would be a header that never matches."""
    monkeypatch.setattr(ml.settings, "ml_service_token", "")
    sent = capture(httpx.Response(202, json={"accepted": True, "queue_depth": 0}))
    ml.submit_ingest(1)
    assert "X-ADA-Service-Token" not in sent[0].headers


class TestFailureIsReportedNotSwallowed:
    def test_an_unreachable_model_service_is_503(self, capture):
        capture(httpx.ConnectError("connection refused"))
        with pytest.raises(HTTPException) as exc:
            ml.submit_ingest(42)
        assert exc.value.status_code == 503

    def test_a_timeout_is_503(self, capture):
        capture(httpx.ReadTimeout("too slow"))
        with pytest.raises(HTTPException) as exc:
            ml.submit_analysis(42)
        assert exc.value.status_code == 503

    def test_a_refused_service_token_is_503_to_the_officer(self, capture):
        """A 401 between two of our own services is a configuration fault. The
        officer cannot act on 'unauthorised', so they are told the service is
        unreachable and the real reason goes to the log."""
        capture(httpx.Response(401, json={"detail": "Bad or missing service token"}))
        with pytest.raises(HTTPException) as exc:
            ml.submit_ingest(42)
        assert exc.value.status_code == 503
        assert "token" not in exc.value.detail.lower()

    def test_a_404_from_ada_ml_is_503(self, capture):
        capture(httpx.Response(404, json={"detail": "No raster 42"}))
        with pytest.raises(HTTPException):
            ml.submit_ingest(42)

    def test_the_message_says_the_work_is_not_lost(self, capture):
        """The row stays queued and ada-ml's requeue_stale sweep collects it.
        Telling the officer to re-upload a multi-gigabyte raster would be
        wrong, and it is what they would otherwise do."""
        capture(httpx.ConnectError("down"))
        with pytest.raises(HTTPException) as exc:
            ml.submit_ingest(42)
        detail = exc.value.detail.lower()
        assert "recorded" in detail
        assert "re-upload" not in detail.replace("nothing needs to be re-uploaded", "")
