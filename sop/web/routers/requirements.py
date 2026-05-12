from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, List
from .db import rows, table, now

router = APIRouter(prefix="/api/requirements", tags=["requirements"])

class ReqCreate(BaseModel):
    title: str; description: Optional[str] = ""; priority: str = "P1"
    acceptance_criteria: Optional[List[str]] = []; tags: Optional[List[str]] = []

class ReqUpdate(BaseModel):
    title: Optional[str] = None; description: Optional[str] = None
    status: Optional[str] = None; priority: Optional[str] = None
    story_points: Optional[int] = None; acceptance_criteria: Optional[List[str]] = None
    human_notes: Optional[str] = None

@router.get("")
def list_reqs(status: Optional[str] = None, priority: Optional[str] = None):
    r = rows("requirements")
    if status: r = [x for x in r if x.get("status") == status]
    if priority: r = [x for x in r if x.get("priority") == priority]
    return sorted(r, key=lambda x: (x.get("priority","P9"), x.get("created_at","")))

@router.post("")
def create_req(body: ReqCreate):
    import os
    t = table("requirements")
    if t is None: raise HTTPException(503, "LanceDB not available")
    row = {"id": f"REQ-{int(now().timestamp()*1000)}", "project_id": os.getenv("PROJECT_ID","default"),
           "title": body.title, "description": body.description, "status": "pending",
           "priority": body.priority, "sprint_id": "", "story_points": 0,
           "acceptance_criteria": body.acceptance_criteria, "tags": body.tags,
           "human_notes": "", "confidence": 0.0, "created_at": now(), "updated_at": now()}
    t.add([row]); return {"ok": True, "id": row["id"]}

@router.patch("/{req_id}/priority")
def update_priority(req_id: str, priority: str, human_notes: Optional[str] = None):
    t = table("requirements")
    if t is None: raise HTTPException(503, "LanceDB not available")
    t.update(where=f"id = '{req_id}'", values={"priority": priority, "human_notes": human_notes or "", "updated_at": now()})
    return {"ok": True}

@router.patch("/{req_id}")
def update_req(req_id: str, body: ReqUpdate):
    t = table("requirements")
    if t is None: raise HTTPException(503, "LanceDB not available")
    vals = {k: v for k, v in body.dict().items() if v is not None}
    vals["updated_at"] = now()
    t.update(where=f"id = '{req_id}'", values=vals); return {"ok": True}

@router.delete("/{req_id}")
def delete_req(req_id: str):
    t = table("requirements")
    if t is None: raise HTTPException(503, "LanceDB not available")
    t.delete(f"id = '{req_id}'"); return {"ok": True}
