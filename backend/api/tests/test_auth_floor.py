"""Every mounted route, walked, and refused without a token.

test_auth_gate.py hand-lists the twenty routes somebody remembered. This walks
`app.routes` instead, so a route added tomorrow is covered the moment it is
mounted and an unguarded one fails here rather than shipping. That is the whole
point of the file: the enumeration is the test.
"""

from __future__ import annotations

import re
import time

import httpx
import jwt
import pytest
from ada_platform import ADAAuth, JwksUnavailableError
from ada_platform.verify import JWKSCache

from app.security import PUBLIC_PATHS

from .conftest import ISSUER, OWNER

ERROR_KEYS = {"code", "message", "field", "allowed", "request_id"}


# FastAPI no longer flattens `include_router` into app.routes; a mounted router
# is one opaque node that resolves its children on demand. Walking only the top
# level finds five routes and passes, which is why the guard test below counts.
def _walk(node, found: set[tuple[str, str]]) -> None:
    path = getattr(node, "path", None)
    methods = getattr(node, "methods", None)
    if path and methods:
        # HEAD and OPTIONS come from the framework rather than from anyone's
        # endpoint, and OPTIONS is answered by CORS outside the floor.
        for method in set(methods) - {"HEAD", "OPTIONS"}:
            found.add((method, path))
        return
    for accessor in ("effective_candidates", "effective_low_priority_routes"):
        resolve = getattr(node, accessor, None)
        if callable(resolve):
            for child in resolve():
                _walk(child, found)
    for child in getattr(node, "routes", ()) or ():
        _walk(child, found)


def mounted_operations() -> list[tuple[str, str]]:
    """Every (method, path template) the application answers."""
    from app.main import app

    found: set[tuple[str, str]] = set()
    for route in app.routes:
        _walk(route, found)
    return sorted(found)


OPERATIONS = mounted_operations()
PROTECTED = [op for op in OPERATIONS if op[1] not in PUBLIC_PATHS]


# "1" satisfies every converter in use here, and the floor refuses long before a
# path parameter is parsed, so the value never has to be plausible.
def concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


def error_of(response) -> dict:
    body = response.json()
    assert set(body) == {"error"}, f"envelope keys are {sorted(body)}"
    error = body["error"]
    assert set(error) == ERROR_KEYS, f"error keys are {sorted(error)}"
    return error


def test_the_suite_found_the_routes_it_is_meant_to_walk():
    """A refactor that stopped `app.routes` being walkable would otherwise turn
    this file into a green no-op, which is worse than deleting it."""
    assert len(OPERATIONS) >= 40, f"only {len(OPERATIONS)} operations enumerated"
    assert PROTECTED, "every route looks public, which cannot be right"


class TestTheAllowlist:
    def test_is_exactly_these_four_and_nothing_else(self):
        """Pinned so widening it is a deliberate line in a diff somebody reviews,
        rather than a path quietly appended to a set."""
        assert PUBLIC_PATHS == {
            "/api/health",
            "/api/auth/config",
            "/api/docs",
            "/api/openapi.json",
        }

    @pytest.mark.parametrize("path", sorted(PUBLIC_PATHS))
    def test_each_one_answers_without_a_token(self, anonymous_client, path):
        """The healthcheck holds no token and the browser needs the other three
        BEFORE it can get one. Gating any of them is a deadlock."""
        response = anonymous_client.get(path)

        assert response.status_code == 200, f"{path} is not reachable anonymously"

    def test_a_path_that_merely_starts_with_a_public_one_is_not_public(
        self, anonymous_client
    ):
        """The allowlist matches exact paths. A prefix match on /api/health would
        also open anything mounted beneath it later."""
        assert anonymous_client.get("/api/health/detail").status_code == 401


class TestEveryRouteIsBehindTheFloor:
    @pytest.mark.parametrize(
        "method,path", PROTECTED, ids=[f"{m} {p}" for m, p in PROTECTED]
    )
    def test_no_token_is_401(self, anonymous_client, method, path):
        response = anonymous_client.request(method, concrete(path))

        assert response.status_code == 401, (
            f"{method} {path} answered {response.status_code} without a token"
        )

    @pytest.mark.parametrize(
        "method,path", PROTECTED, ids=[f"{m} {p}" for m, p in PROTECTED]
    )
    def test_the_refusal_is_the_project_envelope_and_says_how_to_recover(
        self, anonymous_client, method, path
    ):
        """A bare {"detail": ...} is a console that can tell the officer nothing,
        and without WWW-Authenticate a client holding an expired token never
        learns that refreshing is the fix."""
        response = anonymous_client.request(method, concrete(path))

        assert error_of(response)["code"] == "unauthenticated"
        assert response.headers.get("www-authenticate") == 'Bearer realm="ada"'

    def test_an_endpoint_added_without_a_dependency_is_refused_anyway(
        self, anonymous_client
    ):
        """The structural half. Before the floor this route would have answered
        200 to anyone who found it, and nothing in the suite would have said so."""
        from app.main import app

        @app.get("/api/forgot-the-dependency")
        def _unguarded() -> dict:
            return {"rows": "the whole register"}

        try:
            response = anonymous_client.get("/api/forgot-the-dependency")
        finally:
            app.router.routes[:] = [
                route
                for route in app.router.routes
                if getattr(route, "path", "") != "/api/forgot-the-dependency"
            ]
            app.openapi_schema = None

        assert response.status_code == 401
        assert "register" not in response.text

    def test_the_request_id_survives_the_refusal(self, anonymous_client):
        """RequestIdMiddleware has to wrap the floor, or the one field that ties a
        401 to a log line is an empty string on every refusal."""
        response = anonymous_client.get(
            "/api/projects", headers={"X-Request-ID": "floor-1"}
        )

        assert error_of(response)["request_id"] == "floor-1"
        assert response.headers["x-request-id"] == "floor-1"


# --------------------------------------------------------------- real tokens
#
# The suite normally stubs authentication with a dependency override, which the
# floor honours — the two are the same callable. These exercise the other path:
# a real RS256 token through the real middleware.


def token(signing_key, **overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER, "sub": OWNER, "iat": now, "exp": now + 300, "azp": "ada-web",
        "scope": "openid profile email", "preferred_username": "officer",
    }
    claims.update(overrides.pop("claims", {}))
    return jwt.encode(claims, signing_key, algorithm="RS256",
                      headers={"kid": overrides.pop("kid", "test-key-1")})


@pytest.fixture
def realm(monkeypatch, realm_transport):
    """Point the process-wide verifier at the JWKS this suite serves."""
    from app import security

    monkeypatch.setattr(
        security, "auth",
        ADAAuth(issuer=ISSUER, client=httpx.Client(transport=realm_transport)),
    )
    return realm_transport


class TestAVerifiedToken:
    def test_reaches_the_endpoint_and_meets_its_own_guard(
        self, realm, anonymous_client, signing_key, code_values
    ):
        """Defence in depth, both layers in one request: the floor admits the
        token and require_permission still refuses a caller holding no ICMS
        role. 403 and not 401 — refreshing would produce the same roles."""
        response = anonymous_client.get(
            "/api/icms/code-values",
            headers={"Authorization": f"Bearer {token(signing_key)}"},
        )

        assert response.status_code == 403, response.text[:200]
        assert error_of(response)["code"] == "role_not_permitted"

    def test_is_verified_once_per_request_and_not_twice(
        self, realm, anonymous_client, signing_key, code_values
    ):
        """The floor stashes the Principal and the dependency reads it back. Two
        verifications would mean two implementations, which can disagree."""
        from app import security

        seen: list[str] = []
        real = security.auth.verify
        security.auth.verify = lambda raw: (seen.append(raw), real(raw))[1]

        anonymous_client.get(
            "/api/icms/code-values",
            headers={"Authorization": f"Bearer {token(signing_key)}"},
        )

        assert len(seen) == 1, f"the token was verified {len(seen)} times"

    @pytest.mark.parametrize("header", [
        "", "Bearer ", "not-a-token", "Basic Zm9vOmJhcg==", "Bearer not.a.jwt",
    ])
    def test_anything_that_is_not_one_is_401(self, realm, anonymous_client, header):
        response = anonymous_client.get(
            "/api/icms/code-values", headers={"Authorization": header}
        )

        assert response.status_code == 401
        assert error_of(response)["code"] == "unauthenticated"

    def test_an_expired_one_is_401(self, realm, anonymous_client, signing_key):
        stale = token(signing_key, claims={"exp": int(time.time()) - 3600})

        response = anonymous_client.get(
            "/api/icms/code-values", headers={"Authorization": f"Bearer {stale}"}
        )

        assert response.status_code == 401


class TestWhenKeycloakIsUnreachable:
    def test_the_answer_is_503_and_not_401(
        self, monkeypatch, anonymous_client, signing_key
    ):
        """401 tells the client its token is bad, so it discards a good one and
        sends the officer to a Keycloak that is also down. 503 is the truth, and
        the only one of the two a client should retry."""
        from app import security

        def refuse(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectError("keycloak is down")

        monkeypatch.setattr(
            security, "auth",
            ADAAuth(issuer=ISSUER,
                    client=httpx.Client(transport=httpx.MockTransport(refuse))),
        )

        response = anonymous_client.get(
            "/api/icms/code-values",
            headers={"Authorization": f"Bearer {token(signing_key)}"},
        )

        assert response.status_code == 503
        assert error_of(response)["code"] == "unavailable"
        assert "keycloak" not in response.text.lower(), "the refusal names infrastructure"


class TestTheJwksCache:
    """Soft TTL, hard TTL and serve-stale, at the level they are implemented."""

    def cache(self, jwks, failing: list[bool], **kwargs) -> JWKSCache:
        def handler(request: httpx.Request) -> httpx.Response:
            if request.url.path.endswith("/.well-known/openid-configuration"):
                return httpx.Response(200, json={
                    "issuer": ISSUER,
                    "jwks_uri": f"{ISSUER}/protocol/openid-connect/certs",
                })
            if failing[0]:
                raise httpx.ConnectError("down")
            return httpx.Response(200, json=jwks)

        return JWKSCache(ISSUER, httpx.Client(transport=httpx.MockTransport(handler)),
                         **kwargs)

    def test_inside_the_soft_ttl_nothing_is_fetched(self, jwks, realm_transport):
        """The fast path is the whole reason verification is local: a fresh cache
        must cost no lock contention and no network."""
        cache = JWKSCache(ISSUER, httpx.Client(transport=realm_transport),
                          cache_seconds=3600)
        for _ in range(5):
            cache.key_for("test-key-1")

        assert len(realm_transport.calls) == 2, "discovery once, certs once"

    def test_keys_inside_the_hard_ttl_are_served_when_the_refresh_fails(self, jwks):
        """A Keycloak blip must not refuse every signed-in officer. The keys we
        hold are still the realm's keys — it rotates them over months."""
        failing = [False]
        cache = self.cache(jwks, failing, cache_seconds=0, hard_ttl_seconds=3600)
        cache.key_for("test-key-1")

        failing[0] = True

        assert cache.key_for("test-key-1") is not None

    def test_a_failed_refresh_is_not_retried_on_every_request(self, jwks):
        """Otherwise a Keycloak that is already struggling takes one /certs per
        request from every worker until it recovers."""
        failing = [False]
        cache = self.cache(jwks, failing, cache_seconds=0, hard_ttl_seconds=3600,
                           min_refresh_seconds=60)
        cache.key_for("test-key-1")
        failing[0] = True
        cache.key_for("test-key-1")
        first_failure = cache._failed_at

        for _ in range(5):
            cache.key_for("test-key-1")

        assert cache._failed_at == first_failure, "it retried inside the backoff"

    def test_past_the_hard_ttl_it_stops_serving_rather_than_guessing(self, jwks):
        """The ceiling on staleness. Keys the realm has abandoned must eventually
        stop verifying tokens, however unreachable Keycloak is."""
        failing = [False]
        cache = self.cache(jwks, failing, cache_seconds=0, hard_ttl_seconds=0)
        cache.key_for("test-key-1")
        failing[0] = True

        with pytest.raises(JwksUnavailableError):
            cache.key_for("test-key-1")

    def test_a_cold_cache_and_an_unreachable_realm_is_unavailable_not_invalid(
        self, jwks
    ):
        cache = self.cache(jwks, [True])

        with pytest.raises(JwksUnavailableError) as exc:
            cache.key_for("test-key-1")
        # repr, because a bare httpx timeout stringifies to "" and the log line
        # would otherwise say nothing at all.
        assert "ConnectError" in str(exc.value)
