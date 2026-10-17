from sop_manager.routers import data_analytics
from sop_manager.routers.data_analytics import NlqIn, _answer_nlq_with_metrics


def test_answer_nlq_with_metrics_handles_status_distribution():
    metrics = {
        "tasks_total": 7,
        "tasks_by_status": {"pending": 2, "in_progress": 3, "blocked": 1, "completed": 1},
        "requirements_total": 4,
        "issues_total": 2,
    }

    result = _answer_nlq_with_metrics("当前任务状态分布和阻塞情况怎么样？", metrics)

    assert result["engine"] == "rules"
    assert result["confidence"] >= 0.7
    assert "任务总数：7" in result["answer"]
    assert "进行中：3" in result["answer"]
    assert "阻塞：1" in result["answer"]
    assert "status_distribution" in result["matched_intents"]


def test_answer_nlq_with_metrics_handles_delivery_overview():
    metrics = {
        "tasks_total": 5,
        "tasks_by_status": {"pending": 1, "completed": 4},
        "requirements_total": 3,
        "issues_total": 0,
    }

    result = _answer_nlq_with_metrics("给我一个项目交付概览", metrics)

    assert result["engine"] == "rules"
    assert "需求总数：3" in result["answer"]
    assert "任务总数：5" in result["answer"]
    assert "问题总数：0" in result["answer"]
    assert result["cards"][0]["label"] == "需求总数"


def test_analytics_nlq_returns_rules_fallback_when_llm_provider_fails(monkeypatch):
    metrics = {
        "tasks_total": 2,
        "tasks_by_status": {"blocked": 1, "completed": 1},
        "requirements_total": 1,
        "issues_total": 0,
        "issues_by_priority": {},
    }

    def unavailable_gateway(body, request):
        raise RuntimeError("provider offline with sensitive upstream context")

    from sop_manager.routers import llm_gateway

    monkeypatch.setattr(data_analytics, "_require_scope", lambda: "project-a")
    monkeypatch.setattr(data_analytics, "_build_metrics", lambda db, pid: metrics)
    monkeypatch.setattr(llm_gateway, "llm_chat", unavailable_gateway)

    result = data_analytics.analytics_nlq(NlqIn(question="阻塞任务怎么样？"), db=object())

    assert result["ok"] is True
    assert result["engine"] == "rules"
    assert result["fallback_reason"] == "llm_provider_failed"
    assert result["provider_errors"] == ["RuntimeError"]
    assert "阻塞：1" in result["answer"]
