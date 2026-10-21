"""Atomic disposable query facts derived from the canonical write evaluation."""

from collections import Counter, defaultdict
from datetime import datetime, timezone

from sqlalchemy import delete, insert, select, update

from .delivery_progress_facts import metrics
from .delivery_scheduling import planning_basis
from .sql_models import DeliveryQueryFact, DeliveryQueryState, DeliveryWorkspace

SCHEMA_VERSION = 6
FLOW_FIELDS = (
    "stage",
    "revision",
    "owner_id",
    "due_on",
    "milestone_id",
    "blocked_reason",
    "closed",
    "legacy_completed",
)


def scope(project, model):
    return model.tenant_id == project.tenant_id, model.project_id == project.id


def _fact(project, kind, entity_id, data, **fields):
    return {
        "tenant_id": project.tenant_id,
        "project_id": project.id,
        "kind": kind,
        "entity_id": entity_id,
        "parent_id": "",
        "owner_id": "",
        "milestone_id": "",
        "status": "",
        "due_on": None,
        "label": "",
        "data": data,
        **fields,
    }


def _requirement_facts(project, evaluation):
    accepted = {row["id"]: row["accepted"] for row in evaluation.facts["requirements"]}
    grouped = defaultdict(list)
    for task in evaluation.snapshot["tasks"]:
        grouped[task["req_id"]].append(task)
    rows = []
    for requirement in evaluation.snapshot["requirements"]:
        flow = requirement["flow"]
        source = evaluation.state.get("flows", {}).get(requirement["id"], {})
        linked = grouped[requirement["id"]]
        data = {
            "basis": requirement["basis"],
            "tasks_total": len(linked),
            "tasks_done": sum(bool(task["verified"]) for task in linked),
            "tasks_recorded_done": sum(task["recorded_status"] == "completed" for task in linked),
            "accepted": accepted[requirement["id"]],
            "deployment_verified": requirement.get("deployment_verified", False),
            "flow": {key: flow.get(key) for key in FLOW_FIELDS},
            "gates": flow["gates"],
            "quality_positions": {
                "test": next((i for i in range(len(source.get("artifacts", [])) - 1, -1, -1)
                    if source["artifacts"][i].get("revision") == source.get("revision") and source["artifacts"][i].get("kind") == "test"), None),
                "acceptance": next((i for i in range(len(source.get("reviews", [])) - 1, -1, -1)
                    if source["reviews"][i].get("revision") == source.get("revision") and source["reviews"][i].get("stage") == "acceptance" and source["reviews"][i].get("decision") == "approved"), None),
            },
        }
        rows.append(
            _fact(
                project,
                "requirement",
                requirement["id"],
                data,
                status=flow["stage"],
                owner_id=flow.get("owner_id") or "",
                milestone_id=flow.get("milestone_id") or "",
                due_on=flow.get("due_on"),
            )
        )
    return rows


def _task_facts(project, evaluation):
    rows = []
    flows = evaluation.state.get("flows", {})
    for task in evaluation.snapshot["tasks"]:
        planning = task["planning"]
        data = {
            key: task[key]
            for key in (
                "basis",
                "status",
                "recorded_status",
                "delivery_status",
                "verified",
                "assigned_to",
                "owner_active",
                "execution_id",
                "dependency_blocked",
                "execution_gate",
            )
        }
        data["owner"] = task.get("owner")
        data["planning"] = {key: planning.get(key) for key in ("starts_on", "ends_on", "blocked_reason")}
        rows.append(
            _fact(
                project,
                "task",
                task["id"],
                data,
                parent_id=task["req_id"] or "",
                owner_id=task.get("owner_id") or "",
                status=task["delivery_status"],
                milestone_id=flows.get(task["req_id"], {}).get("milestone_id") or "",
            )
        )
    return rows


def _execution_facts(project, evaluation):
    rows = []
    for position, entry in enumerate(evaluation.state.get("executions", [])):
        data = {
            key: entry.get(key)
            for key in (
                "id",
                "task_id",
                "workspace_id",
                "status",
                "run_id",
                "run_version",
                "progress",
                "created_at",
                "stale",
                "issue_id",
                "attempt",
                "handoff_id",
            )
        }
        data["position"] = position
        rows.append(
            _fact(
                project,
                "execution",
                entry["id"],
                data,
                parent_id=entry["task_id"],
                status=entry["status"],
                label=entry["id"],
            )
        )
    return rows


def _milestone_counts(evaluation):
    result = defaultdict(Counter)
    for row in evaluation.facts["tasks"]:
        counts = result[row["milestone_id"]]
        counts["task_count"] += 1
        counts["verified_task_count"] += row["status"] == "verified_completed"
    for row in evaluation.facts["requirements"]:
        counts = result[row["milestone_id"]]
        counts["requirement_count"] += 1
        counts["accepted_requirement_count"] += bool(row["accepted"])
    return result


def _reference_facts(project, evaluation):
    owners = Counter(task.get("owner_id") for task in evaluation.snapshot["tasks"])
    counts = _milestone_counts(evaluation)
    rows = []
    registry = defaultdict(list)
    for position, member in enumerate(evaluation.state.get("members", [])):
        if isinstance(member, dict) and isinstance(member.get("id"), str) and not member["id"].startswith("user:"):
            registry[member["id"]].append(position)
    roster = {member["id"]: member for member in evaluation.snapshot["members"]}
    for member_id in registry.keys() - roster.keys():
        roster[member_id] = evaluation.verification.team.resolve_owner(member_id)
    for member in roster.values():
        rows.append(
            _fact(
                project,
                "member",
                member["id"],
                {**member, "task_count": owners[member["id"]], "registry_positions": registry.get(member["id"], [])},
                label=member.get("name") or member["id"],
                status="active" if member["active"] else "inactive",
            )
        )
    for milestone in evaluation.snapshot["milestones"]:
        aggregate = {
            key: counts[milestone["id"]][key]
            for key in (
                "requirement_count",
                "accepted_requirement_count",
                "task_count",
                "verified_task_count",
            )
        }
        rows.append(
            _fact(
                project,
                "milestone",
                milestone["id"],
                {**milestone, **aggregate},
                label=milestone["title"],
                due_on=milestone.get("ends_on"),
            )
        )
    for position, resource in enumerate(evaluation.snapshot.get("resources", [])):
        safe = {
            key: resource.get(key)
            for key in ("id", "kind", "title", "url", "ref", "archived", "created_at", "updated_at")
        }
        safe["position"] = position
        rows.append(
            _fact(
                project,
                "resource",
                resource["id"],
                safe,
                label=resource["title"],
                status="archived" if resource.get("archived") else "active",
            )
        )
    for sprint in evaluation.facts["scopes"]["sprints"]:
        rows.append(_fact(project, "sprint", sprint["id"], sprint, label=sprint["title"]))
    return rows


def _inbox_facts(project, evaluation):
    from .delivery_inbox import build_inbox, derive_task_attention

    snapshot = evaluation.snapshot
    roster = {member["id"]: member for member in snapshot["members"]}
    requirements = {row["id"]: row for row in snapshot["requirements"]}
    task_attention = derive_task_attention(evaluation.verification)

    def human_owner(owner_id):
        member = roster.get(owner_id)
        return owner_id if member and member["kind"] == "human" and member["active"] and member["available"] else ""

    rows = []
    # Team facts contain every category. Current reader permissions are applied in SQL.
    evaluated_gates = {row["id"]: row["flow"]["gates"] for row in snapshot["requirements"]}
    for item in build_inbox(snapshot, {"id": ""}, scope="team", evaluated_gates=evaluated_gates, task_attention=task_attention)["items"]:
        requirement = requirements.get(item["requirement_id"])
        requirement_owner = (requirement or {}).get("flow", {}).get("owner_id", "")
        data = {
            "item": item,
            "mine_owner_id": human_owner(item["owner_id"]),
            "mine_requirement_owner_id": human_owner(requirement_owner),
            "mine_delivery_actor_id": human_owner("user:" + actor) if (actor := task_attention.get(item["task_id"], {}).get("delivery_actor_id")) else "",
            "priority_rank": {"P0": "0", "P1": "1", "P2": "2", "P3": "3"}.get(item["priority"], "4"),
            **{category: category in item["categories"] for category in ("work", "approval", "acceptance", "blocked")},
        }
        rows.append(_fact(project, "inbox", item["id"], data,
            parent_id=item["requirement_id"], owner_id=item["owner_id"],
            status=item["status"], due_on=item["due_on"]))
    return rows


def _quality_release_facts(project, evaluation):
    """Small disposable catalogue rows; never substitute these for command proof."""
    from .delivery_deployment_facts import release_deployment_view
    from .delivery_release import _requirement_quality, _task_quality
    from .delivery_verification import fingerprint

    context = evaluation.verification
    grouped, rows = defaultdict(list), []
    for task in sorted(context.tasks.values(), key=lambda value: value.id):
        value = _task_quality(context, task)
        grouped[value["requirement_id"]].append(value)
        if not value["requirement_id"]:
            item = _quality_item("task", value, [value])
            rows.append(_fact(project, "quality_catalogue", fingerprint(["task", task.id]), {"item": item},
                parent_id="task", status="ready" if item["ready"] else "attention", label=task.title[:256]))
    for requirement in sorted(context.requirements.values(), key=lambda value: value.id):
        linked = grouped[requirement.id]
        value = _requirement_quality(context, requirement, linked)
        item = _quality_item("requirement", value, linked)
        rows.append(_fact(project, "quality_catalogue", fingerprint(["requirement", requirement.id]), {"item": item},
            parent_id="requirement", status="ready" if item["ready"] else "attention", label=requirement.title[:256]))
    data = evaluation.state
    upper = {}
    for evidence in data.get("ci_evidence", []):
        predicate = evidence["statement"]["predicate"]
        key = tuple(predicate[name] for name in ("policy_generation", "repository", "workflow", "commit_sha"))
        upper[key] = max(upper.get(key, (0, 0)), (predicate["run_number"], predicate["run_attempt"]))
    for position, evidence in enumerate(data.get("ci_evidence", [])):
        predicate = evidence["statement"]["predicate"]
        key = tuple(predicate[name] for name in ("policy_generation", "repository", "workflow", "commit_sha"))
        item = _release_item("evidence", evidence["id"], predicate["workflow"] + " #" + str(predicate["run_number"]) + "." + str(predicate["run_attempt"]))
        item.update(at=evidence["imported_at"], status="passed" if evidence["passed"] else "failed", passed=evidence["passed"], commit_sha=predicate["commit_sha"],
            scope_requirements=len(evidence["selected"]["requirement_ids"]), scope_tasks=len(evidence["quality_snapshot"]["tasks"]))
        metadata = {"item": item, "position": position, "latest_sequence": list(upper[key])}
        rows.append(_fact(project, "release_evidence", evidence["id"], metadata, label=item["title"][:256], status=item["status"]))
    for position, candidate in enumerate(data.get("release_candidates", [])):
        snapshot = candidate["snapshot"]
        item = _release_item("candidate", candidate["id"], snapshot["version"])
        status = "stale" if candidate.get("invalidated") and candidate["decision"] in {"pending", "approved"} else candidate["decision"]
        item.update(at=candidate["created_at"], status=status, version=snapshot["version"], environment=snapshot["environment"], commit_sha=snapshot["ci"]["commit_sha"],
            scope_requirements=len(snapshot["selected"]["requirement_ids"]), scope_tasks=len(snapshot["quality"]["tasks"]))
        metadata = {"item": item, "position": position, "deployment": release_deployment_view(data, candidate["id"], business_valid=True)}
        rows.append(_fact(project, "release_candidate", candidate["id"], metadata, label=(snapshot["version"] + " " + snapshot["environment"])[:256], status=status))
    for requirement_id, flow in data.get("flows", {}).items():
        requirement = context.requirements.get(requirement_id)
        for position, record in enumerate(flow.get("releases", [])):
            locator = fingerprint([requirement_id, position, record])
            item = _release_item("legacy", locator, str(record.get("version") or "Manual history"))
            item.update(at=record.get("at"), status="manual_history", version=record.get("version"), requirement_id=requirement_id,
                requirement_title=requirement.title if requirement else None, scope_requirements=1, summary=str(record.get("summary") or record.get("verification") or "")[:240] or None)
            rows.append(_fact(project, "release_legacy", locator, {"item": item, "position": position}, parent_id=requirement_id, label=item["title"][:256], status="manual_history"))
    return rows


def _quality_item(kind, value, tasks):
    reasons = list({reason["code"]: reason for reason in [*value["reasons"], *(reason for task in tasks for reason in task["reasons"])]}.values())
    return {"kind": kind, "id": value["id"], "title": value["title"], "ready": not reasons, "attention": bool(reasons), "reasons": reasons,
        "issue_count": len({issue["id"] for task in tasks for issue in task["issues"]}), "target": value["target"], "revision": value.get("revision"), "task_count": len(tasks)}


def _release_item(kind, entity_id, title):
    return {"kind": kind, "id": entity_id, "title": title, "at": None, "status": "", "version": None, "environment": None, "commit_sha": None,
        "passed": None, "requirement_id": None, "requirement_title": None, "scope_requirements": 0, "scope_tasks": 0, "summary": None}


def replace_from_evaluation(db, project, evaluation):
    """Caller owns Project lock and canonical transaction; no commit or history write."""
    connection = db.connection()
    current = connection.execute(
        select(DeliveryQueryState.generation).where(*scope(project, DeliveryQueryState))
    ).scalar()
    generation = (current or 0) + 1
    rows = _requirement_facts(project, evaluation) + _task_facts(project, evaluation)
    rows += _execution_facts(project, evaluation) + _reference_facts(project, evaluation)
    rows += _inbox_facts(project, evaluation)
    rows += _quality_release_facts(project, evaluation)
    for kind, collection in (("progress_task", "tasks"), ("progress_requirement", "requirements")):
        rows += [_fact(project, kind, item["id"], item, parent_id=item.get("req_id") or "",
            milestone_id=item.get("milestone_id", ""), status=item.get("status", item.get("stage", "")),
            label=item["title"][:256]) for item in evaluation.facts[collection]]
    linked_issues = {
        flow["source_issue_id"]: requirement_id
        for requirement_id, flow in evaluation.state.get("flows", {}).items()
        if flow.get("source_issue_id")
    }
    for issue in evaluation.snapshot["issues"]:
        rows.append(
            _fact(
                project,
                "issue",
                issue["id"],
                {
                    "source_kinds": issue.get("source_kinds", []),
                    "linked_requirement_id": linked_issues.get(issue["id"]),
                },
                parent_id=issue["task_id"] or "",
                status=issue["status"],
            )
        )
    connection.execute(delete(DeliveryQueryFact).where(*scope(project, DeliveryQueryFact)))
    for start in range(0, len(rows), 250):
        connection.execute(insert(DeliveryQueryFact), rows[start : start + 250])
    metric = metrics(evaluation.facts["tasks"], evaluation.facts["requirements"])
    metric["requirement_stage_counts"] = dict(
        Counter(row["stage"] for row in evaluation.facts["requirements"])
    )
    summary = {**evaluation.snapshot["summary"], "tasks_done": metric["verified_completed"]}
    version = (
        connection.execute(
            select(DeliveryWorkspace.version).where(*scope(project, DeliveryWorkspace))
        ).scalar()
        or 0
    )
    values = {
        "schema_version": SCHEMA_VERSION,
        "generation": generation,
        "source_version": version,
        "computed_at": datetime.now(timezone.utc).replace(tzinfo=None),
        "summary": summary,
        "metrics": metric,
        "planning_basis": planning_basis(db, project, evaluation.state, verification=evaluation.verification),
    }
    if current is None:
        connection.execute(
            insert(DeliveryQueryState), {"tenant_id": project.tenant_id, "project_id": project.id, **values}
        )
    else:
        connection.execute(update(DeliveryQueryState).where(*scope(project, DeliveryQueryState)), values)
    return generation


def rebuild(db, project, user):
    """Explicit derived-only maintenance, including previously unindexed databases."""
    from fastapi import HTTPException

    from sop_manager.project_write_guard import lock_project_scopes

    from .auth_sql import check_project_access
    from .delivery import _role_permissions
    from .delivery_progress_facts import evaluate_project
    from .delivery_query_read import metadata, query_state
    from .sql_models import User

    lock_project_scopes(db, [(project.tenant_id, project.id)])
    db.refresh(project)
    actor = db.get(User, user.id, populate_existing=True)
    if actor is None or actor.status != "active":
        raise HTTPException(403, "An active account is required")
    check_project_access(actor, project.id, db)
    if not _role_permissions(db, actor, project)["configure"]:
        raise HTTPException(403, "Project configure permission required")
    from .delivery_issue_origins import rebuild_origins

    origin_rebuild = rebuild_origins(db, project)
    evaluation = evaluate_project(db, project)
    replace_from_evaluation(db, project, evaluation)
    db.commit()
    row = (
        db.execute(select(DeliveryQueryState.__table__).where(*scope(project, DeliveryQueryState)))
        .mappings()
        .one()
    )
    return {**metadata(db, project, row), "query_state": query_state(row), "origin_rebuild": origin_rebuild}
