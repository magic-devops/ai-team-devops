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


def _report_attribution(report: dict[str, Any]) -> dict[str, Any]:
    attribution = report.get("attribution")
    if isinstance(attribution, dict):
        return attribution
    metrics = report.get("metrics_snapshot")
    return analyze_metric_attribution(metrics if isinstance(metrics, dict) else {})


def aggregate_report_intelligence(reports: list[dict[str, Any]]) -> dict[str, Any]:
    enriched: list[dict[str, Any]] = []
    driver_map: dict[str, dict[str, Any]] = {}
    recommendation_map: dict[str, dict[str, Any]] = {}
    score_total = 0

    for report in reports:
        attribution = _report_attribution(report)
        score = _int(attribution.get("score"))
        score_total += score
        row = {
            "id": str(report.get("id") or ""),
            "title": str(report.get("title") or "未命名报告"),
            "score": score,
            "risk_level": str(attribution.get("risk_level") or "low"),
            "drivers": attribution.get("drivers") or [],
            "recommendations": attribution.get("recommendations") or [],
        }
        enriched.append(row)

        for driver in row["drivers"]:
            if not isinstance(driver, dict):
                continue
            factor = str(driver.get("factor") or driver.get("label") or "unknown")
            bucket = driver_map.setdefault(
                factor,
                {
                    "factor": factor,
                    "label": str(driver.get("label") or factor),
                    "impact": str(driver.get("impact") or "neutral"),
                    "count": 0,
                    "total_weight": 0,
                    "report_ids": [],
                },
            )
            bucket["count"] += 1
            bucket["total_weight"] += _int(driver.get("weight"))
            if row["id"]:
                bucket["report_ids"].append(row["id"])

        for rec in row["recommendations"]:
            if not isinstance(rec, dict):
                continue
            action_type = str(rec.get("action_type") or rec.get("title") or "follow_up")
            bucket = recommendation_map.setdefault(
                action_type,
                {
                    "action_type": action_type,
                    "title": str(rec.get("title") or "跟进报表智能建议"),
                    "detail": str(rec.get("detail") or ""),
                    "priority_hint": str(rec.get("priority_hint") or "P1"),
                    "count": 0,
                    "report_ids": [],
                },
            )
            bucket["count"] += 1
            if row["id"]:
                bucket["report_ids"].append(row["id"])

    total = len(enriched)
    high_risk = [row for row in enriched if row["risk_level"] in {"high", "critical"}]
    medium_risk = [row for row in enriched if row["risk_level"] == "medium"]
    average_score = round(score_total / total) if total else 100
    health_status = "healthy"
    if high_risk or average_score < 75:
        health_status = "risk"
    elif medium_risk or average_score < 88:
        health_status = "watch"

    top_drivers = sorted(
        driver_map.values(),
        key=lambda row: (-_int(row.get("count")), -_int(row.get("total_weight")), str(row.get("factor"))),
    )
    recommendations = sorted(
        recommendation_map.values(),
        key=lambda row: (0 if row.get("priority_hint") == "P0" else 1 if row.get("priority_hint") == "P1" else 2, -_int(row.get("count"))),
    )
    for rec in recommendations:
        rec["detail"] = rec["detail"] or f"{rec['count']} 份报告命中该类治理建议，请优先形成闭环。"

    return {
        "summary": {
            "total_reports": total,
            "attribution_reports": len([row for row in reports if isinstance(row.get("attribution"), dict)]),
            "high_risk_reports": len(high_risk),
            "medium_risk_reports": len(medium_risk),
            "low_risk_reports": len([row for row in enriched if row["risk_level"] == "low"]),
            "average_score": average_score,
        },
        "health_status": health_status,
        "top_drivers": top_drivers[:8],
        "high_risk_reports": high_risk[:10],
        "recommendations": recommendations[:8],
        "agent_consumption": {
            "api": "/api/v1/analytics/reports/intelligence",
            "suggested_actions": [
                "读取 summary 判断报表运营健康",
                "按 top_drivers 定位高频风险因子",
                "调用 /api/v1/analytics/reports/intelligence/tasks 将建议任务化",
            ],
        },
    }


def build_report_intelligence_tasks(intelligence: dict[str, Any], *, priority: str = "P1", assigned_to: str = "DataOps", dev_tool: str = "codex") -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    summary = intelligence.get("summary") if isinstance(intelligence.get("summary"), dict) else {}
    for index, rec in enumerate(intelligence.get("recommendations") or [], start=1):
        title = str(rec.get("title") or "跟进报表智能建议")
        report_ids = [str(x) for x in rec.get("report_ids", []) if str(x).strip()]
        tasks.append({
            "title": f"治理报表智能风险：{title}",
            "description": "\n".join([
                f"运营状态：{intelligence.get('health_status', 'watch')}",
                f"平均健康分：{summary.get('average_score', 0)}",
                f"高风险报告：{summary.get('high_risk_reports', 0)} / {summary.get('total_reports', 0)}",
                f"建议类型：{rec.get('action_type', '-')}",
                f"建议详情：{rec.get('detail', '')}",
                f"关联报告：{', '.join(report_ids) if report_ids else '-'}",
                "",
                "请完成报表归因治理、修复动作和验证证据回填。",
            ]),
            "priority": priority or str(rec.get("priority_hint") or "P1"),
            "estimate": "M" if index <= 2 else "S",
            "assigned_to": assigned_to or "DataOps",
            "dev_tool": dev_tool or "codex",
            "source": "analytics_report_intelligence",
            "source_report_id": f"report-intelligence-{index}",
            "source_report_title": title,
        })
    return tasks


def build_decision_attribution_engine(
    reports: list[dict[str, Any]],
    *,
    question: str = "",
    include_evidence: bool = True,
    max_reports: int = 10,
) -> dict[str, Any]:
    intelligence = aggregate_report_intelligence(reports)
    summary = intelligence.get("summary") if isinstance(intelligence.get("summary"), dict) else {}
    top_drivers = [row for row in intelligence.get("top_drivers") or [] if isinstance(row, dict)]
    recommendations = [row for row in intelligence.get("recommendations") or [] if isinstance(row, dict)]
    high_risk_reports = [row for row in intelligence.get("high_risk_reports") or [] if isinstance(row, dict)]

    total_reports = _int(summary.get("total_reports"))
    high_risk_count = _int(summary.get("high_risk_reports"))
    average_score = _int(summary.get("average_score")) if total_reports else 100
    negative_driver_weight = sum(_int(row.get("total_weight")) for row in top_drivers if row.get("impact") == "negative")
    high_risk_penalty = min(28, high_risk_count * 7)
    driver_penalty = min(22, round(negative_driver_weight / max(total_reports, 1) / 5))
    decision_score = max(0, min(100, round(average_score - high_risk_penalty - driver_penalty + (6 if total_reports >= 3 else 0))))

    decision_status = "go"
    if high_risk_count or decision_score < 70:
        decision_status = "block"
    elif recommendations or decision_score < 85:
        decision_status = "watch"

    confidence = 0.92 if total_reports >= 5 else 0.84 if total_reports >= 2 else 0.68
    decision_text = {
        "go": "可继续推进",
        "watch": "建议带风险推进",
        "block": "建议先阻断治理",
    }[decision_status]

    evidence: list[dict[str, Any]] = []
    if include_evidence:
        for report in high_risk_reports[:max_reports]:
            evidence.append(
                {
                    "type": "report",
                    "id": report.get("id"),
                    "title": report.get("title"),
                    "risk_level": report.get("risk_level"),
                    "score": report.get("score"),
                    "drivers": [str(x.get("label") or x.get("factor")) for x in report.get("drivers", []) if isinstance(x, dict)][:4],
                }
            )
        for driver in top_drivers[:5]:
            evidence.append(
                {
                    "type": "driver",
                    "id": driver.get("factor"),
                    "title": driver.get("label") or driver.get("factor"),
                    "impact": driver.get("impact"),
                    "count": driver.get("count"),
                    "report_ids": driver.get("report_ids") or [],
                }
            )

    actions: list[dict[str, Any]] = []
    for index, rec in enumerate(recommendations[:6], start=1):
        actions.append(
            {
                "id": f"decision-action-{index}",
                "title": rec.get("title") or "跟进智能决策建议",
                "detail": rec.get("detail") or "请按关联报告和归因证据形成治理闭环。",
                "action_type": rec.get("action_type") or "follow_up",
                "priority_hint": rec.get("priority_hint") or ("P0" if decision_status == "block" else "P1"),
                "report_ids": rec.get("report_ids") or [],
            }
        )
    if not actions:
        actions.append(
            {
                "id": "decision-action-monitor",
                "title": "保持洞察订阅与决策巡检",
                "detail": "当前未发现需要阻断的高风险决策项，建议持续发布洞察报告并保留证据。",
                "action_type": "monitor",
                "priority_hint": "P3",
                "report_ids": [],
            }
        )

    answer_lines = [
        f"决策结论：{decision_text}。",
        f"决策分 {decision_score}，置信度 {round(confidence * 100)}%，覆盖报告 {total_reports} 份。",
        f"高风险报告 {high_risk_count} 份，平均健康分 {average_score}。",
    ]
    if question.strip():
        answer_lines.insert(0, f"问题：{question.strip()}")
    if top_drivers:
        answer_lines.append("关键归因：" + "、".join(str(row.get("label") or row.get("factor")) for row in top_drivers[:3]))
    if actions:
        answer_lines.append("下一步：" + "；".join(str(row.get("title")) for row in actions[:3]))

    return {
        "decision": {
            "status": decision_status,
            "label": decision_text,
            "score": decision_score,
            "confidence": confidence,
            "question": question.strip(),
        },
        "summary": {
            "total_reports": total_reports,
            "high_risk_reports": high_risk_count,
            "average_score": average_score,
            "top_driver_count": len(top_drivers),
            "action_count": len(actions),
            "evidence_count": len(evidence),
        },
        "answer": "\n".join(answer_lines),
        "top_drivers": top_drivers[:8],
        "actions": actions,
        "evidence": evidence,
        "intelligence": intelligence,
        "agent_consumption": {
            "api": "/api/v1/analytics/decision/overview",
            "contract": "decision + summary + evidence + actions",
            "suggested_actions": [
                "按 decision.status 判断继续推进、关注或阻断治理",
                "读取 evidence 定位报告和归因驱动",
                "调用 /api/v1/analytics/decision/tasks 预览或生成治理任务",
            ],
        },
    }


def build_decision_tasks(
    decision_packet: dict[str, Any],
    *,
    priority: str = "",
    assigned_to: str = "DataOps",
    dev_tool: str = "codex",
    max_tasks: int = 5,
) -> list[dict[str, Any]]:
    decision = decision_packet.get("decision") if isinstance(decision_packet.get("decision"), dict) else {}
    actions = [row for row in decision_packet.get("actions") or [] if isinstance(row, dict)]
    out: list[dict[str, Any]] = []
    for index, action in enumerate(actions[:max_tasks], start=1):
        report_ids = [str(x) for x in action.get("report_ids", []) if str(x).strip()]
        effective_priority = priority or str(action.get("priority_hint") or ("P0" if decision.get("status") == "block" else "P1"))
        out.append(
            {
                "title": f"执行智能决策治理：{action.get('title') or '跟进建议'}",
                "description": "\n".join(
                    [
                        f"决策状态：{decision.get('label') or decision.get('status') or 'watch'}",
                        f"决策分：{decision.get('score', 0)}，置信度：{round(float(decision.get('confidence') or 0) * 100)}%",
                        f"治理类型：{action.get('action_type') or '-'}",
                        f"治理说明：{action.get('detail') or ''}",
                        f"关联报告：{', '.join(report_ids) if report_ids else '-'}",
                        "",
                        "请根据归因证据完成治理、验证和结果回填，必要时联动需求/任务/质量模块。",
                    ]
                ),
                "priority": effective_priority,
                "estimate": "M" if index <= 2 else "S",
                "assigned_to": assigned_to or "DataOps",
                "dev_tool": dev_tool or "codex",
                "source": "analytics_decision_attribution",
                "source_report_id": ",".join(report_ids) if report_ids else f"decision-action-{index}",
                "source_report_title": str(action.get("title") or "智能决策归因"),
            }
        )
    return out


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
