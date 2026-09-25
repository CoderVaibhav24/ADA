"""`alembic upgrade head --sql` — the review step, rendered with no server.

Offline mode has no bind and cannot render an executemany parameter list, so a
seed written as `op.get_bind().execute(text(...), [dicts])` emits one statement
with every value NULL: runnable SQL that quietly inserts nothing real. These
assertions are against the rendered text, which is what a reviewer actually sees.
"""

from __future__ import annotations

import contextlib
import io

import pytest
from alembic import command
from alembic.config import Config

from ada_core.migrate import ALEMBIC_DIR

# Nothing connects. The URL only tells the compiler which dialect to render for.
URL = "postgresql+psycopg2://render/render@offline/render"


# Offline mode writes to sys.stdout, not to Config.stdout — capture the wrong
# one and every assertion below passes against an empty string.
def _render(revision_range: str) -> str:
    cfg = Config()
    cfg.set_main_option("script_location", str(ALEMBIC_DIR))
    cfg.set_main_option("sqlalchemy.url", URL)
    buffer = io.StringIO()
    with contextlib.redirect_stdout(buffer):
        command.upgrade(cfg, revision_range, sql=True)
    sql = buffer.getvalue()
    assert sql.strip(), f"nothing rendered for {revision_range}"
    return sql


@pytest.fixture(scope="module")
def chain() -> str:
    return _render("base:head")


@pytest.fixture(scope="module")
def policy() -> str:
    return _render("0002:0003")


@pytest.fixture(scope="module")
def upload() -> str:
    return _render("0003:0004")


@pytest.fixture(scope="module")
def screens() -> str:
    return _render("0004:0005")


@pytest.fixture(scope="module")
def code_values() -> str:
    return _render("0005:0006")


@pytest.fixture(scope="module")
def statuses() -> str:
    return _render("0006:0007")


@pytest.fixture(scope="module")
def imagery() -> str:
    return _render("0007:0008")


@pytest.fixture(scope="module")
def complaint() -> str:
    return _render("0008:0009")


@pytest.fixture(scope="module")
def atomic() -> str:
    return _render("0009:0010")


@pytest.fixture(scope="module")
def answers() -> str:
    return _render("0010:0011")


def test_the_chain_renders_to_head(chain):
    assert "CREATE TABLE icms_workflow_transition" in chain
    assert "UPDATE alembic_version SET version_num='0011'" in chain


def test_the_complaint_date_is_added_and_backfilled_in_ist(complaint):
    assert "ALTER TABLE icms_case ADD COLUMN complaint_date DATE" in complaint
    assert "(created_at AT TIME ZONE 'Asia/Kolkata')::date" in complaint
    assert "DISABLE TRIGGER trg_icms_case_touch" in complaint
    assert "ENABLE TRIGGER trg_icms_case_touch" in complaint
    assert "ALTER TABLE icms_evidence ADD COLUMN caption TEXT" in complaint


def test_the_inspection_answers_render(answers):
    assert "ALTER TABLE icms_inspection ADD COLUMN encroachment_confirmed_cd" in answers
    assert "icms_inspection_recommendation_ck" in answers
    assert answers.count("INSERT INTO icms_code_value ") == 19
    assert "'no_false_positive'" in answers and "'शिकायत दर्ज'" not in answers
    assert "SET active=false WHERE icms_code_value.domain = 'area_type'" in answers


def test_the_complaint_photo_kind_and_its_policy_render(complaint):
    assert complaint.count("'complaint_photo'") >= 3
    assert "INSERT INTO icms_upload_policy " in complaint
    assert "image/webp" in complaint


@pytest.mark.parametrize(
    "revision",
    ["policy", "upload", "screens", "code_values", "statuses", "imagery", "complaint",
     "atomic", "answers"])
def test_no_seed_statement_renders_as_all_nulls(revision, request):
    """The regression. `VALUES (NULL` is the signature of an unrenderable
    parameter list, and the SQL it produces is wrong rather than broken."""
    assert "VALUES (NULL" not in request.getfixturevalue(revision)


def test_the_policy_seed_renders_as_literals(policy):
    assert "'pcs-nodal-officer'" in policy
    assert "'PCS Nodal Officer'" in policy
    assert policy.count("INSERT INTO icms_role ") == 5
    assert policy.count("INSERT INTO icms_permission ") == 15
    assert policy.count("INSERT INTO icms_role_permission ") == 37
    assert policy.count("INSERT INTO icms_workflow_transition ") == 18
    assert policy.count("INSERT INTO icms_workflow_transition_role ") == 23


def test_the_transition_ids_are_stated_and_the_sequence_is_moved(policy):
    """Explicit ids are what removes the RETURNING round-trip offline mode cannot
    do; BIGSERIAL then has to be told, or the next insert collides with a seed."""
    assert "VALUES (1, 'raise', NULL, 'raised'" in policy
    assert "VALUES (18, 'close', 'notice_issued', 'closed'" in policy
    assert "setval(pg_get_serial_sequence('icms_workflow_transition', 'id')" in policy


def test_an_empty_array_is_rendered_with_its_type(policy):
    """A bare ARRAY[] is SQL PostgreSQL refuses, and only when someone runs it."""
    assert "ARRAY[]::text[]" in policy
    assert "ARRAY[], " not in policy


def test_an_apostrophe_in_a_seeded_note_is_escaped(policy):
    assert "icms_evidence''s CHECK constraint" in policy


def test_the_upload_policy_seed_renders_as_literals(upload):
    assert upload.count("INSERT INTO icms_upload_policy ") == 4
    assert "ARRAY['image/jpeg', 'image/png', 'image/heic']" in upload


def test_the_home_screen_seed_renders_as_literals(screens):
    assert "'home_sdui'" in screens


def test_the_act_and_section_seed_renders_as_literals(code_values):
    """Six rows, the Hindi among them, and every one of them skippable."""
    assert code_values.count("INSERT INTO icms_code_value ") == 6
    assert "'act', 'up_upda_1973'" in code_values
    assert code_values.count("'section', 'sec_") == 5
    assert "धारा 27 — अनधिकृत विकास हटाने का आदेश" in code_values


def test_every_section_renders_with_its_act_as_parent(code_values):
    """`parent_code` is what ties a section to the act it is issued under, and
    the findings form has nothing to show without it."""
    sections = [line for line in code_values.splitlines() if "'section', 'sec_" in line]

    assert len(sections) == 5
    assert all("'up_upda_1973'" in line for line in sections)


def test_the_code_value_seed_can_be_applied_twice(code_values):
    """The rows go into a table that already holds seventeen, and an operator may
    have hand-seeded one of these codes before the revision reached them."""
    assert code_values.count("ON CONFLICT (domain, code) DO NOTHING") == 6


def test_the_status_seed_renders_every_domain_as_literals(statuses):
    """Eleven case statuses, five inspection statuses, three re-survey decisions
    — the counts the enum, the CHECK constraint and the model hold."""
    assert statuses.count("INSERT INTO icms_code_value ") == 19
    assert statuses.count("'case_status', '") == 11
    assert statuses.count("'inspection_status', '") == 5
    assert statuses.count("'resurvey_decision', '") == 3
    assert statuses.count("ON CONFLICT (domain, code) DO NOTHING") == 19


def test_every_status_carries_its_hindi_and_no_parent(statuses):
    """Flat vocabularies, unlike 0006's sections: nothing hangs off anything, and
    a client with no Hindi label falls back to the code it was meant to replace."""
    rows = [line for line in statuses.splitlines()
            if line.startswith("INSERT INTO icms_code_value ")]

    assert len(rows) == 19
    assert all(", NULL, " in line for line in rows), "parent_code is NULL throughout"
    assert "'Under Inspection', 'निरीक्षण जारी'" in statuses
    assert "'Sent Back', 'वापस भेजा गया'" in statuses


def test_the_status_seed_is_ordered_by_the_workflow_and_not_alphabetically(statuses):
    """`sort_order` is what makes a status facet read like the life of a case."""
    assert "'case_status', 'raised', 'Complaint Filed', 'शिकायत दर्ज', NULL, 1)" in statuses
    assert "'case_status', 'rejected', 'Rejected', 'अस्वीकृत', NULL, 11)" in statuses


def test_the_imagery_permissions_render_as_idempotent_literals(imagery):
    """Two permissions, seven grants, each skippable, and a revision bump."""
    assert imagery.count("INSERT INTO icms_permission ") == 2
    assert imagery.count("INSERT INTO icms_role_permission ") == 7
    assert imagery.count("ON CONFLICT DO NOTHING") == 9
    assert "'field-surveyor', 'imagery.read'" in imagery
    assert "'field-surveyor', 'imagery.write'" not in imagery
    assert "'public'" not in imagery
    assert "UPDATE icms_policy_revision SET revision = revision + 1" in imagery


def test_the_atomic_permissions_render_as_idempotent_literals(atomic):
    """37 permissions with their Hindi, 74 grants, each skippable, and a revision bump."""
    assert atomic.count("INSERT INTO icms_permission ") == 37
    assert atomic.count("INSERT INTO icms_role_permission ") == 74
    assert atomic.count("ON CONFLICT DO NOTHING") == 111
    assert "'public', 'case.raise'" in atomic
    assert "'super-admin', 'case.amend'" not in atomic
    assert "'super-admin', 'case.raise'" not in atomic
    assert "'super-admin', 'evidence.write'" not in atomic


def test_every_transition_is_backfilled_with_its_permission(atomic):
    """The phase 2 column: nullable, restricted, one UPDATE per action."""
    assert "ALTER TABLE icms_workflow_transition ADD COLUMN permission_cd VARCHAR(64)" in atomic
    assert "icms_wf_transition_permission_fk" in atomic
    assert "ON DELETE RESTRICT" in atomic
    assert atomic.count("UPDATE icms_workflow_transition SET permission_cd=") == 16
    assert ("SET permission_cd='evidence.write' "
            "WHERE icms_workflow_transition.action_cd = 'add_evidence'") in atomic
    assert "INSERT INTO icms_workflow_transition_role " not in atomic
    assert "'field-surveyor', 'case.amend'" not in atomic
    assert "'pcs-nodal-officer', 'case.amend'" in atomic
    assert "डैशबोर्ड स्क्रीन खोलें" in atomic
    assert "UPDATE icms_policy_revision SET revision = revision + 1" in atomic


def test_the_boundary_layers_render_as_postgis_with_spatial_indexes():
    """0015: two geometry tables with GiST indexes, and red zones that may have no project."""
    boundary = _render("0014:0015")
    assert "geom geometry(MultiPolygon,4326) NOT NULL" in boundary
    assert "CREATE INDEX ix_icms_village_geom ON icms_village USING gist (geom)" in boundary
    assert "CREATE INDEX ix_icms_parcel_geom ON icms_parcel USING gist (geom)" in boundary
    assert "ALTER TABLE red_zones ALTER COLUMN project_id DROP NOT NULL" in boundary
    assert "CHECK (project_id IS NOT NULL OR source = 'kml')" in boundary
    assert ("CREATE UNIQUE INDEX uq_red_zones_import_key ON red_zones (import_key) "
            "WHERE import_key IS NOT NULL") in boundary


def test_scheme_plots_render_as_two_partial_unique_keys_and_a_check():
    """0016: a parcel is keyed by village + khasra or by sector + plot number."""
    plots = _render("0015:0016")
    assert "ALTER TABLE icms_parcel ALTER COLUMN village_lgd DROP NOT NULL" in plots
    assert "ALTER TABLE icms_parcel ALTER COLUMN khasra_no DROP NOT NULL" in plots
    assert "ALTER TABLE icms_parcel DROP CONSTRAINT uq_icms_parcel_village_khasra" in plots
    assert ("CREATE UNIQUE INDEX uq_icms_parcel_village_khasra ON icms_parcel "
            "(village_lgd, khasra_no) WHERE village_lgd IS NOT NULL AND khasra_no IS NOT NULL"
            ) in plots
    assert ("CREATE UNIQUE INDEX uq_icms_parcel_sector_plot ON icms_parcel (sector, plot_no) "
            "WHERE sector IS NOT NULL AND plot_no IS NOT NULL") in plots
    assert ("CHECK ((village_lgd IS NOT NULL AND khasra_no IS NOT NULL) OR "
            "(sector IS NOT NULL AND plot_no IS NOT NULL))") in plots
    assert "ADD COLUMN imported_by_name VARCHAR(200)" in plots


def test_the_raster_lifecycle_columns_render():
    """0017: resumable uploads, archive master and cold tier on `rasters`."""
    lifecycle = _render("0016:0017")
    assert "ALTER TABLE rasters ADD COLUMN size_bytes BIGINT" in lifecycle
    assert "ALTER TABLE rasters ADD COLUMN fingerprint VARCHAR(80)" in lifecycle
    assert "ALTER TABLE rasters ADD COLUMN retry_count INTEGER DEFAULT 0 NOT NULL" in lifecycle
    assert "CREATE INDEX ix_rasters_fingerprint ON rasters (fingerprint)" in lifecycle
    assert "SET last_used_at = uploaded_at" in lifecycle
    assert "UPDATE alembic_version SET version_num='0017'" in lifecycle


def test_the_parcel_result_table_renders():
    """0024: one row per (analysis, parcel), cascading from both sides."""
    parcels = _render("0023_findings_stage:0024_analysis_parcel_result")
    assert "CREATE TABLE analysis_parcel_result" in parcels
    assert "FOREIGN KEY(job_id) REFERENCES analysis_jobs (id) ON DELETE CASCADE" in parcels
    assert "FOREIGN KEY(parcel_id) REFERENCES icms_parcel (id) ON DELETE CASCADE" in parcels
    assert "CONSTRAINT uq_analysis_parcel_result_job_parcel UNIQUE (job_id, parcel_id)" in parcels
    assert "change_class IN ('new_build', 'extension', 'demolition'" in parcels
    assert ("UPDATE alembic_version SET version_num='0024_analysis_parcel_result'"
            in parcels)


def test_the_chain_ends_at_the_parcel_result_head(chain):
    assert "UPDATE alembic_version SET version_num='0024_analysis_parcel_result'" in chain
