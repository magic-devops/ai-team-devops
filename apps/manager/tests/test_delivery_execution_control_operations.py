# ruff: noqa: F811 -- real shared SQL/Core fixtures
"""Durable admission/effect/launch fault definitions. Deliberately not run yet."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from sqlalchemy import select, update

from sop_manager.project_write_guard import execution_control_projection_scope
from sop_manager.routers import delivery_execution_control_operation_service as controls
from sop_manager.routers.delivery_execution_control_operation_model import DeliveryExecutionControlOperation as Control
from sop_manager.routers.delivery_execution_handoff import handoff_once
from sop_manager.routers.delivery_execution_handoff_model import DeliveryExecutionHandoff
from sop_manager.routers.sql_models import DeliveryProgressObservation, DeliveryRequirementVersion, DeliveryWorkspace, Project, ProjectMember, Task, User
from test_delivery_execution import bridge, drain_controls, finish, queue, queue_payload, sync  # noqa: F401
from test_delivery_execution_runtime import gate
from test_delivery_workbench import command, env  # noqa: F401

ALL_CONTROLS = ["execution.start", "execution.retry", "execution.cancel", "approve", "reject"]


def fixed(bridge, action="execution.start", *, entry=None):
    client = bridge[0]
    entry = entry or sync(bridge, queue(bridge))
    decision = action if action in {"approve", "reject"} else None
    if action == "execution.retry":
        finish(bridge, entry, success=False)
        entry = sync(bridge, entry)
    body = {"id": entry["id"], "action": "execution.approval" if decision else action,
            "reason": "Human reviewed this exact control original"}
    if decision:
        approval = gate(bridge, entry)
        body.update(approval_id=approval["id"], decision=decision)
    preview = client.post("/api/v1/delivery/execution-control-preview", json=body)
    assert preview.status_code == 200 and preview.json()["allowed"], preview.text
    value = preview.json()
    return entry, {"action": value["action"], "payload": value["payload"], "expected_version": value["version"],
                   "idempotency_key": "fixed-control-" + action}


def admitted(bridge, original):
    response = bridge[0].post("/api/v1/delivery/commands", json=original)
    assert response.status_code == 200, response.text
    ack = response.json()
    assert set(ack["result"]) == {"control_operation_id", "request_digest"}
    return ack


def control_row(bridge, identity):
    with bridge[1]() as db:
        row = db.get(Control, identity)
        return {column.key: deepcopy(getattr(row, column.key)) for column in row.__table__.columns}


def future():
    return datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1)


@pytest.mark.parametrize("action", ALL_CONTROLS)
def test_acceptance_has_one_original_and_no_core_effect_before_commit(bridge, action):
    entry, original = fixed(bridge, action)
    run = bridge[2].get(bridge[3], bridge[4]["id"], "runs", entry["run_id"])
    ack = admitted(bridge, original)
    row = control_row(bridge, ack["result"]["control_operation_id"])
    assert row["state"] == "accepted" and row["revision"] == 1 and row["attempt"] == 0
    assert row["effect"] is None and row["launch"] is None
    assert row["original"]["original"] == {"payload": original["payload"], "version": original["expected_version"], "key": original["idempotency_key"]}
    assert row["accepted_version"] == ack["applied_version"] == original["expected_version"] + 1
    assert bridge[2].get(bridge[3], bridge[4]["id"], "runs", run["id"]) == run
    with bridge[2].engine.connect() as conn:
        assert conn.execute(select(bridge[2].managed_launches)).all() == []
    replay = admitted(bridge, original)
    assert replay["replayed"] and replay["result"] == ack["result"]
    with bridge[1]() as db:
        assert db.query(Control).count() == 1


@pytest.mark.parametrize("action", ALL_CONTROLS)
def test_admission_rollback_has_no_receipt_effect_or_launch(bridge, monkeypatch, action):
    entry, original = fixed(bridge, action)
    before = bridge[2].get(bridge[3], bridge[4]["id"], "runs", entry["run_id"])
    accept = controls.accept_control
    def fail(*args, **kwargs):
        accept(*args, **kwargs)
        raise HTTPException(503, "Injected failure before Manager acceptance commit")
    monkeypatch.setattr(controls, "accept_control", fail)
    response = bridge[0].post("/api/v1/delivery/commands", json=original)
    assert response.status_code == 503
    with bridge[1]() as db:
        assert db.query(Control).count() == 0
    assert bridge[2].get(bridge[3], bridge[4]["id"], "runs", entry["run_id"]) == before
    with bridge[2].engine.connect() as conn:
        assert conn.execute(select(bridge[2].managed_launches)).all() == []


@pytest.mark.parametrize("action", ALL_CONTROLS)
def test_committed_effect_recovers_after_manager_failure_and_unrelated_version(bridge, monkeypatch, action):
    entry, original = fixed(bridge, action)
    ack = admitted(bridge, original)
    identity = ack["result"]["control_operation_id"]
    project = controls.project_control
    monkeypatch.setattr(controls, "project_control", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("Projection lost after Core commit")))
    assert drain_controls(bridge, monkeypatch=monkeypatch) == 0
    with bridge[1]() as db:
        row = db.get(Control, identity)
        fact = controls.ManagedControls(bridge[2], bridge[0].app.state.hermes_execution).probe(controls._principal(row), row.workspace_id, request=row.original)
    assert fact is not None
    assert command(bridge[0], "task.update", {"id": entry["task_id"], "priority": "P0"}).status_code == 200
    monkeypatch.setattr(controls, "project_control", project)
    assert drain_controls(bridge, monkeypatch=monkeypatch, now=future()) == 1
    saved = control_row(bridge, identity)
    assert saved["effect"]["receipt_id"] == fact["receipt_id"]
    assert saved["effect"]["run_version"] == fact["run_version"]
    replay = admitted(bridge, original)
    assert replay["result"] == ack["result"] and replay["applied_version"] == ack["applied_version"]
    assert saved["original"]["original"]["key"] == original["idempotency_key"]


def test_claim_commit_precedes_effect_and_expiry_fences_old_projection(bridge, monkeypatch):
    _entry, original = fixed(bridge)
    ack = admitted(bridge, original)
    identity = ack["result"]["control_operation_id"]
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    with bridge[1]() as db:
        first = controls.claim_control(db, identity, now=now)
        db.commit()
    assert control_row(bridge, identity)["lease_owner"] == first.owner
    with bridge[1]() as db:
        assert controls.claim_control(db, identity, now=now) is None
    with bridge[1]() as db:
        second = controls.claim_control(db, identity, now=now + timedelta(minutes=2))
        db.commit()
    assert second.fence > first.fence
    assert controls.process_control(bridge[0].app, bridge[1], first) is False
    with monkeypatch.context() as scoped:
        scoped.setattr(__import__("sop_manager.routers.delivery_execution_schedule", fromlist=["submit_control_launch"]), "submit_control_launch", lambda *_: False)
        assert controls.process_control(bridge[0].app, bridge[1], second) is True


@pytest.mark.parametrize("column,value", [("original", {}), ("request_digest", "a" * 64), ("action", "execution.cancel"), ("target_operation_id", "other"), ("state", "applied")])
def test_control_original_and_state_cannot_be_changed_by_ordinary_sql(bridge, column, value):
    _, original = fixed(bridge)
    identity = admitted(bridge, original)["result"]["control_operation_id"]
    with bridge[1]() as db, pytest.raises(HTTPException) as denied:
        db.execute(update(Control).where(Control.id == identity).values({column: value}))
        db.commit()
    assert denied.value.detail["code"] == "control_service_required"


def test_control_projection_scope_cannot_change_task_or_requirement(bridge):
    _, original = fixed(bridge)
    identity = admitted(bridge, original)["result"]["control_operation_id"]
    with bridge[1]() as db, pytest.raises(HTTPException) as denied:
        with execution_control_projection_scope(db, "tenant", "project", identity):
            db.get(Task, bridge[6]["id"]).status = "completed"
            db.commit()
    assert denied.value.detail["code"] == "control_technical_scope_only"


def test_accepted_cancel_blocks_fresh_handoff_without_core_dispatch(bridge):
    queued = command(bridge[0], "execution.queue", queue_payload(bridge))
    execution = queued.json()["executions"][-1]
    preview = bridge[0].post("/api/v1/delivery/execution-control-preview", json={
        "id": execution["id"], "action": "execution.cancel", "reason": "Stop before plan creation"}).json()
    admitted(bridge, {"action": "execution.cancel", "payload": preview["payload"], "expected_version": preview["version"], "idempotency_key": "pending-cancel"})
    assert handoff_once(bridge[0].app, bridge[1]) == 0
    assert bridge[2].list(bridge[3], bridge[4]["id"], "runs") == []
    with bridge[1]() as db:
        assert db.query(DeliveryExecutionHandoff).one().state == "blocked"


def test_accepted_empty_run_cancel_observes_its_handoff_plan_without_rebinding_or_stopping(bridge, monkeypatch):
    from hermes_core.managed_handoff import ManagedHandoff
    from sop_manager.routers.delivery_execution_handoff import _principal, _request

    queued = command(bridge[0], "execution.queue", queue_payload(bridge))
    entry = queued.json()["executions"][-1]
    preview = bridge[0].post("/api/v1/delivery/execution-control-preview", json={
        "id": entry["id"], "action": "execution.cancel", "reason": "Close this exact pending handoff"}).json()
    original = {"action": "execution.cancel", "payload": preview["payload"], "expected_version": preview["version"],
                "idempotency_key": "pending-cancel-plan-won"}
    assert original["payload"]["run_id"] == ""
    ack = admitted(bridge, original)
    identity = ack["result"]["control_operation_id"]
    # Model an original H already committed in Core while its SQL projection
    # was lost. The C worker must discover the real plan before closing H.
    with bridge[1]() as db:
        handoff = db.query(DeliveryExecutionHandoff).filter_by(execution_id=entry["id"]).one()
        plan = ManagedHandoff(bridge[2], bridge[0].app.state.hermes_execution).dispatch(
            _principal(handoff), handoff.workspace_id, fence=1, **_request(handoff))
    before = bridge[2].get(bridge[3], bridge[4]["id"], "runs", plan["run_id"])
    assert drain_controls(bridge, monkeypatch=monkeypatch) == 1
    row = control_row(bridge, identity)
    assert row["state"] == "applied" and row["outcome"] == "needs_review"
    assert row["effect"]["outcome"] == "handoff_planned" and row["effect"]["handoff"]["run_id"] == plan["run_id"]
    assert row["run_id"] is None and row["original"]["original"]["payload"]["run_id"] == ""
    assert row["original"]["original"]["payload"] == original["payload"]
    assert bridge[2].get(bridge[3], bridge[4]["id"], "runs", plan["run_id"]) == before
    with bridge[1]() as db:
        persisted = db.get(DeliveryWorkspace, "project").data["executions"][-1]
        assert not persisted.get("run_id") and not persisted.get("stop_snapshot")
    replay = admitted(bridge, original)
    assert replay["result"] == ack["result"] and replay["applied_version"] == ack["applied_version"]


def test_cancel_preempts_fixed_prior_start_and_cannot_launch_late(bridge, monkeypatch):
    entry, original = fixed(bridge)
    first = admitted(bridge, original)
    preview = bridge[0].post("/api/v1/delivery/execution-control-preview", json={
        "id": entry["id"], "action": "execution.cancel", "reason": "Explicitly stop this exact attempt"})
    assert preview.status_code == 200 and preview.json()["allowed"], preview.text
    value = preview.json()
    cancelled = admitted(bridge, {"action": "execution.cancel", "payload": value["payload"], "expected_version": value["version"], "idempotency_key": "preempt-start"})
    fixed_cancel = control_row(bridge, cancelled["result"]["control_operation_id"])
    assert [item["control_id"] for item in fixed_cancel["original"]["prior_requests"]] == [first["result"]["control_operation_id"]]
    drain_controls(bridge, monkeypatch=monkeypatch)
    drain_controls(bridge, monkeypatch=monkeypatch, now=future())
    assert control_row(bridge, first["result"]["control_operation_id"])["state"] == "closed"
    run = bridge[2].get(bridge[3], bridge[4]["id"], "runs", entry["run_id"])
    assert run["status"] == "cancelled" and not run["data"].get("execution_owner")
    with bridge[2].engine.connect() as conn:
        assert conn.execute(select(bridge[2].managed_launches)).all() == []


def test_blocked_original_can_be_durably_ended_without_runtime_execute(bridge, monkeypatch):
    entry, original = fixed(bridge)
    ack = admitted(bridge, original)
    target_id = ack["result"]["control_operation_id"]
    # Product managers retain project write/approval but have only runtime read.
    with bridge[1]() as db:
        db.get(User, "lead").role = "product_manager"
        db.add(ProjectMember(project_id="project", user_id="lead", role="product_manager"))
        db.commit()
    # Preserve runtime workspace read membership after role downgrade.
    body = {"action": "execution.control.close", "payload": {"id": entry["id"], "control_operation_id": target_id,
        "request_digest": ack["result"]["request_digest"], "reason": "End the unperformed original"},
        "expected_version": bridge[0].get("/api/v1/delivery/workspace").json()["version"], "idempotency_key": "end-original"}
    closing = admitted(bridge, body)
    drain_controls(bridge, monkeypatch=monkeypatch)
    drain_controls(bridge, monkeypatch=monkeypatch, now=future())
    assert control_row(bridge, target_id)["state"] == "closed"
    end = control_row(bridge, closing["result"]["control_operation_id"])
    assert end["state"] == "applied" and end["outcome"] == "closed"
    assert bridge[2].get(bridge[3], bridge[4]["id"], "runs", entry["run_id"])["status"] == "planned"


def test_effect_recovery_when_archived_and_actor_disabled_is_technical_only(bridge, monkeypatch):
    entry, original = fixed(bridge, "execution.cancel")
    ack = admitted(bridge, original)
    project = controls.project_control
    monkeypatch.setattr(controls, "project_control", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("Manager unavailable after effect")))
    drain_controls(bridge, monkeypatch=monkeypatch)
    with bridge[1]() as db:
        db.get(User, "lead").status = "disabled"
        db.commit()
    with bridge[1].kw["bind"].begin() as conn:
        conn.execute(update(Project).where(Project.id == "project").values(status="archived"))
    with bridge[1]() as db:
        before = (db.query(DeliveryProgressObservation).count(), db.query(DeliveryRequirementVersion).count(), db.get(Task, entry["task_id"]).status)
    monkeypatch.setattr(controls, "project_control", project)
    assert drain_controls(bridge, monkeypatch=monkeypatch, now=future()) == 1
    with bridge[1]() as db:
        after = (db.query(DeliveryProgressObservation).count(), db.query(DeliveryRequirementVersion).count(), db.get(Task, entry["task_id"]).status)
        assert after == before
        assert db.get(DeliveryWorkspace, "project").data["executions"][-1]["status"] == "cancelled"
    assert control_row(bridge, ack["result"]["control_operation_id"])["state"] == "applied"


@pytest.mark.parametrize("limit", [0, 101, -1, True])
def test_control_scan_rejects_unbounded_or_boolean_limit(bridge, limit):
    with pytest.raises(ValueError):
        controls.control_once(bridge[0].app, bridge[1], limit=limit)
