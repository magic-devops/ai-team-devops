"""Runtime metadata authorization remains current independently of SQL generations."""

import json
from copy import deepcopy

import pytest
from fastapi import HTTPException
from sop_manager.routers.delivery_query_commands import recorded_ack, replay_ack
from sop_manager.routers.delivery_service import initial_state
from sop_manager.routers.sql_models import DeliveryEvent, DeliveryWorkspace, Project, User
from test_delivery_issue_evidence import evidence as runtime_evidence
from test_delivery_issue_evidence import linked_run
from test_delivery_workbench import env as delivery_env

env = delivery_env
evidence = runtime_evidence


def test_execution_reference_page_filters_runtime_scope_before_total_and_rechecks_membership(env, evidence):
    client, sessions, actor = env
    _, store, principal, workspace, data, _ = evidence
    run, entry = linked_run(evidence, run_id="private-reference-run")
    client.app.state.hermes_store = store
    with sessions() as db:
        db.add(
            DeliveryWorkspace(
                tenant_id="tenant", project_id="project", version=0, data={**initial_state(), **data}
            )
        )
        db.commit()
    actor["id"] = "reader"
    denied = client.get("/api/v1/delivery/references", params={"kind": "execution"})
    assert denied.status_code == 200, denied.text
    assert denied.json()["total"] == 0 and denied.json()["items"] == []
    assert run["id"] not in denied.text
    assert client.get(f"/api/v1/delivery/executions/{entry['id']}").status_code == 403
    before = client.get("/api/v1/delivery/context").json()["query_generation"]
    workspace = store.mutate(
        principal,
        "",
        "workspaces",
        workspace["id"],
        operation="test.membership",
        key="allow-reader",
        request={},
        trace="test",
        expected=workspace["version"],
        transform=lambda value: {"data": {**value["data"], "members": ["reader"]}},
    )
    allowed = client.get("/api/v1/delivery/references", params={"kind": "execution"})
    assert allowed.status_code == 200, allowed.text
    assert allowed.json()["total"] == 1
    assert allowed.json()["items"][0]["data"]["run_id"] == run["id"]
    exact = client.get(f"/api/v1/delivery/executions/{entry['id']}")
    assert exact.status_code == 200, exact.text
    assert exact.json()["execution"]["id"] == entry["id"]
    assert client.get("/api/v1/delivery/context").json()["query_generation"] == before
    store.mutate(
        principal,
        "",
        "workspaces",
        workspace["id"],
        operation="test.membership",
        key="revoke-reader",
        request={},
        trace="test",
        expected=workspace["version"],
        transform=lambda value: {"data": {**value["data"], "members": []}},
    )
    revoked = client.get("/api/v1/delivery/references", params={"kind": "execution"})
    assert revoked.json()["total"] == 0
    assert "private-reference-run" not in json.dumps(revoked.json())


def test_execution_references_sort_all_matching_history_before_sql_page(env, evidence):
    client, sessions, _ = env
    _, store, _, _, data, _ = evidence
    _, entry = linked_run(evidence)
    entry.update(id="A-older", created_at="2026-10-01T00:00:00Z")
    newer = deepcopy(entry)
    newer.update(id="Z-newer", created_at="2026-10-02T00:00:00Z")
    data["executions"].append(newer)
    client.app.state.hermes_store = store
    with sessions() as db:
        db.add(
            DeliveryWorkspace(
                tenant_id="tenant", project_id="project", version=0, data={**initial_state(), **data}
            )
        )
        db.commit()
    response = client.get(
        "/api/v1/delivery/references", params={"kind": "execution", "sort": "created_desc", "limit": 1}
    )
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 2
    assert response.json()["items"][0]["id"] == "Z-newer"


def test_original_runtime_ack_result_requires_current_original_workspace_access(evidence):
    sessions, store, principal, workspace, _, _ = evidence
    with sessions() as db:
        project = db.get(Project, "project")
        original = recorded_ack(
            project, "execution.start", "execution", {"run_id": "original-private-run"}, 20
        )
        db.add(
            DeliveryEvent(
                id="original-runtime-ack",
                tenant_id="tenant",
                project_id="project",
                version=20,
                actor="lead",
                action="execution.start",
                resource_id="execution",
                data={"command_ack": original, "command_ack_access": [workspace["id"]]},
            )
        )
        db.commit()
        reader = db.get(User, "reader")
        with pytest.raises(HTTPException) as denied:
            replay_ack(db, project, 20, user=reader, store=store)
        assert denied.value.status_code == 403
        store.mutate(
            principal,
            "",
            "workspaces",
            workspace["id"],
            operation="test.membership",
            key="ack-reader",
            request={},
            trace="test",
            expected=workspace["version"],
            transform=lambda value: {"data": {**value["data"], "members": ["reader"]}},
        )
        result = replay_ack(db, project, 20, user=reader, store=store)
        assert result["result"] == {"run_id": "original-private-run"}
        assert result["applied_version"] == 20 and result["replayed"] is True
