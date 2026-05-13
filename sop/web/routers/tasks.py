from __future__ import annotations

import json
import os
import re
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from .db import PROJECT_PATH, rows, table, now

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

_PRIOS = ("P0", "P1", "P2", "P3")
_TASK_UI_PATH = PROJECT_PATH / ".ai-memory" / "tasks_plan_ui_state.json"


def _safe_task_id(tid: str) -> str:
    tid = (tid or "").strip()
    if not re.match(r"^T-[a-zA-Z0-9._-]{2,80}$", tid):
        raise HTTPException(400, "非法任务 ID")
    return tid


def _ui_default() -> Dict[str, Any]:
    return {"version": 1, "columns": {p: [] for p in _PRIOS}, "fields": {}}


def _ui_load() -> Dict[str, Any]:
    if not _TASK_UI_PATH.exists():
        return _ui_default()
    try:
        d = json.loads(_TASK_UI_PATH.read_text(encoding="utf-8"))
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
    _TASK_UI_PATH.parent.mkdir(parents=True, exist_ok=True)
    _TASK_UI_PATH.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")


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
        raise HTTPException(503, "LanceDB not available")
    tid = f"T-{int(now().timestamp() * 1000)}"
    row = {
        "id": tid,
        "project_id": os.getenv("PROJECT_ID", "default"),
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
    if (body.dev_tool or "").strip():
        st.setdefault("fields", {})[tid] = {"dev_tool": (body.dev_tool or "").strip()}
    _ui_save(st)
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
        raise HTTPException(503, "LanceDB not available")
    ts = now()
    for p in _PRIOS:
        for tid in groups[p]:
            t.update(where=f"id = '{tid}'", values={"priority": p, "updated_at": ts})
    st = _ui_load()
    st["columns"] = groups
    _ui_save(st)
    return {"ok": True}


@router.patch("/{task_id}/unblock")
def unblock_task(task_id: str, human_notes: str = ""):
    _safe_task_id(task_id)
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    t.update(
        where=f"id = '{task_id}'",
        values={"status": "pending", "human_notes": human_notes, "updated_at": now()},
    )
    return {"ok": True}


@router.patch("/{task_id}")
def update_task(task_id: str, body: TaskUpdate):
    _safe_task_id(task_id)
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    try:
        raw = body.model_dump(exclude_unset=True)
    except AttributeError:
        raw = body.dict(exclude_unset=True)
    ui_tool = raw.pop("dev_tool", None) if "dev_tool" in raw else None
    vals = {k: v for k, v in raw.items() if v is not None}
    if not vals and ui_tool is None:
        return {"ok": True}
    if vals:
        vals["updated_at"] = now()
        t.update(where=f"id = '{task_id}'", values=vals)
    st = _ui_load()
    if "priority" in vals:
        _ui_append_to_column(st, task_id, str(vals["priority"]))
    if ui_tool is not None:
        fld = st.setdefault("fields", {}).setdefault(task_id, {})
        fld["dev_tool"] = ui_tool or ""
    if "priority" in vals or ui_tool is not None:
        _ui_save(st)
    return {"ok": True}


@router.delete("/{task_id}")
def delete_task(task_id: str):
    _safe_task_id(task_id)
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "LanceDB not available")
    t.delete(f"id = '{task_id}'")
    st = _ui_load()
    _ui_delete_id(st, task_id)
    _ui_save(st)
    return {"ok": True}
