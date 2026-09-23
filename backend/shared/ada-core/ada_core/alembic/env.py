"""Alembic environment for the schema ada-api and ada-ml share.

Two ways in, and both end up in the same place:

  * **Programmatically**, from `ada_core.migrate.run_migrations()` at ada-ml
    boot. It passes an open connection through `config.attributes`, so the
    migrations run on the engine the application already configured and no URL
    — and therefore no password — is rendered anywhere.

  * **From the CLI**, `alembic -c alembic.ini upgrade head`, for a developer or
    a deployment step. Then the URL comes from DATABASE_URL via CoreSettings,
    which is the same variable the services read.

`compare_type` and `compare_server_default` are on because without them
autogenerate silently misses a column changing type and a default being added
or dropped — and a `server_default` that exists in the model and not in the
database is exactly the class of bug that made this project adopt Alembic.
"""

from __future__ import annotations

from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine, pool

# Importing every model module is what registers the tables on the metadata.
# A module nobody imports contributes no tables, and autogenerate would then
# cheerfully emit a migration dropping every table it could not see.
from ada_core import models, models_app, models_icms  # noqa: F401
from ada_core.database import Base
from ada_core.types import Geometry

config = context.config

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _url() -> str:
    """The database to migrate, from the same setting the services use."""
    configured = config.get_main_option("sqlalchemy.url", None)
    if configured:
        return configured
    from ada_core.config import CoreSettings

    return CoreSettings().database_url


def _configure(connection) -> None:
    context.configure(
        connection=connection,
        target_metadata=target_metadata,
        compare_type=True,
        compare_server_default=True,
        render_item=_render_item,
        # PostGIS keeps its own bookkeeping; a migration must not try to manage
        # it. spatial_ref_sys is created by the extension and holds 8,500 rows
        # of projection definitions, and autogenerate would otherwise offer to
        # drop it.
        include_object=_include_object,
    )


def _include_object(obj, name, type_, reflected, compare_to) -> bool:
    """Never manage a table this project does not declare.

    The database ADA runs on is not exclusively ADA's. PostGIS brings
    `spatial_ref_sys` and, on the postgis/postgis image, the whole tiger
    geocoder — `edges`, `bg`, `tabblock`, `layer` and a dozen more. Without this
    rule the first autogenerate cheerfully emitted `op.drop_table('edges')` for
    every one of them, which is a migration that destroys somebody else's data
    on the way to creating ours.

    Anything reflected out of the database that is not in our metadata is
    therefore invisible to autogenerate. The cost is that a table we drop from
    the models has to be dropped in a hand-written migration; that is the right
    way round.
    """
    if type_ == "table" and reflected and name not in target_metadata.tables:
        return False
    return True


def _render_item(type_, obj, autogen_context) -> str | bool:
    """Teach autogenerate to write our own column types.

    Without this a geometry column renders as `sa.NullType()` — autogenerate
    only knows how to repr the types SQLAlchemy ships — and the migration
    creates a column with no type at all. Returning False falls back to the
    default rendering for everything else.
    """
    if type_ == "type" and isinstance(obj, Geometry):
        autogen_context.imports.add("from ada_core.types import Geometry")
        return f"Geometry({obj.geometry_type!r}, srid={obj.srid})"
    return False


def run_migrations_offline() -> None:
    """Emit SQL to stdout instead of applying it — `alembic upgrade head --sql`.

    This is how a migration gets reviewed before it touches a database that
    matters, and how it gets handed to somebody who runs it themselves.
    """
    context.configure(
        url=_url(),
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        include_object=_include_object,
        render_item=_render_item,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    connection = config.attributes.get("connection")
    if connection is not None:
        # Called from the application. The caller owns the transaction.
        _configure(connection)
        with context.begin_transaction():
            context.run_migrations()
        return

    # NullPool: a migration process runs once and exits, and a pooled engine
    # keeps it alive waiting on connections it will never use again.
    engine = create_engine(_url(), poolclass=pool.NullPool)
    try:
        with engine.connect() as conn:
            _configure(conn)
            with context.begin_transaction():
                context.run_migrations()
    finally:
        engine.dispose()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
