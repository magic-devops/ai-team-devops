from __future__ import annotations

from sop_cli.commands import event
from sop_sdk.config import AgentConfig
from sop_sdk.event_outbox import EventOutbox
from typer.testing import CliRunner


def setup(monkeypatch, tmp_path):
    monkeypatch.setattr(event, "get_config", lambda: AgentConfig(project_id="P", project_path=tmp_path))


def test_local_enqueue_preserves_exact_original_file_and_second_id_conflicts(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path)
    raw = '{ "specversion":"1.0","id":"E","type":"generic.fact","source":"cli","subject":"", "time":"2026-10-18T00:00:00Z","datacontenttype":"application/json","data":{"原文":"é"}}'
    path = tmp_path / "event.json"
    path.write_bytes(raw.encode())
    runner = CliRunner()
    assert runner.invoke(event.app, ["enqueue-file", str(path), "--local"]).exit_code == 0
    with EventOutbox(tmp_path / ".sop-runtime/outbox.sqlite") as box:
        assert box.inspect("E")["event_json"] == raw
    path.write_bytes(raw.replace('"é"', '"é"').encode())
    result = runner.invoke(event.app, ["enqueue-file", str(path), "--local"])
    assert result.exit_code == 2 and "event_id_conflict" in result.stdout


def test_bad_200_keeps_last_copy_and_never_creates_old_jsonl(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path)

    class Client:
        def events_identity(self):
            return {"tenant_id": "T", "project_id": "P", "producer_id": "U"}

        def events_ingest(self, *args, **kwargs):
            return {"accepted": ["E"], "duplicated": []}

    monkeypatch.setattr(event, "get_client", lambda: Client())
    result = CliRunner().invoke(
        event.app, ["emit", "generic.fact", "--id", "E", "--time", "2026-10-18T00:00:00Z"]
    )
    assert result.exit_code == 2
    with EventOutbox(tmp_path / ".sop-runtime/outbox.sqlite") as box:
        assert box.inspect("E")["state"] == "pending"
        assert box.inspect("E")["attempts"] == 1
    assert not (tmp_path / ".sop-runtime/events/outbox.jsonl").exists()
    assert not (tmp_path / ".sop-runtime/events/sent.jsonl").exists()


def test_remote_list_failure_does_not_claim_local_is_remote(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path)

    class Client:
        def events_list(self, **kwargs):
            raise RuntimeError("Access denied")

    monkeypatch.setattr(event, "get_client", lambda: Client())
    result = CliRunner().invoke(event.app, ["list", "--json"])
    assert result.exit_code == 2 and "Access denied" in result.stdout
    assert not (tmp_path / ".sop-runtime/outbox.sqlite").exists()


def test_bare_local_entry_and_all_commands_have_valid_help(monkeypatch, tmp_path):
    setup(monkeypatch, tmp_path)
    runner = CliRunner()
    assert runner.invoke(event.app, []).exit_code == 0
    for command in [
        "emit",
        "enqueue-file",
        "flush",
        "list",
        "show",
        "attempts",
        "retry",
        "requeue",
        "stats",
        "migrate-v0",
    ]:
        result = runner.invoke(event.app, [command, "--help"])
        assert result.exit_code == 0, (command, result.exception)
