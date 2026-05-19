"""组织权限聚合：租户成员、业务线、项目成员一站式摘要。"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from sop_manager.path_config import resolved_ai_memory_root

from .auth_sql import PROJECT_MEMBER_ROLES, USER_ROLES, User as AuthUser, current_user, require_role, role_weight
from .sql_models import Business, Project, ProjectMember, Task, User, get_session

router = APIRouter(prefix="/api/v1/organization", tags=["organization"])


class RolePolicyUpdateIn(BaseModel):
    user_capability_map: dict[str, list[str]] = Field(default_factory=dict)
    project_capability_map: dict[str, list[str]] = Field(default_factory=dict)
    notes: str = Field("", max_length=2000)


class RolePolicyCheckIn(BaseModel):
    scope: str = Field("tenant", pattern="^(tenant|project)$")
    role: str = Field(..., max_length=64)
    capability: str = Field(..., max_length=120)


class AccessReviewTasksIn(BaseModel):
    dry_run: bool = True
    limit: int = Field(20, ge=1, le=100)
    assigned_to: str = Field("tenant_admin", max_length=64)
    priority: str = Field("P1", pattern="^P[0-3]$")


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _default_user_capability_map() -> dict[str, list[str]]:
    return {
        "super_admin": ["tenant.manage", "user.manage", "business.manage", "project.manage", "policy.admin", "audit.read"],
        "tenant_admin": ["user.manage", "business.manage", "project.manage", "policy.read", "audit.read"],
        "project_admin": ["project.manage", "project.member.manage", "delivery.manage", "agent.dispatch"],
        "developer": ["delivery.execute", "task.claim", "code.submit"],
        "devops": ["delivery.execute", "deploy.manage", "ops.monitor", "incident.handle"],
        "product_manager": ["requirement.manage", "task.plan", "quality.review"],
        "analyst": ["data.read", "metric.develop", "insight.analyze"],
        "viewer": ["workspace.read"],
    }


def _default_project_capability_map() -> dict[str, list[str]]:
    return {
        "project_admin": ["project.member.manage", "project.configure", "agent.dispatch", "quality.gate"],
        "developer": ["task.claim", "code.submit", "quality.evidence"],
        "devops": ["deploy.manage", "ops.monitor", "incident.handle"],
        "product_manager": ["requirement.refine", "acceptance.review", "task.prioritize"],
        "analyst": ["data.develop", "metric.review", "insight.publish"],
        "viewer": ["project.read"],
    }


def _role_policy_path(tenant_id: str):
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in tenant_id or "default")
    return resolved_ai_memory_root() / "organization_role_policy" / f"{safe}.json"


def _role_policy_history_path(tenant_id: str):
    safe = "".join(ch if ch.isalnum() or ch in "._-" else "_" for ch in tenant_id or "default")
    return resolved_ai_memory_root() / "organization_role_policy" / f"{safe}.history.jsonl"


def _dedupe_capabilities(items: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for item in items or []:
        value = str(item or "").strip()
        if not value or len(value) > 120 or value in seen:
            continue
        seen.add(value)
        out.append(value)
    return out[:80]


def _normalize_role_policy(data: dict[str, Any] | None = None) -> dict[str, Any]:
    data = data if isinstance(data, dict) else {}
    user_map = {**_default_user_capability_map()}
    project_map = {**_default_project_capability_map()}
    for role, capabilities in (data.get("user_capability_map") or {}).items():
        if role in USER_ROLES and isinstance(capabilities, list):
            user_map[role] = _dedupe_capabilities(capabilities)
    for role, capabilities in (data.get("project_capability_map") or {}).items():
        if role in PROJECT_MEMBER_ROLES and isinstance(capabilities, list):
            project_map[role] = _dedupe_capabilities(capabilities)
    return {
        "version": int(data.get("version") or 1),
        "user_capability_map": user_map,
        "project_capability_map": project_map,
        "notes": str(data.get("notes") or "租户级角色与项目成员角色可配置能力策略。"),
        "updated_at": str(data.get("updated_at") or ""),
        "updated_by": str(data.get("updated_by") or ""),
    }


def _load_role_policy(tenant_id: str) -> dict[str, Any]:
    p = _role_policy_path(tenant_id)
    if not p.is_file():
        return _normalize_role_policy()
    try:
        return _normalize_role_policy(json.loads(p.read_text(encoding="utf-8")))
    except Exception:
        return _normalize_role_policy()


def _save_role_policy(tenant_id: str, data: dict[str, Any]) -> None:
    p = _role_policy_path(tenant_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(_normalize_role_policy(data), ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _append_role_policy_history(tenant_id: str, event: dict[str, Any]) -> None:
    p = _role_policy_history_path(tenant_id)
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "id": event.get("id") or f"role-policy-{uuid4().hex[:12]}",
        "tenant_id": tenant_id,
        "created_at": event.get("created_at") or _now(),
        **event,
    }
    with p.open("a", encoding="utf-8") as f:
        f.write(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n")


def _read_role_policy_history(tenant_id: str, limit: int = 50) -> list[dict[str, Any]]:
    p = _role_policy_history_path(tenant_id)
    if not p.is_file():
        return []
    try:
        lines = [line.strip() for line in p.read_text(encoding="utf-8").splitlines() if line.strip()]
    except Exception:
        return []
    items: list[dict[str, Any]] = []
    for line in reversed(lines[-max(1, min(limit, 200)):]):
        try:
            item = json.loads(line)
            if isinstance(item, dict):
                items.append(item)
        except Exception:
            continue
    return items


def _severity_rank(severity: str) -> int:
    return {"high": 0, "medium": 1, "low": 2, "info": 3}.get(str(severity or "info"), 9)


def _access_review_findings(user: AuthUser, db: Session) -> dict[str, Any]:
    tid = user.tenant_id
    users = db.query(User).filter(User.tenant_id == tid).all()
    projects = db.query(Project).filter(Project.tenant_id == tid).all()
    members = (
        db.query(ProjectMember)
        .join(Project, Project.id == ProjectMember.project_id)
        .filter(Project.tenant_id == tid)
        .all()
    )
    user_by_id = {u.id: u for u in users}
    project_by_id = {p.id: p for p in projects}
    findings: list[dict[str, Any]] = []

    def add(
        kind: str,
        severity: str,
        title: str,
        description: str,
        *,
        project_id: str = "",
        owner: str = "",
        command: str = "",
        params: dict[str, Any] | None = None,
    ) -> None:
        findings.append({
            "id": f"{kind}-{uuid4().hex[:8]}",
            "kind": kind,
            "severity": severity,
            "title": title,
            "description": description,
            "params": params or {},
            "project_id": project_id,
            "project_name": getattr(project_by_id.get(project_id), "name", "") if project_id else "",
            "owner": owner,
            "command": command,
        })

    tenant_admins = [u for u in users if str(u.role or "") in {"super_admin", "tenant_admin"} and str(u.status or "active") == "active"]
    if len(tenant_admins) > 3:
        add(
            "tenant_admin_review",
            "medium",
            "租户管理员数量偏多",
            f"当前活跃 super_admin/tenant_admin 共 {len(tenant_admins)} 个，建议按最小权限原则定期复核。",
            command="sop ops org-access-review --json",
            params={"count": len(tenant_admins)},
        )
    for u in users:
        role = str(u.role or "")
        status = str(u.status or "active")
        if role not in USER_ROLES:
            add("unknown_user_role", "high", f"成员 {u.username} 使用未知租户角色", f"角色 {role or '-'} 不在平台标准角色集合中。", owner=u.username, params={"username": u.username, "role": role or "-"})
        if status != "active":
            user_memberships = [m for m in members if m.user_id == u.id]
            if user_memberships:
                add(
                    "disabled_user_membership",
                    "high",
                    f"禁用成员仍保留项目授权：{u.username}",
                    f"该成员已禁用，但仍拥有 {len(user_memberships)} 个项目成员关系，建议移除或恢复账号后再授权。",
                    owner=u.username,
                    params={"username": u.username, "count": len(user_memberships)},
                )

    for p in projects:
        p_members = [m for m in members if m.project_id == p.id]
        admins = [m for m in p_members if str(m.role or "") == "project_admin"]
        if str(p.status or "active") == "active" and not admins:
            add(
                "project_without_admin",
                "high",
                f"项目缺少项目管理员：{p.name}",
                "活跃项目没有 project_admin，AI 派单、成员授权和质量卡点审批容易无人负责。",
                project_id=p.id,
                command=f"sop project review --project-id {p.id} --json",
                params={"projectName": p.name},
            )
        if len(admins) > 5:
            add(
                "too_many_project_admins",
                "medium",
                f"项目管理员数量偏多：{p.name}",
                f"项目拥有 {len(admins)} 个 project_admin，建议按职责拆分和最小授权原则复核。",
                project_id=p.id,
                params={"projectName": p.name, "count": len(admins)},
            )
        for m in p_members:
            member_user = user_by_id.get(m.user_id)
            role = str(m.role or "")
            if role not in PROJECT_MEMBER_ROLES:
                add(
                    "unknown_project_role",
                    "high",
                    f"项目成员使用未知角色：{p.name}",
                    f"成员 {getattr(member_user, 'username', m.user_id)} 的项目角色 {role or '-'} 不在标准集合中。",
                    project_id=p.id,
                    owner=getattr(member_user, "username", m.user_id),
                    params={"projectName": p.name, "username": getattr(member_user, "username", m.user_id), "role": role or "-"},
                )
            if member_user and str(member_user.status or "active") != "active":
                add(
                    "disabled_project_member",
                    "high",
                    f"项目包含禁用成员：{p.name}",
                    f"成员 {member_user.username} 已禁用但仍保留项目角色 {role or '-'}。",
                    project_id=p.id,
                    owner=member_user.username,
                    params={"projectName": p.name, "username": member_user.username, "role": role or "-"},
                )

    policy = _load_role_policy(tid)
    empty_user_roles = [role for role, caps in (policy.get("user_capability_map") or {}).items() if not caps]
    empty_project_roles = [role for role, caps in (policy.get("project_capability_map") or {}).items() if not caps]
    if empty_user_roles or empty_project_roles:
        add(
            "empty_capability_policy",
            "medium",
            "存在空能力角色策略",
            f"租户角色 {','.join(empty_user_roles) or '-'}；项目角色 {','.join(empty_project_roles) or '-'} 未配置能力码。",
            command="sop ops org-policy --json",
            params={"userRoles": ",".join(empty_user_roles) or "-", "projectRoles": ",".join(empty_project_roles) or "-"},
        )

    findings.sort(key=lambda x: (_severity_rank(str(x.get("severity") or "")), str(x.get("title") or "")))
    counts: dict[str, int] = {"high": 0, "medium": 0, "low": 0, "info": 0}
    for item in findings:
        sev = str(item.get("severity") or "info")
        counts[sev] = counts.get(sev, 0) + 1
    score = max(0, 100 - counts.get("high", 0) * 18 - counts.get("medium", 0) * 8 - counts.get("low", 0) * 3)
    grade = "excellent" if score >= 90 else "good" if score >= 75 else "watch" if score >= 60 else "risk"
    return {
        "ok": True,
        "score": score,
        "grade": grade,
        "summary": {
            "users": len(users),
            "active_users": sum(1 for u in users if str(u.status or "active") == "active"),
            "tenant_admins": len(tenant_admins),
            "projects": len(projects),
            "project_members": len(members),
            "findings": len(findings),
            "by_severity": counts,
        },
        "findings": findings,
        "recommendations": [
            "优先处理 high 风险：禁用成员残留授权、项目缺少负责人、未知角色。",
            "将周期性权限体检结果任务化，纳入租户管理员或安全审计人员待办。",
            "AI/CLI 在自动派单前应读取 access-review 与 policy/check，避免把任务分配给不具备能力的角色。",
        ],
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 在派单、调度和执行敏感动作前识别组织权限风险。",
            "api": "GET /api/v1/organization/access-review",
            "tasks_api": "POST /api/v1/organization/access-review/tasks",
        },
    }


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
            {"id": "access-review", "path": "#/organization/access-review", "capability": "portfolio.organization.access-review"},
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
    role_policy = _load_role_policy(user.tenant_id)
    user_capability_map = role_policy["user_capability_map"]
    project_capability_map = role_policy["project_capability_map"]

    return {
        "ok": True,
        "configurable": True,
        "version": role_policy["version"],
        "notes": role_policy["notes"],
        "updated_at": role_policy["updated_at"],
        "updated_by": role_policy["updated_by"],
        "user_capability_map": user_capability_map,
        "project_capability_map": project_capability_map,
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
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 按 tenant_code、business_code、project_id 判断组织角色可执行能力边界。",
            "api": "/api/v1/organization/policy",
            "update_api": "PUT /api/v1/organization/policy",
            "reset_api": "POST /api/v1/organization/policy/reset",
            "check_api": "POST /api/v1/organization/policy/check",
            "history_api": "GET /api/v1/organization/policy/history",
        },
    }


@router.put("/policy")
def organization_policy_update(
    body: RolePolicyUpdateIn,
    user: AuthUser = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    current = _load_role_policy(user.tenant_id)
    current.update({
        "user_capability_map": body.user_capability_map,
        "project_capability_map": body.project_capability_map,
        "notes": body.notes,
        "updated_at": _now(),
        "updated_by": user.username,
    })
    _save_role_policy(user.tenant_id, current)
    _append_role_policy_history(user.tenant_id, {
        "action": "update",
        "updated_by": user.username,
        "notes": body.notes,
        "user_roles": len(current.get("user_capability_map") or {}),
        "project_roles": len(current.get("project_capability_map") or {}),
    })
    return organization_policy(user=user)


@router.post("/policy/reset")
def organization_policy_reset(
    user: AuthUser = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    reset = _normalize_role_policy({
        "notes": "已恢复为平台默认角色能力策略。",
        "updated_at": _now(),
        "updated_by": user.username,
    })
    _save_role_policy(user.tenant_id, reset)
    _append_role_policy_history(user.tenant_id, {
        "action": "reset",
        "updated_by": user.username,
        "notes": reset["notes"],
        "user_roles": len(reset.get("user_capability_map") or {}),
        "project_roles": len(reset.get("project_capability_map") or {}),
    })
    return organization_policy(user=user)


@router.post("/policy/check")
def organization_policy_check(
    body: RolePolicyCheckIn,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    policy = _load_role_policy(user.tenant_id)
    source = policy["project_capability_map"] if body.scope == "project" else policy["user_capability_map"]
    capabilities = source.get(body.role, [])
    allowed = body.capability in capabilities or "*" in capabilities
    return {
        "ok": True,
        "allowed": allowed,
        "decision": "allow" if allowed else "deny",
        "scope": body.scope,
        "role": body.role,
        "capability": body.capability,
        "matched_capabilities": capabilities,
        "tenant_id": user.tenant_id,
        "reason": "capability_matched" if allowed else "capability_not_found",
        "next": [
            "CLI/Agent 在领取任务或执行敏感操作前可调用本接口完成权限试算。",
            "若返回 deny，可由 tenant_admin 在角色策略中心补充能力码或调整任务分派。",
        ],
    }


@router.get("/policy/history")
def organization_policy_history(
    limit: int = 50,
    user: AuthUser = Depends(current_user),
) -> dict[str, Any]:
    items = _read_role_policy_history(user.tenant_id, limit=limit)
    return {
        "ok": True,
        "items": items,
        "total": len(items),
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 审计组织角色策略变更，判断能力边界是否近期发生变化。",
            "api": "/api/v1/organization/policy/history",
        },
    }


@router.get("/access-review")
def organization_access_review(
    user: AuthUser = Depends(current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    return _access_review_findings(user, db)


@router.post("/access-review/tasks")
def organization_access_review_tasks(
    body: AccessReviewTasksIn,
    user: AuthUser = Depends(require_role("tenant_admin")),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    review = _access_review_findings(user, db)
    projects = db.query(Project).filter(Project.tenant_id == user.tenant_id).all()
    fallback_project_id = projects[0].id if projects else ""
    candidates = [
        item for item in review.get("findings", [])
        if str(item.get("severity") or "") in {"high", "medium"}
    ][: body.limit]
    planned: list[dict[str, Any]] = []
    created: list[dict[str, Any]] = []
    now_dt = datetime.now(timezone.utc).replace(tzinfo=None)
    for item in candidates:
        project_id = str(item.get("project_id") or fallback_project_id)
        task = {
            "title": f"权限治理：{item.get('title')}",
            "description": "\n".join([
                str(item.get("description") or ""),
                "",
                f"风险级别: {item.get('severity')}",
                f"风险类型: {item.get('kind')}",
                f"责任对象: {item.get('owner') or '-'}",
                f"项目: {item.get('project_name') or project_id or '-'}",
                "",
                "建议命令:",
                str(item.get("command") or "sop ops org-access-review --json"),
            ]),
            "priority": "P0" if item.get("severity") == "high" else body.priority,
            "estimate": "S",
            "assigned_to": body.assigned_to,
            "project_id": project_id,
            "source": "organization_access_review",
            "source_report_id": str(item.get("id") or ""),
            "source_report_title": str(item.get("title") or ""),
        }
        planned.append(task)
        if not body.dry_run and project_id:
            task_id = f"T-ORG-{uuid4().hex[:12]}"
            row = Task(
                id=task_id,
                tenant_id=user.tenant_id,
                project_id=project_id,
                title=task["title"][:256],
                description=task["description"],
                status="pending",
                priority=task["priority"],
                estimate=task["estimate"],
                assigned_to=task["assigned_to"],
                created_at=now_dt,
                updated_at=now_dt,
            )
            db.add(row)
            created.append({"ok": True, "id": task_id, "project_id": project_id, "title": task["title"]})
    if not body.dry_run:
        db.commit()
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "items": planned,
        "created": created,
        "summary": {
            "planned": len(planned),
            "created": len(created),
            "skipped_without_project": sum(1 for item in planned if not item.get("project_id")),
        },
        "agent_consumption": {
            "purpose": "将组织权限体检发现转成可执行治理任务，纳入任务调度与 AI 开发流程。",
            "source": "organization_access_review",
        },
    }
