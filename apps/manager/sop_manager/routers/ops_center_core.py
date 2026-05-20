"""Pure helpers for OpsCenter self-healing decisions."""
from __future__ import annotations

import operator
import re
from typing import Any

_OPS = {
    ">": operator.gt,
    ">=": operator.ge,
    "<": operator.lt,
    "<=": operator.le,
    "==": operator.eq,
    "=": operator.eq,
    "!=": operator.ne,
}

_COND_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*(>=|<=|==|!=|>|<|=)\s*([A-Za-z0-9_.:/-]+)\s*$")
_DESTRUCTIVE_ACTIONS = ("rollback", "delete", "drop", "shutdown", "scale_down", "disable")
_SAFE_ACTIONS = ("restart", "scale_out", "clear_cache", "rotate", "notify")


def _num(value: Any) -> float | None:
    try:
        return float(value)
    except Exception:
        return None


def _lookup(signals: dict[str, Any], key: str) -> Any:
    current: Any = signals
    for part in key.split("."):
        if isinstance(current, dict) and part in current:
            current = current[part]
        else:
            return None
    return current


def evaluate_condition(condition: str, signals: dict[str, Any]) -> tuple[bool, dict[str, Any]]:
    m = _COND_RE.match(condition or "")
    if not m:
        text = (condition or "").strip().lower()
        blob = " ".join(f"{k}={v}" for k, v in signals.items()).lower()
        matched = bool(text and text in blob)
        return matched, {"condition": condition, "mode": "contains", "actual": blob[:200]}
    key, op, expected_raw = m.groups()
    actual = _lookup(signals, key)
    if actual is None:
        return False, {"condition": condition, "metric": key, "operator": op, "expected": expected_raw, "actual": None}
    actual_num = _num(actual)
    expected_num = _num(expected_raw)
    if actual_num is not None and expected_num is not None:
        matched = _OPS[op](actual_num, expected_num)
    else:
        matched = _OPS[op](str(actual), str(expected_raw))
    return bool(matched), {"condition": condition, "metric": key, "operator": op, "expected": expected_raw, "actual": actual}


def _risk_level(action: str, signals: dict[str, Any], open_rca: int, has_runbook: bool, evidence: dict[str, Any] | None = None) -> str:
    action_l = (action or "").lower()
    env = str(signals.get("environment") or signals.get("env") or "").lower()
    if env == "production" and any(token in action_l for token in _DESTRUCTIVE_ACTIONS):
        return "critical"
    metric = str((evidence or {}).get("metric") or "").lower()
    actual = _num((evidence or {}).get("actual"))
    expected = _num((evidence or {}).get("expected"))
    if metric in ("cpu", "memory", "error_rate", "latency_ms") and actual is not None and expected is not None:
        if actual >= expected:
            return "high"
    if open_rca > 0 or any(token in action_l for token in _DESTRUCTIVE_ACTIONS):
        return "high"
    if not has_runbook and not any(token in action_l for token in _SAFE_ACTIONS):
        return "medium"
    return "low"


def _decision_for(risk: str) -> str:
    if risk == "critical":
        return "needs_approval"
    if risk == "high":
        return "ready"
    return "ready"


def _match_runbooks(action: str, runbooks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    action_l = (action or "").lower()
    out: list[dict[str, Any]] = []
    for rb in runbooks:
        blob = " ".join(
            [
                str(rb.get("name") or ""),
                " ".join(str(x) for x in rb.get("tags") or []),
                " ".join(str(x) for x in rb.get("steps") or []),
            ]
        ).lower()
        if any(part and part in blob for part in re.split(r"[_\s-]+", action_l)):
            out.append(rb)
    return out[:3]


def _decision_steps(action: str, risk: str, runbooks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    steps = [
        {"id": "observe", "title": "确认监控信号仍在触发阈值内", "type": "check"},
        {"id": "scope", "title": "确认 tenant_code / business_code / project_id 作用域无误", "type": "guard"},
    ]
    if not runbooks:
        steps.append({"id": "runbook", "title": "补齐或绑定 Runbook 后再自动执行高风险动作", "type": "guard"})
    else:
        for idx, rb in enumerate(runbooks, start=1):
            steps.append({"id": f"runbook-{idx}", "title": f"按 Runbook 执行：{rb.get('name')}", "type": "runbook", "runbook_id": rb.get("id")})
    steps.append({"id": "execute", "title": f"执行自愈动作：{action}", "type": "action"})
    if risk in ("high", "critical"):
        steps.append({"id": "verify", "title": "执行后回查指标、流水线和 RCA 状态", "type": "verify"})
    return steps


def evaluate_self_heal(
    policies: list[dict[str, Any]],
    signals: dict[str, Any],
    rca: list[dict[str, Any]],
    pipelines: list[dict[str, Any]],
    runbooks: list[dict[str, Any]],
) -> dict[str, Any]:
    open_rca = [item for item in rca if item.get("status") == "open"]
    failed_pipelines = [item for item in pipelines if item.get("status") in ("failed", "error")]
    decisions: list[dict[str, Any]] = []
    for policy in policies:
        if not policy.get("enabled", True):
            continue
        matched, evidence = evaluate_condition(str(policy.get("trigger_condition") or ""), signals)
        if not matched:
            continue
        matched_runbooks = _match_runbooks(str(policy.get("action") or ""), runbooks)
        risk = _risk_level(str(policy.get("action") or ""), signals, len(open_rca), bool(matched_runbooks), evidence)
        decisions.append(
            {
                "policy_id": policy.get("id") or "",
                "trigger_condition": policy.get("trigger_condition") or "",
                "action": policy.get("action") or "",
                "decision": _decision_for(risk),
                "risk_level": risk,
                "evidence": {
                    **evidence,
                    "open_rca": len(open_rca),
                    "failed_pipelines": len(failed_pipelines),
                    "environment": signals.get("environment") or signals.get("env") or "",
                },
                "runbooks": matched_runbooks,
                "steps": _decision_steps(str(policy.get("action") or ""), risk, matched_runbooks),
            }
        )
    severity_order = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    decisions.sort(key=lambda item: severity_order.get(str(item.get("risk_level")), 0), reverse=True)
    return {
        "ok": True,
        "signals": signals,
        "summary": {
            "policies": len(policies),
            "matched": len(decisions),
            "ready": sum(1 for item in decisions if item.get("decision") == "ready"),
            "needs_approval": sum(1 for item in decisions if item.get("decision") == "needs_approval"),
            "critical": sum(1 for item in decisions if item.get("risk_level") == "critical"),
            "high": sum(1 for item in decisions if item.get("risk_level") == "high"),
        },
        "decisions": decisions,
    }


def build_self_heal_tasks(
    evaluation: dict[str, Any],
    *,
    dry_run: bool,
    priority: str,
    assigned_to: str,
    dev_tool: str,
) -> dict[str, Any]:
    tasks: list[dict[str, Any]] = []
    for decision in evaluation.get("decisions") or []:
        risk = str(decision.get("risk_level") or "medium")
        tasks.append(
            {
                "title": f"处置自愈策略：{decision.get('trigger_condition')}",
                "description": "\n".join(
                    [
                        "Hermes 智能运维自愈治理任务。",
                        "",
                        f"Policy: {decision.get('policy_id')}",
                        f"Decision: {decision.get('decision')}",
                        f"Risk: {risk}",
                        f"Action: {decision.get('action')}",
                        "",
                        "Steps:",
                        *[f"- {step.get('title')}" for step in decision.get("steps") or []],
                    ]
                ),
                "priority": "P0" if risk == "critical" else priority,
                "estimate": "S",
                "assigned_to": assigned_to,
                "dev_tool": dev_tool,
                "source": "ops_center_self_heal",
                "source_report_id": str(decision.get("policy_id") or ""),
                "source_report_title": str(decision.get("trigger_condition") or ""),
                "debug_notes": f"ops_self_heal policy={decision.get('policy_id')} decision={decision.get('decision')} risk={risk}",
            }
        )
    return {
        "ok": True,
        "dry_run": dry_run,
        "summary": {"planned": len(tasks), "created": 0 if dry_run else len(tasks)},
        "tasks": tasks,
        "items": tasks,
    }


def summarize_ops_health(
    *,
    pipelines: list[dict[str, Any]],
    rca: list[dict[str, Any]],
    runbooks: list[dict[str, Any]],
    self_heal: list[dict[str, Any]],
    evaluations: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    failed = sum(1 for item in pipelines if item.get("status") in ("failed", "error"))
    running = sum(1 for item in pipelines if item.get("status") == "running")
    open_rca = sum(1 for item in rca if item.get("status") == "open")
    active = sum(1 for item in self_heal if item.get("enabled"))
    evals = evaluations or []
    needs_approval = sum(int((item.get("summary") or {}).get("needs_approval") or 0) for item in evals)
    matched = sum(int((item.get("summary") or {}).get("matched") or 0) for item in evals)
    score = 100 - failed * 18 - open_rca * 12 - needs_approval * 10
    if not runbooks:
        score -= 8
    if active == 0:
        score -= 6
    recommendations: list[str] = []
    if failed:
        recommendations.append("存在失败流水线，建议生成 RCA 并绑定回滚/重启 Runbook。")
    if open_rca:
        recommendations.append("存在未关闭 RCA，建议补齐解决方案并沉淀自愈策略。")
    if not runbooks:
        recommendations.append("Runbook 为空，高风险自愈动作会进入审批态。")
    if active == 0:
        recommendations.append("暂无启用自愈策略，建议至少覆盖 CPU、错误率、延迟三类常见信号。")
    if needs_approval:
        recommendations.append("存在需要审批的自愈决策，请确认生产环境动作边界。")
    return {
        "health_score": max(0, min(100, score)),
        "pipelines": len(pipelines),
        "pipelines_running": running,
        "pipelines_failed": failed,
        "rca_open": open_rca,
        "runbooks": len(runbooks),
        "self_heal_active": active,
        "self_heal_matched": matched,
        "self_heal_needs_approval": needs_approval,
        "recommendations": recommendations[:8],
    }
