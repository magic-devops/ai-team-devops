"""Explicit schema upgrades operate on real old SQLite tables without startup DDL."""

import json
import os
import sqlite3
import subprocess
import sys
from contextlib import contextmanager

import pytest
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import IntegrityError


def command(path, action, tmp_path, database_url=None):
    environment = {**os.environ, "DB_TYPE": "sqlite", "DATABASE_URL": database_url or "sqlite:///" + path.as_posix(),
                   "PROJECT_PATH": str(tmp_path), "SOP_RUNTIME_DIR": str(tmp_path / "runtime"), "PYTHONUTF8": "1"}
    return subprocess.run([sys.executable, "-m", "sop_manager.cli", "schema", action],  # noqa: S603 - fixed module and enum action, owned test database
                          capture_output=True, text=True, env=environment, timeout=30)


def test_schema_verify_does_not_initialize_empty_database(tmp_path):
    path = tmp_path / "new.sqlite"
    result = command(path, "verify", tmp_path)
    assert result.returncode == 2, result.stderr
    receipt = json.loads(result.stdout)
    assert receipt["status"] == "uninitialized"
    if path.exists():
        with sqlite3.connect(path) as db:
            assert db.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall() == []


def test_explicit_schema_upgrade_preserves_old_rows_and_is_idempotent(tmp_path):
    path = tmp_path / "old.sqlite"
    with sqlite3.connect(path) as db:
        db.execute("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, req_id TEXT DEFAULT '')")
        db.execute("INSERT INTO tasks VALUES ('T-existing', 'Original task', '')")
    before = command(path, "verify", tmp_path)
    assert before.returncode == 2, before.stderr
    assert json.loads(before.stdout)["status"] == "upgrade_required"
    with sqlite3.connect(path) as db:
        assert [column[1] for column in db.execute("PRAGMA table_info(tasks)")] == ["id", "title", "req_id"]
    applied = command(path, "apply", tmp_path)
    assert applied.returncode == 0, applied.stderr
    assert json.loads(applied.stdout)["status"] == "upgraded"
    with sqlite3.connect(path) as db:
        assert db.execute("SELECT id,title,req_id,acceptance_criteria FROM tasks").fetchall() == [
            ("T-existing", "Original task", "", "[]"),
        ]
    again = command(path, "apply", tmp_path)
    assert again.returncode == 0, again.stderr
    assert json.loads(again.stdout)["status"] == "current"
    verified = command(path, "verify", tmp_path)
    assert verified.returncode == 0, verified.stderr
    assert json.loads(verified.stdout)["status"] == "current"


def test_application_schema_check_requires_explicit_upgrade_before_any_ddl(tmp_path, monkeypatch):
    from sop_manager.routers import sql_models

    engine = create_engine("sqlite:///" + (tmp_path / "startup.sqlite").as_posix())
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL)"))
        connection.execute(text("INSERT INTO tasks VALUES ('T-old', 'Preserved')"))
    monkeypatch.setattr(sql_models, "engine", engine)
    with pytest.raises(RuntimeError, match="sop-manager schema apply"):
        sql_models.create_all()
    assert inspect(engine).get_table_names() == ["tasks"]
    with engine.connect() as connection:
        assert connection.execute(text("SELECT id,title FROM tasks")).all() == [("T-old", "Preserved")]
    engine.dispose()


def test_new_database_create_all_includes_task_acceptance(tmp_path, monkeypatch):
    from sop_manager.routers import sql_models

    engine = create_engine("sqlite:///" + (tmp_path / "fresh.sqlite").as_posix())
    monkeypatch.setattr(sql_models, "engine", engine)
    sql_models.create_all()
    column = next(column for column in inspect(engine).get_columns("tasks") if column["name"] == "acceptance_criteria")
    assert column["nullable"] is False
    engine.dispose()


def test_upgraded_sqlite_rejects_null_criteria_and_replay_keeps_existing_text(tmp_path):
    from sop_manager.schema_upgrade import apply_schema_upgrade

    engine = create_engine("sqlite:///" + (tmp_path / "constraints.sqlite").as_posix())
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL)"))
    apply_schema_upgrade(engine)
    with pytest.raises(IntegrityError), engine.begin() as connection:
        connection.execute(text("INSERT INTO tasks (id,title,acceptance_criteria) VALUES ('T-null', 'Invalid', NULL)"))
    with engine.begin() as connection:
        connection.execute(text("INSERT INTO tasks (id,title,acceptance_criteria) VALUES ('T-text', 'Valid', '[\"Keep this\"]')"))
    assert apply_schema_upgrade(engine)["status"] == "current"
    with engine.connect() as connection:
        assert connection.execute(text("SELECT acceptance_criteria FROM tasks WHERE id='T-text'")).scalar() == '["Keep this"]'
    engine.dispose()


def test_incomplete_nullable_revision_is_not_current_and_never_overwrites_text(tmp_path):
    from sop_manager.schema_upgrade import apply_schema_upgrade, verify_schema

    engine = create_engine("sqlite:///" + (tmp_path / "incomplete.sqlite").as_posix())
    with engine.begin() as connection:
        connection.execute(text("CREATE TABLE tasks (id TEXT PRIMARY KEY, acceptance_criteria JSON)"))
        connection.execute(text("INSERT INTO tasks VALUES ('T-null', NULL), ('T-text', '[\"Keep this\"]')"))
    assert verify_schema(engine)["status"] == "upgrade_required"
    with pytest.raises(RuntimeError, match="nullable"):
        apply_schema_upgrade(engine)
    with engine.connect() as connection:
        assert connection.execute(text("SELECT id,acceptance_criteria FROM tasks ORDER BY id")).all() == [
            ("T-null", None), ("T-text", '["Keep this"]'),
        ]
    engine.dispose()


def test_mysql_old_schema_upgrade_fails_closed_without_ddl(monkeypatch):
    from types import SimpleNamespace

    from sop_manager import schema_upgrade

    monkeypatch.setattr(schema_upgrade, "verify_schema", lambda engine: {
        "status": "upgrade_required", "missing": ["tasks.acceptance_criteria"],
    })
    engine = SimpleNamespace(dialect=SimpleNamespace(name="mysql"))
    with pytest.raises(RuntimeError, match="mysql"):
        schema_upgrade.apply_schema_upgrade(engine)


def test_schema_cli_does_not_echo_credential_bearing_driver_errors(tmp_path):
    secret = "private-schema-password"  # noqa: S105 - deliberate fixture marker, never a credential
    result = command(tmp_path / "unused.sqlite", "verify", tmp_path, database_url=f"sqlite://user:{secret}@invalid/db")
    assert result.returncode == 1
    assert secret not in result.stdout + result.stderr
    assert json.loads(result.stdout)["status"] == "failed"


def test_health_command_still_loads_application_after_lazy_package_change(monkeypatch):
    import sop_manager
    from sop_manager.cli import main

    def unavailable():
        raise RuntimeError("Database needs schema upgrade")

    monkeypatch.setattr(sop_manager, "get_app", unavailable)
    assert main(["health"]) == 1


@pytest.mark.parametrize("missing", [True, False])
def test_postgresql_upgrade_compiles_transactional_ddl_and_null_only_resume(monkeypatch, missing):
    """Compilation evidence only; this test does not claim a live PostgreSQL server."""
    from sop_manager import schema_upgrade
    from sqlalchemy.dialects import postgresql
    from types import SimpleNamespace

    statements = []
    states = iter([
        {"status": "upgrade_required", "missing": ["tasks.acceptance_criteria"] if missing else []},
        {"status": "current", "missing": []},
    ])
    monkeypatch.setattr(schema_upgrade, "verify_schema", lambda engine: next(states))

    columns = [{"name": "assigned_to", "nullable": True}]
    if not missing:
        columns += [{"name": "acceptance_criteria", "nullable": True}, {"name": "owner_id", "nullable": False}]
    monkeypatch.setattr(schema_upgrade, "inspect", lambda connection: SimpleNamespace(get_columns=lambda name: columns))
    monkeypatch.setattr(schema_upgrade, "_identity_plan", lambda *args: (None, [], []))

    class Compiler:
        dialect = postgresql.dialect()

        @contextmanager
        def begin(self):
            yield self

        def execute(self, statement):
            compiled = statement.compile(dialect=self.dialect)
            statements.append((str(compiled), compiled.params))

    assert schema_upgrade.apply_schema_upgrade(Compiler())["status"] == "upgraded"
    if missing:
        assert statements == [("ALTER TABLE tasks ADD COLUMN acceptance_criteria JSON DEFAULT '[]' NOT NULL", {}),
                              ("ALTER TABLE tasks ADD COLUMN owner_id VARCHAR(100) DEFAULT '' NOT NULL", {}),
                              ("ALTER TABLE tasks DROP COLUMN assigned_to", {})]
    else:
        assert statements == [
            ("UPDATE tasks SET acceptance_criteria=%(acceptance_criteria)s::JSON WHERE tasks.acceptance_criteria IS NULL", {"acceptance_criteria": []}),
            ("ALTER TABLE tasks ALTER COLUMN acceptance_criteria SET NOT NULL", {}),
            ("ALTER TABLE tasks DROP COLUMN assigned_to", {}),
        ]
