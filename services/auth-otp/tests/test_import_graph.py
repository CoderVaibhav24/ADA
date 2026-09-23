"""Rules about who may import what, with a failing build behind each one.

These are not style checks. Each one protects a property that is cheap to keep
and expensive to recover once it has been lost in a dozen modules.
"""

from __future__ import annotations

import ast
import pathlib

APP = pathlib.Path(__file__).resolve().parent.parent / "app"


def _imports(path: pathlib.Path) -> set[str]:
    tree = ast.parse(path.read_text())
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


def _modules() -> list[pathlib.Path]:
    return sorted(APP.rglob("*.py"))


def test_only_the_redis_adapter_imports_redis():
    """The cost of moving pending OTPs elsewhere is how many modules know where
    they are, and the answer has to stay one."""
    offenders = [
        path.relative_to(APP).as_posix()
        for path in _modules()
        if any(name.split(".")[0] == "redis" for name in _imports(path))
        and path.relative_to(APP).as_posix() != "store/redis_kv.py"
    ]

    assert offenders == [], f"redis must only be imported by store/redis_kv.py, found {offenders}"


def test_only_the_keycloak_gateway_and_the_sms_providers_speak_http():
    """Every outbound call goes through a module that knows how to fail properly.

    A stray httpx call somewhere else is a call with no timeout, no error
    translation and no log line, and it will be discovered during an outage.
    """
    allowed = {"keycloak.py", "main.py", "dependencies.py", "sms/twofactor.py", "sms/registry.py"}
    offenders = [
        path.relative_to(APP).as_posix()
        for path in _modules()
        if "httpx" in _imports(path) and path.relative_to(APP).as_posix() not in allowed
    ]

    assert offenders == [], f"httpx is confined to {sorted(allowed)}, found {offenders}"


def test_the_otp_lifecycle_and_the_throttle_do_not_know_about_http():
    """They are pure logic over the store, which is why they are unit-testable.

    An import of fastapi here would mean a rate-limit decision that can only be
    exercised through a request.
    """
    for module in ("otp.py", "throttle.py"):
        names = _imports(APP / module)
        assert "fastapi" not in names, f"{module} must not import fastapi"
        assert "httpx" not in names, f"{module} must not import httpx"


def test_nothing_imports_a_database_driver():
    """This service holds no durable state, and it must not grow any.

    Every lasting fact about a person belongs to Keycloak. A schema here would be
    a second, weaker place where identity is recorded, and the moment one exists
    it starts drifting from the accounts it describes.
    """
    drivers = {"sqlalchemy", "asyncpg", "psycopg", "psycopg2", "alembic"}
    offenders = []
    for path in _modules():
        found = drivers & {name.split(".")[0] for name in _imports(path)}
        if found:
            offenders.append((path.relative_to(APP).as_posix(), sorted(found)))

    assert offenders == [], f"ada-auth must stay stateless, found {offenders}"
