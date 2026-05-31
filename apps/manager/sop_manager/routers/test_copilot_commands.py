from fastapi.testclient import TestClient

from sop_manager.main import app


def test_copilot_execute_operation_preview_and_apply():
    client = TestClient(app)

    preview = client.post(
        "/api/v1/copilot/commands/execute",
        json={"command_id": "ops.health", "dry_run": True, "session_id": "cp-test", "run_id": "run-preview"},
    )
    assert preview.status_code == 200
    preview_body = preview.json()
    assert preview_body["dry_run"] is True
    assert preview_body["status"] == "planned"
    assert preview_body["evidence"]["plan"]["safe_to_execute"] is True

    applied = client.post(
        "/api/v1/copilot/commands/execute",
        json={"command_id": "ops.health", "dry_run": False, "session_id": "cp-test", "run_id": "run-apply"},
    )
    assert applied.status_code == 200
    applied_body = applied.json()
    assert applied_body["dry_run"] is False
    assert applied_body["status"] == "succeeded"
    assert applied_body["evidence"]["result"]["ok"] is True
    assert applied_body["evidence"]["audit_chain"].get("hash")


def test_copilot_execute_rejects_unknown_command():
    client = TestClient(app)

    response = client.post(
        "/api/v1/copilot/commands/execute",
        json={"command_id": "ops.unknown", "dry_run": False},
    )
    assert response.status_code == 404
