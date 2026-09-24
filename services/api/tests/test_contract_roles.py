"""The role matrix: every ICMS operation against every role, and against none.

One row per operation in tests/contract.py names the roles admitted to it, so
adding an endpoint or a role is one line and the 100 cells follow.
"""

from __future__ import annotations

import pytest

from tests.conftest import LEAD, NODAL, SUPER_ADMIN, SURVEYOR
from tests.contract import ALL_ROLES, OPERATIONS, assert_error

PRINCIPALS = [SUPER_ADMIN, NODAL, SURVEYOR, LEAD, None]
ICMS = "/api/icms"


@pytest.mark.parametrize("role", PRINCIPALS, ids=lambda r: r or "no-role")
@pytest.mark.parametrize("op", OPERATIONS, ids=lambda op: op.id)
def test_the_status_each_role_gets(icms_client, contract_world, op, role):
    """Both halves matter: the role that owns the operation reaches it, and every
    other role is refused at the same status with the same code."""
    response = op.send(icms_client, role=role)
    permitted = role is not None and role in op.roles
    expected = op.ok if permitted else 403

    assert response.status_code == expected, (
        f"{op.id} · as {role or 'no role'}: expected {expected}, "
        f"got {response.status_code} — {response.text[:300]}"
    )
    if not permitted:
        assert_error(op.id, f"refused to {role or 'a caller with no ICMS role'}",
                     response, status=403, code="role_not_permitted")


@pytest.mark.parametrize("op", OPERATIONS, ids=lambda op: op.id)
def test_no_token_is_401_before_any_role_is_resolved(anonymous_client, op):
    """401 tells the client to refresh; 403 tells it not to bother. Confusing the
    two makes a client with an expired token retry for ever or give up wrongly."""
    response = anonymous_client.request(op.method, op.path, json=op.body)

    assert_error(op.id, "no token", response, status=401, code="unauthenticated")
    assert response.headers.get("WWW-Authenticate", "").startswith("Bearer"), (
        f"{op.id}: the 401 must say how to authenticate"
    )


class TestTheShapeOfTheMatrix:
    def test_every_operation_admits_at_least_one_role(self):
        for op in OPERATIONS:
            assert op.roles, f"{op.id} admits nobody, which cannot be intended"
            assert op.roles <= ALL_ROLES, f"{op.id} names a role the realm does not declare"

    def test_super_admin_is_refused_the_case_transitions_on_purpose(self, icms_client,
                                                                    contract_world):
        """Administration and enforcement are separate authorities. This reads like a
        bug in the matrix above, so it is stated here rather than left to be found."""
        transitions = [op for op in OPERATIONS
                       if op.path.startswith(f"{ICMS}/cases") and op.method != "GET"]

        assert len(transitions) == 11
        for op in transitions:
            assert SUPER_ADMIN not in op.roles, f"{op.id} should not admit Super Admin"
            assert op.send(icms_client, role=SUPER_ADMIN).status_code == 403

    def test_super_admin_still_reads_every_case(self, icms_client, contract_world):
        """The other half of the split: no transitions, but nothing hidden either."""
        body = icms_client.sign_in(SUPER_ADMIN).get(f"{ICMS}/cases").json()

        assert body["total"] == 12, "Super Admin is unrestricted and sees RURAL too"

    def test_only_super_admin_administers_zones_and_policy(self):
        administration = [
            op for op in OPERATIONS
            if "/admin/policy" in op.path
            or (op.path.startswith(f"{ICMS}/zone") and op.method != "GET")
        ]

        for op in administration:
            assert op.roles == frozenset({SUPER_ADMIN}), (
                f"{op.id} admits {sorted(op.roles)}; administration is Super Admin's alone"
            )

    def test_the_four_read_surfaces_are_open_to_every_officer(self):
        """A form that cannot load its dropdowns is a form nobody fills."""
        open_to_all = {op.id for op in OPERATIONS if op.roles == ALL_ROLES}

        assert open_to_all == {
            # No permission at all, not even `reference.read`: a field client
            # that cannot read the accuracy rule falls back to a stale copy.
            f"GET {ICMS}/app-config",
            f"GET {ICMS}/code-values",
            f"GET {ICMS}/zones",
            f"GET {ICMS}/zones/TAJ",
            f"GET {ICMS}/cases",
            f"GET {ICMS}/cases/CMP-2026-0006",
            f"GET {ICMS}/cases/CMP-2026-0006/evidence",
            f"GET {ICMS}/cases/CMP-2026-0006/evidence/2/content",
            f"GET {ICMS}/me/capabilities",
            # Batch 3's reads. `inspection.read` and `evidence.read` are granted
            # to all four roles: a verifier who cannot see the photograph cannot
            # verify anything, and the field app needs its own work list.
            f"GET {ICMS}/inspections",
            f"GET {ICMS}/inspections/INS-2026-0001",
            f"GET {ICMS}/inspections/INS-2026-0001/evidence",
            f"GET {ICMS}/evidence/1/content",
            f"GET {ICMS}/evidence/1/stamped",
            f"GET {ICMS}/cases/CMP-2026-0008/resurvey-requests",
        }
