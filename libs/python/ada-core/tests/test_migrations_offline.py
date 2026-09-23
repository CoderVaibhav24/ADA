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


def test_the_chain_renders_to_head(chain):
    assert "CREATE TABLE icms_workflow_transition" in chain
    assert "UPDATE alembic_version SET version_num='0007'" in chain


@pytest.mark.parametrize(
    "revision", ["policy", "upload", "screens", "code_values", "statuses"])
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
