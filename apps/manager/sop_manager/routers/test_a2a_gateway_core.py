from sop_manager.routers.a2a_gateway_core import (
    build_a2a_governance_tasks,
    build_protocol_packet,
    score_agent_match,
    summarize_a2a_health,
)


def test_score_agent_match_prefers_exact_capability_and_healthy_agent():
    task = {
        "task_type": "code_review",
        "task_description": "Review Spring Boot API security and SQL access",
        "required_capabilities": ["code.review", "security.audit"],
        "priority": "P1",
    }
    agent = {
        "id": "agent-1",
        "name": "Reviewer",
        "status": "active",
        "capabilities": ["code.review", "security.audit", "java.spring"],
        "success_rate": 0.92,
        "load": 1,
    }

    result = score_agent_match(agent, task)

    assert result["agent_id"] == "agent-1"
    assert result["confidence"] >= 0.9
    assert result["decision"] == "recommended"
    assert "code.review" in result["matched_capabilities"]
    assert result["risk_level"] == "low"


def test_score_agent_match_marks_busy_or_missing_capability_as_watch():
    task = {
        "task_type": "data_pipeline",
        "required_capabilities": ["flink.cdc", "schema.registry"],
        "priority": "P0",
    }
    agent = {
        "id": "agent-2",
        "name": "Generic Agent",
        "status": "active",
        "capabilities": ["schema.registry"],
        "success_rate": 0.55,
        "load": 5,
    }

    result = score_agent_match(agent, task)

    assert result["confidence"] < 0.75
    assert result["decision"] == "needs_review"
    assert result["risk_level"] in {"medium", "high"}
    assert "flink.cdc" in result["missing_capabilities"]


def test_build_protocol_packet_contains_scope_callbacks_and_quality_gates():
    dispatch = {
        "id": "dispatch-1",
        "agent_id": "agent-1",
        "task_id": "task-9",
        "payload": {"title": "Fix flaky tests", "source": "manager-web"},
    }
    agent = {"id": "agent-1", "name": "Tester", "capabilities": ["test.automation"]}
    scope = {"tenant_code": "t1", "business_code": "b1", "project_id": "p1"}

    packet = build_protocol_packet(dispatch, agent, scope)

    assert packet["protocol"] == "hermes-a2a"
    assert packet["run_id"] == "dispatch-1"
    assert packet["scope"] == scope
    assert packet["callbacks"]["evidence"].endswith("/api/v1/a2a/evidence")
    assert packet["quality_gates"]
    assert packet["agent"]["name"] == "Tester"


def test_summarize_a2a_health_flags_missing_evidence_and_capability_gaps():
    registry = [
        {"id": "a1", "status": "active", "capabilities": ["code.review"]},
        {"id": "a2", "status": "paused", "capabilities": []},
    ]
    dispatches = [
        {"id": "d1", "status": "dispatched", "agent_id": "a1"},
        {"id": "d2", "status": "success", "agent_id": "a1", "evidence_at": "2026-05-20T01:00:00Z"},
    ]

    summary = summarize_a2a_health(registry, dispatches)

    assert summary["registered_agents"] == 2
    assert summary["active"] == 1
    assert summary["evidence_received"] == 1
    assert summary["health_score"] < 100
    assert summary["risks"]
    assert summary["capability_coverage"]["total_capabilities"] == 1


def test_build_a2a_governance_tasks_creates_actionable_task_drafts():
    summary = {
        "health_score": 72,
        "risks": [
            {"level": "high", "title": "存在未回写证据的分发任务", "recommendation": "追踪 Agent 执行结果并补齐证据。"},
            {"level": "medium", "title": "存在无能力画像 Agent", "recommendation": "补齐能力画像。"},
        ],
    }

    tasks = build_a2a_governance_tasks(summary)

    assert len(tasks) == 2
    assert tasks[0]["source"] == "a2a_protocol_governance"
    assert tasks[0]["priority"] == "P0"
    assert "A2A" in tasks[0]["title"]
