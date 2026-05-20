"""Pure helpers for LLM Gateway routing, cost and governance."""
from __future__ import annotations

from typing import Any


PRICE_CATALOG_USD_PER_1K = {
    "gpt-5": {"input": 0.005, "output": 0.015},
    "gpt-5-mini": {"input": 0.0015, "output": 0.004},
    "gpt-4.1": {"input": 0.005, "output": 0.015},
    "gpt-4.1-mini": {"input": 0.001, "output": 0.004},
    "claude-sonnet": {"input": 0.003, "output": 0.015},
    "claude-haiku": {"input": 0.0008, "output": 0.004},
    "default": {"input": 0.002, "output": 0.008},
}


def _num(value: Any, default: float = 0.0) -> float:
    try:
        return float(value)
    except Exception:
        return default


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _price_for(model_id: str) -> dict[str, float]:
    mid = str(model_id or "").lower()
    for key, price in PRICE_CATALOG_USD_PER_1K.items():
        if key != "default" and key in mid:
            return price
    return PRICE_CATALOG_USD_PER_1K["default"]


def estimate_invocation_cost(model_id: str, prompt_tokens: int, completion_tokens: int) -> dict[str, Any]:
    prompt = max(0, _int(prompt_tokens))
    completion = max(0, _int(completion_tokens))
    price = _price_for(model_id)
    cost = (prompt / 1000.0) * price["input"] + (completion / 1000.0) * price["output"]
    return {
        "model_id": str(model_id or ""),
        "estimated_prompt_tokens": prompt,
        "estimated_completion_tokens": completion,
        "estimated_tokens": prompt + completion,
        "estimated_cost_usd": round(cost, 6),
        "pricing": price,
    }


def _usage_for_model(usage: list[dict[str, Any]], model_id: str) -> dict[str, int]:
    requests = 0
    tokens = 0
    for row in usage:
        if str(row.get("model_id") or "") != model_id:
            continue
        requests += 1
        tokens += _int(row.get("prompt_tokens")) + _int(row.get("completion_tokens"))
    return {"requests": requests, "tokens": tokens}


def _throttle_for(throttles: list[dict[str, Any]], model_id: str) -> dict[str, Any] | None:
    enabled = [row for row in throttles if str(row.get("model_id") or "") == model_id and bool(row.get("enabled", True))]
    if not enabled:
        return None
    return sorted(enabled, key=lambda row: str(row.get("created_at") or ""), reverse=True)[0]


def evaluate_throttle(model_id: str, estimated_tokens: int, throttles: list[dict[str, Any]], usage: list[dict[str, Any]]) -> dict[str, Any]:
    rule = _throttle_for(throttles, model_id)
    if not rule:
        return {
            "model_id": model_id,
            "allowed": True,
            "protected": False,
            "risk_level": "low",
            "reason": "未配置 RPM/TPM 限流，允许但建议补齐保护。",
        }
    current = _usage_for_model(usage, model_id)
    rpm_limit = max(0, _int(rule.get("rpm_limit")))
    tpm_limit = max(0, _int(rule.get("tpm_limit")))
    projected_requests = current["requests"] + 1
    projected_tokens = current["tokens"] + max(0, estimated_tokens)
    blocked_reasons: list[str] = []
    if rpm_limit and projected_requests > rpm_limit:
        blocked_reasons.append(f"RPM {projected_requests}/{rpm_limit}")
    if tpm_limit and projected_tokens > tpm_limit:
        blocked_reasons.append(f"TPM {projected_tokens}/{tpm_limit}")
    if blocked_reasons:
        return {
            "model_id": model_id,
            "allowed": False,
            "protected": True,
            "risk_level": "high",
            "reason": "超过限流阈值：" + "，".join(blocked_reasons),
            "usage": current,
            "rule": rule,
        }
    ratio = max(
        projected_requests / rpm_limit if rpm_limit else 0,
        projected_tokens / tpm_limit if tpm_limit else 0,
    )
    risk = "medium" if ratio >= 0.8 else "low"
    return {
        "model_id": model_id,
        "allowed": True,
        "protected": True,
        "risk_level": risk,
        "reason": f"限流余量正常，预计占用 {round(ratio * 100)}%。",
        "usage": current,
        "rule": rule,
    }


def _candidate_routes(task_type: str, routes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enabled = [row for row in routes if bool(row.get("enabled", True))]
    exact = [row for row in enabled if str(row.get("task_type") or "general") == task_type]
    general = [row for row in enabled if str(row.get("task_type") or "general") == "general"]
    candidates = exact or general or enabled
    return sorted(candidates, key=lambda row: _int(row.get("priority")), reverse=True)


def select_llm_route(task: dict[str, Any], routes: list[dict[str, Any]], throttles: list[dict[str, Any]], usage: list[dict[str, Any]]) -> dict[str, Any]:
    task_type = str(task.get("task_type") or "general")
    prompt = max(0, _int(task.get("estimated_prompt_tokens")))
    completion = max(0, _int(task.get("estimated_completion_tokens")))
    estimated_tokens = prompt + completion
    candidates = _candidate_routes(task_type, routes)
    if not candidates:
        return {
            "status": "blocked",
            "task_type": task_type,
            "route_id": "",
            "selected_model_id": "",
            "primary_model_id": "",
            "fallback_model_id": "",
            "fallback_applied": False,
            "risk_level": "high",
            "reason": "没有可用模型路由。",
            "cost": estimate_invocation_cost("", prompt, completion),
        }

    attempts: list[dict[str, Any]] = []
    for route in candidates:
        primary = str(route.get("model_id") or "")
        fallback = str(route.get("fallback_model_id") or "")
        for model_id, fallback_applied in ((primary, False), (fallback, True)):
            if not model_id:
                continue
            throttle = evaluate_throttle(model_id, estimated_tokens, throttles, usage)
            attempts.append({"route_id": route.get("id"), "model_id": model_id, "fallback_applied": fallback_applied, "throttle": throttle})
            if throttle["allowed"]:
                risk = throttle["risk_level"]
                if fallback_applied and risk == "low":
                    risk = "medium"
                return {
                    "status": "allowed",
                    "task_type": task_type,
                    "route_id": str(route.get("id") or ""),
                    "route_name": str(route.get("name") or ""),
                    "selected_model_id": model_id,
                    "primary_model_id": primary,
                    "fallback_model_id": fallback,
                    "fallback_applied": fallback_applied,
                    "risk_level": risk,
                    "reason": ("主模型触发限流，已切换 fallback。" if fallback_applied else "命中可用模型路由。") + f" {throttle['reason']}",
                    "cost": estimate_invocation_cost(model_id, prompt, completion),
                    "attempts": attempts,
                }

    first = candidates[0]
    return {
        "status": "blocked",
        "task_type": task_type,
        "route_id": str(first.get("id") or ""),
        "route_name": str(first.get("name") or ""),
        "selected_model_id": "",
        "primary_model_id": str(first.get("model_id") or ""),
        "fallback_model_id": str(first.get("fallback_model_id") or ""),
        "fallback_applied": False,
        "risk_level": "high",
        "reason": "主模型与 fallback 均不可用或触发限流。",
        "cost": estimate_invocation_cost(str(first.get("model_id") or ""), prompt, completion),
        "attempts": attempts,
    }


def summarize_gateway_health(routes: list[dict[str, Any]], throttles: list[dict[str, Any]], usage: list[dict[str, Any]]) -> dict[str, Any]:
    active_routes = [row for row in routes if bool(row.get("enabled", True))]
    protected_models = {str(row.get("model_id") or "") for row in throttles if bool(row.get("enabled", True))}
    route_models = {str(row.get("model_id") or "") for row in active_routes if row.get("model_id")}
    latencies = [_int(row.get("latency_ms")) for row in usage if row.get("latency_ms") is not None]
    total_tokens = sum(_int(row.get("prompt_tokens")) + _int(row.get("completion_tokens")) for row in usage)
    total_cost = round(sum(_num(row.get("cost_usd")) for row in usage), 6)
    avg_latency = round(sum(latencies) / len(latencies), 1) if latencies else 0
    risks: list[dict[str, Any]] = []
    missing_fallback = [row for row in active_routes if not str(row.get("fallback_model_id") or "")]
    unprotected = sorted(model for model in route_models if model not in protected_models)
    if not active_routes:
        risks.append({"level": "critical", "title": "没有启用模型路由", "recommendation": "至少配置一个 general 路由，避免 Copilot/Agent 调用失败。"})
    if missing_fallback:
        risks.append({"level": "high", "title": "模型路由缺少 fallback", "recommendation": "为关键路由配置备用模型，降低主模型故障和限流风险。", "count": len(missing_fallback)})
    if unprotected:
        risks.append({"level": "medium", "title": "模型缺少限流保护", "recommendation": "为路由模型配置 RPM/TPM，避免成本或请求峰值失控。", "models": unprotected[:5]})
    if avg_latency >= 3000:
        risks.append({"level": "medium", "title": "模型平均延迟偏高", "recommendation": "检查慢模型、fallback 策略和长上下文请求。", "avg_latency_ms": avg_latency})
    health = 100
    for risk in risks:
        health -= {"critical": 35, "high": 22, "medium": 12, "low": 6}.get(str(risk.get("level")), 8)
    return {
        "total_requests": len(usage),
        "total_tokens": total_tokens,
        "total_cost_usd": total_cost,
        "avg_latency_ms": avg_latency,
        "active_routes": len(active_routes),
        "throttle_rules": len(throttles),
        "health_score": max(0, health),
        "risks": risks,
        "recommendations": [str(risk.get("recommendation") or "") for risk in risks[:5]],
        "route_coverage": {
            "active_routes": len(active_routes),
            "routes_without_fallback": len(missing_fallback),
            "unprotected_models": unprotected,
        },
    }


def build_gateway_governance_tasks(summary: dict[str, Any]) -> list[dict[str, Any]]:
    priority_by_level = {"critical": "P0", "high": "P0", "medium": "P1", "low": "P2"}
    tasks: list[dict[str, Any]] = []
    for idx, risk in enumerate(summary.get("risks") or [], start=1):
        level = str(risk.get("level") or "medium")
        title = str(risk.get("title") or "模型网关治理")
        tasks.append(
            {
                "title": f"LLM Gateway 治理：{title}",
                "description": "\n".join(
                    [
                        f"风险等级：{level}",
                        f"健康分：{summary.get('health_score', 0)}",
                        f"建议：{risk.get('recommendation') or '补齐模型网关治理动作。'}",
                    ]
                ),
                "priority": priority_by_level.get(level, "P1"),
                "estimate": "S" if level in {"low", "medium"} else "M",
                "assigned_to": "AI Platform",
                "dev_tool": "codex",
                "source": "llm_gateway_governance",
                "source_report_id": f"llm-risk-{idx}",
                "source_report_title": title,
            }
        )
    return tasks
