"""
@module: routers.copilot
@purpose: Manager 内嵌 AI Copilot —— ⌘K 命令面板 / NLQ 搜索 / 自动分类 / 智能总结
@stable: /api/v1/copilot/{ask,classify,summarize,suggest} 路径稳定
@ai_safe_edit:
  - 改 system prompt：仅改 _SYS_* 常量
  - 新增技能：加 router + 提示词；走 llm_gateway.llm_chat 即可
"""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

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


def _chat(system: str, user: str, task_type: str = "classify") -> dict[str, Any]:
    try:
        from routers.llm_gateway import ChatIn, Message, llm_chat
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


# ── Schemas ──────────────────────────────────────────────────────
class AskIn(BaseModel):
    query: str
    context: dict[str, Any] | None = None


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
    ctx_txt = f"\n上下文: {body.context}" if body.context else ""
    return _chat(_SYS_ASK, body.query + ctx_txt, task_type="plan")


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
    return {"ok": True, "skills": ["ask", "classify", "summarize", "suggest"]}
