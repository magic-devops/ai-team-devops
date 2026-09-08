import os
import sys
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from hermes_core.api import create_app


@pytest.fixture
def live_executor(tmp_path):
    binary = os.environ.get("HERMES_TEST_AGENTD", "")
    if not binary or not Path(binary).is_file():
        pytest.skip("Set HERMES_TEST_AGENTD to a built native agentd for real process execution")
    app = create_app(tmp_path / "data", "owner-token", agentd=binary)
    client = TestClient(app, headers={"Authorization": "Bearer owner-token"})
    workspace = client.post("/api/v2/workspaces", json={"data": {"name": "Executor QA", "root": str(tmp_path)}, "idempotency_key": "workspace"}).json()["items"][0]
    client.headers["X-Workspace-Id"] = workspace["id"]
    return client, tmp_path


def test_real_tdd_approval_export_and_replay(live_executor):
    client, root = live_executor
    nodes = [
        {"id": "red", "argv": [sys.executable, "-c", "import sys; print('RED: assertion failed as expected'); sys.exit(1)"], "expected_exit_code": 1},
        {"id": "review", "kind": "approval", "title": "Review test evidence"},
        {"id": "green", "argv": [sys.executable, "-c", "from pathlib import Path; Path('delivery.txt').write_text('verified'); print('GREEN: delivery verified')"]},
    ]
    run = client.post("/api/v2/runs", json={"data": {"title": "Real TDD", "nodes": nodes}, "idempotency_key": "run"}).json()["items"][0]
    start = {"expected_version": 1, "idempotency_key": "start", "dry_run": False}
    response = client.post(f"/api/v2/runs/{run['id']}/start", json=start)
    assert response.status_code == 200, response.text
    interrupted = client.get(f"/api/v2/runs/{run['id']}").json()["items"][0]
    assert interrupted["status"] == "interrupted", interrupted
    assert not (root / "delivery.txt").exists()
    assert interrupted["data"]["node_results"]["red"]["exit_code"] == 1
    approval = client.get("/api/v2/approvals").json()["items"][0]
    decision = {"expected_version": approval["version"], "idempotency_key": "decision", "decision": "approve"}
    assert client.post(f"/api/v2/approvals/{approval['id']}/decision", json=decision).status_code == 200
    completed = client.get(f"/api/v2/runs/{run['id']}").json()["items"][0]
    assert completed["status"] == "completed", completed
    assert (root / "delivery.txt").read_text() == "verified"
    before = client.get(f"/api/v2/runs/{run['id']}/events").json()["items"]
    assert client.post(f"/api/v2/runs/{run['id']}/start", json=start).status_code == 200
    assert client.post(f"/api/v2/approvals/{approval['id']}/decision", json=decision).status_code == 200
    assert client.get(f"/api/v2/runs/{run['id']}/events").json()["items"] == before
    export = {"expected_version": completed["version"], "idempotency_key": "export", "dry_run": False}
    first = client.post(f"/api/v2/runs/{run['id']}/export", json=export)
    assert first.status_code == 200, first.text
    assert first.json()["items"][0]["data"]["events"] == before
    assert client.post(f"/api/v2/runs/{run['id']}/export", json=export).json()["items"] == first.json()["items"]
    replay = client.post(f"/api/v2/runs/{run['id']}/replay", json={**export, "idempotency_key": "replay"})
    assert replay.status_code == 200, replay.text
    assert replay.json()["items"][0]["status"] == "planned"
    assert "node_results" not in replay.json()["items"][0]["data"]


def test_retry_only_failed_unit(live_executor):
    client, root = live_executor
    nodes = [
        {"id": "once", "argv": [sys.executable, "-c", "from pathlib import Path; p=Path('count'); p.write_text(str(int(p.read_text())+1) if p.exists() else '1')"]},
        {"id": "unstable", "argv": [sys.executable, "-c", "from pathlib import Path; import sys; p=Path('attempt'); retry=p.exists(); p.touch(); sys.exit(0 if retry else 1)"]},
    ]
    run = client.post("/api/v2/runs", json={"data": {"nodes": nodes}, "idempotency_key": "run"}).json()["items"][0]
    assert client.post(f"/api/v2/runs/{run['id']}/start", json={"expected_version": 1, "idempotency_key": "start", "dry_run": False}).status_code == 200
    failed = client.get(f"/api/v2/runs/{run['id']}").json()["items"][0]
    assert failed["status"] == "failed", failed
    result = client.post(f"/api/v2/runs/{run['id']}/retry", json={"expected_version": failed["version"], "idempotency_key": "retry", "dry_run": False})
    assert result.status_code == 200, result.text
    completed = client.get(f"/api/v2/runs/{run['id']}").json()["items"][0]
    assert completed["status"] == "completed", completed
    assert (root / "count").read_text() == "1"
