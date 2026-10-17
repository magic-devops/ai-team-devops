"""Task acceptance belongs to the canonical task and survives every SQL writer."""

import pytest
from sop_manager.routers import db_sql_compat, sql_models, sync_api
from test_business_access import env as env
from test_business_access import headers


def test_standalone_task_acceptance_round_trips_create_update_and_clear(env):
    client, sessions = env
    response = client.post("/api/v1/tasks", headers=headers(), json={
        "title": "Independent delivery", "acceptance_criteria": ["  Real tests pass  ", "Human reviews output"],
    })
    assert response.status_code == 200, response.text
    task_id = response.json()["id"]
    stored = client.get(f"/api/v1/tasks/{task_id}", headers=headers()).json()
    assert stored["req_id"] == ""
    assert stored.get("acceptance_criteria") == ["Real tests pass", "Human reviews output"]
    response = client.patch(f"/api/v1/tasks/{task_id}", headers=headers(), json={"title": "Renamed"})
    assert response.status_code == 200, response.text
    with sessions() as db:
        assert db.get(sql_models.Task, task_id).acceptance_criteria == ["Real tests pass", "Human reviews output"]
    assert client.patch(f"/api/v1/tasks/{task_id}", headers=headers(), json={"acceptance_criteria": []}).status_code == 200
    assert client.get(f"/api/v1/tasks/{task_id}", headers=headers()).json()["acceptance_criteria"] == []


@pytest.mark.parametrize("value", [None, "Pass", [0], [True], [" "], ["x" * 2001], ["Pass"] * 81, {"criterion": "Pass"}])
@pytest.mark.parametrize("operation", ["create", "update"])
def test_task_api_rejects_invalid_acceptance_without_changing_data(env, value, operation):
    client, sessions = env
    if operation == "create":
        response = client.post("/api/v1/tasks", headers=headers(), json={"title": "Invalid", "acceptance_criteria": value})
    else:
        response = client.patch("/api/v1/tasks/T-selected", headers=headers(), json={"acceptance_criteria": value})
    assert response.status_code == 422, response.text
    with sessions() as db:
        assert db.query(sql_models.Task).count() == 2


def test_task_acceptance_defaults_are_independent_lists_and_orm_rejects_indices(env):
    _, sessions = env
    with sessions() as db:
        first, second = db.get(sql_models.Task, "T-selected"), db.get(sql_models.Task, "T-other")
        assert getattr(first, "acceptance_criteria", None) == []
        assert first.acceptance_criteria is not second.acceptance_criteria
        with pytest.raises(ValueError, match="acceptance_criteria"):
            first.acceptance_criteria = [0]


def test_sql_compat_batch_rejects_mixed_indices_before_any_insert(env, monkeypatch):
    _, sessions = env
    monkeypatch.setattr(db_sql_compat, "resolved_tenant_id", lambda: "team")
    monkeypatch.setattr(db_sql_compat, "resolved_project_id", lambda: "selected")
    with sessions() as db:
        table = db_sql_compat._SqlTable(sql_models.Task, db)
        with pytest.raises(Exception) as failure:
            table.add([
                {"id": "T-good", "title": "Good", "acceptance_criteria": ["Pass"]},
                {"id": "T-bad", "title": "Bad", "acceptance_criteria": [1]},
            ])
        assert getattr(failure.value, "status_code", None) == 422
        assert db.query(sql_models.Task).count() == 2


def test_sync_task_acceptance_is_normalized_and_invalid_upsert_is_atomic(env, monkeypatch):
    _, sessions = env
    monkeypatch.setattr(sync_api, "_require_scope", lambda: "selected")
    monkeypatch.setattr(sync_api, "resolved_tenant_id", lambda: "team")
    monkeypatch.setattr(sync_api, "append_event", lambda **kw: {"id": "event"})
    monkeypatch.setattr(sync_api, "_ws_sync_event", lambda *args: None)
    with sessions() as db:
        saved = sync_api.sync_push(sync_api.SyncPushIn(module="tasks", record={
            "id": "T-synced", "title": "Synced", "acceptance_criteria": [" Pass "],
        }), db=db)
        assert saved["record"].get("acceptance_criteria") == ["Pass"]
        with pytest.raises(Exception) as failure:
            sync_api.sync_push(sync_api.SyncPushIn(module="tasks", record={
                "id": "T-synced", "title": "Corrupted", "acceptance_criteria": [1],
            }), db=db)
        assert getattr(failure.value, "status_code", None) == 422
        db.expire_all()
        assert db.get(sql_models.Task, "T-synced").title == "Synced"


def test_lance_import_preserves_task_criteria_without_requirement_copy(env, monkeypatch):
    from sop_manager import migrate

    _, sessions = env

    class Source:
        def rows(self, resource, limit):
            return [{"id": "T-imported", "title": "Imported", "acceptance_criteria": [" Own criterion "]}] if resource == "tasks" else []

    monkeypatch.setattr(migrate, "get_vector_store", Source)
    monkeypatch.setattr(migrate, "get_session", lambda: iter([sessions()]))
    monkeypatch.setattr(sql_models, "engine", sessions.kw["bind"])
    migrate.migrate_lance_to_sql("team", "selected")
    with sessions() as db:
        row = db.get(sql_models.Task, "T-imported")
        assert row.acceptance_criteria == ["Own criterion"]
        assert row.req_id == ""


@pytest.mark.parametrize("requirement_id,own_criteria", [
    ("", ["Independent task output is reviewed"]),
    ("REQ-selected", ["Only this task-specific condition"]),
    ("REQ-selected", []),
])
def test_agent_plan_packet_preserves_own_task_criteria_without_requirement_inheritance(env, requirement_id, own_criteria):
    client, sessions = env
    with sessions() as db:
        requirement = db.get(sql_models.Requirement, "REQ-selected")
        requirement.acceptance_criteria = ["Parent condition must not be inherited"]
        task = db.get(sql_models.Task, "T-selected")
        task.req_id = requirement_id
        task.acceptance_criteria = own_criteria
        db.commit()
    response = client.get("/api/v1/tasks/T-selected/agent-plan?include_context=false", headers=headers())
    assert response.status_code == 200, response.text
    plan = response.json()
    assert plan["packet"]["contract"].get("acceptance_criteria") == own_criteria
    assert plan["task"].get("acceptance_criteria") == own_criteria
    assert plan["packet"]["contract"]["req_id"] == requirement_id
