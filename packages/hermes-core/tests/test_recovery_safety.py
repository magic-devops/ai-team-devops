import time

import pytest
from fastapi.testclient import TestClient

from hermes_core.api import create_app
from hermes_core.cli import ensure_token_file
from hermes_core.models import CoreError, Principal


def test_expired_lease_is_fenced_and_requires_review(tmp_path):
    app = create_app(tmp_path, "token")
    store, execution = app.state.hermes_store, app.state.hermes_execution
    principal = Principal("owner")
    workspace = store.create(principal, "", "workspaces", {"root": str(tmp_path)}, "workspace", "trace")
    run = store.create(principal, workspace["id"], "runs", {
        "nodes": [{"id": "write", "argv": ["echo", "x"]}],
        "execution_owner": "old-owner", "lease_expires_at": time.time() - 10,
    }, "run", "trace", status="running")
    execution.recover(principal, workspace["id"])
    recovered = store.get(principal, workspace["id"], "runs", run["id"])
    assert recovered["status"] == "failed"
    assert recovered["data"]["recovery_requires_review"] is True
    with pytest.raises(CoreError, match="ownership changed"):
        execution.patch(principal, workspace["id"], run["id"], "node.evidence", lambda row: {"status": "completed"}, "old-owner")
    assert len(store.stream(principal, workspace["id"], entity_id=run["id"])) == 2


def test_token_symlink_is_not_followed(tmp_path):
    target = tmp_path / "real-token"
    target.write_text("x" * 48)
    link = tmp_path / "token"
    link.symlink_to(target)
    with pytest.raises(ValueError, match="symbolic link"):
        ensure_token_file(link)
    assert target.read_text() == "x" * 48


def test_auth_error_envelope_is_complete(tmp_path):
    response = TestClient(create_app(tmp_path, "token")).get("/api/v2/workspaces")
    assert response.status_code == 401
    assert {"ok", "scope", "summary", "items", "actions", "permissions", "audit", "trace_id", "cli", "agent_consumption"} <= response.json().keys()
    assert response.json()["permissions"] == []
