"""Settings for the ADA API service.

The API knows three things the ML service does not: who the caller is, where
the model service lives, and which origin the browser arrives from. It knows
none of the model tunables, which is the point of the split — a threshold
changing in ada-ml is not a redeploy of the process serving the map.

Shared settings (DATABASE_URL, DATA_DIR, the GDAL cache) come from
ada_core.CoreSettings.
"""

from __future__ import annotations

from ada_core import CoreSettings
from ada_core.database import configure_engine


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

    service_name: str = "ada-api"
    log_level: str = "INFO"
    api_port: int = 8000


settings = Settings()  # type: ignore[call-arg]
settings.prepare_runtime()
configure_engine(settings.database_url)
