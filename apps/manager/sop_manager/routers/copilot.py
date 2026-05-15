"""
@module: routers.copilot
@purpose: Manager 内嵌 AI Copilot —— ⌘K 命令面板 / NLQ 搜索 / 自动分类 / 智能总结
@stable: /api/v1/copilot/{ask,classify,summarize,suggest} 路径稳定
@ai_safe_edit:
  - 改 system prompt：仅改 _SYS_* 常量
  - 新增技能：加 router + 提示词；走 llm_gateway.llm_chat 即可
"""
from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from sop_manager.path_config import (
    resolved_ai_memory_root,
    resolved_business_code,
    resolved_project_code,
    resolved_project_id,
    resolved_tenant_code,
)

router = APIRouter(prefix="/api/v1/copilot", tags=["copilot"])
_log = logging.getLogger("sop.copilot")


_SYS_ASK = (
    "你是 ai-team-devops 后台的智能助手。用户在 Manager Web 中按 ⌘K 输入问题。\n"
    "目标：理解意图后给出可执行的下一步（页面跳转/查询/调用 API）。\n"
    "始终用 JSON 回复，结构: {\"intent\": \"navigate|query|action|answer\","
    " \"target\": \"页面路径或 API\", \"params\": {...}, \"summary\": \"一两句话\"}。"
)
_SYS_CLASSIFY = (
    "把用户输入的需求/任务文本分类，输出 JSON: {\"priority\": \"P0|P1|P2|P3\","
    " \"estimate\": \"XS|S|M|L|XL\", \"tags\": [\"标签...\"], \"category\": \"feature|bug|chore|docs\"}。\n"
    "依据：是否阻塞、范围大小、领域关键词。"
)
_SYS_SUMMARIZE = (
    "把多条事项总结为 ≤ 150 字的中文要点（保留时间/责任人/关键数字），输出纯文本。"
)
_SYS_SUGGEST = (
    "你是研发教练。基于上下文给出 ≤ 5 条**下一步行动建议**，每条 ≤ 24 字，输出 JSON 数组字符串。"
)


def _gather_rag_memory(query: str) -> str:
    """可选：注入记忆 + RAG 片段，增强 Copilot 回答。"""
    parts: list[str] = []
    if not query.strip():
        return ""
    try:
        from sop_manager.memory_store import get_memory_store
        from sop_manager.path_config import request_scope_active

        if request_scope_active():
            hits = get_memory_store().search(query, limit=5)
            if hits:
                parts.append("相关记忆:\n" + json.dumps(hits[:5], ensure_ascii=False)[:2000])
    except Exception as e:
        _log.debug("copilot memory context skip: %s", e)
    try:
        from sop_manager.routers.rag import SearchIn, search as rag_search

        out = rag_search(SearchIn(query=query, limit=4))
        items = out.items if hasattr(out, "items") else []
        if items:
            snippets = [
                {"collection": x.collection, "title": x.title, "snippet": (x.snippet or "")[:200]}
                for x in items[:4]
            ]
            parts.append("RAG 检索:\n" + json.dumps(snippets, ensure_ascii=False))
    except Exception as e:
        _log.debug("copilot rag context skip: %s", e)
    return "\n\n".join(parts)


def _chat(system: str, user: str, task_type: str = "classify") -> dict[str, Any]:
    try:
        from sop_manager.routers.llm_gateway import ChatIn, Message, llm_chat
    except Exception as e:  # pragma: no cover
        raise HTTPException(503, f"llm_gateway 未启用：{e}")
    body = ChatIn(
        messages=[Message(role="system", content=system), Message(role="user", content=user)],
        task_type=task_type,
        cache_ttl=120,
        temperature=0.0,
    )
    out = llm_chat(body, None)  # type: ignore[arg-type]
    text = (out.content or "").strip()
    if text.startswith("```"):
        # 容错：去掉 markdown 围栏
        i0 = text.find("\n"); i1 = text.rfind("```")
        if i0 >= 0 and i1 > i0:
            text = text[i0 + 1: i1].strip()
    return {"raw": text, "model": out.model, "usage": out.usage.model_dump(),
            "provider": out.provider, "cached": out.cached}


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _safe_id(value: str, prefix: str) -> str:
    raw = (value or "").strip() or f"{prefix}-{uuid.uuid4().hex[:12]}"
    out = "".join(c for c in raw if c.isalnum() or c in "-_.")[:120]
    return out or f"{prefix}-{uuid.uuid4().hex[:12]}"


def _copilot_dir() -> Path:
    base = resolved_ai_memory_root() / "copilot-v1"
    base.mkdir(parents=True, exist_ok=True)
    return base


def _scope_key() -> str:
    t = resolved_tenant_code().replace("/", "_")[:80]
    b = (resolved_business_code() or "_").replace("/", "_")[:80]
    p = resolved_project_code().replace("/", "_")[:80]
    return f"{t}__{b}__{p}"


def _sessions_file() -> Path:
    return _copilot_dir() / f"{_scope_key()}.sessions.jsonl"


def _turns_file(session_id: str) -> Path:
    sid = _safe_id(session_id, "cp")
    d = _copilot_dir() / _scope_key()
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{sid}.jsonl"


def _read_jsonl(path: Path, limit: int = 500) -> list[dict[str, Any]]:
    if not path.is_file():
        return []
    rows: list[dict[str, Any]] = []
    for line in reversed(path.read_text(encoding="utf-8").splitlines()):
        if not line.strip():
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(obj, dict):
            rows.append(obj)
        if len(rows) >= limit:
            break
    return list(reversed(rows))


def _append_jsonl(path: Path, row: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n")


def _upsert_session(session_id: str, *, title: str, run_id: str) -> None:
    path = _sessions_file()
    rows = _read_jsonl(path, limit=5000)
    now = _now()
    found = False
    for row in rows:
        if str(row.get("session_id") or "") == session_id:
            row["updated_at"] = now
            row["last_run_id"] = run_id
            row["title"] = row.get("title") or title
            found = True
            break
    if not found:
        rows.append({
            "session_id": session_id,
            "title": title[:120] or session_id,
            "created_at": now,
            "updated_at": now,
            "last_run_id": run_id,
            "tenant_code": resolved_tenant_code(),
            "business_code": resolved_business_code(),
            "project_id": resolved_project_id(),
            "project_code": resolved_project_code(),
        })
    path.write_text("".join(json.dumps(r, ensure_ascii=False, separators=(",", ":")) + "\n" for r in rows[-1000:]), encoding="utf-8")


def _record_turn(session_id: str, row: dict[str, Any]) -> None:
    _append_jsonl(_turns_file(session_id), row)


# ── Schemas ──────────────────────────────────────────────────────
class AskIn(BaseModel):
    query: str
    context: dict[str, Any] | None = None
    session_id: str = ""
    run_id: str = ""


class ClassifyIn(BaseModel):
    text: str


class SummarizeIn(BaseModel):
    items: list[str]


class SuggestIn(BaseModel):
    context: str
    goal: str = ""


# ── Routes ──────────────────────────────────────────────────────
@router.post("/ask")
def copilot_ask(body: AskIn) -> dict[str, Any]:
    """⌘K 自然语言意图理解：返回结构化 intent。"""
    if not body.query.strip():
        raise HTTPException(400, "query 为空")
    ctx = body.context if isinstance(body.context, dict) else {}
    session_id = _safe_id(body.session_id or str(ctx.get("session_id") or ""), "cp")
    run_id = _safe_id(body.run_id or str(ctx.get("run_id") or ""), "run")
    ctx_txt = f"\n上下文: {body.context}" if body.context else ""
    enrich = _gather_rag_memory(body.query)
    extra = f"\n\n{enrich}" if enrich else ""
    try:
        result = _chat(_SYS_ASK, body.query + ctx_txt + extra, task_type="plan")
    except Exception as e:
        _upsert_session(session_id, title=body.query, run_id=run_id)
        _record_turn(session_id, {
            "ts": _now(),
            "session_id": session_id,
            "run_id": run_id,
            "query": body.query,
            "context": ctx,
            "ok": False,
            "error": str(e),
        })
        raise
    _upsert_session(session_id, title=body.query, run_id=run_id)
    _record_turn(session_id, {
        "ts": _now(),
        "session_id": session_id,
        "run_id": run_id,
        "query": body.query,
        "context": ctx,
        "ok": True,
        "response": result,
    })
    return {"ok": True, "session_id": session_id, "run_id": run_id, **result}


@router.post("/classify")
def copilot_classify(body: ClassifyIn) -> dict[str, Any]:
    """新建需求/任务时调用：自动建议优先级 / 估点 / 标签。"""
    if not body.text.strip():
        raise HTTPException(400, "text 为空")
    return _chat(_SYS_CLASSIFY, body.text, task_type="classify")


@router.post("/summarize")
def copilot_summarize(body: SummarizeIn) -> dict[str, Any]:
    """周报 / Sprint 回顾自动摘要。"""
    if not body.items:
        raise HTTPException(400, "items 为空")
    user = "\n".join(f"- {x}" for x in body.items[:200])
    return _chat(_SYS_SUMMARIZE, user, task_type="summarize")


@router.post("/suggest")
def copilot_suggest(body: SuggestIn) -> dict[str, Any]:
    """给出下一步行动建议（5 条以内）。"""
    user = f"目标: {body.goal}\n\n上下文:\n{body.context[:6000]}"
    return _chat(_SYS_SUGGEST, user, task_type="plan")


@router.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "skills": ["ask", "classify", "summarize", "suggest", "sessions"]}


@router.get("/sessions")
def copilot_sessions(limit: int = Query(100, ge=1, le=1000)) -> dict[str, Any]:
    rows = _read_jsonl(_sessions_file(), limit=limit)
    rows = list(reversed(rows))
    return {"ok": True, "items": rows[:limit], "total": len(rows)}


@router.get("/sessions/{session_id}")
def copilot_session(session_id: str, limit: int = Query(100, ge=1, le=1000)) -> dict[str, Any]:
    sid = _safe_id(session_id, "cp")
    rows = _read_jsonl(_turns_file(sid), limit=limit)
    return {"ok": True, "session_id": sid, "items": rows, "total": len(rows)}
