import os
from pathlib import Path


def test_oceanbase_migration_manifest_has_three_code_indexes():
    from sop_manager.db import oceanbase_migration_plan

    plan = oceanbase_migration_plan()

    assert plan["ok"] is True
    assert plan["target"]["database"] == "oceanbase"
    assert plan["target"]["mode"] == "mysql"
    assert plan["migrations"]
    assert {"tenants", "businesses", "projects", "requirements", "tasks", "issues", "audit_logs"} <= set(plan["core_tables"])

    sql = "\n".join(item["sql"] for item in plan["migrations"]).lower()
    assert "tenant_code" in sql
    assert "business_code" in sql
    assert "project_id" in sql
    assert "idx_requirements_scope_status" in sql
    assert "idx_tasks_scope_status" in sql
    assert "idx_issues_scope_status" in sql
    assert "idx_audit_scope_created" in sql
    assert "serial" not in sql
    assert "jsonb" not in sql


def test_oceanbase_smoke_checks_required_schema_and_backup_restore_checklist():
    from sop_manager.db import oceanbase_migration_smoke

    payload = oceanbase_migration_smoke()

    assert payload["ok"] is True
    check_ids = {item["id"]: item for item in payload["checks"]}
    assert check_ids["migration_files_present"]["ok"] is True
    assert check_ids["scope_columns_present"]["ok"] is True
    assert check_ids["scope_indexes_present"]["ok"] is True
    assert check_ids["sqlite_dev_path_intact"]["ok"] is True
    assert len(payload["backup_restore_checklist"]) >= 6
    assert payload["agent_consumption"]["api"] == "/api/v1/system/ops/storage/migration-smoke"


def test_sqlite_dev_path_remains_under_runtime_dir(monkeypatch, tmp_path):
    from sop_manager.path_config import apply_startup_defaults

    monkeypatch.setenv("PROJECT_PATH", str(tmp_path))
    monkeypatch.delenv("SOP_RUNTIME_DIR", raising=False)
    monkeypatch.setenv("DB_TYPE", "sqlite")
    monkeypatch.setenv("DATABASE_URL", "sqlite:///./sop.db")

    apply_startup_defaults()

    runtime_db = tmp_path / ".sop-runtime" / "db" / "sop.db"
    assert Path(os.environ["DATABASE_URL"].replace("sqlite:///", "")).resolve() == runtime_db.resolve()
    assert (tmp_path / ".sop-runtime" / "db").is_dir()


def test_system_ops_storage_endpoints_expose_plan_and_smoke():
    from sop_manager.routers.sql_models import User
    from sop_manager.routers.system_ops import storage_migration_plan, storage_migration_smoke

    user = User(
        id="u-test",
        tenant_id="default",
        username="admin",
        password_hash="x",
        role="super_admin",
        status="active",
    )

    plan = storage_migration_plan(user)
    smoke = storage_migration_smoke(user)

    assert plan["ok"] is True
    assert "/api/v1/system/ops/storage/migration-smoke" in plan["links"].values()
    assert smoke["ok"] is True
    assert smoke["summary"]["passed"] == smoke["summary"]["total"]
