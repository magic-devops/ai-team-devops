"""Report-issue uses the existing enqueue protocol and retains its original receipt."""

import hashlib
import json

import httpx
import pytest
from sop_sdk import EventOutbox
from sop_sdk.client import ManagerClient
from sop_sdk.event_envelope import FrozenEvent
from sop_sdk.event_sender import flush_outbox
from sop_sdk.ipc import AgentdIpcClient

STAMP = "2026-10-19T00:00:00Z"
ORIGINAL_JSON = (
    '{"specversion":"1.0","id":"issue-original","type":"sop.issue.opened","source":"sop-sdk",'
    '"subject":"","time":"2026-10-19T00:00:00Z","datacontenttype":"application/json",'
    '"data":{"expected_version":7,"title":"工具发现","severity":"P1",'
    '"description":"Original é finding","task_id":"T-fixed"}}'
)
ORIGINAL_DIGEST = hashlib.sha256(ORIGINAL_JSON.encode()).hexdigest()
ORIGINAL_ITEM = {"id": "issue-original", "event_json": ORIGINAL_JSON, "digest": ORIGINAL_DIGEST}
REPORT = {
    "title": "工具发现", "expected_version": 7, "intended_project_id": "P", "event_id": "issue-original",
    "time": STAMP, "severity": "P1", "description": "Original é finding", "task_id": "T-fixed",
}


class QueueProtocolTransport:
    """Protocol test double; all admission and receipt state lives in real SQLite."""

    name = "sqlite-protocol-fixture"
    endpoint = "memory://test-only"

    def __init__(self, path):
        self.path = path
        self.frames = []
        self.lose_response = False

    def available(self):
        return True

    def request(self, frame, timeout, max_bytes):
        self.frames.append(frame)
        request = json.loads(frame)
        with EventOutbox(self.path) as box:
            if request["op"] == "event.enqueue":
                data = request["data"]
                original = FrozenEvent.from_json(data["event_json"], digest=data["digest"])
                result = box.enqueue(original, data["intended_project_id"])
            else:
                assert request["op"] == "outbox.inspect"
                result = box.inspect(request["data"]["id"])
        if self.lose_response:
            self.lose_response = False
            raise TimeoutError("Admission committed; response lost")
        response = {"ok": True, "op": request["op"], "result": result}
        if request["op"] == "event.enqueue":
            response["id"] = result["id"]
        return (json.dumps(response) + "\n").encode()


def test_report_issue_freezes_full_opened_frame_and_local_admission_only(tmp_path):
    path = tmp_path / "outbox.sqlite"
    transport = QueueProtocolTransport(path)
    ipc = AgentdIpcClient(project_path=tmp_path, transport=transport)
    result = ipc.report_issue(**REPORT)
    assert result == {
        "ok": True, "op": "event.enqueue", "id": "issue-original",
        "result": {"id": "issue-original", "digest": ORIGINAL_DIGEST, "state": "pending", "revision": 1, "replayed": False},
    }
    assert transport.frames[0].endswith(b"\n")
    assert json.loads(transport.frames[0]) == {
        "v": 1, "op": "event.enqueue", "name": "", "data": {**ORIGINAL_ITEM, "intended_project_id": "P"},
    }
    with EventOutbox(path) as box:
        row = box.inspect("issue-original")
        assert row["event_json"] == ORIGINAL_JSON and row["digest"] == ORIGINAL_DIGEST
        assert row["state"] == "pending" and row["intended_project_id"] == "P"
        assert row["remote_receipt_json"] is None and row["processing_state"] is None


def test_report_issue_unknown_keeps_original_id_time_project_and_replay_bytes(tmp_path):
    path = tmp_path / "outbox.sqlite"
    transport = QueueProtocolTransport(path)
    transport.lose_response = True
    ipc = AgentdIpcClient(project_path=tmp_path, transport=transport)
    unknown = ipc.report_issue(**REPORT)
    assert unknown["ok"] is False and unknown["error_code"] == "timeout"
    assert unknown["original_event"] == ORIGINAL_ITEM and unknown["intended_project_id"] == "P"
    with EventOutbox(path) as box:
        assert box.inspect("issue-original")["event_json"] == ORIGINAL_JSON
    recovered = ipc.enqueue_event(
        FrozenEvent.from_json(unknown["original_event"]["event_json"], digest=unknown["original_event"]["digest"]),
        intended_project_id=unknown["intended_project_id"],
    )
    assert recovered["result"]["replayed"] is True and recovered["result"]["state"] == "pending"
    assert transport.frames[0] == transport.frames[1]
    with EventOutbox(path) as box:
        assert box.stats()["pending"] == 1


def test_report_issue_processed_issue_created_ack_survives_reopen_and_ipc_inspection(tmp_path):
    path = tmp_path / "outbox.sqlite"
    transport = QueueProtocolTransport(path)
    ipc = AgentdIpcClient(project_path=tmp_path, transport=transport)
    assert ipc.report_issue(**REPORT)["result"]["state"] == "pending"
    requests = []

    def handle(request):
        requests.append(request)
        assert request.headers["X-Project-Id"] == "P"
        if request.url.path == "/api/v1/events:identity":
            return httpx.Response(200, json={"tenant_id": "T", "project_id": "P", "producer_id": "U"})
        assert request.url.path == "/api/v1/events:ingest"
        assert json.loads(request.content)["events"] == [ORIGINAL_ITEM]
        return httpx.Response(200, json={
            "tenant_id": "T", "project_id": "P", "producer": {"kind": "user", "id": "U"}, "as_of": STAMP,
            "results": [{
                "id": "issue-original", "digest": ORIGINAL_DIGEST, "outcome": "stored",
                "receipt_id": "receipt-original", "stored_at": STAMP, "error": None,
                "processing": {
                    "state": "processed", "revision": 2, "handler": "issue.opened", "operation_id": "operation-one",
                    "attempts": 1, "updated_at": STAMP, "processed_at": STAMP,
                    "reason_code": None, "retryable": False,
                    "result": {"kind": "issue_created", "target_kind": "issue", "target_id": "ISS-actual"},
                },
            }],
        })

    with ManagerClient("https://manager.example", project_id="P", max_retries=0) as manager:
        manager._client.close()
        manager._client = httpx.Client(base_url=manager.base_url, transport=httpx.MockTransport(handle))
        with EventOutbox(path) as box:
            delivered = flush_outbox(box, manager, intended_project_id="P", manager_url=manager.base_url)
            assert delivered["acked"] == 1
    inspected = ipc.outbox_inspect("issue-original")
    row = inspected["result"]
    assert inspected["ok"] is True and inspected["op"] == "outbox.inspect"
    assert row["event_json"] == ORIGINAL_JSON and row["state"] == "acked"
    assert row["processing_state"] == "processed" and row["receipt_id"] == "receipt-original"
    assert row["expected_tenant_id"] == "T" and row["expected_project_id"] == "P" and row["expected_producer_id"] == "U"
    assert json.loads(row["remote_receipt_json"])["processing"]["result"] == {
        "kind": "issue_created", "target_kind": "issue", "target_id": "ISS-actual",
    }
    assert len(requests) == 2
    replayed = ipc.report_issue(**REPORT)
    assert replayed["result"]["state"] == "acked" and replayed["result"]["replayed"] is True
    assert len(requests) == 2


@pytest.mark.parametrize("version", [-1, True, "7"])
def test_report_issue_invalid_version_cannot_reach_admission(tmp_path, version):
    transport = QueueProtocolTransport(tmp_path / "outbox.sqlite")
    ipc = AgentdIpcClient(project_path=tmp_path, transport=transport)
    with pytest.raises(ValueError):
        ipc.report_issue(**{**REPORT, "expected_version": version})
    assert not transport.frames and not transport.path.exists()
