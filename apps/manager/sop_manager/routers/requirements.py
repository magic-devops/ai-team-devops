"""需求 CRUD、经模型网关生成的可编辑预览，以及明确确认后的可追踪采用。"""
from __future__ import annotations

import json
import re
import uuid
from sop_manager.task_owner import TaskOwnerId, TaskOwnerInput

from pathlib import Path
from typing import Annotated, Any, Dict, List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, model_validator
from sqlalchemy.orm import Session

from sop_manager.path_config import (
    resolved_ai_memory_root,
    resolved_business_code,
    resolved_project_code,
    resolved_project_id,
    resolved_tenant_code,
    resolved_tenant_id,
)

from .auth_sql import current_user_or_apikey
from .business_access import require_business_access
from .db_sql_compat import now, rows, table
from .delivery_contract import Input
from .requirements_assistance import GenerationInput, PrototypeApply, ReviewInput
from .sql_models import User, get_session
from .webhook import notify_webhook

BusinessUser = Annotated[User, Depends(current_user_or_apikey)]
BusinessSession = Annotated[Session, Depends(get_session)]

router = APIRouter(prefix="/api/v1/requirements", tags=["requirements"],
                   dependencies=[Depends(require_business_access)])

_DOC_MAX = 120_000
_PRIOS = ("P0", "P1", "P2", "P3")


def _ui_state_path():
    return resolved_ai_memory_root() / "requirements_ui_state.json"


def _proto_dir():
    return resolved_ai_memory_root() / "requirement_prototypes"


def _ui_default_state() -> Dict[str, Any]:
    return {"version": 1, "columns": {p: [] for p in _PRIOS}, "fields": {}}


def _ui_load() -> Dict[str, Any]:
    sp = _ui_state_path()
    d = _ui_default_state()
    if not sp.exists():
        return _ui_with_import_assignments(d)
    try:
        loaded = json.loads(sp.read_text(encoding="utf-8"))
        if isinstance(loaded, dict):
            d = loaded
    except (ValueError, OSError):
        pass
    d.setdefault("columns", {p: [] for p in _PRIOS})
    d.setdefault("fields", {})
    for p in _PRIOS:
        d["columns"].setdefault(p, [])
    return _ui_with_import_assignments(d)


def _ui_with_import_assignments(state):
    """Atomic imports keep assignments in SQL; explicit later UI edits still override them."""
    from .sql_models import DeliveryWorkspace, SessionLocal

    with SessionLocal() as db:
        workspace = db.query(DeliveryWorkspace).filter_by(project_id=resolved_project_id(), tenant_id=resolved_tenant_id()).first()
        if workspace:
            for rid, flow in workspace.data.get("flows", {}).items():
                source = flow.get("intake_source", {})
                if source:
                    state["fields"].setdefault(rid, {"assigned_agent": source.get("assigned_agent", ""),
                                                   "dev_tool": source.get("dev_tool", "")})
    return state


def _ui_save(d: Dict[str, Any]) -> None:
    from sop_manager.project_write_guard import project_file_write_scope

    with project_file_write_scope():
        sp = _ui_state_path()
        sp.parent.mkdir(parents=True, exist_ok=True)
        sp.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


def _ui_rebuild_columns(rows_all: List[Dict[str, Any]], st: Dict[str, Any]) -> None:
    by_p: Dict[str, List[str]] = {p: [] for p in _PRIOS}

    def _ts(r: Dict[str, Any]) -> str:
        return str(r.get("created_at") or "")

    for r in rows_all:
        rid = r.get("id")
        if not rid:
            continue
        pr = (r.get("priority") or "P3").upper()
        if pr not in _PRIOS:
            pr = "P3"
        by_p[pr].append(rid)
    for p in _PRIOS:
        by_p[p].sort(key=lambda i: _ts(next((x for x in rows_all if x.get("id") == i), {})))
    st["columns"] = by_p


def _ui_remove_from_columns(st: Dict[str, Any], req_id: str) -> None:
    for p in _PRIOS:
        st["columns"][p] = [x for x in st["columns"].get(p, []) if x != req_id]


def _ui_delete_id(st: Dict[str, Any], req_id: str) -> None:
    _ui_remove_from_columns(st, req_id)
    st.get("fields", {}).pop(req_id, None)


def _ui_append_to_column(st: Dict[str, Any], req_id: str, priority: str) -> None:
    pr = (priority or "P3").upper()
    if pr not in _PRIOS:
        pr = "P3"
    _ui_remove_from_columns(st, req_id)
    st.setdefault("columns", {p: [] for p in _PRIOS})
    st["columns"].setdefault(pr, []).append(req_id)


def _ui_merge_row(r: Dict[str, Any], st: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(r)
    fd = (st.get("fields") or {}).get(r.get("id")) or {}
    out["assigned_agent"] = str(fd.get("assigned_agent") or "")
    out["dev_tool"] = str(fd.get("dev_tool") or "")
    return out


def _ui_ordered_list(rows_all: List[Dict[str, Any]], st: Dict[str, Any]) -> List[Dict[str, Any]]:
    row_by_id = {r["id"]: r for r in rows_all if r.get("id")}
    if not any(st.get("columns", {}).get(p) for p in _PRIOS) and rows_all:
        _ui_rebuild_columns(rows_all, st)
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for p in _PRIOS:
        for rid in st.get("columns", {}).get(p, []):
            if rid in row_by_id and rid not in seen:
                rr = dict(row_by_id[rid])
                rr["priority"] = p
                out.append(_ui_merge_row(rr, st))
                seen.add(rid)
    for r in sorted(rows_all, key=lambda x: str(x.get("created_at") or "")):
        rid = r.get("id")
        if rid and rid not in seen:
            out.append(_ui_merge_row(r, st))
            seen.add(rid)
    return out


def _safe_req_id(rid: str) -> str:
    rid = (rid or "").strip()
    if not re.match(r"^REQ-[a-zA-Z0-9._-]{4,80}$", rid):
        raise HTTPException(400, "非法需求 ID")
    return rid


class ReqCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    priority: str = "P1"
    acceptance_criteria: Optional[List[str]] = []
    tags: Optional[List[str]] = []
    assigned_agent: Optional[str] = ""
    dev_tool: Optional[str] = ""


class ReqUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    story_points: Optional[int] = None
    acceptance_criteria: Optional[List[str]] = None
    human_notes: Optional[str] = None
    assigned_agent: Optional[str] = None
    dev_tool: Optional[str] = None


class ReqBulkUpdate(BaseModel):
    ids: List[str] = Field(default_factory=list, min_length=1, max_length=200)
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_agent: Optional[str] = None
    dev_tool: Optional[str] = None


class RequirementOpsTasksIn(TaskOwnerInput):
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    categories: List[str] = Field(default_factory=list, max_length=20)
    limit: int = Field(20, ge=1, le=100)


class ReorderBoardBody(BaseModel):
    """各优先级列自上而下需求 ID；须与当前库中需求 ID 全集一致、无重复。"""

    groups: Dict[str, List[str]] = Field(default_factory=dict)


class PriorityBody(BaseModel):
    priority: str
    human_notes: Optional[str] = ""


class BatchCreateBody(Input):
    items: list[ReqCreate] = Field(..., min_length=1, max_length=80)
    generation_id: str | None = Field(None, min_length=1, max_length=64)
    expected_version: int | None = Field(None, ge=0)
    idempotency_key: str | None = Field(None, min_length=8, max_length=100)

    @model_validator(mode="after")
    def adoption_fields(self):
        values = [self.generation_id, self.expected_version, self.idempotency_key]
        if any(value is not None for value in values) and any(value is None for value in values):
            raise ValueError("Generation adoption requires generation_id, expected_version and idempotency_key")
        return self


class ParseDocumentBody(GenerationInput):
    """粘贴 PRD / 需求说明全文，由大模型抽取结构化需求列表（JSON）。"""
    text: str = Field(..., min_length=20, max_length=_DOC_MAX)
    filename: str | None = Field(None, max_length=500)
    mode: str = Field("prd", pattern="^(idea|prd|meeting|feedback|incident|data|mixed)$")
    agent: str = Field("Product Analyst Agent", max_length=120)
    cli: str = Field("codex", max_length=80)
    auto_priority: bool = True
    auto_acceptance: bool = True
    assigned_agent: str | None = Field("", max_length=120)
    dev_tool: str | None = Field("", max_length=80)


class GeneratePrototypeBody(GenerationInput):
    mode: Literal["wireframe", "user_journey", "ia"] = "wireframe"
    extra_context: str | None = Field(None, max_length=8000)
    gen_image: bool = False


class GenerateTasksBody(TaskOwnerInput):
    dry_run: bool = True
    mode: str = Field("standard", pattern="^(standard|frontend|backend|fullstack|test)$")
    max_tasks: int = Field(6, ge=1, le=20)
    sprint_id: Optional[str] = ""
    owner_id: TaskOwnerId = ""
    dev_tool: Optional[str] = ""
    create_dependencies: bool = True


class ApplyReviewBody(Input):
    acceptance_criteria: list[str] | None = Field(None, max_length=80)
    tags: list[Annotated[str, Field(min_length=1, max_length=80)]] | None = Field(None, max_length=20)
    human_notes: str | None = Field("", max_length=10000)
    generation_id: str | None = Field(None, min_length=1, max_length=64)
    requirement_basis: str | None = Field(None, min_length=64, max_length=64)
    expected_version: int | None = Field(None, ge=0)
    idempotency_key: str | None = Field(None, min_length=8, max_length=100)

    @model_validator(mode="after")
    def adoption_fields(self):
        values = [self.generation_id, self.requirement_basis, self.expected_version, self.idempotency_key]
        if any(value is not None for value in values) and any(value is None for value in values):
            raise ValueError("Generation adoption requires generation_id, requirement_basis, expected_version and idempotency_key")
        return self


def _prototype_dir() -> Path:
    d = _proto_dir()
    d.mkdir(parents=True, exist_ok=True)
    return d


def _prototype_path(req_id: str) -> Path:
    safe = re.sub(r"[^a-zA-Z0-9._-]", "_", req_id)[:120]
    return _prototype_dir() / f"{safe}.md"


def _dump_vals(body: ReqUpdate) -> Dict[str, Any]:
    try:
        raw = body.model_dump(exclude_unset=True)
    except AttributeError:
        raw = body.dict(exclude_unset=True)
    return {k: v for k, v in raw.items() if v is not None}


def _llm_text(system: str, user: str, max_tokens: int = 8192, request: Request = None) -> str:
    """Compatibility helper; all text generation uses the scoped model gateway."""
    from . import llm_gateway

    return llm_gateway.llm_chat(llm_gateway.ChatIn(task_type="plan", cache_ttl=0,
        max_tokens=max_tokens, messages=[llm_gateway.Message(role="system", content=system),
                                       llm_gateway.Message(role="user", content=user)]), request).content


def _extract_json_obj(text: str) -> Dict[str, Any]:
    t = text.strip()
    if "```" in t:
        m = re.search(r"```(?:json)?\s*([\s\S]*?)\s*```", t, re.I)
        if m:
            t = m.group(1).strip()
    i0, i1 = t.find("{"), t.rfind("}")
    if i0 < 0 or i1 <= i0:
        raise ValueError("模型未返回可解析 JSON")
    return json.loads(t[i0 : i1 + 1])


def _normalize_items(raw: Dict[str, Any]) -> List[Dict[str, Any]]:
    items = raw.get("requirements") or raw.get("items") or raw.get("data")
    if not isinstance(items, list):
        raise ValueError("JSON 中缺少 requirements 数组")
    out: List[Dict[str, Any]] = []
    for it in items[:80]:
        if not isinstance(it, dict):
            continue
        title = (it.get("title") or "").strip()
        if not title:
            continue
        pr = (it.get("priority") or "P2").upper()
        if pr not in ("P0", "P1", "P2", "P3"):
            pr = "P2"
        ac = it.get("acceptance_criteria") or it.get("acceptance") or []
        if isinstance(ac, str):
            ac = [x.strip() for x in re.split(r"[\n;]", ac) if x.strip()]
        if not isinstance(ac, list):
            ac = []
        ac = [str(x).strip() for x in ac if str(x).strip()][:20]
        out.append(
            {
                "title": title[:500],
                "description": str(it.get("description") or "")[:8000],
                "priority": pr,
                "acceptance_criteria": ac,
                "tags": [str(x) for x in (it.get("tags") or []) if str(x)][:12]
                if isinstance(it.get("tags"), list)
                else [],
            }
        )
    if not out:
        raise ValueError("未解析到任何有效需求条目")
    return out


def _infer_doc_priority(text: str, default: str = "P2") -> str:
    t = text.lower()
    if any(x in t for x in ("安全", "合规", "故障", "阻断", "资损", "核心", "支付", "权限", "p0")):
        return "P0"
    if any(x in t for x in ("必须", "关键", "重要", "审批", "上线", "调度", "自动化", "p1")):
        return "P1"
    if any(x in t for x in ("优化", "体验", "美化", "增强", "p3")):
        return "P3"
    return default if default in _PRIOS else "P2"


def _fallback_requirements_from_text(text: str, body: ParseDocumentBody) -> List[Dict[str, Any]]:
    lines = [x.strip(" \t-•*#0123456789.、") for x in text.splitlines() if x.strip()]
    candidates: List[str] = []
    current: List[str] = []
    for raw in lines:
        is_heading = bool(re.match(r"^(需求|功能|模块|场景|目标|问题|痛点|故事|story|feature)[:：\s]", raw, re.I))
        is_bullet = len(raw) <= 180 and bool(re.search(r"(需要|支持|实现|提供|允许|自动|智能|管理|导入|审核|拆解|评估|生成)", raw))
        if (is_heading or is_bullet) and current:
            candidates.append("；".join(current))
            current = [raw]
        else:
            current.append(raw)
        if len("；".join(current)) > 700:
            candidates.append("；".join(current))
            current = []
    if current:
        candidates.append("；".join(current))

    if not candidates:
        sentences = [x.strip() for x in re.split(r"[。！？!?]\s*", text) if x.strip()]
        candidates = sentences[:20]

    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for idx, chunk in enumerate(candidates[:40], start=1):
        chunk = re.sub(r"\s+", " ", chunk).strip()
        if len(chunk) < 8:
            continue
        title = chunk.split("；", 1)[0][:48].strip("：:，,。 ")
        if not title:
            title = f"需求条目 {idx}"
        key = title.lower()
        if key in seen:
            continue
        seen.add(key)
        pr = _infer_doc_priority(chunk) if body.auto_priority else "P2"
        criteria = [
            f"给定项目作用域下，用户可以完成「{title}」的主流程操作",
            "关键输入、异常场景和权限边界均有明确提示或拦截",
            "相关结果可被人工审核，并能进入后续任务拆解或治理流程",
        ] if body.auto_acceptance else []
        tags = ["doc-intake", body.mode]
        if body.cli:
            tags.append(str(body.cli).strip())
        out.append(
            {
                "title": title,
                "description": chunk[:8000],
                "priority": pr,
                "acceptance_criteria": criteria,
                "tags": [x for x in tags if x][:12],
            }
        )
    if not out:
        raise ValueError("本地规则未解析到任何有效需求条目")
    return out


def _enrich_intake_items(items: List[Dict[str, Any]], body: ParseDocumentBody) -> List[Dict[str, Any]]:
    assigned_agent = (body.assigned_agent or body.agent or "").strip()
    dev_tool = (body.dev_tool or body.cli or "").strip()
    enriched: List[Dict[str, Any]] = []
    for item in items:
        tags = list(item.get("tags") or [])
        for tag in ("ai-intake" if body.generator == "ai" else "rule-intake", body.mode):
            if tag and tag not in tags:
                tags.append(tag)
        enriched.append(
            {
                **item,
                "assigned_agent": assigned_agent,
                "dev_tool": dev_tool,
                "tags": tags[:12],
            }
        )
    return enriched


def _intake_response(items: List[Dict[str, Any]], body: ParseDocumentBody, *, source: str, warning: str = "") -> Dict[str, Any]:
    filename = body.filename or "requirements.md"
    cli = (body.cli or "codex").strip()
    agent = (body.agent or "Product Analyst Agent").strip()
    scope = {
        "tenant_code": resolved_tenant_code(),
        "business_code": resolved_business_code(),
        "project_id": resolved_project_id(),
        "project_code": resolved_project_code(),
    }
    return {
        "ok": True,
        "source": source,
        "warning": warning,
        "items": items,
        "count": len(items),
        "intake_config": {
            "filename": filename,
            "mode": body.mode,
            "agent": agent,
            "cli": cli,
            "auto_priority": body.auto_priority,
            "auto_acceptance": body.auto_acceptance,
            "assigned_agent": body.assigned_agent or agent,
            "dev_tool": body.dev_tool or cli,
        },
        "commands": [
            {
                "label": "文档解析",
                "command": f"sop requirement parse-doc --file {filename} --agent \"{agent}\" --cli {cli} --mode {body.mode}",
            },
            {"label": "需求池治理", "command": "sop requirement ops-plan --json"},
            {"label": "生成治理任务", "command": "sop requirement ops-tasks --categories intake,review,generation --apply"},
        ],
        "agent_packet": {
            "goal": "将想法、文档或会议纪要转成 AI/CLI 可消费的结构化需求，并进入评审、拆任务和调度闭环。",
            "agent": agent,
            "cli": cli,
            "mode": body.mode,
            "scope": scope,
            "next_actions": [
                "人工审核标题、优先级、验收标准和标签",
                "批量导入需求池",
                "运行智能评审并补齐验收标准",
                "对高优需求生成开发任务和 DAG 依赖",
            ],
        },
    }


def _as_text_list(value: Any) -> List[str]:
    if isinstance(value, list):
        return [str(x).strip() for x in value if str(x).strip()]
    if isinstance(value, str):
        return [x.strip() for x in re.split(r"[\n;；]", value) if x.strip()]
    return []


def _shorten(text: str, limit: int = 120) -> str:
    t = re.sub(r"\s+", " ", str(text or "")).strip()
    return t if len(t) <= limit else t[: limit - 1].rstrip() + "…"


def _task_priority(req_priority: str, index: int, mode: str) -> str:
    pr = (req_priority or "P2").upper()
    if pr not in _PRIOS:
        pr = "P2"
    if index == 0 and pr in ("P0", "P1"):
        return pr
    if mode == "test" and pr == "P0":
        return "P1"
    return {"P0": "P1", "P1": "P1", "P2": "P2", "P3": "P3"}.get(pr, "P2")


def _estimate_for(index: int, mode: str, title: str) -> str:
    if mode in ("fullstack", "backend") and index == 1:
        return "L"
    if any(k in title for k in ("测试", "验收", "文档", "回归")):
        return "S"
    return "M"


def _work_type_for(mode: str, title: str) -> str:
    if mode in ("frontend", "backend", "test"):
        return mode
    if any(k in title for k in ("页面", "前端", "交互", "组件", "可视化")):
        return "frontend"
    if any(k in title for k in ("接口", "后端", "权限", "数据", "同步", "存储")):
        return "backend"
    if any(k in title for k in ("测试", "验收", "回归")):
        return "test"
    return "engineering"


def _derive_task_specs(req: Dict[str, Any], body: GenerateTasksBody) -> List[Dict[str, Any]]:
    title = str(req.get("title") or "").strip() or req.get("id") or "未命名需求"
    acceptance = _as_text_list(req.get("acceptance_criteria"))
    tags = _as_text_list(req.get("tags"))
    owner = body.owner_id
    tool = (body.dev_tool or "").strip()
    mode = body.mode or "standard"

    seeds: List[Dict[str, str]] = []
    seeds.append(
        {
            "title": f"澄清与方案设计：{_shorten(title, 80)}",
            "description": "梳理需求边界、交互流程、数据对象、权限与验收口径，输出可执行开发方案。",
            "agent_hint": "architect-agent",
        }
    )
    if mode in ("backend", "fullstack", "standard"):
        seeds.append(
            {
                "title": f"实现服务端能力：{_shorten(title, 80)}",
                "description": "补齐 API、数据校验、三码隔离、审计事件、错误处理与可观测埋点。",
                "agent_hint": "backend-agent",
            }
        )
    if mode in ("frontend", "fullstack", "standard"):
        seeds.append(
            {
                "title": f"实现管理端交互：{_shorten(title, 80)}",
                "description": "设计模块化页面状态、操作反馈、空态/错误态、权限态与响应式布局。",
                "agent_hint": "frontend-agent",
            }
        )
    for ac in acceptance[: max(0, body.max_tasks - 3)]:
        seeds.append(
            {
                "title": f"验收项落地：{_shorten(ac, 86)}",
                "description": f"围绕验收标准完成实现与验证：{ac}",
                "agent_hint": "delivery-agent",
            }
        )
    if mode in ("test", "fullstack", "standard") or acceptance:
        seeds.append(
            {
                "title": f"测试与回归：{_shorten(title, 80)}",
                "description": "补齐单元/接口/前端交互验证，覆盖关键验收标准与异常路径。",
                "agent_hint": "qa-agent",
            }
        )
    seeds.append(
        {
            "title": f"文档与知识沉淀：{_shorten(title, 80)}",
            "description": "更新规约、知识库、使用说明与 Agent 上下文，使 CLI/Agent 可复用本次能力。",
            "agent_hint": "knowledge-agent",
        }
    )

    dedup: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for idx, seed in enumerate(seeds):
        stitle = seed["title"].strip()
        if not stitle or stitle in seen:
            continue
        seen.add(stitle)
        work_type = _work_type_for(mode, stitle + " " + seed.get("description", ""))
        dedup.append(
            {
                "title": stitle[:500],
                "description": "\n".join(
                    x
                    for x in [
                        seed.get("description", "").strip(),
                        f"来源需求: {req.get('id', '')} / {title}",
                        f"标签: {', '.join(tags)}" if tags else "",
                    ]
                    if x
                )[:8000],
                "priority": _task_priority(str(req.get("priority") or "P2"), idx, mode),
                "estimate": _estimate_for(idx, mode, stitle),
                "owner_id": owner,
                "req_id": req.get("id") or "",
                "sprint_id": (body.sprint_id or "").strip(),
                "dev_tool": tool,
                "work_type": work_type,
                "agent_hint": seed.get("agent_hint") or "delivery-agent",
                "tool_hint": tool or ("sop-cli + registered IDE/agent profile"),
            }
        )
        if len(dedup) >= body.max_tasks:
            break
    return dedup


def _words(text: str) -> set[str]:
    return {x.lower() for x in re.findall(r"[\w\u4e00-\u9fff]{2,}", text or "")}


def _similarity(a: str, b: str) -> float:
    aw, bw = _words(a), _words(b)
    if not aw or not bw:
        return 0.0
    return len(aw & bw) / max(len(aw | bw), 1)


def _generated_acceptance(req: Dict[str, Any]) -> List[str]:
    title = _shorten(str(req.get("title") or "该需求"), 60)
    desc = str(req.get("description") or "").strip()
    candidates = [
        f"用户完成「{title}」主流程时，系统应给出明确成功反馈且数据状态正确更新。",
        "当输入缺失、无权限或服务异常时，系统应展示可理解的错误提示，不产生脏数据。",
        "该能力应接入项目上下文、审计事件和任务/Agent 协作链路，便于后续追踪。",
    ]
    for sentence in re.split(r"[。！？!?；;\n]", desc):
        s = sentence.strip()
        if len(s) >= 12:
            candidates.insert(0, f"覆盖场景：{_shorten(s, 90)}。")
        if len(candidates) >= 5:
            break
    out: List[str] = []
    seen: set[str] = set()
    for item in candidates:
        if item not in seen:
            out.append(item)
            seen.add(item)
        if len(out) >= 5:
            break
    return out


def _review_requirement(req: Dict[str, Any], peers: List[Dict[str, Any]]) -> Dict[str, Any]:
    title = str(req.get("title") or "").strip()
    desc = str(req.get("description") or "").strip()
    acceptance = _as_text_list(req.get("acceptance_criteria"))
    tags = _as_text_list(req.get("tags"))
    status = str(req.get("status") or "pending")
    priority = str(req.get("priority") or "P2")
    tasks = [x for x in rows("tasks", 1000) if x.get("req_id") == req.get("id")]

    score = 100
    risks: List[Dict[str, str]] = []
    suggestions: List[str] = []

    def penalize(points: int, code: str, text: str, suggestion: str) -> None:
        nonlocal score
        score -= points
        risks.append({"code": code, "level": "high" if points >= 16 else "medium", "message": text})
        suggestions.append(suggestion)

    if len(title) < 6:
        penalize(12, "weak_title", "标题过短，后续 AI/人员很难准确定位业务意图。", "补充对象、动作和目标结果，例如「管理员可配置项目级模型路由」。")
    if len(desc) < 40:
        penalize(18, "thin_description", "描述信息不足，缺少业务场景、边界或异常路径。", "补充用户角色、主流程、异常流程、权限和数据状态变化。")
    if not acceptance:
        penalize(22, "missing_acceptance", "缺少验收标准，无法形成稳定交付闭环。", "至少补 3 条可测试的 Given/When/Then 或场景化验收标准。")
    elif len(acceptance) < 2:
        penalize(10, "thin_acceptance", "验收标准数量偏少，容易遗漏异常路径。", "补充权限、失败、空态、边界值或审计相关验收。")
    if not tags:
        penalize(6, "missing_tags", "缺少标签，不利于知识沉淀、检索和智能路由。", "增加业务域、技术域或平台域标签。")
    if priority in {"P0", "P1"} and not tasks and status != "completed":
        penalize(14, "no_delivery_tasks", "高优需求尚未拆解开发任务，无法分配给 CLI/Agent 执行。", "使用「智能拆任务」生成任务并建立依赖关系。")
    if status == "completed" and not tasks:
        penalize(12, "completed_without_tasks", "需求已完成但没有关联任务，缺少交付证据。", "补充关联任务或在备注中说明外部交付证据。")

    duplicates = []
    base = f"{title}\n{desc}"
    for peer in peers:
        if peer.get("id") == req.get("id"):
            continue
        sim = _similarity(base, f"{peer.get('title') or ''}\n{peer.get('description') or ''}")
        if sim >= 0.28:
            duplicates.append({"id": peer.get("id"), "title": peer.get("title"), "similarity": round(sim, 2)})
    if duplicates:
        penalize(8, "possible_duplicate", "存在相似需求，可能造成重复开发或验收冲突。", "合并相似需求，或明确差异范围和依赖关系。")

    score = max(0, min(100, score))
    suggested_acceptance = [] if acceptance else _generated_acceptance(req)
    next_actions = []
    if suggested_acceptance:
        next_actions.append("应用建议验收标准")
    if not tasks:
        next_actions.append("预览并创建开发任务")
    if duplicates:
        next_actions.append("处理相似需求")
    if score >= 85 and tasks:
        next_actions.append("进入迭代执行与验收")
    return {
        "ok": True,
        "requirement_id": req.get("id"),
        "score": score,
        "level": "ready" if score >= 85 else "review" if score >= 65 else "needs_work",
        "risks": risks,
        "suggestions": suggestions,
        "suggested_acceptance_criteria": suggested_acceptance,
        "duplicates": duplicates[:5],
        "linked_tasks": len(tasks),
        "next_actions": next_actions,
        "reviewed_at": now().isoformat(),
    }


def _requirements_ops_payload(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    task_rows = rows("tasks", 2000)
    tasks_by_req: Dict[str, List[Dict[str, Any]]] = {}
    for task in task_rows:
        rid = str(task.get("req_id") or "")
        if rid:
            tasks_by_req.setdefault(rid, []).append(task)
    reviews = [_review_requirement(req, items) for req in items]
    by_id = {str(r.get("requirement_id") or ""): r for r in reviews}
    needs_review = [req for req in items if (by_id.get(str(req.get("id"))) or {}).get("score", 0) < 65]
    review_band = [req for req in items if 65 <= int((by_id.get(str(req.get("id"))) or {}).get("score", 0)) < 85]
    high_no_tasks = [
        req for req in items
        if str(req.get("priority") or "").upper() in {"P0", "P1"}
        and str(req.get("status") or "pending") != "completed"
        and not tasks_by_req.get(str(req.get("id") or ""))
    ]
    missing_acceptance = [req for req in items if not _as_text_list(req.get("acceptance_criteria"))]
    unassigned = [req for req in items if not str(req.get("assigned_agent") or "").strip() and str(req.get("status") or "pending") != "completed"]
    duplicate_pairs = []
    for review in reviews:
        for dup in review.get("duplicates") or []:
            duplicate_pairs.append({"id": review.get("requirement_id"), **dup})

    risks: List[Dict[str, Any]] = []
    if not items:
        risks.append({
            "id": "empty-requirement-pool",
            "severity": "P1",
            "category": "intake",
            "title": "需求池尚未建立",
            "description": "平台需要先沉淀业务想法、需求条目和验收标准，AI CLI/Agent 才能稳定拆解任务并执行。",
            "command": "sop requirement create \"初始化需求池\" --priority P1",
            "count": 0,
            "requirement_ids": [],
        })
    if needs_review:
        risks.append({
            "id": "low-quality-requirements",
            "severity": "P1",
            "category": "review",
            "title": f"{len(needs_review)} 个需求质量分低于 65",
            "description": "需求描述、验收标准或边界不足，会导致 AI 生成任务偏差和验收不可控。",
            "command": "sop requirement ops-tasks --categories review --apply",
            "count": len(needs_review),
            "requirement_ids": [str(x.get("id")) for x in needs_review[:10]],
        })
    if missing_acceptance:
        risks.append({
            "id": "missing-acceptance",
            "severity": "P1" if len(missing_acceptance) >= 3 else "P2",
            "category": "acceptance",
            "title": f"{len(missing_acceptance)} 个需求缺少验收标准",
            "description": "缺少验收标准会让质量卡点和 Agent 完成判定失去依据。",
            "command": "sop requirement ops-tasks --categories acceptance --apply",
            "count": len(missing_acceptance),
            "requirement_ids": [str(x.get("id")) for x in missing_acceptance[:10]],
        })
    if high_no_tasks:
        risks.append({
            "id": "high-priority-no-tasks",
            "severity": "P0" if any(str(x.get("priority")).upper() == "P0" for x in high_no_tasks) else "P1",
            "category": "generation",
            "title": f"{len(high_no_tasks)} 个高优需求尚未拆任务",
            "description": "高优需求需要尽快生成可执行任务、DAG 依赖和 Agent 执行包。",
            "command": "sop requirement ops-tasks --categories generation --apply",
            "count": len(high_no_tasks),
            "requirement_ids": [str(x.get("id")) for x in high_no_tasks[:10]],
        })
    if unassigned:
        risks.append({
            "id": "unassigned-requirements",
            "severity": "P2",
            "category": "routing",
            "title": f"{len(unassigned)} 个未完成需求未指定 Agent",
            "description": "缺少负责 Agent 或工具路由，会影响智能分发和后续执行跟踪。",
            "command": "sop requirement ops-tasks --categories routing --apply",
            "count": len(unassigned),
            "requirement_ids": [str(x.get("id")) for x in unassigned[:10]],
        })
    if duplicate_pairs:
        risks.append({
            "id": "duplicate-requirements",
            "severity": "P2",
            "category": "dedupe",
            "title": f"发现 {len(duplicate_pairs)} 条相似需求线索",
            "description": "相似需求需要合并或明确差异，避免重复开发和验收冲突。",
            "command": "sop requirement ops-tasks --categories dedupe --apply",
            "count": len(duplicate_pairs),
            "requirement_ids": [str(x.get("id")) for x in duplicate_pairs[:10]],
        })

    avg_score = round(sum(int(r.get("score") or 0) for r in reviews) / max(1, len(reviews)), 1) if reviews else 0
    score = 100
    score -= min(35, len(needs_review) * 8)
    score -= min(25, len(high_no_tasks) * 10)
    score -= min(20, len(missing_acceptance) * 4)
    score -= min(10, len(unassigned) * 2)
    if not items:
        score = 50
    score = max(0, score)
    grade = "healthy" if score >= 85 else "watch" if score >= 65 else "risk"
    candidates: List[Dict[str, Any]] = []
    for risk in risks:
        candidates.append({
            "title": f"[需求治理] {risk['title']}",
            "description": "\n".join([
                str(risk.get("description") or ""),
                "",
                f"风险分类: {risk.get('category')}",
                f"关联需求: {', '.join(risk.get('requirement_ids') or []) or '待梳理'}",
                f"建议命令: {risk.get('command')}",
            ]),
            "priority": "P0" if risk.get("severity") == "P0" else "P1" if risk.get("severity") == "P1" else "P2",
            "estimate": "M",
            "owner_id": "",
            "dev_tool": "codex-cli",
            "source": "requirement_ops",
            "source_report_id": str(risk.get("id") or ""),
            "source_report_title": str(risk.get("title") or ""),
            "category": str(risk.get("category") or ""),
            "debug_notes": f"tenant_code={resolved_tenant_code()} business_code={resolved_business_code()} project_id={resolved_project_id()} project_code={resolved_project_code()}",
        })
    return {
        "ok": True,
        "health": {"score": score, "grade": grade, "avg_review_score": avg_score},
        "summary": {
            "total": len(items),
            "ready": sum(1 for r in reviews if int(r.get("score") or 0) >= 85),
            "review": len(review_band),
            "needs_work": len(needs_review),
            "missing_acceptance": len(missing_acceptance),
            "high_priority_without_tasks": len(high_no_tasks),
            "unassigned": len(unassigned),
            "duplicate_hints": len(duplicate_pairs),
        },
        "risks": risks,
        "task_candidates": candidates,
        "commands": [
            {"label": "查看需求治理计划", "command": "sop requirement ops-plan --json"},
            {"label": "预览需求治理任务", "command": "sop requirement ops-tasks --limit 20 --json"},
            {"label": "生成需求治理任务", "command": "sop requirement ops-tasks --apply"},
        ],
        "agent_packet": {
            "purpose": "RequirementOps: keep product requirements reviewable, routable, and ready for task generation.",
            "read_api": "/api/v1/requirements/ops-plan",
            "task_api": "/api/v1/requirements/ops-tasks",
            "recommended_cli": "sop requirement ops-plan --json",
            "quality_gates": ["acceptance criteria required", "P0/P1 must have tasks", "agent routing required", "dedupe before build"],
        },
        "scope": {
            "tenant_code": resolved_tenant_code(),
            "business_code": resolved_business_code(),
            "project_id": resolved_project_id(),
            "project_code": resolved_project_code(),
        },
    }


@router.get("/ops-plan")
def requirements_ops_plan() -> Dict[str, Any]:
    raw = rows("requirements", 1000)
    st = _ui_load()
    items = _ui_ordered_list(raw, st)
    return _requirements_ops_payload(items)


@router.post("/ops-tasks")
def requirements_ops_tasks(body: RequirementOpsTasksIn) -> Dict[str, Any]:
    plan = requirements_ops_plan()
    categories = {x.strip() for x in body.categories if x.strip()}
    candidates = [
        item for item in (plan.get("task_candidates") or [])
        if not categories
        or str(item.get("category") or "") in categories
        or str(item.get("source_report_id") or "") in categories
        or str(item.get("source_report_title") or "") in categories
    ][: body.limit]
    items: List[Dict[str, Any]] = []
    created: List[str] = []
    if not body.dry_run:
        from .tasks import TaskCreate, create_task

        for item in candidates:
            payload = dict(item)
            payload["priority"] = body.priority or payload.get("priority") or "P1"
            payload["owner_id"] = body.owner_id
            out = create_task(TaskCreate(**payload))
            task_id = str(out.get("id") or "")
            created.append(task_id)
            payload["task_id"] = task_id
            items.append(payload)
    else:
        for item in candidates:
            payload = dict(item)
            payload["priority"] = body.priority or payload.get("priority") or "P1"
            payload["owner_id"] = body.owner_id
            items.append(payload)
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "items": items,
        "created_task_ids": created,
        "summary": {
            "planned": len(candidates),
            "created": len(created),
            "health_score": (plan.get("health") or {}).get("score", 0),
            "grade": (plan.get("health") or {}).get("grade", ""),
        },
    }


def _filter_requirements(
    raw: List[Dict[str, Any]],
    *,
    status: str = "",
    priority: str = "",
    q: str = "",
    assigned_agent: str = "",
    dev_tool: str = "",
) -> List[Dict[str, Any]]:
    if status:
        raw = [x for x in raw if x.get("status") == status]
    if priority and str(priority).upper() in _PRIOS:
        pu = str(priority).upper()
        raw = [x for x in raw if (x.get("priority") or "").upper() == pu]
    if assigned_agent:
        agent = assigned_agent.strip().lower()
        raw = [x for x in raw if agent in str(x.get("assigned_agent") or "").lower()]
    if dev_tool:
        tool = dev_tool.strip().lower()
        raw = [x for x in raw if tool in str(x.get("dev_tool") or "").lower()]
    q_norm = q.strip().lower()
    if q_norm:
        def hit(item: Dict[str, Any]) -> bool:
            haystack = "\n".join(
                [
                    str(item.get("id") or ""),
                    str(item.get("title") or ""),
                    str(item.get("description") or ""),
                    str(item.get("human_notes") or ""),
                    str(item.get("assigned_agent") or ""),
                    str(item.get("dev_tool") or ""),
                    " ".join(str(x) for x in item.get("tags", []) if x),
                    " ".join(str(x) for x in item.get("acceptance_criteria", []) if x),
                ]
            ).lower()
            return q_norm in haystack

        raw = [x for x in raw if hit(x)]
    return raw


@router.get("")
def list_reqs(
    status: Optional[str] = None,
    priority: Optional[str] = None,
    q: Optional[str] = None,
    assigned_agent: Optional[str] = None,
    dev_tool: Optional[str] = None,
):
    raw = rows("requirements", 500)
    st = _ui_load()
    ordered = _ui_ordered_list(raw, st)
    return _filter_requirements(
        ordered,
        status=status or "",
        priority=priority or "",
        q=q or "",
        assigned_agent=assigned_agent or "",
        dev_tool=dev_tool or "",
    )


@router.get("/summary")
def requirements_summary():
    raw = rows("requirements", 1000)
    st = _ui_load()
    items = _ui_ordered_list(raw, st)
    by_status: Dict[str, int] = {}
    by_priority: Dict[str, int] = {}
    by_agent: Dict[str, int] = {}
    by_tool: Dict[str, int] = {}
    tags: Dict[str, int] = {}
    ready = 0
    completed = 0
    for item in items:
        status = str(item.get("status") or "pending")
        priority = str(item.get("priority") or "P3")
        agent = str(item.get("assigned_agent") or "unassigned")
        tool = str(item.get("dev_tool") or "unspecified")
        by_status[status] = by_status.get(status, 0) + 1
        by_priority[priority] = by_priority.get(priority, 0) + 1
        by_agent[agent] = by_agent.get(agent, 0) + 1
        by_tool[tool] = by_tool.get(tool, 0) + 1
        if status == "completed":
            completed += 1
        if item.get("acceptance_criteria"):
            ready += 1
        for tag in item.get("tags", []) if isinstance(item.get("tags"), list) else []:
            tag_s = str(tag).strip()
            if tag_s:
                tags[tag_s] = tags.get(tag_s, 0) + 1
    total = len(items)
    return {
        "ok": True,
        "summary": {
            "total": total,
            "ready": ready,
            "completed": completed,
            "completion_rate": round((completed / total) * 100, 1) if total else 0,
            "by_status": by_status,
            "by_priority": by_priority,
            "by_agent": by_agent,
            "by_tool": by_tool,
            "tags": tags,
        },
    }


@router.get("/charts")
def requirements_charts() -> dict[str, Any]:
    """ECharts 友好：需求状态/优先级/Agent 分布。"""
    payload = requirements_summary()
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}

    def _pie(counter: dict[str, int]) -> list[dict[str, Any]]:
        return [{"name": k, "value": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0])) if v > 0]

    return {
        "ok": True,
        "by_status": _pie(summary.get("by_status") or {}),
        "by_priority": _pie(summary.get("by_priority") or {}),
        "by_agent": _pie(summary.get("by_agent") or {}),
    }


@router.get("/hub")
def requirements_hub() -> dict[str, Any]:
    payload = requirements_summary()
    summary = payload.get("summary") if isinstance(payload.get("summary"), dict) else {}
    charts = requirements_charts()
    return {
        "ok": True,
        "summary": summary,
        "charts": {
            "by_status": charts.get("by_status") or [],
            "by_priority": charts.get("by_priority") or [],
        },
        "domains": [
            {"id": "pool", "path": "#/requirements/pool", "capability": "product.requirements.pool"},
            {"id": "review", "path": "#/requirements/review", "capability": "product.requirements.review"},
            {"id": "generation", "path": "#/requirements/generation", "capability": "product.requirements.generation"},
            {"id": "batch", "path": "#/requirements/batch", "capability": "product.requirements.batch"},
        ],
        "workbench_path": "#/requirements/pool",
        "flow": [
            {"id": "pool", "done": (summary.get("total") or 0) > 0},
            {"id": "review", "done": (summary.get("ready") or 0) > 0},
            {"id": "generation", "done": (summary.get("completed") or 0) > 0},
            {"id": "batch", "done": float(summary.get("completion_rate") or 0) >= 30},
        ],
    }


@router.post("")
def create_req(body: ReqCreate):
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    row = {
        "id": f"REQ-{uuid.uuid4().hex[:16]}",
        "project_id": resolved_project_id(),
        "title": body.title,
        "description": body.description or "",
        "status": "pending",
        "priority": body.priority,
        "sprint_id": "",
        "story_points": 0,
        "acceptance_criteria": body.acceptance_criteria or [],
        "tags": body.tags or [],
        "human_notes": "",
        "confidence": 0.0,
        "created_at": now(),
        "updated_at": now(),
    }
    t.add([row])
    st = _ui_load()
    _ui_append_to_column(st, row["id"], body.priority)
    if (body.assigned_agent or "").strip() or (body.dev_tool or "").strip():
        st.setdefault("fields", {})[row["id"]] = {
            "assigned_agent": (body.assigned_agent or "").strip(),
            "dev_tool": (body.dev_tool or "").strip(),
        }
    _ui_save(st)
    notify_webhook(
        "requirement.created",
        {"requirement_id": row["id"], "title": body.title, "priority": body.priority},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True, "id": row["id"]}


@router.post("/batch")
def batch_create(body: BatchCreateBody, user: BusinessUser,
                 db: BusinessSession):
    if body.generation_id:
        from .delivery import _project
        from .requirements_assistance import adopt

        return adopt(db, _project(db, user, resolved_project_id()), user, "batch.apply", body)
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    ids: List[str] = []
    rows_add: List[Dict[str, Any]] = []
    for it in body.items:
        rid = f"REQ-{uuid.uuid4().hex[:16]}"
        ids.append(rid)
        rows_add.append(
            {
                "id": rid,
                "project_id": resolved_project_id(),
                "title": it.title,
                "description": it.description or "",
                "status": "pending",
                "priority": it.priority,
                "sprint_id": "",
                "story_points": 0,
                "acceptance_criteria": it.acceptance_criteria or [],
                "tags": it.tags or [],
                "human_notes": "",
                "confidence": 0.0,
                "created_at": now(),
                "updated_at": now(),
            }
        )
    t.add(rows_add)
    st = _ui_load()
    for row, it in zip(rows_add, body.items):
        _ui_append_to_column(st, row["id"], row["priority"])
        if (it.assigned_agent or "").strip() or (it.dev_tool or "").strip():
            st.setdefault("fields", {})[row["id"]] = {
                "assigned_agent": (it.assigned_agent or "").strip(),
                "dev_tool": (it.dev_tool or "").strip(),
            }
    _ui_save(st)
    notify_webhook(
        "requirement.batch_created",
        {"count": len(ids), "ids": ids},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True, "ids": ids, "count": len(ids)}


@router.post("/parse-document")
def parse_document(body: ParseDocumentBody, request: Request,
                   user: BusinessUser, db: BusinessSession):
    from .delivery import _project
    from .requirements_assistance import generate

    if len(body.text.strip()) < 20:
        raise HTTPException(400, "文档内容过短")
    return generate(db, _project(db, user, resolved_project_id()), user, "parse", body, request)


@router.post("/reorder-board")
def reorder_board(body: ReorderBoardBody):
    raw = rows("requirements", 500)
    all_ids = {r["id"] for r in raw if r.get("id")}
    groups: Dict[str, List[str]] = {p: [] for p in _PRIOS}
    combined: List[str] = []
    for p in _PRIOS:
        for rid in body.groups.get(p) or []:
            rid = _safe_req_id(str(rid).strip())
            if rid not in all_ids:
                raise HTTPException(400, f"未知需求 ID: {rid}")
            groups[p].append(rid)
            combined.append(rid)
    if len(combined) != len(set(combined)):
        raise HTTPException(400, "需求 ID 重复")
    if set(combined) != all_ids:
        raise HTTPException(400, "各列 ID 须覆盖当前全部需求且无多余项（拖拽后请提交完整四列顺序）")
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    ts = now()
    for p in _PRIOS:
        for rid in groups[p]:
            t.update(where=f"id = '{rid}'", values={"priority": p, "updated_at": ts})
    st = _ui_load()
    st["columns"] = groups
    _ui_save(st)
    return {"ok": True}


@router.patch("/bulk")
def bulk_update_reqs(body: ReqBulkUpdate):
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    ids = [_safe_req_id(str(rid).strip()) for rid in body.ids if str(rid).strip()]
    ids = list(dict.fromkeys(ids))
    if not ids:
        raise HTTPException(400, "ids 不能为空")
    existing = {str(x.get("id")) for x in rows("requirements", 1000) if x.get("id")}
    missing = [rid for rid in ids if rid not in existing]
    if missing:
        raise HTTPException(400, f"未知需求 ID: {', '.join(missing[:10])}")
    vals: Dict[str, Any] = {}
    if body.status is not None:
        status = str(body.status).strip()
        if status not in {"pending", "in_progress", "blocked", "completed"}:
            raise HTTPException(400, "非法需求状态")
        vals["status"] = status
    if body.priority is not None:
        priority = str(body.priority).strip().upper()
        if priority not in _PRIOS:
            raise HTTPException(400, "非法需求优先级")
        vals["priority"] = priority
    ui_patch: Dict[str, str] = {}
    if body.assigned_agent is not None:
        ui_patch["assigned_agent"] = str(body.assigned_agent).strip()[:80]
    if body.dev_tool is not None:
        ui_patch["dev_tool"] = str(body.dev_tool).strip()[:80]
    if not vals and not ui_patch:
        raise HTTPException(400, "未提供可更新字段")
    vals["updated_at"] = now()
    if vals:
        for rid in ids:
            t.update(where=f"id = '{rid}'", values=vals)
    st = _ui_load()
    if "priority" in vals:
        for rid in ids:
            _ui_append_to_column(st, rid, str(vals["priority"]))
    if ui_patch:
        fields = st.setdefault("fields", {})
        for rid in ids:
            fld = fields.setdefault(rid, {})
            for key, value in ui_patch.items():
                fld[key] = value
    if "priority" in vals or ui_patch:
        _ui_save(st)
    notify_webhook(
        "requirement.bulk_updated",
        {"requirement_ids": ids, "fields": [k for k in vals.keys() if k != "updated_at"] + list(ui_patch.keys()), "count": len(ids)},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True, "updated": len(ids), "fields": [k for k in vals.keys() if k != "updated_at"] + list(ui_patch.keys())}


@router.post("/{req_id}/generate-tasks")
def generate_tasks_from_requirement(req_id: str, body: GenerateTasksBody):
    req_id = _safe_req_id(req_id)
    found = [x for x in rows("requirements", 1000) if x.get("id") == req_id]
    if not found:
        raise HTTPException(404, "需求不存在")
    req = found[0]
    specs = _derive_task_specs(req, body)
    if body.dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "requirement_id": req_id,
            "mode": body.mode,
            "items": specs,
            "count": len(specs),
        }

    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    existing = rows("tasks", 1000)
    existing_by_title = {
        str(x.get("title") or ""): str(x.get("id") or "")
        for x in existing
        if x.get("req_id") == req_id and x.get("title")
    }
    rows_add: List[Dict[str, Any]] = []
    created_items: List[Dict[str, Any]] = []
    skipped: List[Dict[str, Any]] = []
    ts = now()
    for spec in specs:
        if spec["title"] in existing_by_title:
            skipped.append({**spec, "id": existing_by_title[spec["title"]], "reason": "exists"})
            continue
        tid = f"T-{uuid.uuid4().hex[:12]}"
        row = {
            "id": tid,
            "project_id": resolved_project_id(),
            "req_id": req_id,
            "sprint_id": spec.get("sprint_id") or "",
            "title": spec["title"],
            "description": spec.get("description") or "",
            "status": "pending",
            "priority": spec.get("priority") or "P2",
            "estimate": spec.get("estimate") or "M",
            "owner_id": spec.get("owner_id") or "",
            "actual_hours": 0.0,
            "confidence": 0.0,
            "created_at": ts,
            "updated_at": ts,
        }
        rows_add.append(row)
        created_items.append({**spec, "id": tid})
    if rows_add:
        t.add(rows_add)
        from .tasks import _ui_append_to_column as _task_ui_append_to_column
        from .tasks import _ui_load as _task_ui_load
        from .tasks import _ui_save as _task_ui_save

        st = _task_ui_load()
        for row, spec in zip(rows_add, created_items):
            _task_ui_append_to_column(st, row["id"], str(row.get("priority") or "P2"))
            fld: Dict[str, Any] = {
                "source": "requirement.generate_tasks",
                "work_type": spec.get("work_type") or "",
                "agent_hint": spec.get("agent_hint") or "",
                "tool_hint": spec.get("tool_hint") or "",
            }
            if (spec.get("dev_tool") or "").strip():
                fld["dev_tool"] = (spec.get("dev_tool") or "").strip()
            st.setdefault("fields", {})[row["id"]] = fld
        if body.create_dependencies and len(rows_add) > 1:
            deps = st.setdefault("dependencies", {})
            first_id = rows_add[0]["id"]
            for row in rows_add[1:]:
                deps.setdefault(first_id, []).append(
                    {
                        "target_id": row["id"],
                        "type": "blocks",
                        "note": "由需求拆解自动建立：方案设计完成后进入后续实现/验证任务。",
                        "created_at": now().isoformat(),
                    }
                )
        _task_ui_save(st)
    notify_webhook(
        "requirement.tasks_generated",
        {
            "requirement_id": req_id,
            "created": len(created_items),
            "skipped": len(skipped),
            "mode": body.mode,
        },
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {
        "ok": True,
        "dry_run": False,
        "requirement_id": req_id,
        "mode": body.mode,
        "items": created_items,
        "skipped": skipped,
        "count": len(created_items),
    }


@router.post("/{req_id}/review")
def review_requirement(req_id: str, request: Request, user: BusinessUser, db: BusinessSession,
                       body: ReviewInput = None):
    from .delivery import _project
    from .requirements_assistance import generate

    return generate(db, _project(db, user, resolved_project_id()), user, "review",
                    body or ReviewInput(), request, _safe_req_id(req_id))


@router.get("/{req_id}/assistance-history")
def assistance_history(req_id: str, user: BusinessUser,
                       db: BusinessSession):
    from .delivery import _project
    from .requirements_assistance import history

    return history(db, _project(db, user, resolved_project_id()), _safe_req_id(req_id))


@router.post("/{req_id}/apply-review")
def apply_requirement_review(req_id: str, body: ApplyReviewBody,
                             user: BusinessUser, db: BusinessSession):
    req_id = _safe_req_id(req_id)
    if body.generation_id:
        from .delivery import _project
        from .requirements_assistance import adopt

        return adopt(db, _project(db, user, resolved_project_id()), user, "apply-review", body, req_id)
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    reqs = rows("requirements", 1000)
    found = [x for x in reqs if x.get("id") == req_id]
    if not found:
        raise HTTPException(404, "需求不存在")
    current = found[0]
    vals: Dict[str, Any] = {}
    if body.acceptance_criteria is not None:
        criteria = [str(x).strip() for x in body.acceptance_criteria if str(x).strip()][:20]
        if criteria:
            vals["acceptance_criteria"] = criteria
    if body.tags is not None:
        tags = [str(x).strip() for x in body.tags if str(x).strip()][:20]
        if tags:
            vals["tags"] = tags
    if body.human_notes is not None:
        note = (body.human_notes or "").strip()
        if note:
            old = str(current.get("human_notes") or "").strip()
            vals["human_notes"] = f"{old}\n{note}".strip() if old else note
    if not vals:
        return {"ok": True, "updated": [], "review": _review_requirement(current, reqs)}
    vals["updated_at"] = now()
    t.update(where=f"id = '{req_id}'", values=vals)
    updated = {**current, **vals}
    notify_webhook(
        "requirement.updated",
        {"requirement_id": req_id, "fields": [k for k in vals.keys() if k != "updated_at"], "source": "requirement.manual_review"},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True, "updated": [k for k in vals.keys() if k != "updated_at"], "review": _review_requirement(updated, reqs)}


@router.get("/{req_id}/prototype")
def get_prototype(req_id: str, user: BusinessUser,
                  db: BusinessSession):
    req_id = _safe_req_id(req_id)
    from .delivery import _project
    from .delivery_plan import _current

    _, state, _, revision = _current(db, _project(db, user, resolved_project_id()), req_id)
    versions = [entry for entry in state["flows"].get(req_id, {}).get("artifacts", []) if entry["kind"] == "prototype"]
    if versions:
        return {"ok": True, "content": versions[-1]["content"], "exists": True, "versions": versions,
                "artifact_id": versions[-1]["id"], "current_revision": revision,
                "stale": versions[-1]["revision"] != revision}
    p = _prototype_path(req_id)
    if not p.exists():
        return {"ok": True, "content": "", "exists": False, "versions": []}
    return {"ok": True, "content": p.read_text(encoding="utf-8", errors="replace"), "exists": True,
            "versions": [], "source": "legacy_file"}


@router.post("/{req_id}/prototype")
def generate_prototype(req_id: str, body: GeneratePrototypeBody, request: Request,
                       user: BusinessUser, db: BusinessSession):
    from .delivery import _project
    from .requirements_assistance import generate

    # Reject unsupported image work before committing or calling any provider.
    if body.gen_image:
        raise HTTPException(422, {"code": "prototype_image_unsupported",
                                 "message": "当前文本模型网关不支持原型配图，请生成可编辑的原型说明"})
    return generate(db, _project(db, user, resolved_project_id()), user, "prototype", body, request, _safe_req_id(req_id))


@router.post("/{req_id}/prototype/apply")
def apply_prototype(req_id: str, body: PrototypeApply,
                    user: BusinessUser, db: BusinessSession):
    from .delivery import _project
    from .requirements_assistance import adopt

    return adopt(db, _project(db, user, resolved_project_id()), user, "prototype.apply", body, _safe_req_id(req_id))


@router.patch("/{req_id}/priority")
def update_priority(req_id: str, body: PriorityBody):
    req_id = _safe_req_id(req_id)
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    t.update(
        where=f"id = '{req_id}'",
        values={"priority": body.priority, "human_notes": body.human_notes or "", "updated_at": now()},
    )
    st = _ui_load()
    _ui_append_to_column(st, req_id, body.priority)
    _ui_save(st)
    notify_webhook(
        "requirement.updated",
        {"requirement_id": req_id, "fields": ["priority", "human_notes"]},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True}


@router.patch("/{req_id}")
def update_req(req_id: str, body: ReqUpdate):
    req_id = _safe_req_id(req_id)
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    try:
        raw = body.model_dump(exclude_unset=True)
    except AttributeError:
        raw = body.dict(exclude_unset=True)
    ui_a = raw.pop("assigned_agent", None) if "assigned_agent" in raw else None
    ui_t = raw.pop("dev_tool", None) if "dev_tool" in raw else None
    vals = {k: v for k, v in raw.items() if v is not None}
    if not vals and ui_a is None and ui_t is None:
        return {"ok": True}
    if vals:
        vals["updated_at"] = now()
        t.update(where=f"id = '{req_id}'", values=vals)
    st = _ui_load()
    if "priority" in vals:
        _ui_append_to_column(st, req_id, str(vals["priority"]))
    if ui_a is not None or ui_t is not None:
        fld = st.setdefault("fields", {}).setdefault(req_id, {})
        if ui_a is not None:
            fld["assigned_agent"] = ui_a or ""
        if ui_t is not None:
            fld["dev_tool"] = ui_t or ""
    if "priority" in vals or ui_a is not None or ui_t is not None:
        _ui_save(st)
    notify_webhook(
        "requirement.updated",
        {"requirement_id": req_id, "fields": list(vals.keys()) if vals else []},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True}


@router.delete("/{req_id}")
def delete_req(req_id: str):
    req_id = _safe_req_id(req_id)
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    t.delete(f"id = '{req_id}'")
    st = _ui_load()
    _ui_delete_id(st, req_id)
    _ui_save(st)
    from sop_manager.project_write_guard import project_file_write_scope

    with project_file_write_scope():
        p = _prototype_path(req_id)
        p.unlink(missing_ok=True)
    notify_webhook(
        "requirement.deleted",
        {"requirement_id": req_id},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True}
