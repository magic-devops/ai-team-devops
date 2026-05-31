"""Production storage migration contracts.

The runtime still supports SQLite for local development. This module exposes a
small, file-backed migration manifest for OceanBase MySQL mode so OpsCenter,
Settings, CLI/Agent consumers, and docs all read the same production storage
contract.
"""
from __future__ import annotations

import os
import re
from pathlib import Path
from typing import Any

from sop_manager.path_config import runtime_dir

MANAGER_ROOT = Path(__file__).resolve().parents[1]
MIGRATIONS_DIR = MANAGER_ROOT / "migrations"

CORE_TABLES = [
    "tenants",
    "businesses",
    "projects",
    "users",
    "project_members",
    "requirements",
    "tasks",
    "issues",
    "sprints",
    "audit_logs",
    "webhook_configs",
    "api_keys",
]

REQUIRED_SCOPE_COLUMNS = ["tenant_code", "business_code", "project_id"]
REQUIRED_SCOPE_INDEXES = [
    "idx_businesses_tenant_code",
    "idx_projects_scope_status",
    "idx_project_members_scope_role",
    "idx_requirements_scope_status",
    "idx_tasks_scope_status",
    "idx_issues_scope_status",
    "idx_sprints_scope_status",
    "idx_audit_scope_created",
    "idx_webhooks_scope_active",
    "idx_api_keys_scope_status",
]

BACKUP_RESTORE_CHECKLIST = [
    "迁移前确认 OceanBase 集群处于 primary tenant，记录集群版本、zone、副本与字符集。",
    "执行逻辑备份：导出 schema、核心表数据、审计链和 API Key 哈希记录，备份文件写入带日期的不可变目录。",
    "冻结写入窗口：暂停 worker、CDC、IM 入站回调和 Agent 分发，只保留只读查询。",
    "在影子库执行全部 migrations 与 smoke，校验 tenant_code/business_code/project_id 三码索引命中。",
    "恢复演练：从备份恢复到临时库，执行登录、项目列表、任务查询、审计查询和 Agent feed 抽样校验。",
    "切流前记录旧 SQLite 文件路径与 checksum；切流后保留只读回滚窗口，不删除本地开发数据库。",
    "失败回滚：停止生产写入，恢复上一版 DATABASE_URL/DB_TYPE，重启 Manager 与 worker 后执行 smoke。",
]


def _sqlite_dev_url() -> str:
    db_file = runtime_dir() / "db" / "sop.db"
    return "sqlite:///" + db_file.resolve().as_posix()


def _read_migration(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def _migration_files() -> list[Path]:
    if not MIGRATIONS_DIR.is_dir():
        return []
    return sorted(MIGRATIONS_DIR.glob("*.sql"))


def oceanbase_migration_plan() -> dict[str, Any]:
    migrations = []
    for path in _migration_files():
        sql = _read_migration(path)
        migrations.append(
            {
                "id": path.stem,
                "file": str(path),
                "bytes": len(sql.encode("utf-8")),
                "sql": sql,
            }
        )
    return {
        "ok": bool(migrations),
        "target": {
            "database": "oceanbase",
            "mode": "mysql",
            "charset": "utf8mb4",
            "collation": "utf8mb4_bin",
        },
        "current": {
            "db_type": os.getenv("DB_TYPE", "sqlite"),
            "database_url_configured": bool(os.getenv("DATABASE_URL", "")),
            "sqlite_dev_url": _sqlite_dev_url(),
            "sqlite_dev_path": str((runtime_dir() / "db" / "sop.db").resolve()),
        },
        "core_tables": CORE_TABLES,
        "scope_columns": REQUIRED_SCOPE_COLUMNS,
        "scope_indexes": REQUIRED_SCOPE_INDEXES,
        "migrations": migrations,
        "backup_restore_checklist": BACKUP_RESTORE_CHECKLIST,
        "links": {
            "smoke": "/api/v1/system/ops/storage/migration-smoke",
            "docs": "/docs/architecture/HERMES_PLATFORM_LATEST_ARCHITECTURE.md",
        },
        "agent_consumption": {
            "api": "/api/v1/system/ops/storage/migration-plan",
            "safe_for_agents": True,
            "next_actions": ["run_smoke", "prepare_shadow_database", "schedule_backup_restore_drill"],
        },
    }


def _check_table(sql: str, table: str) -> bool:
    return bool(re.search(rf"create\s+table\s+if\s+not\s+exists\s+`?{re.escape(table)}`?\s*\(", sql))


def _check_column(sql: str, column: str) -> bool:
    return bool(re.search(rf"`?{re.escape(column)}`?\s+(varchar|char|text)", sql))


def _check_index(sql: str, index: str) -> bool:
    return bool(re.search(rf"\b(key|unique\s+key|index)\s+`?{re.escape(index)}`?\s*\(", sql))


def oceanbase_migration_smoke() -> dict[str, Any]:
    plan = oceanbase_migration_plan()
    sql = "\n".join(str(item.get("sql") or "") for item in plan.get("migrations", [])).lower()
    checks = [
        {
            "id": "migration_files_present",
            "ok": bool(plan.get("migrations")),
            "message": f"{len(plan.get('migrations', []))} migration files",
        },
        {
            "id": "core_tables_present",
            "ok": all(_check_table(sql, table) for table in CORE_TABLES),
            "message": ",".join(table for table in CORE_TABLES if not _check_table(sql, table)) or "all core tables declared",
        },
        {
            "id": "scope_columns_present",
            "ok": all(_check_column(sql, column) for column in REQUIRED_SCOPE_COLUMNS),
            "message": ",".join(column for column in REQUIRED_SCOPE_COLUMNS if not _check_column(sql, column)) or "tenant_code,business_code,project_id ready",
        },
        {
            "id": "scope_indexes_present",
            "ok": all(_check_index(sql, index) for index in REQUIRED_SCOPE_INDEXES),
            "message": ",".join(index for index in REQUIRED_SCOPE_INDEXES if not _check_index(sql, index)) or "scope indexes ready",
        },
        {
            "id": "oceanbase_mysql_compatible",
            "ok": not any(token in sql for token in (" jsonb", " serial", " generated always as identity", " returning ")),
            "message": "MySQL mode tokens only",
        },
        {
            "id": "sqlite_dev_path_intact",
            "ok": os.getenv("DB_TYPE", "sqlite").lower() != "sqlite" or _sqlite_dev_url().startswith("sqlite:///"),
            "message": _sqlite_dev_url(),
        },
    ]
    passed = sum(1 for item in checks if item["ok"])
    return {
        "ok": passed == len(checks),
        "checks": checks,
        "summary": {"passed": passed, "failed": len(checks) - passed, "total": len(checks)},
        "backup_restore_checklist": BACKUP_RESTORE_CHECKLIST,
        "agent_consumption": {
            "api": "/api/v1/system/ops/storage/migration-smoke",
            "safe_for_agents": True,
            "next_actions": ["fix_failed_checks", "run_shadow_restore", "prepare_cutover_window"],
        },
    }
