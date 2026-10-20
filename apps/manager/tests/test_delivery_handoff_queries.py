"""Actual HTTP/canonical SQL handoff read definitions; execution is deferred."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from hermes_core.models import CoreError
from sqlalchemy import delete
from sop_manager.routers.sql_models import DeliveryQueryFact, DeliveryQueryState, DeliveryWorkspace, Project, ProjectMember, User
from test_delivery_workbench import env  # noqa: F401
from test_delivery_execution import bridge, cancel_execution, queue_payload  # noqa: F401
from test_delivery_query import statements


def accepted(bridge):
    client = bridge[0]
    version = client.get("/api/v1/delivery/workspace").json()["version"]
    answer = client.post("/api/v1/delivery/commands", json={
        "action": "execution.queue", "payload": queue_payload(bridge), "expected_version": version,
        "idempotency_key": f"handoff-query-accept-{version}",
    })
    assert answer.status_code == 200, answer.text
    ack = answer.json()
    assert ack["result"] is None
    assert ack["resource"]["kind"] == "execution"
    assert ack["affected_refs"] == [ack["resource"]]
    return ack["resource"]["id"], ack


def detail(client, execution_id):
    return client.get(f"/api/v1/delivery/executions/{execution_id}/handoff")


def test_accepted_handoff_detail_is_canonical_bounded_and_has_no_runtime_side_effects(bridge):
    client, sessions, store, principal, workspace, _, task = bridge
    execution_id, ack = accepted(bridge)
    with sessions() as db:
        before_version = db.get(DeliveryWorkspace, "project").version
    with statements(sessions) as sql:
        response = detail(client, execution_id)
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["project_id"], body["execution_id"], body["task_id"]) == ("project", execution_id, task["id"])
    h = body["handoff"]
    assert h["execution_id"] == execution_id and h["workspace_id"] == workspace["id"]
    assert h["state"] == "accepted" and h["attempt"] == 0 and h["revision"] >= 1
    assert h["run_id"] is None and h["runtime_task_id"] is None and h["error"] is None
    assert h["accepted_at"].endswith("Z") and h["updated_at"].endswith("Z")
    assert not {"original", "request_digest", "lease_owner", "requested_by", "target_snapshot"} & h.keys()
    assert not store.list(principal, workspace["id"], "tasks")
    assert not store.list(principal, workspace["id"], "runs")
    observation = client.get(f"/api/v1/delivery/executions/{execution_id}/observations")
    assert observation.status_code == 200, observation.text
    assert observation.json()["permissions"]["can_sync"] is False
    assert observation.json()["permissions"]["can_start"] is False
    with sessions() as db:
        assert db.get(DeliveryWorkspace, "project").version == before_version == ack["version"]
    reads = [value.lower() for value in sql if value.lstrip().lower().startswith("select")]
    assert not any("delivery_execution_handoffs.original" in value for value in reads)
    assert not any("delivery_workspaces.data" in value for value in reads)
    assert detail(client, execution_id).json() == body


def test_handoff_reads_and_task_locator_do_not_require_disposable_query_facts(bridge):
    client, sessions, _, _, _, _, task = bridge
    execution_id, _ = accepted(bridge)
    with sessions() as db:
        for model in (DeliveryQueryFact, DeliveryQueryState):
            db.execute(delete(model).where(model.tenant_id == "tenant", model.project_id == "project"))
        db.commit()
    assert detail(client, execution_id).status_code == 200
    page = client.get(f"/api/v1/delivery/tasks/{task['id']}/execution-handoffs")
    assert page.status_code == 200, page.text
    assert page.json()["items"][0]["execution_id"] == execution_id
    assert page.json()["task_id"] == task["id"] and page.json()["total"] == 1


def test_handoff_runtime_read_access_is_required_without_granting_execute(bridge):
    client, sessions, store, principal, workspace, _, task = bridge
    execution_id, _ = accepted(bridge)
    with sessions() as db:
        db.get(User, "lead").role = "developer"
        db.add(ProjectMember(project_id="project", user_id="lead", role="developer"))
        db.commit()
    assert detail(client, execution_id).status_code == 200
    store.mutate(principal, "", "workspaces", workspace["id"], operation="test.membership.revoke",
        key="handoff-read-revoke", request={}, trace="test", expected=workspace["version"],
        transform=lambda row: {"data": {**row["data"], "owner": "another-actor", "members": []}})
    response = detail(client, execution_id)
    assert response.status_code == 403 and "handoff-" not in response.text
    page = client.get(f"/api/v1/delivery/tasks/{task['id']}/execution-handoffs")
    assert page.status_code == 200
    assert page.json()["items"] == [] and page.json()["total"] == 0


def test_handoff_identity_is_not_readable_through_another_project_header(bridge):
    client = bridge[0]
    execution_id, _ = accepted(bridge)
    response = client.get(f"/api/v1/delivery/executions/{execution_id}/handoff", headers={"X-Project-Id": "foreign-project"})
    assert response.status_code in {403, 404}
    assert execution_id not in response.text


def test_detached_old_admin_identity_cannot_override_current_membership(bridge):
    from sop_manager.routers.delivery_execution_handoff_query import handoff_detail
    from sop_manager.routers.delivery_query_read import reference_page

    client, sessions, store, principal, workspace, _, _ = bridge
    execution_id, _ = accepted(bridge)
    stale = SimpleNamespace(id="lead", tenant_id="tenant", role="super_admin", status="active")
    with sessions() as db:
        db.get(User, "lead").role = "developer"
        db.add(ProjectMember(project_id="project", user_id="lead", role="developer"))
        db.commit()
    store.mutate(principal, "", "workspaces", workspace["id"], operation="test.handoff.revoke",
        key="detached-old-admin", request={}, trace="test", expected=workspace["version"],
        transform=lambda value: {"data": {**value["data"], "owner": "another-actor", "members": []}})
    with sessions() as db, pytest.raises(HTTPException) as failure:
        handoff_detail(db, db.get(Project, "project"), stale, execution_id, store)
    assert failure.value.status_code == 403
    with sessions() as db:
        page = reference_page(db, db.get(Project, "project"), stale, {"kind": "execution"}, limit=20, store=store)
    assert page["items"] == [] and page["total"] == 0


def test_revoked_account_cannot_read_canonical_handoff_or_its_original(bridge):
    client, sessions = bridge[:2]
    execution_id, _ = accepted(bridge)
    with sessions() as db:
        db.get(User, "lead").status = "disabled"
        db.commit()
    response = detail(client, execution_id)
    assert response.status_code in {401, 403}
    assert execution_id not in response.text


def test_task_handoff_cursor_is_bound_to_project_task_limit_and_current_visibility(bridge):
    client, sessions, _, _, _, _, task = bridge
    ids = []
    for _ in range(3):
        execution_id, _ = accepted(bridge)
        ids.append(execution_id)
        assert cancel_execution(client, execution_id).status_code == 200
    path = f"/api/v1/delivery/tasks/{task['id']}/execution-handoffs"
    first = client.get(path, params={"limit": 1}).json()
    assert first["total"] == 3 and first["items"][0]["execution_id"] == ids[-1]
    cursor = first["next_cursor"]
    second = client.get(path, params={"limit": 1, "cursor": cursor})
    assert second.status_code == 200 and second.json()["items"][0]["execution_id"] == ids[-2]
    assert client.get(path, params={"limit": 2, "cursor": cursor}).status_code == 422
    assert client.get("/api/v1/delivery/tasks/other-task/execution-handoffs", params={"limit": 1, "cursor": cursor}).status_code == 422
    assert client.get(path, params={"limit": 1, "cursor": cursor + "corrupt"}).status_code == 422
    with sessions() as db:
        db.get(User, "lead").role = "developer"
        db.add(ProjectMember(project_id="project", user_id="lead", role="developer"))
        db.commit()
    assert client.get(path, params={"limit": 1, "cursor": cursor}).status_code == 422
    assert client.get(path, params={"limit": 1}).status_code == 200


@pytest.mark.parametrize("limit", [0, 101])
def test_task_handoff_page_rejects_unbounded_reads(bridge, limit):
    client, *_, task = bridge
    assert client.get(f"/api/v1/delivery/tasks/{task['id']}/execution-handoffs", params={"limit": limit}).status_code == 422


def test_execution_references_attach_live_handoff_error_without_waiting_for_a_business_write(bridge, monkeypatch):
    from hermes_core.managed_handoff import ManagedHandoff
    from sop_manager.routers.delivery_execution_handoff import handoff_once

    client, sessions = bridge[:2]
    execution_id, _ = accepted(bridge)
    def unavailable(*args, **kwargs):
        raise CoreError("handoff_unavailable", "Planner temporarily unavailable", 503)
    monkeypatch.setattr(ManagedHandoff, "dispatch", unavailable)
    handoff_once(client.app, sessions=sessions)
    h = detail(client, execution_id).json()["handoff"]
    assert h["state"] == "retry_wait" and h["attempt"] == 1
    page = client.get("/api/v1/delivery/references", params={"kind": "execution", "limit": 20})
    assert page.status_code == 200, page.text
    item = next(item for item in page.json()["items"] if item["id"] == execution_id)
    assert item["data"]["handoff"] == h
    assert "original" not in item["data"]["handoff"]
