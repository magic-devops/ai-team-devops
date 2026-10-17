"""Transactional delivery actions over existing Manager business entities."""

from __future__ import annotations

import hashlib
import json
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException
from sqlalchemy import and_, or_

from .delivery_contract import STAGE_IDS, default_flow, stage_gates
from .sql_models import Issue, ProjectMember, Requirement, Task, User


def stamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def identifier(prefix):
    return f"{prefix}-{uuid4().hex[:16]}"


def initial_state():
    return {
        "project": {},
        "members": [],
        "milestones": [],
        "resources": [],
        "flows": {},
        "task_owners": {},
        "task_details": {},
    }


def serialize(row):
    return {
        c.name: (v.isoformat() + "Z" if isinstance(v := getattr(row, c.name), datetime) else v)
        for c in row.__table__.columns
    }


def records(db, model, project):
    return db.query(model).filter_by(tenant_id=project.tenant_id, project_id=project.id)


def get_record(db, model, project, rid):
    row = records(db, model, project).filter_by(id=rid).first()
    if not row:
        raise HTTPException(404, "Record not found in this project")
    return row


def members(db, project, data, user):
    people = (
        db.query(User, ProjectMember.role)
        .outerjoin(
            ProjectMember, and_(ProjectMember.user_id == User.id, ProjectMember.project_id == project.id)
        )
        .filter(
            User.tenant_id == project.tenant_id,
            User.status == "active",
            or_(ProjectMember.project_id == project.id, User.role.in_(["tenant_admin", "super_admin"])),
        )
        .order_by(User.id)
        .all()
    )
    result = [
        {
            "id": f"user:{u.id}",
            "name": u.username,
            "kind": "human",
            "role": role or u.role,
            "tool": "",
            "capacity": 5,
            "active": True,
        }
        for u, role in people
    ]
    return result + data["members"]


def validate_owner(owner, roster):
    if not owner:
        return ""
    member = next((m for m in roster if m["id"] == owner and m["active"] and m["kind"] != "tool"), None)
    if not member:
        raise HTTPException(422, "Choose an active project member or agent")
    return member["name"]


def invalidate(flow):
    flow["revision"] += 1
    flow["stage"] = "intake"
    flow["closed"] = False
    flow.pop("accepted_work", None)
    flow.pop("tested_work", None)


def _fingerprint(value):
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, ensure_ascii=False, default=str).encode()
    ).hexdigest()


def reconcile(db, project, state):
    """Legacy APIs still edit canonical rows; never reuse approvals against changed scope.

    Reads return an effective view without writing. The next delivery command persists
    the invalidation and its reason in the same versioned transaction.
    """
    data = deepcopy(state)
    tasks = [serialize(t) for t in records(db, Task, project).order_by(Task.id).all()]
    for req in records(db, Requirement, project).all():
        flow = data["flows"].get(req.id)
        if not flow:
            continue
        definition = _fingerprint([req.title, req.description, req.acceptance_criteria])
        work = _fingerprint(
            [
                {k: t[k] for k in ("id", "title", "description", "status", "assigned_to")}
                for t in tasks
                if t["req_id"] == req.id
            ]
        )
        changed = flow.get("definition", definition) != definition or (
            flow["stage"] in {"testing", "acceptance", "release", "operations"}
            and flow.get("tested_work", work) != work
        )
        if changed:
            flow["reviews"].append(
                {
                    "stage": flow["stage"],
                    "revision": flow["revision"],
                    "decision": "reopen",
                    "actor": "system",
                    "comment": "Canonical requirement or accepted work changed outside this workbench.",
                    "at": stamp(),
                }
            )
            invalidate(flow)
        flow["definition"] = definition
    _reconcile_execution_evidence(db, project, data)
    return data


def _reconcile_execution_evidence(db, project, data):
    from .delivery_execution import basis

    tasks = {t.id: t for t in records(db, Task, project).all()}
    requirements = {r.id: r for r in records(db, Requirement, project).all()}
    executions = data.get("executions", [])
    latest = {entry["task_id"]: entry for entry in executions}
    runs = {entry["run_id"]: entry for entry in executions if entry.get("run_id")}
    for entry in executions:
        task = tasks.get(entry["task_id"])
        req = requirements.get(entry["snapshot"]["requirement_id"])
        revision = data["flows"].get(req.id, default_flow())["revision"] if req else 0
        entry["stale"] = (
            bool(entry.get("planning_invalidated"))
            or not task
            or not req
            or basis(task, req, revision) != entry["snapshot"]
        )
    for flow in data["flows"].values():
        for artifact in flow["artifacts"]:
            if artifact.get("source") == "execution-runtime":
                entry = runs.get(artifact.get("run_id"))
                artifact["stale"] = (
                    not entry
                    or entry["status"] != "accepted"
                    or entry["stale"]
                    or latest[entry["task_id"]]["id"] != entry["id"]
                )


def remember_basis(db, project, data):
    tasks = [serialize(t) for t in records(db, Task, project).order_by(Task.id).all()]
    for req in records(db, Requirement, project).all():
        flow = data["flows"].get(req.id)
        if not flow:
            continue
        flow["definition"] = _fingerprint([req.title, req.description, req.acceptance_criteria])
        if flow["stage"] in {"testing", "acceptance", "release", "operations"}:
            flow["tested_work"] = _fingerprint(
                [
                    {k: t[k] for k in ("id", "title", "description", "status", "assigned_to")}
                    for t in tasks
                    if t["req_id"] == req.id
                ]
            )


def materialize(db, project, data, user):
    from .delivery_verification import VerificationContext

    verification = VerificationContext(db, project, data)
    roster = verification.roster
    tasks = [serialize(t) for t in records(db, Task, project).order_by(Task.created_at, Task.id).all()]
    for task in tasks:
        task["basis"] = verification.basis(task["id"])
        latest = next((e for e in reversed(data.get("executions", [])) if e["task_id"] == task["id"]), None)
        task["execution_id"] = latest["id"] if latest else ""
        if (
            latest
            and (latest["status"] != "accepted" or latest.get("stale"))
            and task["status"] == "completed"
        ):
            task["status"] = "in_progress"
        task["owner_id"] = data["task_owners"].get(task["id"], "")
        task["owner_explicit"] = task["id"] in data.get("task_owners", {})
        candidates = [
            m
            for m in roster
            if m["active"]
            and m["kind"] != "tool"
            and m["name"] == task["assigned_to"]
            and (not task["owner_id"] or task["owner_id"] == m["id"])
        ]
        task["owner_active"] = len(candidates) == 1
        if task["owner_active"]:
            task["owner_id"] = candidates[0]["id"]
        task["planning"] = deepcopy(data.get("task_details", {}).get(task["id"], {}))
    from .delivery_plan import dependency_status, requirement_basis

    blockers = dependency_status(db, project, data)
    for task in tasks:
        task["dependency_blocked"] = blockers.get(task["id"], [])
        if (
            task["planning"].get("blocked_reason")
            or task["dependency_blocked"]
            and task["status"] == "completed"
        ):
            task["status"] = "blocked"
    issues = [serialize(i) for i in records(db, Issue, project).order_by(Issue.created_at.desc()).all()]
    reqs = []
    for row in (
        records(db, Requirement, project).order_by(Requirement.created_at.desc(), Requirement.id).all()
    ):
        req = serialize(row)
        req["basis"] = requirement_basis(row)
        flow = deepcopy(data["flows"].get(row.id, default_flow()))
        flow["legacy_completed"] = row.status == "completed" and row.id not in data["flows"]
        flow["gates"] = stage_gates(req, flow, tasks, issues)
        req["flow"] = flow
        req["tasks_total"] = sum(t["req_id"] == row.id for t in tasks)
        req["tasks_done"] = sum(t["req_id"] == row.id and t["status"] == "completed" for t in tasks)
        reqs.append(req)
    summary = {
        "requirements": len(reqs),
        "tasks": len(tasks),
        "tasks_done": sum(t["status"] == "completed" for t in tasks),
        "blocked": sum(bool(r["flow"].get("blocked_reason")) for r in reqs)
        + sum(t["status"] == "blocked" for t in tasks),
        "accepted": sum(STAGE_IDS.index(r["flow"]["stage"]) >= STAGE_IDS.index("release") for r in reqs),
        "released": sum(r["flow"]["stage"] == "operations" for r in reqs),
        "open_issues": sum(i["status"] not in {"resolved", "closed"} for i in issues),
    }
    summary["acceptance_rate"] = round(summary["accepted"] / len(reqs) * 100) if reqs else 0
    from .delivery_resources import project_view

    return {
        "project": project_view(project, data),
        "requirements": reqs,
        "tasks": tasks,
        "issues": issues,
        "members": roster,
        "milestones": data["milestones"],
        "resources": data.get("resources", []),
        "executions": data.get("executions", []),
        "summary": summary,
    }


def _create_task(db, project, data, requirement, draft, roster, task_id=None):
    if data["flows"].get(requirement.id, {}).get("stage") in {"release", "operations"}:
        raise HTTPException(409, "Reopen the requirement before changing accepted scope")
    planning_fields = {"key", "acceptance_criteria", "depends_on", "starts_on", "ends_on", "blocked_reason"}
    values = draft.model_dump(exclude={"requirement_id", "owner_id", *planning_fields})
    row = Task(
        id=task_id or identifier("T"),
        tenant_id=project.tenant_id,
        project_id=project.id,
        req_id=requirement.id,
        assigned_to=validate_owner(draft.owner_id, roster),
        status="blocked" if draft.blocked_reason else "pending",
        **values,
    )
    data["task_owners"][row.id] = draft.owner_id
    data.setdefault("task_details", {})[row.id] = draft.model_dump(mode="json", include=planning_fields)
    flow = data["flows"].get(requirement.id, {})
    if flow.get("stage") in {"testing", "acceptance"}:
        invalidate(flow)
        requirement.status = "pending"
    db.add(row)
    return row.id


def apply_action(db, project, user, data, action, body):
    roster = members(db, project, data, user)
    values = body.model_dump(mode="json")
    resource_id = project.id
    before = None
    if action == "project.update":
        from .delivery_resources import update_project

        if "owner_id" in body.model_fields_set:
            validate_owner(body.owner_id, roster)
        return update_project(project, data, body)
    elif action.startswith("resource."):
        from .delivery_resources import apply_resource

        return apply_resource(data, user, action, body)
    elif action in {"member.save", "milestone.save"}:
        return _save_entry(data, action, body, roster, values)
    elif action == "requirement.create":
        validate_owner(body.owner_id, roster)
        _milestone(body.milestone_id, data)
        resource_id = identifier("REQ")
        row = Requirement(
            id=resource_id,
            tenant_id=project.tenant_id,
            project_id=project.id,
            status="pending",
            **body.model_dump(exclude={"owner_id", "due_on", "milestone_id"}),
        )
        db.add(row)
        data["flows"][resource_id] = {
            **default_flow(),
            "owner_id": body.owner_id,
            "due_on": values["due_on"],
            "milestone_id": body.milestone_id,
        }
    elif action == "requirement.update":
        return _update_requirement(db, project, data, body, roster, values)
    elif action in {"task.create", "tasks.plan"}:
        from .delivery_plan import apply_plan, validate_plan

        req = get_record(db, Requirement, project, body.requirement_id)
        if action == "tasks.plan":
            return apply_plan(db, project, user, data, req, body, roster)
        validate_plan(db, project, data, req, [body], roster)
        resource_id = _create_task(db, project, data, req, body, roster)
    elif action == "task.update":
        return _update_task(db, project, data, body, roster)
    elif action == "issue.promote":
        return _promote_issue(db, project, data, body)
    else:
        return _apply_lifecycle(db, project, user, data, action, body, values)
    return resource_id, before


def _save_entry(data, action, body, roster, values):
    before = None
    collection = "members" if action == "member.save" else "milestones"
    if collection == "milestones":
        validate_owner(body.owner_id, roster)
    if body.id and not any(x["id"] == body.id for x in data[collection]):
        raise HTTPException(404, "Entry not found")
    resource_id = body.id or identifier("member" if collection == "members" else "milestone")
    values["id"] = resource_id
    data[collection] = [x for x in data[collection] if x["id"] != resource_id] + [values]
    return resource_id, before


def _update_requirement(db, project, data, body, roster, values):
    row = get_record(db, Requirement, project, body.id)
    before = serialize(row)
    resource_id = row.id
    flow = data["flows"].setdefault(row.id, default_flow())
    changes = body.model_dump(exclude_unset=True, exclude={"id"})
    if "owner_id" in changes:
        validate_owner(body.owner_id, roster)
    if "milestone_id" in changes:
        _milestone(body.milestone_id, data)
    content_changed = any(
        k in changes and changes[k] is not None and changes[k] != getattr(row, k)
        for k in ("title", "description", "acceptance_criteria")
    )
    for key, value in changes.items():
        if key in {"owner_id", "due_on", "milestone_id", "blocked_reason"}:
            flow[key] = values[key]
        elif value is not None:
            setattr(row, key, value)
    if content_changed:
        invalidate(flow)
        row.status = "pending"
    return resource_id, before


def _update_task(db, project, data, body, roster):
    from .delivery_plan import edit_task_links

    row = get_record(db, Task, project, body.id)
    if body.task_basis is not None:
        from .delivery_verification import VerificationContext

        if body.task_basis != VerificationContext(db, project, data).basis(row.id):
            raise HTTPException(
                409,
                {
                    "code": "task_basis_changed",
                    "message": "Task scope changed. Review and explicitly adopt the latest task basis.",
                },
            )
    before = serialize(row)
    changes = body.model_dump(mode="json", exclude_unset=True)
    planning = data.setdefault("task_details", {}).setdefault(row.id, {})
    if "starts_on" in changes or "ends_on" in changes:
        start = changes.get("starts_on", planning.get("starts_on"))
        end = changes.get("ends_on", planning.get("ends_on"))
        planning.update(starts_on=start, ends_on=end)
    if "blocked_reason" in changes:
        planning["blocked_reason"] = body.blocked_reason or ""
    links_changed = edit_task_links(db, project, data, row, body)
    if body.status in {"in_progress", "completed"}:
        from .delivery_plan import require_dependencies

        require_dependencies(db, project, data, row.id)
    if body.status == "completed" and any(e["task_id"] == row.id for e in data.get("executions", [])):
        raise HTTPException(409, "Complete managed executions through evidence review")
    resource_id = row.id
    flow = data["flows"].get(row.req_id, {})
    if flow.get("stage") in {"release", "operations"}:
        raise HTTPException(409, "Reopen the requirement before changing accepted work")
    if body.owner_id is not None:
        row.assigned_to = validate_owner(body.owner_id, roster)
        data["task_owners"][row.id] = body.owner_id
    if body.status is not None:
        row.status = body.status
    if body.description is not None:
        row.description = body.description
    if planning.get("blocked_reason"):
        row.status = "blocked"
    if flow.get("stage") in {"testing", "acceptance"} and (
        links_changed
        or any(before[key] != getattr(row, key) for key in ("description", "status", "assigned_to"))
    ):
        invalidate(flow)
        get_record(db, Requirement, project, row.req_id).status = "pending"
        if links_changed:
            planning["requirement_revision"] = flow["revision"]
    return resource_id, before


def _promote_issue(db, project, data, body):
    before = None
    issue = get_record(db, Issue, project, body.issue_id)
    existing = next(
        (rid for rid, flow in data["flows"].items() if flow.get("source_issue_id") == issue.id), None
    )
    if existing and records(db, Requirement, project).filter_by(id=existing).first():
        return existing, None
    resource_id = identifier("REQ")
    db.add(
        Requirement(
            id=resource_id,
            tenant_id=project.tenant_id,
            project_id=project.id,
            title=issue.title,
            description=issue.description,
            priority=issue.severity if issue.severity in {"P0", "P1", "P2", "P3"} else "P1",
            status="pending",
            acceptance_criteria=body.acceptance_criteria,
            tags=["issue-feedback"],
        )
    )
    data["flows"][resource_id] = {**default_flow(), "source_issue_id": issue.id}
    return resource_id, before


def _add_evidence(row, flow, user, action, body, values):
    if flow["closed"] or flow["stage"] == "operations" and action == "release.save":
        raise HTTPException(409, "Reopen before modifying a completed delivery")
    collection = "artifacts" if action == "artifact.add" else "releases"
    if action == "artifact.add" and body.kind != "test" and body.result == "failed":
        target = {
            "prd": "product",
            "prototype": "ux",
            "architecture": "architecture",
            "code": "development",
            "runbook": "operations",
        }[body.kind]
        if STAGE_IDS.index(flow["stage"]) > STAGE_IDS.index(target):
            invalidate(flow)
            row.status = "pending"
    values.pop("requirement_id")
    flow[collection].append(
        {
            **values,
            "id": identifier("evidence"),
            "revision": flow["revision"],
            "actor": user.id,
            "at": stamp(),
            "source": "manual",
        }
    )
    if (
        action == "artifact.add"
        and body.kind == "test"
        and body.result == "failed"
        and flow["stage"] in {"acceptance", "release", "operations"}
    ):
        flow["stage"] = "testing"
        row.status = "in_progress"


def _apply_lifecycle(db, project, user, data, action, body, values):
    before = None
    row = get_record(db, Requirement, project, body.requirement_id)
    resource_id = row.id
    flow = data["flows"].setdefault(row.id, default_flow())
    if action == "stage.reopen":
        flow["reviews"].append(
            {
                "stage": flow["stage"],
                "revision": flow["revision"],
                "decision": "reopen",
                "actor": user.id,
                "comment": body.comment,
                "at": stamp(),
            }
        )
        invalidate(flow)
        row.status = "pending"
    elif action in {"artifact.add", "release.save"}:
        _add_evidence(row, flow, user, action, body, values)
    elif action == "stage.advance":
        if flow["closed"]:
            raise HTTPException(409, "Delivery already closed")
        snapshot = materialize(db, project, data, user)
        gates = stage_gates(serialize(row), flow, snapshot["tasks"], snapshot["issues"])
        missing = [g["id"] for g in gates if not g["ok"]]
        if missing:
            raise HTTPException(422, {"code": "stage_gates", "missing": missing})
        stage = flow["stage"]
        flow["reviews"].append(
            {
                "stage": stage,
                "revision": flow["revision"],
                "decision": "approved",
                "actor": user.id,
                "comment": body.comment,
                "at": stamp(),
            }
        )
        if stage == "operations":
            flow["closed"] = True
        else:
            flow["stage"] = STAGE_IDS[STAGE_IDS.index(stage) + 1]
        row.status = (
            "completed" if STAGE_IDS.index(flow["stage"]) >= STAGE_IDS.index("release") else "in_progress"
        )
    return resource_id, before


def _milestone(mid, data):
    if mid and not any(m["id"] == mid for m in data["milestones"]):
        raise HTTPException(422, "Choose a milestone from this project")
