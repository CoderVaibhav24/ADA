"""Settings, read from the environment only.

Every name here exists in the repository's .env.example. The issuer has no
default, so a missing one fails at import rather than authenticating people
against something unintended.
"""

from __future__ import annotations

import ipaddress
from functools import lru_cache
from typing import Annotated, Literal
from urllib.parse import urlsplit

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="ADA_",
        env_file=None,  # the container gets its environment from compose
        extra="ignore",
        frozen=True,
    )

    # --- Identity -----------------------------------------------------------

    # The PUBLIC issuer — whatever Keycloak was told to call itself, and
    # therefore what it stamps into the 'iss' claim of every token it mints.
    issuer: str

    # Where to actually reach that issuer over HTTP, when it is not the same
    # address. Inside the compose network Keycloak answers on
    # http://keycloak:8090 while minting tokens that claim
    # http://localhost:8090/realms/pcsmcpl. Both are correct and they disagree,
    # so the string that gets compared and the URL that gets fetched are kept
    # apart. Unset outside a container, where they are the same thing.
    internal_issuer_url: str | None = None

    # --- The confidential client this service authenticates as --------------
    #
    # Its service account needs two realm-management roles and no others:
    #
    #   view-users     to find the account behind a phone number
    #   impersonation  to exchange its own token for that account's token
    #
    # impersonation is a genuinely powerful grant — it mints a user token for
    # any subject in the realm without a credential — which is the reason this
    # client is confidential, has no browser flow, and is used by this service
    # alone. Do not reuse it for anything else.
    auth_client_id: str = "ada-auth"
    auth_client_secret: str = ""

    # Passed as `audience` on the exchange, so the minted token carries the
    # client id ada-api accepts in `azp` (OIDC_ALLOWED_AZP) rather than
    # ada-auth's. Keycloak must grant ada-auth a token-exchange permission on
    # this client. An empty string omits the parameter.
    exchange_audience: str = "ada-web"

    # Realm roles that may never sign in by one-time code. The exchange mints a
    # token without any credential of theirs, so a privileged account must use
    # password plus TOTP through Keycloak's own flow instead.
    otp_denied_roles: Annotated[list[str], NoDecode] = ["super-admin"]

    # --- Service ------------------------------------------------------------

    # Production unless said otherwise: a missing ADA_ENV must never land on
    # the permissive end. Compose, which is local development, sets "local".
    env: Literal["local", "staging", "production"] = "production"
    log_level: str = "INFO"
    auth_port: int = 8002
    service_name: str = "ada-auth"

    # --- OTP storage --------------------------------------------------------

    redis_url: str = "redis://redis:6379/0"

    # Five minutes. Long enough for an SMS to arrive on a bad network, short
    # enough that a code read off a locked screen an hour later is useless.
    otp_ttl_seconds: int = 300
    otp_digits: int = 6
    # Wrong guesses allowed against one issued code before it is spent. Five
    # tries against a six-digit space is a 1-in-200000 chance per code, and the
    # throttling ladder below bounds how many codes an attacker can cause.
    otp_max_attempts: int = 5

    # The stored value is HMAC-SHA256(otp_hmac_key, phone:otp), never the code
    # itself. A Redis dump then does not hand over live codes, and the per-phone
    # salt means one precomputed table does not cover every pending login.
    #
    # No default: an empty key would silently degrade every stored code to a
    # keyed hash with a known key, which is not a hash at all.
    otp_hmac_key: str = ""

    # --- Throttling ladder --------------------------------------------------
    #
    # Four stages, each catching what the one before it lets through:
    #
    #   cooldown    one code per phone per minute — stops the Resend button
    #   window      N codes per phone per hour    — stops a patient loop
    #   soft lock   15 min after too many wrong guesses
    #   hard lock   24 h after repeated soft locks
    #
    # Flat cooldown, deliberately NOT exponential. A doubling backoff
    # (60/120/240) means the second Resend always fails after the client's 60 s
    # countdown has already reached zero, so the button can never be used. Spam
    # stays bounded by the hourly window instead.
    otp_request_cooldown_seconds: int = 60
    otp_request_window_seconds: int = 3600
    otp_request_phone_limit: int = 10

    otp_verify_window_seconds: int = 3600
    otp_verify_phone_limit: int = 5
    otp_soft_lock_seconds: int = 900
    otp_hard_lock_seconds: int = 86400
    otp_soft_locks_before_hard_lock: int = 3

    # Per-IP limits are off by default and that is not an oversight. Every
    # request arrives from the reverse proxy, so one shared source address
    # covers the whole estate and an IP counter locks out every user at once.
    # Turn it on only where the real client address survives to this service.
    otp_ip_limits_enabled: bool = False
    otp_request_ip_limit: int = 30
    otp_verify_ip_limit: int = 20

    # The Keycloak user attribute that holds the phone number. Searched with
    # ?q={attribute}:{phone}, then falling back to an exact username match for
    # accounts whose username IS the number — which is what HRMS provisions, and
    # what a migrated account therefore looks like.
    #
    # The value stored on the account has to be in the same form the caller
    # sends: digits only, no spaces, no punctuation, no leading +. A number
    # stored as "+91 99900 01234" will not be found by a search for
    # "919990001234", and the symptom is an unregistered-number response for an
    # account that plainly exists.
    otp_phone_attribute: str = "phoneNumber"

    # --- Enumeration --------------------------------------------------------
    #
    # /request-otp answers the same way whether or not the number is registered.
    # HRMS chose the opposite — it returns 404 "not registered" so the login
    # screen can show an immediate error — and paid for it in user enumeration:
    # anyone can probe which numbers exist. ADA is the shared identity plane
    # for every application, so the default here is the private one, and an
    # application that wants the friendlier error opts in explicitly.
    otp_reveal_unknown_phone: bool = False

    # --- SMS ----------------------------------------------------------------
    #
    # console  log the code at WARNING and send nothing. Local default.
    # stub     accept and drop. For tests.
    # twofactor  2factor.in, the provider HRMS uses.
    sms_provider: Literal["console", "stub", "twofactor"] = "console"
    sms_timeout_seconds: float = 10.0
    twofactor_api_key: str = ""
    # 2factor.in addresses a template by name, and the template is what carries
    # the sender id and the approved wording.
    twofactor_template: str = "OTP1"

    # --- Email one-time codes -----------------------------------------------
    #
    # The same ladder, the same store and the same code generator as the phone
    # channel — only the lookup and the delivery differ. Keys are namespaced by
    # channel, so a code issued to an address cannot be spent against a number.
    #
    # console  log the code at WARNING and send nothing. Local default.
    # stub     accept and drop. For tests.
    # smtp     a real relay.
    email_otp_provider: Literal["console", "stub", "smtp"] = "console"

    # Its own SMTP settings rather than ada-notify's. ada-auth holds no queue
    # and no database on purpose, and a login code must not wait behind an
    # outbox — see app/email/smtp.py.
    auth_smtp_host: str = ""
    auth_smtp_port: int = 587
    auth_smtp_username: str = ""
    auth_smtp_password: str = ""
    auth_smtp_starttls: bool = True
    auth_smtp_ssl: bool = False
    auth_email_from: str = "ada@pcsmcpl.net"
    auth_email_from_name: str = "ADA"

    # Answer /email/request-otp the same way whether or not the address is
    # registered. Same argument as otp_reveal_unknown_phone, and more pressing:
    # an address is easier to guess than a number.
    otp_reveal_unknown_email: bool = False

    # --- Development bypass -------------------------------------------------
    #
    # The bypass accepts any code, so it needs three independent things to be
    # true at once:
    #
    #   env == "local"                   (the default is production)
    #   allow_otp_dev_bypass == True     (explicit opt-in, default off)
    #   the issuer host is loopback or the compose "keycloak" host
    #
    # Staging and production can never enable it. A non-production env with a
    # public issuer refuses to start at all (see _refuse_public_non_production).
    allow_otp_dev_bypass: bool = False
    dev_otp: str = "000000"

    @field_validator("issuer")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")

    @field_validator("internal_issuer_url")
    @classmethod
    def _strip_optional_trailing_slash(cls, value: str | None) -> str | None:
        return value.rstrip("/") if value else None

    # An empty ADA_ENV (as a copied .env.example has it) means "not said", which
    # is production — never a validation error, never local.
    @field_validator("env", mode="before")
    @classmethod
    def _blank_env_is_production(cls, value: object) -> object:
        return "production" if value is None or str(value).strip() == "" else value

    @field_validator("otp_denied_roles", mode="before")
    @classmethod
    def _split_denied_roles(cls, value: object) -> object:
        if isinstance(value, str):
            text = value.strip().strip("[]")
            return [part.strip().strip("\"'") for part in text.split(",") if part.strip()]
        return value

    @model_validator(mode="after")
    def _refuse_public_non_production(self) -> Settings:
        if self.env != "production" and not _is_private_host(_host_of(self.issuer)):
            raise ValueError(
                f"ADA_ENV={self.env!r} but ADA_ISSUER={self.issuer!r} is a public host. "
                "Non-production modes relax OTP checks and are only permitted against a "
                "localhost or private-network issuer. Set ADA_ENV=production for a "
                "deployed service."
            )
        return self

    @property
    def dev_bypass_allowed(self) -> bool:
        return (
            self.env == "local"
            and self.allow_otp_dev_bypass is True
            and _host_of(self.issuer) in _BYPASS_ISSUER_HOSTS
        )

    @property
    def fetch_base(self) -> str:
        """The base URL to make HTTP requests against."""
        return self.internal_issuer_url or self.issuer

    @property
    def realm(self) -> str:
        """The realm name, taken from the issuer rather than configured twice.

        An issuer is always {server}/realms/{realm}, so the name is already
        there. A separate ADA_REALM would create a pair that can disagree,
        and disagreement presents as "no such user" rather than as
        misconfiguration.
        """
        return self.issuer.rsplit("/realms/", 1)[-1]

    @property
    def server_base(self) -> str:
        """The Keycloak server root, reachable from this process.

        The admin API lives at {server}/admin/realms/{realm}/..., a sibling of
        the realm path rather than a child, so the /realms segment comes off.
        """
        base = self.fetch_base
        marker = f"/realms/{self.realm}"
        return base[: -len(marker)] if base.endswith(marker) else base

    @property
    def token_endpoint(self) -> str:
        return f"{self.fetch_base}/protocol/openid-connect/token"

    @property
    def logout_endpoint(self) -> str:
        return f"{self.fetch_base}/protocol/openid-connect/logout"

    @property
    def admin_users_url(self) -> str:
        return f"{self.server_base}/admin/realms/{self.realm}/users"


_BYPASS_ISSUER_HOSTS = frozenset({"localhost", "127.0.0.1", "keycloak"})


def _host_of(url: str) -> str:
    return (urlsplit(url).hostname or "").lower()


# Loopback, RFC 1918 / link-local addresses, and single-label or internal names.
def _is_private_host(host: str) -> bool:
    if not host:
        return False
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return (
            "." not in host
            or host.endswith((".localhost", ".local", ".internal", ".lan"))
        )
    return address.is_loopback or address.is_private or address.is_link_local


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
