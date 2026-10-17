# ruff: noqa: F811 -- pytest fixture injection
"""Approval gates must be reachable through a normal, public dispatch plan."""

import pytest
from test_delivery_execution import bridge, queue_payload, sync  # noqa: F401
from test_delivery_workbench import command, env  # noqa: F401


def approval_plan(bridge):
    return {**queue_payload(bridge), "nodes": [
        {"id": "prepare", "argv": ["controlled-tool", "prepare"]},
        {"id": "human_gate", "title": "Review before testing", "kind": "approval"},
        {"id": "verify", "argv": ["controlled-tool", "verify"]},
    ], "test_node_ids": ["verify"]}


@pytest.mark.parametrize("decision", ["approve", "reject"])
def test_public_plan_reaches_real_checkpoint_and_exact_approval_controls(bridge, monkeypatch, decision):
    client, _, store, principal, workspace, _, _ = bridge
    calls = []

    def controlled_tool(_principal, _workspace, _run_id, node, _root, _owner):
        calls.append(node.id)
        return {"succeeded": True, "exit_code": 0, "stdout": node.id,
                "expected_exit_code": 0, "process_tree_stopped": True,
                "wait_completed": True, "output_eof": True}

    monkeypatch.setattr(client.app.state.hermes_execution, "tool", controlled_tool)
    plan = approval_plan(bridge)
    preview = client.post("/api/v1/delivery/execution-preview", json=plan)
    assert preview.status_code == 200, preview.text
    assert [node["kind"] for node in preview.json()["nodes"]] == ["command", "approval", "command"]
    queued = command(client, "execution.queue", plan)
    assert queued.status_code == 200, queued.text
    entry = sync(bridge, queued.json()["executions"][-1])
    started = client.post("/api/v1/delivery/execution-control-preview", json={
        "id": entry["id"], "action": "execution.start", "reason": "Start the reviewed gate plan",
    })
    assert started.status_code == 200 and started.json()["allowed"], started.text
    response = command(client, "execution.start", started.json()["payload"], version=started.json()["version"])
    assert response.status_code == 200, response.text
    facts = client.get(f"/api/v1/delivery/executions/{entry['id']}/runtime").json()
    assert facts["runtime_status"] == "interrupted" and facts["active_node_id"] == "human_gate"
    assert calls == ["prepare"]
    approval = facts["approval"]
    assert approval["node_id"] == "human_gate" and approval["attempt"] == 1
    fixed = client.post("/api/v1/delivery/execution-control-preview", json={
        "id": entry["id"], "action": "execution.approval", "reason": "Human reviewed the actual checkpoint",
        "approval_id": approval["id"], "decision": decision,
    })
    assert fixed.status_code == 200 and fixed.json()["allowed"], fixed.text
    body = {"action": "execution.approval", "payload": fixed.json()["payload"],
            "expected_version": fixed.json()["version"], "idempotency_key": f"gate-{decision}"}
    decided = client.post("/api/v1/delivery/commands", json=body)
    assert decided.status_code == 200, decided.text
    run = store.get(principal, workspace["id"], "runs", entry["run_id"])
    assert run["status"] == ("completed" if decision == "approve" else "failed")
    assert calls == (["prepare", "verify"] if decision == "approve" else ["prepare"])
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 200 and replay.json()["replayed"], replay.text
    assert calls == (["prepare", "verify"] if decision == "approve" else ["prepare"])
    final = sync(bridge, entry)
    assert final["status"] == ("awaiting_review" if decision == "approve" else "failed")
    tasks = client.get("/api/v1/delivery/workspace").json()["tasks"]
    assert tasks[0]["status"] != "completed"
    if decision == "approve":
        observation = client.get(f"/api/v1/delivery/executions/{entry['id']}/observations").json()
        assert observation["tests"] == {"total": 1, "passed": 1, "failed": 0, "pending": 0, "status": "passed"}
        assert run["data"]["node_results"]["human_gate"]["succeeded"] is True


@pytest.mark.parametrize("change", [
    {"nodes": [{"id": "gate", "kind": "approval"}], "test_node_ids": []},
    {"test_node_ids": ["human_gate"]},
    {"nodes": [{"id": "gate", "kind": "approval", "argv": ["unexpected"]}, {"id": "verify", "argv": ["tool"]}]},
    {"nodes": [{"id": "gate", "kind": "approval", "agent_id": "agent"}, {"id": "verify", "argv": ["tool"]}]},
    {"nodes": [{"id": "gate", "kind": "approval", "prompt": "unexpected"}, {"id": "verify", "argv": ["tool"]}]},
    {"nodes": [{"id": "verify", "kind": "approval"}, {"id": "verify", "argv": ["tool"]}]},
])
def test_public_preview_rejects_nonpure_untested_or_commandless_gates(bridge, change):
    plan = {**approval_plan(bridge), **change}
    response = bridge[0].post("/api/v1/delivery/execution-preview", json=plan)
    assert response.status_code == 422, response.text
    assert command(bridge[0], "execution.queue", plan).status_code == 422
    assert not bridge[2].list(bridge[3], bridge[4]["id"], "runs")


def test_remote_approval_plan_is_rejected_before_intent_or_dispatch(bridge):
    body = {**approval_plan(bridge), "target_kind": "device", "target_device_id": "paired-device"}
    preview = bridge[0].post("/api/v1/delivery/execution-preview", json=body)
    assert preview.status_code == 422, preview.text
    assert preview.json()["detail"]["code"] == "target_approval_unsupported"
    queued = command(bridge[0], "execution.queue", body)
    assert queued.status_code == 422 and queued.json()["detail"]["code"] == "target_approval_unsupported"
    assert bridge[0].get("/api/v1/delivery/workspace").json()["executions"] == []
    assert not bridge[2].list(bridge[3], bridge[4]["id"], "runs")


def test_agent_posttests_still_reject_approval_gates(bridge):
    body = {**queue_payload(bridge), "nodes": [], "agent_id": "agent-profile", "agent_version": 1,
            "test_node_ids": [], "test_nodes": [{"id": "gate", "kind": "approval"}]}
    preview = bridge[0].post("/api/v1/delivery/execution-preview", json=body)
    assert preview.status_code == 422 and "Post-agent tests require executable command nodes only" in preview.text
    assert command(bridge[0], "execution.queue", body).status_code == 422
    assert bridge[0].get("/api/v1/delivery/workspace").json()["executions"] == []


def pending_public_gate(bridge, monkeypatch):
    client = bridge[0]
    monkeypatch.setattr(client.app.state.hermes_execution, "tool", lambda *_args: {
        "succeeded": True, "exit_code": 0, "stdout": "controlled command completed",
        "process_tree_stopped": True, "wait_completed": True, "output_eof": True,
    })
    queued = command(client, "execution.queue", approval_plan(bridge))
    assert queued.status_code == 200, queued.text
    entry = sync(bridge, queued.json()["executions"][-1])
    preview = client.post("/api/v1/delivery/execution-control-preview", json={
        "id": entry["id"], "action": "execution.start", "reason": "Start the actual public gate plan",
    })
    assert preview.status_code == 200 and preview.json()["allowed"], preview.text
    response = command(client, "execution.start", preview.json()["payload"], version=preview.json()["version"])
    assert response.status_code == 200, response.text
    assert client.get(f"/api/v1/delivery/executions/{entry['id']}/runtime").json()["runtime_status"] == "interrupted"
    return entry


@pytest.mark.parametrize("changed", ["paused", "stale"])
def test_runtime_exposes_independent_reject_capability_for_cleanup(bridge, monkeypatch, changed):
    from dataclasses import replace

    from sop_manager.routers import delivery_issue_evidence

    entry = pending_public_gate(bridge, monkeypatch)
    client = bridge[0]
    if changed == "paused":
        preview = client.post("/api/v1/delivery/project-lifecycle-preview", json={
            "target_status": "paused", "reason": "Pause at the real human gate",
        })
        assert preview.status_code == 200, preview.text
        assert command(client, "project.lifecycle", {"target_status": "paused",
            "reason": "Pause at the real human gate", "preview_basis": preview.json()["preview_basis"]}).status_code == 200
    else:
        assert command(client, "task.update", {"id": entry["task_id"], "description": "Changed task scope at gate"}).status_code == 200
    response = client.get(f"/api/v1/delivery/executions/{entry['id']}/runtime")
    assert response.status_code == 200, response.text
    facts = response.json()
    assert facts["controls"]["approval"]["allowed"] is False
    assert facts["controls"]["approval_reject"]["allowed"] is True
    reject = client.post("/api/v1/delivery/execution-control-preview", json={
        "id": entry["id"], "action": "execution.approval", "reason": "Reject the pending obsolete gate",
        "approval_id": facts["approval"]["id"], "decision": "reject",
    })
    assert reject.status_code == 200 and reject.json()["allowed"], reject.text
    original = delivery_issue_evidence.runtime_identity
    monkeypatch.setattr(delivery_issue_evidence, "runtime_identity", lambda user, store: (
        replace(original(user, store), permissions=original(user, store).permissions - {"approve"})))
    denied = client.get(f"/api/v1/delivery/executions/{entry['id']}/runtime")
    assert denied.status_code == 200, denied.text
    assert denied.json()["controls"]["approval"]["allowed"] is False
    assert denied.json()["controls"]["approval_reject"]["allowed"] is False
    assert any(reason["code"] == "approval_permission_required" for reason in denied.json()["controls"]["approval_reject"]["reasons"])
