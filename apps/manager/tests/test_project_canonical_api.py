"""Project management reads and old routes cannot bypass canonical commands."""

import json

from sop_manager.routers import tenants
from sop_manager.routers.sql_models import Base, Project, Task
from sqlalchemy import select
from test_delivery_workbench import command
from test_delivery_workbench import env as delivery_env

env = delivery_env


def database_image(sessions):
    with sessions() as db:
        return {table.name: sorted(repr(tuple(row)) for row in db.execute(select(table)).all())
                for table in Base.metadata.sorted_tables}


def test_project_reads_are_pure_and_complete_risk_count_exceeds_display_sample(env, monkeypatch):
    client, sessions, _ = env
    client.app.include_router(tenants.proj_router)
    monkeypatch.setenv("ADMIN_MODE", "single")
    with sessions() as db:
        db.add_all([Task(id=f"risk-{number}", tenant_id="tenant", project_id="project", title="Blocked",
                         status="blocked", owner_id="user:lead", acceptance_criteria=["Works"])
                    for number in range(15)])
        db.commit()
    before = database_image(sessions)
    response = client.get("/api/v1/projects/summary")
    assert response.status_code == 200, response.text
    value = response.json()
    assert value["risks_total"] == value["risk_counts"]["blocked"] == 15
    assert len(value["risks"]) == 12
    hub = client.get("/api/v1/projects/hub")
    assert hub.status_code == 200 and hub.json()["summary"]["risks_total"] == 15
    assert client.get("/api/v1/projects").status_code == 200
    assert database_image(sessions) == before


def test_removed_unversioned_project_writes_and_archived_initial_state_are_unavailable(env):
    client, sessions, _ = env
    client.app.include_router(tenants.proj_router)
    for method, path in [("PATCH", "/api/v1/projects/project"), ("DELETE", "/api/v1/projects/project"),
                         ("PATCH", "/api/v1/projects/project/set-template")]:
        response = client.request(method, path, json={"status": "archived", "is_template": True})
        assert response.status_code in {404, 405}, response.text
    response = client.post("/api/v1/projects", json={"name": "Invalid", "status": "archived"})
    assert response.status_code == 422, response.text
    with sessions() as db:
        assert db.get(Project, "project").status == "active"


def test_vector_configuration_is_not_exposed_in_activity_or_project_directory(env):
    client, sessions, _ = env
    client.app.include_router(tenants.proj_router)
    fixture_value = "test-fixture_value-value-not-a-real-credential"
    result = command(client, "project.update", {"vector_db_config": {"password": fixture_value}})
    assert result.status_code == 200, result.text
    assert fixture_value not in result.text
    assert result.json()["activity"][0]["data"]["input"] == {"vector_db_config": {"changed": True}}
    with sessions() as db:
        assert db.get(Project, "project").vector_db_config["password"] == fixture_value
    directory = client.get("/api/v1/projects")
    assert directory.status_code == 200 and fixture_value not in directory.text
    assert fixture_value not in json.dumps(client.get("/api/v1/delivery/workspace").json())


def test_project_routes_require_existing_scope_without_auto_provision():
    from sop_manager.routers.project_scope_resolve import existing_project_required

    assert existing_project_required("/api/v1/projects")
    assert existing_project_required("/api/v1/projects/portfolio")


def test_private_template_is_not_visible_or_previewable_to_another_project_member(env):
    client, sessions, actor = env
    client.app.include_router(tenants.proj_router)
    with sessions() as db:
        db.get(Project, "other").is_template = True
        db.commit()
    actor["id"] = "reader"
    assert client.get("/api/v1/projects/templates").json() == []
    denied = client.post("/api/v1/projects/other/clone-preview", json={"name": "Copy"})
    assert denied.status_code in {403, 404}, denied.text


def test_vector_clone_counts_actual_rows_and_rechecks_destination_scope(env, monkeypatch):
    from sop_manager.routers import sql_models, vector_store

    _, sessions, _ = env
    calls = []

    class Store:
        def rows(self, namespace, limit):
            return [{"id": "old", "content": "A copied rule"}]

        def upsert(self, namespace, row):
            calls.append((namespace, row))

    monkeypatch.setattr(vector_store, "get_vector_store", lambda **kwargs: Store())
    monkeypatch.setattr(sql_models, "SessionLocal", sessions)
    counts = tenants._clone_vector_data("other", "project", "lance", {}, True, False, tenant_id="tenant")
    assert counts == {"knowledge": 1, "rules": 0} and len(calls) == 1
    with sessions.kw["bind"].begin() as connection:
        connection.execute(Project.__table__.update().where(Project.id == "project").values(status="archived"))
    import pytest
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as error:
        tenants._clone_vector_data("other", "project", "lance", {}, True, False, tenant_id="tenant")
    assert error.value.status_code == 409 and len(calls) == 1
