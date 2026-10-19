"""Small progress reads never substitute current pages for exact frozen history."""

import json
from contextlib import contextmanager

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopConflictError, SopForbiddenError, SopNotFoundError, SopTransportError
from sop_sdk.security import BearerAuth


@contextmanager
def progress_client(handler):
    with ManagerClient(
        "https://manager.example", auth=BearerAuth("test-only"), project_id="selected", max_retries=0
    ) as client:
        client._client.close()
        client._client = httpx.Client(base_url=client.base_url, transport=httpx.MockTransport(handler))
        yield client


READS = [
    ("delivery_progress_baselines", (), {"scope": "sprint", "scope_id": "SPR-one", "limit": 1, "cursor": "opaque/+?=:window"},
     "/api/v1/delivery/progress/baselines", {"scope": "sprint", "scope_id": "SPR-one", "limit": "1", "cursor": "opaque/+?=:window"},
     {"scope": {"kind": "sprint", "id": "SPR-one", "label": "Sprint"}, "items": [{"id": "baseline-off-page", "task_count": 500}], "total": 90, "next_cursor": "next-window"}),
    ("delivery_progress_observation_items", ("observation-old",), {"collection": "tasks", "scope": "milestone", "scope_id": "M-old", "limit": 1, "cursor": "original-window"},
     "/api/v1/delivery/progress/observations/observation-old/tasks", {"scope": "milestone", "scope_id": "M-old", "limit": "1", "cursor": "original-window"},
     {"source_kind": "observation", "source_id": "observation-old", "snapshot_basis": "a" * 64, "collection": "tasks", "items": [{"id": "T-deleted", "title": "Frozen title"}], "total": 500, "next_cursor": "next-window"}),
    ("delivery_progress_observation_items", ("observation-old",), {"collection": "requirements", "limit": 1},
     "/api/v1/delivery/progress/observations/observation-old/requirements", {"scope": "project", "limit": "1"},
     {"source_kind": "observation", "source_id": "observation-old", "snapshot_basis": "a" * 64, "collection": "requirements", "items": [{"id": "REQ-old", "title": "Frozen requirement"}], "total": 2, "next_cursor": "next-window"}),
    ("delivery_progress_observation_item", ("observation-old", "T-deleted"), {"scope": "sprint", "scope_id": "SPR-deleted"},
     "/api/v1/delivery/progress/observations/observation-old/tasks/T-deleted", {"scope": "sprint", "scope_id": "SPR-deleted"},
     {"source_kind": "observation", "source_id": "observation-old", "snapshot_basis": "a" * 64, "collection": "tasks", "item": {"id": "T-deleted", "title": "Frozen title", "acceptance_criteria": ["Original criterion"]}}),
    ("delivery_progress_observation_item", ("observation-old", "REQ-old"), {"collection": "requirements"},
     "/api/v1/delivery/progress/observations/observation-old/requirements/REQ-old", {"scope": "project"},
     {"collection": "requirements", "item": {"id": "REQ-old", "title": "Original requirement"}}),
    ("delivery_baseline_items", ("baseline-old",), {"collection": "tasks", "limit": 1, "cursor": "frozen-window"},
     "/api/v1/delivery/progress/baselines/baseline-old/tasks", {"limit": "1", "cursor": "frozen-window"},
     {"source_kind": "baseline", "source_id": "baseline-old", "snapshot_basis": "b" * 64, "collection": "tasks", "items": [{"id": "T-old", "title": "Baseline title"}], "total": 500, "next_cursor": "next-window"}),
    ("delivery_baseline_items", ("baseline-old",), {"collection": "requirements", "limit": 1},
     "/api/v1/delivery/progress/baselines/baseline-old/requirements", {"limit": "1"},
     {"source_kind": "baseline", "source_id": "baseline-old", "snapshot_basis": "b" * 64, "collection": "requirements", "items": [], "total": 0, "next_cursor": None}),
    ("delivery_baseline_item", ("baseline-old", "T-deleted"), {},
     "/api/v1/delivery/progress/baselines/baseline-old/tasks/T-deleted", {},
     {"source_kind": "baseline", "source_id": "baseline-old", "snapshot_basis": "b" * 64, "collection": "tasks", "item": {"id": "T-deleted", "title": "Frozen baseline title"}}),
    ("delivery_baseline_item", ("baseline-old", "REQ-old"), {"collection": "requirements"},
     "/api/v1/delivery/progress/baselines/baseline-old/requirements/REQ-old", {},
     {"collection": "requirements", "item": {"id": "REQ-old", "title": "Original requirement"}}),
    ("delivery_baseline_comparison", ("baseline-old",), {"query_generation": 17},
     "/api/v1/delivery/progress/baselines/baseline-old/comparison", {"query_generation": "17"},
     {"baseline_id": "baseline-old", "baseline_basis": "b" * 64, "query_generation": 17, "available": True, "complete": False, "counts": {"added": 1, "removed": 2, "changed": 3, "incomplete": 3, "unchanged": 10}, "incomplete_plan_fields": ["acceptance"]}),
    ("delivery_baseline_comparison_items", ("baseline-old",), {"kind": "changed", "query_generation": 17, "limit": 1, "cursor": "fixed-diff"},
     "/api/v1/delivery/progress/baselines/baseline-old/comparison/items", {"kind": "changed", "query_generation": "17", "limit": "1", "cursor": "fixed-diff"},
     {"baseline_id": "baseline-old", "baseline_basis": "b" * 64, "query_generation": 17, "kind": "changed", "items": [{"id": "T-one", "fields": ["title"], "incomplete_fields": ["acceptance"]}], "total": 3, "next_cursor": "next-window"}),
    ("delivery_baseline_comparison_item", ("baseline-old", "T-deleted"), {"kind": "removed", "query_generation": 17},
     "/api/v1/delivery/progress/baselines/baseline-old/comparison/items/T-deleted", {"kind": "removed", "query_generation": "17"},
     {"baseline_id": "baseline-old", "query_generation": 17, "kind": "removed", "item": {"id": "T-deleted", "before": {"title": "Original title"}, "after": None}}),
    ("delivery_progress_freeze_proof", (), {"scope": "milestone", "scope_id": "M-one"},
     "/api/v1/delivery/progress/freeze-proof", {"scope": "milestone", "scope_id": "M-one"},
     {"project_id": "selected", "version": 7, "query_generation": 17, "scope": {"kind": "milestone", "id": "M-one", "label": "Milestone"}, "available": True, "complete": True, "basis": "c" * 64, "task_ids": ["T-off-page", "T-one"], "budget": {"task_count": 2}}),
]


@pytest.mark.parametrize("method,args,options,path,params,expected", READS)
def test_bounded_progress_reads_one_explicit_source_without_following_or_reconstructing(
    method, args, options, path, params, expected
):
    seen = []
    with progress_client(lambda request: seen.append(request) or httpx.Response(200, json=expected)) as client:
        assert getattr(client, method)(*args, **options) == expected
    assert len(seen) == 1 and seen[0].method == "GET" and seen[0].content == b""
    assert seen[0].url.path == path and dict(seen[0].url.params) == params
    assert seen[0].headers["X-Project-Id"] == "selected"
    assert seen[0].headers["Authorization"] == "Bearer test-only"


@pytest.mark.parametrize("method,args,options,params", [
    ("delivery_progress_baselines", (), {}, {"scope": "project", "limit": "20"}),
    ("delivery_progress_observation_items", ("observation-one",), {}, {"scope": "project", "limit": "20"}),
    ("delivery_baseline_items", ("baseline-one",), {}, {"limit": "20"}),
    ("delivery_baseline_comparison", ("baseline-one",), {}, {}),
    ("delivery_baseline_comparison_items", ("baseline-one",), {"kind": "incomplete"}, {"kind": "incomplete", "limit": "20"}),
    ("delivery_progress_freeze_proof", (), {}, {"scope": "project"}),
])
def test_default_progress_reads_do_not_invent_current_generation_or_cursor(method, args, options, params):
    seen = []
    with progress_client(lambda request: seen.append(request) or httpx.Response(200, json={})) as client:
        getattr(client, method)(*args, **options)
    assert dict(seen[0].url.params) == params


PAGES = [
    ("delivery_progress_baselines", (), {}),
    ("delivery_progress_observation_items", ("observation-one",), {}),
    ("delivery_baseline_items", ("baseline-one",), {}),
    ("delivery_baseline_comparison_items", ("baseline-one",), {"kind": "changed"}),
]


@pytest.mark.parametrize("method,args,options", PAGES)
@pytest.mark.parametrize("invalid", [
    {"limit": 0}, {"limit": 101}, {"limit": True}, {"limit": 1.5},
    {"cursor": None}, {"cursor": False}, {"cursor": "x" * 4001},
    {"cursor": "bad\nwindow"}, {"cursor": "bad\x7fwindow"}, {"cursor": "bad\x85window"},
])
def test_invalid_progress_page_never_reaches_http(method, args, options, invalid):
    with progress_client(lambda _: pytest.fail("Invalid page reached HTTP")) as client:
        with pytest.raises(ValueError):
            getattr(client, method)(*args, **options, **invalid)


@pytest.mark.parametrize("method,args,options", PAGES)
def test_progress_page_keeps_full_opaque_cursor_limit_as_query_data(method, args, options):
    seen = []
    with progress_client(lambda request: seen.append(request) or httpx.Response(200, json={})) as client:
        getattr(client, method)(*args, **options, limit=100, cursor="x" * 4000)
    assert seen[0].url.params["limit"] == "100" and seen[0].url.params["cursor"] == "x" * 4000


@pytest.mark.parametrize("method,args", [
    ("delivery_progress", ()), ("delivery_progress_observation", ("observation-one",)),
    ("delivery_progress_baselines", ()), ("delivery_progress_freeze_proof", ()),
    ("delivery_progress_observation_items", ("observation-one",)),
    ("delivery_progress_observation_item", ("observation-one", "T-one")),
])
@pytest.mark.parametrize("invalid", [
    {"scope": "all"}, {"scope": None}, {"scope": []}, {"scope": "sprint"},
    {"scope_id": "unexpected"}, {"scope": "sprint", "scope_id": None},
    {"scope": "sprint", "scope_id": True}, {"scope": "sprint", "scope_id": "x" * 101},
    {"scope": "sprint", "scope_id": "bad\x85id"},
])
def test_progress_scope_validated_before_transport(method, args, invalid):
    with progress_client(lambda _: pytest.fail("Invalid scope reached HTTP")) as client:
        with pytest.raises(ValueError):
            getattr(client, method)(*args, **invalid)


def test_scope_id_uses_public_100_character_limit_and_is_query_data():
    seen = []
    with progress_client(lambda request: seen.append(request) or httpx.Response(200, json={})) as client:
        client.delivery_progress_freeze_proof(scope="sprint", scope_id="x" * 100)
    assert seen[0].url.params["scope_id"] == "x" * 100


@pytest.mark.parametrize("method,args", [
    ("delivery_progress_observation_items", ("observation-one",)),
    ("delivery_progress_observation_item", ("observation-one", "T-one")),
    ("delivery_baseline_items", ("baseline-one",)), ("delivery_baseline_item", ("baseline-one", "T-one")),
])
@pytest.mark.parametrize("collection", ["all", "task", "../tasks", None, []])
def test_frozen_collection_cannot_choose_another_resource(method, args, collection):
    with progress_client(lambda _: pytest.fail("Invalid collection reached HTTP")) as client:
        with pytest.raises(ValueError):
            getattr(client, method)(*args, collection=collection)


@pytest.mark.parametrize("method,args", [
    ("delivery_baseline_comparison_items", ("baseline-one",)),
    ("delivery_baseline_comparison_item", ("baseline-one", "T-one")),
])
@pytest.mark.parametrize("kind", ["all", "unchanged", "../changed", None, []])
def test_comparison_kind_is_explicit_and_not_a_path(method, args, kind):
    with progress_client(lambda _: pytest.fail("Invalid kind reached HTTP")) as client:
        with pytest.raises(ValueError):
            getattr(client, method)(*args, kind=kind)


@pytest.mark.parametrize("method,args,options", [
    ("delivery_baseline_comparison", ("baseline-one",), {}),
    ("delivery_baseline_comparison_items", ("baseline-one",), {"kind": "changed"}),
    ("delivery_baseline_comparison_item", ("baseline-one", "T-one"), {"kind": "changed"}),
])
@pytest.mark.parametrize("generation", [0, -1, True, 1.5, "17"])
def test_comparison_generation_must_be_an_explicit_positive_integer(method, args, options, generation):
    with progress_client(lambda _: pytest.fail("Invalid generation reached HTTP")) as client:
        with pytest.raises(ValueError):
            getattr(client, method)(*args, **options, query_generation=generation)


@pytest.mark.parametrize("method,args,options", [
    ("delivery_progress_observation_items", ("../other",), {}),
    ("delivery_progress_observation_item", ("observation-one", "T-one/other"), {}),
    ("delivery_baseline_items", ("baseline?other=1",), {}),
    ("delivery_baseline_item", ("baseline-one", ""), {}),
    ("delivery_baseline_comparison", ("../other",), {}),
    ("delivery_baseline_comparison_items", ("baseline/other",), {"kind": "added"}),
    ("delivery_baseline_comparison_item", ("baseline-one", "T?other=1"), {"kind": "changed"}),
])
def test_frozen_and_comparison_ids_cannot_escape_exact_resource(method, args, options):
    with progress_client(lambda _: pytest.fail("Invalid ID reached HTTP")) as client:
        with pytest.raises(ValueError):
            getattr(client, method)(*args, **options)


@pytest.mark.parametrize("status,error", [(403, SopForbiddenError), (404, SopNotFoundError), (409, SopConflictError), (413, SopTransportError)])
@pytest.mark.parametrize("method,args,options", [
    ("delivery_progress_observation_item", ("observation-old", "T-deleted"), {}),
    ("delivery_baseline_item", ("baseline-old", "T-deleted"), {}),
    ("delivery_baseline_comparison_items", ("baseline-old",), {"kind": "changed", "query_generation": 17, "cursor": "original-window"}),
])
def test_denied_missing_stale_or_over_budget_does_not_fallback_or_restart(status, error, method, args, options):
    seen = []
    with progress_client(lambda request: seen.append(request) or httpx.Response(status, json={"detail": "Exact source unavailable"})) as client:
        with pytest.raises(error):
            getattr(client, method)(*args, **options)
    assert len(seen) == 1 and seen[0].method == "GET"


@pytest.mark.parametrize("available,complete,ids,basis", [(True, True, [], "c" * 64), (False, False, None, None)])
def test_freeze_proof_distinguishes_empty_complete_scope_from_unavailable(available, complete, ids, basis):
    seen = []
    expected = {"project_id": "selected", "version": 7, "query_generation": 17, "available": available,
                "complete": complete, "task_ids": ids, "basis": basis, "metrics": None,
                "budget": {"max_tasks": 10000, "max_bytes": 16777216}, "reasons": []}
    with progress_client(lambda request: seen.append(request) or httpx.Response(200, json=expected)) as client:
        assert client.delivery_progress_freeze_proof() == expected
    assert len(seen) == 1 and seen[0].method == "GET"


@pytest.mark.parametrize("action,payload", [
    ("baseline.create", {"title": "Reviewed full scope", "scope": "sprint", "scope_id": "SPR-one", "task_ids": [], "basis": "c" * 64, "starts_on": "2026-10-01", "ends_on": "2026-10-31", "note": "Original reviewed proof"}),
    ("progress.record", {}),
])
def test_unknown_progress_command_keeps_original_body_version_and_key(action, payload):
    seen = []
    body = {"action": action, "payload": payload, "expected_version": 7, "idempotency_key": "progress-original-operation"}
    original_bytes = json.dumps(body, ensure_ascii=False, separators=(",", ":")).encode()

    def handle(request):
        seen.append(request)
        if len(seen) == 1:
            raise httpx.ReadTimeout("Committed; acknowledgement lost", request=request)
        return httpx.Response(200, json={"project_id": "selected", "action": action, "replayed": True})

    with progress_client(handle) as client:
        with pytest.raises(SopTransportError):
            client.delivery_command(body)
        assert client.delivery_command(body)["replayed"] is True
    assert len(seen) == 2 and seen[0].content == seen[1].content == original_bytes
    assert all(request.url.path == "/api/v1/delivery/commands" and request.method == "POST" for request in seen)


def test_current_task_page_keeps_sprint_filter_on_the_canonical_task_read():
    seen = []
    with progress_client(lambda request: seen.append(request) or httpx.Response(200, json={"items": [], "total": 0})) as client:
        client.delivery_tasks(sprint_id="SPR-one", milestone_id="M-one", limit=1, cursor="fixed-current")
    assert seen[0].url.path == "/api/v1/delivery/tasks"
    assert dict(seen[0].url.params) == {"sprint_id": "SPR-one", "milestone_id": "M-one", "limit": "1", "cursor": "fixed-current", "sort": "created_desc"}
