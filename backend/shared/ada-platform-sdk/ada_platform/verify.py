"""Local token verification. No network call per request.

NFR-SEC-010 and AD-4: the SDK verifies tokens itself against the realm's public
keys, rather than calling Keycloak's introspection endpoint.

The difference is not performance, though it is also performance. Introspection
makes Keycloak a hard dependency of every single request in the estate: the
central host hiccups and every application stops serving, not just new logins.
Local verification means a Keycloak outage stops people logging in and leaves
everyone already logged in working normally — which is definition-of-done 9.

## RS256 only

HS256 is refused before any key is looked up. A shared secret distributed so that
applications can verify tokens can also be used to mint them, so the weakest
application in the estate would be able to forge an administrator's token for
every other one. Asymmetric signing means the public key verifies and cannot
sign.

The explicit check exists on top of the `algorithms=` argument so that a refusal
is legible in a log rather than appearing as a generic signature failure.

## Key rotation

Keycloak publishes a new signing key before it starts signing with it. A cache
that only expired on a timer would still reject good tokens for up to its TTL, so
an unrecognised `kid` triggers a refetch — rate limited, because otherwise anyone
can make an application hammer Keycloak by sending tokens with random kids.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass, field

import httpx
import jwt
from jwt.algorithms import RSAAlgorithm

from ada_platform.errors import ADAAuthError, JwksUnavailableError

log = logging.getLogger("ada_platform.verify")

ALLOWED_ALGORITHMS = ("RS256",)


@dataclass(frozen=True)
class Principal:
    """What a verified token asserts.

    subject is the stable Keycloak user id — the same value ADA expects as a
    notification recipient, which is what makes "notify the person who made this
    request" a one-liner rather than a lookup.
    """

    subject: str
    azp: str
    scopes: frozenset[str]
    username: str = ""
    email: str = ""
    claims: dict = field(repr=False, default_factory=dict)

    @property
    def is_service_account(self) -> bool:
        return self.username.startswith("service-account-")

    def has_scope(self, scope: str) -> bool:
        return scope in self.scopes

    @property
    def roles(self) -> frozenset[str]:
        realm_access = self.claims.get("realm_access") or {}
        return frozenset(realm_access.get("roles") or ())


class JWKSCache:
    """Discovery document and signing keys, cached in the calling process."""

    def __init__(
        self,
        issuer: str,
        client: httpx.Client,
        *,
        cache_seconds: int = 3600,
        hard_ttl_seconds: int = 86_400,
        min_refresh_seconds: int = 60,
        internal_issuer_url: str | None = None,
    ) -> None:
        self._issuer = issuer.rstrip("/")
        self._internal = (internal_issuer_url or "").rstrip("/") or None
        self._client = client
        # Soft: refresh past this age. Hard: stop serving at this age even if
        # every refresh since has failed, so keys the realm abandoned a week ago
        # do not keep verifying tokens.
        self._cache_seconds = cache_seconds
        self._hard_ttl_seconds = max(hard_ttl_seconds, cache_seconds)
        self._min_refresh_seconds = min_refresh_seconds

        self._keys: dict[str, object] = {}
        self._jwks_uri: str | None = None
        self._fetched_at = 0.0
        self._last_refresh_attempt = 0.0
        self._failed_at = float("-inf")
        # A web server serves requests on many threads. Without this, a rotation
        # under load has every thread fetching the JWKS at once. Held across the
        # staleness re-check too, so only one thread ever refreshes.
        self._lock = threading.Lock()

    def _fetchable(self, advertised: str) -> str:
        if self._internal and advertised.startswith(self._issuer):
            return self._internal + advertised[len(self._issuer) :]
        return advertised

    def _discover(self) -> str:
        if self._jwks_uri:
            return self._jwks_uri
        base = self._internal or self._issuer
        response = self._client.get(f"{base}/.well-known/openid-configuration")
        response.raise_for_status()
        document = response.json()

        advertised = str(document.get("issuer", "")).rstrip("/")
        if advertised != self._issuer:
            # Caught here rather than at the first 401. An issuer mismatch makes
            # every token invalid and the symptom gives no hint of the cause.
            raise ADAAuthError(
                "issuer_mismatch",
                f"The realm calls itself {advertised!r}; this application is "
                f"configured for {self._issuer!r}. They must match exactly, "
                "including the scheme and any trailing path.",
            )

        self._jwks_uri = self._fetchable(document["jwks_uri"])
        return self._jwks_uri

    def _fetch(self) -> None:
        response = self._client.get(self._discover())
        response.raise_for_status()

        keys: dict[str, object] = {}
        for key in response.json().get("keys", []):
            # Signature keys only. A realm also publishes an encryption key, and
            # accepting one for verification widens what a token may be signed
            # with beyond what was intended.
            if key.get("use") not in (None, "sig"):
                continue
            if key.get("alg") and key["alg"] not in ALLOWED_ALGORITHMS:
                continue
            if kid := key.get("kid"):
                keys[kid] = RSAAlgorithm.from_jwk(key)

        self._keys = keys
        self._fetched_at = time.monotonic()

    # Keycloak being briefly unreachable must not 401 every request: a signature
    # check needs the keys we already hold, not a live Keycloak.
    def _refresh(self) -> None:
        age = time.monotonic() - self._fetched_at
        servable = bool(self._keys) and age < self._hard_ttl_seconds
        # A refresh that failed a moment ago will fail again, and retrying per
        # request turns a Keycloak blip into a request-rate attack on it.
        if servable and (time.monotonic() - self._failed_at) < self._min_refresh_seconds:
            return
        try:
            self._fetch()
        except ADAAuthError:
            # A realm calling itself something else is a misconfiguration, not
            # an outage, and stale keys would not fix it.
            raise
        except Exception as exc:
            self._failed_at = time.monotonic()
            if servable:
                log.warning(
                    "JWKS refresh failed; serving keys cached %ds ago: %r", int(age), exc
                )
                return
            raise JwksUnavailableError(self._issuer, exc) from exc

    def key_for(self, kid: str) -> object:
        with self._lock:
            expired = (time.monotonic() - self._fetched_at) > self._cache_seconds
            if not self._keys or expired:
                self._refresh()

            if kid in self._keys:
                return self._keys[kid]

            # Unknown kid: either a rotation, or a token that was never going to
            # be accepted. Rate limited so the second case cannot be used to make
            # this application attack Keycloak.
            if (time.monotonic() - self._last_refresh_attempt) < self._min_refresh_seconds:
                raise ADAAuthError("unknown_kid_rate_limited")
            self._last_refresh_attempt = time.monotonic()
            self._refresh()

            if kid not in self._keys:
                raise ADAAuthError("unknown_kid")
            return self._keys[kid]


class TokenVerifier:
    def __init__(self, issuer: str, jwks: JWKSCache, *, leeway_seconds: int = 10) -> None:
        self._issuer = issuer.rstrip("/")
        self._jwks = jwks
        self._leeway = leeway_seconds

    def verify(self, token: str) -> Principal:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise ADAAuthError("malformed_header") from exc

        algorithm = header.get("alg")
        if algorithm not in ALLOWED_ALGORITHMS:
            # Refused before any key lookup. 'none' and HS256 are the two that
            # matter, and both are attacks rather than misconfigurations.
            raise ADAAuthError(f"algorithm_refused:{algorithm}")

        kid = header.get("kid")
        if not kid:
            raise ADAAuthError("missing_kid")

        key = self._jwks.key_for(kid)

        try:
            claims = jwt.decode(
                token,
                key=key,  # type: ignore[arg-type]
                algorithms=list(ALLOWED_ALGORITHMS),
                issuer=self._issuer,
                leeway=self._leeway,
                options={
                    "require": ["exp", "iat", "iss", "sub"],
                    "verify_exp": True,
                    "verify_iss": True,
                    # Keycloak puts 'account' in aud, so audience is not a usable
                    # authorisation signal. Authorisation is azp plus scope,
                    # which is what the token was actually issued for.
                    "verify_aud": False,
                },
            )
        except jwt.ExpiredSignatureError as exc:
            # Its own reason because it is the one a caller can fix, and with a
            # 60-second lifetime it is the one they will hit.
            raise ADAAuthError("expired", "Token has expired") from exc
        except jwt.InvalidIssuerError as exc:
            raise ADAAuthError("issuer_rejected") from exc
        except jwt.PyJWTError as exc:
            raise ADAAuthError(f"invalid:{type(exc).__name__}") from exc

        azp = claims.get("azp") or claims.get("client_id") or ""

        return Principal(
            subject=str(claims["sub"]),
            azp=str(azp),
            scopes=frozenset(str(claims.get("scope", "")).split()),
            username=str(claims.get("preferred_username", "")),
            email=str(claims.get("email", "")),
            claims=claims,
        )
