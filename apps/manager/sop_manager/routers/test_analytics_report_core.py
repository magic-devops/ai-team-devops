from sop_manager.routers.analytics_report_core import (
    aggregate_report_intelligence,
    analyze_metric_attribution,
    build_attribution_tasks,
    build_decision_attribution_engine,
    build_decision_tasks,
    build_report_intelligence_tasks,
    generate_insight_report,
    summarize_report_intelligence,
)


def test_analyze_metric_attribution_detects_delivery_blockers():
    metrics = {
        "tasks_total": 20,
        "requirements_total": 8,
        "issues_total": 5,
        "tasks_by_status": {"blocked": 4, "in_progress": 6, "done": 10},
        "issues_by_priority": {"P0": 2, "P1": 3},
    }

    result = analyze_metric_attribution(metrics)

    assert result["risk_level"] == "high"
    assert result["summary"]["blocked_tasks"] == 4
    assert result["summary"]["p0_issues"] == 2
    assert result["drivers"][0]["factor"] in {"blocked_tasks", "p0_issues"}
    assert any(item["action_type"] == "delivery_unblock" for item in result["recommendations"])


def test_analyze_metric_attribution_marks_low_risk_when_no_blockers():
    metrics = {
        "tasks_total": 12,
        "requirements_total": 4,
        "issues_total": 0,
        "tasks_by_status": {"completed": 10, "in_progress": 2},
        "issues_by_priority": {},
    }

    result = analyze_metric_attribution(metrics)

    assert result["risk_level"] == "low"
    assert result["score"] >= 85
    assert result["drivers"]
    assert result["drivers"][0]["impact"] == "positive"


def test_generate_insight_report_contains_markdown_and_actionable_sections():
    metrics = {
        "tasks_total": 10,
        "requirements_total": 5,
        "issues_total": 1,
        "tasks_by_status": {"blocked": 1, "in_progress": 3},
        "issues_by_priority": {"P1": 1},
    }

    report = generate_insight_report(metrics, title="项目交付洞察")

    assert report["title"] == "项目交付洞察"
    assert "## 归因分析" in report["answer"]
    assert "## 建议动作" in report["answer"]
    assert report["highlights"]
    assert report["attribution"]["risk_level"] in {"medium", "high"}


def test_build_attribution_tasks_uses_driver_recommendations():
    attribution = {
        "risk_level": "high",
        "recommendations": [
            {"title": "处理阻塞任务", "detail": "拆解阻塞原因", "action_type": "delivery_unblock"},
            {"title": "修复 P0 问题", "detail": "安排修复窗口", "action_type": "quality_fix"},
        ],
    }

    tasks = build_attribution_tasks(attribution, priority="P1", owner_id="", dev_tool="codex")

    assert len(tasks) == 2
    assert tasks[0]["source"] == "analytics_attribution"
    assert tasks[0]["priority"] == "P1"
    assert tasks[0]["owner_id"] == ""


def test_summarize_report_intelligence_counts_attribution_reports():
    reports = [
        {"id": "r1", "attribution": {"risk_level": "high"}, "source": "insight"},
        {"id": "r2", "source": "nlq"},
        {"id": "r3", "attribution": {"risk_level": "low"}, "source": "insight"},
    ]

    summary = summarize_report_intelligence(reports)

    assert summary["attribution_reports"] == 2
    assert summary["high_risk_reports"] == 1
    assert summary["insight_reports"] == 2


def test_aggregate_report_intelligence_groups_risks_and_drivers():
    reports = [
        {
            "id": "r1",
            "title": "交付风险洞察",
            "attribution": {
                "score": 62,
                "risk_level": "high",
                "drivers": [
                    {"factor": "blocked_tasks", "label": "阻塞任务", "impact": "negative", "weight": 80},
                    {"factor": "p0_issues", "label": "高优问题", "impact": "negative", "weight": 55},
                ],
                "recommendations": [
                    {"title": "处理阻塞任务", "detail": "恢复关键路径", "action_type": "delivery_unblock", "priority_hint": "P0"}
                ],
            },
        },
        {
            "id": "r2",
            "title": "需求拆解洞察",
            "metrics_snapshot": {
                "tasks_total": 2,
                "requirements_total": 6,
                "issues_total": 0,
                "tasks_by_status": {"in_progress": 2},
            },
        },
    ]

    intelligence = aggregate_report_intelligence(reports)

    assert intelligence["health_status"] in {"risk", "watch"}
    assert intelligence["summary"]["total_reports"] == 2
    assert intelligence["summary"]["high_risk_reports"] >= 1
    assert intelligence["top_drivers"][0]["factor"] == "blocked_tasks"
    assert intelligence["recommendations"][0]["action_type"] in {"delivery_unblock", "requirement_decompose"}
    assert intelligence["agent_consumption"]["api"] == "/api/v1/analytics/reports/intelligence"


def test_build_report_intelligence_tasks_creates_operational_candidates():
    intelligence = {
        "health_status": "risk",
        "summary": {"total_reports": 3, "high_risk_reports": 2, "average_score": 68},
        "recommendations": [
            {
                "title": "处理阻塞任务",
                "detail": "2 份报告命中阻塞任务风险",
                "action_type": "delivery_unblock",
                "priority_hint": "P0",
                "report_ids": ["r1", "r2"],
            }
        ],
    }

    tasks = build_report_intelligence_tasks(intelligence, priority="", owner_id="", dev_tool="codex")

    assert len(tasks) == 1
    assert tasks[0]["source"] == "analytics_report_intelligence"
    assert tasks[0]["priority"] == "P0"
    assert "2 份报告" in tasks[0]["description"]


def test_build_decision_attribution_engine_returns_explainable_packet():
    reports = [
        {
            "id": "r1",
            "title": "发布风险洞察",
            "attribution": {
                "score": 58,
                "risk_level": "high",
                "drivers": [{"factor": "blocked_tasks", "label": "阻塞任务", "impact": "negative", "weight": 90}],
                "recommendations": [{"title": "处理阻塞任务", "detail": "先恢复关键路径", "action_type": "delivery_unblock", "priority_hint": "P0"}],
            },
        }
    ]

    packet = build_decision_attribution_engine(reports, question="是否可以发布？")

    assert packet["decision"]["status"] == "block"
    assert packet["summary"]["evidence_count"] >= 1
    assert packet["actions"][0]["priority_hint"] == "P0"
    assert "是否可以发布" in packet["answer"]
    assert packet["agent_consumption"]["api"] == "/api/v1/analytics/decision/overview"


def test_build_decision_tasks_preserves_decision_context():
    packet = {
        "decision": {"status": "watch", "label": "建议带风险推进", "score": 82, "confidence": 0.84},
        "actions": [
            {
                "id": "a1",
                "title": "治理高风险报告",
                "detail": "补充证据并关闭风险",
                "action_type": "risk_governance",
                "priority_hint": "P1",
                "report_ids": ["r1"],
            }
        ],
    }

    tasks = build_decision_tasks(packet, priority="", owner_id="", dev_tool="codex", max_tasks=3)

    assert len(tasks) == 1
    assert tasks[0]["source"] == "analytics_decision_attribution"
    assert tasks[0]["priority"] == "P1"
    assert "决策分" in tasks[0]["description"]
