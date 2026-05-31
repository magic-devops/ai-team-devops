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
import time
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


def _command_catalog() -> list[dict[str, Any]]:
    """产品级命令注册表：前端 CmdK、CLI/Agent 都可消费同一份能力清单。"""
    return [
        {"id": "nav.dashboard", "type": "navigate", "label": "打开驾驶舱", "description": "查看项目健康、交付摘要和快捷入口", "target": "#/dashboard", "keywords": ["dashboard", "驾驶舱", "首页", "健康"]},
        {"id": "nav.projects", "type": "navigate", "label": "打开项目管理", "description": "项目列表、当前项目切换和接入包", "target": "#/projects", "keywords": ["project", "项目", "register", "onboarding"]},
        {"id": "nav.tasks", "type": "navigate", "label": "打开任务看板", "description": "查看任务、迭代和研发执行状态", "target": "#/tasks", "keywords": ["task", "任务", "看板", "sprint"]},
        {"id": "nav.requirements", "type": "navigate", "label": "打开需求管理", "description": "管理需求、验收标准、优先级和 Agent 归属", "target": "#/requirements", "keywords": ["requirement", "需求", "prd", "验收"]},
        {"id": "nav.workflows", "type": "navigate", "label": "打开工作流编排", "description": "启动流程、查看实例、发送信号和取消运行", "target": "#/workflows", "keywords": ["workflow", "编排", "流程", "temporal"]},
        {"id": "nav.organization", "type": "navigate", "label": "打开组织权限", "description": "租户成员、业务线、项目成员和角色", "target": "#/organization", "keywords": ["org", "组织", "权限", "成员", "tenant"]},
        {"id": "nav.analytics", "type": "navigate", "label": "打开数据分析", "description": "指标目录、数据血缘、NLQ 和导出", "target": "#/analytics", "keywords": ["analytics", "数据", "指标", "血缘", "nlq"]},
        {"id": "nav.notify", "type": "navigate", "label": "打开消息通道", "description": "Webhook、IM 通道、入站与出站消息流水", "target": "#/notify", "keywords": ["notify", "消息", "钉钉", "企微", "webhook"]},
        {"id": "nav.audit", "type": "navigate", "label": "打开审计合规", "description": "审计链校验、事件查询、手动留痕和 CSV 导出", "target": "#/audit", "keywords": ["audit", "审计", "合规", "hash", "csv"]},
        {"id": "nav.copilot", "type": "navigate", "label": "打开 AI 助手", "description": "会话、计划、自然语言问答和上下文注入", "target": "#/copilot", "keywords": ["copilot", "ai", "助手", "cmdk"]},
        {"id": "nav.intelligence", "type": "navigate", "label": "打开智能与知识", "description": "知识库、RAG、记忆、规则、蒸馏审核和用量", "target": "#/intelligence", "keywords": ["knowledge", "知识", "rag", "memory", "记忆", "规则"]},
        {"id": "nav.marketplace", "type": "navigate", "label": "打开资产市场", "description": "规约包、技能包、安装、签名和评分", "target": "#/marketplace", "keywords": ["marketplace", "市场", "技能", "规约"]},
        {"id": "nav.platforms", "type": "navigate", "label": "打开 AI 平台", "description": "CLI/IDE/Agent 接入、模型提供商和角色模型", "target": "#/platforms", "keywords": ["platform", "模型", "agent", "cli", "ide"]},
        {"id": "nav.system_map", "type": "navigate", "label": "打开页面能力地图", "description": "查看 React 与 legacy 页面迁移成熟度", "target": "#/system-map", "keywords": ["system map", "页面地图", "迁移", "legacy"]},
        {"id": "nav.settings", "type": "navigate", "label": "打开系统设置", "description": "账户、运行状态、外观、商业计费和管理入口", "target": "#/settings", "keywords": ["settings", "设置", "主题", "计费"]},
        {"id": "ops.health", "type": "operation", "label": "检查 Manager 健康", "description": "调用 /api/v1/health 查看服务状态", "target": "/api/v1/health", "keywords": ["health", "健康", "manager", "服务"]},
        {"id": "ops.audit_verify", "type": "operation", "label": "校验审计链", "description": "调用 /api/v1/audit/chain/verify 验证审计完整性", "target": "/api/v1/audit/chain/verify", "keywords": ["verify", "校验", "审计链", "hash"]},
        {"id": "ops.workflow_summary", "type": "operation", "label": "查看工作流摘要", "description": "调用 /api/v1/workflows/summary 查看流程运行概览", "target": "/api/v1/workflows/summary", "keywords": ["workflow", "summary", "流程", "摘要"]},
        {"id": "ops.billing_summary", "type": "operation", "label": "查看商业化汇总", "description": "调用 /api/v1/billing/summary 查看账单与收款汇总", "target": "/api/v1/billing/summary", "keywords": ["billing", "计费", "收款", "商业化"]},
        {"id": "ai.summarize_project", "type": "copilot", "label": "总结当前项目状态", "description": "让 Copilot 汇总需求、任务、风险和下一步", "target": "#/copilot", "prompt": "总结当前项目状态、主要风险和下一步行动", "keywords": ["summary", "总结", "项目状态", "下一步"]},
        {"id": "ai.plan_iteration", "type": "copilot", "label": "生成迭代推进计划", "description": "让 Copilot 基于上下文生成可执行计划", "target": "#/copilot", "prompt": "基于当前项目上下文生成下一轮迭代推进计划", "keywords": ["plan", "计划", "迭代", "sprint"]},
    ]


def _score_command(cmd: dict[str, Any], query: str) -> int:
    q = query.strip().lower()
    if not q:
        return 1
    hay = " ".join([
        str(cmd.get("id", "")),
        str(cmd.get("label", "")),
        str(cmd.get("description", "")),
        " ".join(str(x) for x in cmd.get("keywords", [])),
    ]).lower()
    score = 0
    for token in [x for x in q.replace("/", " ").replace("#", " ").split() if x]:
        if token in hay:
            score += 4
        if hay.startswith(token):
            score += 2
    if q in hay:
        score += 8
    return score


def _resolve_commands(query: str, limit: int = 8) -> list[dict[str, Any]]:
    rows = sorted(
        ((cmd, _score_command(cmd, query)) for cmd in _command_catalog()),
        key=lambda x: x[1],
        reverse=True,
    )
    picked = [dict(cmd, score=score) for cmd, score in rows if score > 0]
    return picked[:limit]


def _command_by_id(command_id: str) -> dict[str, Any] | None:
    target = command_id.strip()
    return next((cmd for cmd in _command_catalog() if str(cmd.get("id") or "") == target), None)


def _parse_jsonish(text: str) -> dict[str, Any] | None:
    raw = (text or "").strip()
    if not raw:
        return None
    try:
        obj = json.loads(raw)
        return obj if isinstance(obj, dict) else None
    except json.JSONDecodeError:
        pass
    start = raw.find("{")
    end = raw.rfind("}")
    if start >= 0 and end > start:
        try:
            obj = json.loads(raw[start:end + 1])
            return obj if isinstance(obj, dict) else None
        except json.JSONDecodeError:
            return None
    return None


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


class CommandResolveIn(BaseModel):
    query: str = ""
    limit: int = Field(8, ge=1, le=30)


class CommandExecuteIn(BaseModel):
    command_id: str = Field(..., min_length=1)
    dry_run: bool = True
    context: dict[str, Any] | None = None
    session_id: str = ""
    run_id: str = ""


class PlanIn(BaseModel):
    query: str
    context: dict[str, Any] | None = None
    session_id: str = ""
    run_id: str = ""


class PlanTasksIn(BaseModel):
    query: str = ""
    plan: dict[str, Any] = Field(default_factory=dict)
    commands: list[dict[str, Any]] = Field(default_factory=list)
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = "Coder"
    dev_tool: str = "copilot"


def _plan_task_specs(body: PlanTasksIn) -> list[dict[str, Any]]:
    plan = body.plan if isinstance(body.plan, dict) else {}
    query = (body.query or "").strip()
    summary = str(plan.get("summary") or "").strip()
    intent = str(plan.get("intent") or "copilot").strip()
    target = str(plan.get("target") or "").strip()
    params = plan.get("params") if isinstance(plan.get("params"), dict) else {}
    command_labels = [
        str(x.get("label") or "").strip()
        for x in (body.commands or [])[:3]
        if isinstance(x, dict) and str(x.get("label") or "").strip()
    ]
    title_seed = summary or query or "Copilot 执行计划"
    detail = {
        "query": query,
        "intent": intent,
        "target": target,
        "params": params,
        "commands": command_labels,
    }
    specs = [
        {
            "title": f"确认 Copilot 计划：{title_seed[:48]}",
            "description": "核对 Copilot 生成的意图、目标页面/API、上下文参数和验收口径。\n\n"
            + json.dumps(detail, ensure_ascii=False, indent=2),
            "estimate": "S",
        },
        {
            "title": f"执行 Copilot 建议动作：{(target or intent or title_seed)[:48]}",
            "description": "按计划推进实际操作或开发工作，必要时拆分子任务并同步风险。\n\n"
            + (summary or query or "无补充说明"),
            "estimate": "M",
        },
        {
            "title": f"验收 Copilot 计划结果：{title_seed[:48]}",
            "description": "验证执行结果、补齐审计记录和后续行动，确保任务状态可以关闭。",
            "estimate": "S",
        },
    ]
    if command_labels:
        specs.insert(1, {
            "title": f"处理候选命令：{command_labels[0][:48]}",
            "description": "评估并执行 Copilot 推荐命令：\n" + "\n".join(f"- {x}" for x in command_labels),
            "estimate": "S",
        })
    return specs[:4]


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


@router.get("/commands")
def copilot_commands(q: str = "", limit: int = Query(30, ge=1, le=100)) -> dict[str, Any]:
    """统一命令注册表：React CmdK、CLI 和 Agent 可复用。"""
    items = _resolve_commands(q, limit=limit) if q.strip() else _command_catalog()[:limit]
    return {"ok": True, "items": items, "total": len(items)}


@router.post("/commands/resolve")
def copilot_resolve_command(body: CommandResolveIn) -> dict[str, Any]:
    """自然语言命令轻量解析：无需 LLM 也能稳定返回候选动作。"""
    items = _resolve_commands(body.query, limit=body.limit)
    best = items[0] if items else None
    return {"ok": True, "query": body.query, "best": best, "items": items, "total": len(items)}


@router.post("/commands/execute")
async def copilot_execute_command(body: CommandExecuteIn) -> dict[str, Any]:
    """受控命令执行：导航/AI 命令只返回计划，operation 命令支持 dry-run 与审计证据。"""
    cmd = _command_by_id(body.command_id)
    if not cmd:
        raise HTTPException(404, "command not found")
    session_id = _safe_id(body.session_id, "cp")
    run_id = _safe_id(body.run_id, "run")
    cmd_type = str(cmd.get("type") or "")
    target = str(cmd.get("target") or "")
    planned = {
        "command_id": cmd.get("id"),
        "label": cmd.get("label"),
        "type": cmd_type,
        "target": target,
        "guards": ["registered_command_only", "no_arbitrary_url", "audit_chain_on_apply"],
        "safe_to_execute": cmd_type in {"navigate", "copilot", "operation"},
    }
    if cmd_type in {"navigate", "copilot"}:
        result = {
            "ok": True,
            "dry_run": True,
            "status": "planned",
            "command": cmd,
            "evidence": {
                "plan": planned,
                "next_action": "navigate" if cmd_type == "navigate" else "open_copilot_chat",
                "prompt": cmd.get("prompt", ""),
            },
            "session_id": session_id,
            "run_id": run_id,
        }
        _record_turn(session_id, {
            "ts": _now(),
            "session_id": session_id,
            "run_id": run_id,
            "query": f"execute command {body.command_id}",
            "context": body.context or {},
            "ok": True,
            "response": result,
        })
        _upsert_session(session_id, title=str(cmd.get("label") or body.command_id), run_id=run_id)
        return result
    if cmd_type != "operation":
        raise HTTPException(400, "unsupported command type")

    operation_result: dict[str, Any] | None = None
    if not body.dry_run:
        if body.command_id == "ops.health":
            operation_result = {"ok": True, "status": "ok", "checked_at": _now(), "scope": _scope_key()}
        elif body.command_id == "ops.audit_verify":
            from sop_manager.routers.audit_chain import verify_chain
            operation_result = verify_chain(max_files=20)
        elif body.command_id == "ops.workflow_summary":
            from sop_manager.routers.workflow import workflow_summary
            operation_result = await workflow_summary()
        elif body.command_id == "ops.billing_summary":
            from sop_manager.routers.billing import billing_summary
            operation_result = billing_summary()
        else:
            raise HTTPException(403, "operation is not allowlisted")

    audit_chain: dict[str, Any] | None = None
    if not body.dry_run:
        try:
            from sop_manager.routers.audit_chain import append_audit
            audit_chain = append_audit(
                "copilot.command.execute",
                resource_type="copilot_command",
                resource_id=body.command_id,
                details={
                    "command": planned,
                    "context": body.context or {},
                    "result_summary": {
                        "ok": bool(operation_result.get("ok", True)) if isinstance(operation_result, dict) else True,
                        "keys": sorted(operation_result.keys())[:12] if isinstance(operation_result, dict) else [],
                    },
                    "session_id": session_id,
                    "run_id": run_id,
                },
            )
        except Exception as err:  # pragma: no cover - audit chain must not hide command result
            audit_chain = {"error": str(err)}

    result = {
        "ok": True,
        "dry_run": body.dry_run,
        "status": "planned" if body.dry_run else "succeeded",
        "command": cmd,
        "evidence": {
            "plan": planned,
            "result": operation_result,
            "audit_chain": audit_chain,
        },
        "session_id": session_id,
        "run_id": run_id,
    }
    _record_turn(session_id, {
        "ts": _now(),
        "session_id": session_id,
        "run_id": run_id,
        "query": f"execute command {body.command_id}",
        "context": body.context or {},
        "ok": True,
        "response": result,
    })
    _upsert_session(session_id, title=str(cmd.get("label") or body.command_id), run_id=run_id)
    return result


@router.post("/plan")
def copilot_plan(body: PlanIn) -> dict[str, Any]:
    """面向 CmdK/助手页的工具调用计划，LLM 不可用时回退到命令解析。"""
    if not body.query.strip():
        raise HTTPException(400, "query 为空")
    ctx = body.context if isinstance(body.context, dict) else {}
    session_id = _safe_id(body.session_id or str(ctx.get("session_id") or ""), "cp")
    run_id = _safe_id(body.run_id or str(ctx.get("run_id") or ""), "run")
    commands = _resolve_commands(body.query, limit=6)
    fallback = commands[0] if commands else {
        "id": "ai.answer",
        "type": "copilot",
        "label": "询问 AI 助手",
        "description": "没有匹配到明确命令，进入 AI 助手会话",
        "target": "#/copilot",
    }
    plan: dict[str, Any] = {
        "intent": fallback.get("type", "copilot"),
        "target": fallback.get("target", "#/copilot"),
        "params": {"command_id": fallback.get("id")},
        "summary": fallback.get("description") or fallback.get("label") or "已生成候选动作。",
    }
    raw_result: dict[str, Any] | None = None
    try:
        ctx_txt = f"\n上下文: {ctx}" if ctx else ""
        enrich = _gather_rag_memory(body.query)
        extra = f"\n\n可用候选命令: {json.dumps(commands, ensure_ascii=False)[:4000]}\n\n{enrich}" if enrich else f"\n\n可用候选命令: {json.dumps(commands, ensure_ascii=False)[:4000]}"
        raw_result = _chat(_SYS_ASK, body.query + ctx_txt + extra, task_type="plan")
        parsed = _parse_jsonish(str(raw_result.get("raw", "")))
        if parsed:
            plan = {
                "intent": str(parsed.get("intent") or plan["intent"]),
                "target": str(parsed.get("target") or plan["target"]),
                "params": parsed.get("params") if isinstance(parsed.get("params"), dict) else plan["params"],
                "summary": str(parsed.get("summary") or plan["summary"]),
            }
    except Exception as e:
        raw_result = {"error": str(e), "fallback": True}
    _upsert_session(session_id, title=body.query, run_id=run_id)
    _record_turn(session_id, {
        "ts": _now(),
        "session_id": session_id,
        "run_id": run_id,
        "query": body.query,
        "context": ctx,
        "ok": True,
        "response": {"plan": plan, "commands": commands, "raw": raw_result},
    })
    return {"ok": True, "session_id": session_id, "run_id": run_id, "plan": plan, "commands": commands, "raw": raw_result}


@router.post("/plan/tasks")
def copilot_plan_tasks(body: PlanTasksIn) -> dict[str, Any]:
    """将 Copilot 工具调用计划转换为任务中心可跟进的执行任务。"""
    specs = _plan_task_specs(body)
    items: list[dict[str, Any]] = []
    if body.dry_run:
        for idx, spec in enumerate(specs, start=1):
            items.append({
                "id": "",
                "title": spec["title"],
                "description": spec["description"],
                "priority": body.priority,
                "estimate": spec.get("estimate") or "M",
                "assigned_to": body.assigned_to or "Coder",
                "source": "copilot_plan",
                "preview": True,
                "order": idx,
            })
        return {"ok": True, "dry_run": True, "created": 0, "items": items}

    from .tasks import TaskCreate, create_task

    for idx, spec in enumerate(specs, start=1):
        out = create_task(TaskCreate(
            title=spec["title"],
            description=spec["description"],
            priority=body.priority,
            estimate=str(spec.get("estimate") or "M"),
            assigned_to=body.assigned_to or "Coder",
            dev_tool=body.dev_tool or "copilot",
            source="copilot_plan",
            debug_notes=json.dumps({
                "query": body.query,
                "plan": body.plan,
                "order": idx,
            }, ensure_ascii=False)[:1800],
        ))
        items.append({
            "id": out.get("id"),
            "title": spec["title"],
            "priority": body.priority,
            "estimate": spec.get("estimate") or "M",
            "assigned_to": body.assigned_to or "Coder",
            "source": "copilot_plan",
            "created": True,
            "order": idx,
        })
        time.sleep(0.002)
    return {"ok": True, "dry_run": False, "created": len(items), "items": items}


@router.get("/health")
def health() -> dict[str, Any]:
    return {"ok": True, "skills": ["ask", "classify", "summarize", "suggest", "sessions", "commands", "plan", "plan_tasks"]}


@router.get("/hub")
def copilot_hub(limit: int = Query(100, ge=1, le=500)) -> dict[str, Any]:
    rows = list(reversed(_read_jsonl(_sessions_file(), limit=limit)))
    recent = rows[:5]
    commands = _command_catalog()
    return {
        "ok": True,
        "summary": {
            "sessions": len(rows),
            "skills": 8,
            "commands": len(commands),
            "scope": _scope_key(),
        },
        "recent_sessions": recent,
        "domains": [
            {
                "id": "chat",
                "path": "#/copilot/chat",
                "capability": "ai.copilot.chat",
                "description": "持续会话、项目上下文注入、会话记录和模块 AI 追问。",
                "primary_action": "continue_conversation",
            },
            {
                "id": "commands",
                "path": "#/copilot/commands",
                "capability": "ai.copilot.commands",
                "description": "统一检索导航、运营动作和 AI 命令，适合快速到达与执行。",
                "primary_action": "search_command_catalog",
            },
            {
                "id": "tool-plan",
                "path": "#/copilot/tool-plan",
                "capability": "ai.copilot.tool-plan",
                "description": "把自然语言目标转成工具调用计划，再预览或生成任务。",
                "primary_action": "plan_to_tasks",
            },
        ],
    }


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
