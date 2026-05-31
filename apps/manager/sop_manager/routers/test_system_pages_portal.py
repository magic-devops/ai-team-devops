import json

from sop_manager.routers.sql_models import User
from sop_manager.routers import system_pages as system_pages_module
from sop_manager.routers.system_pages import (
    ExperienceTaskIn,
    IsolationScanRunIn,
    IsolationScanCompareTaskIn,
    IsolationScanTaskIn,
    IsolationTaskIn,
    GovernanceTaskBulkUpdateIn,
    ReadinessTaskIn,
    system_page_menu_health,
    system_page_capabilities,
    system_pages_isolation_audit,
    system_pages_isolation_scan,
    system_pages_isolation_scan_runs,
    system_pages_isolation_scan_run_compare,
    system_page_isolation_scan_compare_tasks,
    system_page_isolation_scan_run_create,
    system_page_isolation_scan_tasks,
    system_page_isolation_tasks,
    system_pages_governance_tasks,
    system_pages_governance_tasks_bulk_update,
    system_page_registry_validate,
    system_page_experience_tasks,
    system_pages_experience_review,
    system_pages_hub,
    system_pages_production_readiness,
    system_pages_readiness,
    system_page_readiness_tasks,
)


MICRO_APP_PAGE_IDS = {
    "microAppMainAdmin",
    "microAppAiFoundation",
    "microAppAiRdCenter",
    "microAppAiDataCenter",
    "microAppAiOpsCenter",
    "microAppGovernance",
}


def test_system_pages_hub_exposes_portal_management_contract():
    user = User(
        id="u-test",
        tenant_id="default",
        username="admin",
        password_hash="x",
        role="super_admin",
        status="active",
    )

    payload = system_pages_hub(user)

    assert payload["ok"] is True
    assert payload["portal"]["name"] == "门户管理"
    assert payload["portal"]["mode"] == "portal_control_plane"
    assert "微应用注册" in payload["portal"]["capabilities"]
    assert payload["identity"]["username"] == "admin"
    assert payload["identity"]["role"] == "super_admin"
    assert payload["contracts"]["menu"]["nav_items"] > 0
    assert payload["contracts"]["permission"]["visible"] > 0
    assert payload["readiness"]["score"] >= 80
    assert len(payload["micro_apps"]) >= 5
    assert {item["id"] for item in payload["governance_actions"]} >= {
        "menu-contract",
        "permission-matrix",
        "micro-app-registry",
    }


def test_system_pages_readiness_exposes_full_module_completion_matrix():
    payload = system_pages_readiness()

    assert payload["ok"] is True
    assert payload["summary"]["total"] > 20
    assert 0 <= payload["summary"]["avg_score"] <= 100
    assert payload["summary"]["complete"] + payload["summary"]["watch"] + payload["summary"]["risk"] == payload["summary"]["total"]
    assert payload["domain_summary"]
    assert payload["agent_consumption"]["api"] == "/api/v1/system/pages/readiness"

    first = payload["items"][0]
    assert {
        "id",
        "name",
        "domain",
        "path",
        "readiness_score",
        "status",
        "dimensions",
        "gaps",
        "next_actions",
        "implementation_contract",
    } <= set(first)
    assert {"frontend", "backend", "ai", "governance", "product"} <= set(first["dimensions"])
    assert {"route", "api_count", "capability", "ai_surfaces"} <= set(first["implementation_contract"])


def test_system_pages_production_readiness_splits_contract_runtime_and_production_stages():
    payload = system_pages_production_readiness()

    assert payload["ok"] is True
    assert payload["summary"]["total"] > 20
    assert 0 <= payload["summary"]["avg_production_score"] <= 100
    assert payload["summary"]["contract_complete"] >= payload["summary"]["production_ready"]
    assert payload["agent_consumption"]["api"] == "/api/v1/system/pages/production-readiness"

    first = payload["items"][0]
    assert {
        "id",
        "name",
        "domain",
        "contract_complete",
        "runtime_ready",
        "production_ready",
        "stage",
        "production_score",
        "dimensions",
        "recommendations",
        "implementation_contract",
    } <= set(first)
    assert {
        "runtime_data",
        "external_connections",
        "async_worker",
        "test_coverage",
        "deployment_evidence",
        "observability",
        "permission_policy",
    } <= set(first["dimensions"])


def test_system_pages_experience_review_scores_menu_ux_permissions_and_ai_editability():
    payload = system_pages_experience_review()

    assert payload["ok"] is True
    assert payload["summary"]["total"] > 20
    assert 0 <= payload["summary"]["avg_experience_score"] <= 100
    assert payload["summary"]["simple"] + payload["summary"]["watch"] + payload["summary"]["complex"] == payload["summary"]["total"]
    assert payload["summary"]["needs_simplification"] == payload["summary"]["watch"] + payload["summary"]["complex"]
    assert payload["agent_consumption"]["api"] == "/api/v1/system/pages/experience-review"

    first = payload["items"][0]
    assert {
        "id",
        "name",
        "domain",
        "status",
        "experience_score",
        "dimensions",
        "recommendations",
        "ui_contract",
        "implementation_contract",
    } <= set(first)
    assert {
        "simplicity",
        "responsive",
        "componentization",
        "permission",
        "ai_editability",
        "commercialization",
    } <= set(first["dimensions"])
    assert "mobile_rule" in first["ui_contract"]
    assert "permission_rule" in first["ui_contract"]


def test_system_pages_experience_review_filters_domain_status_and_keyword():
    payload = system_pages_experience_review(domain="governance", status="all", q="治理")

    assert payload["ok"] is True
    assert payload["filters"] == {"domain": "governance", "status": "all", "q": "治理"}
    for item in payload["items"]:
        assert item["domain"] == "governance"
        assert "治理" in f"{item['id']} {item['name']} {' '.join(item.get('recommendations', []))}"


def test_system_pages_experience_tasks_preview_modules_for_ui_simplification():
    result = system_page_experience_tasks(
        ExperienceTaskIn(
            dry_run=True,
            domain="all",
            status="all",
            q="",
            include_simple=False,
            max_items=3,
            priority="P1",
            assigned_to="Designer",
        )
    )

    assert result["ok"] is True
    assert result["dry_run"] is True
    assert result["summary"]["planned"] > 0
    assert result["summary"]["created"] == 0
    first = result["planned"][0]
    assert first["source"] == "system_page_experience"
    assert first["priority"] == "P1"
    assert first["assigned_to"] == "Designer"
    assert first["source_report_id"].startswith("experience:")
    assert "experience_score" in first["description"]
    assert "ui_contract" in first["description"]


def test_system_pages_experience_tasks_apply_is_idempotent(monkeypatch):
    created: list[dict] = []

    def fake_list_tasks(**filters):
        source = filters.get("source")
        rows = created if source == "system_page_experience" else []
        return rows

    def fake_create_task(body):
        row = body.model_dump()
        row["id"] = f"T-exp-{len(created) + 1}"
        row["status"] = "pending"
        created.append(row)
        return row

    monkeypatch.setattr(system_pages_module, "list_tasks", fake_list_tasks)
    monkeypatch.setattr(system_pages_module, "create_task", fake_create_task)

    body = ExperienceTaskIn(dry_run=False, status="all", include_simple=False, max_items=2)
    first = system_page_experience_tasks(body)
    second = system_page_experience_tasks(body)

    assert first["summary"]["created"] == first["summary"]["planned"]
    assert first["summary"]["created"] > 0
    assert second["summary"]["created"] == 0
    assert second["summary"]["planned"] == 0
    assert second["summary"]["skipped"] == first["summary"]["created"]
    assert len(created) == first["summary"]["created"]


def test_system_pages_production_readiness_filters_stage_domain_and_keyword():
    payload = system_pages_production_readiness(domain="data", stage="all", q="数据")

    assert payload["ok"] is True
    assert payload["filters"] == {"domain": "data", "stage": "all", "q": "数据"}
    for item in payload["items"]:
        assert item["domain"] == "data"
        assert "数据" in f"{item['id']} {item['name']} {' '.join(item.get('recommendations', []))}"


def test_system_pages_readiness_filters_domain_status_and_keyword():
    payload = system_pages_readiness(domain="ecosystem", status="watch", q="Agent")

    assert payload["ok"] is True
    assert payload["filters"] == {"domain": "ecosystem", "status": "watch", "q": "Agent"}
    for item in payload["items"]:
        assert item["domain"] == "ecosystem"
        assert item["status"] == "watch"
        assert "agent" in f"{item['id']} {item['name']} {' '.join(item.get('capabilities', []))}".lower()


def test_system_pages_readiness_tasks_preview_modules_for_continuous_enhancement():
    result = system_page_readiness_tasks(
        ReadinessTaskIn(
            dry_run=True,
            domain="ecosystem",
            status="all",
            q="Agent",
            include_complete=True,
            max_items=3,
            priority="P2",
            assigned_to="Coder",
        )
    )

    assert result["ok"] is True
    assert result["dry_run"] is True
    assert result["summary"]["planned"] > 0
    assert result["summary"]["created"] == 0
    first = result["planned"][0]
    assert first["source"] == "system_page_readiness"
    assert first["priority"] == "P2"
    assert first["assigned_to"] == "Coder"
    assert first["source_report_id"].startswith("readiness:")
    assert "readiness_score" in first["description"]
    assert "implementation_contract" in first["description"]


def test_micro_app_pages_are_registered_in_navigation_contract():
    validation = system_page_registry_validate()["validation"]

    assert not MICRO_APP_PAGE_IDS & set(validation["missing_nav"])

    health = system_page_menu_health()["health"]
    missing_nav = [issue for issue in health["issues"] if issue["category"] == "missing_nav"]
    assert missing_nav == []

    readiness = system_pages_readiness()
    watch_ids = {item["id"] for item in readiness["items"] if item["status"] == "watch"}
    assert not MICRO_APP_PAGE_IDS & watch_ids


def test_menu_health_has_no_submodule_i18n_gap():
    health = system_page_menu_health()["health"]

    assert health["summary"]["categories"].get("missing_sub_i18n", 0) == 0
    assert [issue for issue in health["issues"] if issue["category"] == "missing_sub_i18n"] == []


def test_menu_health_has_no_top_level_i18n_gap():
    health = system_page_menu_health()["health"]

    assert health["summary"]["categories"].get("missing_i18n", 0) == 0
    assert [issue for issue in health["issues"] if issue["category"] == "missing_i18n"] == []


def test_system_map_menu_groups_security_governance_units():
    payload = system_page_capabilities()
    system_map = next(item for item in payload["items"] if item["id"] == "systemMap")
    submodules = {item["id"]: item for item in system_map["submodules"]}

    assert {
        "registry",
        "manifest",
        "capabilities",
        "readiness",
        "three_code_isolation",
        "source_scan",
        "baseline_compare",
        "governance_tasks",
        "actions",
        "migration",
    } <= set(submodules)
    assert submodules["readiness"]["name"] == "模块完整度"
    assert submodules["three_code_isolation"]["path"] == "#/system-map/three-code-isolation"
    assert submodules["source_scan"]["name"] == "源码隔离扫描"
    assert submodules["baseline_compare"]["name"] == "智能基线对比"
    assert submodules["baseline_compare"]["path"] == "#/system-map/baseline-compare"
    assert submodules["governance_tasks"]["path"] == "#/system-map/governance-tasks"
    assert submodules["manifest"]["parent_id"] == "contract"
    assert submodules["capabilities"]["navigation_role"] == "contract_tab"
    assert submodules["actions"]["parent_id"] == "contract"


def test_system_pages_governance_tasks_aggregates_real_generated_tasks(monkeypatch):
    sample_tasks = [
        {
            "id": "T-readiness",
            "title": "补齐模块完整度",
            "description": "readiness_score=72",
            "status": "pending",
            "priority": "P1",
            "assigned_to": "Coder",
            "source": "system_page_readiness",
            "source_report_id": "readiness:systemMap",
            "source_report_title": "模块治理",
            "created_at": "2026-05-24T00:00:00Z",
            "updated_at": "2026-05-24T00:00:00Z",
        },
        {
            "id": "T-compare",
            "title": "修复源码隔离基线回退",
            "description": "before=protected after=risk",
            "status": "in_progress",
            "priority": "P0",
            "assigned_to": "SecurityAgent",
            "source": "system_page_isolation_scan_compare",
            "source_report_id": "isolation_scan_compare:auth:regressed",
            "source_report_title": "sop_manager/routers/auth.py",
            "created_at": "2026-05-24T00:01:00Z",
            "updated_at": "2026-05-24T00:01:00Z",
        },
        {
            "id": "T-backlog",
            "title": "Legacy 收敛",
            "description": "legacy target",
            "status": "completed",
            "priority": "P2",
            "assigned_to": "Coder",
            "source": "system_page_backlog",
            "source_report_id": "legacy:console",
            "source_report_title": "Legacy Console",
            "created_at": "2026-05-24T00:02:00Z",
            "updated_at": "2026-05-24T00:02:00Z",
        },
        {
            "id": "T-normal",
            "title": "普通任务不进入模块治理",
            "status": "pending",
            "priority": "P3",
            "source": "",
        },
    ]

    monkeypatch.setattr(system_pages_module, "list_tasks", lambda **_: sample_tasks)

    payload = system_pages_governance_tasks(status="all", source="all", q="", limit=10)

    assert payload["ok"] is True
    assert payload["summary"]["total"] == 3
    assert payload["summary"]["open"] == 2
    assert payload["summary"]["completed"] == 1
    assert payload["summary"]["by_source"]["system_page_readiness"] == 1
    assert payload["summary"]["by_source"]["system_page_isolation_scan_compare"] == 1
    assert payload["summary"]["by_priority"]["P0"] == 1
    assert payload["summary"]["bulk_actions"]["statuses"] == ["pending", "in_progress", "blocked", "completed"]
    assert payload["summary"]["bulk_actions"]["priorities"] == ["P0", "P1", "P2", "P3"]
    first = payload["items"][0]
    assert first["id"] == "T-compare"
    assert first["source_label"] == "智能基线对比"
    assert first["source_route"] == "#/system-map/baseline-compare"
    assert first["task_url"].startswith("#/tasks?")
    assert payload["lanes"][0]["source"] == "system_page_experience"
    assert any(lane["source"] == "system_page_readiness" for lane in payload["lanes"])
    assert payload["agent_consumption"]["api"] == "/api/v1/system/pages/governance-tasks"
    assert payload["agent_consumption"]["cli"] == "sop pages governance-tasks --json"


def test_system_pages_governance_tasks_filters_source_status_and_keyword(monkeypatch):
    monkeypatch.setattr(
        system_pages_module,
        "list_tasks",
        lambda **_: [
            {
                "id": "T-readiness",
                "title": "模块完整度治理",
                "description": "readiness_score=72",
                "status": "pending",
                "priority": "P1",
                "assigned_to": "Coder",
                "source": "system_page_readiness",
                "source_report_id": "readiness:systemMap",
                "source_report_title": "模块治理",
            },
            {
                "id": "T-scan",
                "title": "源码隔离扫描治理",
                "description": "scope guard",
                "status": "pending",
                "priority": "P0",
                "assigned_to": "SecurityAgent",
                "source": "system_page_isolation_scan",
                "source_report_id": "isolation_scan:auth",
                "source_report_title": "auth.py",
            },
        ],
    )

    payload = system_pages_governance_tasks(status="pending", source="system_page_readiness", q="完整度", limit=5)

    assert payload["ok"] is True
    assert payload["filters"] == {
        "status": "pending",
        "source": "system_page_readiness",
        "q": "完整度",
        "limit": 5,
    }
    assert [item["id"] for item in payload["items"]] == ["T-readiness"]
    assert payload["summary"]["source_options"][0]["value"] == "all"


def test_system_pages_governance_tasks_bulk_update_scopes_to_generated_tasks(monkeypatch):
    sample_tasks = [
        {
            "id": "T-readiness",
            "title": "模块完整度治理",
            "status": "pending",
            "priority": "P1",
            "assigned_to": "Coder",
            "source": "system_page_readiness",
            "source_report_id": "readiness:systemMap",
        },
        {
            "id": "T-normal",
            "title": "普通任务",
            "status": "pending",
            "priority": "P3",
            "assigned_to": "Coder",
            "source": "",
        },
    ]
    calls: list[object] = []

    monkeypatch.setattr(system_pages_module, "list_tasks", lambda **_: sample_tasks)
    monkeypatch.setattr(system_pages_module, "bulk_update_tasks", lambda body: calls.append(body) or {"ok": True})

    preview = system_pages_governance_tasks_bulk_update(
        GovernanceTaskBulkUpdateIn(
            ids=["T-readiness", "T-normal", "T-missing"],
            dry_run=True,
            status="blocked",
            priority="P0",
            assigned_to="OpsAgent",
        )
    )

    assert preview["ok"] is True
    assert preview["dry_run"] is True
    assert preview["summary"] == {"planned": 1, "updated": 0, "skipped": 2}
    assert preview["planned"][0]["id"] == "T-readiness"
    assert preview["planned"][0]["patch"] == {"status": "blocked", "priority": "P0", "assigned_to": "OpsAgent"}
    assert preview["agent_consumption"]["cli"] == "sop pages governance-tasks-update --ids T-readiness,T-normal,T-missing --dry-run --status blocked --priority P0 --assigned-to OpsAgent --json"
    assert preview["agent_consumption"]["allowed_statuses"] == ["pending", "in_progress", "blocked", "completed"]
    assert {item["id"]: item["reason"] for item in preview["skipped"]} == {
        "T-normal": "not_governance_task",
        "T-missing": "not_found",
    }
    assert calls == []

    applied = system_pages_governance_tasks_bulk_update(
        GovernanceTaskBulkUpdateIn(ids=["T-readiness"], dry_run=False, status="completed")
    )

    assert applied["ok"] is True
    assert applied["dry_run"] is False
    assert applied["summary"] == {"planned": 1, "updated": 1, "skipped": 0}
    assert calls
    assert calls[0].ids == ["T-readiness"]
    assert calls[0].status == "completed"
    assert applied["agent_consumption"]["api"] == "/api/v1/system/pages/governance-tasks/bulk-update"


def test_system_pages_isolation_audit_exposes_three_code_guard_coverage():
    payload = system_pages_isolation_audit()

    assert payload["ok"] is True
    assert payload["summary"]["score"] >= 90
    assert payload["summary"]["high_risk"] == 0
    assert {"analytics_reports", "notify_messages", "agent_runs", "ops_records", "data_governance_records", "usage_and_billing_ledgers"} <= {item["id"] for item in payload["domains"]}
    for item in payload["domains"]:
        assert {"tenant_code", "business_code", "project_id"} <= set(item["scope_fields"])
        assert item["read_protected"] is True
        assert item["write_protected"] is True
    assert payload["agent_consumption"]["api"] == "/api/v1/system/pages/isolation-audit"
    assert payload["watch"] == []


def test_system_pages_isolation_tasks_preview_core_domains_for_continuous_audit():
    result = system_page_isolation_tasks(
        IsolationTaskIn(
            dry_run=True,
            status="all",
            ids=["analytics_reports"],
            include_protected=True,
            max_items=3,
            priority="P0",
            assigned_to="SecurityAgent",
        )
    )

    assert result["ok"] is True
    assert result["dry_run"] is True
    assert result["summary"]["planned"] == 1
    assert result["summary"]["created"] == 0
    first = result["planned"][0]
    assert first["source"] == "system_page_isolation"
    assert first["priority"] == "P0"
    assert first["assigned_to"] == "SecurityAgent"
    assert first["source_report_id"] == "isolation:analytics_reports"
    assert "scope_contract" in first["description"]
    assert "tenant_code" in first["description"]
    assert "scope_guard" in first["description"]
    assert "test_analytics_reports_do_not_cross_business_scope" in first["description"]


def test_system_pages_isolation_scan_discovers_source_level_scope_guards():
    payload = system_pages_isolation_scan(q="notify")

    assert payload["ok"] is True
    assert payload["summary"]["scanned_files"] > 0
    assert payload["summary"]["total"] > 0
    assert payload["agent_consumption"]["api"] == "/api/v1/system/pages/isolation-audit/scan"
    assert payload["agent_consumption"]["cli"] == "sop pages isolation-scan --json"

    first = payload["items"][0]
    assert {
        "id",
        "module",
        "file",
        "storage",
        "status",
        "risk_level",
        "scope_guard",
        "signals",
        "missing",
        "recommendation",
    } <= set(first)
    assert "notify" in first["module"]
    assert first["scope_guard"]["attach_scope"] is True
    assert first["scope_guard"]["scope_matches"] is True
    assert first["status"] == "protected"
    assert "tenant_code" in first["signals"]["scope_fields"]


def test_system_pages_isolation_scan_tasks_preview_source_findings_for_security_agent():
    result = system_page_isolation_scan_tasks(
        IsolationScanTaskIn(
            dry_run=True,
            status="all",
            q="notify",
            include_protected=True,
            max_items=2,
            priority="P0",
            assigned_to="SecurityAgent",
        )
    )

    assert result["ok"] is True
    assert result["dry_run"] is True
    assert result["summary"]["planned"] == 1
    assert result["summary"]["created"] == 0
    first = result["planned"][0]
    assert first["source"] == "system_page_isolation_scan"
    assert first["priority"] == "P0"
    assert first["assigned_to"] == "SecurityAgent"
    assert first["source_report_id"] == "isolation_scan:notify"
    assert "sop_manager/routers/notify.py" in first["description"]
    assert "scope_guard" in first["description"]
    assert "recommendation" in first["description"]


def test_system_pages_isolation_scan_runs_persist_snapshot_history(monkeypatch, tmp_path):
    monkeypatch.setattr(system_pages_module, "_isolation_scan_runs_file", lambda: tmp_path / "isolation_scan_runs.jsonl")

    created = system_page_isolation_scan_run_create(
        IsolationScanRunIn(
            status="all",
            q="notify",
            note="nightly baseline",
            max_items=5,
            created_by="SecurityAgent",
        )
    )

    assert created["ok"] is True
    assert created["run"]["filters"] == {"q": "notify", "status": "all"}
    assert created["run"]["summary"]["total"] == 1
    assert created["run"]["findings"][0]["module"] == "notify"
    assert created["agent_consumption"]["api"] == "/api/v1/system/pages/isolation-audit/scan/runs"

    history = system_pages_isolation_scan_runs(limit=5)
    assert history["ok"] is True
    assert history["summary"]["total"] == 1
    assert history["items"][0]["id"] == created["run"]["id"]
    assert history["items"][0]["created_by"] == "SecurityAgent"
    assert history["items"][0]["note"] == "nightly baseline"


def test_system_pages_isolation_scan_compare_detects_resolved_risk(monkeypatch, tmp_path):
    runs_file = tmp_path / "isolation_scan_runs.jsonl"
    monkeypatch.setattr(system_pages_module, "_isolation_scan_runs_file", lambda: runs_file)
    runs_file.write_text(
        json.dumps(
            {
                "id": "baseline-risk",
                "created_at": "2026-05-22T00:00:00Z",
                "created_by": "SecurityAgent",
                "note": "risk baseline",
                "filters": {"q": "notify", "status": "all"},
                "summary": {"score": 0, "total": 1, "protected": 0, "watch": 0, "risk": 1},
                "findings": [
                    {
                        "id": "source:notify",
                        "module": "notify",
                        "file": "sop_manager/routers/notify.py",
                        "status": "risk",
                        "risk_level": "high",
                        "recommendation": "补齐 scope_guard",
                    }
                ],
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    compare = system_pages_isolation_scan_run_compare(base_id="baseline-risk", q="notify", status="all")

    assert compare["ok"] is True
    assert compare["base"]["id"] == "baseline-risk"
    assert compare["target"]["mode"] == "current_scan"
    assert compare["summary"]["resolved"] == 1
    assert compare["summary"]["new_risks"] == 0
    assert compare["summary"]["score_delta"] == 100
    assert compare["items"][0]["change"] == "resolved"
    assert compare["items"][0]["module"] == "notify"
    assert compare["recommendations"][0]["kind"] == "keep_protected"
    assert compare["agent_consumption"]["api"] == "/api/v1/system/pages/isolation-audit/scan/runs/compare"


def test_system_pages_isolation_scan_compare_tasks_plan_regressions(monkeypatch, tmp_path):
    runs_file = tmp_path / "isolation_scan_runs.jsonl"
    monkeypatch.setattr(system_pages_module, "_isolation_scan_runs_file", lambda: runs_file)
    runs_file.write_text(
        json.dumps(
            {
                "id": "baseline-protected-auth",
                "created_at": "2026-05-22T00:00:00Z",
                "created_by": "SecurityAgent",
                "note": "protected baseline",
                "filters": {"q": "auth", "status": "all"},
                "summary": {"score": 100, "total": 1, "protected": 1, "watch": 0, "risk": 0},
                "findings": [
                    {
                        "id": "source:auth",
                        "module": "auth",
                        "file": "sop_manager/routers/auth.py",
                        "status": "protected",
                        "risk_level": "low",
                        "recommendation": "已检测到 attach_scope + scope_matches，可纳入持续回归扫描。",
                    }
                ],
            },
            ensure_ascii=False,
        )
        + "\n",
        encoding="utf-8",
    )

    result = system_page_isolation_scan_compare_tasks(
        IsolationScanCompareTaskIn(
            base_id="baseline-protected-auth",
            q="auth",
            status="all",
            dry_run=True,
            max_items=5,
            assigned_to="SecurityAgent",
        )
    )

    assert result["ok"] is True
    assert result["dry_run"] is True
    assert result["summary"]["planned"] >= 1
    assert result["summary"]["created"] == 0
    first = result["planned"][0]
    assert first["source"] == "system_page_isolation_scan_compare"
    assert first["priority"] == "P0"
    assert first["assigned_to"] == "SecurityAgent"
    assert first["source_report_id"].startswith("isolation_scan_compare:")
    assert "before=" in first["description"]
    assert "after=" in first["description"]
    assert result["agent_consumption"]["api"] == "/api/v1/system/pages/isolation-audit/scan/runs/compare/tasks"


def test_system_pages_agent_runs_contract_exposes_retry_lifecycle():
    payload = system_pages_readiness(q="Agent 运行中心")

    agent_runs = next(item for item in payload["items"] if item["id"] == "agentRuns")
    apis = set(agent_runs["implementation_contract"]["apis"])
    assert "/api/v1/agent-runs/{id}/retry" in apis
    assert "/api/v1/agent-runs/{id}/cancel" in apis
    assert "失败重试" in agent_runs["capabilities"]


def test_system_pages_a2a_contract_exposes_agent_run_traceability():
    payload = system_pages_readiness(q="A2A")

    a2a = next(item for item in payload["items"] if item["id"] == "a2aGateway")
    apis = set(a2a["implementation_contract"]["apis"])
    assert "/api/v1/a2a/dispatch/{id}/packet" in apis
    assert "/api/v1/a2a/dispatch/{id}/retry" in apis
    assert "/api/v1/a2a/dispatch/{id}/reassign" in apis
    assert "/api/v1/a2a/sessions" in apis
    assert "/api/v1/a2a/sessions/{id}" in apis
    assert "/api/v1/a2a/sla" in apis
    assert "/api/v1/a2a/sla/tasks" in apis
    assert "/api/v1/a2a/sla/policy" in apis
    assert "/api/v1/a2a/sla/escalations" in apis
    assert "/api/v1/a2a/execution-windows" in apis
    assert "/api/v1/a2a/execution-windows/policy" in apis
    assert "/api/v1/a2a/execution-windows/tasks" in apis
    assert "/api/v1/a2a/execution-windows/actions" in apis
    assert "/api/v1/a2a/trust" in apis
    assert "/api/v1/a2a/registry/{id}/heartbeat" in apis
    assert "/api/v1/a2a/registry/{id}/credentials/rotate" in apis
    assert "/api/v1/a2a/registry/{id}/tasks/pull" in apis
    assert "/api/v1/a2a/registry/{id}/tasks/ack" in apis
    assert "/api/v1/a2a/registry/{id}/tasks/renew" in apis
    assert "/api/v1/a2a/leases/expire" in apis
    assert "/api/v1/a2a/registry/{id}/progress" in apis
    assert "/api/v1/a2a/trust/policy" in apis
    assert "/api/v1/a2a/trust/tasks" in apis
    assert "/api/v1/agent-runs" in apis
    assert "Agent Run 关联" in a2a["capabilities"]
    assert "失败分发重试" in a2a["capabilities"]
    assert "执行窗口自动动作" in a2a["capabilities"]
    assert "协商会话历史" in a2a["capabilities"]
    assert "外部 Agent SLA" in a2a["capabilities"]
    assert "SLA 策略配置" in a2a["capabilities"]
    assert "SLA 自动升级动作" in a2a["capabilities"]
    assert "外部 Agent 凭证" in a2a["capabilities"]
    assert "双向心跳" in a2a["capabilities"]
    assert "跨组织信任策略" in a2a["capabilities"]
    assert "信任治理任务" in a2a["capabilities"]
    assert "双向任务拉取" in a2a["capabilities"]
    assert "任务租约确认" in a2a["capabilities"]
    assert "任务租约续期" in a2a["capabilities"]
    assert "租约过期回收" in a2a["capabilities"]
    assert "拒绝任务重派" in a2a["capabilities"]
    assert "执行窗口审计" in a2a["capabilities"]
    assert "执行窗口任务化" in a2a["capabilities"]
    assert "执行窗口策略配置" in a2a["capabilities"]
    assert "执行窗口动作阻断解释" in a2a["capabilities"]
    assert "进度回写" in a2a["capabilities"]


def test_system_pages_a2a_focused_routes_expose_operational_submodules():
    payload = system_page_capabilities()
    registry = next(item for item in payload["items"] if item["id"] == "a2aRegistry")
    dispatch = next(item for item in payload["items"] if item["id"] == "a2aDispatch")

    registry_submodules = {item["id"]: item for item in registry["submodules"]}
    dispatch_submodules = {item["id"]: item for item in dispatch["submodules"]}

    assert {"agent_directory", "credential_rotation", "heartbeat", "trust_policy", "lease_flow", "progress_sync"} <= set(registry_submodules)
    assert registry_submodules["credential_rotation"]["path"] == "#/ecosystem/a2a/registry"
    assert registry_submodules["trust_policy"]["capability"] == "ecosystem.a2a.registry.trust_policy"
    assert {"dispatch_queue", "packet_preview", "retry", "reassign", "lease_ops", "evidence_sync"} <= set(dispatch_submodules)
    assert dispatch_submodules["packet_preview"]["path"] == "#/ecosystem/a2a/dispatch"
    assert dispatch_submodules["evidence_sync"]["path"] == "#/ecosystem/a2a/evidence"


def test_system_pages_experience_review_scores_a2a_focused_route_density():
    payload = system_pages_experience_review(q="A2A")
    registry = next(item for item in payload["items"] if item["id"] == "a2aRegistry")
    dispatch = next(item for item in payload["items"] if item["id"] == "a2aDispatch")

    assert registry["implementation_contract"]["submodule_count"] >= 6
    assert dispatch["implementation_contract"]["submodule_count"] >= 6
    assert "密度" in registry["dimensions"]["simplicity"]["detail"]
    assert "密度" in dispatch["dimensions"]["simplicity"]["detail"]
    assert registry["status"] == "simple"
    assert dispatch["status"] == "simple"


def test_system_pages_llm_gateway_contract_exposes_production_controls():
    payload = system_pages_readiness(q="模型网关")

    llm = next(item for item in payload["items"] if item["id"] == "llmGateway")
    apis = set(llm["implementation_contract"]["apis"])
    assert "/api/v1/llm-gateway/policies" in apis
    assert "/api/v1/llm-gateway/policy-evaluate" in apis
    assert "/api/v1/llm-gateway/fallback-drill" in apis
    assert "/api/v1/llm-gateway/cost-anomalies/tasks" in apis
    assert "/api/v1/llm-gateway/cost-attribution/run" in apis
    assert "/api/v1/llm-gateway/cost-attribution/tasks" in apis
    assert "/api/v1/llm-gateway/model-evals/run" in apis
    assert "/api/v1/llm-gateway/model-evals/tasks" in apis
    assert "/api/v1/llm-gateway/prompt-audit/run" in apis
    assert "/api/v1/llm-gateway/prompt-audit/tasks" in apis
    assert "策略化路由" in llm["capabilities"]
    assert "预算护栏" in llm["capabilities"]
    assert "Provider 健康" in llm["capabilities"]
    assert "Fallback 演练" in llm["capabilities"]
    assert "成本异常任务化" in llm["capabilities"]
    assert "跨 Provider 成本归因" in llm["capabilities"]
    assert "成本归因任务化" in llm["capabilities"]
    assert "模型评测" in llm["capabilities"]
    assert "评测任务化" in llm["capabilities"]
    assert "Prompt 审计" in llm["capabilities"]
    assert "提示词注入检测" in llm["capabilities"]

    all_payload = system_pages_readiness()
    attribution = next(item for item in all_payload["items"] if item["id"] == "llmGatewayAttribution")
    assert attribution["path"] == "#/ai/llm-gateway/attribution"
    assert "/api/v1/llm-gateway/cost-attribution/runs" in attribution["implementation_contract"]["apis"]
    assert "Provider 成本分布" in attribution["capabilities"]

    model_eval = next(item for item in all_payload["items"] if item["id"] == "llmGatewayEval")
    assert model_eval["path"] == "#/ai/llm-gateway/eval"
    assert "/api/v1/llm-gateway/model-evals/runs" in model_eval["implementation_contract"]["apis"]
    assert "模型排名" in model_eval["capabilities"]


def test_system_pages_ops_center_contract_exposes_self_heal_guardrails():
    payload = system_pages_readiness(q="智能运维中心")

    ops = next(item for item in payload["items"] if item["id"] == "opsCenter")
    apis = set(ops["implementation_contract"]["apis"])
    assert "/api/v1/ops-center/self-heal/actions" in apis
    assert "/api/v1/ops-center/self-heal/actions/{id}/approve" in apis
    assert "/api/v1/ops-center/self-heal/actions/{id}/apply" in apis
    assert "/api/v1/ops-center/self-heal/actions/{id}/verify" in apis
    assert "/api/v1/ops-center/self-heal/actions/{id}/rollback" in apis
    assert "自愈审批" in ops["capabilities"]
    assert "动作验证" in ops["capabilities"]
    assert "回滚留证" in ops["capabilities"]

    capability_payload = system_page_capabilities()
    ops_capability = next(item for item in capability_payload["items"] if item["id"] == "opsCenter")
    submodules = {item["id"]: item for item in ops_capability["submodules"]}
    assert {"pipeline", "alerts", "rca", "runbook", "self-heal"} <= set(submodules)
    assert submodules["alerts"]["path"] == "#/system/ops-center/alerts"
    assert submodules["self-heal"]["capability"] == "system.ops-center.self-heal"


def test_system_pages_experience_review_scores_modular_api_density():
    payload = system_pages_experience_review(q="智能运维中心")
    ops = next(item for item in payload["items"] if item["id"] == "opsCenter")

    assert ops["implementation_contract"]["submodule_count"] >= 5
    assert "密度" in ops["dimensions"]["simplicity"]["detail"]
    assert ops["dimensions"]["simplicity"]["score"] >= 60


def test_system_pages_settings_contract_exposes_storage_migration():
    payload = system_pages_readiness(q="设置")

    settings = next(item for item in payload["items"] if item["id"] == "settings")
    apis = set(settings["implementation_contract"]["apis"])
    assert "/api/v1/system/ops/storage/migration-plan" in apis
    assert "/api/v1/system/ops/storage/migration-smoke" in apis
    assert "OceanBase 迁移" in settings["capabilities"]
    assert "备份恢复清单" in settings["capabilities"]
    assert "SQLite 开发路径" in settings["capabilities"]


def test_system_pages_data_quality_contract_exposes_executable_runtime():
    payload = system_pages_readiness(q="质量告警")

    quality = next(item for item in payload["items"] if item["id"] == "dataQuality")
    apis = set(quality["implementation_contract"]["apis"])
    assert "/api/v1/data-quality/rules" in apis
    assert "/api/v1/data-quality/runs" in apis
    assert "/api/v1/data-quality/alerts" in apis
    assert "/api/v1/data-quality/alerts/tasks" in apis
    assert "规则执行" in quality["capabilities"]
    assert "告警归因" in quality["capabilities"]
    assert "运行任务化" in quality["capabilities"]


def test_system_pages_metrics_contract_exposes_semantic_layer_runtime():
    payload = system_pages_readiness(q="指标与标签")

    metrics = next(item for item in payload["items"] if item["id"] == "dataMetricsTags")
    apis = set(metrics["implementation_contract"]["apis"])
    assert "/api/v1/metrics-service/catalog/{id}/publish" in apis
    assert "/api/v1/metrics-service/catalog/{id}/versions" in apis
    assert "/api/v1/metrics-service/catalog/{id}/impact" in apis
    assert "/api/v1/metrics-service/query/{id}" in apis
    assert "指标版本发布" in metrics["capabilities"]
    assert "查询契约" in metrics["capabilities"]
    assert "血缘影响分析" in metrics["capabilities"]


def test_system_pages_tag_contract_exposes_profile_build_runtime():
    payload = system_pages_readiness(q="指标与标签")

    tags = next(item for item in payload["items"] if item["id"] == "dataMetricsTags")
    apis = set(tags["implementation_contract"]["apis"])
    assert "/api/v1/tag-service/rules/evaluate" in apis
    assert "/api/v1/tag-service/profiles/build" in apis
    assert "/api/v1/tag-service/profiles/builds" in apis
    assert "/api/v1/tag-service/ontology/entities/{id}/publish" in apis
    assert "规则试算" in tags["capabilities"]
    assert "画像构建" in tags["capabilities"]
    assert "画像发布契约" in tags["capabilities"]


def test_system_pages_data_ingest_contract_exposes_runtime_control_plane():
    payload = system_pages_readiness(q="数据接入")

    ingest = next(item for item in payload["items"] if item["id"] == "dataIngest")
    apis = set(ingest["implementation_contract"]["apis"])
    assert ingest["path"] == "#/data/ingest"
    assert "/api/v1/data-ingest/connectors/{id}/dry-run" in apis
    assert "/api/v1/data-ingest/connectors/{id}/schema" in apis
    assert "/api/v1/data-ingest/schema-registry" in apis
    assert "/api/v1/data-ingest/runs" in apis
    assert "/api/v1/data-ingest/cdc-cursors" in apis
    assert ingest["implementation_contract"]["submodule_count"] >= 6
    assert ingest["implementation_contract"]["action_count"] >= 18
    assert "连接器 Dry-run" in ingest["capabilities"]
    assert "Schema Registry" in ingest["capabilities"]
    assert "CDC 游标" in ingest["capabilities"]
    assert "运行历史" in ingest["capabilities"]


def test_system_pages_data_ingest_exposes_focused_submodule_paths():
    payload = system_page_capabilities()
    ingest = next(item for item in payload["items"] if item["id"] == "dataIngest")
    submodules = {item["id"]: item for item in ingest["submodules"]}

    assert {"connectors", "dry_run", "schema_registry", "cdc_cursors", "batch_jobs", "run_history"} <= set(submodules)
    assert submodules["connectors"]["path"] == "#/data/ingest/connectors"
    assert submodules["schema_registry"]["path"] == "#/data/ingest/schema"
    assert submodules["cdc_cursors"]["path"] == "#/data/ingest/cdc"
    assert submodules["batch_jobs"]["path"] == "#/data/ingest/batch"
    assert submodules["schema_registry"]["capability"] == "data.ingest.schema_registry"


def test_system_pages_experience_review_scores_data_ingest_route_density():
    payload = system_pages_experience_review(q="数据接入")
    ingest = next(item for item in payload["items"] if item["id"] == "dataIngest")

    assert ingest["implementation_contract"]["submodule_count"] >= 6
    assert "密度" in ingest["dimensions"]["simplicity"]["detail"]
    assert ingest["status"] == "simple"


def test_system_pages_data_sources_contract_exposes_metadata_sync_control_plane():
    payload = system_pages_readiness(q="数据源管理")

    sources = next(item for item in payload["items"] if item["id"] == "dataSources")
    apis = set(sources["implementation_contract"]["apis"])
    assert sources["domain"] == "data"
    assert sources["path"] == "#/data/sources"
    assert "/api/v1/db-config/connections/summary" in apis
    assert "/api/v1/db-config/connections/{name}/metadata-preview" in apis
    assert "/api/v1/db-config/connections/{name}/metadata-sync" in apis
    assert "元数据预览" in sources["capabilities"]
    assert "Schema Registry 同步" in sources["capabilities"]
    assert "Agent 消费入口" in sources["capabilities"]


def test_system_pages_knowledge_graph_contract_exposes_graph_rag_and_memory_ontology():
    payload = system_pages_readiness(q="知识图谱")

    graph = next(item for item in payload["items"] if item["id"] == "knowledgeGraph")
    apis = set(graph["implementation_contract"]["apis"])
    assert "/api/v1/knowledge-graph/build" in apis
    assert "/api/v1/knowledge-graph/query" in apis
    assert "/api/v1/knowledge-graph/entity-profiles/merge" in apis
    assert "/api/v1/memory/{id}/lifecycle" in apis
    assert "来源权限检查" in graph["capabilities"]
    assert "证据链" in graph["capabilities"]
    assert "实体画像合并" in graph["capabilities"]
    assert "记忆生命周期" in graph["capabilities"]


def test_system_pages_organization_contract_exposes_abac_field_security():
    payload = system_pages_readiness(q="组织权限")

    org = next(item for item in payload["items"] if item["id"] == "organization")
    apis = set(org["implementation_contract"]["apis"])
    assert "/api/v1/organization/policy" in apis
    assert "/api/v1/organization/policy/check" in apis
    assert "/api/v1/organization/policy/history" in apis
    assert "字段级安全" in org["capabilities"]
    assert "行级 ABAC" in org["capabilities"]
    assert "策略试算" in org["capabilities"]
    assert "策略审计" in org["capabilities"]
