"""The ICMS response contract: exact fields, exact types, exact statuses.

Behaviour lives in the suites beside this one. This states the payload a client
compiles against, so a change to one fails here rather than in the browser.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Any

from ada_core.datetimes import now_ist

from tests.conftest import (
    JPEG_BYTES,
    LEAD,
    NODAL,
    NODAL_ID,
    SUPER_ADMIN,
    SURVEYOR,
    SURVEYOR_B_ID,
    SURVEYOR_ID,
)

# A sentinel for "this clause says nothing about that key", so that `None` stays
# usable as the assertion "this key is null".
UNSPECIFIED = object()

IST_OFFSET = timedelta(hours=5, minutes=30)
ERROR_KEYS = frozenset({"code", "message", "field", "allowed", "request_id"})
_LOOKS_LIKE_A_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}")


@dataclass(frozen=True)
class Kind:
    """A value test that no Python type expresses, named for the failure message."""

    name: str
    accepts: Callable[[Any], bool]

    def __repr__(self) -> str:
        return self.name


# Asia/Kolkata or nothing: a 'Z' here is a client rendering IST as UTC.
def is_ist(value: Any) -> bool:
    if not isinstance(value, str) or not _LOOKS_LIKE_A_TIMESTAMP.match(value):
        return False
    try:
        return datetime.fromisoformat(value).utcoffset() == IST_OFFSET
    except ValueError:
        return False


IST = Kind("an IST timestamp ending +05:30", is_ist)
NUM = Kind("a number", lambda v: isinstance(v, (int, float)) and not isinstance(v, bool))


# bool is a subclass of int, so a plain isinstance would let True pass for a count.
def _matches(value: Any, kind: Any) -> bool:
    if kind is None:
        return value is None
    if isinstance(kind, Kind):
        return kind.accepts(value)
    if kind is int:
        return isinstance(value, int) and not isinstance(value, bool)
    return isinstance(value, kind)


def _name_of(kind: Any) -> str:
    if kind is None:
        return "null"
    return kind.name if isinstance(kind, Kind) else kind.__name__


def _describe(kinds: tuple) -> str:
    return " or ".join(_name_of(k) for k in kinds)


# The whole object, not a couple of keys: a field quietly added or dropped is the
# regression a client notices and this suite is supposed to catch first.
def assert_shape(where: str, clause: str, body: Any, spec: Mapping[str, Any]) -> None:
    prefix = f"{where} · {clause}"
    assert isinstance(body, dict), f"{prefix}: expected an object, got {type(body).__name__}"

    actual, expected = set(body), set(spec)
    assert actual == expected, (
        f"{prefix}: the field set changed — added {sorted(actual - expected)}, "
        f"removed {sorted(expected - actual)}"
    )

    wrong = [
        f"{name}={body[name]!r} is not {_describe(kinds if isinstance(kinds, tuple) else (kinds,))}"
        for name, kinds in spec.items()
        if not any(
            _matches(body[name], k)
            for k in (kinds if isinstance(kinds, tuple) else (kinds,))
        )
    ]
    assert not wrong, f"{prefix}: " + "; ".join(wrong)


# Status AND envelope together: a 404 carrying a bare {"detail": ...} is a client
# that cannot tell the user anything, which is the half a status code misses.
def assert_error(
    where: str,
    clause: str,
    response,
    *,
    status: int,
    code: str,
    field: Any = UNSPECIFIED,
    allowed: Any = UNSPECIFIED,
) -> dict:
    prefix = f"{where} · {clause}"
    assert response.status_code == status, (
        f"{prefix}: expected {status}, got {response.status_code} — {response.text[:300]}"
    )

    body = response.json()
    assert set(body) == {"error"}, f"{prefix}: envelope keys are {sorted(body)}, expected ['error']"
    error = body["error"]
    assert set(error) == ERROR_KEYS, (
        f"{prefix}: error keys are {sorted(error)}, expected {sorted(ERROR_KEYS)}"
    )
    assert error["code"] == code, f"{prefix}: code is {error['code']!r}, expected {code!r}"
    assert isinstance(error["message"], str) and error["message"], f"{prefix}: message is empty"
    assert isinstance(error["request_id"], str) and error["request_id"], (
        f"{prefix}: no request_id, so this failure cannot be found in the logs"
    )
    if field is not UNSPECIFIED:
        assert error["field"] == field, f"{prefix}: field is {error['field']!r}, expected {field!r}"
    if allowed is not UNSPECIFIED:
        assert error["allowed"] == allowed, (
            f"{prefix}: allowed is {error['allowed']!r}, expected {allowed!r}"
        )
    return error


# Finds a timestamp anywhere in a payload, including one added since this file was
# written — a hand-listed set of fields would not notice a new column.
def ist_strings(payload: Any, path: str = "") -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    if isinstance(payload, dict):
        for key, value in payload.items():
            found += ist_strings(value, f"{path}.{key}" if path else key)
    elif isinstance(payload, list):
        for index, value in enumerate(payload):
            found += ist_strings(value, f"{path}[{index}]")
    elif isinstance(payload, str) and _LOOKS_LIKE_A_TIMESTAMP.match(payload):
        found.append((path, payload))
    return found


# --------------------------------------------------------------- the shapes
#
# One entry per field: the name, the JSON types it may hold, and `None` when the
# column is nullable. These are the frontend's and the survey app's data model.

PAGE = {
    "items": list,
    "page": int,
    "size": int,
    "total": int,
    "pages": int,
    "sort": str,
    "next_cursor": (str, None),
}

CODE_VALUE = {
    "id": int, "domain": str, "code": str, "label": str,
    "label_hi": (str, None), "parent_code": (str, None),
    "sort_order": int, "active": bool,
}

ZONE = {
    "id": int, "zone_cd": str, "name": str, "name_hi": (str, None),
    "parent_cd": (str, None), "active": bool, "has_geometry": bool,
    "created_at": IST, "updated_at": IST,
}

ZONE_DETAIL = {**ZONE, "geometry": (dict, None)}

ZONE_ASSIGNMENT = {
    "id": int, "zone_id": int, "zone_cd": str, "zone_name": str, "user_id": str,
    "active": bool, "assigned_by": (str, None),
    "created_at": IST, "revoked_at": (IST, None),
}

ZONE_ASSIGNMENT_REVOKED = {
    "zone_cd": str, "user_id": str, "revoked": bool, "revoked_at": (IST, None),
}

CASE_ROW = {
    "case_ref": str, "zone_cd": str, "zone_name": str,
    "property_address": (str, None), "landmark": (str, None),
    "complainant_name": (str, None), "complaint_type_cd": (str, None),
    "complaint_type_label": (str, None), "other_type": (str, None),
    "measured_area_sqm": (NUM, None), "priority": (str, None),
    "ulpin": (str, None), "khasra_no": (str, None), "village_lgd_code": (str, None),
    "status": str, "stage_no": int, "current_round": int, "source": str,
    "assignee_user_id": (str, None), "raised_at": IST,
    # Derived from ulpin/khasra_no rather than stored. It is in the payload and in
    # the schema, so it is part of the contract like any other field.
    "parcel_id": (str, None),
}

CASE_ASSIGNMENT = {
    "assignee_user_id": str, "assigned_by": str, "assignment_type": str,
    "note": (str, None), "assigned_at": IST, "active": bool, "released_at": (IST, None),
}

INSPECTION_ROUND = {
    "inspection_ref": str, "round_no": int, "surveyor_user_id": str, "status": str,
    "submitted_at": (IST, None), "measured_area_sqm": (NUM, None),
}

CASE_DETAIL = {
    **CASE_ROW,
    "detail": (str, None), "complainant_phone": (str, None),
    "complainant_email": (str, None), "owner_name": (str, None),
    "owner_phone": (str, None), "police_station": (str, None),
    "pin_code": (str, None), "district": (str, None), "state": (str, None),
    "country": (str, None), "property_type_cd": (str, None),
    "floor_count": (int, None), "detection_id": (int, None),
    "district_lgd_code": (str, None), "idempotency_key": (str, None),
    "location": (dict, None), "closed_at": (IST, None), "created_by": (str, None),
    "updated_at": IST, "assignment": (dict, None), "rounds": list,
    "evidence_count": int, "allowed_actions": list,
}

# ---- Batch 3, the inspection loop (docs/icms/batch-3-contract.md section 3)

INSPECTION_ROW = {
    "inspection_ref": str, "case_ref": str, "case_title": (str, None),
    "round_no": int, "status": str, "zone_cd": (str, None),
    "zone_name": (str, None), "priority": (str, None),
    "surveyor_user_id": str, "surveyor_name": (str, None),
    "scheduled_for": (IST, None), "started_at": (IST, None),
    "submitted_at": (IST, None),
    "evidence_count": int, "finding_count": int, "has_check_in": bool,
}

FINDING = {"seq": int, "finding": str, "created_at": IST}

SECTION = {"act_cd": str, "section_cd": str}

CHECK_IN = {
    "id": int, "inspection_ref": str, "user_id": str,
    "lat": (NUM, None), "lon": (NUM, None), "accuracy_m": NUM,
    "device_timestamp": IST, "server_timestamp": IST, "capture_source": str,
    "inside_zone": (bool, None),
}

# `geotag_flagged` is computed at write time and stored nowhere: the accuracy
# threshold is server configuration a browser cannot read, so the flag travels.
EVIDENCE = {
    "id": int, "case_ref": str, "inspection_ref": (str, None),
    "round_no": (int, None), "kind": str, "doc_type_cd": (str, None),
    "original_filename": (str, None), "content_type": (str, None),
    "byte_size": (int, None), "sha256": (str, None),
    "lat": (NUM, None), "lon": (NUM, None), "accuracy_m": (NUM, None),
    "device_timestamp": (IST, None), "capture_source": (str, None),
    "captured_at": (IST, None), "uploaded_by": str, "uploaded_at": IST,
    "content_url": str, "geotag_flagged": bool,
}

INSPECTION_DETAIL = {
    **INSPECTION_ROW,
    "case_status": str, "occupant_name": (str, None), "occupant_phone": (str, None),
    "area_type_cd": (str, None), "measured_area_sqm": (NUM, None),
    "notice_required": (bool, None), "notice_act_cd": (str, None),
    "officer_note": (str, None), "location": (dict, None),
    "location_accuracy_m": (NUM, None),
    "findings": list, "sections": list, "check_ins": list, "evidence": list,
    "available_actions": list,
}

RESURVEY_REQUEST = {
    "id": int, "case_ref": str, "from_round": int, "reason": str,
    "requested_by": str, "requested_at": IST, "decision": str,
    "decided_by": (str, None), "decided_at": (IST, None),
    "decision_note": (str, None), "resulting_round": (int, None),
}

# ---- Batch 6, the notice (docs/icms/batch-6-contract.md section 3)

# `status` is DERIVED: `overdue` is computed from `compliance_due` on every read
# and is never a stored value, so a client must not expect it to match a column.
# `compliance_due` is a bare ISO date, not a timestamp — a compliance period is
# counted in days and a notice served at 23:45 IST does not expire at 23:45.
NOTICE_ROW = {
    "notice_ref": str, "case_ref": str, "act_cd": str, "section_cds": list,
    "status": str, "issued_by": (str, None), "issued_at": (IST, None),
    "compliance_due": (str, None), "zone_cd": (str, None),
    "property_address": (str, None), "has_artefact": bool,
}

# `deliveries` is always `[]`. The Parivartan App owns delivery tracking by
# section 3a, so `icms_notice_delivery` has a table and no endpoint; the key is
# in the shape from the start so it does not appear later as a breaking change.
NOTICE_DETAIL = {
    **NOTICE_ROW,
    "body": (dict, None), "issuing_authority": (str, None),
    "artefact_sha256": (str, None), "inspection_ref": (str, None),
    "deliveries": list,
}

CAPABILITY_ACTION = {
    "action": str, "source_status": (str, None), "target_status": str,
    "stage_no": int, "assignee_only": bool, "opens_round": bool, "requires": list,
}

CAPABILITIES = {
    "user_id": str, "roles": list, "permissions": list, "zone_ids": list,
    "unrestricted": bool, "actions": list, "policy_revision": int,
    "policy_source": str, "advisory": bool,
}

# Three keys and no envelope: a field client reads this once at start-up, so a
# fourth key appearing is a contract change and fails here.
APP_CONFIG = {
    "gps_accuracy_gate_m": NUM, "gps_accuracy_flag_m": NUM,
    "device_timestamp_max_age_hours": NUM,
    # Published since 2026-09-23 because they are enforced: `submit` refuses a
    # round below the minimum and `add_evidence` a photograph past the maximum.
    "minimum_photo_count": int, "maximum_photo_count": int,
}

PERMISSION = {
    "permission_cd": str, "resource": str, "action": str, "label": str, "is_system": bool,
}

ROLE_GRANTS = {"role_cd": str, "label": str, "active": bool, "permission_cds": list}

TRANSITION = {
    "id": int, "action_cd": str, "source_status": (str, None), "target_status": str,
    "stage_no": int, "assignee_only": bool, "opens_round": bool,
    "requires": list, "roles": list, "active": bool, "sort_order": int,
    "note": (str, None),
}

# Keycloak is the user store, so `id` is the subject ICMS rows already hold and
# there is no local row carrying an ADA id beside it. `created_at` is nullable
# because a Keycloak representation can arrive without createdTimestamp.
USER_ROW = {
    "id": str, "username": str, "first_name": (str, None), "last_name": (str, None),
    "email": (str, None), "enabled": bool, "email_verified": bool,
    "created_at": (IST, None),
}

# The register omits roles: Keycloak returns no role mappings with a user list,
# so carrying them would be one extra round trip per row.
USER_DETAIL = {**USER_ROW, "realm_roles": list, "required_actions": list}

# No password, no token — only that a credential was set, and when.
PASSWORD_RESET = {
    "id": str, "username": str, "temporary": bool,
    "required_actions": list, "reset_at": IST,
}


# ---- Batch 5, the dashboard and the map (one shape per panel)

STATUS_COUNT = {"status": str, "count": int, "high_priority": int}

DASHBOARD_SUMMARY = {
    "total": int, "open": int, "closed": int, "rejected": int,
    "high_priority": int, "by_status": list,
}

TREND_POINT = {"period": str, "raised": int, "resolved": int}

DASHBOARD_TREND = {
    "bucket": str, "days": int, "start": str, "end": str, "points": list,
}

TYPE_COUNT = {
    "complaint_type_cd": (str, None), "label": (str, None),
    "total": int, "open": int, "resolved": int,
}

ZONE_COUNT = {
    "zone_cd": str, "zone_name": str, "total": int, "open": int, "resolved": int,
}

# `metadata` is where the count lives on both map reads — the FeatureCollection
# itself stays exactly what a GeoJSON client expects, which is why it is additive.
MAP_WINDOW = {
    "count": int, "total": int, "limit": int, "offset": int, "bbox": list,
}

CASE_FEATURE_PROPS = {
    "case_ref": str, "zone_cd": str, "status": str, "stage_no": int,
    "priority": (str, None), "complaint_type_cd": (str, None), "raised_at": IST,
}

CASE_FEATURE = {"type": str, "id": str, "geometry": (dict, None), "properties": dict}

CASE_FEATURE_COLLECTION = {"type": str, "features": list, "metadata": dict}


# ----------------------------------------------------------- the operations
#
# Every ICMS operation, with the roles admitted to it and the status an admitted
# caller gets. Adding an endpoint or a role is one line here, and
# test_contract_openapi.py fails if an operation is mounted and not listed.

ALL_ROLES = frozenset({SUPER_ADMIN, NODAL, SURVEYOR, LEAD})
ENFORCEMENT = frozenset({NODAL, SURVEYOR, LEAD})
NODAL_ONLY = frozenset({NODAL})
SURVEYOR_ONLY = frozenset({SURVEYOR})
LEAD_ONLY = frozenset({LEAD})
# `open_round`, and the re-survey decision that performs one.
OPENERS = frozenset({NODAL, SURVEYOR})
ADMIN_ONLY = frozenset({SUPER_ADMIN})
# `dashboard.read`, which the seed grants to every role but the surveyor.
DASHBOARD_READERS = frozenset({SUPER_ADMIN, NODAL, LEAD})
# `notice.read`, granted by the seed to the same three and to no surveyor. A
# Field Surveyor inspects; the notice is the authority's instrument, not the
# surveyor's, and nothing in the field app reads one.
NOTICE_READERS = frozenset({SUPER_ADMIN, NODAL, LEAD})

# Inside the twelve hours ada_core.validation allows a device clock to differ by.
DEVICE_NOW = now_ist().isoformat()

RAISE_BODY = {
    "source": "public",
    "zone_cd": "TAJ",
    "complaint_type_cd": "unauthorised_construction",
    "complainant_name": "Nisha Verma",
    "property_address": "88 Kamla Nagar",
}


@dataclass(frozen=True)
class Op:
    method: str
    path: str
    roles: frozenset[str]
    ok: int = 200
    body: dict | None = None
    shape: Any = None
    # Multipart, for the one operation that uploads a file. `form` and `body`
    # are exclusive: a request is either JSON or a form, never both.
    form: dict | None = None
    # Answers bytes rather than JSON, so the schema comparisons skip it.
    binary: bool = False

    @property
    def id(self) -> str:
        return f"{self.method} {self.path.split('?')[0]}"

    def send(self, client, *, role: str | None = None):
        signed = client.sign_in(*(role,)) if role else client.sign_in()
        if self.form is not None:
            return signed.request(
                self.method, self.path, data=self.form,
                files={"file": ("front.jpg", JPEG_BYTES, "image/jpeg")})
        return signed.request(self.method, self.path, json=self.body)

    def send_as_permitted(self, client):
        return self.send(client, role=sorted(self.roles)[0])


# `policy_tables` seeds the transitions in migration order, so id 1 is `raise`.
FIRST_TRANSITION = 1

OPERATIONS: tuple[Op, ...] = (
    Op("GET", "/api/icms/app-config", ALL_ROLES, shape=APP_CONFIG),
    Op("GET", "/api/icms/code-values", ALL_ROLES, shape=PAGE),
    Op("GET", "/api/icms/zones", ALL_ROLES, shape=PAGE),
    Op("POST", "/api/icms/zones", ADMIN_ONLY, ok=201, shape=ZONE_DETAIL,
       body={"zone_cd": "NEWZ", "name": "New Zone"}),
    Op("GET", "/api/icms/zones/TAJ", ALL_ROLES, shape=ZONE_DETAIL),
    Op("PUT", "/api/icms/zones/TAJ", ADMIN_ONLY, shape=ZONE_DETAIL, body={"name": "Renamed"}),
    Op("GET", "/api/icms/zone-assignments", ADMIN_ONLY, shape=PAGE),
    Op("POST", "/api/icms/zone-assignments", ADMIN_ONLY, ok=201, shape=ZONE_ASSIGNMENT,
       body={"zone_cd": "RURAL", "user_id": "contract-officer"}),
    Op("DELETE", f"/api/icms/zone-assignments?zone_cd=TAJ&user_id={NODAL_ID}", ADMIN_ONLY,
       shape=ZONE_ASSIGNMENT_REVOKED),
    # Super Admin is refused here on purpose: administration and enforcement are
    # separate authorities, and Super Admin holds no transition at all.
    Op("POST", "/api/icms/cases", ENFORCEMENT, ok=201, shape=CASE_DETAIL, body=RAISE_BODY),
    Op("GET", "/api/icms/cases", ALL_ROLES, shape=PAGE),
    # CMP-2026-0006 and not CMP-2026-0001: the case detail is read by the Field
    # Surveyor it is assigned to, and CMP-2026-0001 is assigned to nobody.
    Op("GET", "/api/icms/cases/CMP-2026-0006", ALL_ROLES, shape=CASE_DETAIL),
    Op("PATCH", "/api/icms/cases/CMP-2026-0001", NODAL_ONLY, shape=CASE_DETAIL,
       body={"priority": "low"}),
    Op("POST", "/api/icms/cases/CMP-2026-0001/assign", NODAL_ONLY, shape=CASE_DETAIL,
       body={"assignee_user_id": SURVEYOR_B_ID}),
    # Batch 3 — the inspection loop. `contract_world` seeds CMP-2026-0006 as
    # under_inspection (round INS-2026-0001), CMP-2026-0007 as
    # inspection_submitted (INS-2026-0002) and CMP-2026-0008 as
    # resurvey_requested with request 1 pending.
    # CMP-2026-0008 and not CMP-2026-0002: `open_round` admits the Field
    # Surveyor only on a case assigned to them, naming themselves, and
    # CMP-2026-0002 is surveyor B's. The re-survey case is surveyor A's.
    Op("POST", "/api/icms/cases/CMP-2026-0008/inspections", OPENERS, ok=201,
       shape=INSPECTION_DETAIL, body={"surveyor_user_id": SURVEYOR_ID}),
    Op("POST", "/api/icms/inspections/INS-2026-0001/check-in", SURVEYOR_ONLY, ok=201,
       shape=CHECK_IN,
       body={"latitude": 27.005, "longitude": 78.005, "accuracy_m": 7.0,
             "device_timestamp": DEVICE_NOW, "capture_source": "gps",
             "idempotency_key": "6f1d6dd9-8443-4b90-9a86-0f65c42b7001"}),
    Op("POST", "/api/icms/inspections/INS-2026-0001/evidence", SURVEYOR_ONLY, ok=201,
       shape=EVIDENCE,
       form={"kind": "photo", "latitude": "27.005", "longitude": "78.005",
             "accuracy_m": "6.0", "device_timestamp": DEVICE_NOW,
             "capture_source": "camera",
             "idempotency_key": "6f1d6dd9-8443-4b90-9a86-0f65c42b7002"}),
    Op("PUT", "/api/icms/inspections/INS-2026-0001/findings", SURVEYOR_ONLY,
       shape=INSPECTION_DETAIL, body={"findings": ["Unauthorised third floor."]}),
    Op("POST", "/api/icms/inspections/INS-2026-0001/submit", SURVEYOR_ONLY,
       shape=INSPECTION_DETAIL,
       body={"idempotency_key": "6f1d6dd9-8443-4b90-9a86-0f65c42b7003"}),
    Op("POST", "/api/icms/inspections/INS-2026-0002/verify", NODAL_ONLY,
       shape=INSPECTION_DETAIL, body={"decision": "accept"}),
    Op("POST", "/api/icms/cases/CMP-2026-0007/resurvey-requests", NODAL_ONLY, ok=201,
       shape=RESURVEY_REQUEST,
       body={"reason": "The measurements do not agree with the sanctioned plan."}),
    Op("POST", "/api/icms/resurvey-requests/1/decide", OPENERS,
       shape=RESURVEY_REQUEST,
       body={"decision": "approve", "surveyor_user_id": SURVEYOR_ID}),
    Op("GET", "/api/icms/inspections", ALL_ROLES, shape=PAGE),
    Op("GET", "/api/icms/inspections/INS-2026-0001", ALL_ROLES,
       shape=INSPECTION_DETAIL),
    Op("GET", "/api/icms/inspections/INS-2026-0001/evidence", ALL_ROLES,
       shape=EVIDENCE),
    Op("GET", "/api/icms/evidence/1/content", ALL_ROLES, binary=True),
    # CMP-2026-0008 is the seeded `resurvey_requested` case, so the list has the
    # pending request 1 in it rather than being an empty array to pin nothing on.
    Op("GET", "/api/icms/cases/CMP-2026-0008/resurvey-requests", ALL_ROLES,
       shape=RESURVEY_REQUEST),
    # Batch 4 — stages 6 and 7. `contract_world` seeds CMP-2026-0009 as
    # `verified` and CMP-2026-0010 as `handed_over`, which are the only statuses
    # the two transitions move from. Neither reaches outside this service: the
    # Parivartan seam is after `issue_notice` and is Batch 6's.
    Op("POST", "/api/icms/cases/CMP-2026-0009/handover", NODAL_ONLY, shape=CASE_DETAIL,
       body={"note": "Verified on site; passing to the authority."}),
    Op("POST", "/api/icms/cases/CMP-2026-0010/confirm", LEAD_ONLY, shape=CASE_DETAIL,
       body={"note": "Confirmed for notice."}),
    # Batch 6 — the notice. `contract_world` seeds CMP-2026-0011 as `confirmed`,
    # the only status `issue_notice` moves from, and NTC-2026-0001 on the closed
    # CMP-2026-0005 so the three reads have a row. There is no
    # POST /notices/{ref}/deliveries and there is not to be one: see section 3a.
    Op("POST", "/api/icms/cases/CMP-2026-0011/notices", LEAD_ONLY, ok=201,
       shape=NOTICE_DETAIL,
       body={"act_cd": "up_upda_1973", "section_cds": ["sec_27"]}),
    Op("GET", "/api/icms/notices", NOTICE_READERS, shape=PAGE),
    Op("GET", "/api/icms/notices/NTC-2026-0001", NOTICE_READERS, shape=NOTICE_DETAIL),
    # Answers the stored PDF, so there is no JSON row to pin.
    Op("GET", "/api/icms/notices/NTC-2026-0001/pdf", NOTICE_READERS, binary=True),
    Op("GET", "/api/icms/me/capabilities", ALL_ROLES, shape=CAPABILITIES),
    Op("GET", "/api/icms/admin/policy/permissions", ADMIN_ONLY, shape=PERMISSION),
    Op("GET", "/api/icms/admin/policy/roles", ADMIN_ONLY, shape=ROLE_GRANTS),
    Op("PUT", "/api/icms/admin/policy/roles/field-surveyor/permissions", ADMIN_ONLY,
       shape=ROLE_GRANTS, body={"permission_cds": ["case.read"]}),
    # Every seeded permission is a system one, so the admitted answer is the 409
    # that refuses to delete a guard an endpoint still names.
    Op("DELETE", "/api/icms/admin/policy/permissions/case.read", ADMIN_ONLY, ok=409),
    Op("GET", "/api/icms/admin/policy/transitions", ADMIN_ONLY, shape=TRANSITION),
    Op("PATCH", f"/api/icms/admin/policy/transitions/{FIRST_TRANSITION}", ADMIN_ONLY,
       shape=TRANSITION, body={"note": "contract"}),
    # Officer administration. Super Admin alone, because `user.read` and
    # `user.manage` are granted to super-admin and to nothing else in 0003 — and
    # an officer who can mint officers has given themselves every role there is.
    Op("GET", "/api/icms/admin/users", ADMIN_ONLY, shape=PAGE),
    Op("POST", "/api/icms/admin/users", ADMIN_ONLY, ok=201, shape=USER_DETAIL,
       body={"username": "contract.officer",
             "email": "contract.officer@example.invalid",
             "first_name": "Contract", "last_name": "Officer",
             "realm_roles": ["field-surveyor"]}),
    Op("GET", f"/api/icms/admin/users/{NODAL_ID}", ADMIN_ONLY, shape=USER_DETAIL),
    Op("PATCH", f"/api/icms/admin/users/{NODAL_ID}", ADMIN_ONLY, shape=USER_DETAIL,
       body={"enabled": True}),
    Op("PUT", f"/api/icms/admin/users/{NODAL_ID}/roles", ADMIN_ONLY,
       shape=USER_DETAIL, body={"realm_roles": ["pcs-nodal-officer"]}),
    Op("POST", f"/api/icms/admin/users/{NODAL_ID}/reset-password", ADMIN_ONLY,
       shape=PASSWORD_RESET, body={"password": "Contract-Pass-2026"}),
    # Batch 5 — the dashboard and the map. Not ALL_ROLES: `dashboard.read` is
    # granted to Super Admin, the nodal officer and the lead, and to a plain
    # Field Surveyor nowhere, so the surveyor column of this matrix is the
    # authorisation denial for all five.
    Op("GET", "/api/icms/dashboard/summary", DASHBOARD_READERS, shape=DASHBOARD_SUMMARY),
    Op("GET", "/api/icms/dashboard/trend", DASHBOARD_READERS, shape=DASHBOARD_TREND),
    Op("GET", "/api/icms/dashboard/by-type", DASHBOARD_READERS, shape=TYPE_COUNT),
    Op("GET", "/api/icms/dashboard/by-zone", DASHBOARD_READERS, shape=ZONE_COUNT),
    # The bbox is in the path because it is required: the map has no unbounded
    # form to send, which is the whole point of the endpoint.
    Op("GET", "/api/icms/cases.geojson?bbox=78.00,27.00,78.02,27.02", DASHBOARD_READERS,
       shape=CASE_FEATURE_COLLECTION),
)

COLLECTIONS: tuple[tuple[str, dict, list[str]], ...] = (
    ("/api/icms/code-values", CODE_VALUE, ["code", "domain", "label", "sort_order"]),
    ("/api/icms/zones", ZONE, ["created_at", "name", "updated_at", "zone_cd"]),
    ("/api/icms/zone-assignments", ZONE_ASSIGNMENT, ["created_at", "user_id", "zone_cd"]),
    (
        "/api/icms/cases",
        CASE_ROW,
        ["case_ref", "complainant_name", "complaint_type_cd", "khasra_no", "priority",
         "property_address", "raised_at", "stage_no", "status", "ulpin", "updated_at",
         "zone_cd"],
    ),
    (
        "/api/icms/inspections",
        INSPECTION_ROW,
        ["case_ref", "inspection_ref", "round_no", "scheduled_for", "started_at",
         "status", "submitted_at", "surveyor_user_id", "zone_cd"],
    ),
    (
        "/api/icms/notices",
        NOTICE_ROW,
        ["act_cd", "case_ref", "compliance_due", "issued_at", "notice_ref",
         "status", "zone_cd"],
    ),
)

COLLECTION_READER = {
    "/api/icms/code-values": SUPER_ADMIN,
    "/api/icms/zones": SUPER_ADMIN,
    "/api/icms/zone-assignments": SUPER_ADMIN,
    "/api/icms/cases": NODAL,
    # Not the surveyor: a Field Surveyor sees only their own rounds, and the
    # envelope tests need a caller the whole register is visible to.
    "/api/icms/inspections": NODAL,
    # The surveyor could not read this one at all: `notice.read` is granted to
    # the other three roles and to no surveyor.
    "/api/icms/notices": NODAL,
}
