"""Fixed returned-report feedback reaches the real W/E consumers; execution deferred."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json

import pytest
from fastapi import HTTPException
from hermes_core.transactional import digest
from sqlalchemy import select, update

from sop_manager.routers import sql_models as models
from sop_manager.routers.delivery_execution_handoff_model import DeliveryExecutionHandoff
from sop_manager.routers.delivery_task_submission_model import DeliveryTaskSubmissionDecision
from test_delivery_execution import bridge as execution_bridge, cancel_execution, queue, queue_payload
from test_delivery_manual_review import make_task
from test_delivery_task_submissions import counts, decide, detail as submission_detail, report, revoke_runtime_membership, submit
from test_delivery_workbench import command, env as delivery_env
from test_external_work_orders import current as work_current, detail as work_detail

env = delivery_env
bridge = execution_bridge


def returned_feedback(client, task, *, payload=None):
    submitted, _body = submit(client, task["id"], payload=payload)
    sid = submitted["result"]["submission_id"]
    rejected, _request = decide(client, task["id"], sid, decision="request_changes")
    assert rejected.status_code == 200, rejected.text
    original = submission_detail(client, task["id"], sid).json()
    reference = {"submission_id": sid, "submission_digest": submitted["result"]["submission_digest"],
        "decision_id": original["decision"]["id"]}
    return reference, original


def work_preview(client, task_id, reference):
    saved = command(client, "member.save", {"name": "External feedback tool", "kind": "tool",
        "role": "developer", "tool": "workbuddy", "active": True})
    assert saved.status_code == 200, saved.text
    executor = saved.json()["members"][-1]
    current = work_current(client, task_id)
    body = {"task_basis": current["task_basis"], "executor_member_id": executor["id"],
        "instructions": "Address the selected returned delivery feedback.", "feedback_reference": reference}
    preview = client.post(f"/api/v1/delivery/tasks/{task_id}/work-order-preview", json=body)
    return preview, body


def create_from_preview(client, task_id, preview, proposal):
    assert preview.status_code == 200 and preview.json()["allowed"], preview.text
    view = preview.json()
    body = {"action": "work_order.create", "expected_version": view["version"], "idempotency_key": "fixed-feedback-work-order",
        "payload": {**proposal, "task_id": task_id, "definition_digest": view["definition_digest"],
            "native_boundary_digest": view["native_boundary_digest"], "preview_basis": view["preview_basis"]}}
    return client.post("/api/v1/delivery/commands", json=body), body


def assert_context(view, reference, original, task_id):
    context = view["feedback_context"]
    assert set(context) == {"schema", "project_id", "task_id", "reference", "submission", "decision"}
    assert context["schema"] == "manager.delivery-feedback.v1" and context["project_id"] == "project"
    assert context["task_id"] == task_id and context["reference"] == reference
    assert context["submission"] == {"definition": original["definition"], "payload": original["payload"]}
    assert context["decision"] == {"decision": "request_changes", "review_id": original["decision"]["review_id"],
        "comment": original["decision"]["comment"], "reviewer": original["decision"]["reviewer"],
        "created_at": original["decision"]["created_at"], "issue_id": original["submission"]["issue_id"]}
    assert digest(context) == view["feedback_context_sha256"]
    return deepcopy(context)


def persisted_state(sessions):
    table_counts = counts(sessions)
    with sessions() as db:
        workspace = db.get(models.DeliveryWorkspace, "project")
        index = db.get(models.DeliveryQueryState, ("tenant", "project"))
        return table_counts, workspace.version, deepcopy(workspace.data), index.generation, index.source_version, index.schema_version


def test_returned_report_is_fixed_in_work_preview_packet_exact_detail_and_same_key_replay(env, monkeypatch):
    from sop_manager.routers import delivery_feedback_service

    client, sessions, _actor = env
    task = make_task(client)
    reference, original = returned_feedback(client, task)
    preview, proposal = work_preview(client, task["id"], reference)
    assert preview.status_code == 200, preview.text
    fixed = assert_context(preview.json(), reference, original, task["id"])
    created, body = create_from_preview(client, task["id"], preview, proposal)
    assert created.status_code == 200, created.text
    wid = created.json()["result"]["work_order_id"]
    exact = work_detail(client, wid)
    assert assert_context(exact, reference, original, task["id"]) == fixed
    before = counts(sessions)

    def live_source_unavailable(*_args, **_kwargs):
        raise HTTPException(503, "The live feedback source is temporarily unavailable")

    monkeypatch.setattr(delivery_feedback_service, "freeze_feedback", live_source_unavailable)
    packet = client.get(f"/api/v1/delivery/work-orders/{wid}/packet")
    assert packet.status_code == 200, packet.text
    assert assert_context(packet.json()["packet"], reference, original, task["id"]) == fixed
    replayed = client.post("/api/v1/delivery/commands", json=body)
    assert replayed.status_code == 200 and replayed.json()["replayed"], replayed.text
    assert replayed.json()["result"] == created.json()["result"]
    assert counts(sessions) == before
    with sessions() as db:
        issue = db.get(models.Issue, original["submission"]["issue_id"])
        assert issue.status == "open" and db.get(models.Task, task["id"]).status != "completed"
        assert db.scalar(select(models.DeliveryTaskReview)).decision == "request_changes"


def test_invalidated_report_is_explicit_history_not_current_task_definition_or_acceptance(env):
    client, sessions, _actor = env
    task = make_task(client)
    reference, old = returned_feedback(client, task)
    workspace = client.get("/api/v1/delivery/workspace").json()
    current = next(row for row in workspace["tasks"] if row["id"] == task["id"])
    changed = command(client, "task.update", {"id": task["id"], "title": "Current scope differs from old returned work", "task_basis": current["basis"]})
    assert changed.status_code == 200, changed.text
    assert submission_detail(client, task["id"], reference["submission_id"]).json()["submission"]["invalidated"]
    preview, proposal = work_preview(client, task["id"], reference)
    assert preview.status_code == 200 and preview.json()["allowed"], preview.text
    assert_context(preview.json(), reference, old, task["id"])
    assert preview.json()["definition"]["title"] == "Current scope differs from old returned work"
    assert preview.json()["feedback_context"]["submission"]["definition"]["title"] == task["title"]
    created, _body = create_from_preview(client, task["id"], preview, proposal)
    assert created.status_code == 200, created.text
    quality = client.get("/api/v1/delivery/quality", params={"requirement_ids": task["req_id"]})
    assert quality.status_code == 200, quality.text
    assert not next(row for row in quality.json()["tasks"] if row["id"] == task["id"])["verified"]
    with sessions() as db:
        assert db.get(models.Issue, old["submission"]["issue_id"]).status == "open"


@pytest.mark.parametrize("mutation", ["wrong_digest", "wrong_decision", "wrong_task", "extra_field", "numeric_id"])
def test_feedback_reference_never_silently_selects_latest_or_crosses_scope(env, mutation):
    client, sessions, _actor = env
    task = make_task(client)
    reference, _original = returned_feedback(client, task)
    selected_task = task["id"]
    if mutation == "wrong_digest": reference = {**reference, "submission_digest": "0" * 64}
    elif mutation == "wrong_decision": reference = {**reference, "decision_id": "missing-decision"}
    elif mutation == "wrong_task": selected_task = make_task(client)["id"]
    elif mutation == "extra_field": reference = {**reference, "latest": True}
    else: reference = {**reference, "submission_id": 1}
    preview, proposal = work_preview(client, selected_task, reference)
    before = counts(sessions)
    assert preview.status_code in {200, 404, 409, 422}, preview.text
    assert preview.status_code != 200 or not preview.json()["allowed"]
    current = work_current(client, selected_task)
    denied = command(client, "work_order.create", {**proposal, "task_id": selected_task,
        "definition_digest": current["definition_digest"], "native_boundary_digest": current["native_boundary_digest"], "preview_basis": "0" * 64})
    assert denied.status_code in {404, 409, 422}, denied.text
    assert counts(sessions) == before


def test_accept_decision_cannot_be_relabelled_as_returned_feedback(env):
    client, sessions, _actor = env
    task = make_task(client)
    submitted, _body = submit(client, task["id"])
    sid = submitted["result"]["submission_id"]
    accepted, _request = decide(client, task["id"], sid)
    assert accepted.status_code == 200, accepted.text
    exact = submission_detail(client, task["id"], sid).json()
    assert command(client, "task.update", {"id": task["id"], "status": "in_progress"}).status_code == 200
    reference = {"submission_id": sid, "submission_digest": exact["submission"]["digest"], "decision_id": exact["decision"]["id"]}
    preview, _proposal = work_preview(client, task["id"], reference)
    assert preview.status_code == 200 and not preview.json()["allowed"], preview.text
    assert any(reason["code"] == "feedback_reference_invalid" for reason in preview.json()["reasons"])


def test_real_execution_preview_handoff_and_runtime_envelope_keep_fixed_feedback_out_of_task_basis(bridge, monkeypatch):
    from sop_manager.routers import delivery_feedback_service
    from sop_manager.routers.delivery_execution_handoff import _validate_original

    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    reference, original = returned_feedback(client, task)
    payload = {**queue_payload(bridge), "feedback_reference": reference}
    preview = client.post("/api/v1/delivery/execution-preview", json=payload)
    assert preview.status_code == 200, preview.text
    fixed = assert_context(preview.json(), reference, original, task["id"])
    unselected = client.post("/api/v1/delivery/execution-preview", json={key: value for key, value in payload.items() if key != "feedback_reference"})
    assert unselected.status_code == 200, unselected.text
    assert preview.json()["task_basis"] == unselected.json()["task_basis"]
    assert preview.json()["snapshot"] == unselected.json()["snapshot"] and preview.json()["plan_basis"] != unselected.json()["plan_basis"]
    body = {"action": "execution.queue", "payload": payload, "expected_version": preview.json()["version"], "idempotency_key": "fixed-feedback-native-plan"}
    queued = client.post("/api/v1/delivery/commands", json=body)
    assert queued.status_code == 200, queued.text
    eid = queued.json()["resource"]["id"]
    with sessions() as db:
        row = db.scalar(select(DeliveryExecutionHandoff).where(DeliveryExecutionHandoff.execution_id == eid))
        assert row.original["feedback_context"] == fixed
        envelope = _validate_original(row)["envelope"]
        assert_context(envelope, reference, original, task["id"])
        assert envelope["source"]["feedback_reference"] == reference
        data = db.get(models.DeliveryWorkspace, "project").data
        entry = next(item for item in data["executions"] if item["id"] == eid)
        assert "feedback_context" not in entry and entry["feedback_reference"] == reference
        assert entry["feedback_context_sha256"] == digest(fixed)
    before = counts(sessions)
    monkeypatch.setattr(delivery_feedback_service, "freeze_feedback", lambda *_args, **_kwargs: (_ for _ in ()).throw(HTTPException(503, "Current source unavailable")))
    replayed = client.post("/api/v1/delivery/commands", json=body)
    assert replayed.status_code == 200 and replayed.json()["replayed"], replayed.text
    assert counts(sessions) == before


@pytest.mark.parametrize("kind", ["work_order", "execution"])
def test_complete_feedback_budget_rejects_without_truncation_or_business_writes(bridge, kind):
    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    workspace = client.get("/api/v1/delivery/workspace").json()
    row = next(item for item in workspace["tasks"] if item["id"] == task["id"])
    changed = command(client, "task.update", {"id": task["id"], "task_basis": row["basis"],
        "acceptance_criteria": [f"Condition {index}: " + "x" * 1490 for index in range(40)]})
    assert changed.status_code == 200, changed.text
    reference, _original = returned_feedback(client, task)
    if kind == "work_order":
        preview, proposal = work_preview(client, task["id"], reference)
        assert preview.status_code == 200 and not preview.json()["allowed"], preview.text
        assert any(reason["code"] == "feedback_context_budget" for reason in preview.json()["reasons"])
        source = work_current(client, task["id"])
        body = {"action": "work_order.create", "payload": {**proposal, "task_id": task["id"],
            "definition_digest": source["definition_digest"], "native_boundary_digest": source["native_boundary_digest"], "preview_basis": "0" * 64}}
    else:
        payload = {**queue_payload(bridge), "feedback_reference": reference}
        preview = client.post("/api/v1/delivery/execution-preview", json=payload)
        assert preview.status_code == 413 and preview.json()["detail"]["code"] == "feedback_context_budget", preview.text
        body = {"action": "execution.queue", "payload": payload}
    body.update(expected_version=client.get("/api/v1/delivery/workspace").json()["version"], idempotency_key="oversized-feedback-original")
    before = persisted_state(sessions)
    rejected = client.post("/api/v1/delivery/commands", json=body)
    assert rejected.status_code == 413 and rejected.json()["detail"]["code"] == "feedback_context_budget", rejected.text
    assert persisted_state(sessions) == before


def test_fixed_feedback_also_obeys_the_complete_external_packet_budget(env):
    client, sessions, _actor = env
    task = make_task(client)
    payload = report(client, task["id"])
    payload["artifacts"] = [{"id": f"evidence-{index}", "title": "Complete original reported evidence",
        "content": "a" * 7900, "url": "", "sha256": None} for index in range(5)]
    for item in [*payload["criteria"], *payload["tests"]]: item["evidence_ids"] = ["evidence-0"]
    reference, _original = returned_feedback(client, task, payload=payload)
    for index in range(40):
        saved = command(client, "resource.save", {"kind": "repository", "title": f"Repository {index}",
            "description": "界" * 4000, "url": f"https://example.org/repository-{index}", "ref": "main"})
        assert saved.status_code == 200, saved.text
    ordinary, proposal = work_preview(client, task["id"], None)
    assert ordinary.status_code == 200 and ordinary.json()["allowed"], ordinary.text
    proposal["feedback_reference"] = reference
    before = persisted_state(sessions)
    selected = client.post(f"/api/v1/delivery/tasks/{task['id']}/work-order-preview", json=proposal)
    assert selected.status_code == 200 and not selected.json()["allowed"], selected.text
    assert any(reason["code"] == "work_order_packet_budget" for reason in selected.json()["reasons"])
    current = work_current(client, task["id"])
    rejected = client.post("/api/v1/delivery/commands", json={"action": "work_order.create", "expected_version": current["version"],
        "idempotency_key": "fixed-feedback-packet-budget", "payload": {**proposal, "task_id": task["id"],
            "definition_digest": current["definition_digest"], "native_boundary_digest": current["native_boundary_digest"], "preview_basis": "0" * 64}})
    assert rejected.status_code == 413 and rejected.json()["detail"]["code"] == "work_order_packet_budget", rejected.text
    assert persisted_state(sessions) == before


@pytest.mark.parametrize("kind", ["work_order", "execution"])
def test_feedback_dispatch_rollback_restores_version_query_receipt_event_and_originals(bridge, monkeypatch, kind):
    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    reference, _original = returned_feedback(client, task)
    if kind == "work_order":
        from sop_manager.routers import delivery_external_work_order_service as service

        preview, proposal = work_preview(client, task["id"], reference)
        view = preview.json()
        body = {"action": "work_order.create", "payload": {**proposal, "task_id": task["id"],
            "definition_digest": view["definition_digest"], "native_boundary_digest": view["native_boundary_digest"], "preview_basis": view["preview_basis"]}}
        name = "apply_work_order"
    else:
        from sop_manager.routers import delivery_execution_handoff as service

        body = {"action": "execution.queue", "payload": {**queue_payload(bridge), "feedback_reference": reference}}
        name = "accept_handoff"
    body.update(expected_version=client.get("/api/v1/delivery/workspace").json()["version"], idempotency_key="feedback-rollback-original")
    before = persisted_state(sessions)
    actual = getattr(service, name)

    def lose_commit(*args, **kwargs):
        actual(*args, **kwargs)
        raise HTTPException(503, "Injected failure after the fixed feedback original was flushed")

    monkeypatch.setattr(service, name, lose_commit)
    rejected = client.post("/api/v1/delivery/commands", json=body)
    assert rejected.status_code == 503, rejected.text
    assert persisted_state(sessions) == before


@pytest.mark.parametrize("project_id", ["other", "foreign-project"])
def test_feedback_is_not_read_through_another_project_or_tenant(env, project_id):
    client, sessions, _actor = env
    task = make_task(client)
    reference, _original = returned_feedback(client, task)
    preview, proposal = work_preview(client, task["id"], reference)
    assert preview.status_code == 200 and preview.json()["allowed"], preview.text
    if project_id == "foreign-project":
        with sessions() as db:
            db.add(models.Tenant(id="foreign-tenant", name="Foreign tenant", slug="foreign-tenant"))
            db.flush()
            db.add(models.Project(id="foreign-project", tenant_id="foreign-tenant", name="Foreign project"))
            db.commit()
    before = persisted_state(sessions)
    rejected = client.post(f"/api/v1/delivery/tasks/{task['id']}/work-order-preview", json=proposal,
        headers={"X-Project-Id": project_id})
    assert rejected.status_code in {403, 404}, rejected.text
    assert "feedback_context" not in rejected.json() and persisted_state(sessions) == before


@pytest.mark.parametrize("planned", [False, True])
@pytest.mark.parametrize("damage", ["remove_scopes", "replace_scopes"])
def test_damaged_handoff_and_entry_scopes_fail_closed_in_actual_recovery_and_launch_views(bridge, planned, damage):
    from sop_manager.routers.delivery_execution_handoff import handoff_once

    client, sessions, store, principal, workspace, _rid, task = bridge
    reference, _original = returned_feedback(client, task)
    body = {"action": "execution.queue", "payload": {**queue_payload(bridge), "feedback_reference": reference},
        "expected_version": client.get("/api/v1/delivery/workspace").json()["version"], "idempotency_key": "feedback-scope-integrity"}
    queued = client.post("/api/v1/delivery/commands", json=body)
    assert queued.status_code == 200, queued.text
    eid = queued.json()["resource"]["id"]
    if planned:
        assert handoff_once(client.app, sessions) == 1
    with sessions() as db:
        row = db.scalar(select(DeliveryExecutionHandoff).where(DeliveryExecutionHandoff.execution_id == eid))
        hid, original = row.id, deepcopy(row.original)
        data = deepcopy(db.get(models.DeliveryWorkspace, "project").data)
    entry = next(item for item in data["executions"] if item["id"] == eid)
    for value in (original, entry):
        if damage == "remove_scopes": value.pop("feedback_runtime_scopes")
        else: value["feedback_runtime_scopes"] = ["a-different-runtime-scope"]
    # Deliberate storage damage bypasses service guards; the old H digest is retained.
    with sessions.kw["bind"].begin() as conn:
        conn.execute(update(DeliveryExecutionHandoff).where(DeliveryExecutionHandoff.id == hid).values(original=original))
        conn.execute(update(models.DeliveryWorkspace).where(models.DeliveryWorkspace.project_id == "project").values(data=data))
    before = persisted_state(sessions)
    runtime = client.get(f"/api/v1/delivery/executions/{eid}/runtime")
    if planned:
        assert runtime.status_code == 200 and not runtime.json()["controls"]["start"]["allowed"], runtime.text
    else:
        assert runtime.status_code == 409, runtime.text
        assert store.list(principal, workspace["id"], "runs") == []
    assert persisted_state(sessions) == before


@pytest.mark.parametrize("field", ["decision_comment", "review_comment", "reviewer"])
def test_returned_decision_and_linked_review_originals_must_agree_before_dispatch(env, field):
    client, sessions, _actor = env
    task = make_task(client)
    reference, original = returned_feedback(client, task)
    with sessions.kw["bind"].begin() as conn:
        if field == "decision_comment":
            conn.execute(update(DeliveryTaskSubmissionDecision).where(DeliveryTaskSubmissionDecision.id == reference["decision_id"]).values(comment="A mismatched stored decision"))
        elif field == "review_comment":
            conn.execute(update(models.DeliveryTaskReview).where(models.DeliveryTaskReview.id == original["decision"]["review_id"]).values(comment="A mismatched stored review"))
        else:
            conn.execute(update(models.DeliveryTaskReview).where(models.DeliveryTaskReview.id == original["decision"]["review_id"]).values(reviewer_id="reader"))
    preview, _proposal = work_preview(client, task["id"], reference)
    assert preview.status_code == 200 and not preview.json()["allowed"], preview.text
    assert any(reason["code"] == "feedback_original_invalid" for reason in preview.json()["reasons"])


@pytest.mark.parametrize("kind", ["work_order", "execution"])
@pytest.mark.parametrize("malformed", ["surrogate", "nonfinite", "depth"])
def test_malformed_feedback_reference_returns_safe_422_in_real_preview_routes(bridge, kind, malformed):
    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    reference, _original = returned_feedback(client, task)
    if malformed == "surrogate": reference = {**reference, "submission_id": "bad\ud800"}
    elif malformed == "nonfinite": reference = {**reference, "submission_id": float("nan")}
    else:
        nested = "unwanted"
        for _index in range(12): nested = [nested]
        reference = {**reference, "unexpected": nested}
    if kind == "work_order":
        _valid, payload = work_preview(client, task["id"], None)
        payload["feedback_reference"] = reference
        url = f"/api/v1/delivery/tasks/{task['id']}/work-order-preview"
    else:
        payload, url = {**queue_payload(bridge), "feedback_reference": reference}, "/api/v1/delivery/execution-preview"
    before = persisted_state(sessions)
    rejected = client.post(url, content=json.dumps(payload, ensure_ascii=True), headers={"Content-Type": "application/json"})
    assert rejected.status_code == 422, rejected.text
    assert persisted_state(sessions) == before


def scoped_feedback(bridge):
    intent = queue(bridge)
    stopped = cancel_execution(bridge[0], intent["id"])
    assert stopped.status_code == 200, stopped.text
    return returned_feedback(bridge[0], bridge[6])


def test_work_feedback_packet_detail_claim_and_receipt_recheck_real_revoked_source_scope(bridge):
    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    reference, original = scoped_feedback(bridge)
    preview, proposal = work_preview(client, task["id"], reference)
    created, body = create_from_preview(client, task["id"], preview, proposal)
    assert created.status_code == 200, created.text
    wid = created.json()["result"]["work_order_id"]
    before = work_detail(client, wid)
    assert_context(before, reference, original, task["id"])
    claim_body = {"action": "work_order.claim", "payload": {"id": wid, "order_revision": before["work_order"]["order_revision"]},
        "expected_version": before["version"], "idempotency_key": "revoked-feedback-claim"}
    revoke_runtime_membership(bridge)
    stored = persisted_state(sessions)
    for url in (f"/api/v1/delivery/work-orders/{wid}", f"/api/v1/delivery/work-orders/{wid}/packet", "/api/v1/delivery/work-orders"):
        assert client.get(url).status_code == 403
    assert client.post("/api/v1/delivery/commands", json=claim_body).status_code == 403
    assert client.post("/api/v1/delivery/commands", json=body).status_code == 403
    assert persisted_state(sessions) == stored


@pytest.mark.parametrize("core_committed", [False, True])
def test_execution_feedback_revocation_blocks_new_handoff_but_can_recover_only_the_existing_core_receipt(bridge, monkeypatch, core_committed):
    from sop_manager.routers import delivery_execution_handoff as handoffs

    client, sessions, store, principal, workspace, _rid, task = bridge
    reference, original = scoped_feedback(bridge)
    body = {"action": "execution.queue", "payload": {**queue_payload(bridge), "feedback_reference": reference},
        "expected_version": client.get("/api/v1/delivery/workspace").json()["version"], "idempotency_key": "revoked-feedback-native"}
    queued = client.post("/api/v1/delivery/commands", json=body)
    assert queued.status_code == 200, queued.text
    eid = queued.json()["resource"]["id"]
    if core_committed:
        actual = handoffs.project_handoff
        monkeypatch.setattr(handoffs, "project_handoff", lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("Lost Manager projection after Core commit")))
        assert handoffs.handoff_once(client.app, sessions) == 0
        assert len(store.list(principal, workspace["id"], "runs")) == 1
        monkeypatch.setattr(handoffs, "project_handoff", actual)
    revoke_runtime_membership(bridge)
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 403, replay.text
    handoffs.handoff_once(client.app, sessions, now=datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(days=1))
    with sessions() as db:
        row = db.scalar(select(DeliveryExecutionHandoff).where(DeliveryExecutionHandoff.execution_id == eid))
        assert row.state == ("planned" if core_committed else "blocked")
        assert_context(row.original, reference, original, task["id"])
    runs = store.list(principal, workspace["id"], "runs")
    assert len(runs) == (1 if core_committed else 0)
    assert all(run["status"] == "planned" and not run["data"].get("execution_owner") for run in runs)


def test_execution_feedback_permission_is_rechecked_at_actual_delayed_launch_claim(bridge, monkeypatch):
    from sop_manager.routers import delivery_execution_control_operation_service as controls, delivery_execution_schedule
    from sop_manager.routers.delivery_execution_handoff import handoff_once

    client, sessions, store, principal, workspace, _rid, task = bridge
    reference, _original = scoped_feedback(bridge)
    queued = command(client, "execution.queue", {**queue_payload(bridge), "feedback_reference": reference})
    assert queued.status_code == 200, queued.text
    eid = queued.json()["resource"]["id"]
    assert handoff_once(client.app, sessions) == 1
    preview = client.post("/api/v1/delivery/execution-control-preview", json={"id": eid,
        "action": "execution.start", "reason": "Review current fixed returned feedback and start"})
    assert preview.status_code == 200 and preview.json()["allowed"], preview.text
    view = preview.json()
    started = client.post("/api/v1/delivery/commands", json={"action": "execution.start", "payload": view["payload"],
        "expected_version": view["version"], "idempotency_key": "feedback-delayed-launch"})
    assert started.status_code == 200, started.text
    monkeypatch.setattr(delivery_execution_schedule, "submit_control_launch", lambda *_args, **_kwargs: False)
    assert controls.control_once(client.app, sessions) == 1
    run = store.list(principal, workspace["id"], "runs")[0]
    assert run["status"] == "queued" and run["data"].get("managed_activation_id")
    revoke_runtime_membership(bridge)
    with pytest.raises(HTTPException) as rejected:
        client.app.state.hermes_execution.execute(principal, workspace["id"], run["id"],
            expected_attempt=run["data"].get("attempt", 1), launch_id=run["data"]["managed_activation_id"])
    assert rejected.value.status_code == 403
    after = store.get(principal, workspace["id"], "runs", run["id"])
    assert after["status"] == "queued" and not after["data"].get("execution_owner")
