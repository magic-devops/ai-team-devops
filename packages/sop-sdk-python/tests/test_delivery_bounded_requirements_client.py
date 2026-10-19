"""Requirement reads pin actual sources and current generations without reconstructing old bundles."""

import json
from contextlib import contextmanager

import httpx
import pytest
from sop_sdk.client import ManagerClient
from sop_sdk.errors import SopConflictError, SopForbiddenError, SopNotFoundError
from sop_sdk.security import BearerAuth

BASIS = "a" * 64
COUNTS = {"direct_task": 2, "dependent_task": 3, "execution": 4, "release_candidate": 5,
          "deployment": 6, "restricted_execution": 7, "restricted_deployment": 8}
BUDGET = {"max_tasks": 10000, "max_closure_tasks": 10000, "max_requirements": 10000,
          "max_records_per_collection": 10000, "max_bytes": 16777216, "max_item_bytes": 1048576,
          "max_dependency_depth": 64, "task_count": 5, "closure_task_count": None, "requirement_count": 1,
          "execution_count": 11, "release_candidate_count": 5, "deployment_count": 14, "bytes_used": None}
ENVELOPE = {"project_id": "selected", "requirement_id": "需求🙂", "version": 9, "query_generation": 17,
            "as_of": "2026-10-19T00:00:00Z"}
METADATA = {"id": "version-one", "number": 2, "basis": BASIS, "at": "2026-10-18T00:00:00Z",
            "actor": {"id": "lead", "name": "Lead"}, "source": "delivery_command", "flow_revision": 3}


@contextmanager
def wire(handler):
    with ManagerClient("https://manager.example", project_id="selected", auth=BearerAuth("fixture-only"), max_retries=0) as client:
        client._client.close()
        client._client = httpx.Client(base_url=client.base_url, transport=httpx.MockTransport(handler))
        yield client


READS = [
    ("delivery_requirement", ("需求🙂",), {}, "/requirements/需求🙂", {},
     {**ENVELOPE, "requirement": {"id": "需求🙂", "title": "Current head", "basis": BASIS,
       "priority": "P1", "status": "pending", "sprint_id": "", "tasks_total": 2, "tasks_done": 0,
       "tasks_recorded_done": 1, "accepted": False, "deployment_verified": False,
       "flow": {"stage": "design", "revision": 3, "owner_id": "", "due_on": None, "milestone_id": "",
                "blocked_reason": "", "closed": False, "legacy_completed": False, "gates": [],
                "record_counts": {"artifacts": 200, "reviews": 300, "releases": 20}}}}),
    ("delivery_requirement_definition", ("需求🙂",), {"query_generation": 17}, "/requirements/需求🙂/definition", {"query_generation": "17"},
     {**ENVELOPE, "requirement_basis": BASIS, "definition": {"id": "需求🙂", "title": "Original", "description": "Exact body", "acceptance_criteria": []}}),
    ("delivery_requirement_history", ("需求🙂",), {"limit": 1, "cursor": "original/+?=:window"}, "/requirements/需求🙂/history",
     {"limit": "1", "cursor": "original/+?=:window"},
     {"project_id": "selected", "requirement_id": "需求🙂", "as_of": ENVELOPE["as_of"], "items": [METADATA],
      "limit": 1, "next_cursor": "next-fixed-window", "earlier_history_unknown": True}),
    ("delivery_requirement_version", ("需求🙂", "version-one"), {}, "/requirements/需求🙂/history/version-one", {},
     {"project_id": "selected", "requirement_id": "需求🙂", "item": {**METADATA,
      "definition": {"id": "需求🙂", "title": "Frozen original", "description": "Deleted current object", "acceptance_criteria": ["Original condition"]}}}),
    *[("delivery_requirement_records", ("需求🙂",), {"collection": collection, "query_generation": 17, "limit": 1, "cursor": "record-window"},
       "/requirements/需求🙂/records", {"collection": collection, "query_generation": "17", "limit": "1", "cursor": "record-window"},
       {**ENVELOPE, "requirement_basis": BASIS, "collection": collection, "total": 300, "limit": 1, "next_cursor": "next-window",
        "items": [{"position": 0, "revision": 3, "kind": None, "stage": None, "title": None, "result": None,
                   "decision": None, "actor": "lead", "at": None, "stale": None}]})
      for collection in ("artifacts", "reviews", "releases")],
    ("delivery_requirement_record", ("需求🙂", 0), {"collection": "reviews", "query_generation": 17}, "/requirements/需求🙂/records/0",
     {"collection": "reviews", "query_generation": "17"}, {**ENVELOPE, "requirement_basis": BASIS, "collection": "reviews", "position": 0,
      "record": {"stage": "acceptance", "revision": 2, "comment": "Exact old review", "decision": "approved"}}),
    ("delivery_requirement_impact", ("需求🙂",), {}, "/requirements/需求🙂/impact", {},
     {**ENVELOPE, "requirement_basis": BASIS, "available": True, "complete": True, "counts": COUNTS, "budget": BUDGET, "reasons": []}),
    *[("delivery_requirement_impact_items", ("需求🙂",), {"kind": kind, "query_generation": 17, "limit": 1, "cursor": "impact-window"},
       "/requirements/需求🙂/impact/items", {"kind": kind, "query_generation": "17", "limit": "1", "cursor": "impact-window"},
       {**ENVELOPE, "requirement_basis": BASIS, "kind": kind, "items": [], "total": 100, "limit": 1, "next_cursor": "more"})
      for kind in ("direct_task", "dependent_task", "execution", "release_candidate", "deployment")],
    ("delivery_requirement_impact_item", ("需求🙂", "任务🙂"), {"kind": "dependent_task", "query_generation": 17},
     "/requirements/需求🙂/impact/items/任务🙂", {"kind": "dependent_task", "query_generation": "17"},
     {**ENVELOPE, "requirement_basis": BASIS, "kind": "dependent_task", "item": {"id": "任务🙂", "kind": "dependent_task",
      "title": "Off-page dependent task", "status": "pending", "target": {"kind": "task", "id": "任务🙂", "label": "Off-page dependent task", "available": True, "reason": None}}}),
    ("delivery_requirement_impact_item", ("需求🙂", "execution-old"), {"kind": "execution", "query_generation": 17},
     "/requirements/需求🙂/impact/items/execution-old", {"kind": "execution", "query_generation": "17"},
     {**ENVELOPE, "requirement_basis": BASIS, "kind": "execution", "item": {"id": "execution-old", "kind": "execution",
      "title": None, "status": None, "target": {"kind": "execution", "id": "execution-old", "label": None, "available": True, "reason": None}}}),
]


@pytest.mark.parametrize("method,args,options,path,params,expected", READS)
def test_one_explicit_requirement_read_preserves_the_canonical_response(method, args, options, path, params, expected):
    seen = []
    with wire(lambda request: seen.append(request) or httpx.Response(200, json=expected)) as client:
        assert getattr(client, method)(*args, **options) == expected
    assert len(seen) == 1 and seen[0].method == "GET" and seen[0].content == b""
    assert seen[0].url.path == "/api/v1/delivery" + path and dict(seen[0].url.params) == params
    assert seen[0].headers["X-Project-Id"] == "selected" and seen[0].headers["Authorization"] == "Bearer fixture-only"


@pytest.mark.parametrize("method", ["delivery_requirement", "delivery_requirement_impact"])
def test_head_and_summary_can_explicitly_pin_the_generation(method):
    seen = []
    with wire(lambda request: seen.append(request) or httpx.Response(200, json={})) as client:
        getattr(client, method)("REQ-one", query_generation=17)
    assert dict(seen[0].url.params) == {"query_generation": "17"}


CURRENT = [
    ("delivery_requirement_definition", (), {}),
    ("delivery_requirement_records", (), {"collection": "artifacts"}),
    ("delivery_requirement_record", (0,), {"collection": "reviews"}),
    ("delivery_requirement_impact_items", (), {"kind": "direct_task"}),
    ("delivery_requirement_impact_item", ("T-one",), {"kind": "direct_task"}),
]


@pytest.mark.parametrize("method,args,options", CURRENT)
@pytest.mark.parametrize("generation", [None, True, 0, -1, 1.5, "17"])
def test_current_content_never_invents_a_missing_or_invalid_generation(method, args, options, generation):
    with wire(lambda request: pytest.fail("Invalid generation reached HTTP")) as client:
        with pytest.raises(ValueError):
            getattr(client, method)("REQ-one", *args, query_generation=generation, **options)


@pytest.mark.parametrize("method,args,options", CURRENT)
def test_current_content_requires_an_explicit_generation_argument(method, args, options):
    with wire(lambda request: pytest.fail("Missing generation reached HTTP")) as client:
        with pytest.raises(TypeError):
            getattr(client, method)("REQ-one", *args, **options)


@pytest.mark.parametrize("method,args,options", [("delivery_requirement", (), {}), ("delivery_requirement_history", (), {}),
    ("delivery_requirement_version", ("version-one",), {}), ("delivery_requirement_impact", (), {}), *CURRENT])
@pytest.mark.parametrize("identity", ["", "x" * 65, "🙂" * 65, " bad", "bad ", "bad\n", "bad\x80", "a/b", "a\\b", "..", "\ud800"])
def test_requirement_identity_is_locally_bounded_without_global_ascii_restrictions(method, args, options, identity):
    if (method, args, options) in CURRENT:
        options = {**options, "query_generation": 17}
    with wire(lambda request: pytest.fail("Invalid identity reached HTTP")) as client:
        with pytest.raises(ValueError):
            getattr(client, method)(identity, *args, **options)


@pytest.mark.parametrize("method,args,options", CURRENT + [("delivery_requirement", (), {}), ("delivery_requirement_impact", (), {})])
def test_unicode_64_codepoint_identity_is_transmitted_without_truncation(method, args, options):
    if (method, args, options) in CURRENT:
        options = {**options, "query_generation": 17}
    seen = []
    with wire(lambda request: seen.append(request) or httpx.Response(200, json={})) as client:
        getattr(client, method)("🙂" * 64, *args, **options)
    assert seen[0].url.path.split("/")[5] == "🙂" * 64


PAGES = [("delivery_requirement_history", {}),
         ("delivery_requirement_records", {"collection": "reviews", "query_generation": 17}),
         ("delivery_requirement_impact_items", {"kind": "execution", "query_generation": 17})]


@pytest.mark.parametrize("method,options", PAGES)
@pytest.mark.parametrize("invalid", [{"limit": 0}, {"limit": 101}, {"limit": True}, {"cursor": None}, {"cursor": "x" * 4001},
                                    {"cursor": "bad\n"}, {"cursor": "bad\x7f"}, {"cursor": "bad\x9f"}])
def test_page_limits_and_opaque_cursor_controls_fail_before_transport(method, options, invalid):
    with wire(lambda request: pytest.fail("Invalid page reached HTTP")) as client:
        with pytest.raises(ValueError):
            getattr(client, method)("REQ-one", **options, **invalid)


@pytest.mark.parametrize("method,options", PAGES)
def test_page_boundary_preserves_the_entire_opaque_cursor(method, options):
    seen = []
    with wire(lambda request: seen.append(request) or httpx.Response(200, json={})) as client:
        getattr(client, method)("REQ-one", limit=100, cursor="🙂" * 4000, **options)
    assert dict(seen[0].url.params)["cursor"] == "🙂" * 4000
    assert dict(seen[0].url.params)["limit"] == "100"


@pytest.mark.parametrize("position", [True, -1, 1.5, "0", None])
def test_record_position_is_a_real_nonnegative_integer(position):
    with wire(lambda request: pytest.fail("Invalid position reached HTTP")) as client:
        with pytest.raises(ValueError):
            client.delivery_requirement_record("REQ-one", position, collection="reviews", query_generation=17)


@pytest.mark.parametrize("collection", ["history", "", None])
def test_record_collection_is_explicit(collection):
    with wire(lambda request: pytest.fail("Invalid collection reached HTTP")) as client:
        with pytest.raises(ValueError):
            client.delivery_requirement_records("REQ-one", collection=collection, query_generation=17)


@pytest.mark.parametrize("kind", ["task", "", None])
def test_impact_kind_is_not_inferred_from_an_item_or_list(kind):
    with wire(lambda request: pytest.fail("Invalid kind reached HTTP")) as client:
        with pytest.raises(ValueError):
            client.delivery_requirement_impact_item("REQ-one", "T-one", kind=kind, query_generation=17)


def test_task_impact_identity_uses_unicode64_while_other_resource_rules_stay_local():
    seen = []
    with wire(lambda request: seen.append(request) or httpx.Response(200, json={})) as client:
        client.delivery_requirement_impact_item("REQ-one", "🙂" * 64, kind="direct_task", query_generation=17)
        with pytest.raises(ValueError):
            client.delivery_requirement_impact_item("REQ-one", "🙂" * 65, kind="direct_task", query_generation=17)
        with pytest.raises(ValueError):
            client.delivery_task("任务🙂")
    assert len(seen) == 1 and seen[0].url.path.endswith("/" + "🙂" * 64)


OTHER_EXACT = [
    ("delivery_requirement_version", {}),
    *[("delivery_requirement_impact_item", {"kind": kind, "query_generation": 17})
      for kind in ("execution", "release_candidate", "deployment")],
]


@pytest.mark.parametrize("method,options", OTHER_EXACT)
def test_other_requirement_resource_ids_use_the_actual_unicode_200_codepoint_limit(method, options):
    seen = []
    identity = "原件🙂" * 66 + "原件"
    assert len(identity) == 200
    with wire(lambda request: seen.append(request) or httpx.Response(200, json={})) as client:
        getattr(client, method)("REQ-one", identity, **options)
    assert len(seen) == 1 and seen[0].url.path.endswith("/" + identity)


@pytest.mark.parametrize("method,options", OTHER_EXACT)
@pytest.mark.parametrize("identity", ["x" * 201, "🙂" * 201, " bad", "bad ", "bad\x00", "bad\x9f", "a/b", "a\\b", ".", "..", "\ud800"])
def test_other_requirement_resource_ids_reject_invalid_input_before_transport(method, options, identity):
    with wire(lambda request: pytest.fail("Invalid other resource identity reached HTTP")) as client:
        with pytest.raises(ValueError):
            getattr(client, method)("REQ-one", identity, **options)


@pytest.mark.parametrize("status,error", [(403, SopForbiddenError), (404, SopNotFoundError), (409, SopConflictError)])
def test_failed_exact_current_read_never_falls_back_to_head_history_or_new_generation(status, error):
    seen = []
    with wire(lambda request: seen.append(request) or httpx.Response(status, json={"detail": {"code": "changed"}})) as client:
        with pytest.raises(error):
            client.delivery_requirement_definition("REQ-one", query_generation=17)
    assert len(seen) == 1 and seen[0].url.params["query_generation"] == "17"


@pytest.mark.parametrize("changes", [{}, {"description": "", "acceptance_criteria": []}, {"title": " Reviewed title "}])
def test_complete_preview_keeps_unavailable_null_proof_and_exact_original_input(changes):
    body = {"requirement_basis": BASIS, "changes": changes}
    expected = {**ENVELOPE, "requirement_basis": BASIS, "preview_basis": None, "changes": [],
                "impact": {"counts": None, "invalidates_current_acceptance": None}, "available": False,
                "complete": False, "allowed": False, "budget": BUDGET,
                "reasons": [{"code": "requirement_proof_bytes_budget", "message": "Complete proof unavailable"}]}
    original = json.dumps(body)
    seen = []
    with wire(lambda request: seen.append(request) or httpx.Response(200, json=expected)) as client:
        assert client.delivery_requirement_change_preview("需求🙂", body) == expected
    assert len(seen) == 1 and seen[0].method == "POST" and json.loads(seen[0].content) == body
    assert json.dumps(body) == original


@pytest.mark.parametrize("body", [{}, {"requirement_basis": "wrong", "changes": {}},
    {"requirement_basis": BASIS, "changes": None}, {"requirement_basis": BASIS, "changes": {"title": None}},
    {"requirement_basis": BASIS, "changes": {"description": 2}}, {"requirement_basis": BASIS, "changes": {"priority": "P1"}},
    {"requirement_basis": BASIS, "changes": {"acceptance_criteria": [""]}},
    {"requirement_basis": BASIS, "changes": {}, "budget": 20}])
def test_invalid_preview_does_not_request_or_mutate_the_proposal(body):
    original = json.dumps(body)
    with wire(lambda request: pytest.fail("Invalid preview reached HTTP")) as client:
        with pytest.raises(ValueError):
            client.delivery_requirement_change_preview("REQ-one", body)
    assert json.dumps(body) == original
