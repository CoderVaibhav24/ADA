"""S-03: what a verified token is FOR — typ, azp allowlist, service accounts."""

from __future__ import annotations

import base64
import time

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from ada_platform import ADAAuthError
from ada_platform.verify import JWKSCache, TokenVerifier

ISSUER = "https://keycloak.test/realms/pcsmcpl"
KID = "k1"


def _b64(value: int) -> str:
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


@pytest.fixture(scope="module")
def key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def jwks(key) -> JWKSCache:
    public = key.public_key().public_numbers()
    document = {"keys": [{"kty": "RSA", "kid": KID, "use": "sig", "alg": "RS256",
                          "n": _b64(public.n), "e": _b64(public.e)}]}

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/.well-known/openid-configuration"):
            return httpx.Response(200, json={"issuer": ISSUER,
                                             "jwks_uri": f"{ISSUER}/certs"})
        return httpx.Response(200, json=document)

    return JWKSCache(ISSUER, httpx.Client(transport=httpx.MockTransport(handler)))


def _token(key, **claims) -> str:
    now = int(time.time())
    body = {"iss": ISSUER, "sub": "user-1", "iat": now, "exp": now + 300,
            "typ": "Bearer", "azp": "ada-web", "preferred_username": "officer",
            "email": "officer@pcsmcpl.net"}
    body.update(claims)
    body = {k: v for k, v in body.items() if v is not None}
    return jwt.encode(body, key, algorithm="RS256", headers={"kid": KID})


def _strict(jwks) -> TokenVerifier:
    return TokenVerifier(ISSUER, jwks, allowed_azp=frozenset({"ada-web", "ada-field"}),
                         reject_service_accounts=True)


def test_an_ada_web_access_token_is_accepted(jwks, key):
    assert _strict(jwks).verify(_token(key)).azp == "ada-web"


def test_an_ada_field_access_token_is_accepted(jwks, key):
    assert _strict(jwks).verify(_token(key, azp="ada-field")).azp == "ada-field"


def test_an_id_token_is_rejected(jwks, key):
    with pytest.raises(ADAAuthError, match="typ_rejected"):
        _strict(jwks).verify(_token(key, typ="ID"))


def test_a_token_with_no_typ_is_rejected_by_default(jwks, key):
    with pytest.raises(ADAAuthError, match="typ_rejected"):
        TokenVerifier(ISSUER, jwks).verify(_token(key, typ=None))


def test_typ_check_can_be_disabled(jwks, key):
    assert TokenVerifier(ISSUER, jwks, require_typ=None).verify(_token(key, typ="ID"))


def test_a_foreign_azp_is_rejected(jwks, key):
    with pytest.raises(ADAAuthError, match="azp_rejected"):
        _strict(jwks).verify(_token(key, azp="some-other-app"))


def test_client_id_is_the_fallback_for_azp(jwks, key):
    principal = _strict(jwks).verify(_token(key, azp=None, client_id="ada-field"))
    assert principal.azp == "ada-field"
    with pytest.raises(ADAAuthError, match="azp_rejected"):
        _strict(jwks).verify(_token(key, azp=None))


def test_no_allowlist_accepts_any_client(jwks, key):
    assert TokenVerifier(ISSUER, jwks).verify(_token(key, azp="anything")).azp == "anything"


def test_a_service_account_token_is_rejected(jwks, key):
    token = _token(key, azp="ada-web", preferred_username="service-account-ada-web",
                   email=None)
    with pytest.raises(ADAAuthError, match="service_account_rejected"):
        _strict(jwks).verify(token)


def test_service_accounts_pass_when_not_refused(jwks, key):
    token = _token(key, preferred_username="service-account-ada-ml", email=None)
    assert TokenVerifier(ISSUER, jwks).verify(token).is_service_account
