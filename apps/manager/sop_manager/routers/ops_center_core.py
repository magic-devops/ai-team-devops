"""Pure helpers for OpsCenter self-healing decisions."""
from __future__ import annotations

import operator
import re
import hashlib
from datetime import datetime, timezone
from uuid import uuid4
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
    owner_id: str,
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
                "owner_id": owner_id,
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


def _severity_rank(level: str) -> int:
    return {"critical": 4, "high": 3, "medium": 2, "low": 1, "info": 0}.get(str(level or "").lower(), 0)


def _alert_severity(item: dict[str, Any]) -> str:
    raw = str(item.get("severity") or item.get("level") or item.get("risk_level") or "").lower()
    if raw in {"critical", "high", "medium", "low", "info"}:
        return raw
    if raw in {"error", "danger", "p0"}:
        return "high"
    if raw in {"warning", "warn", "p1"}:
        return "medium"
    return "info"


def normalize_ops_alert(source: str, item: dict[str, Any]) -> dict[str, Any]:
    severity = _alert_severity(item)
    title = str(item.get("title") or item.get("message") or item.get("name") or item.get("id") or source)
    return {
        "id": str(item.get("id") or item.get("alert_id") or item.get("invoice_id") or f"{source}-{uuid4().hex[:8]}"),
        "source": source,
        "status": str(item.get("status") or "open"),
        "severity": severity,
        "title": title,
        "detail": str(item.get("detail") or item.get("action") or item.get("recommendation") or item.get("reason") or ""),
        "dataset": str(item.get("dataset") or item.get("dataset_id") or ""),
        "trace_id": str(item.get("trace_id") or ""),
        "correlation_id": str(item.get("correlation_id") or ""),
        "raw": item,
    }


def _payload_items(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if not isinstance(payload, dict):
        return []
    for key in ("alerts", "items", "monitors", "events", "result"):
        value = payload.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    data = payload.get("data")
    if isinstance(data, list):
        return [item for item in data if isinstance(item, dict)]
    if isinstance(data, dict):
        for key in ("alerts", "items", "monitors", "events", "result"):
            value = data.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    return [payload]


def normalize_alerts_from_source(source: dict[str, Any], payload: Any) -> list[dict[str, Any]]:
    source_id = str(source.get("id") or source.get("name") or source.get("source_type") or "configured")
    source_name = str(source.get("name") or source_id)
    source_type = str(source.get("source_type") or "generic_json")
    source_labels = source.get("labels") if isinstance(source.get("labels"), dict) else {}
    out: list[dict[str, Any]] = []
    for raw in _payload_items(payload):
        labels = raw.get("labels") if isinstance(raw.get("labels"), dict) else {}
        annotations = raw.get("annotations") if isinstance(raw.get("annotations"), dict) else {}
        status = raw.get("status", "open")
        if isinstance(status, dict):
            status = status.get("state") or status.get("status") or "open"
        merged = {
            **raw,
            "id": raw.get("id") or raw.get("alert_id") or raw.get("fingerprint"),
            "source": source_name,
            "status": status,
            "severity": raw.get("severity") or raw.get("level") or labels.get("severity") or labels.get("priority") or raw.get("overall_state") or "info",
            "title": raw.get("title") or raw.get("name") or labels.get("alertname") or labels.get("name") or raw.get("event_type") or source_name,
            "detail": raw.get("detail") or raw.get("message") or annotations.get("description") or annotations.get("summary") or raw.get("query") or "",
            "dataset": raw.get("dataset") or raw.get("dataset_id") or labels.get("dataset") or labels.get("table") or "",
            "trace_id": raw.get("trace_id") or labels.get("trace_id") or "",
            "correlation_id": raw.get("correlation_id") or labels.get("correlation_id") or "",
        }
        normalized = normalize_ops_alert(source_name, merged)
        if not normalized.get("id") or normalized["id"].startswith(f"{source_name}-"):
            fingerprint = hashlib.sha1(
                f"{source_id}:{normalized.get('title')}:{normalized.get('detail')}:{labels}".encode("utf-8")
            ).hexdigest()[:12]
            normalized["id"] = f"{source_id}-{fingerprint}"
        normalized["source_id"] = source_id
        normalized["source_type"] = source_type
        normalized["labels"] = {**source_labels, **labels}
        normalized["annotations"] = annotations
        out.append(normalized)
    return out


def summarize_alert_sources(sources: list[dict[str, Any]], alerts: list[dict[str, Any]], runs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    enabled_sources = [item for item in sources if item.get("enabled", True)]
    open_alerts = [item for item in alerts if str(item.get("status") or "open").lower() in {"open", "active", "triggered", "alerting", "unpaid"}]
    high_alerts = [item for item in open_alerts if _severity_rank(str(item.get("severity") or "info")) >= 2]
    source_counts: dict[str, int] = {}
    for item in open_alerts:
        key = str(item.get("source") or item.get("source_id") or "unknown")
        source_counts[key] = source_counts.get(key, 0) + 1
    latest_runs = runs or []
    failed_runs = [item for item in latest_runs if not item.get("ok", True)]
    return {
        "sources": len(sources),
        "enabled_sources": len(enabled_sources),
        "alerts": len(alerts),
        "open_alerts": len(open_alerts),
        "high_alerts": len(high_alerts),
        "failed_runs": len(failed_runs),
        "source_counts": source_counts,
        "health_score": max(0, min(100, 100 - len(high_alerts) * 8 - len(failed_runs) * 12 - max(0, len(enabled_sources) - len(latest_runs)) * 4)),
    }


def _alert_label_value(alert: dict[str, Any], key: str) -> str:
    labels = alert.get("labels") if isinstance(alert.get("labels"), dict) else {}
    annotations = alert.get("annotations") if isinstance(alert.get("annotations"), dict) else {}
    if key in alert:
        return str(alert.get(key) or "")
    if key in labels:
        return str(labels.get(key) or "")
    if key in annotations:
        return str(annotations.get(key) or "")
    return ""


def _alert_matches(alert: dict[str, Any], matchers: dict[str, Any]) -> bool:
    if not matchers:
        return False
    for key, expected in matchers.items():
        actual = _alert_label_value(alert, str(key))
        if isinstance(expected, list):
            if actual not in {str(item) for item in expected}:
                return False
        elif str(expected) not in {"*", actual}:
            return False
    return True


def _is_active_silence(silence: dict[str, Any], now_iso: str) -> bool:
    if silence.get("enabled") is False:
        return False
    starts_at = str(silence.get("starts_at") or "")
    ends_at = str(silence.get("ends_at") or "")
    if starts_at and now_iso < starts_at:
        return False
    if ends_at and now_iso > ends_at:
        return False
    return True


def _alert_group_key(alert: dict[str, Any], group_by: list[str]) -> str:
    parts = [f"{key}={_alert_label_value(alert, key) or '-'}" for key in group_by if key]
    if parts:
        return "|".join(parts)
    return "|".join([str(alert.get("source_id") or alert.get("source") or "-"), str(alert.get("title") or alert.get("id") or "-")])


def evaluate_alert_noise(
    alerts: list[dict[str, Any]],
    policies: list[dict[str, Any]] | None = None,
    silences: list[dict[str, Any]] | None = None,
    *,
    now_iso: str | None = None,
) -> dict[str, Any]:
    now_value = now_iso or _now()
    enabled_policies = [item for item in (policies or []) if item.get("enabled", True)]
    policy = enabled_policies[0] if enabled_policies else {}
    group_by = [str(item) for item in policy.get("group_by") or ["service", "alertname", "source_id"] if str(item)]
    min_rca_severity = str(policy.get("min_rca_severity") or "high")
    suppress_severities = {str(item) for item in policy.get("suppress_severities") or []}
    active_silences = [item for item in (silences or []) if _is_active_silence(item, now_value)]
    open_alerts = [
        item for item in alerts
        if str(item.get("status") or "open").lower() in {"open", "active", "triggered", "alerting", "unpaid"}
    ]
    groups: dict[str, dict[str, Any]] = {}
    suppressed_alerts = 0
    deduped_alerts = 0
    for alert in open_alerts:
        severity = str(alert.get("severity") or _alert_severity(alert))
        matched_silences = [
            {"id": item.get("id", ""), "name": item.get("name", ""), "reason": item.get("reason", "")}
            for item in active_silences
            if _alert_matches(alert, item.get("matchers") if isinstance(item.get("matchers"), dict) else {})
        ]
        suppressed_by_policy = severity in suppress_severities
        suppressed = bool(matched_silences) or suppressed_by_policy
        if suppressed:
            suppressed_alerts += 1
        key = _alert_group_key(alert, group_by)
        group = groups.setdefault(key, {
            "id": f"alert-group-{hashlib.sha1(key.encode('utf-8')).hexdigest()[:10]}",
            "group_key": key,
            "group_by": group_by,
            "title": str(alert.get("title") or key),
            "source": str(alert.get("source") or ""),
            "labels": {k: _alert_label_value(alert, k) for k in group_by},
            "alerts": [],
            "alert_ids": [],
            "count": 0,
            "suppressed_count": 0,
            "max_severity": severity,
            "recommended_action": "watch",
            "silences": [],
        })
        group["count"] += 1
        group["alert_ids"].append(alert.get("id", ""))
        if group["count"] > 1:
            deduped_alerts += 1
        if _severity_rank(severity) > _severity_rank(str(group.get("max_severity") or "info")):
            group["max_severity"] = severity
            group["title"] = str(alert.get("title") or key)
            group["source"] = str(alert.get("source") or "")
        if suppressed:
            group["suppressed_count"] += 1
        for silence in matched_silences:
            if silence not in group["silences"]:
                group["silences"].append(silence)
        group["alerts"].append({
            "id": alert.get("id", ""),
            "title": alert.get("title", ""),
            "severity": severity,
            "status": alert.get("status", ""),
            "source": alert.get("source", ""),
            "source_id": alert.get("source_id", ""),
            "suppressed": suppressed,
            "suppressed_by_policy": suppressed_by_policy,
            "silences": matched_silences,
        })
    incidents = list(groups.values())
    for group in incidents:
        group["deduped_count"] = max(0, int(group.get("count") or 0) - 1)
        actionable = group["suppressed_count"] < group["count"] and _severity_rank(str(group.get("max_severity") or "info")) >= _severity_rank(min_rca_severity)
        group["recommended_action"] = "create_rca" if actionable else "silenced" if group["suppressed_count"] == group["count"] else "watch"
    incidents.sort(key=lambda item: (_severity_rank(str(item.get("max_severity") or "info")), int(item.get("count") or 0)), reverse=True)
    actionable_incidents = [item for item in incidents if item.get("recommended_action") == "create_rca"]
    reduction = 0 if not open_alerts else round((suppressed_alerts + deduped_alerts) / max(1, len(open_alerts)), 2)
    return {
        "policy": {
            "id": policy.get("id", "default"),
            "name": policy.get("name", "Default alert noise policy"),
            "group_by": group_by,
            "min_rca_severity": min_rca_severity,
            "suppress_severities": sorted(suppress_severities),
        },
        "summary": {
            "raw_alerts": len(alerts),
            "open_alerts": len(open_alerts),
            "groups": len(incidents),
            "actionable_incidents": len(actionable_incidents),
            "suppressed_alerts": suppressed_alerts,
            "deduped_alerts": deduped_alerts,
            "active_silences": len(active_silences),
            "noise_reduction_ratio": reduction,
            "health_score": max(0, min(100, 100 - len(actionable_incidents) * 10 - suppressed_alerts * 2)),
        },
        "groups": incidents[:100],
        "actionable_alerts": [
            alert
            for group in actionable_incidents
            for alert in group.get("alerts", [])
            if not alert.get("suppressed")
        ][:100],
        "evaluated_at": now_value,
    }


def summarize_alert_noise_evaluations(evaluations: list[dict[str, Any]]) -> dict[str, Any]:
    latest = evaluations[0] if evaluations else {}
    summary = latest.get("summary", {}) if isinstance(latest.get("summary"), dict) else {}
    return {
        "evaluations": len(evaluations),
        "latest_at": latest.get("created_at") or latest.get("evaluated_at") or "",
        "latest_open_alerts": int(summary.get("open_alerts") or 0),
        "latest_groups": int(summary.get("groups") or 0),
        "latest_actionable_incidents": int(summary.get("actionable_incidents") or 0),
        "latest_noise_reduction_ratio": float(summary.get("noise_reduction_ratio") or 0),
        "latest_health_score": int(summary.get("health_score") or 100),
    }


def _active_alerts(alerts: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        item for item in alerts
        if str(item.get("status") or "open").lower() in {"open", "active", "triggered", "alerting", "unpaid"}
    ]


def _label_frequencies(alerts: list[dict[str, Any]]) -> dict[str, dict[str, int]]:
    frequencies: dict[str, dict[str, int]] = {}
    for alert in alerts:
        labels = alert.get("labels") if isinstance(alert.get("labels"), dict) else {}
        for key, value in labels.items():
            text = str(value or "")
            if not text:
                continue
            bucket = frequencies.setdefault(str(key), {})
            bucket[text] = bucket.get(text, 0) + 1
    return frequencies


def _recommendation_id(kind: str, payload: dict[str, Any]) -> str:
    import json
    raw = json.dumps({"kind": kind, "payload": payload}, ensure_ascii=False, sort_keys=True)
    return "alert-strategy-" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:14]


def _alert_strategy_recommendation(
    *,
    kind: str,
    priority: str,
    title: str,
    reason: str,
    impact: str,
    operation: str,
    payload: dict[str, Any],
    confidence: float,
) -> dict[str, Any]:
    return {
        "id": _recommendation_id(kind, payload),
        "kind": kind,
        "priority": priority,
        "title": title,
        "reason": reason,
        "impact": impact,
        "operation": operation,
        "payload": payload,
        "confidence": round(max(0.0, min(confidence, 0.99)), 2),
        "status": "open",
    }


def summarize_alert_strategy_recommendations(recommendations: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "recommendations": len(recommendations),
        "critical": sum(1 for item in recommendations if item.get("priority") == "critical"),
        "high": sum(1 for item in recommendations if item.get("priority") == "high"),
        "medium": sum(1 for item in recommendations if item.get("priority") == "medium"),
        "low": sum(1 for item in recommendations if item.get("priority") == "low"),
        "applyable": sum(1 for item in recommendations if item.get("operation") in {"upsert_policy", "create_silence"}),
        "review_only": sum(1 for item in recommendations if item.get("operation") == "review"),
    }


def recommend_alert_noise_strategy(
    *,
    alerts: list[dict[str, Any]],
    policies: list[dict[str, Any]],
    silences: list[dict[str, Any]],
    evaluations: list[dict[str, Any]] | None = None,
    limit: int = 20,
    now_iso: str | None = None,
) -> dict[str, Any]:
    current = evaluate_alert_noise(alerts, policies, silences, now_iso=now_iso)
    summary = current.get("summary", {}) if isinstance(current.get("summary"), dict) else {}
    active_alerts = _active_alerts(alerts)
    enabled_policies = [item for item in policies if item.get("enabled", True)]
    primary_policy = enabled_policies[0] if enabled_policies else {}
    group_by = [str(item) for item in primary_policy.get("group_by") or current.get("policy", {}).get("group_by") or [] if str(item)]
    suppress_severities = {str(item) for item in primary_policy.get("suppress_severities") or current.get("policy", {}).get("suppress_severities") or []}
    label_frequencies = _label_frequencies(active_alerts)
    recommendations: list[dict[str, Any]] = []

    if not enabled_policies:
        preferred_group_by = [item for item in ("service", "alertname", "source_id") if item in label_frequencies or item == "source_id"]
        recommendations.append(_alert_strategy_recommendation(
            kind="create_baseline_policy",
            priority="high" if active_alerts else "medium",
            title="创建基础告警降噪策略",
            reason="当前没有启用的降噪策略，外部告警会直接进入 RCA 输入。",
            impact="按服务、告警名和来源折叠重复告警，并默认抑制 info 级别噪声。",
            operation="upsert_policy",
            payload={
                "name": "自动推荐基础降噪策略",
                "enabled": True,
                "group_by": preferred_group_by or ["source_id", "title"],
                "min_rca_severity": "high",
                "suppress_severities": ["info"],
                "labels": {"source": "alert_strategy_recommendation"},
                "note": "由 OpsCenter 根据当前告警形态自动推荐。",
            },
            confidence=0.84 if active_alerts else 0.66,
        ))

    low_noise = [item for item in active_alerts if _severity_rank(str(item.get("severity") or "info")) <= 1]
    if low_noise and not {"info", "low"} <= suppress_severities:
        payload = {
            "policy_id": primary_policy.get("id", ""),
            "name": primary_policy.get("name") or "自动推荐低优先级抑制策略",
            "enabled": True,
            "group_by": group_by or ["service", "alertname", "source_id"],
            "min_rca_severity": primary_policy.get("min_rca_severity") or "high",
            "suppress_severities": sorted(suppress_severities | {"info", "low"}),
            "labels": primary_policy.get("labels") if isinstance(primary_policy.get("labels"), dict) else {"source": "alert_strategy_recommendation"},
            "note": "自动纳入 info/low 抑制，降低低价值告警进入 RCA 的概率。",
        }
        recommendations.append(_alert_strategy_recommendation(
            kind="suppress_low_priority",
            priority="medium",
            title="抑制低优先级告警",
            reason=f"当前存在 {len(low_noise)} 条低优先级开放告警，但策略未完整抑制 info/low。",
            impact="减少低价值告警对 RCA 与 IM 风险简报的干扰。",
            operation="upsert_policy",
            payload=payload,
            confidence=0.78,
        ))

    duplicate_groups = [item for item in current.get("groups") or [] if int(item.get("deduped_count") or 0) > 0]
    reduction = float(summary.get("noise_reduction_ratio") or 0)
    if duplicate_groups and reduction < 0.35:
        desired = list(dict.fromkeys([*group_by, "service", "alertname", "source_id"]))
        recommendations.append(_alert_strategy_recommendation(
            kind="tune_grouping",
            priority="high",
            title="优化重复告警分组字段",
            reason=f"检测到 {len(duplicate_groups)} 个重复告警组，但降噪率仅 {round(reduction * 100)}%。",
            impact="增强同服务同告警名的折叠效果，降低重复派单和重复 RCA。",
            operation="upsert_policy",
            payload={
                "policy_id": primary_policy.get("id", ""),
                "name": primary_policy.get("name") or "自动推荐分组优化策略",
                "enabled": True,
                "group_by": desired or ["service", "alertname", "source_id"],
                "min_rca_severity": primary_policy.get("min_rca_severity") or "high",
                "suppress_severities": sorted(suppress_severities or {"info"}),
                "labels": primary_policy.get("labels") if isinstance(primary_policy.get("labels"), dict) else {"source": "alert_strategy_recommendation"},
                "note": "根据重复告警组自动优化分组字段。",
            },
            confidence=0.82,
        ))

    for group in current.get("groups") or []:
        severity = str(group.get("max_severity") or "info")
        if _severity_rank(severity) > 1 or int(group.get("count") or 0) < 3:
            continue
        labels = group.get("labels") if isinstance(group.get("labels"), dict) else {}
        matchers = {key: value for key, value in labels.items() if value and value != "-"}
        if not matchers:
            continue
        recommendations.append(_alert_strategy_recommendation(
            kind="create_silence_for_noisy_group",
            priority="medium",
            title=f"为噪声组创建静默：{group.get('title')}",
            reason=f"{group.get('group_key')} 产生 {group.get('count')} 条 {severity} 告警，适合进入维护静默或观察池。",
            impact="把重复低风险告警留在观测层，避免干扰生产 RCA 队列。",
            operation="create_silence",
            payload={
                "name": f"自动静默 {group.get('title') or group.get('id')}",
                "matchers": matchers,
                "starts_at": "",
                "ends_at": "",
                "reason": "由 OpsCenter 告警策略推荐生成，请结合维护窗口确认。",
                "enabled": True,
                "owner": "Ops Lead",
            },
            confidence=0.72,
        ))
        if len([item for item in recommendations if item["kind"] == "create_silence_for_noisy_group"]) >= 3:
            break

    actionable = int(summary.get("actionable_incidents") or 0)
    min_severity = str(primary_policy.get("min_rca_severity") or current.get("policy", {}).get("min_rca_severity") or "high")
    if actionable >= 5 and _severity_rank(min_severity) < _severity_rank("high"):
        recommendations.append(_alert_strategy_recommendation(
            kind="raise_rca_threshold",
            priority="high",
            title="提高 RCA 触发阈值",
            reason=f"当前可行动告警组达到 {actionable} 个，且 RCA 阈值为 {min_severity}。",
            impact="先把中低风险告警留在告警治理层，减少 RCA 队列拥塞。",
            operation="upsert_policy",
            payload={
                "policy_id": primary_policy.get("id", ""),
                "name": primary_policy.get("name") or "自动推荐 RCA 阈值策略",
                "enabled": True,
                "group_by": group_by or ["service", "alertname", "source_id"],
                "min_rca_severity": "high",
                "suppress_severities": sorted(suppress_severities or {"info"}),
                "labels": primary_policy.get("labels") if isinstance(primary_policy.get("labels"), dict) else {"source": "alert_strategy_recommendation"},
                "note": "根据可行动告警组数量自动提高 RCA 触发阈值。",
            },
            confidence=0.8,
        ))

    history = evaluations or []
    if len(history) >= 2:
        latest_summary = history[0].get("summary", {}) if isinstance(history[0].get("summary"), dict) else {}
        previous_summary = history[1].get("summary", {}) if isinstance(history[1].get("summary"), dict) else {}
        latest_health = int(latest_summary.get("health_score") or 100)
        previous_health = int(previous_summary.get("health_score") or latest_health)
        if latest_health + 10 < previous_health:
            recommendations.append(_alert_strategy_recommendation(
                kind="review_policy_effect",
                priority="medium",
                title="复查近期降噪策略效果",
                reason=f"最近健康分从 {previous_health} 下降到 {latest_health}，策略效果可能退化。",
                impact="建议复核近期策略变更、告警源质量和静默窗口，必要时生成治理任务。",
                operation="review",
                payload={"latest_health_score": latest_health, "previous_health_score": previous_health},
                confidence=0.7,
            ))

    priority_rank = {"critical": 4, "high": 3, "medium": 2, "low": 1}
    unique: dict[str, dict[str, Any]] = {}
    for item in recommendations:
        unique[item["id"]] = item
    ordered = sorted(unique.values(), key=lambda item: (priority_rank.get(str(item.get("priority")), 0), float(item.get("confidence") or 0)), reverse=True)
    ordered = ordered[: max(1, min(limit, 100))]
    return {
        "ok": True,
        "summary": {
            **summarize_alert_strategy_recommendations(ordered),
            "open_alerts": len(active_alerts),
            "current_groups": int(summary.get("groups") or 0),
            "current_actionable_incidents": actionable,
            "current_noise_reduction_ratio": reduction,
            "current_health_score": int(summary.get("health_score") or 100),
        },
        "items": ordered,
        "evaluation": current,
        "generated_at": now_iso or _now(),
        "agent_consumption": {
            "api": "/api/v1/ops-center/alert-noise/recommendations",
            "safe_for_agents": True,
            "purpose": "基于告警形态、降噪效果和历史评估推荐可应用的告警策略优化动作。",
        },
    }


def _variant_id(payload: dict[str, Any]) -> str:
    import json
    raw = json.dumps(payload, ensure_ascii=False, sort_keys=True)
    return "alert-variant-" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12]


def _strategy_variant_from_policy(policy: dict[str, Any], fallback_name: str) -> dict[str, Any]:
    return {
        "id": str(policy.get("id") or _variant_id(policy)),
        "name": str(policy.get("name") or fallback_name),
        "enabled": bool(policy.get("enabled", True)),
        "group_by": [str(item) for item in policy.get("group_by") or ["service", "alertname", "source_id"] if str(item)],
        "min_rca_severity": str(policy.get("min_rca_severity") or "high"),
        "suppress_severities": [str(item) for item in policy.get("suppress_severities") or ["info"] if str(item)],
        "labels": policy.get("labels") if isinstance(policy.get("labels"), dict) else {},
        "note": str(policy.get("note") or ""),
    }


def _default_strategy_variants(policies: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enabled = [item for item in policies if item.get("enabled", True)]
    baseline = _strategy_variant_from_policy(enabled[0], "当前主策略") if enabled else {
        "id": "default-baseline",
        "name": "默认基线策略",
        "enabled": True,
        "group_by": ["service", "alertname", "source_id"],
        "min_rca_severity": "high",
        "suppress_severities": ["info"],
        "labels": {"source": "ops_center"},
        "note": "无启用策略时使用默认基线。",
    }
    strict = {
        **baseline,
        "id": "strict-high-only",
        "name": "严格高危优先策略",
        "min_rca_severity": "critical" if baseline.get("min_rca_severity") == "high" else "high",
        "suppress_severities": sorted(set([*baseline.get("suppress_severities", []), "info", "low", "medium"])),
        "note": "仅让高危告警进入 RCA，适合告警风暴或值班人力不足场景。",
    }
    service_focused = {
        **baseline,
        "id": "service-focused-dedupe",
        "name": "服务维度折叠策略",
        "group_by": list(dict.fromkeys([*baseline.get("group_by", []), "service", "alertname", "environment"])),
        "suppress_severities": sorted(set([*baseline.get("suppress_severities", []), "info", "low"])),
        "note": "强化服务和环境维度折叠，适合重复告警多的生产服务。",
    }
    return [baseline, strict, service_focused]


def compare_alert_strategy_variants(
    *,
    alerts: list[dict[str, Any]],
    policies: list[dict[str, Any]],
    silences: list[dict[str, Any]],
    variants: list[dict[str, Any]] | None = None,
    baseline_policy_id: str = "",
    now_iso: str | None = None,
) -> dict[str, Any]:
    now_value = now_iso or _now()
    baseline_policies = [item for item in policies if item.get("enabled", True)]
    if baseline_policy_id:
        selected = [item for item in policies if str(item.get("id") or "") == baseline_policy_id]
        if selected:
            baseline_policies = selected
    baseline_eval = evaluate_alert_noise(alerts, baseline_policies, silences, now_iso=now_value)
    baseline_summary = baseline_eval.get("summary", {}) if isinstance(baseline_eval.get("summary"), dict) else {}
    variant_inputs = variants or _default_strategy_variants(baseline_policies)
    normalized_variants: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(variant_inputs):
        if not isinstance(raw, dict):
            continue
        item = _strategy_variant_from_policy(raw, f"候选策略 {index + 1}")
        item["id"] = str(raw.get("id") or _variant_id(item))
        if item["id"] in seen:
            item["id"] = f"{item['id']}-{index + 1}"
        seen.add(item["id"])
        normalized_variants.append(item)
    if not normalized_variants:
        normalized_variants = _default_strategy_variants(baseline_policies)

    baseline_health = int(baseline_summary.get("health_score") or 0)
    baseline_actionable = int(baseline_summary.get("actionable_incidents") or 0)
    rows: list[dict[str, Any]] = []
    for variant in normalized_variants:
        evaluated = evaluate_alert_noise(alerts, [variant], silences, now_iso=now_value)
        summary = evaluated.get("summary", {}) if isinstance(evaluated.get("summary"), dict) else {}
        health = int(summary.get("health_score") or 0)
        actionable = int(summary.get("actionable_incidents") or 0)
        reduction = float(summary.get("noise_reduction_ratio") or 0)
        score_delta = health - baseline_health
        actionable_delta = actionable - baseline_actionable
        composite = health * 1.0 + reduction * 20 - actionable * 5
        rows.append({
            "id": variant["id"],
            "name": variant["name"],
            "policy": variant,
            "summary": summary,
            "open_alerts": int(summary.get("open_alerts") or 0),
            "groups": int(summary.get("groups") or 0),
            "actionable_incidents": actionable,
            "suppressed_alerts": int(summary.get("suppressed_alerts") or 0),
            "deduped_alerts": int(summary.get("deduped_alerts") or 0),
            "noise_reduction_ratio": reduction,
            "health_score": health,
            "score_delta": score_delta,
            "actionable_delta": actionable_delta,
            "composite_score": round(composite, 2),
            "winner": False,
            "groups_preview": evaluated.get("groups", [])[:5],
            "recommendation": (
                "建议应用：健康分提升且可行动 RCA 压力下降。"
                if score_delta > 0 and actionable_delta <= 0
                else "建议观察：效果接近基线，可作为灰度策略。"
                if score_delta >= 0
                else "暂不建议：健康分低于当前基线。"
            ),
        })
    rows.sort(key=lambda item: (float(item.get("composite_score") or 0), int(item.get("health_score") or 0)), reverse=True)
    if rows:
        rows[0]["winner"] = True
    winner = rows[0] if rows else {}
    return {
        "ok": True,
        "baseline": {
            "policy": baseline_eval.get("policy", {}),
            "summary": baseline_summary,
            "groups_preview": baseline_eval.get("groups", [])[:5],
        },
        "items": rows,
        "summary": {
            "variants": len(rows),
            "open_alerts": int(baseline_summary.get("open_alerts") or 0),
            "baseline_health_score": baseline_health,
            "winner_id": winner.get("id", ""),
            "winner_name": winner.get("name", ""),
            "winner_health_score": int(winner.get("health_score") or 0),
            "winner_score_delta": int(winner.get("score_delta") or 0),
            "winner_actionable_delta": int(winner.get("actionable_delta") or 0),
            "best_noise_reduction_ratio": float(winner.get("noise_reduction_ratio") or 0),
        },
        "generated_at": now_value,
        "agent_consumption": {
            "api": "/api/v1/ops-center/alert-noise/strategy-compare",
            "safe_for_agents": True,
            "purpose": "对同一批开放告警执行多策略 A/B 对比，帮助人和 Agent 选择可灰度应用的降噪策略。",
        },
    }


def summarize_alert_strategy_comparisons(runs: list[dict[str, Any]]) -> dict[str, Any]:
    latest = runs[0] if runs else {}
    summary = latest.get("summary", {}) if isinstance(latest.get("summary"), dict) else {}
    return {
        "comparisons": len(runs),
        "latest_at": latest.get("created_at") or latest.get("generated_at") or "",
        "latest_variants": int(summary.get("variants") or 0),
        "latest_winner": str(summary.get("winner_name") or ""),
        "latest_winner_score_delta": int(summary.get("winner_score_delta") or 0),
        "latest_best_noise_reduction_ratio": float(summary.get("best_noise_reduction_ratio") or 0),
    }


def _alert_service_key(alert: dict[str, Any], sources_by_id: dict[str, dict[str, Any]]) -> tuple[str, str, str]:
    source_id = str(alert.get("source_id") or alert.get("source") or "unknown")
    source = sources_by_id.get(source_id, {})
    source_name = str(source.get("name") or alert.get("source") or source_id)
    service = _alert_label_value(alert, "service") or _alert_label_value(alert, "app") or _alert_label_value(alert, "dataset") or "default"
    return source_id, source_name, service


def predict_alert_source_slo(
    *,
    alerts: list[dict[str, Any]],
    sources: list[dict[str, Any]],
    runs: list[dict[str, Any]] | None = None,
    evaluations: list[dict[str, Any]] | None = None,
    window_hours: int = 24,
    now_iso: str | None = None,
) -> dict[str, Any]:
    now_value = now_iso or _now()
    bounded_window = max(1, min(int(window_hours or 24), 168))
    source_map = {str(item.get("id") or item.get("name") or ""): item for item in sources}
    latest_eval = (evaluations or [{}])[0] if evaluations else {}
    latest_eval_summary = latest_eval.get("summary", {}) if isinstance(latest_eval.get("summary"), dict) else {}
    reduction = float(latest_eval_summary.get("noise_reduction_ratio") or 0)
    failed_sources = {str(item.get("source_id") or "") for item in (runs or []) if not item.get("ok", True)}
    open_alerts = [
        item for item in alerts
        if str(item.get("status") or "open").lower() in {"open", "active", "triggered", "alerting", "unpaid"}
    ]
    buckets: dict[tuple[str, str, str], dict[str, Any]] = {}
    for alert in open_alerts:
        key = _alert_service_key(alert, source_map)
        bucket = buckets.setdefault(key, {
            "source_id": key[0],
            "source_name": key[1],
            "service": key[2],
            "open_alerts": 0,
            "critical_alerts": 0,
            "high_alerts": 0,
            "medium_alerts": 0,
            "low_alerts": 0,
            "titles": [],
        })
        severity = str(alert.get("severity") or _alert_severity(alert))
        bucket["open_alerts"] += 1
        if _severity_rank(severity) >= _severity_rank("critical"):
            bucket["critical_alerts"] += 1
        elif _severity_rank(severity) >= _severity_rank("high"):
            bucket["high_alerts"] += 1
        elif _severity_rank(severity) >= _severity_rank("medium"):
            bucket["medium_alerts"] += 1
        else:
            bucket["low_alerts"] += 1
        title = str(alert.get("title") or alert.get("id") or "")
        if title and title not in bucket["titles"]:
            bucket["titles"].append(title)
    if not buckets:
        for source in sources:
            key = (str(source.get("id") or source.get("name") or "unknown"), str(source.get("name") or source.get("id") or "unknown"), "default")
            buckets[key] = {
                "source_id": key[0],
                "source_name": key[1],
                "service": key[2],
                "open_alerts": 0,
                "critical_alerts": 0,
                "high_alerts": 0,
                "medium_alerts": 0,
                "low_alerts": 0,
                "titles": [],
            }
    items: list[dict[str, Any]] = []
    for bucket in buckets.values():
        failed_penalty = 14 if bucket["source_id"] in failed_sources else 0
        severity_penalty = bucket["critical_alerts"] * 22 + bucket["high_alerts"] * 14 + bucket["medium_alerts"] * 7 + bucket["low_alerts"] * 2
        volume_penalty = max(0, bucket["open_alerts"] - 3) * 4
        reduction_bonus = int(reduction * 10)
        score = max(0, min(100, 99 - severity_penalty - volume_penalty - failed_penalty + reduction_bonus))
        breach_probability = round(max(0.02, min(0.98, (100 - score) / 100)), 2)
        if score < 60 or bucket["critical_alerts"] > 0:
            risk = "critical"
        elif score < 75 or bucket["high_alerts"] >= 2:
            risk = "high"
        elif score < 88 or bucket["open_alerts"] >= 3:
            risk = "watch"
        else:
            risk = "healthy"
        recommendations = []
        if bucket["critical_alerts"] or bucket["high_alerts"]:
            recommendations.append("优先创建或更新 RCA，并绑定 Runbook 处置高危告警。")
        if bucket["open_alerts"] >= 3:
            recommendations.append("复核告警分组与静默窗口，降低重复告警对值班队列的压力。")
        if bucket["source_id"] in failed_sources:
            recommendations.append("告警源最近采集失败，先恢复采集链路再判断真实 SLO。")
        if not recommendations:
            recommendations.append("维持当前策略，按窗口继续观察趋势。")
        items.append({
            **bucket,
            "titles": bucket["titles"][:5],
            "window_hours": bounded_window,
            "noise_reduction_ratio": reduction,
            "predicted_slo_score": score,
            "breach_probability": breach_probability,
            "risk_level": risk,
            "recommendations": recommendations,
        })
    risk_rank = {"critical": 4, "high": 3, "watch": 2, "healthy": 1}
    items.sort(key=lambda item: (risk_rank.get(str(item.get("risk_level")), 0), int(item.get("open_alerts") or 0)), reverse=True)
    risk_targets = [item for item in items if item.get("risk_level") in {"critical", "high"}]
    avg_score = round(sum(int(item.get("predicted_slo_score") or 0) for item in items) / max(1, len(items)), 1)
    max_probability = max([float(item.get("breach_probability") or 0) for item in items] or [0])
    return {
        "ok": True,
        "items": items[:100],
        "summary": {
            "targets": len(items),
            "risk_targets": len(risk_targets),
            "critical_targets": sum(1 for item in items if item.get("risk_level") == "critical"),
            "avg_slo_score": avg_score,
            "breach_probability": round(max_probability, 2),
            "window_hours": bounded_window,
            "noise_reduction_ratio": reduction,
        },
        "generated_at": now_value,
        "agent_consumption": {
            "api": "/api/v1/ops-center/alert-noise/slo-prediction",
            "safe_for_agents": True,
            "purpose": "按告警源和服务预测短期 SLO 风险，指导 RCA、Runbook 和告警策略联动治理。",
        },
    }


def summarize_alert_slo_predictions(runs: list[dict[str, Any]]) -> dict[str, Any]:
    latest = runs[0] if runs else {}
    summary = latest.get("summary", {}) if isinstance(latest.get("summary"), dict) else {}
    return {
        "predictions": len(runs),
        "latest_at": latest.get("created_at") or latest.get("generated_at") or "",
        "latest_targets": int(summary.get("targets") or 0),
        "latest_risk_targets": int(summary.get("risk_targets") or 0),
        "latest_avg_slo_score": float(summary.get("avg_slo_score") or 0),
        "latest_breach_probability": float(summary.get("breach_probability") or 0),
    }


_RISK_ORDER = {"healthy": 0, "watch": 1, "medium": 1, "high": 2, "critical": 3}


def build_alert_slo_escalation(
    prediction: dict[str, Any],
    *,
    policy: dict[str, Any] | None = None,
    dry_run: bool = True,
    priority: str = "P1",
    owner_id: str = "",
    dev_tool: str = "codex",
) -> dict[str, Any]:
    policy = policy or {}
    enabled = bool(policy.get("enabled", True))
    min_risk = str(policy.get("min_risk_level") or "high")
    min_probability = float(policy.get("min_breach_probability") or 0.35)
    max_targets = max(1, min(int(policy.get("max_targets") or 5), 50))
    actions = [str(item) for item in policy.get("actions") or ["create_task", "im_notify"] if str(item)]
    source_items = prediction.get("items") if isinstance(prediction.get("items"), list) else []
    candidates: list[dict[str, Any]] = []
    for item in source_items:
        risk = str(item.get("risk_level") or "healthy")
        probability = float(item.get("breach_probability") or 0)
        if _RISK_ORDER.get(risk, 0) < _RISK_ORDER.get(min_risk, 2) and probability < min_probability:
            continue
        candidates.append(item)
    candidates = candidates[:max_targets]
    escalations: list[dict[str, Any]] = []
    tasks: list[dict[str, Any]] = []
    for item in candidates:
        risk = str(item.get("risk_level") or "high")
        source_id = str(item.get("source_id") or "")
        service = str(item.get("service") or "default")
        escalation_id = "alert-slo-escalation-" + hashlib.sha1(f"{source_id}:{service}:{risk}".encode("utf-8")).hexdigest()[:12]
        recommendations = [str(rec) for rec in item.get("recommendations") or [] if str(rec)]
        escalation = {
            "id": escalation_id,
            "source_id": source_id,
            "source_name": str(item.get("source_name") or source_id),
            "service": service,
            "risk_level": risk,
            "predicted_slo_score": int(item.get("predicted_slo_score") or 0),
            "breach_probability": float(item.get("breach_probability") or 0),
            "open_alerts": int(item.get("open_alerts") or 0),
            "critical_alerts": int(item.get("critical_alerts") or 0),
            "high_alerts": int(item.get("high_alerts") or 0),
            "actions": actions,
            "recommendations": recommendations,
            "status": "planned" if dry_run else "executed",
        }
        escalations.append(escalation)
        if "create_task" in actions:
            tasks.append({
                "title": f"处置告警 SLO 风险：{escalation['source_name']} / {service}",
                "description": "\n".join([
                    "OpsCenter 告警 SLO 自动升级任务。",
                    "",
                    f"Risk: {risk}",
                    f"Predicted SLO score: {escalation['predicted_slo_score']}",
                    f"Breach probability: {round(escalation['breach_probability'] * 100)}%",
                    f"Open alerts: {escalation['open_alerts']}, critical: {escalation['critical_alerts']}, high: {escalation['high_alerts']}",
                    "",
                    "Recommendations:",
                    *[f"- {rec}" for rec in recommendations],
                ]),
                "priority": "P0" if risk == "critical" else priority,
                "estimate": "S",
                "owner_id": owner_id,
                "dev_tool": dev_tool,
                "source": "ops_center_alert_slo_escalation",
                "source_report_id": escalation_id,
                "source_report_title": f"{escalation['source_name']} / {service}",
                "debug_notes": f"alert_slo risk={risk} probability={escalation['breach_probability']} score={escalation['predicted_slo_score']}",
            })
    return {
        "ok": True,
        "enabled": enabled,
        "dry_run": dry_run,
        "policy": {
            "enabled": enabled,
            "min_risk_level": min_risk,
            "min_breach_probability": min_probability,
            "max_targets": max_targets,
            "actions": actions,
        },
        "summary": {
            "candidates": len(candidates),
            "tasks_planned": len(tasks),
            "created": 0 if dry_run else len(tasks),
            "im_planned": 1 if candidates and "im_notify" in actions else 0,
            "critical": sum(1 for item in escalations if item.get("risk_level") == "critical"),
            "high": sum(1 for item in escalations if item.get("risk_level") == "high"),
            "max_breach_probability": max([float(item.get("breach_probability") or 0) for item in escalations] or [0]),
        },
        "items": escalations,
        "tasks": tasks,
        "agent_consumption": {
            "api": "/api/v1/ops-center/alert-noise/slo-escalation/run",
            "safe_for_agents": True,
            "purpose": "将跨源 SLO 预测中的高风险对象升级为治理任务和 IM 风险通知计划。",
        },
    }


def summarize_alert_slo_escalations(runs: list[dict[str, Any]]) -> dict[str, Any]:
    latest = runs[0] if runs else {}
    summary = latest.get("summary", {}) if isinstance(latest.get("summary"), dict) else {}
    return {
        "runs": len(runs),
        "latest_at": latest.get("created_at") or "",
        "latest_candidates": int(summary.get("candidates") or 0),
        "latest_created": int(summary.get("created") or 0),
        "latest_critical": int(summary.get("critical") or 0),
        "latest_max_breach_probability": float(summary.get("max_breach_probability") or 0),
    }


def _latest_summary(items: list[dict[str, Any]]) -> dict[str, Any]:
    latest = items[0] if items else {}
    return latest.get("summary", {}) if isinstance(latest.get("summary"), dict) else {}


def build_alert_strategy_canary_audit(
    *,
    compare_runs: list[dict[str, Any]],
    policies: list[dict[str, Any]],
    evaluations: list[dict[str, Any]],
    slo_predictions: list[dict[str, Any]],
    escalations: list[dict[str, Any]],
    candidate_id: str = "",
    traffic_percent: int = 10,
    now_iso: str | None = None,
) -> dict[str, Any]:
    now_value = now_iso or _now()
    bounded_traffic = max(1, min(int(traffic_percent or 10), 50))
    latest_compare = compare_runs[0] if compare_runs else {}
    compare_items = latest_compare.get("items") if isinstance(latest_compare.get("items"), list) else []
    candidate = next((item for item in compare_items if str(item.get("id") or "") == candidate_id), None)
    if candidate is None:
        candidate = next((item for item in compare_items if item.get("winner")), None) or (compare_items[0] if compare_items else {})
    candidate_policy = candidate.get("policy") if isinstance(candidate.get("policy"), dict) else {}
    policy_id = str(candidate_policy.get("id") or candidate.get("id") or candidate_id or "")
    persisted_policy = next((item for item in policies if str(item.get("id") or "") == policy_id), {})
    policy_enabled = bool((persisted_policy or candidate_policy).get("enabled", True))

    score_delta = int(candidate.get("score_delta") or 0)
    actionable_delta = int(candidate.get("actionable_delta") or 0)
    candidate_health = int(candidate.get("health_score") or latest_compare.get("summary", {}).get("winner_health_score") or 0)
    reduction = float(candidate.get("noise_reduction_ratio") or 0)
    latest_eval_summary = _latest_summary(evaluations)
    slo_summary = _latest_summary(slo_predictions)
    escalation_summary = _latest_summary(escalations)
    risk_targets = int(slo_summary.get("risk_targets") or 0)
    critical_targets = int(slo_summary.get("critical_targets") or escalation_summary.get("critical") or 0)
    max_probability = float(slo_summary.get("breach_probability") or escalation_summary.get("max_breach_probability") or 0)
    escalation_created = int(escalation_summary.get("created") or 0)
    latest_reduction = float(latest_eval_summary.get("noise_reduction_ratio") or 0)
    reduction_drift = round(reduction - latest_reduction, 3)

    readiness_score = 70
    readiness_score += min(max(score_delta, -20) * 2, 24)
    readiness_score += int(min(max(reduction, 0), 1) * 16)
    readiness_score -= max(0, actionable_delta) * 8
    readiness_score -= risk_targets * 8
    readiness_score -= critical_targets * 18
    readiness_score -= int(max_probability * 16)
    readiness_score -= escalation_created * 3
    if not policy_enabled:
        readiness_score -= 30
    readiness_score = max(0, min(100, readiness_score))

    blocked_reasons: list[str] = []
    review_reasons: list[str] = []
    if not candidate:
        blocked_reasons.append("缺少策略对比候选，请先执行策略效果 A/B 对比。")
    if not policy_enabled:
        blocked_reasons.append("候选策略当前未启用或不在策略目录中。")
    if score_delta < 0:
        blocked_reasons.append("候选策略健康分低于当前基线。")
    if critical_targets > 0 or max_probability >= 0.7:
        blocked_reasons.append("当前仍存在 critical SLO 风险或违约概率过高。")
    if actionable_delta > 1:
        review_reasons.append("候选策略会增加 RCA 可行动压力，需要人工确认值班容量。")
    if risk_targets > 0:
        review_reasons.append("仍存在 high/watch SLO 风险对象，建议先完成升级处置。")
    if readiness_score < 75:
        review_reasons.append("综合准入分低于灰度直接启动阈值。")

    if blocked_reasons:
        decision = "blocked"
        risk_level = "critical"
        recommended_percent = 0
    elif review_reasons:
        decision = "needs_review"
        risk_level = "high" if readiness_score < 65 else "watch"
        recommended_percent = min(bounded_traffic, 10)
    else:
        decision = "ready"
        risk_level = "healthy"
        recommended_percent = min(bounded_traffic, 25 if readiness_score >= 90 else 15)

    evidence = [
        {
            "kind": "strategy_compare",
            "title": "策略对比结果",
            "status": "pass" if score_delta >= 0 else "fail",
            "value": score_delta,
            "detail": f"候选健康分 {candidate_health}，相对基线变化 {score_delta}。",
        },
        {
            "kind": "rca_pressure",
            "title": "RCA 压力变化",
            "status": "pass" if actionable_delta <= 0 else "review",
            "value": actionable_delta,
            "detail": f"可行动事件变化 {actionable_delta}，降噪率 {round(reduction * 100)}%。",
        },
        {
            "kind": "slo_risk",
            "title": "SLO 风险窗口",
            "status": "fail" if critical_targets or max_probability >= 0.7 else "review" if risk_targets else "pass",
            "value": risk_targets,
            "detail": f"风险对象 {risk_targets}，critical {critical_targets}，最大违约概率 {round(max_probability * 100)}%。",
        },
        {
            "kind": "policy_drift",
            "title": "策略漂移",
            "status": "pass" if reduction_drift >= -0.1 else "review",
            "value": reduction_drift,
            "detail": f"候选降噪率相对最近执行策略变化 {round(reduction_drift * 100)}%。",
        },
    ]
    guardrails = [
        f"灰度流量不超过 {recommended_percent}%。",
        "观察窗口内 health_score 不得低于基线 5 分。",
        "critical SLO 风险、P0 任务或 RCA backlog 增加时立即回滚。",
        "灰度期间保留 IM 风险简报和任务化升级通道。",
    ]
    rollback_triggers = [
        "SLO 违约概率连续两个窗口超过 70%。",
        "RCA 可行动事件较基线增加超过 1 个。",
        "告警源采集失败或策略命中分组异常增长。",
    ]
    return {
        "ok": True,
        "decision": decision,
        "risk_level": risk_level,
        "candidate": {
            "id": str(candidate.get("id") or policy_id),
            "name": str(candidate.get("name") or candidate_policy.get("name") or persisted_policy.get("name") or "候选策略"),
            "policy_id": policy_id,
            "health_score": candidate_health,
            "score_delta": score_delta,
            "actionable_delta": actionable_delta,
            "noise_reduction_ratio": reduction,
        },
        "summary": {
            "audits": 1,
            "canary_ready": 1 if decision == "ready" else 0,
            "readiness_score": readiness_score,
            "decision": decision,
            "risk_level": risk_level,
            "recommended_percent": recommended_percent,
            "requested_percent": bounded_traffic,
            "slo_risk_targets": risk_targets,
            "slo_critical_targets": critical_targets,
            "max_breach_probability": round(max_probability, 2),
            "strategy_score_delta": score_delta,
            "actionable_delta": actionable_delta,
        },
        "items": evidence,
        "blocked_reasons": blocked_reasons,
        "review_reasons": review_reasons,
        "guardrails": guardrails,
        "rollback_triggers": rollback_triggers,
        "generated_at": now_value,
        "agent_consumption": {
            "api": "/api/v1/ops-center/alert-noise/strategy-canary/audit",
            "safe_for_agents": True,
            "purpose": "把策略 A/B 对比、SLO 风险和自动升级结果汇总为可审批的灰度准入审计。",
        },
    }


def summarize_alert_strategy_canary_audits(runs: list[dict[str, Any]]) -> dict[str, Any]:
    latest = runs[0] if runs else {}
    summary = latest.get("summary", {}) if isinstance(latest.get("summary"), dict) else {}
    return {
        "audits": len(runs),
        "latest_at": latest.get("created_at") or latest.get("generated_at") or "",
        "latest_decision": str(summary.get("decision") or latest.get("decision") or ""),
        "latest_readiness_score": int(summary.get("readiness_score") or 0),
        "latest_recommended_percent": int(summary.get("recommended_percent") or 0),
        "ready": sum(1 for item in runs if item.get("decision") == "ready"),
        "running": sum(1 for item in runs if item.get("audit_status") == "canary_running"),
    }


def build_ops_strategy_linkage(
    *,
    canary_audits: list[dict[str, Any]],
    slo_escalations: list[dict[str, Any]],
    rca: list[dict[str, Any]],
    runbooks: list[dict[str, Any]],
    self_heal: list[dict[str, Any]],
    pipelines: list[dict[str, Any]],
    actions: list[str] | None = None,
    max_items: int = 8,
    priority: str = "P1",
    owner_id: str = "",
    dev_tool: str = "codex",
    now_iso: str | None = None,
) -> dict[str, Any]:
    now_value = now_iso or _now()
    enabled_actions = [str(item) for item in actions or ["create_task", "im_notify"] if str(item)]
    limit = max(1, min(int(max_items or 8), 50))
    latest_audit = canary_audits[0] if canary_audits else {}
    latest_escalation = slo_escalations[0] if slo_escalations else {}
    audit_summary = latest_audit.get("summary") if isinstance(latest_audit.get("summary"), dict) else {}
    escalation_summary = latest_escalation.get("summary") if isinstance(latest_escalation.get("summary"), dict) else {}
    open_rca = [item for item in rca if str(item.get("status") or "open") != "resolved"]
    failed_pipelines = [item for item in pipelines if str(item.get("status") or "") in {"failed", "blocked"}]
    escalation_items = latest_escalation.get("items") if isinstance(latest_escalation.get("items"), list) else []
    canary_decision = str(latest_audit.get("decision") or audit_summary.get("decision") or "")
    canary_status = str(latest_audit.get("audit_status") or "")

    links: list[dict[str, Any]] = []

    def add_link(kind: str, module: str, title: str, risk_level: str, target: dict[str, Any], recommendations: list[str]) -> None:
        raw = f"{kind}:{module}:{title}:{target.get('id') or target.get('name') or len(links)}"
        links.append({
            "id": "ops-linkage-" + hashlib.sha1(raw.encode("utf-8")).hexdigest()[:12],
            "kind": kind,
            "module": module,
            "title": title,
            "risk_level": risk_level,
            "target": target,
            "recommendations": recommendations,
            "status": "planned",
        })

    if latest_audit:
        audit_target = {
            "id": latest_audit.get("id", ""),
            "decision": canary_decision,
            "audit_status": canary_status,
            "readiness_score": audit_summary.get("readiness_score", 0),
            "candidate": latest_audit.get("candidate", {}),
            "api": "/api/v1/ops-center/alert-noise/strategy-canary/audits",
        }
        if canary_decision == "ready" or canary_status == "canary_running":
            add_link(
                "deployment_canary_guardrail",
                "system_ops",
                "将告警策略灰度审计护栏同步到发布灰度观察",
                "medium",
                audit_target,
                [
                    "按审计建议流量设置发布灰度观察窗口。",
                    "将 SLO 风险、RCA 压力和告警分组异常作为回滚触发条件。",
                ],
            )
        else:
            add_link(
                "strategy_canary_blocker",
                "ops_center",
                "处理告警策略灰度准入阻断项",
                "high" if canary_decision == "needs_review" else "critical",
                audit_target,
                [*(latest_audit.get("blocked_reasons") or []), *(latest_audit.get("review_reasons") or [])][:3]
                or ["补齐策略对比、SLO 预测和升级处置证据后重新审计。"],
            )

    for item in escalation_items[:3]:
        add_link(
            "slo_runbook_binding",
            "runbooks",
            f"为 {item.get('source_name') or item.get('source_id')} / {item.get('service')} 绑定 SLO 处置 Runbook",
            str(item.get("risk_level") or "high"),
            {
                "id": item.get("id", ""),
                "source_id": item.get("source_id", ""),
                "service": item.get("service", ""),
                "breach_probability": item.get("breach_probability", 0),
                "api": "/api/v1/ops-center/runbooks",
            },
            [
                "沉淀高风险告警源的标准处置步骤。",
                "在 RCA 验证和自愈动作中复用同一 Runbook。",
            ],
        )

    if not runbooks:
        add_link(
            "runbook_bootstrap",
            "runbooks",
            "补齐策略灰度与 SLO 升级的基础 Runbook",
            "high",
            {"api": "/api/v1/ops-center/runbooks", "count": 0},
            ["创建告警降噪灰度、SLO 升级、回滚检查三个基础 Runbook。"],
        )
    if not self_heal:
        add_link(
            "self_heal_bootstrap",
            "self_heal",
            "补齐告警策略联动自愈策略",
            "medium",
            {"api": "/api/v1/ops-center/self-heal", "count": 0},
            ["为高频可恢复告警创建带审批的自愈动作，避免直接执行破坏性操作。"],
        )
    if open_rca:
        add_link(
            "rca_backlog",
            "rca",
            "将未关闭 RCA 与策略灰度风险重新对齐",
            "medium",
            {"api": "/api/v1/ops-center/rca", "open_rca": len(open_rca)},
            ["复核未关闭 RCA 是否影响灰度准入和回滚触发。"],
        )
    if failed_pipelines:
        add_link(
            "pipeline_remediation",
            "pipelines",
            "把失败流水线纳入策略灰度回滚信号",
            "high",
            {"api": "/api/v1/ops-center/pipelines", "failed": len(failed_pipelines)},
            ["失败流水线恢复前不建议扩大告警策略灰度流量。"],
        )

    links = links[:limit]
    risk_rank = {"critical": 4, "high": 3, "medium": 2, "watch": 1, "low": 1, "healthy": 0}
    links.sort(key=lambda item: risk_rank.get(str(item.get("risk_level")), 0), reverse=True)
    tasks: list[dict[str, Any]] = []
    if "create_task" in enabled_actions:
        for link in links:
            tasks.append({
                "title": f"跨模块运维策略联动：{link['title']}",
                "description": "\n".join([
                    "OpsCenter 跨模块运维策略联动任务。",
                    "",
                    f"Module: {link['module']}",
                    f"Kind: {link['kind']}",
                    f"Risk: {link['risk_level']}",
                    "",
                    "Recommendations:",
                    *[f"- {rec}" for rec in link.get("recommendations") or []],
                ]),
                "priority": "P0" if link.get("risk_level") == "critical" else priority,
                "estimate": "S",
                "owner_id": owner_id,
                "dev_tool": dev_tool,
                "source": "ops_center_strategy_linkage",
                "source_report_id": link["id"],
                "source_report_title": link["title"],
                "debug_notes": f"module={link['module']} kind={link['kind']} risk={link['risk_level']}",
            })
    module_counts: dict[str, int] = {}
    for link in links:
        module = str(link.get("module") or "unknown")
        module_counts[module] = module_counts.get(module, 0) + 1
    high_risk = sum(1 for item in links if str(item.get("risk_level")) in {"critical", "high"})
    return {
        "ok": True,
        "actions": enabled_actions,
        "items": links,
        "tasks": tasks,
        "strategy_packet": {
            "canary_audit": {
                "id": latest_audit.get("id", ""),
                "decision": canary_decision,
                "status": canary_status,
                "readiness_score": audit_summary.get("readiness_score", 0),
            },
            "slo_escalation": {
                "id": latest_escalation.get("id", ""),
                "candidates": escalation_summary.get("candidates", 0),
                "created": escalation_summary.get("created", 0),
            },
            "module_routes": [
                {"module": "ops_center", "api": "/api/v1/ops-center/alert-noise/strategy-canary/audits"},
                {"module": "runbooks", "api": "/api/v1/ops-center/runbooks"},
                {"module": "self_heal", "api": "/api/v1/ops-center/self-heal"},
                {"module": "tasks", "api": "/api/v1/tasks"},
                {"module": "notify", "api": "/api/v1/notify/messages"},
            ],
        },
        "summary": {
            "linkage_items": len(links),
            "modules": len(module_counts),
            "high_risk": high_risk,
            "tasks_planned": len(tasks),
            "canary_ready": 1 if canary_decision == "ready" else 0,
            "runbooks": len(runbooks),
            "self_heal_policies": len(self_heal),
        },
        "generated_at": now_value,
        "agent_consumption": {
            "api": "/api/v1/ops-center/strategy-linkage/run",
            "safe_for_agents": True,
            "purpose": "把告警策略灰度审计、SLO 升级、Runbook、自愈、任务和 IM 通知串成可执行的跨模块运维策略联动包。",
        },
    }


def summarize_ops_strategy_linkages(runs: list[dict[str, Any]]) -> dict[str, Any]:
    latest = runs[0] if runs else {}
    summary = latest.get("summary", {}) if isinstance(latest.get("summary"), dict) else {}
    return {
        "runs": len(runs),
        "latest_at": latest.get("created_at") or latest.get("generated_at") or "",
        "latest_items": int(summary.get("linkage_items") or 0),
        "latest_modules": int(summary.get("modules") or 0),
        "latest_high_risk": int(summary.get("high_risk") or 0),
        "latest_created": int(summary.get("created") or 0),
    }


def _candidate(
    *,
    kind: str,
    title: str,
    root_cause: str,
    severity: str,
    confidence: float,
    evidence: list[dict[str, Any]],
    recommendations: list[str],
    linked: dict[str, Any] | None = None,
) -> dict[str, Any]:
    bounded = max(0.0, min(float(confidence), 0.99))
    fingerprint = hashlib.sha1(f"{kind}:{title}:{root_cause}".encode("utf-8")).hexdigest()[:10]
    return {
        "id": f"rca-insight-{kind}-{fingerprint}",
        "kind": kind,
        "title": title,
        "root_cause": root_cause,
        "severity": severity,
        "confidence": round(bounded, 2),
        "evidence": evidence[:8],
        "recommendations": recommendations[:6],
        "linked": linked or {},
    }


def _tokens(text: str) -> set[str]:
    return {item for item in re.split(r"[^a-zA-Z0-9_\u4e00-\u9fff]+", (text or "").lower()) if len(item) >= 2}


def recommend_runbooks_for_candidate(candidate: dict[str, Any], runbooks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    query_parts = [
        str(candidate.get("kind") or ""),
        str(candidate.get("title") or ""),
        str(candidate.get("root_cause") or ""),
        " ".join(str(x) for x in candidate.get("recommendations") or []),
        " ".join(str(ev.get("type") or "") + " " + str(ev.get("label") or "") for ev in candidate.get("evidence") or [] if isinstance(ev, dict)),
    ]
    query_tokens = _tokens(" ".join(query_parts))
    out: list[dict[str, Any]] = []
    for runbook in runbooks:
        haystack = " ".join([
            str(runbook.get("name") or ""),
            " ".join(str(x) for x in runbook.get("tags") or []),
            " ".join(str(x) for x in runbook.get("steps") or []),
        ])
        overlap = sorted(query_tokens & _tokens(haystack))
        if not overlap:
            continue
        out.append({
            "id": runbook.get("id", ""),
            "name": runbook.get("name", ""),
            "tags": runbook.get("tags", []) if isinstance(runbook.get("tags"), list) else [],
            "steps_count": len(runbook.get("steps", [])) if isinstance(runbook.get("steps"), list) else 0,
            "match_score": min(100, 40 + len(overlap) * 12),
            "matched_terms": overlap[:8],
        })
    out.sort(key=lambda item: int(item.get("match_score") or 0), reverse=True)
    return out[:5]


def diff_runbook_versions(base: dict[str, Any], target: dict[str, Any]) -> dict[str, Any]:
    base_snapshot = base.get("snapshot", {}) if isinstance(base.get("snapshot"), dict) else base
    target_snapshot = target.get("snapshot", {}) if isinstance(target.get("snapshot"), dict) else target
    base_steps = [str(item) for item in base_snapshot.get("steps") or []]
    target_steps = [str(item) for item in target_snapshot.get("steps") or []]
    base_tags = [str(item) for item in base_snapshot.get("tags") or []]
    target_tags = [str(item) for item in target_snapshot.get("tags") or []]
    max_steps = max(len(base_steps), len(target_steps))
    changed_steps = [
        {"index": idx + 1, "base": base_steps[idx] if idx < len(base_steps) else "", "target": target_steps[idx] if idx < len(target_steps) else ""}
        for idx in range(max_steps)
        if (base_steps[idx] if idx < len(base_steps) else "") != (target_steps[idx] if idx < len(target_steps) else "")
    ]
    return {
        "base_version_id": base.get("id", ""),
        "target_version_id": target.get("id", ""),
        "name_changed": str(base_snapshot.get("name") or "") != str(target_snapshot.get("name") or ""),
        "base_name": base_snapshot.get("name", ""),
        "target_name": target_snapshot.get("name", ""),
        "added_tags": [item for item in target_tags if item not in base_tags],
        "removed_tags": [item for item in base_tags if item not in target_tags],
        "changed_steps": changed_steps,
        "summary": {
            "changed_steps": len(changed_steps),
            "added_tags": len([item for item in target_tags if item not in base_tags]),
            "removed_tags": len([item for item in base_tags if item not in target_tags]),
            "has_change": bool(changed_steps) or base_snapshot.get("name") != target_snapshot.get("name") or base_tags != target_tags,
        },
    }


def summarize_runbook_versions(runbooks: list[dict[str, Any]], versions: list[dict[str, Any]]) -> dict[str, Any]:
    active = [item for item in versions if item.get("status") == "active"]
    archived = [item for item in versions if item.get("status") == "archived"]
    missing_versions = [item for item in runbooks if not item.get("active_version_id")]
    versioned_runbooks = len({str(item.get("runbook_id") or "") for item in versions if item.get("runbook_id")})
    health_score = 100
    if missing_versions:
        health_score -= min(40, len(missing_versions) * 10)
    if len(active) < len(runbooks):
        health_score -= min(20, max(0, len(runbooks) - len(active)) * 5)
    return {
        "runbooks": len(runbooks),
        "versions": len(versions),
        "active_versions": len(active),
        "archived_versions": len(archived),
        "versioned_runbooks": versioned_runbooks,
        "missing_version_runbooks": len(missing_versions),
        "health_score": max(0, health_score),
    }


def _latest_verification(rca_item: dict[str, Any]) -> dict[str, Any]:
    history = rca_item.get("verification_history")
    if isinstance(history, list) and history:
        latest = history[-1]
        return latest if isinstance(latest, dict) else {}
    return {}


def _rca_bound_runbook_ids(rca_item: dict[str, Any]) -> set[str]:
    ids = {str(item) for item in rca_item.get("selected_runbook_ids") or [] if str(item)}
    linked = rca_item.get("linked") if isinstance(rca_item.get("linked"), dict) else {}
    ids.update(str(item) for item in linked.get("runbooks") or [] if str(item))
    recommended = rca_item.get("recommended_runbooks")
    if isinstance(recommended, list):
        ids.update(str(item.get("id")) for item in recommended if isinstance(item, dict) and item.get("id"))
    return ids


def _action_bound_runbook_ids(action: dict[str, Any]) -> set[str]:
    ids = {str(item) for item in action.get("runbook_ids") or [] if str(item)}
    for rb in action.get("runbooks") or []:
        if isinstance(rb, dict) and rb.get("id"):
            ids.add(str(rb["id"]))
    for step in action.get("steps") or []:
        if isinstance(step, dict) and step.get("runbook_id"):
            ids.add(str(step["runbook_id"]))
    return ids


def _record_evidence(evidence: list[dict[str, Any]], evidence_id: str, title: str, value: Any, status: str = "collected") -> None:
    if value in (None, "", [], {}):
        return
    evidence.append({"id": evidence_id, "title": title, "status": status, "value": value})


def _checks_from_verification(verification: dict[str, Any]) -> dict[str, Any]:
    checks = verification.get("checks") if isinstance(verification.get("checks"), dict) else {}
    plan = verification.get("plan") if isinstance(verification.get("plan"), dict) else {}
    plan_checks = plan.get("checks") if isinstance(plan.get("checks"), list) else []
    out = dict(checks)
    for item in plan_checks:
        if isinstance(item, dict) and item.get("id"):
            out.setdefault(str(item["id"]), item.get("status") or item.get("evidence"))
    return out


def report_runbook_evidence(record: dict[str, Any]) -> dict[str, Any]:
    """Project collected records honestly, including JSON saved before intake existed.

    This is a pure read projection. Record coverage never proves execution or
    acceptance; legacy self-heal reports cannot satisfy execution requirements.
    """
    result = dict(record, execution_evidence=False, coverage_kind="reported_records")
    reported_titles = {"self_heal_action": "自愈建议记录", "rca_verification": "RCA 自报验证记录", "runbook_execution_check": "Runbook 自报执行记录"}
    evidence = [dict(item, status="reported_only", title=reported_titles[item["id"]])
                if item.get("id") in reported_titles else dict(item)
                for item in record.get("collected_evidence") or [] if isinstance(item, dict)]
    sources = [dict(item, status="reported_only", recorded_state=item.get("recorded_state", item.get("status", "")))
               if item.get("type") in {"self_heal", "rca"} else dict(item)
               for item in record.get("sources") or [] if isinstance(item, dict)]
    required = {str(item["id"]): dict(item) for item in record.get("required_evidence") or []
                if isinstance(item, dict) and item.get("id")}
    if any(item.get("id") == "self_heal_action" for item in evidence) or any(item.get("type") == "self_heal" for item in sources):
        required["self_heal_action"] = {"id": "self_heal_action", "title": "正式自愈执行与验证证据"}
    collected = {str(item.get("id") or "") for item in evidence
                 if item.get("status") == "collected" and item.get("value") not in ({}, [], "", None)}
    missing = [item for key, item in required.items() if key not in collected]
    result.update(collected_evidence=evidence, sources=sources, required_evidence=list(required.values()),
                  missing_evidence=missing, coverage_score=round((len(required)-len(missing))*100/len(required)) if required else 0,
                  status="complete" if required and not missing else "partial" if collected else "missing",
                  recommended_action="backfill_missing_evidence" if missing or not required else "review_collected_records")
    return result


def summarize_runbook_execution_evidence(records: list[dict[str, Any]]) -> dict[str, Any]:
    records = [report_runbook_evidence(item) for item in records]
    scores = [int(item.get("coverage_score") or 0) for item in records]
    missing = sum(len(item.get("missing_evidence") or []) for item in records)
    complete = sum(1 for item in records if item.get("status") == "complete")
    partial = sum(1 for item in records if item.get("status") == "partial")
    return {
        "records": len(records),
        "execution_evidence": False,
        "coverage_kind": "reported_records",
        "complete": complete,
        "partial": partial,
        "missing": sum(1 for item in records if item.get("status") == "missing"),
        "missing_evidence": missing,
        "coverage_score": round(sum(scores) / len(scores)) if scores else 0,
        "needs_backfill": sum(1 for item in records if item.get("status") != "complete"),
    }


def build_runbook_execution_evidence(
    *,
    runbooks: list[dict[str, Any]],
    versions: list[dict[str, Any]],
    rca: list[dict[str, Any]],
    pipelines: list[dict[str, Any]],
    self_heal_actions: list[dict[str, Any]],
    runbook_ids: list[str] | None = None,
    rca_ids: list[str] | None = None,
    include_resolved: bool = True,
    limit: int = 100,
    now_iso: str | None = None,
) -> dict[str, Any]:
    selected_runbook_ids = {str(item) for item in runbook_ids or [] if str(item)}
    selected_rca_ids = {str(item) for item in rca_ids or [] if str(item)}
    version_by_runbook: dict[str, dict[str, Any]] = {}
    for version in versions:
        rid = str(version.get("runbook_id") or "")
        if not rid:
            continue
        current = version_by_runbook.get(rid)
        if version.get("status") == "active" or current is None:
            version_by_runbook[rid] = version

    pipeline_by_id = {str(item.get("id") or ""): item for item in pipelines if item.get("id")}
    records: list[dict[str, Any]] = []
    now_value = now_iso or _now()
    for runbook in runbooks:
        runbook_id = str(runbook.get("id") or "")
        if not runbook_id or (selected_runbook_ids and runbook_id not in selected_runbook_ids):
            continue
        bound_rca = [
            item for item in rca
            if runbook_id in _rca_bound_runbook_ids(item)
            and (include_resolved or item.get("status") != "resolved")
            and (not selected_rca_ids or str(item.get("id") or "") in selected_rca_ids)
        ]
        bound_actions = [item for item in self_heal_actions if runbook_id in _action_bound_runbook_ids(item)]
        if not bound_rca and not bound_actions:
            continue

        version = version_by_runbook.get(runbook_id) or {}
        required = {
            "runbook_version": "Runbook 激活版本",
            "rca_root_cause": "RCA 根因",
            "rca_resolution": "处置方案",
            "rca_verification": "正式问题验收证据",
            "runbook_execution_check": "正式 Runbook 执行与验证证据",
        }
        evidence: list[dict[str, Any]] = []
        sources: list[dict[str, Any]] = []
        linked_pipeline_ids: set[str] = set()

        _record_evidence(evidence, "runbook_version", "Runbook 激活版本", {
            "version_id": version.get("id") or runbook.get("active_version_id") or "",
            "version_no": version.get("version_no") or runbook.get("active_version_no") or 1,
            "checksum": version.get("checksum") or runbook.get("checksum") or "",
        })

        for item in bound_rca:
            latest = _latest_verification(item)
            checks = _checks_from_verification(latest)
            linked = item.get("linked") if isinstance(item.get("linked"), dict) else {}
            linked_pipeline_ids.update(str(pid) for pid in linked.get("pipelines") or [] if str(pid))
            source = {
                "type": "rca",
                "id": item.get("id", ""),
                "title": item.get("incident_id") or item.get("root_cause") or item.get("id"),
                "status": item.get("status", ""),
                "verification_status": item.get("verification_status") or latest.get("status") or "",
            }
            sources.append(source)
            _record_evidence(evidence, "rca_root_cause", "RCA 根因", item.get("root_cause"))
            _record_evidence(evidence, "rca_resolution", "处置方案", checks.get("resolution") or item.get("resolution"))
            _record_evidence(evidence, "rca_verification", "RCA 验证", {
                "status": item.get("verification_status") or latest.get("status") or "",
                "score": item.get("verification_score") or latest.get("score") or 0,
                "verified_by": item.get("verified_by") or latest.get("verifier") or "",
                "verified_at": item.get("verified_at") or latest.get("created_at") or "",
            })
            _record_evidence(evidence, "runbook_execution_check", "Runbook 执行确认", {
                "runbook_status": checks.get("runbook_status") or checks.get("runbook_execution_status") or "",
                "evidence_url": checks.get("evidence_url") or checks.get("evidence") or "",
                "note": latest.get("note") or "",
            })

        if linked_pipeline_ids:
            required["linked_pipeline_recovered"] = "关联流水线恢复"
            linked_pipelines = [pipeline_by_id[pid] for pid in linked_pipeline_ids if pid in pipeline_by_id]
            _record_evidence(evidence, "linked_pipeline_recovered", "关联流水线恢复", [
                {"id": item.get("id"), "name": item.get("name"), "status": item.get("status"), "error_msg": item.get("error_msg", "")}
                for item in linked_pipelines
            ], "collected" if linked_pipelines else "missing")

        if bound_actions:
            required["self_heal_action"] = "正式自愈执行与验证证据"
        for action in bound_actions:
            sources.append({
                "type": "self_heal",
                "id": action.get("id", ""),
                "title": action.get("action") or action.get("trigger_condition") or action.get("id"),
                "status": "reported_only",
                "recorded_state": action.get("state", ""),
                "risk_level": action.get("risk_level", ""),
            })
            _record_evidence(evidence, "self_heal_action", "自愈建议记录", {
                "state": action.get("state", ""),
                "applied_by": action.get("applied_by", ""),
                "applied_at": action.get("applied_at", ""),
                "apply_result": action.get("apply_result") or {},
                "verified_by": action.get("verified_by", ""),
                "verified_at": action.get("verified_at", ""),
                "verification_result": action.get("verification_result") or {},
            }, "reported_only")

        source_key = ":".join(sorted(str(item.get("id") or "") for item in sources)) or runbook_id
        record_id = "runbook-evidence-" + hashlib.sha1(f"{runbook_id}:{version.get('id') or ''}:{source_key}".encode("utf-8")).hexdigest()[:14]
        records.append(report_runbook_evidence({
            "id": record_id,
            "runbook_id": runbook_id,
            "runbook_name": runbook.get("name", ""),
            "version_id": version.get("id") or runbook.get("active_version_id") or "",
            "version_no": version.get("version_no") or runbook.get("active_version_no") or 1,
            "required_evidence": [{"id": key, "title": title} for key, title in required.items()],
            "collected_evidence": evidence,
            "sources": sources[:20],
            "generated_at": now_value,
        }))

    records.sort(key=lambda item: (int(item.get("coverage_score") or 0), item.get("runbook_name") or ""))
    records = records[: max(1, min(limit, 500))]
    return {
        "ok": True,
        "summary": summarize_runbook_execution_evidence(records),
        "items": records,
        "generated_at": now_value,
        "agent_consumption": {
            "api": "/api/v1/ops-center/runbooks/evidence/backfill",
            "safe_for_agents": True,
            "purpose": "归集 RCA、流水线及自愈建议记录；来源覆盖率不证明执行或验收通过。",
        },
    }


def build_ops_rca_insights(
    *,
    trace_summary: dict[str, Any],
    alerts: list[dict[str, Any]],
    pipelines: list[dict[str, Any]],
    rca: list[dict[str, Any]],
    runbooks: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    normalized_alerts = [normalize_ops_alert(str(item.get("source") or "alert"), item) for item in alerts if isinstance(item, dict)]
    trace_root = trace_summary.get("root_cause", {}) if isinstance(trace_summary.get("root_cause"), dict) else {}
    trace_summary_counts = trace_summary.get("summary", {}) if isinstance(trace_summary.get("summary"), dict) else {}
    trace_nodes = trace_summary.get("root_cause_navigation", []) if isinstance(trace_summary.get("root_cause_navigation"), list) else []
    open_rca = [item for item in rca if item.get("status") == "open"]
    failed_pipelines = [item for item in pipelines if item.get("status") in {"failed", "error"} or item.get("error_msg")]
    candidates: list[dict[str, Any]] = []

    likely_causes = [str(item) for item in trace_root.get("likely_causes", []) if str(item)]
    if likely_causes or trace_summary_counts.get("failed_runs") or trace_summary_counts.get("slow_llm_calls") or trace_summary_counts.get("failed_data_jobs"):
        severity = str(trace_root.get("risk_level") or "medium")
        evidence = [
            {"type": "trace_summary", "label": key, "value": value}
            for key, value in trace_summary_counts.items()
            if value
        ]
        evidence.extend(
            {"type": node.get("type"), "label": node.get("title"), "value": node.get("detail"), "status": node.get("status")}
            for node in trace_nodes[:5]
            if isinstance(node, dict)
        )
        recommendations = list(trace_root.get("recommended_next") or [])
        if trace_summary_counts.get("slow_llm_calls"):
            recommendations.insert(0, "检查 LLM Gateway Provider 健康、路由 fallback 和慢调用模型。")
        if trace_summary_counts.get("failed_data_jobs"):
            recommendations.insert(0, "检查数据接入游标、连接器状态和最近失败作业证据。")
        candidates.append(_candidate(
            kind="trace_correlation",
            title="Trace 关联根因",
            root_cause="；".join(likely_causes) or "Trace 中存在失败 Run、慢 LLM 或失败数据作业。",
            severity=severity if severity in {"critical", "high", "medium", "low"} else "medium",
            confidence=0.82 if likely_causes else 0.68,
            evidence=evidence,
            recommendations=recommendations or ["打开 Trace 节点逐项核对 Agent、LLM、数据作业、事件和审计链。"],
            linked={"trace": trace_summary.get("trace", {}), "api": "/api/v1/system/ops/observability/traces"},
        ))

    high_alerts = [item for item in normalized_alerts if item["status"] in {"open", "active", "unpaid"} and _severity_rank(item["severity"]) >= 2]
    if high_alerts:
        source_counts: dict[str, int] = {}
        for item in high_alerts:
            source_counts[item["source"]] = source_counts.get(item["source"], 0) + 1
        top_source = sorted(source_counts.items(), key=lambda kv: kv[1], reverse=True)[0][0]
        top_severity = max((item["severity"] for item in high_alerts), key=_severity_rank)
        candidates.append(_candidate(
            kind="multi_source_alerts",
            title="多源告警聚合",
            root_cause=f"{top_source} 等来源存在 {len(high_alerts)} 条未关闭高/中风险告警。",
            severity=top_severity,
            confidence=0.76,
            evidence=[{"type": item["source"], "label": item["title"], "value": item["detail"], "status": item["status"], "severity": item["severity"]} for item in high_alerts[:8]],
            recommendations=["先处置最高等级告警并关联 Trace 证据。", "将重复告警归并为一个 RCA，避免多处重复派单。", "按 source 生成治理任务并回写处理结论。"],
            linked={"sources": source_counts},
        ))

    if failed_pipelines:
        first = failed_pipelines[0]
        candidates.append(_candidate(
            kind="pipeline_failure",
            title="部署/运维流水线失败",
            root_cause=str(first.get("error_msg") or first.get("name") or "存在失败运维流水线。"),
            severity="high",
            confidence=0.72,
            evidence=[{"type": "pipeline", "label": item.get("name") or item.get("id"), "value": item.get("error_msg") or item.get("status"), "status": item.get("status")} for item in failed_pipelines[:5]],
            recommendations=["绑定发布包、回滚 Runbook 和执行证据。", "确认失败流水线是否已经进入自愈或人工审批。"],
            linked={"pipelines": [item.get("id") for item in failed_pipelines[:8]]},
        ))

    if open_rca:
        candidates.append(_candidate(
            kind="open_rca_debt",
            title="未关闭 RCA 风险",
            root_cause=f"仍有 {len(open_rca)} 个 RCA 未关闭，可能导致同类故障重复发生。",
            severity="medium",
            confidence=0.64,
            evidence=[{"type": "rca", "label": item.get("incident_id") or item.get("id"), "value": item.get("root_cause"), "status": item.get("status")} for item in open_rca[:5]],
            recommendations=["补齐解决方案、负责人和验证证据。", "将可重复动作沉淀为 Runbook 或自愈策略。"],
            linked={"rca": [item.get("id") for item in open_rca[:8]]},
        ))

    if not candidates:
        candidates.append(_candidate(
            kind="healthy_baseline",
            title="暂无明显聚合根因",
            root_cause="当前 Trace、告警、流水线和 RCA 没有形成高置信度故障链。",
            severity="low",
            confidence=0.48,
            evidence=[],
            recommendations=["保持观测采集开启；故障发生时按 trace_id、correlation_id 或 run_id 重新分析。"],
        ))

    runbooks = runbooks or []
    for item in candidates:
        recommended = recommend_runbooks_for_candidate(item, runbooks)
        item["recommended_runbooks"] = recommended
        if recommended:
            linked = item.get("linked", {}) if isinstance(item.get("linked"), dict) else {}
            linked["runbooks"] = [rb["id"] for rb in recommended if rb.get("id")]
            item["linked"] = linked

    candidates.sort(key=lambda item: (_severity_rank(item["severity"]), item["confidence"]), reverse=True)
    return {
        "ok": True,
        "summary": {
            "candidates": len(candidates),
            "critical": sum(1 for item in candidates if item["severity"] == "critical"),
            "high": sum(1 for item in candidates if item["severity"] == "high"),
            "medium": sum(1 for item in candidates if item["severity"] == "medium"),
            "alerts": len(normalized_alerts),
            "open_alerts": len([item for item in normalized_alerts if item["status"] in {"open", "active", "unpaid"}]),
            "failed_pipelines": len(failed_pipelines),
            "open_rca": len(open_rca),
        },
        "candidates": candidates,
        "alerts": normalized_alerts[:50],
        "trace": trace_summary,
        "agent_consumption": {
            "api": "/api/v1/ops-center/rca/insights",
            "safe_for_agents": True,
            "purpose": "聚合 Trace、告警、流水线和 RCA，生成可任务化的智能根因候选。",
        },
    }


def build_ops_rca_insight_tasks(
    analysis: dict[str, Any],
    *,
    dry_run: bool,
    priority: str,
    owner_id: str,
    dev_tool: str,
) -> dict[str, Any]:
    tasks: list[dict[str, Any]] = []
    for item in analysis.get("candidates") or []:
        severity = str(item.get("severity") or "medium")
        if item.get("kind") == "healthy_baseline":
            continue
        tasks.append({
            "title": f"处置智能根因：{item.get('title')}",
            "description": "\n".join([
                "OpsCenter 智能根因归因治理任务。",
                "",
                f"Root cause: {item.get('root_cause')}",
                f"Severity: {severity}",
                f"Confidence: {item.get('confidence')}",
                "",
                "Evidence:",
                *[f"- {ev.get('type')}: {ev.get('label')} {ev.get('value') or ''}".strip() for ev in item.get("evidence") or []],
                "",
                "Recommendations:",
                *[f"- {rec}" for rec in item.get("recommendations") or []],
            ]),
            "priority": "P0" if severity == "critical" else "P1" if severity == "high" else priority,
            "estimate": "S",
            "owner_id": owner_id,
            "dev_tool": dev_tool,
            "source": "ops_center_rca_insight",
            "source_report_id": str(item.get("id") or ""),
            "source_report_title": str(item.get("title") or ""),
            "debug_notes": f"ops_rca_insight kind={item.get('kind')} severity={severity} confidence={item.get('confidence')}",
        })
    return {
        "ok": True,
        "dry_run": dry_run,
        "summary": {"planned": len(tasks), "created": 0 if dry_run else len(tasks)},
        "tasks": tasks,
        "items": tasks,
    }










def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rollback_command(action: str) -> str:
    action_l = (action or "").strip().lower()
    if action_l.startswith("rollback"):
        return "restore previous deployment and replay post-deploy verification"
    if action_l.startswith("restart"):
        return "restart previous stable service instance and verify health"
    if action_l.startswith("scale_out"):
        return "scale service back to previous replica count"
    if action_l.startswith("scale_down"):
        return "scale service up to previous replica count"
    if action_l.startswith("disable"):
        return "re-enable previous configuration"
    return f"manual rollback for: {action}"


def _audit_payload(action: dict[str, Any]) -> dict[str, Any]:
    return {
        "action_id": action.get("id"),
        "policy_id": action.get("policy_id"),
        "state": action.get("state"),
        "risk_level": action.get("risk_level"),
        "action": action.get("action"),
        "trigger_condition": action.get("trigger_condition"),
        "requires_approval": bool(action.get("requires_approval")),
        "rollback_required": bool(action.get("rollback_required")),
        "approved_by": action.get("approved_by") or "",
        "applied_by": action.get("applied_by") or "",
        "verified_by": action.get("verified_by") or "",
        "rolled_back_by": action.get("rolled_back_by") or "",
    }


def _with_audit(action: dict[str, Any]) -> dict[str, Any]:
    action["audit_payload"] = _audit_payload(action)
    return action


def build_self_heal_guarded_actions(evaluation: dict[str, Any], *, created_by: str) -> list[dict[str, Any]]:
    actions: list[dict[str, Any]] = []
    for decision in evaluation.get("decisions") or []:
        risk = str(decision.get("risk_level") or "medium")
        requires_approval = decision.get("decision") == "needs_approval" or risk == "critical"
        action_text = str(decision.get("action") or "")
        rollback_required = risk in {"critical", "high"} or any(token in action_text.lower() for token in _DESTRUCTIVE_ACTIONS)
        item = {
            "id": str(uuid4()),
            "policy_id": str(decision.get("policy_id") or ""),
            "trigger_condition": str(decision.get("trigger_condition") or ""),
            "action": action_text,
            "state": "approval_required" if requires_approval else "preview",
            "risk_level": risk,
            "requires_approval": requires_approval,
            "rollback_required": rollback_required,
            "rollback_command": _rollback_command(action_text) if rollback_required else "",
            "evidence": decision.get("evidence") or {},
            "steps": decision.get("steps") or [],
            "signals": evaluation.get("signals") or {},
            "created_by": created_by,
            "created_at": _now(),
            "approved_by": "",
            "approved_at": "",
            "approval_note": "",
            "applied_by": "",
            "applied_at": "",
            "apply_result": {},
            "verified_by": "",
            "verified_at": "",
            "verification_result": {},
            "rolled_back_by": "",
            "rolled_back_at": "",
            "rollback_evidence": {},
        }
        actions.append(_with_audit(item))
    return actions


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
