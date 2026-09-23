"""ICMS Batch 5 — the dashboard panels and the bbox-bounded case map.

Two questions run through every test here, and they are the two the register
already answers: what does this caller's zone scope let them count, and what
does the field-surveyor narrowing take off that.

The decision the narrowing tests pin is that a surveyor's dashboard counts THEIR
cases, not their zone's. `dashboard.read` is granted to nobody holding only
`field-surveyor` in the seed, so the fixture that grants it is the one place in
this suite where the policy table is edited — and the numbers it then produces
are the ones an administrator would get by granting it for real.
"""

from __future__ import annotations

import json
from datetime import timedelta

import pytest
from ada_core.datetimes import now_ist

from tests.conftest import (
    LEAD,
    NODAL,
    SUPER_ADMIN,
    SUPER_ADMIN_ID,
    SURVEYOR,
    SURVEYOR_B_ID,
)
from tests.contract import (
    CASE_FEATURE,
    CASE_FEATURE_COLLECTION,
    CASE_FEATURE_PROPS,
    DASHBOARD_SUMMARY,
    DASHBOARD_TREND,
    MAP_WINDOW,
    STATUS_COUNT,
    TREND_POINT,
    TYPE_COUNT,
    ZONE_COUNT,
    assert_error,
    assert_shape,
)

ICMS = "/api/icms"
SUMMARY = f"{ICMS}/dashboard/summary"
TREND = f"{ICMS}/dashboard/trend"
BY_TYPE = f"{ICMS}/dashboard/by-type"
BY_ZONE = f"{ICMS}/dashboard/by-zone"
MAP = f"{ICMS}/cases.geojson"

# The square the fixture drops its markers in, and one a degree away from it.
BOX = "78.00,27.00,78.02,27.02"
ELSEWHERE = "79.00,28.00,79.02,28.02"

PANELS = [SUMMARY, TREND, BY_TYPE, BY_ZONE, f"{MAP}?bbox={BOX}"]


def _point(lon: float, lat: float) -> str:
    return json.dumps({"type": "Point", "coordinates": [lon, lat]})


@pytest.fixture
def dashboard_world(db, zones, assignments, cases, code_values):
    """The five seeded cases, plus the row the narrowing turns on, plus locations.

    CMP-2026-0009 sits in CANT — the surveyor's zone — and is assigned to nobody,
    so "their zone" and "their cases" are different numbers and a test can tell
    which of the two a panel counted. CMP-2026-0004 stays in RURAL, which nobody
    holds, and goes on being the row a scoping failure would leak.
    """
    from ada_core.models_icms import Case

    extra = Case(
        case_ref="CMP-2026-0009", zone_id=zones["CANT"].id, source="public",
        status="raised", stage_no=1, complaint_type_cd="encroachment",
        complainant_name="Ira Bose", property_address="2 Cantt Road", priority="high",
        raised_at=cases["CMP-2026-0001"].raised_at, created_by=SUPER_ADMIN_ID,
        location=_point(78.007, 27.007),
    )
    db.add(extra)

    for ref, lon, lat in (
        ("CMP-2026-0001", 78.005, 27.005),   # TAJ, inside BOX
        ("CMP-2026-0002", 78.500, 27.500),   # TAJ, outside BOX
        ("CMP-2026-0003", 78.004, 27.004),   # CANT, inside BOX, the surveyor's
        ("CMP-2026-0004", 78.006, 27.006),   # RURAL, inside BOX, nobody's
    ):
        cases[ref].location = _point(lon, lat)
    db.commit()
    db.refresh(extra)
    return {**cases, "CMP-2026-0009": extra}


@pytest.fixture
def surveyor_reads_the_dashboard(db, policy_tables):
    """Grants `field-surveyor` the permission an administrator could grant it.

    The seed does not, so without this every panel answers 403 to a surveyor and
    the narrowing below would be untestable — and untested narrowing is how the
    23 September audit came to find six places leaning on zone scope alone.
    """
    from ada_core.models_icms import RolePermission

    from app.icms import policy

    db.add(RolePermission(role_cd=SURVEYOR, permission_cd="dashboard.read"))
    db.commit()
    return policy.reload(db)


@pytest.fixture
def trend_world(db, zones, assignments):
    """Five cases placed relative to today, so the window assertions do not rot.

    Fixed dates would pass this week and fail in November. Three TAJ cases land
    inside the default thirty days, one sits forty days back — the row that says
    the window is a window — and one is in RURAL, which nobody holds.
    """
    from ada_core.models_icms import Case

    today = now_ist()
    rows = [
        Case(case_ref=f"CMP-2026-01{index:02d}", zone_id=zones[zone].id,
             source="public", status=status, stage_no=1,
             complaint_type_cd="encroachment", property_address="A place",
             raised_at=today - timedelta(days=age))
        for index, (age, zone, status) in enumerate([
            (0, "TAJ", "raised"),
            (1, "TAJ", "closed"),
            (9, "TAJ", "raised"),
            (40, "TAJ", "raised"),
            (2, "RURAL", "raised"),
        ])
    ]
    db.add_all(rows)
    db.commit()
    return rows


def read(client, path, role=NODAL, **params):
    return client.sign_in(role).get(path, params=params)


# ------------------------------------------------------------- the counters
class TestSummary:
    def test_the_cards_count_the_whole_register_for_an_unrestricted_caller(
        self, icms_client, dashboard_world
    ):
        body = read(icms_client, SUMMARY, SUPER_ADMIN).json()

        assert (body["total"], body["open"], body["closed"], body["rejected"]) == (6, 5, 1, 0)
        assert body["high_priority"] == 3

    def test_zone_scope_narrows_the_numbers(self, icms_client, dashboard_world):
        """The nodal officer holds TAJ alone: three cases, not six."""
        body = read(icms_client, SUMMARY, NODAL).json()

        assert (body["total"], body["open"], body["closed"]) == (3, 2, 1)
        assert body["high_priority"] == 1

    def test_the_per_status_table_sums_to_the_total(self, icms_client, dashboard_world):
        body = read(icms_client, SUMMARY, SUPER_ADMIN).json()

        assert sum(row["count"] for row in body["by_status"]) == body["total"]
        assert {row["status"] for row in body["by_status"]} == {"raised", "assigned", "closed"}

    def test_a_status_nobody_is_in_is_absent_rather_than_zero(self, icms_client,
                                                              dashboard_world):
        """The table is what the register holds, not the vocabulary it could hold."""
        body = read(icms_client, SUMMARY, SUPER_ADMIN).json()

        assert "verified" not in {row["status"] for row in body["by_status"]}

    def test_an_officer_with_no_zone_counts_nothing(self, icms_client, zones,
                                                    assignments, code_values):
        """Not the whole district. An unassigned officer is the direction a
        permissions bug must not fail in."""
        body = read(icms_client, SUMMARY, LEAD).json()

        assert (body["total"], body["by_status"]) == (0, [])


class TestTheSurveyorNarrowing:
    def test_a_surveyor_counts_their_own_cases_and_not_their_zone(
        self, icms_client, dashboard_world, surveyor_reads_the_dashboard
    ):
        """CANT holds two cases and one of them is theirs. The answer is one.

        Two would mean the dashboard had been given the zone and not the
        assignment, which is the aggregate form of the leak the case register was
        narrowed to close on 23 September.
        """
        body = read(icms_client, SUMMARY, SURVEYOR).json()

        assert body["total"] == 1
        assert [row["status"] for row in body["by_status"]] == ["assigned"]

    def test_the_zone_breakdown_narrows_with_it(self, icms_client, dashboard_world,
                                                surveyor_reads_the_dashboard):
        body = read(icms_client, BY_ZONE, SURVEYOR).json()

        assert [(row["zone_cd"], row["total"]) for row in body] == [("CANT", 1)]

    def test_the_map_narrows_with_it(self, icms_client, dashboard_world,
                                     surveyor_reads_the_dashboard):
        body = read(icms_client, MAP, SURVEYOR, bbox=BOX).json()

        assert [f["id"] for f in body["features"]] == ["CMP-2026-0003"]
        assert body["metadata"]["total"] == 1

    def test_a_supervisory_role_beside_it_is_not_narrowed(
        self, icms_client, dashboard_world, surveyor_reads_the_dashboard
    ):
        """Surveyor B holds TAJ and one case in it. As a surveyor they see that
        one; with a nodal officer's role beside it they supervise all three."""
        client = icms_client.sign_in(SURVEYOR, subject=SURVEYOR_B_ID)
        alone = client.get(SUMMARY).json()["total"]
        supervising = icms_client.sign_in(
            SURVEYOR, NODAL, subject=SURVEYOR_B_ID).get(SUMMARY).json()["total"]

        assert (alone, supervising) == (1, 3)

    def test_the_helper_agrees_with_the_two_registers(self):
        """One rule in three modules. A role added to one set must reach all three."""
        from app.icms import cases as case_repo
        from app.icms import dashboard as panel
        from app.icms import inspections as inspection_repo

        for roles in ([SURVEYOR], [SURVEYOR, NODAL], [NODAL], [SUPER_ADMIN],
                      [SURVEYOR, SUPER_ADMIN], [SURVEYOR, LEAD], [], ["offline_access"]):
            assert (panel._own_cases_only(roles)
                    == case_repo._own_cases_only(roles)
                    == inspection_repo._own_rounds_only(roles)), roles


# ---------------------------------------------------------------- the trend
class TestTrend:
    def test_the_default_window_is_thirty_days_of_day_buckets(self, icms_client,
                                                              trend_world):
        body = read(icms_client, TREND, NODAL).json()

        assert (body["bucket"], body["days"]) == ("day", 30)
        assert len(body["points"]) == 30
        assert body["end"] == now_ist().date().isoformat()

    def test_a_case_older_than_the_window_is_not_counted(self, icms_client, trend_world):
        """Three of the four TAJ cases are inside thirty days; the fourth is not."""
        body = read(icms_client, TREND, NODAL).json()

        assert sum(point["raised"] for point in body["points"]) == 3

    def test_a_wider_window_reaches_it(self, icms_client, trend_world):
        body = read(icms_client, TREND, NODAL, days=60).json()

        assert sum(point["raised"] for point in body["points"]) == 4
        assert len(body["points"]) == 60

    def test_empty_buckets_are_zeroes_rather_than_missing_keys(self, icms_client,
                                                               trend_world):
        body = read(icms_client, TREND, NODAL).json()
        periods = [point["period"] for point in body["points"]]

        assert periods == sorted(periods), "the series must be in order to be drawn"
        assert len(set(periods)) == len(periods)
        assert any(point["raised"] == 0 for point in body["points"])

    def test_resolved_is_the_cohort_and_not_the_closures_of_the_day(self, icms_client,
                                                                    trend_world):
        body = read(icms_client, TREND, NODAL).json()

        assert sum(point["resolved"] for point in body["points"]) == 1

    def test_zone_scope_narrows_the_trend(self, icms_client, trend_world):
        """The RURAL case is inside the window and outside the officer's authority."""
        nodal = sum(p["raised"] for p in read(icms_client, TREND, NODAL).json()["points"])
        admin = sum(
            p["raised"] for p in read(icms_client, TREND, SUPER_ADMIN).json()["points"])

        assert (nodal, admin) == (3, 4)

    @pytest.mark.parametrize("bucket,most", [("day", 31), ("week", 6), ("month", 3)])
    def test_a_wider_bucket_returns_fewer_points(self, icms_client, trend_world,
                                                 bucket, most):
        body = read(icms_client, TREND, NODAL, days=31, bucket=bucket).json()

        assert 0 < len(body["points"]) <= most
        assert sum(point["raised"] for point in body["points"]) == 3

    def test_a_month_bucket_is_labelled_with_the_first_of_the_month(self, icms_client,
                                                                    trend_world):
        body = read(icms_client, TREND, NODAL, days=31, bucket="month").json()

        assert all(point["period"].endswith("-01") for point in body["points"])

    @pytest.mark.parametrize("params,field", [
        ({"days": 0}, "days"), ({"days": 366}, "days"), ({"days": "many"}, "days"),
        ({"bucket": "year"}, "bucket"), ({"page": 2}, "page"),
    ])
    def test_a_window_outside_the_bounds_is_refused_by_name(self, icms_client,
                                                            trend_world, params, field):
        """A year is the ceiling. Past it the chart is a table scan with axes."""
        assert_error(f"GET {TREND}", str(params),
                     read(icms_client, TREND, NODAL, **params),
                     status=422, code="validation_failed", field=field)


# ----------------------------------------------------------- the breakdowns
class TestByType:
    def test_the_breakdown_is_labelled_from_the_lookup_table(self, icms_client,
                                                             dashboard_world):
        body = read(icms_client, BY_TYPE, NODAL).json()
        by_code = {row["complaint_type_cd"]: row for row in body}

        assert by_code["encroachment"]["total"] == 2
        assert by_code["encroachment"]["label"] == "Encroachment on public land"
        assert by_code["unauthorised_construction"]["total"] == 1

    def test_the_open_and_resolved_split_agrees_with_the_total(self, icms_client,
                                                               dashboard_world):
        for row in read(icms_client, BY_TYPE, SUPER_ADMIN).json():
            assert row["open"] + row["resolved"] == row["total"], row

    def test_zone_scope_narrows_the_breakdown(self, icms_client, dashboard_world):
        """`deviation_from_plan` is CANT's alone and must not reach a TAJ officer."""
        nodal = {row["complaint_type_cd"] for row in read(icms_client, BY_TYPE, NODAL).json()}
        admin = {
            row["complaint_type_cd"] for row in read(icms_client, BY_TYPE, SUPER_ADMIN).json()
        }

        assert "deviation_from_plan" in admin
        assert "deviation_from_plan" not in nodal

    def test_the_totals_agree_with_the_summary_card(self, icms_client, dashboard_world):
        """Two panels over the same rows. A client showing both must not see them differ."""
        card = read(icms_client, SUMMARY, NODAL).json()["total"]

        assert sum(row["total"] for row in read(icms_client, BY_TYPE, NODAL).json()) == card


class TestByZone:
    def test_the_breakdown_is_ordered_by_count(self, icms_client, dashboard_world):
        body = read(icms_client, BY_ZONE, SUPER_ADMIN).json()

        assert [(row["zone_cd"], row["total"]) for row in body] == [
            ("TAJ", 3), ("CANT", 2), ("RURAL", 1)]

    def test_zone_scope_narrows_the_breakdown(self, icms_client, dashboard_world):
        body = read(icms_client, BY_ZONE, NODAL).json()

        assert [row["zone_cd"] for row in body] == ["TAJ"]
        assert body[0]["zone_name"] == "Taj Ganj"

    def test_a_zone_the_caller_cannot_see_is_absent_and_not_zeroed(self, icms_client,
                                                                   dashboard_world):
        """A zero row would still say the zone exists and how many zones there are."""
        body = read(icms_client, BY_ZONE, NODAL).json()

        assert "RURAL" not in {row["zone_cd"] for row in body}


# ------------------------------------------------------------------ the map
class TestCasesGeoJson:
    def test_a_valid_bbox_returns_only_what_is_inside_it(self, icms_client,
                                                         dashboard_world):
        body = read(icms_client, MAP, SUPER_ADMIN, bbox=BOX).json()

        assert body["type"] == "FeatureCollection"
        assert sorted(f["id"] for f in body["features"]) == [
            "CMP-2026-0001", "CMP-2026-0003", "CMP-2026-0004", "CMP-2026-0009"]
        assert "CMP-2026-0002" not in {f["id"] for f in body["features"]}, "outside the box"

    def test_a_box_over_empty_ground_is_an_empty_collection(self, icms_client,
                                                            dashboard_world):
        body = read(icms_client, MAP, SUPER_ADMIN, bbox=ELSEWHERE).json()

        assert (body["features"], body["metadata"]["total"]) == ([], 0)

    def test_zone_scope_narrows_what_the_box_returns(self, icms_client, dashboard_world):
        """CMP-2026-0004 is inside the box and in RURAL, which nobody holds."""
        body = read(icms_client, MAP, NODAL, bbox=BOX).json()

        assert [f["id"] for f in body["features"]] == ["CMP-2026-0001"]
        assert body["metadata"]["total"] == 1

    def test_a_missing_bbox_is_refused_rather_than_scanning_the_district(
        self, icms_client, dashboard_world
    ):
        assert_error(f"GET {MAP}", "no bbox", icms_client.sign_in(NODAL).get(MAP),
                     status=422, code="validation_failed", field="bbox")

    @pytest.mark.parametrize("bad,clause", [
        ("70.0,20.0,80.0,30.0", "ten degrees a side"),
        ("78.0,27.0,79.5,27.5", "one and a half degrees wide"),
        ("78.02,27.0,78.00,27.02", "east of west"),
        ("78.0,27.02,78.02,27.00", "north of south"),
        ("78.0,27.0,78.02", "three numbers"),
        ("not,a,bounding,box", "not numbers"),
        ("", "empty"),
    ])
    def test_an_extent_outside_the_cap_is_refused_by_name(self, icms_client,
                                                          dashboard_world, bad, clause):
        assert_error(f"GET {MAP}", clause, read(icms_client, MAP, NODAL, bbox=bad),
                     status=422, code="validation_failed", field="bbox")

    def test_the_window_pages_and_the_total_does_not_move(self, icms_client,
                                                          dashboard_world):
        first = read(icms_client, MAP, SUPER_ADMIN, bbox=BOX, limit=2).json()
        second = read(icms_client, MAP, SUPER_ADMIN, bbox=BOX, limit=2, offset=2).json()

        assert (len(first["features"]), first["metadata"]["total"]) == (2, 4)
        assert (len(second["features"]), second["metadata"]["total"]) == (2, 4)
        assert not ({f["id"] for f in first["features"]}
                    & {f["id"] for f in second["features"]})

    def test_an_offset_past_the_end_still_reports_the_true_total(self, icms_client,
                                                                 dashboard_world):
        """A zero there would tell a client it had reached the end of nothing."""
        body = read(icms_client, MAP, SUPER_ADMIN, bbox=BOX, offset=99).json()

        assert (body["features"], body["metadata"]["total"]) == ([], 4)

    def test_a_limit_over_the_cap_is_refused(self, icms_client, dashboard_world):
        assert_error(f"GET {MAP}", "a limit past the cap",
                     read(icms_client, MAP, NODAL, bbox=BOX, limit=2001),
                     status=422, code="validation_failed", field="limit")

    def test_a_feature_carries_what_a_marker_needs_and_nothing_from_the_case_file(
        self, icms_client, dashboard_world
    ):
        body = read(icms_client, MAP, NODAL, bbox=BOX).json()
        feature = body["features"][0]

        assert feature["geometry"] == {"type": "Point", "coordinates": [78.005, 27.005]}
        assert set(feature["properties"]) == {
            "case_ref", "zone_cd", "status", "stage_no", "priority",
            "complaint_type_cd", "raised_at"}
        assert feature["properties"]["raised_at"].endswith("+05:30")

    def test_the_echoed_window_is_what_was_asked_for(self, icms_client, dashboard_world):
        body = read(icms_client, MAP, NODAL, bbox=BOX, limit=5, offset=0).json()

        assert body["metadata"]["bbox"] == [78.0, 27.0, 78.02, 27.02]
        assert (body["metadata"]["limit"], body["metadata"]["offset"]) == (5, 0)
        assert body["metadata"]["count"] == len(body["features"])


# --------------------------------------------------------------- the shapes
class TestTheShapes:
    """The nested rows the envelopes carry. `tests/contract.py` pins the top
    level of each panel through the OpenAPI suite; these are the rows inside it,
    which that suite unwraps past."""

    def test_the_summary_and_its_status_rows(self, icms_client, dashboard_world):
        body = read(icms_client, SUMMARY, SUPER_ADMIN).json()

        assert_shape(f"GET {SUMMARY}", "the summary", body, DASHBOARD_SUMMARY)
        for index, row in enumerate(body["by_status"]):
            assert_shape(f"GET {SUMMARY}", f"by_status[{index}]", row, STATUS_COUNT)

    def test_the_trend_and_its_points(self, icms_client, trend_world):
        body = read(icms_client, TREND, NODAL).json()

        assert_shape(f"GET {TREND}", "the trend", body, DASHBOARD_TREND)
        for index, point in enumerate(body["points"]):
            assert_shape(f"GET {TREND}", f"points[{index}]", point, TREND_POINT)

    def test_the_two_breakdowns_are_bare_lists_of_their_row(self, icms_client,
                                                            dashboard_world):
        for path, shape in ((BY_TYPE, TYPE_COUNT), (BY_ZONE, ZONE_COUNT)):
            body = read(icms_client, path, SUPER_ADMIN).json()

            assert isinstance(body, list) and body, f"GET {path} produced no rows to pin"
            for index, row in enumerate(body):
                assert_shape(f"GET {path}", f"[{index}]", row, shape)

    def test_the_collection_its_features_and_its_window(self, icms_client,
                                                        dashboard_world):
        body = read(icms_client, MAP, SUPER_ADMIN, bbox=BOX).json()

        assert_shape(f"GET {MAP}", "the collection", body, CASE_FEATURE_COLLECTION)
        assert_shape(f"GET {MAP}", "metadata", body["metadata"], MAP_WINDOW)
        for index, feature in enumerate(body["features"]):
            assert_shape(f"GET {MAP}", f"features[{index}]", feature, CASE_FEATURE)
            assert_shape(f"GET {MAP}", f"features[{index}].properties",
                         feature["properties"], CASE_FEATURE_PROPS)


# --------------------------------------------------------------- the refusal
class TestAuthorisation:
    @pytest.mark.parametrize("path", PANELS, ids=lambda p: p.split("?")[0])
    def test_a_caller_without_dashboard_read_is_refused(self, icms_client,
                                                        dashboard_world, path):
        """`field-surveyor` holds no `dashboard.read` in the seed, and the refusal
        names the roles that do rather than a permission code nobody can be given."""
        response = icms_client.sign_in(SURVEYOR).get(path)

        error = assert_error(path, "as a field surveyor", response,
                             status=403, code="role_not_permitted")
        assert error["allowed"] == ["ada-project-lead", "pcs-nodal-officer", "super-admin"]

    @pytest.mark.parametrize("path", PANELS, ids=lambda p: p.split("?")[0])
    def test_no_token_is_401_and_not_403(self, anonymous_client, path):
        assert_error(path, "no token", anonymous_client.get(path),
                     status=401, code="unauthenticated")

    @pytest.mark.parametrize("path", PANELS, ids=lambda p: p.split("?")[0])
    def test_every_role_that_holds_the_permission_reaches_it(self, icms_client,
                                                             dashboard_world, path):
        for role in (SUPER_ADMIN, NODAL, LEAD):
            assert icms_client.sign_in(role).get(path).status_code == 200, (
                f"{path} refused {role}")
