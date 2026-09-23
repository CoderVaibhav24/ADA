"""ADAAuth.ready(): the readiness probe's view of the JWKS cache."""

from __future__ import annotations

import base64

import httpx
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from ada_platform import ADAAuth

ISSUER = "https://keycloak.test/realms/pcsmcpl"


def _b64(value: int) -> str:
    raw = value.to_bytes((value.bit_length() + 7) // 8, "big")
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()


@pytest.fixture(scope="module")
def document() -> dict:
    public = rsa.generate_private_key(public_exponent=65537, key_size=2048).public_key()
    numbers = public.public_numbers()
    return {"keys": [{"kty": "RSA", "kid": "k1", "use": "sig", "alg": "RS256",
                      "n": _b64(numbers.n), "e": _b64(numbers.e)}]}


class Realm:
    def __init__(self, document: dict) -> None:
        self.document = document
        self.up = True
        self.calls = 0

    def handle(self, request: httpx.Request) -> httpx.Response:
        self.calls += 1
        if not self.up:
            raise httpx.ConnectError("keycloak down", request=request)
        if request.url.path.endswith("/.well-known/openid-configuration"):
            return httpx.Response(200, json={"issuer": ISSUER, "jwks_uri": f"{ISSUER}/certs"})
        return httpx.Response(200, json=self.document)


def _auth(realm: Realm, **kwargs) -> ADAAuth:
    return ADAAuth(issuer=ISSUER, client=httpx.Client(transport=httpx.MockTransport(realm.handle)),
                   **kwargs)


def test_a_cold_cache_is_ready_when_the_realm_answers(document):
    realm = Realm(document)
    assert _auth(realm).ready() is True
    assert realm.calls == 2


def test_an_unreachable_realm_with_a_cold_cache_is_not_ready_and_does_not_raise(document):
    realm = Realm(document)
    realm.up = False
    assert _auth(realm).ready() is False


def test_a_realm_with_no_signing_keys_is_not_ready():
    assert _auth(Realm({"keys": []})).ready() is False


def test_an_issuer_mismatch_is_not_ready_and_does_not_raise(document):
    realm = Realm(document)
    auth = ADAAuth(issuer="https://other.test/realms/x",
                   client=httpx.Client(transport=httpx.MockTransport(realm.handle)))
    assert auth.ready() is False


def test_cached_keys_stay_ready_without_a_network_call_even_past_the_hard_ttl(document):
    realm = Realm(document)
    auth = _auth(realm, jwks_cache_seconds=0, jwks_hard_ttl_seconds=0)
    assert auth.ready() is True
    realm.up = False
    calls = realm.calls

    assert auth.ready() is True
    assert realm.calls == calls
