"""Real external delivery commands and canonical consumers; execution is deferred.

These definitions use isolated SQL, the real runtime bridge and HTTP commands.
They do not replace the deferred shared-window runtime validation receipt.
"""

from copy import deepcopy

import pytest
from fastapi import HTTPException
from sqlalchemy import delete, func, select, update
from sop_manager.routers import sql_models as models
from sop_manager.routers.delivery_progress_facts import capture_facts
from sop_manager.routers.delivery_task_submission_model import (
    DeliveryTaskSubmission as Submission,
    DeliveryTaskSubmissionDecision as Decision,
)
from test_delivery_execution import (
    bridge as delivery_bridge,
    cancel_execution,
    finish,
    queue,
    sync,
)
from test_delivery_manual_review import make_task, review, review_current
from test_delivery_workbench import command, env as delivery_env

env = delivery_env
bridge = delivery_bridge


def current(client, tid):
    return client.get(f"/api/v1/delivery/tasks/{tid}/delivery-submissions/current")


def history(client, tid, **params):
    return client.get(f"/api/v1/delivery/tasks/{tid}/delivery-submissions", params=params)


def detail(client, tid, sid):
    return client.get(f"/api/v1/delivery/tasks/{tid}/delivery-submissions/{sid}")


def report(client, tid, **changes):
    response = current(client, tid)
    assert response.status_code == 200, response.text
    basis = response.json()
    return {"task_id": tid, "task_basis": basis["task_basis"],
        "definition_digest": basis["definition_digest"], "native_boundary_digest": basis["native_boundary_digest"],
        "source": {"kind": "tool", "name": "External development tool", "url": ""},
        "summary": "Implemented the exact requested behavior and attached the reported checks.",
        "artifacts": [{"id": "checks", "title": "Reported behavior checks", "content": "Search by exact title passed.", "url": "", "sha256": None}],
        "criteria": [{"source": item["source"], "index": item["index"], "text_digest": item["text_digest"],
                      "result": "met", "evidence_ids": ["checks"]} for item in basis["criteria"]],
        "tests": [{"id": "search", "title": "Search exact title", "status": "passed", "evidence_ids": ["checks"]}], **changes}


def request(client, action, payload, *, key, version=None):
    if version is None:
        version = client.get("/api/v1/delivery/workspace").json()["version"]
    return {"action": action, "payload": payload, "idempotency_key": key, "expected_version": version}


def submit(client, tid, *, key="external-report", payload=None):
    body = request(client, "task.delivery.submit", payload or report(client, tid), key=key)
    response = client.post("/api/v1/delivery/commands", json=body)
    assert response.status_code == 200, response.text
    return response.json(), body


def decide(client, tid, sid, *, decision="accept", key="external-review"):
    response = detail(client, tid, sid)
    assert response.status_code == 200, response.text
    fixed = response.json()
    body = request(client, "task.delivery.review", {"task_id": tid, "submission_id": sid,
        "submission_digest": fixed["submission"]["digest"], "task_basis": fixed["task_basis"],
        "native_boundary_digest": fixed["native_boundary_digest"], "decision": decision,
        "comment": "Inspected the original report and verified every current acceptance condition."}, key=key, version=fixed["version"])
    return client.post("/api/v1/delivery/commands", json=body), body


def task_fact(sessions, tid):
    with sessions() as db:
        return next(row for row in capture_facts(db, db.get(models.Project, "project"))["tasks"] if row["id"] == tid)


def counts(sessions):
    with sessions() as db:
        return {table.name: db.scalar(select(func.count()).select_from(table)) for table in models.Base.metadata.sorted_tables}


def revoke_runtime_membership(bridge):
    _client, sessions, store, principal, workspace, _rid, _task = bridge
    latest = store.get(principal, "", "workspaces", workspace["id"])
    store.mutate(principal, "", "workspaces", workspace["id"], operation="test.membership.revoke", key="revoke-runtime-reader",
        request={}, trace="test", expected=latest["version"],
        transform=lambda row: {"data": {**row["data"], "owner": "different-owner", "members": []}})
    with sessions() as db:
        db.get(models.User, "lead").role = "tenant_admin"
        db.commit()


def test_report_is_a_candidate_until_one_real_human_review_and_all_consumers_agree(env):
    client, sessions, _ = env
    task = make_task(client)
    ack, original = submit(client, task["id"])
    sid = ack["result"]["submission_id"]
    assert ack["resource"] == {"kind": "task_submission", "id": sid}
    assert set(ack["result"]) == {"task_ids", "submission_id", "submission_digest", "issue_id"}
    assert ack["result"]["issue_id"] is None
    assert "workspace" not in ack and "tasks" not in ack
    assert task_fact(sessions, task["id"])["status"] == "awaiting_review"
    with sessions() as db:
        assert db.get(models.Task, task["id"]).status != "completed"
        assert db.scalar(select(func.count()).select_from(models.DeliveryTaskReview)) == 0
        saved = db.scalar(select(Submission))
        assert saved.original["command_key"] == original["idempotency_key"]
    accepted, review_request = decide(client, task["id"], sid)
    assert accepted.status_code == 200, accepted.text
    result = accepted.json()["result"]
    assert accepted.json()["resource"] == {"kind": "task_review", "id": result["review_id"]}
    assert set(result) == {"task_ids", "submission_id", "submission_digest", "decision_id", "review_id", "issue_id"}
    assert task_fact(sessions, task["id"])["status"] == "verified_completed"
    exported = client.get("/api/v1/delivery/workspace").json()
    full_task = next(row for row in exported["tasks"] if row["id"] == task["id"])
    assert full_task["status"] == "completed"
    scope = client.get("/api/v1/delivery/quality", params={"requirement_ids": task["req_id"]})
    assert scope.status_code == 200, scope.text
    quality_task = next(row for row in scope.json()["tasks"] if row["id"] == task["id"])
    assert quality_task["verified"] and quality_task["proof"]["source"] == "external"
    assert quality_task["proof"]["id"] == sid and quality_task["proof"]["run_id"] is None
    artifacts = [a for r in exported["requirements"] if r["id"] == task["req_id"] for a in r["flow"]["artifacts"] if a.get("submission_id") == sid]
    assert len(artifacts) == 1 and artifacts[0]["evidence_source"] == "reported_human_reviewed"
    reviews = client.get(f"/api/v1/delivery/tasks/{task['id']}/reviews").json()
    assert reviews["reviews"][0]["id"] == result["review_id"]
    assert reviews["reviews"][0]["source"] == "external"
    assert reviews["reviews"][0]["submission_id"] == sid
    for body, expected in ((original, ack), (review_request, accepted.json())):
        replay = client.post("/api/v1/delivery/commands", json=body)
        assert replay.status_code == 200 and replay.json()["replayed"]
        assert replay.json()["result"] == expected["result"]
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(Submission)) == 1
        assert db.scalar(select(func.count()).select_from(Decision)) == 1
        assert db.scalar(select(func.count()).select_from(models.DeliveryTaskReview)) == 1
    duplicate, _body = decide(client, task["id"], sid, key="second-human-decision")
    assert duplicate.status_code == 409


@pytest.mark.parametrize("status", ["failed", "unknown", "not_run", "skipped", "empty"])
def test_reported_nonpassing_or_missing_checks_never_become_acceptance(env, status):
    client, sessions, _ = env
    task = make_task(client)
    payload = report(client, task["id"])
    payload["tests"] = [] if status == "empty" else [{**payload["tests"][0], "status": status}]
    ack, _ = submit(client, task["id"], payload=payload)
    sid = ack["result"]["submission_id"]
    fixed = detail(client, task["id"], sid).json()
    assert fixed["permissions"]["can_review"] and not fixed["permissions"]["can_accept"]
    response, _ = decide(client, task["id"], sid)
    assert response.status_code == 409
    assert task_fact(sessions, task["id"])["status"] != "verified_completed"
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(Decision)) == 0


def test_failed_criteria_issue_reused_by_request_changes_and_real_requirement_pool(env):
    client, sessions, _ = env
    task = make_task(client)
    payload = report(client, task["id"])
    payload["criteria"][0]["result"] = "not_met"
    payload["tests"][0]["status"] = "failed"
    ack, original = submit(client, task["id"], payload=payload)
    sid, issue_id = ack["result"]["submission_id"], ack["result"]["issue_id"]
    assert issue_id
    changed, _ = decide(client, task["id"], sid, decision="request_changes")
    assert changed.status_code == 200, changed.text
    assert changed.json()["result"]["issue_id"] == issue_id
    replay = client.post("/api/v1/delivery/commands", json=original)
    assert replay.status_code == 200 and replay.json()["result"]["issue_id"] == issue_id
    issue = client.get(f"/api/v1/delivery/issues/{issue_id}")
    assert issue.status_code == 200, issue.text
    evidence = [row for row in issue.json()["evidence"] if row["kind"] == "submission"]
    assert len(evidence) == 1 and evidence[0]["target"]["submission_id"] == sid
    assert "not_met" in evidence[0]["excerpt"] and "failed" in evidence[0]["excerpt"]
    promoted = command(client, "issue.promote", {"issue_id": issue_id, "acceptance_criteria": ["The reported external failure has a regression check"]})
    assert promoted.status_code == 200, promoted.text
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(models.Issue)) == 1
        workspace = db.get(models.DeliveryWorkspace, "project")
        assert any(flow.get("source_issue_id") == issue_id for flow in workspace.data["flows"].values())


@pytest.mark.parametrize("accepted", [False, True])
def test_definition_round_trip_permanently_invalidates_original_and_review(env, accepted):
    client, sessions, _ = env
    task = make_task(client)
    ack, _ = submit(client, task["id"])
    sid = ack["result"]["submission_id"]
    if accepted:
        response, _ = decide(client, task["id"], sid)
        assert response.status_code == 200, response.text
    for description in ("Changed scope", task.get("description") or ""):
        response = command(client, "task.update", {"id": task["id"], "description": description})
        assert response.status_code == 200, response.text
    original = detail(client, task["id"], sid)
    assert original.status_code == 200, original.text
    assert original.json()["submission"]["invalidated"]
    assert not original.json()["permissions"]["can_review"]
    assert task_fact(sessions, task["id"])["status"] != "verified_completed"
    with sessions() as db:
        assert db.scalar(select(Submission)).invalidated_reason == "submission_definition_changed"
        if accepted:
            assert db.scalar(select(models.DeliveryTaskReview)).invalidated


def test_new_original_supersedes_pending_report_without_adding_task_truth(env):
    client, sessions, _ = env
    task = make_task(client)
    first, _ = submit(client, task["id"])
    second, _ = submit(client, task["id"], key="replacement-report")
    page = history(client, task["id"]).json()
    assert page["total"] == 2
    assert [item["status"] for item in page["items"]] == ["awaiting_review", "invalidated"]
    assert page["items"][1]["invalidated_reason"] == "submission_superseded"
    invalid, _ = decide(client, task["id"], first["result"]["submission_id"])
    assert invalid.status_code == 409
    accepted, _ = decide(client, task["id"], second["result"]["submission_id"])
    assert accepted.status_code == 200, accepted.text
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(models.Task)) == 1
        assert db.scalar(select(func.count()).select_from(models.DeliveryTaskReview)) == 1


def test_history_is_paged_thin_reader_bound_and_pure_read(env):
    client, sessions, actor = env
    task = make_task(client)
    for index in range(3):
        submit(client, task["id"], key=f"report-{index}")
    before = counts(sessions)
    first = history(client, task["id"], limit=2)
    assert first.status_code == 200, first.text
    second = history(client, task["id"], limit=2, cursor=first.json()["next_cursor"])
    assert second.status_code == 200 and len(second.json()["items"]) == 1
    assert first.json()["total"] == 3 and second.json()["next_cursor"] is None
    assert not {"payload", "definition", "original", "native_boundary"} & first.json()["items"][0].keys()
    sid = first.json()["items"][0]["id"]
    assert current(client, task["id"]).status_code == 200
    assert detail(client, task["id"], sid).status_code == 200
    assert counts(sessions) == before
    actor["id"] = "reader"
    assert history(client, task["id"], limit=2, cursor=first.json()["next_cursor"]).status_code == 422
    own = current(client, task["id"])
    assert own.status_code == 200 and not own.json()["can_submit"]
    fixed = detail(client, task["id"], sid).json()
    assert not fixed["permissions"]["can_review"]


@pytest.mark.parametrize("kind", ["original", "decision", "invalidation_restore"])
def test_fixed_original_and_real_review_link_reject_orm_and_core_writes(env, kind):
    client, sessions, _ = env
    task = make_task(client)
    ack, _ = submit(client, task["id"])
    sid = ack["result"]["submission_id"]
    if kind == "decision":
        response, _ = decide(client, task["id"], sid)
        assert response.status_code == 200
    if kind == "invalidation_restore":
        assert command(client, "task.update", {"id": task["id"], "description": "Changed"}).status_code == 200
    with sessions() as db:
        with pytest.raises(HTTPException) as error:
            if kind == "decision":
                db.execute(update(Decision).where(Decision.project_id == "project", Decision.submission_id == sid).values(comment="Rewrite accepted history"))
            elif kind == "invalidation_restore":
                db.execute(update(Submission).where(Submission.project_id == "project", Submission.id == sid).values(invalidated=False, invalidated_at=None, invalidated_reason=""))
            else:
                db.scalar(select(Submission)).summary = "Rewrite original summary"
                db.flush()
        assert error.value.detail["code"] == "task_submission_immutable"
        db.rollback()


def test_deleted_task_keeps_exact_original_but_no_review_write(env):
    client, sessions, _ = env
    task = make_task(client)
    ack, _ = submit(client, task["id"])
    with sessions() as db:
        db.execute(delete(models.Task).where(models.Task.id == task["id"]))
        db.commit()
    original = detail(client, task["id"], ack["result"]["submission_id"])
    assert original.status_code == 200, original.text
    assert original.json()["definition"]["title"] == task["title"]
    assert original.json()["task_basis"] is None and not original.json()["permissions"]["can_review"]
    assert history(client, task["id"]).status_code == 200
    assert current(client, task["id"]).status_code == 404


def test_native_history_requires_positive_closure_and_same_task_can_use_external_delivery(bridge):
    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    intent = queue(bridge)
    blocked = current(client, task["id"])
    assert blocked.status_code == 200 and not blocked.json()["can_submit"]
    cancelled = cancel_execution(client, intent["id"])
    assert cancelled.status_code == 200, cancelled.text
    eligible = current(client, task["id"])
    assert eligible.status_code == 200 and eligible.json()["can_submit"], eligible.text
    assert not review_current(client, task["id"]).json()["current"]["eligible"]
    assert review(client, task["id"]).status_code == 409
    ack, _ = submit(client, task["id"])
    accepted, _ = decide(client, task["id"], ack["result"]["submission_id"])
    assert accepted.status_code == 200, accepted.text
    assert task_fact(sessions, task["id"])["status"] == "verified_completed"
    with sessions() as db:
        assert db.get(models.Task, task["id"]).status == "completed"


def test_completed_run_without_positive_stop_remains_blocked_for_takeover(bridge):
    client, _sessions, store, principal, workspace, _rid, task = bridge
    entry = sync(bridge, queue(bridge))
    finish(bridge, entry)
    entry = sync(bridge, entry)
    reviewed = command(client, "execution.review", {"id": entry["id"], "decision": "request_changes",
        "comment": "External work will address this delivery", "run_version": entry["run_version"]})
    assert reviewed.status_code == 200, reviewed.text
    run = store.get(principal, workspace["id"], "runs", entry["run_id"])
    def remove_positive_stop(row):
        data = deepcopy(row["data"])
        data.pop("stop_request", None)
        data["node_results"] = {"tests": {"succeeded": True, "exit_code": 0, "stdout": "Untrusted report"}}
        return {"data": data}
    store.mutate(principal, workspace["id"], "runs", run["id"], operation="test.unproven.stop", key="unproven-stop",
        request={}, trace="test", expected=run["version"], transform=remove_positive_stop)
    response = current(client, task["id"])
    assert response.status_code == 200 and not response.json()["can_submit"]
    assert "submission_native_stop_unverified" in {item["code"] for item in response.json()["reasons"]}


def test_native_original_runtime_read_revocation_blocks_history_and_detail(bridge):
    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    intent = queue(bridge)
    assert cancel_execution(client, intent["id"]).status_code == 200
    ack, _ = submit(client, task["id"])
    revoke_runtime_membership(bridge)
    assert history(client, task["id"]).status_code == 403
    assert detail(client, task["id"], ack["result"]["submission_id"]).status_code == 403


@pytest.mark.parametrize("positive_stop", [True, False])
def test_failed_terminal_run_needs_positive_stop_before_external_repair(bridge, positive_stop):
    client, _sessions, store, principal, workspace, _rid, task = bridge
    entry = sync(bridge, queue(bridge))
    finish(bridge, entry, success=False)
    entry = sync(bridge, entry)
    assert entry["status"] == "failed"
    if not positive_stop:
        run = store.get(principal, workspace["id"], "runs", entry["run_id"])
        def uncertain(row):
            data = deepcopy(row["data"])
            data.pop("stop_request", None)
            data["node_results"] = {"tests": {"succeeded": False, "exit_code": 1, "stdout": "Failure without physical stop evidence"}}
            return {"data": data}
        store.mutate(principal, workspace["id"], "runs", run["id"], operation="test.failed.uncertain", key="failed-uncertain",
            request={}, trace="test", expected=run["version"], transform=uncertain)
    response = current(client, task["id"])
    assert response.status_code == 200, response.text
    assert response.json()["can_submit"] is positive_stop, response.text
    if positive_stop:
        ack, _ = submit(client, task["id"])
        assert ack["result"]["submission_id"]
    else:
        assert "submission_native_stop_unverified" in {item["code"] for item in response.json()["reasons"]}


def test_pending_external_report_cannot_borrow_legacy_manual_approval(env):
    client, sessions, _ = env
    task = make_task(client)
    payload = report(client, task["id"], tests=[])
    ack, _ = submit(client, task["id"], payload=payload)
    old = review_current(client, task["id"])
    assert old.status_code == 200 and not old.json()["current"]["eligible"]
    assert "manual_review_external_submission" in {item["code"] for item in old.json()["current"]["reasons"]}
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 409
    assert review(client, task["id"]).status_code == 409
    with sessions() as db:
        with pytest.raises(HTTPException) as error:
            db.execute(update(models.Task).where(models.Task.id == task["id"]).values(status="completed"))
        assert error.value.detail["code"] == "task_submission_review_required"
        db.rollback()
    assert task_fact(sessions, task["id"])["status"] == "awaiting_review"
    assert detail(client, task["id"], ack["result"]["submission_id"]).json()["permissions"]["can_accept"] is False


def test_legacy_external_review_history_cannot_bypass_runtime_read_revocation(bridge):
    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    intent = queue(bridge)
    assert cancel_execution(client, intent["id"]).status_code == 200
    ack, _ = submit(client, task["id"])
    accepted, _ = decide(client, task["id"], ack["result"]["submission_id"])
    assert accepted.status_code == 200, accepted.text
    review_id = accepted.json()["result"]["review_id"]
    revoke_runtime_membership(bridge)
    assert client.get(f"/api/v1/delivery/tasks/{task['id']}/reviews").status_code == 403
    assert client.get(f"/api/v1/delivery/tasks/{task['id']}/reviews/{review_id}").status_code == 403
    assert review_current(client, task["id"]).status_code == 403


def test_every_native_execution_is_checked_even_when_latest_handoff_is_closed(bridge):
    client, _sessions, store, principal, workspace, _rid, task = bridge
    old = sync(bridge, queue(bridge))
    assert cancel_execution(client, old["id"]).status_code == 200
    latest = queue(bridge)
    assert cancel_execution(client, latest["id"]).status_code == 200
    run = store.get(principal, workspace["id"], "runs", old["run_id"])
    # A real persisted old-runtime fault must not disappear behind the latest E.
    store.mutate(principal, workspace["id"], "runs", run["id"], operation="test.old.runtime.open", key="old-runtime-open",
        request={}, trace="test", expected=run["version"], transform=lambda _row: {"status": "running"})
    response = current(client, task["id"])
    assert response.status_code == 200, response.text
    assert not response.json()["can_submit"]
    assert "submission_native_run_open" in {item["code"] for item in response.json()["reasons"]}


def test_exact_condition_digest_and_fixed_boundary_are_required(env):
    client, sessions, _ = env
    task = make_task(client)
    for field in ("condition", "native_boundary_digest", "definition_digest", "task_basis"):
        payload = report(client, task["id"])
        if field == "condition":
            payload["criteria"][0]["text_digest"] = "0" * 64
        else:
            payload[field] = "0" * 64
        body = request(client, "task.delivery.submit", payload, key="wrong-" + field)
        response = client.post("/api/v1/delivery/commands", json=body)
        assert response.status_code == 409, response.text
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(Submission)) == 0


def test_archived_project_retains_report_history_and_blocks_new_decisions(env):
    client, sessions, _ = env
    task = make_task(client)
    ack, _ = submit(client, task["id"])
    with sessions() as db:
        db.get(models.Project, "project").status = "archived"
        db.commit()
    original = detail(client, task["id"], ack["result"]["submission_id"])
    assert original.status_code == 200, original.text
    assert not original.json()["permissions"]["can_review"]
    assert not current(client, task["id"]).json()["can_submit"]
    assert history(client, task["id"]).status_code == 200
    response, _ = decide(client, task["id"], ack["result"]["submission_id"])
    assert response.status_code in {403, 409}


def failed_native(bridge):
    entry = sync(bridge, queue(bridge))
    finish(bridge, entry, success=False)
    return sync(bridge, entry)


def retry_preview(client, execution_id):
    response = client.post("/api/v1/delivery/execution-control-preview", json={
        "id": execution_id, "action": "execution.retry", "reason": "Review retry of this exact original"})
    assert response.status_code == 200, response.text
    return response.json()


def test_external_takeover_permanently_retires_old_native_retry_and_review(bridge):
    client, _sessions, _store, _principal, _workspace, _rid, task = bridge
    old = failed_native(bridge)
    assert retry_preview(client, old["id"])["allowed"]
    ack, _ = submit(client, task["id"])
    sid = ack["result"]["submission_id"]
    for accepted in (False, True):
        if accepted:
            decision, _ = decide(client, task["id"], sid)
            assert decision.status_code == 200, decision.text
        preview = retry_preview(client, old["id"])
        assert not preview["allowed"]
        assert "execution_external_takeover" in {item["code"] for item in preview["reasons"]}
        retry = command(client, "execution.retry", preview["payload"], version=preview["version"])
        assert retry.status_code == 409
        old_review = command(client, "execution.review", {"id": old["id"], "decision": "request_changes",
            "run_version": old["run_version"], "comment": "Cannot replace the submitted external original through old native review"})
        assert old_review.status_code == 409
        assert old_review.json()["detail"]["code"] == "execution_external_takeover"
    assert command(client, "task.update", {"id": task["id"], "description": "Changed current scope"}).status_code == 200
    assert detail(client, task["id"], sid).json()["submission"]["invalidated"]
    assert not retry_preview(client, old["id"])["allowed"]
    observation = client.get(f"/api/v1/delivery/executions/{old['id']}/observations")
    assert observation.status_code == 200, observation.text
    assert not observation.json()["permissions"]["can_start"]
    assert not observation.json()["permissions"]["can_review"]


def test_unknown_accepted_native_control_blocks_external_report_instead_of_double_execution(bridge):
    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    old = failed_native(bridge)
    payload = report(client, task["id"])
    preview = retry_preview(client, old["id"])
    assert preview["allowed"]
    original = request(client, "execution.retry", preview["payload"], key="unknown-old-retry", version=preview["version"])
    accepted = client.post("/api/v1/delivery/commands", json=original)
    assert accepted.status_code == 200, accepted.text
    # Model a lost caller response by keeping its original pending operation;
    # no worker or physical process runs and no second command identity is made.
    candidate = current(client, task["id"])
    assert candidate.status_code == 200 and not candidate.json()["can_submit"]
    assert "submission_native_control_pending" in {item["code"] for item in candidate.json()["reasons"]}
    attempted = client.post("/api/v1/delivery/commands", json=request(client, "task.delivery.submit", payload, key="report-during-unknown-retry"))
    assert attempted.status_code == 409
    replay = client.post("/api/v1/delivery/commands", json=original)
    assert replay.status_code == 200 and replay.json()["replayed"]
    assert replay.json()["result"] == accepted.json()["result"]
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(Submission)) == 0


def test_explicit_reopen_can_create_new_handoff_and_new_native_acceptance_supersedes_external(bridge):
    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    old = failed_native(bridge)
    ack, _ = submit(client, task["id"])
    sid = ack["result"]["submission_id"]
    accepted, _ = decide(client, task["id"], sid)
    assert accepted.status_code == 200, accepted.text
    from test_delivery_execution import queue_payload

    blocked = command(client, "execution.queue", queue_payload(bridge))
    assert blocked.status_code == 409
    reopened = command(client, "task.update", {"id": task["id"], "status": "in_progress"})
    assert reopened.status_code == 200, reopened.text
    latest = queue(bridge)
    assert latest["id"] != old["id"] and latest["status"] == "pending_dispatch"
    assert detail(client, task["id"], sid).json()["submission"]["invalidated"]
    current_native = sync(bridge, latest)
    finish(bridge, current_native, success=True)
    current_native = sync(bridge, current_native)
    reviewed = command(client, "execution.review", {"id": current_native["id"], "decision": "accept",
        "run_version": current_native["run_version"], "comment": "Verified the new native delivery after explicit reopen"})
    assert reviewed.status_code == 200, reviewed.text
    assert task_fact(sessions, task["id"])["status"] == "verified_completed"
    quality = client.get("/api/v1/delivery/quality", params={"requirement_ids": task["req_id"]})
    assert quality.status_code == 200, quality.text
    proof = next(row for row in quality.json()["tasks"] if row["id"] == task["id"])
    assert proof["verified"] and proof["proof"]["source"] == "native"
    assert proof["proof"]["execution_id"] == current_native["id"]
    assert not retry_preview(client, old["id"])["allowed"]
    old_sync = command(client, "execution.sync", {"id": old["id"]})
    assert old_sync.status_code == 200, old_sync.text
    assert task_fact(sessions, task["id"])["status"] == "verified_completed"
    assert next(row for row in old_sync.json()["tasks"] if row["id"] == task["id"])["status"] == "completed"


def test_reopen_invalidates_decided_submission_and_cannot_restore_old_approval(env):
    client, sessions, _ = env
    task = make_task(client)
    ack, _ = submit(client, task["id"])
    sid = ack["result"]["submission_id"]
    accepted, _ = decide(client, task["id"], sid)
    assert accepted.status_code == 200, accepted.text
    assert command(client, "task.update", {"id": task["id"], "status": "in_progress"}).status_code == 200
    original = detail(client, task["id"], sid)
    assert original.status_code == 200, original.text
    assert original.json()["submission"]["status"] == "invalidated"
    assert original.json()["submission"]["invalidated_reason"] == "submission_review_invalidated"
    assert history(client, task["id"]).json()["items"][0]["status"] == "invalidated"
    assert task_fact(sessions, task["id"])["status"] != "verified_completed"
    assert command(client, "task.update", {"id": task["id"], "status": "completed"}).status_code == 200
    assert detail(client, task["id"], sid).json()["submission"]["status"] == "invalidated"
    assert task_fact(sessions, task["id"])["status"] == "recorded_completed"
    with sessions() as db:
        assert db.scalar(select(models.DeliveryTaskReview)).invalidated


def test_sync_of_retired_failed_native_preserves_external_acceptance_and_issue_count(bridge):
    client, sessions, _store, _principal, _workspace, _rid, task = bridge
    old = failed_native(bridge)
    ack, _ = submit(client, task["id"])
    sid = ack["result"]["submission_id"]
    accepted, _ = decide(client, task["id"], sid)
    assert accepted.status_code == 200, accepted.text
    with sessions() as db:
        issue_count = db.scalar(select(func.count()).select_from(models.Issue))
    for _iteration in range(2):
        response = command(client, "execution.sync", {"id": old["id"]})
        assert response.status_code == 200, response.text
        assert task_fact(sessions, task["id"])["status"] == "verified_completed"
        original = detail(client, task["id"], sid)
        assert original.status_code == 200 and original.json()["submission"]["status"] == "accepted"
    with sessions() as db:
        assert db.get(models.Task, task["id"]).status == "completed"
        assert db.scalar(select(func.count()).select_from(models.Issue)) == issue_count
        assert not db.scalar(select(models.DeliveryTaskReview)).invalidated
