"""Projects, and the ownership boundary every other route depends on."""

from __future__ import annotations

from ada_core import models

from .conftest import OTHER, OWNER


def test_create_returns_the_row_and_stamps_the_owner(client, db):
    response = client.post("/api/projects", json={"name": "Agra", "description": "POC"})
    assert response.status_code == 200
    body = response.json()
    assert body["name"] == "Agra"
    # The owner comes from the token, never from the body.
    assert db.get(models.Project, body["id"]).user_id == OWNER


def test_the_owner_cannot_be_chosen_by_the_caller(client, db):
    """A body field named user_id must not be able to create a project on
    somebody else's behalf, nor to hand one away."""
    response = client.post(
        "/api/projects", json={"name": "Smuggled", "user_id": OTHER}
    )
    assert response.status_code == 200
    assert db.get(models.Project, response.json()["id"]).user_id == OWNER


def test_list_shows_only_your_own(client, project, foreign_project):
    names = {row["name"] for row in client.get("/api/projects").json()}
    assert names == {"Agra"}


def test_get_your_own(client, project):
    assert client.get(f"/api/projects/{project.id}").json()["name"] == "Agra"


class TestIsolation:
    """Somebody else's project is 404, never 403.

    A 403 confirms the row exists, which tells an attacker that project 7
    belongs to someone — enough to enumerate the estate. 404 is the same answer
    they get for a project that was never created.
    """

    def test_read(self, client, foreign_project):
        assert client.get(f"/api/projects/{foreign_project.id}").status_code == 404

    def test_removal(self, client, foreign_project, db):
        assert client.delete(f"/api/projects/{foreign_project.id}").status_code == 404
        assert db.get(models.Project, foreign_project.id) is not None

    def test_listing_rasters(self, client, foreign_project):
        assert client.get(f"/api/projects/{foreign_project.id}/rasters").status_code == 404

    def test_listing_analyses(self, client, foreign_project):
        assert client.get(f"/api/projects/{foreign_project.id}/analyses").status_code == 404

    def test_listing_red_zones(self, client, foreign_project):
        assert client.get(f"/api/projects/{foreign_project.id}/red-zones").status_code == 404

    def test_creating_a_red_zone_in_it(self, client, foreign_project):
        response = client.post(
            f"/api/projects/{foreign_project.id}/red-zones",
            json={"name": "z", "geometry": {"type": "Polygon", "coordinates": [[]]}},
        )
        assert response.status_code == 404

    def test_starting_an_analysis_in_it(self, client, foreign_project):
        response = client.post(
            f"/api/projects/{foreign_project.id}/analyses",
            json={"raster_t1_id": 1, "raster_t2_id": 2, "mode": "diff"},
        )
        assert response.status_code == 404


def test_a_project_that_does_not_exist_is_also_404(client):
    assert client.get("/api/projects/99999").status_code == 404


def test_removing_a_project_takes_its_children(client, db, project):
    raster = models.Raster(project_id=project.id, name="t1", original_path="/x.tif")
    db.add(raster)
    db.commit()
    assert client.delete(f"/api/projects/{project.id}").status_code in (200, 204)
    assert db.query(models.Raster).filter_by(project_id=project.id).count() == 0
