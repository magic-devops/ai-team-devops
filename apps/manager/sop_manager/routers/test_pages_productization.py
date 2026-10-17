from sop_manager.routers.pages_productization import (
    InteractionOpsActionIn,
    InteractionOpsExportIn,
    InteractionOpsMemoryIn,
    InteractionTaskIn,
    pages_interaction_analysis,
    pages_interaction_ops,
    pages_interaction_ops_export,
    pages_interaction_ops_memory,
    pages_interaction_ops_tasks,
    pages_interaction_tasks,
    pages_productization,
)


def test_pages_productization_links_interaction_analysis_cli_and_api():
    payload = pages_productization(domain="all", q="")

    assert payload["ok"] is True
    assert payload["summary"]["productization_standard"] == "metrics + filter + workspace + actions + AI + CLI + audit"
    assert any(action["path"] == "/api/v1/pages/interaction-analysis" for action in payload["actions"])
    assert any("sop pages interaction-analysis" in item["command"] for item in payload["cli"])


def test_pages_interaction_analysis_exposes_unified_fast_ux_contract():
    payload = pages_interaction_analysis(domain="all", q="System", status="all", limit=5)

    assert set(("ok", "scope", "summary", "items", "actions", "agent_consumption", "cli", "permissions", "audit", "trace_id")).issubset(payload)
    assert payload["agent_consumption"]["api"] == "/api/v1/pages/interaction-analysis"
    assert payload["agent_consumption"]["evidence_boundary"].startswith("Static registry analysis")
    assert payload["summary"]["standards"] >= 10
    assert len(payload["items"]) <= 5
    assert any(item["id"] == "keyboard_feedback" for item in payload["standards"])
    assert any("sop pages interaction-analysis" in item["command"] for item in payload["cli"])
    if payload["items"]:
        row = payload["items"][0]
        assert "interaction_score" in row
        assert row["status"] in {"ready", "watch", "risk"}
        assert row["quick_actions"][1].startswith("sop pages interaction-analysis")


def test_pages_interaction_analysis_filters_status():
    payload = pages_interaction_analysis(domain="all", q="", status="watch", limit=50)

    assert all(item["status"] == "watch" for item in payload["items"])
    assert payload["audit"]["filters"]["status"] == "watch"


def test_pages_interaction_tasks_preview_gap_tasks():
    result = pages_interaction_tasks(
        InteractionTaskIn(
            dry_run=True,
            domain="all",
            status="watch",
            q="",
            max_items=3,
            priority="P1",
            owner_id="",
        )
    )

    assert result["ok"] is True
    assert result["dry_run"] is True
    assert result["summary"]["planned"] > 0
    assert result["summary"]["created"] == 0
    first = result["planned"][0]
    assert first["source"] == "system_page_interaction"
    assert first["source_report_id"].startswith("interaction:")
    assert "interaction_score" in first["description"]
    assert "interaction_gaps" in first["description"]
    assert result["agent_consumption"]["api"] == "/api/v1/pages/interaction-analysis/tasks"


def test_pages_interaction_ops_aggregates_delivery_governance_payload():
    payload = pages_interaction_ops(domain="all", q="", status="watch", limit=20)

    assert set(("ok", "scope", "summary", "items", "actions", "agent_consumption", "cli", "permissions", "audit", "trace_id")).issubset(payload)
    assert payload["agent_consumption"]["api"] == "/api/v1/pages/interaction-ops"
    assert payload["summary"]["standard"] == "risk lanes + execution lanes + evidence lanes"
    assert payload["summary"]["total"] == len(payload["items"])
    assert any(action["path"] == "/api/v1/pages/interaction-ops/tasks" for action in payload["actions"])
    assert any(item["command"].startswith("sop pages interaction-ops") for item in payload["cli"])
    assert any(permission["capability"] == "governance.interaction-ops" for permission in payload["permissions"])
    if payload["items"]:
        first = payload["items"][0]
        assert first["lane"] in {"risk", "execution", "evidence"}
        assert first["severity"] in {"high", "medium", "low"}
        assert "agent_context" in first


def test_pages_interaction_ops_tasks_preview_is_idempotent_source_contract():
    result = pages_interaction_ops_tasks(
        InteractionOpsActionIn(
            dry_run=True,
            domain="all",
            status="watch",
            q="",
            max_items=3,
            priority="P1",
            owner_id="",
        )
    )

    assert result["ok"] is True
    assert result["dry_run"] is True
    assert result["summary"]["created"] == 0
    assert result["agent_consumption"]["api"] == "/api/v1/pages/interaction-ops/tasks"
    if result["planned"]:
        first = result["planned"][0]
        assert first["source"] == "interaction_ops"
        assert first["source_report_id"].startswith("interaction-ops:")
        assert "interaction_ops" in first["description"]


def test_pages_interaction_ops_memory_preview_has_scoped_record():
    result = pages_interaction_ops_memory(
        InteractionOpsMemoryIn(
            dry_run=True,
            domain="all",
            status="watch",
            q="",
            limit=5,
            kind="long",
            write_kb=True,
        )
    )

    assert result["ok"] is True
    assert result["summary"]["dry_run"] is True
    assert result["summary"]["written"] is False
    assert result["record"]["kind"] == "long"
    assert result["record"]["write_kb"] is True
    assert result["agent_consumption"]["api"] == "/api/v1/pages/interaction-ops/memory"


def test_pages_interaction_ops_export_preview_contains_runbook_and_audit_package():
    result = pages_interaction_ops_export(
        InteractionOpsExportIn(
            dry_run=True,
            domain="all",
            status="watch",
            q="",
            limit=5,
            include_events=True,
        )
    )

    assert result["ok"] is True
    assert result["summary"]["dry_run"] is True
    assert result["package"]["kind"] == "interaction_ops_audit_package"
    assert "runbook" in result["package"]
    assert result["agent_consumption"]["api"] == "/api/v1/pages/interaction-ops/export"
