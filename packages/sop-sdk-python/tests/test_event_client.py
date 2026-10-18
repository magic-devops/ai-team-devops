import json

import httpx
import pytest
from sop_sdk import EventIdentity, FrozenEvent, ManagerClient
from sop_sdk.event_envelope import EventProtocolError
from sop_sdk.ipc import AgentdIpcClient


def test_all_event_http_methods_preserve_explicit_identity_bytes_and_cursor():
    seen = []
    frozen = FrozenEvent.create("generic.fact", {"text": "原字节"}, event_id="E", time="2026-10-18T00:00:00Z")
    identity = EventIdentity("T", "P", "U", "https://manager.test")
    with ManagerClient("https://manager.test", project_id="P", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(
            base_url=client.base_url,
            transport=httpx.MockTransport(
                lambda request: seen.append(request) or httpx.Response(200, json={})
            ),
        )
        client.events_identity()
        client.events_ingest([frozen], identity=identity)
        client.events_list(
            state="failed", event_type="generic.fact", producer_id="U", cursor="original", limit=7
        )
        client.event_receipt("R-one")
        client.event_attempts("R-one", cursor="window", limit=3)
        client.event_retry(
            "R-one", expected_revision=4, reason="已恢复原权限", idempotency_key="original-key"
        )
        for wrong in [
            EventIdentity("T", "Other", "U", "https://manager.test"),
            EventIdentity("T", "P", "U", "https://other.test"),
        ]:
            with pytest.raises(ValueError):
                client.events_ingest([frozen], identity=wrong)
    assert len(seen) == 6
    assert json.loads(seen[1].content) == {**identity.request_scope(), "events": [frozen.item()]}
    assert dict(seen[2].url.params) == {
        "state": "failed",
        "type": "generic.fact",
        "producer_id": "U",
        "cursor": "original",
        "limit": "7",
    }
    assert seen[-1].url.path == "/api/v1/events/R-one:retry"
    assert json.loads(seen[-1].content) == {
        "expected_revision": 4,
        "reason": "已恢复原权限",
        "idempotency_key": "original-key",
    }


def test_event_http_json_with_duplicate_keys_fails_closed():
    with ManagerClient("https://manager.test", project_id="P", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(
            base_url=client.base_url,
            transport=httpx.MockTransport(
                lambda request: httpx.Response(
                    200,
                    content=b'{"project_id":"wrong","project_id":"P"}',
                    headers={"Content-Type": "application/json"},
                )
            ),
        )
        with pytest.raises(EventProtocolError):
            client.events_identity()


@pytest.mark.parametrize(
    "wire", [b'{"ok":true}\n', b'{"ok":true}', b'{"ok":false,"ok":true}\n', b'{"ok":"false"}\n']
)
def test_unknown_ipc_ack_retains_original_intent_for_explicit_retry(tmp_path, wire):
    class Transport:
        name = "fake"
        endpoint = "memory://explicit-test"

        def available(self):
            return True

        def request(self, *args):
            return wire

    client = AgentdIpcClient(project_path=tmp_path, transport=Transport())
    frozen = FrozenEvent.create("generic.fact", {}, event_id="E", time="2026-10-18T00:00:00Z")
    result = client.enqueue_event(frozen, intended_project_id="P")
    assert result["ok"] is False
    assert result["original_event"] == frozen.item() and result["intended_project_id"] == "P"


@pytest.mark.parametrize("flag", ["false", 1, None])
def test_otherwise_matching_enqueue_response_requires_boolean_ok(tmp_path, flag):
    frozen = FrozenEvent.create("generic.fact", {}, event_id="E", time="2026-10-18T00:00:00Z")

    class Transport:
        name = "fake"
        endpoint = "memory://explicit-test"

        def available(self):
            return True

        def request(self, *args):
            return (
                json.dumps(
                    {
                        "ok": flag,
                        "op": "event.enqueue",
                        "id": frozen.id,
                        "result": {
                            "id": frozen.id,
                            "digest": frozen.digest,
                            "state": "pending",
                            "revision": 1,
                            "replayed": False,
                        },
                    }
                )
                + "\n"
            ).encode()

    response = AgentdIpcClient(project_path=tmp_path, transport=Transport()).enqueue_event(
        frozen, intended_project_id="P"
    )
    assert response["ok"] is False and response["error_code"] == "invalid_response"
    assert response["original_event"] == frozen.item()
