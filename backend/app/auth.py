from supertokens_python import InputAppInfo, SupertokensConfig, init
from supertokens_python.recipe import dashboard, emailpassword, session, usermetadata

from .config import settings


def init_supertokens() -> None:
    init(
        app_info=InputAppInfo(
            app_name="ADA Change Detection",
            api_domain=settings.api_domain,
            website_domain=settings.website_domain,
            api_base_path="/api/auth",
            website_base_path="/auth",
        ),
        supertokens_config=SupertokensConfig(
            connection_uri=settings.supertokens_connection_uri,
            api_key=settings.supertokens_api_key,
        ),
        framework="fastapi",
        recipe_list=[
            emailpassword.init(),
            session.init(),
            usermetadata.init(),
            dashboard.init(),
        ],
        mode="asgi",
    )
