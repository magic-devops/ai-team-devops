from contextlib import contextmanager

import pytest
from fastapi import HTTPException

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import agent_runs as runs
from sop_manager.routers.agent_runs import EvidenceIn, RunCreate, StatusUpdate


@contextmanager
def scoped_project(root, *, tenant="tenant-a", business="biz-a", project="project-a"):
    tokens = set_request_scope(
        tenant_id=tenant,
        project_id=project,
        project_path=root,
        tenant_code=tenant,
        business_code=business,
        project_code=project,
    )
    try:
        yield
    finally:
        reset_request_scope(tokens)


def test_retry_failed_agent_run_creates_recoverable_retry_run(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        original = runs.create_run(RunCreate(agent_id="coder", task_id="T-retry", meta={"lease_owner": "agent-a"}))
        runs.update_status(original["id"], StatusUpdate(status="failed", error_msg="unit tests failed"))
        runs.write_evidence(
            original["id"],
            EvidenceIn(
                artifact={"path": "artifacts/T-retry.log"},
                gate_results={"unit": "failed"},
                confidence=0.42,
            ),
        )

        retried = runs.retry_run(original["id"])
        listed = runs.list_runs(agent_id="coder", status="", limit=10)

    assert retried["retry_of"] == original["id"]
    assert retried["status"] == "pending"
    assert retried["retry_count"] == 1
    assert retried["artifact"] == {"path": "artifacts/T-retry.log"}
    assert retried["gate_results"] == {"unit": "failed"}
    assert {item["id"] for item in listed["items"]} == {original["id"], retried["id"]}


def test_retry_rejects_cross_project_run(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        original = runs.create_run(RunCreate(agent_id="coder", task_id="T-retry"))
        runs.update_status(original["id"], StatusUpdate(status="failed", error_msg="x"))

    with scoped_project(tmp_path, business="biz-a", project="project-b"):
        with pytest.raises(HTTPException) as exc:
            runs.retry_run(original["id"])

    assert exc.value.status_code == 404


def test_cancel_running_agent_run_records_reason(tmp_path):
    with scoped_project(tmp_path, business="biz-a", project="project-a"):
        run = runs.create_run(RunCreate(agent_id="coder", task_id="T-cancel"))
        runs.update_status(run["id"], StatusUpdate(status="running"))

        cancelled = runs.cancel_run(run["id"], runs.CancelIn(reason="manual stop"))
        summary = runs.runs_summary()["summary"]

    assert cancelled["status"] == "cancelled"
    assert cancelled["cancel_reason"] == "manual stop"
    assert cancelled["finished_at"]
    assert summary["cancelled"] == 1
