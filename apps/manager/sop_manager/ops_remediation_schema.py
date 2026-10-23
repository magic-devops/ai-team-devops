"""Explicit offline source identity upgrade; no source or Issue is rebound."""
from sqlalchemy import MetaData, Table, inspect, literal, select, text
from sqlalchemy.orm import declarative_base

from .routers.ops_remediation_model import register_ops_source_model

TABLE = "ops_issue_sources"
NEXT_TABLE = "ops_issue_sources_next"
SOURCE_UNIQUE = {"tenant_id", "project_id", "source_type", "source_id"}


def inspect_ops_source_schema(connection, inspector=None):
    inspector = inspector or inspect(connection)
    if not inspector.has_table(TABLE):
        return {"exists": False, "upgrade_required": inspector.has_table(NEXT_TABLE)}
    columns = {item["name"]: item for item in inspector.get_columns(TABLE)}
    canonical = register_ops_source_model(declarative_base()).__table__
    expected = {column.name: column for column in canonical.columns}
    complete = set(columns) == set(expected)
    if complete:
        for name, column in expected.items():
            actual = columns[name]
            expected_length, actual_length = getattr(column.type, "length", None), getattr(actual["type"], "length", None)
            if actual["nullable"] or not isinstance(actual["type"], type(column.type)) or (
                expected_length is not None and actual_length is not None and actual_length < expected_length
            ):
                complete = False
                break
    unique_sets = {frozenset(item["column_names"]) for item in inspector.get_unique_constraints(TABLE)}
    indexes = inspector.get_indexes(TABLE)
    issue_index = any(item["column_names"] == ["tenant_id", "project_id", "issue_id"] and not item.get("unique") for item in indexes)
    unexpected_unique_index = any(item.get("unique") and set(item["column_names"]) not in (SOURCE_UNIQUE, {"id"}) for item in indexes)
    current = (complete and inspector.get_pk_constraint(TABLE).get("constrained_columns") == ["id"]
               and unique_sets == {frozenset(SOURCE_UNIQUE)} and issue_index and not unexpected_unique_index
               and not inspector.get_foreign_keys(TABLE) and not inspector.has_table(NEXT_TABLE))
    return {"exists": True, "upgrade_required": not current}


def upgrade_ops_source_schema(connection):
    inspector = inspect(connection)
    state = inspect_ops_source_schema(connection, inspector)
    if not state["upgrade_required"]:
        return False
    from .schema_upgrade import SchemaUpgradeRequired

    if inspector.has_table(NEXT_TABLE) or not state["exists"]:
        raise SchemaUpgradeRequired("Incomplete operational source schema; repair explicitly without discarding fixed sources.")
    columns = {item["name"] for item in inspector.get_columns(TABLE)}
    if "source_type" in columns:
        raise SchemaUpgradeRequired("Incomplete operational source schema; repair explicitly without discarding fixed sources.")
    canonical = register_ops_source_model(declarative_base()).__table__
    if columns != {column.name for column in canonical.columns} - {"source_type"}:
        raise SchemaUpgradeRequired("Unknown operational source schema; inspect it before upgrading.")
    original = Table(TABLE, MetaData(), autoload_with=connection)
    destination = canonical.to_metadata(MetaData(), name=NEXT_TABLE)
    # Keep the existing index until the old table is removed in this transaction.
    destination.indexes.clear()
    destination.create(connection)
    connection.execute(destination.insert().from_select(
        [column.name for column in destination.columns],
        select(*[literal("self_heal") if column.name == "source_type" else original.c[column.name]
                 for column in destination.columns]),
    ))
    original.drop(connection)
    connection.execute(text("ALTER TABLE ops_issue_sources_next RENAME TO ops_issue_sources"))
    for index in canonical.indexes:
        index.create(connection)
    return True
