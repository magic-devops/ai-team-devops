import json

from sop_cli.commands import requirement, workflow
from typer.testing import CliRunner


def generation_result():
    return {"ok": True, "items": [{"title": "Review scope", "acceptance_criteria": ["Saved"]}],
            "suggested_acceptance_criteria": ["Saved"], "expected_version": 4,
            "generation": {"id": "generation-one", "basis": "opaque-basis", "source": "rules"}}


def test_parse_rules_and_import_retries_preserve_generation_and_version(monkeypatch):
    seen = []

    class Client:
        def parse_requirements_document(self, body):
            seen.append(("preview", body))
            return generation_result()

        def batch_create_requirements(self, body):
            seen.append(("import", body))
            return {"ok": True, "count": 1}

    monkeypatch.setattr(requirement, "get_client", Client)
    args = ["parse-doc", "--text", "A document explaining the real acceptance conditions", "--generator", "rules", "--request-id", "preview-one", "--apply", "--json"]
    for _ in range(2):
        result = CliRunner().invoke(requirement.app, args)
        assert result.exit_code == 0, result.output
        assert json.loads(result.output)["created"]["count"] == 1
    assert seen[0][1]["generator"] == "rules" and seen[0][1]["idempotency_key"] == "preview-one"
    assert seen[1][1] == seen[3][1]
    assert seen[1][1]["generation_id"] == "generation-one" and seen[1][1]["expected_version"] == 4
    assert seen[1][1]["idempotency_key"]


def test_failed_ai_parse_does_not_import_or_switch_to_rules(monkeypatch):
    class Client:
        def parse_requirements_document(self, body):
            raise RuntimeError("Model provider disabled")

        def batch_create_requirements(self, body):
            raise AssertionError("Failed generation cannot be imported")

    monkeypatch.setattr(requirement, "get_client", Client)
    result = CliRunner().invoke(requirement.app, ["parse-doc", "--text", "A document explaining acceptance and delivery", "--generator", "ai", "--apply"])
    assert result.exit_code == 1 and "Model provider disabled" in result.output


def test_review_apply_keeps_server_basis_and_fixed_adoption_identity(monkeypatch):
    seen = []

    class Client:
        def review_requirement(self, req_id, body):
            seen.append(("review", req_id, body))
            return generation_result()

        def apply_requirement_review(self, req_id, body):
            seen.append(("apply", req_id, body))
            return {"ok": True, "updated": ["acceptance_criteria"]}

    monkeypatch.setattr(requirement, "get_client", Client)
    result = CliRunner().invoke(requirement.app, ["review", "REQ-one", "--generator", "ai", "--request-id", "review-one", "--apply-acceptance", "--json"])
    assert result.exit_code == 0, result.output
    assert seen[0][2] == {"generator": "ai", "idempotency_key": "review-one"}
    assert seen[1][2]["requirement_basis"] == "opaque-basis"
    assert seen[1][2]["generation_id"] == "generation-one" and seen[1][2]["expected_version"] == 4
    assert json.loads(result.output)["applied"]["ok"]


def test_workflow_review_uses_explicit_comment_and_retry_id(monkeypatch):
    seen = []

    class Client:
        def review_workflow(self, workflow_id, decision, comment, signal_id):
            seen.append((workflow_id, decision, comment, signal_id))
            return {"status": "completed", "decision": decision}

    monkeypatch.setattr(workflow, "get_client", Client)
    result = CliRunner().invoke(workflow.app, ["review", "review-one", "--decision", "request_changes", "--comment", "Needs tests", "--request-id", "signal-one", "--json"])
    assert result.exit_code == 0, result.output
    assert seen == [("review-one", "request_changes", "Needs tests", "signal-one")]
    assert json.loads(result.output)["decision"] == "request_changes"


def test_workflow_start_keeps_identity_and_rejects_non_object_arguments(monkeypatch):
    seen = []

    class Client:
        def start_workflow(self, body):
            seen.append(body)
            return {"workflow_id": body["workflow_id"], "status": "running"}

    monkeypatch.setattr(workflow, "get_client", Client)
    result = CliRunner().invoke(workflow.app, ["start", "code_review", "--id", "review-one", "--args", '{"diff":"change"}', "--json"])
    assert result.exit_code == 0, result.output
    assert seen == [{"type": "code_review", "workflow_id": "review-one", "args": {"diff": "change"}}]
    bad = CliRunner().invoke(workflow.app, ["start", "code_review", "--id", "review-two", "--args", "[]"])
    assert bad.exit_code != 0 and len(seen) == 1


def test_prototype_preview_and_history_do_not_implicitly_apply(monkeypatch):
    seen = []

    class Client:
        def generate_requirement_prototype(self, req_id, body):
            seen.append((req_id, body))
            return {**generation_result(), "content": "Editable design"}

        def requirement_assistance_history(self, req_id):
            return {"items": [{"status": "succeeded"}]}

        def apply_requirement_prototype(self, *args):
            raise AssertionError("Preview must not apply")

    monkeypatch.setattr(requirement, "get_client", Client)
    result = CliRunner().invoke(requirement.app, ["prototype", "REQ-one", "--generator", "rules", "--request-id", "prototype-one", "--json"])
    assert result.exit_code == 0, result.output
    assert json.loads(result.output)["content"] == "Editable design"
    assert seen == [("REQ-one", {"generator": "rules", "idempotency_key": "prototype-one", "mode": "wireframe", "extra_context": "", "gen_image": False})]
    history = CliRunner().invoke(requirement.app, ["assistance-history", "REQ-one", "--json"])
    assert json.loads(history.output)["items"][0]["status"] == "succeeded"


def test_prototype_apply_uses_only_explicit_edited_envelope(monkeypatch, tmp_path):
    seen = []

    class Client:
        def apply_requirement_prototype(self, req_id, body):
            seen.append((req_id, body))
            return {"ok": True, "artifact_id": "artifact-one"}

    monkeypatch.setattr(requirement, "get_client", Client)
    body = {"content": "Human edited design", "generation_id": "generation-one", "requirement_basis": "a" * 64, "expected_version": 4, "idempotency_key": "adopt-one"}
    path = tmp_path / "adopt.json"
    path.write_text(json.dumps(body), encoding="utf-8")
    result = CliRunner().invoke(requirement.app, ["prototype-apply", "REQ-one", "--file", str(path), "--json"])
    assert result.exit_code == 0, result.output
    assert seen == [("REQ-one", body)]
    path.write_text("[]", encoding="utf-8")
    bad = CliRunner().invoke(requirement.app, ["prototype-apply", "REQ-one", "--file", str(path)])
    assert bad.exit_code != 0 and len(seen) == 1
