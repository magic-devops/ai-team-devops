from sop_manager.routers.ops_center_core import (
    build_self_heal_tasks,
    evaluate_self_heal,
    summarize_ops_health,
)


def test_evaluate_self_heal_matches_enabled_threshold_policy():
    result = evaluate_self_heal(
        policies=[
            {
                "id": "policy-cpu",
                "trigger_condition": "cpu > 90",
                "action": "restart_service api",
                "enabled": True,
            },
            {
                "id": "policy-disabled",
                "trigger_condition": "error_rate > 5",
                "action": "rollback deployment",
                "enabled": False,
            },
        ],
        signals={"cpu": 96, "error_rate": 9, "service": "api"},
        rca=[],
        pipelines=[],
        runbooks=[],
    )

    assert result["summary"]["matched"] == 1
    assert result["decisions"][0]["policy_id"] == "policy-cpu"
    assert result["decisions"][0]["decision"] == "ready"
    assert result["decisions"][0]["risk_level"] == "high"
    assert result["decisions"][0]["action"] == "restart_service api"


def test_evaluate_self_heal_blocks_destructive_production_action_without_runbook():
    result = evaluate_self_heal(
        policies=[
            {
                "id": "policy-prod-rollback",
                "trigger_condition": "error_rate >= 5",
                "action": "rollback production",
                "enabled": True,
            }
        ],
        signals={"error_rate": 12, "environment": "production"},
        rca=[{"id": "rca-1", "status": "open", "incident_id": "INC-1", "root_cause": "release regression"}],
        pipelines=[],
        runbooks=[],
    )

    decision = result["decisions"][0]
    assert decision["decision"] == "needs_approval"
    assert decision["risk_level"] == "critical"
    assert any("Runbook" in step["title"] for step in decision["steps"])
    assert result["summary"]["needs_approval"] == 1


def test_build_self_heal_tasks_creates_actionable_task_drafts():
    evaluation = evaluate_self_heal(
        policies=[
            {"id": "policy-latency", "trigger_condition": "latency_ms > 1000", "action": "scale_out api", "enabled": True}
        ],
        signals={"latency_ms": 1880, "service": "api"},
        rca=[],
        pipelines=[],
        runbooks=[{"id": "rb-scale", "name": "服务扩容", "tags": ["scale"], "steps": ["确认容量", "扩容实例"]}],
    )

    tasks = build_self_heal_tasks(evaluation, dry_run=True, priority="P1", assigned_to="Ops Agent", dev_tool="codex")

    assert tasks["dry_run"] is True
    assert tasks["tasks"][0]["source"] == "ops_center_self_heal"
    assert tasks["tasks"][0]["priority"] == "P1"
    assert "policy-latency" in tasks["tasks"][0]["debug_notes"]


def test_summarize_ops_health_counts_open_risk_and_recommendations():
    summary = summarize_ops_health(
        pipelines=[{"status": "failed"}, {"status": "running"}],
        rca=[{"status": "open"}, {"status": "resolved"}],
        runbooks=[],
        self_heal=[{"enabled": True}, {"enabled": False}],
        evaluations=[{"summary": {"matched": 2, "needs_approval": 1}}],
    )

    assert summary["health_score"] < 90
    assert summary["pipelines_failed"] == 1
    assert summary["rca_open"] == 1
    assert summary["self_heal_active"] == 1
    assert summary["recommendations"]
