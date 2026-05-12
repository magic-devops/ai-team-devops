from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from .db import rows, table, now
import os

router = APIRouter(prefix="/api/issues", tags=["issues"])

class IssueCreate(BaseModel):
    title: str; description: Optional[str] = ""; type: str = "bug"
    severity: str = "P2"; task_id: Optional[str] = ""

@router.get("")
def list_issues(status: Optional[str] = None, severity: Optional[str] = None):
    r = rows("issues")
    if status: r = [x for x in r if x.get("status") == status]
    if severity: r = [x for x in r if x.get("severity") == severity]
    return sorted(r, key=lambda i: (i.get("severity","P9"), i.get("created_at","")))

@router.post("")
def create_issue(body: IssueCreate):
    t = table("issues")
    if t is None: raise HTTPException(503, "LanceDB not available")
    row = {"id": f"ISSUE-{int(now().timestamp()*1000)}", "project_id": os.getenv("PROJECT_ID","default"),
           "sprint_id": "", "task_id": body.task_id or "", "title": body.title,
           "description": body.description, "type": body.type, "severity": body.severity,
           "status": "open", "reported_by": "human", "resolved_by": "", "resolution": "",
           "created_at": now(), "resolved_at": None}
    t.add([row]); return {"ok": True, "id": row["id"]}

@router.patch("/{issue_id}/resolve")
def resolve_issue(issue_id: str, resolution: str = ""):
    t = table("issues")
    if t is None: raise HTTPException(503, "LanceDB not available")
    t.update(where=f"id = '{issue_id}'", values={"status": "resolved", "resolution": resolution,
              "resolved_by": "human", "resolved_at": now()})
    return {"ok": True}
