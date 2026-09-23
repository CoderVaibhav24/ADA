"""The photograph count, which the server owns and the clients read.

Decided 2026-09-23: how many photographs a round carries is the server's number,
published by `GET /api/icms/app-config` and enforced at both ends — `submit`
refuses a round below `icms_min_photos_per_round` 422 `missing_payload`, and
`add_evidence` refuses a photograph past `icms_max_photos_per_round` 422
`too_many_photos`. Enforcement came first; publication followed it.

Every test here sets the bound it is about rather than leaning on the default,
because the defaults are unconfirmed — 3 is a design value from the Figma
capture step and 5 is `maxPic` from the legacy field app — and a suite pinned to
either would fail the day ADA settles a different number. What is pinned is the
behaviour at whatever the setting says.

The rest of the suite stands the floor down through `no_photo_minimum`, so that
a test about a transition fails on the transition. This is the file that does not.
"""

from __future__ import annotations

from ada_core.models_icms import Evidence, Inspection
from sqlalchemy import func, select

from app.config import settings
from tests.conftest import JPEG_BYTES, NODAL, SURVEYOR
from tests.test_icms_evidence import PDF_BYTES, fields, jpeg, key
from tests.test_icms_reference import error_of

ICMS = "/api/icms"
# `inspection_loop` seeds round 1 of CMP-2026-0006 under_inspection, assigned to
# the Field Surveyor, holding exactly one photograph.
ROUND = "INS-2026-0001"
CASE = "CMP-2026-0006"
SEEDED_PHOTOS = 1
EVIDENCE = f"{ICMS}/inspections/{ROUND}/evidence"
SUBMIT = f"{ICMS}/inspections/{ROUND}/submit"
SUBMIT_KEY = "6f1d6dd9-8443-4b90-9a86-0f65c42b9001"


def add_photo(client, suffix: str):
    return client.post(EVIDENCE, data=fields(idempotency_key=key(suffix)), files=jpeg())


def add_document(client, suffix: str):
    return client.post(
        EVIDENCE,
        data=fields(kind="document", latitude=None, longitude=None, accuracy_m=None,
                    capture_source="upload", doc_type_cd="sanction_plan",
                    idempotency_key=key(suffix)),
        files={"file": ("plan.pdf", PDF_BYTES, "application/pdf")},
    )


def stored(db, kind: str = "photo") -> int:
    return int(db.execute(
        select(func.count()).select_from(Evidence)
        .where(
            Evidence.kind == kind,
            Evidence.inspection_id.in_(
                select(Inspection.id).where(Inspection.inspection_ref == ROUND)),
        )
    ).scalar_one())


class TestTheFloorOnSubmit:
    def test_a_round_short_of_the_minimum_is_refused(
        self, icms_client, inspection_loop, monkeypatch
    ):
        """The refusal reuses `missing_payload`: what the transition needs is not
        in the round. The message carries both numbers, so the surveyor is told
        how many more to take rather than only that they are short."""
        monkeypatch.setattr(settings, "icms_min_photos_per_round", 3)

        response = icms_client.sign_in(SURVEYOR).post(
            SUBMIT, json={"idempotency_key": SUBMIT_KEY})

        assert response.status_code == 422, response.text
        error = error_of(response)
        assert error["code"] == "missing_payload"
        assert error["field"] == "evidence"
        assert "1 photograph" in error["message"]
        assert "at least 3" in error["message"]

    def test_a_refused_submit_leaves_the_round_unsubmitted(
        self, icms_client, inspection_loop, monkeypatch
    ):
        """The count is asked before the state change, so a short round is not a
        round that half-submitted."""
        monkeypatch.setattr(settings, "icms_min_photos_per_round", 3)
        client = icms_client.sign_in(SURVEYOR)

        client.post(SUBMIT, json={"idempotency_key": SUBMIT_KEY})

        detail = client.get(f"{ICMS}/inspections/{ROUND}").json()
        assert detail["status"] == "in_progress"
        assert detail["submitted_at"] is None
        assert detail["case_status"] == "under_inspection"

    def test_a_refused_submit_writes_no_event(
        self, icms_client, inspection_loop, monkeypatch, events
    ):
        monkeypatch.setattr(settings, "icms_min_photos_per_round", 3)

        icms_client.sign_in(SURVEYOR).post(SUBMIT, json={"idempotency_key": SUBMIT_KEY})

        assert [row["action"] for row in events(inspection_loop[CASE].id)] == []

    def test_exactly_the_minimum_submits(
        self, icms_client, inspection_loop, monkeypatch
    ):
        """The bound is `< minimum` and not `<= minimum`: a round holding exactly
        what was asked for is a round that may be submitted."""
        monkeypatch.setattr(settings, "icms_min_photos_per_round", 3)
        client = icms_client.sign_in(SURVEYOR)
        assert add_photo(client, "101").status_code == 201
        assert add_photo(client, "102").status_code == 201

        response = client.post(SUBMIT, json={"idempotency_key": SUBMIT_KEY})

        assert response.status_code == 200, response.text
        assert response.json()["status"] == "submitted"

    def test_documents_do_not_count_towards_it(
        self, icms_client, inspection_loop, monkeypatch
    ):
        """A round carries documents and signatures too. Two sanction plans are
        not two photographs, and a count that said so would let a round be
        submitted with one photograph and a folder of paperwork."""
        monkeypatch.setattr(settings, "icms_min_photos_per_round", 3)
        client = icms_client.sign_in(SURVEYOR)
        assert add_document(client, "111").status_code == 201
        assert add_document(client, "112").status_code == 201

        response = client.post(SUBMIT, json={"idempotency_key": SUBMIT_KEY})

        assert response.status_code == 422
        assert "1 photograph" in error_of(response)["message"]

    def test_a_minimum_of_one_is_met_by_the_round_as_seeded(
        self, icms_client, inspection_loop, monkeypatch
    ):
        """The number is ADA's to set, downwards as well as up."""
        monkeypatch.setattr(settings, "icms_min_photos_per_round", SEEDED_PHOTOS)

        response = icms_client.sign_in(SURVEYOR).post(
            SUBMIT, json={"idempotency_key": SUBMIT_KEY})

        assert response.status_code == 200, response.text


class TestTheReplayStillAnswersItself:
    def test_a_submitted_round_replays_200_after_the_rule_changed_under_it(
        self, icms_client, inspection_loop, monkeypatch
    ):
        """The handset retries what it cannot tell landed, possibly days later and
        possibly after the district settled a higher number. The replay is
        answered by the round that was already submitted: the count is asked of a
        submit that is about to happen, never of one that already did.
        """
        monkeypatch.setattr(settings, "icms_min_photos_per_round", 1)
        client = icms_client.sign_in(SURVEYOR)
        first = client.post(SUBMIT, json={"idempotency_key": SUBMIT_KEY})
        assert first.status_code == 200, first.text

        monkeypatch.setattr(settings, "icms_min_photos_per_round", 9)
        second = client.post(SUBMIT, json={"idempotency_key": SUBMIT_KEY})

        assert second.status_code == 200, second.text
        assert second.json()["status"] == "submitted"
        assert second.json()["submitted_at"] == first.json()["submitted_at"]

    def test_the_replay_writes_no_second_event(
        self, icms_client, inspection_loop, monkeypatch, events
    ):
        monkeypatch.setattr(settings, "icms_min_photos_per_round", 1)
        client = icms_client.sign_in(SURVEYOR)
        client.post(SUBMIT, json={"idempotency_key": SUBMIT_KEY})
        monkeypatch.setattr(settings, "icms_min_photos_per_round", 9)
        client.post(SUBMIT, json={"idempotency_key": SUBMIT_KEY})

        actions = [row["action"] for row in events(inspection_loop[CASE].id)]
        assert actions == ["submit"]


class TestTheCeilingOnUpload:
    def test_a_photograph_past_the_maximum_is_refused(
        self, icms_client, inspection_loop, monkeypatch
    ):
        """The field app stops its capture flow at the maximum, so this is the
        backstop and not the everyday path — and it reads as an error."""
        monkeypatch.setattr(settings, "icms_max_photos_per_round", 2)
        client = icms_client.sign_in(SURVEYOR)
        assert add_photo(client, "201").status_code == 201

        response = add_photo(client, "202")

        assert response.status_code == 422, response.text
        error = error_of(response)
        assert error["code"] == "too_many_photos"
        assert error["field"] == "kind"

    def test_the_refusal_says_how_many_the_round_already_holds(
        self, icms_client, inspection_loop, monkeypatch
    ):
        """Evidence is append-only, so there is no way back under the ceiling and
        the only useful thing to say is what is already there."""
        monkeypatch.setattr(settings, "icms_max_photos_per_round", 2)
        client = icms_client.sign_in(SURVEYOR)
        add_photo(client, "203")

        response = add_photo(client, "204")

        assert "already holds 2 photographs" in error_of(response)["message"]

    def test_a_refused_upload_stores_nothing(
        self, icms_client, inspection_loop, monkeypatch, db
    ):
        """Refused before the bytes are taken: no row, and no half-written file
        for an operator to sweep."""
        monkeypatch.setattr(settings, "icms_max_photos_per_round", SEEDED_PHOTOS)
        before = stored(db)

        response = add_photo(icms_client.sign_in(SURVEYOR), "205")

        assert response.status_code == 422
        assert stored(db) == before
        assert list((settings.icms_evidence_dir / CASE).glob("*.part")) == []

    def test_exactly_the_maximum_is_accepted(
        self, icms_client, inspection_loop, monkeypatch
    ):
        """The bound is on what the round already holds, so the photograph that
        takes it to the ceiling is the last one in and not the first one out."""
        monkeypatch.setattr(settings, "icms_max_photos_per_round", 3)
        client = icms_client.sign_in(SURVEYOR)
        assert add_photo(client, "301").status_code == 201

        last = add_photo(client, "302")

        assert last.status_code == 201, last.text
        assert len(client.get(EVIDENCE).json()) == 3

    def test_a_document_is_not_a_photograph_at_the_ceiling_either(
        self, icms_client, inspection_loop, monkeypatch
    ):
        """A round full of photographs still takes the sanction plan it needs."""
        monkeypatch.setattr(settings, "icms_max_photos_per_round", SEEDED_PHOTOS)
        client = icms_client.sign_in(SURVEYOR)

        document = add_document(client, "311")

        assert document.status_code == 201, document.text
        assert add_photo(client, "312").status_code == 422

    def test_a_replayed_upload_still_returns_its_row_at_the_ceiling(
        self, icms_client, inspection_loop, monkeypatch
    ):
        """The retry that made the round full is the retry that must not be
        refused: the key already belongs to a row, and that row is the answer."""
        monkeypatch.setattr(settings, "icms_max_photos_per_round", 2)
        client = icms_client.sign_in(SURVEYOR)
        first = add_photo(client, "401")
        assert first.status_code == 201, first.text

        replay = add_photo(client, "401")

        assert replay.status_code == 200, replay.text
        assert replay.json()["id"] == first.json()["id"]

    def test_what_the_round_already_holds_survives_the_refusal(
        self, icms_client, inspection_loop, monkeypatch
    ):
        """A refusal is not a rollback of what was already accepted."""
        monkeypatch.setattr(settings, "icms_max_photos_per_round", 2)
        client = icms_client.sign_in(SURVEYOR)
        add_photo(client, "501")
        add_photo(client, "502")

        rows = icms_client.sign_in(NODAL).get(EVIDENCE).json()

        assert len(rows) == 2
        assert {row["kind"] for row in rows} == {"photo"}
        assert all(row["byte_size"] == len(JPEG_BYTES) for row in rows)
