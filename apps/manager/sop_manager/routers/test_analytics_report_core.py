from sop_manager.routers.analytics_report_core import (
    analyze_metric_attribution,
    build_attribution_tasks,
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

    tasks = build_attribution_tasks(attribution, priority="P1", assigned_to="DataOps", dev_tool="codex")

    assert len(tasks) == 2
    assert tasks[0]["source"] == "analytics_attribution"
    assert tasks[0]["priority"] == "P1"
    assert tasks[0]["assigned_to"] == "DataOps"


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
