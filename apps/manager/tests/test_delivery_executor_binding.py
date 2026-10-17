"""Real Manager/runtime handoff keeps executor affiliation separate from responsibility."""

# ruff: noqa: F811 - imported fixtures are injected by pytest.

from copy import deepcopy

import pytest
from fastapi import HTTPException
from hermes_core.transactional import digest
from sop_manager.routers.sql_models import DeliveryWorkspace, Project, Task, User
from sqlalchemy import update
from test_delivery_execution import bridge, cancel_execution, sync  # noqa: F401
from test_delivery_external_execution import agent_proposal, all_counts
from test_delivery_workbench import command, env  # noqa: F401


def workspace(bridge):
    response = bridge[0].get("/api/v1/delivery/workspace")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture
def bound(bridge):
    from sop_manager.routers.delivery_team_runtime import binding_basis

    client, sessions, store, principal, ws, _, _ = bridge
    body = agent_proposal(bridge)
    agent = store.get(principal, ws["id"], "agents", body["agent_id"])
    response = command(client, "member.save", {"name": "Execution member", "kind": "agent", "tool": "codex"})
    assert response.status_code == 200, response.text
    member = next(row for row in response.json()["members"] if row["kind"] == "agent")
    with sessions() as db:
        row = db.get(DeliveryWorkspace, "project")
        data = deepcopy(row.data)
        data.setdefault("member_runtime_bindings", {})[member["id"]] = {
            "generation": 1,
            "status": "bound",
            "binding": {
                "workspace_id": ws["id"],
                "agent_id": agent["id"],
                "agent_version": agent["version"],
                "profile_digest": digest(agent["data"]),
                "source": {
                    "workspace_name": ws["data"]["name"],
                    "agent_title": agent["data"]["title"],
                    "provider": agent["data"]["provider"],
                },
                "bound_by": "lead",
                "bound_at": "2026-10-17T10:00:00Z",
            },
            "changed_by": "lead",
            "changed_at": "2026-10-17T10:00:00Z",
            "changed_reason": "bound",
        }
        row.data = data
        db.commit()
        basis = binding_basis(db.get(Project, "project"), row.data, member["id"])
    return bridge, member, {**body, "executor_member_id": member["id"], "executor_binding_basis": basis}


def queued(bound):
    bridge, _, body = bound
    response = command(bridge[0], "execution.queue", body)
    assert response.status_code == 200, response.text
    return response.json()["executions"][-1]


def revise_binding(bound, *, generation, unbound=False):
    bridge, member, _ = bound
    with bridge[1]() as db:
        row = db.get(DeliveryWorkspace, "project")
        data = deepcopy(row.data)
        record = data["member_runtime_bindings"][member["id"]]
        record["generation"] = generation
        if unbound:
            record["status"], record["binding"] = "unbound", None
        row.data = data
        db.commit()


def complete(bridge, entry):
    _, _, store, principal, ws, _, _ = bridge
    run = store.get(principal, ws["id"], "runs", entry["run_id"])
    store.mutate(
        principal,
        ws["id"],
        "runs",
        run["id"],
        operation="test.binding-result",
        key="complete",
        request={},
        trace="test",
        expected=run["version"],
        transform=lambda item: {
            "status": "completed",
            "data": {
                **item["data"],
                "node_results": {
                    "agent_1": {
                        "succeeded": True,
                        "exit_code": 0,
                        "agent": {
                            "provider": "codex",
                            "completed": True,
                            "agent_id": entry["agent_id"],
                            "profile_version": entry["agent_version"],
                        },
                    },
                    "pytest": {"succeeded": True, "exit_code": 0, "stdout": "Passed behavior checks"},
                },
            },
        },
    )


def test_direct_agent_queue_explicitly_records_no_team_executor(bridge):
    response = command(bridge[0], "execution.queue", agent_proposal(bridge))
    assert response.status_code == 200, response.text
    assert response.json()["executions"][-1]["executor_snapshot"] is None


def test_bound_preview_and_queue_pin_the_same_executor_without_mutating_reads(bound):
    bridge, member, body = bound
    client = bridge[0]
    before = all_counts(bridge)
    preview = client.post("/api/v1/delivery/execution-preview", json=body)
    assert preview.status_code == 200, preview.text
    snapshot = preview.json()["executor_snapshot"]
    assert snapshot["member_id"] == member["id"]
    assert snapshot["member_name"] == "Execution member"
    assert snapshot["binding_basis"] == body["executor_binding_basis"]
    assert snapshot["recorded_at"] == "2026-10-17T10:00:00Z"
    assert snapshot["agent_id"] == body["agent_id"]
    assert all_counts(bridge) == before
    entry = queued(bound)
    assert entry["executor_snapshot"] == snapshot
    assert entry["snapshot"]["owner"]["id"] == "user:lead"
    assert entry["executor_snapshot"]["member_id"] != entry["snapshot"]["owner"]["id"]


def test_pending_binding_a_b_a_is_permanent_without_task_scope_invalidation(bound):
    bridge, _, _ = bound
    client, sessions, store, principal, ws, _, task = bridge
    entry = queued(bound)
    basis = workspace(bridge)["tasks"][0]["basis"]
    for generation in (2, 3):
        revise_binding(bound, generation=generation)
        with sessions() as db:
            original = db.get(DeliveryWorkspace, "project").data["executions"][-1]
            assert original["executor_binding_invalidated"]
            assert not original.get("planning_invalidated") and not original["stale"]
            assert db.get(Task, task["id"]).owner_id == "user:lead"
    assert workspace(bridge)["tasks"][0]["basis"] == basis
    before = all_counts(bridge)
    observed = client.get(f"/api/v1/delivery/executions/{entry['id']}/observations")
    assert observed.status_code == 200, observed.text
    assert observed.json()["executor_binding_invalidated"]
    assert not observed.json()["permissions"]["can_sync"]
    assert observed.json()["permissions"]["can_cancel"]
    assert all_counts(bridge) == before
    rejected = command(client, "execution.sync", {"id": entry["id"]})
    assert rejected.status_code == 409, rejected.text
    assert not store.list(principal, ws["id"], "runs")
    assert cancel_execution(client, entry["id"]).status_code == 200


def test_executor_member_rename_keeps_binding_and_original_snapshot(bound):
    bridge, member, body = bound
    entry = queued(bound)
    response = command(
        bridge[0],
        "member.save",
        {"id": member["id"], "name": "Renamed executor", "kind": "agent", "tool": "codex"},
    )
    assert response.status_code == 200, response.text
    assert not response.json()["executions"][-1].get("executor_binding_invalidated")
    assert response.json()["executions"][-1]["executor_snapshot"]["member_name"] == "Execution member"
    execution = sync(bridge, entry)
    assert execution["executor_snapshot"]["binding_basis"] == body["executor_binding_basis"]
    assert execution["executor_snapshot"]["member_name"] == "Execution member"


def test_executor_disable_restore_unbinds_and_keeps_pending_intent_invalid(bound):
    bridge, member, _ = bound
    entry = queued(bound)
    basis = workspace(bridge)["tasks"][0]["basis"]
    with bridge[1]() as db:
        db.get(User, "lead").username = "Approver display name"
        db.commit()
    for active in (False, True):
        response = command(
            bridge[0],
            "member.save",
            {"id": member["id"], "name": "Execution member", "kind": "agent", "active": active},
        )
        assert response.status_code == 200, response.text
    with bridge[1]() as db:
        data = db.get(DeliveryWorkspace, "project").data
        record = data["member_runtime_bindings"][member["id"]]
        assert record["status"] == "unbound" and record["generation"] > 1
        assert record["changed_by"] == "lead"
        assert data["executions"][-1]["executor_binding_invalidated"]
    assert workspace(bridge)["tasks"][0]["basis"] == basis
    assert command(bridge[0], "execution.sync", {"id": entry["id"]}).status_code == 409


def test_handed_off_planned_run_survives_rebinding_and_preserves_test_and_human_review(bound):
    bridge, _, _ = bound
    client, _, store, principal, ws, _, task = bridge
    entry = sync(bridge, queued(bound))
    assert entry["status"] == "planned"
    snapshot = entry["executor_snapshot"]
    revise_binding(bound, generation=2, unbound=True)
    assert not workspace(bridge)["executions"][-1].get("executor_binding_invalidated")
    assert sync(bridge, entry)["executor_snapshot"] == snapshot
    complete(bridge, entry)
    entry = sync(bridge, entry)
    observed = client.get(f"/api/v1/delivery/executions/{entry['id']}/observations")
    assert observed.status_code == 200, observed.text
    assert observed.json()["tests"]["status"] == "passed"
    assert observed.json()["permissions"]["can_review"]
    accepted = command(
        client,
        "execution.review",
        {
            "id": entry["id"],
            "run_version": entry["run_version"],
            "decision": "accept",
            "comment": "Original agent and tests verified",
        },
    )
    assert accepted.status_code == 200, accepted.text
    assert next(row for row in accepted.json()["tasks"] if row["id"] == task["id"])["verified"]
    assert accepted.json()["executions"][-1]["executor_snapshot"] == snapshot
    assert len(store.list(principal, ws["id"], "runs")) == 1


def test_receipt_recovery_precedes_binding_revalidation_after_manager_rollback(bound, monkeypatch):
    from sop_manager.routers import delivery_execution

    bridge, _, _ = bound
    client, _, store, principal, ws, _, _ = bridge
    entry = queued(bound)
    original = delivery_execution._observe

    def interrupted(*args, **kwargs):
        raise HTTPException(503, "Manager commit interrupted after runtime handoff")

    monkeypatch.setattr(delivery_execution, "_observe", interrupted)
    assert command(client, "execution.sync", {"id": entry["id"]}).status_code == 503
    assert len(store.list(principal, ws["id"], "runs")) == 1
    revise_binding(bound, generation=2, unbound=True)
    monkeypatch.setattr(delivery_execution, "_observe", original)
    before = all_counts(bridge)
    observation = client.get(f"/api/v1/delivery/executions/{entry['id']}/observations")
    assert observation.status_code == 200, observation.text
    assert observation.json()["run_id"]
    assert observation.json()["permissions"]["can_sync"]
    assert not observation.json()["executor_binding_invalidated"]
    assert all_counts(bridge) == before
    with bridge[1]() as db:
        assert not db.get(DeliveryWorkspace, "project").data["executions"][-1]["run_id"]
    recovered = sync(bridge, entry)
    assert recovered["run_id"] and recovered["executor_snapshot"] == entry["executor_snapshot"]
    assert len(store.list(principal, ws["id"], "runs")) == 1
    assert not recovered["stale"] and not recovered.get("planning_invalidated")


def test_runtime_profile_version_drift_blocks_new_handoff_and_cancellation_remains_available(bound):
    bridge, _, body = bound
    client, _, store, principal, ws, _, _ = bridge
    entry = queued(bound)
    agent = store.get(principal, ws["id"], "agents", body["agent_id"])
    for key, instructions in (
        ("changed", "Changed implementation policy"),
        ("restored", agent["data"]["instructions"]),
    ):
        current = store.get(principal, ws["id"], "agents", agent["id"])
        store.mutate(
            principal,
            ws["id"],
            "agents",
            agent["id"],
            operation="test.profile-change",
            key=key,
            request={},
            trace="test",
            expected=current["version"],
            transform=lambda item, text=instructions: {"data": {**item["data"], "instructions": text}},
        )
    rejected = command(client, "execution.sync", {"id": entry["id"]})
    assert rejected.status_code == 409, rejected.text
    assert not store.list(principal, ws["id"], "runs")
    assert cancel_execution(client, entry["id"]).status_code == 200


def test_pending_binding_marker_rolls_back_with_failed_business_capture(bound, monkeypatch):
    from sop_manager.routers import delivery_progress_capture

    bridge, member, _ = bound
    queued(bound)

    def interrupted(*args, **kwargs):
        raise RuntimeError("Capture interrupted")

    with monkeypatch.context() as patch:
        patch.setattr(delivery_progress_capture, "evaluate_project", interrupted)
        with bridge[1]() as db:
            row = db.get(DeliveryWorkspace, "project")
            data = deepcopy(row.data)
            data["member_runtime_bindings"][member["id"]]["generation"] = 2
            row.data = data
            with pytest.raises(RuntimeError, match="Capture interrupted"):
                db.commit()
            db.rollback()
            restored = db.get(DeliveryWorkspace, "project").data
            assert restored["member_runtime_bindings"][member["id"]]["generation"] == 1
            assert not restored["executions"][-1]["executor_binding_invalidated"]


def test_cached_workspace_does_not_lose_another_transactions_executor_marker(bound):
    bridge, member, _ = bound
    queued(bound)
    with bridge[1]() as old:
        cached = old.get(DeliveryWorkspace, "project")
        assert not cached.data["executions"][-1]["executor_binding_invalidated"]
        revise_binding(bound, generation=2)
        old.get(Task, bridge[-1]["id"]).actual_hours = 1
        old.commit()
        current = old.get(DeliveryWorkspace, "project").data
        assert current["member_runtime_bindings"][member["id"]]["generation"] == 2
        assert current["executions"][-1]["executor_binding_invalidated"]
        assert not current["executions"][-1].get("planning_invalidated")


def test_unobserved_binding_change_is_read_only_then_persists_in_one_reserved_command(bound):
    bridge, member, _ = bound
    entry = queued(bound)
    client, sessions, _, _, _, _, _ = bridge
    before = workspace(bridge)
    with sessions() as db:
        data = deepcopy(db.get(DeliveryWorkspace, "project").data)
    data["member_runtime_bindings"][member["id"]]["generation"] = 2
    with sessions.kw["bind"].begin() as connection:
        connection.execute(
            update(DeliveryWorkspace).where(DeliveryWorkspace.project_id == "project").values(data=data)
        )
    counts = all_counts(bridge)
    current = workspace(bridge)
    assert current["executions"][-1]["executor_binding_invalidated"]
    assert current["tasks"][0]["basis"] == before["tasks"][0]["basis"]
    assert all_counts(bridge) == counts
    with sessions() as db:
        assert not db.get(DeliveryWorkspace, "project").data["executions"][-1]["executor_binding_invalidated"]
    recorded = command(client, "progress.record", {})
    assert recorded.status_code == 200, recorded.text
    assert recorded.json()["version"] == recorded.json()["applied_version"] == before["version"] + 1
    with sessions() as db:
        stored = db.get(DeliveryWorkspace, "project").data["executions"][-1]
        assert stored["id"] == entry["id"] and stored["executor_binding_invalidated"]
        assert not stored.get("planning_invalidated")


def test_executor_binding_never_grants_execute_permission(bound, monkeypatch):
    from dataclasses import replace

    from sop_manager.routers import delivery_execution

    bridge, _, body = bound
    original = delivery_execution.runtime_identity
    monkeypatch.setattr(
        delivery_execution,
        "runtime_identity",
        lambda user, store: replace(original(user, store), permissions=frozenset({"read"})),
    )
    before = all_counts(bridge)
    response = command(bridge[0], "execution.queue", body)
    assert response.status_code == 403, response.text
    assert all_counts(bridge) == before
