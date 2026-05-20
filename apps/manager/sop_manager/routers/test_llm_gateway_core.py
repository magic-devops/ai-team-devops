from sop_manager.routers.llm_gateway_core import (
    build_gateway_governance_tasks,
    estimate_invocation_cost,
    select_llm_route,
    summarize_gateway_health,
)


def test_select_llm_route_prefers_exact_enabled_route_by_priority():
    routes = [
        {"id": "r1", "task_type": "general", "model_id": "cheap-model", "priority": 10, "enabled": True},
        {"id": "r2", "task_type": "code", "model_id": "code-model", "priority": 3, "enabled": True, "fallback_model_id": "cheap-model"},
    ]

    decision = select_llm_route(
        {"task_type": "code", "estimated_prompt_tokens": 1000, "estimated_completion_tokens": 500},
        routes,
        [],
        [],
    )

    assert decision["status"] == "allowed"
    assert decision["selected_model_id"] == "code-model"
    assert decision["route_id"] == "r2"
    assert decision["fallback_applied"] is False
    assert decision["risk_level"] == "low"


def test_select_llm_route_uses_fallback_when_primary_would_exceed_tpm():
    routes = [
        {"id": "r1", "task_type": "analysis", "model_id": "primary-model", "priority": 10, "enabled": True, "fallback_model_id": "fallback-model"},
    ]
    throttles = [
        {"model_id": "primary-model", "rpm_limit": 10, "tpm_limit": 1000, "enabled": True},
        {"model_id": "fallback-model", "rpm_limit": 10, "tpm_limit": 5000, "enabled": True},
    ]
    usage = [
        {"model_id": "primary-model", "prompt_tokens": 800, "completion_tokens": 100},
    ]

    decision = select_llm_route(
        {"task_type": "analysis", "estimated_prompt_tokens": 400, "estimated_completion_tokens": 100},
        routes,
        throttles,
        usage,
    )

    assert decision["status"] == "allowed"
    assert decision["selected_model_id"] == "fallback-model"
    assert decision["fallback_applied"] is True
    assert decision["primary_model_id"] == "primary-model"
    assert decision["risk_level"] == "medium"


def test_select_llm_route_blocks_when_primary_and_fallback_are_limited():
    routes = [
        {"id": "r1", "task_type": "general", "model_id": "primary", "priority": 1, "enabled": True, "fallback_model_id": "fallback"},
    ]
    throttles = [
        {"model_id": "primary", "rpm_limit": 1, "tpm_limit": 100, "enabled": True},
        {"model_id": "fallback", "rpm_limit": 1, "tpm_limit": 100, "enabled": True},
    ]

    decision = select_llm_route(
        {"task_type": "unknown", "estimated_prompt_tokens": 120, "estimated_completion_tokens": 10},
        routes,
        throttles,
        [],
    )

    assert decision["status"] == "blocked"
    assert decision["risk_level"] == "high"
    assert decision["selected_model_id"] == ""
    assert decision["fallback_applied"] is False


def test_estimate_invocation_cost_uses_catalog_and_rounds():
    cost = estimate_invocation_cost("gpt-5-mini", 1200, 800)

    assert cost["model_id"] == "gpt-5-mini"
    assert cost["estimated_tokens"] == 2000
    assert cost["estimated_cost_usd"] > 0


def test_summarize_gateway_health_flags_missing_fallback_and_high_latency():
    routes = [
        {"id": "r1", "task_type": "code", "model_id": "m1", "enabled": True, "fallback_model_id": ""},
    ]
    usage = [
        {"model_id": "m1", "prompt_tokens": 100, "completion_tokens": 100, "cost_usd": 0.02, "latency_ms": 3500},
    ]

    summary = summarize_gateway_health(routes, [], usage)

    assert summary["active_routes"] == 1
    assert summary["health_score"] < 100
    assert any(risk["title"] == "模型路由缺少 fallback" for risk in summary["risks"])
    assert any(risk["title"] == "模型平均延迟偏高" for risk in summary["risks"])


def test_build_gateway_governance_tasks_creates_drafts_from_risks():
    summary = {
        "health_score": 76,
        "risks": [
            {"level": "high", "title": "模型路由缺少 fallback", "recommendation": "为关键路由配置备用模型。"},
            {"level": "medium", "title": "模型缺少限流保护", "recommendation": "配置 RPM/TPM。"},
        ],
    }

    tasks = build_gateway_governance_tasks(summary)

    assert len(tasks) == 2
    assert tasks[0]["source"] == "llm_gateway_governance"
    assert tasks[0]["priority"] == "P0"
    assert "LLM Gateway" in tasks[0]["title"]
