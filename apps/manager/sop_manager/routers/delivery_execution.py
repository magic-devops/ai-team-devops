"""Durable Manager intents bridging to the existing execution adapters.

Manager owns business status/review. Runtime tasks are immutable execution
envelopes, keyed by a committed intent; retrying a cross-store write reuses it.
"""

from copy import deepcopy
from dataclasses import replace

from fastapi import HTTPException
from hermes_core.agents import AgentDispatch, Agents
from hermes_core.delivery import Delivery
from hermes_core.models import CoreError, TaskDispatch, TaskReview
from hermes_core.repository import Repository
from hermes_core.transactional import digest

from .auth_sql import check_project_access
from .delivery_contract import default_flow
from .delivery_service import get_record, identifier, stamp
from .hermes_workspace import runtime_identity
from .sql_models import Issue, Requirement, Task, User

CLOSED = {"accepted", "changes_requested", "cancelled"}


def basis(task, requirement, revision):
    return {
        "task_id": task.id,
        "title": task.title,
        "description": task.description,
        "assigned_to": task.assigned_to,
        "requirement_id": task.req_id,
        "requirement_title": requirement.title,
        "requirement_description": requirement.description,
        "acceptance_criteria": requirement.acceptance_criteria,
        "revision": revision,
    }


def context(store, user, workspace, permission="read"):
    if store is None:
        raise HTTPException(503, "Execution runtime is not configured")
    principal = runtime_identity(user, store)
    if permission not in principal.permissions:
        raise HTTPException(403, f"Runtime {permission} permission required")
    if principal.workspace_ids is not None and workspace not in principal.workspace_ids:
        raise HTTPException(403, "Execution workspace membership required")
    row = store.get(principal, "", "workspaces", workspace)
    if row["status"] != "active":
        raise HTTPException(409, "Execution workspace is inactive")
    return principal, row


def catalog(store, user):
    if store is None:
        return {"workspaces": [], "can_execute": False, "providers": []}
    principal = runtime_identity(user, store)
    rows = store.list(principal, "", "workspaces", limit=1000)
    result = []
    for row in rows:
        if (
            row["status"] != "active"
            or principal.workspace_ids is not None
            and row["id"] not in principal.workspace_ids
        ):
            continue
        result.append(
            {
                "id": row["id"],
                "name": row["data"].get("name", row["id"]),
                "agents": [
                    {
                        "id": a["id"],
                        "version": a["version"],
                        "title": a["data"].get("title"),
                        "provider": a["data"].get("provider"),
                    }
                    for a in store.list(principal, row["id"], "agents", status="active")
                ],
                "devices": [
                    {"id": d["id"], "name": d["data"].get("name", d["id"])}
                    for d in store.list(principal, row["id"], "devices", status="active")
                ],
            }
        )
    return {
        "workspaces": result,
        "can_execute": "execute" in principal.permissions,
        "providers": Agents.catalog(),
    }


def _queue(db, project, user, state, body, store):
    from .delivery_plan import require_dependencies

    principal, workspace = context(store, user, body.workspace_id, "execute")
    task = get_record(db, Task, project, body.task_id)
    require_dependencies(db, project, state, task.id)
    requirement = get_record(db, Requirement, project, task.req_id)
    flow = state["flows"].setdefault(requirement.id, default_flow())
    if task.status == "completed" or flow["stage"] in {"testing", "acceptance", "release", "operations"}:
        raise HTTPException(409, "Reopen the requirement and task before dispatch")
    if not requirement.acceptance_criteria:
        raise HTTPException(422, "Define acceptance criteria before dispatch")
    entries = state.setdefault("executions", [])
    if any(e["task_id"] == task.id and e["status"] not in CLOSED for e in entries):
        raise HTTPException(409, "Review or cancel the current execution before redispatch")
    if body.agent_id:
        agent = store.get(principal, workspace["id"], "agents", body.agent_id)
        if agent["version"] != body.agent_version or agent["status"] != "active":
            raise HTTPException(409, "Agent configuration changed; reload")
    entry = {
        "id": identifier("execution"),
        **body.model_dump(),
        "requested_by": user.id,
        "workspace_version": workspace["version"],
        "snapshot": basis(task, requirement, flow["revision"]),
        "status": "pending_dispatch",
        "created_at": stamp(),
        "run_id": "",
        "run_version": 0,
        "runtime_task_id": "",
        "progress": 0,
        "results": {},
        "stale": False,
    }
    entries.append(entry)
    task.status = "in_progress"
    return entry["id"], None


def _envelope_data(entry):
    snapshot = entry["snapshot"]
    return {
        "title": snapshot["title"],
        "description": snapshot["requirement_description"] + "\n\n" + snapshot["description"],
        "acceptance_criteria": "\n".join(snapshot["acceptance_criteria"]),
        "source": {"kind": "manager.delivery", "execution_id": entry["id"], "snapshot": snapshot},
    }


def _dispatch_body(entry):
    common = {
        "expected_version": 1,
        "idempotency_key": entry["id"],
        "dry_run": False,
        "target_device_id": entry["target_device_id"],
    }
    if entry["agent_id"]:
        return AgentDispatch(**common, agent_id=entry["agent_id"], target_version=entry["agent_version"])
    return TaskDispatch(**common, nodes=entry["nodes"])


def _dispatch(store, principal, entry):
    envelope = store.create(
        principal,
        entry["workspace_id"],
        "tasks",
        _envelope_data(entry),
        entry["id"],
        entry["id"],
        status="active",
    )
    service = Delivery(store, Repository(None))
    request = _dispatch_body(entry)
    if entry["agent_id"]:
        result = Agents(store).dispatch(
            principal, entry["workspace_id"], envelope["id"], request, entry["id"], service
        )
    else:
        result = service.dispatch(principal, entry["workspace_id"], envelope["id"], request, entry["id"])
    entry["runtime_task_id"] = envelope["id"]
    entry["run_id"] = result["run"]["id"]


def _cancel(db, project, entry, store, principal):
    if entry["status"] in CLOSED:
        raise HTTPException(409, "Execution already closed")
    if not entry["run_id"]:
        receipt_actor = replace(principal, actor=entry["requested_by"])
        envelope = store.receipt(
            receipt_actor, entry["workspace_id"], "create:tasks", entry["id"], _envelope_data(entry)
        )
        if envelope:
            operation = "task.agent-dispatch:" if entry["agent_id"] else "task.dispatch:"
            cached = store.receipt(
                receipt_actor,
                entry["workspace_id"],
                operation + envelope["id"],
                entry["id"],
                _dispatch_body(entry).model_dump(),
            )
            if cached:
                entry.update(run_id=cached["run"]["id"], runtime_task_id=envelope["id"])
    if entry["run_id"]:
        run = store.get(principal, entry["workspace_id"], "runs", entry["run_id"])
        if run["status"] == "completed":
            raise HTTPException(409, "Review completed execution instead of cancelling")
        if run["status"] not in {"failed", "cancelled"}:

            def cancel(current):
                if current["status"] == "completed":
                    raise CoreError("invalid_transition", "Execution completed; review evidence", 409)
                return {
                    "status": "cancelled",
                    "data": {**current["data"], "execution_owner": None, "lease_expires_at": None},
                }

            run = store.mutate(
                principal,
                entry["workspace_id"],
                "runs",
                run["id"],
                operation="manager.cancel",
                key=entry["id"],
                request={},
                trace=entry["id"],
                expected=run["version"],
                transform=cancel,
            )
        entry["run_version"] = run["version"]
    entry["status"] = "cancelled"
    entry["cancelled_at"] = stamp()
    get_record(db, Task, project, entry["task_id"]).status = "blocked"


def _observe(db, project, state, entry, store, principal):
    run = store.get(principal, entry["workspace_id"], "runs", entry["run_id"])
    task = get_record(db, Task, project, entry["task_id"])
    requirement = get_record(db, Requirement, project, entry["snapshot"]["requirement_id"])
    flow = state["flows"].setdefault(requirement.id, default_flow())
    entry["stale"] = (
        bool(entry.get("planning_invalidated"))
        or basis(task, requirement, flow["revision"]) != entry["snapshot"]
    )
    results = run["data"].get("node_results", {})
    entry.update(
        run_version=run["version"],
        observed_at=stamp(),
        results={
            key: {
                k: (
                    str(value[k])[-12000:]
                    if k in {"error", "stdout", "stderr"} and value.get(k) is not None
                    else value.get(k)
                )
                for k in ("succeeded", "exit_code", "error", "stdout", "stderr")
            }
            for key, value in results.items()
        },
        progress=round(
            sum(v.get("succeeded") is True for v in results.values())
            / max(len(run["data"].get("nodes", [])), 1)
            * 100
        ),
    )
    if entry["status"] not in CLOSED:
        entry["status"] = "awaiting_review" if run["status"] == "completed" else run["status"]
        task.status = "blocked" if run["status"] in {"failed", "cancelled", "interrupted"} else "in_progress"
    if run["status"] == "failed" and not entry.get("issue_id"):
        issue = Issue(
            id=identifier("ISS"),
            tenant_id=project.tenant_id,
            project_id=project.id,
            task_id=task.id,
            title=f"Execution failed: {task.title}"[:256],
            type="bug",
            severity="P1",
            status="open",
            reported_by="execution-runtime",
            description=f"Execution {entry['id']} / run {run['id']} / revision {entry['snapshot']['revision']}\n"
            + str(run["data"].get("error") or "Review the execution node results."),
        )
        db.add(issue)
        entry["issue_id"] = issue.id
    return run, task, requirement, flow


def _review(entry, run, task, flow, body, user, store, principal):
    if entry["status"] in CLOSED:
        raise HTTPException(409, "This execution has already been reviewed or cancelled")
    if body.run_version != run["version"]:
        raise HTTPException(409, "Execution evidence changed; reload before review")
    if body.decision == "accept" and entry["stale"]:
        raise HTTPException(409, "Requirement or task changed; old execution cannot be accepted")
    runtime_task = store.get(principal, entry["workspace_id"], "tasks", entry["runtime_task_id"])
    # Use the runtime's evidence/code checks, but Manager remains the review authority.
    Delivery(store, Repository(None)).review(
        principal,
        entry["workspace_id"],
        runtime_task["id"],
        TaskReview(
            expected_version=runtime_task["version"],
            idempotency_key=entry["id"],
            dry_run=True,
            run_id=run["id"],
            run_version=body.run_version,
            decision=body.decision,
            comment=body.comment,
        ),
        entry["id"],
    )
    entry["status"] = "accepted" if body.decision == "accept" else "changes_requested"
    entry["review"] = {
        "decision": body.decision,
        "comment": body.comment,
        "actor": user.id,
        "at": stamp(),
        "run_version": run["version"],
        "evidence_sha256": digest(run),
    }
    task.status = "completed" if body.decision == "accept" else "blocked"
    test_ids = entry["test_node_ids"]
    if (
        body.decision == "accept"
        and test_ids
        and all(entry["results"].get(i, {}).get("succeeded") is True for i in test_ids)
    ):
        flow["artifacts"].append(
            {
                "id": identifier("artifact"),
                "kind": "test",
                "title": task.title,
                "content": f"Verified run {run['id']}; test nodes: {', '.join(test_ids)}; {body.comment}",
                "url": "",
                "result": "passed",
                "revision": flow["revision"],
                "at": stamp(),
                "actor": user.username,
                "source": "execution-runtime",
                "task_id": task.id,
                "execution_id": entry["id"],
                "run_id": run["id"],
                "evidence_sha256": digest(run),
            }
        )


def apply_execution(db, project, user, state, action, body, store):
    try:
        if action == "execution.queue":
            return _queue(db, project, user, state, body, store)
        entry = next((e for e in state.get("executions", []) if e["id"] == body.id), None)
        if not entry:
            raise HTTPException(404, "Execution not found in project")
        before = deepcopy(entry)
        # Reader must independently have workspace access; replay uses the original
        # actor so a second operator cannot create a second external receipt/run.
        permission = {"execution.review": "approve", "execution.cancel": "execute"}.get(action, "read")
        principal, workspace = context(store, user, entry["workspace_id"], permission)
        if action == "execution.cancel":
            _cancel(db, project, entry, store, principal)
            return entry["id"], before
        if not entry["run_id"]:
            originator = db.get(User, entry["requested_by"])
            if not originator or originator.status != "active":
                raise HTTPException(
                    403, "Original dispatcher is no longer active; cancel and prepare a new plan"
                )
            check_project_access(originator, project.id, db)
            dispatcher, workspace = context(store, originator, entry["workspace_id"], "execute")
            task = get_record(db, Task, project, entry["task_id"])
            req = get_record(db, Requirement, project, entry["snapshot"]["requirement_id"])
            revision = state["flows"][req.id]["revision"]
            if (
                entry.get("planning_invalidated")
                or basis(task, req, revision) != entry["snapshot"]
                or workspace["version"] != entry["workspace_version"]
            ):
                raise HTTPException(
                    409, "Dispatch context changed; cancel this intent and prepare a new plan"
                )
            _dispatch(store, dispatcher, entry)
        run, task, _, flow = _observe(db, project, state, entry, store, principal)
        if action == "execution.review":
            if body.decision == "accept":
                from .delivery_plan import require_dependencies

                require_dependencies(db, project, state, task.id)
            _review(entry, run, task, flow, body, user, store, principal)
        return entry["id"], before
    except CoreError as exc:
        raise HTTPException(exc.status, exc.message) from exc
