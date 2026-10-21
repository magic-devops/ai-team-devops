"""Read-only delivery inbox projected from an authorized, reconciled workspace.

This module does not approve evidence, call execution runtimes or persist state.
Its targets open the existing workbench, whose commands recheck all permissions.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Mapping
from datetime import date, datetime, timezone

from .delivery_contract import STAGE_IDS, default_flow, stage_gates
from .delivery_task_contract import delivery_task_definition, snapshots_match

CATEGORIES = ("work", "approval", "acceptance", "blocked")
FINISHED = {"completed", "cancelled", "closed"}
RESOLVED = {"resolved", "closed"}


def _identity(user):
    return str(user.get("id", "") if isinstance(user, Mapping) else getattr(user, "id", ""))


def _clock(now):
    value = now if now is not None else datetime.now(timezone.utc)
    if isinstance(value, date) and not isinstance(value, datetime):
        value = datetime.combine(value, datetime.min.time(), tzinfo=timezone.utc)
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _due(value):
    """Legacy absent or malformed dates never manufacture overdue work."""
    if isinstance(value, datetime):
        return _clock(value).date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value).isoformat()
        except ValueError:
            pass
    return None


def _owned(owner_id, roster, user_id):
    if not user_id or owner_id != "user:" + user_id:
        return False
    humans = [m for m in roster if m.get("id") == owner_id and m.get("active") and m.get("available")]
    if len(humans) != 1 or humans[0].get("kind") != "human":
        return False
    return True


def _flow(requirement):
    return {**default_flow(), **(requirement.get("flow") or {})}


def derive_task_attention(verification):
    """Use the same proof context without exposing originals or editing a Task.

    The identifiers locate existing protected detail reads. They do not grant
    access to a report, packet, progress message, runtime or acceptance action.
    """
    from .delivery_manual_review import current_review
    from .delivery_task_submission_service import current_submission, native_takeover

    result = {}
    for task_id in verification.tasks:
        activity = verification.work_order_activity.get(task_id)
        submitted = current_submission(verification, task_id)
        entry = verification.executions.get(task_id)
        status = verification.delivery_status(task_id)
        manual = (current_review(verification, task_id, can_approve=True)
            if activity is None and not submitted and not entry and verification.tasks[task_id].status == "completed" else None)
        result[task_id] = {
            "delivery_status": status,
            "current_submission_id": submitted["id"] if submitted else None,
            "submission_pending": bool(activity is None and submitted and not submitted["decision_id"] and status == "awaiting_review"),
            "work_order_active": activity is not None,
            "work_order_id": activity.get("id") if activity else None,
            "work_order_state": activity["state"] if activity else None,
            "reported_status": activity["reported_status"] if activity else None,
            "claimant_id": activity.get("claimant_id") if activity else None,
            "delivery_actor_id": activity.get("claimant_id") if activity is not None else submitted.get("submitted_by") if submitted else None,
            "manual_eligible": bool(manual and manual["eligible"]),
            "native_eligible": activity is None and not submitted and not (entry and native_takeover(verification, entry)),
        }
    return result


def _task_reasons(task, requirement, issues, attention=None):
    planning = task.get("planning") or {}
    reasons = []
    if planning.get("blocked_reason"):
        reasons.append(str(planning["blocked_reason"]))
    reasons.extend("Dependency not complete: " + str(rid) for rid in task.get("dependency_blocked") or [])
    if task.get("status") == "blocked" and not reasons:
        reasons.append("Task is blocked")
    if requirement and _flow(requirement).get("blocked_reason"):
        reasons.append(str(_flow(requirement)["blocked_reason"]))
    if attention and attention.get("work_order_active") and attention.get("reported_status") == "blocked":
        reasons.append("External work reported a blocker")
    reasons.extend(_issue_reason(issue) for issue in issues)
    return list(dict.fromkeys(reasons))


def _issue_reason(issue):
    return "Unresolved issue " + issue["id"] + ": " + str(issue.get("title") or issue["id"])


def _awaiting(task, requirement, entry, latest):
    if not entry:
        return False
    if (
        entry.get("status") != "awaiting_review"
        or entry.get("stale") is not False
        or entry.get("planning_invalidated")
        or not entry.get("run_id")
        or not isinstance(entry.get("run_version"), int)
        or entry["run_version"] < 1
        or task.get("execution_id") != entry.get("id")
        or latest.get(task["id"]) is not entry
        or entry.get("task_id") != task["id"]
        or task.get("status") in FINISHED
    ):
        return False
    # materialize derives this from the shared current task definition. Inbox
    # neither reconstructs a weaker snapshot nor requires a parent requirement.
    evidence = entry.get("snapshot") or {}
    definition = delivery_task_definition(
        task,
        requirement,
        task.get("planning") or {},
        task.get("owner"),
        evidence.get("dependency_basis", {}),
        requirement_revision=_flow(requirement)["revision"] if requirement else 0,
        designs=task.get("designs", []),
    )
    return task.get("delivery_status") == "awaiting_review" and snapshots_match(
        definition["snapshot"], evidence
    )


def _item(kind, record, requirement, owner_id, categories, reasons, today, *, task=None, status=None, acceptance_kind=None):
    flow = _flow(requirement) if requirement else default_flow()
    rid = requirement["id"] if requirement else ""
    tid = task["id"] if task else ""
    deadline = _due((task.get("planning") or {}).get("ends_on") if task else flow.get("due_on"))
    target = {
        "view": "issues" if kind == "issue" else "list",
        "requirement_id": rid,
        "detail": "tasks" if task else "details",
        "submission_id": None,
        "work_order_id": None,
    }
    if tid:
        target["task_id"] = tid
    if kind == "issue":
        target["issue_id"] = record["id"]
    return {
        "id": kind + ":" + record["id"],
        "kind": kind,
        "resource_id": record["id"],
        "title": record.get("title") or record["id"],
        "requirement_id": rid,
        "task_id": tid,
        "status": status or record.get("status") or "pending",
        "stage": flow["stage"] if requirement else "",
        "owner_id": owner_id or "",
        "due_on": deadline,
        "priority": record.get("severity" if kind == "issue" else "priority") or "P1",
        "categories": [category for category in CATEGORIES if category in categories],
        "blocked_reasons": list(dict.fromkeys(reasons))[:5],
        "blocked_reason_count": len(set(reasons)),
        "acceptance_kind": acceptance_kind,
        "overdue": bool(deadline and deadline < today),
        "target": target,
    }


def _approval(requirement, tasks, issues, reasons, evaluated_gates=None):
    flow = _flow(requirement)
    if flow["closed"] or flow.get("legacy_completed") or flow["stage"] not in STAGE_IDS[:-1] or reasons:
        return False
    checks = evaluated_gates
    if checks is None:
        checks = stage_gates(
            requirement, flow, tasks, issues,
            deployment_verified=requirement.get("deployment_verified") is True, designs=requirement.get("designs", []),
        )
    return bool(checks) and all(check.get("ok") is True for check in checks)


def _requirement_items(requirements, tasks, issues, reasons, mine, scope, can_approve, today, evaluated_gates=None):
    result = []
    tasks_by_requirement = defaultdict(list)
    issues_by_requirement = defaultdict(list)
    requirement_by_task = {task["id"]: task.get("req_id") for task in tasks}
    for task in tasks:
        tasks_by_requirement[task.get("req_id")].append(task)
    for issue in issues:
        issues_by_requirement[requirement_by_task.get(issue.get("task_id"))].append(issue)
    for requirement in requirements:
        rid = requirement["id"]
        flow = _flow(requirement)
        blockers = reasons[rid]
        categories = set()
        if scope == "team" or rid in mine:
            if not flow["closed"] and not flow.get("legacy_completed"):
                categories.add("work")
            if blockers:
                categories.add("blocked")
        if can_approve and _approval(
            requirement, tasks_by_requirement[rid], issues_by_requirement[rid], blockers,
            (evaluated_gates or {}).get(rid),
        ):
            categories.add("approval")
        if categories:
            result.append(
                _item("requirement", requirement, requirement, flow["owner_id"], categories, blockers, today)
            )
    return result


def _sort(item):
    # Urgent dates first, then explicit business priority and attention type.
    rank = min(
        ({"blocked": 0, "acceptance": 1, "approval": 2, "work": 3}[c] for c in item["categories"]), default=4
    )
    return (
        not item["overdue"],
        {"P0": 0, "P1": 1, "P2": 2, "P3": 3}.get(item["priority"], 4),
        rank,
        item["due_on"] or "9999-12-31",
        item["id"],
    )


def build_inbox(snapshot, user, scope="mine", now=None, *, evaluated_gates=None, task_attention=None):
    """Project authorized current records without changing their state or evidence."""
    if scope not in {"mine", "team"}:
        raise ValueError("scope must be mine or team")
    instant = _clock(now)
    today = instant.date().isoformat()
    user_id = _identity(user)
    requirements = snapshot.get("requirements") or []
    tasks = snapshot.get("tasks") or []
    issues = [i for i in snapshot.get("issues") or [] if i.get("status") not in RESOLVED]
    roster = snapshot.get("members") or []
    task_attention = task_attention or {}
    requirement_by_id = {r["id"]: r for r in requirements}
    task_by_id = {t["id"]: t for t in tasks}
    mine_requirements = {r["id"] for r in requirements if _owned(_flow(r)["owner_id"], roster, user_id)}
    mine_tasks = {
        t["id"]
        for t in tasks
        if t.get("owner_active", True) is not False and _owned(t.get("owner_id"), roster, user_id)
    }
    actor_tasks = {
        task_id for task_id, attention in task_attention.items()
        if attention.get("delivery_actor_id")
        and _owned("user:" + attention["delivery_actor_id"], roster, user_id)
    }
    issues_by_task = defaultdict(list)
    for issue in issues:
        issues_by_task[issue.get("task_id")].append(issue)
    task_reasons = {
        t["id"]: _task_reasons(t, requirement_by_id.get(t.get("req_id")), issues_by_task[t["id"]], task_attention.get(t["id"]))
        for t in tasks
    }
    reasons_by_requirement = _requirement_reasons(requirements, tasks, task_reasons)
    can_approve = scope == "team" or snapshot.get("permissions", {}).get("approve") is True
    items = _requirement_items(
        requirements, tasks, issues, reasons_by_requirement, mine_requirements, scope, can_approve, today,
        evaluated_gates,
    )
    items.extend(
        _task_items(
            snapshot,
            tasks,
            requirement_by_id,
            task_reasons,
            mine_tasks,
            mine_requirements,
            scope,
            can_approve,
            today,
            task_attention,
            actor_tasks,
        )
    )
    items.extend(
        _issue_items(issues, task_by_id, requirement_by_id, mine_tasks | actor_tasks, mine_requirements, scope, today)
    )
    items.sort(key=_sort)
    counts = {category: sum(category in item["categories"] for item in items) for category in CATEGORIES}
    counts.update(overdue=sum(item["overdue"] for item in items), total=len(items))
    return {
        "project_id": snapshot.get("project", {}).get("id", ""),
        "version": snapshot.get("version", 0),
        "scope": scope,
        "current_user_id": user_id,
        "as_of": instant.isoformat().replace("+00:00", "Z"),
        "counts": counts,
        "items": items,
    }


def _requirement_reasons(requirements, tasks, task_reasons):
    result = defaultdict(list)
    for requirement in requirements:
        reason = _flow(requirement).get("blocked_reason")
        if reason:
            result[requirement["id"]].append(str(reason))
    for task in tasks:
        result[task.get("req_id")].extend(task_reasons[task["id"]])
    return result


def _task_items(snapshot, tasks, requirements, reasons, mine, mine_requirements, scope, can_approve, today, task_attention, actor_tasks):
    entries = snapshot.get("executions") or []
    by_id = {e["id"]: e for e in entries}
    latest = {e.get("task_id"): e for e in entries}
    result = []
    for task in tasks:
        requirement = requirements.get(task.get("req_id"))
        attention = task_attention.get(task["id"], {})
        active_order = attention.get("work_order_active", False)
        current_submission = attention.get("current_submission_id")
        external = attention.get("submission_pending", False)
        native = (not active_order and not current_submission and attention.get("native_eligible", True)
            and _awaiting(task, requirement, by_id.get(task.get("execution_id")), latest))
        manual = (
            not active_order and not current_submission and attention.get("manual_eligible", True)
            and task["id"] not in latest
            and task.get("recorded_status", task.get("status")) == "completed"
            and task.get("verified") is not True
        )
        awaiting = external or native or manual
        personal = task["id"] in mine
        categories = set()
        if awaiting and (
            scope == "team" or personal or task.get("req_id") in mine_requirements or can_approve
        ):
            categories.add("acceptance")
        if scope == "team" or personal or task["id"] in actor_tasks:
            recorded_needs_action = task.get("recorded_status", task.get("status")) == "completed" and task.get("verified") is not True
            if not awaiting and (active_order or task.get("status") not in FINISHED or recorded_needs_action):
                categories.add("work")
            if reasons[task["id"]]:
                categories.add("blocked")
        if categories:
            status = (attention.get("delivery_status") if active_order or current_submission else
                "recorded_completed" if manual else "awaiting_review" if native else None)
            item = _item(
                "task", task, requirement, task.get("owner_id"), categories,
                reasons[task["id"]], today, task=task, status=status,
                acceptance_kind="external" if external else "manual" if manual else "execution" if native else None,
            )
            if active_order:
                item["target"]["work_order_id"] = attention.get("work_order_id")
            elif current_submission:
                item["target"]["submission_id"] = current_submission
            result.append(item)
    return result


def _issue_items(issues, tasks, requirements, mine_tasks, mine_requirements, scope, today):
    result = []
    for issue in issues:
        task = tasks.get(issue.get("task_id"))
        requirement = requirements.get(task.get("req_id")) if task else None
        if (
            scope == "team"
            or issue.get("task_id") in mine_tasks
            or (requirement and requirement["id"] in mine_requirements)
        ):
            owner = task.get("owner_id") if task else ""
            result.append(
                _item(
                    "issue", issue, requirement, owner, {"blocked"}, [_issue_reason(issue)], today, task=task
                )
            )
    return result
