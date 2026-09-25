"""The tables both services map, and the constraints the split depends on."""

from __future__ import annotations

import pytest
from sqlalchemy import inspect

from ada_core import models


def test_every_expected_table_is_mapped():
    """The platform's own tables. ICMS and the field app's `app_*` tables share
    the metadata (models_icms.py, models_app.py) and are excluded here; the
    ICMS ones are asserted in test_icms_schema.py."""
    platform = {
        name for name in models.Base.metadata.tables
        if not name.startswith(("icms_", "app_"))
    }
    assert platform == {
        "projects",
        "rasters",
        "red_zones",
        "analysis_jobs",
        "change_polygons",
        "analysis_parcel_result",
    }


def test_user_id_is_wide_enough_for_a_keycloak_subject():
    """A Keycloak subject is a 36-character UUID. The column predates the auth
    swap and held a SuperTokens id; 64 still fits, which is why the migration
    is a data rewrite rather than a schema change."""
    column = models.Project.__table__.c.user_id
    assert column.type.length >= 36
    assert column.index is True


def test_reviewed_by_holds_the_same_kind_of_id_as_user_id():
    """Both are rewritten together by scripts/remap_user_ids.py; a narrower
    column would truncate one of them."""
    assert (
        models.ChangePolygon.__table__.c.reviewed_by.type.length
        == models.Project.__table__.c.user_id.type.length
    )


def test_review_status_is_indexed_and_defaults_to_pending():
    column = models.ChangePolygon.__table__.c.review_status
    assert column.default.arg == "pending"
    assert column.index is True


JSON_COLUMNS = [
    ("rasters", "bounds_4326"),
    ("red_zones", "geometry"),
    ("analysis_jobs", "params"),
    ("analysis_jobs", "stats"),
    ("change_polygons", "geometry"),
    ("change_polygons", "properties"),
]


@pytest.mark.parametrize("table,column", JSON_COLUMNS)
def test_json_columns_are_jsonb_on_postgres_and_json_on_sqlite(table, column):
    """Production is PostgreSQL and must get a real JSONB column — its indexing
    and containment operators are the reason the type was chosen. The SQLite
    variant exists only so a schema can be created in a test without a server;
    without it create_all raises UnsupportedCompilationError."""
    from sqlalchemy.dialects import postgresql, sqlite

    type_ = models.Base.metadata.tables[table].c[column].type
    assert "sqlite" in type_._variant_mapping, f"{table}.{column} has no sqlite variant"
    assert type(type_.dialect_impl(postgresql.dialect())).__name__ == "_PGJSONB"
    assert type(type_.dialect_impl(sqlite.dialect())).__name__ == "_SQliteJson"


@pytest.mark.parametrize(
    "table,parent",
    [
        ("rasters", "projects"),
        ("red_zones", "projects"),
        ("analysis_jobs", "projects"),
        ("change_polygons", "analysis_jobs"),
    ],
)
def test_children_cascade_on_removal_in_the_database(table, parent):
    """ON DELETE CASCADE in the schema, not only cascade in the ORM: ada-ml
    writes rows outside any ORM relationship the API loaded, so removing a
    project through the API must not leave orphans behind."""
    fks = [
        fk
        for fk in models.Base.metadata.tables[table].foreign_keys
        if fk.column.table.name == parent
    ]
    assert fks, f"{table} has no foreign key to {parent}"
    assert all(fk.ondelete == "CASCADE" for fk in fks)


def test_defaults_that_the_ui_polls(engine, db):
    """A freshly created job must be readable by the API before ada-ml touches
    it — the frontend starts polling immediately."""
    project = models.Project(user_id="u", name="p")
    db.add(project)
    db.commit()
    raster = models.Raster(project_id=project.id, name="t1", original_path="/x.tif")
    job = models.AnalysisJob(project_id=project.id, raster_t1_id=1, raster_t2_id=2)
    db.add_all([raster, job])
    db.commit()
    db.refresh(raster)
    db.refresh(job)
    assert (raster.status, raster.progress) == ("processing", 0.0)
    assert (job.status, job.progress, job.mode) == ("queued", 0.0, "ai")
    assert job.finished_at is None


@pytest.mark.parametrize(
    "table,column",
    [
        ("projects", "created_at"),
        ("rasters", "uploaded_at"),
        ("rasters", "captured_at"),
        ("red_zones", "created_at"),
        ("analysis_jobs", "created_at"),
        ("analysis_jobs", "finished_at"),
        ("change_polygons", "reviewed_at"),
    ],
)
def test_timestamp_columns_carry_a_timezone(table, column):
    """Naive timestamps compare wrongly across a deployment in another zone,
    and finished_at minus created_at is how an analysis is timed."""
    assert models.Base.metadata.tables[table].c[column].type.timezone is True


def test_row_defaults_are_written_as_aware_ist():
    """The column type alone does not guarantee this — a default of
    datetime.now() would be naive and PostgreSQL would then interpret it in the
    server's zone. Asserted on the default function rather than on a round
    trip, because SQLite has no timestamptz and drops the offset on read.
    """
    stamped = models.now_ist()
    assert stamped.tzinfo is not None
    assert stamped.utcoffset().total_seconds() == 5.5 * 3600


def test_project_removal_takes_its_children_with_it(engine, db, project):
    raster = models.Raster(project_id=project.id, name="t1", original_path="/x.tif")
    zone = models.RedZone(project_id=project.id, geometry={"type": "Polygon", "coordinates": []})
    db.add_all([raster, zone])
    db.commit()
    db.delete(project)
    db.commit()
    assert db.query(models.Raster).count() == 0
    assert db.query(models.RedZone).count() == 0


def test_tables_have_the_indexes_the_hot_paths_need(engine):
    """Every list endpoint filters by the owning id; without these the API
    table-scans on a database the ML service is writing to."""
    inspector = inspect(engine)
    indexed = {
        table: {c for index in inspector.get_indexes(table) for c in index["column_names"]}
        for table in ("projects", "rasters", "red_zones", "analysis_jobs", "change_polygons")
    }
    assert "user_id" in indexed["projects"]
    assert "project_id" in indexed["rasters"]
    assert "project_id" in indexed["analysis_jobs"]
    assert "job_id" in indexed["change_polygons"]
