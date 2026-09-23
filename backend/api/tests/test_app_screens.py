"""Server-driven screens: the contract, the validator, capabilities, versions and caching."""

from __future__ import annotations

import copy
import importlib.util
import json
from pathlib import Path

import pytest
from ada_core.models_app import AppScreen  # registers app_screen before create_all
from sqlalchemy import func, select

from tests.conftest import LEAD, NODAL, SUPER_ADMIN, SUPER_ADMIN_ID, SURVEYOR

BACKEND = Path(__file__).resolve().parents[2]
REPO = BACKEND.parent
MIGRATION = BACKEND / "shared/ada-core/ada_core/alembic/versions/0005_app_screen.py"
APP_CONTRACT = REPO / "app/src/sdui/contract.json"
API_CONTRACT = BACKEND / "api/app/icms/sdui_contract.json"
RUNTIME = {"runtime": "1.0"}


def _home_seed() -> dict:
    spec = importlib.util.spec_from_file_location("migration_0005", MIGRATION)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return copy.deepcopy(module.HOME_SDUI)


def simple(**overrides) -> dict:
    """A minimal valid screen; overrides replace top-level keys."""
    definition = {
        "title": "Simple",
        "body": [{"type": "text", "props": {"text": "Hello"}}],
    }
    definition.update(overrides)
    return definition


def with_node(node: dict) -> dict:
    return simple(body=[node])


@pytest.fixture
def admin(icms_client):
    return icms_client.sign_in(SUPER_ADMIN)


def put(client, screen_id: str, definition: dict, **extra):
    return client.put(f"/api/app/screens/{screen_id}", json={"definition": definition, **extra})


def publish(client, screen_id: str, version: int | None = None):
    body = {} if version is None else {"version": version}
    return client.post(f"/api/app/screens/{screen_id}/publish", json=body)


def assert_envelope(response, status: int, code: str, field: str | None = None) -> dict:
    assert response.status_code == status, response.text
    error = response.json()["error"]
    assert set(error) == {"code", "message", "field", "allowed", "request_id"}
    assert error["code"] == code, error
    assert error["request_id"]
    if field is not None:
        assert error["field"] == field, error
    return error


# ------------------------------------------------------------------ contract


class TestContract:
    @pytest.mark.skipif(not APP_CONTRACT.exists(), reason="app/ is not in this checkout")
    def test_the_server_and_the_app_read_the_same_contract(self):
        """The app renders from its copy and the server validates against this one."""
        assert json.loads(API_CONTRACT.read_text()) == json.loads(APP_CONTRACT.read_text())

    def test_the_seeded_home_screen_passes_the_validator(self):
        from app.icms import policy, screens

        checked = screens.validate_definition(
            _home_seed(), schema_version=1, permissions=policy.snapshot().permissions)
        assert checked.title == "Home"
        assert checked.required_runtime == "1.0"
        assert checked.label_domains == ("case_status",)

    def test_the_seed_binds_real_case_endpoints(self):
        paths = []

        def walk(node):
            if "data" in node:
                paths.append(node["data"]["path"])
            for child in node.get("children", []):
                walk(child)
            for slot in ("item", "empty"):
                if slot in node:
                    walk(node[slot])

        for node in _home_seed()["body"]:
            walk(node)
        assert paths.count("/api/icms/cases") == 2
        assert "/api/icms/inspections" in paths


# ---------------------------------------------------------------- validation


BAD_DEFINITIONS = [
    pytest.param(with_node({"type": "marquee", "props": {}}), "unknown_component",
                 "definition.body[0].type", id="unknown-component"),
    pytest.param(with_node({"type": "button", "props": {"label": "Go"},
                            "action": {"type": "eval", "code": "1"}}),
                 "unknown_action", "definition.body[0].action.type", id="unknown-action"),
    pytest.param(with_node({"type": "stat_card", "props": {"label": "Assigned"}}),
                 "missing_prop", "definition.body[0].props.value", id="missing-required-prop"),
    pytest.param(with_node({"type": "text", "props": {"text": "x", "fontSize": 40}}),
                 "unknown_prop", "definition.body[0].props", id="unknown-prop"),
    pytest.param(with_node({"type": "text", "props": {"text": "x", "color": "#ff0000"}}),
                 "bad_prop", "definition.body[0].props.color", id="literal-colour"),
    pytest.param(with_node({"type": "button", "props": {"label": "Go"}}),
                 "missing_action", "definition.body[0].action", id="button-without-action"),
    pytest.param(with_node({"type": "text", "props": {"text": "x"},
                            "action": {"type": "refresh"}}),
                 "action_not_allowed", "definition.body[0].action", id="action-on-text"),
    pytest.param(with_node({"type": "list", "props": {},
                            "item": {"type": "text", "props": {"text": "x"}}}),
                 "missing_binding", "definition.body[0].data", id="list-without-data"),
    pytest.param(with_node({"type": "text", "props": {"text": "x"}, "visibleIf": "god.mode"}),
                 "unknown_capability", "definition.body[0].visibleIf", id="unknown-capability"),
    pytest.param(simple(body=[]), "bad_definition", "definition.body", id="empty-body"),
    pytest.param(simple(script="alert(1)"), "bad_definition", "definition",
                 id="unknown-top-level-key"),
]

BAD_PATHS = [
    "https://evil.example/api/icms/cases",
    "//evil.example/api/icms/cases",
    "/api/projects",
    "/api/app/screens",
    "/api/icms/../projects",
    "/api/icms/cases/%2e%2e",
    "/api/icms/cases?mine=true",
    "/api/icms/{{params.resource}}",
    "/api/icms/cases/x{{params.ref}}",
]

BAD_TEMPLATES = [
    ("{{constructor.name}}", "bad_template"),
    ("{{item.__proto__}}", "bad_template"),
    ("{{params.a + params.b}}", "bad_template"),
    ("{{params.a()}}", "bad_template"),
    ("{{window.location}}", "unknown_scope"),
    ("{{data.count}}", "unbound_data"),
    ("{{params.a|eval}}", "unknown_formatter"),
    ("{{params.a|label}}", "bad_template"),
    ("{{params.a|date:x}}", "bad_template"),
    ("{{ params.a", "bad_template"),
]


class TestValidation:
    @pytest.mark.parametrize(("definition", "code", "field"), BAD_DEFINITIONS)
    def test_a_bad_definition_is_422_and_stores_nothing(self, admin, db, definition, code,
                                                         field):
        assert_envelope(put(admin, "bad_screen", definition), 422, code, field)
        assert db.execute(select(func.count()).select_from(AppScreen)).scalar_one() == 0

    def test_an_unknown_component_names_the_ones_that_exist(self, admin):
        error = assert_envelope(
            put(admin, "bad_screen", with_node({"type": "marquee"})), 422, "unknown_component")
        assert "stat_card" in error["allowed"]

    @pytest.mark.parametrize("path", BAD_PATHS)
    def test_a_binding_cannot_leave_the_path_whitelist(self, admin, path):
        node = {"type": "list", "data": {"source": "api", "path": path},
                "item": {"type": "text", "props": {"text": "x"}}}
        assert_envelope(put(admin, "bad_screen", with_node(node)), 422, "path_not_allowed")

    def test_a_binding_must_come_from_the_api(self, admin):
        node = {"type": "list", "data": {"source": "url", "path": "/api/icms/cases"},
                "item": {"type": "text", "props": {"text": "x"}}}
        assert_envelope(put(admin, "bad_screen", with_node(node)), 422, "bad_binding")

    @pytest.mark.parametrize(("template", "code"), BAD_TEMPLATES)
    def test_templates_are_dotted_lookups_and_nothing_more(self, admin, template, code):
        node = {"type": "text", "props": {"text": template}}
        assert_envelope(put(admin, "bad_screen", with_node(node)), 422, code)

    def test_item_is_only_in_scope_inside_a_list_item(self, admin):
        node = {"type": "text", "props": {"text": "{{item.case_ref}}"}}
        assert_envelope(put(admin, "bad_screen", with_node(node)), 422, "unbound_item")

    def test_call_api_needs_a_confirmation(self, admin):
        node = {"type": "button", "props": {"label": "Go"},
                "action": {"type": "call_api", "path": "/api/icms/cases/X/assign"}}
        assert_envelope(put(admin, "bad_screen", with_node(node)), 422, "missing_confirm")

    def test_call_api_may_not_reach_the_admin_surface(self, admin):
        node = {"type": "button", "props": {"label": "Go"},
                "action": {"type": "call_api", "path": "/api/icms/admin/policy/transitions",
                           "confirm": {"title": "Sure?", "message": "Really"}}}
        assert_envelope(put(admin, "bad_screen", with_node(node)), 422, "path_not_allowed")

    @pytest.mark.parametrize("url", ["https://evil.example/", "http://evil.example/",
                                     "javascript:alert(1)", "https://{{params.host}}/"])
    def test_open_url_is_https_on_an_allowed_host_only(self, admin, url):
        node = {"type": "button", "props": {"label": "Go"},
                "action": {"type": "open_url", "url": url}}
        assert_envelope(put(admin, "bad_screen", with_node(node)), 422, "url_not_allowed")

    def test_navigate_takes_a_registered_route(self, admin):
        node = {"type": "button", "props": {"label": "Go"},
                "action": {"type": "navigate", "route": "settings"}}
        assert_envelope(put(admin, "bad_screen", with_node(node)), 422, "unknown_route")

    def test_navigate_takes_exactly_the_route_params(self, admin):
        node = {"type": "button", "props": {"label": "Go"},
                "action": {"type": "navigate", "route": "complaint_detail", "params": {}}}
        assert_envelope(put(admin, "bad_screen", with_node(node)), 422, "bad_action")

    def test_an_unknown_schema_version_is_refused(self, admin):
        assert_envelope(put(admin, "bad_screen", simple(), schema_version=9), 422,
                        "unknown_schema_version", "schema_version")

    def test_min_app_runtime_cannot_undercut_the_components(self, admin):
        assert_envelope(put(admin, "bad_screen", simple(), min_app_runtime="0.9"), 422,
                        "min_app_runtime_too_low", "min_app_runtime")

    def test_required_capability_must_be_a_permission(self, admin):
        assert_envelope(put(admin, "bad_screen", simple(), required_capability="god.mode"),
                        422, "unknown_capability", "required_capability")

    def test_an_oversized_definition_is_refused(self, admin):
        body = [{"type": "text", "props": {"text": "x" * 400}} for _ in range(200)]
        assert_envelope(put(admin, "bad_screen", simple(body=body)), 422,
                        "definition_too_large")

    def test_a_malformed_request_is_enveloped_too(self, admin):
        response = admin.put("/api/app/screens/bad_screen", json={"definitions": {}})
        assert_envelope(response, 422, "validation_failed")

    def test_a_bad_screen_id_is_enveloped(self, admin):
        assert_envelope(put(admin, "Bad-Screen", simple()), 422, "validation_failed")

    def test_the_seed_is_accepted_through_the_api(self, admin):
        response = put(admin, "home_copy", _home_seed())
        assert response.status_code == 201, response.text
        assert response.json()["min_app_runtime"] == "1.0"


# -------------------------------------------------------------- capabilities


class TestCapabilities:
    @pytest.mark.parametrize("role", [NODAL, SURVEYOR, LEAD])
    def test_only_a_super_admin_may_write(self, icms_client, role):
        client = icms_client.sign_in(role)
        assert_envelope(put(client, "home_x", simple()), 403, "role_not_permitted")
        assert_envelope(publish(client, "home_x"), 403, "role_not_permitted")
        response = client.post("/api/app/screens/home_x/rollback", json={"to_version": 1})
        assert_envelope(response, 403, "role_not_permitted")
        assert_envelope(client.get("/api/app/screens/home_x/versions"), 403,
                        "role_not_permitted")

    def test_a_screen_behind_a_capability_is_refused_to_a_role_without_it(self, admin):
        assert put(admin, "policy_board", simple(), required_capability="policy.read") \
            .status_code == 201
        assert publish(admin, "policy_board").status_code == 200

        surveyor = admin.sign_in(SURVEYOR)
        error = assert_envelope(
            surveyor.get("/api/app/screens/policy_board", params=RUNTIME), 403,
            "role_not_permitted")
        assert SUPER_ADMIN in error["allowed"]
        index = surveyor.get("/api/app/screens").json()["items"]
        assert "policy_board" not in {item["screen_id"] for item in index}

        admin = surveyor.sign_in(SUPER_ADMIN)
        assert admin.get("/api/app/screens/policy_board", params=RUNTIME).status_code == 200

    def test_every_icms_role_may_read_an_open_screen(self, admin):
        put(admin, "open_board", simple())
        publish(admin, "open_board")
        for role in (NODAL, SURVEYOR, LEAD):
            response = admin.sign_in(role).get("/api/app/screens/open_board", params=RUNTIME)
            assert response.status_code == 200, (role, response.text)

    def test_a_signed_in_non_officer_is_refused(self, icms_client):
        client = icms_client.sign_in("offline_access")
        assert_envelope(client.get("/api/app/screens"), 403, "role_not_permitted")


# ------------------------------------------------------------------ versions


class TestVersions:
    def test_versions_are_monotonic_per_screen(self, admin):
        assert [put(admin, "home_a", simple()).json()["version"] for _ in range(3)] == [1, 2, 3]
        assert put(admin, "home_b", simple()).json()["version"] == 1

    def test_a_draft_is_not_served(self, admin):
        put(admin, "home_a", simple())
        assert_envelope(admin.get("/api/app/screens/home_a", params=RUNTIME), 404,
                        "screen_not_found")
        assert admin.get("/api/app/screens").json()["items"] == []

    def test_publish_serves_the_newest_draft(self, admin):
        put(admin, "home_a", simple(title="One"))
        put(admin, "home_a", simple(title="Two"))
        published = publish(admin, "home_a")
        assert published.status_code == 200, published.text
        assert published.json()["version"] == 2
        assert published.json()["published_by"] == SUPER_ADMIN_ID
        served = admin.get("/api/app/screens/home_a", params=RUNTIME).json()
        assert (served["version"], served["title"]) == (2, "Two")

    def test_an_older_draft_cannot_displace_a_newer_published_version(self, admin):
        put(admin, "home_a", simple(title="One"))
        put(admin, "home_a", simple(title="Two"))
        publish(admin, "home_a", 2)
        assert_envelope(publish(admin, "home_a", 1), 409, "stale_draft", "version")
        assert admin.get("/api/app/screens/home_a", params=RUNTIME).json()["version"] == 2

    def test_a_published_version_is_not_published_twice(self, admin):
        put(admin, "home_a", simple())
        publish(admin, "home_a")
        assert_envelope(publish(admin, "home_a", 1), 409, "already_published")
        assert_envelope(publish(admin, "home_a"), 404, "draft_not_found")

    def test_publish_revalidates_what_was_stored(self, admin, db):
        """A row that would not pass today's contract never becomes the served version."""
        db.add(AppScreen(screen_id="home_a", version=1, schema_version=1, min_app_runtime="1.0",
                         title="Bad", definition=with_node({"type": "marquee"}),
                         status="draft", created_by="someone"))
        db.commit()
        assert_envelope(publish(admin, "home_a", 1), 422, "unknown_component")
        assert_envelope(admin.get("/api/app/screens/home_a", params=RUNTIME), 404,
                        "screen_not_found")

    def test_history_is_kept_newest_first(self, admin):
        put(admin, "home_a", simple(title="One"))
        publish(admin, "home_a")
        put(admin, "home_a", simple(title="Two"))
        history = admin.get("/api/app/screens/home_a/versions").json()
        assert [(row["version"], row["status"], row["serving"]) for row in history] == [
            (2, "draft", False), (1, "published", True)]


class TestRollback:
    @pytest.fixture
    def two_published(self, admin):
        for title in ("One", "Two"):
            put(admin, "home_a", simple(title=title))
            publish(admin, "home_a")
        return admin

    def test_rollback_appends_a_copy_rather_than_rewinding(self, two_published):
        admin = two_published
        response = admin.post("/api/app/screens/home_a/rollback", json={"to_version": 1})
        assert response.status_code == 201, response.text
        row = response.json()
        assert (row["version"], row["source_version"], row["status"]) == (3, 1, "published")

        served = admin.get("/api/app/screens/home_a", params=RUNTIME).json()
        assert (served["version"], served["title"]) == (3, "One")
        history = admin.get("/api/app/screens/home_a/versions").json()
        assert [row["version"] for row in history] == [3, 2, 1]
        assert all(row["status"] == "published" for row in history)

    def test_rolling_back_to_the_served_version_is_refused(self, two_published):
        response = two_published.post("/api/app/screens/home_a/rollback", json={"to_version": 2})
        assert_envelope(response, 409, "already_current", "to_version")

    def test_a_draft_cannot_be_rolled_back_to(self, two_published):
        put(two_published, "home_a", simple(title="Draft"))
        response = two_published.post("/api/app/screens/home_a/rollback", json={"to_version": 3})
        assert_envelope(response, 409, "not_published")

    def test_a_missing_version_is_404(self, two_published):
        response = two_published.post("/api/app/screens/home_a/rollback", json={"to_version": 9})
        assert_envelope(response, 404, "version_not_found")


# ------------------------------------------------------------------- caching


class TestCaching:
    @pytest.fixture
    def served(self, admin):
        put(admin, "home_a", simple())
        publish(admin, "home_a")
        return admin

    def test_the_answer_carries_an_etag_and_revalidation_headers(self, served):
        response = served.get("/api/app/screens/home_a", params=RUNTIME)
        assert response.status_code == 200
        assert response.headers["ETag"] == response.json()["etag"]
        assert response.headers["Cache-Control"] == "private, no-cache"
        assert "Authorization" in response.headers["Vary"]

    def test_a_matching_if_none_match_is_304_with_no_body(self, served):
        etag = served.get("/api/app/screens/home_a", params=RUNTIME).headers["ETag"]
        again = served.get("/api/app/screens/home_a", params=RUNTIME,
                           headers={"If-None-Match": etag})
        assert again.status_code == 304
        assert again.content == b""
        assert again.headers["ETag"] == etag

    def test_a_weak_or_listed_tag_also_matches(self, served):
        etag = served.get("/api/app/screens/home_a", params=RUNTIME).headers["ETag"]
        again = served.get("/api/app/screens/home_a", params=RUNTIME,
                           headers={"If-None-Match": f'"other", W/{etag}'})
        assert again.status_code == 304

    def test_have_version_is_304_for_a_client_without_headers(self, served):
        response = served.get("/api/app/screens/home_a", params={**RUNTIME, "have_version": 1})
        assert response.status_code == 304

    def test_a_new_version_invalidates_the_old_tag(self, served):
        etag = served.get("/api/app/screens/home_a", params=RUNTIME).headers["ETag"]
        put(served, "home_a", simple(title="Newer"))
        publish(served, "home_a")
        fresh = served.get("/api/app/screens/home_a", params={**RUNTIME, "have_version": 1},
                           headers={"If-None-Match": etag})
        assert fresh.status_code == 200
        assert fresh.json()["version"] == 2
        assert fresh.headers["ETag"] != etag

    def test_the_capability_check_runs_before_a_304(self, admin):
        put(admin, "policy_board", simple(), required_capability="policy.read")
        publish(admin, "policy_board")
        etag = admin.get("/api/app/screens/policy_board", params=RUNTIME).headers["ETag"]
        surveyor = admin.sign_in(SURVEYOR)
        response = surveyor.get("/api/app/screens/policy_board", params=RUNTIME,
                                headers={"If-None-Match": etag})
        assert response.status_code == 403

    def test_the_index_is_revalidated_the_same_way(self, served):
        first = served.get("/api/app/screens")
        assert first.json()["items"][0]["screen_id"] == "home_a"
        again = served.get("/api/app/screens", headers={"If-None-Match": first.headers["ETag"]})
        assert again.status_code == 304


class TestRuntime:
    @pytest.fixture
    def needs_newer_app(self, admin):
        put(admin, "home_new", simple(), min_app_runtime="1.2")
        publish(admin, "home_new")
        return admin

    def test_an_older_binary_is_told_to_update_rather_than_served(self, needs_newer_app):
        error = assert_envelope(
            needs_newer_app.get("/api/app/screens/home_new", params={"runtime": "1.0"}), 426,
            "app_update_required", "runtime")
        assert error["allowed"] == ["1.2"]

    def test_a_new_enough_binary_is_served(self, needs_newer_app):
        for runtime in ("1.2", "1.10", "2.0"):
            response = needs_newer_app.get("/api/app/screens/home_new",
                                           params={"runtime": runtime})
            assert response.status_code == 200, runtime

    def test_the_index_hides_screens_the_binary_cannot_render(self, needs_newer_app):
        def ids(response):
            return {item["screen_id"] for item in response.json()["items"]}

        assert "home_new" not in ids(needs_newer_app.get("/api/app/screens",
                                                         params={"runtime": "1.0"}))
        assert "home_new" in ids(needs_newer_app.get("/api/app/screens",
                                                     params={"runtime": "1.2"}))

    def test_runtime_is_required_to_fetch_a_screen(self, needs_newer_app):
        assert_envelope(needs_newer_app.get("/api/app/screens/home_new"), 422,
                        "validation_failed", "runtime")

    def test_an_unknown_screen_is_404(self, admin):
        assert_envelope(admin.get("/api/app/screens/nope", params=RUNTIME), 404,
                        "screen_not_found")
