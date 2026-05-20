"""Pure helpers for analytics insight reports and attribution."""
from __future__ import annotations

from typing import Any


def _int(value: Any) -> int:
    try:
        return int(value or 0)
    except Exception:
        return 0


def _ratio(part: int, total: int) -> float:
    return round(part / total, 4) if total > 0 else 0.0


def analyze_metric_attribution(metrics: dict[str, Any]) -> dict[str, Any]:
    tasks_total = _int(metrics.get("tasks_total"))
    requirements_total = _int(metrics.get("requirements_total"))
    issues_total = _int(metrics.get("issues_total"))
    tasks_by_status = metrics.get("tasks_by_status") if isinstance(metrics.get("tasks_by_status"), dict) else {}
    issues_by_priority = metrics.get("issues_by_priority") if isinstance(metrics.get("issues_by_priority"), dict) else {}
    blocked_tasks = _int(tasks_by_status.get("blocked"))
    in_progress = _int(tasks_by_status.get("in_progress"))
    completed = _int(tasks_by_status.get("completed") or tasks_by_status.get("done"))
    p0_issues = _int(issues_by_priority.get("P0"))
    p1_issues = _int(issues_by_priority.get("P1"))

    blocked_ratio = _ratio(blocked_tasks, tasks_total)
    high_issue_ratio = _ratio(p0_issues + p1_issues, max(issues_total, 1))
    completion_ratio = _ratio(completed, tasks_total)
    score = 100
    score -= min(45, blocked_tasks * 9)
    score -= min(30, p0_issues * 12 + p1_issues * 5)
    score -= 10 if tasks_total and completion_ratio < 0.35 else 0
    score -= 8 if requirements_total and tasks_total < requirements_total else 0
    score = max(0, score)

    risk_level = "low"
    if p0_issues > 0 or blocked_ratio >= 0.15 or score < 70:
        risk_level = "high"
    elif blocked_tasks > 0 or p1_issues > 0 or score < 85:
        risk_level = "medium"

    drivers: list[dict[str, Any]] = []
    if blocked_tasks:
        drivers.append({
            "factor": "blocked_tasks",
            "label": "阻塞任务",
            "impact": "negative",
            "value": blocked_tasks,
            "weight": min(100, blocked_tasks * 25),
            "explanation": f"当前有 {blocked_tasks} 个阻塞任务，占任务总量 {round(blocked_ratio * 100, 1)}%。",
        })
    if p0_issues or p1_issues:
        drivers.append({
            "factor": "p0_issues" if p0_issues else "p1_issues",
            "label": "高优问题",
            "impact": "negative",
            "value": p0_issues + p1_issues,
            "weight": min(100, p0_issues * 35 + p1_issues * 15),
            "explanation": f"存在 P0 问题 {p0_issues} 个、P1 问题 {p1_issues} 个。",
        })
    if tasks_total and tasks_total < requirements_total:
        drivers.append({
            "factor": "task_coverage",
            "label": "需求拆解覆盖不足",
            "impact": "negative",
            "value": tasks_total,
            "weight": 18,
            "explanation": f"需求 {requirements_total} 个但任务仅 {tasks_total} 个，可能存在未拆解需求。",
        })
    if not drivers:
        drivers.append({
            "factor": "delivery_flow",
            "label": "交付流稳定",
            "impact": "positive",
            "value": completed,
            "weight": 20,
            "explanation": "未发现阻塞任务或高优问题，交付流整体稳定。",
        })
    drivers.sort(key=lambda row: (row.get("impact") != "negative", -_int(row.get("weight"))))

    recommendations: list[dict[str, Any]] = []
    if blocked_tasks:
        recommendations.append({
            "title": "处理阻塞任务",
            "detail": "拉齐阻塞原因、责任人和下一步动作，优先恢复关键路径。",
            "action_type": "delivery_unblock",
            "priority_hint": "P0" if blocked_tasks >= 3 else "P1",
        })
    if p0_issues or p1_issues:
        recommendations.append({
            "title": "修复高优问题",
            "detail": "按 P0/P1 问题建立修复任务，关联验证证据和发布窗口。",
            "action_type": "quality_fix",
            "priority_hint": "P0" if p0_issues else "P1",
        })
    if tasks_total < requirements_total:
        recommendations.append({
            "title": "补齐需求拆解",
            "detail": "检查未拆解需求，补齐验收标准、任务和依赖关系。",
            "action_type": "requirement_decompose",
            "priority_hint": "P1",
        })
    if not recommendations:
        recommendations.append({
            "title": "持续监控交付健康",
            "detail": "保持报告订阅和关键指标巡检，沉淀稳定交付样板。",
            "action_type": "monitor",
            "priority_hint": "P3",
        })

    return {
        "score": score,
        "risk_level": risk_level,
        "summary": {
            "tasks_total": tasks_total,
            "requirements_total": requirements_total,
            "issues_total": issues_total,
            "blocked_tasks": blocked_tasks,
            "in_progress_tasks": in_progress,
            "completed_tasks": completed,
            "p0_issues": p0_issues,
            "p1_issues": p1_issues,
            "blocked_ratio": blocked_ratio,
            "completion_ratio": completion_ratio,
            "high_issue_ratio": high_issue_ratio,
        },
        "drivers": drivers,
        "recommendations": recommendations,
    }


def generate_insight_report(metrics: dict[str, Any], title: str = "智能数据洞察报告") -> dict[str, Any]:
    attribution = analyze_metric_attribution(metrics)
    summary = attribution["summary"]
    highlights = [
        f"健康分 {attribution['score']}，风险等级 {attribution['risk_level']}。",
        f"需求 {summary['requirements_total']} 个、任务 {summary['tasks_total']} 个、问题 {summary['issues_total']} 个。",
        f"阻塞任务 {summary['blocked_tasks']} 个，P0/P1 问题 {summary['p0_issues'] + summary['p1_issues']} 个。",
    ]
    lines = [
        f"## 总览",
        "",
        *[f"- {item}" for item in highlights],
        "",
        "## 归因分析",
        "",
    ]
    for driver in attribution["drivers"]:
        lines.append(f"- **{driver['label']}**：{driver['explanation']}")
    lines.extend(["", "## 建议动作", ""])
    for rec in attribution["recommendations"]:
        lines.append(f"- **{rec['title']}**：{rec['detail']}")
    lines.extend(["", "## 指标快照", "", "```json"])
    import json
    lines.append(json.dumps(metrics, ensure_ascii=False, indent=2))
    lines.append("```")
    return {
        "title": title,
        "answer": "\n".join(lines),
        "highlights": highlights,
        "attribution": attribution,
        "tags": ["智能洞察", "归因分析", f"risk:{attribution['risk_level']}"],
        "source": "insight",
    }


def build_attribution_tasks(attribution: dict[str, Any], *, priority: str = "P1", assigned_to: str = "DataOps", dev_tool: str = "codex") -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    for index, rec in enumerate(attribution.get("recommendations") or [], start=1):
        title = str(rec.get("title") or "跟进归因建议")
        tasks.append({
            "title": f"跟进数据归因：{title}",
            "description": "\n".join([
                f"风险等级：{attribution.get('risk_level', 'medium')}",
                f"建议类型：{rec.get('action_type', '-')}",
                f"建议详情：{rec.get('detail', '')}",
                "",
                "请结合需求、任务、问题与数据指标完成治理，并回填证据。",
            ]),
            "priority": priority or str(rec.get("priority_hint") or "P1"),
            "estimate": "M" if index <= 2 else "S",
            "assigned_to": assigned_to or "DataOps",
            "dev_tool": dev_tool or "codex",
            "source": "analytics_attribution",
            "source_report_id": f"attribution-{index}",
            "source_report_title": title,
        })
    return tasks


def summarize_report_intelligence(reports: list[dict[str, Any]]) -> dict[str, Any]:
    attribution_reports = [row for row in reports if isinstance(row.get("attribution"), dict)]
    insight_reports = [row for row in reports if str(row.get("source") or "") == "insight"]
    high_risk = [row for row in attribution_reports if str(row.get("attribution", {}).get("risk_level") or "") in {"high", "critical"}]
    return {
        "total_reports": len(reports),
        "insight_reports": len(insight_reports),
        "attribution_reports": len(attribution_reports),
        "high_risk_reports": len(high_risk),
        "latest_risk_level": str((attribution_reports[0].get("attribution") or {}).get("risk_level") or "") if attribution_reports else "",
    }
