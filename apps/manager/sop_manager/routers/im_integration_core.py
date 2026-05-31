"""Pure helpers for IM briefing and delivery planning."""
from __future__ import annotations

from typing import Any


_RISK_ORDER = {"critical": 4, "high": 3, "medium": 2, "low": 1}


def _int(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except Exception:
        return default


def _risk_from(summary: dict[str, Any], risks: list[dict[str, Any]]) -> str:
    explicit = [str(item.get("level") or "low") for item in risks if isinstance(item, dict)]
    top = max(explicit, key=lambda level: _RISK_ORDER.get(level, 0), default="low")
    score = _int(summary.get("health_score"), 100)
    if score < 60:
        return "critical" if top == "critical" else "high"
    if score < 80 and _RISK_ORDER.get(top, 0) < _RISK_ORDER["medium"]:
        return "medium"
    return top


def _level_for(risk_level: str) -> str:
    if risk_level in {"critical", "high"}:
        return "error"
    if risk_level == "medium":
        return "warn"
    return "info"


def _summary_lines(summary: dict[str, Any]) -> list[str]:
    lines: list[str] = []
    for key in sorted(summary.keys()):
        value = summary.get(key)
        if isinstance(value, (dict, list)):
            continue
        lines.append(f"- {key}: {value}")
    return lines[:12]


def _channel_name(row: dict[str, Any]) -> str:
    return str(row.get("name") or "").strip()


def _channel_events(row: dict[str, Any]) -> set[str]:
    raw = row.get("events")
    if not isinstance(raw, list):
        return set()
    return {str(item).strip() for item in raw if str(item).strip()}


def _matches_event(row: dict[str, Any], event: str) -> bool:
    events = _channel_events(row)
    return bool(event and ("*" in events or event in events))


def inbound_dedupe_key(row: dict[str, Any]) -> str:
    import hashlib
    import json

    payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    explicit = (
        row.get("idempotency_key")
        or row.get("dedupe_key")
        or payload.get("message_id")
        or payload.get("event_id")
        or payload.get("id")
        or payload.get("msg_id")
    )
    if explicit:
        return f"inbound:{row.get('channel') or row.get('connector_type') or 'unknown'}:{explicit}"
    stable = {
        "channel": row.get("channel", ""),
        "sender": row.get("sender", ""),
        "event": row.get("event", ""),
        "text": row.get("text") or row.get("content") or "",
    }
    digest = hashlib.sha256(json.dumps(stable, ensure_ascii=False, sort_keys=True).encode("utf-8")).hexdigest()[:24]
    return f"inbound:{stable['channel']}:{digest}"


def build_connector_health(channels: list[dict[str, Any]], events: list[dict[str, Any]]) -> dict[str, Any]:
    items: list[dict[str, Any]] = []
    for channel in channels:
        name = str(channel.get("name") or "")
        related = [event for event in events if str(event.get("channel") or "") == name]
        failures = [event for event in related if event.get("ok") is False]
        last = related[0] if related else {}
        enabled = bool(channel.get("enabled", True))
        status = "disabled" if not enabled else "degraded" if failures else "healthy" if related else "idle"
        items.append({
            "name": name,
            "type": str(channel.get("type") or "webhook"),
            "enabled": enabled,
            "status": status,
            "events": channel.get("events") if isinstance(channel.get("events"), list) else [],
            "message_count": len(related),
            "failure_count": len(failures),
            "last_message_at": str(last.get("ts") or ""),
            "last_direction": str(last.get("direction") or ""),
        })
    configured = len(items)
    healthy = sum(1 for item in items if item["status"] in {"healthy", "idle"})
    degraded = sum(1 for item in items if item["status"] == "degraded")
    disabled = sum(1 for item in items if item["status"] == "disabled")
    return {
        "summary": {
            "configured": configured,
            "healthy": healthy,
            "degraded": degraded,
            "disabled": disabled,
            "score": round((healthy / configured) * 100, 1) if configured else 0,
        },
        "items": items,
    }


def build_im_briefing(
    *,
    module: str,
    title: str,
    summary: dict[str, Any],
    risks: list[dict[str, Any]],
    recommendations: list[str],
    scope: dict[str, Any],
    actions: list[dict[str, Any]],
) -> dict[str, Any]:
    risk_level = _risk_from(summary, risks)
    lines = [
        f"## {title}",
        "",
        f"- 模块: {module}",
        f"- 风险等级: {risk_level}",
        f"- 健康分: {summary.get('health_score', '-')}",
        "",
        "### 关键指标",
        *_summary_lines(summary),
    ]
    if risks:
        lines.extend(["", "### 风险"])
        for risk in risks[:6]:
            lines.append(f"- [{risk.get('level', 'medium')}] {risk.get('title') or risk.get('recommendation') or '运行风险'}")
    if recommendations:
        lines.extend(["", "### 建议"])
        for item in recommendations[:6]:
            lines.append(f"- {item}")
    if actions:
        lines.extend(["", "### 操作入口"])
        for action in actions[:5]:
            lines.append(f"- {action.get('label')}: {action.get('href') or action.get('api') or '-'}")
    return {
        "module": module,
        "title": title,
        "level": _level_for(risk_level),
        "risk_level": risk_level,
        "content": "\n".join(lines),
        "summary": summary,
        "risks": risks,
        "recommendations": recommendations,
        "actions": actions,
        "payload": {
            "module": module,
            "scope": dict(scope),
            "summary": summary,
            "risk_level": risk_level,
            "actions": actions,
        },
    }


def build_im_delivery_plan(
    briefing: dict[str, Any],
    channels: list[dict[str, Any]],
    *,
    requested_channels: list[str],
    event: str = "",
) -> dict[str, Any]:
    event = str(event or "").strip()
    requested = [str(item).strip() for item in requested_channels if str(item).strip()]
    by_name = {_channel_name(row): row for row in channels if _channel_name(row)}
    enabled = [row for row in channels if bool(row.get("enabled", True))]
    blocked: list[dict[str, str]] = []
    if requested:
        targets = [row for row in enabled if str(row.get("name") or "") in requested]
        found = {str(row.get("name") or "") for row in targets}
        for name in requested:
            row = by_name.get(name)
            if row and not bool(row.get("enabled", True)):
                blocked.append({"name": name, "reason": "disabled"})
        unavailable = found | {item["name"] for item in blocked}
        missing = sorted(name for name in requested if name not in unavailable)
        selection_mode = "requested"
    else:
        matched = [row for row in enabled if _matches_event(row, event)]
        targets = matched or enabled
        missing = []
        selection_mode = "event" if matched else "fallback"
    messages = [
        {
            "channel": str(row.get("name") or ""),
            "type": str(row.get("type") or "webhook"),
            "title": str(briefing.get("title") or "Hermes IM Briefing"),
            "content": str(briefing.get("content") or ""),
            "level": str(briefing.get("level") or "info"),
        }
        for row in targets
    ]
    target_names = [_channel_name(row) for row in targets if _channel_name(row)]
    audit = {
        "module": str(briefing.get("module") or ""),
        "event": event,
        "risk_level": str(briefing.get("risk_level") or ""),
        "selection_mode": selection_mode,
        "selected_channels": target_names,
        "missing_channels": missing,
        "blocked_channels": blocked,
        "message_count": len(messages),
    }
    return {
        "ready": bool(targets),
        "targets": targets,
        "target_count": len(targets),
        "messages": messages,
        "missing_channels": missing,
        "blocked_channels": blocked,
        "selection_mode": selection_mode,
        "audit": audit,
        "recommendation": "" if targets else "请先在通信集成中配置并启用企业微信、钉钉、Slack 或 Webhook 通道。",
    }


def build_report_subscription_digest(
    *,
    subscriptions: list[dict[str, Any]],
    notify_summary: dict[str, Any],
    connector_health: dict[str, Any],
    recent_events: list[dict[str, Any]],
    scope: dict[str, Any],
    now_iso: str,
) -> dict[str, Any]:
    enabled = [row for row in subscriptions if bool(row.get("enabled", True))]
    failures = _int(notify_summary.get("failures"))
    messages = _int(notify_summary.get("messages"))
    last_24h = _int(notify_summary.get("last_24h"))
    health_summary = connector_health.get("summary") if isinstance(connector_health.get("summary"), dict) else {}
    health_score = float(health_summary.get("score") or 0)
    degraded = _int(health_summary.get("degraded"))
    disabled = _int(health_summary.get("disabled"))
    risk_level = "high" if failures or degraded else "medium" if disabled or health_score < 80 else "low"
    recent_titles = [
        str(event.get("title") or event.get("event") or event.get("channel") or "")
        for event in recent_events[:5]
        if isinstance(event, dict)
    ]
    base_summary = {
        "health_score": health_score,
        "subscriptions": len(subscriptions),
        "enabled_subscriptions": len(enabled),
        "messages": messages,
        "last_24h": last_24h,
        "failures": failures,
        "degraded_connectors": degraded,
        "disabled_connectors": disabled,
    }
    risks: list[dict[str, Any]] = []
    if failures:
        risks.append({"level": "high", "title": f"消息流水存在 {failures} 条失败记录"})
    if degraded:
        risks.append({"level": "medium", "title": f"{degraded} 个连接器处于降级状态"})
    if disabled:
        risks.append({"level": "low", "title": f"{disabled} 个连接器已停用"})
    recommendations = [
        "优先检查失败或降级通道，避免订阅报告漏投。",
        "将关键报告订阅绑定到两个以上可用通道。",
    ] if risks else ["当前通信通道健康，可按订阅策略投递报告简报。"]
    items: list[dict[str, Any]] = []
    for row in subscriptions:
        report_type = str(row.get("report_type") or "report")
        channel = str(row.get("channel") or "")
        schedule = str(row.get("schedule") or "weekly")
        filters = row.get("filters") if isinstance(row.get("filters"), dict) else {}
        title = f"Hermes {report_type} {schedule} report"
        briefing = build_im_briefing(
            module="notify",
            title=title,
            summary={**base_summary, "report_type": report_type, "schedule": schedule, "channel": channel},
            risks=risks or ([{"level": risk_level, "title": "订阅可正常投递"}] if risk_level != "low" else []),
            recommendations=recommendations,
            scope=scope,
            actions=[
                {"label": "通信集成", "href": "#/notify"},
                {"label": "订阅运行中心", "href": "#/notify/subscription-runs"},
            ],
        )
        items.append({
            "subscription_id": str(row.get("id") or f"{report_type}:{channel}"),
            "report_type": report_type,
            "channel": channel,
            "schedule": schedule,
            "enabled": bool(row.get("enabled", True)),
            "filters": filters,
            "briefing": briefing,
            "recent_titles": recent_titles,
        })
    return {
        "ok": True,
        "generated_at": now_iso,
        "scope": dict(scope),
        "summary": base_summary,
        "risk_level": risk_level,
        "recommendations": recommendations,
        "items": items,
    }
