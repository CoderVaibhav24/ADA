"""Request-scoped access to the objects built once at startup.

Everything expensive — the HTTP client, the Keycloak gateway, the store — is
constructed in the lifespan and read from app.state here. Building any of them
per request would open a new connection to Keycloak or Redis on every login.
"""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from app.config import Settings, get_settings
from app.email.base import EmailProvider
from app.keycloak import KeycloakGateway
from app.otp import OtpService
from app.sms.base import SmsProvider
from app.throttle import OtpThrottle


def settings_of(request: Request) -> Settings:
    return get_settings()


def keycloak_of(request: Request) -> KeycloakGateway:
    return request.app.state.keycloak


def otp_of(request: Request) -> OtpService:
    return request.app.state.otp


def throttle_of(request: Request) -> OtpThrottle:
    return request.app.state.throttle


def sms_of(request: Request) -> SmsProvider:
    return request.app.state.sms


def email_of(request: Request) -> EmailProvider:
    return request.app.state.email


CurrentSettings = Annotated[Settings, Depends(settings_of)]
Keycloak = Annotated[KeycloakGateway, Depends(keycloak_of)]
Otp = Annotated[OtpService, Depends(otp_of)]
Throttle = Annotated[OtpThrottle, Depends(throttle_of)]
Sms = Annotated[SmsProvider, Depends(sms_of)]
Email = Annotated[EmailProvider, Depends(email_of)]
