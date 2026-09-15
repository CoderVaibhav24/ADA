"""Accepts everything and sends nothing. For tests.

Records what it was asked to send so a test can assert on it, which the console
provider cannot offer without capturing log output.
"""

from __future__ import annotations


class StubEmailProvider:
    def __init__(self) -> None:
        self.sent: list[tuple[str, str]] = []

    async def send_code(self, address: str, code: str) -> None:
        self.sent.append((address, code))
