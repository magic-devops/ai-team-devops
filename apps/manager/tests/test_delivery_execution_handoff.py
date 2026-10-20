"""Permanent real SQL/Core handoff definitions; execution is deliberately deferred."""
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select, update

from sop_manager.routers.delivery_execution_handoff import claim_handoff, handoff_once, process_claim
from sop_manager.routers.delivery_execution_handoff_model import DeliveryExecutionHandoff
from sop_manager.routers.sql_models import DeliveryProgressObservation, DeliveryRequirementVersion, DeliveryWorkspace, Project, Task, User
from test_delivery_execution import bridge, queue_payload, cancel_execution  # noqa: F401
from test_delivery_workbench import command, env  # noqa: F401


def accept(bridge, key="durable-original-queue"):
    client = bridge[0]
    body = {"action": "execution.queue", "payload": queue_payload(bridge),
            "expected_version": client.get("/api/v1/delivery/workspace").json()["version"], "idempotency_key": key}
    response = client.post("/api/v1/delivery/commands", json=body)
    assert response.status_code == 200, response.text
    return response.json(), body


def row(bridge, execution_id):
    with bridge[1]() as db:
        result = db.scalar(select(DeliveryExecutionHandoff).where(DeliveryExecutionHandoff.execution_id == execution_id))
        return {column.key: getattr(result, column.key) for column in result.__table__.columns}


def test_queue_ack_accepts_one_immutable_handoff_without_external_side_effects(bridge):
    ack, body = accept(bridge)
    assert ack["resource"]["kind"] == "execution" and ack["result"] is None
    assert set(ack) == {"project_id", "action", "resource", "result", "affected_refs", "applied_version", "version", "query_generation", "replayed"}
    assert "executions" not in ack
    handoff = row(bridge, ack["resource"]["id"])
    assert handoff["state"] == "accepted" and handoff["attempt"] == 0 and handoff["revision"] == 1
    assert handoff["original"]["handoff_id"] == handoff["id"]
    assert handoff["accepted_version"] == ack["applied_version"]
    replay = bridge[0].post("/api/v1/delivery/commands", json=body).json()
    assert replay["resource"] == ack["resource"] and replay["applied_version"] == ack["applied_version"]
    assert bridge[2].list(bridge[3], bridge[4]["id"], "runs") == []
    with bridge[1]() as db:
        assert len(db.scalars(select(DeliveryExecutionHandoff)).all()) == 1


def test_acceptance_rollback_removes_handoff_and_creates_no_core_plan(bridge, monkeypatch):
    from sop_manager.routers import delivery_execution_handoff as service
    actual = service.accept_handoff
    def fail(*args, **kwargs):
        actual(*args, **kwargs)
        raise HTTPException(503, "Injected Manager failure before acceptance commit")
    monkeypatch.setattr(service, "accept_handoff", fail)
    client = bridge[0]
    response = client.post("/api/v1/delivery/commands", json={"action": "execution.queue", "payload": queue_payload(bridge),
        "expected_version": client.get("/api/v1/delivery/workspace").json()["version"], "idempotency_key": "rollback-original-queue"})
    assert response.status_code == 503
    with bridge[1]() as db:
        assert db.scalars(select(DeliveryExecutionHandoff)).all() == []
    assert bridge[2].list(bridge[3], bridge[4]["id"], "runs") == []


def test_background_handoff_needs_no_sync_and_never_starts_a_process(bridge, monkeypatch):
    ack, _ = accept(bridge)
    monkeypatch.setattr(bridge[0].app.state.hermes_execution, "execute", lambda *args: pytest.fail("Handoff must not execute"))
    assert handoff_once(bridge[0].app, bridge[1]) == 1
    current = row(bridge, ack["resource"]["id"])
    assert current["state"] == "planned" and current["run_id"] and current["runtime_task_id"]
    assert handoff_once(bridge[0].app, bridge[1]) == 0
    run = bridge[2].get(bridge[3], bridge[4]["id"], "runs", current["run_id"])
    assert run["status"] == "planned"
    with bridge[1]() as db:
        assert db.get(Task, bridge[6]["id"]).status == "in_progress"


def test_claim_is_committed_and_expiry_fences_an_old_worker(bridge):
    ack, _ = accept(bridge); handoff = row(bridge, ack["resource"]["id"])
    instant = datetime.now(timezone.utc).replace(tzinfo=None)
    with bridge[1]() as db:
        first = claim_handoff(db, handoff["id"], now=instant); db.commit()
    with bridge[1]() as db:
        durable = db.get(DeliveryExecutionHandoff, handoff["id"])
        assert durable.state == "dispatching" and durable.fence == first.fence
        assert durable.original == handoff["original"] and durable.lease_owner == first.owner
        assert claim_handoff(db, handoff["id"], now=instant) is None
    with bridge[1]() as db:
        second = claim_handoff(db, handoff["id"], now=instant + timedelta(minutes=2)); db.commit()
    assert second.fence > first.fence
    assert process_claim(bridge[0].app, bridge[1], first, now=instant + timedelta(minutes=2)) is False


def test_core_commit_then_manager_failure_recovers_after_unrelated_project_version_advance(bridge, monkeypatch):
    from sop_manager.routers import delivery_execution_handoff as service
    ack, body = accept(bridge)
    actual = service.project_handoff
    monkeypatch.setattr(service, "project_handoff", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("Projection unavailable")))
    handoff_once(bridge[0].app, bridge[1])
    assert len(bridge[2].list(bridge[3], bridge[4]["id"], "runs")) == 1
    changed = command(bridge[0], "task.update", {"id": bridge[6]["id"], "priority": "P0"})
    assert changed.status_code == 200
    monkeypatch.setattr(service, "project_handoff", actual)
    handoff_once(bridge[0].app, bridge[1], now=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1))
    current = row(bridge, ack["resource"]["id"])
    assert current["state"] == "planned"
    assert len(bridge[2].list(bridge[3], bridge[4]["id"], "runs")) == 1
    replay = bridge[0].post("/api/v1/delivery/commands", json=body).json()
    assert replay["resource"] == ack["resource"] and replay["applied_version"] == ack["applied_version"]


@pytest.mark.parametrize("action,payload", [("execution.sync", {}), ("execution.review", {"decision": "accept", "comment": "No implicit plan", "run_version": 1})])
def test_sync_and_review_of_pending_intent_create_no_plan(bridge, action, payload):
    ack, _ = accept(bridge)
    response = command(bridge[0], action, {"id": ack["resource"]["id"], **payload})
    assert response.status_code == 409
    assert bridge[2].list(bridge[3], bridge[4]["id"], "runs") == []
    assert row(bridge, ack["resource"]["id"])["state"] == "accepted"


def test_pending_cancel_closes_core_gate_before_confirming_not_started(bridge):
    ack, _ = accept(bridge)
    response = cancel_execution(bridge[0], ack["resource"]["id"])
    assert response.status_code == 200, response.text
    assert row(bridge, ack["resource"]["id"])["state"] == "cancelled"
    assert handoff_once(bridge[0].app, bridge[1]) == 0
    assert bridge[2].list(bridge[3], bridge[4]["id"], "runs") == []


def test_unreachable_core_cannot_confirm_not_started_cancellation(bridge, monkeypatch):
    from hermes_core.managed_handoff import ManagedHandoff
    ack, _ = accept(bridge)
    monkeypatch.setattr(ManagedHandoff, "close", lambda *a, **kw: (_ for _ in ()).throw(OSError("Core unavailable")))
    response = cancel_execution(bridge[0], ack["resource"]["id"])
    assert response.status_code == 503
    assert row(bridge, ack["resource"]["id"])["state"] == "accepted"


def test_originator_revoked_before_new_handoff_does_not_gain_system_execute(bridge):
    ack, _ = accept(bridge)
    with bridge[1]() as db:
        db.get(User, "lead").role = "developer"; db.commit()
    handoff_once(bridge[0].app, bridge[1])
    assert row(bridge, ack["resource"]["id"])["state"] == "blocked"
    assert bridge[2].list(bridge[3], bridge[4]["id"], "runs") == []


@pytest.mark.parametrize("field,value", [("requested_by", "other"), ("original", {}), ("request_digest", "f" * 64), ("task_id", "foreign")])
def test_handoff_original_and_scope_are_not_general_sql_editable(bridge, field, value):
    ack, _ = accept(bridge); handoff = row(bridge, ack["resource"]["id"])
    with bridge[1]() as db, pytest.raises(HTTPException):
        db.execute(update(DeliveryExecutionHandoff).where(DeliveryExecutionHandoff.id == handoff["id"]).values({field: value}))
        db.commit()


def test_claimed_then_cancelled_original_rejects_a_late_worker(bridge):
    ack, _ = accept(bridge); handoff = row(bridge, ack["resource"]["id"])
    with bridge[1]() as db:
        claim = claim_handoff(db, handoff["id"]); db.commit()
    assert cancel_execution(bridge[0], ack["resource"]["id"]).status_code == 200
    assert process_claim(bridge[0].app, bridge[1], claim) is False
    assert row(bridge, ack["resource"]["id"])["state"] == "cancelled"
    assert not bridge[2].list(bridge[3], bridge[4]["id"], "runs")


def test_core_close_commit_then_cancel_sql_rollback_can_replay_the_terminal_fence(bridge, monkeypatch):
    from sop_manager.routers import delivery_execution_runtime_controls as controls
    from sop_manager.routers.delivery_execution_handoff import _principal, _request
    from hermes_core.managed_handoff import ManagedHandoff

    ack, _ = accept(bridge); execution_id = ack["resource"]["id"]
    actual = controls._transition_cancel
    monkeypatch.setattr(controls, "_transition_cancel", lambda *a: (_ for _ in ()).throw(HTTPException(503, "Manager cancel commit unavailable")))
    assert cancel_execution(bridge[0], execution_id).status_code == 503
    assert row(bridge, execution_id)["state"] == "accepted"
    with bridge[1]() as db:
        handoff = db.get(DeliveryExecutionHandoff, row(bridge, execution_id)["id"])
        fact = ManagedHandoff(bridge[2], bridge[0].app.state.hermes_execution).probe(_principal(handoff), handoff.workspace_id, **_request(handoff))
    assert fact["state"] == "closed" and fact["run_id"] is None and fact["closed"] is True
    monkeypatch.setattr(controls, "_transition_cancel", actual)
    assert cancel_execution(bridge[0], execution_id).status_code == 200
    assert row(bridge, execution_id)["state"] == "cancelled"
    assert not bridge[2].list(bridge[3], bridge[4]["id"], "runs")


def test_plan_wins_cancel_race_returns_real_identity_and_requires_a_new_preview(bridge, monkeypatch):
    from hermes_core.managed_handoff import ManagedHandoff

    ack, _ = accept(bridge); execution_id = ack["resource"]["id"]
    actual_close = ManagedHandoff.close
    actual_dispatch = ManagedHandoff.dispatch
    def plan_then_close(service, principal, workspace, **kwargs):
        actual_dispatch(service, bridge[3], workspace, **kwargs)
        return actual_close(service, principal, workspace, **kwargs)
    monkeypatch.setattr(ManagedHandoff, "close", plan_then_close)
    response = cancel_execution(bridge[0], execution_id)
    assert response.status_code == 409 and response.json()["detail"]["code"] == "handoff_already_planned"
    assert row(bridge, execution_id)["state"] == "accepted"
    assert len(bridge[2].list(bridge[3], bridge[4]["id"], "runs")) == 1
    observed = bridge[0].get(f"/api/v1/delivery/executions/{execution_id}/runtime")
    assert observed.status_code == 200 and observed.json()["run_id"]
    with bridge[1]() as db:
        entry = db.get(DeliveryWorkspace, "project").data["executions"][-1]
        assert entry["status"] == "pending_dispatch" and not entry.get("stop_snapshot")


@pytest.mark.parametrize("status", ["planning", "paused", "archived"])
def test_new_handoff_rechecks_project_availability_without_technical_scope_escalation(bridge, status):
    ack, _ = accept(bridge)
    # Seed a pre-existing lifecycle state, as in the existing lifecycle boundary fixtures.
    with bridge[1].kw["bind"].begin() as conn:
        conn.execute(update(Project).where(Project.id == "project").values(status=status))
    assert handoff_once(bridge[0].app, bridge[1]) == 0
    assert row(bridge, ack["resource"]["id"])["state"] == "blocked"
    assert not bridge[2].list(bridge[3], bridge[4]["id"], "runs")


def test_blocked_receipt_probe_failure_never_reenables_new_dispatch(bridge, monkeypatch):
    from hermes_core.managed_handoff import ManagedHandoff

    ack, _ = accept(bridge); execution_id = ack["resource"]["id"]
    with bridge[1]() as db:
        db.get(User, "lead").role = "developer"; db.commit()
    handoff_once(bridge[0].app, bridge[1])
    first = row(bridge, execution_id)
    assert first["state"] == "blocked"
    with bridge[1]() as db:
        db.get(User, "lead").role = "super_admin"; db.commit()
    actual_probe = ManagedHandoff.probe
    monkeypatch.setattr(ManagedHandoff, "probe", lambda *a, **kw: (_ for _ in ()).throw(OSError("Temporary Core read loss")))
    later = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1)
    assert handoff_once(bridge[0].app, bridge[1], now=later) == 0
    assert row(bridge, execution_id)["state"] == "blocked"
    monkeypatch.setattr(ManagedHandoff, "probe", actual_probe)
    assert handoff_once(bridge[0].app, bridge[1], now=later + timedelta(days=1)) == 0
    current = row(bridge, execution_id)
    assert current["state"] == "blocked" and current["original"] == first["original"] and current["error"] == first["error"]
    assert not bridge[2].list(bridge[3], bridge[4]["id"], "runs")


def test_blocked_original_recovers_a_committed_core_closure_without_new_authority(bridge, monkeypatch):
    from sop_manager.routers import delivery_execution_runtime_controls as controls

    ack, _ = accept(bridge); execution_id = ack["resource"]["id"]
    with bridge[1]() as db:
        db.get(User, "lead").role = "developer"; db.commit()
    handoff_once(bridge[0].app, bridge[1])
    assert row(bridge, execution_id)["state"] == "blocked"
    with bridge[1]() as db:
        db.get(User, "lead").role = "super_admin"; db.commit()
    monkeypatch.setattr(controls, "_transition_cancel", lambda *a: (_ for _ in ()).throw(HTTPException(503, "Manager cancel commit unavailable")))
    assert cancel_execution(bridge[0], execution_id).status_code == 503
    with bridge[1]() as db:
        db.get(User, "lead").status = "disabled"; db.commit()
    assert handoff_once(bridge[0].app, bridge[1], now=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1)) == 1
    assert row(bridge, execution_id)["state"] == "cancelled"
    assert not bridge[2].list(bridge[3], bridge[4]["id"], "runs")


def test_existing_core_plan_recovers_when_originator_disabled_and_project_archived_without_business_writes(bridge, monkeypatch):
    from sop_manager.routers import delivery_execution_handoff as service

    ack, _ = accept(bridge); execution_id = ack["resource"]["id"]
    actual = service.project_handoff
    monkeypatch.setattr(service, "project_handoff", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("Projection lost")))
    handoff_once(bridge[0].app, bridge[1])
    assert len(bridge[2].list(bridge[3], bridge[4]["id"], "runs")) == 1
    with bridge[1]() as db:
        db.get(User, "lead").status = "disabled"; db.commit()
    with bridge[1].kw["bind"].begin() as conn:
        conn.execute(update(Project).where(Project.id == "project").values(status="archived"))
    with bridge[1]() as db:
        before = (db.query(DeliveryProgressObservation).count(), db.query(DeliveryRequirementVersion).count(),
                  db.get(Task, bridge[6]["id"]).status)
        original = db.get(DeliveryWorkspace, "project").data["executions"][-1]
    monkeypatch.setattr(service, "project_handoff", actual)
    assert handoff_once(bridge[0].app, bridge[1], now=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1)) == 1
    current = row(bridge, execution_id)
    assert current["state"] == "planned" and current["run_id"]
    with bridge[1]() as db:
        after = (db.query(DeliveryProgressObservation).count(), db.query(DeliveryRequirementVersion).count(),
                 db.get(Task, bridge[6]["id"]).status)
        entry = db.get(DeliveryWorkspace, "project").data["executions"][-1]
        assert before == after and db.get(Project, "project").status == "archived"
        assert entry.get("planning_invalidated") == original.get("planning_invalidated")
        assert {k: v for k, v in entry.items() if k not in {"run_id", "runtime_task_id", "run_version", "status"}} == {
            k: v for k, v in original.items() if k not in {"run_id", "runtime_task_id", "run_version", "status"}}


def test_handoff_projection_preserves_newer_explicit_observation(bridge, monkeypatch):
    from sop_manager.routers import delivery_execution_handoff as service
    from test_delivery_execution import finish

    ack, _ = accept(bridge); execution_id = ack["resource"]["id"]
    actual = service.project_handoff
    monkeypatch.setattr(service, "project_handoff", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("Projection lost")))
    handoff_once(bridge[0].app, bridge[1])
    observed = command(bridge[0], "execution.sync", {"id": execution_id})
    assert observed.status_code == 200, observed.text
    execution = observed.json()["executions"][-1]
    finish(bridge, execution)
    assert command(bridge[0], "execution.sync", {"id": execution_id}).status_code == 200
    with bridge[1]() as db:
        workspace = db.get(DeliveryWorkspace, "project")
        before, version = workspace.data["executions"][-1], workspace.version
    assert before["status"] == "awaiting_review" and before["run_version"] > 1
    monkeypatch.setattr(service, "project_handoff", actual)
    assert handoff_once(bridge[0].app, bridge[1], now=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1)) == 1
    with bridge[1]() as db:
        workspace = db.get(DeliveryWorkspace, "project")
        assert workspace.data["executions"][-1] == before and workspace.version == version
    assert row(bridge, execution_id)["state"] == "planned"


@pytest.mark.parametrize("limit", [0, 101, True, -1])
def test_handoff_scan_is_bounded_and_rejects_boolean_limits(bridge, limit):
    with pytest.raises(ValueError):
        handoff_once(bridge[0].app, bridge[1], limit=limit)


def test_technical_projection_capability_cannot_write_a_task_or_definition(bridge):
    from sop_manager.project_write_guard import execution_handoff_projection_scope

    ack, _ = accept(bridge); handoff = row(bridge, ack["resource"]["id"])
    with bridge[1]() as db, pytest.raises(HTTPException) as denied:
        with execution_handoff_projection_scope(db, "tenant", "project", handoff["id"]):
            db.get(Task, bridge[6]["id"]).status = "completed"
            db.commit()
    assert denied.value.detail["code"] == "handoff_technical_scope_only"


def test_core_atomic_failure_leaves_no_partial_envelope_and_retries_the_same_original(bridge, monkeypatch):
    from hermes_core.delivery import Delivery
    from hermes_core.models import CoreError

    ack, _ = accept(bridge); execution_id = ack["resource"]["id"]
    original = row(bridge, execution_id)["original"]
    actual = Delivery.dispatch_in_transaction
    monkeypatch.setattr(Delivery, "dispatch_in_transaction", lambda *a, **kw: (_ for _ in ()).throw(CoreError("injected_unavailable", "Planning temporarily unavailable", 503)))
    assert handoff_once(bridge[0].app, bridge[1]) == 0
    current = row(bridge, execution_id)
    assert current["state"] == "retry_wait" and current["original"] == original
    assert not bridge[2].list(bridge[3], bridge[4]["id"], "tasks")
    assert not bridge[2].list(bridge[3], bridge[4]["id"], "runs")
    with bridge[2].engine.connect() as conn:
        assert conn.execute(select(bridge[2].managed_handoffs)).all() == []
    monkeypatch.setattr(Delivery, "dispatch_in_transaction", actual)
    assert handoff_once(bridge[0].app, bridge[1], now=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1)) == 1
    assert row(bridge, execution_id)["original"] == original
    assert len(bridge[2].list(bridge[3], bridge[4]["id"], "runs")) == 1


def test_closure_recovery_is_safe_but_does_not_fabricate_a_lost_cancel_command_ack(bridge, monkeypatch):
    from sop_manager.routers import delivery_execution_runtime_controls as controls
    from sop_manager.routers.delivery_execution_handoff import _principal, _request
    from sop_manager.routers.sql_models import DeliveryEvent
    from hermes_core.managed_handoff import ManagedHandoff

    ack, _ = accept(bridge); execution_id = ack["resource"]["id"]
    preview = bridge[0].post("/api/v1/delivery/execution-control-preview", json={
        "id": execution_id, "action": "execution.cancel", "reason": "Confirm the accepted plan cannot start"})
    assert preview.status_code == 200
    fixed = preview.json()
    body = {"action": "execution.cancel", "payload": fixed["payload"], "expected_version": fixed["version"],
            "idempotency_key": "lost-cancel-ack-original"}
    monkeypatch.setattr(controls, "_transition_cancel", lambda *a: (_ for _ in ()).throw(HTTPException(503, "Manager cancel commit unavailable")))
    assert bridge[0].post("/api/v1/delivery/commands", json=body).status_code == 503
    assert handoff_once(bridge[0].app, bridge[1], now=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1)) == 1
    current = row(bridge, execution_id)
    assert current["state"] == "cancelled"
    with bridge[1]() as db:
        handoff = db.get(DeliveryExecutionHandoff, current["id"])
        replay = ManagedHandoff(bridge[2], bridge[0].app.state.hermes_execution).dispatch(
            _principal(handoff), handoff.workspace_id, fence=handoff.fence + 1, **_request(handoff))
        assert replay["state"] == "closed" and replay["run_id"] is None
        assert db.query(DeliveryEvent).filter_by(action="execution.cancel").count() == 0
    # This is an explicit remaining reconciliation gap, never a fabricated success:
    # H proves safe closure, while the old command's SQL version/ACK never committed.
    retry = bridge[0].post("/api/v1/delivery/commands", json=body)
    assert retry.status_code == 409 and "resource" not in retry.json()
    assert not bridge[2].list(bridge[3], bridge[4]["id"], "runs")


def test_public_handoff_failure_is_bounded_sanitized_and_utc(bridge, monkeypatch):
    from sop_manager.routers import delivery_execution_handoff as service
    from sop_manager.routers.delivery_execution_handoff_contract import ExecutionHandoffSummary
    from types import SimpleNamespace

    ack, _ = accept(bridge)
    monkeypatch.setattr(service, "_authorize_new", lambda *a, **kw: (_ for _ in ()).throw(HTTPException(503, {
        "code": "temporary\n" + "c" * 200, "message": "password=private-value\n" + "m" * 1500})))
    handoff_once(bridge[0].app, bridge[1])
    public = service.handoff_view(SimpleNamespace(**row(bridge, ack["resource"]["id"])))
    assert public["state"] == "retry_wait" and len(public["error"]["code"]) <= 100 and len(public["error"]["message"]) <= 1000
    assert "private-value" not in public["error"]["message"] and "\n" not in public["error"]["message"]
    assert public["accepted_at"].endswith("Z") and public["updated_at"].endswith("Z")
    assert set(public) == {"id", "execution_id", "task_id", "workspace_id", "state", "revision", "attempt", "accepted_at", "updated_at", "next_attempt_at", "error", "run_id", "runtime_task_id"}
    assert ExecutionHandoffSummary.model_validate(public).state == "retry_wait"


def test_legacy_deployment_observation_failure_cannot_starve_accepted_handoffs(bridge, monkeypatch):
    from sop_manager.routers import delivery_sync

    ack, _ = accept(bridge)
    monkeypatch.setattr(delivery_sync, "_sync_deployments", lambda *a: (_ for _ in ()).throw(RuntimeError("Unrelated deployment read failed")))
    with pytest.raises(RuntimeError, match="Unrelated deployment read failed"):
        delivery_sync.sync_once(bridge[0].app, bridge[1])
    assert row(bridge, ack["resource"]["id"])["state"] == "planned"
    assert len(bridge[2].list(bridge[3], bridge[4]["id"], "runs")) == 1


def test_due_order_prevents_old_blocked_originals_from_starving_a_later_acceptance(bridge):
    acknowledgements = []
    tasks = [bridge[6]]
    for position in range(2):
        created = command(bridge[0], "task.create", {"requirement_id": bridge[5], "title": f"Independent work {position}",
            "owner_id": "user:lead", "acceptance_criteria": ["Prove the independent result"]})
        assert created.status_code == 200, created.text
        resource_id = created.json()["resource"]["id"]
        tasks.append(next(task for task in created.json()["tasks"] if task["id"] == resource_id))
    for position, task in enumerate(tasks):
        current_bridge = (*bridge[:6], task)
        ack, _ = accept(current_bridge, key=f"fair-scan-original-{position}")
        acknowledgements.append(ack)
    for task in tasks[:2]:
        assert command(bridge[0], "task.update", {"id": task["id"], "description": "The fixed scope changed"}).status_code == 200
    assert handoff_once(bridge[0].app, bridge[1], limit=2) == 0
    assert [row(bridge, ack["resource"]["id"])["state"] for ack in acknowledgements] == ["blocked", "blocked", "accepted"]
    later = datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(minutes=2)
    assert handoff_once(bridge[0].app, bridge[1], limit=1, now=later) == 1
    assert row(bridge, acknowledgements[-1]["resource"]["id"])["state"] == "planned"
    assert len(bridge[2].list(bridge[3], bridge[4]["id"], "runs")) == 1
