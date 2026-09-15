"""Every route is behind the token, and the 401 says how to recover."""

from __future__ import annotations

import pytest

PROTECTED = [
    ("get", "/api/projects"),
    ("post", "/api/projects"),
    ("get", "/api/projects/1"),
    ("delete", "/api/projects/1"),
    ("get", "/api/projects/1/rasters"),
    ("get", "/api/projects/1/red-zones"),
    ("post", "/api/projects/1/red-zones"),
    ("get", "/api/projects/1/analyses"),
    ("post", "/api/projects/1/analyses"),
    ("get", "/api/projects/1/feedback-dataset"),
    ("get", "/api/analyses/1"),
    ("delete", "/api/analyses/1"),
    ("get", "/api/analyses/1/features"),
    ("get", "/api/analyses/1/report.csv"),
    ("get", "/api/analyses/1/report.geojson"),
    ("delete", "/api/rasters/1"),
    ("delete", "/api/red-zones/1"),
    ("get", "/api/tiles/raster/1/info"),
    ("get", "/api/tiles/raster/1/10/1/1.png"),
    ("get", "/api/tiles/mask/1/10/1/1.png"),
]


@pytest.mark.parametrize("method,path", PROTECTED)
def test_no_token_is_401(anonymous_client, method, path):
    """Enumerated rather than spot-checked: a route added without the
    dependency is invisible until somebody finds it, and the map tiles are the
    easiest to forget because the browser fetches them on its own."""
    response = getattr(anonymous_client, method)(path)
    assert response.status_code == 401, f"{method.upper()} {path} is not protected"


def test_the_401_tells_the_client_to_present_a_bearer_token(anonymous_client):
    """With a short-lived access token a client hits this constantly, and
    correct behaviour — refresh, then retry — depends on the header."""
    response = anonymous_client.get("/api/projects")
    assert response.headers.get("WWW-Authenticate", "").startswith("Bearer")


@pytest.mark.parametrize("path", ["/api/health", "/api/auth/config"])
def test_the_two_public_routes_stay_public(anonymous_client, path):
    """The browser needs both BEFORE it can sign in. Gating them is a deadlock:
    the page cannot learn where to send the user to get a token."""
    assert anonymous_client.get(path).status_code == 200


def test_health_reports_which_service_answered(anonymous_client):
    body = anonymous_client.get("/api/health").json()
    assert body["status"] == "ok"
    assert body["service"] == "ada-api"


class TestAuthConfig:
    def test_serves_what_the_spa_needs_to_start_a_login(self, anonymous_client):
        body = anonymous_client.get("/api/auth/config").json()
        assert body["issuer"] == "https://keycloak.test/realms/pcsmcpl"
        assert body["client_id"] == "ada-web"

    def test_carries_nothing_secret(self, anonymous_client):
        """It is served to anonymous callers by design, so the contract is that
        it contains only what the browser already sends to Keycloak in the
        clear. A PKCE public client has no secret; leaking a confidential
        client's would be handing over the realm."""
        body = anonymous_client.get("/api/auth/config").json()
        assert set(body) == {"issuer", "client_id"}
        serialised = str(body).lower()
        for forbidden in ("secret", "password", "database_url", "token"):
            assert forbidden not in serialised
