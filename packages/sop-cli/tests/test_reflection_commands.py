from __future__ import annotations

import importlib
import importlib.util
import json
from contextlib import contextmanager

import httpx
import pytest
from typer.testing import CliRunner

from sop_cli import local_intents
from sop_sdk import ManagerClient
from sop_sdk.config import AgentConfig
from sop_sdk.event_outbox import EventOutbox

AT = "2026-10-19T00:00:00Z"


def cli():
    assert importlib.util.find_spec("sop_cli.commands.reflection") is not None, "Reflection command group is missing"
    return importlib.import_module("sop_cli.commands.reflection")


def payload():
    return {"schema_version": 1, "category": "testing", "title": "原题 é", "observation": "真实观察的陈述"}


def prepare_ack():
    return {"project_id": "P", "action": "reflection.input.create",
            "resource": {"kind": "reflection_input", "id": "input-original"},
            "result": {"status": "prepared", "source_count": 1},
            "affected_refs": [{"kind": "reflection_input", "id": "input-original"}],
            "applied_version": 6, "version": 9, "query_generation": None, "replayed": True}


def prepare_command():
    return {"action": "reflection.input.create", "expected_version": 5, "idempotency_key": "original-input-key",
            "payload": {"title": "固定输入", "rationale": "已人工核对", "sources": [
                {"reflection_id": "deleted-later", "source_digest": "a" * 64, "attempt_id": "original-attempt"}]}}


def configure(monkeypatch, handler):
    module = cli()

    @contextmanager
    def manager():
        with ManagerClient("https://manager.test", project_id="P", max_retries=0) as client:
            client._client.close()
            client._client = httpx.Client(base_url=client.base_url, transport=httpx.MockTransport(handler))
            yield client

    monkeypatch.setattr(module, "get_client", manager)
    return module


def test_record_goes_to_real_outbox_and_preserves_original_after_reopen(monkeypatch, tmp_path):
    module = cli()
    config = AgentConfig(project_id="P", project_path=tmp_path)
    monkeypatch.setattr(module, "get_config", lambda: config)
    path = tmp_path / "claim.json"
    path.write_text(json.dumps(payload(), ensure_ascii=False), encoding="utf-8")
    args = ["record", "--file", str(path), "--id", "original", "--time", AT, "--local"]
    result = CliRunner().invoke(module.app, args)
    assert result.exit_code == 0, result.output
    outcome = json.loads(result.output)
    assert outcome["delivery_state"] == "pending" and outcome["processing"] is None
    with EventOutbox(tmp_path / config.outbox_path) as box:
        original = box.inspect("original")
        assert json.loads(original["event_json"])["data"]["title"] == payload()["title"]
        assert json.loads(original["event_json"])["type"] == "sop.reflection.recorded"
    repeated = CliRunner().invoke(module.app, args)
    assert repeated.exit_code == 0 and json.loads(repeated.output)["replayed"] is True
    path.write_text(json.dumps({**payload(), "lesson": "changed"}), encoding="utf-8")
    changed = CliRunner().invoke(module.app, args)
    assert changed.exit_code != 0 and "event_id_conflict" in changed.output
    with EventOutbox(tmp_path / config.outbox_path) as box:
        assert box.inspect("original")["event_json"] == original["event_json"]
    assert not (tmp_path / ".sop-runtime/events/outbox.jsonl").exists()


def test_record_validates_but_never_reserializes_an_existing_full_envelope(monkeypatch, tmp_path):
    module = cli()
    config = AgentConfig(project_id="P", project_path=tmp_path)
    monkeypatch.setattr(module, "get_config", lambda: config)
    raw = '{ "specversion":"1.0", "id":"original", "type":"sop.reflection.recorded", "source":"external", "subject":"", "time":"2026-10-19t00:00:00z", "datacontenttype":"application/json", "data":{"schema_version":1,"category":"testing","title":"é","observation":"原文 < & >"}}\n'
    path = tmp_path / "original.json"
    path.write_bytes(raw.encode())
    result = CliRunner().invoke(module.app, ["record", "--event-file", str(path), "--local"])
    assert result.exit_code == 0, result.output
    with EventOutbox(tmp_path / config.outbox_path) as box:
        assert box.inspect("original")["event_json"] == raw


def test_record_requires_explicit_original_identity_and_rejects_two_sources(monkeypatch, tmp_path):
    module = cli()
    config = AgentConfig(project_id="P", project_path=tmp_path)
    monkeypatch.setattr(module, "get_config", lambda: config)
    path = tmp_path / "claim.json"
    path.write_text(json.dumps(payload()), encoding="utf-8")
    for args in [
        ["record", "--file", str(path), "--local"],
        ["record", "--file", str(path), "--event-file", str(path), "--id", "original", "--time", AT, "--local"],
        ["record", "--event-file", str(path), "--id", "replacement", "--local"],
    ]:
        result = CliRunner().invoke(module.app, args)
        assert result.exit_code != 0
    assert not (tmp_path / config.outbox_path).exists()


@pytest.mark.parametrize("raw", [
    '{"schema_version":1,"schema_version":1,"category":"other","title":"t","observation":"o"}',
    '{"schema_version":true,"category":"other","title":"t","observation":"o"}',
    '{"schema_version":1,"category":"other","title":"t","observation":"o","producer_id":"forged"}',
])
def test_invalid_claim_never_creates_a_local_queue(monkeypatch, tmp_path, raw):
    module = cli()
    config = AgentConfig(project_id="P", project_path=tmp_path)
    monkeypatch.setattr(module, "get_config", lambda: config)
    path = tmp_path / "invalid.json"
    path.write_bytes(raw.encode())
    result = CliRunner().invoke(module.app, ["record", "--file", str(path), "--id", "original", "--time", AT, "--local"])
    assert result.exit_code != 0
    assert not (tmp_path / config.outbox_path).exists()


def test_remote_record_distinguishes_stored_pending_from_processed_collection(monkeypatch, tmp_path):
    module = cli()
    config = AgentConfig(project_id="P", project_path=tmp_path, manager_url="https://manager.test")
    monkeypatch.setattr(module, "get_config", lambda: config)
    phase = {"state": "pending"}
    sends = []

    def handle(request):
        if request.url.path == "/api/v1/events:identity":
            return httpx.Response(200, json={"tenant_id": "T", "project_id": "P", "producer_id": "U"})
        assert request.url.path == "/api/v1/events:ingest"
        event = json.loads(request.content)["events"][0]
        sends.append(event)
        processed = phase["state"] == "processed"
        return httpx.Response(200, json={
            "tenant_id": "T", "project_id": "P", "producer": {"kind": "user", "id": "U"}, "as_of": AT,
            "results": [{"id": event["id"], "digest": event["digest"], "outcome": "stored",
                "receipt_id": "receipt-" + event["id"], "stored_at": AT, "error": None,
                "processing": {"state": phase["state"], "revision": 2 if processed else 1,
                    "handler": "reflection.record", "operation_id": None, "attempts": 1 if processed else 0,
                    "updated_at": AT, "processed_at": AT if processed else None,
                    "reason_code": None, "retryable": not processed,
                    "result": {"kind": "reflection_recorded", "target_kind": "reflection",
                               "target_id": "receipt-" + event["id"]} if processed else None}}],
        })

    @contextmanager
    def manager(cfg):
        with ManagerClient(cfg.manager_url, project_id=cfg.project_id, max_retries=0) as client:
            client._client.close()
            client._client = httpx.Client(base_url=client.base_url, transport=httpx.MockTransport(handle))
            yield client

    monkeypatch.setattr(local_intents, "build_default_client", manager)
    path = tmp_path / "claim.json"
    path.write_text(json.dumps(payload()), encoding="utf-8")
    runner = CliRunner()
    args = ["record", "--file", str(path), "--time", AT]
    pending = runner.invoke(module.app, [*args, "--id", "pending"])
    pending_json = json.loads(pending.output)
    assert pending_json["delivery_state"] == "acked" and pending_json["processing"]["state"] == "pending"
    assert pending_json["ok"] is False
    phase["state"] = "processed"
    collected = runner.invoke(module.app, [*args, "--id", "collected"])
    assert collected.exit_code == 0, collected.output
    outcome = json.loads(collected.output)
    assert outcome["delivery_state"] == "acked" and outcome["processing"]["state"] == "processed"
    assert outcome["processing"]["result"]["kind"] == "reflection_recorded"
    assert len(sends) == 2


@pytest.mark.parametrize("args,path,params", [
    (["list", "--json"], "/api/v1/reflections", {"limit": "20"}),
    (["list", "--category", "testing", "--from", "2026-10-19T00:00:00+08:00", "--to", "2026-10-20T00:00:00+08:00",
      "--limit", "1", "--cursor", "opaque/+?window", "--json"], "/api/v1/reflections",
     {"category": "testing", "occurred_from": "2026-10-19T00:00:00+08:00", "occurred_to": "2026-10-20T00:00:00+08:00",
      "limit": "1", "cursor": "opaque/+?window"}),
    (["show", "old", "--json"], "/api/v1/reflections/old", {}),
    (["inputs", "--limit", "2", "--cursor", "input-window", "--json"], "/api/v1/reflections/inputs",
     {"limit": "2", "cursor": "input-window"}),
    (["input", "old", "--json"], "/api/v1/reflections/inputs/old", {}),
])
def test_cli_reads_exact_objects_or_one_requested_window(monkeypatch, args, path, params):
    seen = []
    body = {"project_id": "P", "items": [], "total": 500, "next_cursor": "unrequested", "available": False}
    module = configure(monkeypatch, lambda req: seen.append(req) or httpx.Response(200, json=body))
    result = CliRunner().invoke(module.app, args)
    assert result.exit_code == 0 and json.loads(result.output) == body, result.output
    assert len(seen) == 1 and seen[0].url.path == path and dict(seen[0].url.params) == params


@pytest.mark.parametrize("status", [403, 404, 409, 503])
def test_exact_read_failure_is_not_empty_success_or_another_source(monkeypatch, status):
    seen = []
    module = configure(monkeypatch, lambda req: seen.append(req) or httpx.Response(status, json={"detail": "Original unavailable"}))
    result = CliRunner().invoke(module.app, ["show", "old", "--json"])
    assert result.exit_code == 1 and "Original unavailable" in result.output
    assert len(seen) == 1 and seen[0].url.path == "/api/v1/reflections/old"


def test_prepare_retries_the_same_original_file_after_a_lost_ack_without_source_reads(monkeypatch, tmp_path):
    seen = []

    def handle(request):
        assert request.method == "POST" and request.url.path == "/api/v1/delivery/commands"
        seen.append(request.content)
        if len(seen) == 1:
            raise httpx.ReadError("ACK lost after committed input", request=request)
        return httpx.Response(200, json=prepare_ack())

    module = configure(monkeypatch, handle)
    body = prepare_command()
    path = tmp_path / "original-command.json"
    path.write_bytes(json.dumps(body, ensure_ascii=False, indent=2).encode())
    raw = path.read_bytes()
    args = ["prepare", "--file", str(path)]
    first = CliRunner().invoke(module.app, args)
    assert first.exit_code == 1 and path.read_bytes() == raw
    second = CliRunner().invoke(module.app, args)
    assert second.exit_code == 0 and json.loads(second.output)["replayed"] is True, second.output
    assert len(seen) == 2 and seen[0] == seen[1] and json.loads(seen[1]) == body
    assert path.read_bytes() == raw


@pytest.mark.parametrize("change", [
    "empty", "partial", "wrong-project", "wrong-action", "wrong-resource", "mismatched-ref",
    "extra-source-ref", "wrong-count", "wrong-status", "wrong-applied-version", "old-version",
    "bad-generation", "bad-replayed", "invalid-json", "oversize", "duplicate-key",
])
def test_prepare_keeps_unverified_ack_unknown_and_recovers_only_the_original_file(monkeypatch, tmp_path, change):
    ack = prepare_ack()
    if change == "empty": ack = {}
    elif change == "partial": del ack["project_id"]
    elif change == "wrong-project": ack["project_id"] = "Q"
    elif change == "wrong-action": ack["action"] = "task.delivery.submit"
    elif change == "wrong-resource": ack["resource"] = {"kind": "task", "id": "input-original"}
    elif change == "mismatched-ref": ack["affected_refs"][0]["id"] = "different-input"
    elif change == "extra-source-ref": ack["affected_refs"].append({"kind": "reflection", "id": "deleted-later"})
    elif change == "wrong-count": ack["result"]["source_count"] = 2
    elif change == "wrong-status": ack["result"]["status"] = "processed"
    elif change == "wrong-applied-version": ack["applied_version"] = 5
    elif change == "old-version": ack["version"] = 5
    elif change == "bad-generation": ack["query_generation"] = True
    elif change == "bad-replayed": ack["replayed"] = "true"
    raw_ack = {"invalid-json": b"{", "oversize": b"{}" + b" " * 65535,
               "duplicate-key": b'{"project_id":"P","project_id":"P"}'}.get(change)
    seen = []

    def handle(request):
        assert request.method == "POST" and request.url.path == "/api/v1/delivery/commands"
        seen.append(request.content)
        if len(seen) == 1:
            if raw_ack is not None:
                return httpx.Response(200, content=raw_ack, headers={"Content-Type": "application/json"})
            return httpx.Response(200, json=ack)
        return httpx.Response(200, json=prepare_ack())

    module = configure(monkeypatch, handle)
    path = tmp_path / "original-command.json"
    original = json.dumps(prepare_command(), ensure_ascii=False, indent=2).encode()
    path.write_bytes(original)
    args = ["prepare", "--file", str(path)]
    first = CliRunner().invoke(module.app, args)
    assert first.exit_code == 1 and path.read_bytes() == original
    message = "".join(first.output.split())
    assert "尚未确认" in message and "同一原文件" in message
    second = CliRunner().invoke(module.app, args)
    assert second.exit_code == 0 and json.loads(second.output) == prepare_ack(), second.output
    assert len(seen) == 2 and seen[0] == seen[1] and json.loads(seen[0]) == prepare_command()
    assert path.read_bytes() == original


def test_prepare_does_not_dispatch_a_different_action_or_fill_missing_original_version(monkeypatch, tmp_path):
    module = configure(monkeypatch, lambda _: pytest.fail("Invalid input command reached transport"))
    path = tmp_path / "command.json"
    for body in [
        {"action": "task.update", "expected_version": 1, "idempotency_key": "original-input-key", "payload": {}},
        {"action": "reflection.input.create", "idempotency_key": "original-input-key", "payload": {}},
    ]:
        path.write_text(json.dumps(body), encoding="utf-8")
        assert CliRunner().invoke(module.app, ["prepare", "--file", str(path)]).exit_code != 0


def test_registered_reflection_group_and_all_canonical_commands_have_help():
    from sop_cli.__main__ import app
    from sop_cli.commands_info import COMMAND_TREE

    result = CliRunner().invoke(app, ["reflection", "--help"])
    assert result.exit_code == 0, result.output
    assert "reflection" in COMMAND_TREE
    module = cli()
    for name in ["record", "list", "show", "inputs", "input", "prepare"]:
        result = CliRunner().invoke(module.app, [name, "--help"])
        assert result.exit_code == 0, result.output
