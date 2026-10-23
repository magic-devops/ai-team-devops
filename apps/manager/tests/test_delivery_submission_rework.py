"""Real rework HTTP, immutable lineage and authorization definitions; not run."""
from copy import deepcopy

import pytest
from fastapi import HTTPException
from hermes_core.transactional import digest
from sqlalchemy import select, update

from sop_manager.routers.delivery_task_submission_model import DeliveryTaskSubmission as Submission
from test_delivery_execution import bridge as execution_bridge
from test_delivery_feedback_workflow import persisted_state, returned_feedback, scoped_feedback, work_preview
from test_delivery_manual_review import make_task
from test_delivery_task_submissions import decide, detail, history, report, request, revoke_runtime_membership, submit
from test_delivery_workbench import command, env as delivery_env

env = delivery_env
bridge = execution_bridge


def preview(client, task_id, reference):
    return client.post(f"/api/v1/delivery/tasks/{task_id}/delivery-submissions/rework-preview",
        json={"rework_reference": reference})


def prepared(client, task_id, reference):
    response = preview(client, task_id, reference)
    assert response.status_code == 200 and response.json()["allowed"], response.text
    view = response.json()
    payload = report(client, task_id, rework_reference=reference, rework_basis=view["rework_basis"])
    return view, payload


def test_preview_is_read_only_full_authorized_history_and_resets_current_acceptance(env):
    client, sessions, _actor = env
    task = make_task(client)
    reference, original = returned_feedback(client, task)
    workspace = client.get("/api/v1/delivery/workspace").json()
    current = next(row for row in workspace["tasks"] if row["id"] == task["id"])
    changed = command(client, "task.update", {"id": task["id"], "title": "Current rework definition",
        "acceptance_criteria": ["Verify the revised behavior"], "task_basis": current["basis"]})
    assert changed.status_code == 200, changed.text
    before = persisted_state(sessions)
    first = preview(client, task["id"], reference)
    second = preview(client, task["id"], reference)
    assert first.status_code == second.status_code == 200, first.text
    view = first.json()
    assert view["allowed"] and view["rework_basis"] == second.json()["rework_basis"]
    assert view["project_id"] == "project" and view["task_id"] == task["id"]
    assert view["rework_reference"] == reference
    assert view["feedback_context"]["submission"] == {"payload": original["payload"], "definition": original["definition"]}
    assert digest(view["feedback_context"]) == view["feedback_context_sha256"]
    assert view["current"]["definition"]["title"] == "Current rework definition"
    seed = view["draft"]
    assert set(seed) == {"source", "summary", "artifacts", "criteria", "tests"} and seed["source"] is None
    assert seed["summary"] == original["payload"]["summary"] and seed["artifacts"] == original["payload"]["artifacts"]
    assert seed["criteria"] == [{**{key: item[key] for key in ("source", "index", "text_digest")},
        "result": "unknown", "evidence_ids": []} for item in sorted(view["current"]["criteria"], key=lambda item: (item["source"], item["index"]))]
    assert seed["tests"] == [{"id": item["id"], "title": item["title"], "status": "not_run", "evidence_ids": []}
        for item in original["payload"]["tests"]]
    assert persisted_state(sessions) == before


def test_selected_rework_saves_full_lineage_strict_ack_and_replays_without_live_preview(env, monkeypatch):
    from sop_manager.routers import delivery_feedback_service

    client, sessions, _actor = env
    task = make_task(client)
    reference, _old = returned_feedback(client, task)
    view, payload = prepared(client, task["id"], reference)
    accepted, body = submit(client, task["id"], payload=payload, key="selected-rework")
    sid = accepted["result"]["submission_id"]
    assert accepted["result"]["rework_reference"] == reference
    assert accepted["result"]["rework_basis"] == view["rework_basis"]
    source = detail(client, task["id"], sid).json()
    fixed = source["rework"]
    assert fixed == {"schema": "manager.submission-rework.v1", "reference": reference, "basis": view["rework_basis"],
        "feedback_context": view["feedback_context"], "feedback_context_sha256": view["feedback_context_sha256"],
        "feedback_runtime_scopes": [], "target_work_order": None}
    with sessions() as db:
        row = db.scalar(select(Submission).where(Submission.id == sid))
        assert row.original["rework"] == fixed and row.submission_digest == digest(row.original)
        assert row.payload["rework_reference"] == reference
    before = persisted_state(sessions)
    monkeypatch.setattr(delivery_feedback_service, "freeze_feedback", lambda *_a, **_k: (_ for _ in ()).throw(HTTPException(503, "Live source down")))
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 200 and replay.json()["replayed"], replay.text
    assert replay.json()["result"] == accepted["result"]
    assert detail(client, task["id"], sid).json()["rework"] == fixed
    assert persisted_state(sessions) == before


def test_ordinary_original_and_receipt_are_not_rewritten_with_optional_lineage(env):
    client, sessions, _actor = env
    task = make_task(client)
    accepted, body = submit(client, task["id"])
    sid = accepted["result"]["submission_id"]
    assert not {"rework_reference", "rework_basis"}.intersection(accepted["result"])
    with sessions() as db:
        row = db.scalar(select(Submission).where(Submission.id == sid))
        assert "rework" not in row.original
        assert not {"rework_reference", "rework_basis"}.intersection(row.payload)
    response = client.post("/api/v1/delivery/commands", json=body)
    assert response.status_code == 200 and response.json()["replayed"]
    assert response.json()["result"] == accepted["result"]


def test_reused_material_is_not_a_new_pass_or_acceptance_until_explicit_new_evidence(env):
    client, sessions, _actor = env
    task = make_task(client)
    reference, _old = returned_feedback(client, task)
    view, _authored = prepared(client, task["id"], reference)
    payload = {**view["draft"], "task_id": task["id"],
        **{key: view["current"][key] for key in ("task_basis", "definition_digest", "native_boundary_digest")},
        "source": {"kind": "human", "name": "Current rework author", "url": ""},
        "rework_reference": reference, "rework_basis": view["rework_basis"]}
    ack, _original = submit(client, task["id"], payload=payload, key="rework-material-only")
    sid = ack["result"]["submission_id"]
    candidate = detail(client, task["id"], sid).json()
    assert not candidate["permissions"]["can_accept"]
    rejected, _body = decide(client, task["id"], sid, key="rework-no-new-pass")
    assert rejected.status_code == 409, rejected.text
    assert detail(client, task["id"], sid).json()["decision"] is None


@pytest.mark.parametrize("damage", ["missing_reference", "missing_basis", "wrong_basis", "wrong_digest", "accepted_decision"])
def test_selected_source_is_paired_exact_and_rechecked_in_actual_command(env, damage):
    client, sessions, _actor = env
    task = make_task(client)
    reference, _old = returned_feedback(client, task)
    view, payload = prepared(client, task["id"], reference)
    if damage == "missing_reference": payload.pop("rework_reference")
    elif damage == "missing_basis": payload.pop("rework_basis")
    elif damage == "wrong_basis": payload["rework_basis"] = "0" * 64
    elif damage == "wrong_digest": payload["rework_reference"] = {**reference, "submission_digest": "0" * 64}
    else:
        accepted, _ = submit(client, task["id"], key="unrelated-accepted-source")
        decision, _ = decide(client, task["id"], accepted["result"]["submission_id"], key="unrelated-source-decision")
        assert decision.status_code == 200, decision.text
        payload["rework_reference"] = {**reference, "decision_id": decision.json()["result"]["decision_id"]}
    before = persisted_state(sessions)
    response = client.post("/api/v1/delivery/commands", json=request(client, "task.delivery.submit", payload, key="invalid-rework"))
    assert response.status_code in {409, 422}, response.text
    assert persisted_state(sessions) == before


def test_current_definition_change_requires_new_explicit_preview_basis(env):
    client, sessions, _actor = env
    task = make_task(client)
    reference, _old = returned_feedback(client, task)
    _view, payload = prepared(client, task["id"], reference)
    assert command(client, "task.update", {"id": task["id"], "description": "Changed after adopting the rework seed"}).status_code == 200
    # Even replacing the ordinary bases with fresh ones cannot adopt a stale seed implicitly.
    changed = report(client, task["id"], rework_reference=reference, rework_basis=payload["rework_basis"])
    before = persisted_state(sessions)
    response = client.post("/api/v1/delivery/commands", json=request(client, "task.delivery.submit", changed, key="stale-rework-seed"))
    assert response.status_code == 409 and response.json()["detail"]["code"] == "submission_rework_basis_changed", response.text
    assert persisted_state(sessions) == before


def test_rework_source_runtime_scope_is_retained_for_all_reads_replay_and_followup_feedback(bridge):
    client, sessions, _store, _principal, workspace, _rid, task = bridge
    reference, _old = scoped_feedback(bridge)
    _view, payload = prepared(client, task["id"], reference)
    ack, original = submit(client, task["id"], payload=payload, key="scoped-rework")
    sid = ack["result"]["submission_id"]
    rejected, _ = decide(client, task["id"], sid, decision="request_changes", key="scoped-rework-decision")
    assert rejected.status_code == 200, rejected.text
    exact = detail(client, task["id"], sid).json()
    assert workspace["id"] in exact["rework"]["feedback_runtime_scopes"]
    next_reference = {"submission_id": sid, "submission_digest": ack["result"]["submission_digest"], "decision_id": exact["decision"]["id"]}
    next_view = preview(client, task["id"], next_reference)
    assert next_view.status_code == 200 and next_view.json()["allowed"], next_view.text
    revoke_runtime_membership(bridge)
    before = persisted_state(sessions)
    for response in (detail(client, task["id"], sid), history(client, task["id"]),
            client.get(f"/api/v1/delivery/delivery-submissions/{sid}/locator"),
            client.post("/api/v1/delivery/commands", json=original), preview(client, task["id"], next_reference)):
        assert response.status_code == 403, response.text
    assert persisted_state(sessions) == before


@pytest.mark.parametrize("damage", ["remove_lineage", "remove_scopes", "ordinary_lineage"])
def test_damaged_lineage_cannot_be_silently_treated_as_ordinary_report(env, damage):
    client, sessions, _actor = env
    task = make_task(client)
    reference, _old = returned_feedback(client, task)
    _view, payload = prepared(client, task["id"], reference)
    ack, _body = submit(client, task["id"], payload=payload, key="lineage-integrity")
    sid = ack["result"]["submission_id"]
    with sessions() as db:
        row = db.scalar(select(Submission).where(Submission.id == sid))
        original, wire = deepcopy(row.original), deepcopy(row.payload)
    if damage == "remove_lineage": original.pop("rework")
    elif damage == "remove_scopes": original["rework"].pop("feedback_runtime_scopes")
    else:
        wire.pop("rework_reference")
        wire.pop("rework_basis")
        original["payload"] = wire
    # Deliberate storage damage keeps the old digest and bypasses normal write guards.
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(Submission).where(Submission.id == sid).values(original=original, payload=wire))
    assert detail(client, task["id"], sid).status_code == 409
    assert history(client, task["id"]).status_code == 409


def test_rework_preview_exposes_denied_current_state_without_inventing_new_acceptance(env):
    client, sessions, _actor = env
    task = make_task(client)
    reference, _old = returned_feedback(client, task)
    assert command(client, "task.update", {"id": task["id"], "acceptance_criteria": [], "requirement_criteria_indices": []}).status_code == 200
    before = persisted_state(sessions)
    response = preview(client, task["id"], reference)
    assert response.status_code == 200, response.text
    view = response.json()
    assert not view["allowed"] and not view["current"]["can_submit"] and view["reasons"] == view["current"]["reasons"]
    assert view["draft"]["criteria"] == [] and view["feedback_context"]["reference"] == reference
    assert len(view["rework_basis"]) == 64 and persisted_state(sessions) == before


@pytest.mark.parametrize("fault", ["wrong_digest", "missing_decision", "wrong_task", "other_project", "malformed"])
def test_rework_preview_never_substitutes_missing_invalid_or_foreign_sources(env, fault):
    client, sessions, _actor = env
    task = make_task(client)
    reference, _old = returned_feedback(client, task)
    selected_task, headers = task["id"], {}
    if fault == "wrong_digest": reference["submission_digest"] = "0" * 64
    elif fault == "missing_decision": reference["decision_id"] = "missing-human-decision"
    elif fault == "wrong_task": selected_task = make_task(client)["id"]
    elif fault == "other_project": headers = {"X-Project-Id": "other"}
    else: reference["extra"] = "infer latest"
    before = persisted_state(sessions)
    response = client.post(f"/api/v1/delivery/tasks/{selected_task}/delivery-submissions/rework-preview",
        json={"rework_reference": reference}, headers=headers)
    assert response.status_code in {403, 404, 409, 422}, response.text
    assert "draft" not in response.json() and persisted_state(sessions) == before


def test_oversize_full_preview_fails_without_truncating_or_mutating(env, monkeypatch):
    from sop_manager.routers import delivery_task_submission_rework

    client, sessions, _actor = env
    task = make_task(client)
    reference, _old = returned_feedback(client, task)
    complete = preview(client, task["id"], reference)
    assert complete.status_code == 200, complete.text
    before = persisted_state(sessions)
    monkeypatch.setattr(delivery_task_submission_rework, "MAX_REWORK_PREVIEW_BYTES", 1)
    response = preview(client, task["id"], reference)
    assert response.status_code == 413 and response.json()["detail"]["code"] == "submission_rework_preview_budget", response.text
    assert "draft" not in response.json() and persisted_state(sessions) == before


def test_rework_target_order_is_current_explicit_snapshot_and_not_inherited_stop(env):
    from test_external_work_orders import claim, create_order, detail as work_detail

    client, sessions, _actor = env
    task = make_task(client)
    reference, _old = returned_feedback(client, task)
    old_preview, _payload = prepared(client, task["id"], reference)
    dispatched, _original = create_order(client, task["id"], key="rework-current-target")
    wid = dispatched["result"]["work_order_id"]
    claim(client, wid)
    selected, payload = prepared(client, task["id"], reference)
    assert selected["current"]["work_order"]["id"] == wid
    assert selected["rework_basis"] != old_preview["rework_basis"]
    assert "work_order" not in selected["draft"] and "stopped_attestation" not in str(selected["draft"])
    # The current locator can be retained without claiming a stop or binding the
    # report. The existing explicit W report/stop workflow remains available.
    ack, _body = submit(client, task["id"], payload=payload, key="rework-unbound-target")
    exact = detail(client, task["id"], ack["result"]["submission_id"]).json()
    assert exact["payload"]["work_order"] is None
    assert exact["rework"]["target_work_order"] == selected["current"]["work_order"]
    assert work_detail(client, wid)["work_order"]["state"] == "claimed"


def test_unbound_current_work_order_scope_is_fixed_even_when_selected_source_has_no_runtime(bridge):
    from test_delivery_feedback_workflow import create_from_preview
    from test_external_work_orders import claim, detail as work_detail

    client, sessions, _store, _principal, workspace, _rid, task = bridge
    # S0 predates any native execution; its own frozen scope is empty.
    selected, _old = returned_feedback(client, task)
    with sessions() as db:
        from sop_manager.routers.delivery_task_submission_service import submission_runtime_scopes
        from sop_manager.routers.sql_models import Project
        assert submission_runtime_scopes(db, db.get(Project, "project"), selected["submission_id"]) == []
    scoped, _scoped_source = scoped_feedback(bridge)
    proposal, body = work_preview(client, task["id"], scoped)
    dispatched, _request = create_from_preview(client, task["id"], proposal, body)
    assert dispatched.status_code == 200, dispatched.text
    wid = dispatched.json()["result"]["work_order_id"]
    claim(client, wid)
    view, payload = prepared(client, task["id"], selected)
    assert view["current"]["work_order"]["id"] == wid and payload.get("work_order") is None
    ack, _body = submit(client, task["id"], payload=payload, key="target-scope-without-stop")
    source = detail(client, task["id"], ack["result"]["submission_id"]).json()
    assert source["rework"]["reference"] == selected
    assert source["rework"]["feedback_runtime_scopes"] == [workspace["id"]]
    assert source["payload"]["work_order"] is None
    assert work_detail(client, wid)["work_order"]["state"] == "claimed"


def test_current_work_order_revision_change_requires_explicit_rework_readoption(env):
    from test_external_work_orders import claim, create_order, mutate

    client, sessions, _actor = env
    task = make_task(client)
    reference, _old = returned_feedback(client, task)
    dispatched, _original = create_order(client, task["id"], key="changed-rework-target")
    wid = dispatched["result"]["work_order_id"]
    claim(client, wid)
    view, _payload = prepared(client, task["id"], reference)
    progress, _request = mutate(client, wid, "progress", percent=None, status="running", message="Fresh progress changed the fixed target revision")
    assert progress.status_code == 200, progress.text
    payload = report(client, task["id"], rework_reference=reference, rework_basis=view["rework_basis"])
    before = persisted_state(sessions)
    response = client.post("/api/v1/delivery/commands", json=request(client, "task.delivery.submit", payload, key="stale-current-work-order"))
    assert response.status_code == 409 and response.json()["detail"]["code"] == "submission_rework_basis_changed", response.text
    assert persisted_state(sessions) == before


@pytest.mark.parametrize("processed", [False, True])
def test_rework_event_freezes_full_scope_for_original_receipt_and_duplicate_read(bridge, processed):
    from sop_manager.routers import events_ingest
    from sop_manager.routers import sql_models as models
    from sop_manager.routers.auth_sql import current_user, current_user_or_apikey
    from test_event_handoff import frozen, result, send, version

    client, sessions, _store, _principal, workspace, _rid, task = bridge
    client.app.include_router(events_ingest.router)
    client.app.dependency_overrides[current_user_or_apikey] = client.app.dependency_overrides[current_user]
    reference, _old = scoped_feedback(bridge)
    _view, payload = prepared(client, task["id"], reference)
    event = frozen("fixed-rework-event", "sop.task.delivery_submitted", {
        "expected_version": version(sessions) if processed else version(sessions) - 1, "report": payload}, task["id"])
    receipt = result(send(client, event))
    assert receipt["processing"]["state"] == ("processed" if processed else "failed"), receipt
    rid = receipt["receipt_id"]
    with sessions() as db:
        processing = db.get(models.EventProcessing, rid)
        assert processing.plan == {"kind": "task-delivery-scope.v1", "runtime_scopes": [workspace["id"]]}
    assert client.get(f"/api/v1/events/{rid}").status_code == 200
    revoke_runtime_membership(bridge)
    before = persisted_state(sessions)
    assert client.get(f"/api/v1/events/{rid}").status_code == 403
    assert client.get(f"/api/v1/events/{rid}/attempts").status_code == 403
    assert send(client, event).status_code == 403
    assert persisted_state(sessions) == before


def test_rework_after_flush_failure_rolls_back_report_lineage_receipt_and_version(env, monkeypatch):
    from sop_manager.routers import delivery_task_submission_service as service

    client, sessions, _actor = env
    task = make_task(client)
    reference, _old = returned_feedback(client, task)
    _view, payload = prepared(client, task["id"], reference)
    before = persisted_state(sessions)
    original = service._submit

    def fail_after_save(*args, **kwargs):
        original(*args, **kwargs)
        raise HTTPException(503, "Injected commit failure after complete rework original")

    monkeypatch.setattr(service, "_submit", fail_after_save)
    body = request(client, "task.delivery.submit", payload, key="rollback-rework-original")
    response = client.post("/api/v1/delivery/commands", json=body)
    assert response.status_code == 503, response.text
    assert persisted_state(sessions) == before


def test_returned_rework_remains_valid_full_fixed_input_for_actual_dispatch_consumer(env):
    client, sessions, _actor = env
    task = make_task(client)
    reference, _old = returned_feedback(client, task)
    _view, payload = prepared(client, task["id"], reference)
    ack, _body = submit(client, task["id"], payload=payload, key="rework-for-dispatch-feedback")
    sid = ack["result"]["submission_id"]
    response, _ = decide(client, task["id"], sid, decision="request_changes", key="rework-for-dispatch-review")
    assert response.status_code == 200, response.text
    selected = {"submission_id": sid, "submission_digest": ack["result"]["submission_digest"], "decision_id": response.json()["result"]["decision_id"]}
    routed, _proposal = work_preview(client, task["id"], selected)
    assert routed.status_code == 200 and routed.json()["allowed"], routed.text
    context = routed.json()["feedback_context"]
    assert context["submission"]["payload"]["rework_reference"] == reference
    assert context["reference"] == selected and digest(context) == routed.json()["feedback_context_sha256"]


def test_rework_route_is_in_real_openapi_and_pair_is_in_nested_command_schema(env):
    client, _sessions, _actor = env
    schema = client.app.openapi()
    route = "/api/v1/delivery/tasks/{task_id}/delivery-submissions/rework-preview"
    assert "post" in schema["paths"][route]
    contracts = schema["paths"]["/api/v1/delivery/commands"]["post"]["x-delivery-command-contracts"]
    report_schema = contracts["task.delivery.submit"]["payload"]
    assert {"rework_reference", "rework_basis"} <= set(report_schema["properties"])
    assert report_schema["dependentRequired"] == {"rework_reference": ["rework_basis"], "rework_basis": ["rework_reference"]}
    assert "null" not in str(report_schema["properties"]["rework_reference"])
    assert "null" not in str(report_schema["properties"]["rework_basis"])
    assert "#/$defs/" not in str(report_schema)
