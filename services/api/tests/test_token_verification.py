"""Real RS256 verification, against a JWKS this suite serves.

Nothing is mocked below the transport. Every rejection path here is an attack
or an outage, and the difference between refusing one and accepting it is the
whole security boundary of the API.
"""

from __future__ import annotations

import time

import httpx
import jwt
import pytest
from ada_platform import ADAAuth, ADAAuthError, ADAConfigError

from .conftest import ISSUER, OWNER


def make_auth(transport) -> ADAAuth:
    return ADAAuth(issuer=ISSUER, client=httpx.Client(transport=transport))


def token(signing_key, **overrides) -> str:
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "sub": OWNER,
        "iat": now,
        "exp": now + 300,
        "azp": "ada-web",
        "typ": "Bearer",
        "scope": "openid profile email",
        "preferred_username": "officer",
        "email": "officer@pcsmcpl.net",
    }
    claims.update(overrides.pop("claims", {}))
    headers = {"kid": overrides.pop("kid", "test-key-1")}
    algorithm = overrides.pop("algorithm", "RS256")
    key = overrides.pop("key", signing_key)
    return jwt.encode(claims, key, algorithm=algorithm, headers=headers)


class TestAccepts:
    def test_a_well_formed_token(self, realm_transport, signing_key):
        principal = make_auth(realm_transport).verify(token(signing_key))
        assert principal.subject == OWNER
        assert principal.azp == "ada-web"
        assert principal.email == "officer@pcsmcpl.net"
        assert principal.has_scope("openid")

    def test_and_fetches_the_jwks_once_for_many_tokens(self, realm_transport, signing_key):
        """Local verification is the point: Keycloak is not on the request path,
        so it going down stops new logins and leaves existing sessions working.
        A refetch per request would reintroduce exactly that coupling."""
        auth = make_auth(realm_transport)
        for _ in range(5):
            auth.verify(token(signing_key))
        assert len(realm_transport.calls) == 2  # discovery once, certs once

    def test_a_token_inside_the_clock_skew_allowance(self, realm_transport, signing_key):
        recent = token(signing_key, claims={"exp": int(time.time()) - 5})
        make_auth(realm_transport).verify(recent)


class TestRefuses:
    def test_an_expired_token_with_a_reason_a_client_can_act_on(
        self, realm_transport, signing_key
    ):
        stale = token(signing_key, claims={"exp": int(time.time()) - 3600})
        with pytest.raises(ADAAuthError) as exc:
            make_auth(realm_transport).verify(stale)
        assert "expired" in exc.value.reason

    def test_the_none_algorithm(self, realm_transport):
        """The classic JWT attack: strip the signature and claim it was never
        needed. Refused before any key lookup happens."""
        unsigned = jwt.encode({"iss": ISSUER, "sub": OWNER}, key=None, algorithm="none",
                              headers={"kid": "test-key-1"})
        with pytest.raises(ADAAuthError) as exc:
            make_auth(realm_transport).verify(unsigned)
        assert "algorithm_refused" in exc.value.reason

    def test_a_symmetric_algorithm(self, realm_transport):
        """HS256 signed with the public key as the HMAC secret — the other half
        of the same attack, and the reason the allow-list is positive."""
        forged = jwt.encode({"iss": ISSUER, "sub": OWNER, "iat": 0, "exp": 9_999_999_999},
                            key="public-key-as-secret", algorithm="HS256",
                            headers={"kid": "test-key-1"})
        with pytest.raises(ADAAuthError) as exc:
            make_auth(realm_transport).verify(forged)
        assert "algorithm_refused" in exc.value.reason

    def test_a_signature_from_a_key_the_realm_does_not_publish(self, realm_transport):
        from cryptography.hazmat.primitives.asymmetric import rsa

        attacker = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        with pytest.raises(ADAAuthError):
            make_auth(realm_transport).verify(token(attacker))

    def test_an_unknown_kid(self, realm_transport, signing_key):
        with pytest.raises(ADAAuthError) as exc:
            make_auth(realm_transport).verify(token(signing_key, kid="rotated-away"))
        assert "kid" in exc.value.reason

    def test_a_token_with_no_kid(self, realm_transport, signing_key):
        import time as _time

        now = int(_time.time())
        no_kid = jwt.encode({"iss": ISSUER, "sub": OWNER, "iat": now, "exp": now + 300},
                            signing_key, algorithm="RS256")
        with pytest.raises(ADAAuthError) as exc:
            make_auth(realm_transport).verify(no_kid)
        assert "missing_kid" in exc.value.reason

    def test_another_realms_issuer(self, realm_transport, signing_key):
        """One Keycloak serves several realms. A valid token for a different
        one is a valid token, and it is not valid here."""
        other = token(signing_key, claims={"iss": "https://keycloak.test/realms/hrms"})
        with pytest.raises(ADAAuthError) as exc:
            make_auth(realm_transport).verify(other)
        assert "issuer" in exc.value.reason

    def test_a_token_with_no_subject(self, realm_transport, signing_key):
        """sub is what every project row is keyed on; a token without one
        cannot own anything."""
        import time as _time

        now = int(_time.time())
        subjectless = jwt.encode(
            {"iss": ISSUER, "iat": now, "exp": now + 300},
            signing_key, algorithm="RS256", headers={"kid": "test-key-1"},
        )
        with pytest.raises(ADAAuthError):
            make_auth(realm_transport).verify(subjectless)

    def test_garbage(self, realm_transport):
        with pytest.raises(ADAAuthError):
            make_auth(realm_transport).verify("not-a-token")


def test_a_missing_issuer_fails_at_construction_not_at_first_login():
    """A deployment with the wrong environment should refuse to start, rather
    than start and reject every officer who tries to sign in."""
    with pytest.raises(ADAConfigError):
        ADAAuth(issuer="")


def test_a_realm_that_calls_itself_something_else_is_caught_at_discovery(jwks, signing_key):
    """The failure this turns into a clear error: point ADA at the wrong realm
    and every token is invalid, with nothing in the 401 to say why. Checked
    once, when the discovery document is read."""
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/.well-known/openid-configuration"):
            return httpx.Response(200, json={
                "issuer": "https://keycloak.test/realms/hrms",
                "jwks_uri": f"{ISSUER}/protocol/openid-connect/certs",
            })
        return httpx.Response(200, json=jwks)

    auth = ADAAuth(issuer=ISSUER, client=httpx.Client(transport=httpx.MockTransport(handler)))
    with pytest.raises(ADAAuthError) as exc:
        auth.verify(token(signing_key))
    assert exc.value.reason == "issuer_mismatch"
    # The message has to name both sides, or it is not actionable.
    assert "hrms" in str(exc.value.detail) and "pcsmcpl" in str(exc.value.detail)


def test_trailing_slashes_are_normalised(realm_transport, signing_key):
    """The issuer is compared character for character. A trailing slash on one
    side and not the other is a blanket 401 with no other symptom, so it is
    normalised rather than trusted."""
    auth = ADAAuth(issuer=ISSUER + "/", client=httpx.Client(transport=realm_transport))
    assert auth.verify(token(signing_key)).subject == OWNER
