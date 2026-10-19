"""Bounded history commands preserve explicit frozen sources and complete proof state."""

import json
from contextlib import contextmanager

import httpx
import pytest
from sop_cli.commands import delivery
from sop_sdk.client import ManagerClient
from sop_sdk.security import BearerAuth
from typer.testing import CliRunner


def configure(monkeypatch, handler):
    @contextmanager
    def client():
        with ManagerClient("https://manager.example", auth=BearerAuth("test-only"), project_id="selected", max_retries=0) as manager:
            manager._client.close()
            manager._client = httpx.Client(base_url=manager.base_url, transport=httpx.MockTransport(handler))
            yield manager

    monkeypatch.setattr(delivery, "get_client", client)


READS = [
    (["baselines", "--scope", "sprint", "--scope-id", "SPR-one", "--limit", "1", "--cursor", "opaque/+?=:window"],
     "/api/v1/delivery/progress/baselines", {"scope": "sprint", "scope_id": "SPR-one", "limit": "1", "cursor": "opaque/+?=:window"},
     {"items": [{"id": "baseline-old", "task_count": 500}], "total": 80, "next_cursor": "next-window"}),
    (["observation", "observation-old", "--scope", "sprint", "--scope-id", "SPR-deleted"],
     "/api/v1/delivery/progress/observations/observation-old", {"scope": "sprint", "scope_id": "SPR-deleted"},
     {"observation": {"id": "observation-old", "snapshot_basis": "a" * 64, "task_count": 500, "scope": {"kind": "sprint", "id": "SPR-deleted", "label": "Frozen sprint"}}}),
    (["observation-items", "observation-old", "--collection", "requirements", "--scope", "milestone", "--scope-id", "M-old", "--limit", "1", "--cursor", "frozen-window"],
     "/api/v1/delivery/progress/observations/observation-old/requirements", {"scope": "milestone", "scope_id": "M-old", "limit": "1", "cursor": "frozen-window"},
     {"source_kind": "observation", "source_id": "observation-old", "snapshot_basis": "a" * 64, "collection": "requirements", "items": [{"id": "REQ-old", "title": "Frozen requirement"}], "total": 200, "next_cursor": "next-window"}),
    (["observation-item", "observation-old", "T-deleted"],
     "/api/v1/delivery/progress/observations/observation-old/tasks/T-deleted", {"scope": "project"},
     {"source_kind": "observation", "source_id": "observation-old", "snapshot_basis": "a" * 64, "collection": "tasks", "item": {"id": "T-deleted", "title": "Frozen title", "acceptance_criteria": ["Original criterion"]}}),
    (["baseline", "baseline-off-page"], "/api/v1/delivery/progress/baselines/baseline-off-page", {},
     {"baseline": {"id": "baseline-off-page", "task_count": 500, "available": True}}),
    (["baseline-items", "baseline-off-page", "--collection", "tasks", "--limit", "1", "--cursor", "original-window"],
     "/api/v1/delivery/progress/baselines/baseline-off-page/tasks", {"limit": "1", "cursor": "original-window"},
     {"source_kind": "baseline", "source_id": "baseline-off-page", "snapshot_basis": "b" * 64, "collection": "tasks", "items": [{"id": "T-deleted", "title": "Baseline title"}], "total": 500, "next_cursor": "next-window"}),
    (["baseline-item", "baseline-off-page", "REQ-old", "--collection", "requirements"],
     "/api/v1/delivery/progress/baselines/baseline-off-page/requirements/REQ-old", {},
     {"source_kind": "baseline", "source_id": "baseline-off-page", "collection": "requirements", "item": {"id": "REQ-old", "title": "Original requirement"}}),
    (["baseline-comparison", "baseline-old", "--generation", "17"],
     "/api/v1/delivery/progress/baselines/baseline-old/comparison", {"query_generation": "17"},
     {"baseline_id": "baseline-old", "query_generation": 17, "counts": {"added": 1, "removed": 2, "changed": 3, "incomplete": 3, "unchanged": 8}, "incomplete_plan_fields": ["acceptance"]}),
    (["baseline-comparison-items", "baseline-old", "--kind", "changed", "--generation", "17", "--limit", "1", "--cursor", "diff-window"],
     "/api/v1/delivery/progress/baselines/baseline-old/comparison/items", {"kind": "changed", "query_generation": "17", "limit": "1", "cursor": "diff-window"},
     {"baseline_id": "baseline-old", "query_generation": 17, "kind": "changed", "items": [{"id": "T-one", "fields": ["title"], "incomplete_fields": ["acceptance"]}], "total": 3, "next_cursor": "next-window"}),
    (["baseline-comparison-item", "baseline-old", "T-deleted", "--kind", "removed", "--generation", "17"],
     "/api/v1/delivery/progress/baselines/baseline-old/comparison/items/T-deleted", {"kind": "removed", "query_generation": "17"},
     {"baseline_id": "baseline-old", "query_generation": 17, "kind": "removed", "item": {"id": "T-deleted", "before": {"title": "Original title"}, "after": None}}),
    (["progress-freeze-proof", "--scope", "sprint", "--scope-id", "SPR-one"],
     "/api/v1/delivery/progress/freeze-proof", {"scope": "sprint", "scope_id": "SPR-one"},
     {"version": 7, "query_generation": 17, "available": True, "complete": True, "basis": "c" * 64, "task_ids": ["T-off-page", "T-one"], "budget": {"task_count": 2}}),
]


@pytest.mark.parametrize("arguments,path,params,expected", READS)
def test_progress_commands_issue_one_exact_read_and_preserve_public_dto(monkeypatch, arguments, path, params, expected):
    seen = []
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(200, json=expected))
    output = CliRunner().invoke(delivery.app, [*arguments, "--json"])
    assert output.exit_code == 0, output.output
    assert json.loads(output.output) == expected
    assert len(seen) == 1 and seen[0].method == "GET" and seen[0].content == b""
    assert seen[0].url.path == path and dict(seen[0].url.params) == params
    assert seen[0].headers["X-Project-Id"] == "selected" and seen[0].headers["Authorization"] == "Bearer test-only"


@pytest.mark.parametrize("arguments,params", [
    (["baselines"], {"scope": "project", "limit": "20"}),
    (["observation-items", "observation-one"], {"scope": "project", "limit": "20"}),
    (["baseline-items", "baseline-one"], {"limit": "20"}),
    (["baseline-comparison", "baseline-one"], {}),
    (["baseline-comparison-items", "baseline-one", "--kind", "incomplete"], {"kind": "incomplete", "limit": "20"}),
    (["progress-freeze-proof"], {"scope": "project"}),
])
def test_progress_defaults_do_not_invent_generation_or_cursor(monkeypatch, arguments, params):
    seen = []
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(200, json={}))
    output = CliRunner().invoke(delivery.app, [*arguments, "--json"])
    assert output.exit_code == 0, output.output
    assert dict(seen[0].url.params) == params


@pytest.mark.parametrize("arguments", [
    ["baselines", "--limit", "0"], ["baselines", "--limit", "101"],
    ["baselines", "--scope", "sprint"], ["baselines", "--scope-id", "unexpected"],
    ["observation-items", "observation-one", "--cursor", "bad\x85window"],
    ["baseline-items", "baseline-one", "--cursor", "x" * 4001],
    ["observation-item", "observation-one", "T-one", "--collection", "other"],
    ["baseline-item", "baseline-one", "../other"],
    ["baseline-comparison-items", "baseline-one"],
    ["baseline-comparison-items", "baseline-one", "--kind", "unchanged"],
    ["baseline-comparison-item", "baseline-one", "T-one", "--kind", "changed", "--generation", "0"],
    ["progress-freeze-proof", "--scope", "all"],
])
def test_invalid_bounded_progress_selection_cannot_send_http(monkeypatch, arguments):
    configure(monkeypatch, lambda _: pytest.fail("Invalid progress selection reached HTTP"))
    output = CliRunner().invoke(delivery.app, [*arguments, "--json"])
    assert output.exit_code != 0


@pytest.mark.parametrize("status", [403, 404, 409, 413])
@pytest.mark.parametrize("arguments", [
    ["observation-item", "observation-old", "T-deleted"],
    ["baseline-item", "baseline-old", "T-deleted"],
    ["baseline-comparison-items", "baseline-old", "--kind", "changed", "--generation", "17", "--cursor", "original-window"],
])
def test_source_errors_remain_errors_without_current_or_first_page_substitution(monkeypatch, status, arguments):
    seen = []
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(status, json={"detail": "Exact source unavailable"}))
    output = CliRunner().invoke(delivery.app, [*arguments, "--json"])
    assert output.exit_code == 1 and "Exact source unavailable" in output.output
    assert len(seen) == 1 and seen[0].method == "GET"


@pytest.mark.parametrize("available,ids,basis", [(True, [], "c" * 64), (False, None, None)])
def test_freeze_proof_empty_complete_and_unavailable_are_distinct_without_submission(monkeypatch, available, ids, basis):
    seen = []
    expected = {"version": 7, "query_generation": 17, "available": available, "complete": available,
                "basis": basis, "task_ids": ids, "budget": {"max_tasks": 10000}, "reasons": []}
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(200, json=expected))
    output = CliRunner().invoke(delivery.app, ["progress-freeze-proof", "--json"])
    assert output.exit_code == 0 and json.loads(output.output) == expected
    assert len(seen) == 1 and seen[0].method == "GET"


@pytest.mark.parametrize("action,payload", [
    ("baseline.create", {"title": "Reviewed scope", "scope": "sprint", "scope_id": "SPR-one", "task_ids": [], "basis": "c" * 64, "note": "Original proof"}),
    ("progress.record", {}),
])
def test_unknown_progress_command_reuses_original_file_payload_version_and_key(monkeypatch, tmp_path, action, payload):
    seen = []
    body = {"action": action, "payload": payload, "expected_version": 7, "idempotency_key": "original-progress-key"}
    original = json.dumps(body, ensure_ascii=False, indent=2).encode()
    path = tmp_path / "original-command.json"
    path.write_bytes(original)

    def handle(request):
        seen.append(request)
        if len(seen) == 1:
            raise httpx.ReadTimeout("Committed; ACK lost", request=request)
        return httpx.Response(200, json={"project_id": "selected", "action": action, "replayed": True})

    configure(monkeypatch, handle)
    runner = CliRunner()
    first = runner.invoke(delivery.app, ["command", "--file", str(path)])
    assert first.exit_code == 1 and path.read_bytes() == original
    second = runner.invoke(delivery.app, ["command", "--file", str(path)])
    assert second.exit_code == 0 and json.loads(second.output)["replayed"] is True
    assert path.read_bytes() == original and len(seen) == 2
    assert json.loads(seen[0].content) == json.loads(seen[1].content) == body
    assert seen[0].content == seen[1].content
    assert all(request.method == "POST" and request.url.path == "/api/v1/delivery/commands" for request in seen)


def test_current_tasks_command_uses_canonical_sprint_filter(monkeypatch):
    seen = []
    configure(monkeypatch, lambda request: seen.append(request) or httpx.Response(200, json={"items": [], "total": 0}))
    output = CliRunner().invoke(delivery.app, ["tasks", "--sprint", "SPR-one", "--limit", "1"])
    assert output.exit_code == 0, output.output
    assert dict(seen[0].url.params) == {"sprint_id": "SPR-one", "limit": "1", "sort": "created_desc"}
