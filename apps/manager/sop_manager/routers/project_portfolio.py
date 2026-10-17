"""Read-only project portfolio over canonical, currently valid delivery facts."""

from __future__ import annotations

import base64
import json
from collections import Counter
from copy import deepcopy
from datetime import date, datetime, timezone

from fastapi import HTTPException
from sqlalchemy import or_

from .auth_sql import _norm_role, check_project_access, role_weight
from .delivery_progress_facts import capture_facts, fact_basis, metrics, select_scope
from .delivery_service import initial_state, reconcile, records
from .delivery_verification import VerificationContext
from .sql_models import Business, DeliveryWorkspace, Issue, Project, ProjectMember, Tenant

RISK_CODES = (
    "blocked",
    "awaiting_review",
    "recorded_completed",
    "overdue_unverified",
    "acceptance_unavailable",
    "owner_unavailable",
    "open_issues",
)


def _clock(value=None):
    value = value or datetime.now(timezone.utc)
    if isinstance(value, date) and not isinstance(value, datetime):
        value = datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _date(value):
    try:
        return date.fromisoformat(value) if isinstance(value, str) else None
    except ValueError:
        return None


def _target(project_id, kind="project", **values):
    return {
        "project_id": project_id,
        "kind": kind,
        "view": "issues"
        if kind == "issue"
        else "timeline"
        if kind == "milestone"
        else "overview"
        if kind == "project"
        else "list",
        "detail": "tasks" if kind == "task" else "details",
        **values,
    }


def _state(db, project, data=None):
    row = db.get(DeliveryWorkspace, project.id)
    raw = data if data is not None else row.data if row else initial_state()
    return row, reconcile(db, project, raw)


def project_facts(db, project, data=None, *, as_of=None):
    """No writes or runtime access; historical archive facts never substitute for current evidence."""
    from .delivery_execution import CLOSED

    now = _clock(as_of)
    _row, effective = _state(db, project, data)
    scoped = select_scope(capture_facts(db, project))
    verification = VerificationContext(db, project, effective)
    risks = []
    for task in scoped["tasks"]:
        categories = [code for code in RISK_CODES[:3] if task["status"] == code]
        due = _date(task["ends_on"])
        if task["status"] != "verified_completed":
            if due and due < now.date():
                categories.append("overdue_unverified")
            acceptance = task["acceptance"]
            if not acceptance["available"] or not acceptance["criteria"]:
                categories.append("acceptance_unavailable")
            canonical = verification.tasks[task["id"]]
            owner = verification.owner(canonical)
            if not owner or not owner["available"]:
                categories.append("owner_unavailable")
        if categories:
            risks.append(
                {
                    "id": "task:" + task["id"],
                    "entity_kind": "task",
                    "entity_id": task["id"],
                    "title": task["title"],
                    "categories": categories,
                    "due_on": task["ends_on"],
                    "target": _target(
                        project.id, "task", requirement_id=task["req_id"] or None, task_id=task["id"]
                    ),
                }
            )
    for requirement in scoped["requirements"]:
        flow = effective.get("flows", {}).get(requirement["id"], {})
        categories = ["blocked"] if flow.get("blocked_reason") else []
        due = _date(flow.get("due_on"))
        if not requirement["accepted"] and due and due < now.date():
            categories.append("overdue_unverified")
        if categories:
            risks.append(
                {
                    "id": "requirement:" + requirement["id"],
                    "entity_kind": "requirement",
                    "entity_id": requirement["id"],
                    "title": requirement["title"],
                    "categories": categories,
                    "due_on": due.isoformat() if due else None,
                    "target": _target(project.id, "requirement", requirement_id=requirement["id"]),
                }
            )
    issues = records(db, Issue, project).order_by(Issue.id).all()
    for issue in issues:
        if issue.status not in {"resolved", "closed"}:
            risks.append(
                {
                    "id": "issue:" + issue.id,
                    "entity_kind": "issue",
                    "entity_id": issue.id,
                    "title": issue.title,
                    "categories": ["open_issues"],
                    "due_on": None,
                    "target": _target(project.id, "issue", issue_id=issue.id),
                }
            )
    risks.sort(key=lambda item: (item["entity_kind"], item["entity_id"]))
    counts = {code: sum(code in item["categories"] for item in risks) for code in RISK_CODES}
    counts["total_items"] = len(risks)
    milestones = [m for m in effective.get("milestones", []) if _date(m.get("ends_on"))]
    upcoming = [m for m in milestones if _date(m["ends_on"]) >= now.date()]
    nearest = min(upcoming, key=lambda m: (m["ends_on"], m["id"]), default=None)
    nearest = (
        None
        if nearest is None
        else {
            "id": nearest["id"],
            "title": nearest["title"],
            "starts_on": nearest.get("starts_on"),
            "ends_on": nearest["ends_on"],
            "target": _target(project.id, "milestone", milestone_id=nearest["id"]),
        }
    )
    intents = [entry for entry in effective.get("executions", []) if entry["status"] not in CLOSED]
    from .delivery_deployment import active_deployment_ids

    deployment_ids = active_deployment_ids(effective)
    basis = fact_basis(
        {
            "progress_basis": scoped["basis"],
            "utc_day": now.date().isoformat(),
            "risks": risks,
            "intents": intents,
            "active_deployment_ids": deployment_ids,
            "milestones": effective.get("milestones", []),
        }
    )
    return {
        "as_of": now.isoformat().replace("+00:00", "Z"),
        "basis": basis,
        "metrics": scoped["metrics"],
        "risk_counts": counts,
        "unclosed_intents_total": len(intents) + len(deployment_ids),
        "nearest_milestone": nearest,
        "risks": risks,
    }


def visible_projects(db, user):
    query = db.query(Project).filter(Project.tenant_id == user.tenant_id)
    if _norm_role(user.role) not in {"super_admin", "tenant_admin"}:
        query = query.filter(
            Project.id.in_(db.query(ProjectMember.project_id).filter(ProjectMember.user_id == user.id))
        )
    return query


def project_capabilities(db, project, user):
    from .delivery import _permissions

    permissions = _permissions(db, user, project)
    lifecycle = permissions["lifecycle"]
    archived = project.status == "archived"
    return {
        "can_enter": True,
        "can_write": permissions["write"] and not archived,
        "can_dispatch": permissions["write"] and project.status == "active",
        "can_configure": permissions["configure"] and not archived,
        "can_transition": lifecycle,
        "can_archive": lifecycle and not archived,
        "can_restore": lifecycle and archived,
    }


def _project_row(db, project, user, version):
    tenant = db.get(Tenant, project.tenant_id)
    business = db.get(Business, project.business_id) if project.business_id else None
    return {
        "id": project.id,
        "tenant_id": project.tenant_id,
        "tenant_code": tenant.slug if tenant and tenant.slug else project.tenant_id,
        "business_id": project.business_id,
        "business_code": business.id if business else "",
        "business_name": business.name if business else "",
        "project_code": project.id,
        "name": project.name,
        "description": project.description or "",
        "project_path": project.project_path or "",
        "vector_db": project.vector_db or "lance",
        "is_template": bool(project.is_template),
        "template_id": project.template_id or "",
        "status": project.status,
        "version": version,
        "created_at": project.created_at.isoformat() + "Z" if project.created_at else "",
        "updated_at": project.updated_at.isoformat() + "Z" if project.updated_at else "",
        "permissions": project_capabilities(db, project, user),
    }


def _detail(db, user, project, now):
    row = db.get(DeliveryWorkspace, project.id)
    facts = project_facts(db, project, as_of=now)
    return {
        "project": _project_row(db, project, user, row.version if row else 0),
        "facts_source": "live",
        "facts_as_of": facts["as_of"],
        "basis": facts["basis"],
        **{
            key: facts[key]
            for key in ("metrics", "risk_counts", "unclosed_intents_total", "nearest_milestone", "risks")
        },
        "primary_target": _target(project.id),
        "lifecycle": {
            "last_archive": deepcopy((row.data.get("lifecycle") or {}).get("last_archive")) if row else None
        },
    }


def project_detail(db, user, project_id):
    project = visible_projects(db, user).filter(Project.id == project_id).first()
    if not project:
        raise HTTPException(404, "Project not found in the current tenant and membership scope")
    check_project_access(user, project.id, db)
    return _detail(db, user, project, _clock())


def _cursor(value, basis):
    if not value:
        return ""
    try:
        decoded = json.loads(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)))
        if (
            set(decoded) != {"basis", "after"}
            or decoded["basis"] != basis
            or not isinstance(decoded["after"], str)
        ):
            raise ValueError
        return decoded["after"]
    except (ValueError, TypeError, UnicodeError, json.JSONDecodeError) as exc:
        raise HTTPException(422, "Portfolio cursor does not match this query and access scope") from exc


def portfolio(db, user, *, q="", business_id=None, status=(), risk=(), cursor="", limit=30):
    """Filter the complete authorized fact set before exact counts and stable-ID pagination."""
    status, risk = status or (), risk or ()
    if (
        not 1 <= limit <= 100
        or set(status) - {"planning", "active", "paused", "archived"}
        or set(risk) - set(RISK_CODES)
    ):
        raise HTTPException(422, "Invalid portfolio filter or page size")
    query = visible_projects(db, user)
    if q.strip():
        query = query.filter(
            or_(
                Project.name.contains(q.strip(), autoescape=True),
                Project.id.contains(q.strip(), autoescape=True),
            )
        )
    if business_id is not None:
        query = query.filter(Project.business_id == business_id)
    if status:
        query = query.filter(Project.status.in_(status))
    scope = fact_basis(
        {
            "tenant": user.tenant_id,
            "actor": user.id,
            "q": q.strip(),
            "business_id": business_id,
            "status": sorted(set(status)),
            "risk": sorted(set(risk)),
        }
    )
    after = _cursor(cursor, scope)
    now = _clock()
    details = [_detail(db, user, project, now) for project in query.order_by(Project.id).all()]
    if risk:
        details = [row for row in details if any(row["risk_counts"][code] for code in risk)]
    empty_metrics = metrics([], [])
    summary_metrics = {
        key: {status: sum(row["metrics"][key][status] for row in details) for status in value}
        if isinstance(value, dict)
        else sum(row["metrics"][key] for row in details)
        for key, value in empty_metrics.items()
    }
    summary = {
        "projects_total": len(details),
        "status_counts": dict(Counter(row["project"]["status"] for row in details)),
        "metrics": summary_metrics,
        "risk_counts": {
            code: sum(row["risk_counts"][code] for row in details) for code in (*RISK_CODES, "total_items")
        },
    }
    page = [row for row in details if row["project"]["id"] > after][: limit + 1]
    more, page = len(page) > limit, page[:limit]
    next_cursor = (
        base64.urlsafe_b64encode(json.dumps({"basis": scope, "after": page[-1]["project"]["id"]}).encode())
        .decode()
        .rstrip("=")
        if more
        else None
    )
    return {
        "as_of": now.isoformat().replace("+00:00", "Z"),
        "rows": [
            {key: value for key, value in row.items() if key not in {"risks", "lifecycle"}} for row in page
        ],
        "total": len(details),
        "next_cursor": next_cursor,
        "limit": limit,
        "summary": summary,
        "summary_scope": "filtered_projects",
        "permissions": {"can_create": role_weight(user.role) <= role_weight("project_admin")},
    }
