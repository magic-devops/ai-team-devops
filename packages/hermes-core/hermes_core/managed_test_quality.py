"""Pure managed-test evidence checks shared by live review and durable SQL proofs.

No output text is evidence of a test verdict. Only fixed command identities and
server-bound terminal results participate in the quality snapshot.
"""

from .models import CoreError
from .transactional import digest

PLAN_SCHEMA = "manager.execution-test-plan.v1"
QUALITY_SCHEMA = "manager.execution-quality.v1"


def _command(node):
    return (isinstance(node, dict) and node.get("kind") == "command"
            and isinstance(node.get("argv"), list) and bool(node["argv"])
            and all(isinstance(arg, str) and arg and "\x00" not in arg for arg in node["argv"])
            and not node.get("agent_id") and not node.get("prompt")
            and type(node.get("expected_exit_code")) is int)


def make_test_plan(nodes, node_ids):
    """Freeze only selected command definitions; Agent prompts cannot self-hash."""
    if (not isinstance(nodes, list) or not isinstance(node_ids, list) or len(node_ids) > 32
            or any(not isinstance(value, str) or not 1 <= len(value) <= 64 for value in node_ids)
            or len(set(node_ids)) != len(node_ids)):
        raise CoreError("invalid_test_plan", "Use unique explicit command test identities", 422)
    by_id = {}
    for node in nodes:
        if not isinstance(node, dict) or not isinstance(node.get("id"), str) or node["id"] in by_id:
            raise CoreError("invalid_test_plan", "The original node definitions must have unique identities", 422)
        by_id[node["id"]] = node
    if any(identity not in by_id or not _command(by_id[identity]) for identity in node_ids):
        raise CoreError("invalid_test_plan", "Tests must reference actual executable command definitions", 422)
    return {"schema": PLAN_SCHEMA, "node_ids": list(node_ids),
            "command_sha256": {identity: digest(by_id[identity]) for identity in node_ids}}


def valid_test_plan(plan, nodes):
    if (not isinstance(plan, dict) or set(plan) != {"schema", "node_ids", "command_sha256"}
            or plan.get("schema") != PLAN_SCHEMA or not isinstance(plan.get("command_sha256"), dict)):
        return False
    try:
        return plan == make_test_plan(nodes, plan.get("node_ids"))
    except (CoreError, ValueError, TypeError):
        return False


def evidence_binding(run_id, node, attempt):
    """Called by the authorized local/remote result owner, never copied from clients."""
    return {"run_id": run_id, "node_id": node["id"], "command_sha256": digest(node), "attempt": attempt}


def _facts(result):
    if not isinstance(result, dict):
        return None
    # Projected logs may be truncated/redacted. Verdicts and these bounded server
    # identities survive projection exactly, so no log digest is compared to SQL.
    return {"succeeded": result.get("succeeded"), "exit_code": result.get("exit_code"),
            "expected_exit_code": result.get("expected_exit_code"), "attempt": result.get("attempt"),
            "skipped": result.get("skipped") is True, "has_error": bool(result.get("error")),
            "evidence_binding": result.get("evidence_binding")}


def test_quality(run, plan):
    """Evaluate one fixed run; a prior successful result is reusable only in it."""
    data = run.get("data", {}) if isinstance(run, dict) else {}
    nodes = data.get("nodes", [])
    attempt = data.get("attempt", 1)
    attempt_valid = type(attempt) is int and attempt >= 1
    result = {"schema": QUALITY_SCHEMA, "status": "pending", "reason_codes": [],
              "execution_id": data.get("managed_execution_id", ""),
              "run_id": run.get("id", "") if run else "",
              "run_version": run.get("version", 0) if run else 0,
              "attempt": attempt if attempt_valid else 0, "test_node_ids": [],
              "test_plan_sha256": None, "results_sha256": None,
              "reused_node_ids": [], "tests": []}
    if not valid_test_plan(plan, nodes) or not attempt_valid:
        return {**result, "status": "invalid", "reason_codes": ["test_plan_invalid"]}
    result.update(test_node_ids=list(plan["node_ids"]), test_plan_sha256=digest(plan))
    if not plan["node_ids"]:
        return {**result, "status": "not_configured", "reason_codes": ["tests_not_configured"]}
    facts = {}
    statuses = []
    for identity in plan["node_ids"]:
        raw = data.get("node_results", {}).get(identity)
        fact = _facts(raw)
        facts[identity] = fact
        status = "pending"
        result_attempt = fact.get("attempt") if fact else None
        if fact:
            binding = fact["evidence_binding"]
            if (type(result_attempt) is not int or not 1 <= result_attempt <= attempt
                    or not isinstance(binding, dict) or type(binding.get("attempt")) is not int
                    or binding != {"run_id": result["run_id"], "node_id": identity,
                                   "command_sha256": plan["command_sha256"][identity], "attempt": result_attempt}
                    or type(fact["exit_code"]) is not int or type(fact["expected_exit_code"]) is not int
                    or fact["expected_exit_code"] != next(node["expected_exit_code"] for node in nodes if node["id"] == identity)):
                status = "invalid"
            elif fact["skipped"]:
                status = "skipped"
            elif fact["succeeded"] is True and not fact["has_error"] and fact["exit_code"] == fact["expected_exit_code"]:
                status = "passed"
            else:
                status = "failed"
        reused = status == "passed" and result_attempt < attempt
        if reused:
            result["reused_node_ids"].append(identity)
        result["tests"].append({"node_id": identity, "status": status,
                                "result_attempt": result_attempt if type(result_attempt) is int else None,
                                "reused": reused})
        statuses.append(status)
    result["results_sha256"] = digest(facts)
    if "invalid" in statuses:
        result.update(status="invalid", reason_codes=["test_evidence_invalid"])
    elif "failed" in statuses or "skipped" in statuses:
        result.update(status="failed", reason_codes=["tests_failed_or_skipped"])
    elif "pending" in statuses or not run or run.get("status") != "completed":
        result.update(status="pending", reason_codes=["tests_pending"])
    else:
        result["status"] = "passed"
    return result


def managed_run_quality(task, run):
    source = task.get("data", {}).get("source", {})
    data = run.get("data", {})
    plan = source.get("test_plan")
    quality = test_quality(run, plan)
    if (source.get("kind") != "manager.delivery" or not source.get("execution_id")
            or data.get("managed_execution_id") != source["execution_id"]
            or data.get("managed_test_plan") != plan
            or data.get("task_source", {}).get("task_id") != task.get("id")):
        quality.update(status="invalid", reason_codes=["test_source_changed"])
    return quality
