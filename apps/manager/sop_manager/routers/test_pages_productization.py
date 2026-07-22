from sop_manager.routers.pages_productization import InteractionTaskIn, pages_interaction_analysis, pages_interaction_tasks, pages_productization


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
            assigned_to="Designer",
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
