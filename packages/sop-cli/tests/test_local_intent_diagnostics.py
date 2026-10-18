from sop_cli.commands import doctor
from sop_sdk import AgentConfig, EventOutbox, FrozenEvent


def test_sync_diagnostic_reads_canonical_queue_and_preserves_old_drafts(tmp_path):
    cfg = AgentConfig(project_id="P", project_path=tmp_path, outbox_path="queues/original.sqlite")
    with EventOutbox(tmp_path / cfg.outbox_path) as box:
        box.enqueue(
            FrozenEvent.create("generic.fact", {}, event_id="original", time="2026-10-18T00:00:00Z"), "P"
        )
    legacy = tmp_path / ".sop-runtime/sync/push_queue.jsonl"
    legacy.parent.mkdir(parents=True)
    legacy.write_bytes(b"unparseable original\r\n")
    before = legacy.read_bytes()
    healthy, detail = doctor._check_sync_local(cfg)
    assert healthy
    assert "pending=1" in detail
    assert legacy.read_bytes() == before
    assert not (tmp_path / ".sop-runtime/outbox.sqlite").exists()


def test_sync_diagnostic_does_not_initialize_a_missing_queue(tmp_path):
    cfg = AgentConfig(project_id="P", project_path=tmp_path)
    assert doctor._check_sync_local(cfg)[0]
    assert not (tmp_path / cfg.outbox_path).exists()
