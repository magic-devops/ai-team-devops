"""One project planning basis, explicit reservations and atomic final-state validation."""

from __future__ import annotations

from collections import Counter
from copy import deepcopy
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException
from pydantic import ValidationError

from .delivery_scheduling_contract import AllocationInput, civil_date
from .delivery_verification import VerificationContext, fingerprint
from .sql_models import DeliveryWorkspace, Sprint


def fail(code, message, status=422):
    raise HTTPException(status, {"code": code, "message": message})


def state(db, project):
    from .delivery_service import initial_state, reconcile

    row = db.get(DeliveryWorkspace, project.id)
    return row, reconcile(db, project, row.data) if row else initial_state()


def unit(member):
    return "hours" if member["kind"] == "human" else "slots"


def planning_basis(db, project, data=None):
    data = state(db, project)[1] if data is None else data
    context = VerificationContext(db, project, data)
    tasks = []
    for task in sorted(context.tasks.values(), key=lambda t: t.id):
        planning = data.get("task_details", {}).get(task.id, {})
        tasks.append(
            {
                "id": task.id,
                "basis": context.basis(task.id),
                "verified": context.verified(task.id),
                "owner_id": task.owner_id,
                "sprint_id": task.sprint_id,
                "milestone_id": data.get("flows", {}).get(task.req_id, {}).get("milestone_id", ""),
                "planning": {
                    key: planning.get(key) for key in ("starts_on", "ends_on", "depends_on", "allocations")
                },
            }
        )
    return fingerprint(
        {
            "tenant_id": project.tenant_id,
            "project_id": project.id,
            "tasks": tasks,
            "members": [
                {key: m[key] for key in ("id", "kind", "active", "available")}
                for m in sorted(context.roster, key=lambda m: m["id"])
            ],
            "calendars": data.get("member_calendars", {}),
        }
    )


def require_basis(db, project, data, expected):
    if expected != planning_basis(db, project, data):
        fail(
            "planning_basis_changed",
            "Project planning changed. Review and explicitly adopt the latest planning basis.",
            409,
        )


def quantity_valid(value, resource_unit, *, positive=False):
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        return False
    lower = 0.5 if positive and resource_unit == "hours" else 1 if positive else 0
    return lower <= value <= (24 if resource_unit == "hours" else 100) and (
        (value * 2).is_integer()
        if isinstance(value, float) and resource_unit == "hours"
        else value == int(value)
        if resource_unit == "slots"
        else True
    )


def active_days_exist(start, end, weekdays):
    return any(
        (start + timedelta(days=i)).weekday() in weekdays for i in range(min(7, (end - start).days + 1))
    )


def normalize_allocations(values, roster):
    by_id = {member["id"]: member for member in roster if member["active"]}
    result = []
    for value in values:
        try:
            item = (
                value
                if isinstance(value, AllocationInput)
                else AllocationInput.model_validate({k: v for k, v in value.items() if k != "unit"})
            )
        except (ValidationError, AttributeError):
            fail("allocation_invalid", "Remove or replace malformed reservation data before saving")
        member = by_id.get(item.member_id)
        if member is None:
            fail("allocation_member_unavailable", "Choose an active resource in this project")
        resource_unit = unit(member)
        if not quantity_valid(item.quantity_per_day, resource_unit, positive=True):
            fail(
                "allocation_quantity_invalid",
                "Human reservations use half-hours up to 24; agent and tool reservations use integer slots up to 100",
            )
        if not active_days_exist(item.starts_on, item.ends_on, set(item.weekdays)):
            fail("allocation_empty_days", "A reservation must contain at least one selected weekday")
        result.append(
            {**item.model_dump(mode="json"), "weekdays": sorted(item.weekdays), "unit": resource_unit}
        )
    return result


def validate_final(db, project, data, details, affected):
    from .delivery_plan import validate_dependency_graph, validate_schedule

    context = VerificationContext(db, project, data)
    validate_dependency_graph({tid: item.get("depends_on", []) for tid, item in details.items()}, affected)
    validate_schedule(details, affected)
    for task_id in affected:
        planned = details.get(task_id, {})
        values = planned.get("allocations", [])
        normalized = normalize_allocations(values, context.roster)
        if any(
            original.get("unit") != final["unit"] for original, final in zip(values, normalized, strict=True)
        ):
            fail(
                "allocation_unit_changed",
                "Remove or explicitly replace reservations whose resource unit no longer matches",
            )
        if not normalized:
            continue
        start, end = civil_date(planned.get("starts_on")), civil_date(planned.get("ends_on"))
        if start is None or end is None:
            fail("allocation_dates_invalid", "Reservations require a complete task date range")
        for index, item in enumerate(normalized):
            first, last = civil_date(item["starts_on"]), civil_date(item["ends_on"])
            if first < start or last > end:
                fail("allocation_dates_invalid", "Reservation dates must stay inside the task date range")
            for other in normalized[:index]:
                if other["member_id"] != item["member_id"]:
                    continue
                overlap_start = max(first, civil_date(other["starts_on"]))
                overlap_end = min(last, civil_date(other["ends_on"]))
                if overlap_start <= overlap_end and active_days_exist(
                    overlap_start, overlap_end, set(item["weekdays"]) & set(other["weekdays"])
                ):
                    fail(
                        "allocation_overlap",
                        "The same task and resource cannot reserve the same effective day twice",
                    )


def prepare_changes(db, project, data, body):
    require_basis(db, project, data, body.planning_basis)
    context = VerificationContext(db, project, data)
    details = deepcopy(data.get("task_details", {}))
    changes = []
    for change in body.changes:
        task = context.tasks.get(change.task_id)
        if task is None:
            fail("schedule_task_missing", "A selected task no longer exists in this project", 404)
        target = details.setdefault(task.id, {})
        before = {
            "starts_on": target.get("starts_on"),
            "ends_on": target.get("ends_on"),
            "allocations": deepcopy(target.get("allocations", [])),
        }
        values = change.model_dump(mode="json", exclude_unset=True, exclude={"task_id"})
        if "allocations" in values:
            values["allocations"] = normalize_allocations(change.allocations, context.roster)
        target.update(values)
        after = {
            "starts_on": target.get("starts_on"),
            "ends_on": target.get("ends_on"),
            "allocations": deepcopy(target.get("allocations", [])),
        }
        changes.append(
            {
                "task_id": task.id,
                "title": task.title,
                "before": before,
                "after": after,
                "fields": sorted(key for key in before if before[key] != after[key]),
            }
        )
    affected = [item.task_id for item in body.changes]
    validate_final(db, project, data, details, affected)
    linked = {tid for tid, planned in details.items() if set(planned.get("depends_on", [])) & set(affected)}
    return details, changes, sorted(set(affected) | linked)


def preview(db, project, body):
    row, data = state(db, project)
    _, changes, affected = prepare_changes(db, project, data, body)
    return {
        "project_id": project.id,
        "version": row.version if row else 0,
        "planning_basis": body.planning_basis,
        "changes": changes,
        "affected_task_ids": affected,
    }


def apply_scheduling(db, project, data, action, body):
    if action == "tasks.schedule":
        details, changes, _ = prepare_changes(db, project, data, body)
        data["task_details"] = details
        return project.id, {"changes": changes}
    require_basis(db, project, data, body.planning_basis)
    context = VerificationContext(db, project, data)
    member = next((m for m in context.roster if m["id"] == body.member_id and m["active"]), None)
    if member is None:
        fail("calendar_member_unavailable", "Choose an active resource in this project")
    resource_unit = unit(member)
    if any(
        value is not None and not quantity_valid(value, resource_unit)
        for value in [*body.weekly, *(item.available for item in body.exceptions)]
    ):
        fail(
            "calendar_quantity_invalid",
            "Calendar values must match the resource's half-hour or integer-slot unit",
        )
    calendars = data.setdefault("member_calendars", {})
    before = deepcopy(calendars.get(member["id"]))
    calendars[member["id"]] = {
        "unit": resource_unit,
        "weekly": list(body.weekly),
        "exceptions": sorted(
            [item.model_dump(mode="json") for item in body.exceptions], key=lambda item: item["date"]
        ),
    }
    return member["id"], before


def _issue(code, member_id="", task_id=""):
    return {"code": code, "message": code.replace("_", " "), "member_id": member_id, "task_id": task_id}


def _date_owner_issues(start, end, owner_id, owner):
    issues = []
    if not start and not end:
        issues.append(_issue("unscheduled"))
    elif not start or not end:
        issues.append(_issue("partial_dates"))
    else:
        try:
            if civil_date(end) < civil_date(start):
                issues.append(_issue("invalid_dates"))
        except ValueError:
            issues.append(_issue("invalid_dates"))
    if not owner_id:
        issues.append(_issue("owner_missing"))
    elif not owner or not owner["available"]:
        issues.append(_issue("owner_inactive", owner_id))
    return issues


def _allocation_issues(allocations, resources, by_id):
    issues = []
    for item in allocations:
        member = by_id.get(item["member_id"])
        if member is None:
            resources.append(
                {
                    "id": item["member_id"],
                    "name": item["member_id"],
                    "kind": None,
                    "active": False,
                    "unit": None,
                    "calendar": None,
                }
            )
            by_id[item["member_id"]] = resources[-1]
            issues.append(_issue("resource_missing", item["member_id"]))
        elif not member["active"]:
            issues.append(_issue("resource_inactive", item["member_id"]))
        elif member["unit"] != item.get("unit"):
            issues.append(_issue("allocation_invalid", item["member_id"]))
        item["unit"] = item.get("unit") if item.get("unit") in {"hours", "slots"} else None
    return issues


def get_schedule(db, project, permissions, starts_on=None, ends_on=None):
    from .delivery_schedule_cells import calculate_cells

    today = datetime.now(timezone.utc).date()
    try:
        first = starts_on or (ends_on - timedelta(days=13) if ends_on else today)
        last = ends_on or first + timedelta(days=13)
    except OverflowError:
        fail("schedule_range_invalid", "Choose dates with a valid fourteen-day default window")
    if last < first or (last - first).days > 91:
        fail("schedule_range_invalid", "Choose an ordered date range of at most 92 days")
    row, data = state(db, project)
    context = VerificationContext(db, project, data)
    resources = [
        {
            "id": m["id"],
            "name": m["name"],
            "kind": m["kind"],
            "active": m["active"],
            "unit": unit(m),
            "calendar": deepcopy(data.get("member_calendars", {}).get(m["id"])),
        }
        for m in context.roster
    ]
    by_id = {r["id"]: r for r in resources}
    task_rows = []
    for task in sorted(context.tasks.values(), key=lambda t: (t.created_at, t.id)):
        planned = data.get("task_details", {}).get(task.id, {})
        flow = data.get("flows", {}).get(task.req_id, {})
        owner = context.owner(task)
        owner_id = task.owner_id
        start, end = planned.get("starts_on"), planned.get("ends_on")
        verified = context.verified(task.id)
        issues = _date_owner_issues(start, end, owner_id, owner)
        allocations = deepcopy(planned.get("allocations", []))
        if not verified and owner_id and not any(a["member_id"] == owner_id for a in allocations):
            issues.append(_issue("owner_allocation_missing", owner_id))
        issues.extend(_allocation_issues(allocations, resources, by_id))
        if not verified and end and end < today.isoformat() and allocations:
            issues.append(_issue("overdue_unverified"))
        blocked = context.blocked(task.id)
        for predecessor in planned.get("depends_on", []):
            prior = context.tasks.get(predecessor)
            if prior is None:
                issues.append(_issue("dependency_missing", task_id=predecessor))
            elif predecessor in blocked:
                issues.append(_issue("dependency_unverified", task_id=predecessor))
            prior_end = data.get("task_details", {}).get(predecessor, {}).get("ends_on")
            if prior_end and start and prior_end > start:
                issues.append(_issue("dependency_dates", task_id=predecessor))
        delivery_status = context.delivery_status(task.id)
        task_rows.append(
            {
                "id": task.id,
                "title": task.title,
                "req_id": task.req_id or "",
                "requirement_title": context.requirements[task.req_id].title
                if task.req_id in context.requirements
                else "",
                "owner_id": owner_id,
                "owner_name": (owner or {}).get("name") or "",
                "owner_active": bool(owner and owner["available"]),
                "status": task.status,
                "delivery_status": delivery_status,
                "verified": verified,
                "milestone_id": flow.get("milestone_id", ""),
                "sprint_id": task.sprint_id or "",
                "task_basis": context.basis(task.id),
                "starts_on": start,
                "ends_on": end,
                "depends_on": planned.get("depends_on", []),
                "dependency_blocked": blocked,
                "allocations": allocations,
                "issues": issues,
            }
        )
    resources = calculate_cells(
        resources, task_rows, first.isoformat(), last.isoformat(), today=today.isoformat()
    )
    cells = [cell for resource in resources for cell in resource["cells"]]
    counts = Counter(issue["code"] for task in task_rows for issue in task["issues"])
    sprints = (
        db.query(Sprint)
        .filter_by(tenant_id=project.tenant_id, project_id=project.id)
        .order_by(Sprint.id)
        .all()
    )
    return {
        "project_id": project.id,
        "version": row.version if row else 0,
        "planning_basis": planning_basis(db, project, data),
        "as_of": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "timezone": "UTC",
        "range": {"starts_on": first.isoformat(), "ends_on": last.isoformat()},
        "permissions": permissions,
        "resources": resources,
        "tasks": task_rows,
        "milestones": [{"id": item["id"], "title": item["title"]} for item in data.get("milestones", [])],
        "sprints": [{"id": s.id, "title": s.goal or s.id} for s in sprints],
        "summary": {
            "tasks_total": len(task_rows),
            "active_tasks": sum(not t["verified"] for t in task_rows),
            "verified_tasks": sum(t["verified"] for t in task_rows),
            "unscheduled_tasks": counts["unscheduled"],
            "incomplete_tasks": sum(bool(t["issues"]) for t in task_rows),
            "overloaded_cells": sum(cell["overload"] is not None and cell["overload"] > 0 for cell in cells),
            "unavailable_cells": sum(cell["unavailable"] for cell in cells),
            "unknown_capacity_cells": sum(cell["available"] is None for cell in cells),
            "issues_by_code": dict(counts),
        },
    }
