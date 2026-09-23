"""Fixtures for the ada-ml suite.

These are unit tests around the service's edges — the door, the queue, the
notification — not around the pipeline. Running a real ChangeStar inference in
a test would need a GPU and a gigabyte of weights, and it would be testing
onnxruntime rather than anything this repository decides.

What IS tested here is everything the split introduced: who may queue work,
what happens to a job row when it ends, and whether the notification the
officer receives can be rendered from what the worker sends.

app.jobs imports the pipeline, and the pipeline imports torch. That import is
real and slow, so the modules that do not need it are imported lazily in the
tests that do.
"""

from __future__ import annotations

import os
import tempfile

_DATA = tempfile.mkdtemp(prefix="ada-ml-tests-")
os.environ.setdefault("DATABASE_URL", "sqlite://")
os.environ.setdefault("DATA_DIR", _DATA)
os.environ.setdefault("ML_SERVICE_TOKEN", "service-token")
# Keep the pipeline off any GPU during tests, whatever the host has.
os.environ.setdefault("ML_DEVICE", "cpu")
os.environ.setdefault("REQUIRE_GPU", "false")

import ada_core.database as database  # noqa: E402
import pytest  # noqa: E402
from ada_core import models  # noqa: E402
from ada_core.database import Base, SessionLocal, configure_engine  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

OWNER = "8f14e45f-ceea-467a-9f5a-000000000000"


@pytest.fixture
def engine():
    """A fresh in-memory database per test.

    The module engine is reset first because configure_engine is idempotent on
    the URL alone, and app/config.py already built one at import — without this
    the pool options below are silently discarded.
    """
    if database._engine is not None:
        database._engine.dispose()
    database._engine = None

    eng = configure_engine(
        "sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False}
    )
    Base.metadata.create_all(bind=eng)
    yield eng
    Base.metadata.drop_all(bind=eng)
    eng.dispose()
    database._engine = None


@pytest.fixture
def db(engine):
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def project(db):
    row = models.Project(user_id=OWNER, name="Agra")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@pytest.fixture
def raster(db, project):
    row = models.Raster(project_id=project.id, name="T1", original_path="/data/t1.tif")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


@pytest.fixture
def job(db, project):
    row = models.AnalysisJob(project_id=project.id, raster_t1_id=1, raster_t2_id=2, mode="ai")
    db.add(row)
    db.commit()
    db.refresh(row)
    return row
