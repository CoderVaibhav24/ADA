"""The SQLAlchemy engine, shared by every service that owns ADA's tables.

The engine is configured rather than constructed at import: two services with
different settings objects load this module, and an engine built from an
environment variable read at import time is one that cannot be pointed anywhere
else — including at a test database. Each service calls `configure_engine()`
once, from its own `app/config.py`, immediately after building its settings.
"""

from __future__ import annotations

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from .config import PoolSettings
from .datetimes import IST_NAME

SessionLocal = sessionmaker(autoflush=False, expire_on_commit=False)

_engine: Engine | None = None


class Base(DeclarativeBase):
    pass


# Split out because create_engine swallows connect_args into a closure, so this dict is the
# only place the settings that were actually applied can still be read.
def engine_options(database_url: str, **overrides) -> dict:
    pool = PoolSettings()
    options: dict = {"pool_pre_ping": pool.db_pool_pre_ping}
    # SQLite's SingletonThreadPool raises TypeError on these rather than ignoring them.
    if not database_url.startswith("sqlite"):
        options.update(
            pool_size=pool.db_pool_size,
            max_overflow=pool.db_max_overflow,
            pool_timeout=pool.db_pool_timeout,
            pool_recycle=pool.db_pool_recycle,
        )
    options.update(overrides)
    # Pins the SESSION zone, which is what makes a TIMESTAMPTZ come back as +05:30. Writing
    # naive local times instead would lose the instant the moment another session read it.
    if database_url.startswith("postgresql"):
        connect_args = dict(options.get("connect_args") or {})
        connect_args.setdefault("options", f"-c timezone={IST_NAME}")
        options["connect_args"] = connect_args
    return options


def configure_engine(database_url: str, **overrides) -> Engine:
    """Build the engine and bind the session factory to it.

    Idempotent for the same URL, so a service that imports its config module
    twice under different names does not end up with two connection pools.
    """
    global _engine
    if _engine is not None and str(_engine.url) == database_url:
        SessionLocal.configure(bind=_engine)
        return _engine
    if _engine is not None:
        _engine.dispose()
    _engine = create_engine(database_url, **engine_options(database_url, **overrides))
    SessionLocal.configure(bind=_engine)
    return _engine


def get_engine() -> Engine:
    if _engine is None:
        raise RuntimeError(
            "ada_core.database.configure_engine() has not been called. Each "
            "service does this in its app/config.py; importing a model before "
            "that module is what usually gets you here."
        )
    return _engine


def get_db():
    """FastAPI dependency: one session per request, always closed."""
    db: Session = SessionLocal()
    try:
        yield db
    finally:
        db.close()
