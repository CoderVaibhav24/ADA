from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from .config import settings

# Endpoints run in FastAPI's worker threadpool (see routers/rasters.py for why),
# so requests genuinely overlap now rather than serialising on the event loop.
# Each holds a session for its whole duration — a tile request keeps one open
# across the GDAL read — and MapLibre opens a dozen tile requests at once. The
# default pool of 5 + 10 overflow would have them queueing on the connection
# pool instead of the event loop, which is the same stall wearing a different
# hat. Sized to cover the threadpool's default width.
engine = create_engine(settings.database_url, pool_pre_ping=True,
                       pool_size=20, max_overflow=20, pool_recycle=1800)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
