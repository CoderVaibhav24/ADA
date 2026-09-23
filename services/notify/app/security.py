"""Local RS256 token verification against the realm's JWKS.

AD-4: tokens are verified here, not by calling Keycloak's introspection
endpoint. Introspection would put Keycloak on the hot path of every single
request, so a central-host failure would stop the whole estate rather than
stopping new logins only.

AD-5: RS256 only. HS256 is refused explicitly rather than left to the default
algorithm list, because a shared secret distributed for verification can also
mint tokens — the weakest application could forge admin tokens everywhere. The
`algorithms=["RS256"]` argument to jwt.decode is the control; the explicit check
before it exists so the refusal is legible in a log rather than appearing as a
generic signature failure.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field

import httpx
import jwt
import structlog
from jwt.algorithms import RSAAlgorithm

from app.config import Settings

logger = structlog.get_logger(__name__)

ALLOWED_ALGORITHMS = ("RS256",)


class TokenError(Exception):
    """A token was presented and is not acceptable. Always a 401."""

    def __init__(self, reason: str, detail: str = "Invalid or expired token") -> None:
        super().__init__(reason)
        self.reason = reason
        self.detail = detail


@dataclass(frozen=True)
class Principal:
    """What a verified token asserts.

    subject is the service account's own user id for a machine token, and the end
    user's id for a user token. azp is the client the token was issued to, and it
    is what tenancy is resolved from.
    """

    subject: str
    azp: str
    scopes: frozenset[str]
    claims: dict = field(repr=False, default_factory=dict)

    @property
    def is_service_account(self) -> bool:
        # Keycloak sets this on tokens obtained through client_credentials.
        return self.claims.get("preferred_username", "").startswith("service-account-")

    def has_scope(self, scope: str) -> bool:
        return scope in self.scopes


class JWKSCache:
    """Discovery document and signing keys, cached, refreshed on an unknown kid.

    Key rotation is transparent: Keycloak publishes the new key before it signs
    with it, but a cache that only expired on a timer would still reject tokens
    for up to its TTL. A kid we have not seen triggers a refetch instead — rate
    limited, because otherwise anyone can make us hammer Keycloak by sending
    tokens with random kids.
    """

    def __init__(self, settings: Settings, client: httpx.AsyncClient) -> None:
        self._settings = settings
        self._client = client
        self._keys: dict[str, object] = {}
        self._jwks_uri: str | None = None
        self._fetched_at: float = 0.0
        self._last_refresh_attempt: float = 0.0

    async def _discover(self) -> str:
        if self._jwks_uri:
            return self._jwks_uri
        response = await self._client.get(self._settings.discovery_url)
        response.raise_for_status()
        document = response.json()

        issued = str(document.get("issuer", "")).rstrip("/")
        if issued != self._settings.issuer:
            # Caught here rather than at the first 401: an issuer mismatch makes
            # every token invalid, and the symptom gives no hint of the cause.
            raise TokenError(
                "issuer_mismatch",
                f"Realm reports issuer {issued!r} but this service is configured "
                f"for {self._settings.issuer!r}",
            )

        # Rewritten to something reachable from this process. The realm
        # advertises this under its public hostname, which inside the compose
        # network does not resolve to Keycloak.
        self._jwks_uri = self._settings.to_fetchable(document["jwks_uri"])
        return self._jwks_uri

    async def _fetch(self) -> None:
        jwks_uri = await self._discover()
        response = await self._client.get(jwks_uri)
        response.raise_for_status()

        keys: dict[str, object] = {}
        for key in response.json().get("keys", []):
            # Signature keys only. A realm also publishes its encryption key, and
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
        logger.info("jwks_loaded", key_count=len(keys), jwks_uri=jwks_uri)

    async def key_for(self, kid: str) -> object:
        expired = (time.monotonic() - self._fetched_at) > self._settings.jwks_cache_seconds
        if not self._keys or expired:
            await self._fetch()

        if kid in self._keys:
            return self._keys[kid]

        # Unknown kid: a rotation, or a token we were never going to accept.
        since_attempt = time.monotonic() - self._last_refresh_attempt
        if since_attempt < self._settings.jwks_min_refresh_seconds:
            raise TokenError("unknown_kid_rate_limited")
        self._last_refresh_attempt = time.monotonic()
        await self._fetch()

        if kid not in self._keys:
            raise TokenError("unknown_kid")
        logger.info("jwks_rotation_observed", kid=kid)
        return self._keys[kid]


class TokenVerifier:
    def __init__(self, settings: Settings, jwks: JWKSCache) -> None:
        self._settings = settings
        self._jwks = jwks

    async def verify(self, token: str) -> Principal:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise TokenError("malformed_header") from exc

        algorithm = header.get("alg")
        if algorithm not in ALLOWED_ALGORITHMS:
            # Refused before any key lookup. 'none' and HS256 are the two that
            # matter, and both are attacks rather than misconfigurations.
            raise TokenError(f"algorithm_refused:{algorithm}")

        kid = header.get("kid")
        if not kid:
            raise TokenError("missing_kid")

        key = await self._jwks.key_for(kid)

        try:
            claims = jwt.decode(
                token,
                key=key,  # type: ignore[arg-type]
                algorithms=list(ALLOWED_ALGORITHMS),
                issuer=self._settings.issuer,
                leeway=self._settings.jwt_leeway_seconds,
                options={
                    "require": ["exp", "iat", "iss", "sub"],
                    "verify_exp": True,
                    "verify_iss": True,
                    # Keycloak puts 'account' in aud for a client_credentials
                    # token, so audience is not a usable authorisation signal
                    # here. Authorisation is azp plus scope, which is what the
                    # token was actually issued for.
                    "verify_aud": False,
                },
            )
        except jwt.ExpiredSignatureError as exc:
            # Its own reason because it is the one a caller can fix, and with a
            # 60-second lifetime it is the one they will hit.
            raise TokenError("expired", "Token has expired") from exc
        except jwt.InvalidIssuerError as exc:
            raise TokenError("issuer_rejected") from exc
        except jwt.PyJWTError as exc:
            raise TokenError(f"invalid:{type(exc).__name__}") from exc

        azp = claims.get("azp") or claims.get("client_id")
        if not azp:
            raise TokenError("missing_azp", "Token carries no authorised party")

        return Principal(
            subject=str(claims["sub"]),
            azp=str(azp),
            scopes=frozenset(str(claims.get("scope", "")).split()),
            claims=claims,
        )
