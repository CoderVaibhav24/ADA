"""Accepts everything and sends nothing. For tests.

Records what it was asked to send so a test can assert on it, which the console
provider cannot offer without capturing log output.
"""

from __future__ import annotations


class StubSmsProvider:
    verifies_own_code = False

    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    async def send_code(self, phone: str, code: str) -> None:
        self.sent.append((phone, code))

    async def start_session(self, phone: str) -> str:
        self.sent.append((phone, "provider-generated"))
        return "stub-session"

    async def verify_session(self, session_id: str, code: str) -> bool:
        return session_id == "stub-session"
