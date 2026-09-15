"""The rule that keeps the broker abstraction real.

Saturday's definition of done: "an import-graph test fails the build if `redis`
is imported outside `broker/`."

An abstraction with no enforcement is a convention, and conventions decay under
deadline. The specific decay this prevents: somebody needs a sorted set at 2 a.m.,
imports redis directly in the delivery worker because it is three lines instead of
a new method on the protocol, and the broker package quietly stops being the only
thing that knows about Redis. Nothing breaks that night. The cost arrives months
later, when changing broker means auditing every module instead of writing one
file.

These tests are static — they read the source with `ast` rather than importing
anything — so they run without a database, without Redis, and in milliseconds.
"""

from __future__ import annotations

import ast
import pathlib

APP = pathlib.Path(__file__).resolve().parent.parent / "app"

# The package allowed to know which broker this is.
BROKER_PACKAGE = APP / "broker"

# Modules a channel adapter may import that nothing else should. Same argument as
# the broker: the day a second provider appears, the swap must be one file.
PROVIDER_MODULES = {"aiosmtplib", "smtplib"}
CHANNELS_PACKAGE = APP / "channels"


def _imported_modules(path: pathlib.Path) -> set[str]:
    """Every top-level module name imported by one file."""
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    modules: set[str] = set()

    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                modules.add(alias.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            # level > 0 is a relative import, which cannot reach a third-party
            # package and so cannot be the violation this looks for.
            if node.level == 0 and node.module:
                modules.add(node.module.split(".")[0])

    return modules


def _python_files() -> list[pathlib.Path]:
    return sorted(p for p in APP.rglob("*.py") if "__pycache__" not in p.parts)


def test_redis_is_imported_only_inside_the_broker_package() -> None:
    offenders = [
        path.relative_to(APP.parent)
        for path in _python_files()
        if BROKER_PACKAGE not in path.parents and "redis" in _imported_modules(path)
    ]

    assert not offenders, (
        "redis is imported outside app/broker/: "
        + ", ".join(str(p) for p in offenders)
        + ".\n\nThe broker abstraction (AD-3) exists so that exactly one package "
        "knows which broker this is. Add what you need to app/broker/base.py as a "
        "method on the Broker protocol, implement it in redis_streams.py, and call "
        "that instead."
    )


def test_provider_libraries_are_imported_only_inside_the_channels_package() -> None:
    offenders = []
    for path in _python_files():
        if CHANNELS_PACKAGE in path.parents:
            continue
        used = _imported_modules(path) & PROVIDER_MODULES
        if used:
            offenders.append((path.relative_to(APP.parent), sorted(used)))

    assert not offenders, (
        "a mail provider library is imported outside app/channels/: "
        + ", ".join(f"{path} ({', '.join(modules)})" for path, modules in offenders)
        + ".\n\nSending belongs behind the Channel protocol, so that swapping SMTP "
        "for a vendor API is one new file rather than an edit to the delivery worker."
    )


def test_the_broker_adapter_satisfies_the_broker_protocol() -> None:
    """Structural conformance, checked once, here.

    RedisStreamsBroker does not inherit from Broker — Broker is a Protocol, and
    that is deliberate: structural typing is what makes a second adapter a new
    file rather than an edit to a base class. The cost of that choice is that
    nothing checks the conformance at import time, so it is checked here.
    """
    import inspect

    from app.broker.base import Broker
    from app.broker.redis_streams import RedisStreamsBroker

    required = {
        name
        for name, value in inspect.getmembers(Broker, inspect.isfunction)
        if not name.startswith("_")
    }
    missing = sorted(name for name in required if not hasattr(RedisStreamsBroker, name))

    assert not missing, (
        f"RedisStreamsBroker is missing {missing}. Every method on the Broker "
        "protocol has to exist on every adapter, or the abstraction only appears "
        "to work until the first caller reaches for the missing one."
    )


def test_the_email_adapters_satisfy_the_channel_protocol() -> None:
    from app.channels.email import EmailChannel, FailingEmailChannel, StubEmailChannel

    for adapter in (EmailChannel, StubEmailChannel, FailingEmailChannel):
        assert hasattr(adapter, "send"), f"{adapter.__name__} has no send()"
        assert hasattr(adapter, "close"), f"{adapter.__name__} has no close()"
        assert getattr(adapter, "name", None) == "email", (
            f"{adapter.__name__}.name must be 'email' — the registry keys channels "
            "by it, and a mismatch silently registers the adapter under the wrong "
            "topic."
        )
