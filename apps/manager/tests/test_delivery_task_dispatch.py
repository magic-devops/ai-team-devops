"""Real scoped task consumers use the canonical delivery graph and acceptance."""

import json

import pytest
from fastapi import HTTPException
from sop_manager.routers import delivery, sql_models, tasks
from sop_manager.routers.delivery_service import initial_state
from test_business_access import env as business_env
from test_business_access import headers

env = business_env


@pytest.mark.parametrize("entry", ["update", "bulk", "pull"])
def test_explicit_resume_clears_only_a_manual_status_block(env, entry):
    client, sessions = env
    with sessions() as db:
        db.get(sql_models.Task, "T-selected").status = "blocked"
        db.commit()
    if entry == "bulk":
        result = client.patch(
            "/api/v1/tasks/bulk", headers=headers(), json={"ids": ["T-selected"], "status": "in_progress"}
        )
    elif entry == "pull":
        result = client.post("/api/v1/tasks/T-selected:pull", headers=headers())
    else:
        result = client.patch("/api/v1/tasks/T-selected", headers=headers(), json={"status": "in_progress"})
    assert result.status_code == 200, result.text
    with sessions() as db:
        assert db.get(sql_models.Task, "T-selected").status == "in_progress"


def seed_chain(client, sessions, *, root_status="completed"):
    client.app.include_router(delivery.router)
    with sessions() as db:
        db.get(sql_models.ProjectMember, ("selected", "writer")).role = "project_admin"
        db.add_all(
            [
                sql_models.Task(
                    id="T-upstream",
                    tenant_id="team",
                    project_id="selected",
                    title="Manually implemented prerequisite",
                    status=root_status,
                    assigned_to="writer",
                ),
                sql_models.Task(
                    id="T-downstream",
                    tenant_id="team",
                    project_id="selected",
                    title="Follow-up implementation",
                    status="pending",
                    assigned_to="writer",
                ),
            ]
        )
        data = initial_state()
        data["task_owners"] = {"T-upstream": "user:writer", "T-downstream": "user:writer"}
        data["task_details"] = {
            "T-upstream": {"depends_on": []},
            "T-downstream": {"depends_on": ["T-upstream"]},
        }
        db.add(
            sql_models.DeliveryWorkspace(
                project_id="selected",
                tenant_id="team",
                version=3,
                data=data,
            )
        )
        db.commit()


@pytest.mark.parametrize("consumer", ["dispatch", "scheduler", "feed"])
def test_recorded_completion_does_not_unlock_delivery_dependency(env, consumer):
    client, sessions = env
    seed_chain(client, sessions)
    if consumer == "dispatch":
        response = client.post(
            "/api/v1/tasks/dispatch-plan",
            headers=headers(),
            json={"ids": ["T-downstream"], "include_blocked": True},
        )
        items = response.json()["items"]
    elif consumer == "scheduler":
        response = client.post(
            "/api/v1/tasks/scheduler/plan",
            headers=headers(),
            json={"ids": ["T-downstream"], "include_blocked": True},
        )
        items = response.json()["agent_packets"]
    else:
        response = client.get("/api/v1/tasks/agent-feed?include_blocked=true", headers=headers())
        items = response.json()["items"]
    assert response.status_code == 200, response.text
    item = next(item for item in items if item["task_id"] == "T-downstream")
    assert item["ready"] is False
    assert item["blocked_by"] == ["T-upstream"]


@pytest.mark.parametrize("auto_start", [True, False])
def test_retired_force_claim_cannot_claim_a_delivery_task(env, auto_start):
    client, sessions = env
    seed_chain(client, sessions)
    response = client.post(
        "/api/v1/tasks/agent-feed/claim",
        headers=headers(),
        json={
            "task_id": "T-downstream",
            "agent": "External agent",
            "force": True,
            "auto_start": auto_start,
        },
    )
    assert response.status_code == 404, response.text
    with sessions() as db:
        assert db.get(sql_models.Task, "T-downstream").status == "pending"
        assert db.get(sql_models.Task, "T-downstream").assigned_to == "writer"


def test_include_blocked_is_display_only_for_applied_dispatch(env):
    client, sessions = env
    seed_chain(client, sessions)
    response = client.post(
        "/api/v1/tasks/dispatch-plan",
        headers=headers(),
        json={
            "ids": ["T-downstream"],
            "include_blocked": True,
            "dry_run": False,
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["updated"] == 0
    assert response.json()["items"][0]["ready"] is False
    with sessions() as db:
        assert db.get(sql_models.Task, "T-downstream").assigned_to == "writer"


@pytest.mark.parametrize("entry", ["update", "bulk", "pull"])
def test_canonical_dependencies_cannot_be_bypassed_by_status_write(env, entry):
    client, sessions = env
    seed_chain(client, sessions)
    if entry == "update":
        response = client.patch(
            "/api/v1/tasks/T-downstream", headers=headers(), json={"status": "in_progress"}
        )
    elif entry == "bulk":
        response = client.patch(
            "/api/v1/tasks/bulk", headers=headers(), json={"ids": ["T-downstream"], "status": "in_progress"}
        )
    else:
        response = client.post("/api/v1/tasks/T-downstream:pull", headers=headers())
    assert response.status_code == 409, response.text
    with sessions() as db:
        assert db.get(sql_models.Task, "T-downstream").status == "pending"


def test_dependency_view_uses_canonical_graph_and_reads_without_writes(env):
    client, sessions = env
    seed_chain(client, sessions)
    with sessions() as db:
        before = {table.name: db.query(table).count() for table in sql_models.Base.metadata.sorted_tables}
    response = client.get("/api/v1/tasks/dependencies", headers=headers())
    assert response.status_code == 200, response.text
    edge = next(edge for edge in response.json()["edges"] if edge["target_id"] == "T-downstream")
    assert (edge["source_id"], edge["type"]) == ("T-upstream", "blocks")
    assert (
        next(node for node in response.json()["nodes"] if node["id"] == "T-downstream")[
            "is_dependency_blocked"
        ]
        is True
    )
    with sessions() as db:
        after = {table.name: db.query(table).count() for table in sql_models.Base.metadata.sorted_tables}
        assert before == after
        assert db.get(sql_models.DeliveryWorkspace, "selected").version == 3


def test_unscoped_helper_does_not_fall_back_to_environment_project(env, monkeypatch):
    _, sessions = env
    monkeypatch.setenv("PROJECT_ID", "selected")
    monkeypatch.setenv("TENANT_ID", "team")
    with pytest.raises(HTTPException) as result:
        tasks._dependency_snapshot([{"id": "T-example", "status": "pending"}], set())
    assert result.value.status_code == 400
    with sessions() as db:
        assert db.query(sql_models.DeliveryWorkspace).count() == 0


def test_manual_acceptance_unlocks_all_consumers_then_returned_work_blocks_again(env):
    client, sessions = env
    seed_chain(client, sessions)
    for decision in ("accept", "request_changes"):
        current_response = client.get("/api/v1/delivery/tasks/T-upstream/reviews", headers=headers())
        assert current_response.status_code == 200, current_response.text
        current = current_response.json()
        response = client.post(
            "/api/v1/delivery/commands",
            headers=headers(),
            json={
                "action": "task.manual_review",
                "expected_version": current["version"],
                "idempotency_key": f"manual-{decision}",
                "payload": {
                    "task_id": "T-upstream",
                    "decision": decision,
                    "basis": current["current"]["basis"],
                    "comment": "Reviewed the implementation against the objective",
                    "evidence_content": "Human inspection of the implementation and local test output",
                },
            },
        )
        assert response.status_code == 200, response.text
        ready = decision == "accept"
        dispatch = client.post(
            "/api/v1/tasks/dispatch-plan",
            headers=headers(),
            json={"ids": ["T-downstream"], "include_blocked": True},
        )
        scheduler = client.post(
            "/api/v1/tasks/scheduler/plan",
            headers=headers(),
            json={"ids": ["T-downstream"], "include_blocked": True},
        )
        feed = client.get("/api/v1/tasks/agent-feed?include_blocked=true", headers=headers())
        assert dispatch.json()["items"][0]["ready"] is ready
        assert scheduler.json()["agent_packets"][0]["ready"] is ready
        assert (
            next(item for item in feed.json()["items"] if item["task_id"] == "T-downstream")["ready"] is ready
        )


def test_obsolete_file_graph_does_not_change_canonical_dependencies(env):
    from pathlib import Path

    client, sessions = env
    seed_chain(client, sessions, root_status="pending")
    with sessions() as db:
        path = (
            Path(db.get(sql_models.Project, "selected").project_path)
            / ".sop-runtime"
            / "ai-memory"
            / "tasks_plan_ui_state.json"
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "dependencies": {
                    "T-downstream": [
                        {"target_id": "T-upstream", "type": "blocks"},
                        {"target_id": "T-selected", "type": "relates"},
                    ]
                }
            }
        ),
        encoding="utf-8",
    )
    response = client.get("/api/v1/tasks/dependencies", headers=headers())
    assert response.status_code == 200, response.text
    assert response.json()["cycle_ids"] == []
    assert [(edge["source_id"], edge["target_id"], edge["type"]) for edge in response.json()["edges"]] == [
        ("T-upstream", "T-downstream", "blocks")
    ]
    response = client.get("/api/v1/tasks/agent-feed?include_blocked=true", headers=headers())
    items = {item["task_id"]: item for item in response.json()["items"]}
    assert items["T-upstream"]["ready"] is True
    assert items["T-downstream"]["blocked_by"] == ["T-upstream"]


def test_task_consumers_cannot_see_other_projects_graph_or_provision_scope(env):
    client, sessions = env
    seed_chain(client, sessions)
    response = client.get("/api/v1/tasks/dependencies", headers=headers(project="other"))
    assert response.status_code == 200, response.text
    assert [node["id"] for node in response.json()["nodes"]] == ["T-other"]
    assert response.json()["edges"] == []
    assert client.get("/api/v1/tasks/dependencies", headers=headers(project="private")).status_code == 403
    assert client.get("/api/v1/tasks/dependencies", headers=headers(project="missing")).status_code == 404
    with sessions() as db:
        assert db.query(sql_models.DeliveryWorkspace).count() == 1
        assert db.query(sql_models.Project).count() == 3


def test_dependency_writes_use_the_versioned_delivery_command(env):
    client, sessions = env
    seed_chain(client, sessions)
    response = client.post(
        "/api/v1/tasks/T-downstream/dependencies",
        headers=headers(),
        json={"target_id": "T-upstream", "type": "blocks"},
    )
    assert response.status_code == 404
    response = client.delete("/api/v1/tasks/T-upstream/dependencies/T-downstream", headers=headers())
    assert response.status_code == 404
    with sessions() as db:
        assert db.get(sql_models.DeliveryWorkspace, "selected").version == 3
        assert db.get(sql_models.DeliveryWorkspace, "selected").data["task_details"]["T-downstream"][
            "depends_on"
        ] == ["T-upstream"]


def test_canonical_cycle_has_no_ready_claimable_member(env):
    from copy import deepcopy

    client, sessions = env
    seed_chain(client, sessions, root_status="pending")
    with sessions() as db:
        workspace = db.get(sql_models.DeliveryWorkspace, "selected")
        data = deepcopy(workspace.data)
        data["task_details"]["T-upstream"]["depends_on"] = ["T-downstream"]
        workspace.data = data
        db.commit()
    response = client.get("/api/v1/tasks/dependencies", headers=headers())
    assert response.status_code == 200, response.text
    assert response.json()["cycle_ids"] == ["T-downstream", "T-upstream"]
    assert all(row["blocked_by"] for row in response.json()["blocked_queue"])
    response = client.post(
        "/api/v1/tasks/agent-feed/claim", headers=headers(), json={"task_id": "T-upstream", "force": True}
    )
    assert response.status_code == 404, response.text


def test_explicit_plan_block_prevents_dispatch_and_claim_even_without_predecessor(env):
    from copy import deepcopy

    client, sessions = env
    seed_chain(client, sessions)
    with sessions() as db:
        workspace = db.get(sql_models.DeliveryWorkspace, "selected")
        data = deepcopy(workspace.data)
        data["task_details"]["T-downstream"] = {
            "depends_on": [],
            "blocked_reason": "Awaiting external credentials",
        }
        workspace.data = data
        db.commit()
    response = client.post(
        "/api/v1/tasks/dispatch-plan",
        headers=headers(),
        json={"ids": ["T-downstream"], "include_blocked": True},
    )
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["ready"] is False
    assert response.json()["items"][0]["blocked_by"] == ["delivery:blocked_reason"]
    graph = client.get("/api/v1/tasks/dependencies", headers=headers()).json()
    node = next(node for node in graph["nodes"] if node["id"] == "T-downstream")
    assert node["ready"] is False
    assert node["blocking_reason"] == "Awaiting external credentials"
    assert node["blocked_by"] == ["delivery:blocked_reason"]
    response = client.post(
        "/api/v1/tasks/agent-feed/claim", headers=headers(), json={"task_id": "T-downstream", "force": True}
    )
    assert response.status_code == 404, response.text


def test_missing_or_foreign_predecessor_blocks_without_reading_foreign_evidence(env):
    from copy import deepcopy

    client, sessions = env
    seed_chain(client, sessions)
    with sessions() as db:
        db.add(
            sql_models.Task(
                id="T-private",
                tenant_id="foreign",
                project_id="private",
                title="Secret foreign scope",
                status="completed",
            )
        )
        workspace = db.get(sql_models.DeliveryWorkspace, "selected")
        data = deepcopy(workspace.data)
        data["task_details"]["T-downstream"]["depends_on"] = ["T-private"]
        workspace.data = data
        db.commit()
    response = client.post(
        "/api/v1/tasks/scheduler/plan",
        headers=headers(),
        json={"ids": ["T-downstream"], "include_blocked": True},
    )
    assert response.status_code == 200, response.text
    assert response.json()["agent_packets"][0]["blocked_by"] == ["T-private"]
    assert "Secret foreign scope" not in response.text
    graph = client.get("/api/v1/tasks/dependencies", headers=headers())
    assert graph.status_code == 200, graph.text
    node = next(node for node in graph.json()["nodes"] if node["id"] == "T-downstream")
    assert node["is_dependency_blocked"] is True
    assert node["blocked_by"] == ["T-private"]
    edge = next(edge for edge in graph.json()["edges"] if edge["target_id"] == "T-downstream")
    assert edge["source_title"] == ""
    assert "Secret foreign scope" not in graph.text


def test_dependency_reader_rejects_an_active_scope_with_mismatched_tenant(env):
    from pathlib import Path

    from sop_manager.path_config import reset_request_scope, set_request_scope
    from sop_manager.routers.delivery_dependencies import scoped_dependencies

    _, sessions = env
    with sessions() as db:
        path = Path(db.get(sql_models.Project, "selected").project_path)
    tokens = set_request_scope("foreign", "selected", path)
    try:
        with pytest.raises(HTTPException) as result:
            scoped_dependencies()
        assert result.value.status_code == 404
    finally:
        reset_request_scope(tokens)
