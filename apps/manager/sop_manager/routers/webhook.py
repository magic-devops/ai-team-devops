"""Webhook 配置 + 事件触发（HMAC-SHA256 签名，异步重试）"""
from __future__ import annotations
import uuid, hmac, hashlib, json, asyncio
from datetime import datetime
from typing import Optional, List
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, HttpUrl
from sqlalchemy.orm import Session

from sop_manager.path_config import resolved_ai_memory_root
from .sql_models import get_session, WebhookConfig
from .auth_sql import current_user, require_role, User

router = APIRouter(prefix="/api/v1/webhooks", tags=["webhooks"])


def _delivery_log_path():
    from pathlib import Path

    p = resolved_ai_memory_root() / "webhook_deliveries.jsonl"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _append_delivery(row: dict) -> None:
    import json as _json

    with _delivery_log_path().open("a", encoding="utf-8") as f:
        f.write(_json.dumps(row, ensure_ascii=False) + "\n")

# (id, category, label_zh, label_en, hint_zh, hint_en)
_EVENT_ROWS: list[tuple[str, str, str, str, str, str]] = [
    ("task.created", "task", "任务已创建", "Task created", "新建执行计划任务时触发", "Fires when a new task is created"),
    ("task.status_changed", "task", "任务状态变更", "Task status changed", "任务 status 字段变化（如 pending→in_progress）", "When task status changes"),
    ("task.updated", "task", "任务已更新", "Task updated", "除纯状态外的字段修改（含看板 UI 字段）", "Non-status fields or UI metadata updated"),
    ("task.deleted", "task", "任务已删除", "Task deleted", "删除任务记录时触发", "When a task is deleted"),
    ("requirement.created", "requirement", "需求已创建", "Requirement created", "新建需求条目", "When a requirement is created"),
    ("requirement.batch_created", "requirement", "批量创建需求", "Requirements batch-created", "一次批量导入/创建多条需求", "When multiple requirements are created in one batch"),
    ("requirement.updated", "requirement", "需求已更新", "Requirement updated", "需求字段或优先级等修改", "When a requirement is updated"),
    ("requirement.deleted", "requirement", "需求已删除", "Requirement deleted", "删除需求条目", "When a requirement is deleted"),
    ("issue.opened", "issue", "问题已创建", "Issue opened", "新建缺陷/问题", "When an issue is opened"),
    ("issue.updated", "issue", "问题已更新", "Issue updated", "问题字段修改（未解决前）", "When an issue is updated before resolution"),
    ("issue.resolved", "issue", "问题已解决", "Issue resolved", "标记为已解决并写入 resolution", "When an issue is resolved"),
    ("issue.deleted", "issue", "问题已删除", "Issue deleted", "删除问题记录", "When an issue is deleted"),
    ("sprint.started", "sprint", "Sprint 已开始", "Sprint started", "新建活跃 Sprint（可能结束上一 Sprint）", "When a new active sprint starts"),
    ("sprint.completed", "sprint", "Sprint 已完成", "Sprint completed", "Sprint 状态变为 completed", "When a sprint is marked completed"),
    ("sprint.updated", "sprint", "Sprint 已更新", "Sprint updated", "Sprint 目标、回顾等字段修改", "When sprint metadata changes"),
    ("sprint.deleted", "sprint", "Sprint 已删除", "Sprint deleted", "删除 Sprint 记录", "When a sprint is deleted"),
    ("project.created", "project", "项目已创建", "Project created", "租户下新建项目", "When a project is created"),
    ("project.updated", "project", "项目已更新", "Project updated", "项目名称、路径、向量库等修改", "When project settings change"),
    ("project.member_added", "project", "成员已加入", "Member added", "项目新增成员", "When a user joins a project"),
    ("project.member_removed", "project", "成员已移除", "Member removed", "项目移除成员", "When a user is removed from a project"),
]

EVENT_CATALOG = [
    {
        "id": a,
        "category": b,
        "label_zh": c,
        "label_en": d,
        "hint_zh": e,
        "hint_en": f,
    }
    for (a, b, c, d, e, f) in _EVENT_ROWS
]
SUPPORTED_EVENTS = [e["id"] for e in EVENT_CATALOG]
SUPPORTED_EVENT_IDS = frozenset(SUPPORTED_EVENTS)


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
    invalid = [e for e in body.events if e not in SUPPORTED_EVENT_IDS]
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
    if "events" in body:
        ev = body["events"]
        if not isinstance(ev, list):
            raise HTTPException(400, "events 须为字符串数组")
        bad = [e for e in ev if e not in SUPPORTED_EVENT_IDS]
        if bad:
            raise HTTPException(400, f"不支持的事件: {bad}")
    for k in ("name", "url", "secret", "events", "active"):
        if k in body:
            setattr(h, k, body[k])
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
    _append_delivery(
        {
            "hook_id": h.id,
            "event": "webhook.test",
            "ok": result.get("ok"),
            "status_code": result.get("status_code"),
            "error": result.get("error"),
            "fired_at": datetime.utcnow().isoformat() + "Z",
            "source": "test",
        }
    )
    return {"ok": result["ok"], "status_code": result.get("status_code"), "error": result.get("error")}


@router.get("/events")
def list_events():
    """返回扁平 id 列表 + 分组元数据（供 Web UI 展示说明与分组全选）。"""
    return {"events": SUPPORTED_EVENTS, "catalog": EVENT_CATALOG}


@router.get("/{hook_id}/deliveries")
def list_deliveries(
    hook_id: str,
    limit: int = 50,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
):
    hook = db.get(WebhookConfig, hook_id)
    if not hook or hook.tenant_id != user.tenant_id:
        raise HTTPException(404, "Webhook 不存在")
    path = _delivery_log_path()
    if not path.is_file():
        return {"ok": True, "items": [], "total": 0}
    items: list[dict] = []
    for line in reversed(path.read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        if row.get("hook_id") != hook_id:
            continue
        items.append(row)
        if len(items) >= limit:
            break
    return {"ok": True, "items": items, "total": len(items)}


def notify_webhook(event: str, data: dict, *, tenant_id: str, project_id: str = "") -> None:
    """业务路由调用：投递失败不影响主流程。"""
    try:
        fire_event(event, data, tenant_id, project_id or "")
    except Exception:
        return


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
            _append_delivery(
                {
                    "hook_id": hook.id,
                    "event": event,
                    "attempt": attempt + 1,
                    "ok": result.get("ok"),
                    "status_code": result.get("status_code"),
                    "error": result.get("error"),
                    "fired_at": datetime.utcnow().isoformat() + "Z",
                    "source": "event",
                }
            )
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
