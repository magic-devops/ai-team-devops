"""Actual CLI and SDK keep current selections, fixed history and caller-owned changes separate."""

import json
from contextlib import contextmanager

import httpx
import pytest
from sop_cli import local_intents
from sop_cli.commands import delivery
from sop_sdk import AgentConfig, EventOutbox
from sop_sdk.client import ManagerClient
from typer.testing import CliRunner


def configure(monkeypatch, handler):
    @contextmanager
    def client():
        with ManagerClient("https://manager.example", project_id="selected", max_retries=0) as manager:
            manager._client.close()
            manager._client = httpx.Client(base_url=manager.base_url, transport=httpx.MockTransport(handler))
            yield manager
    monkeypatch.setattr(delivery, "get_client", client)


READS = [
    (["requirement", "--id", "需求🙂"], "/requirements/需求🙂", {}),
    (["requirement-definition", "--id", "需求🙂", "--generation", "17"], "/requirements/需求🙂/definition", {"query_generation": "17"}),
    (["requirement-history", "--id", "需求🙂", "--limit", "1", "--cursor", "frozen/+?=window"], "/requirements/需求🙂/history", {"limit": "1", "cursor": "frozen/+?=window"}),
    (["requirement-history", "--id", "需求🙂", "--version", "version-one"], "/requirements/需求🙂/history/version-one", {}),
    *[(["requirement-records", "--id", "需求🙂", "--collection", collection, "--generation", "17", "--limit", "1", "--cursor", "original-window"],
       "/requirements/需求🙂/records", {"collection": collection, "query_generation": "17", "limit": "1", "cursor": "original-window"}) for collection in ("artifacts", "reviews", "releases")],
    (["requirement-record", "--id", "需求🙂", "--collection", "reviews", "--position", "0", "--generation", "17"],
     "/requirements/需求🙂/records/0", {"collection": "reviews", "query_generation": "17"}),
    (["requirement-impact", "--id", "需求🙂"], "/requirements/需求🙂/impact", {}),
    *[(["requirement-impact-items", "--id", "需求🙂", "--kind", kind, "--generation", "17"],
       "/requirements/需求🙂/impact/items", {"kind": kind, "query_generation": "17", "limit": "20"})
      for kind in ("direct_task", "dependent_task", "execution", "release_candidate", "deployment")],
    (["requirement-impact-item", "--id", "需求🙂", "--kind", "dependent_task", "--item", "任务🙂", "--generation", "17"],
     "/requirements/需求🙂/impact/items/任务🙂", {"kind": "dependent_task", "query_generation": "17"}),
]


@pytest.mark.parametrize("arguments,path,params", READS)
def test_command_makes_one_selected_read_without_reconstructing_a_bundle(monkeypatch, arguments, path, params):
    expected = {"project_id": "selected", "requirement_id": "需求🙂", "available": False, "counts": None,
                "items": [], "earlier_history_unknown": True, "next_cursor": "do-not-follow"}
    seen = []
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(200, json=expected))
    output = CliRunner().invoke(delivery.app, [*arguments, "--json"])
    assert output.exit_code == 0, output.output
    assert json.loads(output.output) == expected
    assert len(seen) == 1 and seen[0].method == "GET"
    assert seen[0].url.path == "/api/v1/delivery" + path and dict(seen[0].url.params) == params
    assert seen[0].headers["X-Project-Id"] == "selected"


@pytest.mark.parametrize("arguments", [
    ["requirement-definition", "--id", "REQ-one"],
    ["requirement-records", "--id", "REQ-one", "--collection", "reviews"],
    ["requirement-record", "--id", "REQ-one", "--collection", "reviews", "--position", "0"],
    ["requirement-impact-items", "--id", "REQ-one", "--kind", "direct_task"],
    ["requirement-impact-item", "--id", "REQ-one", "--kind", "direct_task", "--item", "T-one"],
    ["requirement-definition", "--id", "REQ-one", "--generation", "0"],
    ["requirement-record", "--id", "REQ-one", "--collection", "reviews", "--position", "-1", "--generation", "17"],
    ["requirement-records", "--id", "REQ-one", "--collection", "history", "--generation", "17"],
    ["requirement-records", "--id", "REQ-one", "--collection", "reviews", "--generation", "17", "--limit", "101"],
    ["requirement-impact-items", "--id", "REQ-one", "--kind", "task", "--generation", "17"],
    ["requirement-history", "--id", "REQ-one", "--version", "version-one", "--cursor", "old"],
    ["requirement-history", "--id", "REQ-one", "--version", "version-one", "--limit", "1"],
])
def test_invalid_or_mixed_selection_never_reaches_transport(monkeypatch, arguments):
    configure(monkeypatch, lambda request: pytest.fail("Invalid command reached HTTP"))
    assert CliRunner().invoke(delivery.app, arguments).exit_code != 0


def test_empty_change_preview_is_valid_and_never_submits_or_rewrites_the_file(monkeypatch, tmp_path):
    file = tmp_path / "original.json"
    original = ('{"requirement_basis":"' + "a" * 64 + '","changes":{}}\n').encode()
    file.write_bytes(original)
    expected = {"available": True, "complete": True, "allowed": True, "preview_basis": "b" * 64,
                "impact": {"counts": {"direct_task": 100}, "invalidates_current_acceptance": False}}
    seen = []
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(200, json=expected))
    result = CliRunner().invoke(delivery.app, ["requirement-change-preview", "--id", "需求🙂", "--file", str(file), "--json"])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output) == expected and file.read_bytes() == original
    assert len(seen) == 1 and seen[0].method == "POST" and seen[0].url.path.endswith("/change-preview")
    assert json.loads(seen[0].content) == {"requirement_basis": "a" * 64, "changes": {}}


def test_empty_changes_reaches_the_existing_preview_without_a_json_option(monkeypatch, tmp_path):
    file = tmp_path / "empty-changes.json"
    file.write_text(json.dumps({"requirement_basis": "a" * 64, "changes": {}}), encoding="utf-8")
    seen = []
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(200, json={"complete": True}))
    result = CliRunner().invoke(delivery.app, ["requirement-change-preview", "--id", "REQ-one", "--file", str(file)])
    assert result.exit_code == 0, result.output
    assert len(seen) == 1 and json.loads(seen[0].content)["changes"] == {}


@pytest.mark.parametrize("status", [403, 404, 409])
def test_current_failure_keeps_requested_generation_without_implicit_adoption(monkeypatch, status):
    seen = []
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(status, json={"detail": "Current read unavailable"}))
    result = CliRunner().invoke(delivery.app, ["requirement-definition", "--id", "REQ-one", "--generation", "17"])
    assert result.exit_code == 1 and len(seen) == 1
    assert dict(seen[0].url.params) == {"query_generation": "17"}


def test_requirement_sync_keeps_the_original_proof_and_persisted_failed_processing_receipt(monkeypatch, tmp_path):
    """New readers cannot silently repair/re-preview a refused frozen write."""
    stamp = "2026-10-19T08:00:00Z"
    ingested = []

    def transport(request):
        if request.url.path == "/api/v1/events:identity":
            return httpx.Response(200, json={"tenant_id": "tenant", "project_id": "selected", "producer_id": "lead"})
        assert request.url.path == "/api/v1/events:ingest" and request.method == "POST"
        event = json.loads(request.content)["events"][0]
        ingested.append(event)
        return httpx.Response(200, json={"tenant_id": "tenant", "project_id": "selected", "producer": {"kind": "user", "id": "lead"},
            "as_of": stamp, "results": [{"id": event["id"], "digest": event["digest"], "outcome": "stored",
            "receipt_id": "receipt-original-requirement", "stored_at": stamp, "error": None,
            "processing": {"state": "failed", "revision": 1, "handler": "sync.record", "operation_id": "original-operation",
                "attempts": 1, "updated_at": stamp, "processed_at": None, "reason_code": "requirement_preview_changed",
                "retryable": False, "result": None}}]})

    @contextmanager
    def client_factory(config):
        with ManagerClient(config.manager_url, project_id=config.project_id, max_retries=0) as client:
            client._client.close()
            client._client = httpx.Client(base_url=client.base_url, transport=httpx.MockTransport(transport))
            yield client

    monkeypatch.setattr(local_intents, "build_default_client", client_factory)
    config = AgentConfig(project_path=tmp_path, project_id="selected", tenant_id="tenant", manager_url="https://manager.example", outbox_max_retries=0)
    original = {"module": "requirements", "record": {"id": "需求🙂", "description": "Reviewed original"},
                "action": "update", "expected_version": 9, "key": "original-requirement-write", "event_time": stamp,
                "requirement_basis": "a" * 64, "change_preview_basis": "b" * 64, "local": False}
    first = local_intents.submit_record(config, **original)
    second = local_intents.submit_record(config, **original)
    assert not first["ok"] and not second["ok"]
    assert first["processing"]["state"] == second["processing"]["state"] == "failed"
    assert second["processing_source"] == "original_receipt" and len(ingested) == 1
    with EventOutbox(tmp_path / config.outbox_path) as box:
        row = box.inspect(original["key"])
        event = json.loads(row["event_json"])
        receipt = json.loads(row["remote_receipt_json"])
    assert row["state"] == "acked" and receipt["processing"]["reason_code"] == "requirement_preview_changed"
    assert event["id"] == original["key"] and event["time"] == stamp
    assert event["data"] == {"module": "requirements", "action": "update", "record": original["record"],
                             "expected_version": 9, "requirement_basis": "a" * 64, "change_preview_basis": "b" * 64}
    with pytest.raises(ValueError):
        local_intents.submit_record(config, **{**original, "change_preview_basis": "c" * 64})
    with EventOutbox(tmp_path / config.outbox_path) as box:
        retained = box.inspect(original["key"])
    assert retained["event_json"] == row["event_json"] and retained["digest"] == row["digest"]
    assert retained["remote_receipt_json"] == row["remote_receipt_json"]
    assert len(ingested) == 1 and not (tmp_path / ".sop-runtime/local").exists()
