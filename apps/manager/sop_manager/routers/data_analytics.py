"""
@module: routers.data_analytics
@purpose: AI 数据分析概览（指标目录、用量、NLQ 占位）
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from sop_manager.path_config import request_scope_active, resolved_project_id
from sop_manager.routers.db_sql_compat import rows
from sop_manager.routers.sql_models import Issue, Requirement, Task, get_session

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])


def _require_scope() -> str:
    if not request_scope_active():
        raise HTTPException(400, detail="需要登录且携带 X-Project-Id")
    pid = resolved_project_id()
    if not pid:
        raise HTTPException(400, detail="未解析到 project_id")
    return pid


def _build_metrics(db: Session, pid: str) -> dict[str, Any]:
    tasks = db.query(Task).filter_by(project_id=pid).all()
    reqs = db.query(Requirement).filter_by(project_id=pid).all()
    issues = db.query(Issue).filter_by(project_id=pid).all()
    task_by_status: dict[str, int] = {}
    for t in tasks:
        st = str(t.status or "unknown")
        task_by_status[st] = task_by_status.get(st, 0) + 1
    issue_by_prio: dict[str, int] = {}
    for i in issues:
        pr = str(i.priority or "P3")
        issue_by_prio[pr] = issue_by_prio.get(pr, 0) + 1
    reflections = 0
    try:
        reflections = len(rows("agent_reflections", 5000))
    except Exception:  # noqa: S110
        pass
    return {
        "tasks_total": len(tasks),
        "tasks_by_status": task_by_status,
        "requirements_total": len(reqs),
        "issues_total": len(issues),
        "issues_by_priority": issue_by_prio,
        "agent_reflections_sampled": reflections,
    }


@router.get("/health")
def analytics_health() -> dict[str, Any]:
    return {"ok": True, "service": "analytics"}


@router.get("/overview")
def analytics_overview(db: Session = Depends(get_session)) -> dict[str, Any]:
    pid = _require_scope()
    return {
        "ok": True,
        "project_id": pid,
        "metrics": _build_metrics(db, pid),
        "nlq": {"enabled": True, "hint": "POST /api/v1/analytics/nlq 自然语言提问"},
    }


class NlqIn(BaseModel):
    question: str = Field(..., min_length=2, max_length=2000)


@router.post("/nlq")
def analytics_nlq(body: NlqIn, db: Session = Depends(get_session)) -> dict[str, Any]:
    pid = _require_scope()
    metrics = _build_metrics(db, pid)
    try:
        from sop_manager.routers.llm_gateway import ChatIn, Message, _provider_chain, _route_model
    except Exception as e:
        raise HTTPException(503, "LLM Gateway 未启用") from e
    prompt = (
        "你是项目数据分析助手。根据以下 JSON 指标摘要，用中文简洁回答用户问题；"
        "若数据不足请说明。\n\n指标："
        f"{metrics}\n\n问题：{body.question}"
    )
    chat_in = ChatIn(messages=[Message(role="user", content=prompt)], task_type="summarize")
    model = _route_model(chat_in)
    errors: list[str] = []
    for provider in _provider_chain(model):
        try:
            out = provider.chat(ChatIn(**{**chat_in.model_dump(), "model": model}))
            return {"ok": True, "answer": out.content, "metrics_snapshot": metrics, "model": out.model}
        except Exception as e:
            errors.append(str(e))
    raise HTTPException(502, f"NLQ 失败: {'; '.join(errors[:3])}")
