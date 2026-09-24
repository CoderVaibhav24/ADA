"""ICMS Batch 6 — the notice.

The suite is organised around the four properties that make a generated notice
a legal instrument rather than a PDF: the number is gapless, the document is
stored rather than re-derived, the citation is real, and `overdue` is a reading
of the calendar rather than a row somebody has to sweep.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timedelta

import pytest

from tests.conftest import IST, LEAD, LEAD_ID, NODAL, SUPER_ADMIN, SURVEYOR

ICMS = "/api/icms"
NOTICES = f"{ICMS}/notices"
ACT = "up_upda_1973"

CONFIRMED_CASE = "CMP-2026-0011"
ISSUED_NOTICE = "NTC-2026-0001"
OVERDUE_NOTICE = "NTC-2026-0002"
OUT_OF_ZONE_NOTICE = "NTC-2026-0003"


def today():
    return datetime.now(IST).date()


def issue(client, case_ref=CONFIRMED_CASE, **body):
    payload = {"act_cd": ACT, "section_cds": ["sec_27"], **body}
    return client.post(f"{ICMS}/cases/{case_ref}/notices", json=payload)


def error_of(response) -> dict:
    return response.json()["error"]


class TestIssuingANotice:
    def test_the_lead_issues_and_gets_the_whole_notice_back(self, icms_client,
                                                            notice_world):
        response = issue(icms_client.sign_in(LEAD))

        assert response.status_code == 201, response.text
        body = response.json()
        assert body["notice_ref"] == "NTC-2026-0004"
        assert body["case_ref"] == CONFIRMED_CASE
        assert body["act_cd"] == ACT
        assert body["section_cds"] == ["sec_27"]
        assert body["status"] == "issued"
        assert body["issued_by"] == LEAD_ID
        assert body["has_artefact"] is True
        assert len(body["artefact_sha256"]) == 64

    def test_the_case_moves_to_notice_issued_and_the_move_is_recorded(
        self, icms_client, notice_world, events
    ):
        client = icms_client.sign_in(LEAD)
        issued = issue(client)
        assert issued.status_code == 201, issued.text

        case = client.get(f"{ICMS}/cases/{CONFIRMED_CASE}").json()
        assert (case["status"], case["stage_no"]) == ("notice_issued", 7)

        rows = [row for row in events(notice_world[CONFIRMED_CASE].id)
                if row["action"] == "issue_notice"]
        assert len(rows) == 1
        assert rows[0]["from_status"] == "confirmed"
        assert rows[0]["to_status"] == "notice_issued"
        assert rows[0]["payload"]["notice_ref"] == issued.json()["notice_ref"]

    def test_the_body_carries_the_document_and_names_the_template(self, icms_client,
                                                                  notice_world):
        body = issue(icms_client.sign_in(LEAD)).json()["body"]

        assert body["template"]["provisional"] is True
        assert body["template"]["source"] == "figma:69:2961"
        assert body["notice"]["notice_ref"] == "NTC-2026-0004"
        assert body["legal"]["act_cd"] == ACT
        assert [s["code"] for s in body["legal"]["sections"]] == ["sec_27"]

    def test_the_document_is_drawn_from_the_case_at_the_moment_of_issue(
        self, icms_client, notice_world
    ):
        """A legal instrument is a snapshot. The template reads `body` and never the
        case, so a later correction to the case cannot rewrite a served notice."""
        body = issue(icms_client.sign_in(LEAD)).json()["body"]

        assert body["recipient"]["name"] == "Suresh Chand"
        assert body["property"]["khasra_no"] == "77/3"
        assert body["property"]["address"] == "19 Wazirpura Road"

    def test_an_override_replaces_the_resolved_default(self, icms_client, notice_world):
        response = issue(
            icms_client.sign_in(LEAD),
            body_overrides={"recipient_name": "Someone Else",
                            "encroached_area_sqm": 84.25,
                            "grounds": ["Verandah extended over the footpath."]},
        )

        body = response.json()["body"]
        assert body["recipient"]["name"] == "Someone Else"
        assert body["property"]["encroached_area_sqm"] == 84.25
        assert body["grounds"] == ["Verandah extended over the footpath."]

    def test_an_unlisted_override_key_is_refused_rather_than_stored(self, icms_client,
                                                                    notice_world):
        """`body` is the text of a legal instrument; an issuer who can add arbitrary
        keys to it can add arbitrary keys to what a court reads."""
        response = issue(icms_client.sign_in(LEAD),
                         body_overrides={"consequence": "Nothing will happen."})

        assert response.status_code == 422
        assert error_of(response)["code"] == "validation_failed"


class TestWhoMayIssue:
    @pytest.mark.parametrize("role", [SUPER_ADMIN, NODAL, SURVEYOR])
    def test_every_other_role_is_refused_at_the_transition(self, icms_client,
                                                           notice_world, role):
        """The lead confirms and the lead issues. A nodal officer who could issue the
        notice they handed over is the separation the whole of stage 6 exists for."""
        response = issue(icms_client.sign_in(role))

        assert response.status_code == 403, response.text
        error = error_of(response)
        assert error["code"] == "role_not_permitted"
        assert "ada-project-lead" in error["message"]
        assert error["allowed"] == ["ada-project-lead"]

    def test_a_surveyor_may_not_read_the_register_at_all(self, icms_client,
                                                         notice_world):
        """`notice.read` is granted to no surveyor. A surveyor inspects; the notice is
        the authority's instrument and nothing in the field app reads one."""
        response = icms_client.sign_in(SURVEYOR).get(NOTICES)

        assert response.status_code == 403
        error = error_of(response)
        assert error["code"] == "role_not_permitted"
        assert SURVEYOR not in error["allowed"]

    @pytest.mark.parametrize("path", ["", f"/{ISSUED_NOTICE}", f"/{ISSUED_NOTICE}/pdf"])
    def test_the_surveyor_is_refused_every_read(self, icms_client, notice_world, path):
        assert icms_client.sign_in(SURVEYOR).get(f"{NOTICES}{path}").status_code == 403


class TestTheCaseHasToBeConfirmed:
    @pytest.mark.parametrize("case_ref", ["CMP-2026-0001", "CMP-2026-0002",
                                          "CMP-2026-0012"])
    def test_issuing_from_any_other_status_is_409(self, icms_client, notice_world,
                                                  case_ref):
        response = issue(icms_client.sign_in(LEAD), case_ref=case_ref)

        assert response.status_code == 409, response.text
        assert error_of(response)["code"] == "invalid_transition"

    def test_a_second_notice_on_the_same_case_is_refused(self, icms_client,
                                                         notice_world):
        """Immutability's other half: the case has left `confirmed`, so a correction
        cannot be a quiet re-issue. It has to be a new instrument on a new record."""
        client = icms_client.sign_in(LEAD)
        assert issue(client).status_code == 201

        assert issue(client).status_code == 409


class TestTheCitationHasToBeReal:
    def test_an_unknown_act_is_refused_and_names_the_ones_that_exist(self, icms_client,
                                                                     notice_world):
        response = issue(icms_client.sign_in(LEAD), act_cd="mp_town_planning_1973")

        assert response.status_code == 422, response.text
        error = error_of(response)
        assert error["code"] == "unknown_act"
        assert error["field"] == "act_cd"
        assert error["allowed"] == [ACT]

    def test_an_unknown_section_is_refused_and_names_the_ones_that_exist(
        self, icms_client, notice_world
    ):
        response = issue(icms_client.sign_in(LEAD), section_cds=["sec_27", "sec_99"])

        assert response.status_code == 422, response.text
        error = error_of(response)
        assert error["code"] == "unknown_section"
        assert error["field"] == "section_cds"
        assert "sec_27" in error["allowed"] and "sec_99" not in error["allowed"]

    def test_a_retired_section_is_refused_like_an_unknown_one(self, icms_client,
                                                              notice_world):
        """sec_28a is seeded inactive here. An inactive code is one ADA has withdrawn,
        and a notice issued under a withdrawn section is defective."""
        response = issue(icms_client.sign_in(LEAD), section_cds=["sec_28a"])

        assert response.status_code == 422
        assert error_of(response)["code"] == "unknown_section"

    def test_a_section_of_another_act_is_refused(self, icms_client, notice_world, db):
        from ada_core.models_icms import CodeValue

        db.add_all([
            CodeValue(domain="act", code="other_act", label="Some Other Act",
                      sort_order=2),
            CodeValue(domain="section", code="sec_x", parent_code="other_act",
                      label="Section X", sort_order=1),
        ])
        db.commit()

        response = issue(icms_client.sign_in(LEAD), section_cds=["sec_x"])

        assert response.status_code == 422
        assert error_of(response)["code"] == "unknown_section"

    def test_nothing_is_written_when_the_citation_is_refused(self, icms_client,
                                                             notice_world, db):
        from ada_core.models_icms import Notice
        from sqlalchemy import func, select

        before = db.execute(select(func.count()).select_from(Notice)).scalar_one()
        issue(icms_client.sign_in(LEAD), act_cd="no_such_act")

        assert db.execute(select(func.count()).select_from(Notice)).scalar_one() == before


class TestTheReferenceIsGapless:
    def test_a_refused_issue_consumes_no_number(self, icms_client, notice_world):
        """This is the point of allocating inside the transaction. A gap in a statutory
        register is a question in court about what happened to notice 47."""
        client = icms_client.sign_in(LEAD)

        refused = issue(client, act_cd="no_such_act")
        assert refused.status_code == 422

        issued = issue(client)
        assert issued.status_code == 201
        assert issued.json()["notice_ref"] == "NTC-2026-0004"

    @pytest.mark.parametrize("attempt", [
        {"act_cd": "no_such_act"},
        {"section_cds": ["sec_99"]},
        {"compliance_due": "2099-01-01"},
    ], ids=["unknown act", "unknown section", "impossible compliance date"])
    def test_every_refusal_shape_leaves_the_counter_alone(self, icms_client,
                                                          notice_world, attempt):
        client = icms_client.sign_in(LEAD)
        assert issue(client, **attempt).status_code == 422

        assert issue(client).json()["notice_ref"] == "NTC-2026-0004"

    def test_successive_notices_run_consecutively(self, icms_client, notice_world, db):
        from ada_core.models_icms import Case

        client = icms_client.sign_in(LEAD)
        minted = [issue(client).json()["notice_ref"]]
        # A second confirmed case, because one case issues one notice.
        db.add(Case(case_ref="CMP-2026-0015",
                    zone_id=notice_world[CONFIRMED_CASE].zone_id,
                    source="office", status="confirmed", stage_no=7,
                    property_address="6 Sanjay Place", created_by=LEAD_ID))
        db.commit()
        minted.append(issue(client, case_ref="CMP-2026-0015").json()["notice_ref"])

        assert minted == ["NTC-2026-0004", "NTC-2026-0005"]


class TestTheComplianceWindow:
    def test_an_absent_date_is_derived_and_stated(self, icms_client, notice_world):
        body = issue(icms_client.sign_in(LEAD)).json()

        assert body["compliance_due"] == (today() + timedelta(days=30)).isoformat()
        assert body["body"]["notice"]["compliance_days"] == 30

    @pytest.mark.parametrize("days", [15, 30, 40])
    def test_a_date_inside_the_statutory_window_is_taken(self, icms_client,
                                                         notice_world, days):
        due = today() + timedelta(days=days)
        response = issue(icms_client.sign_in(LEAD), compliance_due=due.isoformat())

        assert response.status_code == 201, response.text
        assert response.json()["compliance_due"] == due.isoformat()

    @pytest.mark.parametrize("days", [-1, 0, 14, 41, 400])
    def test_a_date_outside_it_is_refused(self, icms_client, notice_world, days):
        """Section 27 allows not less than 15 and not more than 40 days. Both bounds
        are the Act's, so neither is a setting a district can argue down."""
        due = today() + timedelta(days=days)
        response = issue(icms_client.sign_in(LEAD), compliance_due=due.isoformat())

        assert response.status_code == 422, response.text
        error = error_of(response)
        assert error["code"] == "compliance_window"
        assert error["field"] == "compliance_due"


class TestTheRegister:
    def test_the_lead_sees_the_notices_in_zones_they_hold(self, icms_client,
                                                          notice_world):
        body = icms_client.sign_in(LEAD).get(NOTICES).json()

        refs = [row["notice_ref"] for row in body["items"]]
        assert refs == [OVERDUE_NOTICE, ISSUED_NOTICE]
        assert body["total"] == 2

    def test_a_notice_in_an_unheld_zone_is_not_in_the_register_or_its_total(
        self, icms_client, notice_world
    ):
        """NTC-2026-0003 is on a RURAL case nobody is assigned to. `total` is counted
        over the scoped selectable, so it cannot count a row the page cannot show."""
        body = icms_client.sign_in(NODAL).get(NOTICES).json()

        assert OUT_OF_ZONE_NOTICE not in [row["notice_ref"] for row in body["items"]]
        assert body["total"] == len(body["items"])

    def test_super_admin_is_unrestricted_and_sees_all_three(self, icms_client,
                                                            notice_world):
        body = icms_client.sign_in(SUPER_ADMIN).get(NOTICES).json()

        assert body["total"] == 3

    @pytest.mark.parametrize("params,expected", [
        ({"case_ref": "CMP-2026-0012"}, [ISSUED_NOTICE]),
        ({"status": "overdue"}, [OVERDUE_NOTICE]),
        ({"status": "issued"}, [ISSUED_NOTICE]),
        ({"act_cd": ACT}, [OVERDUE_NOTICE, ISSUED_NOTICE]),
        ({"act_cd": "no_such_act"}, []),
        ({"zone_cd": "TAJ"}, [OVERDUE_NOTICE, ISSUED_NOTICE]),
        ({"zone_cd": "CANT"}, []),
        ({"q": "NTC-2026-0001"}, [ISSUED_NOTICE]),
    ], ids=lambda value: str(value))
    def test_each_filter_narrows_to_the_documented_rows(self, icms_client, notice_world,
                                                        params, expected):
        body = icms_client.sign_in(LEAD).get(NOTICES, params=params).json()

        assert [row["notice_ref"] for row in body["items"]] == expected

    def test_repeated_values_of_one_filter_or_together(self, icms_client, notice_world):
        body = icms_client.sign_in(LEAD).get(
            NOTICES, params={"status": ["issued", "overdue"]}).json()

        assert body["total"] == 2

    def test_an_unknown_status_is_refused_with_the_vocabulary(self, icms_client,
                                                              notice_world):
        response = icms_client.sign_in(LEAD).get(NOTICES, params={"status": "posted"})

        assert response.status_code == 422
        error = error_of(response)
        assert error["code"] == "validation_failed"
        assert "posted" in error["message"]

    def test_the_issue_date_range_is_inclusive_of_both_ends(self, icms_client,
                                                            notice_world):
        day = (today() - timedelta(days=5)).isoformat()
        body = icms_client.sign_in(LEAD).get(
            NOTICES, params={"issued_from": day, "issued_to": day}).json()

        assert [row["notice_ref"] for row in body["items"]] == [ISSUED_NOTICE]

    def test_there_is_no_page_size_parameter(self, icms_client, notice_world):
        """`size`, not `page_size`. The screen agent binds to one of them and an
        unknown query parameter is refused rather than silently ignored."""
        response = icms_client.sign_in(LEAD).get(NOTICES, params={"page_size": 5})

        assert response.status_code == 422


class TestOverdueIsDerived:
    def test_a_passed_compliance_date_reads_overdue_while_the_row_says_issued(
        self, icms_client, notice_world, db
    ):
        from ada_core.models_icms import Notice
        from sqlalchemy import select

        row = icms_client.sign_in(LEAD).get(f"{NOTICES}/{OVERDUE_NOTICE}").json()
        stored = db.execute(
            select(Notice.status).where(Notice.notice_ref == OVERDUE_NOTICE)
        ).scalar_one()

        assert row["status"] == "overdue"
        assert stored == "issued", "nothing sweeps a stored status, so none is stored"

    def test_a_notice_still_in_time_reads_issued(self, icms_client, notice_world):
        row = icms_client.sign_in(LEAD).get(f"{NOTICES}/{ISSUED_NOTICE}").json()

        assert row["status"] == "issued"

    def test_the_register_sorts_by_the_same_expression_it_shows(self, icms_client,
                                                                notice_world):
        body = icms_client.sign_in(LEAD).get(NOTICES, params={"sort": "status"}).json()

        assert [row["status"] for row in body["items"]] == ["issued", "overdue"]


class TestTheDetail:
    def test_the_detail_carries_the_document_and_the_digest(self, icms_client,
                                                            notice_world):
        body = icms_client.sign_in(LEAD).get(f"{NOTICES}/{ISSUED_NOTICE}").json()

        assert body["notice_ref"] == ISSUED_NOTICE
        assert body["body"]["notice"]["notice_ref"] == ISSUED_NOTICE
        assert len(body["artefact_sha256"]) == 64
        assert body["issuing_authority"]

    def test_deliveries_is_present_and_empty(self, icms_client, notice_world):
        """Deliberate, not an oversight. The Parivartan App owns delivery tracking by
        section 3a; the key is here so the shape does not change when it starts."""
        body = icms_client.sign_in(LEAD).get(f"{NOTICES}/{ISSUED_NOTICE}").json()

        assert body["deliveries"] == []

    def test_no_delivery_route_is_mounted(self, icms_client, notice_world):
        from app.main import app

        mounted = {route.path for route in app.routes if hasattr(route, "path")}

        assert not [path for path in mounted if "deliveries" in path]

    def test_a_notice_is_immutable(self, icms_client, notice_world):
        """No PUT, no PATCH, no DELETE. A correction is a new notice."""
        client = icms_client.sign_in(LEAD)
        for method in ("put", "patch", "delete"):
            response = getattr(client, method)(f"{NOTICES}/{ISSUED_NOTICE}")
            assert response.status_code == 405, f"{method.upper()} is mounted"

    def test_an_unknown_reference_is_404(self, icms_client, notice_world):
        response = icms_client.sign_in(LEAD).get(f"{NOTICES}/NTC-2026-9999")

        assert response.status_code == 404
        assert error_of(response)["code"] == "notice_not_found"

    def test_a_notice_outside_the_callers_zones_is_404_and_not_403(self, icms_client,
                                                                   notice_world):
        """404 and never 403: a 403 confirms the record exists, which is itself a
        disclosure about a property the officer may not see."""
        response = icms_client.sign_in(NODAL).get(f"{NOTICES}/{OUT_OF_ZONE_NOTICE}")

        assert response.status_code == 404
        assert error_of(response)["code"] == "notice_not_found"

    def test_issuing_on_a_case_outside_the_callers_zones_is_404(self, icms_client,
                                                                notice_world, db):
        from ada_core.models_icms import Case

        db.add(Case(case_ref="CMP-2026-0016",
                    zone_id=notice_world["CMP-2026-0014"].zone_id,
                    source="office", status="confirmed", stage_no=7,
                    property_address="Village Runkata", created_by=LEAD_ID))
        db.commit()

        response = issue(icms_client.sign_in(LEAD), case_ref="CMP-2026-0016")

        assert response.status_code == 404
        assert error_of(response)["code"] == "case_not_found"


class TestTheStoredArtefact:
    def test_the_pdf_is_the_bytes_that_were_stored(self, icms_client, notice_world, db):
        """The heart of it: a reprint reproduces the document that was served, so the
        route reads the file and does not re-render from `body`."""
        from ada_core.models_icms import Notice
        from sqlalchemy import select

        from app.config import settings

        response = icms_client.sign_in(LEAD).get(f"{NOTICES}/{ISSUED_NOTICE}/pdf")
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/pdf"

        row = db.execute(
            select(Notice.artefact_path, Notice.artefact_sha256)
            .where(Notice.notice_ref == ISSUED_NOTICE)
        ).one()
        on_disk = (settings.icms_notice_dir / row.artefact_path).read_bytes()

        assert response.content == on_disk
        assert hashlib.sha256(response.content).hexdigest() == row.artefact_sha256

    def test_a_reprint_after_the_template_changes_still_serves_what_was_issued(
        self, icms_client, notice_world, monkeypatch
    ):
        """A re-render would pick up whatever template is current. ADA's official one
        is still to come, so this is the difference between a reprint and a reissue."""
        client = icms_client.sign_in(LEAD)
        served = client.get(f"{NOTICES}/{ISSUED_NOTICE}/pdf").content

        from app.icms import notice_template

        monkeypatch.setattr(
            notice_template, "render",
            lambda body: b"%PDF-1.4 a completely different document")

        assert client.get(f"{NOTICES}/{ISSUED_NOTICE}/pdf").content == served

    def test_the_document_is_a_pdf_that_names_the_notice(self, icms_client,
                                                         notice_world):
        response = icms_client.sign_in(LEAD).get(f"{NOTICES}/{ISSUED_NOTICE}/pdf")

        assert response.content.startswith(b"%PDF-")
        assert response.content.rstrip().endswith(b"%%EOF")
        assert ISSUED_NOTICE.encode() in response.content

    def test_a_missing_file_is_refused_rather_than_redrawn(self, icms_client,
                                                           notice_world, db):
        from ada_core.models_icms import Notice
        from sqlalchemy import select

        from app.config import settings

        path = db.execute(
            select(Notice.artefact_path).where(Notice.notice_ref == ISSUED_NOTICE)
        ).scalar_one()
        (settings.icms_notice_dir / path).unlink()

        response = icms_client.sign_in(LEAD).get(f"{NOTICES}/{ISSUED_NOTICE}/pdf")

        assert response.status_code == 404
        assert error_of(response)["code"] == "notice_artefact_missing"

    def test_an_out_of_zone_artefact_is_404(self, icms_client, notice_world):
        response = icms_client.sign_in(NODAL).get(f"{NOTICES}/{OUT_OF_ZONE_NOTICE}/pdf")

        assert response.status_code == 404
        assert error_of(response)["code"] == "notice_not_found"

    def test_a_freshly_issued_notice_is_downloadable_at_once(self, icms_client,
                                                             notice_world):
        client = icms_client.sign_in(LEAD)
        ref = issue(client).json()["notice_ref"]

        response = client.get(f"{NOTICES}/{ref}/pdf")

        assert response.status_code == 200
        assert response.content.startswith(b"%PDF-")


class TestTheTemplateIsDataAndSwappable:
    def test_rendering_the_same_body_twice_gives_the_same_bytes(self, notice_world, db):
        """No clock in the writer. A library that stamps a creation date makes two
        renders of one document differ — the property the artefact store relies on."""
        from ada_core.models_icms import Notice
        from sqlalchemy import select

        from app.icms.notice_template import render

        body = db.execute(
            select(Notice.body).where(Notice.notice_ref == ISSUED_NOTICE)
        ).scalar_one()

        assert render(body) == render(body)

    def test_the_render_reads_nothing_but_the_body(self, notice_world, db):
        from ada_core.models_icms import Notice
        from sqlalchemy import select

        from app.icms.notice_template import render

        body = db.execute(
            select(Notice.body).where(Notice.notice_ref == ISSUED_NOTICE)
        ).scalar_one()
        before = render(body)

        body["recipient"]["name"] = "A Different Person"

        assert render(body) != before, "the document has to follow the stored body"

    def test_the_map_extract_is_a_named_hole_rather_than_a_silent_omission(
        self, icms_client, notice_world
    ):
        """No map is produced: one needs a tile server, and a legal document renderer
        does not get an outbound HTTP dependency. The document says so."""
        body = issue(icms_client.sign_in(LEAD)).json()["body"]

        assert body["map_extract"]["available"] is False
        assert "tile service" in body["map_extract"]["reason"]

    def test_the_acknowledgement_slip_is_a_named_hole_too(self, icms_client,
                                                          notice_world):
        """Decided 2026-09-23: Figma's Notice Create checklist promises a slip and the
        document frame draws none, so any wording here would be invented. An
        acknowledgement OF SERVICE with the wrong wording is worse than none."""
        response = issue(icms_client.sign_in(LEAD))
        body = response.json()["body"]

        assert body["acknowledgement"]["available"] is False
        assert "to be confirmed" in body["acknowledgement"]["reason"]

    def test_no_slip_and_no_map_are_drawn_into_the_document(self, icms_client,
                                                            notice_world):
        ref = issue(icms_client.sign_in(LEAD)).json()["notice_ref"]
        content = icms_client.sign_in(LEAD).get(f"{NOTICES}/{ref}/pdf").content

        assert b"ACKNOWLEDGEMENT SLIP" not in content
        assert b"Signature or thumb impression" not in content
        assert b"not attached" in content, "the absence has to be stated, not silent"

    def test_the_document_says_it_is_provisional(self, icms_client, notice_world):
        body = issue(icms_client.sign_in(LEAD)).json()["body"]

        assert "PROVISIONAL" in body["provisional_mark"]
        assert body["template"]["provisional"] is True
