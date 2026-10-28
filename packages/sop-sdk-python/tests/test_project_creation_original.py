"""UNRUN: SDK retains the caller's exact project creation original on retry."""
import json

import httpx
from sop_sdk.client import ManagerClient


def test_create_project_replays_exact_caller_original_without_minting_a_key():
    original = {"name": "Project", "status": "planning", "idempotency_key": "retained-project-create-01"}
    sent = []
    def handler(request):
        sent.append(request)
        return httpx.Response(200, json={"ok": True, "action": "project.create", "id": "project-id",
                                        "idempotency_key": original["idempotency_key"], "replayed": len(sent) > 1})
    with ManagerClient("https://manager.example", project_id="existing", max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(transport=httpx.MockTransport(handler), base_url=client.base_url)
        client.create_project(original)
        recovered = client.create_project(original)
    assert recovered["replayed"] is True
    assert len(sent) == 2 and sent[0].content == sent[1].content
    assert all(json.loads(request.content) == original for request in sent)
    assert original["idempotency_key"] == "retained-project-create-01"
