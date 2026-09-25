"""Evidence: what may be uploaded, how it is flagged, and who may read it back.

Four properties, and none of them is the happy path.

**The geo-tag gate.** A photograph is evidence of a place and a time, so it
arrives with its position, accuracy, device clock and capture source or it is
refused — `icms_evidence_geotag_ck` says the same thing in the database, and an
API that let one past would be relying on an IntegrityError to say so. Anything
whose position is missing or worse than `icms_accuracy_flag_m` is stored
`geotag_flagged`; what cannot happen is a capture with no fix quietly becoming
geo-tagged evidence. Nothing here is refused for accuracy alone — that is the
check-in's gate, `icms_accuracy_gate_m`, and it is the wider of the two.

**Append-only.** No update route and no delete route, in this batch or a later
one — asserted against the mounted schema rather than promised in a comment.

**Idempotent.** The handset retries an upload it cannot tell landed and gets
back the row the first attempt wrote.

**Read under the same zone scope as everything else.** The file is served by
this API rather than from a bucket URL, because a link that works for anybody
holding it is not a link this system can issue.
"""

from __future__ import annotations

import pytest
from ada_core.datetimes import now_ist

from tests.conftest import (
    JPEG_BYTES,
    LEAD,
    NODAL,
    SUPER_ADMIN,
    SURVEYOR,
    SURVEYOR_B_ID,
    SURVEYOR_ID,
)
from tests.test_icms_reference import error_of

ICMS = "/api/icms"
# Seeded by `inspection_world`: round 1 of CMP-2026-0006, which is
# under_inspection and whose surveyor is the Field Surveyor.
ROUND = "INS-2026-0001"
EVIDENCE = f"{ICMS}/inspections/{ROUND}/evidence"

PDF_BYTES = b"%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n"


def key(suffix: str) -> str:
    return f"6f1d6dd9-8443-4b90-9a86-0f65c42b5{suffix}"


def fields(**overrides) -> dict:
    body = {
        "kind": "photo", "latitude": "27.005", "longitude": "78.005",
        "accuracy_m": "6.5", "device_timestamp": now_ist().isoformat(),
        "capture_source": "camera", "idempotency_key": key("001"),
    }
    body.update(overrides)
    return {name: value for name, value in body.items() if value is not None}


def jpeg(name: str = "front.jpg") -> dict:
    return {"file": (name, JPEG_BYTES, "image/jpeg")}


def upload(client, *, form: dict | None = None, files: dict | None = None,
           path: str = EVIDENCE):
    return client.post(path, data=form if form is not None else fields(),
                       files=files or jpeg())


class TestUpload:
    def test_the_assignee_uploads_a_photograph(self, icms_client, inspection_loop):
        response = upload(icms_client.sign_in(SURVEYOR))

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["kind"] == "photo"
        assert body["case_ref"] == "CMP-2026-0006"
        assert body["inspection_ref"] == ROUND
        assert body["round_no"] == 1
        assert body["uploaded_by"] == SURVEYOR_ID
        assert body["original_filename"] == "front.jpg"
        assert body["byte_size"] == len(JPEG_BYTES)
        assert body["geotag_flagged"] is False

    def test_the_content_type_comes_from_the_bytes_and_not_from_the_client(
        self, icms_client, inspection_loop
    ):
        """The handset's Content-Type is a claim; the magic bytes are the file."""
        response = upload(icms_client.sign_in(SURVEYOR))

        assert response.json()["content_type"] == "image/jpeg"

    def test_the_file_lands_where_the_row_says_it_did(
        self, icms_client, inspection_loop, db
    ):
        from ada_core.models_icms import Evidence
        from sqlalchemy import select

        from app.config import settings

        body = upload(icms_client.sign_in(SURVEYOR)).json()
        stored = db.execute(
            select(Evidence.storage_path).where(Evidence.id == body["id"])
        ).scalar_one()

        path = settings.icms_evidence_dir / stored
        assert path.is_file()
        assert path.read_bytes() == JPEG_BYTES
        # Content-addressed, so the same bytes twice are one file and two rows.
        assert body["sha256"] in stored

    def test_uploading_writes_its_event(self, icms_client, inspection_loop, events, db):
        from ada_core.models_icms import Case
        from sqlalchemy import select

        case_id = db.execute(
            select(Case.id).where(Case.case_ref == "CMP-2026-0006")).scalar_one()
        upload(icms_client.sign_in(SURVEYOR))

        trail = events(case_id)
        assert trail[-1]["action"] == "add_evidence"
        assert (trail[-1]["from_status"], trail[-1]["to_status"]) == (
            "under_inspection", "under_inspection")
        assert trail[-1]["round_no"] == 1

    def test_a_file_whose_contents_are_not_what_it_claims_is_refused(
        self, icms_client, inspection_loop
    ):
        """A .jpg carrying a PDF is a client that is lying or broken."""
        response = upload(
            icms_client.sign_in(SURVEYOR),
            files={"file": ("front.jpg", PDF_BYTES, "image/jpeg")})

        assert response.status_code == 415
        assert error_of(response)["code"] in (
            "unsupported_media_type", "content_type_mismatch")

    def test_an_extension_the_policy_does_not_allow_is_refused(
        self, icms_client, inspection_loop
    ):
        response = upload(icms_client.sign_in(SURVEYOR), files=jpeg("front.exe"))

        assert response.status_code == 415
        assert error_of(response)["code"] == "extension_not_allowed"

    def test_a_document_is_accepted_under_its_own_policy(
        self, icms_client, inspection_loop
    ):
        response = upload(
            icms_client.sign_in(SURVEYOR),
            form=fields(kind="document", latitude=None, longitude=None,
                        accuracy_m=None, capture_source="upload",
                        doc_type_cd="sanction_plan"),
            files={"file": ("plan.pdf", PDF_BYTES, "application/pdf")})

        assert response.status_code == 201, response.text
        assert response.json()["doc_type_cd"] == "sanction_plan"

    def test_a_kind_with_no_active_policy_rejects_everything(
        self, icms_client, inspection_loop, upload_policies, db
    ):
        """An inactive or absent kind refuses every file rather than falling back
        to something permissive."""
        upload_policies["photo"].active = False
        db.commit()

        response = upload(icms_client.sign_in(SURVEYOR))

        assert response.status_code == 400
        assert error_of(response)["code"] == "unknown_upload_kind"

    def test_a_file_over_the_size_limit_is_refused(
        self, icms_client, inspection_loop, upload_policies, db
    ):
        upload_policies["photo"].max_bytes = 8
        db.commit()

        response = upload(icms_client.sign_in(SURVEYOR))

        assert response.status_code == 413
        assert error_of(response)["code"] == "payload_too_large"

    def test_a_refused_upload_leaves_no_row(self, icms_client, inspection_loop,
                                            upload_policies, db):
        from ada_core.models_icms import Evidence
        from sqlalchemy import func, select

        upload_policies["photo"].max_bytes = 8
        db.commit()
        before = db.execute(select(func.count()).select_from(Evidence)).scalar_one()
        upload(icms_client.sign_in(SURVEYOR))

        assert db.execute(
            select(func.count()).select_from(Evidence)).scalar_one() == before

    def test_an_unknown_kind_is_refused_by_the_request_model(
        self, icms_client, inspection_loop
    ):
        response = upload(icms_client.sign_in(SURVEYOR), form=fields(kind="hearsay"))

        assert response.status_code == 422

    def test_an_unknown_inspection_is_a_404(self, icms_client, inspection_loop):
        response = upload(
            icms_client.sign_in(SURVEYOR),
            path=f"{ICMS}/inspections/INS-2026-9999/evidence")

        assert response.status_code == 404
        assert error_of(response)["code"] == "inspection_not_found"


class TestTheGeoTagGate:
    def test_a_photograph_with_no_position_is_refused(self, icms_client, inspection_loop):
        """The one thing that cannot happen: a capture with no fix becoming
        geo-tagged evidence. The database says so too, on a CHECK constraint."""
        response = upload(
            icms_client.sign_in(SURVEYOR),
            form=fields(latitude=None, longitude=None))

        assert response.status_code == 422
        error = error_of(response)
        assert error["code"] == "geotag_required"
        assert "latitude" in (error["allowed"] or [])

    def test_a_photograph_with_no_device_clock_is_refused(
        self, icms_client, inspection_loop
    ):
        response = upload(
            icms_client.sign_in(SURVEYOR), form=fields(device_timestamp=None))

        assert response.status_code == 422
        assert error_of(response)["code"] == "geotag_required"

    def test_half_a_position_is_refused_before_anything_else(
        self, icms_client, inspection_loop
    ):
        response = upload(icms_client.sign_in(SURVEYOR), form=fields(longitude=None))

        assert response.status_code == 422

    def test_a_poor_fix_is_stored_flagged_rather_than_refused(
        self, icms_client, inspection_loop
    ):
        """Not refused: the photograph is still worth having. Flagged, so nobody
        reading the file later mistakes it for a position anybody stood at."""
        response = upload(icms_client.sign_in(SURVEYOR), form=fields(accuracy_m="900"))

        assert response.status_code == 201, response.text
        assert response.json()["geotag_flagged"] is True

    def test_a_document_with_no_position_is_stored_flagged(
        self, icms_client, inspection_loop
    ):
        """A sanction plan has no GPS fix and never will. It is evidence; it is
        simply not geo-tagged evidence."""
        response = upload(
            icms_client.sign_in(SURVEYOR),
            form=fields(kind="document", latitude=None, longitude=None,
                        accuracy_m=None, capture_source="upload"),
            files={"file": ("plan.pdf", PDF_BYTES, "application/pdf")})

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["geotag_flagged"] is True
        assert (body["lat"], body["lon"]) == (None, None)

    def test_a_fix_the_gate_admits_and_the_flag_distrusts(
        self, icms_client, inspection_loop
    ):
        """The point of two numbers rather than one.

        30 m is the fix a handset gives standing against the wall being
        inspected. The gate lets the surveyor work there; the flag says the
        photograph taken from that spot is not a position anybody can swear to.
        """
        from app.config import settings

        assert settings.icms_accuracy_flag_m < 30 < settings.icms_accuracy_gate_m

        client = icms_client.sign_in(SURVEYOR)
        checked_in = client.post(
            f"{ICMS}/inspections/{ROUND}/check-in",
            json={"latitude": 27.005, "longitude": 78.005, "accuracy_m": 30.0,
                  "device_timestamp": now_ist().isoformat(),
                  "capture_source": "gps", "idempotency_key": key("0c1")})
        photograph = upload(client, form=fields(accuracy_m="30"))

        assert checked_in.status_code == 201, checked_in.text
        assert photograph.status_code == 201, photograph.text
        assert photograph.json()["geotag_flagged"] is True

    def test_the_flag_follows_its_own_setting(
        self, icms_client, inspection_loop, monkeypatch
    ):
        """The flag reads `icms_accuracy_flag_m`, not a literal and not the gate
        — ADA has fixed neither number, and the two move independently."""
        from app.config import settings

        monkeypatch.setattr(settings, "icms_accuracy_flag_m", 1000.0)
        response = upload(icms_client.sign_in(SURVEYOR), form=fields(accuracy_m="900"))

        assert response.json()["geotag_flagged"] is False

    def test_the_flag_is_recomputed_on_the_way_out(
        self, icms_client, inspection_loop, monkeypatch
    ):
        """A flag tightened afterwards re-flags what no longer meets it, because
        the flag is derived from the stored accuracy rather than frozen into a
        column the schema does not have."""
        from app.config import settings

        body = upload(icms_client.sign_in(SURVEYOR), form=fields(accuracy_m="12")).json()
        assert body["geotag_flagged"] is False

        monkeypatch.setattr(settings, "icms_accuracy_flag_m", 10.0)
        again = icms_client.sign_in(SURVEYOR).get(EVIDENCE).json()

        assert [row["geotag_flagged"] for row in again if row["id"] == body["id"]] == [True]


class TestIdempotentReplay:
    def test_a_replay_returns_the_first_row(self, icms_client, inspection_loop):
        client = icms_client.sign_in(SURVEYOR)
        first = upload(client)
        second = upload(client)

        assert (first.status_code, second.status_code) == (201, 200)
        assert first.json()["id"] == second.json()["id"]
        assert first.json()["uploaded_at"] == second.json()["uploaded_at"]

    def test_a_replay_creates_no_second_row_and_no_second_event(
        self, icms_client, inspection_loop, db
    ):
        from ada_core.models_icms import CaseEvent, Evidence
        from sqlalchemy import func, select

        client = icms_client.sign_in(SURVEYOR)
        before = db.execute(select(func.count()).select_from(Evidence)).scalar_one()
        upload(client)
        upload(client)

        assert db.execute(
            select(func.count()).select_from(Evidence)).scalar_one() == before + 1
        assert db.execute(
            select(func.count()).select_from(CaseEvent)
            .where(CaseEvent.action == "add_evidence")).scalar_one() == 1

    def test_a_different_key_is_a_different_photograph(self, icms_client,
                                                       inspection_loop):
        client = icms_client.sign_in(SURVEYOR)
        first = upload(client)
        second = upload(client, form=fields(idempotency_key=key("002")))

        assert second.status_code == 201
        assert first.json()["id"] != second.json()["id"]

    def test_a_key_already_used_on_another_round_is_a_409(
        self, icms_client, inspection_loop
    ):
        """The column is unique across the table, so the alternative is handing
        back another round's photograph under this round's reference."""
        client = icms_client.sign_in(SURVEYOR)
        upload(client)
        elsewhere = icms_client.sign_in(NODAL).post(
            f"{ICMS}/cases/CMP-2026-0002/inspections",
            json={"surveyor_user_id": SURVEYOR_ID})
        assert elsewhere.status_code == 201, elsewhere.text

        response = upload(
            icms_client.sign_in(SURVEYOR),
            path=f"{ICMS}/inspections/{elsewhere.json()['inspection_ref']}/evidence")

        assert response.status_code == 409
        assert error_of(response)["code"] == "idempotency_key_reused"

    def test_a_key_that_is_not_a_uuid_is_refused(self, icms_client, inspection_loop):
        response = upload(icms_client.sign_in(SURVEYOR),
                          form=fields(idempotency_key="retry-1"))

        assert response.status_code == 422


class TestAppendOnly:
    def test_there_is_no_update_or_delete_route_for_evidence(self, icms_client):
        """Asserted against the mounted schema rather than promised in a comment.

        Evidence is the record of what a surveyor saw on a day. A route that
        could rewrite or remove it is a route that makes every other photograph
        arguable too; a re-survey adds a round instead.
        """
        schema = icms_client.sign_in(SUPER_ADMIN).get("/api/openapi.json").json()
        mutations = {
            f"{method.upper()} {path}"
            for path, operations in schema["paths"].items()
            if "evidence" in path
            for method in operations
            if method in ("put", "patch", "delete")
        }

        assert mutations == set()

    def test_a_second_round_adds_rather_than_replaces(self, icms_client, inspection_loop):
        """Round 1's evidence is still round 1's after round 2 exists."""
        client = icms_client.sign_in(SURVEYOR)
        upload(client)
        client.post(f"{ICMS}/inspections/{ROUND}/submit",
                    json={"idempotency_key": key("003")})
        nodal = icms_client.sign_in(NODAL)
        nodal.post(f"{ICMS}/inspections/{ROUND}/verify",
                   json={"decision": "reject",
                         "reason": "The rear elevation was not photographed."})
        opened = nodal.post(f"{ICMS}/cases/CMP-2026-0006/inspections",
                            json={"surveyor_user_id": SURVEYOR_ID})
        assert opened.status_code == 201, opened.text

        round_one = icms_client.sign_in(SURVEYOR).get(EVIDENCE).json()
        round_two = icms_client.sign_in(SURVEYOR).get(
            f"{ICMS}/inspections/{opened.json()['inspection_ref']}/evidence").json()

        assert len(round_one) == 2
        assert round_two == []


class TestTheDownload:
    def test_the_bytes_come_back_as_an_attachment(self, icms_client, inspection_loop):
        body = upload(icms_client.sign_in(SURVEYOR)).json()

        response = icms_client.sign_in(NODAL).get(body["content_url"])

        assert response.status_code == 200
        assert response.content == JPEG_BYTES
        assert response.headers["content-disposition"].startswith("attachment")
        assert "front.jpg" in response.headers["content-disposition"]

    def test_the_content_url_in_the_payload_is_the_one_that_works(
        self, icms_client, inspection_loop
    ):
        body = upload(icms_client.sign_in(SURVEYOR)).json()

        assert body["content_url"] == f"/api/icms/evidence/{body['id']}/content"
        assert icms_client.sign_in(NODAL).get(body["content_url"]).status_code == 200

    def test_every_icms_role_may_read_evidence(self, icms_client, inspection_loop):
        """`evidence.read` is granted to all four. A verifier who cannot see the
        photograph cannot verify anything."""
        body = upload(icms_client.sign_in(SURVEYOR)).json()

        for role in (SUPER_ADMIN, NODAL, SURVEYOR, LEAD):
            response = icms_client.sign_in(role).get(body["content_url"])
            assert response.status_code == 200, f"{role} could not read the evidence"

    def test_evidence_outside_the_callers_zones_is_a_404(
        self, icms_client, inspection_world
    ):
        """Without `inspection_loop` the surveyor sees CANT alone, and the seeded
        evidence is in TAJ. Indistinguishable from absent, as everywhere else."""
        hidden = icms_client.sign_in(SURVEYOR).get(f"{ICMS}/evidence/1/content")
        missing = icms_client.sign_in(SURVEYOR).get(f"{ICMS}/evidence/9999/content")

        assert hidden.status_code == missing.status_code == 404
        assert error_of(hidden)["code"] == error_of(missing)["code"]

    def test_a_record_whose_file_is_gone_says_so(self, icms_client, inspection_loop, db):
        """404 with its own code rather than a 500: the row is the record, and the
        operator needs to know which of the two went missing."""
        from ada_core.models_icms import Evidence
        from sqlalchemy import select

        from app.config import settings

        body = upload(icms_client.sign_in(SURVEYOR)).json()
        stored = db.execute(
            select(Evidence.storage_path).where(Evidence.id == body["id"])
        ).scalar_one()
        (settings.icms_evidence_dir / stored).unlink()

        response = icms_client.sign_in(NODAL).get(body["content_url"])

        assert response.status_code == 404
        assert error_of(response)["code"] == "evidence_content_missing"

    def test_no_token_is_refused(self, anonymous_client, inspection_loop):
        assert anonymous_client.get(f"{ICMS}/evidence/1/content").status_code == 401


class TestASurveyorReadsOnlyTheirOwnRounds:
    """`evidence.read` is a role's permission, not sight of every round in a zone.

    The register already narrows a plain Field Surveyor to their own rounds. The
    by-reference reads did not, so the work list hid a colleague's round and
    `GET /inspections/{ref}/evidence` handed over its geo-located site
    photographs — which are the strongest thing in an enforcement record.

    Both surveyors can see TAJ here, deliberately: the claim is about the round,
    not about the zone, and a test where the zone did the work would prove
    nothing. 404 rather than 403 throughout, which is this module's convention
    for a record outside the caller's authority.
    """

    @pytest.fixture
    def colleagues_round(self, icms_client, inspection_loop):
        """A round on CMP-2026-0002 belonging to surveyor B, with a photograph."""
        from tests.test_icms_inspections import open_round

        ref = open_round(icms_client, "CMP-2026-0002", SURVEYOR_B_ID)
        photograph = upload(
            icms_client.sign_in(SURVEYOR, subject=SURVEYOR_B_ID),
            form=fields(idempotency_key=key("777")),
            path=f"{ICMS}/inspections/{ref}/evidence",
        )
        assert photograph.status_code == 201, photograph.text[:300]
        return ref, photograph.json()

    def test_a_surveyor_cannot_list_a_colleagues_evidence(
        self, icms_client, colleagues_round
    ):
        ref, _ = colleagues_round

        response = icms_client.sign_in(SURVEYOR).get(
            f"{ICMS}/inspections/{ref}/evidence")

        assert response.status_code == 404
        assert error_of(response)["code"] == "inspection_not_found"

    def test_the_surveyor_whose_round_it_is_lists_it(self, icms_client, colleagues_round):
        ref, photograph = colleagues_round

        response = icms_client.sign_in(SURVEYOR, subject=SURVEYOR_B_ID).get(
            f"{ICMS}/inspections/{ref}/evidence")

        assert response.status_code == 200, response.text[:300]
        assert [row["id"] for row in response.json()] == [photograph["id"]]

    def test_a_nodal_officer_lists_any_round_in_their_zones(
        self, icms_client, colleagues_round
    ):
        """Supervision is the whole job. The narrowing is the plain surveyor's."""
        ref, _ = colleagues_round

        response = icms_client.sign_in(NODAL).get(f"{ICMS}/inspections/{ref}/evidence")

        assert response.status_code == 200, response.text[:300]

    def test_a_surveyor_cannot_download_a_colleagues_photograph(
        self, icms_client, colleagues_round
    ):
        """The one that matters most: the bytes, not the metadata."""
        _, photograph = colleagues_round

        response = icms_client.sign_in(SURVEYOR).get(photograph["content_url"])

        assert response.status_code == 404
        assert error_of(response)["code"] == "evidence_not_found"

    def test_the_surveyor_whose_photograph_it_is_downloads_it(
        self, icms_client, colleagues_round
    ):
        _, photograph = colleagues_round

        response = icms_client.sign_in(SURVEYOR, subject=SURVEYOR_B_ID).get(
            photograph["content_url"])

        assert response.status_code == 200, response.text[:300]
        assert response.content == JPEG_BYTES

    @pytest.mark.parametrize("role", (SUPER_ADMIN, NODAL, LEAD))
    def test_every_supervisory_role_still_downloads_it(
        self, icms_client, colleagues_round, role
    ):
        _, photograph = colleagues_round

        assert icms_client.sign_in(role).get(
            photograph["content_url"]).status_code == 200, role

    def test_a_hidden_round_is_indistinguishable_from_one_that_does_not_exist(
        self, icms_client, colleagues_round
    ):
        """Otherwise the 404 tells a surveyor which references their colleagues
        are working on, which is the leak in a smaller form."""
        ref, _ = colleagues_round
        client = icms_client.sign_in(SURVEYOR)

        hidden = client.get(f"{ICMS}/inspections/{ref}")
        missing = client.get(f"{ICMS}/inspections/INS-2026-9999")

        assert hidden.status_code == missing.status_code == 404
        assert error_of(hidden)["code"] == error_of(missing)["code"]
        assert error_of(hidden)["field"] == error_of(missing)["field"] is None


class TestTheRoundGallery:
    def test_the_list_is_oldest_first(self, icms_client, inspection_loop):
        client = icms_client.sign_in(SURVEYOR)
        first = upload(client).json()
        second = upload(client, form=fields(idempotency_key=key("002"))).json()

        rows = client.get(EVIDENCE).json()
        assert [row["id"] for row in rows] == [1, first["id"], second["id"]]

    def test_the_gallery_carries_the_flag_the_portal_draws(
        self, icms_client, inspection_loop
    ):
        upload(icms_client.sign_in(SURVEYOR), form=fields(accuracy_m="900"))

        rows = icms_client.sign_in(NODAL).get(EVIDENCE).json()
        assert any(row["geotag_flagged"] for row in rows)

    def test_an_unknown_round_is_a_404(self, icms_client, inspection_loop):
        response = icms_client.sign_in(NODAL).get(
            f"{ICMS}/inspections/INS-2026-9999/evidence")

        assert response.status_code == 404

    def test_no_token_is_refused(self, anonymous_client, inspection_loop):
        assert anonymous_client.get(EVIDENCE).status_code == 401


def gps_jpeg(lat: float | None = None, lon: float | None = None) -> bytes:
    """A real, decodable JPEG, with an EXIF GPS IFD when a position is given."""
    import io
    from fractions import Fraction

    from PIL import Image

    def dms(value: float):
        value = abs(value)
        degrees = int(value)
        minutes = int((value - degrees) * 60)
        seconds = Fraction((value - degrees - minutes / 60) * 3600).limit_denominator(10000)
        return (Fraction(degrees), Fraction(minutes), seconds)

    image = Image.new("RGB", (320, 240), (90, 120, 150))
    exif = Image.Exif()
    if lat is not None and lon is not None:
        exif[0x8825] = {
            1: "N" if lat >= 0 else "S", 2: dms(lat),
            3: "E" if lon >= 0 else "W", 4: dms(lon),
        }
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", exif=exif)
    return buffer.getvalue()


def photo(data: bytes) -> dict:
    return {"file": ("site.jpg", data, "image/jpeg")}


def stored_row(db, evidence_id: int):
    from ada_core.models_icms import Evidence
    from sqlalchemy import select

    return db.execute(select(Evidence).where(Evidence.id == evidence_id)).scalar_one()


class TestLocationStamp:
    def test_exif_gps_is_read_back(self, tmp_path):
        from app.icms.evidence_stamp import exif_gps

        path = tmp_path / "gps.jpg"
        path.write_bytes(gps_jpeg(27.005, 78.005))
        lat, lon = exif_gps(path)

        assert lat == pytest.approx(27.005, abs=1e-6)
        assert lon == pytest.approx(78.005, abs=1e-6)

    def test_southern_and_western_references_are_negative(self, tmp_path):
        from app.icms.evidence_stamp import exif_gps

        path = tmp_path / "sw.jpg"
        path.write_bytes(gps_jpeg(-33.86, -70.65))

        assert exif_gps(path) == (pytest.approx(-33.86, abs=1e-6),
                                  pytest.approx(-70.65, abs=1e-6))

    def test_a_matching_exif_fix_is_not_flagged(self, icms_client, inspection_loop, db):
        response = upload(icms_client.sign_in(SURVEYOR), files=photo(gps_jpeg(27.005, 78.005)))

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["geotag_flagged"] is False
        assert body["exif_lat"] == pytest.approx(27.005, abs=1e-6)
        assert stored_row(db, body["id"]).geotag_flagged is False

    def test_a_photo_with_no_exif_gps_is_flagged(self, icms_client, inspection_loop, db):
        body = upload(icms_client.sign_in(SURVEYOR), files=photo(gps_jpeg())).json()

        assert body["geotag_flagged"] is True
        assert (body["exif_lat"], body["exif_lon"]) == (None, None)
        assert stored_row(db, body["id"]).geotag_flagged is True

    def test_exif_more_than_25_m_off_is_flagged(self, icms_client, inspection_loop, db):
        # 0.0005° of latitude is about 55 m.
        body = upload(icms_client.sign_in(SURVEYOR),
                      files=photo(gps_jpeg(27.0055, 78.005))).json()

        assert body["geotag_flagged"] is True
        assert stored_row(db, body["id"]).geotag_flagged is True

    def test_the_event_carries_the_same_flag(self, icms_client, inspection_loop, events, db):
        from ada_core.models_icms import Case
        from sqlalchemy import select

        upload(icms_client.sign_in(SURVEYOR), files=photo(gps_jpeg()))
        case_id = db.execute(
            select(Case.id).where(Case.case_ref == "CMP-2026-0006")).scalar_one()

        assert events(case_id)[-1]["payload"]["geotag_flagged"] is True

    def test_a_stamped_copy_is_stored_and_the_original_is_untouched(
        self, icms_client, inspection_loop, db
    ):
        import hashlib

        from app.config import settings

        original = gps_jpeg(27.005, 78.005)
        client = icms_client.sign_in(SURVEYOR)
        body = upload(client, files=photo(original)).json()
        row = stored_row(db, body["id"])

        assert body["sha256"] == hashlib.sha256(original).hexdigest()
        assert (settings.icms_evidence_dir / row.storage_path).read_bytes() == original
        stamped = settings.icms_evidence_dir / row.stamped_storage_key
        assert stamped.is_file()
        assert stamped.read_bytes() != original

        assert body["stamped_url"] == f"{ICMS}/evidence/{body['id']}/stamped"
        download = client.get(body["stamped_url"])
        assert download.status_code == 200
        assert download.headers["content-type"] == "image/jpeg"
        assert download.content == stamped.read_bytes()

        import io

        from PIL import Image
        width, height = Image.open(io.BytesIO(download.content)).size
        assert width == 320 and height > 240

    def test_an_undecodable_photo_has_no_stamp_and_still_lands(
        self, icms_client, inspection_loop
    ):
        client = icms_client.sign_in(SURVEYOR)
        body = upload(client).json()

        assert body["stamped_url"] is None
        missing = client.get(f"{ICMS}/evidence/{body['id']}/stamped")
        assert missing.status_code == 404
        assert error_of(missing)["code"] == "evidence_not_stamped"

    def test_a_stamp_failure_never_fails_the_upload(
        self, icms_client, inspection_loop, monkeypatch
    ):
        from app.icms import inspections

        def boom(*args, **kwargs):
            raise OSError("disk full")

        monkeypatch.setattr(inspections, "write_stamped", boom)
        response = upload(icms_client.sign_in(SURVEYOR), files=photo(gps_jpeg(27.005, 78.005)))

        assert response.status_code == 201, response.text
        assert response.json()["stamped_url"] is None

    def test_distance_to_site_is_measured_from_the_case_point(
        self, icms_client, inspection_loop, db
    ):
        import json

        from ada_core.models_icms import Case
        from sqlalchemy import update

        db.execute(update(Case).where(Case.case_ref == "CMP-2026-0006").values(
            location=json.dumps({"type": "Point", "coordinates": [78.005, 27.0055]})))
        db.commit()

        body = upload(icms_client.sign_in(SURVEYOR),
                      files=photo(gps_jpeg(27.005, 78.005))).json()

        assert body["distance_to_site_m"] == pytest.approx(55.6, abs=0.5)

    def test_no_case_point_means_no_distance(self, icms_client, inspection_loop):
        body = upload(icms_client.sign_in(SURVEYOR),
                      files=photo(gps_jpeg(27.005, 78.005))).json()

        assert body["distance_to_site_m"] is None


def sideways_jpeg(fmt: str = "JPEG", lat: float = 27.005, lon: float = 78.005) -> bytes:
    """An iPhone-style capture: landscape pixels, red left half, Orientation 6, GPS."""
    import io
    from fractions import Fraction

    from PIL import Image, ImageDraw

    if fmt == "HEIF":
        import pillow_heif
        pillow_heif.register_heif_opener()
    image = Image.new("RGB", (320, 240), (20, 40, 220))
    ImageDraw.Draw(image).rectangle((0, 0, 159, 239), fill=(220, 20, 20))
    exif = Image.Exif()
    exif[0x0112] = 6
    exif[0x8825] = {
        1: "N", 2: (Fraction(int(lat)), Fraction(0), Fraction(round((lat % 1) * 3600, 4))),
        3: "E", 4: (Fraction(int(lon)), Fraction(0), Fraction(round((lon % 1) * 3600, 4))),
    }
    buffer = io.BytesIO()
    image.save(buffer, format=fmt, exif=exif.tobytes())
    return buffer.getvalue()


class TestIphonePhotos:
    def test_an_orientation_6_photo_is_stamped_upright(self, icms_client, inspection_loop, db):
        from PIL import Image

        from app.config import settings

        body = upload(icms_client.sign_in(SURVEYOR), files=photo(sideways_jpeg())).json()
        stamped_key = stored_row(db, body["id"]).stamped_storage_key
        stamped = Image.open(settings.icms_evidence_dir / stamped_key)

        width, height = stamped.size
        assert width == 240 and height > 320
        # Rotated 90° clockwise: the red left edge is now the top, the bar is below the blue.
        top, bottom = stamped.getpixel((120, 10)), stamped.getpixel((120, 310))
        assert top[0] > 150 and top[2] < 100
        assert bottom[2] > 150 and bottom[0] < 100

    def test_a_heic_photo_is_stored_as_an_upright_jpeg(self, icms_client, inspection_loop, db):
        import hashlib

        from PIL import Image

        from app.config import settings

        heic = sideways_jpeg("HEIF")
        assert heic[4:12] == b"ftypheic"
        response = upload(icms_client.sign_in(SURVEYOR),
                          files={"file": ("IMG_0001.HEIC", heic, "image/heic")})

        assert response.status_code == 201, response.text
        body = response.json()
        row = stored_row(db, body["id"])
        stored = settings.icms_evidence_dir / row.storage_path
        data = stored.read_bytes()
        assert data[:3] == b"\xff\xd8\xff"
        assert row.storage_path.endswith(".jpg")
        assert row.content_type == "image/jpeg"
        assert row.original_filename == "IMG_0001.jpg"
        assert body["sha256"] == hashlib.sha256(data).hexdigest()
        image = Image.open(stored)
        assert image.size == (240, 320)
        assert image.getexif().get(0x0112) == 1
        assert body["exif_lat"] == pytest.approx(27.005, abs=1e-4)
        assert body["geotag_flagged"] is False
        assert body["stamped_url"] is not None

    def test_an_undecodable_heic_is_a_415(self, icms_client, inspection_loop, db):
        junk = b"\x00\x00\x00\x18ftypheic\x00\x00\x00\x00mif1heic" + b"\x00" * 64
        response = upload(icms_client.sign_in(SURVEYOR),
                          files={"file": ("IMG_0002.heic", junk, "image/heic")})

        assert response.status_code == 415, response.text
        assert error_of(response)["code"] == "unsupported_image_format"
