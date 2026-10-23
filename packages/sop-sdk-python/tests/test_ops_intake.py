"""SDK protocol definitions; not executed during the user validation freeze."""
import json
import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.security import BearerAuth
from sop_sdk.ops_intake import intake_command, intake_ack


def original():
    return {"action": "issue.ops.intake", "expected_version": 7, "idempotency_key": "stable-ops-intake",
            "payload": {"source_id": "ops-one", "source_digest": "a" * 64, "title": "Investigate",
                        "description": "Verify actual execution", "severity": "P1"}}


def ack():
    iid = "ISSUE-" + "1" * 32
    return {"project_id": "P", "action": "issue.ops.intake", "resource": {"kind": "issue", "id": iid},
            "result": {"issue_id": iid, "source_id": "ops-one", "source_digest": "a" * 64},
            "affected_refs": [{"kind": "issue", "id": iid}], "applied_version": 8, "version": 8,
            "query_generation": 1, "replayed": False}


@pytest.mark.parametrize("action", ["issue.ops.intake", "issue.rca.intake"])
def test_client_preserves_explicit_original_and_checks_actual_ack(action):
    request_body, receipt = original(), ack()
    request_body["action"] = receipt["action"] = action
    calls = []
    def handle(request):
        calls.append(request)
        return httpx.Response(200, json=receipt)
    with ManagerClient("https://manager.example", auth=BearerAuth("test"), project_id="P") as client:
        client._client.close(); client._client = httpx.Client(transport=httpx.MockTransport(handle), base_url=client.base_url)
        assert client.delivery_ops_intake(request_body) == receipt
    assert json.loads(calls[0].content) == request_body
    assert calls[0].headers["X-Project-Id"] == "P"


@pytest.mark.parametrize("change", [{"source_id": "../other"}, {"source_digest": "wrong"}, {"severity": "critical"}, {"extra": True}])
def test_input_is_complete_and_not_rebased(change):
    value = original(); value["payload"].update(change)
    with pytest.raises(ValueError): intake_command(value)


def test_wrong_source_or_issue_receipt_stays_unconfirmed():
    value = ack(); value["result"]["source_digest"] = "b" * 64
    with pytest.raises(ValueError): intake_ack(original(), value, "P")
    value = ack(); value["action"] = "issue.rca.intake"
    with pytest.raises(ValueError): intake_ack(original(), value, "P")
