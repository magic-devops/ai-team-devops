"""Workflow GETs project current state without rewriting journals or live handles."""
from copy import deepcopy
from pathlib import Path

import pytest
from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.project_write_guard import lifecycle_scope
from sop_manager.routers import sql_models, workflow
from test_business_access import env as business_env  # noqa: F401 - dependency of the imported fixture.
from test_business_access import headers
from test_workflow_access import env as env
from test_workflow_access import start_review


def journal_paths(sessions):
    with sessions() as db:
        root = Path(db.get(sql_models.Project, "selected").project_path)
    tokens = set_request_scope("team", "selected", root, tenant_code="team", project_code="selected")
    try:
        return workflow._runs_file(), workflow._events_file()
    finally:
        reset_request_scope(tokens)


def archive(sessions):
    with sessions() as db:
        with lifecycle_scope(db, "team", "selected"):
            db.get(sql_models.Project, "selected").status = "archived"
            db.commit()


@pytest.mark.parametrize("suffix", ["status", "result", "detail", "query", "instances", "summary", "charts", "hub", "ops-plan"])
def test_archived_completed_workflow_history_gets_never_attempt_persistence(env, monkeypatch, suffix):
    client, sessions = env
    workflow_id = "archive-history"
    assert start_review(client, workflow_id).status_code == 200
    response = client.post(f"/api/v1/workflows/{workflow_id}/signal", headers=headers("product"), json={"signal": "approve", "payload": {"comment": "Human checked", "signal_id": "approved"}})
    assert response.status_code == 200, response.text
    archive(sessions)
    paths = journal_paths(sessions)
    before = [path.read_bytes() for path in paths]
    handles = deepcopy(workflow._engine._handles)
    attempts = []
    save = workflow._save_runs
    def tracked_save(rows):
        attempts.append(rows)
        return save(rows)
    monkeypatch.setattr(workflow, "_save_runs", tracked_save)
    url = f"/api/v1/workflows/{workflow_id}/{suffix}" if suffix in {"status", "result", "detail", "query"} else f"/api/v1/workflows/{suffix}"
    response = client.get(url, headers=headers("reader"))
    assert response.status_code == 200, response.text
    assert attempts == []
    assert [path.read_bytes() for path in paths] == before
    assert workflow._engine._handles == handles


@pytest.mark.parametrize("suffix", ["status", "detail", "query", "instances", "summary"])
def test_elapsed_deadline_is_a_read_only_projection_of_the_live_handle(env, monkeypatch, suffix):
    client, sessions = env
    workflow_id = "deadline-projection"
    response = client.post("/api/v1/workflows/start", headers=headers(), json={"type": "code_review", "workflow_id": workflow_id, "args": {"timeout_seconds": 3600}})
    assert response.status_code == 200, response.text
    handle = workflow._engine._handles[("team", "selected", workflow_id)]
    handle.status = "awaiting_human"
    handle.result.update(phase="awaiting_human", review_deadline=1)
    before_handle = deepcopy(handle)
    paths = journal_paths(sessions)
    before_files = [path.read_bytes() for path in paths]
    archive(sessions)
    url = f"/api/v1/workflows/{workflow_id}/{suffix}" if suffix in {"status", "detail", "query"} else f"/api/v1/workflows/{suffix}"
    response = client.get(url, headers=headers("reader"))
    assert response.status_code == 200, response.text
    assert "timeout_pending" in response.text
    assert handle == before_handle
    assert [path.read_bytes() for path in paths] == before_files


def test_recovered_get_does_not_populate_or_mutate_the_engine_cache(env):
    client, sessions = env
    assert start_review(client, "journal-only").status_code == 200
    workflow._engine._handles.clear()
    archive(sessions)
    before = [path.read_bytes() for path in journal_paths(sessions)]
    response = client.get("/api/v1/workflows/journal-only/status", headers=headers("reader"))
    assert response.status_code == 200, response.text
    assert workflow._engine._handles == {}
    assert [path.read_bytes() for path in journal_paths(sessions)] == before


def test_already_recorded_timeout_keeps_its_original_pending_phase(env):
    client, _ = env
    assert start_review(client, "recorded-timeout").status_code == 200
    handle = workflow._engine._handles[("team", "selected", "recorded-timeout")]
    handle.status = "timeout_pending"
    handle.result.update(phase="timeout_pending", pending_phase="awaiting_human", review_deadline=1)
    response = client.get("/api/v1/workflows/recorded-timeout/status", headers=headers("reader"))
    assert response.status_code == 200, response.text
    assert response.json()["result"]["pending_phase"] == "awaiting_human"
