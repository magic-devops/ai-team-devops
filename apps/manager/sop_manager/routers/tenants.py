"""租户 & 项目管理路由 (SaaS 多租户 + 单项目模式)"""
from __future__ import annotations
import os, uuid
from datetime import datetime
from typing import Optional, List

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .sql_models import get_session, Tenant, Business, Project, ProjectMember, User, Requirement, Task
from .auth_sql import current_user, require_role, ADMIN_MODE, assert_project_member_role, check_project_access
from .webhook import notify_webhook

router = APIRouter(prefix="/api/v1/tenants", tags=["tenants"])
proj_router = APIRouter(prefix="/api/v1/projects", tags=["projects"])


# ── 租户管理 (super_admin only, saas 模式) ────────────────────────
class TenantCreate(BaseModel):
    name: str
    slug: str
    plan: str = "free"

@router.get("")
def list_tenants(user: User = Depends(require_role("super_admin")),
                 db: Session = Depends(get_session)):
    return [{"id": t.id, "name": t.name, "slug": t.slug, "plan": t.plan,
             "status": t.status, "created_at": t.created_at.isoformat()}
            for t in db.query(Tenant).all()]

@router.post("")
def create_tenant(body: TenantCreate, user: User = Depends(require_role("super_admin")),
                  db: Session = Depends(get_session)):
    if db.query(Tenant).filter_by(slug=body.slug).first():
        raise HTTPException(400, "slug 已存在")
    t = Tenant(id=f"t-{uuid.uuid4().hex[:12]}", name=body.name,
               slug=body.slug, plan=body.plan)
    db.add(t); db.commit()
    return {"ok": True, "id": t.id}

@router.patch("/{tenant_id}")
def update_tenant(tenant_id: str, body: dict,
                  user: User = Depends(require_role("super_admin")),
                  db: Session = Depends(get_session)):
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(404, "租户不存在")
    for k in ("name", "plan", "status", "config"):
        if k in body:
            setattr(t, k, body[k])
    t.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True}

@router.delete("/{tenant_id}")
def delete_tenant(tenant_id: str, user: User = Depends(require_role("super_admin")),
                  db: Session = Depends(get_session)):
    t = db.get(Tenant, tenant_id)
    if not t:
        raise HTTPException(404, "租户不存在")
    db.delete(t); db.commit()
    return {"ok": True}


# ── 业务线管理 ────────────────────────────────────────────────────
biz_router = APIRouter(prefix="/api/v1/businesses", tags=["businesses"])

class BizCreate(BaseModel):
    name: str
    description: str = ""

@biz_router.get("")
def list_businesses(user: User = Depends(require_role("tenant_admin")),
                    db: Session = Depends(get_session)):
    return [{"id": b.id, "name": b.name, "description": b.description,
             "project_count": len(b.projects)}
            for b in db.query(Business).filter_by(tenant_id=user.tenant_id).all()]

@biz_router.post("")
def create_business(body: BizCreate, user: User = Depends(require_role("tenant_admin")),
                    db: Session = Depends(get_session)):
    b = Business(id=f"biz-{uuid.uuid4().hex[:12]}", tenant_id=user.tenant_id,
                 name=body.name, description=body.description)
    db.add(b); db.commit()
    return {"ok": True, "id": b.id}

@biz_router.delete("/{biz_id}")
def delete_business(biz_id: str, user: User = Depends(require_role("tenant_admin")),
                    db: Session = Depends(get_session)):
    b = db.get(Business, biz_id)
    if not b or b.tenant_id != user.tenant_id:
        raise HTTPException(404, "业务线不存在")
    db.delete(b); db.commit()
    return {"ok": True}


# ── 项目管理 ──────────────────────────────────────────────────────
class ProjectCreate(BaseModel):
    name: str
    description: str = ""
    business_id: Optional[str] = None
    project_path: str = ""
    vector_db: str = "lance"
    vector_db_config: dict = {}

@proj_router.get("")
def list_projects(user: User = Depends(current_user), db: Session = Depends(get_session)):
    import os
    from sop_manager.project_provision import ensure_project_for_user, local_project_id_from_memory

    if (os.getenv("ADMIN_MODE", "single") or "single").strip().lower() == "single":
        pid = local_project_id_from_memory()
        if pid:
            ensure_project_for_user(db, pid, user)
    q = db.query(Project).filter_by(tenant_id=user.tenant_id)
    if user.role not in ("super_admin", "tenant_admin"):
        member_pids = [m.project_id for m in user.memberships]
        q = q.filter(Project.id.in_(member_pids))
    return [{"id": p.id, "name": p.name, "description": p.description,
             "business_id": p.business_id, "vector_db": p.vector_db,
             "status": p.status, "created_at": p.created_at.isoformat()}
            for p in q.all()]

@proj_router.post("")
def create_project(body: ProjectCreate, user: User = Depends(require_role("project_admin")),
                   db: Session = Depends(get_session)):
    p = Project(
        id=f"proj-{uuid.uuid4().hex[:12]}", tenant_id=user.tenant_id,
        business_id=body.business_id, name=body.name, description=body.description,
        project_path=body.project_path, vector_db=body.vector_db,
        vector_db_config=body.vector_db_config,
    )
    db.add(p)
    # 创建者自动成为 project_admin
    db.add(ProjectMember(project_id=p.id, user_id=user.id, role="project_admin"))
    db.commit()
    notify_webhook(
        "project.created",
        {"project_id": p.id, "name": p.name, "vector_db": p.vector_db},
        tenant_id=user.tenant_id,
        project_id=p.id,
    )
    return {"ok": True, "id": p.id}

@proj_router.patch("/{project_id}")
def update_project(project_id: str, body: dict,
                   user: User = Depends(current_user), db: Session = Depends(get_session)):
    p = db.get(Project, project_id)
    if not p or p.tenant_id != user.tenant_id:
        raise HTTPException(404, "项目不存在")
    for k in ("name", "description", "project_path", "vector_db", "vector_db_config", "status"):
        if k in body:
            setattr(p, k, body[k])
    p.updated_at = datetime.utcnow()
    db.commit()
    notify_webhook(
        "project.updated",
        {"project_id": project_id, "fields": list(body.keys())},
        tenant_id=user.tenant_id,
        project_id=project_id,
    )
    return {"ok": True}

@proj_router.delete("/{project_id}")
def delete_project(project_id: str, user: User = Depends(require_role("tenant_admin")),
                   db: Session = Depends(get_session)):
    p = db.get(Project, project_id)
    if not p or p.tenant_id != user.tenant_id:
        raise HTTPException(404, "项目不存在")
    db.delete(p); db.commit()
    return {"ok": True}

# 项目成员管理
@proj_router.get("/{project_id}/members")
def list_members(project_id: str, user: User = Depends(current_user),
                 db: Session = Depends(get_session)):
    check_project_access(user, project_id, db, min_role="viewer")
    p = db.get(Project, project_id)
    if not p or p.tenant_id != user.tenant_id:
        raise HTTPException(404, "项目不存在")
    members = db.query(ProjectMember).filter_by(project_id=project_id).all()
    return [{"user_id": m.user_id, "username": m.user.username, "email": m.user.email, "role": m.role}
            for m in members]

class MemberAdd(BaseModel):
    user_id: str
    role: str = "developer"

@proj_router.post("/{project_id}/members")
def add_member(project_id: str, body: MemberAdd,
               user: User = Depends(require_role("project_admin")),
               db: Session = Depends(get_session)):
    p = db.get(Project, project_id)
    if not p or p.tenant_id != user.tenant_id:
        raise HTTPException(404, "项目不存在")
    target = db.get(User, body.user_id)
    if not target or target.tenant_id != user.tenant_id or target.status != "active":
        raise HTTPException(404, "用户不存在或不可用")
    if db.query(ProjectMember).filter_by(project_id=project_id, user_id=body.user_id).first():
        raise HTTPException(400, "成员已存在")
    mrole = assert_project_member_role(body.role)
    db.add(ProjectMember(project_id=project_id, user_id=body.user_id, role=mrole))
    db.commit()
    notify_webhook(
        "project.member_added",
        {"project_id": project_id, "user_id": body.user_id, "role": mrole},
        tenant_id=user.tenant_id,
        project_id=project_id,
    )
    return {"ok": True}

@proj_router.delete("/{project_id}/members/{user_id}")
def remove_member(project_id: str, user_id: str,
                  user: User = Depends(require_role("project_admin")),
                  db: Session = Depends(get_session)):
    p = db.get(Project, project_id)
    if not p or p.tenant_id != user.tenant_id:
        raise HTTPException(404, "项目不存在")
    m = db.query(ProjectMember).filter_by(project_id=project_id, user_id=user_id).first()
    if not m:
        raise HTTPException(404, "成员不存在")
    db.delete(m); db.commit()
    notify_webhook(
        "project.member_removed",
        {"project_id": project_id, "user_id": user_id},
        tenant_id=user.tenant_id,
        project_id=project_id,
    )
    return {"ok": True}


@proj_router.get("/{project_id}/onboarding")
def project_onboarding(project_id: str, request: Request,
                       user: User = Depends(current_user),
                       db: Session = Depends(get_session)):
    """返回无密钥项目接入包，供 Web/CLI/IDE/Agent 初始化使用。"""
    check_project_access(user, project_id, db, min_role="viewer")
    p = db.get(Project, project_id)
    if not p or p.tenant_id != user.tenant_id:
        raise HTTPException(404, "项目不存在")
    tenant = db.get(Tenant, p.tenant_id)
    business = db.get(Business, p.business_id) if p.business_id else None
    manager_url = str(request.base_url).rstrip("/")
    tenant_code = tenant.slug if tenant and tenant.slug else p.tenant_id
    business_code = business.id if business else ""
    project_code = p.id
    project_name = p.name or p.id
    env = {
        "MANAGER_URL": manager_url,
        "PROJECT_ID": p.id,
        "PROJECT_CODE": project_code,
        "TENANT_ID": p.tenant_id,
        "TENANT_CODE": tenant_code,
        "BUSINESS_CODE": business_code,
        "SOP_PROJECT_MANIFEST": ".sop-runtime/project_manifest.json",
        "SOP_AGENT_CONTEXT": ".sop-runtime/agent_context.json",
    }
    agent_toml = f"""[manager]
url = "{manager_url}"
project_id = "{p.id}"
project_code = "{project_code}"
tenant_id = "{p.tenant_id}"
tenant_code = "{tenant_code}"
business_code = "{business_code}"

[auth]
method = "apikey"
api_key_ref = "keyring://sop/manager"
verify_ssl = true

[transport]
ws = true
grpc = false
mcp_servers = ["lancedb", "knowledge", "tasks", "files"]
a2a_port = 7741

[reliability]
outbox_path = ".sop-runtime/outbox.sqlite"
batch_size = 50
max_retries = 6
dlq_path = ".sop-runtime/dlq/"
timeout_seconds = 30
"""
    commands = {
        "new_project": f"sop register {project_name} --manager {manager_url} --username <manager-user>",
        "existing_project": f"sop init {project_name} --manager {manager_url} && sop login --pair",
        "prepare_context": "sop context prepare --flush",
        "doctor": "sop doctor && sop status --json",
        "sync": "sop sync pull --direct --materialize && sop sync flush",
        "watch": "sop sync watch --flush",
        "copilot": "sop copilot ask \"总结当前任务和下一步\"",
    }
    agent_context = {
        "schema": "sop.agent-context.v1",
        "project": {
            "id": p.id,
            "code": project_code,
            "tenant_code": tenant_code,
            "business_code": business_code,
        },
        "files": {
            "manifest": ".sop-runtime/project_manifest.json",
            "env": ".sop-runtime/sop.env",
            "work_snapshot": ".sop-runtime/work_snapshot.json",
            "db_connections": ".sop-runtime/db_connections.json",
        },
        "commands": {
            "refresh": "sop context prepare --flush",
            "status": "sop status --json",
            "next_work": "sop work next --local --json",
            "memory_search": "sop memory search",
            "kb_search": "sop kb search --local --json",
            "copilot_ask": "sop copilot ask",
        },
    }
    tool_profiles = [
        {
            "id": "codex",
            "name": "Codex CLI / Codex App",
            "target": "AGENTS.md",
            "content": (
                "启动时读取 .sop-runtime/project_manifest.json 与 .sop-runtime/agent_context.json；"
                "执行开发前先运行 sop context prepare --flush；任务、需求、记忆、知识库、规则和事件统一通过 sop CLI 接入。"
            ),
            "commands": ["sop context prepare --flush", "sop status --json", "sop copilot ask \"总结当前工程状态\""],
        },
        {
            "id": "claude",
            "name": "Claude Code",
            "target": "CLAUDE.md",
            "content": (
                "Use SOP context from .sop-runtime/agent_context.json. Before coding, run `sop context prepare --flush` "
                "and inspect `sop work next --local --json`. Persist durable decisions with `sop memory add`."
            ),
            "commands": ["sop context prepare --flush", "sop work next --local --json"],
        },
        {
            "id": "cursor",
            "name": "Cursor",
            "target": ".cursorrules",
            "content": (
                "Load SOP project manifest from .sop-runtime/project_manifest.json. Respect tenant_code/business_code/project_code "
                "headers and use sop CLI for requirements, tasks, rules, memory, knowledge and sync."
            ),
            "commands": ["sop context manifest --write", "sop context prepare --flush"],
        },
        {
            "id": "qoder",
            "name": "Qoder / Trae / generic Agent",
            "target": ".qoder/context.md",
            "content": (
                f"Manager: {manager_url}\\nProject: {p.id}\\nTenant: {tenant_code}\\n"
                "Read .sop-runtime/agent_context.json for commands and local cache paths."
            ),
            "commands": ["sop context env --out .sop-runtime/sop.env", "sop event subscribe --json"],
        },
    ]
    return {
        "ok": True,
        "schema": "sop.project-onboarding.v1",
        "project": {
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "status": p.status,
            "project_path": p.project_path,
            "vector_db": p.vector_db,
        },
        "isolation": {
            "tenant_id": p.tenant_id,
            "tenant_code": tenant_code,
            "business_id": p.business_id or "",
            "business_code": business_code,
            "project_id": p.id,
            "project_code": project_code,
        },
        "manager": {
            "url": manager_url,
            "api_base": manager_url + "/api/v1",
            "ws_events": manager_url.replace("http://", "ws://").replace("https://", "wss://") + "/ws/events",
            "auth": "bearer-or-api-key",
        },
        "commands": commands,
        "env": env,
        "agent_context": agent_context,
        "tool_profiles": tool_profiles,
        "files": {
            "agent_toml": ".sop-runtime/agent.toml",
            "env": ".sop-runtime/sop.env",
            "manifest": ".sop-runtime/project_manifest.json",
            "agent_context": ".sop-runtime/agent_context.json",
            "work_snapshot": ".sop-runtime/work_snapshot.json",
            "db_connections": ".sop-runtime/db_connections.json",
        },
        "agent_toml": agent_toml,
        "capabilities": [
            "requirements",
            "tasks",
            "issues",
            "sprints",
            "memory",
            "knowledge",
            "rules",
            "events-wss",
            "usage-quota",
            "db-config",
            "copilot",
            "platform-shims",
        ],
        "recommended_flow": [
            "在工程根目录执行 new_project 或 existing_project 命令",
            "执行 sop context prepare --flush 生成 manifest、agent_context、env 与远端物化缓存",
            "执行 sop doctor 检查 Manager、同步队列、记忆/知识库 outbox 与平台 shim",
            "各类 CLI/IDE/Agent 读取 .sop-runtime/project_manifest.json 或 SOP_AGENT_CONTEXT 即可接入",
        ],
    }


# ── 项目模板 ──────────────────────────────────────────────────────
@proj_router.get("/templates")
def list_templates(user: User = Depends(current_user), db: Session = Depends(get_session)):
    """列出当前租户下所有模板项目"""
    tpls = db.query(Project).filter_by(tenant_id=user.tenant_id, is_template=True).all()
    return [{"id": p.id, "name": p.name, "description": p.description,
             "vector_db": p.vector_db, "created_at": p.created_at.isoformat(),
             "req_count": db.query(Requirement).filter_by(project_id=p.id).count(),
             "task_count": db.query(Task).filter_by(project_id=p.id).count()}
            for p in tpls]


@proj_router.patch("/{project_id}/set-template")
def set_template(project_id: str, is_template: bool = True,
                 user: User = Depends(require_role("project_admin")),
                 db: Session = Depends(get_session)):
    """将项目标记为/取消模板"""
    p = db.get(Project, project_id)
    if not p or p.tenant_id != user.tenant_id:
        raise HTTPException(404, "项目不存在")
    p.is_template = is_template
    p.updated_at = datetime.utcnow()
    db.commit()
    return {"ok": True, "is_template": is_template}


class CloneProjectBody(BaseModel):
    name: str
    description: str = ""
    business_id: Optional[str] = None
    project_path: str = ""
    # 克隆选项
    clone_requirements: bool = True   # 复制需求（清空状态为 pending）
    clone_tasks: bool = False          # 复制任务模板
    clone_knowledge: bool = True       # 复制向量知识库
    clone_rules: bool = True           # 复制规则库
    clone_specs: bool = False          # 复制规范文档（文件系统）


@proj_router.post("/{template_id}/clone")
def clone_project(template_id: str, body: CloneProjectBody,
                  user: User = Depends(require_role("project_admin")),
                  db: Session = Depends(get_session)):
    """从模板项目克隆新项目"""
    tpl = db.get(Project, template_id)
    if not tpl or tpl.tenant_id != user.tenant_id:
        raise HTTPException(404, "模板项目不存在")
    if not tpl.is_template:
        raise HTTPException(400, "该项目未标记为模板，请先设置为模板")

    new_id = f"proj-{uuid.uuid4().hex[:12]}"
    new_proj = Project(
        id=new_id, tenant_id=user.tenant_id,
        business_id=body.business_id or tpl.business_id,
        name=body.name, description=body.description or tpl.description,
        project_path=body.project_path,
        vector_db=tpl.vector_db, vector_db_config=tpl.vector_db_config,
        template_id=template_id,
    )
    db.add(new_proj)
    db.add(ProjectMember(project_id=new_id, user_id=user.id, role="project_admin"))

    cloned = {"requirements": 0, "tasks": 0, "knowledge": 0, "rules": 0}

    # 克隆需求（重置状态）
    if body.clone_requirements:
        for r in db.query(Requirement).filter_by(project_id=template_id).all():
            db.add(Requirement(
                id=f"REQ-{uuid.uuid4().hex[:16]}", tenant_id=user.tenant_id,
                project_id=new_id, title=r.title, description=r.description,
                status="pending", priority=r.priority,
                acceptance_criteria=r.acceptance_criteria, tags=r.tags,
            ))
            cloned["requirements"] += 1

    # 克隆任务模板（重置状态）
    if body.clone_tasks:
        for t in db.query(Task).filter_by(project_id=template_id).all():
            db.add(Task(
                id=f"T-{uuid.uuid4().hex[:12]}", tenant_id=user.tenant_id,
                project_id=new_id, title=t.title, description=t.description,
                status="pending", priority=t.priority, estimate=t.estimate,
                assigned_to=t.assigned_to,
            ))
            cloned["tasks"] += 1

    db.commit()

    # 克隆向量知识库（异步，不阻塞）
    if body.clone_knowledge or body.clone_rules:
        try:
            _clone_vector_data(template_id, new_id, tpl.vector_db,
                               tpl.vector_db_config or {},
                               clone_knowledge=body.clone_knowledge,
                               clone_rules=body.clone_rules)
            cloned["knowledge"] = 1 if body.clone_knowledge else 0
            cloned["rules"] = 1 if body.clone_rules else 0
        except Exception:
            pass  # 向量库克隆失败不影响项目创建

    return {"ok": True, "id": new_id, "cloned": cloned}


def _clone_vector_data(src_id: str, dst_id: str, vector_db: str,
                       vector_cfg: dict, clone_knowledge: bool, clone_rules: bool):
    """复制向量库数据到新项目命名空间"""
    from .vector_store import get_vector_store, _ns
    store = get_vector_store(project_vector_db=vector_db, project_vector_config=vector_cfg)
    tables = []
    if clone_knowledge: tables.append("knowledge")
    if clone_rules: tables.append("rules")
    for tbl in tables:
        src_rows = store.rows(_ns(src_id, tbl), limit=2000)
        for row in src_rows:
            new_row = {k: v for k, v in row.items() if k != "vector"}
            new_row["id"] = f"{tbl[:3]}-{uuid.uuid4().hex[:12]}"
            try:
                store.upsert(_ns(dst_id, tbl), new_row)
            except Exception:
                pass
