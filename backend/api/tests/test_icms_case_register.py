"""ICMS Batch 2 — `GET /api/icms/cases`, the Complaints register.

The endpoint the grid is built on, so the tests are organised the way the screen
is: the columns it renders, the controls it offers, and the paging underneath.

Four cases are visible to a Super Admin (CMP-2026-0001 to -0005 less none), and
CMP-2026-0004 sits in RURAL, which nobody is assigned to. Several tests here
exist only to say that -0004 did not appear.
"""

from __future__ import annotations

import pytest

from tests.conftest import (
    LEAD,
    NODAL,
    SUPER_ADMIN,
    SUPER_ADMIN_ID,
    SURVEYOR,
    SURVEYOR_B_ID,
    SURVEYOR_ID,
)
from tests.test_icms_reference import error_of

CASES = "/api/icms/cases"


def refs(body) -> list[str]:
    return [item["case_ref"] for item in body["items"]]


@pytest.fixture
def surveyor_in_taj(db, zones, cases):
    """The surveyor covers TAJ as well as CANT, where three cases are not theirs.

    Without it the zone scope alone leaves the surveyor with CMP-2026-0003, and
    a test about the assignment narrowing would pass on the zone filter.
    """
    from ada_core.models_icms import ZoneAssignment

    db.add(ZoneAssignment(zone_id=zones["TAJ"].id, user_id=SURVEYOR_ID,
                          assigned_by=SUPER_ADMIN_ID))
    db.commit()
    return cases


# ------------------------------------------------------------- the columns
class TestTheGridColumns:
    def test_every_available_column_comes_back_in_one_call(
        self, icms_client, cases, code_values
    ):
        """The grid renders Complaint ID, Location, Complainant, Complaint Type,
        Area, Status and Filed. A screen that needed a second call per row would
        make twenty-five calls to draw a page."""
        row = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"q": "Fatehabad"}).json()["items"][0]

        assert row["case_ref"] == "CMP-2026-0001"
        assert row["property_address"] == "12 Fatehabad Road"
        assert row["landmark"] == "Near Shilpgram"
        assert row["complainant_name"] == "Asha Devi"
        assert row["complaint_type_cd"] == "unauthorised_construction"
        assert row["complaint_type_label"] == "Unauthorised construction"
        assert row["status"] == "raised"
        assert row["stage_no"] == 1
        assert row["raised_at"].startswith("2026-09-10")

    def test_the_assignee_column_shows_the_open_assignment(self, icms_client, cases):
        rows = {item["case_ref"]: item for item in
                icms_client.sign_in(SUPER_ADMIN).get(CASES).json()["items"]}

        assert rows["CMP-2026-0002"]["assignee_user_id"] == SURVEYOR_B_ID
        assert rows["CMP-2026-0001"]["assignee_user_id"] is None

    def test_the_area_column_is_null_until_a_surveyor_has_measured(
        self, icms_client, cases
    ):
        """An area on an unsurveyed complaint would be a guess with a number on
        it. It arrives from the latest inspection round or not at all."""
        rows = icms_client.sign_in(SUPER_ADMIN).get(CASES).json()["items"]

        assert all(row["measured_area_sqm"] is None for row in rows)

    def test_the_area_column_reads_the_latest_round(self, icms_client, cases, db):
        from ada_core.models_icms import Inspection

        db.add_all([
            Inspection(inspection_ref="INS-2026-0001", case_id=cases["CMP-2026-0002"].id,
                       round_no=1, surveyor_user_id=SURVEYOR_B_ID,
                       measured_area_sqm=120.50, status="rejected"),
            Inspection(inspection_ref="INS-2026-0002", case_id=cases["CMP-2026-0002"].id,
                       round_no=2, surveyor_user_id=SURVEYOR_B_ID,
                       measured_area_sqm=143.25, status="submitted"),
        ])
        db.commit()

        rows = {item["case_ref"]: item for item in
                icms_client.sign_in(SUPER_ADMIN).get(CASES).json()["items"]}

        assert float(rows["CMP-2026-0002"]["measured_area_sqm"]) == 143.25

    def test_many_rounds_do_not_multiply_the_case(self, icms_client, cases, db):
        """The area is a correlated subquery rather than a join for exactly this
        reason: joining the rounds would put the case on the page twice."""
        from ada_core.models_icms import Inspection

        db.add_all([
            Inspection(inspection_ref=f"INS-2026-000{n}", case_id=cases["CMP-2026-0002"].id,
                       round_no=n, surveyor_user_id=SURVEYOR_B_ID, status="submitted")
            for n in (1, 2, 3)
        ])
        db.commit()

        body = icms_client.sign_in(SUPER_ADMIN).get(CASES).json()

        assert refs(body).count("CMP-2026-0002") == 1
        assert body["total"] == 5


# ------------------------------------------------------------- the filters
class TestTheFilters:
    def test_by_status(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"status": "raised"}).json()

        assert sorted(refs(body)) == ["CMP-2026-0001", "CMP-2026-0004"]
        assert body["total"] == 2

    def test_repeated_statuses_or_together(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params=[("status", "raised"), ("status", "closed")]).json()

        assert body["total"] == 3

    def test_different_filters_and_together(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"status": "raised", "zone_cd": "TAJ"}).json()

        assert refs(body) == ["CMP-2026-0001"]
        assert body["total"] == 1

    def test_by_stage(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"stage_no": 2}).json()

        assert sorted(refs(body)) == ["CMP-2026-0002", "CMP-2026-0003"]

    def test_by_zone(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"zone_cd": "CANT"}).json()

        assert refs(body) == ["CMP-2026-0003"]

    def test_by_complaint_type(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"complaint_type_cd": "encroachment"}).json()

        assert body["total"] == 2

    def test_by_source(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"source": "public"}).json()

        assert body["total"] == 3

    def test_by_assignee(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"assignee_user_id": SURVEYOR_ID}).json()

        assert refs(body) == ["CMP-2026-0003"]

    def test_mine_is_what_the_field_app_sends(self, icms_client, cases):
        """The field app is given one list: the cases assigned to the signed-in
        surveyor, and nothing else."""
        body = icms_client.sign_in(SURVEYOR).get(CASES, params={"mine": "true"}).json()

        assert refs(body) == ["CMP-2026-0003"]

    def test_mine_is_empty_for_an_officer_holding_nothing(self, icms_client, cases):
        body = icms_client.sign_in(NODAL).get(CASES, params={"mine": "true"}).json()

        assert body["items"] == []
        assert body["total"] == 0

    def test_by_filed_date_range(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"filed_from": "2026-09-12", "filed_to": "2026-09-14"}).json()

        assert sorted(refs(body)) == ["CMP-2026-0002", "CMP-2026-0003"]

    def test_the_date_range_is_inclusive_at_both_ends(self, icms_client, cases):
        """`filed_to` is a date and `raised_at` is an instant. An upper bound of
        `<= that date` would drop everything filed after midnight on it."""
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"filed_from": "2026-09-10", "filed_to": "2026-09-10"}).json()

        assert refs(body) == ["CMP-2026-0001"]

    def test_an_inverted_range_is_refused(self, icms_client, cases):
        response = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"filed_from": "2026-09-14", "filed_to": "2026-09-10"})

        assert response.status_code == 422

    def test_search_matches_the_address(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"q": "Mall Road"}).json()

        assert refs(body) == ["CMP-2026-0003"]

    def test_search_matches_the_complainant(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"q": "asha"}).json()

        assert refs(body) == ["CMP-2026-0001"]

    def test_search_matches_the_reference(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"q": "0003"}).json()

        assert refs(body) == ["CMP-2026-0003"]

    def test_a_wildcard_in_the_search_term_is_not_a_wildcard(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"q": "%"}).json()

        assert body["total"] == 0

    def test_an_unknown_status_is_refused_rather_than_matching_nothing(
        self, icms_client, cases
    ):
        """An unknown status silently matching nothing looks exactly like an
        empty register, and the officer who typed it cannot tell which happened."""
        response = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"status": "INSPECTION REPORT SUBMITED"})

        assert response.status_code == 422
        assert error_of(response)["code"] == "validation_failed"

    def test_an_unknown_source_is_refused(self, icms_client, cases):
        response = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"source": "carrier"})

        assert response.status_code == 422

    def test_a_stage_outside_the_seven_is_refused(self, icms_client, cases):
        response = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"stage_no": 9})

        assert response.status_code == 422

    def test_an_unknown_filter_is_refused_rather_than_ignored(self, icms_client, cases):
        """`extra="forbid"` means the query model IS the whitelist. A parameter
        nobody declared is a 422 naming it, not an unfiltered register that
        looks like it worked."""
        response = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"urgency": "high"})

        assert response.status_code == 422
        assert error_of(response)["field"] == "urgency"


# --------------------------------------------------------------- the scope
class TestZoneScoping:
    def test_a_super_admin_sees_every_case(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES).json()

        assert body["total"] == 5

    def test_an_officer_sees_only_their_zones(self, icms_client, cases):
        body = icms_client.sign_in(NODAL).get(CASES).json()

        assert sorted(refs(body)) == ["CMP-2026-0001", "CMP-2026-0002", "CMP-2026-0005"]
        assert "CMP-2026-0004" not in refs(body)

    def test_the_total_counts_only_what_the_caller_may_read(self, icms_client, cases):
        """Counted over the scoped selectable. A count taken before the scope is
        applied reports rows the caller cannot read — a leak with a number on it."""
        body = icms_client.sign_in(NODAL).get(CASES).json()

        assert body["total"] == 3
        assert body["pages"] == 1

    def test_a_filter_cannot_widen_the_scope(self, icms_client, cases):
        body = icms_client.sign_in(NODAL).get(CASES, params={"zone_cd": "RURAL"}).json()

        assert body["items"] == []
        assert body["total"] == 0

    def test_a_search_cannot_widen_the_scope(self, icms_client, cases):
        body = icms_client.sign_in(NODAL).get(CASES, params={"q": "Kheria"}).json()

        assert body["total"] == 0

    def test_a_surveyor_sees_their_own_zone(self, icms_client, cases):
        body = icms_client.sign_in(SURVEYOR).get(CASES).json()

        assert refs(body) == ["CMP-2026-0003"]

    def test_an_officer_with_no_assignment_sees_an_empty_register(
        self, icms_client, zones, assignments, db
    ):
        from ada_core.models_icms import Case

        db.add(Case(case_ref="CMP-2026-0009", zone_id=zones["TAJ"].id,
                    source="public", status="raised", stage_no=1))
        db.commit()

        body = icms_client.sign_in(LEAD).get(CASES).json()

        assert body["items"] == []
        assert body["total"] == 0


# ------------------------------------------------ the surveyor's own register
class TestTheSurveyorSeesOnlyTheirOwnCases:
    """A zone is what an officer may see; an assignment is what a surveyor works.

    The inspection register has drawn this line since Batch 3
    (`inspections._own_rounds_only`). Without the same clause here a surveyor
    covering a zone reads every complainant, owner and phone number in it.
    """

    def test_a_surveyor_lists_only_the_cases_assigned_to_them(
        self, icms_client, surveyor_in_taj
    ):
        body = icms_client.sign_in(SURVEYOR).get(CASES, params={"size": 200}).json()

        assert refs(body) == ["CMP-2026-0003"]

    def test_the_total_is_narrowed_with_the_rows(self, icms_client, surveyor_in_taj):
        """Counted over the narrowed selectable, so the count cannot report the
        colleagues' cases the page does not carry."""
        body = icms_client.sign_in(SURVEYOR).get(CASES).json()

        assert body["total"] == 1

    def test_the_narrowing_is_not_a_filter_the_client_can_drop(
        self, icms_client, surveyor_in_taj
    ):
        """`mine` is a request. This is not: omitting it, or sending it false,
        leaves the register exactly as narrow."""
        client = icms_client.sign_in(SURVEYOR)

        assert refs(client.get(CASES).json()) == ["CMP-2026-0003"]
        assert refs(client.get(CASES, params={"mine": "false"}).json()) == ["CMP-2026-0003"]

    def test_a_filter_naming_another_surveyor_returns_nothing(
        self, icms_client, surveyor_in_taj
    ):
        body = icms_client.sign_in(SURVEYOR).get(
            CASES, params={"assignee_user_id": SURVEYOR_B_ID}).json()

        assert body["items"] == []
        assert body["total"] == 0

    def test_a_search_cannot_reach_a_colleagues_case(self, icms_client, surveyor_in_taj):
        body = icms_client.sign_in(SURVEYOR).get(CASES, params={"q": "Asha"}).json()

        assert body["total"] == 0

    def test_a_nodal_officer_still_sees_every_case_in_their_zones(
        self, icms_client, surveyor_in_taj
    ):
        """Several officers work one case at different stages, so the narrowing
        is the Field Surveyor's alone."""
        body = icms_client.sign_in(NODAL).get(CASES).json()

        assert sorted(refs(body)) == ["CMP-2026-0001", "CMP-2026-0002", "CMP-2026-0005"]

    def test_a_supervising_officer_is_not_narrowed_by_also_being_a_surveyor(
        self, icms_client, surveyor_in_taj
    ):
        """The same test the inspection register makes: the narrowing is for a
        Field Surveyor holding no supervisory role, and the two must not drift."""
        body = icms_client.sign_in(SURVEYOR, NODAL).get(CASES).json()

        assert sorted(refs(body)) == [
            "CMP-2026-0001", "CMP-2026-0002", "CMP-2026-0003", "CMP-2026-0005"]

    def test_mine_still_filters_for_an_officer_who_sees_more_than_their_own(
        self, icms_client, surveyor_in_taj
    ):
        body = icms_client.sign_in(SURVEYOR, NODAL).get(
            CASES, params={"mine": "true"}).json()

        assert refs(body) == ["CMP-2026-0003"]


# ------------------------------------------------------ paging and sorting
class TestPagingAndSorting:
    def test_the_default_sort_is_newest_first(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES).json()

        assert body["sort"] == "-raised_at"
        assert refs(body)[0] == "CMP-2026-0005"

    def test_sorting_by_a_whitelisted_column(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"sort": "case_ref"}).json()

        assert refs(body) == sorted(refs(body))

    def test_sorting_by_the_zone_label(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"sort": "zone_cd"}).json()

        assert body["sort"] == "zone_cd"
        assert body["items"][0]["zone_cd"] == "CANT"

    def test_an_unknown_sort_key_is_refused_with_the_legal_ones(self, icms_client, cases):
        response = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"sort": "parcel_id"})

        assert response.status_code == 400
        error = error_of(response)
        assert error["code"] == "unknown_sort_field"
        assert error["allowed"] == [
            "case_ref", "complainant_name", "complaint_type_cd", "khasra_no",
            "priority", "property_address", "raised_at", "stage_no", "status",
            "ulpin", "updated_at", "zone_cd",
        ]

    def test_a_page_reports_the_total_beyond_it(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"size": 2}).json()

        assert len(body["items"]) == 2
        assert (body["total"], body["pages"], body["next_cursor"]) == (5, 3, "2")

    def test_the_last_page_offers_no_cursor(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"size": 2, "page": 3}).json()

        assert len(body["items"]) == 1
        assert body["next_cursor"] is None

    def test_a_page_past_the_end_still_knows_the_total(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"size": 2, "page": 50}).json()

        assert body["items"] == []
        assert (body["total"], body["pages"]) == (5, 3)

    def test_pages_do_not_overlap(self, icms_client, cases):
        """Compound sorts, `(column, id)`. Ordering by a column with ties and no
        tie-break lets a row appear on two pages while another never appears."""
        client = icms_client.sign_in(SUPER_ADMIN)
        seen: list[str] = []
        for page in (1, 2, 3):
            seen += refs(client.get(CASES, params={"size": 2, "page": page,
                                                   "sort": "status"}).json())

        assert len(seen) == len(set(seen)) == 5

    def test_the_total_is_correct_under_a_filter(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"status": "assigned", "size": 1}).json()

        assert len(body["items"]) == 1
        assert body["total"] == 2

    def test_the_size_ceiling_is_enforced(self, icms_client, cases):
        response = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"size": 5000})

        assert response.status_code == 422


# ------------------------------------------------------------ the doorway
class TestAccess:
    def test_no_token_is_refused(self, anonymous_client, cases):
        response = anonymous_client.get(CASES)

        assert response.status_code == 401
        assert error_of(response)["code"] == "unauthenticated"

    def test_a_caller_with_no_icms_role_is_refused(self, icms_client, cases):
        response = icms_client.sign_in().get(CASES)

        assert response.status_code == 403
        assert error_of(response)["code"] == "role_not_permitted"

    def test_every_icms_role_may_read_the_register(self, icms_client, cases):
        for role in (SUPER_ADMIN, NODAL, SURVEYOR, LEAD):
            assert icms_client.sign_in(role).get(CASES).status_code == 200, role


# ------------------------------------- what revision 0002 made possible
class TestParcelAndPriority:
    """The three grid controls that had no columns behind them until 0002.

    `Parcel ID`, the `All Priorities` dropdown, and the half of the search box
    labelled "Search parcel / Khasra No." — all shipped as unrenderable in Batch
    2 and all reachable now.
    """

    def test_filtering_by_priority(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"priority": "high"}).json()

        assert sorted(refs(body)) == ["CMP-2026-0001", "CMP-2026-0004"]
        assert body["total"] == 2

    def test_repeated_priorities_or_together(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params=[("priority", "high"), ("priority", "low")]).json()

        assert body["total"] == 3

    def test_an_unknown_priority_is_refused(self, icms_client, cases):
        """Not silently matched against nothing. `urgent` is not a value the
        CHECK constraint would accept either."""
        response = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"priority": "urgent"})

        assert response.status_code == 422
        assert error_of(response)["code"] == "validation_failed"

    def test_priority_sorts_by_urgency_not_alphabetically(self, icms_client, cases):
        """Alphabetical order is high, low, medium — the right answer to the
        wrong question. The officer asked for the urgent ones first."""
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"sort": "priority"}).json()
        order = [item["priority"] for item in body["items"]]

        assert order[:2] == ["high", "high"]
        assert order[2:4] == ["medium", "low"]

    def test_unprioritised_cases_sort_last(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"sort": "priority"}).json()

        assert body["items"][-1]["priority"] is None
        assert body["items"][-1]["case_ref"] == "CMP-2026-0005"

    def test_reversing_the_priority_sort(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"sort": "-priority"}).json()

        assert body["sort"] == "-priority"
        assert body["items"][0]["priority"] is None

    def test_the_parcel_id_cell_prefers_the_national_identifier(self, icms_client, cases):
        rows = {item["case_ref"]: item for item in
                icms_client.sign_in(SUPER_ADMIN).get(CASES).json()["items"]}

        assert rows["CMP-2026-0001"]["parcel_id"] == "AB12CD34EF56GH"

    def test_the_parcel_id_cell_falls_back_to_village_and_khasra(self, icms_client, cases):
        """ULPIN rollout in Uttar Pradesh is partial, so the fallback is the
        normal case rather than the exception."""
        rows = {item["case_ref"]: item for item in
                icms_client.sign_in(SUPER_ADMIN).get(CASES).json()["items"]}

        assert rows["CMP-2026-0002"]["parcel_id"] == "071234/127/1/2"

    def test_a_case_with_no_parcel_has_no_parcel_id(self, icms_client, cases):
        rows = {item["case_ref"]: item for item in
                icms_client.sign_in(SUPER_ADMIN).get(CASES).json()["items"]}

        assert rows["CMP-2026-0005"]["parcel_id"] is None

    def test_the_raw_parcel_columns_come_back_beside_the_display_string(
        self, icms_client, cases
    ):
        """A client linking to Bhulekh needs the village code and the khasra
        separately, not a display string it has to take apart again."""
        rows = {item["case_ref"]: item for item in
                icms_client.sign_in(SUPER_ADMIN).get(CASES).json()["items"]}

        assert rows["CMP-2026-0002"]["village_lgd_code"] == "071234"
        assert rows["CMP-2026-0002"]["khasra_no"] == "127/1/2"

    def test_the_search_box_finds_a_khasra_number(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"q": "127/1"}).json()

        assert refs(body) == ["CMP-2026-0002"]

    def test_the_search_box_finds_a_ulpin(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"q": "AB12CD34"}).json()

        assert refs(body) == ["CMP-2026-0001"]

    def test_filtering_by_exact_khasra(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"khasra_no": "50/1"}).json()

        assert refs(body) == ["CMP-2026-0001"]

    def test_filtering_by_village(self, icms_client, cases):
        """The practical parcel key is the pair, so the village filter is the
        half an officer actually has when working a revenue village."""
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"village_lgd_code": "071234"}).json()

        assert sorted(refs(body)) == ["CMP-2026-0001", "CMP-2026-0002"]

    def test_filtering_by_ulpin(self, icms_client, cases):
        body = icms_client.sign_in(SUPER_ADMIN).get(
            CASES, params={"ulpin": "AB12CD34EF56GH"}).json()

        assert refs(body) == ["CMP-2026-0001"]

    def test_sorting_by_khasra_is_available(self, icms_client, cases):
        response = icms_client.sign_in(SUPER_ADMIN).get(CASES, params={"sort": "khasra_no"})

        assert response.status_code == 200

    def test_the_parcel_filters_cannot_widen_the_scope(self, icms_client, cases):
        """CMP-2026-0004 is in RURAL, which the nodal officer cannot see, and
        shares a village code with a case in CANT."""
        body = icms_client.sign_in(NODAL).get(
            CASES, params={"village_lgd_code": "079999"}).json()

        assert body["items"] == []
        assert body["total"] == 0
