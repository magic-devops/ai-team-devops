"""Canonical task-edit/receipt HTTP definitions; runtime execution is deferred."""

from copy import deepcopy
import json

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from sop_manager.routers import sql_models as models
from test_delivery_execution import bridge as execution_bridge, finish, queue, sync
from test_delivery_manual_review import make_task, review, review_current
from test_delivery_task_submissions import counts, current as submission_current, detail as submission_detail, submit
from test_delivery_workbench import command, env as delivery_env
from test_external_work_orders import claim, create_order, detail as order_detail

env = delivery_env
bridge = execution_bridge


def workspace_task(client, task_id):
    response = client.get("/api/v1/delivery/workspace")
    assert response.status_code == 200, response.text
    workspace = response.json()
    return workspace, next(row for row in workspace["tasks"] if row["id"] == task_id)


def original(client, task_id, changes, *, key="task-edit-original"):
    workspace, task = workspace_task(client, task_id)
    return {"action": "task.update", "expected_version": workspace["version"], "idempotency_key": key,
        "payload": {"id": task_id, "task_basis": task["basis"], **changes}}


def assert_ack(body, original_body, task_id):
    assert set(body) == {"project_id", "action", "resource", "result", "affected_refs", "applied_version", "version", "query_generation", "replayed"}
    assert body["project_id"] == "project" and body["action"] == "task.update"
    assert body["resource"] == {"kind": "task", "id": task_id} and body["result"] is None
    assert body["affected_refs"] == [{"kind": "task", "id": task_id}]
    assert body["applied_version"] == original_body["expected_version"] + 1
    assert body["version"] >= body["applied_version"]
    assert body["query_generation"] is None or type(body["query_generation"]) is int and body["query_generation"] > 0


def stored_query_state(sessions):
    with sessions() as db:
        workspace = db.get(models.DeliveryWorkspace, "project")
        index = db.get(models.DeliveryQueryState, ("tenant", "project"))
        return workspace.version, deepcopy(workspace.data), index.generation, index.source_version, index.schema_version


@pytest.mark.parametrize("mode", ["definition", "owner", "status"])
def test_exact_task_edit_modes_produce_one_task_ack_and_replay_the_original(env, mode):
    client, sessions, _actor = env
    task = make_task(client)
    workspace, row = workspace_task(client, task["id"])
    if mode == "definition":
        planning = row["planning"]
        changes = {"title": "  核对交付 🧭  ", "planning_basis": workspace["planning_basis"],
            "description": row["description"], "acceptance_criteria": row["acceptance_criteria"],
            "requirement_criteria_indices": planning.get("requirement_criteria_indices", []),
            "depends_on": planning.get("depends_on", []), "starts_on": planning.get("starts_on"),
            "ends_on": planning.get("ends_on"), "blocked_reason": planning.get("blocked_reason", "")}
    else:
        changes = {"owner_id": "user:reader"} if mode == "owner" else {"status": "in_progress"}
    body = original(client, task["id"], changes)
    retained = deepcopy(body)
    first = client.post("/api/v1/delivery/commands", json=body)
    assert first.status_code == 200, first.text
    assert_ack(first.json(), retained, task["id"])
    before = counts(sessions)
    second = client.post("/api/v1/delivery/commands", json=body)
    assert second.status_code == 200 and second.json()["replayed"], second.text
    assert_ack(second.json(), retained, task["id"])
    assert second.json()["resource"] == first.json()["resource"] and body == retained
    assert counts(sessions) == before
    read = client.get(f"/api/v1/delivery/tasks/{task['id']}")
    assert read.status_code == 200, read.text
    if mode == "definition":
        assert read.json()["task"]["title"] == "核对交付 🧭"


@pytest.mark.parametrize("title", [None, "", "   ", "x" * 257, 7])
def test_invalid_or_null_titles_are_rejected_without_writing(env, title):
    client, sessions, _actor = env
    task = make_task(client)
    body = original(client, task["id"], {"title": title})
    before = counts(sessions)
    response = client.post("/api/v1/delivery/commands", json=body)
    assert response.status_code == 422, response.text
    assert counts(sessions) == before


def test_title_length_counts_unicode_codepoints_and_invalid_unicode_never_writes(env):
    client, sessions, _actor = env
    task = make_task(client)
    title = "界🧭" * 128
    body = original(client, task["id"], {"title": "  " + title + "  "})
    saved = client.post("/api/v1/delivery/commands", json=body)
    assert saved.status_code == 200, saved.text
    assert client.get(f"/api/v1/delivery/tasks/{task['id']}").json()["task"]["title"] == title
    too_long = original(client, task["id"], {"title": title + "界"}, key="unicode-title-too-long")
    invalid = original(client, task["id"], {"title": "Unpaired \ud800"}, key="unicode-title-invalid")
    before = counts(sessions)
    assert client.post("/api/v1/delivery/commands", json=too_long).status_code == 422
    rejected = client.post("/api/v1/delivery/commands", content=json.dumps(invalid, ensure_ascii=True),
        headers={"Content-Type": "application/json"})
    assert rejected.status_code == 422 and rejected.json()["detail"]["code"] == "task_title_invalid", rejected.text
    assert counts(sessions) == before


def test_title_requires_adopted_task_basis_and_an_old_basis_cannot_be_rebound_implicitly(env):
    client, sessions, _actor = env
    task = make_task(client)
    saved = original(client, task["id"], {"title": "My retained title"})
    absent = deepcopy(saved)
    absent["payload"].pop("task_basis")
    assert client.post("/api/v1/delivery/commands", json=absent).status_code == 422
    changed = command(client, "task.update", {"id": task["id"], "description": "Another current scope."})
    assert changed.status_code == 200, changed.text
    stale = {**saved, "expected_version": changed.json()["version"]}
    before = counts(sessions)
    denied = client.post("/api/v1/delivery/commands", json=stale)
    assert denied.status_code == 409 and denied.json()["detail"]["code"] == "task_basis_changed", denied.text
    assert counts(sessions) == before and saved["payload"]["title"] == "My retained title"
    assert client.get(f"/api/v1/delivery/tasks/{task['id']}").json()["task"]["title"] == task["title"]


def test_committed_edit_receipt_does_not_depend_on_current_get_or_a_still_existing_task(env, monkeypatch):
    from sop_manager.routers import delivery_query_read

    client, sessions, _actor = env
    task = make_task(client)
    body = original(client, task["id"], {"title": "Confirmed exactly once"})
    first = client.post("/api/v1/delivery/commands", json=body)
    assert first.status_code == 200, first.text

    def current_unavailable(*_args, **_kwargs):
        raise HTTPException(503, "Current task reading is unavailable after the commit.")

    monkeypatch.setattr(delivery_query_read, "task_detail", current_unavailable)
    assert client.get(f"/api/v1/delivery/tasks/{task['id']}").status_code == 503
    before = counts(sessions)
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 200 and replay.json()["replayed"], replay.text
    assert_ack(replay.json(), body, task["id"])
    assert counts(sessions) == before
    with sessions() as db:
        db.delete(db.get(models.Task, task["id"]))
        db.commit()
    before = counts(sessions)
    deleted_replay = client.post("/api/v1/delivery/commands", json=body)
    assert deleted_replay.status_code == 200 and deleted_replay.json()["replayed"], deleted_replay.text
    assert_ack(deleted_replay.json(), body, task["id"])
    assert counts(sessions) == before


def test_replay_rechecks_current_write_access_and_changed_input_never_reuses_the_key(env):
    client, sessions, actor = env
    task = make_task(client)
    with sessions() as db:
        db.add(models.User(id="task-editor", tenant_id="tenant", username="task-editor", password_hash="not-a-login", role="developer", status="active"))
        db.flush()
        db.add(models.ProjectMember(project_id="project", user_id="task-editor", role="developer"))
        db.commit()
    actor["id"] = "task-editor"
    body = original(client, task["id"], {"title": "Developer's original title"})
    first = client.post("/api/v1/delivery/commands", json=body)
    assert first.status_code == 200, first.text
    changed = deepcopy(body)
    changed["payload"]["title"] = "Different body under the same key"
    assert client.post("/api/v1/delivery/commands", json=changed).status_code == 409
    with sessions() as db:
        db.get(models.ProjectMember, ("project", "task-editor")).role = "viewer"
        db.commit()
    retained = deepcopy(body)
    before = counts(sessions)
    assert client.post("/api/v1/delivery/commands", json=body).status_code == 403
    assert counts(sessions) == before and body == retained
    with sessions() as db:
        db.get(models.ProjectMember, ("project", "task-editor")).role = "developer"
        db.commit()
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 200 and replay.json()["replayed"], replay.text
    assert_ack(replay.json(), body, task["id"])


def test_title_change_invalidates_current_external_report_and_held_order_without_rewriting_originals(env):
    client, sessions, _actor = env
    task = make_task(client)
    created, _ = create_order(client, task["id"])
    wid = created["result"]["work_order_id"]
    claim(client, wid)
    submitted, _ = submit(client, task["id"])
    sid = submitted["result"]["submission_id"]
    old_report = submission_detail(client, task["id"], sid).json()
    old_order = order_detail(client, wid)
    before = counts(sessions)
    denied = client.post("/api/v1/delivery/commands", json=original(client, task["id"],
        {"title": "A held order cannot complete by editing its title", "status": "completed"}))
    assert denied.status_code == 409, denied.text
    assert counts(sessions) == before
    changed = client.post("/api/v1/delivery/commands", json=original(client, task["id"], {"title": "A different fixed delivery title"}))
    assert changed.status_code == 200, changed.text
    report = submission_detail(client, task["id"], sid).json()
    held_order = order_detail(client, wid)
    assert report["submission"]["invalidated"] and report["definition"] == old_report["definition"]
    assert held_order["work_order"]["invalidated"] and held_order["work_order"]["state"] == "claimed"
    assert held_order["definition"] == old_order["definition"]
    assert submission_current(client, task["id"]).json()["work_order"] is None
    quality = client.get("/api/v1/delivery/quality", params={"requirement_ids": task["req_id"]})
    assert quality.status_code == 200, quality.text
    fact = next(row for row in quality.json()["tasks"] if row["id"] == task["id"])
    assert not fact["verified"] and fact["delivery_status"] != "verified_completed"
    with sessions() as db:
        assert db.scalar(select(models.DeliveryTaskReview)) is None


def advance_task_to(client, task, target):
    rid = task["req_id"]
    for stage, kind in [("intake", None), ("product", "prd"), ("ux", "prototype"), ("architecture", "architecture")]:
        if kind:
            added = command(client, "artifact.add", {"requirement_id": rid, "kind": kind,
                "title": kind, "content": "Reviewed evidence for the current requirement."})
            assert added.status_code == 200, added.text
        advanced = command(client, "stage.advance", {"requirement_id": rid, "comment": "Reviewed " + stage})
        assert advanced.status_code == 200, advanced.text
    planned = command(client, "stage.advance", {"requirement_id": rid, "comment": "Current implementation plan ready"})
    assert planned.status_code == 200, planned.text
    completed = command(client, "task.update", {"id": task["id"], "status": "completed"})
    assert completed.status_code == 200, completed.text
    accepted = review(client, task["id"])
    assert accepted.status_code == 200, accepted.text
    tested = command(client, "stage.advance", {"requirement_id": rid, "comment": "Reviewed implementation delivery"})
    assert tested.status_code == 200, tested.text
    if target != "testing":
        evidence = command(client, "artifact.add", {"requirement_id": rid, "kind": "test", "title": "Acceptance checks",
            "content": "Verified current acceptance behavior.", "result": "passed"})
        assert evidence.status_code == 200, evidence.text
        verified = command(client, "stage.advance", {"requirement_id": rid, "comment": "Verified reported checks"})
        assert verified.status_code == 200, verified.text
    if target == "release":
        released = command(client, "stage.advance", {"requirement_id": rid, "comment": "Accepted current evidence"})
        assert released.status_code == 200, released.text
    workspace, _row = workspace_task(client, task["id"])
    requirement = next(row for row in workspace["requirements"] if row["id"] == rid)
    assert requirement["flow"]["stage"] == target
    return requirement["flow"]


@pytest.mark.parametrize("stage", ["testing", "acceptance", "release"])
def test_title_edits_reopen_testing_evidence_and_cannot_bypass_accepted_release(env, stage):
    client, sessions, _actor = env
    task = make_task(client)
    previous = advance_task_to(client, task, stage)
    body = original(client, task["id"], {"title": "Changed delivery requires current checks"})
    before = counts(sessions)
    changed = client.post("/api/v1/delivery/commands", json=body)
    workspace, current_task = workspace_task(client, task["id"])
    requirement = next(row for row in workspace["requirements"] if row["id"] == task["req_id"])
    if stage == "release":
        assert changed.status_code == 409, changed.text
        assert counts(sessions) == before and current_task["title"] == task["title"]
        assert requirement["flow"]["stage"] == "release" and requirement["flow"]["revision"] == previous["revision"]
    else:
        assert changed.status_code == 200, changed.text
        assert requirement["flow"]["stage"] == "intake" and requirement["flow"]["revision"] == previous["revision"] + 1
        assert requirement["status"] == "pending"
        assert "tested_work" not in requirement["flow"] and "accepted_work" not in requirement["flow"]
        assert not review_current(client, task["id"]).json()["current"]["verified"]


def test_title_change_invalidates_manual_acceptance_and_requires_fresh_quality_evidence(env):
    client, sessions, _actor = env
    task = make_task(client)
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    accepted = review(client, task["id"])
    assert accepted.status_code == 200, accepted.text
    before = review_current(client, task["id"]).json()
    assert before["current"]["verified"]
    changed = client.post("/api/v1/delivery/commands", json=original(client, task["id"], {"title": "Fresh manual verification scope"}))
    assert changed.status_code == 200, changed.text
    current = review_current(client, task["id"]).json()
    assert not current["current"]["verified"] and current["effective_review_id"] is None
    with sessions() as db:
        assert db.scalar(select(models.DeliveryTaskReview)).invalidated
    quality = client.get("/api/v1/delivery/quality", params={"requirement_ids": task["req_id"]})
    assert quality.status_code == 200, quality.text
    fact = next(row for row in quality.json()["tasks"] if row["id"] == task["id"])
    assert not fact["verified"] and any(reason["code"] == "task_unverified" for reason in fact["reasons"])


def test_native_original_cannot_be_completed_or_reused_by_a_combined_title_edit(bridge):
    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    intent = queue(bridge)
    body = original(client, task["id"], {"title": "Changed scope must not complete native work", "status": "completed"})
    before = counts(sessions)
    denied = client.post("/api/v1/delivery/commands", json=body)
    assert denied.status_code == 409, denied.text
    assert counts(sessions) == before
    changed = client.post("/api/v1/delivery/commands", json=original(client, task["id"], {"title": "A new native scope"}, key="new-native-task-title"))
    assert changed.status_code == 200, changed.text
    observed = client.get(f"/api/v1/delivery/executions/{intent['id']}/observations")
    assert observed.status_code == 200 and observed.json()["stale"], observed.text
    with sessions() as db:
        assert db.get(models.Task, task["id"]).status != "completed"
        assert db.scalar(select(models.DeliveryTaskReview)) is None


def test_title_change_invalidates_accepted_native_proof_and_its_real_test_artifact(bridge):
    client, sessions, _store, _principal, _workspace, rid, task = bridge
    intent = queue(bridge)
    execution = sync(bridge, intent)
    finish(bridge, execution)
    execution = sync(bridge, intent)
    accepted = command(client, "execution.review", {"id": intent["id"], "decision": "accept",
        "comment": "Verified this original runtime result", "run_version": execution["run_version"]})
    assert accepted.status_code == 200, accepted.text
    assert client.get(f"/api/v1/delivery/tasks/{task['id']}").json()["task"]["verified"]
    changed = client.post("/api/v1/delivery/commands", json=original(client, task["id"],
        {"title": "New title requires a new native proof"}))
    assert changed.status_code == 200, changed.text
    before = counts(sessions)
    stored = stored_query_state(sessions)
    workspace, current_task = workspace_task(client, task["id"])
    assert not current_task["verified"] and current_task["status"] != "completed"
    assert next(row for row in workspace["executions"] if row["id"] == intent["id"])["stale"]
    requirement = next(row for row in workspace["requirements"] if row["id"] == rid)
    assert any(artifact["stale"] for artifact in requirement["flow"]["artifacts"]
        if artifact.get("source") == "execution-runtime")
    quality = client.get("/api/v1/delivery/quality", params={"requirement_ids": rid})
    assert quality.status_code == 200, quality.text
    assert not next(row for row in quality.json()["tasks"] if row["id"] == task["id"])["verified"]
    assert counts(sessions) == before and stored_query_state(sessions) == stored
