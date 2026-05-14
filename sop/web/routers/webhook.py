"""Webhook 配置 + 事件触发（HMAC-SHA256 签名，异步重试）"""
from __future__ import annotations
import uuid, hmac, hashlib, json, asyncio
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, HttpUrl
from sqlalchemy.orm import Session

from .sql_models import get_session, WebhookConfig
from .auth_sql import current_user, require_role, User

router = APIRouter(prefix="/api/v1/webhooks", tags=["webhooks"])

SUPPORTED_EVENTS = [
    "task.created", "task.status_changed", "task.deleted",
    "requirement.created", "requirement.updated",
    "issue.opened", "issue.resolved",
    "sprint.started", "sprint.completed",
    "project.created",
]


class WebhookCreate(BaseModel):
    name: str
    url: str
    secret: str = ""
    events: List[str] = []
    project_id: Optional[str] = None


@router.get("")
def list_webhooks(user: User = Depends(current_user), db: Session = Depends(get_session)):
    hooks = db.query(WebhookConfig).filter_by(tenant_id=user.tenant_id).all()
    return [{"id": h.id, "name": h.name, "url": h.url, "events": h.events,
             "active": h.active, "fail_count": h.fail_count,
             "last_fired_at": h.last_fired_at.isoformat() + "Z" if h.last_fired_at else None}
            for h in hooks]


@router.post("")
def create_webhook(body: WebhookCreate, user: User = Depends(require_role("project_admin")),
                   db: Session = Depends(get_session)):
    invalid = [e for e in body.events if e not in SUPPORTED_EVENTS]
    if invalid:
        raise HTTPException(400, f"不支持的事件: {invalid}")
    h = WebhookConfig(
        id=f"wh-{uuid.uuid4().hex[:12]}", tenant_id=user.tenant_id,
        project_id=body.project_id or "", name=body.name,
        url=body.url, secret=body.secret, events=body.events,
    )
    db.add(h); db.commit()
    return {"ok": True, "id": h.id}


@router.patch("/{hook_id}")
def update_webhook(hook_id: str, body: dict, user: User = Depends(require_role("project_admin")),
                   db: Session = Depends(get_session)):
    h = db.get(WebhookConfig, hook_id)
    if not h or h.tenant_id != user.tenant_id:
        raise HTTPException(404, "Webhook 不存在")
    for k in ("name", "url", "secret", "events", "active"):
        if k in body: setattr(h, k, body[k])
    db.commit()
    return {"ok": True}


@router.delete("/{hook_id}")
def delete_webhook(hook_id: str, user: User = Depends(require_role("project_admin")),
                   db: Session = Depends(get_session)):
    h = db.get(WebhookConfig, hook_id)
    if not h or h.tenant_id != user.tenant_id:
        raise HTTPException(404, "Webhook 不存在")
    db.delete(h); db.commit()
    return {"ok": True}


@router.post("/{hook_id}/test")
def test_webhook(hook_id: str, user: User = Depends(current_user),
                 db: Session = Depends(get_session)):
    h = db.get(WebhookConfig, hook_id)
    if not h or h.tenant_id != user.tenant_id:
        raise HTTPException(404, "Webhook 不存在")
    result = _fire_sync(h, "webhook.test", {"message": "test ping", "triggered_by": user.username})
    return {"ok": result["ok"], "status_code": result.get("status_code"), "error": result.get("error")}


@router.get("/events")
def list_events():
    return {"events": SUPPORTED_EVENTS}


# ── 触发引擎 ──────────────────────────────────────────────────────
def _sign(secret: str, payload: str) -> str:
    if not secret:
        return ""
    return "sha256=" + hmac.new(secret.encode(), payload.encode(), hashlib.sha256).hexdigest()


def _fire_sync(hook: WebhookConfig, event: str, data: dict) -> dict:
    import urllib.request, urllib.error
    payload = json.dumps({"event": event, "data": data,
                          "fired_at": datetime.utcnow().isoformat() + "Z"})
    sig = _sign(hook.secret, payload)
    headers = {"Content-Type": "application/json", "X-Sop-Event": event}
    if sig: headers["X-Sop-Signature"] = sig
    req = urllib.request.Request(hook.url, data=payload.encode(), headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return {"ok": True, "status_code": resp.status}
    except urllib.error.HTTPError as e:
        return {"ok": False, "status_code": e.code, "error": str(e)}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def fire_event(event: str, data: dict, tenant_id: str, project_id: str = ""):
    """异步触发所有匹配的 Webhook（不阻塞请求）"""
    db = next(get_session())
    try:
        hooks = db.query(WebhookConfig).filter_by(
            tenant_id=tenant_id, active=True
        ).all()
        hooks = [h for h in hooks if event in (h.events or [])
                 and (not h.project_id or h.project_id == project_id)]
    finally:
        db.close()

    for hook in hooks:
        asyncio.get_event_loop().run_in_executor(None, _fire_with_retry, hook.id, event, data)


def _fire_with_retry(hook_id: str, event: str, data: dict, max_retries: int = 3):
    db = next(get_session())
    try:
        hook = db.get(WebhookConfig, hook_id)
        if not hook: return
        for attempt in range(max_retries):
            result = _fire_sync(hook, event, data)
            if result["ok"]:
                hook.fail_count = 0
                hook.last_fired_at = datetime.utcnow()
                db.commit()
                return
            import time; time.sleep(2 ** attempt)
        hook.fail_count = (hook.fail_count or 0) + 1
        if hook.fail_count >= 10: hook.active = False
        db.commit()
    except Exception:
        db.rollback()
    finally:
        db.close()
