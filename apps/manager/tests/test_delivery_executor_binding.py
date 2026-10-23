"""Real Manager/runtime handoff keeps executor affiliation separate from responsibility."""

# ruff: noqa: F811 - imported fixtures are injected by pytest.

from copy import deepcopy

import pytest
from fastapi import HTTPException
from hermes_core.transactional import digest
from sop_manager.routers.sql_models import DeliveryWorkspace, Task, User
from sqlalchemy import select, update
from test_delivery_execution import bridge, cancel_execution, sync  # noqa: F401
from test_delivery_external_execution import agent_proposal, all_counts
from test_delivery_workbench import command, env  # noqa: F401


def workspace(bridge):
    response = bridge[0].get("/api/v1/delivery/workspace")
    assert response.status_code == 200, response.text
    return response.json()


@pytest.fixture(params=["agent", "tool"])
def bound(bridge, request):
    """Both resource kinds use formal HTTP binding, never a seeded association."""
    client, sessions, store, principal, ws, _, _ = bridge
    body = agent_proposal(bridge)
    agent = store.get(principal, ws["id"], "agents", body["agent_id"])
    response = command(client, "member.save", {"name": "Execution member", "kind": request.param, "tool": "codex"})
    assert response.status_code == 200, response.text
    member = next(row for row in response.json()["members"] if row["kind"] == request.param)
    response = command(client, "member.runtime.bind", {
        "member_id": member["id"], "workspace_id": ws["id"],
        "agent_id": agent["id"], "agent_version": agent["version"],
    })
    assert response.status_code == 200, response.text
    catalogue = client.get("/api/v1/delivery/team-runtime-bindings")
    assert catalogue.status_code == 200, catalogue.text
    row = next(row for row in catalogue.json()["members"] if row["member_id"] == member["id"])
    assert row["status"] == "current" and row["binding"]["profile_digest"] == digest(agent["data"])
    basis = row["binding_basis"]
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
    catalogue = client.get("/api/v1/delivery/team-runtime-bindings").json()
    association = next(row for row in catalogue["members"] if row["member_id"] == member["id"])
    assert snapshot["recorded_at"] == association["binding"]["bound_at"]
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
        {"id": member["id"], "name": "Renamed executor", "kind": member["kind"], "tool": "codex"},
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
            {"id": member["id"], "name": "Execution member", "kind": member["kind"], "active": active},
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


def test_explicit_rebind_after_restore_does_not_revive_old_intent_or_transfer_ownership(bound):
    bridge, member, body = bound
    client, sessions, store, principal, ws, _, task = bridge
    entry = queued(bound)
    original_owner = entry["snapshot"]["owner"]
    for active in (False, True):
        saved = command(client, "member.save", {
            "id": member["id"], "name": member["name"], "kind": member["kind"], "active": active,
        })
        assert saved.status_code == 200, saved.text
    state = workspace(bridge)
    payload = {"member_id": member["id"], "workspace_id": body["workspace_id"],
        "agent_id": body["agent_id"], "agent_version": body["agent_version"]}
    for _ in range(2):
        rebound = command(client, "member.runtime.bind", payload, key="explicit-rebind", version=state["version"])
        assert rebound.status_code == 200, rebound.text
    catalogue = client.get("/api/v1/delivery/team-runtime-bindings").json()
    row = next(row for row in catalogue["members"] if row["member_id"] == member["id"])
    assert row["status"] == "current" and row["generation"] == 3
    assert row["binding_basis"] != body["executor_binding_basis"]
    rejected = command(client, "execution.sync", {"id": entry["id"]})
    assert rejected.status_code == 409, rejected.text
    assert not store.list(principal, ws["id"], "runs")
    with sessions() as db:
        stored = db.get(DeliveryWorkspace, "project").data["executions"][-1]
        assert stored["executor_binding_invalidated"] and stored["snapshot"]["owner"] == original_owner
        assert db.get(Task, task["id"]).owner_id == "user:lead"


def test_tool_executor_cannot_become_the_responsible_task_owner(bound):
    bridge, member, _ = bound
    if member["kind"] != "tool":
        pytest.skip("Tool responsibility boundary")
    before = all_counts(bridge)
    response = command(bridge[0], "task.update", {"id": bridge[-1]["id"], "owner_id": member["id"]})
    assert response.status_code == 422, response.text
    assert all_counts(bridge) == before


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


@pytest.mark.parametrize("action", ["execution.start", "execution.retry", "approve"])
def test_handed_off_controls_and_launch_authority_use_fixed_profiles_after_unbind(bound, monkeypatch, action):
    """Exercise actual control admission/effect/claim authority, without launching a provider."""
    from hermes_core.managed_controls import launch_authority
    from test_delivery_execution import drain_controls
    from test_delivery_execution_control_operations import admitted, fixed

    bridge, member, _ = bound
    client, _, store, principal, ws, _, _ = bridge
    entry = sync(bridge, queued(bound))
    snapshot = entry["executor_snapshot"]
    removed = command(client, "member.runtime.unbind", {"member_id": member["id"]})
    assert removed.status_code == 200, removed.text
    _, original = fixed(bridge, action, entry=entry)
    ack = admitted(bridge, original)
    assert drain_controls(bridge, monkeypatch=monkeypatch) == 1
    with store.engine.connect() as connection:
        ticket = connection.execute(select(store.managed_launches).where(
            store.managed_launches.c.control_id == ack["result"]["control_operation_id"],
        )).mappings().one()
    run = store.get(principal, ws["id"], "runs", entry["run_id"])
    with launch_authority(store, client.app.state.hermes_execution, principal, ws["id"], run,
        launch_id=ticket["id"]) as (authorized, actual_ticket):
        assert authorized.actor == "lead" and "execute" in authorized.permissions
        assert actual_ticket["id"] == ticket["id"]
        assert actual_ticket["run_id"] == entry["run_id"]
    saved = workspace(bridge)["executions"][-1]
    assert saved["executor_snapshot"] == snapshot and not saved.get("executor_binding_invalidated")
    assert len(store.list(principal, ws["id"], "runs")) == 1


def test_handed_off_unbound_executor_still_requires_the_pinned_runtime_profile(bound):
    bridge, member, body = bound
    client, _, store, principal, ws, _, _ = bridge
    entry = sync(bridge, queued(bound))
    assert command(client, "member.runtime.unbind", {"member_id": member["id"]}).status_code == 200
    agent = store.get(principal, ws["id"], "agents", body["agent_id"])
    store.mutate(principal, ws["id"], "agents", agent["id"], operation="test.fixed-profile-drift",
        key="fixed-profile-drift", request={}, trace="test", expected=agent["version"],
        transform=lambda row: {"data": {**row["data"], "instructions": "Different execution policy"}})
    preview = client.post("/api/v1/delivery/execution-control-preview", json={
        "id": entry["id"], "action": "execution.start", "reason": "Review current authority",
    })
    assert preview.status_code == 200 and not preview.json()["allowed"], preview.text
    assert preview.json()["reasons"]


def test_receipt_recovery_precedes_binding_revalidation_after_manager_rollback(bound, monkeypatch):
    from sop_manager.routers import delivery_execution_handoff as service

    bridge, _, _ = bound
    client, _, store, principal, ws, _, _ = bridge
    entry = queued(bound)
    original = service.project_handoff

    def interrupted(*args, **kwargs):
        raise HTTPException(503, "Manager commit interrupted after runtime handoff")

    monkeypatch.setattr(service, "project_handoff", interrupted)
    assert service.handoff_once(client.app, bridge[1]) == 0
    assert len(store.list(principal, ws["id"], "runs")) == 1
    revise_binding(bound, generation=2, unbound=True)
    monkeypatch.setattr(service, "project_handoff", original)
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
