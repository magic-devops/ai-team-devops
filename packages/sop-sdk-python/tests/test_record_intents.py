import json

import httpx
import pytest
from sop_sdk import ManagerClient
from sop_sdk.event_envelope import EventProtocolError
from sop_sdk.ipc import AgentdIpcClient


def test_http_sync_transmits_original_preview_basis_without_mutating_record():
    requests = []
    original = {"id": "REQ-one", "description": "Reviewed definition"}
    with ManagerClient("https://manager.test", project_id="P", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(
            base_url=client.base_url,
            transport=httpx.MockTransport(
                lambda request: requests.append(request) or httpx.Response(200, json={})
            ),
        )
        client.sync_push(
            "requirements",
            original,
            action="update",
            expected_version=7,
            idempotency_key="original-request",
            requirement_basis="a" * 64,
            change_preview_basis="b" * 64,
        )
    assert len(requests) == 1
    assert json.loads(requests[0].content) == {
        "module": "requirements",
        "action": "update",
        "record": original,
        "expected_version": 7,
        "idempotency_key": "original-request",
        "requirement_basis": "a" * 64,
        "change_preview_basis": "b" * 64,
    }
    assert original == {"id": "REQ-one", "description": "Reviewed definition"}


def test_wrong_module_basis_is_rejected_before_http_request():
    with ManagerClient("https://manager.test", project_id="P", max_retries=0) as client:
        with pytest.raises(EventProtocolError, match="task_basis"):
            client.sync_push(
                "issues",
                {"id": "I"},
                action="update",
                expected_version=0,
                idempotency_key="original-request",
                task_basis="a" * 64,
            )


def test_ipc_sync_carries_original_task_basis_in_the_frozen_event(tmp_path):
    seen = []

    class Transport:
        name = "fixture"
        endpoint = "memory://explicit"

        def available(self):
            return True

        def request(self, raw, timeout, max_bytes):
            seen.append(json.loads(raw))
            message = seen[-1]
            return (
                json.dumps(
                    {
                        "ok": True,
                        "op": "event.enqueue",
                        "id": message["data"]["id"],
                        "result": {
                            "id": message["data"]["id"],
                            "digest": message["data"]["digest"],
                            "state": "pending",
                            "revision": 1,
                            "replayed": False,
                        },
                    }
                )
                + "\n"
            ).encode()

    client = AgentdIpcClient(project_path=tmp_path, transport=Transport())
    result = client.sync_push(
        "tasks",
        {"id": "T", "owner_id": "user:author"},
        action="update",
        expected_version=7,
        intended_project_id="P",
        event_id="original-task-owner",
        time="2026-10-18T00:00:00Z",
        task_basis="a" * 64,
    )
    assert result["ok"] is True
    frozen = json.loads(seen[0]["data"]["event_json"])
    assert frozen["id"] == "original-task-owner"
    assert frozen["data"] == {
        "module": "tasks",
        "action": "update",
        "record": {"id": "T", "owner_id": "user:author"},
        "expected_version": 7,
        "task_basis": "a" * 64,
    }
