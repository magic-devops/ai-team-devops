"""租户 & 项目管理路由 (SaaS 多租户 + 单项目模式)"""
from __future__ import annotations
import os, uuid
from sop_manager.task_owner import TaskOwnerId, TaskOwnerInput

from collections import Counter
from datetime import datetime
from typing import Any, Optional, List, Literal

from fastapi import APIRouter, HTTPException, Depends, Request
from pydantic import BaseModel, ConfigDict
from sqlalchemy.orm import Session

from .sql_models import get_session, Tenant, Business, Project, ProjectMember, User, Requirement, Task, Issue, Sprint
from .auth_sql import current_user, require_role, ADMIN_MODE, assert_project_member_role, check_project_access
from .webhook import notify_webhook
from .project_portfolio_routes import router as portfolio_router
from .project_creation import ProjectCreate, ProjectCreateAck, create_project_record

router = APIRouter(prefix="/api/v1/tenants", tags=["tenants"])
proj_router = APIRouter(prefix="/api/v1/projects", tags=["projects"])
proj_router.include_router(portfolio_router)


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

class BizUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None

@biz_router.get("")
def list_businesses(user: User = Depends(current_user),
                    db: Session = Depends(get_session)):
    tenant = db.get(Tenant, user.tenant_id)
    tenant_code = (tenant.slug if tenant and tenant.slug else user.tenant_id)
    return [{"id": b.id, "name": b.name, "description": b.description,
             "tenant_id": b.tenant_id, "tenant_code": tenant_code,
             "business_code": b.id,
             "project_count": len(b.projects)}
            for b in db.query(Business).filter_by(tenant_id=user.tenant_id).all()]

@biz_router.post("")
def create_business(body: BizCreate, user: User = Depends(require_role("tenant_admin")),
                    db: Session = Depends(get_session)):
    b = Business(id=f"biz-{uuid.uuid4().hex[:12]}", tenant_id=user.tenant_id,
                 name=body.name, description=body.description)
    db.add(b); db.commit()
    return {"ok": True, "id": b.id}

@biz_router.patch("/{biz_id}")
def update_business(biz_id: str, body: BizUpdate, user: User = Depends(require_role("tenant_admin")),
                    db: Session = Depends(get_session)):
    b = db.get(Business, biz_id)
    if not b or b.tenant_id != user.tenant_id:
        raise HTTPException(404, "业务线不存在")
    if body.name is not None:
        b.name = body.name
    if body.description is not None:
        b.description = body.description
    db.commit()
    return {"ok": True}

@biz_router.delete("/{biz_id}")
def delete_business(biz_id: str, user: User = Depends(require_role("tenant_admin")),
                    db: Session = Depends(get_session)):
    b = db.get(Business, biz_id)
    if not b or b.tenant_id != user.tenant_id:
        raise HTTPException(404, "业务线不存在")
    if db.query(Project).filter_by(tenant_id=user.tenant_id, business_id=biz_id).first():
        raise HTTPException(400, "业务线下仍有关联项目，请先调整项目归属")
    db.delete(b); db.commit()
    return {"ok": True}


# ── 项目管理 ──────────────────────────────────────────────────────
def _project_counts(db: Session, project_id: str) -> dict:
    return {
        "members": db.query(ProjectMember).filter_by(project_id=project_id).count(),
        "requirements": db.query(Requirement).filter_by(project_id=project_id).count(),
        "tasks": db.query(Task).filter_by(project_id=project_id).count(),
        "issues": db.query(Issue).filter_by(project_id=project_id).count(),
        "sprints": db.query(Sprint).filter_by(project_id=project_id).count(),
    }


def _project_row(db: Session, p: Project) -> dict:
    tenant = db.get(Tenant, p.tenant_id)
    business = db.get(Business, p.business_id) if p.business_id else None
    return {
        "id": p.id,
        "tenant_id": p.tenant_id,
        "tenant_code": (tenant.slug if tenant and tenant.slug else p.tenant_id),
        "name": p.name,
        "description": p.description,
        "business_id": p.business_id,
        "business_code": business.id if business else "",
        "business_name": business.name if business else "",
        "project_code": p.id,
        "project_path": p.project_path,
        "vector_db": p.vector_db,
        "is_template": bool(p.is_template),
        "template_id": p.template_id or "",
        "status": p.status,
        "created_at": p.created_at.isoformat() if p.created_at else "",
        "updated_at": p.updated_at.isoformat() if p.updated_at else "",
        "counts": _project_counts(db, p.id),
    }


def _visible_projects(user: User, db: Session):
    from .project_portfolio import visible_projects

    return visible_projects(db, user)

@proj_router.get("")
def list_projects(user: User = Depends(current_user), db: Session = Depends(get_session)):
    return [_project_row(db, p) for p in _visible_projects(user, db).order_by(Project.updated_at.desc()).all()]


@proj_router.get("/summary")
def projects_summary(user: User = Depends(current_user), db: Session = Depends(get_session)):
    from .project_portfolio import portfolio, project_facts

    projects = _visible_projects(user, db).all()
    delivery = portfolio(db, user, limit=1)["summary"]
    status_counts = Counter([p.status or "unknown" for p in projects])
    vector_counts = Counter([p.vector_db or "unknown" for p in projects])
    totals = {"members": 0, "requirements": 0, "tasks": 0, "issues": 0, "sprints": 0}
    readiness_risks = []
    risks = []
    for p in projects:
        counts = _project_counts(db, p.id)
        for key, value in counts.items():
            totals[key] += value
        if len(risks) < 12:
            risks.extend({"project_id": p.id, **item} for item in project_facts(db, p)["risks"])
        if not p.project_path:
            readiness_risks.append({"project_id": p.id, "level": "medium", "message": "未配置项目路径，Agent 本地操作与接入包可用性受限"})
        if counts["members"] <= 1:
            readiness_risks.append({"project_id": p.id, "level": "low", "message": "项目成员较少，建议补齐产品、研发、运维或 Agent 责任人"})
    try:
        from .system_pages import LEGACY_PAGES, _enrich_pages
        project_legacy = [
            {
                **item,
                "project_relevant": item.get("target") in {"#/projects", "#/organization"} or item.get("console_id") in {"config", "tenants"},
            }
            for item in _enrich_pages(LEGACY_PAGES)
        ]
    except Exception:
        project_legacy = []
    migrated = [p for p in project_legacy if p.get("status") in {"migrating", "active"}]
    return {
        "ok": True,
        "total": len(projects),
        "active": status_counts.get("active", 0),
        "templates": sum(1 for p in projects if p.is_template),
        "status_counts": dict(status_counts),
        "vector_counts": dict(vector_counts),
        "entity_totals": totals,
        "risks": risks[:12],
        "risks_total": delivery["risk_counts"]["total_items"],
        "risk_counts": delivery["risk_counts"],
        "delivery_metrics": delivery["metrics"],
        "readiness_risks": readiness_risks,
        "legacy_coverage": {
            "total": len(project_legacy),
            "covered": len(migrated),
            "rate": round(len(migrated) / max(1, len(project_legacy)) * 100, 1),
            "items": project_legacy,
        },
        "recommendations": [
            "优先维护项目路径、成员角色、接入包与模板，保证 CLI/IDE/Agent 可稳定接入。",
            "将 legacy 项目配置与组织管理能力收敛到 React 项目管理和组织权限模块。",
            "新项目建议从模板克隆，并立即执行 sop context prepare --flush 与 sop doctor。",
        ],
    }


@proj_router.get("/hub")
def projects_hub(user: User = Depends(current_user), db: Session = Depends(get_session)) -> dict[str, Any]:
    raw = projects_summary(user=user, db=db)
    totals = raw.get("entity_totals") if isinstance(raw.get("entity_totals"), dict) else {}
    status_counts = raw.get("status_counts") if isinstance(raw.get("status_counts"), dict) else {}

    def _pie(counter: dict[str, int]) -> list[dict[str, Any]]:
        return [{"name": k, "value": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0])) if v > 0]

    return {
        "ok": True,
        "summary": {
            "total": raw.get("total", 0),
            "active": raw.get("active", 0),
            "templates": raw.get("templates", 0),
            "members": totals.get("members", 0),
            "requirements": totals.get("requirements", 0),
            "tasks": totals.get("tasks", 0),
            "risks_total": raw["risks_total"],
            "risk_counts": raw["risk_counts"],
        },
        "charts": {"by_status": _pie(status_counts)},
        "domains": [
            {"id": "portfolio", "path": "#/projects/portfolio", "capability": "portfolio.projects.portfolio"},
            {"id": "businesses", "path": "#/projects/businesses", "capability": "portfolio.projects.businesses"},
            {"id": "tenants", "path": "#/projects/tenants", "capability": "portfolio.projects.tenants"},
            {"id": "users", "path": "#/projects/users", "capability": "portfolio.projects.tenant-users"},
            {"id": "members", "path": "#/projects/members", "capability": "portfolio.projects.members"},
            {
                "id": "delivery_kit",
                "path": "#/projects/delivery-kit",
                "capability": "portfolio.projects.delivery-kit",
            },
        ],
    }


@proj_router.get("/{project_id}/review")
def project_review(project_id: str, request: Request,
                   user: User = Depends(current_user), db: Session = Depends(get_session)):
    """项目智能体检：给 UI/Agent 返回项目接入、协作、交付与 legacy 收敛建议。"""
    check_project_access(user, project_id, db, min_role="viewer")
    p = db.get(Project, project_id)
    if not p or p.tenant_id != user.tenant_id:
        raise HTTPException(404, "项目不存在")
    counts = _project_counts(db, p.id)
    members = db.query(ProjectMember).filter_by(project_id=p.id).all()
    manager_url = str(request.base_url).rstrip("/")

    checks = [
        {
            "id": "project_path",
            "label": "项目路径",
            "ok": bool((p.project_path or "").strip()),
            "weight": 20,
            "recommendation": "配置 project_path，确保 CLI/IDE/Agent 可定位本地工程根目录。",
        },
        {
            "id": "members",
            "label": "协作成员",
            "ok": counts["members"] >= 2,
            "weight": 20,
            "recommendation": "至少补齐项目管理员与研发/运维/产品角色，降低单点维护风险。",
        },
        {
            "id": "delivery_context",
            "label": "交付上下文",
            "ok": counts["requirements"] > 0 or counts["tasks"] > 0,
            "weight": 20,
            "recommendation": "录入需求或任务，让 Agent 能基于工作台快照生成下一步计划。",
        },
        {
            "id": "active_status",
            "label": "项目状态",
            "ok": (p.status or "") == "active",
            "weight": 15,
            "recommendation": "活跃项目建议保持 active；暂停或归档项目应从默认工作流中降噪。",
        },
        {
            "id": "template_strategy",
            "label": "模板策略",
            "ok": bool(p.is_template) or bool(p.template_id),
            "weight": 10,
            "recommendation": "将成熟项目设为模板，或从模板克隆，统一需求/规则/知识初始化方式。",
        },
        {
            "id": "ai_onboarding",
            "label": "AI 接入包",
            "ok": True,
            "weight": 15,
            "recommendation": "执行 sop context prepare --flush 刷新 manifest、agent_context、env 与远端缓存。",
        },
    ]
    score = sum(item["weight"] for item in checks if item["ok"])
    risks = [
        {"level": "medium" if item["weight"] >= 20 else "low", "check_id": item["id"], "message": item["recommendation"]}
        for item in checks
        if not item["ok"]
    ]
    actions = [
        {
            "id": "prepare_context",
            "title": "刷新 Agent 上下文",
            "kind": "command",
            "command": "sop context prepare --flush && sop status --json",
            "impact": "让各类 CLI/IDE/Agent 读取最新项目上下文、接入包和工作台快照。",
        },
        {
            "id": "doctor",
            "title": "执行项目自检",
            "kind": "command",
            "command": "sop doctor && sop sync doctor",
            "impact": "检查 Manager、同步队列、manifest、记忆/知识 outbox 与平台 shim。",
        },
        {
            "id": "work_snapshot",
            "title": "导出工作台快照",
            "kind": "command",
            "command": "sop work export --local --out .sop-runtime/work_snapshot.json",
            "impact": "给 AI Agent 提供需求、任务、问题、迭代和下一步建议的稳定输入。",
        },
    ]
    if not p.project_path:
        actions.insert(0, {
            "id": "set_path",
            "title": "配置项目路径",
            "kind": "ui",
            "command": "",
            "impact": "在右侧项目控制台补充 project_path，提升本地文件、终端与 Agent 操作可用性。",
        })
    if counts["members"] < 2:
        actions.append({
            "id": "add_members",
            "title": "补齐项目成员",
            "kind": "ui",
            "command": "",
            "impact": "添加研发、运维、产品或分析角色，形成项目级权限闭环。",
        })
    return {
        "ok": True,
        "project": _project_row(db, p),
        "score": score,
        "grade": "excellent" if score >= 85 else "good" if score >= 70 else "needs_attention" if score >= 50 else "at_risk",
        "checks": checks,
        "risks": risks,
        "actions": actions,
        "member_roles": Counter([m.role for m in members]),
        "agent_prompt": (
            f"你正在接手 SOP 项目 {p.name} ({p.id})。Manager: {manager_url}。"
            "请先读取 .sop-runtime/agent_context.json、运行 sop status --json，"
            "再基于项目管理工作台的 review.actions 规划下一步。"
        ),
    }

@proj_router.post("", response_model=ProjectCreateAck)
def create_project(body: ProjectCreate, user: User = Depends(require_role("project_admin")),
                   db: Session = Depends(get_session)):
    result = create_project_record(db, user, body)
    if not result.replayed:
        try:
            notify_webhook("project.created", {"project_id": result.id, "name": body.name, "vector_db": body.vector_db},
                           tenant_id=result.tenant_id, project_id=result.id)
        except Exception:
            # Optional notification failure cannot invalidate an atomic save.
            import logging
            logging.getLogger(__name__).exception("Project creation notification failed")
    return result

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

@proj_router.get("/{project_id}/member-candidates")
def list_member_candidates(project_id: str, user: User = Depends(current_user),
                           db: Session = Depends(get_session)):
    check_project_access(user, project_id, db, min_role="project_admin")
    p = db.get(Project, project_id)
    if not p or p.tenant_id != user.tenant_id:
        raise HTTPException(404, "项目不存在")
    member_ids = {m.user_id for m in db.query(ProjectMember).filter_by(project_id=project_id).all()}
    return [
        {"id": u.id, "username": u.username, "email": u.email, "role": u.role, "status": u.status}
        for u in db.query(User).filter_by(tenant_id=user.tenant_id, status="active").all()
        if u.id not in member_ids
    ]

class MemberAdd(BaseModel):
    user_id: str
    role: str = "developer"

class MemberUpdate(BaseModel):
    role: str

@proj_router.post("/{project_id}/members")
def add_member(project_id: str, body: MemberAdd,
               user: User = Depends(require_role("project_admin")),
               db: Session = Depends(get_session)):
    check_project_access(user, project_id, db, min_role="project_admin")
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
    check_project_access(user, project_id, db, min_role="project_admin")
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

@proj_router.patch("/{project_id}/members/{user_id}")
def update_member(project_id: str, user_id: str, body: MemberUpdate,
                  user: User = Depends(require_role("project_admin")),
                  db: Session = Depends(get_session)):
    check_project_access(user, project_id, db, min_role="project_admin")
    p = db.get(Project, project_id)
    if not p or p.tenant_id != user.tenant_id:
        raise HTTPException(404, "项目不存在")
    m = db.query(ProjectMember).filter_by(project_id=project_id, user_id=user_id).first()
    if not m:
        raise HTTPException(404, "成员不存在")
    m.role = assert_project_member_role(body.role)
    db.commit()
    notify_webhook(
        "project.member_updated",
        {"project_id": project_id, "user_id": user_id, "role": m.role},
        tenant_id=user.tenant_id,
        project_id=project_id,
    )
    return {"ok": True, "role": m.role}


class ProjectBootstrapTasksBody(TaskOwnerInput):
    dry_run: bool = True
    priority: str = "P1"
    owner_id: TaskOwnerId = ""


def _project_bootstrap_task_specs(p: Project, counts: dict, *, priority: str, owner_id: str) -> list[dict]:
    specs = []
    if not (p.project_path or "").strip():
        specs.append({
            "id": "project_path",
            "title": f"配置项目路径与本地 Agent 工作目录：{p.name}",
            "description": "在项目管理页补充 project_path，并确保 CLI/IDE/Agent 能定位工程根目录与 .sop-runtime 接入包。",
            "estimate": "S",
        })
    if counts["members"] < 2:
        specs.append({
            "id": "members",
            "title": f"补齐项目成员与职责：{p.name}",
            "description": "至少补齐 project_admin、developer、devops/product_manager 等项目角色，形成项目级权限闭环。",
            "estimate": "S",
        })
    if counts["requirements"] == 0 and counts["tasks"] == 0:
        specs.append({
            "id": "delivery_context",
            "title": f"初始化项目需求和任务上下文：{p.name}",
            "description": "录入首批需求或任务，并导出工作台快照，确保 AI Agent 能基于真实交付上下文规划下一步。",
            "estimate": "M",
        })
    specs.append({
        "id": "ai_onboarding",
        "title": f"刷新 AI/CLI 接入包并完成项目自检：{p.name}",
        "description": "执行 sop context prepare --flush、sop doctor、sop status --json，刷新 manifest、agent_context、env 与远端缓存。",
        "estimate": "S",
    })
    return [
        {
            **item,
            "priority": priority,
            "owner_id": owner_id,
            "status": "pending",
        }
        for item in specs
    ]


class ProjectOpsTasksBody(TaskOwnerInput):
    dry_run: bool = True
    priority: str = "P1"
    owner_id: TaskOwnerId = ""
    categories: list[str] = []


def _project_ops_task_specs(p: Project, counts: dict, *, priority: str, owner_id: str, categories: list[str] | None = None) -> list[dict]:
    wanted = set(categories or [])
    include_all = not wanted
    specs: list[dict[str, Any]] = []

    def add(category: str, item: dict[str, Any]) -> None:
        if include_all or category in wanted:
            specs.append({**item, "category": category})

    if not (p.project_path or "").strip():
        add("setup", {
            "id": "project_path",
            "title": f"配置项目路径与本地 Agent 工作目录：{p.name}",
            "description": "补充 project_path，确保 CLI/IDE/Agent 可定位工程根目录、.sop-runtime 接入包和本地文件上下文。",
            "estimate": "S",
        })
    if counts["members"] < 2:
        add("collaboration", {
            "id": "members",
            "title": f"补齐项目成员与职责：{p.name}",
            "description": "至少补齐 project_admin、developer、devops/product_manager 等项目角色，形成项目级权限闭环。",
            "estimate": "S",
        })
    if counts["requirements"] == 0 and counts["tasks"] == 0:
        add("delivery", {
            "id": "delivery_context",
            "title": f"初始化项目需求和任务上下文：{p.name}",
            "description": "录入首批需求或任务，并导出工作台快照，确保 AI Agent 能基于真实交付上下文规划下一步。",
            "estimate": "M",
        })
    if (p.status or "") != "active":
        add("lifecycle", {
            "id": "active_status",
            "title": f"确认项目生命周期状态：{p.name}",
            "description": "评估项目是否应恢复 active、保持 paused 或进入 archived，避免 AI 调度误领取非活跃项目任务。",
            "estimate": "S",
        })
    if not bool(p.is_template) and not bool(p.template_id):
        add("standardization", {
            "id": "template_strategy",
            "title": f"建立项目模板化策略：{p.name}",
            "description": "将成熟项目设为模板或绑定来源模板，统一需求、规则、知识、Agent 接入和交付初始化方式。",
            "estimate": "M",
        })
    add("ai_onboarding", {
        "id": "ai_onboarding",
        "title": f"刷新 AI/CLI 接入包并完成项目自检：{p.name}",
        "description": "执行 sop context prepare --flush、sop doctor、sop status --json，刷新 manifest、agent_context、env 与远端缓存。",
        "estimate": "S",
    })
    add("ai_onboarding", {
        "id": "work_snapshot",
        "title": f"生成项目工作台快照：{p.name}",
        "description": "导出需求、任务、问题、迭代、风险和下一步建议，供 Agent 作为稳定输入消费。",
        "estimate": "S",
    })
    return [{**item, "priority": priority, "owner_id": owner_id, "status": "pending"} for item in specs]


def _create_project_tasks_from_specs(
    *,
    db: Session,
    user: User,
    project_id: str,
    specs: list[dict[str, Any]],
    source: str,
    dry_run: bool,
) -> dict[str, Any]:
    existing = {
        t.human_notes
        for t in db.query(Task).filter_by(project_id=project_id).all()
        if (t.human_notes or "").startswith(f"source={source};")
    }
    planned, created, skipped = [], [], []
    for spec in specs:
        marker = f"source={source};project={project_id};item={spec['id']}"
        row = {k: v for k, v in spec.items() if k != "id"}
        row["human_notes"] = marker
        if marker in existing:
            skipped.append({"id": spec["id"], "reason": "task_exists", "title": spec["title"]})
            continue
        planned.append(row)
        if not dry_run:
            task = Task(
                id=f"T-{uuid.uuid4().hex[:12]}",
                tenant_id=user.tenant_id,
                project_id=project_id,
                title=row["title"],
                description=row["description"],
                status="pending",
                priority=row["priority"],
                estimate=row["estimate"],
                owner_id=row["owner_id"],
                human_notes=marker,
            )
            db.add(task)
            created.append({"id": task.id, "title": task.title})
    if not dry_run:
        db.commit()
    return {
        "ok": True,
        "dry_run": dry_run,
        "planned": planned,
        "created": created,
        "skipped": skipped,
        "summary": {"planned": len(planned), "created": len(created), "skipped": len(skipped)},
    }


@proj_router.post("/{project_id}/bootstrap-tasks")
def create_project_bootstrap_tasks(project_id: str, body: ProjectBootstrapTasksBody,
                                   user: User = Depends(current_user),
                                   db: Session = Depends(get_session)):
    """把项目体检建议落成可执行任务，进入任务看板。"""
    check_project_access(user, project_id, db, min_role="project_admin")
    p = db.get(Project, project_id)
    if not p or p.tenant_id != user.tenant_id:
        raise HTTPException(404, "项目不存在")
    counts = _project_counts(db, project_id)
    specs = _project_bootstrap_task_specs(p, counts, priority=body.priority, owner_id=body.owner_id)
    result = _create_project_tasks_from_specs(db=db, user=user, project_id=project_id, specs=specs, source="project_bootstrap", dry_run=body.dry_run)
    if not body.dry_run:
        notify_webhook(
            "project.bootstrap_tasks_created",
            {"project_id": project_id, "created": result["summary"]["created"], "skipped": result["summary"]["skipped"]},
            tenant_id=user.tenant_id,
            project_id=project_id,
        )
    return result


@proj_router.get("/{project_id}/ops-plan")
def project_ops_plan(project_id: str, request: Request,
                     user: User = Depends(current_user),
                     db: Session = Depends(get_session)):
    """项目治理操作包：面向 UI/CLI/Agent 的机器可读项目运营计划。"""
    check_project_access(user, project_id, db, min_role="viewer")
    p = db.get(Project, project_id)
    if not p or p.tenant_id != user.tenant_id:
        raise HTTPException(404, "项目不存在")
    review = project_review(project_id=project_id, request=request, user=user, db=db)
    counts = _project_counts(db, project_id)
    tenant = db.get(Tenant, p.tenant_id)
    business = db.get(Business, p.business_id) if p.business_id else None
    tenant_code = tenant.slug if tenant and tenant.slug else p.tenant_id
    business_code = business.id if business else ""
    commands = [
        {"id": "prepare", "title": "刷新项目上下文", "command": "sop context prepare --flush", "category": "setup"},
        {"id": "status", "title": "导出健康状态", "command": "sop status --json --out .sop-runtime/status.json", "category": "ops"},
        {"id": "work", "title": "导出工作台快照", "command": "sop work export --local --out .sop-runtime/work_snapshot.json", "category": "delivery"},
        {"id": "doctor", "title": "执行端到端自检", "command": "sop doctor && sop sync doctor", "category": "ops"},
        {"id": "feed", "title": "查看 Agent 可领取任务", "command": "sop task feed --limit 10 --include-blocked", "category": "agent"},
    ]
    task_specs = _project_ops_task_specs(p, counts, priority="P1", owner_id="")
    return {
        "ok": True,
        "project": review["project"],
        "scope": {
            "tenant_id": p.tenant_id,
            "tenant_code": tenant_code,
            "business_id": p.business_id or "",
            "business_code": business_code,
            "project_id": p.id,
            "project_code": p.id,
        },
        "health": {
            "score": review["score"],
            "grade": review["grade"],
            "risks": review["risks"],
            "counts": counts,
        },
        "readiness": review["checks"],
        "commands": commands,
        "task_candidates": task_specs,
        "ai_packet": {
            "intent": "project_governance_ops",
            "manager_url": str(request.base_url).rstrip("/"),
            "project_id": p.id,
            "required_context": [".sop-runtime/project_manifest.json", ".sop-runtime/agent_context.json", ".sop-runtime/work_snapshot.json"],
            "recommended_entry": "#/projects/governance",
            "next_cli": [cmd["command"] for cmd in commands],
        },
    }


@proj_router.post("/{project_id}/ops-tasks")
def create_project_ops_tasks(project_id: str, body: ProjectOpsTasksBody,
                             user: User = Depends(current_user),
                             db: Session = Depends(get_session)):
    """把项目治理操作包中的候选项落成任务。"""
    check_project_access(user, project_id, db, min_role="project_admin")
    p = db.get(Project, project_id)
    if not p or p.tenant_id != user.tenant_id:
        raise HTTPException(404, "项目不存在")
    counts = _project_counts(db, project_id)
    specs = _project_ops_task_specs(p, counts, priority=body.priority, owner_id=body.owner_id, categories=body.categories)
    result = _create_project_tasks_from_specs(db=db, user=user, project_id=project_id, specs=specs, source="project_ops", dry_run=body.dry_run)
    if not body.dry_run:
        notify_webhook(
            "project.ops_tasks_created",
            {"project_id": project_id, "created": result["summary"]["created"], "skipped": result["summary"]["skipped"]},
            tenant_id=user.tenant_id,
            project_id=project_id,
        )
    return result


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
        "manager_url": manager_url,
        "api_base": manager_url + "/api/v1",
        "scope": {
            "tenant_id": p.tenant_id,
            "tenant_code": tenant_code,
            "business_id": p.business_id or "",
            "business_code": business_code,
            "project_id": p.id,
            "project_code": project_code,
        },
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
        "readiness": [
            {"id": "project_selected", "label": "项目已选择", "ok": True, "detail": p.id},
            {"id": "tenant_scope", "label": "tenant_code 已生成", "ok": bool(tenant_code), "detail": tenant_code},
            {"id": "business_scope", "label": "business_code 已关联", "ok": bool(business_code), "detail": business_code or "未绑定业务线"},
            {"id": "project_path", "label": "项目路径已配置", "ok": bool(p.project_path), "detail": p.project_path or "可在项目组合中补充"},
            {"id": "agent_profiles", "label": "Agent Profile 已内置", "ok": True, "detail": "Codex / Claude / Cursor / Qoder"},
            {"id": "event_channel", "label": "事件通道可用", "ok": True, "detail": "/ws/events"},
        ],
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
    tpls = _visible_projects(user, db).filter_by(is_template=True).all()
    return [{"id": p.id, "name": p.name, "description": p.description,
             "vector_db": p.vector_db, "created_at": p.created_at.isoformat(),
             "req_count": db.query(Requirement).filter_by(project_id=p.id).count(),
             "task_count": db.query(Task).filter_by(project_id=p.id).count()}
            for p in tpls]


class CloneProjectBody(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)
    name: str
    description: str = ""
    business_id: Optional[str] = None
    project_path: str = ""
    # 克隆选项
    clone_requirements: bool = True   # 复制需求（清空状态为 pending）
    clone_tasks: bool = False          # 复制任务模板
    clone_knowledge: bool = True       # 复制向量知识库
    clone_rules: bool = True           # 复制规则库


def _template_clone_preview(db: Session, tpl: Project, body: CloneProjectBody) -> dict[str, Any]:
    counts = _project_counts(db, tpl.id)
    selected_assets = {
        "requirements": counts["requirements"] if body.clone_requirements else 0,
        "tasks": counts["tasks"] if body.clone_tasks else 0,
        "knowledge": 1 if body.clone_knowledge else 0,
        "rules": 1 if body.clone_rules else 0,
    }
    warnings: list[dict[str, str]] = []
    if not body.name.strip():
        warnings.append({"level": "block", "message": "新项目名称不能为空"})
    if body.clone_requirements and counts["requirements"] == 0:
        warnings.append({"level": "warn", "message": "模板没有需求模板，克隆后需要补录首批需求"})
    if body.clone_tasks and counts["tasks"] == 0:
        warnings.append({"level": "warn", "message": "模板没有任务模板，克隆任务数量为 0"})
    if not body.project_path.strip():
        warnings.append({"level": "warn", "message": "未填写 project_path，克隆后 AI/CLI 本地接入需要补齐项目路径"})
    return {
        "ok": True,
        "template": _project_row(db, tpl),
        "new_project": {
            "name": body.name,
            "description": body.description or tpl.description,
            "business_id": body.business_id or tpl.business_id or "",
            "project_path": body.project_path,
            "vector_db": tpl.vector_db,
        },
        "selected_assets": selected_assets,
        "warnings": warnings,
        "recommended_after_clone": [
            "进入 AI 接入 > 接入总览，确认 tenant_code/business_code/project_id 与接入检查",
            "执行 sop context prepare --flush 生成 Agent 上下文资产",
            "进入项目智能治理 > 健康评估，预览并生成首批治理任务",
            "进入任务中心 > 调度中心，让 AI/CLI Agent 按依赖关系领取任务",
        ],
        "ai_packet": {
            "intent": "project_template_clone_preview",
            "template_id": tpl.id,
            "target_project_name": body.name,
            "copy_requirements": body.clone_requirements,
            "copy_tasks": body.clone_tasks,
            "copy_knowledge": body.clone_knowledge,
            "copy_rules": body.clone_rules,
            "next_pages": [
                "#/projects/templates/clone",
                "#/projects/onboarding/overview",
                "#/projects/governance/review",
                "#/tasks/scheduler",
            ],
        },
    }


@proj_router.post("/{template_id}/clone-preview")
def preview_clone_project(template_id: str, body: CloneProjectBody,
                          user: User = Depends(current_user),
                          db: Session = Depends(get_session)):
    """预览模板克隆影响：供 UI/CLI/Agent 在真实创建前评估资产、风险和后续治理步骤。"""
    check_project_access(user, template_id, db)
    tpl = db.get(Project, template_id)
    if not tpl or tpl.tenant_id != user.tenant_id:
        raise HTTPException(404, "模板项目不存在")
    if not tpl.is_template:
        raise HTTPException(400, "该项目未标记为模板，请先设置为模板")
    return _template_clone_preview(db, tpl, body)


@proj_router.post("/{template_id}/clone")
def clone_project(template_id: str, body: CloneProjectBody,
                  user: User = Depends(require_role("project_admin")),
                  db: Session = Depends(get_session)):
    """从模板项目克隆新项目"""
    check_project_access(user, template_id, db)
    tpl = db.get(Project, template_id)
    if not tpl or tpl.tenant_id != user.tenant_id:
        raise HTTPException(404, "模板项目不存在")
    if not tpl.is_template:
        raise HTTPException(400, "该项目未标记为模板，请先设置为模板")

    if not body.name.strip() or len(body.name) > 128:
        raise HTTPException(422, "Project name must contain between 1 and 128 characters")
    if body.business_id:
        business = db.get(Business, body.business_id)
        if not business or business.tenant_id != user.tenant_id:
            raise HTTPException(422, "Choose a business in this project's tenant")

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
                owner_id="",
            ))
            cloned["tasks"] += 1

    db.commit()

    warnings = []
    # Count only rows actually copied into the new destination project.
    if body.clone_knowledge or body.clone_rules:
        try:
            copied = _clone_vector_data(template_id, new_id, tpl.vector_db,
                               tpl.vector_db_config or {},
                               clone_knowledge=body.clone_knowledge,
                               clone_rules=body.clone_rules, tenant_id=user.tenant_id)
            cloned.update(copied)
        except HTTPException:
            raise
        except Exception:
            warnings.append({"code": "vector_clone_unavailable", "message": "The project was created, but vector assets could not be copied completely. Inspect the destination before using it."})

    return {"ok": True, "id": new_id, "cloned": cloned, "warnings": warnings}


def _clone_vector_data(src_id: str, dst_id: str, vector_db: str,
                       vector_cfg: dict, clone_knowledge: bool, clone_rules: bool, *, tenant_id: str):
    """复制向量库数据到新项目命名空间"""
    from .vector_store import get_vector_store, _ns
    from sop_manager.project_write_guard import project_file_write_scope
    store = get_vector_store(project_vector_db=vector_db, project_vector_config=vector_cfg)
    tables = []
    if clone_knowledge: tables.append("knowledge")
    if clone_rules: tables.append("rules")
    copied = {"knowledge": 0, "rules": 0}
    with project_file_write_scope(tenant_id=tenant_id, project_id=dst_id):
        for tbl in tables:
            src_rows = store.rows(_ns(src_id, tbl), limit=2000)
            for row in src_rows:
                new_row = {k: v for k, v in row.items() if k != "vector"}
                new_row["id"] = f"{tbl[:3]}-{uuid.uuid4().hex[:12]}"
                store.upsert(_ns(dst_id, tbl), new_row)
                copied[tbl] += 1
    return copied
