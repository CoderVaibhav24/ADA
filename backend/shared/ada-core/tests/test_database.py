"""The engine both services share, and the way it is configured rather than built."""

from __future__ import annotations

import pytest
from sqlalchemy.pool import QueuePool, StaticPool

import ada_core.database as database
from ada_core.config import PoolSettings
from ada_core.database import (
    SessionLocal,
    configure_engine,
    engine_options,
    get_db,
    get_engine,
)
from ada_core.datetimes import IST_NAME


@pytest.fixture(autouse=True)
def _reset_module_engine():
    """Each test starts with no engine, and leaves none behind.

    The engine is module state on purpose — two services must not each build
    their own pool — which means a test that configures one has to put it back.
    """
    previous = database._engine
    database._engine = None
    yield
    if database._engine is not None and database._engine is not previous:
        database._engine.dispose()
    database._engine = previous


def test_get_engine_before_configure_explains_itself():
    with pytest.raises(RuntimeError) as exc:
        get_engine()
    # The message has to name the fix; this is the failure a new service hits.
    assert "configure_engine" in str(exc.value)


def test_configure_binds_the_session_factory():
    engine = configure_engine("sqlite://", poolclass=StaticPool)
    assert SessionLocal.kw["bind"] is engine
    assert get_engine() is engine


def test_configure_is_idempotent_for_the_same_url():
    """A service importing its config module twice under different names must
    not end up with two connection pools against one database."""
    first = configure_engine("sqlite://", poolclass=StaticPool)
    second = configure_engine("sqlite://", poolclass=StaticPool)
    assert first is second


def test_configure_replaces_the_engine_for_a_different_url(tmp_path):
    first = configure_engine("sqlite://", poolclass=StaticPool)
    second = configure_engine(f"sqlite:///{tmp_path / 'other.db'}")
    assert second is not first
    assert get_engine() is second


def test_postgres_gets_the_sized_pool():
    """Sized to cover FastAPI's threadpool: a tile request holds a session
    across a blocking GDAL read and MapLibre opens a dozen at once, so the
    default 5 + 10 would queue requests on the pool instead of the event loop."""
    pool = PoolSettings()
    engine = configure_engine("postgresql+psycopg2://u:p@example.invalid/db")
    assert isinstance(engine.pool, QueuePool)
    assert engine.pool.size() == pool.db_pool_size
    assert engine.pool._max_overflow == pool.db_max_overflow
    assert engine.pool._recycle == pool.db_pool_recycle


def test_pool_tuning_comes_from_the_environment(monkeypatch):
    """The whole point of moving it out of the module: a busy deployment raises
    the pool in infra/.env instead of waiting for a release."""
    monkeypatch.setenv("DB_POOL_SIZE", "7")
    monkeypatch.setenv("DB_MAX_OVERFLOW", "3")
    monkeypatch.setenv("DB_POOL_TIMEOUT", "11")
    monkeypatch.setenv("DB_POOL_RECYCLE", "60")
    engine = configure_engine("postgresql+psycopg2://u:p@example.invalid/db")
    assert engine.pool.size() == 7
    assert engine.pool._max_overflow == 3
    assert engine.pool._timeout == 11
    assert engine.pool._recycle == 60


def test_pre_ping_can_be_turned_off_from_the_environment(monkeypatch):
    monkeypatch.setenv("DB_POOL_PRE_PING", "false")
    engine = configure_engine("postgresql+psycopg2://u:p@example.invalid/db")
    assert engine.pool._pre_ping is False


def test_postgres_sessions_are_pinned_to_ist():
    """A TIMESTAMPTZ read by a session in another zone comes back in that zone.
    Pinning the session is what makes every row read back at +05:30."""
    options = engine_options("postgresql+psycopg2://u:p@example.invalid/db")
    assert options["connect_args"]["options"] == f"-c timezone={IST_NAME}"


def test_sqlite_is_given_no_connect_args():
    """SQLite has no session timezone, and libpq's `options` is not a keyword
    sqlite3.connect accepts — passing it raises TypeError at the first connect."""
    assert "connect_args" not in engine_options("sqlite://")
    assert configure_engine("sqlite://").dialect.name == "sqlite"


def test_sqlite_does_not_get_pool_arguments():
    """Regression. SQLite uses SingletonThreadPool, which REJECTS pool_size and
    max_overflow with a TypeError rather than ignoring them — passing them
    unconditionally made configure_engine('sqlite://') impossible, which is the
    one thing the test suite needs to do."""
    engine = configure_engine("sqlite://")
    assert engine.dialect.name == "sqlite"


def test_pre_ping_is_always_on():
    """A pooled connection that PostgreSQL closed underneath us surfaces as a
    random OperationalError on an unrelated request without this."""
    engine = configure_engine("postgresql+psycopg2://u:p@example.invalid/db")
    assert engine.pool._pre_ping is True


def test_get_db_yields_a_session_and_closes_it():
    configure_engine("sqlite://", poolclass=StaticPool)
    generator = get_db()
    session = next(generator)
    assert session.is_active
    with pytest.raises(StopIteration):
        next(generator)
    # close() returns the connection to the pool; a leaked session per request
    # exhausts it under load.
    assert not session.in_transaction()
