"""Managed acceptance requires a fixed test plan and server-bound command evidence."""

from copy import deepcopy

import pytest
from hermes_core.managed_test_quality import make_test_plan, managed_run_quality, test_quality as evaluate_quality
from hermes_core.models import CoreError, Node
from hermes_core.transactional import digest


def evidence(*, attempt=1):
    node = Node(id="tests", argv=["python", "-m", "pytest"]).model_dump()
    plan = make_test_plan([node], ["tests"])
    task = {"id": "runtime-task", "data": {"source": {
        "kind": "manager.delivery", "execution_id": "E", "test_plan": plan}}}
    result = {"succeeded": True, "exit_code": 0, "expected_exit_code": 0,
              "attempt": attempt, "evidence_binding": {
                  "run_id": "R", "node_id": "tests", "command_sha256": digest(node), "attempt": attempt}}
    run = {"id": "R", "version": 7, "status": "completed", "data": {
        "attempt": attempt, "nodes": [node], "node_results": {"tests": result},
        "task_source": {"task_id": task["id"]}, "managed_execution_id": "E", "managed_test_plan": plan}}
    return task, run, plan


def test_empty_explicit_plan_may_run_but_cannot_prove_tests():
    task, run, _ = evidence()
    plan = make_test_plan(run["data"]["nodes"], [])
    task["data"]["source"]["test_plan"] = run["data"]["managed_test_plan"] = plan
    assert managed_run_quality(task, run)["status"] == "not_configured"


@pytest.mark.parametrize("change", [
    lambda result: result.pop("exit_code"),
    lambda result: result.update(exit_code=True),
    lambda result: result.pop("expected_exit_code"),
    lambda result: result.pop("attempt"),
    lambda result: result.update(skipped=True),
    lambda result: result.update(error="Timeout"),
    lambda result: result.pop("evidence_binding"),
    lambda result: result["evidence_binding"].update(run_id="another-run"),
    lambda result: result["evidence_binding"].update(node_id="another-test"),
    lambda result: result["evidence_binding"].update(attempt=2),
    lambda result: result["evidence_binding"].update(command_sha256="0" * 64),
])
def test_missing_or_borrowed_result_cannot_pass(change):
    task, run, _ = evidence()
    change(run["data"]["node_results"]["tests"])
    assert managed_run_quality(task, run)["status"] != "passed"


def test_changed_command_and_mutated_source_cannot_borrow_old_test_plan():
    task, run, _ = evidence()
    run["data"]["nodes"][0]["argv"] = ["echo", "unverified"]
    assert managed_run_quality(task, run)["status"] == "invalid"
    task, run, _ = evidence()
    task["data"]["source"]["test_plan"] = make_test_plan(run["data"]["nodes"], [])
    assert managed_run_quality(task, run)["status"] == "invalid"


def test_same_run_unchanged_success_reuse_is_explicit_and_bound_to_current_attempt():
    task, run, _ = evidence()
    run["data"]["attempt"] = 2
    result = managed_run_quality(task, run)
    assert result["status"] == "passed"
    assert result["attempt"] == 2
    assert result["reused_node_ids"] == ["tests"]
    assert result["tests"][0]["result_attempt"] == 1
    run["id"] = "new-run"
    assert managed_run_quality(task, run)["status"] == "invalid"


def test_quality_digest_ignores_truncated_presentation_logs_but_binds_verdict():
    _, run, plan = evidence()
    original = evaluate_quality(run, plan)
    run["data"]["node_results"]["tests"]["stdout"] = "x" * 50000
    assert evaluate_quality(run, plan) == original
    run["version"] += 1
    assert evaluate_quality(run, plan) != original


def test_plan_only_contains_selected_command_definitions_and_is_detached():
    _, run, plan = evidence()
    assert plan == {"schema": "manager.execution-test-plan.v1", "node_ids": ["tests"],
                    "command_sha256": {"tests": digest(run["data"]["nodes"][0])}}
    copied = deepcopy(plan)
    run["data"]["nodes"][0]["argv"].append("--changed")
    assert plan == copied
    with pytest.raises(CoreError):
        make_test_plan([Node(id="approve", kind="approval").model_dump()], ["approve"])


def test_legacy_original_without_test_plan_is_readable_but_never_test_verified():
    task, run, _ = evidence()
    task["data"]["source"].pop("test_plan")
    run["data"].pop("managed_test_plan")
    assert managed_run_quality(task, run)["status"] == "invalid"
