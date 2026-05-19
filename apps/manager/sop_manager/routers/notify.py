"""消息通知：微信/钉钉/Slack/Webhook 推送开发进度与入站协同"""
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field
from typing import Any, List
from pathlib import Path
import base64, datetime, hashlib, hmac, json, time, uuid
from sop_manager.path_config import (
    resolved_ai_memory_root,
    resolved_business_code,
    resolved_project_code,
    resolved_project_id,
    resolved_tenant_code,
)

router = APIRouter(prefix="/api/v1/notify", tags=["notify"])


def _notify_file() -> Path:
    return resolved_ai_memory_root() / "notify.json"


def _load(): return json.loads(_notify_file().read_text()) if _notify_file().exists() else {"channels": {}, "rules": []}
def _save(d):
    p = _notify_file()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, indent=2))

def _ledger_file() -> Path:
    return resolved_ai_memory_root() / "notify-events.jsonl"

def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

def _scope() -> dict[str, str]:
    return {
        "tenant_code": resolved_tenant_code(),
        "business_code": resolved_business_code(),
        "project_id": resolved_project_id(),
        "project_code": resolved_project_code(),
    }

def _append_event(row: dict[str, Any]) -> dict[str, Any]:
    row.setdefault("id", f"msg-{uuid.uuid4().hex[:12]}")
    row.setdefault("ts", _now())
    for k, v in _scope().items():
        row.setdefault(k, v)
    p = _ledger_file()
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False) + "\n")
    return row

def _read_events(limit: int = 100, direction: str = "") -> list[dict[str, Any]]:
    p = _ledger_file()
    if not p.exists():
        return []
    out: list[dict[str, Any]] = []
    for line in reversed(p.read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        if direction and row.get("direction") != direction:
            continue
        out.append(row)
        if len(out) >= limit:
            break
    return out

def _find_event(message_id: str) -> dict[str, Any] | None:
    p = _ledger_file()
    if not p.exists():
        return None
    for line in reversed(p.read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        if str(row.get("id") or "") == message_id:
            return row
    return None

def _inbound_title(row: dict[str, Any]) -> str:
    text = str(row.get("text") or row.get("content") or "").strip()
    first = next((x.strip() for x in text.splitlines() if x.strip()), "")
    return (first or f"{row.get('channel') or 'inbound'} 入站消息")[:80]

def _inbound_description(row: dict[str, Any]) -> str:
    payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
    detail = {
        "message_id": row.get("id"),
        "channel": row.get("channel"),
        "sender": row.get("sender"),
        "event": row.get("event"),
        "ts": row.get("ts"),
        "payload": payload,
    }
    return f"{row.get('text') or row.get('content') or ''}\n\n入站上下文:\n{json.dumps(detail, ensure_ascii=False, indent=2)}"

class Channel(BaseModel):
    type: str          # wechat_work | dingtalk | slack | webhook
    name: str
    webhook_url: str
    enabled: bool = True
    events: List[str] = ["task_blocked","issue_p0","sprint_complete","deploy"]

class NotifyMsg(BaseModel):
    channel: str; title: str; content: str; level: str = "info"

class ChannelPatch(BaseModel):
    webhook_url: str | None = None
    enabled: bool | None = None
    events: list[str] | None = None

class InboundMsg(BaseModel):
    channel: str = "inbound"
    sender: str = ""
    text: str = Field(default="", max_length=20000)
    event: str = "message"
    payload: dict[str, Any] = {}

class InboundAction(BaseModel):
    action: str = Field("task", pattern="^(task|requirement)$")
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = "Coder"
    assigned_agent: str = "PM"
    dev_tool: str = "copilot"

class ConnectorVerifyIn(BaseModel):
    secret: str = Field(default="", max_length=2048)
    timestamp: str = ""
    nonce: str = ""
    signature: str = ""
    payload: dict[str, Any] = {}
    body: str = ""

CONNECTOR_CATALOG: list[dict[str, Any]] = [
    {
        "type": "dingtalk",
        "name": "DingTalk",
        "display_name": "钉钉机器人",
        "events": ["task_blocked", "issue_p0", "deploy", "approval_required", "quality_blocked"],
        "direction": ["outbound", "inbound"],
        "auth": ["webhook_url", "sign_secret"],
        "signature": "hmac_sha256_base64(timestamp + '\\n' + secret)",
        "inbound_modes": ["bot_callback", "stream", "manual_simulation"],
        "actions": ["send_alert", "create_task", "create_requirement", "approval_callback"],
        "callback_path": "/api/v1/notify/connectors/dingtalk/inbound",
        "maturity": "beta",
    },
    {
        "type": "wechat_work",
        "name": "WeCom",
        "display_name": "企业微信机器人",
        "events": ["task_blocked", "sprint_complete", "deploy", "approval_required", "quality_blocked"],
        "direction": ["outbound", "inbound"],
        "auth": ["webhook_url", "token", "encoding_aes_key"],
        "signature": "sha1(token, timestamp, nonce, body_or_echo)",
        "inbound_modes": ["callback_url_verify", "bot_callback", "manual_simulation"],
        "actions": ["send_alert", "create_task", "create_requirement", "approval_callback"],
        "callback_path": "/api/v1/notify/connectors/wechat_work/inbound",
        "maturity": "beta",
    },
    {
        "type": "webhook",
        "name": "Generic Webhook",
        "display_name": "通用 Webhook",
        "events": ["*"],
        "direction": ["outbound", "inbound"],
        "auth": ["webhook_url", "hmac_secret", "bearer_token"],
        "signature": "x-hermes-signature: sha256=<hmac_sha256(timestamp + '.' + body)>",
        "inbound_modes": ["json_callback", "cloud_event", "agent_event"],
        "actions": ["send_alert", "create_task", "create_requirement", "event_wakeup"],
        "callback_path": "/api/v1/notify/connectors/webhook/inbound",
        "maturity": "ga",
    },
    {
        "type": "slack",
        "name": "Slack",
        "display_name": "Slack Webhook",
        "events": ["issue_p0", "deploy", "quality_blocked"],
        "direction": ["outbound"],
        "auth": ["webhook_url"],
        "signature": "",
        "inbound_modes": [],
        "actions": ["send_alert"],
        "callback_path": "",
        "maturity": "preview",
    },
]

CHANNEL_TEMPLATES = [
    {
        "type": c["type"],
        "name": c["name"],
        "events": c["events"],
        "direction": c["direction"],
        "secret_mode": "webhook_url",
    }
    for c in CONNECTOR_CATALOG
]

def _public_channel(ch: dict[str, Any]) -> dict[str, Any]:
    out = dict(ch)
    raw = str(out.get("webhook_url") or "")
    out["webhook_url"] = "***" if raw else ""
    out["has_webhook"] = bool(raw)
    return out

def _connector(connector_type: str) -> dict[str, Any]:
    for item in CONNECTOR_CATALOG:
        if item["type"] == connector_type:
            return item
    raise HTTPException(404, "Connector not found")

def _callback_template(connector_type: str, request: Request | None = None) -> dict[str, Any]:
    item = _connector(connector_type)
    base_url = str(request.base_url).rstrip("/") if request else ""
    callback_path = item.get("callback_path") or ""
    callback_url = f"{base_url}{callback_path}" if callback_path and base_url else callback_path
    return {
        "type": connector_type,
        "callback_path": callback_path,
        "callback_url": callback_url,
        "signature": item.get("signature", ""),
        "required_scope": ["tenant_code", "business_code", "project_id"],
        "headers": {
            "X-Tenant-Code": resolved_tenant_code(),
            "X-Business-Code": resolved_business_code(),
            "X-Project-Id": resolved_project_id(),
            "X-Project-Code": resolved_project_code(),
        },
        "sample_payload": {
            "event": "message",
            "sender": "external-user-or-agent",
            "text": "请把这个入站消息转为需求或任务",
            "priority": "P1",
            "metadata": {"source": connector_type},
        },
    }

def _sign_dingtalk(secret: str, timestamp: str) -> str:
    raw = f"{timestamp}\n{secret}".encode("utf-8")
    digest = hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).digest()
    return base64.b64encode(digest).decode("utf-8")

def _sign_wechat_work(secret: str, timestamp: str, nonce: str, body: str) -> str:
    parts = sorted([secret or "", timestamp or "", nonce or "", body or ""])
    return hashlib.sha1("".join(parts).encode("utf-8")).hexdigest()

def _sign_webhook(secret: str, timestamp: str, body: str) -> str:
    raw = f"{timestamp}.{body}".encode("utf-8")
    return "sha256=" + hmac.new(secret.encode("utf-8"), raw, hashlib.sha256).hexdigest()

def _safe_compare(left: str, right: str) -> bool:
    return bool(left and right) and hmac.compare_digest(left, right)

def _text_from_payload(connector_type: str, payload: dict[str, Any], raw_body: str) -> str:
    if connector_type == "dingtalk":
        text = payload.get("text") or {}
        if isinstance(text, dict):
            return str(text.get("content") or "").strip()
        return str(text or payload.get("content") or raw_body).strip()
    if connector_type == "wechat_work":
        return str(payload.get("Content") or payload.get("content") or payload.get("text") or raw_body).strip()
    return str(payload.get("text") or payload.get("content") or payload.get("message") or payload.get("title") or raw_body).strip()

def _sender_from_payload(connector_type: str, payload: dict[str, Any]) -> str:
    if connector_type == "dingtalk":
        return str(payload.get("senderNick") or payload.get("senderStaffId") or payload.get("conversationId") or "")
    if connector_type == "wechat_work":
        return str(payload.get("FromUserName") or payload.get("user_id") or payload.get("sender") or "")
    return str(payload.get("sender") or payload.get("from") or payload.get("user") or payload.get("agent") or "")

def _event_from_payload(connector_type: str, payload: dict[str, Any]) -> str:
    if connector_type == "dingtalk":
        return str(payload.get("msgtype") or payload.get("event") or "message")
    if connector_type == "wechat_work":
        return str(payload.get("Event") or payload.get("MsgType") or payload.get("event") or "message")
    return str(payload.get("event") or payload.get("type") or "message")

def _normalize_inbound(connector_type: str, payload: dict[str, Any], raw_body: str, request: Request) -> dict[str, Any]:
    return {
        "direction": "inbound",
        "connector_type": connector_type,
        "channel": str(payload.get("channel") or payload.get("channel_name") or connector_type),
        "sender": _sender_from_payload(connector_type, payload),
        "event": _event_from_payload(connector_type, payload),
        "text": _text_from_payload(connector_type, payload, raw_body),
        "payload": payload,
        "headers": {
            "user-agent": request.headers.get("user-agent", ""),
            "x-hermes-timestamp": request.headers.get("x-hermes-timestamp", ""),
            "x-hermes-signature": request.headers.get("x-hermes-signature", ""),
        },
        "ok": True,
    }

@router.get("/connectors")
def connectors(request: Request):
    channels = _load()["channels"]
    counts: dict[str, int] = {}
    for ch in channels.values():
        ctype = str(ch.get("type") or "unknown")
        counts[ctype] = counts.get(ctype, 0) + 1
    items = []
    for item in CONNECTOR_CATALOG:
        row = dict(item)
        row["configured_channels"] = counts.get(item["type"], 0)
        row["callback"] = _callback_template(item["type"], request)
        items.append(row)
    return {"items": items, "total": len(items), "scope": _scope()}

@router.get("/connectors/{connector_type}/callback-template")
def connector_callback_template(connector_type: str, request: Request):
    return _callback_template(connector_type, request)

@router.post("/connectors/{connector_type}/verify")
def connector_verify(connector_type: str, body: ConnectorVerifyIn):
    _connector(connector_type)
    raw_body = body.body or json.dumps(body.payload, ensure_ascii=False, separators=(",", ":"))
    timestamp = body.timestamp or str(int(time.time() * 1000))
    if connector_type == "dingtalk":
        expected = _sign_dingtalk(body.secret, timestamp) if body.secret else ""
    elif connector_type == "wechat_work":
        expected = _sign_wechat_work(body.secret, timestamp, body.nonce, raw_body) if body.secret else ""
    elif connector_type == "webhook":
        expected = _sign_webhook(body.secret, timestamp, raw_body) if body.secret else ""
    else:
        expected = ""
    return {
        "ok": _safe_compare(body.signature, expected) if body.signature else bool(expected or connector_type == "slack"),
        "type": connector_type,
        "timestamp": timestamp,
        "expected_signature": expected,
        "matched": _safe_compare(body.signature, expected) if body.signature else None,
        "headers": {
            "X-Hermes-Timestamp": timestamp,
            "X-Hermes-Signature": expected,
        },
    }

@router.post("/connectors/{connector_type}/inbound")
async def connector_inbound(connector_type: str, request: Request):
    _connector(connector_type)
    raw = (await request.body()).decode("utf-8", errors="replace")
    payload: dict[str, Any] = {}
    if raw.strip():
        try:
            parsed = json.loads(raw)
            payload = parsed if isinstance(parsed, dict) else {"items": parsed}
        except Exception:
            payload = {"raw": raw}
    row = _normalize_inbound(connector_type, payload, raw, request)
    return _append_event(row)

@router.get("/templates")
def templates(): return {"items": CHANNEL_TEMPLATES}

@router.get("/channels")
def list_channels(): return [_public_channel(x) for x in _load()["channels"].values()]

@router.post("/channels")
def add_channel(body: Channel):
    d = _load()
    row = body.model_dump()
    row["created_at"] = _now()
    row["updated_at"] = _now()
    d["channels"][body.name] = row
    _save(d)
    return {"ok": True, "channel": _public_channel(row)}

@router.patch("/channels/{name}")
def patch_channel(name: str, body: ChannelPatch):
    d = _load()
    ch = d["channels"].get(name)
    if not ch:
        raise HTTPException(404, "Channel not found")
    patch = body.model_dump(exclude_none=True)
    ch.update(patch)
    ch["updated_at"] = _now()
    d["channels"][name] = ch
    _save(d)
    return {"ok": True, "channel": _public_channel(ch)}

@router.delete("/channels/{name}")
def del_channel(name: str):
    d = _load(); d["channels"].pop(name, None); _save(d); return {"ok": True}

@router.post("/test/{channel_name}")
def test_channel(channel_name: str):
    return send_msg(NotifyMsg(channel=channel_name, title="测试通知", content="ai-team-devops 通知测试", level="info"))

@router.post("/send")
def send_msg(body: NotifyMsg):
    d = _load()
    ch = d["channels"].get(body.channel)
    if not ch: raise HTTPException(404, "Channel not found")
    if not ch.get("enabled"):
        return _append_event({"direction": "outbound", "channel": body.channel, "title": body.title, "content": body.content, "level": body.level, "ok": False, "reason": "disabled"})
    try:
        import urllib.request, json as _json
        payload = _build_payload(ch["type"], body.title, body.content, body.level)
        data = _json.dumps(payload).encode()
        r = urllib.request.urlopen(urllib.request.Request(ch["webhook_url"], data=data,
            headers={"Content-Type": "application/json"}, method="POST"), timeout=10)
        return _append_event({"direction": "outbound", "channel": body.channel, "type": ch["type"], "title": body.title, "content": body.content, "level": body.level, "ok": True, "status": r.status})
    except Exception as e:
        return _append_event({"direction": "outbound", "channel": body.channel, "type": ch.get("type"), "title": body.title, "content": body.content, "level": body.level, "ok": False, "error": str(e)})

@router.post("/inbound")
def inbound(body: InboundMsg):
    return _append_event({
        "direction": "inbound",
        "channel": body.channel,
        "sender": body.sender,
        "event": body.event,
        "text": body.text,
        "payload": body.payload,
        "ok": True,
    })

@router.post("/inbound/{message_id}/action")
def inbound_action(message_id: str, body: InboundAction):
    row = _find_event(message_id)
    if not row:
        raise HTTPException(404, "Message not found")
    if row.get("direction") != "inbound":
        raise HTTPException(400, "Only inbound messages can be converted")
    title = _inbound_title(row)
    description = _inbound_description(row)
    preview = {
        "action": body.action,
        "title": title,
        "description": description,
        "priority": body.priority,
        "source_message_id": message_id,
    }
    if body.dry_run:
        return {"ok": True, "dry_run": True, "item": preview}

    if body.action == "task":
        from .tasks import TaskCreate, create_task

        out = create_task(TaskCreate(
            title=f"处理入站消息：{title}",
            description=description,
            priority=body.priority,
            estimate="M",
            assigned_to=body.assigned_to or "Coder",
            dev_tool=body.dev_tool or "copilot",
            source="notify_inbound",
            source_report_id=message_id,
            source_report_title=title,
        ))
        result = {"ok": True, "dry_run": False, "action": "task", "id": out.get("id"), "item": preview}
    else:
        from .requirements import ReqCreate, create_req

        out = create_req(ReqCreate(
            title=f"入站需求：{title}",
            description=description,
            priority=body.priority,
            acceptance_criteria=["已确认消息诉求和处理范围", "已完成对应任务或需求状态更新"],
            tags=["notify-inbound", str(row.get("channel") or "inbound")],
            assigned_agent=body.assigned_agent or "PM",
            dev_tool=body.dev_tool or "copilot",
        ))
        result = {"ok": True, "dry_run": False, "action": "requirement", "id": out.get("id"), "item": preview}
    _append_event({
        "direction": "internal",
        "channel": "notify",
        "event": "inbound_action_created",
        "source_message_id": message_id,
        "action": body.action,
        "target_id": result.get("id"),
        "ok": True,
    })
    return result

@router.get("/messages")
def messages(limit: int = 100, direction: str = ""):
    items = _read_events(limit=limit, direction=direction)
    return {"items": items, "total": len(items)}

@router.get("/charts")
def notify_charts():
    payload = summary()
    by_direction = payload.get("by_direction") if isinstance(payload.get("by_direction"), dict) else {}
    by_channel_type = payload.get("by_channel_type") if isinstance(payload.get("by_channel_type"), dict) else {}
    by_channel = payload.get("by_channel") if isinstance(payload.get("by_channel"), dict) else {}
    top_channels = sorted(by_channel.items(), key=lambda x: (-int(x[1]), x[0]))[:8]
    return {
        "ok": True,
        "by_direction": [{"name": k, "value": int(v)} for k, v in by_direction.items() if int(v) > 0],
        "by_channel_type": [{"name": k, "value": int(v)} for k, v in by_channel_type.items() if int(v) > 0],
        "by_channel": [{"name": k, "value": int(v)} for k, v in top_channels if int(v) > 0],
    }


@router.get("/summary")
def summary():
    channels = list_channels()
    events = _read_events(limit=1000)
    by_direction: dict[str, int] = {}
    by_channel: dict[str, int] = {}
    failures = 0
    last_24h = 0
    now = datetime.datetime.now(datetime.timezone.utc)
    for e in events:
        by_direction[e.get("direction", "unknown")] = by_direction.get(e.get("direction", "unknown"), 0) + 1
        ch = str(e.get("channel") or "unknown")
        by_channel[ch] = by_channel.get(ch, 0) + 1
        if e.get("ok") is False:
            failures += 1
        ts = str(e.get("ts") or "")
        if ts:
            try:
                dt = datetime.datetime.fromisoformat(ts.replace("Z", "+00:00"))
                if (now - dt).total_seconds() <= 86400:
                    last_24h += 1
            except Exception:
                pass
    by_type: dict[str, int] = {}
    for ch in channels:
        t = str(ch.get("type") or "unknown")
        by_type[t] = by_type.get(t, 0) + 1
    return {
        "ok": True,
        "channels": len(channels),
        "enabled": len([c for c in channels if c.get("enabled")]),
        "messages": len(events),
        "failures": failures,
        "last_24h": last_24h,
        "by_direction": by_direction,
        "by_channel": by_channel,
        "by_channel_type": by_type,
    }


@router.get("/hub")
def notify_hub() -> dict[str, Any]:
    payload = summary()
    charts = notify_charts()
    return {
        "ok": True,
        "summary": {
            "channels": payload.get("channels", 0),
            "enabled": payload.get("enabled", 0),
            "messages": payload.get("messages", 0),
            "failures": payload.get("failures", 0),
            "last_24h": payload.get("last_24h", 0),
        },
        "charts": {
            "by_direction": charts.get("by_direction") or [],
            "by_channel_type": charts.get("by_channel_type") or [],
            "by_channel": charts.get("by_channel") or [],
        },
        "domains": [
            {"id": "channels", "path": "#/notify/channels", "capability": "ecosystem.notify.channels"},
            {"id": "outbound", "path": "#/notify/outbound", "capability": "ecosystem.notify.outbound"},
            {"id": "inbound", "path": "#/notify/inbound", "capability": "ecosystem.notify.inbound"},
            {"id": "messages", "path": "#/notify/messages", "capability": "ecosystem.notify.messages"},
            {"id": "connectors", "path": "#/notify/connectors", "capability": "ecosystem.notify.connectors"},
            {"id": "webhooks", "path": "#/notify/webhooks", "capability": "ecosystem.notify.webhooks"},
        ],
    }


@router.get("/timeline")
def notify_timeline(limit: int = 80, direction: str = "") -> dict[str, Any]:
    """按日聚合消息流水，供通信集成工作台时间线展示。"""
    from collections import defaultdict

    events = _read_events(limit=max(limit, 200), direction=direction)
    buckets: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in events:
        ts = str(e.get("ts") or "")
        day = ts[:10] if len(ts) >= 10 else "unknown"
        buckets[day].append(e)
    days = [
        {"date": day, "count": len(items), "items": items[:10]}
        for day, items in sorted(buckets.items(), reverse=True)
    ]
    return {"ok": True, "total": len(events), "days": days[:30]}

@router.post("/broadcast")
def broadcast(title: str, content: str, level: str = "info", event: str = ""):
    """广播到所有启用的频道"""
    d = _load(); results = {}
    for name, ch in d["channels"].items():
        if not ch.get("enabled"): continue
        if event and event not in ch.get("events", []): continue
        results[name] = send_msg(NotifyMsg(channel=name, title=title, content=content, level=level))
    return results

def _build_payload(ch_type: str, title: str, content: str, level: str) -> dict:
    icon = {"info":"ℹ️","warn":"⚠️","error":"❌","success":"✅"}.get(level,"📢")
    if ch_type == "dingtalk":
        return {"msgtype":"markdown","markdown":{"title":title,"text":f"## {icon} {title}\n\n{content}"}}
    if ch_type == "wechat_work":
        return {"msgtype":"markdown","markdown":{"content":f"**{icon} {title}**\n>{content}"}}
    if ch_type == "slack":
        return {"text":f"{icon} *{title}*\n{content}"}
    return {"title":title,"content":content,"level":level}  # generic webhook
