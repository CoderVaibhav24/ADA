"""The Create Complaint screen's two additions: complaint_date and case evidence."""

from __future__ import annotations

from datetime import timedelta

import pytest
from ada_core.datetimes import now_ist

from tests.conftest import (
    JPEG_BYTES,
    LEAD,
    NODAL,
    NODAL_ID,
    SUPER_ADMIN,
    SUPER_ADMIN_ID,
    SURVEYOR,
    SURVEYOR_ID,
)
from tests.test_icms_reference import error_of

CASES = "/api/icms/cases"
RAISED = "CMP-2026-0001"      # TAJ, raised
ASSIGNED = "CMP-2026-0002"    # TAJ, assigned
RURAL = "CMP-2026-0004"       # RURAL, raised, visible to nobody but Super Admin
EVIDENCE = f"{CASES}/{RAISED}/evidence"

RAISE = {
    "source": "public",
    "zone_cd": "TAJ",
    "complainant_name": "Nisha Verma",
    "property_address": "88 Kamla Nagar",
}

PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + (1).to_bytes(4, "big")
    + (1).to_bytes(4, "big") + b"\x08\x02\x00\x00\x00" + b"\x00" * 4
    + b"\x00\x00\x00\x00IEND\xaeB`\x82"
)
_WEBP_BODY = (b"WEBP" + b"VP8L" + (5).to_bytes(4, "little") + b"\x2f"
              + (0).to_bytes(4, "little") + b"\x00")
WEBP_BYTES = b"RIFF" + len(_WEBP_BODY).to_bytes(4, "little") + _WEBP_BODY
HEIC_BYTES = b"\x00\x00\x00\x18ftypheic" + b"\x00" * 16
PDF_BYTES = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


def key(n: int) -> str:
    return f"6f1d6dd9-8443-4b90-9a86-0f65c42b{n:04d}"


def today() -> str:
    return now_ist().date().isoformat()


@pytest.fixture
def world(db, zones, assignments, cases, upload_policies, code_values):
    """The case fixtures, with the surveyor also holding TAJ."""
    from ada_core.models_icms import ZoneAssignment

    db.add(ZoneAssignment(zone_id=zones["TAJ"].id, user_id=SURVEYOR_ID,
                          assigned_by=SUPER_ADMIN_ID))
    db.commit()
    return cases


@pytest.fixture
def filing(db, zones):
    """Zones with the nodal officer holding TAJ and no cases, so the counter is fresh."""
    from ada_core.models_icms import ZoneAssignment

    db.add(ZoneAssignment(zone_id=zones["TAJ"].id, user_id=NODAL_ID,
                          assigned_by=SUPER_ADMIN_ID))
    db.commit()
    return zones


def upload(client, path: str = EVIDENCE, *, name: str = "front.jpg",
           data: bytes = JPEG_BYTES, content_type: str = "image/jpeg",
           form: dict | None = None, headers: dict | None = None):
    return client.post(path, data=form or {}, headers=headers or {},
                       files={"file": (name, data, content_type)})


# -------------------------------------------------------------- complaint_date
class TestComplaintDate:
    def test_absent_it_is_today_in_ist(self, icms_client, filing):
        body = icms_client.sign_in(NODAL).post(CASES, json=RAISE).json()

        assert body["complaint_date"] == today()

    def test_a_past_date_is_stored_and_returned(self, icms_client, filing):
        client = icms_client.sign_in(NODAL)
        created = client.post(CASES, json={**RAISE, "complaint_date": "2026-09-01"})

        assert created.status_code == 201, created.text
        ref = created.json()["case_ref"]
        assert created.json()["complaint_date"] == "2026-09-01"
        assert client.get(f"{CASES}/{ref}").json()["complaint_date"] == "2026-09-01"
        rows = client.get(CASES, params={"q": ref}).json()["items"]
        assert [row["complaint_date"] for row in rows] == ["2026-09-01"]

    def test_today_is_accepted(self, icms_client, filing):
        response = icms_client.sign_in(NODAL).post(
            CASES, json={**RAISE, "complaint_date": today()})

        assert response.status_code == 201

    @pytest.mark.parametrize("value", [
        (now_ist().date() + timedelta(days=1)).isoformat(),
        "1999-12-31",
        "not-a-date",
    ])
    def test_an_implausible_date_is_refused(self, icms_client, filing, value):
        response = icms_client.sign_in(NODAL).post(
            CASES, json={**RAISE, "complaint_date": value})

        assert response.status_code == 422
        error = error_of(response)
        assert error["code"] == "validation_failed"
        assert error["field"] == "complaint_date"

    def test_a_row_with_no_complaint_date_still_reads(self, icms_client, world, db):
        """A row the backfill has not reached renders null rather than failing."""
        from ada_core.models_icms import Case
        from sqlalchemy import update

        db.execute(update(Case).where(Case.case_ref == RAISED).values(complaint_date=None))
        db.commit()

        body = icms_client.sign_in(NODAL).get(f"{CASES}/{RAISED}").json()
        assert body["complaint_date"] is None


# ---------------------------------------------------------------- the upload
class TestUpload:
    def test_the_nodal_officer_attaches_a_photograph(self, icms_client, world):
        response = upload(icms_client.sign_in(NODAL),
                          form={"caption": "Front elevation",
                                "latitude": "27.005", "longitude": "78.005"})

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["replayed"] is False
        evidence = body["evidence"]
        assert set(evidence) == {"id", "filename", "content_type", "size_bytes", "caption",
                                 "latitude", "longitude", "created_at", "content_url"}
        assert evidence["filename"] == "front.jpg"
        assert evidence["content_type"] == "image/jpeg"
        assert evidence["size_bytes"] == len(JPEG_BYTES)
        assert evidence["caption"] == "Front elevation"
        assert (evidence["latitude"], evidence["longitude"]) == (27.005, 78.005)
        assert evidence["created_at"].endswith("+05:30")
        assert evidence["content_url"] == f"{EVIDENCE}/{evidence['id']}/content"

    def test_the_position_is_optional(self, icms_client, world):
        evidence = upload(icms_client.sign_in(LEAD)).json()["evidence"]

        assert (evidence["latitude"], evidence["longitude"]) == (None, None)
        assert evidence["caption"] is None

    def test_half_a_position_is_refused(self, icms_client, world):
        response = upload(icms_client.sign_in(NODAL), form={"latitude": "27.0"})

        assert response.status_code == 422

    @pytest.mark.parametrize("name,data,content_type", [
        ("front.png", PNG_BYTES, "image/png"),
        ("front.webp", WEBP_BYTES, "image/webp"),
    ])
    def test_png_and_webp_are_accepted(self, icms_client, world, name, data, content_type):
        response = upload(icms_client.sign_in(NODAL), name=name, data=data,
                          content_type=content_type)

        assert response.status_code == 201, response.text
        assert response.json()["evidence"]["content_type"] == content_type

    @pytest.mark.parametrize("name,data,content_type", [
        ("scan.pdf", PDF_BYTES, "application/pdf"),
        ("front.jpg", PDF_BYTES, "image/jpeg"),
        ("front.jpg", HEIC_BYTES, "image/jpeg"),
    ])
    def test_anything_but_jpeg_png_or_webp_is_refused(
        self, icms_client, world, name, data, content_type
    ):
        response = upload(icms_client.sign_in(NODAL), name=name, data=data,
                          content_type=content_type)

        assert response.status_code == 415
        assert error_of(response)["code"] in (
            "extension_not_allowed", "unsupported_media_type", "content_type_mismatch")

    def test_the_upload_writes_an_event(self, icms_client, world, events):
        upload(icms_client.sign_in(NODAL))

        trail = events(world[RAISED].id)
        assert trail[-1]["action"] == "add_evidence"
        assert (trail[-1]["from_status"], trail[-1]["to_status"]) == ("raised", "raised")

    def test_the_case_detail_counts_it(self, icms_client, world):
        client = icms_client.sign_in(NODAL)
        upload(client)

        assert client.get(f"{CASES}/{RAISED}").json()["evidence_count"] == 1


class TestIdempotency:
    def test_a_replay_is_200_and_the_same_row(self, icms_client, world):
        client = icms_client.sign_in(NODAL)
        first = upload(client, headers={"Idempotency-Key": key(1)})
        again = upload(client, headers={"Idempotency-Key": key(1)})

        assert first.status_code == 201
        assert again.status_code == 200
        assert again.json()["replayed"] is True
        assert again.json()["evidence"] == first.json()["evidence"]
        assert len(client.get(EVIDENCE).json()["items"]) == 1

    def test_without_a_key_two_posts_are_two_rows(self, icms_client, world):
        client = icms_client.sign_in(NODAL)
        upload(client)
        upload(client)

        assert len(client.get(EVIDENCE).json()["items"]) == 2

    def test_a_key_used_on_another_case_is_refused(self, icms_client, world, db):
        from ada_core.models_icms import Case
        from sqlalchemy import update

        db.execute(update(Case).where(Case.case_ref == ASSIGNED).values(status="raised"))
        db.commit()
        client = icms_client.sign_in(NODAL)
        upload(client, headers={"Idempotency-Key": key(2)})
        response = upload(client, f"{CASES}/{ASSIGNED}/evidence",
                          headers={"Idempotency-Key": key(2)})

        assert response.status_code == 409
        assert error_of(response)["code"] == "idempotency_key_reused"

    def test_a_malformed_key_is_refused(self, icms_client, world):
        response = upload(icms_client.sign_in(NODAL), headers={"Idempotency-Key": "abc"})

        assert response.status_code == 422


class TestLimits:
    def test_the_eleventh_photograph_is_refused(self, icms_client, world, monkeypatch):
        from app.config import settings

        assert settings.icms_max_photos_per_case == 10
        monkeypatch.setattr(settings, "icms_max_photos_per_case", 2)
        client = icms_client.sign_in(NODAL)
        assert upload(client).status_code == 201
        assert upload(client).status_code == 201

        response = upload(client)
        assert response.status_code == 422
        assert error_of(response)["code"] == "too_many_photos"
        assert len(client.get(EVIDENCE).json()["items"]) == 2

    def test_only_a_raised_case_takes_one(self, icms_client, world):
        response = upload(icms_client.sign_in(NODAL), f"{CASES}/{ASSIGNED}/evidence")

        assert response.status_code == 409
        assert error_of(response)["code"] == "invalid_transition"


class TestWhoMayUpload:
    def test_super_admin_holds_no_raise_and_is_refused(self, icms_client, world):
        response = upload(icms_client.sign_in(SUPER_ADMIN))

        assert response.status_code == 403
        assert error_of(response)["code"] == "role_not_permitted"

    def test_a_surveyor_in_the_zone_may_attach(self, icms_client, world):
        assert upload(icms_client.sign_in(SURVEYOR)).status_code == 201

    def test_a_case_outside_the_callers_zones_is_404(self, icms_client, world):
        response = upload(icms_client.sign_in(NODAL), f"{CASES}/{RURAL}/evidence")

        assert response.status_code == 404
        assert error_of(response)["code"] == "case_not_found"

    def test_no_token_is_401(self, anonymous_client, world):
        response = upload(anonymous_client)

        assert response.status_code == 401


# ----------------------------------------------------------------- the reads
class TestReads:
    def test_the_list_and_the_bytes(self, icms_client, world):
        client = icms_client.sign_in(NODAL)
        created = upload(client, form={"caption": "Rear wall"}).json()["evidence"]

        listed = client.get(EVIDENCE)
        assert listed.status_code == 200
        assert listed.json() == {"items": [created]}

        content = client.get(created["content_url"])
        assert content.status_code == 200
        assert content.content == JPEG_BYTES
        assert content.headers["content-type"] == "image/jpeg"
        assert content.headers["content-disposition"].startswith("inline")
        assert content.headers["x-content-type-options"] == "nosniff"

    def test_an_empty_case_lists_nothing(self, icms_client, world):
        assert icms_client.sign_in(NODAL).get(EVIDENCE).json() == {"items": []}

    def test_super_admin_reads_every_zone(self, icms_client, world, db):
        from ada_core.models_icms import ZoneAssignment

        db.add(ZoneAssignment(zone_id=world[RURAL].zone_id, user_id=NODAL_ID,
                              assigned_by=SUPER_ADMIN_ID))
        db.commit()
        created = upload(icms_client.sign_in(NODAL), f"{CASES}/{RURAL}/evidence").json()

        admin = icms_client.sign_in(SUPER_ADMIN)
        assert admin.get(f"{CASES}/{RURAL}/evidence").json()["items"] == [created["evidence"]]
        assert admin.get(created["evidence"]["content_url"]).status_code == 200

    def test_a_case_outside_the_callers_zones_is_404(self, icms_client, world):
        response = icms_client.sign_in(NODAL).get(f"{CASES}/{RURAL}/evidence")

        assert response.status_code == 404
        assert error_of(response)["code"] == "case_not_found"

    def test_a_surveyor_reads_only_cases_assigned_to_them(self, icms_client, world):
        """The detail route's narrowing, applied the same way: TAJ is in the
        surveyor's zones, but CMP-2026-0001 is nobody's assignment."""
        created = upload(icms_client.sign_in(NODAL)).json()["evidence"]
        surveyor = icms_client.sign_in(SURVEYOR)

        assert surveyor.get(f"{CASES}/{RAISED}").status_code == 404
        assert surveyor.get(EVIDENCE).status_code == 404
        assert surveyor.get(created["content_url"]).status_code == 404

    def test_evidence_of_another_case_is_not_served_through_this_one(
        self, icms_client, world, db
    ):
        from ada_core.models_icms import Case
        from sqlalchemy import update

        db.execute(update(Case).where(Case.case_ref == ASSIGNED).values(status="raised"))
        db.commit()
        client = icms_client.sign_in(NODAL)
        other = upload(client, f"{CASES}/{ASSIGNED}/evidence").json()["evidence"]

        response = client.get(f"{EVIDENCE}/{other['id']}/content")
        assert response.status_code == 404
        assert error_of(response)["code"] == "evidence_not_found"

    def test_inspection_evidence_is_not_listed_as_case_evidence(
        self, icms_client, contract_world
    ):
        client = icms_client.sign_in(NODAL)
        items = client.get(f"{CASES}/CMP-2026-0006/evidence").json()["items"]

        assert [item["id"] for item in items] == [2]
        assert client.get(f"{CASES}/CMP-2026-0006/evidence/1/content").status_code == 404

    def test_no_token_is_401(self, anonymous_client, world):
        assert anonymous_client.get(EVIDENCE).status_code == 401
        assert anonymous_client.get(f"{EVIDENCE}/1/content").status_code == 401
