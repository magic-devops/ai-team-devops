from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query, Body
from pydantic import BaseModel, Field

from sop_manager.path_config import resolved_ai_memory_root, resolved_project_id, resolved_tenant_id
from .db_sql_compat import rows, table, now
from .webhook import notify_webhook

router = APIRouter(prefix="/api/v1/tasks", tags=["tasks"])

_PRIOS = ("P0", "P1", "P2", "P3")


def _task_ui_path():
    return resolved_ai_memory_root() / "tasks_plan_ui_state.json"


def _safe_task_id(tid: str) -> str:
    tid = (tid or "").strip()
    if not re.match(r"^T-[a-zA-Z0-9._-]{2,80}$", tid):
        raise HTTPException(400, "非法任务 ID")
    return tid


def _ui_default() -> Dict[str, Any]:
    return {"version": 1, "columns": {p: [] for p in _PRIOS}, "fields": {}}


def _ui_load() -> Dict[str, Any]:
    p = _task_ui_path()
    if not p.exists():
        return _ui_default()
    try:
        d = json.loads(p.read_text(encoding="utf-8"))
        if not isinstance(d, dict):
            return _ui_default()
        d.setdefault("columns", {p: [] for p in _PRIOS})
        d.setdefault("fields", {})
        for p in _PRIOS:
            d["columns"].setdefault(p, [])
        return d
    except Exception:
        return _ui_default()


def _ui_save(d: Dict[str, Any]) -> None:
    p = _task_ui_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


def _ui_rebuild_columns(rows_all: List[Dict[str, Any]], st: Dict[str, Any]) -> None:
    by_p: Dict[str, List[str]] = {p: [] for p in _PRIOS}

    def _ts(r: Dict[str, Any]) -> str:
        return str(r.get("created_at") or "")

    for r in rows_all:
        tid = r.get("id")
        if not tid:
            continue
        pr = (r.get("priority") or "P3").upper()
        if pr not in _PRIOS:
            pr = "P3"
        by_p[pr].append(tid)
    for p in _PRIOS:
        by_p[p].sort(key=lambda i: _ts(next((x for x in rows_all if x.get("id") == i), {})))
    st["columns"] = by_p


def _ui_remove_from_columns(st: Dict[str, Any], task_id: str) -> None:
    for p in _PRIOS:
        st["columns"][p] = [x for x in st["columns"].get(p, []) if x != task_id]


def _ui_delete_id(st: Dict[str, Any], task_id: str) -> None:
    _ui_remove_from_columns(st, task_id)
    st.get("fields", {}).pop(task_id, None)


def _ui_append_to_column(st: Dict[str, Any], task_id: str, priority: str) -> None:
    pr = (priority or "P3").upper()
    if pr not in _PRIOS:
        pr = "P3"
    _ui_remove_from_columns(st, task_id)
    st.setdefault("columns", {p: [] for p in _PRIOS})
    st["columns"].setdefault(pr, []).append(task_id)


def _ui_merge_row(r: Dict[str, Any], st: Dict[str, Any]) -> Dict[str, Any]:
    out = dict(r)
    fd = (st.get("fields") or {}).get(r.get("id")) or {}
    out["dev_tool"] = str(fd.get("dev_tool") or "")
    for k in ("artifact_url", "artifact_path", "debug_notes", "branch"):
        if k in fd and fd.get(k) is not None:
            out[k] = str(fd.get(k) or "")
    return out


def _ui_ordered_list(rows_all: List[Dict[str, Any]], st: Dict[str, Any]) -> List[Dict[str, Any]]:
    row_by_id = {r["id"]: r for r in rows_all if r.get("id")}
    if not any(st.get("columns", {}).get(p) for p in _PRIOS) and rows_all:
        _ui_rebuild_columns(rows_all, st)
        _ui_save(st)
    out: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for p in _PRIOS:
        for tid in st.get("columns", {}).get(p, []):
            if tid in row_by_id and tid not in seen:
                rr = dict(row_by_id[tid])
                rr["priority"] = p
                out.append(_ui_merge_row(rr, st))
                seen.add(tid)
    for r in sorted(rows_all, key=lambda x: str(x.get("created_at") or "")):
        tid = r.get("id")
        if tid and tid not in seen:
            out.append(_ui_merge_row(r, st))
            seen.add(tid)
    return out


class TaskCreate(BaseModel):
    title: str
    description: Optional[str] = ""
    priority: str = "P1"
    estimate: str = "M"
    assigned_to: Optional[str] = "Coder"
    req_id: Optional[str] = ""
    sprint_id: Optional[str] = ""
    dev_tool: Optional[str] = ""
    artifact_url: Optional[str] = ""
    artifact_path: Optional[str] = ""
    debug_notes: Optional[str] = ""
    branch: Optional[str] = ""


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    priority: Optional[str] = None
    estimate: Optional[str] = None
    assigned_to: Optional[str] = None
    actual_hours: Optional[float] = None
    confidence: Optional[float] = None
    sprint_id: Optional[str] = None
    human_notes: Optional[str] = None
    req_id: Optional[str] = None
    dev_tool: Optional[str] = None
    artifact_url: Optional[str] = None
    artifact_path: Optional[str] = None
    debug_notes: Optional[str] = None
    branch: Optional[str] = None


class ReorderTasksBody(BaseModel):
    groups: Dict[str, List[str]] = Field(default_factory=dict)


@router.get("")
def list_tasks(status: Optional[str] = None, sprint_id: Optional[str] = None):
    raw = rows("tasks", 500)
    if sprint_id:
        raw = [x for x in raw if x.get("sprint_id") == sprint_id]
    if status:
        raw = [x for x in raw if x.get("status") == status]
    if status or sprint_id:
        return sorted(raw, key=lambda x: (x.get("priority", "P9"), str(x.get("created_at") or "")))
    st = _ui_load()
    return _ui_ordered_list(raw, st)


@router.post("")
def create_task(body: TaskCreate):
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    tid = f"T-{int(now().timestamp() * 1000)}"
    row = {
        "id": tid,
        "project_id": resolved_project_id(),
        "req_id": body.req_id or "",
        "sprint_id": body.sprint_id or "",
        "title": body.title,
        "description": body.description or "",
        "status": "pending",
        "priority": body.priority,
        "estimate": body.estimate,
        "assigned_to": body.assigned_to or "Coder",
        "actual_hours": 0.0,
        "confidence": 0.0,
        "created_at": now(),
        "updated_at": now(),
    }
    t.add([row])
    st = _ui_load()
    _ui_append_to_column(st, tid, body.priority)
    fld: Dict[str, Any] = {}
    if (body.dev_tool or "").strip():
        fld["dev_tool"] = (body.dev_tool or "").strip()
    if (body.artifact_url or "").strip():
        fld["artifact_url"] = (body.artifact_url or "").strip()[:800]
    if (body.artifact_path or "").strip():
        fld["artifact_path"] = (body.artifact_path or "").strip()[:400]
    if (body.debug_notes or "").strip():
        fld["debug_notes"] = (body.debug_notes or "").strip()[:2000]
    if (body.branch or "").strip():
        fld["branch"] = (body.branch or "").strip()[:120]
    if fld:
        st.setdefault("fields", {})[tid] = fld
    _ui_save(st)
    notify_webhook(
        "task.created",
        {"task_id": tid, "title": body.title, "priority": body.priority, "status": "pending"},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True, "id": tid}


@router.post("/reorder-board")
def reorder_tasks_board(body: ReorderTasksBody):
    raw = rows("tasks", 500)
    all_ids = {r["id"] for r in raw if r.get("id")}
    groups: Dict[str, List[str]] = {p: [] for p in _PRIOS}
    combined: List[str] = []
    raw_in = body.groups or {}
    for p in _PRIOS:
        arr = raw_in.get(p)
        if not isinstance(arr, list):
            arr = raw_in.get(p.lower()) or []
        if not isinstance(arr, list):
            arr = []
        for tid in arr:
            tid = _safe_task_id(str(tid).strip())
            if tid not in all_ids:
                raise HTTPException(400, f"未知任务 ID: {tid}")
            groups[p].append(tid)
            combined.append(tid)
    if len(combined) != len(set(combined)):
        raise HTTPException(400, "任务 ID 重复")
    if set(combined) != all_ids:
        raise HTTPException(400, "各列须覆盖当前全部任务 ID 且无多余项")
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    ts = now()
    for p in _PRIOS:
        for tid in groups[p]:
            t.update(where=f"id = '{tid}'", values={"priority": p, "updated_at": ts})
    st = _ui_load()
    st["columns"] = groups
    _ui_save(st)
    return {"ok": True}


@router.patch("/{task_id}/unblock")
def unblock_task(task_id: str, human_notes: str = Body("", embed=True)):
    _safe_task_id(task_id)
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    t.update(
        where=f"id = '{task_id}'",
        values={"status": "pending", "human_notes": human_notes or "", "updated_at": now()},
    )
    notify_webhook(
        "task.status_changed",
        {"task_id": task_id, "status": "pending", "via": "unblock"},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True}


@router.patch("/{task_id}")
def update_task(task_id: str, body: TaskUpdate):
    _safe_task_id(task_id)
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    try:
        raw = body.model_dump(exclude_unset=True)
    except AttributeError:
        raw = body.dict(exclude_unset=True)
    ui_keys = ("dev_tool", "artifact_url", "artifact_path", "debug_notes", "branch")
    ui_patch: Dict[str, Any] = {}
    for uk in ui_keys:
        if uk in raw:
            ui_patch[uk] = raw.pop(uk)
    vals = {k: v for k, v in raw.items() if v is not None}
    if not vals and not ui_patch:
        return {"ok": True}
    if vals:
        vals["updated_at"] = now()
        t.update(where=f"id = '{task_id}'", values=vals)
    st = _ui_load()
    if "priority" in vals:
        _ui_append_to_column(st, task_id, str(vals["priority"]))
    if ui_patch:
        fld = st.setdefault("fields", {}).setdefault(task_id, {})
        for k, v in ui_patch.items():
            if v is None or (isinstance(v, str) and not str(v).strip()):
                fld.pop(k, None)
                continue
            s = str(v).strip()
            if k == "artifact_url":
                fld[k] = s[:800]
            elif k == "artifact_path":
                fld[k] = s[:400]
            elif k == "debug_notes":
                fld[k] = s[:2000]
            elif k == "branch":
                fld[k] = s[:120]
            elif k == "dev_tool":
                fld[k] = s[:80]
    if "priority" in vals or ui_patch:
        _ui_save(st)
    if vals or ui_patch:
        notify_webhook(
            "task.updated",
            {"task_id": task_id, "fields": list(vals.keys()) if vals else []},
            tenant_id=resolved_tenant_id(),
            project_id=resolved_project_id(),
        )
    if "status" in vals:
        notify_webhook(
            "task.status_changed",
            {"task_id": task_id, "status": vals["status"]},
            tenant_id=resolved_tenant_id(),
            project_id=resolved_project_id(),
        )
    return {"ok": True}


@router.delete("/{task_id}")
def delete_task(task_id: str):
    _safe_task_id(task_id)
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    t.delete(f"id = '{task_id}'")
    st = _ui_load()
    _ui_delete_id(st, task_id)
    _ui_save(st)
    notify_webhook(
        "task.deleted",
        {"task_id": task_id},
        tenant_id=resolved_tenant_id(),
        project_id=resolved_project_id(),
    )
    return {"ok": True}
