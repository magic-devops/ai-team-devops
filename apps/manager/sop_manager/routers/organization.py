"""组织权限聚合：租户成员、业务线、项目成员一站式摘要。"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .auth_sql import PROJECT_MEMBER_ROLES, USER_ROLES, User as AuthUser, current_user, role_weight
from .sql_models import Business, Project, ProjectMember, User, get_session

router = APIRouter(prefix="/api/v1/organization", tags=["organization"])


@router.get("/summary")
def organization_summary(
    user: AuthUser = Depends(current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    tid = user.tenant_id
    users = db.query(User).filter(User.tenant_id == tid).all()
    businesses = db.query(Business).filter(Business.tenant_id == tid).all()
    projects = db.query(Project).filter(Project.tenant_id == tid).all()
    members = (
        db.query(ProjectMember)
        .join(Project, Project.id == ProjectMember.project_id)
        .filter(Project.tenant_id == tid)
        .all()
    )

    by_role: dict[str, int] = {}
    by_status: dict[str, int] = {}
    for u in users:
        role = str(u.role or "unknown")
        status = str(u.status or "active")
        by_role[role] = by_role.get(role, 0) + 1
        by_status[status] = by_status.get(status, 0) + 1

    by_project_role: dict[str, int] = {}
    for m in members:
        pr = str(m.role or "unknown")
        by_project_role[pr] = by_project_role.get(pr, 0) + 1

    active_projects = sum(1 for p in projects if str(p.status or "") == "active")

    return {
        "ok": True,
        "users_total": len(users),
        "users_active": by_status.get("active", 0),
        "users_disabled": by_status.get("disabled", 0),
        "tenant_admins": sum(1 for u in users if "admin" in str(u.role or "").lower()),
        "businesses_total": len(businesses),
        "projects_total": len(projects),
        "projects_active": active_projects,
        "project_members_total": len(members),
        "by_user_role": by_role,
        "by_user_status": by_status,
        "by_project_member_role": by_project_role,
    }


@router.get("/hub")
def organization_hub(
    user: AuthUser = Depends(current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    summary = organization_summary(user=user, db=db)
    by_role = summary.get("by_user_role") if isinstance(summary.get("by_user_role"), dict) else {}

    def _pie(counter: dict[str, int]) -> list[dict[str, Any]]:
        return [{"name": k, "value": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0])) if v > 0]

    return {
        "ok": True,
        "summary": {
            "users_total": summary.get("users_total", 0),
            "users_active": summary.get("users_active", 0),
            "businesses_total": summary.get("businesses_total", 0),
            "projects_total": summary.get("projects_total", 0),
            "projects_active": summary.get("projects_active", 0),
            "project_members_total": summary.get("project_members_total", 0),
        },
        "charts": {"by_user_role": _pie(by_role)},
        "domains": [
            {"id": "users", "path": "#/organization/users", "capability": "portfolio.organization.tenant-users"},
            {"id": "businesses", "path": "#/organization/businesses", "capability": "portfolio.organization.businesses"},
            {"id": "project-members", "path": "#/organization/project-members", "capability": "portfolio.organization.project-members"},
            {"id": "role-policy", "path": "#/organization/role-policy", "capability": "portfolio.organization.role-policy"},
        ],
    }


@router.get("/policy")
def organization_policy(
    user: AuthUser = Depends(current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    """组织治理策略视图：给 UI/AI Agent 返回角色、能力边界和治理控制面。"""
    tenant = user.tenant
    tenant_code = (tenant.slug if tenant and tenant.slug else user.tenant_id)

    user_capability_map = {
        "super_admin": ["tenant.manage", "user.manage", "business.manage", "project.manage", "policy.admin", "audit.read"],
        "tenant_admin": ["user.manage", "business.manage", "project.manage", "policy.read", "audit.read"],
        "project_admin": ["project.manage", "project.member.manage", "delivery.manage", "agent.dispatch"],
        "developer": ["delivery.execute", "task.claim", "code.submit"],
        "devops": ["delivery.execute", "deploy.manage", "ops.monitor", "incident.handle"],
        "product_manager": ["requirement.manage", "task.plan", "quality.review"],
        "analyst": ["data.read", "metric.develop", "insight.analyze"],
        "viewer": ["workspace.read"],
    }
    project_capability_map = {
        "project_admin": ["project.member.manage", "project.configure", "agent.dispatch", "quality.gate"],
        "developer": ["task.claim", "code.submit", "quality.evidence"],
        "devops": ["deploy.manage", "ops.monitor", "incident.handle"],
        "product_manager": ["requirement.refine", "acceptance.review", "task.prioritize"],
        "analyst": ["data.develop", "metric.review", "insight.publish"],
        "viewer": ["project.read"],
    }

    return {
        "ok": True,
        "tenant_scope": {
            "tenant_id": user.tenant_id,
            "tenant_code": tenant_code,
            "business_code": "*",
            "project_id": "*",
        },
        "user_roles": [
            {
                "role": role,
                "level": role_weight(role),
                "scope": "tenant",
                "capabilities": user_capability_map.get(role, ["workspace.read"]),
                "assignable": role != "super_admin" or user.role == "super_admin",
            }
            for role in USER_ROLES
        ],
        "project_member_roles": [
            {
                "role": role,
                "level": role_weight(role),
                "scope": "project",
                "capabilities": project_capability_map.get(role, ["project.read"]),
                "assignable": user.role in {"super_admin", "tenant_admin", "project_admin"},
            }
            for role in PROJECT_MEMBER_ROLES
        ],
        "governance_controls": [
            {
                "id": "tenant_isolation",
                "title": "tenant_code 租户隔离",
                "status": "active",
                "description": "所有组织成员、业务线、项目成员按租户过滤，跨租户不可见不可写。",
                "next": "升级为 ABAC 策略表达式与审计回放。",
            },
            {
                "id": "business_boundary",
                "title": "business_code 业务边界",
                "status": "active",
                "description": "业务线承载项目归属、权限分组和数据开发治理边界。",
                "next": "补充业务负责人、成本中心与业务级审批策略。",
            },
            {
                "id": "project_membership",
                "title": "project_id 项目授权",
                "status": "active",
                "description": "项目成员角色决定需求、任务、AI Agent 调度和项目运维操作边界。",
                "next": "加入临时授权、权限变更审批和过期自动回收。",
            },
            {
                "id": "ai_operability",
                "title": "AI 可操作规约",
                "status": "active",
                "description": "将页面、能力码、角色和 API 显式暴露给 CLI/Agent，便于自主治理和任务执行。",
                "next": "输出机器可读 OpenAPI + capability manifest。",
            },
        ],
        "ai_surfaces": [
            {
                "id": "tenant_users",
                "title": "租户成员治理",
                "capability": "portfolio.organization.tenant-users",
                "path": "#/organization/users",
                "description": "成员状态、角色、密码重置和账号生命周期。",
            },
            {
                "id": "business_lines",
                "title": "业务线治理",
                "capability": "portfolio.organization.businesses",
                "path": "#/organization/businesses",
                "description": "业务边界、项目归属和后续业务级权限策略入口。",
            },
            {
                "id": "project_members",
                "title": "项目成员治理",
                "capability": "portfolio.organization.project-members",
                "path": "#/organization/project-members",
                "description": "项目角色分配、成员候选和 AI 开发任务协作范围。",
            },
            {
                "id": "role_policy",
                "title": "角色策略中心",
                "capability": "portfolio.organization.role-policy",
                "path": "#/organization/role-policy",
                "description": "角色能力、治理控制点和 AI 可操作边界。",
            },
        ],
    }
