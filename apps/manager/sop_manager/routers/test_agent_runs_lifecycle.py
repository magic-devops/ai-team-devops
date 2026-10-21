"""Legacy Run files are read-only diagnostics, never formal execution state."""
from contextlib import contextmanager
import json

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from sop_manager.path_config import reset_request_scope, set_request_scope
from sop_manager.routers import agent_runs as runs
from sop_manager.routers.scope_guard import attach_scope


@contextmanager
def scoped_project(root, project="project-a"):
    tokens = set_request_scope(tenant_id="tenant-a", project_id=project, project_path=root,
        tenant_code="tenant-a", business_code="biz-a", project_code=project)
    try:
        yield
    finally:
        reset_request_scope(tokens)


@pytest.mark.parametrize("method", ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
@pytest.mark.parametrize("path", ["", "/unique/status", "/unique/heartbeat", "/unique/evidence", "/unique/retry", "/unique/cancel", "/summary"])
def test_retired_agent_run_methods_preserve_legacy_source_and_never_claim_stopped(monkeypatch, tmp_path, method, path):
    monkeypatch.setattr(runs, "resolved_ai_memory_root", lambda: tmp_path)
    source = tmp_path / "agent_runs" / "run_unique.json"
    source.parent.mkdir()
    with scoped_project(tmp_path):
        source.write_text(json.dumps(attach_scope({"id": "unique", "status": "running"})), encoding="utf-8")
        before = {p.relative_to(tmp_path).as_posix(): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
        app = FastAPI(); app.include_router(runs.router)
        response = TestClient(app).request(method, "/api/v1/agent-runs" + path,
            json={"task_id": "made-up", "status": "success", "stopped": True})
        assert response.status_code == 410
        if method != "HEAD":
            assert response.json()["detail"]["code"] == "legacy_agent_execution_retired"
        row = runs._all_runs()[0]
        assert row["status"] == "running" and row["legacy_unverified"] is True and row["evidence_source"] == "legacy_reported"
        assert {p.relative_to(tmp_path).as_posix(): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()} == before
    with scoped_project(tmp_path, project="another-project"):
        assert runs._all_runs() == []


def test_empty_private_legacy_trace_read_does_not_create_a_store(monkeypatch, tmp_path):
    source = tmp_path / "not-created"
    monkeypatch.setattr(runs, "resolved_ai_memory_root", lambda: source)
    with scoped_project(tmp_path):
        assert runs._all_runs() == []
    assert not source.exists()
