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

from .db import PROJECT_PATH, now, rows, table

router = APIRouter(prefix="/api/requirements", tags=["requirements"])

_DOC_MAX = 120_000


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


class ReqUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    story_points: Optional[int] = None
    acceptance_criteria: Optional[List[str]] = None
    human_notes: Optional[str] = None


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
    d = PROJECT_PATH / ".ai-memory" / "requirement_prototypes"
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
    r = rows("requirements")
    if status:
        r = [x for x in r if x.get("status") == status]
    if priority:
        r = [x for x in r if x.get("priority") == priority]
    return sorted(r, key=lambda x: (x.get("priority", "P9"), x.get("created_at", "")))


@router.post("")
def create_req(body: ReqCreate):
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    row = {
        "id": f"REQ-{uuid.uuid4().hex[:16]}",
        "project_id": os.getenv("PROJECT_ID", "default"),
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
    return {"ok": True, "id": row["id"]}


@router.post("/batch")
def batch_create(body: BatchCreateBody):
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    ids: List[str] = []
    rows_add: List[Dict[str, Any]] = []
    for it in body.items:
        rid = f"REQ-{uuid.uuid4().hex[:16]}"
        ids.append(rid)
        rows_add.append(
            {
                "id": rid,
                "project_id": os.getenv("PROJECT_ID", "default"),
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
        raise HTTPException(503, "LanceDB not available")
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
        raise HTTPException(503, "LanceDB not available")
    t.update(
        where=f"id = '{req_id}'",
        values={"priority": body.priority, "human_notes": body.human_notes or "", "updated_at": now()},
    )
    return {"ok": True}


@router.patch("/{req_id}")
def update_req(req_id: str, body: ReqUpdate):
    req_id = _safe_req_id(req_id)
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    vals = _dump_vals(body)
    if not vals:
        return {"ok": True}
    vals["updated_at"] = now()
    t.update(where=f"id = '{req_id}'", values=vals)
    return {"ok": True}


@router.delete("/{req_id}")
def delete_req(req_id: str):
    req_id = _safe_req_id(req_id)
    t = table("requirements")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    t.delete(f"id = '{req_id}'")
    p = _prototype_path(req_id)
    if p.exists():
        try:
            p.unlink()
        except OSError:
            pass
    return {"ok": True}
