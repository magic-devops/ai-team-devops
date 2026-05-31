from fastapi.testclient import TestClient

from sop_manager.main import app


def test_copilot_commands_include_policy_contract():
    client = TestClient(app)

    response = client.get("/api/v1/copilot/commands", params={"q": "billing", "limit": 5})
    assert response.status_code == 200
    body = response.json()
    command = next(item for item in body["items"] if item["id"] == "ops.billing_summary")
    assert command["policy"]["required_capability"] == "system.billing.summary"
    assert command["policy"]["risk_level"] == "high"
    assert command["policy"]["approval_required"] is True


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


def test_copilot_execute_respects_approval_policy():
    client = TestClient(app)
    run_id = "run-approval-queue"

    blocked = client.post(
        "/api/v1/copilot/commands/execute",
        json={"command_id": "ops.audit_verify", "dry_run": False, "session_id": "cp-test", "run_id": run_id},
    )
    assert blocked.status_code == 200
    blocked_body = blocked.json()
    assert blocked_body["status"] == "approval_required"
    assert blocked_body["evidence"]["plan"]["policy"]["approval_required"] is True
    assert blocked_body["evidence"]["next_action"] == "review_approval"
    approval_id = blocked_body["evidence"]["approval"]["id"]

    repeated = client.post(
        "/api/v1/copilot/commands/execute",
        json={"command_id": "ops.audit_verify", "dry_run": False, "session_id": "cp-test", "run_id": run_id},
    )
    assert repeated.status_code == 200
    assert repeated.json()["evidence"]["approval"]["id"] == approval_id

    pending = client.get("/api/v1/copilot/commands/approvals", params={"status": "pending", "limit": 20})
    assert pending.status_code == 200
    assert any(item["id"] == approval_id and item["command_id"] == "ops.audit_verify" for item in pending.json()["items"])

    reviewed = client.post(
        f"/api/v1/copilot/commands/approvals/{approval_id}/review",
        json={"status": "approved", "reviewer": "pytest", "note": "ok"},
    )
    assert reviewed.status_code == 200
    assert reviewed.json()["item"]["status"] == "approved"

    confirmed = client.post(
        "/api/v1/copilot/commands/execute",
        json={
            "command_id": "ops.audit_verify",
            "dry_run": False,
            "approval_confirmed": True,
            "session_id": "cp-test",
            "run_id": "run-confirmed",
            "context": {"approval_id": approval_id},
        },
    )
    assert confirmed.status_code == 200
    confirmed_body = confirmed.json()
    assert confirmed_body["status"] == "succeeded"
    assert confirmed_body["evidence"]["approval"]["status"] == "executed"
    assert confirmed_body["evidence"]["audit_chain"].get("hash")


def test_copilot_rejected_approval_blocks_execution():
    client = TestClient(app)

    blocked = client.post(
        "/api/v1/copilot/commands/execute",
        json={"command_id": "ops.billing_summary", "dry_run": False, "session_id": "cp-test", "run_id": "run-reject-approval"},
    )
    assert blocked.status_code == 200
    approval_id = blocked.json()["evidence"]["approval"]["id"]

    reviewed = client.post(
        f"/api/v1/copilot/commands/approvals/{approval_id}/review",
        json={"status": "rejected", "reviewer": "pytest", "note": "deny"},
    )
    assert reviewed.status_code == 200
    assert reviewed.json()["item"]["status"] == "rejected"

    confirmed = client.post(
        "/api/v1/copilot/commands/execute",
        json={
            "command_id": "ops.billing_summary",
            "dry_run": False,
            "approval_confirmed": True,
            "session_id": "cp-test",
            "run_id": "run-reject-apply",
            "context": {"approval_id": approval_id},
        },
    )
    assert confirmed.status_code == 409


def test_copilot_execute_rejects_unknown_command():
    client = TestClient(app)

    response = client.post(
        "/api/v1/copilot/commands/execute",
        json={"command_id": "ops.unknown", "dry_run": False},
    )
    assert response.status_code == 404
