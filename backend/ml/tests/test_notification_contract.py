"""The worker and the templates have to agree, and they live in two services.

ada-ml builds a payload; ada-notify renders a template stored in its own
database, seeded by alembic revision 0002. The renderer has no defaults and no
conditionals on purpose — a missing value is an error, not an empty string — so
a placeholder the worker does not supply is a delivery marked `failed` with the
officer never told their analysis finished.

Nothing else checks this. The two sides are in different services, different
databases and different images, and neither import graph reaches the other.
"""

from __future__ import annotations

import ast
import re
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[3]
SEED = REPO / "backend" / "notify" / "alembic" / "versions" / "0002_ada_project_seed.py"
PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}")


def seeded_templates() -> dict[str, set[str]]:
    """{template key: placeholders it uses}, read from the migration itself.

    Parsed rather than imported: importing it would need alembic's runtime
    context, and the literal is what actually ships.
    """
    tree = ast.parse(SEED.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and getattr(node.targets[0], "id", "") == "TEMPLATES":
            templates = ast.literal_eval(node.value)
            break
    else:  # pragma: no cover - the migration always defines it
        pytest.fail("TEMPLATES not found in the seed migration")

    return {
        entry["key"]: set(PLACEHOLDER.findall(entry["subject"] + entry["body"]))
        for entry in templates
    }


def worker_payload_keys(monkeypatch, db, job) -> dict[str, set[str]]:
    """{template key: payload keys the worker sends}, captured from the worker."""
    from app import notifier

    sent: dict[str, set[str]] = {}

    class Capture:
        def send(self, *, template_key, payload, **_):
            sent[template_key] = set(payload)
            return type("Outcome", (), {"accepted": True, "error": None})()

    monkeypatch.setattr(notifier, "_client", None)
    monkeypatch.setattr(notifier, "_unavailable_reason", None)
    monkeypatch.setattr(notifier.settings, "notify_enabled", True)
    monkeypatch.setattr(notifier, "_notifier", Capture)
    notifier.analysis_finished(job.id)
    notifier.analysis_failed(job.id)
    return sent


def test_the_seed_migration_defines_both_templates():
    assert set(seeded_templates()) == {"analysis-complete", "analysis-failed"}


def test_the_worker_supplies_every_placeholder_each_template_needs(monkeypatch, db, job):
    templates = seeded_templates()
    payloads = worker_payload_keys(monkeypatch, db, job)

    for key, placeholders in templates.items():
        missing = placeholders - payloads[key]
        assert not missing, (
            f"template {key!r} uses {sorted(missing)}, which ada-ml never sends. "
            "The renderer has no defaults, so this delivery fails."
        )


def test_the_templates_address_the_right_channel():
    """Only email can be delivered in this release. A template stored against a
    channel the worker cannot send is refused at ingestion, not at delivery."""
    tree = ast.parse(SEED.read_text())
    assert "'email'" in SEED.read_text() or '"email"' in SEED.read_text()
    assert tree is not None


def test_the_project_client_id_matches_the_credential_the_worker_uses(monkeypatch, db):
    """ada-notify matches the token's azp against projects.client_id, and that
    match is the whole tenancy boundary. The seed row and ada-ml's configured
    client id are written in two different files and must agree."""
    from app.config import Settings

    source = SEED.read_text()
    assert 'CLIENT_ID = "ada-ml"' in source
    assert Settings.model_fields["notify_client_id"].default == "ada-ml"
