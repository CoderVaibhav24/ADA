"""What the SDK raises, and what it deliberately does not.

Two families, and the split matters more than the individual classes:

  * ADAAuthError and its subclasses are raised. An application asking "is
    this token valid" needs an answer, and there is no sensible default — a
    request either is authenticated or is refused.

  * Sending never raises into a caller's request path. ADANotify.send returns
    an outcome instead. See notify.py for the argument; the short version is that
    a notification failing must not turn a successful leave approval into a 500.
"""

from __future__ import annotations


class ADAError(Exception):
    """Base for everything this package raises."""


class ADAConfigError(ADAError):
    """The SDK was constructed wrongly — a missing issuer, an unusable URL.

    Raised at construction rather than at first use, so a deployment with the
    wrong environment fails at startup instead of on the first request that
    happens to need a token.
    """


class ADAAuthError(ADAError):
    """A token was presented and is not acceptable. Answer 401."""

    status_code = 401

    def __init__(self, reason: str, detail: str = "Invalid or expired token") -> None:
        super().__init__(reason)
        self.reason = reason
        self.detail = detail


class ADAScopeError(ADAError):
    """The token is valid and does not carry the required scope. Answer 403.

    Distinct from ADAAuthError on purpose. A 401 sends a client off to fetch
    another token; when the problem is a missing scope, the new token will be
    identical and the client will loop.
    """

    status_code = 403

    def __init__(self, required: str, held: frozenset[str]) -> None:
        super().__init__(f"missing scope '{required}'")
        self.required = required
        self.held = held
        self.detail = f"Token lacks the required scope '{required}'"


class ADAUnavailable(ADAError):
    """ADA could not be reached. Only raised by explicitly synchronous calls."""
