# ruff: noqa: F811 -- pytest fixture injection and shared fixture helpers
"""Business runtime evidence/control tests with real SQL and runtime stores."""

import importlib
import importlib.util
from copy import deepcopy

import pytest
from fastapi import HTTPException
from sop_manager.routers.delivery_execution_runtime_contract import (
    ExecutionControlPreviewInput,
    ExecutionRuntimeControl,
)
from sop_manager.routers.sql_models import DeliveryWorkspace, Project, User
from test_delivery_execution import bridge, finish, queue, sync  # noqa: F401
from test_delivery_workbench import command, env  # noqa: F401


def runtime():
    name = "sop_manager.routers.delivery_execution_runtime"
    assert importlib.util.find_spec(name) is not None, "Missing scoped runtime service"
    return importlib.import_module(name)


def scope(bridge):
    db = bridge[1]()
    project = db.get(Project, "project")
    user = db.get(User, "lead")
    state = deepcopy(db.get(DeliveryWorkspace, "project").data)
    return db, project, user, state, state["executions"][-1]


def preview(bridge, action="execution.start", reason="Reviewed the fixed run"):
    module = runtime()
    db, project, user, state, entry = scope(bridge)
    try:
        return module.control_preview(db, project, user, state,
            ExecutionControlPreviewInput(id=entry["id"], action=action, reason=reason),
            bridge[2], bridge[0].app.state.hermes_execution,
            {"write": True, "approve": True}, version=db.get(DeliveryWorkspace, "project").version)
    finally:
        db.close()


def test_runtime_detail_is_pure_and_does_not_expose_owner_or_credentials(bridge):
    entry = sync(bridge, queue(bridge))
    db, project, user, state, _ = scope(bridge)
    try:
        before = deepcopy(state)
        counts = (len(bridge[2].list(bridge[3], bridge[4]["id"], "runs")),
                  len(bridge[2].stream(bridge[3], bridge[4]["id"])))
        detail = runtime().runtime_detail(db, project, user, state, entry, bridge[2],
                                         bridge[0].app.state.hermes_execution,
                                         {"write": True, "approve": True})
        assert detail["run_id"] == entry["run_id"]
        assert detail["controls"]["start"]["allowed"] is True
        assert detail["active_node_id"] is None and detail["stop"] is None
        assert state == before
        assert counts == (len(bridge[2].list(bridge[3], bridge[4]["id"], "runs")),
                          len(bridge[2].stream(bridge[3], bridge[4]["id"])))
        assert "execution_owner" not in str(detail) and "credential" not in str(detail)
    finally:
        db.close()


def test_output_is_exact_attempt_and_inactive_workspace_history_is_readable(bridge):
    entry = sync(bridge, queue(bridge))
    finish(bridge, entry)
    store, principal, ws = bridge[2:5]
    run = store.get(principal, ws["id"], "runs", entry["run_id"])
    store.mutate(principal, "", "workspaces", ws["id"], operation="test.inactive", key="inactive",
                 request={}, trace="test", expected=ws["version"],
                 transform=lambda row: {"status": "inactive"})
    db, project, user, state, _ = scope(bridge)
    try:
        result = runtime().node_output(db, project, user, state, entry, store,
                                       node_id="tests", attempt=1, stream="stdout", limit=50, cursor="")
        assert result["source"] == "completed_node_result"
        assert result["chunks"][0]["text"] == "test output"
        assert result["available_attempts"] == [1]
        for node, attempt in (("missing", 1), ("tests", 2)):
            with pytest.raises(HTTPException) as failure:
                runtime().node_output(db, project, user, state, entry, store,
                                      node_id=node, attempt=attempt, stream="stdout", limit=50, cursor="")
            assert failure.value.status_code == 404
        assert store.get(principal, ws["id"], "runs", run["id"])["version"] == run["version"]
    finally:
        db.close()


def test_fixed_start_ignores_heartbeat_version_and_recovers_core_receipt(bridge):
    entry = sync(bridge, queue(bridge))
    proposal = preview(bridge)
    assert proposal["allowed"] is True
    payload = ExecutionRuntimeControl.model_validate(proposal["payload"])
    store, principal, ws = bridge[2:5]
    run = store.get(principal, ws["id"], "runs", entry["run_id"])
    store.mutate(principal, ws["id"], "runs", run["id"], operation="test.heartbeat", key="heartbeat",
                 request={}, trace="test", expected=run["version"],
                 transform=lambda row: {"data": {**row["data"], "lease_expires_at": 12345}})
    bridge[1].configure(autoflush=False)
    for _ in range(2):
        db, project, user, state, _entry = scope(bridge)
        try:
            applied = runtime().apply_runtime_control(db, project, user, state, "execution.start", payload,
                store, bridge[0].app.state.hermes_execution, command_key="fixed-start")
            assert applied[2]["start_run"]["run_id"] == entry["run_id"]
            assert state["executions"][-1]["status"] == "queued"
            db.rollback()  # Model the Manager transaction failing after the Core commit.
        finally:
            db.close()
    rows = store.stream(principal, ws["id"], entity_id=run["id"])
    assert sum(row["action"] == "run.start" for row in rows) == 1


def test_control_basis_change_and_scope_never_execute(bridge):
    entry = sync(bridge, queue(bridge))
    proposal = preview(bridge)
    payload = ExecutionRuntimeControl.model_validate(proposal["payload"])
    assert command(bridge[0], "task.update", {"id": entry["task_id"], "description": "Changed scope"}).status_code == 200
    db, project, user, state, _ = scope(bridge)
    try:
        with pytest.raises(HTTPException) as failure:
            runtime().apply_runtime_control(db, project, user, state, "execution.start", payload,
                bridge[2], bridge[0].app.state.hermes_execution, command_key="stale-start")
        assert failure.value.status_code == 409
        assert bridge[2].get(bridge[3], bridge[4]["id"], "runs", entry["run_id"])["status"] == "planned"
        other = db.get(Project, "other")
        with pytest.raises(HTTPException) as failure:
            runtime().runtime_detail(db, other, user, {"executions": []}, entry, bridge[2],
                                     bridge[0].app.state.hermes_execution, {"write": True, "approve": True})
        assert failure.value.status_code == 404
    finally:
        db.close()


def test_observation_output_and_usage_are_sanitized_before_return(bridge):
    entry = sync(bridge, queue(bridge))
    store, principal, ws = bridge[2:5]
    run = store.get(principal, ws["id"], "runs", entry["run_id"])
    result = {"succeeded": False, "exit_code": 1, "stdout": "token=private-value\nBearer super-secret",
              "agent": {"provider": "codex", "message": "password=hunter2",
                        "usage": {"input_tokens": 12, "token": "private-value", "nested": {"password": "hunter2"}}}}
    store.mutate(principal, ws["id"], "runs", run["id"], operation="node.evidence", key="evidence",
                 request={}, trace="test", expected=run["version"],
                 transform=lambda row: {"status": "failed", "data": {**row["data"], "node_results": {"tests": result}}},
                 audit_data={"node_id": "tests", "attempt": 1, "message": "secret=private-value", "result": result})
    response = bridge[0].get(f"/api/v1/delivery/executions/{entry['id']}/observations")
    assert response.status_code == 200, response.text
    assert "private-value" not in response.text and "hunter2" not in response.text and "super-secret" not in response.text
    assert response.json()["nodes"][0]["result"]["agent"]["usage"] == {"input_tokens": 12}


def test_exact_output_cursor_cannot_cross_stream_or_attempt_and_chunks_do_not_change_run_version(bridge):
    from hermes_core.run_output import append_run_events

    entry = sync(bridge, queue(bridge))
    store, principal, ws = bridge[2:5]
    run = store.get(principal, ws["id"], "runs", entry["run_id"])
    run = store.mutate(principal, ws["id"], "runs", run["id"], operation="test.claim", key="owner",
        request={}, trace="test", expected=run["version"], transform=lambda row: {
            "status": "running", "data": {**row["data"], "active_node": "tests", "execution_owner": "private-owner", "attempt": 1}})
    append_run_events(store, principal, ws["id"], run["id"], owner="private-owner", node_id="tests", attempt=1,
        events=[{"source_seq": 1, "stream": "stdout", "text": "safe line\n"}], idempotency_key="output-one")
    db, project, user, state, _ = scope(bridge)
    try:
        first = runtime().node_output(db, project, user, state, entry, store,
            node_id="tests", attempt=1, stream="stdout", limit=1, cursor="")
        assert first["source"] == "live_capture" and first["chunks"][0]["text"] == "safe line\n"
        assert not first["complete"] and "private-owner" not in str(first)
        second = runtime().node_output(db, project, user, state, entry, store,
            node_id="tests", attempt=1, stream="stdout", limit=1, cursor=first["next_cursor"])
        assert second["chunks"] == []
        with pytest.raises(HTTPException) as failure:
            runtime().node_output(db, project, user, state, entry, store,
                node_id="tests", attempt=1, stream="stderr", limit=1, cursor=first["next_cursor"])
        assert failure.value.status_code == 422
        assert store.get(principal, ws["id"], "runs", run["id"])["version"] == run["version"]
    finally:
        db.close()


def test_cancel_is_fixed_cas_and_never_claims_stop_before_ack(bridge):
    from hermes_core.run_controls import acknowledge_stop

    entry = sync(bridge, queue(bridge))
    store, principal, ws = bridge[2:5]
    run = store.get(principal, ws["id"], "runs", entry["run_id"])
    store.mutate(principal, ws["id"], "runs", run["id"], operation="test.claim", key="owner",
        request={}, trace="test", expected=run["version"], transform=lambda row: {
            "status": "running", "data": {**row["data"], "active_node": "tests", "execution_owner": "private-owner", "attempt": 1}})
    fixed = preview(bridge, "execution.cancel")
    assert fixed["allowed"]
    client = bridge[0]
    version = client.get("/api/v1/delivery/workspace").json()["version"]
    failed = command(client, "execution.cancel", fixed["payload"], key="fixed-cancel", version=version - 1)
    assert failed.status_code == 409
    assert store.get(principal, ws["id"], "runs", run["id"])["status"] == "running"
    cancelled = command(client, "execution.cancel", fixed["payload"], key="fixed-cancel", version=version)
    assert cancelled.status_code == 200, cancelled.text
    current = cancelled.json()["executions"][-1]
    assert current["stop_pending"] and current["stop_snapshot"]["state"] == "requested"
    replay = command(client, "execution.cancel", fixed["payload"], key="fixed-cancel", version=version)
    assert replay.status_code == 200 and replay.json()["replayed"]
    duplicate = command(client, "execution.cancel", {"id": entry["id"]})
    assert duplicate.status_code == 422
    blocked = command(client, "execution.queue", __import__("test_delivery_execution").queue_payload(bridge))
    assert blocked.status_code == 409 and blocked.json()["detail"]["code"] == "execution_stop_unresolved"
    run = store.get(principal, ws["id"], "runs", run["id"])
    acknowledge_stop(store, principal, ws["id"], run["id"], request_id=run["data"]["stop_request"]["id"],
        owner="private-owner", attempt=1, node_id="tests", final_source_seq=0,
        evidence={"process_tree_stopped": True, "wait_completed": True, "output_eof": True}, idempotency_key="ack")
    assert client.get(f"/api/v1/delivery/executions/{entry['id']}/runtime").json()["stop"]["state"] == "confirmed"
    with bridge[1]() as db:
        assert db.get(DeliveryWorkspace, "project").data["executions"][-1]["stop_pending"] is True
    response = command(client, "execution.sync", {"id": entry["id"]})
    assert response.status_code == 200, response.text
    assert response.json()["executions"][-1]["stop_pending"] is False
    assert response.json()["executions"][-1]["status"] == "cancelled"
    assert response.json()["tasks"][0]["status"] != "completed"


def test_paused_project_blocks_start_but_allows_cancellation(bridge):
    sync(bridge, queue(bridge))
    client = bridge[0]
    lifecycle = client.post("/api/v1/delivery/project-lifecycle-preview", json={"target_status": "paused", "reason": "Paused by lead"})
    assert lifecycle.status_code == 200, lifecycle.text
    payload = {"target_status": "paused", "reason": "Paused by lead", "preview_basis": lifecycle.json()["preview_basis"]}
    assert command(client, "project.lifecycle", payload).status_code == 200
    assert preview(bridge)["allowed"] is False
    cancel = preview(bridge, "execution.cancel")
    assert cancel["allowed"]
    response = command(client, "execution.cancel", cancel["payload"])
    assert response.status_code == 200, response.text
    assert response.json()["executions"][-1]["stop_snapshot"]["state"] == "not_started"


def test_cancelled_legacy_unrecorded_stop_blocks_project_archive_and_redispatch(bridge):
    entry = sync(bridge, queue(bridge))
    db, project, user, state, _ = scope(bridge)
    try:
        state["executions"][-1]["status"] = "cancelled"
        facts = runtime().unresolved_stop_targets(db, project, state)
        assert len(facts) == 1 and facts[0]["status"] == "unknown"
        assert facts[0]["target"]["execution_id"] == entry["id"]
        with pytest.raises(HTTPException) as failure:
            runtime().require_previous_stops(db, project, user, state, entry["task_id"], bridge[2])
        assert failure.value.status_code == 409
    finally:
        db.close()


def gate(bridge, entry):
    from hermes_core.models import Node
    from hermes_core.transactional import digest

    store, principal, ws = bridge[2:5]
    run = store.get(principal, ws["id"], "runs", entry["run_id"])
    run = store.mutate(principal, ws["id"], "runs", run["id"], operation="test.gate", key="gate",
        request={}, trace="test", expected=run["version"], transform=lambda row: {
            "status": "interrupted", "data": {**row["data"], "active_node": "gate", "attempt": 1,
                "nodes": [*row["data"]["nodes"], Node(id="gate", kind="approval").model_dump()]}})
    definition = {key: run["data"].get(key) for key in ("nodes", "workspace_root", "workspace_version", "isolation", "base_commit", "agent_bindings", "agent_source")}
    return store.create(principal, ws["id"], "approvals", {"title": "Review gate", "run_id": run["id"],
        "node_id": "gate", "definition_hash": digest(definition), "attempt": 1}, "approval", "test",
        status="pending", entity_id="approval-one")


def test_rejecting_gate_is_stale_scope_cleanup_and_does_not_require_project_active(bridge):
    entry = sync(bridge, queue(bridge))
    approval = gate(bridge, entry)
    client = bridge[0]
    assert command(client, "task.update", {"id": entry["task_id"], "description": "Scope changed"}).status_code == 200
    lifecycle = client.post("/api/v1/delivery/project-lifecycle-preview", json={"target_status": "paused", "reason": "Paused by lead"}).json()
    assert command(client, "project.lifecycle", {"target_status": "paused", "reason": "Paused by lead",
        "preview_basis": lifecycle["preview_basis"]}).status_code == 200
    db, project, user, state, _ = scope(bridge)
    try:
        reject = runtime().control_preview(db, project, user, state, ExecutionControlPreviewInput(
            id=entry["id"], action="execution.approval", reason="Reject obsolete gate", approval_id=approval["id"], decision="reject"),
            bridge[2], client.app.state.hermes_execution, {"write": True, "approve": True}, version=0)
        assert reject["allowed"] is True
        runtime().apply_runtime_control(db, project, user, state, "execution.approval",
            ExecutionRuntimeControl.model_validate(reject["payload"]), bridge[2], client.app.state.hermes_execution,
            command_key="reject-stale-gate")
        assert bridge[2].get(bridge[3], bridge[4]["id"], "approvals", approval["id"])["status"] == "rejected"
        assert bridge[2].get(bridge[3], bridge[4]["id"], "runs", entry["run_id"])["status"] == "failed"
    finally:
        db.close()


def test_new_queued_start_confirmation_keeps_one_run_and_attempt(bridge):
    entry = sync(bridge, queue(bridge))
    first = preview(bridge)
    db, project, user, state, _ = scope(bridge)
    try:
        runtime().apply_runtime_control(db, project, user, state, "execution.start",
            ExecutionRuntimeControl.model_validate(first["payload"]), bridge[2], bridge[0].app.state.hermes_execution,
            command_key="first-queue-start")
    finally:
        db.close()
    recovered = preview(bridge)
    assert recovered["allowed"] is True
    db, project, user, state, _ = scope(bridge)
    try:
        applied = runtime().apply_runtime_control(db, project, user, state, "execution.start",
            ExecutionRuntimeControl.model_validate(recovered["payload"]), bridge[2], bridge[0].app.state.hermes_execution,
            command_key="explicit-queued-recovery")
        assert applied[2]["start_run"]["attempt"] == 1
        assert applied[2]["start_run"]["run_id"] == entry["run_id"]
        assert len(bridge[2].list(bridge[3], bridge[4]["id"], "runs")) == 1
    finally:
        db.close()


def test_old_start_receipt_carries_original_attempt_and_current_authority_is_required(bridge):
    entry = sync(bridge, queue(bridge))
    fixed = ExecutionRuntimeControl.model_validate(preview(bridge)["payload"])
    db, project, user, state, _ = scope(bridge)
    try:
        runtime().apply_runtime_control(db, project, user, state, "execution.start", fixed,
            bridge[2], bridge[0].app.state.hermes_execution, command_key="old-start")
        run = bridge[2].get(bridge[3], bridge[4]["id"], "runs", entry["run_id"])
        bridge[2].mutate(bridge[3], bridge[4]["id"], "runs", run["id"], operation="test.later_attempt", key="attempt2",
            request={}, trace="test", expected=run["version"], transform=lambda row: {
                "status": "retrying", "data": {**row["data"], "attempt": 2}})
        applied = runtime().apply_runtime_control(db, project, user, state, "execution.start", fixed,
            bridge[2], bridge[0].app.state.hermes_execution, command_key="old-start")
        assert applied[2]["start_run"]["attempt"] == 1
        user.role = "developer"
        with pytest.raises(HTTPException) as failure:
            runtime().apply_runtime_control(db, project, user, state, "execution.start", fixed,
                bridge[2], bridge[0].app.state.hermes_execution, command_key="old-start")
        assert failure.value.status_code == 403
    finally:
        db.rollback()
        db.close()


def test_terminal_cancel_retains_missing_physical_proof_as_explicit_unknown(bridge):
    entry = sync(bridge, queue(bridge))
    store, principal, ws = bridge[2:5]
    run = store.get(principal, ws["id"], "runs", entry["run_id"])
    store.mutate(principal, ws["id"], "runs", run["id"], operation="test.legacy_result", key="legacy",
        request={}, trace="test", expected=run["version"], transform=lambda row: {"status": "failed",
            "data": {**row["data"], "node_results": {"tests": {"succeeded": False, "exit_code": 1}}}})
    fixed = preview(bridge, "execution.cancel")
    response = command(bridge[0], "execution.cancel", fixed["payload"])
    assert response.status_code == 200, response.text
    result = response.json()["executions"][-1]
    assert result["stop_pending"] is True
    assert result["stop_snapshot"]["state"] == "unknown"
    assert bridge[0].get(f"/api/v1/delivery/executions/{entry['id']}/runtime").json()["stop"]["state"] == "unknown"
    assert bridge[0].get(f"/api/v1/delivery/executions/{entry['id']}/observations").json()["permissions"]["can_sync"]


def test_controls_refuse_a_run_whose_runtime_envelope_points_at_another_intent(bridge):
    entry = sync(bridge, queue(bridge))
    store, principal, ws = bridge[2:5]
    task = store.get(principal, ws["id"], "tasks", entry["runtime_task_id"])
    store.mutate(principal, ws["id"], "tasks", task["id"], operation="test.source_changed", key="source-changed",
        request={}, trace="test", expected=task["version"], transform=lambda row: {
            "data": {**row["data"], "source": {**row["data"]["source"], "execution_id": "another-intent"}}})
    value = preview(bridge)
    assert value["allowed"] is False
    assert value["reasons"][0]["code"] == "execution_source_changed"
    assert preview(bridge, "execution.cancel")["allowed"] is False


def test_control_sql_projection_is_committed_with_production_autoflush_disabled(bridge):
    bridge[1].configure(autoflush=False)
    entry = sync(bridge, queue(bridge))
    fixed = preview(bridge, "execution.cancel")
    result = command(bridge[0], "execution.cancel", fixed["payload"])
    assert result.status_code == 200, result.text
    with bridge[1]() as db:
        from sop_manager.routers.sql_models import Task

        persisted = db.get(DeliveryWorkspace, "project").data["executions"][-1]
        assert persisted["status"] == "cancelled" and persisted["stop_pending"] is False
        assert persisted["stop_snapshot"]["state"] == "not_started"
        assert db.get(Task, entry["task_id"]).status == "blocked"


def test_observations_preserve_whitespace_of_sanitized_output(bridge):
    entry = sync(bridge, queue(bridge))
    store, principal, ws = bridge[2:5]
    run = store.get(principal, ws["id"], "runs", entry["run_id"])
    store.mutate(principal, ws["id"], "runs", run["id"], operation="test.completed", key="whitespace",
        request={}, trace="test", expected=run["version"], transform=lambda row: {"status": "completed",
            "data": {**row["data"], "node_results": {"tests": {"succeeded": True, "exit_code": 0,
                "stdout": "  line  \n\n", "stderr": "  warning\n"}}}})
    result = bridge[0].get(f"/api/v1/delivery/executions/{entry['id']}/observations").json()["nodes"][0]["result"]
    assert result["stdout"] == "  line  \n\n" and result["stderr"] == "  warning\n"
