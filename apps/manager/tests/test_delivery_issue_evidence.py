"""Canonical Issue evidence from actual SQL and runtime records, never prose IDs."""

import importlib
import json
from copy import deepcopy

import pytest
from fastapi import HTTPException
from hermes_core.models import Principal
from hermes_core.transactional import Store
from sop_manager.routers.delivery_contract import default_flow
from sop_manager.routers.delivery_issue_contract import EvidenceItem, IssueRecord
from sop_manager.routers.sql_models import Issue, Project, Requirement, Task, User
from test_delivery_workbench import env  # noqa: F401


@pytest.fixture
def evidence(env, tmp_path):  # noqa: F811
    _, sessions, _ = env
    store = Store("sqlite:///" + str(tmp_path / "evidence.sqlite"))
    p = Principal("lead", tenant="tenant", business="team")
    ws = store.create(p, "", "workspaces", {"name": "Private", "owner": "lead"}, "ws", "ws")
    with sessions() as db:
        db.get(User, "lead").role = "super_admin"
        db.add(Requirement(id="req", tenant_id="tenant", project_id="project", title="Search"))
        db.add(Task(id="task", tenant_id="tenant", project_id="project", req_id="req", title="Implement"))
        db.add(Issue(id="issue", tenant_id="tenant", project_id="project", task_id="task", title="Failure"))
        db.commit()
    data = {"flows": {}, "executions": [], "deployments": []}

    def snapshot(actor="lead", issue_id="issue"):
        module = importlib.import_module("sop_manager.routers.delivery_issue_evidence")
        with sessions() as db:
            return module.issue_snapshot(
                db, db.get(Project, "project"), data, db.get(User, actor), issue_id, store=store
            )

    yield sessions, store, p, ws, data, snapshot
    store.engine.dispose()


def linked_run(evidence, *, run_id="run", stdout="1 failed", status="failed"):
    _, store, p, ws, data, _ = evidence
    run = store.create(
        p,
        ws["id"],
        "runs",
        {
            "attempt": 1,
            "nodes": [{"id": "tests", "argv": ["private-tool", "private-arg"]}],
            "node_results": {"tests": {"succeeded": False, "exit_code": 1, "stdout": stdout}},
            "env": {"PRIVATE_SETTING": "never-send-config"},
        },
        run_id,
        run_id,
        status=status,
    )
    entry = {
        "id": "execution",
        "issue_id": "issue",
        "task_id": "task",
        "workspace_id": ws["id"],
        "run_id": run["id"],
        "run_version": run["version"],
        "status": status,
        "attempt": 1,
        "stale": False,
        "test_node_ids": ["tests"],
        "results": deepcopy(run["data"]["node_results"]),
        "snapshot": {"title": "Implement", "requirement": {"id": "req"}},
    }
    data["executions"].append(entry)
    return run, entry


def test_description_cannot_forge_execution_or_deployment_link(evidence):
    sessions, _, _, _, data, snapshot = evidence
    with sessions() as db:
        db.get(Issue, "issue").description = "Execution forged / run private-run Deployment: private-deploy"
        db.commit()
    data["executions"].append(
        {"id": "forged", "issue_id": "different", "run_id": "private-run", "task_id": "task"}
    )
    result = snapshot()
    assert [row["kind"] for row in result["evidence"]] == ["issue", "task"]
    assert result["runtime_scopes"] == []
    for row in result["evidence"]:
        EvidenceItem.model_validate(row)
    IssueRecord.model_validate(result["issue"])


def test_linked_runtime_projects_actual_test_result_without_plan_or_config(evidence):
    _, _, _, ws, _, snapshot = evidence
    linked_run(evidence)
    result = snapshot()
    nodes = [row for row in result["evidence"] if row["kind"] == "node"]
    assert len(nodes) == 1 and nodes[0]["status"] == "failed"
    assert {fact["label"]: fact["value"] for fact in nodes[0]["facts"]}["is_test"] == "true"
    assert "1 failed" in nodes[0]["excerpt"]
    assert result["evidence_scopes"][nodes[0]["id"]] == ws["id"]
    assert result["runtime_scopes"] == [ws["id"]]
    encoded = json.dumps(result)
    assert "private-tool" not in encoded and "private-arg" not in encoded
    assert "never-send-config" not in encoded
    assert nodes[0]["target"]["execution_id"] == "execution"
    assert nodes[0]["target"]["project_id"] == "project"


def test_runtime_membership_is_rechecked_for_evidence_and_history(evidence):
    sessions, store, _, ws, _, snapshot = evidence
    linked_run(evidence, stdout="private-worker-output")
    full = snapshot()
    restricted = snapshot("reader")
    assert restricted["issue_basis"] == full["issue_basis"]
    assert "private-worker-output" not in json.dumps(restricted)
    rows = [row for row in restricted["evidence"] if row["kind"] == "execution"]
    assert len(rows) == 1 and rows[0]["restricted"] and rows[0]["excerpt"] == ""
    module = importlib.import_module("sop_manager.routers.delivery_issue_evidence")
    with sessions() as db:
        with pytest.raises(HTTPException) as exc:
            module.assert_evidence_access(
                store, db.get(User, "reader"), db.get(Project, "project"), [ws["id"]]
            )
    assert exc.value.status_code == 403


@pytest.mark.parametrize("field", ["title", "description", "resolution"])
def test_issue_text_and_logs_are_redacted_before_snapshot_persistence(evidence, field):
    sessions, _, _, _, _, snapshot = evidence
    sensitive_sample = (
        'Authorization: Bearer bearer-private-value\n{"api_key":"api-private-value",'
        '"password": "password-private-value"}\naccess_token=access-private-value\n'
        "sk-proj-abcdefghijklmnopqrstuvwxyz123456\n"
        "-----BEGIN RSA PRIVATE KEY-----\nprivate-key-body\n-----END RSA PRIVATE KEY-----"
    )
    with sessions() as db:
        setattr(db.get(Issue, "issue"), field, sensitive_sample)
        db.commit()
    linked_run(evidence, stdout=sensitive_sample + "\n" + "safe-log " * 1000)
    result = snapshot()
    encoded = json.dumps(result)
    for secret in [
        "bearer-private-value",
        "api-private-value",
        "password-private-value",
        "access-private-value",
        "abcdefghijklmnopqrstuvwxyz123456",
        "private-key-body",
    ]:
        assert secret not in encoded
    assert "[REDACTED]" in encoded
    node = next(row for row in result["evidence"] if row["kind"] == "node")
    assert node["redacted"] and node["truncated"] and len(node["excerpt"]) <= 4000


def test_missing_runtime_is_explicit_and_does_not_fall_back_to_saved_logs(evidence):
    _, _, _, _, data, snapshot = evidence
    _, entry = linked_run(evidence, stdout="stale-private-log")
    entry["run_id"] = "missing-run"
    result = snapshot()
    execution = next(row for row in result["evidence"] if row["kind"] == "execution")
    assert execution["missing"] and execution["status"] == "unknown"
    assert "stale-private-log" not in json.dumps(result)
    data["executions"] = []


def test_basis_ignores_observation_heartbeat_but_binds_full_raw_result(evidence):
    _, store, p, ws, _, snapshot = evidence
    run, entry = linked_run(evidence, stdout="x" * 5000)
    first_snapshot = snapshot()
    first = first_snapshot["issue_basis"]
    entry["observed_at"] = "2099-01-01T00:00:00Z"
    run = store.mutate(
        p,
        ws["id"],
        "runs",
        run["id"],
        operation="heartbeat",
        key="heartbeat",
        request={},
        trace="test",
        expected=run["version"],
        transform=lambda row: {
            "data": {**row["data"], "lease_expires_at": "2099", "presence": {"at": "2099"}}
        },
    )
    entry["run_version"] = run["version"]
    assert snapshot()["issue_basis"] == first
    store.mutate(
        p,
        ws["id"],
        "runs",
        run["id"],
        operation="result",
        key="new-result",
        request={},
        trace="test",
        expected=run["version"],
        transform=lambda row: {
            "data": {
                **row["data"],
                "node_results": {"tests": {"succeeded": False, "exit_code": 1, "stdout": "x" * 4999 + "y"}},
            }
        },
    )
    changed = snapshot()
    assert changed["issue_basis"] == first
    node_id = f"node:{run['id']}:tests"
    assert changed["evidence_digests"][node_id] != first_snapshot["evidence_digests"][node_id]
    entry["results"]["tests"]["stdout"] = "canonical Manager result changed"
    assert snapshot()["issue_basis"] != first


def test_issue_lookup_never_crosses_project_and_requirement_link_requires_real_row(evidence):
    sessions, _, _, _, data, snapshot = evidence
    with sessions() as db:
        db.add(Issue(id="other-issue", tenant_id="tenant", project_id="other", title="Other"))
        db.commit()
    with pytest.raises(HTTPException) as exc:
        snapshot(issue_id="other-issue")
    assert exc.value.status_code == 404
    data["flows"] = {"deleted-req": {**default_flow(), "source_issue_id": "issue"}}
    assert snapshot()["requirement_id"] is None
    data["flows"]["req"] = {**default_flow(), "source_issue_id": "issue"}
    assert snapshot()["requirement_id"] == "req"


def test_deployment_probe_is_actual_unknown_not_planned_success(evidence):
    _, _, _, ws, data, snapshot = evidence
    data["deployments"].append(
        {
            "id": "deploy",
            "issue_id": "issue",
            "kind": "deploy",
            "status": "unknown",
            "environment_id": "prod",
            "candidate_id": "candidate",
            "actual_traffic": None,
            "snapshot": {
                "environment_generation": 1,
                "environment_name": "Production",
                "definition": {"workspace_id": ws["id"], "apply_argv": ["secret-plan"]},
            },
            "operations": [
                {
                    "id": "op",
                    "run_id": "",
                    "status": "unknown",
                    "observe": False,
                    "plan": {"traffic_percent": 100},
                    "result": {
                        "status": "unknown",
                        "traffic_percent": 100,
                        "error": "worker lost",
                        "probes": [
                            {
                                "healthy": False,
                                "traffic_percent": 25,
                                "sample_count": 1,
                                "operation_id": "op",
                                "artifact_sha256": "a" * 64,
                            }
                        ],
                    },
                }
            ],
        }
    )
    result = snapshot()
    deployment = next(row for row in result["evidence"] if row["kind"] == "deployment")
    facts = {fact["label"]: fact["value"] for fact in deployment["facts"]}
    assert deployment["status"] == "unknown"
    assert facts["actual_traffic"] == "unknown"
    assert facts["business_valid"] == "false"
    assert "secret-plan" not in json.dumps(result)
    probe = next(row for row in result["evidence"] if row["kind"] == "probe")
    assert probe["status"] == "failed"
    assert probe["target"]["deployment_id"] == "deploy"


def test_evidence_limit_is_deterministic_and_marks_omission(evidence):
    _, store, p, ws, _, snapshot = evidence
    run, _ = linked_run(evidence)
    store.mutate(
        p,
        ws["id"],
        "runs",
        run["id"],
        operation="many",
        key="many",
        request={},
        trace="test",
        expected=run["version"],
        transform=lambda row: {
            "data": {
                **row["data"],
                "node_results": {
                    f"node-{index:03}": {"succeeded": False, "exit_code": 1} for index in range(70)
                },
            }
        },
    )
    first, second = snapshot(), snapshot()
    assert len(first["evidence"]) == 32
    assert any(row["truncated"] for row in first["evidence"])
    assert first == second
    assert len({row["id"] for row in first["evidence"]}) == 32


def test_linking_existing_promoted_requirement_does_not_change_source_basis(evidence):
    _, _, _, _, data, snapshot = evidence
    before = snapshot()
    data["flows"]["req"] = {**default_flow(), "source_issue_id": "issue"}
    after = snapshot()
    assert after["requirement_id"] == "req"
    assert after["issue_basis"] == before["issue_basis"]
    assert after["evidence_digests"] == before["evidence_digests"]


def test_prefixed_secret_fields_and_incomplete_private_keys_are_filtered(evidence):
    _, _, _, _, _, snapshot = evidence
    linked_run(
        evidence,
        stdout=(
            'OPENAI_API_KEY=provider-private-value\nDB_PASSWORD="db private value"\n'
            "AWS_SECRET_ACCESS_KEY=aws-private-value\nclient-secret=client-private-value\n"
            "-----BEGIN PRIVATE KEY-----\nunfinished-key-material"
        ),
    )
    encoded = json.dumps(snapshot())
    for value in (
        "provider-private-value",
        "db private value",
        "aws-private-value",
        "client-private-value",
        "unfinished-key-material",
    ):
        assert value not in encoded


def test_selected_node_digest_binds_source_identity_and_marks_old_attempt(evidence):
    _, store, p, ws, _, snapshot = evidence
    run, _ = linked_run(evidence, status="running")
    before = snapshot()
    store.mutate(
        p,
        ws["id"],
        "runs",
        run["id"],
        operation="source",
        key="source-change",
        request={},
        trace="test",
        expected=run["version"],
        transform=lambda row: {
            "data": {**row["data"], "attempt": 2, "source": {"execution_id": "different-source"}}
        },
    )
    after = snapshot()
    node_id = f"node:{run['id']}:tests"
    assert after["evidence_digests"][node_id] != before["evidence_digests"][node_id]
    node = next(row for row in after["evidence"] if row["id"] == node_id)
    assert node["status"] == "historical"
    assert {fact["label"]: fact["value"] for fact in node["facts"]}["result_current"] == "false"


def test_runtime_history_remains_readable_when_workspace_is_inactive(evidence):
    sessions, store, p, ws, _, snapshot = evidence
    linked_run(evidence)
    store.mutate(
        p,
        "",
        "workspaces",
        ws["id"],
        operation="archive",
        key="archive",
        request={},
        trace="test",
        expected=ws["version"],
        transform=lambda row: {"status": "archived"},
    )
    assert any(row["kind"] == "node" and not row["restricted"] for row in snapshot()["evidence"])
    module = importlib.import_module("sop_manager.routers.delivery_issue_evidence")
    with sessions() as db:
        module.assert_evidence_access(store, db.get(User, "lead"), db.get(Project, "project"), [ws["id"]])


def test_actual_requirement_edit_changes_source_basis_before_runtime_sync(evidence):
    from sop_manager.routers.delivery_verification import VerificationContext

    sessions, _, _, _, data, snapshot = evidence
    _, entry = linked_run(evidence)
    data["flows"]["req"] = default_flow()
    with sessions() as db:
        task = db.get(Task, "task")
        task.owner_id = "user:lead"
        task.acceptance_criteria = ["Returns a matching result"]
        db.get(Requirement, "req").acceptance_criteria = ["Search works"]
        db.commit()
        entry["snapshot"] = VerificationContext(db, db.get(Project, "project"), data).definition("task")[
            "snapshot"
        ]
    before = snapshot()
    before_execution = next(row for row in before["evidence"] if row["kind"] == "execution")
    assert {fact["label"]: fact["value"] for fact in before_execution["facts"]}["scope_current"] == "true"
    with sessions() as db:
        db.get(Requirement, "req").description = "A different requirement definition"
        db.commit()
    after = snapshot()
    assert after["issue_basis"] != before["issue_basis"]
    after_execution = next(row for row in after["evidence"] if row["kind"] == "execution")
    assert {fact["label"]: fact["value"] for fact in after_execution["facts"]}["scope_current"] == "false"


def test_selected_node_digest_rejects_changed_origin_without_result_change(evidence):
    _, store, p, ws, _, snapshot = evidence
    run, _ = linked_run(evidence)
    before = snapshot()
    store.mutate(
        p,
        ws["id"],
        "runs",
        run["id"],
        operation="source",
        key="origin-only",
        request={},
        trace="test",
        expected=run["version"],
        transform=lambda row: {"data": {**row["data"], "source": {"execution_id": "replaced-origin"}}},
    )
    after = snapshot()
    node_id = f"node:{run['id']}:tests"
    assert after["issue_basis"] == before["issue_basis"]
    assert after["evidence_digests"][node_id] != before["evidence_digests"][node_id]
