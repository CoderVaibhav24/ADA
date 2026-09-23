"""The documented contract and the delivered one, checked against each other.

apps/web/src/api/generated is built from this schema, so a payload that has
drifted from what /api/openapi.json promises is a typed client that lies.
"""

from __future__ import annotations

import re
from typing import Any

import pytest

from tests.conftest import NODAL_ID, SUPER_ADMIN
from tests.contract import (
    APP_CONFIG,
    CAPABILITIES,
    CASE_DETAIL,
    CASE_FEATURE_COLLECTION,
    CHECK_IN,
    CODE_VALUE,
    COLLECTIONS,
    DASHBOARD_SUMMARY,
    DASHBOARD_TREND,
    EVIDENCE,
    INSPECTION_DETAIL,
    NOTICE_DETAIL,
    OPERATIONS,
    PAGE,
    PASSWORD_RESET,
    PERMISSION,
    RESURVEY_REQUEST,
    ROLE_GRANTS,
    TRANSITION,
    TYPE_COUNT,
    USER_DETAIL,
    USER_ROW,
    ZONE_ASSIGNMENT,
    ZONE_ASSIGNMENT_REVOKED,
    ZONE_COUNT,
    ZONE_DETAIL,
)

ICMS_PREFIX = "/api/icms"

# Which pinned shape each operation's 2xx body should be, once the page or array
# wrapper is taken off. The DELETE that answers 409 has no success body to pin.
DOCUMENTED_SHAPE = {
    f"GET {ICMS_PREFIX}/app-config": APP_CONFIG,
    f"GET {ICMS_PREFIX}/code-values": CODE_VALUE,
    f"GET {ICMS_PREFIX}/zones": ZONE_DETAIL,
    f"POST {ICMS_PREFIX}/zones": ZONE_DETAIL,
    f"GET {ICMS_PREFIX}/zones/TAJ": ZONE_DETAIL,
    f"PUT {ICMS_PREFIX}/zones/TAJ": ZONE_DETAIL,
    f"GET {ICMS_PREFIX}/zone-assignments": ZONE_ASSIGNMENT,
    f"POST {ICMS_PREFIX}/zone-assignments": ZONE_ASSIGNMENT,
    f"DELETE {ICMS_PREFIX}/zone-assignments": ZONE_ASSIGNMENT_REVOKED,
    f"POST {ICMS_PREFIX}/cases": CASE_DETAIL,
    f"GET {ICMS_PREFIX}/cases": None,
    f"GET {ICMS_PREFIX}/cases/CMP-2026-0006": CASE_DETAIL,
    f"PATCH {ICMS_PREFIX}/cases/CMP-2026-0001": CASE_DETAIL,
    f"POST {ICMS_PREFIX}/cases/CMP-2026-0001/assign": CASE_DETAIL,
    f"POST {ICMS_PREFIX}/cases/CMP-2026-0008/inspections": INSPECTION_DETAIL,
    f"POST {ICMS_PREFIX}/inspections/INS-2026-0001/check-in": CHECK_IN,
    f"POST {ICMS_PREFIX}/inspections/INS-2026-0001/evidence": EVIDENCE,
    f"PUT {ICMS_PREFIX}/inspections/INS-2026-0001/findings": INSPECTION_DETAIL,
    f"POST {ICMS_PREFIX}/inspections/INS-2026-0001/submit": INSPECTION_DETAIL,
    f"POST {ICMS_PREFIX}/inspections/INS-2026-0002/verify": INSPECTION_DETAIL,
    f"POST {ICMS_PREFIX}/cases/CMP-2026-0007/resurvey-requests": RESURVEY_REQUEST,
    f"POST {ICMS_PREFIX}/resurvey-requests/1/decide": RESURVEY_REQUEST,
    f"GET {ICMS_PREFIX}/inspections/INS-2026-0001": INSPECTION_DETAIL,
    f"GET {ICMS_PREFIX}/inspections/INS-2026-0001/evidence": EVIDENCE,
    f"GET {ICMS_PREFIX}/cases/CMP-2026-0008/resurvey-requests": RESURVEY_REQUEST,
    f"POST {ICMS_PREFIX}/cases/CMP-2026-0009/handover": CASE_DETAIL,
    f"POST {ICMS_PREFIX}/cases/CMP-2026-0010/confirm": CASE_DETAIL,
    # Answers bytes, so there is no JSON row to pin.
    f"GET {ICMS_PREFIX}/evidence/1/content": None,
    f"POST {ICMS_PREFIX}/cases/CMP-2026-0011/notices": NOTICE_DETAIL,
    f"GET {ICMS_PREFIX}/notices": None,
    f"GET {ICMS_PREFIX}/notices/NTC-2026-0001": NOTICE_DETAIL,
    # Answers the stored PDF, so there is no JSON row to pin.
    f"GET {ICMS_PREFIX}/notices/NTC-2026-0001/pdf": None,
    f"GET {ICMS_PREFIX}/me/capabilities": CAPABILITIES,
    f"GET {ICMS_PREFIX}/admin/policy/permissions": PERMISSION,
    f"GET {ICMS_PREFIX}/admin/policy/roles": ROLE_GRANTS,
    f"PUT {ICMS_PREFIX}/admin/policy/roles/field-surveyor/permissions": ROLE_GRANTS,
    f"DELETE {ICMS_PREFIX}/admin/policy/permissions/case.read": None,
    f"GET {ICMS_PREFIX}/admin/policy/transitions": TRANSITION,
    f"PATCH {ICMS_PREFIX}/admin/policy/transitions/1": TRANSITION,
    f"GET {ICMS_PREFIX}/admin/users": USER_ROW,
    f"POST {ICMS_PREFIX}/admin/users": USER_DETAIL,
    f"GET {ICMS_PREFIX}/admin/users/{NODAL_ID}": USER_DETAIL,
    f"PATCH {ICMS_PREFIX}/admin/users/{NODAL_ID}": USER_DETAIL,
    f"PUT {ICMS_PREFIX}/admin/users/{NODAL_ID}/roles": USER_DETAIL,
    f"POST {ICMS_PREFIX}/admin/users/{NODAL_ID}/reset-password": PASSWORD_RESET,
    f"GET {ICMS_PREFIX}/dashboard/summary": DASHBOARD_SUMMARY,
    f"GET {ICMS_PREFIX}/dashboard/trend": DASHBOARD_TREND,
    f"GET {ICMS_PREFIX}/dashboard/by-type": TYPE_COUNT,
    f"GET {ICMS_PREFIX}/dashboard/by-zone": ZONE_COUNT,
    # The collection itself, not a row: `row_schema` leaves it alone because a
    # FeatureCollection carries `features`, not `items`.
    f"GET {ICMS_PREFIX}/cases.geojson": CASE_FEATURE_COLLECTION,
}

# The register rows differ from the detail shapes, so they come from COLLECTIONS.
DOCUMENTED_SHAPE.update({f"GET {path}": item for path, item, _ in COLLECTIONS})


@pytest.fixture
def schema(icms_client):
    return icms_client.sign_in(SUPER_ADMIN).get("/api/openapi.json").json()


def resolve(schema: dict, node: Any) -> Any:
    """Follows a local $ref. A schema that still holds one cannot be compared."""
    seen = 0
    while isinstance(node, dict) and "$ref" in node:
        seen += 1
        assert seen < 20, f"$ref cycle at {node['$ref']}"
        name = node["$ref"].rsplit("/", 1)[-1]
        node = schema["components"]["schemas"][name]
    return node


# Matches a concrete request path against the templated paths the schema declares.
def documented_path(schema: dict, path: str) -> str:
    path = path.split("?")[0]
    if path in schema["paths"]:
        return path
    candidates = [
        template for template in schema["paths"]
        if re.fullmatch(re.sub(r"\{[^}]+\}", "[^/]+", template), path)
    ]
    assert len(candidates) == 1, f"{path} matches {candidates or 'no'} documented path"
    return candidates[0]


def response_schema(schema: dict, op) -> dict:
    operation = schema["paths"][documented_path(schema, op.path)][op.method.lower()]
    documented = operation["responses"].get(str(op.ok))
    assert documented is not None, (
        f"{op.id}: the schema documents {sorted(operation['responses'])}, not {op.ok}"
    )
    content = documented.get("content", {}).get("application/json")
    return resolve(schema, content["schema"]) if content else {}


# Unwraps the page and array envelopes so the row shape can be compared directly.
def row_schema(schema: dict, node: dict) -> dict:
    node = resolve(schema, node)
    if node.get("type") == "array":
        return resolve(schema, node["items"])
    if "items" in node.get("properties", {}):
        return resolve(schema, resolve(schema, node["properties"]["items"])["items"])
    return node


_JSON_TYPES = {
    "object": dict, "array": list, "string": str, "boolean": bool,
    "integer": int, "number": (int, float),
}


# A JSON Schema subset, enough for what FastAPI emits and no dependency added.
def violations(schema: dict, node: Any, value: Any, path: str = "$") -> list[str]:
    node = resolve(schema, node)
    if not node or node is True:
        return []

    if "anyOf" in node:
        if any(not violations(schema, branch, value, path) for branch in node["anyOf"]):
            return []
        return [f"{path}: {value!r} matches none of the documented alternatives"]

    if "const" in node and value != node["const"]:
        return [f"{path}: {value!r} is not the documented constant {node['const']!r}"]
    if "enum" in node and value not in node["enum"]:
        return [f"{path}: {value!r} is not one of {node['enum']}"]

    declared = node.get("type")
    if declared == "null":
        return [] if value is None else [f"{path}: expected null, got {value!r}"]
    if declared in _JSON_TYPES:
        expected = _JSON_TYPES[declared]
        if declared in ("integer", "number") and isinstance(value, bool):
            return [f"{path}: expected {declared}, got a boolean"]
        if not isinstance(value, expected):
            return [f"{path}: expected {declared}, got {type(value).__name__}"]

    problems: list[str] = []
    if declared == "object" or "properties" in node:
        properties = node.get("properties", {})
        for name in node.get("required", ()):
            if name not in value:
                problems.append(f"{path}.{name}: documented as required and missing")
        for name, item in value.items():
            if name in properties:
                problems += violations(schema, properties[name], item, f"{path}.{name}")
            elif node.get("additionalProperties") is False:
                problems.append(f"{path}.{name}: delivered but not documented")
    if declared == "array" and "items" in node:
        for index, item in enumerate(value):
            problems += violations(schema, node["items"], item, f"{path}[{index}]")
    return problems


class TestCoverage:
    def test_every_mounted_icms_operation_has_a_contract(self, schema):
        """A fourteenth endpoint added without a row in contract.py fails here rather
        than shipping with no contract at all."""
        mounted = {
            f"{method.upper()} {path}"
            for path, operations in schema["paths"].items()
            if path.startswith(ICMS_PREFIX)
            for method in operations
            if method in ("get", "post", "put", "patch", "delete")
        }
        covered = {
            f"{op.method} {documented_path(schema, op.path)}" for op in OPERATIONS
        }

        assert mounted == covered, (
            f"contract coverage: untested {sorted(mounted - covered)}, "
            f"stale {sorted(covered - mounted)}"
        )

    def test_every_operation_declares_a_concrete_success_schema(self, schema):
        """A route that lost its response_model documents nothing, and the generated
        client then types its answer as `any`."""
        for op in OPERATIONS:
            # A binary download documents a media type rather than a schema:
            # `application/octet-stream` with no `schema` is what it delivers.
            if op.ok >= 400 or op.binary:
                continue
            documented = response_schema(schema, op)
            assert documented, f"{op.id}: the {op.ok} response has no documented schema"

    def test_no_icms_operation_is_mounted_twice_under_different_prefixes(self, schema):
        icms = [path for path in schema["paths"] if "/icms" in path]

        assert all(path.startswith(ICMS_PREFIX) for path in icms), sorted(icms)


class TestTheDeliveredPayloadMatchesTheDocumentedOne:
    @pytest.mark.parametrize(
        "op", [op for op in OPERATIONS if op.ok < 400 and not op.binary],
        ids=lambda op: op.id)
    def test_a_real_success_response_validates_against_its_documented_schema(
        self, icms_client, contract_world, schema, op
    ):
        response = op.send_as_permitted(icms_client)
        assert response.status_code == op.ok, response.text[:300]
        if not response.content:
            return

        problems = violations(schema, response_schema(schema, op), response.json())
        assert not problems, f"{op.id} · documented vs delivered: " + "; ".join(problems)

    @pytest.mark.parametrize("op", [op for op in OPERATIONS if DOCUMENTED_SHAPE[op.id]],
                             ids=lambda op: op.id)
    def test_the_documented_row_has_exactly_the_fields_this_suite_pins(self, schema, op):
        """Ties the schema the frontend compiles against to the shapes above, so the
        two cannot drift apart without one of them failing."""
        documented = set(row_schema(schema, response_schema(schema, op)).get("properties", {}))
        pinned = set(DOCUMENTED_SHAPE[op.id])

        assert documented == pinned, (
            f"{op.id} · documented row: schema has {sorted(documented - pinned)} extra, "
            f"{sorted(pinned - documented)} missing"
        )

    def test_the_page_envelope_is_documented_as_the_same_seven_keys(self, schema):
        for path, _, _ in COLLECTIONS:
            node = resolve(schema, schema["paths"][path]["get"]["responses"]["200"]
                           ["content"]["application/json"]["schema"])
            assert set(node["properties"]) == set(PAGE), (
                f"GET {path} · the documented page envelope is {sorted(node['properties'])}"
            )


class TestTheDocumentedTypes:
    @pytest.mark.parametrize("model,fields", [
        ("ZoneOut", ["created_at", "updated_at"]),
        ("ZoneAssignmentOut", ["created_at"]),
        ("CaseRow", ["raised_at"]),
        ("CaseDetail", ["raised_at", "updated_at"]),
        # The nullable IST fields (scheduled_for, started_at, submitted_at) are
        # documented as `anyOf: [string, null]`; this clause is about the
        # non-nullable ones, which must be a bare `string` and never date-time.
        ("CheckInOut", ["device_timestamp", "server_timestamp"]),
        ("EvidenceOut", ["uploaded_at"]),
    ])
    def test_every_ist_field_is_documented_as_a_string(self, schema, model, fields):
        """IstDateTime serialises through a PlainSerializer returning str, so the schema
        says `string` and carries no `format: date-time` for a client to key on."""
        properties = resolve(schema, schema["components"]["schemas"][model])["properties"]

        for name in fields:
            assert properties[name].get("type") == "string", (
                f"{model}.{name} is documented as {properties[name]}"
            )

    def test_a_nullable_field_is_documented_as_nullable(self, schema):
        row = resolve(schema, schema["components"]["schemas"]["CaseRow"])

        assert {"type": "null"} in row["properties"]["priority"]["anyOf"]
        assert "anyOf" not in row["properties"]["case_ref"], "case_ref is never null"

    # The ICMS routers answer every refusal with {"error": {...}} from errors.py, but
    # no route declares it, so the schema documents FastAPI's default
    # HTTPValidationError instead and documents no 401/403/404/409 at all. The
    # generated client therefore has the wrong type for every error it will ever see.
    @pytest.mark.xfail(
        strict=True,
        reason="no ICMS route declares `responses=`, so the error envelope is undocumented",
    )
    def test_the_error_envelope_is_documented(self, schema):
        documented = schema["paths"][f"{ICMS_PREFIX}/cases"]["get"]["responses"]

        assert "403" in documented
        error = resolve(schema, documented["422"]["content"]["application/json"]["schema"])
        assert set(error["properties"]) == {"error"}
