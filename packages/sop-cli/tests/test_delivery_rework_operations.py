"""CLI file adoption -> actual SDK/HTTP consumer definitions. UNRUN."""
from contextlib import contextmanager
from copy import deepcopy
import json

import httpx
from typer.testing import CliRunner

from sop_cli.commands import delivery, delivery_operations
from sop_sdk.client import ManagerClient
from sop_sdk.delivery_ack import digest


def complete_preview(ref):
    definition = {"task_id": "T", "title": "Task", "description": "", "assigned_to": "",
        "task_acceptance_criteria": ["Current condition"], "acceptance_criteria": ["Current condition"],
        "owner": None, "dependency_basis": {}, "requirement": None, "designs": [], "design_basis": "0" * 64}
    c = {"project_id": "P", "task_id": "T", "version": 7, "query_generation": 1, "as_of": "now",
        "task_basis": "a" * 64, "definition_digest": "b" * 64, "native_boundary_digest": "c" * 64,
        "definition": definition, "criteria": [{"source": "task", "index": 0, "text_digest": "d" * 64, "text": "Current condition"}],
        "can_submit": True, "reasons": [], "latest_submission_id": "S", "work_order": None}
    draft = {"source": None, "summary": "历史材料", "artifacts": [{"id": "diff", "title": "Diff", "content": "原始材料"}],
        "criteria": [{"source": "task", "index": 0, "text_digest": "d" * 64, "result": "unknown", "evidence_ids": []}],
        "tests": [{"id": "suite", "title": "Suite", "status": "not_run", "evidence_ids": []}]}
    payload = {**deepcopy(draft), "source": {"kind": "human", "name": "Old author"}, "task_id": "T",
        "task_basis": "a" * 64, "definition_digest": "b" * 64, "native_boundary_digest": "c" * 64}
    context = {"schema": "manager.delivery-feedback.v1", "project_id": "P", "task_id": "T", "reference": ref,
        "submission": {"definition": deepcopy(definition), "payload": payload}, "decision": {"decision": "request_changes",
            "review_id": "R", "comment": "Please fix", "reviewer": {"id": "U", "name": "Reviewer"}, "created_at": "now", "issue_id": None}}
    return {"project_id": "P", "task_id": "T", "version": 7, "query_generation": 1, "as_of": "now",
        "rework_reference": ref, "rework_basis": "2" * 64, "current": c, "feedback_context": context,
        "feedback_context_sha256": digest(context), "draft": draft, "allowed": True, "reasons": []}


def test_cli_draft_edit_prepare_rework_preserves_protected_source(tmp_path, monkeypatch):
    ref = {"submission_id": "S", "submission_digest": "1" * 64, "decision_id": "D"}
    requests = []
    def handler(request):
        requests.append(request)
        if request.url.path.endswith("/context/me"):
            return httpx.Response(200, json={"ok": True, "user": {"id": "U", "tenant_id": "TEN"},
                "scope": {"tenant_id": "TEN", "project_id": "P", "tenant_code": "t", "business_code": "b", "project_code": "p"}})
        if request.url.path.endswith("/delivery-submissions/S"):
            return httpx.Response(200, json={"project_id": "P", "task_id": "T", "version": 7,
                "submission": {"id": "S", "task_id": "T", "digest": "1" * 64}, "decision": {"id": "D", "decision": "request_changes"}})
        assert request.url.path.endswith("/rework-preview")
        return httpx.Response(200, json=complete_preview(ref))
    @contextmanager
    def get_client():
        with ManagerClient("https://manager.test", project_id="P", max_retries=0) as client:
            client._client.close()
            client._client = httpx.Client(base_url="https://manager.test", transport=httpx.MockTransport(handler))
            yield client
    monkeypatch.setattr(delivery_operations, "get_client", get_client)
    journal = str(tmp_path / "journal")
    runner = CliRunner()
    exported = tmp_path / "返工材料.json"
    draft = runner.invoke(delivery.app, ["operation", "rework-draft", "--task", "T", "--submission", "S", "--output", str(exported)])
    assert draft.exit_code == 0, draft.output
    adopted = json.loads(exported.read_text(encoding="utf-8"))
    assert "历史材料" in exported.read_text(encoding="utf-8")
    assert adopted["authored"]["source"] is None and adopted["preview"]["rework_reference"] == ref
    assert not list((tmp_path / "journal").glob("*.json"))
    original_export = exported.read_bytes()
    count = len(requests)
    duplicate = runner.invoke(delivery.app, ["operation", "rework-draft", "--task", "T", "--submission", "S", "--output", str(exported)])
    assert duplicate.exit_code != 0 and exported.read_bytes() == original_export and len(requests) == count
    adopted["authored"]["source"] = {"kind": "human", "name": "Current author"}
    path = tmp_path / "adopted.json"; path.write_text(json.dumps(adopted), encoding="utf-8")
    original = path.read_bytes()
    result = runner.invoke(delivery.app, ["operation", "prepare-rework", "--task", "T", "--file", str(path), "--journal", journal])
    assert result.exit_code == 0, result.output
    records = list((tmp_path / "journal").glob("*.json")); assert len(records) == 1
    saved = json.loads(records[0].read_text())
    assert saved["original"]["payload"]["rework_reference"] == ref and path.read_bytes() == original
    assert not any(r.url.path.endswith("/commands") for r in requests)


def test_cli_prepare_rework_rejects_wire_only_and_explains_readoption(tmp_path, monkeypatch):
    path = tmp_path / "wire.json"; path.write_text('{"rework_reference":{},"authored":{}}')
    result = CliRunner().invoke(delivery.app, ["operation", "prepare-rework", "--task", "T", "--file", str(path), "--journal", str(tmp_path / "journal")])
    assert result.exit_code != 0 and "rework-draft" in result.output
    assert not list((tmp_path / "journal").glob("*.json"))
