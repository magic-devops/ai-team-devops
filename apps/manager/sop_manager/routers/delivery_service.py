"""Transactional delivery actions over existing Manager business entities."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from copy import deepcopy
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import HTTPException

from .delivery_contract import STAGE_IDS, default_flow, stage_gates
from .delivery_task_contract import snapshots_match
from .delivery_team import TeamContext, semantic_owner
from .sql_models import Issue, Requirement, Task


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
        "task_details": {},
        "member_calendars": {},
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
    return TeamContext(db, project, data).roster


def validate_owner(owner, roster):
    if not owner:
        return ""
    member = next(
        (
            m
            for m in roster
            if m["id"] == owner and m["active"] and m.get("available") and m["kind"] in {"human", "agent"}
        ),
        None,
    )
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


def _work_fingerprint(tasks, team, requirement_id):
    return _fingerprint(
        [
            {
                **{
                    key: task[key]
                    for key in ("id", "title", "description", "acceptance_criteria", "status", "owner_id")
                },
                "owner": semantic_owner(team.resolve_owner(task["owner_id"])),
            }
            for task in tasks
            if task["req_id"] == requirement_id
        ]
    )


def reconcile(db, project, state, *, verification=None):
    """Legacy APIs still edit canonical rows; never reuse approvals against changed scope.

    Reads return an effective view without writing. The next delivery command persists
    the invalidation and its reason in the same versioned transaction.
    """
    from .delivery_verification import VerificationContext

    data = verification.data if verification is not None else deepcopy(state)
    context = verification or VerificationContext(db, project, data)
    tasks = defaultdict(list)
    for task in sorted(context.tasks.values(), key=lambda row: row.id):
        tasks[task.req_id].append(serialize(task))
    for req in context.requirements.values():
        flow = data["flows"].get(req.id)
        if not flow:
            continue
        definition = _fingerprint([req.title, req.description, req.acceptance_criteria])
        work = _work_fingerprint(tasks[req.id], context.team, req.id)
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
    _reconcile_execution_evidence(db, project, data, context=context)
    context.reset_proof()
    from .delivery_release import reconcile_releases

    reconcile_releases(db, project, data, verification=context)
    context.reset_proof()
    return data


def _reconcile_execution_evidence(db, project, data, *, context=None):
    from .delivery_verification import VerificationContext

    context = context or VerificationContext(db, project, data)
    executions = data.get("executions", [])
    latest = {entry["task_id"]: entry for entry in executions}
    runs = {entry["run_id"]: entry for entry in executions if entry.get("run_id")}
    for entry in executions:
        if context.pending_executor_binding_invalidated(entry):
            entry["executor_binding_invalidated"] = True
        definition = context.definition(entry["task_id"])
        entry["stale"] = (
            bool(entry.get("planning_invalidated"))
            or not definition
            or not definition["execution_gate"]["eligible"]
            or not definition["snapshot"]["owner"]
            or not definition["snapshot"]["owner"]["available"]
            or not snapshots_match(definition["snapshot"], entry["snapshot"])
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
                    or entry["task_id"] in context.latest_submissions
                    and not context.latest_submissions[entry["task_id"]]["invalidated"]
                )
            elif artifact.get("source") == "external-delivery":
                task_id = artifact.get("task_id")
                review = context.reviews.get(task_id)
                proof = context.external_proofs.get(review.id) if review else None
                artifact["stale"] = bool(not proof or proof["id"] != artifact.get("submission_id")
                    or review.id != artifact.get("review_id") or proof["submission_digest"] != artifact.get("evidence_sha256")
                    or not context.external_accepted(task_id))


def remember_basis(db, project, data):
    tasks = defaultdict(list)
    for task in records(db, Task, project).order_by(Task.id).all():
        tasks[task.req_id].append(serialize(task))
    team = TeamContext(db, project, data)
    for req in records(db, Requirement, project).all():
        flow = data["flows"].get(req.id)
        if not flow:
            continue
        flow["definition"] = _fingerprint([req.title, req.description, req.acceptance_criteria])
        if flow["stage"] in {"testing", "acceptance", "release", "operations"}:
            flow["tested_work"] = _work_fingerprint(tasks[req.id], team, req.id)


def materialize(db, project, data, user, *, verification=None, progress_only=False):
    from .delivery_deployment_facts import current_deployed_requirement_ids
    from .delivery_verification import VerificationContext

    verification = verification or VerificationContext(db, project, data)
    roster = verification.roster
    tasks = [
        serialize(t) for t in sorted(verification.tasks.values(), key=lambda row: (row.created_at, row.id))
    ]
    for task in tasks:
        task["recorded_status"] = task["status"]
        task["basis"] = verification.basis(task["id"])
        task["designs"] = verification.definition(task["id"])["snapshot"]["designs"]
        task["design_basis"] = verification.definition(task["id"])["snapshot"]["design_basis"]
        task["acceptance"] = verification.definition(task["id"])["acceptance"]
        task["execution_gate"] = verification.execution_gate(task["id"])
        task["delivery_status"] = verification.delivery_status(task["id"])
        task["verified"] = verification.verified(task["id"])
        latest = verification.executions.get(task["id"])
        task["execution_id"] = latest["id"] if latest else ""
        if (
            latest
            and (latest["status"] != "accepted" or latest.get("stale"))
            and task["status"] == "completed"
            and not verification.external_accepted(task["id"])
        ):
            task["status"] = "in_progress"
        task["owner"] = verification.owner(verification.tasks[task["id"]])
        task["owner_active"] = bool(task["owner"] and task["owner"]["available"])
        task["assigned_to"] = (task["owner"] or {}).get("name") or ""
        task["planning"] = deepcopy(data.get("task_details", {}).get(task["id"], {}))
    from .delivery_plan import requirement_basis

    blockers = {tid: verification.blocked(tid) for tid in verification.tasks}
    for task in tasks:
        task["dependency_blocked"] = blockers.get(task["id"], [])
        if (
            task["planning"].get("blocked_reason")
            or task["dependency_blocked"]
            and task["status"] == "completed"
        ):
            task["status"] = "blocked"
    issues = [
        (
            {key: getattr(i, key) for key in ("id", "task_id", "title", "severity", "status")}
            if progress_only
            else serialize(i)
        )
        for i in sorted(verification.issues, key=lambda row: row.created_at, reverse=True)
    ]
    task_groups, issue_groups = defaultdict(list), defaultdict(list)
    for task in tasks:
        task_groups[task["req_id"]].append(task)
    requirement_by_task = {task["id"]: task["req_id"] for task in tasks}
    for issue in issues:
        issue_groups[requirement_by_task.get(issue["task_id"])].append(issue)
    from sqlalchemy import select

    from .sql_models import IssueEventOrigin

    event_issue_ids = (
        set()
        if progress_only
        else set(
            db.scalars(
                select(IssueEventOrigin.issue_id)
                .where(
                    IssueEventOrigin.tenant_id == project.tenant_id, IssueEventOrigin.project_id == project.id
                )
                .distinct()
            )
        )
    )
    from .delivery_issue_sources import external_issue_ids

    reported_issue_ids = set() if progress_only else external_issue_ids(db, project)
    for issue in issues:
        issue["source_kinds"] = [
            kind
            for kind, collection in (("execution", "executions"), ("deployment", "deployments"))
            if any(entry.get("issue_id") == issue["id"] for entry in data.get(collection, []))
        ]
        if issue["id"] in event_issue_ids:
            issue["source_kinds"].append("event")
        if issue["id"] in reported_issue_ids:
            issue["source_kinds"].append("external")
    reqs = []
    deployed_requirements = current_deployed_requirement_ids(db, project, data, verification=verification)
    requirement_rows = sorted(verification.requirements.values(), key=lambda row: row.id)
    requirement_rows.sort(key=lambda row: row.created_at, reverse=True)
    for row in requirement_rows:
        req = serialize(row)
        req["basis"] = requirement_basis(row)
        flow = deepcopy(data["flows"].get(row.id, default_flow()))
        flow["legacy_completed"] = row.status == "completed" and row.id not in data["flows"]
        req["deployment_verified"] = row.id in deployed_requirements
        linked = task_groups[row.id]
        flow["gates"] = stage_gates(
            req, flow, linked, issue_groups[row.id], deployment_verified=req["deployment_verified"], designs=verification.design_selections.get(("requirement", row.id), [])
        )
        req["designs"] = deepcopy(verification.design_selections.get(("requirement", row.id), []))
        req["flow"] = flow
        req["tasks_total"] = len(linked)
        req["tasks_done"] = sum(t["verified"] for t in linked)
        req["tasks_recorded_completed"] = sum(t["delivery_status"] == "recorded_completed" for t in linked)
        reqs.append(req)
    summary = {
        "requirements": len(reqs),
        "tasks": len(tasks),
        "tasks_done": sum(t["verified"] for t in tasks),
        "recorded_completed": sum(t["delivery_status"] == "recorded_completed" for t in tasks),
        "blocked": sum(bool(r["flow"].get("blocked_reason")) for r in reqs)
        + sum(t["status"] == "blocked" for t in tasks),
        "accepted": sum(verification.requirement_accepted(r["id"]) for r in reqs),
        "released": len(deployed_requirements),
        "recorded_released": sum(r["flow"]["stage"] == "operations" for r in reqs),
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
    if requirement and data["flows"].get(requirement.id, {}).get("stage") in {"release", "operations"}:
        raise HTTPException(409, "Reopen the requirement before changing accepted scope")
    planning_fields = {
        "key",
        "requirement_criteria_indices",
        "depends_on",
        "starts_on",
        "ends_on",
        "blocked_reason",
    }
    values = draft.model_dump(exclude={"requirement_id", *planning_fields})
    validate_owner(draft.owner_id, roster)
    row = Task(
        id=task_id or identifier("T"),
        tenant_id=project.tenant_id,
        project_id=project.id,
        req_id=requirement.id if requirement else "",
        status="blocked" if draft.blocked_reason else "pending",
        **values,
    )
    data.setdefault("task_details", {})[row.id] = draft.model_dump(mode="json", include=planning_fields)
    if requirement:
        from .delivery_plan import requirement_basis, requirement_snapshot

        data["task_details"][row.id].update(
            requirement_basis=requirement_basis(requirement),
            requirement_snapshot=requirement_snapshot(requirement),
            requirement_revision=data["flows"].get(requirement.id, default_flow())["revision"],
        )
    flow = data["flows"].get(requirement.id, {}) if requirement else {}
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
        return update_project(db, project, data, body)
    elif action.startswith("resource."):
        from .delivery_resources import apply_resource

        return apply_resource(data, user, action, body)
    elif action in {"member.save", "milestone.save"}:
        return _save_entry(data, action, body, roster, values, actor=user.id)
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

        req = get_record(db, Requirement, project, body.requirement_id) if body.requirement_id else None
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


def _save_entry(data, action, body, roster, values, *, actor):
    before = None
    collection = "members" if action == "member.save" else "milestones"
    if collection == "milestones":
        validate_owner(body.owner_id, roster)
    if body.id and not any(x["id"] == body.id for x in data[collection]):
        raise HTTPException(404, "Entry not found")
    if collection == "members" and body.id:
        previous = next(x for x in data[collection] if x["id"] == body.id)
        if previous["kind"] != body.kind:
            raise HTTPException(
                409,
                {"code": "member_kind_immutable", "message": "Resource kind cannot change after creation"},
            )
        if previous["kind"] == "agent" and previous["active"] and not body.active:
            from .delivery_team_runtime import invalidate_member_runtime_binding

            invalidate_member_runtime_binding(data, body.id, actor=actor, reason="member_inactive")
    resource_id = body.id or identifier("member" if collection == "members" else "milestone")
    values["id"] = resource_id
    data[collection] = [x for x in data[collection] if x["id"] != resource_id] + [values]
    return resource_id, before


def _update_requirement(db, project, data, body, roster, values):
    row = get_record(db, Requirement, project, body.id)
    before = serialize(row)
    resource_id = row.id
    from .delivery_requirement_proof import require_change_preview

    require_change_preview(db, project, data, row, body)
    flow = data["flows"].setdefault(row.id, default_flow())
    changes = body.model_dump(exclude_unset=True, exclude={"id", "requirement_basis", "change_preview_basis"})
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


def _edit_task_planning(db, project, data, body, roster):
    scheduling = bool({"starts_on", "ends_on", "allocations"} & body.model_fields_set)
    if scheduling:
        from .delivery_scheduling import require_basis

        require_basis(db, project, data, body.planning_basis)
    changes = body.model_dump(mode="json", exclude_unset=True)
    planning = data.setdefault("task_details", {}).setdefault(body.id, {})
    blocked_before = planning.get("blocked_reason") or ""
    if "starts_on" in changes or "ends_on" in changes:
        start = changes.get("starts_on", planning.get("starts_on"))
        end = changes.get("ends_on", planning.get("ends_on"))
        planning.update(starts_on=start, ends_on=end)
    if "allocations" in changes:
        from .delivery_scheduling import normalize_allocations

        planning["allocations"] = normalize_allocations(body.allocations, roster)
    if "blocked_reason" in changes:
        planning["blocked_reason"] = body.blocked_reason or ""
    return planning, scheduling, blocked_before


def _require_task_transition(db, project, data, row, body):
    if body.status == "completed":
        from .delivery_external_work_order_service import require_no_active_work_order

        require_no_active_work_order(db, project, row.id, action="task.complete")
    if body.status in {"in_progress", "completed"}:
        from .delivery_plan import require_dependencies

        require_dependencies(db, project, data, row.id)
    if body.status == "completed" and any(e["task_id"] == row.id for e in data.get("executions", [])):
        raise HTTPException(409, "Complete managed executions through evidence review")


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
    planning, scheduling, blocked_before = _edit_task_planning(db, project, data, body, roster)
    links_changed = edit_task_links(db, project, data, row, body)
    if scheduling:
        from .delivery_scheduling import validate_final

        validate_final(db, project, data, data["task_details"], [row.id])
    _require_task_transition(db, project, data, row, body)
    resource_id = row.id
    flow = data["flows"].get(row.req_id, {})
    business_change = links_changed or (
        body.title is not None
        and body.title != before["title"]
        or "acceptance_criteria" in body.model_fields_set
        and body.acceptance_criteria != row.acceptance_criteria
        or "owner_id" in body.model_fields_set
        and body.owner_id != row.owner_id
        or body.status is not None
        and body.status != before["status"]
        or body.description is not None
        and body.description != before["description"]
        or body.blocked_reason is not None
        and body.blocked_reason != blocked_before
    )
    if flow.get("stage") in {"release", "operations"} and business_change:
        raise HTTPException(409, "Reopen the requirement before changing accepted work")
    if "owner_id" in body.model_fields_set:
        validate_owner(body.owner_id, roster)
        row.owner_id = body.owner_id
    if body.status is not None:
        row.status = body.status
    if body.title is not None:
        row.title = body.title
    if body.description is not None:
        row.description = body.description
    if "acceptance_criteria" in body.model_fields_set:
        row.acceptance_criteria = body.acceptance_criteria
    if planning.get("blocked_reason"):
        row.status = "blocked"
    if flow.get("stage") in {"testing", "acceptance"} and (
        links_changed
        or any(
            before[key] != getattr(row, key)
            for key in ("title", "description", "status", "owner_id", "acceptance_criteria")
        )
    ):
        invalidate(flow)
        get_record(db, Requirement, project, row.req_id).status = "pending"
        if links_changed:
            planning["requirement_revision"] = flow["revision"]
    return resource_id, before


def _promote_issue(db, project, data, body):
    before = None
    issue = get_record(db, Issue, project, body.issue_id)
    candidates = [rid for rid, flow in data["flows"].items() if flow.get("source_issue_id") == issue.id]
    existing = (
        records(db, Requirement, project)
        .filter(Requirement.id.in_(candidates))
        .order_by(Requirement.id)
        .first()
    )
    if existing:
        return existing.id, None
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
    if flow["closed"]:
        raise HTTPException(409, "Reopen before modifying a completed delivery")
    collection = "artifacts"
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
    elif action == "artifact.add":
        _add_evidence(row, flow, user, action, body, values)
    elif action == "stage.advance":
        if flow["closed"]:
            raise HTTPException(409, "Delivery already closed")
        snapshot = materialize(db, project, data, user)
        current_requirement = next(item for item in snapshot["requirements"] if item["id"] == row.id)
        gates = stage_gates(
            serialize(row),
            flow,
            snapshot["tasks"],
            snapshot["issues"],
            deployment_verified=current_requirement["deployment_verified"], designs=current_requirement.get("designs", []),
        )
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
