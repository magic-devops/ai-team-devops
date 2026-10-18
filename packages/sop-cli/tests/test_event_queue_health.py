from sop_cli.commands import context, doctor, status
from sop_sdk import AgentConfig, EventOutbox, FrozenEvent


def test_status_and_doctor_read_actual_sqlite_counts_and_dead_letters(tmp_path):
    path = tmp_path / ".sop-runtime/outbox.sqlite"
    with EventOutbox(path) as box:
        for event_id in ["pending", "dead"]:
            event = FrozenEvent.create("generic.fact", {}, event_id=event_id, time="2026-10-18T00:00:00Z")
            box.enqueue(event, "P")
        box.fail("dead", 1, "unavailable", "offline", max_attempts=1)
    before = path.read_bytes()
    observed = status._read_outboxes(tmp_path)["events"]
    assert observed["pending"] == 1 and observed["dead_letter"] == 1
    healthy, detail = doctor._check_agent_outboxes(AgentConfig(project_path=tmp_path))
    assert not healthy and "dead_letter=1" in detail
    assert path.read_bytes() == before


def test_corrupt_queue_is_unknown_not_zero_success_and_missing_queue_stays_absent(tmp_path):
    path = tmp_path / ".sop-runtime/outbox.sqlite"
    assert status._read_outboxes(tmp_path)["events"]["pending"] == 0
    assert not path.exists()
    path.parent.mkdir()
    path.write_bytes(b"invalid sqlite database")
    observed = status._read_outboxes(tmp_path)["events"]
    assert observed["pending"] is None and observed["bad"] == 1
    assert path.read_bytes() == b"invalid sqlite database"


def test_agent_manifest_and_env_use_configured_single_queue(monkeypatch, tmp_path):
    cfg = AgentConfig(project_path=tmp_path, project_id="P", outbox_path="queues/current.sqlite")
    monkeypatch.setattr(context, "get_config", lambda: cfg)
    manifest = context.build_project_manifest()
    assert manifest["local"]["event_outbox"] == str(tmp_path / cfg.outbox_path)
    assert str(tmp_path / cfg.outbox_path) in next(
        line for line in context.build_env_lines() if "SOP_EVENT_OUTBOX=" in line
    )
