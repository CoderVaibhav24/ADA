"""Fixtures for the ada-core suite.

These are unit tests against a real SQLAlchemy engine, not mocks. The engine is
in-memory SQLite, which is possible only because models.py declares its JSONB
columns with a SQLite variant — on a plain JSONB the schema cannot be created
without a PostgreSQL server, and a suite that needed one would not run in CI.

StaticPool is not a detail: the default SQLite pool hands out a NEW in-memory
database per connection, so a table created on one connection is invisible to
the next and every test sees an empty schema.
"""

from __future__ import annotations

import pytest
from sqlalchemy.pool import StaticPool

from ada_core import models
from ada_core.database import Base, SessionLocal, configure_engine


@pytest.fixture
def engine():
    eng = configure_engine(
        "sqlite://",
        poolclass=StaticPool,
        connect_args={"check_same_thread": False},
    )
    Base.metadata.create_all(bind=eng)
    yield eng
    Base.metadata.drop_all(bind=eng)


@pytest.fixture
def db(engine):
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def project(db):
    row = models.Project(user_id="8f14e45f-ceea-467a-9f5a-000000000000", name="Agra")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
