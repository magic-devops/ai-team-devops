"""Pure helpers for Hermes A2A protocol governance."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def normalize_capabilities(values: list[str] | tuple[str, ...] | None) -> list[str]:
    seen: set[str] = set()
    out: list[str] = []
    for raw in values or []:
        cap = str(raw or "").strip().lower().replace(" ", ".")
        if not cap or cap in seen:
            continue
        seen.add(cap)
        out.append(cap)
    return out


def _num(value: Any, default: float) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _text_tokens(*parts: Any) -> set[str]:
    text = " ".join(str(part or "").lower() for part in parts)
    for ch in ",.;:()[]{}|/\\_-":
        text = text.replace(ch, " ")
    return {token for token in text.split() if len(token) >= 3}


def score_agent_match(agent: dict[str, Any], task: dict[str, Any]) -> dict[str, Any]:
    required = normalize_capabilities(task.get("required_capabilities") or [])
    caps = normalize_capabilities(agent.get("capabilities") or [])
    cap_set = set(caps)
    required_set = set(required)
    matched = sorted(cap_set & required_set)
    missing = sorted(required_set - cap_set)
    coverage = len(matched) / len(required) if required else 0.55

    task_tokens = _text_tokens(task.get("task_type"), task.get("task_description"))
    agent_tokens = _text_tokens(agent.get("name"), agent.get("agent_type"), " ".join(caps))
    semantic_bonus = min(len(task_tokens & agent_tokens) * 0.04, 0.16)

    success_rate = max(0.0, min(_num(agent.get("success_rate"), 0.8), 1.0))
    load = max(0.0, _num(agent.get("load"), 0.0))
    load_penalty = min(load * 0.04, 0.24)
    status_penalty = 0.35 if str(agent.get("status") or "active") != "active" else 0.0
    priority = str(task.get("priority") or "").upper()
    priority_penalty = 0.08 if priority in {"P0", "P1"} and missing else 0.0

    confidence = coverage * 0.62 + success_rate * 0.26 + semantic_bonus - load_penalty - status_penalty - priority_penalty
    confidence = max(0.0, min(confidence, 0.99))
    risk_level = "low"
    if status_penalty or confidence < 0.45 or (priority == "P0" and missing):
        risk_level = "high"
    elif missing or confidence < 0.75 or load >= 4:
        risk_level = "medium"
    decision = "recommended" if confidence >= 0.75 and risk_level == "low" else "needs_review"
    if confidence < 0.2 and not matched:
        decision = "not_recommended"

    return {
        "agent_id": str(agent.get("id") or ""),
        "name": str(agent.get("name") or agent.get("id") or ""),
        "agent_type": str(agent.get("agent_type") or "custom"),
        "confidence": round(confidence, 2),
        "decision": decision,
        "risk_level": risk_level,
        "matched_capabilities": matched,
        "missing_capabilities": missing,
        "load": load,
        "success_rate": round(success_rate, 2),
        "reason": _match_reason(matched, missing, confidence, risk_level),
    }


def _match_reason(matched: list[str], missing: list[str], confidence: float, risk_level: str) -> str:
    if missing:
        return f"匹配 {len(matched)} 项能力，缺少 {', '.join(missing[:3])}，风险 {risk_level}。"
    if matched:
        return f"能力完全覆盖，综合置信度 {round(confidence * 100)}%。"
    return f"未声明强制能力，按 Agent 健康与语义相关性给出置信度 {round(confidence * 100)}%。"


def build_protocol_packet(dispatch: dict[str, Any], agent: dict[str, Any], scope: dict[str, Any]) -> dict[str, Any]:
    payload = dispatch.get("payload") if isinstance(dispatch.get("payload"), dict) else {}
    dispatch_id = str(dispatch.get("id") or "")
    run_id = str(dispatch.get("agent_run_id") or dispatch_id)
    return {
        "protocol": "hermes-a2a",
        "version": "1.0",
        "dispatch_id": dispatch_id,
        "run_id": run_id,
        "task_id": str(dispatch.get("task_id") or payload.get("task_id") or ""),
        "scope": dict(scope),
        "agent": {
            "id": str(agent.get("id") or dispatch.get("agent_id") or ""),
            "name": str(agent.get("name") or ""),
            "endpoint": str(agent.get("endpoint") or ""),
            "capabilities": normalize_capabilities(agent.get("capabilities") or []),
        },
        "payload": payload,
        "callbacks": {
            "run_heartbeat": f"/api/v1/agent-runs/{run_id}/heartbeat",
            "heartbeat": f"/api/v1/a2a/dispatch/{run_id}/heartbeat",
            "evidence": "/api/v1/a2a/evidence",
            "audit": "/api/v1/audit/events",
        },
        "quality_gates": [
            {"id": "evidence.required", "name": "执行证据回写", "required": True},
            {"id": "confidence.minimum", "name": "置信度不低于 0.7", "required": True, "threshold": 0.7},
            {"id": "artifact.traceable", "name": "产物路径或说明可追溯", "required": True},
        ],
        "report_schema": {
            "status": "success|failed|blocked",
            "confidence": "0..1",
            "artifact": {"summary": "string", "files": ["path"], "links": ["url"]},
            "quality_gate_results": [{"id": "string", "passed": True, "detail": "string"}],
        },
        "created_at": _now(),
    }


def evaluate_evidence_quality(evidence: dict[str, Any]) -> dict[str, Any]:
    artifact = evidence.get("artifact") if isinstance(evidence.get("artifact"), dict) else {}
    confidence = _num(evidence.get("confidence"), 0.0)
    status = str(evidence.get("status") or "").lower()
    gates = evidence.get("quality_gate_results") if isinstance(evidence.get("quality_gate_results"), list) else []
    missing: list[str] = []
    if status not in {"success", "failed", "blocked", "cancelled"}:
        missing.append("status")
    if confidence < 0.7:
        missing.append("confidence>=0.7")
    if not artifact:
        missing.append("artifact")
    if not gates:
        missing.append("quality_gate_results")
    score = 100 - len(missing) * 18
    if status == "failed":
        score -= 12
    return {
        "score": max(0, score),
        "status": "complete" if not missing else "incomplete",
        "missing": missing,
    }


def summarize_a2a_health(registry: list[dict[str, Any]], dispatches: list[dict[str, Any]]) -> dict[str, Any]:
    active = [a for a in registry if str(a.get("status") or "active") == "active"]
    evidence = [d for d in dispatches if d.get("evidence_at")]
    linked_agent_runs = [d for d in dispatches if d.get("agent_run_id")]
    pending_evidence = [d for d in dispatches if not d.get("evidence_at") and str(d.get("status") or "") == "dispatched"]
    cap_counts: dict[str, int] = {}
    empty_profile = 0
    for agent in registry:
        caps = normalize_capabilities(agent.get("capabilities") or [])
        if not caps:
            empty_profile += 1
        for cap in caps:
            cap_counts[cap] = cap_counts.get(cap, 0) + 1
    risks: list[dict[str, Any]] = []
    if registry and not active:
        risks.append({"level": "critical", "title": "没有活跃 A2A Agent", "recommendation": "启用至少一个 Agent 或检查心跳状态。"})
    if pending_evidence:
        risks.append({"level": "high", "title": "存在未回写证据的分发任务", "recommendation": "追踪 Agent 执行结果并补齐证据。", "count": len(pending_evidence)})
    if empty_profile:
        risks.append({"level": "medium", "title": "存在无能力画像 Agent", "recommendation": "补齐能力画像，避免协商结果不可解释。", "count": empty_profile})
    failed = [d for d in dispatches if str(d.get("status") or "").lower() == "failed"]
    if failed:
        risks.append({"level": "medium", "title": "存在失败的 A2A 执行", "recommendation": "分析失败证据并重新分派给更匹配的 Agent。", "count": len(failed)})

    health = 100
    for risk in risks:
        level = str(risk.get("level") or "")
        health -= {"critical": 35, "high": 22, "medium": 12, "low": 6}.get(level, 5)
    return {
        "registered_agents": len(registry),
        "active": len(active),
        "paused": len(registry) - len(active),
        "dispatched_tasks": len(dispatches),
        "linked_agent_runs": len(linked_agent_runs),
        "evidence_received": len(evidence),
        "pending_evidence": len(pending_evidence),
        "failed": len(failed),
        "health_score": max(0, health),
        "risks": risks,
        "capability_coverage": {
            "total_capabilities": len(cap_counts),
            "top_capabilities": sorted(
                [{"capability": key, "agents": value} for key, value in cap_counts.items()],
                key=lambda item: (-item["agents"], item["capability"]),
            )[:8],
        },
        "recommendations": [str(r.get("recommendation") or "") for r in risks[:5]],
    }


def build_a2a_governance_tasks(summary: dict[str, Any]) -> list[dict[str, Any]]:
    priority_by_level = {"critical": "P0", "high": "P0", "medium": "P1", "low": "P2"}
    tasks: list[dict[str, Any]] = []
    for idx, risk in enumerate(summary.get("risks") or [], start=1):
        level = str(risk.get("level") or "medium")
        title = str(risk.get("title") or "A2A 协议治理")
        tasks.append(
            {
                "title": f"A2A 协议治理：{title}",
                "description": "\n".join(
                    [
                        f"风险等级：{level}",
                        f"健康分：{summary.get('health_score', 0)}",
                        f"建议：{risk.get('recommendation') or '补齐 A2A 协议治理动作。'}",
                    ]
                ),
                "priority": priority_by_level.get(level, "P1"),
                "estimate": "S" if level in {"low", "medium"} else "M",
                "assigned_to": "Agent Platform",
                "dev_tool": "codex",
                "source": "a2a_protocol_governance",
                "source_report_id": f"a2a-risk-{idx}",
                "source_report_title": title,
            }
        )
    return tasks
