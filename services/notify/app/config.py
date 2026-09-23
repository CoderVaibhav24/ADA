"""Settings, read from the environment only.

Every name here already exists in the repository's .env.example. Nothing carries
a default that would be wrong in production: the database URL and the issuer
have no defaults at all, so a missing one fails at import rather than connecting
to something unintended.
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

    # Compared against the token's 'iss' claim character for character. A
    # trailing slash here and not there is a blanket 401 with no useful
    # diagnostic, so it is normalised below rather than trusted.
    #
    # This is the PUBLIC issuer — whatever Keycloak was told to call itself, and
    # therefore whatever it stamps into every token it mints.
    issuer: str

    # Where to actually reach that issuer over HTTP, when it is not the same
    # address.
    #
    # Inside the compose network, Keycloak answers on http://keycloak:8090, but
    # KC_HOSTNAME makes it mint tokens claiming an issuer of
    # http://localhost:8090/realms/pcsmcpl. Both facts are correct and they do
    # not agree, so the two uses have to be separated: the issuer string is
    # compared, this URL is fetched. Collapsing them gives a choice between a
    # service that cannot resolve the JWKS host and one that rejects every
    # token for an issuer mismatch.
    #
    # Unset outside a container, where the two are the same thing.
    internal_issuer_url: str | None = None

    # Tokens are verified locally against the JWKS (AD-4). Introspection would
    # put Keycloak on the hot path of every request, which is exactly what
    # AD-4 exists to prevent.
    jwks_cache_seconds: int = 3600
    # A token signed by a key we have never seen is the signal for a rotation,
    # and the response is to refetch. Rate-limited, because otherwise an
    # attacker sends garbage kids and we DoS Keycloak on their behalf.
    jwks_min_refresh_seconds: int = 60
    # Clock skew allowance on exp/nbf. With a 60-second token lifetime this
    # cannot be generous: 30s of leeway on a 60s token is a 50% extension.
    jwt_leeway_seconds: int = 10

    required_scope: str = "notify:send"

    # --- Storage ------------------------------------------------------------

    database_url: str
    db_pool_size: int = 10
    db_max_overflow: int = 5
    db_echo: bool = False

    # --- Service ------------------------------------------------------------

    env: Literal["local", "staging", "production"] = "local"
    log_level: str = "INFO"
    notify_port: int = 8001

    # NFR: ingestion answers inside 200 ms. The statement timeout is set well
    # under that so a pathological query surfaces as an error attributable to
    # this setting, rather than as a request that quietly blows the budget.
    db_statement_timeout_ms: int = 3000

    max_payload_bytes: int = 64 * 1024

    service_name: str = "ada-notify"

    # --- Broker -------------------------------------------------------------
    #
    # Redis Streams is the adapter, not the interface (AD-3). Everything below
    # is named in broker-neutral terms except redis_url itself, so that a Kafka
    # adapter would read the same settings.

    redis_url: str = "redis://redis:6379/0"

    # Stream and group names. The consumer group is what makes delivery
    # at-least-once with acknowledgement rather than fire-and-forget: an
    # unacknowledged message stays in the group's pending list and is reclaimable.
    stream_prefix: str = "ada"
    consumer_group: str = "ada-workers"

    # MAXLEN ~ on XADD. Streams grow without bound otherwise, and the outbox —
    # not Redis — is the durable record, so trimming loses nothing that has been
    # acknowledged.
    stream_max_length: int = 100_000

    # How long a consumer blocks waiting for a message before looping. Long
    # enough that an idle worker is not spinning, short enough that a shutdown
    # signal is acted on promptly.
    consume_block_ms: int = 5_000
    consume_batch: int = 32

    # --- Outbox dispatcher --------------------------------------------------

    outbox_poll_seconds: float = 0.5
    outbox_batch: int = 100

    # --- Retry ladder -------------------------------------------------------
    #
    # base 10 s, cap 1 hour, five attempts, full jitter. Roughly 10 s, 30 s,
    # 2 min, 10 min, 1 hour (build-plan.md, Sunday 30 August).
    retry_max_attempts: int = 5
    retry_base_seconds: float = 10.0
    retry_cap_seconds: float = 3600.0
    # Full jitter, not equal jitter and not none. Without it a provider outage
    # produces a retry stampede in which everything that failed together retries
    # together, forever.
    retry_jitter: bool = True

    # How often the scheduler moves due entries out of retry:{channel} back onto
    # the stream. Streams cannot schedule, which is why the sorted set exists.
    scheduler_tick_seconds: float = 1.0

    # --- Reclaimer ----------------------------------------------------------
    #
    # XAUTOCLAIM with a minimum idle time. Five minutes: long enough that a slow
    # SMTP send is not reclaimed underneath the worker still doing it, short
    # enough to satisfy "reclaimed within five minutes" (definition of done, 8).
    reclaim_min_idle_ms: int = 300_000
    reclaim_tick_seconds: float = 30.0
    reclaim_batch: int = 64

    # --- Email --------------------------------------------------------------

    email_provider: Literal["smtp", "stub", "failing_stub"] = "smtp"
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_starttls: bool = True
    smtp_ssl: bool = False
    email_from: str = ""
    email_from_name: str = "ADA"
    email_timeout_seconds: float = 10.0

    # --- Recipient resolution -----------------------------------------------
    #
    # A recipient is a Keycloak subject (AD-8), and the email channel needs an
    # address. Keycloak is the source of truth for that address, so it is read
    # from the admin API and cached — never copied into a column that then
    # drifts from the account it describes.
    admin_client_id: str = "ada-notify"
    admin_client_secret: str = ""
    recipient_cache_seconds: int = 300

    # --- End-user endpoints (/v1/me) ------------------------------------------

    # Comma-separated Keycloak clients whose *user* tokens may call /v1/me.
    user_client_ids: str = "ada-field"

    # --- Push (FCM HTTP v1 + APNs, direct; no Expo Push Service) --------------

    # native = FCM and/or APNs from the credentials below; absent credentials
    # disable that platform with a startup warning rather than failing boot.
    push_provider: Literal["native", "stub", "failing_stub"] = "native"
    push_timeout_seconds: float = 10.0

    fcm_project_id: str = ""
    fcm_service_account_file: str = ""

    apns_key_file: str = ""
    apns_key_id: str = ""
    apns_team_id: str = ""
    apns_bundle_id: str = ""

    @field_validator("issuer")
    @classmethod
    def _strip_trailing_slash(cls, value: str) -> str:
        return value.rstrip("/")

    @field_validator("database_url")
    @classmethod
    def _require_async_driver(cls, value: str) -> str:
        # A psycopg URL here produces 'MissingGreenlet' somewhere deep inside the
        # first request, which is an unreadable way to learn about a typo.
        if not value.startswith("postgresql+asyncpg://"):
            raise ValueError(
                "ADA_DATABASE_URL must use the asyncpg driver, "
                "e.g. postgresql+asyncpg://user:pass@host:5400/ada"
            )
        return value

    @field_validator("internal_issuer_url")
    @classmethod
    def _strip_optional_trailing_slash(cls, value: str | None) -> str | None:
        return value.rstrip("/") if value else None

    @property
    def user_clients(self) -> frozenset[str]:
        return frozenset(c.strip() for c in self.user_client_ids.split(",") if c.strip())

    @property
    def fetch_base(self) -> str:
        """The base URL to make HTTP requests against."""
        return self.internal_issuer_url or self.issuer

    @property
    def discovery_url(self) -> str:
        return f"{self.fetch_base}/.well-known/openid-configuration"

    @property
    def realm(self) -> str:
        """The realm name, taken from the issuer rather than configured twice.

        An issuer is always {server}/realms/{realm}, so the name is already
        present. Adding ADA_REALM alongside it would create a pair that can
        disagree, and the symptom of disagreement — admin lookups against a realm
        that has no such user — reads as a missing user rather than as
        configuration.
        """
        return self.issuer.rsplit("/realms/", 1)[-1]

    @property
    def server_base(self) -> str:
        """The Keycloak server root, reachable from this process.

        The admin API is served from {server}/admin/realms/{realm}/..., which is
        a sibling of the realm path rather than a child of it, so the /realms
        segment has to come off.
        """
        base = self.fetch_base
        marker = f"/realms/{self.realm}"
        return base[: -len(marker)] if base.endswith(marker) else base

    @property
    def token_endpoint(self) -> str:
        return f"{self.fetch_base}/protocol/openid-connect/token"

    def to_fetchable(self, advertised_url: str) -> str:
        """Rewrite a URL the realm advertises into one reachable from here.

        The discovery document advertises jwks_uri under the public issuer, so a
        container that fetched it verbatim would try to resolve the public host
        and fail. Only the issuer prefix is rewritten; a URL pointing anywhere
        else is returned untouched rather than being silently redirected at our
        own Keycloak.
        """
        if self.internal_issuer_url and advertised_url.startswith(self.issuer):
            return self.internal_issuer_url + advertised_url[len(self.issuer) :]
        return advertised_url


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
