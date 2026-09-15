"""Engine, session factory, and the request-scoped session dependency."""

from __future__ import annotations

from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from app.config import Settings, get_settings

_engine: AsyncEngine | None = None
_session_factory: async_sessionmaker[AsyncSession] | None = None


def create_engine(settings: Settings | None = None) -> AsyncEngine:
    settings = settings or get_settings()
    return create_async_engine(
        settings.database_url,
        echo=settings.db_echo,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        # Recycle below any proxy or database idle timeout. Without it the first
        # request after an idle period fails with a closed connection, which is a
        # confusing thing to debug because it only happens after lunch.
        pool_recycle=1800,
        pool_pre_ping=True,
        connect_args={
            "server_settings": {
                "application_name": settings.service_name,
                "statement_timeout": str(settings.db_statement_timeout_ms),
            },
            # asyncpg caches prepared statements per connection. Through a
            # transaction-pooling proxy (PgBouncer) that cache goes stale and
            # every query starts failing with 'prepared statement does not
            # exist'. There is no proxy today; this makes adding one later a
            # configuration change rather than an outage.
            "statement_cache_size": 0,
        },
    )


def get_engine() -> AsyncEngine:
    global _engine
    if _engine is None:
        _engine = create_engine()
    return _engine


def get_session_factory() -> async_sessionmaker[AsyncSession]:
    global _session_factory
    if _session_factory is None:
        _session_factory = async_sessionmaker(
            get_engine(),
            expire_on_commit=False,  # a committed row stays readable in the handler
            autoflush=False,  # the ingestion path flushes deliberately, to catch IntegrityError
        )
    return _session_factory


async def dispose_engine() -> None:
    global _engine, _session_factory
    if _engine is not None:
        await _engine.dispose()
    _engine = None
    _session_factory = None


async def get_db() -> AsyncIterator[AsyncSession]:
    """FastAPI dependency. One session per request, rolled back on any exception.

    Commits are explicit in the handler. A dependency that commits on the way out
    would commit half-finished work whenever a handler returned early.
    """
    async with get_session_factory()() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise
