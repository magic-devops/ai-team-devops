"""需求 CRUD + 文档 AI 拆解 + 原型说明/配图（原型存 .ai-memory/requirement_prototypes/）"""
from __future__ import annotations

import json
import os
import re
import uuid
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from sop_manager.path_config import resolved_ai_memory_root, resolved_project_id, resolved_tenant_id
from .db_sql_compat import now, rows, table
from .webhook import notify_webhook

router = APIRouter(prefix="/api/v1/requirements", tags=["requirements"])

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
    if not sp.exists():
        return _ui_default_state()
    try:
        d = json.loads(sp.read_text(encoding="utf-8"))
        if not isinstance(d, dict):
            return _ui_default_state()
        d.setdefault("columns", {p: [] for p in _PRIOS})
        d.setdefault("fields", {})
        for p in _PRIOS:
            d["columns"].setdefault(p, [])
        return d
    except Exception:
        return _ui_default_state()


def _ui_save(d: Dict[str, Any]) -> None:
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
        _ui_save(st)
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


class ReorderBoardBody(BaseModel):
    """各优先级列自上而下需求 ID；须与当前库中需求 ID 全集一致、无重复。"""

    groups: Dict[str, List[str]] = Field(default_factory=dict)


class PriorityBody(BaseModel):
    priority: str
    human_notes: Optional[str] = ""


class BatchCreateBody(BaseModel):
    items: List[ReqCreate] = Field(..., min_length=1, max_length=80)


class ParseDocumentBody(BaseModel):
    """粘贴 PRD / 需求说明全文，由大模型抽取结构化需求列表（JSON）。"""
    text: str = Field(..., min_length=20, max_length=_DOC_MAX)
    filename: Optional[str] = None


class GeneratePrototypeBody(BaseModel):
    mode: str = "wireframe"  # wireframe | user_journey | ia
    extra_context: Optional[str] = Field(None, max_length=8000)
    gen_image: bool = False  # 需要 OPENAI_API_KEY


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


def _llm_text(system: str, user: str, max_tokens: int = 8192) -> str:
    try:
        import anthropic
    except ImportError:
        raise HTTPException(503, "请安装 anthropic: pip install anthropic")
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        raise HTTPException(503, "未配置 ANTHROPIC_API_KEY，无法调用文档解析 / 原型生成")
    client = anthropic.Anthropic(api_key=key)
    msg = client.messages.create(
        model=os.getenv("REQUIREMENTS_AI_MODEL", "claude-3-5-sonnet-20241022"),
        max_tokens=max_tokens,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    if not msg.content:
        return ""
    return getattr(msg.content[0], "text", "") or ""


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


def _openai_image_url(prompt: str) -> Optional[str]:
    key = os.getenv("OPENAI_API_KEY", "")
    if not key:
        return None
    try:
        import urllib.request
    except ImportError:
        return None
    body = json.dumps(
        {
            "model": "dall-e-3",
            "prompt": (prompt[:900] + " Minimal high-fidelity UI mockup, clean vector, no text watermark."),
            "n": 1,
            "size": "1024x1024",
            "response_format": "url",
        }
    ).encode("utf-8")
    req = urllib.request.Request(
        "https://api.openai.com/v1/images/generations",
        data=body,
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    arr = data.get("data") or []
    if not arr:
        return None
    return arr[0].get("url")


@router.get("")
def list_reqs(status: Optional[str] = None, priority: Optional[str] = None):
    raw = rows("requirements", 500)
    if status:
        raw = [x for x in raw if x.get("status") == status]
    st = _ui_load()
    ordered = _ui_ordered_list(raw, st)
    if priority and str(priority).upper() in _PRIOS:
        pu = str(priority).upper()
        ordered = [x for x in ordered if (x.get("priority") or "").upper() == pu]
    return ordered


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
def batch_create(body: BatchCreateBody):
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
def parse_document(body: ParseDocumentBody):
    text = body.text.strip()
    if len(text) < 20:
        raise HTTPException(400, "文档内容过短")
    system = """你是资深产品经理。用户粘贴的是 PRD / 需求说明 / 会议纪要等文本。
请从中抽取**可交付的需求条目**，严格只输出一个 JSON 对象（不要 Markdown 围栏），格式：
{"requirements":[
  {"title":"短标题","description":"详细说明","priority":"P0|P1|P2|P3","acceptance_criteria":["可验收条目1"],"tags":["可选标签"]}
]}
规则：
- 5～40 条为宜；合并重复表述；标题简洁中文。
- priority：核心业务/合规/安全为 P0；重要功能 P1；一般 P2；优化类 P3。
- acceptance_criteria：每条需求 1～5 条可测标准。
- 不要编造文本中不存在的功能。"""
    user = f"文件名参考: {body.filename or '未命名'}\n\n--- 文档正文 ---\n{text[:_DOC_MAX]}"
    try:
        raw_txt = _llm_text(system, user, max_tokens=8192)
        obj = _extract_json_obj(raw_txt)
        items = _normalize_items(obj)
        return {"ok": True, "items": items, "count": len(items)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"文档解析失败: {e}") from e


class ReorderBoardBody(BaseModel):
    groups: Dict[str, List[str]] = Field(default_factory=dict)


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


@router.get("/{req_id}/prototype")
def get_prototype(req_id: str):
    req_id = _safe_req_id(req_id)
    p = _prototype_path(req_id)
    if not p.exists():
        return {"ok": True, "content": "", "exists": False}
    return {"ok": True, "content": p.read_text(encoding="utf-8", errors="replace"), "exists": True}


@router.post("/{req_id}/prototype")
def generate_prototype(req_id: str, body: GeneratePrototypeBody):
    req_id = _safe_req_id(req_id)
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    found = [x for x in rows("requirements", 500) if x.get("id") == req_id]
    if not found:
        raise HTTPException(404, "需求不存在")
    r = found[0]
    if body.mode not in ("wireframe", "user_journey", "ia"):
        raise HTTPException(400, "mode 须为 wireframe | user_journey | ia")
    mode_hint = {
        "wireframe": "以「页面线框 + 组件说明」为主，给出关键界面布局（可用 ASCII/表格描述区域占比）。",
        "user_journey": "以「用户旅程 + 触点」为主，覆盖主流程与异常分支。",
        "ia": "以「信息架构」为主：模块、导航层级、实体关系简述。",
    }.get(body.mode, "")
    extra = (body.extra_context or "").strip()
    system = f"""你是资深产品设计师。请根据需求生成**中低保真原型说明**（Markdown，简体中文）。
{mode_hint}
输出章节建议：概述 / 目标用户与场景 / 关键页面与布局要点 / 组件与交互 / 非功能与边界 / 开放问题。
不要编造需求正文中没有的功能；可合理推断 UI 结构。不要输出代码仓库路径。"""
    user = f"""需求 ID: {req_id}
标题: {r.get('title','')}
描述:
{r.get('description','')}

验收标准:
{json.dumps(r.get('acceptance_criteria') or [], ensure_ascii=False)}

人工备注:
{r.get('human_notes') or ''}

补充说明:
{extra}
"""
    try:
        md = _llm_text(system, user, max_tokens=8192)
        if not md.strip():
            raise HTTPException(502, "模型返回为空")
        img_url: Optional[str] = None
        if body.gen_image:
            img_prompt = f"Software UI mockup for: {r.get('title','')}. {r.get('description','')[:400]}"
            img_url = _openai_image_url(img_prompt)
            if img_url:
                md += f"\n\n---\n## 概念配图（AI）\n\n![prototype]({img_url})\n"
        _prototype_path(req_id).write_text(md.strip() + "\n", encoding="utf-8")
        return {"ok": True, "content": md, "image_url": img_url}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(502, f"原型生成失败: {e}") from e


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
    p = _prototype_path(req_id)
    if p.exists():
        try:
            p.unlink()
        except OSError:
            pass
    notify_webhook(
        "requirement.deleted",
        {"requirement_id": req_id},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True}
