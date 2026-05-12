"""消息通知：微信/钉钉/Slack 推送开发进度"""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List
from pathlib import Path
import json, os, requests as req_lib

router = APIRouter(prefix="/api/notify", tags=["notify"])
NOTIFY_FILE = Path(os.getenv("PROJECT_PATH", ".")) / ".ai-memory" / "notify.json"

def _load(): return json.loads(NOTIFY_FILE.read_text()) if NOTIFY_FILE.exists() else {"channels": {}, "rules": []}
def _save(d): NOTIFY_FILE.parent.mkdir(parents=True, exist_ok=True); NOTIFY_FILE.write_text(json.dumps(d, indent=2))

class Channel(BaseModel):
    type: str          # wechat_work | dingtalk | slack | webhook
    name: str
    webhook_url: str
    enabled: bool = True
    events: List[str] = ["task_blocked","issue_p0","sprint_complete","deploy"]

class NotifyMsg(BaseModel):
    channel: str; title: str; content: str; level: str = "info"

@router.get("/channels")
def list_channels(): return list(_load()["channels"].values())

@router.post("/channels")
def add_channel(body: Channel):
    d = _load(); d["channels"][body.name] = body.dict(); _save(d); return {"ok": True}

@router.delete("/channels/{name}")
def del_channel(name: str):
    d = _load(); d["channels"].pop(name, None); _save(d); return {"ok": True}

@router.post("/test/{channel_name}")
def test_channel(channel_name: str):
    return send_msg(NotifyMsg(channel=channel_name, title="测试通知", content="ai-team-devops 通知测试 ✅", level="info"))

@router.post("/send")
def send_msg(body: NotifyMsg):
    d = _load()
    ch = d["channels"].get(body.channel)
    if not ch: raise HTTPException(404, "Channel not found")
    if not ch.get("enabled"): return {"ok": False, "reason": "disabled"}
    try:
        import urllib.request, json as _json
        payload = _build_payload(ch["type"], body.title, body.content, body.level)
        data = _json.dumps(payload).encode()
        r = urllib.request.urlopen(urllib.request.Request(ch["webhook_url"], data=data,
            headers={"Content-Type": "application/json"}, method="POST"), timeout=10)
        return {"ok": True, "status": r.status}
    except Exception as e:
        return {"ok": False, "error": str(e)}

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
