"""Receipt scope and interrupted rule storage must retain the original intent."""

import json
from contextlib import contextmanager
from dataclasses import replace
from pathlib import Path

import pytest
from sop_cli import local_intents, rule_store
from sop_cli.commands import rule
from sop_sdk import AgentConfig, EventOutbox
from sop_sdk.event_sender import flush_outbox
from sop_sdk.record_intents import freeze_record_intent
from typer.testing import CliRunner

STAMP = "2026-10-18T06:00:00Z"
ARGUMENTS = dict(
    module="issues",
    record={"id": "I", "title": "Original"},
    action="create",
    expected_version=4,
    key="original-operation",
    event_time=STAMP,
)


class OriginalClient:
    def events_identity(self):
        return {"tenant_id": "T", "project_id": "P", "producer_id": "U"}

    def events_ingest(self, events, *, identity):
        event = events[0]
        return {
            "tenant_id": "T",
            "project_id": "P",
            "producer": {"kind": "user", "id": "U"},
            "as_of": STAMP,
            "results": [
                {
                    "id": event.id,
                    "digest": event.digest,
                    "outcome": "stored",
                    "receipt_id": "receipt-original",
                    "stored_at": STAMP,
                    "error": None,
                    "processing": {
                        "state": "processed",
                        "revision": 2,
                        "handler": "sync.record",
                        "operation_id": "operation-original",
                        "attempts": 1,
                        "updated_at": STAMP,
                        "processed_at": STAMP,
                        "reason_code": None,
                        "retryable": False,
                        "result": {"kind": "record_upserted", "target_kind": "issue", "target_id": "I"},
                    },
                }
            ],
        }


@pytest.mark.parametrize("local", [True, False])
def test_acked_original_cannot_claim_success_under_changed_manager(monkeypatch, tmp_path, local):
    config = AgentConfig(
        project_id="P", tenant_id="T", project_path=tmp_path, manager_url="https://a.invalid/base"
    )

    @contextmanager
    def client_factory(cfg):
        assert cfg.manager_url == config.manager_url
        yield OriginalClient()

    monkeypatch.setattr(local_intents, "build_default_client", client_factory)
    assert local_intents.submit_record(config, local=False, **ARGUMENTS)["ok"]
    second = local_intents.submit_record(
        replace(config, manager_url="https://b.invalid/base"), local=local, **ARGUMENTS
    )
    assert not second["ok"] and second["delivery_error"] == "scope_mismatch"
    assert second["receipt_id"] is None and second["processing"] is None
    with EventOutbox(tmp_path / config.outbox_path) as box:
        assert box.inspect(ARGUMENTS["key"])["manager_origin"] == "https://a.invalid/base"


def test_concurrent_original_ack_cannot_be_presented_under_another_user(monkeypatch, tmp_path):
    config = AgentConfig(project_id="P", tenant_id="T", project_path=tmp_path)
    frozen = freeze_record_intent(**ARGUMENTS)
    with EventOutbox(tmp_path / config.outbox_path) as box:
        box.enqueue(frozen, "P")

    class OtherUser:
        calls = 0

        def events_identity(self):
            self.calls += 1
            if self.calls == 1:
                # Another real SQLite connection delivers the same original while this sender is selecting it.
                with EventOutbox(tmp_path / config.outbox_path) as concurrent:
                    flush_outbox(
                        concurrent, OriginalClient(), intended_project_id="P", manager_url=config.manager_url
                    )
            return {"tenant_id": "T", "project_id": "P", "producer_id": "another-user"}

        def events_ingest(self, *args, **kwargs):
            pytest.fail("The deferred operation must not be resent under another user")

    @contextmanager
    def client_factory(_):
        yield OtherUser()

    monkeypatch.setattr(local_intents, "build_default_client", client_factory)
    result = local_intents.submit_frozen(config, frozen, local=False)
    assert result["delivery_state"] == "acked" and not result["ok"]
    assert result["delivery_error"] == "scope_mismatch"
    assert result["receipt_id"] is None and result["processing"] is None


def test_rule_flush_uses_one_original_configuration(monkeypatch, tmp_path):
    original = AgentConfig(project_id="P", project_path=tmp_path / "original")
    other = AgentConfig(project_id="Q", project_path=tmp_path / "other")
    target = rule_store.rules_target(original)
    target.parent.mkdir(parents=True)
    target.write_bytes(b"Original rules\r\n")
    configurations = iter([original, other])
    monkeypatch.setattr(rule, "get_config", lambda: next(configurations))
    result = CliRunner().invoke(
        rule.app,
        [
            "flush",
            "--expected-version",
            "4",
            "--key",
            "rule-original",
            "--time",
            STAMP,
            "--expected-sha256",
            "absent",
            "--local",
        ],
    )
    assert result.exit_code == 0, result.output
    with EventOutbox(original.project_path / original.outbox_path) as box:
        row = box.inspect("rule-original")
        assert row["intended_project_id"] == "P"
        assert json.loads(row["event_json"])["data"]["record"]["content"] == "Original rules\r\n"
    assert not (other.project_path / other.outbox_path).exists()


def test_partial_proposal_write_never_publishes_invalid_json(monkeypatch, tmp_path):
    config = AgentConfig(project_id="P", project_path=tmp_path)
    healthy = rule_store.create_proposal(config, "Existing", "coding", "human", 0.75, STAMP)
    original_open = Path.open

    class PartialWrite:
        def __init__(self, handle):
            self.handle = handle

        def __enter__(self):
            return self

        def __exit__(self, *args):
            self.handle.close()

        def write(self, data):
            self.handle.write(data[: len(data) // 2])
            self.handle.flush()
            raise OSError("interrupted storage")

        def __getattr__(self, name):
            return getattr(self.handle, name)

    def broken_open(path, mode="r", *args, **kwargs):
        handle = original_open(path, mode, *args, **kwargs)
        return PartialWrite(handle) if mode == "xb" else handle

    with monkeypatch.context() as fault:
        fault.setattr(Path, "open", broken_open)
        with pytest.raises(OSError, match="interrupted storage"):
            rule_store.create_proposal(config, "Interrupted", "coding", "human", 0.75, STAMP)
    assert [item["id"] for item in rule_store.list_proposals(config)["items"]] == [healthy["id"]]


def test_applied_body_recovers_after_status_write_failure(monkeypatch, tmp_path):
    config = AgentConfig(project_id="P", project_path=tmp_path)
    target = rule_store.rules_target(config)
    target.parent.mkdir(parents=True)
    target.write_bytes(b"# Original\r\n\r\n")
    proposal = rule_store.create_proposal(config, "Reviewed original", "coding", "human", 0.75, STAMP)
    original_atomic = rule_store._atomic

    def fail_status(path, data):
        if path.parent == rule_store.proposal_directory(config):
            raise OSError("status write failed")
        original_atomic(path, data)

    with monkeypatch.context() as fault:
        fault.setattr(rule_store, "_atomic", fail_status)
        with pytest.raises(OSError, match="status write failed"):
            rule_store.apply_proposal(config, proposal["id"], STAMP)
    original_bytes = target.read_bytes()
    applied, _ = rule_store.apply_proposal(config, proposal["id"], STAMP)
    assert applied["status"] == "applied" and target.read_bytes() == original_bytes
    assert original_bytes.count(b"Reviewed original") == 1
