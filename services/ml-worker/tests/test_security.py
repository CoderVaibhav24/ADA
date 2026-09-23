"""The one check on the model service's door."""

from __future__ import annotations

import pytest
from fastapi import HTTPException

from app import security


async def call(token: str) -> None:
    await security.require_service_token(token)


@pytest.mark.asyncio
async def test_the_right_token_passes(monkeypatch):
    monkeypatch.setattr(security.settings, "ml_service_token", "expected")
    await call("expected")


@pytest.mark.asyncio
async def test_a_wrong_token_is_401(monkeypatch):
    monkeypatch.setattr(security.settings, "ml_service_token", "expected")
    with pytest.raises(HTTPException) as exc:
        await call("guessed")
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_a_missing_token_is_401(monkeypatch):
    monkeypatch.setattr(security.settings, "ml_service_token", "expected")
    with pytest.raises(HTTPException) as exc:
        await call("")
    assert exc.value.status_code == 401


@pytest.mark.asyncio
async def test_a_prefix_of_the_token_is_not_enough(monkeypatch):
    monkeypatch.setattr(security.settings, "ml_service_token", "expected-secret")
    with pytest.raises(HTTPException):
        await call("expected")


@pytest.mark.asyncio
async def test_an_unset_token_disables_the_check(monkeypatch):
    """Right for a single-user local run against a loopback port, and only
    there: ADA_ENV=local."""
    monkeypatch.setattr(security.settings, "ml_service_token", "")
    monkeypatch.setattr(security.settings, "ada_env", "local")
    await call("")
    await call("anything at all")


@pytest.mark.asyncio
@pytest.mark.parametrize("env", ["production", "staging"])
async def test_an_unset_token_outside_local_refuses_every_call(monkeypatch, env):
    monkeypatch.setattr(security.settings, "ml_service_token", "")
    monkeypatch.setattr(security.settings, "ada_env", env)
    with pytest.raises(HTTPException) as caught:
        await call("")
    assert caught.value.status_code == 503


def test_the_comparison_is_constant_time():
    """A plain == returns as soon as two bytes differ, and the time it took
    says how long the matching prefix was — which turns guessing the token
    from infeasible into linear in its length."""
    import inspect

    source = inspect.getsource(security.require_service_token)
    assert "compare_digest" in source
    assert "==" not in source.split("compare_digest")[0].split("expected")[-1]
