"""Pure helpers for LLM Gateway routing, cost and governance."""
from __future__ import annotations

import hashlib
import re
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


def _active_policy(policies: list[dict[str, Any]]) -> dict[str, Any]:
    enabled = [row for row in policies if bool(row.get("enabled", True))]
    policy = sorted(enabled, key=lambda row: str(row.get("updated_at") or row.get("created_at") or ""), reverse=True)[0] if enabled else {}
    return {
        "id": policy.get("id") or "default",
        "enabled": bool(policy.get("enabled", True)),
        "daily_budget_usd": max(0.0, _num(policy.get("daily_budget_usd"), 0.0)),
        "block_on_budget": bool(policy.get("block_on_budget", True)),
        "require_provider_health": bool(policy.get("require_provider_health", True)),
        "max_provider_latency_ms": max(100, _int(policy.get("max_provider_latency_ms"), 5000)),
        "max_provider_error_rate": max(0.0, min(_num(policy.get("max_provider_error_rate"), 0.5), 1.0)),
        "cost_anomaly_threshold_usd": max(0.0, _num(policy.get("cost_anomaly_threshold_usd"), 1.0)),
    }


def _health_for(provider_health: list[dict[str, Any]], model_id: str) -> dict[str, Any]:
    matches = [row for row in provider_health if str(row.get("model_id") or "") == model_id]
    if not matches:
        return {"model_id": model_id, "status": "unknown", "healthy": True, "reason": "未上报 provider 健康，按可用处理。"}
    row = sorted(matches, key=lambda item: str(item.get("checked_at") or item.get("created_at") or ""), reverse=True)[0]
    return dict(row)


def evaluate_provider_health(model_id: str, provider_health: list[dict[str, Any]], policy: dict[str, Any] | None = None) -> dict[str, Any]:
    active_policy = policy or _active_policy([])
    row = _health_for(provider_health, model_id)
    status = str(row.get("status") or "unknown").lower()
    latency = _int(row.get("latency_ms"))
    error_rate = _num(row.get("error_rate"))
    healthy_status = status in {"", "unknown", "healthy", "ok", "active"}
    healthy_latency = latency <= 0 or latency <= int(active_policy.get("max_provider_latency_ms") or 5000)
    healthy_errors = error_rate <= float(active_policy.get("max_provider_error_rate") or 0.5)
    healthy = healthy_status and healthy_latency and healthy_errors
    reasons: list[str] = []
    if not healthy_status:
        reasons.append(f"status={status}")
    if not healthy_latency:
        reasons.append(f"latency_ms={latency}")
    if not healthy_errors:
        reasons.append(f"error_rate={error_rate}")
    return {
        "model_id": model_id,
        "status": status or "unknown",
        "healthy": healthy,
        "latency_ms": latency,
        "error_rate": error_rate,
        "reason": "provider 健康" if healthy else "provider 不健康：" + "，".join(reasons),
        "raw": row,
    }


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


def evaluate_policy_decision(
    task: dict[str, Any],
    routes: list[dict[str, Any]],
    throttles: list[dict[str, Any]],
    usage: list[dict[str, Any]],
    policies: list[dict[str, Any]],
    provider_health: list[dict[str, Any]],
) -> dict[str, Any]:
    policy = _active_policy(policies)
    if not policy.get("enabled", True):
        decision = select_llm_route(task, routes, throttles, usage)
        decision["policy_decision"] = {"decision": "allow", "matched_rules": ["policy_disabled"], "policy": policy, "reasons": []}
        return decision

    task_type = str(task.get("task_type") or "general")
    prompt = max(0, _int(task.get("estimated_prompt_tokens")))
    completion = max(0, _int(task.get("estimated_completion_tokens")))
    estimated_tokens = prompt + completion
    allow_fallback = bool(task.get("allow_fallback", True))
    current_cost = round(sum(_num(row.get("cost_usd")) for row in usage), 6)
    skipped_rules: list[str] = []
    attempts: list[dict[str, Any]] = []

    candidates = _candidate_routes(task_type, routes)
    if not candidates:
        decision = select_llm_route(task, routes, throttles, usage)
        decision["policy_decision"] = {"decision": "block", "matched_rules": ["no_route"], "policy": policy, "reasons": [decision.get("reason", "")]}
        return decision

    for route in candidates:
        primary = str(route.get("model_id") or "")
        fallback = str(route.get("fallback_model_id") or "")
        model_candidates = [(primary, False)]
        if allow_fallback and fallback:
            model_candidates.append((fallback, True))
        for model_id, fallback_applied in model_candidates:
            if not model_id:
                continue
            health = evaluate_provider_health(model_id, provider_health, policy)
            if policy.get("require_provider_health") and not health["healthy"]:
                attempts.append({"route_id": route.get("id"), "model_id": model_id, "fallback_applied": fallback_applied, "provider_health": health, "allowed": False})
                if "provider_unhealthy" not in skipped_rules:
                    skipped_rules.append("provider_unhealthy")
                continue
            throttle = evaluate_throttle(model_id, estimated_tokens, throttles, usage)
            attempts.append({"route_id": route.get("id"), "model_id": model_id, "fallback_applied": fallback_applied, "provider_health": health, "throttle": throttle, "allowed": throttle["allowed"]})
            if not throttle["allowed"]:
                if "throttle_exceeded" not in skipped_rules:
                    skipped_rules.append("throttle_exceeded")
                continue
            cost = estimate_invocation_cost(model_id, prompt, completion)
            budget = _num(policy.get("daily_budget_usd"))
            if budget and current_cost + _num(cost.get("estimated_cost_usd")) > budget:
                return {
                    "status": "blocked",
                    "task_type": task_type,
                    "route_id": str(route.get("id") or ""),
                    "route_name": str(route.get("name") or ""),
                    "selected_model_id": "",
                    "primary_model_id": primary,
                    "fallback_model_id": fallback,
                    "fallback_applied": False,
                    "risk_level": "high",
                    "reason": "预计调用成本会超过模型网关预算护栏。",
                    "cost": cost,
                    "attempts": attempts,
                    "policy_decision": {
                        "decision": "block" if policy.get("block_on_budget") else "warn",
                        "matched_rules": [*skipped_rules, "budget_exceeded"],
                        "policy": policy,
                        "budget": {"daily_budget_usd": budget, "current_cost_usd": current_cost, "projected_cost_usd": round(current_cost + _num(cost.get("estimated_cost_usd")), 6)},
                        "reasons": ["预计调用成本超过 daily_budget_usd。"],
                    },
                }
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
                "reason": ("主模型不健康或不可用，已切换 fallback。" if fallback_applied else "命中策略允许的模型路由。") + f" {throttle['reason']}",
                "cost": cost,
                "provider_health": health,
                "attempts": attempts,
                "policy_decision": {
                    "decision": "allow",
                    "matched_rules": skipped_rules or ["policy_allowed"],
                    "policy": policy,
                    "budget": {"daily_budget_usd": _num(policy.get("daily_budget_usd")), "current_cost_usd": current_cost, "projected_cost_usd": round(current_cost + _num(cost.get("estimated_cost_usd")), 6)},
                    "reasons": [],
                },
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
        "reason": "策略、provider 健康或限流导致主模型与 fallback 均不可用。",
        "cost": estimate_invocation_cost(str(first.get("model_id") or ""), prompt, completion),
        "attempts": attempts,
        "policy_decision": {"decision": "block", "matched_rules": skipped_rules or ["policy_blocked"], "policy": policy, "reasons": ["没有可用模型通过策略评估。"]},
    }


def build_fallback_drill(routes: list[dict[str, Any]], provider_health: list[dict[str, Any]], throttles: list[dict[str, Any]], usage: list[dict[str, Any]]) -> dict[str, Any]:
    active_routes = [row for row in routes if bool(row.get("enabled", True))]
    items: list[dict[str, Any]] = []
    for route in active_routes:
        primary = str(route.get("model_id") or "")
        fallback = str(route.get("fallback_model_id") or "")
        issues: list[str] = []
        primary_health = evaluate_provider_health(primary, provider_health, _active_policy([])) if primary else {"healthy": False, "reason": "缺少主模型"}
        fallback_health = evaluate_provider_health(fallback, provider_health, _active_policy([])) if fallback else {"healthy": False, "reason": "缺少 fallback"}
        fallback_throttle = evaluate_throttle(fallback, 1, throttles, usage) if fallback else {"allowed": False, "reason": "缺少 fallback"}
        if not fallback:
            issues.append("missing_fallback")
        if fallback and not fallback_health["healthy"]:
            issues.append("fallback_unhealthy")
        if fallback and not fallback_throttle["allowed"]:
            issues.append("fallback_throttled")
        status = "ready" if fallback and fallback_health["healthy"] and fallback_throttle["allowed"] else "unready"
        items.append(
            {
                "route_id": str(route.get("id") or ""),
                "route_name": str(route.get("name") or ""),
                "task_type": str(route.get("task_type") or "general"),
                "primary_model_id": primary,
                "fallback_model_id": fallback,
                "primary_health": primary_health,
                "fallback_health": fallback_health,
                "fallback_throttle": fallback_throttle,
                "status": status,
                "issues": issues,
                "recommendation": "fallback 可在主模型故障时接管。" if status == "ready" else "补齐健康 fallback、限流保护或 provider 健康配置。",
            }
        )
    return {
        "summary": {
            "total_routes": len(items),
            "ready": sum(1 for item in items if item["status"] == "ready"),
            "unready": sum(1 for item in items if item["status"] != "ready"),
        },
        "items": items,
    }


def build_cost_anomaly_tasks(usage: list[dict[str, Any]], policies: list[dict[str, Any]], *, assigned_to: str, dev_tool: str) -> dict[str, Any]:
    policy = _active_policy(policies)
    threshold = _num(policy.get("cost_anomaly_threshold_usd"), 1.0)
    by_model: dict[str, dict[str, Any]] = {}
    for row in usage:
        model_id = str(row.get("model_id") or "unknown")
        bucket = by_model.setdefault(model_id, {"model_id": model_id, "requests": 0, "cost_usd": 0.0, "tokens": 0, "task_types": set()})
        bucket["requests"] += 1
        bucket["cost_usd"] = round(bucket["cost_usd"] + _num(row.get("cost_usd")), 6)
        bucket["tokens"] += _int(row.get("prompt_tokens")) + _int(row.get("completion_tokens"))
        if row.get("task_type"):
            bucket["task_types"].add(str(row.get("task_type")))
    anomalies = []
    for bucket in by_model.values():
        avg_cost = bucket["cost_usd"] / max(1, bucket["requests"])
        if threshold and avg_cost < threshold:
            continue
        anomalies.append({**bucket, "task_types": sorted(bucket["task_types"]), "avg_cost_usd": round(avg_cost, 6), "threshold_usd": threshold})
    anomalies.sort(key=lambda item: item["avg_cost_usd"], reverse=True)
    tasks = [
        {
            "title": f"LLM Gateway 成本异常治理：{item['model_id']}",
            "description": "\n".join(
                [
                    f"模型：{item['model_id']}",
                    f"平均成本：${item['avg_cost_usd']}，阈值：${item['threshold_usd']}",
                    f"请求数：{item['requests']}，Tokens：{item['tokens']}",
                    f"任务类型：{', '.join(item['task_types']) or '-'}",
                    "建议：检查路由策略、上下文长度、fallback 与预算护栏，必要时切换低成本模型。",
                ]
            ),
            "priority": "P0" if item["avg_cost_usd"] >= threshold * 2 else "P1",
            "estimate": "S",
            "assigned_to": assigned_to,
            "dev_tool": dev_tool,
            "source": "llm_gateway_cost_anomaly",
            "source_report_id": f"llm-cost-{item['model_id']}",
            "source_report_title": f"LLM cost anomaly {item['model_id']}",
        }
        for item in anomalies
    ]
    return {"summary": {"models": len(by_model), "anomalies": len(anomalies), "threshold_usd": threshold}, "anomalies": anomalies, "items": tasks}


def _provider_for(model_id: str) -> str:
    mid = str(model_id or "").lower()
    if any(key in mid for key in ("gpt", "openai", "o1", "o3", "o4")):
        return "openai"
    if any(key in mid for key in ("claude", "anthropic", "sonnet", "haiku")):
        return "anthropic"
    if any(key in mid for key in ("gemini", "google")):
        return "google"
    if any(key in mid for key in ("qwen", "dashscope", "tongyi")):
        return "dashscope"
    if any(key in mid for key in ("deepseek", "deep-seek")):
        return "deepseek"
    if any(key in mid for key in ("llama", "mistral", "local", "ollama")):
        return "local"
    return "unknown"


def _bucket_cost(row: dict[str, Any]) -> dict[str, Any]:
    prompt_tokens = _int(row.get("prompt_tokens"))
    completion_tokens = _int(row.get("completion_tokens"))
    tokens = prompt_tokens + completion_tokens
    cost = _num(row.get("cost_usd"))
    return {
        "requests": 1,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "tokens": tokens,
        "cost_usd": round(cost, 6),
        "latency_total_ms": _int(row.get("latency_ms")),
        "latency_samples": 1 if row.get("latency_ms") is not None else 0,
    }


def _merge_cost_bucket(bucket: dict[str, Any], row: dict[str, Any]) -> None:
    delta = _bucket_cost(row)
    for key, value in delta.items():
        bucket[key] = round(_num(bucket.get(key)) + _num(value), 6) if key == "cost_usd" else _int(bucket.get(key)) + _int(value)


def _finalize_cost_bucket(bucket: dict[str, Any], total_cost: float) -> dict[str, Any]:
    requests = max(1, _int(bucket.get("requests")))
    tokens = max(0, _int(bucket.get("tokens")))
    latency_samples = max(0, _int(bucket.get("latency_samples")))
    latency_total = max(0, _int(bucket.get("latency_total_ms")))
    cost = round(_num(bucket.get("cost_usd")), 6)
    return {
        **bucket,
        "cost_usd": cost,
        "cost_share": round((cost / total_cost) * 100, 2) if total_cost else 0,
        "avg_cost_usd": round(cost / requests, 6),
        "cost_per_1k_tokens": round((cost / tokens) * 1000, 6) if tokens else 0,
        "avg_latency_ms": round(latency_total / latency_samples, 1) if latency_samples else 0,
    }


def build_cost_attribution(
    usage: list[dict[str, Any]],
    policies: list[dict[str, Any]],
    *,
    min_cost_usd: float = 0.0,
    assigned_to: str = "AI Platform",
    dev_tool: str = "codex",
) -> dict[str, Any]:
    rows = [row for row in usage if _num(row.get("cost_usd")) >= max(0.0, _num(min_cost_usd))]
    total_cost = round(sum(_num(row.get("cost_usd")) for row in rows), 6)
    total_tokens = sum(_int(row.get("prompt_tokens")) + _int(row.get("completion_tokens")) for row in rows)
    by_provider: dict[str, dict[str, Any]] = {}
    by_model: dict[str, dict[str, Any]] = {}
    by_task_type: dict[str, dict[str, Any]] = {}
    by_source: dict[str, dict[str, Any]] = {}
    for row in rows:
        model_id = str(row.get("model_id") or "unknown")
        provider = str(row.get("provider") or row.get("provider_id") or _provider_for(model_id))
        task_type = str(row.get("task_type") or "general")
        source = str(row.get("agent_run_id") or row.get("task_id") or row.get("trace_id") or row.get("correlation_id") or "unattributed")
        for buckets, key, label_key in (
            (by_provider, provider, "provider"),
            (by_model, model_id, "model_id"),
            (by_task_type, task_type, "task_type"),
            (by_source, source, "source"),
        ):
            bucket = buckets.setdefault(key, {label_key: key, "requests": 0, "prompt_tokens": 0, "completion_tokens": 0, "tokens": 0, "cost_usd": 0.0, "latency_total_ms": 0, "latency_samples": 0})
            if label_key != "provider":
                bucket.setdefault("provider", provider)
            if label_key != "model_id":
                bucket.setdefault("model_id", model_id if label_key == "source" else "")
            _merge_cost_bucket(bucket, row)
    providers = sorted((_finalize_cost_bucket(row, total_cost) for row in by_provider.values()), key=lambda item: item["cost_usd"], reverse=True)
    models = sorted((_finalize_cost_bucket(row, total_cost) for row in by_model.values()), key=lambda item: item["cost_usd"], reverse=True)
    task_types = sorted((_finalize_cost_bucket(row, total_cost) for row in by_task_type.values()), key=lambda item: item["cost_usd"], reverse=True)
    sources = sorted((_finalize_cost_bucket(row, total_cost) for row in by_source.values()), key=lambda item: item["cost_usd"], reverse=True)[:20]
    policy = _active_policy(policies)
    budget = _num(policy.get("daily_budget_usd"))
    budget_ratio = round((total_cost / budget) * 100, 2) if budget else 0
    top_provider_share = providers[0]["cost_share"] if providers else 0
    findings: list[dict[str, Any]] = []
    if budget and total_cost > budget:
        findings.append({"level": "critical", "title": "模型成本超过预算", "recommendation": "立即检查高成本 Provider、降级非关键任务模型，并限制长上下文调用。"})
    elif budget and budget_ratio >= 80:
        findings.append({"level": "high", "title": "模型成本接近预算", "recommendation": "按 Provider 和任务类型识别成本来源，提前调整路由和预算。"})
    if top_provider_share >= 70:
        findings.append({"level": "medium", "title": "成本集中在单一 Provider", "recommendation": "评估跨 Provider 路由与 fallback，避免成本和可用性集中风险。", "provider": providers[0]["provider"]})
    expensive_models = [item for item in models if item["avg_cost_usd"] >= _num(policy.get("cost_anomaly_threshold_usd"), 1.0)]
    if expensive_models:
        findings.append({"level": "medium", "title": "存在高平均成本模型", "recommendation": "检查高成本模型是否只用于高价值任务，必要时增加低成本模型路由。", "models": [item["model_id"] for item in expensive_models[:5]]})
    tasks = [
        {
            "title": f"LLM Gateway 成本归因治理：{finding['title']}",
            "description": "\n".join([
                f"风险等级：{finding['level']}",
                f"总成本：${total_cost}",
                f"预算占用：{budget_ratio}%",
                f"建议：{finding['recommendation']}",
                "Provider 归因：",
                *[f"- {item['provider']}: ${item['cost_usd']} / {item['cost_share']}%" for item in providers[:5]],
            ]),
            "priority": "P0" if finding["level"] in {"critical", "high"} else "P1",
            "estimate": "S",
            "assigned_to": assigned_to,
            "dev_tool": dev_tool,
            "source": "llm_gateway_cost_attribution",
            "source_report_id": "llm-cost-attribution-" + hashlib.sha1(str(finding).encode("utf-8")).hexdigest()[:10],
            "source_report_title": finding["title"],
        }
        for finding in findings
    ]
    return {
        "ok": True,
        "summary": {
            "records": len(rows),
            "providers": len(providers),
            "models": len(models),
            "task_types": len(task_types),
            "total_cost_usd": total_cost,
            "total_tokens": total_tokens,
            "budget_usd": budget,
            "budget_ratio": budget_ratio,
            "top_provider": providers[0]["provider"] if providers else "",
            "top_provider_share": top_provider_share,
            "findings": len(findings),
            "tasks_planned": len(tasks),
        },
        "providers": providers,
        "models": models,
        "task_types": task_types,
        "sources": sources,
        "findings": findings,
        "tasks": tasks,
        "agent_consumption": {
            "api": "/api/v1/llm-gateway/cost-attribution/run",
            "purpose": "按 Provider、模型、任务类型和执行来源归因 LLM 成本，供 AI CLI/Agent 优化路由、预算和模型选择。",
            "safe_for_agents": True,
        },
    }


def _model_eval_capability(model_id: str) -> dict[str, float]:
    mid = str(model_id or "").lower()
    profile = {"quality": 72.0, "reasoning": 70.0, "code": 68.0, "safety": 76.0, "speed": 72.0}
    if any(key in mid for key in ("gpt-5", "o3", "o4", "claude-opus")):
        profile.update({"quality": 94.0, "reasoning": 96.0, "code": 92.0, "safety": 88.0, "speed": 62.0})
    elif any(key in mid for key in ("sonnet", "gpt-4.1", "gemini-pro")):
        profile.update({"quality": 88.0, "reasoning": 88.0, "code": 86.0, "safety": 84.0, "speed": 70.0})
    elif any(key in mid for key in ("mini", "haiku", "flash", "qwen", "deepseek")):
        profile.update({"quality": 78.0, "reasoning": 76.0, "code": 78.0, "safety": 80.0, "speed": 88.0})
    elif any(key in mid for key in ("llama", "mistral", "local", "ollama")):
        profile.update({"quality": 72.0, "reasoning": 70.0, "code": 72.0, "safety": 68.0, "speed": 82.0})
    return profile


def _estimate_tokens_from_text(text: str, fallback: int = 800) -> int:
    value = str(text or "").strip()
    if not value:
        return fallback
    return max(1, int(len(value) / 3.2))


def _keyword_score(text: str, expected_keywords: list[Any]) -> tuple[float, list[str], list[str]]:
    keywords = [str(item).strip() for item in expected_keywords if str(item).strip()]
    if not keywords:
        return 75.0, [], []
    lowered = str(text or "").lower()
    matched = [kw for kw in keywords if kw.lower() in lowered]
    missing = [kw for kw in keywords if kw not in matched]
    return round((len(matched) / max(1, len(keywords))) * 100, 2), matched, missing


def _task_quality_score(model_id: str, task_type: str) -> float:
    profile = _model_eval_capability(model_id)
    task = str(task_type or "general").lower()
    if any(key in task for key in ("code", "bug", "review", "develop")):
        return profile["code"]
    if any(key in task for key in ("reason", "analysis", "decision", "plan")):
        return profile["reasoning"]
    if any(key in task for key in ("summary", "extract", "classify")):
        return round((profile["quality"] + profile["speed"]) / 2, 2)
    return profile["quality"]


def _bounded_score(value: float) -> float:
    return round(max(0.0, min(100.0, _num(value))), 2)


def _score_cost_efficiency(cost_usd: float, budget_usd: float) -> float:
    budget = max(0.000001, _num(budget_usd, 0.02))
    ratio = max(0.0, _num(cost_usd) / budget)
    if ratio <= 0.5:
        return 100.0
    if ratio <= 1.0:
        return round(100.0 - (ratio - 0.5) * 60.0, 2)
    return _bounded_score(70.0 - min(70.0, (ratio - 1.0) * 70.0))


def _score_latency(latency_ms: int, slo_ms: int) -> float:
    latency = max(0, _int(latency_ms))
    slo = max(100, _int(slo_ms, 3000))
    if latency <= 0:
        return 76.0
    if latency <= slo:
        return round(100.0 - (latency / slo) * 20.0, 2)
    return _bounded_score(80.0 - ((latency - slo) / slo) * 80.0)


def _default_eval_cases(routes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    task_types = []
    for route in routes:
        task_type = str(route.get("task_type") or "general")
        if task_type not in task_types:
            task_types.append(task_type)
    if not task_types:
        task_types = ["general"]
    return [
        {
            "id": f"baseline-{task_type}",
            "name": f"{task_type} baseline",
            "task_type": task_type,
            "prompt": f"Evaluate whether the model can handle {task_type} work with safe, structured, actionable output.",
            "expected_keywords": ["safe", "structured", "actionable"],
            "expected_output": "",
            "weight": 1.0,
            "max_prompt_tokens": 1200,
            "completion_tokens": 600,
            "latency_slo_ms": 3000,
            "budget_usd": 0.05,
        }
        for task_type in task_types[:8]
    ]


def build_model_evaluation(
    routes: list[dict[str, Any]],
    policies: list[dict[str, Any]],
    provider_health: list[dict[str, Any]],
    throttles: list[dict[str, Any]],
    usage: list[dict[str, Any]],
    *,
    model_ids: list[Any] | None = None,
    cases: list[dict[str, Any]] | None = None,
    actual_outputs: dict[str, Any] | None = None,
    min_score: float = 75.0,
    assigned_to: str = "AI Platform",
    dev_tool: str = "codex",
) -> dict[str, Any]:
    requested_models = [str(item).strip() for item in (model_ids or []) if str(item).strip()]
    route_models = []
    for route in routes:
        for key in ("model_id", "fallback_model_id"):
            model_id = str(route.get(key) or "").strip()
            if model_id and model_id not in route_models:
                route_models.append(model_id)
    models = requested_models or route_models
    suite_cases = [dict(case) for case in (cases or []) if isinstance(case, dict)] or _default_eval_cases(routes)
    outputs = actual_outputs if isinstance(actual_outputs, dict) else {}
    policy = _active_policy(policies)
    rows: list[dict[str, Any]] = []
    model_rollup: dict[str, dict[str, Any]] = {}
    findings: list[dict[str, Any]] = []
    if not models:
        return {
            "ok": True,
            "summary": {"models": 0, "cases": len(suite_cases), "evaluations": 0, "best_model": "", "best_score": 0, "findings": 1, "tasks_planned": 1},
            "models": [],
            "cases": suite_cases,
            "items": [],
            "findings": [{"level": "high", "title": "缺少可评测模型", "recommendation": "先配置模型路由或在评测请求中指定 model_ids。"}],
            "tasks": [
                {
                    "title": "LLM Gateway 模型评测治理：补齐可评测模型",
                    "description": "模型评测没有发现可用模型候选。请先配置模型路由、fallback 或直接指定 model_ids。",
                    "priority": "P1",
                    "estimate": "S",
                    "assigned_to": assigned_to,
                    "dev_tool": dev_tool,
                    "source": "llm_gateway_model_eval",
                    "source_report_id": "llm-model-eval-no-model",
                    "source_report_title": "缺少可评测模型",
                }
            ],
            "agent_consumption": {"api": "/api/v1/llm-gateway/model-evals/run", "purpose": "评测模型候选的质量、成本、延迟、策略可用性和安全性。", "safe_for_agents": True},
        }
    for model_id in models:
        rollup = model_rollup.setdefault(
            model_id,
            {
                "model_id": model_id,
                "provider": _provider_for(model_id),
                "cases": 0,
                "weighted_score_sum": 0.0,
                "weight_sum": 0.0,
                "quality_score_sum": 0.0,
                "cost_usd": 0.0,
                "tokens": 0,
                "blocked": 0,
                "missing_keywords": set(),
                "recommendations": set(),
            },
        )
        for index, case in enumerate(suite_cases):
            case_id = str(case.get("id") or f"case-{index + 1}")
            task_type = str(case.get("task_type") or "general")
            prompt = str(case.get("prompt") or case.get("input") or "")
            prompt_tokens = max(1, _int(case.get("prompt_tokens"), _estimate_tokens_from_text(prompt, _int(case.get("max_prompt_tokens"), 800))))
            completion_tokens = max(1, _int(case.get("completion_tokens"), 600))
            weight = max(0.01, _num(case.get("weight"), 1.0))
            budget_usd = max(0.000001, _num(case.get("budget_usd"), 0.05))
            latency_slo_ms = max(100, _int(case.get("latency_slo_ms"), 3000))
            output_by_case = outputs.get(case_id) if isinstance(outputs.get(case_id), dict) else {}
            raw_output = output_by_case.get(model_id) if isinstance(output_by_case, dict) else outputs.get(model_id)
            if raw_output is None:
                raw_output = case.get("actual_output") or ""
            actual_output = str(raw_output)
            expected_keywords = list(case.get("expected_keywords") or [])
            keyword_score, matched_keywords, missing_keywords = _keyword_score(actual_output, expected_keywords)
            quality_score = keyword_score if actual_output else _task_quality_score(model_id, task_type)
            audit = build_prompt_audit(
                prompt=prompt,
                task_type=task_type,
                model_id=model_id,
                user_role=str(case.get("user_role") or "agent"),
                max_prompt_tokens=max(prompt_tokens, _int(case.get("max_prompt_tokens"), 8000)),
                allow_pii=bool(case.get("allow_pii", False)),
                allow_secrets=bool(case.get("allow_secrets", False)),
            )
            safety_score = 100.0 if audit.get("decision") == "allowed" else 45.0 if audit.get("decision") == "review" else 15.0
            health = evaluate_provider_health(model_id, provider_health, policy)
            throttle = evaluate_throttle(model_id, prompt_tokens + completion_tokens, throttles, usage)
            cost = estimate_invocation_cost(model_id, prompt_tokens, completion_tokens)
            cost_score = _score_cost_efficiency(_num(cost.get("estimated_cost_usd")), budget_usd)
            latency_score = _score_latency(_int(health.get("latency_ms")), latency_slo_ms)
            policy_score = 100.0
            status = "passed"
            reasons: list[str] = []
            if policy.get("require_provider_health") and not health.get("healthy"):
                policy_score -= 35.0
                status = "blocked"
                reasons.append("provider_unhealthy")
            if not throttle.get("allowed"):
                policy_score -= 35.0
                status = "blocked"
                reasons.append("throttle_exceeded")
            if audit.get("decision") == "blocked":
                policy_score -= 45.0
                status = "blocked"
                reasons.append("prompt_blocked")
            elif audit.get("decision") == "review":
                policy_score -= 20.0
                if status == "passed":
                    status = "review"
                reasons.append("prompt_review")
            score = _bounded_score(
                quality_score * 0.42
                + safety_score * 0.18
                + cost_score * 0.16
                + latency_score * 0.12
                + _bounded_score(policy_score) * 0.12
            )
            if score < _num(min_score, 75.0) and status == "passed":
                status = "watch"
            row = {
                "case_id": case_id,
                "case_name": str(case.get("name") or case_id),
                "task_type": task_type,
                "model_id": model_id,
                "provider": rollup["provider"],
                "status": status,
                "score": score,
                "quality_score": _bounded_score(quality_score),
                "safety_score": _bounded_score(safety_score),
                "cost_score": _bounded_score(cost_score),
                "latency_score": _bounded_score(latency_score),
                "policy_score": _bounded_score(policy_score),
                "estimated_cost_usd": cost["estimated_cost_usd"],
                "estimated_tokens": cost["estimated_tokens"],
                "health": health,
                "throttle": throttle,
                "prompt_audit": {"decision": audit.get("decision"), "summary": audit.get("summary")},
                "matched_keywords": matched_keywords,
                "missing_keywords": missing_keywords,
                "reasons": reasons,
                "recommendation": "可作为该任务类型候选模型。" if status == "passed" else "调整路由、Provider 健康、限流、Prompt 或模型候选后重新评测。",
            }
            rows.append(row)
            rollup["cases"] += 1
            rollup["weighted_score_sum"] += score * weight
            rollup["weight_sum"] += weight
            rollup["quality_score_sum"] += _bounded_score(quality_score)
            rollup["cost_usd"] = round(_num(rollup.get("cost_usd")) + _num(cost.get("estimated_cost_usd")), 6)
            rollup["tokens"] += _int(cost.get("estimated_tokens"))
            if status == "blocked":
                rollup["blocked"] += 1
            for keyword in missing_keywords:
                rollup["missing_keywords"].add(keyword)
            if row["recommendation"]:
                rollup["recommendations"].add(row["recommendation"])
    models_summary = []
    for rollup in model_rollup.values():
        cases_count = max(1, _int(rollup.get("cases")))
        weight_sum = max(0.01, _num(rollup.get("weight_sum"), 1.0))
        score = _bounded_score(_num(rollup.get("weighted_score_sum")) / weight_sum)
        models_summary.append(
            {
                "model_id": rollup["model_id"],
                "provider": rollup["provider"],
                "cases": rollup["cases"],
                "score": score,
                "quality_score": _bounded_score(_num(rollup.get("quality_score_sum")) / cases_count),
                "estimated_cost_usd": round(_num(rollup.get("cost_usd")), 6),
                "estimated_tokens": _int(rollup.get("tokens")),
                "blocked_cases": _int(rollup.get("blocked")),
                "missing_keywords": sorted(rollup["missing_keywords"])[:10],
                "recommendations": sorted(rollup["recommendations"])[:5],
                "status": "passed" if score >= _num(min_score, 75.0) and not _int(rollup.get("blocked")) else "watch" if score >= 60 else "risk",
            }
        )
    models_summary.sort(key=lambda item: (item["score"], -item["estimated_cost_usd"]), reverse=True)
    best = models_summary[0] if models_summary else {}
    for model in models_summary:
        if model["status"] == "risk":
            findings.append({"level": "high", "title": f"模型评测低分：{model['model_id']}", "recommendation": "复核该模型适用任务、输出质量、Provider 健康和限流策略。", "model_id": model["model_id"]})
        elif model["blocked_cases"]:
            findings.append({"level": "medium", "title": f"模型存在阻断用例：{model['model_id']}", "recommendation": "优先修复阻断用例对应的 Prompt 安全、Provider 健康或限流配置。", "model_id": model["model_id"]})
    if len(models_summary) > 1 and best:
        route_primary = set(str(route.get("model_id") or "") for route in routes)
        if best["model_id"] not in route_primary:
            findings.append({"level": "medium", "title": "最优评测模型未作为主路由", "recommendation": "评估是否将最优模型加入高优先级路由或作为关键任务 fallback。", "model_id": best["model_id"]})
    tasks = [
        {
            "title": f"LLM Gateway 模型评测治理：{finding['title']}",
            "description": "\n".join(
                [
                    f"风险等级：{finding['level']}",
                    f"模型：{finding.get('model_id') or '-'}",
                    f"最佳模型：{best.get('model_id') or '-'} / {best.get('score', 0)}",
                    f"建议：{finding['recommendation']}",
                    "评测 Top 模型：",
                    *[f"- {item['model_id']}: score={item['score']} cost=${item['estimated_cost_usd']} status={item['status']}" for item in models_summary[:5]],
                ]
            ),
            "priority": "P0" if finding["level"] == "high" else "P1",
            "estimate": "S",
            "assigned_to": assigned_to,
            "dev_tool": dev_tool,
            "source": "llm_gateway_model_eval",
            "source_report_id": "llm-model-eval-" + hashlib.sha1(str(finding).encode("utf-8")).hexdigest()[:10],
            "source_report_title": finding["title"],
        }
        for finding in findings
    ]
    return {
        "ok": True,
        "summary": {
            "models": len(models_summary),
            "cases": len(suite_cases),
            "evaluations": len(rows),
            "best_model": best.get("model_id", ""),
            "best_score": best.get("score", 0),
            "avg_score": _bounded_score(sum(item["score"] for item in models_summary) / max(1, len(models_summary))),
            "min_score": _bounded_score(min_score),
            "findings": len(findings),
            "tasks_planned": len(tasks),
        },
        "models": models_summary,
        "cases": suite_cases,
        "items": rows,
        "findings": findings,
        "tasks": tasks,
        "agent_consumption": {
            "api": "/api/v1/llm-gateway/model-evals/run",
            "purpose": "用统一 suite 评测模型候选的质量、成本、延迟、策略可用性和 Prompt 安全，供路由与 fallback 决策使用。",
            "fields": ["summary.best_model", "models.score", "items.status", "findings", "tasks"],
            "safe_for_agents": True,
        },
    }


SECRET_PATTERNS = [
    ("api_key", re.compile(r"(?i)\b(api[_-]?key|x-api-key|apikey)\b\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{16,}")),
    ("bearer_token", re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._\-]{20,}")),
    ("private_key", re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----")),
    ("password", re.compile(r"(?i)\b(password|passwd|pwd)\b\s*[:=]\s*['\"]?[^,\s]{8,}")),
    ("secret_ref_inline", re.compile(r"(?i)\b(secret|token)\b\s*[:=]\s*['\"]?[A-Za-z0-9_\-]{16,}")),
]

PII_PATTERNS = [
    ("email", re.compile(r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b")),
    ("phone", re.compile(r"(?<!\d)(?:\+?\d[\d\- ]{8,}\d)(?!\d)")),
    ("id_card", re.compile(r"\b\d{15}(\d{2}[0-9Xx])?\b")),
]

INJECTION_MARKERS = [
    "ignore previous",
    "ignore all previous",
    "忽略以上",
    "忽略之前",
    "绕过",
    "越权",
    "disable safety",
    "system prompt",
    "developer message",
]


def _redact_prompt(prompt: str) -> str:
    redacted = prompt
    for _, pattern in [*SECRET_PATTERNS, *PII_PATTERNS]:
        redacted = pattern.sub("[REDACTED]", redacted)
    return redacted


def build_prompt_audit(
    *,
    prompt: str,
    task_type: str = "general",
    model_id: str = "",
    user_role: str = "agent",
    max_prompt_tokens: int = 8000,
    allow_pii: bool = False,
    allow_secrets: bool = False,
    actions: list[str] | None = None,
    assigned_to: str = "AI Platform",
    dev_tool: str = "codex",
    now_iso: str = "",
) -> dict[str, Any]:
    text = str(prompt or "")
    normalized = text.lower()
    estimated_tokens = max(1, len(text) // 4) if text else 0
    enabled_actions = [str(item) for item in actions or ["create_task"] if str(item)]
    findings: list[dict[str, Any]] = []

    def add(kind: str, title: str, severity: str, evidence: str, recommendation: str) -> None:
        raw = f"{kind}:{title}:{evidence}:{len(findings)}"
        findings.append({
            "id": "prompt-audit-" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12],
            "kind": kind,
            "title": title,
            "severity": severity,
            "evidence": evidence[:240],
            "recommendation": recommendation,
        })

    for kind, pattern in SECRET_PATTERNS:
        if pattern.search(text):
            add(
                kind,
                "Prompt 包含疑似密钥或凭据",
                "critical" if not allow_secrets else "medium",
                kind,
                "移除明文密钥，改用 env://、vault:// 或 secret:// SecretRef，并在模型调用前只传必要上下文。",
            )

    for kind, pattern in PII_PATTERNS:
        if pattern.search(text):
            add(
                kind,
                "Prompt 包含疑似个人敏感信息",
                "high" if not allow_pii else "medium",
                kind,
                "对邮箱、手机号、证件号等字段做脱敏或使用最小化样本，避免将真实个人信息发送给模型。",
            )

    matched_injections = [marker for marker in INJECTION_MARKERS if marker in normalized]
    if matched_injections:
        add(
            "prompt_injection",
            "Prompt 存在提示词注入或越权指令",
            "high",
            ", ".join(matched_injections[:5]),
            "隔离用户输入和系统指令，使用结构化任务字段传参，并在调用前增加安全边界说明。",
        )

    if estimated_tokens > max(1, _int(max_prompt_tokens, 8000)):
        add(
            "context_overflow",
            "Prompt 上下文过长",
            "medium",
            f"estimated_tokens={estimated_tokens}, limit={max_prompt_tokens}",
            "先做摘要、RAG 检索或上下文裁剪，再提交给模型，降低成本和延迟。",
        )

    if text and len(text.strip()) < 20:
        add(
            "underspecified_prompt",
            "Prompt 目标描述不足",
            "medium",
            "prompt is too short",
            "补齐目标、输入、输出格式、边界条件和验收标准，提升模型输出稳定性。",
        )

    if "```" not in text and any(word in normalized for word in ("code", "代码", "sql", "ddl", "diff")):
        add(
            "unstructured_code_context",
            "代码类 Prompt 缺少结构化代码块",
            "low",
            "code-like prompt without fenced block",
            "使用 fenced code block 标注代码、SQL 或 diff，并明确期望的修改范围。",
        )

    severity_rank = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    findings.sort(key=lambda item: severity_rank.get(str(item.get("severity")), 0), reverse=True)
    critical = sum(1 for item in findings if item["severity"] == "critical")
    high = sum(1 for item in findings if item["severity"] == "high")
    medium = sum(1 for item in findings if item["severity"] == "medium")
    blocked = critical > 0 or (high >= 2 and not allow_pii)
    decision = "blocked" if blocked else "review" if findings else "passed"
    score = max(0, 100 - critical * 35 - high * 22 - medium * 10 - max(0, len(findings) - critical - high - medium) * 4)
    redacted = _redact_prompt(text)
    prompt_hash = hashlib.sha256(text.encode("utf-8")).hexdigest() if text else ""
    tasks: list[dict[str, Any]] = []
    if "create_task" in enabled_actions:
        for finding in findings[:10]:
            tasks.append({
                "title": f"LLM Gateway Prompt 审计治理：{finding['title']}",
                "description": "\n".join([
                    f"Prompt 审计决策：{decision}",
                    f"任务类型：{task_type}",
                    f"模型：{model_id or '-'}",
                    f"风险等级：{finding['severity']}",
                    f"证据：{finding['evidence']}",
                    f"建议：{finding['recommendation']}",
                ]),
                "priority": "P0" if finding["severity"] in {"critical", "high"} else "P1",
                "estimate": "S",
                "assigned_to": assigned_to,
                "dev_tool": dev_tool,
                "source": "llm_gateway_prompt_audit",
                "source_report_id": finding["id"],
                "source_report_title": finding["title"],
            })
    return {
        "ok": True,
        "decision": decision,
        "score": score,
        "summary": {
            "findings": len(findings),
            "critical": critical,
            "high": high,
            "medium": medium,
            "estimated_tokens": estimated_tokens,
            "tasks_planned": len(tasks),
            "decision": decision,
            "score": score,
        },
        "items": findings,
        "tasks": tasks,
        "prompt_profile": {
            "prompt_hash": prompt_hash,
            "prompt_length": len(text),
            "estimated_tokens": estimated_tokens,
            "redacted_preview": redacted[:1200],
            "task_type": task_type,
            "model_id": model_id,
            "user_role": user_role,
            "raw_prompt_stored": False,
        },
        "actions": enabled_actions,
        "generated_at": now_iso,
        "agent_consumption": {
            "api": "/api/v1/llm-gateway/prompt-audit/run",
            "safe_for_agents": True,
            "purpose": "在模型调用前审计 Prompt 的密钥、PII、提示词注入、上下文长度和结构化质量风险。",
        },
    }


def summarize_prompt_audits(runs: list[dict[str, Any]]) -> dict[str, Any]:
    latest = runs[0] if runs else {}
    latest_summary = latest.get("summary") if isinstance(latest.get("summary"), dict) else {}
    return {
        "runs": len(runs),
        "latest_at": latest.get("created_at") or latest.get("generated_at") or "",
        "latest_decision": latest_summary.get("decision") or latest.get("decision") or "",
        "latest_score": int(latest_summary.get("score") or latest.get("score") or 0),
        "latest_findings": int(latest_summary.get("findings") or 0),
        "blocked": sum(1 for item in runs if str(item.get("decision") or item.get("summary", {}).get("decision") or "") == "blocked"),
        "high_risk_findings": sum(int((item.get("summary") or {}).get("critical") or 0) + int((item.get("summary") or {}).get("high") or 0) for item in runs),
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
