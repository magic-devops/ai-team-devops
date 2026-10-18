import json

from sop_cli.commands import sync
from sop_sdk import AgentConfig, EventOutbox


def test_explicit_create_is_frozen_once_without_local_business_overlay(monkeypatch, tmp_path):
    config = AgentConfig(project_path=tmp_path, project_id="P")
    monkeypatch.setattr("sop_cli._util.get_config", lambda: config)
    from sop_cli.commands import event

    monkeypatch.setattr(event, "get_config", lambda: config)
    result = sync._frozen_sync(
        "tasks",
        {"id": "T-created", "title": "Original"},
        "create",
        "create-original-001",
        "2026-10-18T00:00:00Z",
        7,
    )
    assert result["id"] == "create-original-001"
    with EventOutbox(tmp_path / ".sop-runtime/outbox.sqlite") as box:
        row = box.inspect("create-original-001")
        assert row["state"] == "pending"
        assert json.loads(row["event_json"])["data"] == {
            "module": "tasks",
            "action": "create",
            "record": {"id": "T-created", "title": "Original"},
            "expected_version": 7,
        }
    assert not (tmp_path / ".sop-runtime/local").exists()
    assert not (tmp_path / ".sop-runtime/sync/push_queue.jsonl").exists()


def test_sparse_patch_keeps_original_task_basis_outside_record(monkeypatch, tmp_path):
    config = AgentConfig(project_path=tmp_path, project_id="P")
    monkeypatch.setattr("sop_cli._util.get_config", lambda: config)
    from sop_cli.commands import event

    monkeypatch.setattr(event, "get_config", lambda: config)
    sync._frozen_sync(
        "tasks",
        {"id": "T", "owner_id": "user:author"},
        "update",
        "basis-original-001",
        "2026-10-18T00:00:00Z",
        7,
        task_basis="a" * 64,
    )
    with EventOutbox(tmp_path / ".sop-runtime/outbox.sqlite") as box:
        data = json.loads(box.inspect("basis-original-001")["event_json"])["data"]
    assert data["record"] == {"id": "T", "owner_id": "user:author"}
    assert data["task_basis"] == "a" * 64
