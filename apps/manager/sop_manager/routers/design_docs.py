"""
技术方案 / 设计文档管理：多文档、版本历史、人工导入、AI 完善（Markdown 落盘 .ai-memory/tech_design/）
供 AI 开发时引用架构、选型与实现细节，支持迭代与回溯。
"""
from __future__ import annotations

import difflib
import json
import os
import re
import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from sop_manager.path_config import resolved_ai_memory_root

router = APIRouter(prefix="/api/v1/design-docs", tags=["design-docs"])

_ID_RE = re.compile(r"^TDS-[a-f0-9]{12}$")
_CONTENT_MAX = 500_000


def _root() -> Path:
    return resolved_ai_memory_root() / "tech_design"


def _index_path() -> Path:
    return _root() / "index.json"


def _utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _load_index() -> Dict[str, Any]:
    p = _index_path()
    if not p.exists():
        return {"documents": []}
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except Exception:
        return {"documents": []}


def _save_index(data: Dict[str, Any]) -> None:
    from sop_manager.project_write_guard import project_file_write_scope

    with project_file_write_scope():
        path = _index_path()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _doc_dir(doc_id: str) -> Path:
    return _root() / doc_id


def _meta_path(doc_id: str) -> Path:
    return _doc_dir(doc_id) / "meta.json"


def _load_meta(doc_id: str) -> Dict[str, Any]:
    p = _meta_path(doc_id)
    if not p.exists():
        raise HTTPException(404, "文档不存在")
    return json.loads(p.read_text(encoding="utf-8"))


def _save_meta(doc_id: str, meta: Dict[str, Any]) -> None:
    from sop_manager.project_write_guard import project_file_write_scope

    with project_file_write_scope():
        path = _meta_path(doc_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")


def _safe_id(doc_id: str) -> str:
    doc_id = (doc_id or "").strip().lower()
    if not _ID_RE.match(doc_id):
        raise HTTPException(400, "非法文档 ID")
    return doc_id


def _sync_index_entry(meta: Dict[str, Any]) -> None:
    idx = _load_index()
    docs = list(idx.get("documents") or [])
    nid = meta["id"]
    row = {
        "id": nid,
        "title": meta.get("title", ""),
        "category": meta.get("category", "general"),
        "tags": meta.get("tags") or [],
        "current_version": meta.get("current_version", 0),
        "updated_at": meta.get("updated_at", ""),
        "created_at": meta.get("created_at", ""),
    }
    found = False
    for i, d in enumerate(docs):
        if d.get("id") == nid:
            docs[i] = row
            found = True
            break
    if not found:
        docs.append(row)
    idx["documents"] = sorted(docs, key=lambda x: x.get("updated_at", ""), reverse=True)
    _save_index(idx)


def _read_current(doc_id: str) -> str:
    cur = _doc_dir(doc_id) / "current.md"
    if not cur.exists():
        return ""
    return cur.read_text(encoding="utf-8", errors="replace")


def _llm_improve(current_md: str, instruction: str, mode: str) -> str:
    try:
        import anthropic
    except ImportError:
        raise HTTPException(503, "请安装 anthropic")
    key = os.getenv("ANTHROPIC_API_KEY", "")
    if not key:
        raise HTTPException(503, "未配置 ANTHROPIC_API_KEY，无法使用 AI 完善")
    mode_hint = {
        "expand": "在保持技术准确的前提下扩展细节：接口、数据模型、错误处理、观测与部署要点。",
        "review": "以架构评审视角指出风险、遗漏与不一致，并给出修订后的完整文档（合并原内容）。",
        "diagram": "补充 Mermaid 图（架构图/时序图/ER 图等，按需选择），与文字说明结合；输出完整 Markdown。",
        "free": "严格遵循用户指令修改文档。",
    }
    hint = mode_hint.get(mode, mode_hint["free"])
    system = f"""你是资深系统架构师与技术负责人。用户维护的是**技术方案 / 设计文档**（Markdown）。
{hint}
要求：
- 输出**完整** Markdown 文档（可直接覆盖原稿），简体中文为主，保留必要英文术语。
- 不编造不存在的业务事实；可合理补全工程实践（日志、幂等、超时、兼容策略等）。
- 不要输出寒暄，不要 ``` 围栏包裹全文（如用小代码块仅用于片段）。"""
    user = f"""【用户指令】
{instruction}

【当前文档】
{current_md[:_CONTENT_MAX]}
"""
    model = os.getenv("DESIGN_DOCS_AI_MODEL", "claude-3-5-sonnet-20241022")
    client = anthropic.Anthropic(api_key=key)
    msg = client.messages.create(
        model=model,
        max_tokens=16384,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    if not msg.content:
        return ""
    return getattr(msg.content[0], "text", "") or ""


class DocCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    category: str = Field("architecture", max_length=80)
    tags: List[str] = []
    initial_content: Optional[str] = Field(None, max_length=_CONTENT_MAX)
    version_note: str = Field("创建", max_length=200)


class DocMetaUpdate(BaseModel):
    title: Optional[str] = Field(None, max_length=200)
    category: Optional[str] = Field(None, max_length=80)
    tags: Optional[List[str]] = None


class VersionCreate(BaseModel):
    content: str = Field(..., min_length=0, max_length=_CONTENT_MAX)
    note: str = Field("编辑保存", max_length=300)


class ImportBody(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    category: str = Field("import", max_length=80)
    tags: List[str] = []
    content: str = Field(..., min_length=1, max_length=_CONTENT_MAX)
    version_note: str = Field("人工导入", max_length=200)


class AiImproveBody(BaseModel):
    instruction: str = Field(..., min_length=4, max_length=8000)
    mode: str = Field("expand", max_length=32)  # expand | review | diagram | free


class RestoreBody(BaseModel):
    version: int = Field(..., ge=1)


@router.get("")
def list_docs():
    idx = _load_index()
    return sorted(idx.get("documents") or [], key=lambda x: x.get("updated_at", ""), reverse=True)


@router.post("")
def create_doc(body: DocCreate):
    from sop_manager.project_write_guard import project_file_write_scope

    with project_file_write_scope():
        doc_id = f"TDS-{uuid.uuid4().hex[:12]}"
        ddir = _doc_dir(doc_id)
        ddir.mkdir(parents=True, exist_ok=True)
        ts = _utc_iso()
        v = 1
        content = (body.initial_content or _default_template(body.title)).strip() + "\n"
        (ddir / "v1.md").write_text(content, encoding="utf-8")
        (ddir / "current.md").write_text(content, encoding="utf-8")
        meta = {
            "id": doc_id,
            "title": body.title.strip(),
            "category": body.category.strip() or "general",
            "tags": body.tags[:24] if body.tags else [],
            "created_at": ts,
            "updated_at": ts,
            "current_version": v,
            "versions": [{"v": v, "created_at": ts, "note": body.version_note.strip() or "创建"}],
        }
        _save_meta(doc_id, meta)
        _sync_index_entry(meta)
        return {"ok": True, "id": doc_id}


def _default_template(title: str) -> str:
    return f"""# {title}

## 1. 背景与目标

## 2. 架构概览

## 3. 方案选型

| 维度 | 方案 | 说明 |
|------|------|------|
|  |  |  |

## 4. 关键设计

## 5. 接口与数据

## 6. 非功能需求（性能/安全/可观测）

## 7. 风险与演进

"""


@router.post("/import")
def import_doc(body: ImportBody):
    b = DocCreate(
        title=body.title,
        category=body.category,
        tags=body.tags,
        initial_content=body.content,
        version_note=body.version_note,
    )
    return create_doc(b)


@router.get("/{doc_id}")
def get_doc(doc_id: str):
    doc_id = _safe_id(doc_id)
    meta = _load_meta(doc_id)
    return {"ok": True, "meta": meta, "content": _read_current(doc_id)}


@router.get("/{doc_id}/versions")
def list_versions(doc_id: str):
    doc_id = _safe_id(doc_id)
    meta = _load_meta(doc_id)
    return {"ok": True, "versions": meta.get("versions") or [], "current_version": meta.get("current_version", 0)}


@router.get("/{doc_id}/compare")
def compare_versions(
    doc_id: str,
    from_version: int = Query(..., alias="from", ge=1),
    to_version: int = Query(..., alias="to", ge=1),
):
    doc_id = _safe_id(doc_id)
    p_from = _doc_dir(doc_id) / f"v{from_version}.md"
    p_to = _doc_dir(doc_id) / f"v{to_version}.md"
    if not p_from.exists() or not p_to.exists():
        raise HTTPException(404, "版本不存在")
    a = p_from.read_text(encoding="utf-8", errors="replace").splitlines()
    b = p_to.read_text(encoding="utf-8", errors="replace").splitlines()
    diff_lines = list(difflib.unified_diff(a, b, fromfile=f"v{from_version}", tofile=f"v{to_version}", lineterm=""))
    added = sum(1 for ln in diff_lines if ln.startswith("+") and not ln.startswith("+++"))
    removed = sum(1 for ln in diff_lines if ln.startswith("-") and not ln.startswith("---"))
    return {
        "ok": True,
        "from_version": from_version,
        "to_version": to_version,
        "added_lines": added,
        "removed_lines": removed,
        "diff_preview": "\n".join(diff_lines[:120]),
        "truncated": len(diff_lines) > 120,
    }


@router.get("/{doc_id}/versions/{version}")
def get_version(doc_id: str, version: int):
    doc_id = _safe_id(doc_id)
    if version < 1:
        raise HTTPException(400, "版本号无效")
    p = _doc_dir(doc_id) / f"v{version}.md"
    if not p.exists():
        raise HTTPException(404, "该版本不存在")
    return {"ok": True, "version": version, "content": p.read_text(encoding="utf-8", errors="replace")}


@router.patch("/{doc_id}")
def patch_meta(doc_id: str, body: DocMetaUpdate):
    from sop_manager.project_write_guard import project_file_write_scope

    with project_file_write_scope():
        doc_id = _safe_id(doc_id)
        meta = _load_meta(doc_id)
        if body.title is not None:
            meta["title"] = body.title.strip()
        if body.category is not None:
            meta["category"] = body.category.strip()
        if body.tags is not None:
            meta["tags"] = body.tags[:24]
        meta["updated_at"] = _utc_iso()
        _save_meta(doc_id, meta)
        _sync_index_entry(meta)
        return {"ok": True}


@router.post("/{doc_id}/versions")
def add_version(doc_id: str, body: VersionCreate):
    from sop_manager.project_write_guard import project_file_write_scope

    with project_file_write_scope():
        doc_id = _safe_id(doc_id)
        meta = _load_meta(doc_id)
        nv = int(meta.get("current_version", 0)) + 1
        ts = _utc_iso()
        content = body.content
        if len(content) > _CONTENT_MAX:
            raise HTTPException(400, "内容过长")
        ddir = _doc_dir(doc_id)
        (ddir / f"v{nv}.md").write_text(content, encoding="utf-8")
        (ddir / "current.md").write_text(content, encoding="utf-8")
        vers = list(meta.get("versions") or [])
        vers.append({"v": nv, "created_at": ts, "note": body.note.strip() or "保存"})
        meta["versions"] = vers
        meta["current_version"] = nv
        meta["updated_at"] = ts
        _save_meta(doc_id, meta)
        _sync_index_entry(meta)
        return {"ok": True, "version": nv}


@router.post("/{doc_id}/ai-improve")
def ai_improve(doc_id: str, body: AiImproveBody):
    doc_id = _safe_id(doc_id)
    meta = _load_meta(doc_id)
    mode = body.mode if body.mode in ("expand", "review", "diagram", "free") else "expand"
    cur = _read_current(doc_id)
    improved = _llm_improve(cur, body.instruction.strip(), mode)
    if not improved.strip():
        raise HTTPException(502, "模型未返回有效内容")
    note = f"AI-{mode}"
    return add_version(doc_id, VersionCreate(content=improved, note=note))


@router.post("/{doc_id}/restore")
def restore_version(doc_id: str, body: RestoreBody):
    """将历史版本内容拷贝为新版本（不丢失后续历史）。"""
    doc_id = _safe_id(doc_id)
    meta = _load_meta(doc_id)
    p = _doc_dir(doc_id) / f"v{body.version}.md"
    if not p.exists():
        raise HTTPException(404, "该版本不存在")
    content = p.read_text(encoding="utf-8", errors="replace")
    return add_version(doc_id, VersionCreate(content=content, note=f"自 v{body.version} 恢复"))


@router.delete("/{doc_id}")
def delete_doc(doc_id: str):
    from sop_manager.project_write_guard import project_file_write_scope

    with project_file_write_scope():
        doc_id = _safe_id(doc_id)
        _load_meta(doc_id)  # 404 if missing
        shutil.rmtree(_doc_dir(doc_id), ignore_errors=True)
        idx = _load_index()
        idx["documents"] = [d for d in (idx.get("documents") or []) if d.get("id") != doc_id]
        _save_index(idx)
        return {"ok": True}
