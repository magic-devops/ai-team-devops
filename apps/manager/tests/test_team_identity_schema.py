"""Upgrade only explicit scoped identities; never identify people by a label."""

import json

import pytest
from sqlalchemy import create_engine, inspect, text

from sop_manager.schema_upgrade import apply_schema_upgrade, verify_schema


def old_database(tmp_path):
    engine = create_engine("sqlite:///" + (tmp_path / "identity.sqlite").as_posix())
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE tasks (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, title TEXT, assigned_to TEXT, acceptance_criteria JSON NOT NULL DEFAULT '[]')"))
        connection.execute(text("CREATE TABLE delivery_workspaces (project_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, version INTEGER NOT NULL, data JSON NOT NULL)"))
        connection.execute(text("INSERT INTO tasks VALUES ('T-explicit','tenant-a','project-a','Explicit','Same name','[]'), ('T-name','tenant-a','project-a','Name only','Same name','[]'), ('T-dangling','tenant-a','project-a','Unavailable','Lost','[]'), ('T-other','tenant-b','project-b','Other','Other name','[]')"))
        state = {"members": [], "task_owners": {"T-explicit": "user:person-a", "T-dangling": "member-deleted", "T-other": "user:attacker", "T-missing": "user:attacker"}, "executions": [{"id": "old", "snapshot": {"assigned_to": "Original audit name"}}]}
        connection.execute(text("INSERT INTO delivery_workspaces VALUES ('project-a','tenant-a',12,:data)"), {"data": json.dumps(state)})
    return engine


def test_upgrade_moves_only_explicit_scoped_ids_and_removes_obsolete_sources(tmp_path):
    engine = old_database(tmp_path)
    assert verify_schema(engine)["status"] == "upgrade_required"
    result = apply_schema_upgrade(engine)
    assert result["status"] == "upgraded"
    columns = {column["name"]: column for column in inspect(engine).get_columns("tasks")}
    assert columns["owner_id"]["nullable"] is False
    assert "assigned_to" not in columns
    with engine.connect() as connection:
        assert connection.execute(text("SELECT id,owner_id FROM tasks ORDER BY id")).all() == [
            ("T-dangling", "member-deleted"), ("T-explicit", "user:person-a"), ("T-name", ""), ("T-other", ""),
        ]
        version, raw = connection.execute(text("SELECT version,data FROM delivery_workspaces")).one()
        data = json.loads(raw)
        assert version == 13
        assert "task_owners" not in data
        assert data["executions"][0]["snapshot"]["assigned_to"] == "Original audit name"
    assert apply_schema_upgrade(engine)["status"] == "current"
    engine.dispose()


def test_verify_is_read_only_even_with_old_identity_map(tmp_path):
    engine = old_database(tmp_path)
    with engine.connect() as connection:
        before = connection.execute(text("SELECT data,version FROM delivery_workspaces")).all()
    assert verify_schema(engine)["status"] == "upgrade_required"
    with engine.connect() as connection:
        assert connection.execute(text("SELECT data,version FROM delivery_workspaces")).all() == before
    assert "owner_id" not in {column["name"] for column in inspect(engine).get_columns("tasks")}
    engine.dispose()


def test_conflicting_new_and_old_identity_is_rejected_without_partial_ddl(tmp_path):
    engine = old_database(tmp_path)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE tasks ADD COLUMN owner_id VARCHAR(100) NOT NULL DEFAULT ''"))
        connection.execute(text("UPDATE tasks SET owner_id='user:other' WHERE id='T-explicit'"))
    with pytest.raises(RuntimeError, match="conflict"):
        apply_schema_upgrade(engine)
    assert "assigned_to" in {column["name"] for column in inspect(engine).get_columns("tasks")}
    with engine.connect() as connection:
        assert connection.execute(text("SELECT owner_id FROM tasks WHERE id='T-explicit'")).scalar() == "user:other"
        assert connection.execute(text("SELECT version FROM delivery_workspaces")).scalar() == 12
        assert "task_owners" in json.loads(connection.execute(text("SELECT data FROM delivery_workspaces")).scalar())
    engine.dispose()


def test_invalid_explicit_identity_fails_before_any_upgrade_mutation(tmp_path):
    engine = old_database(tmp_path)
    with engine.begin() as connection:
        connection.execute(text("UPDATE delivery_workspaces SET data=:data"), {"data": json.dumps({"task_owners": {"T-explicit": True}})})
    with pytest.raises(RuntimeError, match="owner"):
        apply_schema_upgrade(engine)
    assert "owner_id" not in {column["name"] for column in inspect(engine).get_columns("tasks")}
    engine.dispose()


def test_late_ddl_failure_rolls_back_added_column_owner_copy_and_workspace_version(tmp_path):
    engine = old_database(tmp_path)
    with engine.begin() as connection:
        connection.execute(text("CREATE INDEX task_name_index ON tasks (assigned_to)"))
    from sqlalchemy.exc import OperationalError

    with pytest.raises(OperationalError):
        apply_schema_upgrade(engine)
    columns = {column["name"] for column in inspect(engine).get_columns("tasks")}
    assert "owner_id" not in columns
    assert "assigned_to" in columns
    with engine.connect() as connection:
        assert connection.execute(text("SELECT version FROM delivery_workspaces")).scalar() == 12
        assert "task_owners" in json.loads(connection.execute(text("SELECT data FROM delivery_workspaces")).scalar())
    engine.dispose()
