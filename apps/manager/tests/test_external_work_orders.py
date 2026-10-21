"""Real external dispatch/claim/report SQL and HTTP definitions; not executed."""
from copy import deepcopy
import json

import pytest
from fastapi import HTTPException
from hermes_core.transactional import digest
from sqlalchemy import func, select, update

from sop_manager.routers import sql_models as models
from sop_manager.routers.delivery_external_work_order_model import DeliveryExternalWorkOrder as Order
from test_delivery_workbench import command, env as delivery_env
from test_delivery_execution import bridge as execution_bridge, cancel_execution, queue, sync
from test_delivery_manual_review import make_task
from test_delivery_task_submissions import decide, detail as submission_detail, submit, task_fact

env = delivery_env
bridge = execution_bridge


def current(client, tid):
    response = client.get(f"/api/v1/delivery/tasks/{tid}/work-orders/current")
    assert response.status_code == 200, response.text
    return response.json()


def detail(client, wid):
    response = client.get(f"/api/v1/delivery/work-orders/{wid}")
    assert response.status_code == 200, response.text
    return response.json()


def create_order(client, task_id, *, kind="tool", key=None, instructions="Complete this exact task and attach real checks."):
    resource = command(client, "member.save", {"name": "External development tool", "kind": kind, "role": "developer", "tool": "workbuddy", "active": True})
    assert resource.status_code == 200, resource.text
    member = resource.json()["members"][-1]
    source = current(client, task_id)
    proposal = client.post(f"/api/v1/delivery/tasks/{task_id}/work-order-preview", json={
        "task_basis": source["task_basis"], "executor_member_id": member["id"], "instructions": instructions})
    assert proposal.status_code == 200, proposal.text
    preview = proposal.json()
    assert preview["complete"] and preview["allowed"], preview
    payload = {"task_id": task_id, "task_basis": preview["task_basis"], "definition_digest": preview["definition_digest"],
        "native_boundary_digest": preview["native_boundary_digest"], "executor_member_id": member["id"],
        "preview_basis": preview["preview_basis"], "instructions": instructions}
    original = {"action": "work_order.create", "expected_version": preview["version"],
        "idempotency_key": key or f"fixed-work-order-{preview['version']}", "payload": payload}
    response = client.post("/api/v1/delivery/commands", json=original)
    assert response.status_code == 200, response.text
    return response.json(), original


def mutate(client, wid, action, *, key=None, **values):
    selected = detail(client, wid)
    body = {"action": "work_order." + action, "expected_version": selected["version"],
        "idempotency_key": key or f"fixed-order-{action}-{selected['version']}",
        "payload": {"id": wid, "order_revision": selected["work_order"]["order_revision"], **values}}
    return client.post("/api/v1/delivery/commands", json=body), body


def claim(client, wid):
    response, body = mutate(client, wid, "claim")
    assert response.status_code == 200, response.text
    return response.json(), body


def test_dispatch_binds_real_task_formal_resource_and_lost_ack_recovers_same_queued_original(env):
    client, sessions, _actor = env
    task = make_task(client)
    ack, original = create_order(client, task["id"])
    wid = ack["result"]["work_order_id"]
    assert ack["resource"] == {"kind": "work_order", "id": wid}
    assert set(ack["result"]) == {"work_order_id", "task_ids", "request_digest", "packet_digest", "order_revision", "state", "submission_id"}
    selected = detail(client, wid)["work_order"]
    assert selected["state"] == "queued" and selected["claimed_by"] is None and selected["progress"] is None
    replay = client.post("/api/v1/delivery/commands", json=original)
    assert replay.status_code == 200 and replay.json()["replayed"] and replay.json()["result"] == ack["result"]
    altered = {**original, "payload": {**original["payload"], "instructions": "Different request"}}
    assert client.post("/api/v1/delivery/commands", json=altered).status_code == 409
    assert client.get("/api/v1/delivery/tasks/manual-made-up/work-orders/current").status_code == 404
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(Order)) == 1
        assert db.get(models.Task, task["id"]).status == "pending"
        assert db.scalar(select(Order)).original["request"]["task_id"] == task["id"]
    activity = client.get("/api/v1/delivery/activity", params={"action": "work_order.create"})
    assert activity.status_code == 200, activity.text
    item = activity.json()["items"][0]
    assert item["target"]["kind"] == "work_order" and item["target"]["id"] == wid
    assert any(ref["kind"] == "task" and ref["id"] == task["id"] for ref in item["related_targets"])
    assert task["req_id"] in item["requirement_ids"]
    assert not any(ref["kind"] == "task" and ref["id"] == wid for ref in item["related_targets"])


def test_claim_is_one_account_and_progress_has_no_success_or_invented_percent(env):
    client, sessions, actor = env
    task = make_task(client); ack, _ = create_order(client, task["id"]); wid = ack["result"]["work_order_id"]
    claimed, original = claim(client, wid)
    assert claimed["result"]["state"] == "claimed"
    assert client.post("/api/v1/delivery/commands", json=original).json()["result"] == claimed["result"]
    with sessions() as db:
        db.add(models.User(id="other-worker", tenant_id="tenant", username="other-worker", password_hash="not-a-login", role="developer", status="active"))
        db.flush(); db.add(models.ProjectMember(project_id="project", user_id="other-worker", role="developer")); db.commit()
    actor["id"] = "other-worker"
    rejected, _ = mutate(client, wid, "progress", percent=50, status="running", message="Not my assignment")
    assert rejected.status_code == 403
    actor["id"] = "lead"
    reported, body = mutate(client, wid, "progress", percent=None, status="running", message="Inspecting the requested behavior; no measured percentage yet.")
    assert reported.status_code == 200, reported.text
    assert client.post("/api/v1/delivery/commands", json=body).json()["result"] == reported.json()["result"]
    progress = detail(client, wid)["work_order"]["progress"]
    assert progress["percent"] is None and progress["source"] == "external_reported"
    denied, _ = mutate(client, wid, "progress", percent=100, status="success", message="Cannot create success")
    assert denied.status_code == 422
    missing = deepcopy(body); missing["payload"].pop("percent"); missing["idempotency_key"] = "missing-progress-value"
    assert client.post("/api/v1/delivery/commands", json=missing).status_code == 422


def test_one_active_slot_requires_explicit_stop_then_existing_submission_human_review(env):
    client, sessions, _actor = env
    task = make_task(client); ack, _ = create_order(client, task["id"]); wid = ack["result"]["work_order_id"]; claim(client, wid)
    submitted, _ = submit(client, task["id"]); sid = submitted["result"]["submission_id"]
    before = submission_detail(client, task["id"], sid).json()
    assert not before["permissions"]["can_review"]
    early, _ = decide(client, task["id"], sid)
    assert early.status_code == 409
    report, original = mutate(client, wid, "report", submission_id=sid,
        submission_digest=submitted["result"]["submission_digest"], stopped_attestation=True)
    assert report.status_code == 200, report.text
    selected = detail(client, wid)["work_order"]
    assert selected["state"] == "reported" and selected["delivery_state"] == "awaiting_review"
    assert selected["closure"]["kind"] == "external_reported_stop"
    assert task_fact(sessions, task["id"])["status"] != "verified_completed"
    accepted, _ = decide(client, task["id"], sid, key="human-review-after-order-report")
    assert accepted.status_code == 200, accepted.text
    final = detail(client, wid)["work_order"]
    assert final["delivery_state"] == "accepted" and not final["invalidated"]
    assert task_fact(sessions, task["id"])["status"] == "verified_completed"
    assert client.post("/api/v1/delivery/commands", json=original).json()["result"] == report.json()["result"]


def test_queued_cancellation_and_claimed_cancellation_have_distinct_truth(env):
    client, _sessions, _actor = env
    task = make_task(client); ack, _ = create_order(client, task["id"]); wid = ack["result"]["work_order_id"]
    response, _ = mutate(client, wid, "cancel", comment="Never claimed; close queued work")
    assert response.status_code == 200
    assert detail(client, wid)["work_order"]["closure"]["kind"] == "never_claimed"
    second, _ = create_order(client, task["id"]); second_id = second["result"]["work_order_id"]; claim(client, second_id)
    response, _ = mutate(client, second_id, "cancel", comment="Request the external worker to stop")
    assert response.status_code == 200
    selected = detail(client, second_id)["work_order"]
    assert selected["state"] == "cancel_requested" and selected["closure"] is None
    assert current(client, task["id"])["active_work_order_id"] == second_id
    denied, _ = mutate(client, second_id, "release", stopped_attestation=1, comment="Numbers are not explicit assent")
    assert denied.status_code == 422
    released, _ = mutate(client, second_id, "release", stopped_attestation=True, comment="Stopped all external activity for this original")
    assert released.status_code == 200 and current(client, task["id"])["active_work_order_id"] is None


def test_task_scope_round_trip_permanently_invalidates_without_releasing_claim(env):
    client, sessions, _actor = env
    task = make_task(client); ack, _ = create_order(client, task["id"]); wid = ack["result"]["work_order_id"]; claim(client, wid)
    with sessions() as db:
        db.get(models.Task, task["id"]).priority = "P0"; db.commit()
    with sessions() as db:
        db.get(models.Task, task["id"]).priority = task["priority"]; db.commit()
    selected = detail(client, wid)
    assert selected["work_order"]["invalidated"] and not selected["permissions"]["can_progress"]
    assert current(client, task["id"])["active_work_order_id"] == wid
    rejected, _ = mutate(client, wid, "progress", percent=50, status="running", message="Cannot continue stale scope")
    assert rejected.status_code == 409
    released, _ = mutate(client, wid, "release", stopped_attestation=True, comment="Old source stopped after explicit review")
    assert released.status_code == 200


def test_executor_disable_requires_release_but_does_not_trap_the_original_claimant(env):
    client, _sessions, _actor = env
    task = make_task(client); ack, _ = create_order(client, task["id"]); wid = ack["result"]["work_order_id"]; claim(client, wid)
    executor = detail(client, wid)["work_order"]["executor"]
    response = command(client, "member.save", {"id": executor["id"], "name": executor["name"], "kind": executor["kind"],
        "tool": executor["tool"], "role": "developer", "active": False})
    assert response.status_code == 200, response.text
    assert detail(client, wid)["work_order"]["invalidated"]
    assert detail(client, wid)["permissions"]["can_release"]
    released, _ = mutate(client, wid, "release", stopped_attestation=True, comment="External work stopped after resource disable")
    assert released.status_code == 200


def test_immutable_original_and_active_slot_cannot_be_bypassed_through_sql(env):
    client, sessions, _actor = env
    task = make_task(client); ack, _ = create_order(client, task["id"]); wid = ack["result"]["work_order_id"]
    for values in ({"original": {"forged": True}}, {"active_task_id": None}, {"state": "reported"}):
        with sessions() as db, pytest.raises(HTTPException) as rejected:
            db.execute(update(Order).where(Order.id == wid).values(**values))
        assert rejected.value.detail["code"] == "work_order_service_required"
    with sessions() as db:
        with pytest.raises(HTTPException) as rejected:
            db.execute(update(models.Task).where(models.Task.id == task["id"]).values(status="completed"))
        assert rejected.value.detail["code"] == "external_work_order_active"


def test_packet_preserves_full_fixed_design_and_normal_catalogues_do_not_read_body(env):
    client, sessions, _actor = env
    from test_design_adoption import create, adopt, save
    from test_delivery_query import statements

    task = make_task(client); did = create(client, content="# Original\n\nFIXED_EXTERNAL_BODY")
    adopt(client, "requirement", task["req_id"], did)
    ack, _ = create_order(client, task["id"]); wid = ack["result"]["work_order_id"]
    packet = client.get(f"/api/v1/delivery/work-orders/{wid}/packet")
    assert packet.status_code == 200, packet.text
    original = packet.json(); assert digest(original["packet"]) == original["packet_digest"]
    assert original["packet"]["design_context"][0]["content"] == "# Original\n\nFIXED_EXTERNAL_BODY"
    save(client, did, content="# New head\n\nUNSELECTED_NEW_BODY")
    assert client.get(f"/api/v1/delivery/work-orders/{wid}/packet").json()["packet"] == original["packet"]
    with statements(sessions) as sql:
        page = client.get("/api/v1/delivery/work-orders")
    assert page.status_code == 200, page.text
    assert "FIXED_EXTERNAL_BODY" not in page.text and "original" not in page.json()["items"][0]
    assert not any("delivery_external_work_orders.original" in statement.lower() for statement in sql)


def test_old_file_execution_routes_are_all_retired_without_touching_user_files(env, tmp_path, monkeypatch):
    client, _sessions, _actor = env
    from sop_manager.routers import a2a_gateway, agent_runs

    client.app.include_router(a2a_gateway.router); client.app.include_router(agent_runs.router)
    monkeypatch.setattr(agent_runs, "resolved_ai_memory_root", lambda: tmp_path)
    unique = tmp_path / "agent_runs" / "run_unique-user.json"
    unique.parent.mkdir(); unique.write_text('{"status":"success"}', encoding="utf-8")
    before = {path.relative_to(tmp_path).as_posix(): path.read_bytes() for path in tmp_path.rglob("*") if path.is_file()}
    for method, path in [("post", "/a2a/dispatch"), ("post", "/a2a/evidence"), ("post", "/a2a/registry/fake/progress"),
            ("put", "/a2a/trust/policy"), ("post", "/a2a/execution-windows/actions"), ("get", "/a2a/health"),
            ("post", "/agent-runs"), ("put", "/agent-runs/fake/status"), ("delete", "/agent-runs/fake"), ("get", "/agent-runs/summary")]:
        response = getattr(client, method)("/api/v1" + path)
        assert response.status_code == 410, response.text
        assert response.json()["detail"]["code"] == "legacy_agent_execution_retired"
    assert {path.relative_to(tmp_path).as_posix(): path.read_bytes() for path in tmp_path.rglob("*") if path.is_file()} == before


def test_empty_catalogue_is_read_only_and_first_real_task_dispatch_works(env):
    from test_delivery_task_submissions import counts

    client, sessions, _actor = env
    before = counts(sessions)
    response = client.get("/api/v1/delivery/work-orders")
    assert response.status_code == 200, response.text
    assert response.json()["items"] == [] and response.json()["total"] == 0
    assert response.json()["version"] == 0 and response.json()["query_generation"] is None
    assert counts(sessions) == before
    task = make_task(client)
    ack, _ = create_order(client, task["id"])
    assert detail(client, ack["result"]["work_order_id"])["work_order"]["state"] == "queued"


def test_report_rejects_another_task_and_changed_digest_without_releasing_slot(env):
    client, _sessions, _actor = env
    task = make_task(client); ack, _ = create_order(client, task["id"]); wid = ack["result"]["work_order_id"]; claim(client, wid)
    other = make_task(client)
    wrong, _ = submit(client, other["id"], key="another-task-delivery")
    denied, _ = mutate(client, wid, "report", submission_id=wrong["result"]["submission_id"],
        submission_digest=wrong["result"]["submission_digest"], stopped_attestation=True)
    assert denied.status_code == 409
    correct, _ = submit(client, task["id"])
    denied, _ = mutate(client, wid, "report", submission_id=correct["result"]["submission_id"],
        submission_digest="0" * 64, stopped_attestation=True)
    assert denied.status_code == 409
    assert current(client, task["id"])["active_work_order_id"] == wid
    assert detail(client, wid)["work_order"]["submission"] is None


def test_paused_project_blocks_new_claim_but_allows_existing_claimed_delivery_to_close(env):
    client, sessions, _actor = env
    task = make_task(client); ack, _ = create_order(client, task["id"]); wid = ack["result"]["work_order_id"]
    # Existing persisted lifecycle state; formal archive preview/apply has its
    # own real consumer definitions and active-order blockers.
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(models.Project).where(models.Project.id == "project").values(status="paused"))
    selected = detail(client, wid)
    assert not selected["permissions"]["can_claim"]
    assert "project_not_active" in {reason["code"] for reason in selected["permissions"]["reasons"]}
    denied, _ = mutate(client, wid, "claim")
    assert denied.status_code == 409 and denied.json()["detail"]["code"] == "project_not_active"
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(models.Project).where(models.Project.id == "project").values(status="active"))
    claim(client, wid)
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(models.Project).where(models.Project.id == "project").values(status="paused"))
    reported, _ = mutate(client, wid, "progress", percent=None, status="blocked", message="Paused; preparing a stopped delivery report.")
    assert reported.status_code == 200, reported.text
    submitted, _ = submit(client, task["id"])
    closed, _ = mutate(client, wid, "report", submission_id=submitted["result"]["submission_id"],
        submission_digest=submitted["result"]["submission_digest"], stopped_attestation=True)
    assert closed.status_code == 200, closed.text
    assert current(client, task["id"])["active_work_order_id"] is None
    assert not current(client, task["id"])["can_dispatch"]


def test_external_current_rejects_explicit_native_stop_for_another_attempt(bridge):
    client, _sessions, store, principal, workspace, _rid, task = bridge
    old = sync(bridge, queue(bridge))
    assert cancel_execution(client, old["id"]).status_code == 200
    assert current(client, task["id"])["native_boundary_digest"] is not None
    run = store.get(principal, workspace["id"], "runs", old["run_id"])

    def wrong_attempt(row):
        data = deepcopy(row["data"])
        data["stop_request"]["attempt"] = data.get("attempt", 1) + 1
        return {"data": data}

    saved = store.mutate(principal, workspace["id"], "runs", run["id"], operation="test.external.stop.attempt",
        key="external-stop-another-attempt", request={}, trace="test", expected=run["version"], transform=wrong_attempt)
    source = current(client, task["id"])
    assert not source["can_dispatch"] and source["native_boundary_digest"] is None
    assert "submission_native_stop_unverified" in {reason["code"] for reason in source["reasons"]}
    external = client.get(f"/api/v1/delivery/tasks/{task['id']}/delivery-submissions/current")
    assert external.status_code == 200 and not external.json()["can_submit"]
    assert "submission_native_stop_unverified" in {reason["code"] for reason in external.json()["reasons"]}
    assert store.get(principal, workspace["id"], "runs", run["id"]) == saved


def test_exact_latest_metadata_page_is_budgeted_before_corrupt_progress_is_downloaded(env):
    client, sessions, _actor = env
    from test_delivery_query import statements

    task = make_task(client); ack, _ = create_order(client, task["id"]); wid = ack["result"]["work_order_id"]
    # Simulate storage corruption below the Session guard. The public read must
    # reject the selected page before transferring oversized JSON metadata.
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(Order).where(Order.id == wid).values(progress={"message": "x" * 1048577}))
    with statements(sessions) as sql:
        response = client.get("/api/v1/delivery/work-orders", params={"limit": 1})
    assert response.status_code == 413, response.text
    assert response.json()["detail"]["code"] == "work_order_page_budget"
    assert not any("delivery_external_work_orders.original" in statement.lower() for statement in sql)


@pytest.mark.parametrize("bad", ["bad\x00instruction", "bad\x85instruction", "bad\ud800instruction"])
def test_preview_rejects_invalid_control_or_utf8_text_at_the_http_contract(env, bad):
    client, _sessions, _actor = env
    task = make_task(client)
    member = command(client, "member.save", {"name": "Formal tool", "kind": "tool", "active": True}).json()["resource"]["id"]
    body = {"task_basis": current(client, task["id"])["task_basis"], "executor_member_id": member, "instructions": bad}
    response = client.post(f"/api/v1/delivery/tasks/{task['id']}/work-order-preview",
        content=json.dumps(body, ensure_ascii=True).encode("ascii"), headers={"Content-Type": "application/json"})
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("field,value", [("instructions", "x" * 4000 + "\ud800"), ("task_basis", "\ud800"),
    ("executor_member_id", {"wrong_type": ["\ud800"]})])
def test_invalid_utf8_is_rejected_before_constraints_or_wrong_type_errors_echo_it(env, field, value):
    client, _sessions, _actor = env
    task = make_task(client)
    body = {"task_basis": current(client, task["id"])["task_basis"], "executor_member_id": "formal-tool", "instructions": "Read the fixed scope."}
    body[field] = value
    response = client.post(f"/api/v1/delivery/tasks/{task['id']}/work-order-preview",
        content=json.dumps(body, ensure_ascii=True).encode("ascii"), headers={"Content-Type": "application/json"})
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "work_order_text_invalid"


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_http_nonfinite_wrong_type_is_rejected_without_echo_serialization_failure(env, value):
    client, _sessions, _actor = env
    task = make_task(client)
    body = {"task_basis": current(client, task["id"])["task_basis"], "executor_member_id": "formal-tool", "instructions": value}
    response = client.post(f"/api/v1/delivery/tasks/{task['id']}/work-order-preview",
        content=json.dumps(body, allow_nan=True).encode("ascii"), headers={"Content-Type": "application/json"})
    assert response.status_code == 422, response.text
    assert response.json()["detail"]["code"] == "work_order_json_invalid"


def test_formal_member_c1_source_is_explicitly_unavailable_without_trapping_claimant_release(env):
    client, _sessions, _actor = env
    task = make_task(client); ack, _ = create_order(client, task["id"]); wid = ack["result"]["work_order_id"]; claim(client, wid)
    executor = detail(client, wid)["work_order"]["executor"]
    changed = command(client, "member.save", {"id": executor["id"], "name": "Tool\x85name", "kind": "tool", "tool": executor["tool"], "active": True})
    assert changed.status_code == 200, changed.text
    source = client.get(f"/api/v1/delivery/tasks/{task['id']}/work-orders/current")
    assert source.status_code == 409 and source.json()["detail"]["code"] == "work_order_source_invalid"
    assert "Tool\x85name" not in source.text
    historical = detail(client, wid)
    assert historical["work_order"]["invalidated"] and historical["permissions"]["can_release"]
    stopped, _ = mutate(client, wid, "release", stopped_attestation=True, comment="The original external work stopped; preserve and repair the team source.")
    assert stopped.status_code == 200, stopped.text
    assert detail(client, wid)["work_order"]["state"] == "closed"


@pytest.mark.parametrize("broken", [{"kind": "tool", "name": "Missing id", "active": True},
    {"id": ["wrong-type"], "kind": "tool", "name": "Wrong id type", "active": True}])
def test_malformed_team_source_has_safe_reason_and_never_blocks_explicit_stop(env, broken):
    client, sessions, _actor = env
    task = make_task(client); ack, _ = create_order(client, task["id"]); wid = ack["result"]["work_order_id"]; claim(client, wid)
    with sessions() as db:
        data = deepcopy(db.get(models.DeliveryWorkspace, "project").data)
    data["members"] = [deepcopy(broken)]
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(models.DeliveryWorkspace).where(models.DeliveryWorkspace.project_id == "project").values(data=data))
    source = client.get(f"/api/v1/delivery/tasks/{task['id']}/work-orders/current")
    assert source.status_code == 409 and source.json()["detail"]["code"] == "work_order_source_invalid"
    assert detail(client, wid)["permissions"]["can_release"]
    stopped, _ = mutate(client, wid, "release", stopped_attestation=True, comment="Stopped despite the unavailable current team catalogue.")
    assert stopped.status_code == 200, stopped.text
    with sessions() as db:
        assert db.get(models.DeliveryWorkspace, "project").data["members"] == [broken]


@pytest.mark.parametrize("broken", [{"id": "bad-repository", "kind": "repository", "title": "Invalid source", "url": "javascript:private-value"},
    {"id": "bad-repository", "kind": "repository", "title": {"wrong": "type"}, "url": "https://example.test/repository"}])
def test_repository_source_validation_is_explicit_and_cannot_accept_a_new_packet(env, broken):
    client, sessions, _actor = env
    task = make_task(client); ack, original = create_order(client, task["id"]); wid = ack["result"]["work_order_id"]
    assert mutate(client, wid, "cancel", comment="Close the unclaimed packet before testing fresh intake.")[0].status_code == 200
    with sessions() as db:
        data = deepcopy(db.get(models.DeliveryWorkspace, "project").data)
        version = db.get(models.DeliveryWorkspace, "project").version
    data["resources"] = [deepcopy(broken)]
    with sessions.kw["bind"].begin() as connection:
        connection.execute(update(models.DeliveryWorkspace).where(models.DeliveryWorkspace.project_id == "project").values(data=data))
    body = {"task_basis": original["payload"]["task_basis"], "executor_member_id": original["payload"]["executor_member_id"], "instructions": original["payload"]["instructions"]}
    proposal = client.post(f"/api/v1/delivery/tasks/{task['id']}/work-order-preview", json=body)
    assert proposal.status_code == 200 and not proposal.json()["allowed"]
    assert "work_order_source_invalid" in {reason["code"] for reason in proposal.json()["reasons"]}
    request = {**original, "expected_version": version, "idempotency_key": "invalid-repository-source"}
    rejected = client.post("/api/v1/delivery/commands", json=request)
    assert rejected.status_code == 409 and rejected.json()["detail"]["code"] == "work_order_source_invalid"
    assert "javascript:private-value" not in rejected.text
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(Order)) == 1
        assert db.get(models.DeliveryWorkspace, "project").data["resources"] == [broken]
