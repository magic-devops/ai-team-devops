"""Real SQL boundaries for bounded, generation-consistent delivery queries."""

import re
from contextlib import contextmanager

from sop_manager.routers.sql_models import DeliveryWorkspace, Issue, Requirement, Task
from sqlalchemy import event
from test_delivery_workbench import env as delivery_env

env = delivery_env


@contextmanager
def statements(sessions):
    captured = []
    engine = sessions.kw["bind"]

    def receive(connection, cursor, statement, parameters, context, executemany):
        captured.append(statement)

    event.listen(engine, "before_cursor_execute", receive)
    try:
        yield captured
    finally:
        event.remove(engine, "before_cursor_execute", receive)


def seed(sessions):
    with sessions() as db:
        db.connection().exec_driver_sql("PRAGMA foreign_keys=ON")
        for index in range(6):
            db.add(
                Requirement(
                    id=f"R-{index}",
                    tenant_id="tenant",
                    project_id="project",
                    title=f"Requirement {index}",
                    description="PRIVATE REQUIREMENT BODY",
                )
            )
        db.flush()
        for index in range(6):
            db.add(
                Task(
                    id=f"T-{index}",
                    tenant_id="tenant",
                    project_id="project",
                    req_id=f"R-{index}",
                    title=f"Task {index}",
                    description="PRIVATE TASK BODY",
                    owner_id="user:lead",
                    status="completed" if index % 2 else "pending",
                )
            )
        db.add(
            Issue(
                id="I-0",
                tenant_id="tenant",
                project_id="project",
                task_id="T-0",
                title="A critical issue",
                severity="P0",
                status="open",
            )
        )
        db.commit()


def rebuild(client):
    response = client.post("/api/v1/delivery/query/rebuild")
    assert response.status_code == 200, response.text
    return response.json()


def test_context_and_lists_never_select_all_business_bodies(env):
    client, sessions, _ = env
    seed(sessions)
    rebuild(client)
    with statements(sessions) as sql:
        context = client.get("/api/v1/delivery/context")
        requirements = client.get("/api/v1/delivery/requirements", params={"limit": 2, "sort": "id_asc"})
        tasks = client.get("/api/v1/delivery/tasks", params={"limit": 2, "sort": "id_asc"})
        issues = client.get("/api/v1/delivery/issues", params={"limit": 2})
    assert context.status_code == requirements.status_code == tasks.status_code == issues.status_code == 200
    assert (
        not {"tasks", "requirements", "issues", "executions", "members", "resources"} & context.json().keys()
    )
    assert context.json()["metrics"]["tasks_total"] == 6
    assert context.json()["metrics"]["verified_completed"] == 0
    assert requirements.json()["total"] == tasks.json()["total"] == 6
    assert len(requirements.json()["items"]) == len(tasks.json()["items"]) == 2
    assert "PRIVATE" not in context.text + requirements.text + tasks.text + issues.text
    reads = [query.lower() for query in sql if query.lstrip().lower().startswith("select")]
    assert not any("tasks.description" in query or "requirements.description" in query for query in reads)
    assert not any(re.search(r"(?:select|,)\s+delivery_workspaces\.data(?:\s|$)", query) for query in reads)


def test_effective_filter_precedes_pagination_and_cursor_is_fixed_to_generation(env):
    client, sessions, _ = env
    seed(sessions)
    rebuild(client)
    first = client.get(
        "/api/v1/delivery/tasks", params={"status": "recorded_completed", "sort": "id_asc", "limit": 2}
    )
    assert first.status_code == 200, first.text
    assert first.json()["total"] == 3
    assert [item["id"] for item in first.json()["items"]] == ["T-1", "T-3"]
    token = first.json()["next_cursor"]
    second = client.get(
        "/api/v1/delivery/tasks",
        params={"status": "recorded_completed", "sort": "id_asc", "limit": 2, "cursor": token},
    )
    assert [item["id"] for item in second.json()["items"]] == ["T-5"]
    assert (
        client.get(
            "/api/v1/delivery/tasks", params={"sort": "id_asc", "limit": 2, "cursor": token}
        ).status_code
        == 422
    )
    with sessions() as db:
        db.get(Task, "T-5").priority = "P0"
        db.commit()
    stale = client.get(
        "/api/v1/delivery/tasks",
        params={"status": "recorded_completed", "sort": "id_asc", "limit": 2, "cursor": token},
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["code"] == "delivery_query_cursor_stale"


def test_exact_task_works_outside_first_page_and_projects_only_its_json_paths(env):
    client, sessions, _ = env
    seed(sessions)
    with sessions() as db:
        workspace = db.get(DeliveryWorkspace, "project")
        if workspace:
            workspace.data = {**workspace.data, "opaque_private": "UNRELATED HUGE WORKSPACE BODY"}
        db.commit()
    rebuild(client)
    with statements(sessions) as sql:
        exact = client.get("/api/v1/delivery/tasks/T-5")
    assert exact.status_code == 200, exact.text
    assert exact.json()["task"]["id"] == "T-5"
    assert exact.json()["task"]["description"] == "PRIVATE TASK BODY"
    assert "UNRELATED HUGE" not in exact.text
    assert any("JSON_EXTRACT" in query for query in sql)
    assert client.get("/api/v1/delivery/tasks/no-such-task").status_code == 404


def test_command_ack_replay_keeps_original_result_without_snapshot(env):
    client, sessions, _ = env
    body = {
        "action": "requirement.create",
        "expected_version": 0,
        "idempotency_key": "immutable-ack-result",
        "payload": {"title": "One", "acceptance_criteria": ["Works"]},
    }
    first = client.post("/api/v1/delivery/commands", json=body)
    assert first.status_code == 200, first.text
    assert "requirements" not in first.json()
    resource = first.json()["resource"]
    assert resource["kind"] == "requirement"
    with sessions() as db:
        db.delete(db.get(Requirement, resource["id"]))
        db.commit()
    replay = client.post("/api/v1/delivery/commands", json=body)
    assert replay.status_code == 200, replay.text
    assert replay.json()["resource"] == resource
    assert replay.json()["replayed"] is True
    assert replay.json()["applied_version"] == first.json()["applied_version"]


def test_command_ack_reads_version_and_generation_in_one_narrow_sql_statement(env):
    from sop_manager.routers.delivery_query_commands import current_ack, recorded_ack
    from sop_manager.routers.sql_models import Project

    _, sessions, _ = env
    with sessions() as db:
        project = db.get(Project, "project")
        recorded = recorded_ack(project, "project.update", project.id, None, 0)
        with statements(sessions) as sql:
            result = current_ack(db, project, recorded, replayed=False)
    reads = [query.lower() for query in sql if query.lstrip().lower().startswith("select")]
    assert len(reads) == 1
    assert "delivery_query_states.generation" in reads[0] and "delivery_workspaces.version" in reads[0]
    assert not any(field in reads[0] for field in ("summary", "metrics", "planning_basis", ".data"))
    assert result["query_generation"] is not None
