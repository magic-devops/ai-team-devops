"""Discussion provenance participates in the original business transaction."""

import pytest
from sop_manager.routers import sql_models as m
from sop_manager.routers.sql_models import Task
from test_delivery_execution import bridge, queue, sync  # noqa: F401
from test_delivery_workbench import env as delivery_env

env = delivery_env


@pytest.fixture
def collaboration(env):
    from sop_manager.routers.delivery_discussions import router

    env[0].app.include_router(router)
    return env


def checked(response):
    assert response.status_code == 200, response.text
    return response.json()


def source(client, kind, entity_id, *, key="chosen", body="Reviewed conclusion", refs=None):
    created = checked(client.post("/api/v1/delivery/discussions", json={
        "subject_kind": kind, "subject_id": entity_id, "title": "A concrete decision",
        "body": body, "refs": refs or [], "idempotency_key": key + "-thread",
    }))
    resolved = checked(client.post(f"/api/v1/delivery/discussions/{created['thread_id']}/resolve", json={
        "expected_thread_version": created["thread_version"], "message_id": created["message_id"],
        "message_revision": created["message_revision"], "idempotency_key": key + "-resolve",
    }))
    return {"thread_id": created["thread_id"], "expected_thread_version": resolved["thread_version"],
            "resolution_event_id": resolved["event_id"], "message_id": created["message_id"],
            "message_revision": created["message_revision"]}


def request_body(client, action, payload, *, selected=None, key="business-selected-source"):
    value = {"action": action, "payload": payload, "expected_version": checked(client.get("/api/v1/delivery/context"))["version"],
             "idempotency_key": key}
    if selected is not None:
        value["source_reference"] = selected
    return value


def sources(client, kind, entity_id):
    return checked(client.get("/api/v1/delivery/sources", params={"target_kind": kind, "target_id": entity_id}))["items"]


def create_requirement(client):
    body = request_body(client, "requirement.create", {"title": "Search", "description": "Original scope",
                         "acceptance_criteria": ["A real result is returned"]}, key="create-original-requirement")
    return checked(client.post("/api/v1/delivery/commands", json=body))["resource"]["id"]


def test_missing_source_cannot_silently_apply_a_business_edit(env):
    client, sessions, _ = env
    with sessions() as db:
        db.add(Task(id="source-target", project_id="project", tenant_id="tenant", title="Original", description="Unchanged"))
        db.commit()
    version = client.get("/api/v1/delivery/context").json()["version"]
    response = client.post(
        "/api/v1/delivery/commands",
        json={
            "action": "task.update",
            "expected_version": version,
            "idempotency_key": "missing-source-original-edit",
            "payload": {"id": "source-target", "description": "Adopted text"},
            "source_reference": {
                "thread_id": "missing-thread",
                "expected_thread_version": 1,
                "resolution_event_id": "missing-resolution",
                "message_id": "missing-message",
                "message_revision": 1,
            },
        },
    )
    assert response.status_code == 404, response.text
    with sessions() as db:
        assert db.get(Task, "source-target").description == "Unchanged"


def test_task_adoption_keeps_original_result_and_snapshot_after_a_new_reply(collaboration):
    client, sessions, _ = collaboration
    with sessions() as db:
        db.add(Task(id="T", project_id="project", tenant_id="tenant", title="Task", description="Original"))
        db.commit()
    selected = source(client, "task", "T", body="Use independently checked data")
    body = request_body(client, "task.update", {"id": "T", "description": "Use independently checked data"}, selected=selected)
    first = checked(client.post("/api/v1/delivery/commands", json=body))
    assert first["resource"] == {"kind": "task", "id": "T"}
    link = sources(client, "task", "T")[0]
    assert link["source_snapshot"]["message"]["body"] == "Use independently checked data"
    assert link["applied_fields"] == ["description"] and link["source_changed"] is False
    checked(client.post(f"/api/v1/delivery/discussions/{selected['thread_id']}/messages", json={
        "body": "A new question requires another decision", "idempotency_key": "later-reply",
    }))
    replay = checked(client.post("/api/v1/delivery/commands", json=body))
    assert replay["replayed"] and replay["resource"] == first["resource"]
    links = sources(client, "task", "T")
    assert len(links) == 1 and links[0]["source_changed"]
    assert links[0]["source_snapshot"] == link["source_snapshot"]
    stale = {**body, "expected_version": replay["version"], "idempotency_key": "new-request-stale-source"}
    assert client.post("/api/v1/delivery/commands", json=stale).status_code == 409
    with sessions() as db:
        assert db.get(Task, "T").description == "Use independently checked data"
        assert db.query(m.DeliverySourceLink).count() == 1
    changed = {**body, "source_reference": {**selected, "message_id": "other-message"}}
    assert client.post("/api/v1/delivery/commands", json=changed).status_code == 409


def test_requirement_adoption_uses_the_existing_fixed_change_preview(collaboration):
    client, sessions, _ = collaboration
    requirement_id = create_requirement(client)
    selected = source(client, "requirement", requirement_id, body="Search within authorized records")
    detail = checked(client.get(f"/api/v1/delivery/requirements/{requirement_id}"))["requirement"]
    preview = checked(client.post(f"/api/v1/delivery/requirements/{requirement_id}/change-preview", json={
        "requirement_basis": detail["basis"], "changes": {"description": "Search within authorized records"},
    }))
    body = request_body(client, "requirement.update", {"id": requirement_id, "description": "Search within authorized records",
                        "requirement_basis": preview["requirement_basis"], "change_preview_basis": preview["preview_basis"]}, selected=selected)
    result = checked(client.post("/api/v1/delivery/commands", json=body))
    link = sources(client, "requirement", requirement_id)[0]
    assert link["target_id"] == result["resource"]["id"] == requirement_id
    assert link["applied_fields"] == ["description"]
    with sessions() as db:
        assert db.get(m.Requirement, requirement_id).description == "Search within authorized records"


def test_task_plan_records_each_actual_task_once_and_replays_the_same_ids(collaboration):
    client, sessions, _ = collaboration
    requirement_id = create_requirement(client)
    selected = source(client, "requirement", requirement_id, body="Implement and test as separate tasks")
    payload = {"requirement_id": requirement_id, "items": [
        {"key": "implement", "title": "Implement behavior", "acceptance_criteria": ["Behavior exists"]},
        {"key": "test", "title": "Verify behavior", "acceptance_criteria": ["An independent check passes"], "depends_on": ["implement"]},
    ]}
    body = request_body(client, "tasks.plan", payload, selected=selected)
    first = checked(client.post("/api/v1/delivery/commands", json=body))
    task_ids = first["result"]["task_ids"]
    assert len(task_ids) == 2
    for task_id in task_ids:
        link = sources(client, "task", task_id)[0]
        assert link["source_id"] == selected["resolution_event_id"]
        assert link["business_event_id"] and link["applied_fields"] == ["items"]
    thread_links = checked(client.get(f"/api/v1/delivery/discussions/{selected['thread_id']}/links"))["items"]
    assert {link["target_id"] for link in thread_links} == set(task_ids)
    replay = checked(client.post("/api/v1/delivery/commands", json=body))
    assert replay["replayed"] and replay["result"]["task_ids"] == task_ids
    with sessions() as db:
        assert db.query(Task).count() == 2 and db.query(m.DeliverySourceLink).count() == 2


def test_issue_promotion_keeps_unique_requirement_and_does_not_close_the_issue(collaboration):
    client, sessions, _ = collaboration
    with sessions() as db:
        db.add(m.Issue(id="I", project_id="project", tenant_id="tenant", title="Observed failure", description="Recorded evidence", status="open"))
        db.commit()
    selected = source(client, "issue", "I", body="Verify the repaired behavior")
    body = request_body(client, "issue.promote", {"issue_id": "I", "acceptance_criteria": ["Verify the repaired behavior"]}, selected=selected)
    first = checked(client.post("/api/v1/delivery/commands", json=body))
    requirement_id = first["resource"]["id"]
    assert sources(client, "requirement", requirement_id)[0]["target_id"] == requirement_id
    again = {**body, "expected_version": first["version"], "idempotency_key": "second-explicit-promotion"}
    assert checked(client.post("/api/v1/delivery/commands", json=again))["resource"]["id"] == requirement_id
    with sessions() as db:
        assert db.query(m.Requirement).count() == 1
        assert db.get(m.Issue, "I").status == "open"


def test_reviewed_diagnosis_adoption_keeps_both_diagnosis_and_discussion_sources(collaboration):
    client, sessions, _ = collaboration
    with sessions() as db:
        db.add(m.Issue(id="I", project_id="project", tenant_id="tenant", title="Observed failure", description="A recorded failing result", status="open"))
        db.commit()
    detail = checked(client.get("/api/v1/delivery/issues/I"))
    diagnosis = checked(client.post("/api/v1/delivery/issues/I/diagnoses", json={
        "expected_version": detail["version"], "issue_basis": detail["issue_basis"],
        "selected_evidence_ids": ["issue:I"], "generator": "rules", "idempotency_key": "fixed-rules-diagnosis",
    }))
    assert diagnosis["status"] == "succeeded" and diagnosis["generator"] == "rules"
    selected = source(client, "issue", "I", body="Review the proposal and verify the repaired result")
    body = request_body(client, "issue.diagnosis.adopt", {
        **diagnosis["result"]["requirement"], "issue_id": "I", "diagnosis_id": diagnosis["id"],
        "issue_basis": detail["issue_basis"], "comment": "Reviewed against the recorded evidence",
    }, selected=selected)
    result = checked(client.post("/api/v1/delivery/commands", json=body))
    requirement_id = result["result"]["requirement_id"]
    assert sources(client, "requirement", requirement_id)[0]["source_id"] == selected["resolution_event_id"]
    with sessions() as db:
        assert db.get(m.Issue, "I").status == "open"
        flow = db.get(m.DeliveryWorkspace, "project").data["flows"][requirement_id]
        assert flow["source_diagnosis"]["id"] == diagnosis["id"]
    replay = checked(client.post("/api/v1/delivery/commands", json=body))
    assert replay["replayed"] and replay["result"]["requirement_id"] == requirement_id


def test_adoption_link_failure_rolls_back_business_and_original_key_can_retry(collaboration, monkeypatch):
    from sop_manager.routers import delivery_discussion_sources as provenance

    client, sessions, _ = collaboration
    with sessions() as db:
        db.add(Task(id="T", project_id="project", tenant_id="tenant", title="Task", description="Original"))
        db.commit()
    selected = source(client, "task", "T")
    body = request_body(client, "task.update", {"id": "T", "description": "Selected change"}, selected=selected)
    original = provenance.record_adoption_links

    def fail_after_append(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("Injected failure after provenance append")

    with monkeypatch.context() as patched:
        patched.setattr(provenance, "record_adoption_links", fail_after_append)
        with pytest.raises(RuntimeError, match="Injected failure"):
            client.post("/api/v1/delivery/commands", json=body)
    with sessions() as db:
        assert db.get(Task, "T").description == "Original"
        assert db.query(m.DeliverySourceLink).count() == 0
        assert db.query(m.DeliveryReceipt).count() == 0
        assert db.query(m.DeliveryEvent).count() == 0
        assert db.get(m.DeliveryWorkspace, "project") is None
    saved = checked(client.post("/api/v1/delivery/commands", json=body))
    assert not saved["replayed"] and len(sources(client, "task", "T")) == 1


def test_original_adoption_replay_checks_exact_runtime_scope_without_roster_scan(bridge, monkeypatch):  # noqa: F811 - pytest fixture injection
    from sop_manager.routers.delivery_discussions import router

    client, sessions, store, _, _, _, task = bridge
    client.app.include_router(router)
    entry = sync(bridge, queue(bridge))
    with sessions() as db:
        db.get(m.User, "lead").role = "tenant_admin"
        db.commit()
    reference = checked(client.get(
        f"/api/v1/delivery/discussion-references/execution/{entry['id']}", params={"field": "summary"},
    ))["reference"]
    selection = {key: reference[key] for key in ("kind", "id", "field", "source_content_basis")}
    selected = source(client, "task", task["id"], refs=[selection])
    body = request_body(client, "task.update", {"id": task["id"], "description": "Reviewed runtime context"}, selected=selected)
    first = checked(client.post("/api/v1/delivery/commands", json=body))
    original_list = store.list

    def forbid_roster(principal, workspace, kind, **options):
        if kind == "workspaces":
            pytest.fail("Original-scope replay enumerated the runtime workspace roster")
        return original_list(principal, workspace, kind, **options)

    monkeypatch.setattr(store, "list", forbid_roster)
    assert len(sources(client, "task", task["id"])) == 1
    replay = checked(client.post("/api/v1/delivery/commands", json=body))
    assert replay["replayed"] and replay["resource"] == first["resource"]
