"""Missing history, permissions, reference totals and actual 10,000-row read bounds."""

from datetime import datetime

from sop_manager.routers.delivery_contract import default_flow
from sop_manager.routers.delivery_service import initial_state
from sop_manager.routers.sql_models import (
    DeliveryProgressObservation,
    DeliveryQueryFact,
    DeliveryQueryState,
    DeliveryWorkspace,
    Requirement,
    Task,
)
from sqlalchemy import delete, event, insert, select, update
from test_delivery_query import rebuild, seed, statements
from test_delivery_workbench import env as delivery_env

env = delivery_env


def test_missing_index_is_unknown_and_reads_cannot_initialize_or_invent_history(env):
    client, sessions, actor = env
    seed(sessions)
    with sessions() as db:
        db.connection().execute(delete(DeliveryQueryFact))
        db.connection().execute(delete(DeliveryQueryState))
        db.commit()
        count = db.query(DeliveryProgressObservation).count()
    actor["id"] = "reader"
    response = client.get("/api/v1/delivery/context")
    assert response.status_code == 200
    assert response.json()["summary"] is None and response.json()["metrics"] is None
    assert response.json()["query_state"]["status"] == "rebuild_required"
    assert client.get("/api/v1/delivery/tasks").status_code == 409
    assert client.post("/api/v1/delivery/query/rebuild").status_code == 403
    with sessions() as db:
        assert db.query(DeliveryQueryState).count() == 0
        assert db.query(DeliveryProgressObservation).count() == count
    actor["id"] = "lead"
    rebuilt = rebuild(client)
    assert rebuilt["query_state"]["status"] == "ready"
    with sessions() as db:
        assert db.query(DeliveryProgressObservation).count() == count


def test_archived_unindexed_project_can_rebuild_only_derived_facts(env):
    from sop_manager.routers.sql_models import Project

    client, sessions, _ = env
    seed(sessions)
    with sessions() as db:
        # Existing archived installation, before query tables were introduced.
        db.connection().execute(update(Project).where(Project.id == "project").values(status="archived"))
        db.connection().execute(delete(DeliveryQueryState))
        db.connection().execute(delete(DeliveryQueryFact))
        db.commit()
        before = {
            table.name: db.connection().execute(select(table)).all()
            for table in (
                Requirement.__table__,
                Task.__table__,
                DeliveryWorkspace.__table__,
                DeliveryProgressObservation.__table__,
            )
        }
    response = client.get("/api/v1/delivery/context")
    assert response.json()["permissions"]["configure"] is False
    assert response.json()["permissions"].get("query_rebuild") is True
    rebuild(client)
    with sessions() as db:
        after = {
            table.name: db.connection().execute(select(table)).all()
            for table in (
                Requirement.__table__,
                Task.__table__,
                DeliveryWorkspace.__table__,
                DeliveryProgressObservation.__table__,
            )
        }
    assert after == before


def test_issue_source_filter_precedes_page_and_count(env):
    client, sessions, _ = env
    seed(sessions)
    rebuild(client)
    assert client.get("/api/v1/delivery/issues", params={"source": "other"}).json()["total"] == 1
    response = client.get("/api/v1/delivery/issues", params={"source": "execution"})
    assert response.status_code == 200, response.text
    assert response.json()["total"] == 0 and response.json()["items"] == []


def test_reference_cursor_remains_bounded_for_one_hundred_selected_ids(env):
    client, sessions, _ = env
    seed(sessions)
    ids = ",".join(["T-0", "T-1"] + [f"missing-{index:03}-" + "x" * 48 for index in range(98)])
    params = {"kind": "task", "ids": ids, "limit": 1}
    first = client.get("/api/v1/delivery/references", params=params)
    assert first.status_code == 200, first.text
    token = first.json()["next_cursor"]
    assert token and len(token) <= 4000
    second = client.get("/api/v1/delivery/references", params={**params, "cursor": token})
    assert second.status_code == 200, second.text
    assert second.json()["items"][0]["id"] == "T-1"


def test_reference_counts_use_full_scope_and_selected_resource_uses_one_json_path(env):
    client, sessions, _ = env
    seed(sessions)
    with sessions() as db:
        state = initial_state()
        state["milestones"] = [
            {
                "id": "M-later",
                "title": "Later",
                "owner_id": "user:lead",
                "starts_on": None,
                "ends_on": "2026-12-31",
            },
            {
                "id": "M-earlier",
                "title": "Earlier",
                "owner_id": "user:lead",
                "starts_on": None,
                "ends_on": "2026-10-31",
            },
        ]
        state["flows"] = {f"R-{index}": {**default_flow(), "milestone_id": "M-later"} for index in range(6)}
        state["resources"] = [
            {
                "id": "RES",
                "title": "Repository",
                "kind": "repository",
                "url": "https://example.org/repo",
                "description": "EXACT RESOURCE BODY",
                "archived": False,
            }
        ]
        db.add(DeliveryWorkspace(project_id="project", tenant_id="tenant", version=0, data=state))
        db.commit()
    member = client.get(
        "/api/v1/delivery/references", params={"kind": "member", "ids": "user:lead", "limit": 1}
    ).json()
    assert member["items"][0]["task_count"] == 6
    milestone = client.get(
        "/api/v1/delivery/references", params={"kind": "milestone", "ids": "M-later", "limit": 1}
    ).json()
    assert milestone["items"][0]["data"]["task_count"] == 6
    assert milestone["items"][0]["data"]["requirement_count"] == 6
    assert milestone["items"][0]["data"]["verified_task_count"] == 0
    earliest = client.get(
        "/api/v1/delivery/references", params={"kind": "milestone", "sort": "ends_asc", "limit": 1}
    ).json()
    assert earliest["items"][0]["id"] == "M-earlier"
    assert (
        client.get("/api/v1/delivery/references", params={"kind": "member", "member_kind": "agent"}).json()[
            "total"
        ]
        == 0
    )
    with statements(sessions) as sql:
        exact = client.get("/api/v1/delivery/references", params={"kind": "resource", "ids": "RES"})
    assert exact.json()["items"][0]["data"]["description"] == "EXACT RESOURCE BODY"
    assert any("JSON_EXTRACT" in query for query in sql)
    assert (
        "EXACT RESOURCE BODY"
        not in client.get("/api/v1/delivery/references", params={"kind": "resource"}).text
    )


def test_ten_thousand_rows_page_and_details_load_only_requested_bodies(env):
    client, sessions, _ = env
    count = 10_000
    body = "PRIVATE LARGE BODY " + "x" * 2048
    moment = datetime(2026, 10, 17)
    # Migration-style fixture insertion deliberately bypasses Session observers;
    # the explicit rebuild must derive current facts without synthesizing history.
    with sessions() as db:
        connection = db.connection()
        connection.exec_driver_sql("PRAGMA foreign_keys=ON")
        connection.execute(
            insert(Requirement),
            [
                {
                    "id": f"S-R-{index:05}",
                    "tenant_id": "tenant",
                    "project_id": "project",
                    "title": f"Requirement {index:05}",
                    "description": body,
                    "created_at": moment,
                    "acceptance_criteria": ["Delivered"],
                }
                for index in range(count)
            ],
        )
        connection.execute(
            insert(Task),
            [
                {
                    "id": f"S-T-{index:05}",
                    "tenant_id": "tenant",
                    "project_id": "project",
                    "req_id": f"S-R-{index:05}",
                    "title": f"Task {index:05}",
                    "description": body,
                    "created_at": moment,
                    "owner_id": "user:lead",
                    "status": "completed" if index % 2 else "pending",
                    "acceptance_criteria": ["Delivered"],
                }
                for index in range(count)
            ],
        )
        db.commit()
    rebuild(client)
    loaded = []

    def record(session, instance):
        if isinstance(instance, (Requirement, Task, DeliveryWorkspace)):
            loaded.append(type(instance).__name__)

    event.listen(sessions.class_, "loaded_as_persistent", record)
    try:
        with statements(sessions) as sql:
            page = client.get(
                "/api/v1/delivery/tasks",
                params={"limit": 3, "sort": "id_asc", "status": "recorded_completed"},
            )
            context = client.get("/api/v1/delivery/context")
    finally:
        event.remove(sessions.class_, "loaded_as_persistent", record)
    assert page.status_code == 200 and context.status_code == 200
    assert page.json()["total"] == 5_000
    assert [item["id"] for item in page.json()["items"]] == ["S-T-00001", "S-T-00003", "S-T-00005"]
    assert context.json()["metrics"]["tasks_total"] == 10_000
    assert context.json()["metrics"]["verified_completed"] == 0
    assert not loaded
    assert "PRIVATE LARGE BODY" not in page.text + context.text
    assert len(page.content) + len(context.content) < 20_000
    assert any("count(" in query.lower() and "delivery_query_facts" in query for query in sql)
    exact = client.get("/api/v1/delivery/tasks/S-T-09999")
    assert exact.status_code == 200 and exact.json()["task"]["description"] == body
    with sessions() as db:
        assert db.scalar(select(Task.id).where(Task.id == "S-T-09999")) == "S-T-09999"
