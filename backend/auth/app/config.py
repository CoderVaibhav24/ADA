"""Settings, read from the environment only.

Every name here exists in the repository's .env.example. The issuer has no
default, so a missing one fails at import rather than authenticating people
against something unintended.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


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

    # Passed as `audience` on the exchange when set. Left empty the exchanged
    # token is audienced at ada-auth itself, which is right when the caller
    # is a first-party application reading it through the SDK.
    exchange_audience: str = ""

    # --- Service ------------------------------------------------------------

    env: Literal["local", "staging", "production"] = "local"
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
    # Secure by default in the strong sense: production cannot enable this, with
    # or without the flag, so a misconfigured ADA_ENV can never turn OTP
    # verification into a no-op.
    #
    #   local       bypass on. The issued code is always dev_otp.
    #   staging     bypass on ONLY with allow_otp_dev_bypass set.
    #   production  bypass impossible.
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

    @property
    def dev_bypass_allowed(self) -> bool:
        if self.env == "local":
            return True
        if self.env == "staging":
            return self.allow_otp_dev_bypass
        return False

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


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
