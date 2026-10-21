"""Actual canonical native/proof consumers; runtime execution is deferred.

An external order is a separate activity slot, not a changed task definition or
proof that an external process has stopped. These tests are definitions only.
"""

from copy import deepcopy
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import event, func, select
from hermes_core.managed_controls import control_definition_hash

from sop_manager.routers.delivery_execution_handoff import _authorize_new
from sop_manager.routers.delivery_execution_handoff_model import DeliveryExecutionHandoff
from sop_manager.routers.delivery_execution_control_operation_model import DeliveryExecutionControlOperation
from sop_manager.routers.delivery_execution_control_operation_service import _fresh_authority
from sop_manager.routers.delivery_manual_review import current_review
from sop_manager.routers.delivery_verification import VerificationContext
from sop_manager.routers.sql_models import DeliveryWorkspace, Issue, Project, Task
from test_delivery_execution import bridge, cancel_execution, queue, queue_payload, sync  # noqa: F401
from test_delivery_execution_runtime import gate
from test_delivery_manual_review import completed, make_task, review, review_current
from test_delivery_task_submissions import decide, failed_native, submit
from test_delivery_workbench import command, env  # noqa: F401


def create_order(client, task_id):
    response = command(client, "member.save", {"name": "External development tool", "kind": "tool", "tool": "custom", "active": True})
    assert response.status_code == 200, response.text
    member_id = response.json()["resource"]["id"]
    current = client.get(f"/api/v1/delivery/tasks/{task_id}/work-orders/current")
    assert current.status_code == 200, current.text
    preview = client.post(f"/api/v1/delivery/tasks/{task_id}/work-order-preview", json={
        "task_basis": current.json()["task_basis"], "executor_member_id": member_id, "instructions": "Implement the fixed task and report the actual checks."})
    assert preview.status_code == 200 and preview.json()["allowed"], preview.text
    value = preview.json()
    response = command(client, "work_order.create", {"task_id": task_id,
        "task_basis": value["task_basis"], "definition_digest": value["definition_digest"],
        "native_boundary_digest": value["native_boundary_digest"], "executor_member_id": member_id,
        "preview_basis": value["preview_basis"], "instructions": "Implement the fixed task and report the actual checks."},
        version=value["version"])
    assert response.status_code == 200, response.text
    return response.json()["result"]


def order_action(client, order, action, **payload):
    response = command(client, "work_order." + action, {
        "id": order["work_order_id"], "order_revision": order["order_revision"], **payload})
    assert response.status_code == 200, response.text
    return response.json()["result"]


def test_real_queued_order_blocks_native_preview_queue_manual_review_and_completion(bridge):
    client, sessions, store, principal, workspace, _rid, task = bridge
    original_plan = queue_payload(bridge)
    order = create_order(client, task["id"])
    assert order["state"] == "queued"
    preview = client.post("/api/v1/delivery/execution-preview", json=original_plan)
    assert preview.status_code == 409, preview.text
    assert preview.json()["detail"]["code"] == "external_work_order_active"
    queued = command(client, "execution.queue", original_plan)
    assert queued.status_code == 409 and queued.json()["detail"]["code"] == "external_work_order_active"
    completed_response = command(client, "task.update", {"id": task["id"], "status": "completed"})
    assert completed_response.status_code == 409
    assert completed_response.json()["detail"]["code"] == "external_work_order_active"
    current = review_current(client, task["id"])
    assert current.status_code == 200 and not current.json()["current"]["can_review"]
    assert "external_work_order_active" in {reason["code"] for reason in current.json()["current"]["reasons"]}
    assert review(client, task["id"], decision="request_changes").status_code == 409
    assert not store.list(principal, workspace["id"], "runs")
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(DeliveryExecutionHandoff)) == 0
        assert db.get(Task, task["id"]).status != "completed"
    order_action(client, order, "cancel", comment="No worker has claimed this original.")
    allowed = client.post("/api/v1/delivery/execution-preview", json=queue_payload(bridge))
    assert allowed.status_code == 200, allowed.text


@pytest.mark.parametrize("action", ["execution.start", "execution.retry", "approve"])
def test_existing_native_controls_cannot_execute_while_an_external_original_owns_the_task(bridge, action):
    client, sessions, store, principal, workspace, _rid, task = bridge
    old = failed_native(bridge)
    order = create_order(client, task["id"])
    order = order_action(client, order, "claim")
    approval = None
    run = store.get(principal, workspace["id"], "runs", old["run_id"])
    if action == "execution.start":
        # Persist an unexpected delayed native state to exercise the read and
        # write guards; the external order must not silently become unclaimed.
        store.mutate(principal, workspace["id"], "runs", run["id"], operation="test.delayed.native", key="delayed-start",
            request={}, trace="test", expected=run["version"], transform=lambda _row: {"status": "planned"})
    elif action == "approve":
        approval = gate(bridge, old)
    before = store.get(principal, workspace["id"], "runs", old["run_id"])
    payload = {"id": old["id"], "action": "execution.approval" if approval else action, "reason": "Inspected this original."}
    if approval:
        payload.update(approval_id=approval["id"], decision="approve")
    preview = client.post("/api/v1/delivery/execution-control-preview", json=payload)
    assert preview.status_code == 200 and not preview.json()["allowed"], preview.text
    assert "external_work_order_active" in {reason["code"] for reason in preview.json()["reasons"]}
    denied = command(client, payload["action"], preview.json()["payload"], version=preview.json()["version"])
    assert denied.status_code == 409
    assert store.get(principal, workspace["id"], "runs", old["run_id"]) == before
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(DeliveryExecutionControlOperation)) == 0
    observation = client.get(f"/api/v1/delivery/executions/{old['id']}/observations")
    assert observation.status_code == 200, observation.text
    assert not observation.json()["permissions"]["can_start"] and not observation.json()["permissions"]["can_review"]
    cleanup = {**payload, "action": "execution.cancel"}
    cleanup.pop("approval_id", None)
    cleanup.pop("decision", None)
    cancel = client.post("/api/v1/delivery/execution-control-preview", json=cleanup)
    assert cancel.status_code == 200 and cancel.json()["allowed"], cancel.text
    if approval:
        rejected = client.post("/api/v1/delivery/execution-control-preview", json={**payload, "decision": "reject"})
        assert rejected.status_code == 200 and rejected.json()["allowed"], rejected.text


def test_claimed_stale_order_blocks_old_review_and_handoff_until_its_explicit_release(bridge):
    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    old = failed_native(bridge)
    order = order_action(client, create_order(client, task["id"]), "claim")
    assert command(client, "task.update", {"id": task["id"], "description": "New current scope"}).status_code == 200
    assert command(client, "task.update", {"id": task["id"], "description": task.get("description") or ""}).status_code == 200
    fixed = client.get(f"/api/v1/delivery/work-orders/{order['work_order_id']}")
    assert fixed.status_code == 200 and fixed.json()["work_order"]["invalidated"], fixed.text
    order = {**order, "order_revision": fixed.json()["work_order"]["order_revision"]}
    native_review = command(client, "execution.review", {"id": old["id"], "run_version": old["run_version"],
        "decision": "request_changes", "comment": "Cannot bypass the active external original."})
    assert native_review.status_code == 409 and native_review.json()["detail"]["code"] == "external_work_order_active"
    with sessions() as db:
        row = db.scalar(select(DeliveryExecutionHandoff).where(DeliveryExecutionHandoff.execution_id == old["id"]))
        with pytest.raises(HTTPException) as denied:
            _authorize_new(db, db.get(Project, "project"), row, deepcopy(db.get(DeliveryWorkspace, "project").data),
                bridge[2], client.app.state.hermes_execution)
        assert denied.value.detail["code"] == "external_work_order_active"
    cancelled = order_action(client, order, "cancel", comment="Request claimant stop; do not infer it.")
    assert cancelled["state"] == "cancel_requested"
    blocked = client.post("/api/v1/delivery/execution-preview", json=queue_payload(bridge))
    assert blocked.status_code == 409 and blocked.json()["detail"]["code"] == "external_work_order_active"


def test_old_native_sync_preserves_actual_runtime_facts_without_overwriting_external_business_progress(bridge):
    client, sessions, store, principal, workspace, _rid, task = bridge
    old = failed_native(bridge)
    order_action(client, create_order(client, task["id"]), "claim")
    with sessions() as db:
        task_status = db.get(Task, task["id"]).status
        issue_count = db.scalar(select(func.count()).select_from(Issue))
    run = store.get(principal, workspace["id"], "runs", old["run_id"])
    changed = store.mutate(principal, workspace["id"], "runs", run["id"], operation="test.delayed.observation", key="delayed-observation",
        request={}, trace="test", expected=run["version"], transform=lambda _row: {"status": "running"})
    observed = sync(bridge, old)
    assert observed["run_version"] == changed["version"] and observed["status"] == "running"
    with sessions() as db:
        assert db.get(Task, task["id"]).status == task_status
        assert db.scalar(select(func.count()).select_from(Issue)) == issue_count
    current = client.get(f"/api/v1/delivery/tasks/{task['id']}/work-orders/current")
    assert current.status_code == 200 and not current.json()["can_dispatch"], current.text
    assert current.json()["active_work_order_id"]
    assert "submission_native_delivery_open" in {reason["code"] for reason in current.json()["reasons"]}


def test_final_launch_authority_rechecks_the_active_slot_after_runtime_effect_preparation(bridge):
    client, sessions, store, principal, workspace, _rid, task = bridge
    old = failed_native(bridge)
    preview = client.post("/api/v1/delivery/execution-control-preview", json={
        "id": old["id"], "action": "execution.retry", "reason": "Inspect the exact launch boundary."})
    assert preview.status_code == 200 and preview.json()["allowed"], preview.text
    order = order_action(client, create_order(client, task["id"]), "claim")
    run = store.get(principal, workspace["id"], "runs", old["run_id"])
    # The consumer under test is the final authority callback, after its caller
    # has verified the private C/ticket original. Model that complete input and
    # a delayed prepared runtime state; this does not claim a real launch ran.
    accepted = SimpleNamespace(requested_by="lead", tenant_id="tenant", project_id="project",
        execution_id=old["id"], task_id=task["id"], workspace_id=workspace["id"], business_key="team",
        action="execution.retry", run_id=run["id"], run_attempt=1,
        original={"original": {"payload": preview.json()["payload"]}, "definition_hash": control_definition_hash(run)})
    store.mutate(principal, workspace["id"], "runs", run["id"], operation="test.prepared.launch", key="prepared-launch",
        request={}, trace="test", expected=run["version"], transform=lambda _row: {"status": "queued"})
    with sessions() as db:
        with pytest.raises(HTTPException) as denied:
            _fresh_authority(db, db.get(Project, "project"), accepted, deepcopy(db.get(DeliveryWorkspace, "project").data),
                store, client.app.state.hermes_execution, launch=True)
        assert denied.value.detail["code"] == "external_work_order_active"
    order = order_action(client, order, "cancel", comment="Request explicit claimant stop.")
    order_action(client, order, "release", stopped_attestation=True, comment="Claimant confirms the external process has stopped.")
    with sessions() as db:
        authorized = _fresh_authority(db, db.get(Project, "project"), accepted, deepcopy(db.get(DeliveryWorkspace, "project").data),
            store, client.app.state.hermes_execution, launch=True)
        assert authorized.actor == "lead"


@pytest.mark.parametrize("fault", ["running_with_old_stop", "terminal_without_stop", "stop_for_another_attempt"])
def test_fresh_native_preview_and_queue_reject_actual_old_run_or_unverified_stop(bridge, fault):
    client, sessions, store, principal, workspace, _rid, _task = bridge
    old = sync(bridge, queue(bridge))
    closed = cancel_execution(client, old["id"])
    assert closed.status_code == 200, closed.text
    allowed = client.post("/api/v1/delivery/execution-preview", json=queue_payload(bridge))
    assert allowed.status_code == 200, allowed.text
    run = store.get(principal, workspace["id"], "runs", old["run_id"])
    assert run["status"] == "cancelled" and run["data"]["stop_request"]["state"] == "not_started"

    def corrupt_observation(row):
        data = deepcopy(row["data"])
        if fault == "terminal_without_stop":
            data.pop("stop_request", None)
        elif fault == "stop_for_another_attempt":
            data["stop_request"]["attempt"] = data.get("attempt", 1) + 1
        return {"status": "running" if fault == "running_with_old_stop" else "cancelled", "data": data}

    unexpected = store.mutate(principal, workspace["id"], "runs", run["id"], operation="test.old.stop.fault", key="old-stop-" + fault,
        request={}, trace="test", expected=run["version"], transform=corrupt_observation)
    with sessions() as db:
        handoffs = db.scalar(select(func.count()).select_from(DeliveryExecutionHandoff))
    plan = queue_payload(bridge)
    preview = client.post("/api/v1/delivery/execution-preview", json=plan)
    assert preview.status_code == 409 and preview.json()["detail"]["code"] == "execution_stop_unresolved", preview.text
    denied = command(client, "execution.queue", plan)
    assert denied.status_code == 409 and denied.json()["detail"]["code"] == "execution_stop_unresolved", denied.text
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(DeliveryExecutionHandoff)) == handoffs
    assert store.get(principal, workspace["id"], "runs", run["id"]) == unexpected


def test_prior_control_with_unknown_sql_projection_blocks_even_a_positively_stopped_run(bridge):
    from sop_manager.routers import delivery_execution_control_operation_service as controls
    from test_delivery_execution_control_operations import admitted, fixed

    client, sessions, _store, _principal, _workspace, _rid, _task = bridge
    old, original = fixed(bridge)
    start = admitted(bridge, original)
    preview = client.post("/api/v1/delivery/execution-control-preview", json={
        "id": old["id"], "action": "execution.cancel", "reason": "Close the unclaimed start before new work."})
    assert preview.status_code == 200 and preview.json()["allowed"], preview.text
    cancellation = client.post("/api/v1/delivery/commands", json={"action": "execution.cancel",
        "payload": preview.json()["payload"], "expected_version": preview.json()["version"], "idempotency_key": "cancel-before-original-projection"})
    assert cancellation.status_code == 200, cancellation.text
    with sessions() as db:
        claim = controls.claim_control(db, cancellation.json()["result"]["control_operation_id"])
        db.commit()
    assert controls.process_control(client.app, sessions, claim)
    with sessions() as db:
        pending = db.get(DeliveryExecutionControlOperation, start["result"]["control_operation_id"])
        assert pending.state == "accepted"
        assert db.get(DeliveryWorkspace, "project").data["executions"][-1]["status"] == "cancelled"
    proposal = client.post("/api/v1/delivery/execution-preview", json=queue_payload(bridge))
    assert proposal.status_code == 409 and proposal.json()["detail"]["code"] == "execution_control_pending", proposal.text


def test_closed_never_planned_handoff_does_not_invent_a_run_stop_requirement(bridge):
    client, _sessions, store, principal, workspace, _rid, _task = bridge
    intent = queue(bridge)
    assert not intent["run_id"]
    assert cancel_execution(client, intent["id"]).status_code == 200
    assert not store.list(principal, workspace["id"], "runs")
    preview = client.post("/api/v1/delivery/execution-preview", json=queue_payload(bridge))
    assert preview.status_code == 200, preview.text


def test_terminal_retry_can_reuse_an_older_successful_last_node_without_rewriting_its_stop_evidence(bridge):
    from hermes_core.run_controls import stop_view
    from sop_manager.routers.delivery_execution_runtime import require_previous_stops
    from sop_manager.routers.sql_models import User

    client, sessions, store, principal, workspace, _rid, task = bridge
    payload = queue_payload(bridge)
    payload.update(nodes=[{"id": "repair", "argv": ["python", "-c", "print('repaired')"]},
                          {"id": "stable", "argv": ["python", "-c", "print('reused')"]}], test_node_ids=["repair", "stable"])
    response = command(client, "execution.queue", payload)
    assert response.status_code == 200, response.text
    old = sync(bridge, response.json()["executions"][-1])
    run = store.get(principal, workspace["id"], "runs", old["run_id"])
    physical = {"succeeded": True, "exit_code": 0, "process_tree_stopped": True, "wait_completed": True, "output_eof": True}
    terminal = store.mutate(principal, workspace["id"], "runs", run["id"], operation="test.retry.reused", key="terminal-reused-node",
        request={}, trace="test", expected=run["version"], transform=lambda row: {"status": "completed", "data": {
            **row["data"], "attempt": 2, "active_node": None, "execution_owner": None, "stop_request": None,
            "node_results": {"repair": {**physical, "attempt": 2}, "stable": {**physical, "attempt": 1}}}})
    assert stop_view(terminal)["state"] == "confirmed" and stop_view(terminal)["attempt"] == 1
    # This checks physical closure only. The normal delivery/review gates still
    # decide whether another Task plan is allowed; no acceptance is invented.
    with sessions() as db:
        require_previous_stops(db, db.get(Project, "project"), db.get(User, "lead"),
            deepcopy(db.get(DeliveryWorkspace, "project").data), task["id"], store)
    assert store.get(principal, workspace["id"], "runs", run["id"]) == terminal


def test_active_work_order_suppresses_existing_manual_acceptance_without_changing_its_original(env):
    client, sessions, _actor = env
    task = completed(client)
    assert review(client, task["id"]).status_code == 200
    with sessions() as db:
        project = db.get(Project, "project")
        data = deepcopy(db.get(DeliveryWorkspace, project.id).data)
        before = VerificationContext(db, project, data, work_order_activity={})
        assert before.verified(task["id"])
        saved = deepcopy(before.reviews[task["id"]].snapshot)
        context = VerificationContext(db, project, data, work_order_activity={task["id"]: {"state": "queued", "reported_status": None}})
        current = current_review(context, task["id"], can_approve=True)
        assert not current["eligible"] and not current["can_review"] and not current["can_accept"]
        assert "external_work_order_active" in {reason["code"] for reason in current["reasons"]}
        assert not context.verified(task["id"])
        assert context.snapshot(task["id"]) == before.snapshot(task["id"])
        assert context.basis(task["id"]) == before.basis(task["id"])
        assert context.reviews[task["id"]].snapshot == saved


@pytest.mark.parametrize("active", [set(), {"another-task"}])
def test_unrelated_or_absent_external_slot_does_not_block_manual_proof(env, active):
    client, sessions, _actor = env
    task = completed(client)
    assert review(client, task["id"]).status_code == 200
    with sessions() as db:
        project = db.get(Project, "project")
        data = deepcopy(db.get(DeliveryWorkspace, project.id).data)
        context = VerificationContext(db, project, data, work_order_activity={tid: {"state": "queued", "reported_status": None} for tid in active})
        assert context.verified(task["id"])
        current = current_review(context, task["id"], can_approve=True)
        assert "external_work_order_active" not in {reason["code"] for reason in current["reasons"]}


def assert_http_progress(client, task_id, status):
    selected = client.get(f"/api/v1/delivery/tasks/{task_id}")
    assert selected.status_code == 200, selected.text
    assert selected.json()["task"]["delivery_status"] == status
    progress = client.get("/api/v1/delivery/progress")
    assert progress.status_code == 200, progress.text
    metrics = progress.json()["current"]["metrics"]
    assert metrics["status_counts"][status] == 1
    assert metrics["tasks_total"] == 1
    assert metrics["verified_completed"] == (1 if status == "verified_completed" else 0)


def test_external_claim_report_and_human_review_project_one_real_http_progress_chain_without_editing_task(env):
    from sop_manager.routers.delivery_external_work_order_model import DeliveryExternalWorkOrder

    client, sessions, _actor = env
    task = make_task(client)
    order = create_order(client, task["id"])
    with sessions() as db:
        project = db.get(Project, "project")
        context = VerificationContext(db, project, deepcopy(db.get(DeliveryWorkspace, project.id).data))
        snapshot, basis = context.snapshot(task["id"]), context.basis(task["id"])
        row = db.get(DeliveryExternalWorkOrder, order["work_order_id"])
        original, packet_digest = deepcopy(row.original), row.packet_digest

    def unchanged_originals():
        with sessions() as db:
            project = db.get(Project, "project")
            context = VerificationContext(db, project, deepcopy(db.get(DeliveryWorkspace, project.id).data))
            assert context.snapshot(task["id"]) == snapshot
            assert context.basis(task["id"]) == basis
            row = db.get(DeliveryExternalWorkOrder, order["work_order_id"])
            assert row.original == original and row.packet_digest == packet_digest

    assert_http_progress(client, task["id"], "pending")
    unchanged_originals()
    order = order_action(client, order, "claim")
    assert_http_progress(client, task["id"], "in_progress")
    unchanged_originals()
    order = order_action(client, order, "progress", percent=None, status="blocked", message="Waiting for the requested external prerequisite.")
    assert_http_progress(client, task["id"], "blocked")
    unchanged_originals()
    order = order_action(client, order, "progress", percent=70, status="running", message="The prerequisite is resolved; finishing the fixed task.")
    assert_http_progress(client, task["id"], "in_progress")
    # Saving S alone does not attest stop or release the current claimant.
    submitted, _request = submit(client, task["id"])
    sid = submitted["result"]["submission_id"]
    assert_http_progress(client, task["id"], "in_progress")
    denied, _request = decide(client, task["id"], sid, key="review-before-stop-and-link")
    assert denied.status_code == 409, denied.text
    unchanged_originals()
    order = order_action(client, order, "report", submission_id=sid,
        submission_digest=submitted["result"]["submission_digest"], stopped_attestation=True)
    assert order["state"] == "reported"
    assert_http_progress(client, task["id"], "awaiting_review")
    unchanged_originals()
    accepted, _request = decide(client, task["id"], sid, key="review-after-stop-and-link")
    assert accepted.status_code == 200, accepted.text
    assert_http_progress(client, task["id"], "verified_completed")


def test_claimed_cancel_request_remains_in_progress_until_explicit_stop_without_rewriting_task(env):
    client, sessions, _actor = env
    task = make_task(client)
    order = create_order(client, task["id"])
    assert_http_progress(client, task["id"], "pending")
    order = order_action(client, order, "claim")
    order = order_action(client, order, "cancel", comment="Wait for the claimant's explicit stop attestation.")
    assert order["state"] == "cancel_requested"
    assert_http_progress(client, task["id"], "in_progress")
    with sessions() as db:
        assert db.get(Task, task["id"]).status == "pending"
    order_action(client, order, "release", stopped_attestation=True, comment="All external work for this original has stopped.")
    assert_http_progress(client, task["id"], "pending")


@pytest.mark.parametrize("state", ["queued", "claimed", "cancel_requested"])
def test_external_activity_projection_preserves_real_planning_blockers_and_never_enters_task_basis(env, state):
    client, sessions, _actor = env
    task = make_task(client)
    with sessions() as db:
        project = db.get(Project, "project")
        data = deepcopy(db.get(DeliveryWorkspace, project.id).data)
        before = VerificationContext(db, project, data, work_order_activity={})
        activity = {task["id"]: {"state": state, "reported_status": "running"}}
        context = VerificationContext(db, project, data, work_order_activity=activity)
        assert context.delivery_status(task["id"]) == ("pending" if state == "queued" else "in_progress")
        assert context.basis(task["id"]) == before.basis(task["id"])
        assert not context.verified(task["id"])
        blocked = deepcopy(data)
        blocked.setdefault("task_details", {}).setdefault(task["id"], {})["blocked_reason"] = "Resolve the current planning blocker."
        assert VerificationContext(db, project, blocked, work_order_activity=activity).delivery_status(task["id"]) == "blocked"
        blocked = deepcopy(data)
        blocked["flows"][task["req_id"]]["blocked_reason"] = "Resolve the current requirement blocker."
        assert VerificationContext(db, project, blocked, work_order_activity=activity).delivery_status(task["id"]) == "blocked"
        blocked = deepcopy(data)
        blocked.setdefault("task_details", {}).setdefault(task["id"], {})["depends_on"] = ["unverified-predecessor"]
        assert VerificationContext(db, project, blocked, work_order_activity=activity).delivery_status(task["id"]) == "blocked"
        recorded = deepcopy(db.get(Task, task["id"]))
        recorded.status = "blocked"
        baseline = VerificationContext(db, project, data, tasks=[recorded], work_order_activity={})
        active = VerificationContext(db, project, data, tasks=[recorded], work_order_activity=activity)
        assert active.delivery_status(task["id"]) == "blocked"
        assert active.basis(task["id"]) == baseline.basis(task["id"])


def test_queued_activity_does_not_borrow_old_task_or_execution_running_status(env):
    client, sessions, _actor = env
    task = make_task(client)
    with sessions() as db:
        project = db.get(Project, "project")
        data = deepcopy(db.get(DeliveryWorkspace, project.id).data)
        data["executions"] = [{"id": "old-execution", "task_id": task["id"], "status": "awaiting_review"}]
        # A detached row models old recorded status. No Task SQL mutation or
        # source adoption is used to represent the queued activity itself.
        recorded = deepcopy(db.get(Task, task["id"]))
        recorded.status = "in_progress"
        context = VerificationContext(db, project, data, tasks=[recorded],
            work_order_activity={task["id"]: {"state": "queued", "reported_status": None}})
        assert context.delivery_status(task["id"]) == "pending"
        assert not context.verified(task["id"])


def test_external_progress_reader_uses_one_scoped_thin_sql_projection_without_loading_original(env):
    from sop_manager.routers.delivery_external_work_order_model import DeliveryExternalWorkOrder
    from sop_manager.routers.delivery_external_work_order_progress import active_activity

    client, sessions, _actor = env
    task = make_task(client)
    order = order_action(client, create_order(client, task["id"]), "claim")
    order_action(client, order, "progress", percent=None, status="blocked", message="Private detailed progress must not be loaded by the progress projection.")
    with sessions() as db:
        project = db.get(Project, "project")
        statements = []

        def capture(_connection, _cursor, statement, _parameters, _context, _many):
            statements.append(statement)

        engine = db.get_bind()
        event.listen(engine, "before_cursor_execute", capture)
        try:
            activity = active_activity(db, project, [task["id"], "unrelated-task"])
        finally:
            event.remove(engine, "before_cursor_execute", capture)
        assert activity == {task["id"]: {"state": "claimed", "reported_status": "blocked",
            "id": order["work_order_id"], "claimant_id": "lead"}}
        assert len(statements) == 1
        query = statements[0].lower()
        assert "tenant_id" in query and "project_id" in query and "active_task_id" in query
        assert "original" not in query and "executor" not in query and "message" not in query
        assert not any(isinstance(value, DeliveryExternalWorkOrder) for value in db.identity_map.values())
        assert active_activity(db, SimpleNamespace(tenant_id="different-tenant", id=project.id), [task["id"]]) == {}
        assert active_activity(db, SimpleNamespace(tenant_id=project.tenant_id, id="different-project"), [task["id"]]) == {}
        assert active_activity(db, project, []) == {}
