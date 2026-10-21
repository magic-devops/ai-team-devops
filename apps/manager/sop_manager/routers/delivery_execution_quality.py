"""One quality rule for current native review and durable delivery verification."""

from hermes_core.managed_test_quality import make_test_plan, managed_run_quality, test_quality
from hermes_core.models import CoreError, Node
from hermes_core.transactional import digest


def entry_nodes(entry):
    # Full dispatch originals, never the thin presentation-only plan_nodes.
    nodes = entry.get("test_nodes", []) if entry.get("agent_id") else entry.get("nodes", [])
    if not isinstance(nodes, list) or any(not isinstance(node, dict) for node in nodes):
        raise CoreError("invalid_test_plan", "Retain the complete original node definitions", 422)
    return [Node.model_validate(node).model_dump() for node in nodes]


def execution_quality(entry, run=None, runtime_task=None):
    """Pure and fail closed; reading an old original never upgrades its plan."""
    plan = entry.get("test_plan")
    try:
        nodes = entry_nodes(entry)
        matches = make_test_plan(nodes, entry.get("test_node_ids", [])) == plan
    except (CoreError, ValueError, TypeError):
        nodes, matches = [], False
    source = run or {"id": "", "version": 0, "status": "planned", "data": {
        "nodes": nodes, "attempt": entry.get("attempt", 1),
        "managed_execution_id": entry["id"]}}
    quality = managed_run_quality(runtime_task, source) if runtime_task else test_quality(source, plan)
    if (not matches or quality["execution_id"] != entry["id"]
            or run and (run.get("id") != entry.get("run_id")
                        or run.get("data", {}).get("managed_test_plan") != plan)):
        quality.update(status="invalid", reason_codes=["test_plan_changed"])
    return quality


def accepted_quality_valid(entry):
    """Recheck fixed acceptance facts without reading another runtime or logs."""
    review = entry.get("review") or {}
    saved = review.get("quality")
    if (not isinstance(saved, dict) or saved.get("status") != "passed"
            or not review.get("evidence_sha256")):
        return False
    try:
        run = {"id": entry.get("run_id", ""), "version": entry.get("run_version", 0), "status": "completed",
               "data": {"nodes": entry_nodes(entry), "attempt": entry.get("attempt", 1),
                        "managed_execution_id": entry["id"], "managed_test_plan": entry.get("test_plan"),
                        "node_results": entry.get("results", {})}}
        return saved == execution_quality(entry, run)
    except (CoreError, ValueError, TypeError, KeyError):
        return False


def review_capabilities(project, permissions, principal, entry, run, verification, quality):
    from .delivery_execution import CLOSED
    from .delivery_task_submission_service import native_takeover

    can_review = bool(project.status == "active" and permissions.get("approve")
        and "approve" in principal.permissions and entry.get("status") not in CLOSED
        and verification.execution_snapshot_current(entry)
        and entry["task_id"] not in verification.work_order_active_task_ids
        and not native_takeover(verification, entry)
        and run and run["status"] in {"completed", "failed", "cancelled"})
    return {"can_review": can_review, "can_accept": can_review and quality["status"] == "passed"}


def review_verified(entry, run, quality, *, current):
    review = entry.get("review") or {}
    return bool(current and run and entry.get("status") == "accepted"
        and review.get("decision") == "accept" and quality["status"] == "passed"
        and review.get("run_version") == run["version"]
        and review.get("evidence_sha256") == digest(run)
        and review.get("quality") == quality and accepted_quality_valid(entry))
