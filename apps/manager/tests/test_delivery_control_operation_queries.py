"""Real HTTP/SQL control-read definitions; runtime execution is deferred."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import delete

from sop_manager.routers.sql_models import DeliveryQueryFact, DeliveryQueryState, DeliveryWorkspace, Project, ProjectMember, User
from test_delivery_execution import bridge  # noqa: F401
from test_delivery_handoff_queries import accepted
from test_delivery_query import statements
from test_delivery_workbench import env  # noqa: F401


def path(execution_id, operation_id=""):
    base = f"/api/v1/delivery/executions/{execution_id}/control-operations"
    return f"{base}/{operation_id}" if operation_id else base


def accept_control(bridge):
    execution_id, _ = accepted(bridge)
    client = bridge[0]
    preview = client.post("/api/v1/delivery/execution-control-preview", json={
        "id": execution_id, "action": "execution.cancel", "reason": "Close this exact pending dispatch",
    })
    assert preview.status_code == 200, preview.text
    fixed = preview.json()
    original = {"action": "execution.cancel", "payload": fixed["payload"],
        "expected_version": fixed["version"], "idempotency_key": "query-accepted-cancel"}
    answer = client.post("/api/v1/delivery/commands", json=original)
    assert answer.status_code == 200, answer.text
    ack = answer.json()
    assert set(ack["result"]) == {"control_operation_id", "request_digest"}
    assert ack["resource"] == {"kind": "execution", "id": execution_id}
    assert ack["affected_refs"] == [ack["resource"]]
    return execution_id, ack, original


def close_control(client, execution_id, ack):
    current = client.get(path(execution_id)).json()
    response = client.post("/api/v1/delivery/commands", json={
        "action": "execution.control.close", "expected_version": current["version"],
        "idempotency_key": "query-close-original", "payload": {"id": execution_id,
            "control_operation_id": ack["result"]["control_operation_id"],
            "request_digest": ack["result"]["request_digest"], "reason": "End this unperformed control"},
    })
    assert response.status_code == 200, response.text
    return response.json()


def test_control_ack_is_durable_acceptance_and_get_selects_only_public_facts(bridge):
    client, sessions, store, principal, workspace, _, task = bridge
    execution_id, ack, original = accept_control(bridge)
    operation_id = ack["result"]["control_operation_id"]
    with statements(sessions) as sql:
        response = client.get(path(execution_id, operation_id))
    assert response.status_code == 200, response.text
    body = response.json()
    assert (body["project_id"], body["execution_id"], body["task_id"]) == ("project", execution_id, task["id"])
    c = body["operation"]
    assert c["id"] == operation_id and c["request_digest"] == ack["result"]["request_digest"]
    assert c["state"] == "accepted" and c["attempt"] == 0 and c["revision"] == 1
    assert c["run_id"] is None and c["run_attempt"] is None and c["launch"] is None and c["outcome"] is None
    assert c["permissions"] == {"can_close": True}
    assert c["accepted_at"].endswith("Z") and c["updated_at"].endswith("Z")
    assert not {"original", "effect", "requested_by", "lease_owner", "fence"} & c.keys()
    assert not store.list(principal, workspace["id"], "runs")
    reads = [value.lower() for value in sql if value.lstrip().lower().startswith("select")]
    assert not any("delivery_execution_control_operations.original" in value or
        "delivery_execution_control_operations.effect" in value or "delivery_workspaces.data" in value for value in reads)
    assert not any(value.lstrip().lower().startswith(("insert", "update", "delete")) for value in sql)
    replay = client.post("/api/v1/delivery/commands", json=original)
    assert replay.status_code == 200, replay.text
    assert replay.json()["result"] == ack["result"] and replay.json()["applied_version"] == ack["applied_version"]
    with sessions() as db:
        assert db.get(DeliveryWorkspace, "project").version == ack["applied_version"]


def test_canonical_empty_and_accepted_control_reads_survive_missing_derived_index(bridge):
    client, sessions = bridge[:2]
    execution_id, ack, _ = accept_control(bridge)
    with sessions() as db:
        for model in (DeliveryQueryFact, DeliveryQueryState):
            db.execute(delete(model).where(model.tenant_id == "tenant", model.project_id == "project"))
        db.commit()
    page = client.get(path(execution_id))
    assert page.status_code == 200, page.text
    assert page.json()["items"][0]["id"] == ack["result"]["control_operation_id"]
    assert client.get(path(execution_id, ack["result"]["control_operation_id"])).status_code == 200


def test_pending_handoff_without_control_has_authorized_empty_page(bridge):
    execution_id, _ = accepted(bridge)
    response = bridge[0].get(path(execution_id))
    assert response.status_code == 200, response.text
    assert response.json()["items"] == [] and response.json()["total"] == 0
    assert response.json()["next_cursor"] is None and response.json()["limit"] == 20


def test_close_acceptance_preserves_target_identity_and_disables_duplicate_close(bridge):
    client = bridge[0]
    execution_id, ack, _ = accept_control(bridge)
    close_ack = close_control(client, execution_id, ack)
    target = client.get(path(execution_id, ack["result"]["control_operation_id"])).json()["operation"]
    closing = client.get(path(execution_id, close_ack["result"]["control_operation_id"])).json()["operation"]
    assert target["permissions"] == {"can_close": False} and target["state"] == "accepted"
    assert closing["action"] == "execution.control.close" and closing["target_operation_id"] == target["id"]
    assert closing["state"] == "accepted" and closing["permissions"] == {"can_close": False}


def test_control_cursor_is_bound_to_execution_limit_reader_and_upper_window(bridge):
    client, sessions = bridge[:2]
    execution_id, ack, _ = accept_control(bridge)
    close_ack = close_control(client, execution_id, ack)
    first = client.get(path(execution_id), params={"limit": 1}).json()
    assert first["total"] == 2 and first["items"][0]["id"] == close_ack["result"]["control_operation_id"]
    cursor = first["next_cursor"]
    second = client.get(path(execution_id), params={"limit": 1, "cursor": cursor})
    assert second.status_code == 200, second.text
    assert second.json()["items"][0]["id"] == ack["result"]["control_operation_id"]
    assert second.json()["next_cursor"] is None
    assert client.get(path(execution_id), params={"limit": 2, "cursor": cursor}).status_code == 422
    assert client.get(path(execution_id), params={"limit": 1, "cursor": cursor + "x"}).status_code == 422
    with sessions() as db:
        db.get(User, "lead").role = "developer"
        db.add(ProjectMember(project_id="project", user_id="lead", role="developer"))
        db.commit()
    assert client.get(path(execution_id), params={"limit": 1, "cursor": cursor}).status_code == 422


def test_detached_old_admin_does_not_bypass_current_workspace_or_project_role(bridge):
    from sop_manager.routers.delivery_execution_control_operation_query import control_operation_detail

    client, sessions, store, principal, workspace = bridge[:5]
    execution_id, ack, _ = accept_control(bridge)
    old = SimpleNamespace(id="lead", tenant_id="tenant", role="super_admin", status="active")
    with sessions() as db:
        db.get(User, "lead").role = "viewer"
        db.add(ProjectMember(project_id="project", user_id="lead", role="viewer"))
        db.commit()
    response = client.get(path(execution_id, ack["result"]["control_operation_id"]))
    assert response.status_code == 200 and response.json()["operation"]["permissions"] == {"can_close": False}
    store.mutate(principal, "", "workspaces", workspace["id"], operation="test.control.workspace.revoke",
        key="control-workspace-revoke", request={}, trace="test", expected=workspace["version"],
        transform=lambda value: {"data": {**value["data"], "owner": "another", "members": []}})
    with sessions() as db, pytest.raises(HTTPException) as failure:
        control_operation_detail(db, db.get(Project, "project"), old, execution_id, ack["result"]["control_operation_id"], store)
    assert failure.value.status_code == 403


@pytest.mark.parametrize("limit", [0, 101])
def test_unbounded_control_page_is_rejected(bridge, limit):
    execution_id, _, _ = accept_control(bridge)
    assert bridge[0].get(path(execution_id), params={"limit": limit}).status_code == 422


def test_control_identity_cannot_cross_project_or_execution(bridge):
    client = bridge[0]
    execution_id, ack, _ = accept_control(bridge)
    assert client.get(path(execution_id, "missing-control")).status_code == 404
    assert client.get(path("foreign-execution", ack["result"]["control_operation_id"])).status_code == 404
    response = client.get(path(execution_id, ack["result"]["control_operation_id"]), headers={"X-Project-Id": "other"})
    assert response.status_code in {403, 404}
    assert execution_id not in response.text


def test_control_routes_and_close_payload_are_part_of_actual_openapi(bridge):
    schema = bridge[0].app.openapi()
    base = "/api/v1/delivery/executions/{execution_id}/control-operations"
    for route in (base, base + "/{operation_id}"):
        assert "get" in schema["paths"][route]
        assert any(value["name"] == "X-Project-Id" for value in schema["paths"][route]["get"]["parameters"])
    command = schema["components"]["schemas"]["Command"]
    assert "execution.control.close" in command["properties"]["action"]["enum"]
    contracts = schema["paths"]["/api/v1/delivery/commands"]["post"]["x-delivery-command-contracts"]
    assert set(contracts) == {"execution.start", "execution.retry", "execution.cancel", "execution.approval", "execution.control.close"}
    close = contracts["execution.control.close"]["payload"]
    assert close["additionalProperties"] is False
    assert set(close["required"]) == set(close["properties"]) == {"id", "control_operation_id", "request_digest", "reason"}
    assert close["properties"]["request_digest"]["pattern"] == "^[0-9a-f]{64}$"
    for contract in contracts.values():
        result = contract["result"]
        assert result["additionalProperties"] is False
        assert set(result["required"]) == set(result["properties"]) == {"control_operation_id", "request_digest"}
        assert contract["result_semantics"] == "durable_acceptance"
