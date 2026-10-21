"""Actual one-command report/stop handoff definitions; execution is deferred."""

from copy import deepcopy

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from sop_manager.routers import sql_models as models
from sop_manager.routers.delivery_external_work_order_model import DeliveryExternalWorkOrder as Order
from sop_manager.routers.delivery_task_submission_model import DeliveryTaskSubmission as Submission
from test_delivery_execution import bridge as execution_bridge, cancel_execution, queue
from test_delivery_manual_review import make_task
from test_delivery_task_submissions import counts, current, decide, detail as submission_detail, report, request, submit
from test_delivery_workbench import command, env as delivery_env
from test_external_work_orders import claim, create_order, detail, mutate

env = delivery_env
bridge = execution_bridge


def held(client, task_id, *, claimed=True):
    ack, _ = create_order(client, task_id)
    wid = ack["result"]["work_order_id"]
    if claimed:
        claim(client, wid)
    return detail(client, wid)["work_order"]


def binding(order):
    return {"id": order["id"], "order_revision": order["order_revision"], "stopped_attestation": True}


def bound_request(client, task_id, order, *, key="guided-report", failed=False):
    payload = report(client, task_id, work_order=binding(order))
    if failed:
        payload["tests"][0]["status"] = "failed"
    return request(client, "task.delivery.submit", payload, key=key)


def test_one_report_transaction_stops_exact_order_and_keeps_acceptance_a_separate_decision(env):
    client, sessions, _actor = env
    task = make_task(client)
    order = held(client, task["id"])
    source = current(client, task["id"]).json()
    assert set(source["work_order"]) == {"id", "order_revision", "executor"}
    assert source["work_order"] == {"id": order["id"], "order_revision": order["order_revision"], "executor": order["executor"]}
    original = bound_request(client, task["id"], order)
    response = client.post("/api/v1/delivery/commands", json=original)
    assert response.status_code == 200, response.text
    ack = response.json()
    sid = ack["result"]["submission_id"]
    assert set(ack["result"]) == {"task_ids", "submission_id", "submission_digest", "issue_id", "work_order"}
    assert ack["result"]["work_order"] == {"id": order["id"], "order_revision": order["order_revision"] + 1, "state": "reported"}
    assert ack["resource"] == {"kind": "task_submission", "id": sid}
    assert {(ref["kind"], ref["id"]) for ref in ack["affected_refs"]} == {("task_submission", sid), ("task", task["id"]), ("work_order", order["id"])}
    assert ack["applied_version"] == original["expected_version"] + 1
    saved_order = detail(client, order["id"])["work_order"]
    assert saved_order["state"] == "reported" and saved_order["delivery_state"] == "awaiting_review"
    assert saved_order["submission"] == {"id": sid, "digest": ack["result"]["submission_digest"]}
    assert saved_order["closure"]["kind"] == "external_reported_stop"
    saved = submission_detail(client, task["id"], sid).json()
    assert saved["payload"]["work_order"] == original["payload"]["work_order"]
    assert saved["payload"]["tests"] == original["payload"]["tests"] and saved["permissions"]["can_review"]
    with sessions() as db:
        assert db.get(models.Task, task["id"]).status != "completed"
        assert db.scalar(select(models.DeliveryTaskReview)) is None
    accepted, _ = decide(client, task["id"], sid)
    assert accepted.status_code == 200, accepted.text
    assert detail(client, order["id"])["work_order"]["delivery_state"] == "accepted"
    for action in ("task.delivery.submit", "task.delivery.review"):
        activity = client.get("/api/v1/delivery/activity", params={"action": action})
        assert activity.status_code == 200, activity.text
        item = activity.json()["items"][0]
        assert item["target"]["kind"] == "task" and item["target"]["id"] == task["id"] and item["target"]["available"]
        assert item["requirement_ids"] == [task["req_id"]]
        assert not any(target["kind"] == "task" and target["id"] == sid for target in [item["target"], *item["related_targets"]])
        if action == "task.delivery.submit":
            assert any(target["kind"] == "work_order" and target["id"] == order["id"] and target["available"] for target in item["related_targets"])
    before = counts(sessions)
    recovered = client.post("/api/v1/delivery/commands", json=original)
    assert recovered.status_code == 200 and recovered.json()["replayed"], recovered.text
    assert recovered.json()["result"] == ack["result"] and counts(sessions) == before


@pytest.mark.parametrize("explicit_null", [False, True])
def test_only_save_report_does_not_stop_or_link_and_existing_explicit_link_still_works(env, explicit_null):
    client, _sessions, _actor = env
    task = make_task(client)
    assert current(client, task["id"]).json()["work_order"] is None
    order = held(client, task["id"])
    payload = report(client, task["id"], **({"work_order": None} if explicit_null else {}))
    saved, _ = submit(client, task["id"], payload=payload)
    sid = saved["result"]["submission_id"]
    assert set(saved["result"]) == {"task_ids", "submission_id", "submission_digest", "issue_id"}
    assert detail(client, order["id"])["work_order"]["state"] == "claimed"
    early, _ = decide(client, task["id"], sid)
    assert early.status_code == 409
    linked, _ = mutate(client, order["id"], "report", submission_id=sid,
        submission_digest=saved["result"]["submission_digest"], stopped_attestation=True)
    assert linked.status_code == 200, linked.text


@pytest.mark.parametrize("attestation", [False, 1, None, "true", "missing"])
def test_handoff_requires_an_explicit_strict_true_stop_attestation_without_writes(env, attestation):
    client, sessions, _actor = env
    task = make_task(client)
    order = held(client, task["id"])
    original = bound_request(client, task["id"], order)
    if attestation == "missing":
        original["payload"]["work_order"].pop("stopped_attestation")
    else:
        original["payload"]["work_order"]["stopped_attestation"] = attestation
    before = counts(sessions)
    response = client.post("/api/v1/delivery/commands", json=original)
    assert response.status_code == 422, response.text
    assert counts(sessions) == before
    assert detail(client, order["id"])["work_order"]["state"] == "claimed"


@pytest.mark.parametrize("fault", ["actor", "task", "revision", "queued", "cancel_requested", "invalidated", "other_project", "other_tenant"])
def test_wrong_or_changed_explicit_work_order_never_falls_back_to_plain_submission(env, fault):
    client, sessions, actor = env
    task = make_task(client)
    order = held(client, task["id"], claimed=fault != "queued")
    if fault == "actor":
        with sessions() as db:
            db.add(models.User(id="guided-other", tenant_id="tenant", username="guided-other", password_hash="not-a-login", role="developer", status="active"))
            db.flush()
            db.add(models.ProjectMember(project_id="project", user_id="guided-other", role="developer"))
            db.commit()
        actor["id"] = "guided-other"
    elif fault == "task":
        made = command(client, "task.create", {"title": "A different original task", "owner_id": "user:lead", "acceptance_criteria": ["Separate scope"]})
        assert made.status_code == 200, made.text
        task = next(row for row in made.json()["tasks"] if row["id"] == made.json()["resource"]["id"])
    elif fault == "revision":
        order["order_revision"] += 1
    elif fault == "cancel_requested":
        cancelled, _ = mutate(client, order["id"], "cancel", comment="Stop requested before this new delivery.")
        assert cancelled.status_code == 200, cancelled.text
        order = detail(client, order["id"])["work_order"]
    elif fault == "invalidated":
        changed = command(client, "task.update", {"id": task["id"], "description": "The old work order has a different scope."})
        assert changed.status_code == 200, changed.text
        order = detail(client, order["id"])["work_order"]
    elif fault == "other_project":
        client.headers["X-Project-Id"] = "other"
        foreign_task = make_task(client)
        order = held(client, foreign_task["id"])
        client.headers["X-Project-Id"] = "project"
    elif fault == "other_tenant":
        with sessions() as db:
            db.add(models.Tenant(id="guided-foreign", name="Foreign", slug="guided-foreign"))
            db.flush()
            db.add(models.Project(id="guided-foreign", tenant_id="guided-foreign", name="Foreign"))
            db.add(models.User(id="guided-foreign-lead", tenant_id="guided-foreign", username="guided-foreign-lead", password_hash="not-a-login", role="tenant_admin", status="active"))
            db.commit()
        actor["id"] = "guided-foreign-lead"
        client.headers["X-Project-Id"] = "guided-foreign"
        made = command(client, "task.create", {"title": "Foreign original work", "owner_id": "user:guided-foreign-lead", "acceptance_criteria": ["Foreign scope"]})
        assert made.status_code == 200, made.text
        foreign_task = next(row for row in made.json()["tasks"] if row["id"] == made.json()["resource"]["id"])
        order = held(client, foreign_task["id"])
        actor["id"] = "lead"
        client.headers["X-Project-Id"] = "project"
    if fault in {"actor", "task", "queued", "cancel_requested", "invalidated"}:
        assert current(client, task["id"]).json()["work_order"] is None
    original = bound_request(client, task["id"], order)
    before = counts(sessions)
    response = client.post("/api/v1/delivery/commands", json=original)
    assert response.status_code in {403, 404, 409}, response.text
    assert counts(sessions) == before


def test_original_replay_after_lost_ack_has_one_submission_issue_closure_and_unchanged_original_request(env):
    client, sessions, _actor = env
    task = make_task(client)
    order = held(client, task["id"])
    original = bound_request(client, task["id"], order, failed=True)
    retained = deepcopy(original)
    response = client.post("/api/v1/delivery/commands", json=original)
    assert response.status_code == 200, response.text
    first = response.json()
    before = counts(sessions)
    replay = client.post("/api/v1/delivery/commands", json=original)
    assert replay.status_code == 200 and replay.json()["replayed"], replay.text
    assert replay.json()["result"] == first["result"] and original == retained
    assert counts(sessions) == before
    assert first["result"]["issue_id"]
    activity = client.get("/api/v1/delivery/activity", params={"action": "task.delivery.submit"})
    assert activity.status_code == 200, activity.text
    item = activity.json()["items"][0]
    assert item["target"]["id"] == task["id"]
    assert any(target["kind"] == "issue" and target["id"] == first["result"]["issue_id"] for target in item["related_targets"])
    assert submission_detail(client, task["id"], first["result"]["submission_id"]).json()["permissions"]["can_accept"] is False
    altered = deepcopy(original)
    altered["payload"]["summary"] = "A changed report cannot reuse the accepted key."
    assert client.post("/api/v1/delivery/commands", json=altered).status_code == 409
    assert counts(sessions) == before


def test_late_work_order_failure_rolls_back_new_report_issue_old_invalidation_and_all_projections(env, monkeypatch):
    from sop_manager.routers import delivery_external_work_order_service as work_orders

    client, sessions, _actor = env
    task = make_task(client)
    order = held(client, task["id"])
    older, _ = submit(client, task["id"], key="guided-retained-old")
    original = bound_request(client, task["id"], order, failed=True)
    with sessions() as db:
        old_row = db.get(Submission, older["result"]["submission_id"])
        old = deepcopy(old_row.original)
        order_before = {column.key: deepcopy(getattr(db.get(Order, order["id"]), column.key)) for column in Order.__table__.c}
        generation = db.scalar(select(models.DeliveryQueryState.generation).where(models.DeliveryQueryState.project_id == "project"))
        version = db.get(models.DeliveryWorkspace, "project").version
        workspace = deepcopy(db.get(models.DeliveryWorkspace, "project").data)
        facts = [(row.kind, row.entity_id, deepcopy(row.data)) for row in db.scalars(select(models.DeliveryQueryFact).where(
            models.DeliveryQueryFact.project_id == "project").order_by(models.DeliveryQueryFact.kind, models.DeliveryQueryFact.entity_id))]
    before = counts(sessions)
    real_apply = work_orders.apply_work_order

    def fail_after_real_closure(*args, **kwargs):
        result = real_apply(*args, **kwargs)
        if args[4] == "work_order.report":
            raise HTTPException(409, {"code": "guided_test_late_failure", "message": "Reject after both real domain writes."})
        return result

    monkeypatch.setattr(work_orders, "apply_work_order", fail_after_real_closure)
    rejected = client.post("/api/v1/delivery/commands", json=original)
    assert rejected.status_code == 409, rejected.text
    assert counts(sessions) == before
    with sessions() as db:
        assert db.get(Submission, older["result"]["submission_id"]).original == old
        assert not db.get(Submission, older["result"]["submission_id"]).invalidated
        assert {column.key: getattr(db.get(Order, order["id"]), column.key) for column in Order.__table__.c} == order_before
        assert db.get(models.DeliveryWorkspace, "project").version == version
        assert db.get(models.DeliveryWorkspace, "project").data == workspace
        assert db.scalar(select(models.DeliveryQueryState.generation).where(models.DeliveryQueryState.project_id == "project")) == generation
        assert [(row.kind, row.entity_id, row.data) for row in db.scalars(select(models.DeliveryQueryFact).where(
            models.DeliveryQueryFact.project_id == "project").order_by(models.DeliveryQueryFact.kind, models.DeliveryQueryFact.entity_id))] == facts
    monkeypatch.setattr(work_orders, "apply_work_order", real_apply)
    retried = client.post("/api/v1/delivery/commands", json=original)
    assert retried.status_code == 200 and not retried.json()["replayed"], retried.text


def test_current_handoff_is_a_pure_scoped_read_and_revision_changes_are_explicit(env):
    client, sessions, actor = env
    task = make_task(client)
    order = held(client, task["id"])
    before = counts(sessions)
    with sessions() as db:
        original = deepcopy(db.get(Order, order["id"]).original)
        version = db.get(models.DeliveryWorkspace, "project").version
        generation = db.scalar(select(models.DeliveryQueryState.generation).where(models.DeliveryQueryState.project_id == "project"))
    first = current(client, task["id"])
    second = current(client, task["id"])
    assert first.status_code == second.status_code == 200
    assert first.json()["work_order"] == second.json()["work_order"]
    assert counts(sessions) == before
    with sessions() as db:
        assert db.get(Order, order["id"]).original == original
        assert db.get(models.DeliveryWorkspace, "project").version == version
        assert db.scalar(select(models.DeliveryQueryState.generation).where(models.DeliveryQueryState.project_id == "project")) == generation
    progressed, _ = mutate(client, order["id"], "progress", percent=None, status="running", message="Explicit current revision changes.")
    assert progressed.status_code == 200, progressed.text
    latest = current(client, task["id"]).json()
    assert latest["task_basis"] == first.json()["task_basis"]
    assert latest["work_order"]["id"] == order["id"] and latest["work_order"]["order_revision"] == order["order_revision"] + 1
    assert not ({"original", "packet", "progress", "instructions", "claimed_by"} & set(latest["work_order"]))
    actor["id"] = "reader"
    assert current(client, task["id"]).json()["work_order"] is None
    assert client.get(f"/api/v1/delivery/tasks/{task['id']}/delivery-submissions/current", headers={"X-Project-Id": "other"}).status_code == 403


def test_native_original_scopes_are_retained_for_bound_receipt_and_rechecked_on_replay(bridge):
    client, sessions, store, principal, workspace, _rid, task = bridge
    execution = queue(bridge)
    cancelled = cancel_execution(client, execution["id"])
    assert cancelled.status_code == 200, cancelled.text
    order = held(client, task["id"])
    original = bound_request(client, task["id"], order, failed=True)
    response = client.post("/api/v1/delivery/commands", json=original)
    assert response.status_code == 200, response.text
    with sessions() as db:
        event = db.scalar(select(models.DeliveryEvent).where(models.DeliveryEvent.version == response.json()["applied_version"]))
        assert event.data["command_ack_access"] == [workspace["id"]]
    latest = store.get(principal, "", "workspaces", workspace["id"])
    store.mutate(principal, "", "workspaces", workspace["id"], operation="guided.membership.revoke", key="guided-revoke-scope",
        request={}, trace="test", expected=latest["version"], transform=lambda row: {"data": {**row["data"], "owner": "different-owner", "members": []}})
    with sessions() as db:
        db.get(models.User, "lead").role = "tenant_admin"
        db.commit()
    assert client.post("/api/v1/delivery/commands", json=original).status_code == 403
    sid = response.json()["result"]["submission_id"]
    assert client.get(f"/api/v1/delivery/tasks/{task['id']}/delivery-submissions/{sid}").status_code == 403
    assert client.get(f"/api/v1/delivery/tasks/{task['id']}/delivery-submissions").status_code == 403
    issue = client.get(f"/api/v1/delivery/issues/{response.json()['result']['issue_id']}")
    assert issue.status_code == 200, issue.text
    evidence = next(item for item in issue.json()["evidence"] if item["kind"] == "submission" and item["target"]["submission_id"] == sid)
    assert evidence["restricted"] and evidence["excerpt"] == ""


@pytest.mark.parametrize("processed", [False, True])
def test_existing_report_event_freezes_bound_scope_for_failed_and_processed_original_consumers(bridge, processed):
    from sop_manager.routers import events_ingest
    from sop_manager.routers.auth_sql import current_user, current_user_or_apikey
    from test_delivery_task_submissions import revoke_runtime_membership
    from test_event_handoff import frozen, result, send, version

    client, sessions, _store, _principal, workspace, _rid, task = bridge
    client.app.include_router(events_ingest.router)
    client.app.dependency_overrides[current_user_or_apikey] = client.app.dependency_overrides[current_user]
    execution = queue(bridge)
    assert cancel_execution(client, execution["id"]).status_code == 200
    order = held(client, task["id"])
    payload = report(client, task["id"], work_order=binding(order))
    original = frozen("guided-fixed-event", "sop.task.delivery_submitted", {
        "expected_version": version(sessions) if processed else version(sessions) - 1, "report": payload}, task["id"])
    receipt = result(send(client, original))
    assert receipt["processing"]["state"] == ("processed" if processed else "failed"), receipt
    rid = receipt["receipt_id"]
    with sessions() as db:
        row = db.get(models.EventProcessing, rid)
        assert row.plan == {"kind": "task-delivery-scope.v1", "runtime_scopes": [workspace["id"]]}
    assert detail(client, order["id"])["work_order"]["state"] == ("reported" if processed else "claimed")
    assert client.get(f"/api/v1/events/{rid}").status_code == 200
    revoke_runtime_membership(bridge)
    before = counts(sessions)
    assert client.get(f"/api/v1/events/{rid}").status_code == 403
    assert client.get(f"/api/v1/events/{rid}/attempts").status_code == 403
    assert send(client, original).status_code == 403
    assert counts(sessions) == before


@pytest.mark.parametrize("fault", ["missing_order", "non_boolean_stop"])
def test_invalid_event_binding_has_unavailable_scope_instead_of_project_only_read_access(env, fault):
    from sop_manager.routers import events_ingest
    from sop_manager.routers.auth_sql import current_user, current_user_or_apikey
    from test_event_handoff import frozen, send, version

    client, sessions, _actor = env
    client.app.include_router(events_ingest.router)
    client.app.dependency_overrides[current_user_or_apikey] = client.app.dependency_overrides[current_user]
    task = make_task(client)
    order = held(client, task["id"])
    payload = report(client, task["id"], work_order=binding(order))
    if fault == "missing_order":
        payload["work_order"]["id"] = "missing-exact-order"
    else:
        payload["work_order"]["stopped_attestation"] = 1
    original = frozen("guided-unavailable-binding", "sop.task.delivery_submitted", {
        "expected_version": version(sessions), "report": payload}, task["id"])
    assert send(client, original).status_code == 403
    with sessions() as db:
        row = db.scalar(select(models.EventProcessing))
        assert row.plan == {"kind": "task-delivery-scope.v1", "unavailable": True}
        assert db.scalar(select(Submission)) is None
    assert detail(client, order["id"])["work_order"]["state"] == "claimed"
