"""Explicit, idempotent Manager SQL schema revisions; never run ALTER at startup."""

from sqlalchemy import JSON, Column, MetaData, Table, func, inspect, select, text
from sqlalchemy.schema import CreateColumn

SCHEMA_REVISION = "20261017_task_acceptance_criteria"
UPGRADE_COMMAND = "sop-manager schema apply"


class SchemaUpgradeRequired(RuntimeError):
    """A known schema revision must be applied before normal application startup."""


def verify_schema(engine) -> dict:
    inspector = inspect(engine)
    exists = inspector.has_table("tasks")
    column = next((column for column in inspector.get_columns("tasks")
                   if column["name"] == "acceptance_criteria"), None) if exists else None
    null_rows = 0
    if column is not None:
        tasks = Table("tasks", MetaData(), Column("acceptance_criteria", JSON))
        with engine.connect() as connection:
            null_rows = connection.execute(select(func.count()).select_from(tasks).where(
                tasks.c.acceptance_criteria.is_(None),
            )).scalar_one()
    current = column is not None and not column["nullable"] and null_rows == 0
    return {
        "revision": SCHEMA_REVISION,
        "dialect": engine.dialect.name,
        "status": "current" if current else "upgrade_required" if exists else "uninitialized",
        "missing": [] if column is not None else ["tasks.acceptance_criteria"],
        "nullable": column["nullable"] if column is not None else None,
        "null_rows": null_rows,
    }


def require_current_schema(engine) -> None:
    if verify_schema(engine)["status"] == "upgrade_required":
        raise SchemaUpgradeRequired(
            f"Manager database schema is outdated. Stop Manager and run `{UPGRADE_COMMAND}` "
            "with the same DATABASE_URL before restarting. Existing task acceptance criteria will default to []."
        )


def apply_schema_upgrade(engine) -> dict:
    before = verify_schema(engine)
    if before["status"] == "current":
        return before
    if before["status"] == "uninitialized":
        raise SchemaUpgradeRequired("Database is uninitialized; start Manager to create a new schema instead of upgrading.")
    dialect = engine.dialect
    if dialect.name not in {"sqlite", "postgresql"}:
        raise SchemaUpgradeRequired(f"Schema upgrade does not support the {dialect.name} dialect.")
    if not before["missing"] and dialect.name == "sqlite":
        raise SchemaUpgradeRequired("Existing SQLite acceptance_criteria is nullable or contains NULL; repair this incomplete schema explicitly before upgrading.")
    table = Table("tasks", MetaData(), Column(
        "acceptance_criteria", JSON, nullable=False, server_default=text("'[]'"),
    ))
    definition = str(CreateColumn(table.c.acceptance_criteria).compile(dialect=dialect))
    table_name = dialect.identifier_preparer.quote(table.name)
    with engine.begin() as connection:
        if before["missing"]:
            connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN {definition}"))
        else:
            connection.execute(table.update().where(table.c.acceptance_criteria.is_(None)).values(acceptance_criteria=[]))
            connection.execute(text(f"ALTER TABLE {table_name} ALTER COLUMN acceptance_criteria SET NOT NULL"))
    return {**verify_schema(engine), "status": "upgraded"}
