"""Bounded, pure projections of existing runtime rows and their event stream."""

import base64
import json

from fastapi import HTTPException
from hermes_core.models import CoreError

from .delivery_contract import default_flow
from .delivery_service import records, stamp
from .sql_models import Requirement, Task


def _integer(value):
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def project_result(value, *, attempt=None):
    """No text inference, credential projection, or aggregate cross-provider usage."""
    if not isinstance(value, dict):
        return None
    agent = value.get("agent")
    agent_result = None
    if isinstance(agent, dict):
        usage = agent.get("usage")
        oversized = isinstance(usage, dict) and len(json.dumps(usage, default=str)) > 16000
        agent_result = {
            "provider": str(agent.get("provider") or "")[:80],
            "agent_id": str(agent.get("agent_id") or "")[:64],
            "profile_version": _integer(agent.get("profile_version")),
            "completed": agent.get("completed") is True,
            "usage": usage if isinstance(usage, dict) and not oversized else None,
            "usage_truncated": oversized,
            "message": str(agent.get("message") or "")[-12000:],
            "error": str(agent.get("error") or "")[-2000:],
            "event_count": len(agent.get("events", [])) if isinstance(agent.get("events"), list) else 0,
        }
    return {
        "succeeded": value.get("succeeded") if isinstance(value.get("succeeded"), bool) else None,
        "exit_code": _integer(value.get("exit_code")),
        "expected_exit_code": _integer(value.get("expected_exit_code")),
        "error": str(value["error"])[-2000:] if value.get("error") is not None else None,
        "stdout": str(value["stdout"])[-12000:] if value.get("stdout") is not None else None,
        "stderr": str(value["stderr"])[-12000:] if value.get("stderr") is not None else None,
        "duration_ms": _integer(value.get("duration_ms")),
        "attempt": _integer(value.get("attempt", attempt)),
        "skipped": value.get("skipped") is True,
        "stdout_truncated": bool(value.get("stdout_truncated"))
        or len(str(value.get("stdout") or "")) > 12000
        or "[truncated]" in str(value.get("stdout") or ""),
        "stderr_truncated": bool(value.get("stderr_truncated"))
        or len(str(value.get("stderr") or "")) > 12000
        or "[truncated]" in str(value.get("stderr") or ""),
        "output_source": "completed_node_result",
        "agent": agent_result,
    }


def _cursor(project_id, execution_id, run_id, seq):
    return (
        base64.urlsafe_b64encode(
            json.dumps([project_id, execution_id, run_id, seq], separators=(",", ":")).encode()
        )
        .decode()
        .rstrip("=")
    )


def _after(cursor, project_id, execution_id, run_id):
    if not cursor:
        return 0
    try:
        decoded = json.loads(
            base64.b64decode(cursor + "=" * (-len(cursor) % 4), altchars=b"-_", validate=True)
        )
        if (
            not isinstance(decoded, list)
            or len(decoded) != 4
            or decoded[:3] != [project_id, execution_id, run_id]
            or isinstance(decoded[3], bool)
            or not isinstance(decoded[3], int)
            or not 0 <= decoded[3] <= 9223372036854775807
        ):
            raise ValueError("Cursor scope mismatch")
        return decoded[3]
    except (ValueError, TypeError, UnicodeError) as exc:
        raise HTTPException(422, "Observation cursor does not belong to this project and execution") from exc


def observations(db, project, user, state, entry, store, execution, permissions, *, limit, cursor):
    from hermes_core.execution_targets import validate_execution_target_snapshot

    from .delivery_execution import CLOSED, basis, context

    principal, _ = context(store, user, entry["workspace_id"])
    run_id = entry.get("run_id") or ""
    after = _after(cursor, project.id, entry["id"], run_id)
    run = store.get(principal, entry["workspace_id"], "runs", run_id) if run_id else None
    rows = (
        store.stream(principal, entry["workspace_id"], entity_id=run_id, after=after, limit=limit + 1)
        if run
        else []
    )
    more, rows = len(rows) > limit, rows[:limit]
    task = records(db, Task, project).filter_by(id=entry["task_id"]).first()
    requirement = records(db, Requirement, project).filter_by(id=entry["snapshot"]["requirement_id"]).first()
    actionable = task is not None and requirement is not None and task.req_id == requirement.id
    revision = state["flows"].get(requirement.id, default_flow())["revision"] if requirement else None
    stale = bool(
        not actionable
        or entry.get("planning_invalidated")
        or basis(task, requirement, revision) != entry["snapshot"]
    )
    run_data = run["data"] if run else {}
    attempt = run_data.get("attempt", 1)
    raw_nodes = run_data.get("nodes", entry.get("plan_nodes", entry.get("nodes", [])))
    results = run_data.get("node_results", {}) if run else {}
    nodes = []
    for node in raw_nodes:
        result = project_result(results.get(node["id"]))
        status = "pending"
        if result:
            status = (
                "skipped"
                if result["skipped"]
                else "passed"
                if result["succeeded"] is True
                else "failed"
                if result["succeeded"] is False
                else "pending"
            )
        if (
            result
            and result["succeeded"] is False
            and (result["attempt"] or 1) < attempt
            and run
            and run["status"] in {"queued", "retrying", "running"}
        ):
            status = "pending"
        if run and run["status"] == "running" and run_data.get("active_node") == node["id"]:
            status = "running"
        nodes.append(
            {
                "id": node["id"],
                "title": node.get("title") or node["id"],
                "kind": node.get("kind", "command"),
                "is_test": node["id"] in entry["test_node_ids"],
                "status": status,
                "result": result,
            }
        )
    test_nodes = [node for node in nodes if node["is_test"]]
    passed = sum(node["status"] == "passed" for node in test_nodes)
    failed = sum(node["status"] == "failed" for node in test_nodes)
    pending = len(test_nodes) - passed - failed
    target_ready = False
    if (
        run
        and run["status"] == "planned"
        and not stale
        and entry["status"] not in CLOSED
        and entry.get("target_snapshot")
    ):
        try:
            validate_execution_target_snapshot(
                store,
                execution,
                principal,
                entry["workspace_id"],
                entry["target_snapshot"],
                provider=(entry.get("agent_snapshot") or {}).get("provider", ""),
            )
            target_ready = True
        except CoreError:
            pass
    return {
        "project_id": project.id,
        "execution_id": entry["id"],
        "run_id": run_id,
        "run_version": run["version"] if run else 0,
        "attempt": attempt,
        "status": entry["status"]
        if entry["status"] in CLOSED or not run
        else "awaiting_review"
        if run["status"] == "completed"
        else run["status"],
        "stale": stale,
        "observed_at": stamp(),
        "events": [
            {
                "id": f"{run_id}:{row['seq']}",
                "seq": row["seq"],
                "at": str(row["created_at"]),
                "type": str(row["action"])[:120],
                "node_id": str(row["data"].get("node_id"))[:64]
                if row["data"].get("node_id") is not None
                else None,
                "status": str(row["data"].get("status"))[:80]
                if row["data"].get("status") is not None
                else None,
                "message": str(row["data"].get("message") or row["data"].get("error") or "")[-2000:],
                "attempt": _integer(row["data"].get("attempt")),
                "result": project_result(row["data"].get("result"), attempt=row["data"].get("attempt")),
            }
            for row in rows
        ],
        "next_cursor": _cursor(project.id, entry["id"], run_id, rows[-1]["seq"] if rows else after)
        if run
        else None,
        "more": more,
        "nodes": nodes,
        "tests": {
            "total": len(test_nodes),
            "passed": passed,
            "failed": failed,
            "pending": pending,
            "status": "not_configured"
            if not test_nodes
            else "failed"
            if failed
            else "pending"
            if pending
            else "passed",
        },
        "permissions": {
            "can_start": permissions["write"] and "execute" in principal.permissions and target_ready,
            "can_cancel": actionable
            and permissions["write"]
            and "execute" in principal.permissions
            and entry["status"] not in CLOSED
            and (not run or run["status"] != "completed"),
            "can_review": actionable
            and permissions["approve"]
            and "approve" in principal.permissions
            and entry["status"] not in CLOSED
            and bool(run and run["status"] in {"completed", "failed", "cancelled"}),
            "can_sync": actionable and permissions["write"] and "read" in principal.permissions,
        },
        "log_streaming": False,
    }
