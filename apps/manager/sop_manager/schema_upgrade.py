"""Explicit transactional schema revisions; startup never guesses task identities."""

from copy import deepcopy
import json

from sqlalchemy import JSON, Column, MetaData, String, Table, func, inspect, select, text
from sqlalchemy.schema import CreateColumn

SCHEMA_REVISION = "20261017_task_owner_identity"
UPGRADE_COMMAND = "sop-manager schema apply"


class SchemaUpgradeRequired(RuntimeError):
    """A known schema revision requires an explicit offline upgrade."""


def _workspace_rows(connection, inspector):
    if not inspector.has_table("delivery_workspaces"):
        return None, []
    table = Table("delivery_workspaces", MetaData(), autoload_with=connection)
    return table, connection.execute(select(table)).mappings().all()


def _state(value):
    value = json.loads(value) if isinstance(value, str) else value
    if not isinstance(value, dict):
        raise SchemaUpgradeRequired("Invalid delivery workspace data; repair explicitly before upgrading.")
    return value


def verify_schema(engine) -> dict:
    with engine.connect() as connection:
        inspector = inspect(connection)
        exists = inspector.has_table("tasks")
        columns = {column["name"]: column for column in inspector.get_columns("tasks")} if exists else {}
        missing = ["tasks." + name for name in ("acceptance_criteria", "owner_id") if name not in columns]
        nulls = {}
        for name in ("acceptance_criteria", "owner_id"):
            if name in columns:
                table = Table("tasks", MetaData(), Column(name, JSON if name == "acceptance_criteria" else String(100)))
                nulls[name] = connection.execute(select(func.count()).select_from(table).where(table.c[name].is_(None))).scalar_one()
        _, workspaces = _workspace_rows(connection, inspector)
        old_maps = sum("task_owners" in _state(row["data"]) for row in workspaces)
    current = exists and not missing and not old_maps and "assigned_to" not in columns and all(
        not columns[name]["nullable"] and not nulls.get(name) for name in ("acceptance_criteria", "owner_id")
    )
    return {
        "revision": SCHEMA_REVISION,
        "dialect": engine.dialect.name,
        "status": "current" if current else "upgrade_required" if exists else "uninitialized",
        "missing": missing,
        "obsolete": ["tasks.assigned_to"] if "assigned_to" in columns else [],
        "nullable": columns.get("acceptance_criteria", {}).get("nullable"),
        "null_rows": nulls.get("acceptance_criteria", 0),
        "owner_nullable": columns.get("owner_id", {}).get("nullable"),
        "owner_null_rows": nulls.get("owner_id", 0),
        "owner_map_workspaces": old_maps,
    }


def require_current_schema(engine) -> None:
    if verify_schema(engine)["status"] == "upgrade_required":
        raise SchemaUpgradeRequired(
            f"Manager database schema is outdated. Stop Manager and run `{UPGRADE_COMMAND}` "
            "with the same DATABASE_URL before restarting. Only explicit scoped task owner IDs are migrated; names do not identify owners."
        )


def _identity_plan(connection, inspector):
    workspace_table, rows = _workspace_rows(connection, inspector)
    tasks = Table("tasks", MetaData(), autoload_with=connection)
    task_rows = {row["id"]: row for row in connection.execute(select(tasks)).mappings()}
    updates, workspaces = [], []
    for row in rows:
        state = deepcopy(_state(row["data"]))
        if "task_owners" not in state:
            continue
        owners = state.pop("task_owners")
        if not isinstance(owners, dict):
            raise SchemaUpgradeRequired("Invalid task owner map; repair explicitly before upgrading.")
        for task_id, owner_id in owners.items():
            if not isinstance(owner_id, str) or len(owner_id) > 100 or owner_id != owner_id.strip():
                raise SchemaUpgradeRequired("Invalid explicit task owner ID; repair explicitly before upgrading.")
            task = task_rows.get(task_id)
            if not task or task.get("tenant_id") != row["tenant_id"] or task.get("project_id") != row["project_id"]:
                continue
            existing = task.get("owner_id") or ""
            if existing and existing != owner_id:
                raise SchemaUpgradeRequired("Task owner conflict between explicit sources; resolve before upgrading.")
            updates.append((task_id, owner_id, row["tenant_id"], row["project_id"]))
        if type(row["version"]) is not int:
            raise SchemaUpgradeRequired("Invalid workspace version; repair explicitly before upgrading.")
        workspaces.append((row, state))
    return workspace_table, updates, workspaces


def apply_schema_upgrade(engine) -> dict:
    before = verify_schema(engine)
    if before["status"] == "current":
        return before
    if before["status"] == "uninitialized":
        raise SchemaUpgradeRequired("Database is uninitialized; start Manager to create a new schema instead of upgrading.")
    if engine.dialect.name not in {"sqlite", "postgresql"}:
        raise SchemaUpgradeRequired(f"Schema upgrade does not support the {engine.dialect.name} dialect.")
    with engine.begin() as connection:
        # Python sqlite legacy transaction mode otherwise commits ALTER before DML.
        if engine.dialect.name == "sqlite":
            connection.exec_driver_sql("BEGIN IMMEDIATE")
        inspector = inspect(connection)
        columns = {column["name"]: column for column in inspector.get_columns("tasks")}
        if engine.dialect.name == "sqlite" and any(columns.get(name, {}).get("nullable") for name in ("acceptance_criteria", "owner_id")):
            raise SchemaUpgradeRequired("Existing SQLite task identity/acceptance column is nullable; repair this incomplete schema explicitly before upgrading.")
        workspace_table, owner_updates, workspace_updates = _identity_plan(connection, inspector)
        definitions = {
            "acceptance_criteria": Column("acceptance_criteria", JSON, nullable=False, server_default=text("'[]'")),
            "owner_id": Column("owner_id", String(100), nullable=False, server_default=text("''")),
        }
        table = Table("tasks", MetaData(), Column("id", String(64)), Column("tenant_id", String(64)), Column("project_id", String(64)), *definitions.values())
        for name, column in definitions.items():
            if name not in columns:
                definition = str(CreateColumn(column).compile(dialect=engine.dialect))
                connection.execute(text(f"ALTER TABLE tasks ADD COLUMN {definition}"))
            elif columns[name]["nullable"]:
                connection.execute(table.update().where(table.c[name].is_(None)).values({name: [] if name == "acceptance_criteria" else ""}))
                connection.execute(text(f"ALTER TABLE tasks ALTER COLUMN {name} SET NOT NULL"))
        for task_id, owner_id, tenant_id, project_id in owner_updates:
            connection.execute(table.update().where(table.c.id == task_id, table.c.tenant_id == tenant_id, table.c.project_id == project_id).values(owner_id=owner_id))
        for row, state in workspace_updates:
            connection.execute(workspace_table.update().where(workspace_table.c.project_id == row["project_id"], workspace_table.c.tenant_id == row["tenant_id"], workspace_table.c.version == row["version"]).values(data=state, version=row["version"] + 1))
        if "assigned_to" in columns:
            connection.execute(text("ALTER TABLE tasks DROP COLUMN assigned_to"))
    return {
        **verify_schema(engine), "status": "upgraded",
        "owners_migrated": len(owner_updates), "workspaces_migrated": len(workspace_updates),
        "evidence_policy": "prior_unversioned_scope_bases_require_revalidation",
        "historical_evidence_rebound": False,
    }
