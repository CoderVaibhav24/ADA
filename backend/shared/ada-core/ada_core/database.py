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

# Endpoints run in FastAPI's worker threadpool (see ada-api routers/rasters.py
# for why), so requests genuinely overlap rather than serialising on the event
# loop. Each holds a session for its whole duration — a tile request keeps one
# open across the GDAL read — and MapLibre opens a dozen tile requests at once.
# The default pool of 5 + 10 overflow would have them queueing on the connection
# pool instead of the event loop, which is the same stall wearing a different
# hat. Sized to cover the threadpool's default width.
POOL_SIZE = 20
MAX_OVERFLOW = 20
POOL_RECYCLE = 1800

SessionLocal = sessionmaker(autoflush=False, expire_on_commit=False)

_engine: Engine | None = None


class Base(DeclarativeBase):
    pass


def configure_engine(database_url: str, **overrides) -> Engine:
    """Build the engine and bind the session factory to it.

    Idempotent for the same URL, so a service that imports its config module
    twice under different names does not end up with two connection pools.
    """
    global _engine
    if _engine is not None and str(_engine.url) == database_url:
        return _engine
    if _engine is not None:
        _engine.dispose()
    options: dict = {"pool_pre_ping": True}
    # The pool sizing is a QueuePool setting and PostgreSQL is the only backend
    # ADA runs on — but SQLite uses SingletonThreadPool, which REJECTS
    # pool_size and max_overflow with a TypeError rather than ignoring them.
    # Passing them unconditionally makes `configure_engine("sqlite://")`
    # impossible, which is the one thing a test wants to do.
    if not database_url.startswith("sqlite"):
        options.update(
            pool_size=POOL_SIZE,
            max_overflow=MAX_OVERFLOW,
            pool_recycle=POOL_RECYCLE,
        )
    options.update(overrides)
    _engine = create_engine(database_url, **options)
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
