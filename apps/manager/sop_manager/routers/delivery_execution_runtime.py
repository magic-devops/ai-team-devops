"""Pure scoped runtime evidence; business controls remain explicit commands."""

import base64
import json
from copy import deepcopy
from dataclasses import replace

from fastapi import HTTPException
from hermes_core.models import CoreError
from hermes_core.transactional import digest

from .delivery_execution_runtime_contract import (
    ExecutionControlPreviewResponse,
    ExecutionNodeOutputResponse,
    ExecutionRuntimeResponse,
)
from .delivery_execution_runtime_safety import safe_text
from .delivery_service import stamp


def _error(exc):
    if isinstance(exc, CoreError):
        return HTTPException(exc.status, {"code": exc.code, "message": safe_text(exc.message, 2000)[0]})
    return exc


def _entry(state, entry):
    current = next((row for row in state.get("executions", []) if row["id"] == entry["id"]), None)
    if current is None:
        raise HTTPException(404, "Execution not found in project")
    return current


def _read(db, project, user, state, entry, store):
    from .auth_sql import check_project_access
    from .delivery_execution import _recover_dispatch
    from .delivery_issue_evidence import _access

    entry = deepcopy(_entry(state, entry))
    check_project_access(user, project.id, db)
    principal, workspace = _access(store, user, project, entry["workspace_id"])
    if not entry.get("run_id"):
        _recover_dispatch(store, replace(principal, actor=entry["requested_by"]), entry, db=db, project=project)
    run = store.get(principal, entry["workspace_id"], "runs", entry["run_id"]) if entry.get("run_id") else None
    return entry, principal, workspace, run


def _stop(run):
    from hermes_core.run_controls import stop_view

    value = stop_view(run) if run else None
    if value is None:
        return None
    evidence = value.get("evidence")
    return {
        "id": str(value.get("id") or ""), "state": value["state"],
        "reason": safe_text(value.get("reason"), 2000)[0],
        "node_id": value.get("node_id"), "attempt": value.get("attempt", 1),
        "requested_at": str(value["requested_at"]) if value.get("requested_at") is not None else None,
        "confirmed_at": str(value["confirmed_at"]) if value.get("confirmed_at") is not None else None,
        "evidence": safe_text(json.dumps(evidence, ensure_ascii=False, sort_keys=True)
                              if isinstance(evidence, (dict, list)) else evidence, 4000)[0],
    }


def record_stop(entry, run):
    """Only an explicit command adopts actual runtime stop evidence into SQL."""
    from hermes_core.run_controls import pending_stop

    value = _stop(run)
    if value is not None:
        entry["stop_snapshot"] = value
        entry["stop_pending"] = pending_stop(run)


def unresolved_stop_targets(db, project, data):
    """Pure SQL projection of an incomplete technical handoff, including legacy gaps."""
    result = []
    for entry in data.get("executions", []):
        legacy_unknown = entry.get("status") == "cancelled" and entry.get("run_id") and not entry.get("stop_snapshot")
        if not entry.get("stop_pending") and not legacy_unknown:
            continue
        result.append({
            "code": "project_execution_stop_unresolved",
            "message": "Confirm and synchronize the actual execution stop before continuing.",
            "target": {"project_id": project.id, "kind": "execution", "view": "list", "detail": "tasks",
                       "execution_id": entry["id"], "task_id": entry.get("task_id") or None},
            "status": (entry.get("stop_snapshot") or {}).get("state", "unknown"),
            "run_id": entry.get("run_id") or None,
        })
    return result


def require_previous_stops(db, project, user, state, task_id, store, *, exclude=""):
    """A new handoff cannot bypass unknown previous execution side effects."""
    from hermes_core.run_controls import pending_stop, stop_view
    from .delivery_verification import VerificationContext
    from .delivery_task_submission_service import native_takeover, native_takeover_closed
    from .delivery_execution_control_operation_service import active_controls

    verification = VerificationContext(db, project, state)
    for previous in state.get("executions", []):
        if previous.get("task_id") != task_id or previous["id"] == exclude:
            continue
        takeover = native_takeover(verification, previous)
        if takeover and (not native_takeover_closed(verification, previous) or active_controls(db, project, previous["id"])):
            raise HTTPException(409, {"code": "execution_external_takeover_unresolved", "message": "The original external takeover closure or an old accepted control is unresolved."})
        unresolved = previous.get("stop_pending") or (
            previous.get("status") == "cancelled" and previous.get("run_id") and not previous.get("stop_snapshot")
        )
        if unresolved:
            raise HTTPException(409, {"code": "execution_stop_unresolved",
                                      "message": "Read and synchronize the previous execution stop before dispatching."})
        if previous.get("run_id"):
            try:
                _, _, _, run = _read(db, project, user, state, previous, store)
                stop = stop_view(run)
                if takeover and (run["status"] not in {"completed", "failed", "cancelled"} or not stop or stop.get("state") not in {"confirmed", "not_started"}):
                    raise HTTPException(409, {"code": "execution_stop_unresolved", "message": "The retired native execution still requires positive terminal and physical stop evidence."})
                if pending_stop(run):
                    raise HTTPException(409, {"code": "execution_stop_unresolved",
                                              "message": "The previous execution has no confirmed stop."})
            except CoreError as exc:
                raise _error(exc) from exc


def _approval(store, principal, workspace, run):
    if not run or run["status"] != "interrupted" or not run["data"].get("active_node"):
        return None
    rows = store.list(principal, workspace, "approvals", status="pending", limit=1000)
    matches = [row for row in rows if row["data"].get("run_id") == run["id"]
               and row["data"].get("node_id") == run["data"]["active_node"]
               and row["data"].get("attempt", 1) == run["data"].get("attempt", 1)]
    if len(matches) != 1:
        return None
    row = matches[0]
    return {"id": row["id"], "version": row["version"], "node_id": row["data"]["node_id"],
            "attempt": row["data"].get("attempt", 1), "status": row["status"],
            "title": safe_text(row["data"].get("title"), 256)[0]}


def _capability(reasons):
    return {"allowed": not reasons, "reasons": reasons}


def _reason(code, message):
    return {"code": code, "message": message}


def _base_control_reasons(project, permissions, principal, entry):
    from .delivery_execution import CLOSED

    reasons = []
    if project.status == "archived":
        reasons.append(_reason("project_archived", "Restore the project before changing execution."))
    if not permissions.get("write"):
        reasons.append(_reason("project_write_required", "Project write permission is required."))
    if "execute" not in principal.permissions:
        reasons.append(_reason("runtime_execute_required", "Runtime execute permission is required."))
    if entry["status"] in CLOSED:
        reasons.append(_reason("execution_closed", "This delivery intent is closed."))
    return reasons


def _fresh_control_reasons(project, current, workspace, run, common):
    from hermes_core.run_controls import pending_stop

    reasons = list(common)
    if project.status != "active":
        reasons.append(_reason("project_not_active", "Activate the project before continuing execution."))
    if not current:
        reasons.append(_reason("execution_stale", "The task or requirement changed; prepare a new plan."))
    if not run:
        reasons.append(_reason("run_missing", "Synchronize the saved dispatch before starting it."))
    elif pending_stop(run):
        reasons.append(_reason("execution_stop_unresolved", "Resolve the actual stop before executing again."))
    if workspace["status"] != "active":
        reasons.append(_reason("workspace_inactive", "Execution workspace is inactive."))
    if run and run["data"].get("workspace_version") != workspace["version"]:
        reasons.append(_reason("workspace_changed", "Workspace configuration changed after planning."))
    return reasons


def _validate_configuration(db, project, user, state, entry, store, execution, principal, run):
    from hermes_core.agents import validate_bound_profiles
    from hermes_core.execution_targets import validate_execution_target_snapshot

    from .delivery_plan import require_dependencies

    require_dependencies(db, project, state, entry["task_id"])
    if entry.get("executor_member_id"):
        from .delivery_team_runtime import resolve_executor_binding

        resolve_executor_binding(db, project, state, user, store,
            member_id=entry["executor_member_id"], expected_basis=entry["executor_binding_basis"],
            workspace_id=entry["workspace_id"], agent_id=entry["agent_id"], agent_version=entry["agent_version"])
    with store.engine.connect() as conn:
        validate_bound_profiles(store, conn, principal, entry["workspace_id"], run["data"].get("agent_bindings", {}))
    snapshot = run["data"].get("target_snapshot")
    if snapshot:
        for node in run["data"].get("nodes", []):
            provider = run["data"].get("agent_bindings", {}).get(node["id"], {}).get("profile", {}).get("provider", "")
            validate_execution_target_snapshot(store, execution, principal, entry["workspace_id"], snapshot, provider=provider)


def _configuration_reason(exc):
    if isinstance(exc, CoreError):
        code = exc.code
    elif isinstance(exc.detail, dict):
        code = exc.detail.get("code", "execution_context_changed")
    else:
        code = "execution_context_changed"
    return _reason(code, "Execution configuration or dependencies changed; review a new plan.")



def _require_managed_source(store, principal, entry, run):
    if run is None:
        return
    task_id = run["data"].get("task_source", {}).get("task_id")
    if not task_id or task_id != entry.get("runtime_task_id"):
        raise HTTPException(409, _reason("execution_source_changed", "The runtime envelope no longer identifies this delivery intent."))
    task = store.get(principal, entry["workspace_id"], "tasks", task_id)
    source = task["data"].get("source", {})
    if source.get("kind") != "manager.delivery" or source.get("execution_id") != entry["id"]:
        raise HTTPException(409, _reason("execution_source_changed", "The runtime envelope no longer identifies this delivery intent."))


def _controls(db, project, user, state, entry, store, execution, principal, workspace, run, permissions, *, ignore_control_ids=()):
    from .delivery_verification import VerificationContext

    verification = VerificationContext(db, project, state)
    current = verification.execution_snapshot_current(entry)
    from .delivery_task_submission_service import native_takeover

    takeover = native_takeover(verification, entry)
    common = _base_control_reasons(project, permissions, principal, entry)
    try:
        _require_managed_source(store, principal, entry, run)
    except (HTTPException, CoreError):
        common.append(_reason("execution_source_changed", "The runtime envelope no longer identifies this delivery intent."))
    fresh = _fresh_control_reasons(project, current, workspace, run, common)
    takeover_reason = _reason("execution_external_takeover", "This original execution is retained as history after external takeover; prepare a new plan to execute again.") if takeover else None
    if takeover_reason:
        fresh.append(takeover_reason)
    if not fresh:
        try:
            _validate_configuration(db, project, user, state, entry, store, execution, principal, run)
        except (HTTPException, CoreError) as exc:
            fresh.append(_configuration_reason(exc))
    start, retry, cancel, approval = list(fresh), list(fresh), list(common), list(fresh)
    from .delivery_execution_control_operation_service import active_controls

    pending = active_controls(db, project, entry["id"], ignore=ignore_control_ids)
    if pending:
        reason = _reason("execution_control_pending", "An accepted control is still being processed. Read its status before another action.")
        start.append(reason)
        retry.append(reason)
        approval.append(reason)
        if any(item.action in {"execution.cancel", "execution.control.close"} for item in pending):
            cancel.append(reason)
    if not run or run["status"] not in {"planned", "queued"}:
        start.append(_reason("start_not_planned", "Only a planned or previously queued run can start."))
    if not run or run["status"] != "failed":
        retry.append(_reason("retry_not_failed", "Only a failed run can retry."))
    if run and run["data"].get("recovery_requires_review") and (
        not permissions.get("approve") or "approve" not in principal.permissions
    ):
        retry.append(_reason("recovery_review_required", "Unknown effects require project and runtime approval permission."))
    if run and run["status"] == "completed" and current:
        cancel.append(_reason("completed_requires_review", "Review the completed execution instead of cancelling."))
    if not run and "requirement" not in entry.get("snapshot", {}):
        cancel.append(_reason("dispatch_definition_missing", "The external dispatch receipt cannot be verified."))
    selected_approval = _approval(store, principal, entry["workspace_id"], run)
    approval_reasons = []
    if not selected_approval:
        approval_reasons.append(_reason("approval_missing", "There is no exact pending approval for this attempt."))
    if not permissions.get("approve") or "approve" not in principal.permissions:
        approval_reasons.append(_reason("approval_permission_required", "Project and runtime approval permission are required."))
    approval.extend(approval_reasons)
    return current, selected_approval, {"start": _capability(start), "retry": _capability(retry),
        "cancel": _capability(cancel), "approval": _capability(approval),
        "approval_reject": _capability([*cancel, *approval_reasons, *([takeover_reason] if takeover_reason else [])])}


def _selected_capability(controls, action, decision):
    key = "approval_reject" if action == "execution.approval" and decision == "reject" else action.removeprefix("execution.")
    return deepcopy(controls[key])


def _basis(db, project, state, entry, workspace, run, approval, controls):
    from .delivery_verification import VerificationContext

    verification = VerificationContext(db, project, state)
    data = run["data"] if run else {}
    return digest({
        "project": {"id": project.id, "status": project.status},
        "execution": {key: entry.get(key) for key in ("id", "task_id", "status", "snapshot", "planning_invalidated",
            "executor_binding_invalidated", "executor_snapshot", "target_snapshot", "agent_snapshot", "stop_pending")},
        "current_task_basis": verification.basis(entry["task_id"]) if entry["task_id"] in verification.tasks else None,
        "workspace": {"id": workspace["id"], "status": workspace["status"], "version": workspace["version"]},
        "run": None if not run else {"id": run["id"], "status": run["status"],
            "attempt": data.get("attempt", 1), "active_node": data.get("active_node"),
            "recovery_requires_review": bool(data.get("recovery_requires_review")),
            "target_snapshot": data.get("target_snapshot"), "agent_bindings": data.get("agent_bindings"),
            "nodes": data.get("nodes"), "stop": _stop(run)},
        "approval": approval, "controls": controls,
    })


def runtime_detail(db, project, user, state, entry, store, execution, permissions):
    from hermes_core.run_output import read_node_output

    from .delivery_execution_observations import project_result

    try:
        entry, principal, workspace, run = _read(db, project, user, state, entry, store)
        current, approval, controls = _controls(db, project, user, state, entry, store, execution,
                                               principal, workspace, run, permissions)
        data = run["data"] if run else {}
        attempt = data.get("attempt", 1)
        nodes = []
        for node in data.get("nodes", entry.get("plan_nodes", [])):
            result = project_result(data.get("node_results", {}).get(node["id"]))
            result_attempt = result["attempt"] or 1 if result else None
            status = ("skipped" if result["skipped"] else "passed" if result["succeeded"] is True
                      else "failed" if result["succeeded"] is False else "pending") if result else "pending"
            if result and result["succeeded"] is False and result_attempt < attempt and run["status"] in {"queued", "running", "retrying"}:
                status = "pending"
            if run and run["status"] == "running" and data.get("active_node") == node["id"]:
                status = "running"
            attempts = []
            if run:
                try:
                    attempts = read_node_output(store, principal, entry["workspace_id"], run["id"], node["id"],
                                                attempt, stream="stdout", limit=1)["available_attempts"]
                except CoreError as exc:
                    if exc.status != 404:
                        raise
                    if result_attempt:
                        attempts = [result_attempt]
            nodes.append({"id": node["id"], "title": safe_text(node.get("title") or node["id"], 256)[0],
                          "kind": node.get("kind", "command"), "is_test": node["id"] in entry["test_node_ids"],
                          "status": status, "available_attempts": attempts, "result_attempt": result_attempt,
                          "reused_result": bool(result and result["succeeded"] is True and result_attempt < attempt)})
        from .delivery_execution import CLOSED
        result = {"project_id": project.id, "execution_id": entry["id"], "run_id": run["id"] if run else "",
                  "run_version": run["version"] if run else 0, "attempt": attempt,
                  "status": entry["status"] if entry["status"] in CLOSED or not run else
                            "awaiting_review" if run["status"] == "completed" else run["status"],
                  "runtime_status": run["status"] if run else None, "stale": not current,
                  "active_node_id": data.get("active_node"), "observed_at": stamp(),
                  "recovery_requires_review": bool(data.get("recovery_requires_review")), "stop": _stop(run) or entry.get("stop_snapshot"),
                  "approval": approval, "nodes": nodes, "controls": controls}
        return ExecutionRuntimeResponse.model_validate(result).model_dump()
    except CoreError as exc:
        raise _error(exc) from exc


def _output_after(cursor, identities):
    if not cursor:
        return 0
    try:
        value = json.loads(base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True))
        if (not isinstance(value, list) or len(value) != len(identities) + 1 or value[:-1] != identities
                or type(value[-1]) is not int or not 0 <= value[-1] <= 9223372036854775807):
            raise ValueError("Output scope mismatch")
        return value[-1]
    except (ValueError, TypeError, UnicodeError) as exc:
        raise HTTPException(422, "Output cursor does not belong to this exact node, attempt and stream") from exc


def node_output(db, project, user, state, entry, store, *, node_id, attempt, stream, limit=50, cursor=""):
    from hermes_core.run_output import read_node_output

    if type(attempt) is not int or attempt < 1 or stream not in {"stdout", "stderr"} or type(limit) is not int or not 1 <= limit <= 100:
        raise HTTPException(422, "Choose an exact positive attempt, output stream and bounded page")
    try:
        entry, principal, _, run = _read(db, project, user, state, entry, store)
        if not run:
            raise HTTPException(404, "This execution has no runtime output")
        identities = [project.id, entry["id"], run["id"], node_id, attempt, stream]
        after = _output_after(cursor, identities)
        data = read_node_output(store, principal, entry["workspace_id"], run["id"], node_id,
                                attempt, stream=stream, after=after, limit=limit)
        chunks, sanitized, truncated = [], bool(data["sanitized"]), bool(data["truncated"])
        for raw in data["chunks"]:
            text, changed, cut = safe_text(raw["text"], 16000)
            sanitized |= changed
            truncated |= cut
            chunks.append({"seq": raw["seq"], "source_seq": raw["source_seq"], "node_id": node_id,
                           "attempt": attempt, "stream": stream, "text": text,
                           "observed_at": str(raw["observed_at"]), "truncated": bool(raw.get("truncated")) or cut})
        next_cursor = base64.urlsafe_b64encode(json.dumps([*identities, data["next_seq"]], separators=(",", ":")).encode()).decode().rstrip("=")
        result = {"project_id": project.id, "execution_id": entry["id"], "run_id": run["id"],
                  "node_id": node_id, "attempt": attempt, "stream": stream, "source": data["source"],
                  "availability": data["availability"], "available_attempts": data["available_attempts"],
                  "chunks": chunks, "next_cursor": next_cursor, "more": data["more"], "complete": data["complete"],
                  "truncated": truncated, "sanitized": sanitized, "gaps": data.get("gaps", [])}
        return ExecutionNodeOutputResponse.model_validate(result).model_dump()
    except CoreError as exc:
        raise _error(exc) from exc


def control_preview(db, project, user, state, body, store, execution, permissions, *, version):
    try:
        original = next((row for row in state.get("executions", []) if row["id"] == body.id), None)
        if original is None:
            raise HTTPException(404, "Execution not found in project")
        entry, principal, workspace, run = _read(db, project, user, state, original, store)
        _, approval, controls = _controls(db, project, user, state, entry, store, execution,
                                          principal, workspace, run, permissions)
        capability = _selected_capability(controls, body.action, body.decision)
        if body.action == "execution.approval" and (not approval or body.approval_id != approval["id"]):
            capability["allowed"] = False
            capability["reasons"].append(_reason("approval_changed", "Read the exact current approval before deciding."))
        payload = {"id": entry["id"], "run_id": run["id"] if run else "", "run_version": run["version"] if run else 0,
                   "attempt": run["data"].get("attempt", 1) if run else 1, "reason": body.reason,
                   "control_basis": _basis(db, project, state, entry, workspace, run, approval, controls)}
        if body.action == "execution.approval":
            payload.update(approval_id=body.approval_id, approval_version=approval["version"] if approval else 1,
                           decision=body.decision)
        result = {"project_id": project.id, "execution_id": entry["id"], "version": version,
                  "action": body.action, **capability, "payload": payload}
        return ExecutionControlPreviewResponse.model_validate(result).model_dump(exclude_none=True)
    except CoreError as exc:
        raise _error(exc) from exc


def apply_runtime_control(db, project, user, state, action, body, store, execution, *, command_key):
    from .delivery_execution_runtime_controls import apply_control

    return apply_control(db, project, user, state, action, body, store, execution, command_key=command_key)
