"""The push channel: one adapter, two senders (FCM for Android, APNs for iOS)."""

from __future__ import annotations

import uuid

import structlog

from app.channels.apns import ApnsSender, load_signing_key
from app.channels.base import Outgoing, PermanentError, RetryableError, SendResult
from app.channels.fcm import CredentialsError, FcmSender, load_service_account, redact_token
from app.config import Settings

logger = structlog.get_logger(__name__)


class PushChannel:
    """Implements app.channels.base.Channel for 'push', routing by device platform."""

    name = "push"

    def __init__(
        self,
        settings: Settings,
        *,
        fcm: FcmSender | None = None,
        apns: ApnsSender | None = None,
        build: bool = True,
    ) -> None:
        self._settings = settings
        self._fcm = fcm
        self._apns = apns
        if build:
            self._fcm = self._fcm or _build_fcm(settings)
            self._apns = self._apns or _build_apns(settings)
        logger.info(
            "push_channel_ready",
            android_fcm=self._fcm is not None,
            ios_apns=self._apns is not None,
        )
        if self._fcm is None and self._apns is None:
            logger.warning(
                "push_disabled",
                detail="no FCM or APNs credentials configured; every push delivery "
                "will fail with 'push is not configured' until they are",
            )

    async def send(self, message: Outgoing) -> SendResult:
        if message.push is None:
            raise PermanentError("push delivery has no device platform")
        platform = message.push.platform
        sender = {"android": self._fcm, "ios": self._apns}.get(platform)
        if sender is None:
            provider = "FCM" if platform == "android" else "APNs"
            raise PermanentError(
                f"{platform} push is not configured ({provider} credentials absent)"
            )
        return await sender.send(message)

    async def close(self) -> None:
        for sender in (self._fcm, self._apns):
            if sender is not None:
                await sender.close()


def _build_fcm(settings: Settings) -> FcmSender | None:
    if not (settings.fcm_project_id and settings.fcm_service_account_file):
        logger.warning(
            "push_platform_disabled",
            platform="android",
            detail="ADA_FCM_PROJECT_ID / ADA_FCM_SERVICE_ACCOUNT_FILE not set",
        )
        return None
    try:
        account = load_service_account(settings.fcm_service_account_file)
    except CredentialsError as exc:
        logger.error("push_platform_disabled", platform="android", detail=str(exc))
        return None
    return FcmSender(
        project_id=settings.fcm_project_id,
        service_account=account,
        timeout=settings.push_timeout_seconds,
    )


def _build_apns(settings: Settings) -> ApnsSender | None:
    required = {
        "ADA_APNS_KEY_FILE": settings.apns_key_file,
        "ADA_APNS_KEY_ID": settings.apns_key_id,
        "ADA_APNS_TEAM_ID": settings.apns_team_id,
        "ADA_APNS_BUNDLE_ID": settings.apns_bundle_id,
    }
    missing = [name for name, value in required.items() if not value]
    if missing:
        logger.warning(
            "push_platform_disabled", platform="ios", detail=f"not set: {', '.join(missing)}"
        )
        return None
    try:
        key = load_signing_key(settings.apns_key_file)
    except CredentialsError as exc:
        logger.error("push_platform_disabled", platform="ios", detail=str(exc))
        return None
    return ApnsSender(
        signing_key=key,
        key_id=settings.apns_key_id,
        team_id=settings.apns_team_id,
        bundle_id=settings.apns_bundle_id,
        timeout=settings.push_timeout_seconds,
    )


class StubPushChannel:
    """Accepts every push and sends nothing. For local work with no credentials."""

    name = "push"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self.sent: list[Outgoing] = []

    async def send(self, message: Outgoing) -> SendResult:
        self.sent.append(message)
        logger.info(
            "push_stubbed",
            token=redact_token(message.to),
            platform=message.push.platform if message.push else None,
            data_keys=sorted(message.data),
        )
        return SendResult(provider_message_id=f"stub-{uuid.uuid4()}", detail="stub provider")

    async def close(self) -> None:
        return None


class FailingPushChannel:
    """Fails every push, retryably. Exists to prove the retry ladder for push."""

    name = "push"

    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    async def send(self, message: Outgoing) -> SendResult:
        raise RetryableError(
            "ADA_PUSH_PROVIDER=failing_stub — this provider refuses every push on purpose"
        )

    async def close(self) -> None:
        return None
