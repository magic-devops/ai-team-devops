import json

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.security import BearerAuth


@pytest.fixture
def client():
    seen = []

    def handle(request):
        seen.append(request)
        return httpx.Response(200, json={"ok": True, "generation": {"id": "g-one"}})

    with ManagerClient("https://manager.example", auth=BearerAuth("test-bearer"), project_id="selected", max_retries=0) as instance:
        instance._client.close()
        instance._client = httpx.Client(transport=httpx.MockTransport(handle), base_url=instance.base_url)
        yield instance, seen


def test_review_preserves_explicit_source_and_retry_identity(client):
    instance, seen = client
    body = {"generator": "ai", "idempotency_key": "stable-preview"}
    instance.review_requirement("REQ-one", body)
    assert seen[-1].method == "POST" and seen[-1].url.path == "/api/v1/requirements/REQ-one/review"
    assert json.loads(seen[-1].content) == body
    assert seen[-1].headers["X-Project-Id"] == "selected"
    assert seen[-1].headers["Authorization"] == "Bearer test-bearer"


def test_review_without_body_retains_rule_review_compatibility(client):
    instance, seen = client
    instance.review_requirement("REQ-one")
    assert not seen[-1].content


def test_prototype_preview_and_adoption_do_not_drop_basis_version_or_edited_content(client):
    instance, seen = client
    instance.generate_requirement_prototype("REQ-one", {"generator": "ai", "mode": "wireframe", "idempotency_key": "preview-one"})
    body = {"generation_id": "g-one", "requirement_basis": "opaque", "expected_version": 4, "idempotency_key": "adopt-one", "content": "Edited design"}
    instance.apply_requirement_prototype("REQ-one", body)
    instance.requirement_assistance_history("REQ-one")
    assert [r.url.path for r in seen] == ["/api/v1/requirements/REQ-one/prototype", "/api/v1/requirements/REQ-one/prototype/apply", "/api/v1/requirements/REQ-one/assistance-history"]
    assert json.loads(seen[1].content) == body


def test_workflow_human_review_sends_explicit_comment_and_stable_signal_id(client):
    instance, seen = client
    instance.review_workflow("review-one", "request_changes", "Fix the boundary condition", "signal-one")
    assert json.loads(seen[-1].content) == {"signal": "request_changes", "payload": {"comment": "Fix the boundary condition", "signal_id": "signal-one"}}
    assert seen[-1].url.path == "/api/v1/workflows/review-one/signal"
    instance.workflow_detail("review-one")
    assert seen[-1].url.path == "/api/v1/workflows/review-one/detail"


@pytest.mark.parametrize("decision,comment,signal_id", [("merge", "Ready", "signal-one"), ("approve", " ", "signal-one"), ("reject", "Reason", "")])
def test_invalid_workflow_decisions_do_not_issue_requests(client, decision, comment, signal_id):
    instance, seen = client
    with pytest.raises(ValueError):
        instance.review_workflow("review-one", decision, comment, signal_id)
    assert seen == []


def test_workflow_start_requires_stable_workflow_identity(client):
    instance, seen = client
    with pytest.raises(ValueError, match="workflow_id"):
        instance.start_workflow({"type": "code_review", "args": {"diff": "change"}})
    body = {"type": "code_review", "workflow_id": "review-one", "args": {"diff": "change"}}
    instance.start_workflow(body)
    assert json.loads(seen[-1].content) == body


@pytest.mark.parametrize("resource_id", ["", "../models", "review/other"])
def test_assistance_paths_reject_path_changing_identifiers(client, resource_id):
    instance, seen = client
    with pytest.raises(ValueError):
        instance.requirement_assistance_history(resource_id)
    with pytest.raises(ValueError):
        instance.workflow_detail(resource_id)
    assert seen == []
