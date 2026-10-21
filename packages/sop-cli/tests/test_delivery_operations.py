"""Real CLI -> operation workflow -> ManagerClient definitions, UNRUN."""
from contextlib import contextmanager
import json

import httpx
from typer.testing import CliRunner

from sop_cli.commands import delivery, delivery_operations
from sop_sdk.client import ManagerClient


def test_cli_prepare_inspect_send_resume_finish_keep_one_original(tmp_path, monkeypatch):
    writes = []
    def handler(request):
        if request.url.path.endswith("/context/me"):
            return httpx.Response(200, json={"ok": True, "user": {"id": "U", "tenant_id": "TEN"},
                "scope": {"tenant_id": "TEN", "project_id": "P", "tenant_code": "t", "business_code": "b", "project_code": "p"}})
        if request.method == "GET":
            return httpx.Response(200, json={"project_id": "P", "version": 7, "work_order": {"id": "W", "task_id": "T", "order_revision": 2,
                "state": "queued", "packet_digest": "f" * 64, "request_digest": "e" * 64}, "permissions": {"can_claim": True}})
        writes.append(bytes(request.content))
        if len(writes) == 1: raise httpx.ReadError("Lost receipt", request=request)
        return httpx.Response(200, json={"project_id": "P", "action": "work_order.claim", "resource": {"kind": "work_order", "id": "W"},
            "result": {"work_order_id": "W", "task_ids": ["T"], "request_digest": "e" * 64, "packet_digest": "f" * 64,
                "order_revision": 3, "state": "claimed", "submission_id": None}, "affected_refs": [{"kind": "work_order", "id": "W"}, {"kind": "task", "id": "T"}],
            "applied_version": 8, "version": 8, "query_generation": 1, "replayed": True})
    @contextmanager
    def get_client():
        with ManagerClient("https://manager.test", project_id="P", max_retries=0) as client:
            client._client.close()
            client._client = httpx.Client(base_url="https://manager.test", transport=httpx.MockTransport(handler))
            yield client
    monkeypatch.setattr(delivery_operations, "get_client", get_client)
    journal = str(tmp_path / "journal")
    runner = CliRunner()
    result = runner.invoke(delivery.app, ["operation", "prepare-work-order", "--journal", journal, "--id", "W", "--action", "claim"])
    assert result.exit_code == 0, result.output
    paths = list((tmp_path / "journal").glob("*.json")); assert len(paths) == 1
    saved = json.loads(paths[0].read_text()); operation = saved["id"]
    assert not writes and saved["state"] == "prepared"
    occupied = runner.invoke(delivery.app, ["operation", "prepare-work-order", "--journal", journal, "--id", "W", "--action", "claim"])
    assert occupied.exit_code != 0 and "list" in occupied.output and "inspect" in occupied.output
    listing = runner.invoke(delivery.app, ["operation", "list", "--journal", journal])
    assert listing.exit_code == 0 and operation in listing.output and "payload" not in listing.output and not writes
    assert runner.invoke(delivery.app, ["operation", "inspect", "--journal", journal, "--operation", operation]).exit_code == 0
    assert runner.invoke(delivery.app, ["operation", "send", "--journal", journal, "--operation", operation]).exit_code != 0
    assert json.loads(paths[0].read_text())["state"] == "unknown"
    assert runner.invoke(delivery.app, ["operation", "resume", "--journal", journal, "--operation", operation]).exit_code == 0
    assert len(writes) == 2 and writes[0] == writes[1]
    assert runner.invoke(delivery.app, ["operation", "finish", "--journal", journal, "--operation", operation]).exit_code == 0
    final = json.loads(paths[0].read_text())
    assert final["active"] is False and final["state"] == "confirmed" and final["original"] == saved["original"]
    # A new, mistaken prepared report can be cancelled without network access.
    prepared = runner.invoke(delivery.app, ["operation", "prepare-work-order", "--journal", journal, "--id", "W", "--action", "claim"])
    assert prepared.exit_code == 0
    records = [json.loads(path.read_text()) for path in (tmp_path / "journal").glob("*.json")]
    next_record = next(record for record in records if record["state"] == "prepared")
    assert runner.invoke(delivery.app, ["operation", "discard", "--journal", journal, "--operation", next_record["id"]]).exit_code == 0
    discarded = json.loads((tmp_path / "journal" / (next_record["id"] + ".json")).read_text())
    assert discarded["state"] == "cancelled" and discarded["active"] is False and len(writes) == 2
    def network_forbidden(): raise AssertionError("Local list must not open a network client")
    monkeypatch.setattr(delivery_operations, "get_client", network_forbidden)
    assert "\"items\": []" in runner.invoke(delivery.app, ["operation", "list", "--journal", journal]).output
    history = runner.invoke(delivery.app, ["operation", "list", "--all", "--journal", journal])
    assert history.exit_code == 0 and operation in history.output and "payload" not in history.output
