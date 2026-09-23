"""Red zones: the officer-drawn polygons that turn a change into a violation."""

from __future__ import annotations

from ada_core import models

SQUARE = {
    "type": "Polygon",
    "coordinates": [[[78.00, 27.10], [78.05, 27.10], [78.05, 27.15],
                     [78.00, 27.15], [78.00, 27.10]]],
}


def test_a_zone_is_stored_against_the_project(client, project, db):
    response = client.post(
        f"/api/projects/{project.id}/red-zones",
        json={"name": "Protected green belt", "geometry": SQUARE},
    )
    assert response.status_code == 200
    row = db.get(models.RedZone, response.json()["id"])
    assert row.project_id == project.id
    assert row.geometry["type"] == "Polygon"


def test_the_geometry_survives_the_round_trip(client, project):
    """It is read back by ada-ml to decide which detections are illegal, so a
    mangled coordinate list is a wrong verdict rather than a display bug."""
    created = client.post(f"/api/projects/{project.id}/red-zones",
                          json={"name": "z", "geometry": SQUARE}).json()
    listed = client.get(f"/api/projects/{project.id}/red-zones").json()
    assert listed[0]["geometry"] == SQUARE
    assert created["geometry"] == SQUARE


def test_zones_are_listed_per_project(client, project, db):
    other = models.Project(user_id=project.user_id, name="Second")
    db.add(other)
    db.commit()
    client.post(f"/api/projects/{project.id}/red-zones",
                json={"name": "mine", "geometry": SQUARE})
    client.post(f"/api/projects/{other.id}/red-zones",
                json={"name": "elsewhere", "geometry": SQUARE})
    names = [row["name"] for row in client.get(f"/api/projects/{project.id}/red-zones").json()]
    assert names == ["mine"]


def test_removing_a_zone(client, project, db):
    created = client.post(f"/api/projects/{project.id}/red-zones",
                          json={"name": "z", "geometry": SQUARE}).json()
    assert client.delete(f"/api/red-zones/{created['id']}").status_code in (200, 204)
    assert db.get(models.RedZone, created["id"]) is None


def test_removing_somebody_elses_zone_is_404(client, db, foreign_project):
    zone = models.RedZone(project_id=foreign_project.id, name="theirs", geometry=SQUARE)
    db.add(zone)
    db.commit()
    db.refresh(zone)
    assert client.delete(f"/api/red-zones/{zone.id}").status_code == 404
    assert db.get(models.RedZone, zone.id) is not None
