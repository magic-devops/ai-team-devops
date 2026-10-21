"""Actual inbox consumers of fixed external reports and held work; unrun definitions."""

from copy import deepcopy

import pytest
from sqlalchemy import select, update

from sop_manager.routers import sql_models as models
from sop_manager.routers.delivery_external_work_order_model import DeliveryExternalWorkOrder as Order
from test_delivery_execution import bridge as execution_bridge, cancel_execution, queue
from test_delivery_manual_review import make_task
from test_delivery_task_submissions import counts, decide, report, submit
from test_delivery_workbench import command, env as delivery_env
from test_external_work_orders import claim, create_order, detail, mutate

env = delivery_env
bridge = execution_bridge


def inbox(client, *, scope="team", category="all", **params):
    response = client.get("/api/v1/delivery/inbox", params={"scope": scope, "category": category, **params})
    assert response.status_code == 200, response.text
    return response.json()


def task_item(body, task_id):
    return next(item for item in body["items"] if item["kind"] == "task" and item["resource_id"] == task_id)


def test_report_without_native_execution_enters_exact_external_acceptance_and_leaves_after_review(env):
    client, _sessions, _actor = env
    task = make_task(client)
    submitted, _ = submit(client, task["id"])
    sid = submitted["result"]["submission_id"]
    pending = inbox(client, category="acceptance")
    item = task_item(pending, task["id"])
    assert item["acceptance_kind"] == "external" and item["status"] == "awaiting_review"
    assert item["target"]["submission_id"] == sid and item["target"]["work_order_id"] is None
    accepted, _ = decide(client, task["id"], sid)
    assert accepted.status_code == 200, accepted.text
    assert not any(item["resource_id"] == task["id"] for item in inbox(client, category="acceptance")["items"])


def test_report_after_closed_native_history_uses_external_source_instead_of_old_execution(bridge):
    client, _sessions, _store, _principal, _workspace, _rid, task = bridge
    intent = queue(bridge)
    cancelled = cancel_execution(client, intent["id"])
    assert cancelled.status_code == 200, cancelled.text
    submitted, _ = submit(client, task["id"])
    item = task_item(inbox(client, category="acceptance"), task["id"])
    assert item["acceptance_kind"] == "external"
    assert item["target"]["submission_id"] == submitted["result"]["submission_id"]
    assert item["target"]["work_order_id"] is None


def test_held_order_remains_work_and_reported_blocker_until_explicit_stop_and_link(env):
    client, _sessions, _actor = env
    task = make_task(client)
    created, _ = create_order(client, task["id"])
    wid = created["result"]["work_order_id"]
    claim(client, wid)
    blocked, _ = mutate(client, wid, "progress", percent=None, status="blocked", message="Private log must stay in the exact order.")
    assert blocked.status_code == 200, blocked.text
    item = task_item(inbox(client), task["id"])
    assert set(item["categories"]) == {"work", "blocked"} and item["status"] == "blocked"
    assert item["target"]["work_order_id"] == wid and item["target"]["submission_id"] is None
    assert "Private log" not in str(item)
    running, _ = mutate(client, wid, "progress", percent=None, status="running", message="Reported work resumed.")
    assert running.status_code == 200, running.text
    submitted, _ = submit(client, task["id"])
    sid = submitted["result"]["submission_id"]
    held = task_item(inbox(client), task["id"])
    assert held["categories"] == ["work"] and held["acceptance_kind"] is None
    assert held["target"]["work_order_id"] == wid and held["target"]["submission_id"] is None
    reported, _ = mutate(client, wid, "report", submission_id=sid,
        submission_digest=submitted["result"]["submission_digest"], stopped_attestation=True)
    assert reported.status_code == 200, reported.text
    item = task_item(inbox(client, category="acceptance"), task["id"])
    assert item["acceptance_kind"] == "external" and item["target"]["submission_id"] == sid
    assert item["target"]["work_order_id"] is None


@pytest.mark.parametrize("state", ["queued", "claimed", "cancel_requested"])
def test_invalidated_held_order_survives_recorded_task_cancellation_for_cleanup(env, state):
    client, sessions, _actor = env
    task = make_task(client)
    created, _ = create_order(client, task["id"])
    wid = created["result"]["work_order_id"]
    if state != "queued":
        claim(client, wid)
    if state == "cancel_requested":
        requested, _ = mutate(client, wid, "cancel", comment="Await the actual claimant's stop confirmation.")
        assert requested.status_code == 200, requested.text
    # Generic SQL-backed writers retain the recorded cancellation. The scoped
    # observer must keep unresolved external ownership visible on the real GET.
    # Delivery's typed TaskEdit intentionally has no cancellation enum value.
    with sessions() as db:
        db.get(models.Task, task["id"]).status = "cancelled"
        db.commit()
    assert detail(client, wid)["work_order"]["invalidated"]
    item = task_item(inbox(client), task["id"])
    assert "work" in item["categories"] and "acceptance" not in item["categories"]
    assert item["target"]["work_order_id"] == wid and item["target"]["submission_id"] is None
    if state == "queued":
        stopped, _ = mutate(client, wid, "cancel", comment="Close the never-claimed original.")
    else:
        stopped, _ = mutate(client, wid, "release", stopped_attestation=True, comment="The original claimant explicitly stopped the work.")
    assert stopped.status_code == 200, stopped.text
    assert not any(item["kind"] == "task" and item["resource_id"] == task["id"] for item in inbox(client)["items"])


def test_request_changes_is_work_until_a_new_current_original_is_submitted(env):
    client, _sessions, _actor = env
    task = make_task(client)
    first, _ = submit(client, task["id"], key="attention-first-report")
    first_id = first["result"]["submission_id"]
    rejected, _ = decide(client, task["id"], first_id, decision="request_changes", key="attention-reject")
    assert rejected.status_code == 200, rejected.text
    item = task_item(inbox(client), task["id"])
    assert "work" in item["categories"] and "acceptance" not in item["categories"]
    assert item["acceptance_kind"] is None and item["target"]["submission_id"] == first_id
    second, _ = submit(client, task["id"], key="attention-corrected-report")
    item = task_item(inbox(client, category="acceptance"), task["id"])
    assert item["acceptance_kind"] == "external" and item["target"]["submission_id"] == second["result"]["submission_id"]
    assert item["target"]["submission_id"] != first_id


def test_invalidated_external_original_does_not_itself_become_an_external_acceptance_target(env):
    client, _sessions, _actor = env
    task = make_task(client)
    submitted, _ = submit(client, task["id"])
    changed = command(client, "task.update", {"id": task["id"], "description": "A different fixed delivery definition."})
    assert changed.status_code == 200, changed.text
    item = task_item(inbox(client), task["id"])
    assert item["acceptance_kind"] is None and "acceptance" not in item["categories"]
    assert item["target"]["submission_id"] is None and item["target"]["work_order_id"] is None
    assert submitted["result"]["submission_id"] not in str(item)


def test_current_manual_eligibility_allows_new_manual_review_without_borrowing_invalidated_external_evidence(env):
    client, _sessions, _actor = env
    task = make_task(client)
    submitted, _ = submit(client, task["id"])
    accepted, _ = decide(client, task["id"], submitted["result"]["submission_id"])
    assert accepted.status_code == 200, accepted.text
    changed = command(client, "task.update", {"id": task["id"], "description": "Revised scope requires fresh human evidence."})
    assert changed.status_code == 200, changed.text
    source = client.get(f"/api/v1/delivery/tasks/{task['id']}/review-current")
    assert source.status_code == 200 and source.json()["current"]["eligible"], source.text
    item = task_item(inbox(client, category="acceptance"), task["id"])
    assert item["acceptance_kind"] == "manual"
    assert item["target"]["submission_id"] is None and item["target"]["work_order_id"] is None


def test_current_claimant_has_personal_work_for_agent_owned_task_without_receiving_approval(env):
    client, sessions, actor = env
    task = make_task(client)
    saved = command(client, "member.save", {"name": "claimant", "kind": "agent", "tool": "codex"})
    assert saved.status_code == 200, saved.text
    responsible = next(member for member in saved.json()["members"] if member["name"] == "claimant")
    current_task = next(row for row in client.get("/api/v1/delivery/workspace").json()["tasks"] if row["id"] == task["id"])
    assigned = command(client, "task.update", {"id": task["id"], "owner_id": responsible["id"], "task_basis": current_task["basis"]})
    assert assigned.status_code == 200, assigned.text
    created, _ = create_order(client, task["id"])
    wid = created["result"]["work_order_id"]
    with sessions() as db:
        db.add(models.User(id="claimant", tenant_id="tenant", username="claimant", password_hash="not-a-login", role="developer", status="active"))
        db.flush()
        db.add(models.ProjectMember(project_id="project", user_id="claimant", role="developer"))
        db.commit()
    actor["id"] = "claimant"
    assert not any(item["resource_id"] == task["id"] for item in inbox(client, scope="mine")["items"])
    claim(client, wid)
    blocked, _ = mutate(client, wid, "progress", percent=None, status="blocked", message="Need an explicit answer before resuming.")
    assert blocked.status_code == 200, blocked.text
    personal = inbox(client, scope="mine")
    item = task_item(personal, task["id"])
    assert set(item["categories"]) == {"work", "blocked"} and item["owner_id"] == responsible["id"]
    assert personal["counts"]["approval"] == 0 and personal["counts"]["acceptance"] == 0
    running, _ = mutate(client, wid, "progress", percent=None, status="running", message="The blocker has been answered.")
    assert running.status_code == 200, running.text
    submitted, _ = submit(client, task["id"])
    reported, _ = mutate(client, wid, "report", submission_id=submitted["result"]["submission_id"],
        submission_digest=submitted["result"]["submission_digest"], stopped_attestation=True)
    assert reported.status_code == 200, reported.text
    assert inbox(client, scope="mine", category="acceptance")["items"] == []
    assert task_item(inbox(client, category="acceptance"), task["id"])["acceptance_kind"] == "external"
    assert client.get(f"/api/v1/delivery/tasks/{task['id']}/delivery-submissions/{submitted['result']['submission_id']}").json()["permissions"]["can_review"] is False

    actor["id"] = "lead"
    rejected, _ = decide(client, task["id"], submitted["result"]["submission_id"], decision="request_changes")
    assert rejected.status_code == 200, rejected.text
    issue_id = rejected.json()["result"]["issue_id"]
    actor["id"] = "claimant"
    personal = inbox(client, scope="mine")
    returned = task_item(personal, task["id"])
    assert set(returned["categories"]) == {"work", "blocked"}
    assert returned["target"]["submission_id"] == submitted["result"]["submission_id"]
    assert returned["target"]["work_order_id"] is None
    issue = next(item for item in personal["items"] if item["kind"] == "issue" and item["resource_id"] == issue_id)
    assert issue["categories"] == ["blocked"] and issue["target"]["issue_id"] == issue_id
    assert personal["counts"]["approval"] == personal["counts"]["acceptance"] == 0

    # The fixture overrides authentication. These reads exercise current roster
    # filtering, independently of production's active-account authentication.
    with sessions() as db:
        db.get(models.User, "claimant").status = "suspended"
        db.commit()
    assert not any(item["task_id"] == task["id"] for item in inbox(client, scope="mine")["items"])
    with sessions() as db:
        db.get(models.User, "claimant").status = "active"
        db.commit()
    assert task_item(inbox(client, scope="mine"), task["id"])["target"]["submission_id"] == submitted["result"]["submission_id"]

    actor["id"] = "lead"
    replacement, _ = create_order(client, task["id"], key="attention-rework-order")
    replacement_id = replacement["result"]["work_order_id"]
    actor["id"] = "claimant"
    assert not any(item["task_id"] == task["id"] for item in inbox(client, scope="mine")["items"])
    with sessions() as db:
        db.add(models.User(id="replacement-worker", tenant_id="tenant", username="replacement-worker", password_hash="not-a-login", role="developer", status="active"))
        db.flush()
        db.add(models.ProjectMember(project_id="project", user_id="replacement-worker", role="developer"))
        db.commit()
    actor["id"] = "replacement-worker"
    claim(client, replacement_id)
    replacement_mine = inbox(client, scope="mine")
    item = task_item(replacement_mine, task["id"])
    assert set(item["categories"]) == {"work", "blocked"} and item["owner_id"] == responsible["id"]
    assert item["target"]["work_order_id"] == replacement_id and item["target"]["submission_id"] is None
    assert any(item["kind"] == "issue" and item["resource_id"] == issue_id for item in replacement_mine["items"])
    assert replacement_mine["counts"]["approval"] == replacement_mine["counts"]["acceptance"] == 0
    actor["id"] = "claimant"
    assert not any(item["task_id"] == task["id"] for item in inbox(client, scope="mine")["items"])

    # The actor locator does not preserve old write rights or project access.
    with sessions() as db:
        db.get(models.ProjectMember, ("project", "replacement-worker")).role = "viewer"
        db.commit()
    actor["id"] = "replacement-worker"
    assert task_item(inbox(client, scope="mine"), task["id"])["target"]["work_order_id"] == replacement_id
    denied, _ = mutate(client, replacement_id, "progress", percent=None, status="running", message="A locator grants no write permission.")
    assert denied.status_code == 403
    with sessions() as db:
        db.delete(db.get(models.ProjectMember, ("project", "replacement-worker")))
        db.commit()
    assert client.get("/api/v1/delivery/inbox", params={"scope": "mine"}).status_code == 403
    assert client.get(f"/api/v1/delivery/work-orders/{replacement_id}").status_code == 403


def test_direct_reporter_rework_is_personal_but_an_accepted_or_invalidated_report_adds_no_work(env):
    client, sessions, actor = env
    task = make_task(client)
    with sessions() as db:
        db.add(models.User(id="reporter", tenant_id="tenant", username="reporter", password_hash="not-a-login", role="developer", status="active"))
        db.flush()
        db.add(models.ProjectMember(project_id="project", user_id="reporter", role="developer"))
        db.commit()
    actor["id"] = "reporter"
    payload = report(client, task["id"])
    payload["tests"][0]["status"] = "failed"
    submitted, _ = submit(client, task["id"], key="direct-reporter-first", payload=payload)
    reported_issue_id = submitted["result"]["issue_id"]
    pending = inbox(client, scope="mine")
    assert task_item(pending, task["id"])["categories"] == ["blocked"]
    assert any(item["kind"] == "issue" and item["resource_id"] == reported_issue_id for item in pending["items"])
    assert inbox(client, scope="mine", category="acceptance")["items"] == []
    actor["id"] = "lead"
    rejected, _ = decide(client, task["id"], submitted["result"]["submission_id"], decision="request_changes")
    assert rejected.status_code == 200, rejected.text
    issue_id = rejected.json()["result"]["issue_id"]
    assert issue_id == reported_issue_id
    actor["id"] = "reporter"
    personal = inbox(client, scope="mine")
    returned = task_item(personal, task["id"])
    assert set(returned["categories"]) == {"work", "blocked"}
    assert returned["target"]["submission_id"] == submitted["result"]["submission_id"]
    assert any(item["kind"] == "issue" and item["resource_id"] == issue_id for item in personal["items"])
    assert personal["counts"]["approval"] == personal["counts"]["acceptance"] == 0
    actor["id"] = "lead"
    changed = command(client, "task.update", {"id": task["id"], "description": "A revised scope invalidates the old reporter association."})
    assert changed.status_code == 200, changed.text
    actor["id"] = "reporter"
    assert not any(item["task_id"] == task["id"] for item in inbox(client, scope="mine")["items"])
    corrected, _ = submit(client, task["id"], key="direct-reporter-corrected")
    actor["id"] = "lead"
    accepted, _ = decide(client, task["id"], corrected["result"]["submission_id"], key="direct-reporter-accept")
    assert accepted.status_code == 200, accepted.text
    actor["id"] = "reporter"
    # Existing unresolved Issues remain visible; acceptance does not invent work
    # and is not an implicit Issue-resolution command.
    assert not any(item["task_id"] == task["id"] for item in inbox(client, scope="mine", category="work")["items"])
    assert inbox(client, scope="mine", category="acceptance")["items"] == []


def test_exact_attention_targets_are_scoped_pure_reads_with_unchanged_originals_and_generations(env):
    client, sessions, actor = env
    task = make_task(client)
    created, _ = create_order(client, task["id"])
    wid = created["result"]["work_order_id"]
    claim(client, wid)
    current_basis = client.get(f"/api/v1/delivery/tasks/{task['id']}/work-orders/current").json()["task_basis"]
    before_counts = counts(sessions)
    with sessions() as db:
        original = deepcopy(db.get(Order, wid).original)
        generation = db.scalar(select(models.DeliveryQueryState.generation).where(models.DeliveryQueryState.project_id == "project"))
    first = inbox(client)
    second = inbox(client, scope="mine")
    assert task_item(first, task["id"])["target"]["work_order_id"] == wid
    assert task_item(second, task["id"])["target"]["work_order_id"] == wid
    assert counts(sessions) == before_counts
    assert client.get(f"/api/v1/delivery/tasks/{task['id']}/work-orders/current").json()["task_basis"] == current_basis
    with sessions() as db:
        assert db.get(Order, wid).original == original
        assert db.scalar(select(models.DeliveryQueryState.generation).where(models.DeliveryQueryState.project_id == "project")) == generation
        db.add(models.Tenant(id="foreign-attention", name="Foreign", slug="foreign-attention"))
        db.flush()
        db.add(models.Project(id="foreign-attention", tenant_id="foreign-attention", name="Foreign"))
        db.commit()
    assert client.get("/api/v1/delivery/inbox", headers={"X-Project-Id": "foreign-attention"}).status_code == 403
    actor["id"] = "reader"
    assert client.get("/api/v1/delivery/inbox", headers={"X-Project-Id": "other"}).status_code == 403


def test_old_attention_schema_requires_explicit_rebuild_and_get_never_repairs_it(env):
    client, sessions, _actor = env
    task = make_task(client)
    submit(client, task["id"])
    with sessions() as db:
        db.connection().execute(update(models.DeliveryQueryState).where(models.DeliveryQueryState.project_id == "project").values(schema_version=5))
        db.commit()
    before = counts(sessions)
    rejected = client.get("/api/v1/delivery/inbox")
    assert rejected.status_code == 409 and rejected.json()["detail"]["code"] == "delivery_query_rebuild_required"
    assert counts(sessions) == before
    with sessions() as db:
        assert db.scalar(select(models.DeliveryQueryState.schema_version).where(models.DeliveryQueryState.project_id == "project")) == 5
    rebuilt = client.post("/api/v1/delivery/query/rebuild")
    assert rebuilt.status_code == 200, rebuilt.text
    assert task_item(inbox(client, category="acceptance"), task["id"])["acceptance_kind"] == "external"
