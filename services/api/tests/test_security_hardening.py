"""S-03, S-04 and S-10 from the enterprise review.

S-03  only ada-web / ada-field ACCESS tokens for a PERSON reach a router.
S-04  the imagery routers require imagery.read (GET) / imagery.write (writes).
S-10  ML_SERVICE_TOKEN may be empty only when ADA_ENV=local.
"""

from __future__ import annotations

import time

import httpx
import jwt
import pytest
from pydantic import ValidationError

from .conftest import ISSUER, OWNER, SURVEYOR, icms_principal

LEAD_ROLES = {"realm_access": {"roles": ["ada-project-lead"]}}


def _token(signing_key, **claims) -> str:
    now = int(time.time())
    body = {
        "iss": ISSUER, "sub": OWNER, "iat": now, "exp": now + 300,
        "typ": "Bearer", "azp": "ada-web", "scope": "openid profile email",
        "preferred_username": "officer", "email": "officer@pcsmcpl.net",
        **LEAD_ROLES,
    }
    body.update(claims)
    body = {key: value for key, value in body.items() if value is not None}
    return jwt.encode(body, signing_key, algorithm="RS256", headers={"kid": "test-key-1"})


@pytest.fixture
def realm(monkeypatch, realm_transport):
    """The process verifier, built exactly as the API builds it, on the test JWKS."""
    from app import security

    monkeypatch.setattr(
        security, "auth",
        security.build_auth(client=httpx.Client(transport=realm_transport)),
    )


def _get(client, token: str):
    return client.get("/api/projects", headers={"Authorization": f"Bearer {token}"})


# --- S-03 -------------------------------------------------------------------


class TestTokenPurpose:
    def test_an_ada_web_access_token_is_accepted(self, realm, anonymous_client, signing_key):
        assert _get(anonymous_client, _token(signing_key)).status_code == 200

    def test_an_ada_field_access_token_is_accepted(self, realm, anonymous_client, signing_key):
        response = _get(anonymous_client, _token(signing_key, azp="ada-field"))
        assert response.status_code == 200

    def test_an_id_token_is_rejected(self, realm, anonymous_client, signing_key):
        response = _get(anonymous_client, _token(signing_key, typ="ID"))
        assert response.status_code == 401
        assert response.json()["error"]["code"] == "unauthenticated"

    def test_a_foreign_azp_is_rejected(self, realm, anonymous_client, signing_key):
        response = _get(anonymous_client, _token(signing_key, azp="hrms-portal"))
        assert response.status_code == 401

    def test_a_service_account_token_is_rejected(self, realm, anonymous_client, signing_key):
        token = _token(signing_key, azp="ada-web",
                       preferred_username="service-account-ada-web", email=None)
        assert _get(anonymous_client, token).status_code == 401

    def test_the_allowlist_comes_from_settings(self):
        from app.config import Settings, settings

        assert settings.oidc_allowed_azp == ["ada-web", "ada-field", "ada-auth"]
        parsed = Settings(oidc_allowed_azp="ada-web, ada-kiosk")  # type: ignore[arg-type]
        assert parsed.oidc_allowed_azp == ["ada-web", "ada-kiosk"]

    def test_the_allowlist_reads_the_environment(self, monkeypatch):
        from app.config import Settings

        monkeypatch.setenv("OIDC_ALLOWED_AZP", "ada-web,ada-field,ada-kiosk")
        assert Settings().oidc_allowed_azp == ["ada-web", "ada-field", "ada-kiosk"]


# --- S-04 -------------------------------------------------------------------


class TestImageryPermissions:
    def test_a_token_with_no_icms_role_gets_403_on_list(
        self, realm, anonymous_client, signing_key
    ):
        token = _token(signing_key, realm_access={"roles": ["offline_access"]})
        response = _get(anonymous_client, token)
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "role_not_permitted"

    def test_no_role_is_403_through_the_dependency_override_too(self, icms_client):
        icms_client.sign_in()
        assert icms_client.get("/api/projects").status_code == 403

    def test_a_surveyor_can_read_but_not_create(self, icms_client):
        surveyor = icms_client.sign_in(SURVEYOR)
        assert surveyor.get("/api/projects").status_code == 200
        response = surveyor.post("/api/projects", json={"name": "Agra"})
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "role_not_permitted"

    def test_writers_can_create(self, icms_client):
        nodal = icms_client.sign_in("pcs-nodal-officer")
        response = nodal.post("/api/projects", json={"name": "Agra"})
        assert response.status_code == 200

    @pytest.mark.parametrize("role", ["super-admin", "ada-project-lead", SURVEYOR])
    def test_only_the_nodal_officer_writes_imagery(self, icms_client, role):
        response = icms_client.sign_in(role).post("/api/projects", json={"name": "Agra"})
        assert response.status_code == 403

    @pytest.mark.parametrize("method,path", [
        ("GET", "/api/projects/1/rasters"),
        ("GET", "/api/projects/1/red-zones"),
        ("GET", "/api/projects/1/analyses"),
        ("GET", "/api/analyses/1"),
        ("GET", "/api/tiles/raster/1/info"),
        ("DELETE", "/api/rasters/1"),
        ("DELETE", "/api/red-zones/1"),
        ("DELETE", "/api/analyses/1"),
        ("POST", "/api/projects/1/analyses"),
    ])
    def test_every_imagery_router_is_gated(self, icms_client, method, path):
        icms_client.sign_in()
        assert icms_client.request(method, path).status_code == 403

    def test_a_surveyor_cannot_delete_on_any_imagery_router(self, icms_client):
        surveyor = icms_client.sign_in(SURVEYOR)
        for path in ("/api/rasters/1", "/api/red-zones/1", "/api/analyses/1"):
            assert surveyor.delete(path).status_code == 403, path

    def test_ownership_still_applies_after_the_permission(self, icms_client, foreign_project):
        lead = icms_client.sign_in("ada-project-lead")
        assert lead.get(f"/api/projects/{foreign_project.id}").status_code == 404

    def test_the_seed_grants(self):
        from app.icms import policy

        grants = policy.DEFAULT_GRANTS
        change_detection = {"change_detection.access", "imagery.write", "imagery.run"}
        assert change_detection <= grants["pcs-nodal-officer"]
        for role in ("super-admin", "ada-project-lead", "field-surveyor"):
            assert "imagery.read" in grants[role], role
            assert not grants[role] & change_detection, role
        assert not grants["public"] & {"imagery.read", "imagery.write"}


# --- S-10 -------------------------------------------------------------------


class TestMlServiceToken:
    @pytest.mark.parametrize("env", ["production", "staging"])
    def test_empty_token_outside_local_refuses_to_start(self, env):
        from app.config import Settings

        with pytest.raises(ValidationError, match="ML_SERVICE_TOKEN"):
            Settings(ml_service_token="", ada_env=env)  # type: ignore[arg-type]

    def test_a_blank_env_means_production(self):
        from app.config import Settings

        assert Settings(ada_env="", ml_service_token="x").ada_env == "production"

    def test_empty_token_is_allowed_in_local(self):
        from app.config import Settings

        assert Settings(ml_service_token="", ada_env="local").ml_service_token == ""

    def test_env_defaults_to_production(self, monkeypatch):
        from app.config import Settings

        # _env_file=None: a developer's .env may say local, and this is about
        # what happens when nothing says anything.
        monkeypatch.delenv("ADA_ENV", raising=False)
        monkeypatch.setenv("ML_SERVICE_TOKEN", "x")
        assert Settings(_env_file=None).ada_env == "production"  # type: ignore[call-arg]
        monkeypatch.setenv("ML_SERVICE_TOKEN", "")
        with pytest.raises(ValidationError, match="ML_SERVICE_TOKEN"):
            Settings(_env_file=None)  # type: ignore[call-arg]


def test_icms_principal_helper_still_carries_roles():
    assert "field-surveyor" in icms_principal(OWNER, SURVEYOR).roles
