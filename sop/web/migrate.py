"""数据迁移工具 — LanceDB → SQL + 反向迁移"""
from __future__ import annotations
import os, uuid
from datetime import datetime
from pathlib import Path
from sqlalchemy.orm import Session

from routers.sql_models import (
    get_session, create_all, Tenant, User, Project,
    Requirement, Task, Issue, Sprint
)
from routers.vector_store import get_vector_store


def migrate_lance_to_sql(tenant_id: str = "t-default", project_id: str = "proj-default"):
    """从 LanceDB 迁移数据到 SQL"""
    print(f"开始迁移 LanceDB → SQL (tenant={tenant_id}, project={project_id})")

    create_all()
    db = next(get_session())
    store = get_vector_store()

    # 确保租户和项目存在
    if not db.get(Tenant, tenant_id):
        db.add(Tenant(id=tenant_id, name="Default", slug="default"))
        db.commit()

    if not db.get(Project, project_id):
        db.add(Project(id=project_id, tenant_id=tenant_id, name="Default Project"))
        db.commit()

    # 迁移 requirements
    reqs = store.rows("requirements", limit=5000)
    for r in reqs:
        if db.query(Requirement).filter_by(id=r.get("id")).first():
            continue
        db.add(Requirement(
            id=r.get("id", f"REQ-{uuid.uuid4().hex[:8]}"),
            tenant_id=tenant_id,
            project_id=project_id,
            title=r.get("title", "")[:256],
            description=r.get("description", ""),
            status=r.get("status", "pending"),
            priority=r.get("priority", "P1"),
            sprint_id=r.get("sprint_id", ""),
            story_points=int(r.get("story_points", 0)),
            acceptance_criteria=r.get("acceptance_criteria", []),
            tags=r.get("tags", []),
            human_notes=r.get("human_notes", ""),
            confidence=float(r.get("confidence", 0.0)),
            created_at=_parse_dt(r.get("created_at")),
            updated_at=_parse_dt(r.get("updated_at")),
        ))
    db.commit()
    print(f"✓ 迁移 {len(reqs)} 条需求")

    # 迁移 tasks
    tasks = store.rows("tasks", limit=5000)
    for t in tasks:
        if db.query(Task).filter_by(id=t.get("id")).first():
            continue
        db.add(Task(
            id=t.get("id", f"T-{uuid.uuid4().hex[:8]}"),
            tenant_id=tenant_id,
            project_id=project_id,
            req_id=t.get("req_id", ""),
            sprint_id=t.get("sprint_id", ""),
            title=t.get("title", "")[:256],
            description=t.get("description", ""),
            status=t.get("status", "pending"),
            priority=t.get("priority", "P1"),
            estimate=t.get("estimate", "M"),
            assigned_to=t.get("assigned_to", ""),
            actual_hours=float(t.get("actual_hours", 0.0)),
            confidence=float(t.get("confidence", 0.0)),
            human_notes=t.get("human_notes", ""),
            created_at=_parse_dt(t.get("created_at")),
            updated_at=_parse_dt(t.get("updated_at")),
        ))
    db.commit()
    print(f"✓ 迁移 {len(tasks)} 条任务")

    # 迁移 issues
    issues = store.rows("issues", limit=5000)
    for i in issues:
        if db.query(Issue).filter_by(id=i.get("id")).first():
            continue
        db.add(Issue(
            id=i.get("id", f"ISSUE-{uuid.uuid4().hex[:8]}"),
            tenant_id=tenant_id,
            project_id=project_id,
            sprint_id=i.get("sprint_id", ""),
            task_id=i.get("task_id", ""),
            title=i.get("title", "")[:256],
            description=i.get("description", ""),
            type=i.get("type", "bug"),
            severity=i.get("severity", "P2"),
            status=i.get("status", "open"),
            reported_by=i.get("reported_by", ""),
            resolved_by=i.get("resolved_by", ""),
            resolution=i.get("resolution", ""),
            created_at=_parse_dt(i.get("created_at")),
            resolved_at=_parse_dt(i.get("resolved_at")),
        ))
    db.commit()
    print(f"✓ 迁移 {len(issues)} 条问题")

    # 迁移 sprints
    sprints = store.rows("sprints", limit=500)
    for s in sprints:
        if db.query(Sprint).filter_by(id=s.get("id")).first():
            continue
        db.add(Sprint(
            id=s.get("id", f"SPRINT-{uuid.uuid4().hex[:8]}"),
            tenant_id=tenant_id,
            project_id=project_id,
            goal=s.get("goal", ""),
            status=s.get("status", "active"),
            planned_points=int(s.get("planned_points", 0)),
            velocity=float(s.get("velocity", 0.0)),
            completion_rate=float(s.get("completion_rate", 0.0)),
            retrospective=s.get("retrospective", ""),
            started_at=_parse_dt(s.get("started_at")),
            ends_at=_parse_dt(s.get("ends_at")),
        ))
    db.commit()
    print(f"✓ 迁移 {len(sprints)} 个 Sprint")

    db.close()
    print("✅ 迁移完成")


def _parse_dt(val) -> datetime:
    if isinstance(val, datetime):
        return val
    if isinstance(val, str):
        try:
            return datetime.fromisoformat(val.replace("Z", "+00:00"))
        except Exception:
            pass
    return datetime.utcnow()


if __name__ == "__main__":
    import sys
    tenant_id = sys.argv[1] if len(sys.argv) > 1 else "t-default"
    project_id = sys.argv[2] if len(sys.argv) > 2 else "proj-default"
    migrate_lance_to_sql(tenant_id, project_id)
