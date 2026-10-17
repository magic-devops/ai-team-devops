"""Canonical task ownership through ordinary CRUD, sync, import and planning."""

import pytest
from fastapi import HTTPException
from sop_manager.routers import data_exchange, db_sql_compat, sql_models, sync_api
from test_business_access import env as env
from test_business_access import headers


def test_task_owner_id_survives_rename_and_explicit_clear_without_name_storage(env):
    client, sessions = env
    created = client.post("/api/v1/tasks", headers=headers(), json={"title": "Owned", "owner_id": "user:writer"})
    assert created.status_code == 200, created.text
    task_id = created.json()["id"]
    with sessions() as db:
        task = db.get(sql_models.Task, task_id)
        assert getattr(task, "owner_id", None) == "user:writer"
        db.get(sql_models.User, "writer").username = "Renamed owner"
        db.commit()
    detail = client.get(f"/api/v1/tasks/{task_id}", headers=headers()).json()
    assert (detail["owner_id"], detail["assigned_to"]) == ("user:writer", "Renamed owner")
    assert client.patch(f"/api/v1/tasks/{task_id}", headers=headers(), json={"title": "Same owner"}).status_code == 200
    assert client.get(f"/api/v1/tasks/{task_id}", headers=headers()).json()["owner_id"] == "user:writer"
    assert client.patch(f"/api/v1/tasks/{task_id}", headers=headers(), json={"owner_id": ""}).status_code == 200
    detail = client.get(f"/api/v1/tasks/{task_id}", headers=headers()).json()
    assert (detail["owner_id"], detail["assigned_to"]) == ("", "")
    assert "assigned_to" not in sql_models.Task.__table__.c


@pytest.mark.parametrize("operation", ["create", "update", "bulk"])
def test_ordinary_task_writes_reject_assigned_to_name_input(env, operation):
    client, _ = env
    if operation == "create":
        response = client.post("/api/v1/tasks", headers=headers(), json={"title": "No names", "assigned_to": "writer"})
    elif operation == "bulk":
        response = client.patch("/api/v1/tasks/bulk", headers=headers(), json={"ids": ["T-selected"], "assigned_to": "writer"})
    else:
        response = client.patch("/api/v1/tasks/T-selected", headers=headers(), json={"assigned_to": "writer"})
    assert response.status_code == 422, response.text


@pytest.mark.parametrize("owner_id", [None, True, 7, "user:disabled", "user:missing", "writer"])
def test_task_owner_must_be_a_current_assignable_scoped_identity(env, owner_id):
    client, sessions = env
    response = client.post("/api/v1/tasks", headers=headers(), json={"title": "Invalid owner", "owner_id": owner_id})
    assert response.status_code == 422, response.text
    with sessions() as db:
        assert db.query(sql_models.Task).count() == 2


def test_sync_and_import_use_owner_ids_and_reject_name_writes(env, monkeypatch):
    _, sessions = env
    monkeypatch.setattr(sync_api, "_require_scope", lambda: "selected")
    monkeypatch.setattr(sync_api, "resolved_tenant_id", lambda: "team")
    monkeypatch.setattr(sync_api, "append_event", lambda **kw: {"id": "event"})
    monkeypatch.setattr(sync_api, "_ws_sync_event", lambda *args: None)
    with sessions() as db:
        result = sync_api.sync_push(sync_api.SyncPushIn(module="tasks", record={
            "id": "T-synced", "title": "Synced", "owner_id": "user:writer",
        }), db=db)
        assert result["record"].get("owner_id") == "user:writer"
        for writer in ("sync", "import"):
            with pytest.raises(HTTPException) as error:
                values = {"id": "T-synced", "assigned_to": "writer"}
                if writer == "sync":
                    sync_api.sync_push(sync_api.SyncPushIn(module="tasks", record=values), db=db)
                else:
                    data_exchange._merge_table(db, "tasks", [values], "team", "selected")
            assert error.value.status_code == 422
            db.rollback()
        data_exchange._merge_table(db, "tasks", [{"id": "T-synced", "owner_id": "user:product"}], "team", "selected")
        db.commit()
        assert db.get(sql_models.Task, "T-synced").owner_id == "user:product"


def test_compatibility_batch_validates_all_owners_before_any_task_insert(env, monkeypatch):
    _, sessions = env
    monkeypatch.setattr(db_sql_compat, "resolved_tenant_id", lambda: "team")
    monkeypatch.setattr(db_sql_compat, "resolved_project_id", lambda: "selected")
    with sessions() as db:
        with pytest.raises(HTTPException) as error:
            db_sql_compat._SqlTable(sql_models.Task, db).add([
                {"id": "T-valid", "title": "Valid", "owner_id": "user:writer"},
                {"id": "T-invalid", "title": "Invalid", "owner_id": "user:missing"},
            ])
        assert error.value.status_code == 422
        db.commit()
        assert db.query(sql_models.Task).count() == 2


def test_task_dispatch_does_not_guess_owner_from_title_and_uses_explicit_pool_ids(env):
    client, sessions = env
    with sessions() as db:
        db.get(sql_models.Task, "T-selected").title = "Frontend React API security"
        db.commit()
    response = client.post("/api/v1/tasks/dispatch-plan", headers=headers(), json={"ids": ["T-selected"]})
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["ready"] is False
    assert response.json()["items"][0].get("owner_id") == ""
    response = client.post("/api/v1/tasks/scheduler/plan", headers=headers(), json={
        "ids": ["T-selected"], "owner_pool": ["user:writer"], "dry_run": False,
    })
    assert response.status_code == 200, response.text
    with sessions() as db:
        assert db.get(sql_models.Task, "T-selected").owner_id == "user:writer"
    assert client.post("/api/v1/tasks/scheduler/plan", headers=headers(), json={"agent_pool": ["Coder"]}).status_code == 422


@pytest.mark.parametrize("metadata", [{"labels": ["preview"]}, {"dedupe_status": "pending"}, {"unknown": "value"}])
def test_public_task_create_rejects_internal_candidate_metadata(env, metadata):
    client, _ = env
    response = client.post("/api/v1/tasks", headers=headers(), json={"title": "Strict canonical task", **metadata})
    assert response.status_code == 422, response.text
