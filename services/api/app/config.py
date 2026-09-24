"""Settings for the ADA API service.

The API knows three things the ML service does not: who the caller is, where
the model service lives, and which origin the browser arrives from. It knows
none of the model tunables, which is the point of the split — a threshold
changing in ada-ml is not a redeploy of the process serving the map.

Shared settings (DATABASE_URL, DATA_DIR, the GDAL cache) come from
ada_core.CoreSettings.
"""

from __future__ import annotations

from pathlib import Path
from typing import Annotated, Literal

from ada_core import CoreSettings
from ada_core.database import configure_engine
from pydantic import AliasChoices, Field, SecretStr, field_validator, model_validator
from pydantic_settings import NoDecode


class Settings(CoreSettings):
    # --- identity ------------------------------------------------------------
    #
    # The PUBLIC issuer — whatever Keycloak was told to call itself, and
    # therefore what it stamps into the 'iss' claim of every token it mints.
    # Compared against that claim character for character, so a trailing slash
    # here and not there is a blanket 401 with no useful diagnostic.
    #
    # No default. A service that authenticates people against an unintended
    # issuer is worse than one that will not start.
    oidc_issuer: str

    # Where to actually REACH that issuer, when it is not the same address.
    # Inside compose Keycloak answers on http://keycloak:8090 while minting
    # tokens claiming http://localhost:8090/realms/pcsmcpl. Both are correct and
    # they disagree, so the string that gets compared and the URL that gets
    # fetched are kept apart. Unset outside a container.
    oidc_internal_issuer_url: str | None = None

    # The public browser client the single-page app authenticates through. Sent
    # to the frontend by /api/auth/config so the origin is configured once, on
    # the server, rather than baked into the built JavaScript.
    oidc_client_id: str = "ada-web"

    # The clients whose access tokens this API accepts, read from `azp`.
    # Anything else the shared realm issues — another application, a service
    # account, a token exchanged for a different audience — is refused.
    # ada-auth is here because a token minted by the OTP exchange carries
    # azp=ada-auth (measured on Keycloak 26.7.2); ada-auth's own service
    # account is still refused by the service-account check.
    # OIDC_ALLOWED_AZP, comma-separated.
    oidc_allowed_azp: Annotated[list[str], NoDecode] = ["ada-web", "ada-field", "ada-auth"]
    # The field app's client. A findings save whose token has this azp is field-origin;
    # any other accepted client is the web portal (docs/icms/inspection-findings-fields.md).
    oidc_field_client_id: str = "ada-field"

    # --- user administration -------------------------------------------------
    #
    # ada-api's OWN confidential client, whose service account holds four
    # realm-management roles and nothing else: view-users, query-users,
    # manage-users, view-realm. Keycloak is the user store — there is no local
    # users table — so /api/icms/admin/users is a proxy onto its Admin API.
    #
    # Deliberately NOT the bootstrap admin (admin-cli against the master realm,
    # KC_BOOTSTRAP_ADMIN_*). That account is a temporary superuser Keycloak
    # itself warns about, it can administer every realm on the server, and a
    # long-lived service must not be the thing that keeps it alive.
    oidc_admin_client_id: str = Field(
        default="ada-api",
        validation_alias=AliasChoices("OIDC_ADMIN_CLIENT_ID", "ADA_API_CLIENT_ID"),
    )
    # Empty disables the user-administration endpoints with a 503 that says so,
    # rather than letting them 401 against Keycloak one request at a time.
    oidc_admin_client_secret: str = Field(
        default="",
        validation_alias=AliasChoices(
            "OIDC_ADMIN_CLIENT_SECRET", "ADA_API_CLIENT_SECRET"
        ),
    )
    # Keycloak is a different failure domain from the database: a slow realm
    # must surface as a 503 the officer can read, not as a request that hangs
    # until the browser gives up. Admin writes are three round trips, so this is
    # per-call and not per-endpoint.
    keycloak_admin_timeout_seconds: float = 8.0

    # The realm's signing keys, cached. Past the soft TTL a request refreshes
    # them; past the hard TTL it stops serving what it holds even if every
    # refresh since has failed. The gap between the two is how long a Keycloak
    # outage can run before signed-in officers start seeing 503s — a day of
    # staleness is nothing against keys that rotate on the order of months.
    jwks_soft_ttl_seconds: int = 3600
    jwks_hard_ttl_seconds: int = 86_400

    # --- the model service ---------------------------------------------------
    ml_service_url: str = "http://ada-ml:8100"
    # Presented on X-ADA-Service-Token. Must match ML_SERVICE_TOKEN in ada-ml.
    # Required unless ADA_ENV=local; see _require_ml_token_outside_local.
    ml_service_token: str = ""
    # Queueing a job is a database-backed handoff, not the work itself, so this
    # is short on purpose: if ada-ml cannot accept an id in five seconds the
    # right answer to the officer is an error, not a spinner.
    ml_timeout_seconds: float = 5.0

    # --- notifications (ada-notify) -----------------------------------------
    # Tells a surveyor a case was assigned to them (push + inbox). Sent as the
    # ada-ml client: ada-notify maps exactly one client_id to a project, and the
    # field app's inbox reads project `ada`, which is bound to ada-ml.
    # Off by default so a stack without ada-notify is not trailed by warnings.
    notify_enabled: bool = False
    notify_url: str = "http://ada-notify:8001"
    # The token endpoint is fetched, not compared, so this is the REACHABLE realm URL.
    notify_issuer: str = ""
    notify_client_id: str = "ada-ml"
    notify_client_secret: str = ""

    # --- browser -------------------------------------------------------------
    # The origin the SPA is served from. One entry, not a wildcard: credentials
    # are sent with these requests and Access-Control-Allow-Origin: * is invalid
    # with them anyway.
    website_origin: str = "http://localhost:5173"

    # --- policy cache --------------------------------------------------------
    # The listener and the revision poll that keep this worker's RBAC and
    # workflow snapshot current. Off in the suite: a background thread sharing
    # an in-memory SQLite connection with the test is a flake, not a test.
    icms_policy_watch: bool = True
    icms_policy_poll_seconds: float = 15.0

    # --- field capture -------------------------------------------------------
    #
    # Two numbers for "the worst GPS fix, in metres, that still counts as 'the
    # surveyor stood there'", because refusing a capture and distrusting one are
    # different decisions and one number cannot answer both.
    #
    # The GATE is a hard refusal: a check-in above it is 422 `poor_accuracy` and
    # nothing is written. It is the wider of the two on purpose. `accuracy_m` is
    # a 68% confidence radius — 5-10 m under open sky but 20-50 m in an urban
    # canyon, which is exactly where a surveyor stands when the thing being
    # inspected is the four-storey wall of an unauthorised construction. Refuse
    # them there and they walk out into the road to get a fix, which defeats the
    # geo-tag. 50 m admits the built-up street and still excludes a
    # network-derived position from across the city.
    #
    # The FLAG is an annotation, not a refusal: evidence above it is stored, and
    # stored `geotag_flagged` rather than as geo-tagged. Strictness costs
    # nothing here — the capture is kept either way — and it is what lets the
    # officer reading the case later tell a photograph that supports "the
    # surveyor stood here" from one that merely asserts it. 15 m is about the
    # best a handset manages beside a building.
    #
    # ADA has fixed NEITHER number — section 8, open question 2 of the
    # build-order document. Both are placeholders. Settings rather than
    # constants because they are the numbers a district will argue about, and
    # that argument must not be a release.
    icms_accuracy_gate_m: float = Field(
        default=50.0,
        # ICMS_ACCURACY_THRESHOLD_M is the name a deployed .env may still carry,
        # from when one number did both jobs. It is still read, and it lands on
        # the gate: what it configured was a refusal.
        validation_alias=AliasChoices(
            "ICMS_ACCURACY_GATE_M", "ICMS_ACCURACY_THRESHOLD_M"
        ),
    )
    icms_accuracy_flag_m: float = 15.0
    # A photo whose EXIF GPS sits farther than this from the submitted fix is flagged.
    icms_exif_mismatch_m: float = 25.0

    # How many photographs one round carries: the floor a submit is held to and
    # the ceiling an upload is refused at. The server owns both — `submit`
    # refuses a round below the floor, `add_evidence` refuses a photograph past
    # the ceiling, and `GET /api/icms/app-config` publishes these two values so
    # no client has to carry a copy.
    #
    # The two numbers have different provenance and it is worth keeping them
    # apart rather than reading them as one pair of placeholders. The MINIMUM is
    # a DESIGN value: the Figma photographs step, node 179:6402, draws "n/3
    # minimum photos captured" (docs/Agents-Mobile/ui-registry.md section 1), so
    # 3 carries a designer's intent. The MAXIMUM is a LEGACY value: `maxPic` in
    # the field app this system replaces, which is evidence of what the old
    # system happened to do and not a requirement — the weaker of the two.
    #
    # ADA has confirmed NEITHER number. Settings rather than constants for the
    # reason the accuracy pair above are: they are the numbers a district will
    # argue about, and that argument must not be a release.
    icms_min_photos_per_round: int = 3
    icms_max_photos_per_round: int = 5
    # Photographs attached to a complaint at filing time, before any round.
    icms_max_photos_per_case: int = 10

    # Submit holds a round to the answer rules R1-R6 (app/icms/inspection_rules.py).
    # Off only in test suites that are about a transition rather than the answers.
    icms_require_inspection_answers: bool = True

    # --- reverse geocoding --------------------------------------------------
    # Suggests state, district and pin code for a complaint pin. Empty base URL
    # turns it off. The public Nominatim has a usage policy: docs/icms/geo-locate.md.
    geo_locate_base_url: str = "https://nominatim.openstreetmap.org"
    # Nominatim refuses anonymous clients; empty builds "ADA-ICMS/<version>".
    geo_locate_user_agent: str = ""
    # Appended to the default User-Agent as the operator contact Nominatim asks for.
    geo_locate_contact: str = ""
    geo_locate_timeout_s: float = 5.0

    # --- chunked upload and the sweeper (docs/ADA-Upload-and-ML-Runtime-Design.md §3) ---
    # One chunk must fit under the gateway's 128 MB per-request cap.
    upload_chunk_bytes: int = 64 << 20
    upload_max_bytes: int = 64 << 30
    upload_session_ttl_hours: float = 24.0
    upload_max_open_sessions: int = 3
    raster_failed_retention_days: float = 7.0
    raster_stuck_minutes: float = 30.0
    disk_min_free_pct: float = 15.0
    sweeper_interval_seconds: float = 900.0
    # Off in the suite: tests call sweep_once directly with a fake clock.
    sweeper_enabled: bool = True
    # ICMS deadline reminders (app/icms/reminders.py); SLAs live in icms_runtime_setting.
    reminders_enabled: bool = True

    # --- cold tier: any S3-compatible bucket; an empty endpoint disables it ---
    cold_store_endpoint: str = ""
    cold_store_bucket: str = ""
    cold_store_region: str = "us-east-1"
    cold_store_access_key: str = ""
    cold_store_secret_key: SecretStr = SecretStr("")
    # STANDARD for MinIO; GLACIER_IR or DEEP_ARCHIVE in production.
    cold_store_storage_class: str = "STANDARD"
    cold_after_days: float = 180.0
    cold_restore_eta_hours: float = 5.0
    # >0 writes every archive under COMPLIANCE-mode Object Lock for this many days.
    cold_object_lock_days: int = 0

    # Production unless said otherwise; compose (local development) sets local.
    ada_env: Literal["local", "staging", "production"] = "production"

    service_name: str = "ada-api"
    log_level: str = "INFO"
    api_port: int = 8000

    # An empty ADA_ENV (as a copied .env.example has it) means "not said", which
    # is production — never a validation error, never local.
    @field_validator("ada_env", mode="before")
    @classmethod
    def _blank_env_is_production(cls, value: object) -> object:
        return "production" if value is None or str(value).strip() == "" else value

    @field_validator("oidc_allowed_azp", mode="before")
    @classmethod
    def _split_allowed_azp(cls, value: object) -> object:
        if isinstance(value, str):
            text = value.strip().strip("[]")
            return [part.strip().strip("\"'") for part in text.split(",") if part.strip()]
        return value

    @model_validator(mode="after")
    def _require_ml_token_outside_local(self) -> Settings:
        if not self.ml_service_token and self.ada_env != "local":
            raise ValueError(
                f"ML_SERVICE_TOKEN is empty and ADA_ENV={self.ada_env!r}. Outside local "
                "development ada-api must authenticate to ada-ml; set ML_SERVICE_TOKEN "
                "(the same value ada-ml has) or ADA_ENV=local for a dev stack."
            )
        if not self.oidc_allowed_azp:
            raise ValueError("OIDC_ALLOWED_AZP is empty, so no token could ever be accepted")
        return self

    @model_validator(mode="after")
    def _check_upload_and_storage(self) -> Settings:
        if not 0 < self.upload_chunk_bytes <= 128 << 20:
            raise ValueError("UPLOAD_CHUNK_BYTES must be between 1 and 134217728 (the gateway cap)")
        if self.upload_max_bytes < self.upload_chunk_bytes:
            raise ValueError("UPLOAD_MAX_BYTES is smaller than one chunk")
        if not 0 <= self.disk_min_free_pct < 100:
            raise ValueError("DISK_MIN_FREE_PCT must be a percentage in [0, 100)")
        if self.upload_max_open_sessions < 1:
            raise ValueError("UPLOAD_MAX_OPEN_SESSIONS must be >= 1")
        if self.sweeper_interval_seconds <= 0:
            raise ValueError("SWEEPER_INTERVAL_SECONDS must be positive")
        if self.cold_store_endpoint and not self.cold_store_bucket:
            raise ValueError("COLD_STORE_ENDPOINT is set but COLD_STORE_BUCKET is empty")
        if self.cold_object_lock_days < 0:
            raise ValueError("COLD_OBJECT_LOCK_DAYS must be >= 0")
        return self

    @property
    def cold_store_enabled(self) -> bool:
        return bool(self.cold_store_endpoint and self.cold_store_bucket)

    # Under uploads_dir so one bind mount carries every officer-supplied file.
    @property
    def icms_evidence_dir(self) -> Path:
        """Where `icms_evidence.storage_path` is resolved from."""
        return self.uploads_dir / "icms-evidence"

    # Beside the evidence rather than inside it: evidence is what an officer
    # uploaded, a notice artefact is what this system served, and a sweep of one
    # must never reach the other.
    @property
    def icms_notice_dir(self) -> Path:
        """Where `icms_notice.artefact_path` is resolved from."""
        return self.uploads_dir / "icms-notices"

    # Split off the issuer rather than configured twice: the admin API lives at
    # <base>/admin/realms/<realm> on the same server the issuer names, and a
    # second pair of settings is a second thing to get out of step with it.
    # Reached over the INTERNAL address when there is one — the public issuer is
    # a browser-facing URL that a container generally cannot resolve.
    @property
    def keycloak_admin(self) -> tuple[str, str]:
        """(base URL, realm), e.g. ('http://keycloak:8090/idp', 'pcsmcpl')."""
        url = self.oidc_internal_issuer_url or self.oidc_issuer
        base, separator, realm = url.rstrip("/").partition("/realms/")
        if not separator or not realm:
            raise ValueError(
                f"cannot read a realm out of {url!r}; it must end in /realms/<realm>"
            )
        return base, realm


settings = Settings()  # type: ignore[call-arg]
settings.prepare_runtime()
configure_engine(settings.database_url)
