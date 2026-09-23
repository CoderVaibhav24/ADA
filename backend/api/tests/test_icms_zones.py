"""ICMS Batch 1 — zones, and the zone scope that decides who sees them.

`icms_zone_assignment` has existed since Batch 0 and was read by nothing. These
tests are the first thing that holds it to account, so they are as much about
the authorisation model as about the endpoints: the fixtures give the nodal
officer TAJ, the surveyor CANT, and nobody RURAL, and RURAL is therefore the row
that a scoping failure would leak.
"""

from __future__ import annotations

from tests.conftest import LEAD, NODAL, SQUARE, SUPER_ADMIN, SURVEYOR
from tests.test_icms_reference import error_of

ZONES = "/api/icms/zones"


def codes(body) -> list[str]:
    return [item["zone_cd"] for item in body["items"]]


# ---------------------------------------------------------------- the list
class TestListZones:
    def test_a_super_admin_sees_every_active_zone(self, icms_client, zones, assignments):
        body = icms_client.sign_in(SUPER_ADMIN).get(ZONES).json()

        assert sorted(codes(body)) == ["CANT", "RURAL", "TAJ"]
        assert body["total"] == 3

    def test_an_officer_sees_only_the_zones_assigned_to_them(
        self, icms_client, zones, assignments
    ):
        body = icms_client.sign_in(NODAL).get(ZONES).json()

        assert codes(body) == ["TAJ"]
        assert "RURAL" not in codes(body)

    def test_the_total_counts_only_what_the_caller_may_read(
        self, icms_client, zones, assignments
    ):
        """The count is taken over the scoped selectable. A count taken before
        the scope is applied reports rows the caller is not allowed to read,
        which is an information leak with a number attached."""
        body = icms_client.sign_in(NODAL).get(ZONES).json()

        assert body["total"] == 1
        assert body["pages"] == 1

    def test_a_revoked_assignment_grants_nothing(self, icms_client, zones, assignments):
        """The surveyor's RURAL assignment is closed. History, not permission."""
        body = icms_client.sign_in(SURVEYOR).get(ZONES).json()

        assert codes(body) == ["CANT"]

    def test_an_officer_with_no_assignment_sees_an_empty_register(
        self, icms_client, zones, assignments
    ):
        """Not the whole district. An unassigned officer seeing everything is
        the direction a permissions bug must not fail in."""
        body = icms_client.sign_in(LEAD).get(ZONES).json()

        assert body["items"] == []
        assert body["total"] == 0

    def test_a_filter_cannot_widen_the_scope(self, icms_client, zones, assignments):
        """Asking for a zone by code does not get it if it is not yours."""
        body = icms_client.sign_in(NODAL).get(ZONES, params={"zone_cd": "RURAL"}).json()

        assert body["items"] == []
        assert body["total"] == 0

    def test_inactive_zones_are_hidden_unless_asked_for(self, icms_client, zones):
        client = icms_client.sign_in(SUPER_ADMIN)

        assert "OLD" not in codes(client.get(ZONES).json())
        assert codes(client.get(ZONES, params={"active": "false"}).json()) == ["OLD"]

    def test_the_list_carries_no_geometry(self, icms_client, zones):
        """A boundary is tens of kilobytes and a page of them is a megabyte the
        dropdown asking for it will not draw."""
        body = icms_client.sign_in(SUPER_ADMIN).get(ZONES).json()

        assert all("geometry" not in item for item in body["items"])
        assert {item["zone_cd"]: item["has_geometry"] for item in body["items"]}["TAJ"]

    def test_search_matches_the_name(self, icms_client, zones):
        body = icms_client.sign_in(SUPER_ADMIN).get(ZONES, params={"q": "ganj"}).json()

        assert codes(body) == ["TAJ"]

    def test_the_sort_whitelist_refuses_a_column_it_does_not_publish(
        self, icms_client, zones
    ):
        response = icms_client.sign_in(SUPER_ADMIN).get(ZONES, params={"sort": "geom"})

        assert response.status_code == 400
        assert error_of(response)["allowed"] == [
            "created_at", "name", "updated_at", "zone_cd"]

    def test_an_unknown_filter_is_refused(self, icms_client, zones):
        response = icms_client.sign_in(SUPER_ADMIN).get(ZONES, params={"zone": "TAJ"})

        assert response.status_code == 422
        assert error_of(response)["field"] == "zone"

    def test_no_token_is_refused(self, anonymous_client, zones):
        assert anonymous_client.get(ZONES).status_code == 401

    def test_a_caller_with_no_icms_role_is_refused(self, icms_client, zones):
        assert icms_client.sign_in().get(ZONES).status_code == 403


# --------------------------------------------------------------- the detail
class TestZoneDetail:
    def test_the_boundary_comes_back_as_geojson(self, icms_client, zones):
        body = icms_client.sign_in(SUPER_ADMIN).get(f"{ZONES}/TAJ").json()

        assert body["geometry"]["type"] == "MultiPolygon"
        assert body["geometry"]["coordinates"][0] == SQUARE["coordinates"]
        assert body["name_hi"] == "ताजगंज"

    def test_a_zone_with_no_boundary_answers_null_rather_than_failing(
        self, icms_client, zones
    ):
        body = icms_client.sign_in(SUPER_ADMIN).get(f"{ZONES}/RURAL").json()

        assert body["geometry"] is None
        assert body["has_geometry"] is False

    def test_an_assigned_officer_may_read_their_zone(self, icms_client, zones, assignments):
        assert icms_client.sign_in(NODAL).get(f"{ZONES}/TAJ").status_code == 200

    def test_a_zone_outside_the_scope_is_indistinguishable_from_absent(
        self, icms_client, zones, assignments
    ):
        """404 rather than 403. Separating the two tells an officer which zone
        codes exist, which is a small leak repeated over a district."""
        mine = icms_client.sign_in(NODAL).get(f"{ZONES}/RURAL")
        missing = icms_client.sign_in(NODAL).get(f"{ZONES}/NOSUCH")

        assert mine.status_code == missing.status_code == 404
        assert error_of(mine)["code"] == error_of(missing)["code"] == "zone_not_found"

    def test_no_token_is_refused(self, anonymous_client, zones):
        assert anonymous_client.get(f"{ZONES}/TAJ").status_code == 401


# --------------------------------------------------------------- the writes
class TestCreateZone:
    def test_a_super_admin_creates_a_zone(self, icms_client, zones):
        response = icms_client.sign_in(SUPER_ADMIN).post(
            ZONES,
            json={"zone_cd": "SIKANDRA", "name": "Sikandra", "geometry": SQUARE},
        )

        assert response.status_code == 201
        body = response.json()
        assert body["zone_cd"] == "SIKANDRA"
        # A Polygon is stored as the single-part MultiPolygon the column is
        # typed for, so what comes back is not what went in and should not be.
        assert body["geometry"]["type"] == "MultiPolygon"
        assert body["geometry"]["coordinates"] == [SQUARE["coordinates"]]

    def test_the_created_zone_is_readable_afterwards(self, icms_client, zones):
        client = icms_client.sign_in(SUPER_ADMIN)
        client.post(ZONES, json={"zone_cd": "SIKANDRA", "name": "Sikandra"})

        assert client.get(f"{ZONES}/SIKANDRA").status_code == 200

    def test_a_duplicate_code_is_a_conflict(self, icms_client, zones):
        response = icms_client.sign_in(SUPER_ADMIN).post(
            ZONES, json={"zone_cd": "TAJ", "name": "Taj Ganj again"})

        assert response.status_code == 409
        error = error_of(response)
        assert (error["code"], error["field"]) == ("zone_exists", "zone_cd")

    def test_case_is_preserved_in_the_natural_key(self, icms_client, zones):
        """`zone_cd` is a natural key carried over from the legacy `zone` table.
        Lower-casing it at the edge would turn a lookup for a migrated `ZN01`
        into a silent 404."""
        icms_client.sign_in(SUPER_ADMIN).post(ZONES, json={"zone_cd": "ZN01", "name": "Z"})

        assert icms_client.get(f"{ZONES}/ZN01").json()["zone_cd"] == "ZN01"

    def test_a_ring_that_does_not_close_is_refused(self, icms_client, zones):
        response = icms_client.sign_in(SUPER_ADMIN).post(
            ZONES,
            json={
                "zone_cd": "BROKEN", "name": "Broken",
                "geometry": {"type": "Polygon",
                             "coordinates": [[[78.0, 27.0], [78.1, 27.0], [78.1, 27.1]]]},
            },
        )

        assert response.status_code == 422
        assert error_of(response)["code"] == "validation_failed"

    def test_an_unknown_body_field_is_refused(self, icms_client, zones):
        response = icms_client.sign_in(SUPER_ADMIN).post(
            ZONES, json={"zone_cd": "X1", "name": "X", "srid": 32644})

        assert response.status_code == 422
        assert error_of(response)["field"] == "srid"

    def test_every_role_but_super_admin_is_refused(self, icms_client, zones):
        for role in (NODAL, SURVEYOR, LEAD):
            response = icms_client.sign_in(role).post(
                ZONES, json={"zone_cd": f"NEW{role[:3]}", "name": "New"})

            assert response.status_code == 403, role
            assert error_of(response)["allowed"] == [SUPER_ADMIN]

    def test_no_token_is_refused(self, anonymous_client, zones):
        response = anonymous_client.post(ZONES, json={"zone_cd": "X", "name": "X"})

        assert response.status_code == 401


class TestUpdateZone:
    def test_a_super_admin_replaces_the_attributes(self, icms_client, zones):
        response = icms_client.sign_in(SUPER_ADMIN).put(
            f"{ZONES}/CANT", json={"name": "Agra Cantonment", "active": False})

        assert response.status_code == 200
        assert response.json()["name"] == "Agra Cantonment"
        assert response.json()["active"] is False

    def test_omitting_the_geometry_leaves_the_boundary_alone(self, icms_client, zones):
        """Omission meaning null would delete a surveyed boundary every time
        somebody renames a zone from a form that does not carry the polygon."""
        client = icms_client.sign_in(SUPER_ADMIN)
        client.put(f"{ZONES}/TAJ", json={"name": "Taj Ganj East"})

        assert client.get(f"{ZONES}/TAJ").json()["geometry"] is not None

    def test_sending_a_null_geometry_clears_it(self, icms_client, zones):
        client = icms_client.sign_in(SUPER_ADMIN)
        client.put(f"{ZONES}/TAJ", json={"name": "Taj Ganj", "geometry": None})

        assert client.get(f"{ZONES}/TAJ").json()["geometry"] is None

    def test_the_update_timestamp_moves(self, icms_client, zones):
        """`icms_zone` has no BEFORE UPDATE touch trigger, so the repository
        sets it. The ORM's `default=` would not: that applies on INSERT only."""
        client = icms_client.sign_in(SUPER_ADMIN)
        before = client.get(f"{ZONES}/CANT").json()["updated_at"]

        after = client.put(f"{ZONES}/CANT", json={"name": "Renamed"}).json()["updated_at"]

        assert after >= before

    def test_an_unknown_zone_is_a_404(self, icms_client, zones):
        response = icms_client.sign_in(SUPER_ADMIN).put(
            f"{ZONES}/NOSUCH", json={"name": "Nowhere"})

        assert response.status_code == 404
        assert error_of(response)["code"] == "zone_not_found"

    def test_a_name_is_required(self, icms_client, zones):
        response = icms_client.sign_in(SUPER_ADMIN).put(f"{ZONES}/TAJ", json={})

        assert response.status_code == 422
        assert error_of(response)["field"] == "name"

    def test_every_role_but_super_admin_is_refused(self, icms_client, zones):
        for role in (NODAL, SURVEYOR, LEAD):
            response = icms_client.sign_in(role).put(f"{ZONES}/TAJ", json={"name": "Mine"})

            assert response.status_code == 403, role

    def test_a_refused_update_changes_nothing(self, icms_client, zones):
        icms_client.sign_in(NODAL).put(f"{ZONES}/TAJ", json={"name": "Mine"})

        assert icms_client.sign_in(SUPER_ADMIN).get(
            f"{ZONES}/TAJ").json()["name"] == "Taj Ganj"

    def test_no_token_is_refused(self, anonymous_client, zones):
        assert anonymous_client.put(f"{ZONES}/TAJ", json={"name": "X"}).status_code == 401
