from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional
from .db import rows, table, now
import os

router = APIRouter(prefix="/api/tasks", tags=["tasks"])

class TaskCreate(BaseModel):
    title: str; description: Optional[str] = ""; priority: str = "P1"
    estimate: str = "M"; assigned_to: Optional[str] = "Coder"
    req_id: Optional[str] = ""; sprint_id: Optional[str] = ""

class TaskUpdate(BaseModel):
    title: Optional[str] = None; description: Optional[str] = None
    status: Optional[str] = None; priority: Optional[str] = None
    estimate: Optional[str] = None; assigned_to: Optional[str] = None
    actual_hours: Optional[float] = None; confidence: Optional[float] = None
    sprint_id: Optional[str] = None; human_notes: Optional[str] = None

@router.get("")
def list_tasks(status: Optional[str] = None, sprint_id: Optional[str] = None):
    r = rows("tasks")
    if status: r = [x for x in r if x.get("status") == status]
    if sprint_id: r = [x for x in r if x.get("sprint_id") == sprint_id]
    return r

@router.post("")
def create_task(body: TaskCreate):
    t = table("tasks")
    if t is None: raise HTTPException(503, "LanceDB not available")
    row = {"id": f"T-{int(now().timestamp()*1000)}", "project_id": os.getenv("PROJECT_ID","default"),
           "req_id": body.req_id or "", "sprint_id": body.sprint_id or "",
           "title": body.title, "description": body.description, "status": "pending",
           "priority": body.priority, "estimate": body.estimate, "assigned_to": body.assigned_to,
           "actual_hours": 0.0, "confidence": 0.0, "created_at": now(), "updated_at": now()}
    t.add([row]); return {"ok": True, "id": row["id"]}

@router.patch("/{task_id}/unblock")
def unblock_task(task_id: str, human_notes: str = ""):
    t = table("tasks")
    if t is None: raise HTTPException(503, "LanceDB not available")
    t.update(where=f"id = '{task_id}'", values={"status": "pending", "human_notes": human_notes, "updated_at": now()})
    return {"ok": True}

@router.patch("/{task_id}")
def update_task(task_id: str, body: TaskUpdate):
    t = table("tasks")
    if t is None: raise HTTPException(503, "LanceDB not available")
    vals = {k: v for k, v in body.dict().items() if v is not None}
    vals["updated_at"] = now()
    t.update(where=f"id = '{task_id}'", values=vals); return {"ok": True}

@router.delete("/{task_id}")
def delete_task(task_id: str):
    t = table("tasks")
    if t is None: raise HTTPException(503, "LanceDB not available")
    t.delete(f"id = '{task_id}'"); return {"ok": True}
