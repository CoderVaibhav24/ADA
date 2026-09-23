"""ICMS Batches 5-6 held to the bar the earlier batches met in the 23 Sep audit.

Batches 4-6 landed after that audit, so each class here is one checklist item:
narrowing, input bounds, the stored artefact, and rendering.
"""

from __future__ import annotations

import time
from datetime import timedelta

import pytest

from tests.conftest import LEAD, NODAL, SURVEYOR
from tests.test_icms_notices import (
    CONFIRMED_CASE,
    ISSUED_NOTICE,
    NOTICES,
    error_of,
    issue,
    today,
)


@pytest.fixture
def surveyor_reads_notices(db, policy_tables):
    """Grants `field-surveyor` the `notice.read` an administrator could grant it."""
    from ada_core.models_icms import RolePermission

    from app.icms import policy

    db.add(RolePermission(role_cd=SURVEYOR, permission_cd="notice.read"))
    db.commit()
    return policy.reload(db)


def _stored_path(db, notice_ref: str) -> str:
    from ada_core.models_icms import Notice
    from sqlalchemy import select

    return db.execute(
        select(Notice.artefact_path).where(Notice.notice_ref == notice_ref)
    ).scalar_one()


def _repoint(db, notice_ref: str, artefact_path: str) -> None:
    from ada_core.models_icms import Notice
    from sqlalchemy import update

    db.execute(update(Notice).where(Notice.notice_ref == notice_ref)
               .values(artefact_path=artefact_path))
    db.commit()


class TestTheSurveyorNarrowingMatchesTheCaseRegister:
    def test_the_helper_agrees_with_the_case_register(self):
        from app.icms import cases as case_repo
        from app.icms import notices

        for roles in ([SURVEYOR], [SURVEYOR, NODAL], [NODAL], [SURVEYOR, LEAD], []):
            assert notices._own_notices_only(roles) == case_repo._own_cases_only(roles)

    def test_the_open_assignee_reads_the_notice(self, icms_client, notice_world,
                                                surveyor_reads_notices):
        ref = issue(icms_client.sign_in(LEAD)).json()["notice_ref"]

        client = icms_client.sign_in(SURVEYOR)
        assert client.get(f"{NOTICES}/{ref}").status_code == 200
        assert [row["notice_ref"] for row in client.get(NOTICES).json()["items"]] == [ref]

    def test_a_released_assignment_no_longer_reads_it(self, icms_client, notice_world,
                                                      surveyor_reads_notices, db):
        """The case register reads the OPEN survey row; a surveyor taken off a case
        stops seeing it there, and must stop seeing its notice too."""
        from ada_core.models_icms import CaseAssignment
        from sqlalchemy import update

        ref = issue(icms_client.sign_in(LEAD)).json()["notice_ref"]
        db.execute(update(CaseAssignment)
                   .where(CaseAssignment.case_id == notice_world[CONFIRMED_CASE].id)
                   .values(active=False))
        db.commit()

        client = icms_client.sign_in(SURVEYOR)
        assert client.get(f"{NOTICES}/{ref}").status_code == 404
        assert client.get(f"{NOTICES}/{ref}/pdf").status_code == 404
        assert client.get(NOTICES).json()["items"] == []


class TestGroundsSchemaIsHonest:
    def test_the_openapi_document_admits_a_string_or_a_list(self):
        from app.main import app

        schemas = app.openapi()["components"]["schemas"]
        name = next(k for k in schemas if k.startswith("NoticeBodyOverrides"))
        grounds = schemas[name]["properties"]["grounds"]
        kinds = {branch.get("type") for branch in grounds["anyOf"]}
        assert {"string", "array"} <= kinds
        array = next(b for b in grounds["anyOf"] if b.get("type") == "array")
        assert array["maxItems"] == 20
        assert array["items"]["maxLength"] == 500

    def test_a_string_is_split_on_blank_lines(self, icms_client, notice_world):
        response = issue(icms_client.sign_in(LEAD), body_overrides={
            "grounds": "First storey added.\n\nBalcony over the lane."})

        assert response.status_code == 201, response.text
        assert response.json()["body"]["grounds"] == [
            "First storey added.", "Balcony over the lane."]

    def test_more_than_twenty_grounds_are_refused(self, icms_client, notice_world):
        response = issue(icms_client.sign_in(LEAD),
                         body_overrides={"grounds": [f"Ground {n}" for n in range(21)]})
        assert response.status_code == 422
        assert error_of(response)["code"] == "validation_failed"

    def test_a_string_splitting_into_more_than_twenty_is_refused(self, icms_client,
                                                                  notice_world):
        text = "\n\n".join(f"Ground {n}" for n in range(21))
        response = issue(icms_client.sign_in(LEAD), body_overrides={"grounds": text})
        assert response.status_code == 422

    def test_an_over_long_ground_is_refused(self, icms_client, notice_world):
        response = issue(icms_client.sign_in(LEAD),
                         body_overrides={"grounds": ["x" * 501]})
        assert response.status_code == 422

    def test_a_blank_string_is_refused_rather_than_stored_empty(self, icms_client,
                                                                 notice_world):
        response = issue(icms_client.sign_in(LEAD), body_overrides={"grounds": " \n\n "})
        assert response.status_code == 422


class TestOverridesUseTheAnnotatedTypes:
    def test_the_recipient_address_is_normalised(self, icms_client, notice_world):
        response = issue(icms_client.sign_in(LEAD), body_overrides={
            "recipient_address": "  12 Mall Road\x00​, Agra  "})

        assert response.status_code == 201, response.text
        assert response.json()["body"]["recipient"]["address"] == "12 Mall Road, Agra"

    def test_markup_in_the_address_is_refused(self, icms_client, notice_world):
        response = issue(icms_client.sign_in(LEAD), body_overrides={
            "recipient_address": "<img src=http://169.254.169.254/>"})
        assert response.status_code == 422

    @pytest.mark.parametrize("bad", ["77/3 OR 1=1", "abc", "1" * 30])
    def test_the_khasra_override_is_a_khasra_number(self, icms_client, notice_world, bad):
        response = issue(icms_client.sign_in(LEAD), body_overrides={"khasra_no": bad})
        assert response.status_code == 422

    def test_a_heading_too_long_to_draw_is_refused(self, icms_client, notice_world):
        response = issue(icms_client.sign_in(LEAD),
                         body_overrides={"notice_type": "N" * 121})
        assert response.status_code == 422

    def test_an_authority_too_long_to_draw_is_refused(self, icms_client, notice_world):
        response = issue(icms_client.sign_in(LEAD), issuing_authority="A" * 121)
        assert response.status_code == 422


class TestComplianceDueIsACalendarDate:
    @pytest.mark.parametrize("shape", [
        "{d}T00:00:00", "{d}T00:00:00Z", "{d}T00:00:00+05:30", "unix",
    ])
    def test_anything_but_yyyy_mm_dd_is_refused(self, icms_client, notice_world, shape):
        """A datetime (naive or zoned) or a timestamp carries a clock the Section 27
        day count does not have; which IST day it names is a guess."""
        due = today() + timedelta(days=30)
        value = 1_790_000_000 if shape == "unix" else shape.format(d=due.isoformat())
        response = issue(icms_client.sign_in(LEAD), compliance_due=value)

        assert response.status_code == 422, response.text
        assert error_of(response)["code"] == "validation_failed"

    def test_the_register_date_filters_take_only_yyyy_mm_dd(self, icms_client,
                                                              notice_world):
        client = icms_client.sign_in(LEAD)
        assert client.get(NOTICES, params={"issued_from": "2026-01-01"}).status_code == 200
        response = client.get(NOTICES, params={"issued_from": "2026-01-01T00:00:00"})
        assert response.status_code == 422

    def test_a_repeatable_filter_is_bounded(self, icms_client, notice_world):
        client = icms_client.sign_in(LEAD)
        params = [("act_cd", f"act_{n}") for n in range(51)]
        assert client.get(NOTICES, params=params).status_code == 422


class TestTheStoredArtefactCannotEscape:
    @pytest.mark.parametrize("path", [
        "../../../../etc/passwd", "/etc/passwd", "NTC-2026-0001/../../outside.pdf", ".",
    ])
    def test_a_stored_path_outside_the_store_is_404(self, icms_client, notice_world,
                                                    db, path):
        _repoint(db, ISSUED_NOTICE, path)

        response = icms_client.sign_in(LEAD).get(f"{NOTICES}/{ISSUED_NOTICE}/pdf")

        assert response.status_code == 404
        assert error_of(response)["code"] == "notice_artefact_missing"

    def test_a_symlink_out_of_the_store_is_404(self, icms_client, notice_world, db,
                                               tmp_path):
        from app.config import settings

        secret = tmp_path / "secret.pdf"
        secret.write_bytes(b"%PDF-1.4 not yours")
        link = settings.icms_notice_dir / ISSUED_NOTICE / "link.pdf"
        link.symlink_to(secret)
        _repoint(db, ISSUED_NOTICE, f"{ISSUED_NOTICE}/link.pdf")

        response = icms_client.sign_in(LEAD).get(f"{NOTICES}/{ISSUED_NOTICE}/pdf")

        assert response.status_code == 404

    def test_another_notices_document_is_not_served_under_this_ref(
        self, icms_client, notice_world, db
    ):
        _repoint(db, ISSUED_NOTICE, _stored_path(db, "NTC-2026-0002"))

        response = icms_client.sign_in(LEAD).get(f"{NOTICES}/{ISSUED_NOTICE}/pdf")

        assert response.status_code == 404

    def test_a_file_whose_bytes_no_longer_match_the_digest_is_not_served(
        self, icms_client, notice_world, db
    ):
        """The digest is the instrument's seal. A tampered file is not the notice."""
        from app.config import settings

        (settings.icms_notice_dir / _stored_path(db, ISSUED_NOTICE)).write_bytes(
            b"%PDF-1.4 altered")

        response = icms_client.sign_in(LEAD).get(f"{NOTICES}/{ISSUED_NOTICE}/pdf")

        assert response.status_code == 404
        assert error_of(response)["code"] == "notice_artefact_missing"

    def test_the_download_is_an_attachment_that_forbids_sniffing(self, icms_client,
                                                                  notice_world):
        response = icms_client.sign_in(LEAD).get(f"{NOTICES}/{ISSUED_NOTICE}/pdf")

        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"
        assert response.headers["content-disposition"].startswith("attachment;")
        assert f'filename="{ISSUED_NOTICE}.pdf"' in response.headers["content-disposition"]
        assert response.headers["x-content-type-options"] == "nosniff"


class TestRenderingIsBoundedAndInert:
    def test_braces_and_pdf_delimiters_in_user_text_are_drawn_literally(
        self, icms_client, notice_world
    ):
        name = "Ram {notice_ref} (x) Tj"
        ground = "{0} {days!r} ) Tj ET BT ("
        response = issue(icms_client.sign_in(LEAD), body_overrides={
            "recipient_name": name, "grounds": [ground]})

        assert response.status_code == 201, response.text
        body = response.json()["body"]
        assert body["recipient"]["name"] == name
        assert body["grounds"] == [ground]
        pdf = icms_client.get(f"{NOTICES}/{response.json()['notice_ref']}/pdf").content
        assert b"(Ram {notice_ref} \\(x\\) Tj) Tj" in pdf
        assert b"\\) Tj ET BT \\(" in pdf

    def test_the_largest_body_the_schema_admits_renders_quickly_and_briefly(
        self, icms_client, notice_world
    ):
        from app.icms import pdf

        overrides = {
            "notice_type": "N" * 120,
            "recipient_name": "R" * 200,
            "recipient_address": "A " * 249 + "A",
            "grounds": ["w" * 500] * 20,
        }
        started = time.monotonic()
        response = issue(icms_client.sign_in(LEAD), issuing_authority="I" * 120,
                         body_overrides=overrides)
        elapsed = time.monotonic() - started

        assert response.status_code == 201, response.text
        assert elapsed < 5.0
        content = icms_client.get(f"{NOTICES}/{response.json()['notice_ref']}/pdf").content
        assert content.count(b"/Type /Page ") <= pdf.MAX_PAGES

    def test_the_writer_refuses_to_run_past_its_page_cap(self):
        from app.icms import pdf

        document = pdf.Document()
        for _ in range(pdf.MAX_PAGES):
            document.page()
        with pytest.raises(ValueError):
            document.page()
