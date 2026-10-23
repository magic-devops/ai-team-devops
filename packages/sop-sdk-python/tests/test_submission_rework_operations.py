"""Actual HTTP and journal consumers for adopted rework; SOURCE ONLY, UNRUN."""
from copy import deepcopy
import json

import httpx
import pytest

from sop_sdk.delivery_ack import DeliveryAckError, command_original, digest
from sop_sdk.delivery_journal import DeliveryJournal
from sop_sdk.delivery_operations import DeliveryOperations
from sop_sdk.submission_rework import SubmissionReworkChanged, validate_preview
from test_delivery_operations import current, identity, receipt
from test_delivery_task_submissions import client_for


REFERENCE = {"submission_id": "S", "submission_digest": "1" * 64, "decision_id": "D"}


def preview():
    c = current()
    c.pop("can_dispatch")
    definition = {"task_id": "T", "title": "Task", "description": "", "assigned_to": "",
        "task_acceptance_criteria": ["Explicit review"], "acceptance_criteria": ["Explicit review"],
        "owner": None, "dependency_basis": {}, "requirement": None, "designs": [], "design_basis": "0" * 64}
    c.update(query_generation=2, as_of="2026-10-23T00:00:00Z", definition=definition, latest_submission_id="S")
    original = {"task_id": "T", "task_basis": "a" * 64, "definition_digest": "b" * 64,
        "native_boundary_digest": "c" * 64, "source": {"kind": "tool", "name": "Previous author", "url": ""},
        "summary": "Original complete summary", "artifacts": [{"id": "diff", "title": "Diff", "content": "Historical material", "url": "", "sha256": None}],
        "criteria": [{"source": "task", "index": 0, "text_digest": "d" * 64, "result": "not_met", "evidence_ids": ["diff"]}],
        "tests": [{"id": "suite", "title": "Suite", "status": "failed", "evidence_ids": ["diff"]}], "work_order": None}
    feedback = {"schema": "manager.delivery-feedback.v1", "project_id": "P", "task_id": "T", "reference": deepcopy(REFERENCE),
        "submission": {"definition": deepcopy(definition), "payload": original}, "decision": {"decision": "request_changes",
            "review_id": "R", "comment": "Fix review findings", "reviewer": {"id": "U", "name": "Reviewer"},
            "created_at": c["as_of"], "issue_id": None}}
    return {"project_id": "P", "task_id": "T", "version": 7, "query_generation": 2,
        "as_of": c["as_of"], "rework_reference": deepcopy(REFERENCE), "rework_basis": "2" * 64,
        "current": c, "feedback_context": feedback,
        "feedback_context_sha256": digest(feedback),
        "draft": {"source": None, "summary": "Original complete summary",
            "artifacts": [{"id": "diff", "title": "Diff", "content": "Historical material", "url": "", "sha256": None}],
            "criteria": [{"source": "task", "index": 0, "text_digest": "d" * 64, "result": "unknown", "evidence_ids": []}],
            "tests": [{"id": "suite", "title": "Suite", "status": "not_run", "evidence_ids": []}]},
        "allowed": True, "reasons": []}


def handler_for(requests, *, mutate=None, lose_ack=False):
    def handler(request):
        requests.append(request)
        if request.url.path.endswith("/context/me"):
            return httpx.Response(200, json=identity())
        if request.url.path.endswith("/rework-preview"):
            assert json.loads(request.content) == {"rework_reference": REFERENCE}
            value = preview()
            if mutate: mutate(value)
            return httpx.Response(200, json=value)
        if request.url.path.endswith("/delivery-submissions/S"):
            return httpx.Response(200, json={"project_id": "P", "task_id": "T", "version": 7,
                "submission": {"id": "S", "task_id": "T", "digest": "1" * 64},
                "decision": {"id": "D", "decision": "request_changes"}})
        if request.url.path.endswith("/commands"):
            if lose_ack: raise httpx.ReadError("Lost ACK", request=request)
            body = json.loads(request.content)
            ack = receipt(body)
            for field in ("rework_reference", "rework_basis"):
                if field in body["payload"]: ack["result"][field] = body["payload"][field]
            return httpx.Response(200, json=ack)
        raise AssertionError("Unexpected source read: " + request.url.path)
    return handler


def adopted(operations):
    value = operations.rework_draft("T", "S")
    assert value["authored"] == value["preview"]["draft"]
    assert value["authored"]["source"] is None
    assert value["authored"]["criteria"][0]["result"] == "unknown"
    assert value["authored"]["tests"][0]["status"] == "not_run"
    value["authored"]["source"] = {"kind": "tool", "name": "Current author", "url": ""}
    value["authored"]["summary"] = "This attempt's explicit report"
    return value


def test_explicit_selected_source_adoption_and_actual_submit_ack(tmp_path):
    requests = []
    with client_for(handler_for(requests)) as client:
        ops = DeliveryOperations(client, tmp_path / "journal")
        source = adopted(ops)
        saved = ops.prepare_rework("T", source)
        p = saved["original"]["payload"]
        assert p["rework_reference"] == REFERENCE and p["rework_basis"] == "2" * 64
        assert p["source"]["name"] == "Current author" and "work_order" not in p
        assert p["criteria"][0]["text_digest"] == "d" * 64
        assert saved["state"] == "prepared" and not any(r.url.path.endswith("/commands") for r in requests)
        assert ops.send(saved["id"])["state"] == "confirmed"
        assert ops.inspect(saved["id"])["original"] == saved["original"]


@pytest.mark.parametrize("mutation", ["basis", "condition", "seed", "feedback", "denied", "project"])
def test_changed_adopted_source_never_rebinds_or_creates_original(tmp_path, mutation):
    requests = []
    with client_for(handler_for(requests)) as client:
        ops = DeliveryOperations(client, tmp_path / "journal")
        source = adopted(ops)
        def mutate(p):
            if mutation == "basis": p["rework_basis"] = "4" * 64
            elif mutation == "condition":
                p["current"]["criteria"][0]["text_digest"] = "5" * 64
                p["draft"]["criteria"][0]["text_digest"] = "5" * 64
            elif mutation == "seed": p["draft"]["summary"] = "Replaced source"
            elif mutation == "feedback":
                p["feedback_context"]["decision"]["comment"] = "Changed feedback"
                p["feedback_context_sha256"] = digest(p["feedback_context"])
            elif mutation == "denied": p["allowed"] = p["current"]["can_submit"] = False
            else: p["project_id"] = "other"
        client._client.close()
        client._client = httpx.Client(base_url="https://manager.test", transport=httpx.MockTransport(handler_for(requests, mutate=mutate)))
        with pytest.raises((SubmissionReworkChanged, ValueError)): ops.prepare_rework("T", source)
        assert not list((tmp_path / "journal").glob("*.json"))
        assert not any(r.url.path.endswith("/commands") for r in requests)


@pytest.mark.parametrize("mutation", ["no_source", "old_digest", "wire_only", "pair_missing", "stop"])
def test_rework_requires_full_adopted_source_new_author_and_current_stop(tmp_path, mutation):
    requests = []
    with client_for(handler_for(requests)) as client:
        ops = DeliveryOperations(client, tmp_path / "journal")
        source = adopted(ops)
        if mutation == "no_source": source["authored"]["source"] = None
        elif mutation == "old_digest": source["authored"]["criteria"][0]["text_digest"] = "6" * 64
        elif mutation == "wire_only": source = {"rework_reference": REFERENCE, "authored": source["authored"]}
        elif mutation == "pair_missing": del source["preview"]["rework_basis"]
        args = {"work_order_id": "W"} if mutation == "stop" else {}
        with pytest.raises(ValueError): ops.prepare_rework("T", source, **args)
        assert not list((tmp_path / "journal").glob("*.json"))


def test_unknown_rework_resumes_only_identical_saved_original_no_source_reads(tmp_path):
    requests = []
    with client_for(handler_for(requests, lose_ack=True)) as client:
        ops = DeliveryOperations(client, tmp_path / "journal")
        saved = ops.prepare_rework("T", adopted(ops))
        with pytest.raises(Exception): ops.send(saved["id"])
        assert ops.inspect(saved["id"])["state"] == "unknown"
        requests.clear()
        client._client.close()
        client._client = httpx.Client(base_url="https://manager.test", transport=httpx.MockTransport(handler_for(requests)))
        assert ops.resume(saved["id"])["state"] == "confirmed"
        assert [r.url.path for r in requests] == ["/api/v1/context/me", "/api/v1/delivery/commands"]
        assert json.loads(requests[-1].content) == saved["original"]


@pytest.mark.parametrize("mutation", ["missing", "different", "one_field"])
def test_selected_rework_ack_pair_is_required_exactly(tmp_path, mutation):
    requests = []
    normal = handler_for(requests)
    def transport(request):
        response = normal(request)
        if request.url.path.endswith("/commands"):
            ack = response.json()
            if mutation in {"missing", "one_field"}: del ack["result"]["rework_basis"]
            if mutation == "missing": del ack["result"]["rework_reference"]
            if mutation == "different": ack["result"]["rework_basis"] = "7" * 64
            return httpx.Response(200, json=ack)
        return response
    with client_for(transport) as client:
        ops = DeliveryOperations(client, tmp_path / "journal")
        saved = ops.prepare_rework("T", adopted(ops))
        with pytest.raises(DeliveryAckError): ops.send(saved["id"])
        assert ops.inspect(saved["id"])["state"] == "unknown"


def test_ordinary_saved_original_is_not_given_rework_fields():
    from test_delivery_operations import authored
    p = {**authored(), "task_id": "T", "task_basis": "a" * 64,
        "definition_digest": "b" * 64, "native_boundary_digest": "c" * 64}
    p["criteria"][0]["text_digest"] = "d" * 64
    body = {"action": "task.delivery.submit", "expected_version": 7, "idempotency_key": "ordinary-original", "payload": p}
    assert command_original(body) == body
    for field in ("rework_reference", "rework_basis"): assert field not in command_original(body)["payload"]


@pytest.mark.parametrize("mutation", ["context_shape", "decision", "context_digest", "summary", "artifact", "test_id", "test_title", "test_result", "criteria_result", "reasons", "current_shape", "work_order_shape"])
def test_malformed_complete_preview_never_creates_a_journal(tmp_path, mutation):
    def mutate(p):
        if mutation == "context_shape": del p["feedback_context"]["submission"]["definition"]
        elif mutation == "decision": p["feedback_context"]["decision"]["decision"] = "accept"
        elif mutation == "context_digest": p["feedback_context_sha256"] = "0" * 64
        elif mutation == "summary": p["draft"]["summary"] = "Unrelated material"
        elif mutation == "artifact": p["draft"]["artifacts"][0]["content"] = "Unrelated material"
        elif mutation == "test_id": p["draft"]["tests"][0]["id"] = "invented"
        elif mutation == "test_title": p["draft"]["tests"][0]["title"] = "Other suite"
        elif mutation == "test_result": p["draft"]["tests"][0]["status"] = "passed"
        elif mutation == "criteria_result": p["draft"]["criteria"][0]["result"] = "met"
        elif mutation == "reasons": p["reasons"] = [{"code": "denied", "message": "Changed"}]
        elif mutation == "current_shape": del p["current"]["definition"]
        else: p["current"]["work_order"] = {"id": "W", "order_revision": 1}
    with client_for(handler_for([], mutate=mutate)) as client:
        with pytest.raises(ValueError): DeliveryOperations(client, tmp_path / "journal").rework_draft("T", "S")
    assert not (tmp_path / "journal").exists()


def test_denied_complete_empty_current_conditions_can_be_read_but_not_prepared(tmp_path):
    value = preview()
    value["current"]["criteria"] = value["draft"]["criteria"] = []
    value["allowed"] = value["current"]["can_submit"] = False
    value["reasons"] = value["current"]["reasons"] = [{"code": "criteria_missing", "message": "Define acceptance first"}]
    assert validate_preview(value, project_id="P", task_id="T", reference=REFERENCE) == value
    from sop_sdk.submission_rework import adoption
    with client_for(handler_for([])) as client:
        with pytest.raises(SubmissionReworkChanged):
            DeliveryOperations(client, tmp_path / "journal").prepare_rework("T", adoption(value))
    assert not (tmp_path / "journal").exists()


def test_unrelated_latest_report_and_query_metadata_do_not_rebase_adopted_business_source(tmp_path):
    requests = []
    with client_for(handler_for(requests)) as client:
        ops = DeliveryOperations(client, tmp_path / "journal")
        source = adopted(ops)
        def mutate(p):
            p["current"]["latest_submission_id"] = "another-report"
            p["query_generation"] = p["current"]["query_generation"] = 20
            p["version"] = p["current"]["version"] = 12
            p["as_of"] = p["current"]["as_of"] = "2026-10-23T01:00:00Z"
        client._client.close()
        client._client = httpx.Client(base_url="https://manager.test", transport=httpx.MockTransport(handler_for(requests, mutate=mutate)))
        saved = ops.prepare_rework("T", source)
        assert saved["original"]["expected_version"] == 12
        assert saved["original"]["payload"]["rework_basis"] == source["preview"]["rework_basis"]


def test_current_work_order_requires_new_explicit_binding_and_stop(tmp_path):
    def mutate(p):
        p["current"]["work_order"] = {"id": "W", "order_revision": 3, "executor": {"id": "agent", "name": "Agent",
            "kind": "agent", "tool": "codex", "active": True, "available": True, "reasons": []}}
    with client_for(handler_for([], mutate=mutate)) as client:
        ops = DeliveryOperations(client, tmp_path / "journal")
        value = adopted(ops)
        assert "work_order" not in value["authored"]
        saved = ops.prepare_rework("T", value, work_order_id="W", stopped_attestation=True)
        assert saved["original"]["payload"]["work_order"] == {"id": "W", "order_revision": 3, "stopped_attestation": True}


@pytest.mark.parametrize("mutation", ["authored_evidence", "authored_source", "adoption_budget", "preview_budget", "context_budget"])
def test_invalid_or_oversized_adoption_fails_before_fresh_network_or_journal(tmp_path, mutation):
    requests = []
    with client_for(handler_for(requests)) as client:
        ops = DeliveryOperations(client, tmp_path / "journal")
        value = adopted(ops)
        if mutation == "authored_evidence": value["authored"]["criteria"][0].update(result="met", evidence_ids=[])
        elif mutation == "authored_source": value["authored"]["source"]["name"] = ""
        elif mutation == "adoption_budget": value["authored"]["summary"] = "界" * (512 * 1024)
        elif mutation == "preview_budget": value["preview"]["current"]["definition"]["description"] = "界" * (256 * 1024)
        else: value["preview"]["feedback_context"]["submission"]["definition"]["description"] = "界" * (64 * 1024)
        requests.clear()
        with pytest.raises(ValueError): ops.prepare_rework("T", value)
        assert requests == [] and not (tmp_path / "journal").exists()
