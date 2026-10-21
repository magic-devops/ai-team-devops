"""Durable Manager intents bridging to the existing execution adapters.

Manager owns business status/review. Runtime tasks are immutable execution
envelopes, keyed by a committed intent; retrying a cross-store write reuses it.
"""

from copy import deepcopy
from dataclasses import replace

from fastapi import HTTPException
from hermes_core.agents import AgentDispatch
from hermes_core.delivery import Delivery
from hermes_core.models import CoreError, TaskDispatch, TaskReview
from hermes_core.repository import Repository
from hermes_core.transactional import digest

from .delivery_contract import default_flow
from .delivery_service import get_record, identifier, stamp
from .hermes_workspace import runtime_identity
from .sql_models import Issue, Task

CLOSED = {"accepted", "changes_requested", "cancelled"}


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


def catalog(store, user, execution=None, *, project_id="", project_write=True, project_configure=False):
    from hermes_core.execution_targets import workspace_execution_targets

    if store is None:
        return {
            "project_id": project_id,
            "as_of": stamp(),
            "runtime_configured": False,
            "workspaces": [],
            "can_execute": False,
            "can_configure_policy": False,
        }
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
                "version": row["version"],
                "agents": [
                    {
                        "id": a["id"],
                        "version": a["version"],
                        "title": a["data"]["title"],
                        "provider": a["data"]["provider"],
                    }
                    for a in store.list(principal, row["id"], "agents", status="active")
                ],
                **workspace_execution_targets(store, execution, principal, row["id"]),
            }
        )
    return {
        "workspaces": result,
        "project_id": project_id,
        "as_of": stamp(),
        "runtime_configured": True,
        "can_execute": project_write and "execute" in principal.permissions,
        "can_configure_policy": project_configure and {"config", "execute"}.issubset(principal.permissions),
    }


def prepare_plan(db, project, user, state, body, store, execution=None):
    from .project_lifecycle import require_active

    require_active(project)
    if body.target_kind == "device" and any(node.kind == "approval" for node in body.nodes):
        raise HTTPException(422, {"code": "target_approval_unsupported",
                                  "message": "Approval gates require the local server checkpoint executor."})
    """Pure proposal validation shared by preview and the versioned write."""
    from hermes_core.execution_targets import select_execution_target

    from .delivery_plan import require_dependencies
    from .delivery_team_runtime import resolve_executor_binding
    from .delivery_verification import VerificationContext

    principal, workspace = context(store, user, body.workspace_id, "execute")
    task = get_record(db, Task, project, body.task_id)
    verification = VerificationContext(db, project, state)
    if verification.basis(task.id) != body.task_basis:
        raise HTTPException(
            409,
            {"code": "task_basis_changed", "message": "Task changed; review the latest task before dispatch"},
        )
    require_dependencies(db, project, state, task.id)
    gate = verification.execution_gate(task.id)
    if not gate["eligible"]:
        raise HTTPException(409, gate["reasons"][0])
    executor_snapshot = None
    if body.executor_member_id:
        executor_snapshot = resolve_executor_binding(
            db,
            project,
            state,
            user,
            store,
            member_id=body.executor_member_id,
            expected_basis=body.executor_binding_basis,
            workspace_id=body.workspace_id,
            agent_id=body.agent_id,
            agent_version=body.agent_version,
        )
    agent = None
    if body.agent_id:
        agent = store.get(principal, workspace["id"], "agents", body.agent_id)
        if agent["version"] != body.agent_version or agent["status"] != "active":
            raise HTTPException(409, "Agent configuration changed; reload")
    target = select_execution_target(
        store,
        execution,
        principal,
        workspace["id"],
        target_kind=body.target_kind,
        target_device_id=body.target_device_id,
        provider=agent["data"]["provider"] if agent else "",
        expected_basis=body.target_basis,
    )
    needed = {"agent"} if agent else {"command"}
    if body.test_nodes:
        needed.add("command")
    if not needed.issubset(target["runtime_capabilities"]) or not needed.issubset(
        target["policy"]["allowed_runtimes"]
    ):
        raise HTTPException(
            409, {"code": "target_unavailable", "message": "Target cannot execute every planned node"}
        )
    snapshot = verification.definition(task.id)["snapshot"]
    from .delivery_execution_design_context import execution_design_context

    design_context = execution_design_context(db, project, snapshot)
    nodes = body.nodes
    if agent:
        from hermes_core.agents import single_agent_nodes

        nodes = single_agent_nodes(agent, _envelope_data({"snapshot": snapshot, "id": "", "design_context": design_context}), body.test_nodes)
    result = {
        "design_context": design_context,
        "task_basis": body.task_basis,
        "workspace_id": workspace["id"],
        "workspace_version": workspace["version"],
        "snapshot": snapshot,
        "executor_snapshot": executor_snapshot,
        "target": target,
        "agent": None
        if not agent
        else {
            "id": agent["id"],
            "version": agent["version"],
            "title": agent["data"]["title"],
            "provider": agent["data"]["provider"],
        },
        "nodes": [node.model_dump(mode="json") for node in nodes],
        "test_node_ids": [node.id for node in body.test_nodes] if agent else body.test_node_ids,
    }
    result["plan_basis"] = digest(result)
    return result


def _queue(db, project, user, state, body, store, execution=None):
    from .delivery_execution_runtime import require_previous_stops

    require_previous_stops(db, project, user, state, body.task_id, store)
    plan = prepare_plan(db, project, user, state, body, store, execution)
    task = get_record(db, Task, project, body.task_id)
    entry = {
        "id": identifier("execution"),
        "project_id": project.id,
        **body.model_dump(mode="json"),
        "test_node_ids": plan["test_node_ids"],
        "plan_nodes": [{key: node[key] for key in ("id", "kind", "title") if key in node} for node in plan["nodes"]],
        "plan_basis": plan["plan_basis"],
        "target_snapshot": plan["target"],
        "agent_snapshot": plan["agent"],
        "executor_snapshot": plan["executor_snapshot"],
        "executor_binding_invalidated": False,
        "requested_by": user.id,
        "workspace_version": plan["workspace_version"],
        "snapshot": plan["snapshot"],
        "status": "pending_dispatch",
        "created_at": stamp(),
        "run_id": "",
        "run_version": 0,
        "attempt": 1,
        "runtime_task_id": "",
        "progress": 0,
        "results": {},
        "stale": False,
    }
    state.setdefault("executions", []).append(entry)
    task.status = "in_progress"
    from .delivery_execution_handoff import accept_handoff

    accept_handoff(db, project, user, entry, design_context=plan["design_context"])
    return entry["id"], None


def _envelope_data(entry):
    snapshot = entry["snapshot"]
    source = {"kind": "manager.delivery", "execution_id": entry["id"], "snapshot": snapshot}
    if entry.get("executor_snapshot") is not None:
        source["executor_snapshot"] = entry["executor_snapshot"]
    return {
        **({"design_context": deepcopy(entry["design_context"])} if "design_context" in entry else {}),
        "title": snapshot["title"],
        "description": "\n\n".join(
            text
            for text in ((snapshot["requirement"] or {}).get("description"), snapshot["description"])
            if text
        ),
        "acceptance_criteria": "\n".join(snapshot["acceptance_criteria"]),
        "source": source,
    }


def _dispatch_body(entry):
    common = {
        "expected_version": 1,
        "idempotency_key": entry["id"],
        "dry_run": False,
        "target_device_id": entry["target_device_id"],
        "target_basis": entry["target_basis"],
    }
    if entry["agent_id"]:
        return AgentDispatch(
            **common,
            agent_id=entry["agent_id"],
            target_version=entry["agent_version"],
            test_nodes=entry["test_nodes"],
        )
    return TaskDispatch(**common, nodes=entry["nodes"])


def _recover_dispatch(store, principal, entry, *, db=None, project=None):
    """Recover committed external receipts before revalidating an unstarted plan."""
    if entry.get("handoff_id"):
        from hermes_core.managed_handoff import ManagedHandoff

        original = entry
        if db is not None and project is not None:
            from .delivery_execution_handoff_model import DeliveryExecutionHandoff
            from .delivery_execution_handoff import _validate_original

            handoff = db.get(DeliveryExecutionHandoff, entry["handoff_id"])
            if not handoff or (handoff.tenant_id, handoff.project_id, handoff.execution_id) != (project.tenant_id, project.id, entry["id"]):
                raise HTTPException(409, "The fixed handoff original is unavailable")
            _validate_original(handoff)
            original = handoff.original
        fact = ManagedHandoff(store, None).probe(principal, entry["workspace_id"], operation_id=entry["handoff_id"],
            project_id=entry["project_id"], execution_id=entry["id"], envelope=_envelope_data(original),
            body=_dispatch_body(original), plan_basis=original["plan_basis"])
        if fact and fact["state"] == "planned":
            entry.update(run_id=fact["run_id"], runtime_task_id=fact["runtime_task_id"])
            return True
        return False
    snapshot = entry.get("snapshot")
    # A missing original definition cannot identify an immutable external request.
    if not entry.get("target_basis") or not isinstance(snapshot, dict) or "requirement" not in snapshot:
        return False
    envelope = store.receipt(
        principal, entry["workspace_id"], "create:tasks", entry["id"], _envelope_data(entry)
    )
    if not envelope:
        return False
    operation = "task.agent-dispatch:" if entry["agent_id"] else "task.dispatch:"
    cached = store.receipt(
        principal,
        entry["workspace_id"],
        operation + envelope["id"],
        entry["id"],
        _dispatch_body(entry).model_dump(),
    )
    if not cached:
        return False
    entry.update(run_id=cached["run"]["id"], runtime_task_id=envelope["id"])
    return True


def _observe(db, project, state, entry, store, principal):
    from .delivery_execution_observations import project_result
    from .delivery_verification import VerificationContext

    run = store.get(principal, entry["workspace_id"], "runs", entry["run_id"])
    verification = VerificationContext(db, project, state)
    from .delivery_task_submission_service import native_takeover

    taken_over = bool(native_takeover(verification, entry))
    task = verification.tasks.get(entry["task_id"])
    requirement = verification.requirements.get(task.req_id) if task else None
    flow = state["flows"].setdefault(requirement.id, default_flow()) if requirement else None
    entry["stale"] = not verification.execution_snapshot_current(entry)
    from .delivery_execution_runtime import record_stop

    record_stop(entry, run)
    results = run["data"].get("node_results", {})
    entry.update(
        run_version=run["version"],
        attempt=run["data"].get("attempt", 1),
        observed_at=stamp(),
        results={key: project_result(value) for key, value in results.items() if isinstance(value, dict)},
        progress=round(
            sum(v.get("succeeded") is True for v in results.values())
            / max(len(run["data"].get("nodes", [])), 1)
            * 100
        ),
    )
    if entry["status"] not in CLOSED:
        entry["status"] = "awaiting_review" if run["status"] == "completed" else run["status"]
        if not entry["stale"] and not taken_over:
            task.status = (
                "blocked" if run["status"] in {"failed", "cancelled", "interrupted"} else "in_progress"
            )
    if not taken_over and entry["status"] not in CLOSED and not entry["stale"] and run["status"] == "failed" and not entry.get("issue_id"):
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
            description=f"Execution {entry['id']} / run {run['id']} / task {entry['task_id']}\n"
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
    if entry["stale"]:
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
        and flow is not None
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


def apply_execution(db, project, user, state, action, body, store, execution=None):
    try:
        if action == "execution.queue":
            return _queue(db, project, user, state, body, store, execution)
        entry = next((e for e in state.get("executions", []) if e["id"] == body.id), None)
        if not entry:
            raise HTTPException(404, "Execution not found in project")
        before = deepcopy(entry)
        # Reader must independently have workspace access; replay uses the original
        # actor so a second operator cannot create a second external receipt/run.
        permission = {"execution.review": "approve", "execution.cancel": "execute"}.get(action, "read")
        if action == "execution.sync" and entry.get("stop_pending"):
            from .delivery_issue_evidence import _access

            principal, _ = _access(store, user, project, entry["workspace_id"])
        else:
            principal, _ = context(store, user, entry["workspace_id"], permission)
        if action == "execution.cancel":
            raise HTTPException(422, "Use the fixed execution control preview and command payload")
        if not entry.get("run_id"):
            _recover_dispatch(store, replace(principal, actor=entry["requested_by"]), entry, db=db, project=project)
        if not entry.get("run_id"):
            raise HTTPException(409, {"code": "execution_handoff_pending",
                "message": "The accepted handoff has no runtime plan yet. Observe its handoff state; sync and review never dispatch."})
        if action == "execution.review":
            from .delivery_task_submission_service import require_native_not_taken_over
            from .delivery_verification import VerificationContext

            require_native_not_taken_over(VerificationContext(db, project, state), entry)
        run, task, _, flow = _observe(db, project, state, entry, store, principal)
        if action == "execution.review":
            if entry["stale"]:
                raise HTTPException(409, "Task scope changed; this execution is read-only history")
            if body.decision == "accept":
                from .delivery_plan import require_dependencies

                require_dependencies(db, project, state, task.id)
            _review(entry, run, task, flow, body, user, store, principal)
        return entry["id"], before
    except CoreError as exc:
        raise HTTPException(exc.status, {"code": exc.code, "message": exc.message}) from exc
