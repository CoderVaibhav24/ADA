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

from ada_core import CoreSettings
from ada_core.database import configure_engine
from pydantic import AliasChoices, Field


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
    # Presented on X-ADA-Service-Token. Must match ML_SERVICE_TOKEN in ada-ml;
    # both empty disables the check.
    ml_service_token: str = ""
    # Queueing a job is a database-backed handoff, not the work itself, so this
    # is short on purpose: if ada-ml cannot accept an id in five seconds the
    # right answer to the officer is an error, not a spinner.
    ml_timeout_seconds: float = 5.0

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

    service_name: str = "ada-api"
    log_level: str = "INFO"
    api_port: int = 8000

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
