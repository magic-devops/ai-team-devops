"""The retired file protocol cannot create fake Task or delivery facts."""
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from sop_manager import path_config
from sop_manager.routers import a2a_gateway


@pytest.mark.parametrize("method", ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"])
@pytest.mark.parametrize("path", ["", "/registry", "/dispatch", "/evidence", "/execution-windows/actions"])
def test_all_retired_a2a_methods_fail_closed_and_preserve_actual_legacy_source(monkeypatch, tmp_path, method, path):
    monkeypatch.setattr(path_config, "resolved_ai_memory_root", lambda: tmp_path)
    source = tmp_path / "a2a" / "dispatches" / "unique-user-dispatch.json"
    source.parent.mkdir(parents=True)
    source.write_text('{"id":"unique-user-dispatch","status":"success"}', encoding="utf-8")
    before = {p.relative_to(tmp_path).as_posix(): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()}
    app = FastAPI(); app.include_router(a2a_gateway.router)
    response = TestClient(app).request(method, "/api/v1/a2a" + path,
        json={"task_id": "made-up", "status": "success", "percent": 50})
    assert response.status_code == 410
    if method != "HEAD":
        assert response.json()["detail"]["code"] == "legacy_agent_execution_retired"
        assert response.json()["detail"]["replacement"] == "/api/v1/delivery/work-orders"
    assert {p.relative_to(tmp_path).as_posix(): p.read_bytes() for p in tmp_path.rglob("*") if p.is_file()} == before
