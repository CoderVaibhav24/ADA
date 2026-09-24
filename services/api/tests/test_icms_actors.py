"""Keycloak subjects become names on the way out, and never cost a failed read."""

from __future__ import annotations

from ada_core.models_icms import BoundaryImport

from app.errors import ApiError
from app.icms import actors
from app.icms.actors import display_name, fill_actor_names, resolve_actor_names
from tests.conftest import LEAD, LEAD_ID, NODAL, NODAL_ID, SUPER_ADMIN, SURVEYOR_ID
from tests.fake_keycloak import FakeKeycloak

ICMS = "/api/icms"
GONE = "99999999-0000-4000-8000-000000000099"
NO_COUNTS = {layer: {"inserted": 0, "updated": 0, "deactivated": 0, "rejected": 0}
             for layer in ("zones", "villages", "parcels", "reserved")}


# ------------------------------------------------------------------ the resolver
class TestDisplayName:
    def test_given_and_family_come_first(self):
        assert display_name({"firstName": "Asha", "lastName": "Verma",
                             "username": "asha", "email": "a@x.in"}) == "Asha Verma"

    def test_a_full_name_attribute_beats_the_parts(self):
        assert display_name({"name": "Dr Asha Verma", "firstName": "Asha"}) == "Dr Asha Verma"

    def test_then_the_username_then_the_email(self):
        assert display_name({"username": "asha"}) == "asha"
        assert display_name({"username": "a@x.in", "email": "a@x.in"}) == "a@x.in"

    def test_nothing_to_call_them_is_none(self):
        assert display_name({"username": " "}) is None


class TestResolve:
    def test_a_batch_is_deduplicated_and_one_lookup_per_subject(self):
        realm = FakeKeycloak()

        names = resolve_actor_names(realm, [SURVEYOR_ID, NODAL_ID, SURVEYOR_ID, None, ""])

        assert names == {SURVEYOR_ID: "Field Surveyor", NODAL_ID: "Nodal Officer"}
        assert len(realm.called("get_user")) == 2

    def test_a_second_read_is_served_from_the_cache(self):
        realm = FakeKeycloak()
        resolve_actor_names(realm, [SURVEYOR_ID])

        assert resolve_actor_names(realm, [SURVEYOR_ID]) == {SURVEYOR_ID: "Field Surveyor"}
        assert len(realm.called("get_user")) == 1

    def test_the_cache_expires(self, monkeypatch):
        realm = FakeKeycloak()
        clock = [1000.0]
        monkeypatch.setattr(actors.time, "monotonic", lambda: clock[0])
        resolve_actor_names(realm, [SURVEYOR_ID])
        clock[0] += actors.TTL_SECONDS + 1

        resolve_actor_names(realm, [SURVEYOR_ID])

        assert len(realm.called("get_user")) == 2

    def test_the_cache_is_bounded(self, monkeypatch):
        monkeypatch.setattr(actors, "MAX_ENTRIES", 2)
        resolve_actor_names(FakeKeycloak(), [SURVEYOR_ID, NODAL_ID, LEAD_ID])

        assert list(actors._cache) == [NODAL_ID, LEAD_ID]

    def test_a_deleted_account_is_absent_and_not_asked_about_again(self):
        realm = FakeKeycloak()

        assert resolve_actor_names(realm, [GONE]) == {}
        assert resolve_actor_names(realm, [GONE]) == {}
        assert len(realm.called("get_user")) == 1

    def test_keycloak_down_answers_what_is_cached_and_never_raises(self):
        realm = FakeKeycloak()
        resolve_actor_names(realm, [SURVEYOR_ID])
        realm.unavailable = ApiError(503, "identity_unavailable", "down")

        names = resolve_actor_names(realm, [SURVEYOR_ID, NODAL_ID, LEAD_ID])

        assert names == {SURVEYOR_ID: "Field Surveyor"}
        # One failed lookup stops the batch, rather than one timeout per row.
        assert len(realm.called("get_user")) == 2

    def test_after_an_outage_it_backs_off_before_asking_again(self):
        realm = FakeKeycloak()
        realm.unavailable = ApiError(503, "identity_unavailable", "down")
        resolve_actor_names(realm, [NODAL_ID])
        realm.unavailable = None

        assert resolve_actor_names(realm, [NODAL_ID]) == {}
        assert len(realm.called("get_user")) == 1

    def test_no_directory_is_no_names(self):
        assert resolve_actor_names(None, [SURVEYOR_ID]) == {}

    def test_fill_keeps_a_stored_name_and_fills_the_rest(self):
        rows = [{"by": SURVEYOR_ID, "by_name": "As signed in"},
                {"by": NODAL_ID, "by_name": None},
                {"by": GONE, "by_name": None}]

        fill_actor_names(FakeKeycloak(), rows, {"by": "by_name"})

        assert [r["by_name"] for r in rows] == ["As signed in", "Nodal Officer", None]


# ------------------------------------------------------------------- the routes
class TestRoutesCarryNames:
    def test_case_detail_names_the_filer_the_assignment_and_the_rounds(
        self, icms_client, contract_world
    ):
        body = icms_client.sign_in(NODAL).get(f"{ICMS}/cases/CMP-2026-0006").json()

        assert body["created_by_name"] == "Nodal Officer"
        assert body["assignment"]["assignee_name"] == "Field Surveyor"
        assert body["assignment"]["assigned_by_name"] == "Nodal Officer"
        assert [r["surveyor_name"] for r in body["rounds"]] == ["Field Surveyor"]

    def test_the_inspection_register_names_the_surveyor(self, icms_client, contract_world):
        items = icms_client.sign_in(NODAL).get(f"{ICMS}/inspections").json()["items"]

        assert items and {row["surveyor_name"] for row in items} == {"Field Surveyor"}

    def test_the_notice_register_names_the_issuer(self, icms_client, contract_world):
        items = icms_client.sign_in(LEAD).get(f"{ICMS}/notices").json()["items"]

        assert items[0]["issued_by"] == LEAD_ID
        assert items[0]["issued_by_name"] == "Project Lead"

    def test_an_import_from_before_names_were_stored_is_named_now(self, icms_client, db):
        db.add(BoundaryImport(filename="old.kml", sha256="a" * 64, imported_by=NODAL_ID,
                              imported_by_name=None, counts=NO_COUNTS))
        db.add(BoundaryImport(filename="new.kml", sha256="b" * 64, imported_by=NODAL_ID,
                              imported_by_name="Name At The Time", counts=NO_COUNTS))
        db.commit()

        rows = icms_client.sign_in(SUPER_ADMIN).get(f"{ICMS}/admin/geo/imports").json()

        assert {r["filename"]: r["imported_by_name"] for r in rows} == {
            "old.kml": "Nodal Officer", "new.kml": "Name At The Time"}

    def test_keycloak_down_still_answers_with_ids(self, icms_client, contract_world, keycloak):
        keycloak.go_down()

        response = icms_client.sign_in(NODAL).get(f"{ICMS}/cases/CMP-2026-0006")

        assert response.status_code == 200
        assert response.json()["created_by"] == NODAL_ID
        assert response.json()["created_by_name"] is None
