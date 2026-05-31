from __future__ import annotations

import hashlib
import hmac
import sys
import time
from pathlib import Path

from sop_manager.routers import system_ops


def _seed_package(tmp_path: Path, monkeypatch) -> dict:
    monkeypatch.setenv("SOP_RUNTIME_DIR", str(tmp_path))
    profile = "prod-oceanbase"
    system_ops.upsert_profile(
        profile,
        system_ops.EnvProfileIn(
            name=profile,
            mode="private",
            database="oceanbase",
            manager_url="https://manager.internal",
            public_url="https://manager.example.com",
            features={"worker": True, "temporal": True, "sso": True},
            env={"DB_TYPE": "oceanbase", "SECRET_TOKEN": "plain-secret"},
            notes="production rollout",
        ),
        _=object(),
    )
    return system_ops.create_deployment_package(
        profile,
        system_ops.DeploymentPackageIn(version="2026.05.24-rc2", channel="staging", release_notes="pipeline-ready package"),
        _=object(),
    )


def test_deployment_pipeline_preview_is_safe_and_traceable(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    created = system_ops.create_deployment_pipeline(
        system_ops.DeploymentPipelineRunIn(
            package_id=package["item"]["id"],
            environment="staging",
            action="preview",
            operator="release-manager",
            dry_run=True,
            notes="preview before approval",
        ),
        _=object(),
    )
    listed = system_ops.list_deployment_pipelines(profile="prod-oceanbase", _=object())
    detail = system_ops.get_deployment_pipeline(created["item"]["id"], _=object())

    assert created["item"]["status"] == "preview"
    assert created["run"]["dry_run"] is True
    assert any(stage["id"] == "deploy_apply" and stage["status"] == "skipped" for stage in created["run"]["stages"])
    assert all(command["safe_to_copy"] is False for command in created["run"]["commands"] if command["id"] == "apply")
    assert listed["total"] == 1
    assert detail["run"]["events"][0]["kind"] == "created"


def test_deployment_pipeline_approval_start_and_success(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    created = system_ops.create_deployment_pipeline(
        system_ops.DeploymentPipelineRunIn(
            package_id=package["item"]["id"],
            environment="production",
            action="deploy",
            operator="release-manager",
            dry_run=False,
            approval_required=True,
        ),
        _=object(),
    )
    run_id = created["item"]["id"]
    approved = system_ops.deployment_pipeline_action(
        run_id,
        system_ops.DeploymentPipelineActionIn(action="approve", actor="ops-lead", message="approved for release window"),
        _=object(),
    )
    started = system_ops.deployment_pipeline_action(
        run_id,
        system_ops.DeploymentPipelineActionIn(action="start", actor="release-manager"),
        _=object(),
    )
    succeeded = system_ops.deployment_pipeline_action(
        run_id,
        system_ops.DeploymentPipelineActionIn(action="mark_success", actor="release-manager", message="post deploy checks green"),
        _=object(),
    )

    assert created["item"]["status"] == "awaiting_approval"
    assert approved["item"]["status"] == "ready"
    assert started["item"]["status"] == "running"
    assert succeeded["item"]["status"] == "succeeded"
    assert any(event["kind"] == "approve" for event in succeeded["run"]["events"])
    assert all(stage["status"] in {"completed", "skipped"} for stage in succeeded["run"]["stages"])


def test_deployment_pipeline_executor_plans_and_blocks_unsafe_apply(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    created = system_ops.create_deployment_pipeline(
        system_ops.DeploymentPipelineRunIn(
            package_id=package["item"]["id"],
            environment="production",
            action="deploy",
            operator="release-manager",
            dry_run=False,
            approval_required=False,
        ),
        _=object(),
    )
    run_id = created["item"]["id"]
    executors = system_ops.list_deployment_pipeline_executors(profile="prod-oceanbase", _=object())
    planned = system_ops.deployment_pipeline_execute(
        run_id,
        system_ops.DeploymentPipelineExecuteIn(executor_id="dry-run", command_id="validate", dry_run=True, actor="release-manager"),
        _=object(),
    )
    blocked = system_ops.deployment_pipeline_execute(
        run_id,
        system_ops.DeploymentPipelineExecuteIn(executor_id="managed-local", command_id="apply", dry_run=False, allow_apply=False, actor="release-manager"),
        _=object(),
    )

    assert any(item["id"] == "managed-local" for item in executors["items"])
    assert planned["result"]["status"] == "planned"
    assert planned["item"]["execution_count"] == 1
    assert blocked["result"]["status"] == "blocked"
    assert blocked["item"]["last_execution_status"] == "blocked"
    assert any(event["kind"] == "execute" for event in blocked["run"]["events"])


def test_deployment_pipeline_executor_runs_local_safe_command(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    created = system_ops.create_deployment_pipeline(
        system_ops.DeploymentPipelineRunIn(
            package_id=package["item"]["id"],
            environment="staging",
            action="deploy",
            operator="release-manager",
            dry_run=False,
            approval_required=False,
        ),
        _=object(),
    )
    run = created["run"]
    run["commands"] = [{"id": "verify", "intent": "verify", "command": f"{sys.executable} -c \"print('executor-ok')\"", "safe_to_copy": True}]
    system_ops._replace_deployment_pipeline_run(run)

    executed = system_ops.deployment_pipeline_execute(
        run["id"],
        system_ops.DeploymentPipelineExecuteIn(executor_id="managed-local", command_id="verify", dry_run=False, actor="release-manager"),
        _=object(),
    )

    assert executed["result"]["status"] == "succeeded"
    assert "executor-ok" in executed["result"]["stdout"]
    assert executed["item"]["last_execution_status"] == "succeeded"
    assert any(event["kind"] == "execute" for event in executed["run"]["events"])


def test_deployment_executor_target_registry_and_config_check(monkeypatch, tmp_path: Path) -> None:
    _seed_package(tmp_path, monkeypatch)
    created = system_ops.create_deployment_executor_target(
        system_ops.DeploymentExecutorTargetIn(
            profile="prod-oceanbase",
            name="prod webhook orchestrator",
            target_type="webhook",
            endpoint="https://deploy.example.com/hooks/hermes",
            supports=["validate", "verify", "deploy"],
            auth_ref="secret://deploy/prod",
            labels={"environment": "production"},
            actor="ops-lead",
        ),
        _=object(),
    )
    checked = system_ops.deployment_executor_target_action(
        created["item"]["id"],
        system_ops.DeploymentExecutorTargetActionIn(action="test", actor="ops-lead"),
        _=object(),
    )
    listed = system_ops.list_deployment_executor_targets(profile="prod-oceanbase", _=object())
    executors = system_ops.list_deployment_pipeline_executors(profile="prod-oceanbase", _=object())

    assert checked["result"]["status"] == "ready"
    assert listed["total"] == 1
    assert listed["items"][0]["auth_ref"] == "secret://deploy/prod"
    assert any(item["id"] == created["item"]["id"] and item["type"] == "external_orchestrator" for item in executors["items"])


def test_deployment_pipeline_external_executor_queues_request(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SOP_DEPLOY_EXECUTOR_ALLOW_APPLY", "true")
    package = _seed_package(tmp_path, monkeypatch)
    target = system_ops.create_deployment_executor_target(
        system_ops.DeploymentExecutorTargetIn(
            profile="prod-oceanbase",
            name="prod remote agent",
            target_type="remote_agent",
            endpoint="agent://release/prod",
            supports=["deploy", "rollback", "verify"],
            auth_ref="secret://agent/prod",
        ),
        _=object(),
    )
    created = system_ops.create_deployment_pipeline(
        system_ops.DeploymentPipelineRunIn(
            package_id=package["item"]["id"],
            environment="production",
            action="deploy",
            operator="release-manager",
            dry_run=False,
            approval_required=False,
        ),
        _=object(),
    )
    queued = system_ops.deployment_pipeline_execute(
        created["item"]["id"],
        system_ops.DeploymentPipelineExecuteIn(
            executor_id=target["item"]["id"],
            command_id="apply",
            dry_run=False,
            allow_apply=True,
            actor="release-manager",
        ),
        _=object(),
    )

    assert queued["result"]["status"] == "queued"
    assert queued["item"]["last_execution_status"] == "queued"
    assert queued["item"]["status"] == "running"
    assert queued["result"]["external_request"]["target_id"] == target["item"]["id"]
    assert queued["run"]["executions"][-1]["external_request"]["command_id"] == "apply"


def test_deployment_pipeline_external_execution_callback_syncs_stage_and_evidence(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SOP_DEPLOY_EXECUTOR_ALLOW_APPLY", "true")
    package = _seed_package(tmp_path, monkeypatch)
    target = system_ops.create_deployment_executor_target(
        system_ops.DeploymentExecutorTargetIn(
            profile="prod-oceanbase",
            name="prod temporal workflow",
            target_type="temporal_workflow",
            endpoint="temporal://release/prod",
            supports=["deploy", "verify"],
            auth_ref="secret://temporal/prod",
        ),
        _=object(),
    )
    created = system_ops.create_deployment_pipeline(
        system_ops.DeploymentPipelineRunIn(
            package_id=package["item"]["id"],
            environment="production",
            action="deploy",
            operator="release-manager",
            dry_run=False,
            approval_required=False,
        ),
        _=object(),
    )
    queued = system_ops.deployment_pipeline_execute(
        created["item"]["id"],
        system_ops.DeploymentPipelineExecuteIn(executor_id=target["item"]["id"], command_id="apply", dry_run=False, allow_apply=True),
        _=object(),
    )
    execution_id = queued["result"]["id"]
    callback = system_ops.deployment_pipeline_execution_callback(
        created["item"]["id"],
        execution_id,
        system_ops.DeploymentPipelineExecutionCallbackIn(
            status="succeeded",
            actor="temporal-worker",
            external_run_id="wf-release-001",
            evidence_url="https://deploy.example.com/runs/wf-release-001",
            stdout="deploy completed",
            exit_code=0,
            metadata={"workflow": "release"},
        ),
        _=object(),
    )

    assert callback["result"]["status"] == "succeeded"
    assert callback["result"]["external_run_id"] == "wf-release-001"
    assert callback["result"]["external_request"]["status"] == "succeeded"
    assert callback["item"]["last_execution_status"] == "succeeded"
    assert any(stage["id"] == "deploy_apply" and stage["status"] == "completed" for stage in callback["run"]["stages"])
    assert any(event["kind"] == "external_callback" for event in callback["run"]["events"])


def test_deployment_pipeline_external_callback_requires_valid_signature(monkeypatch, tmp_path: Path) -> None:
    monkeypatch.setenv("SOP_DEPLOY_EXECUTOR_ALLOW_APPLY", "true")
    monkeypatch.setenv("SOP_DEPLOY_CALLBACK_SECRET", "callback-secret")
    package = _seed_package(tmp_path, monkeypatch)
    target = system_ops.create_deployment_executor_target(
        system_ops.DeploymentExecutorTargetIn(
            profile="prod-oceanbase",
            name="signed temporal deployer",
            target_type="temporal_workflow",
            endpoint="temporal://deploy/production",
            supports=["deploy", "verify"],
            auth_ref="secret://temporal/deploy",
            callback_secret_ref="env://SOP_DEPLOY_CALLBACK_SECRET",
            require_callback_signature=True,
            callback_skew_seconds=300,
            labels={"region": "cn-hz"},
        ),
        _=object(),
    )
    created = system_ops.create_deployment_pipeline(
        system_ops.DeploymentPipelineRunIn(
            package_id=package["item"]["id"],
            environment="production",
            action="deploy",
            operator="release-manager",
            dry_run=False,
            approval_required=False,
        ),
        _=object(),
    )
    queued = system_ops.deployment_pipeline_execute(
        created["item"]["id"],
        system_ops.DeploymentPipelineExecuteIn(executor_id=target["item"]["id"], command_id="apply", dry_run=False, allow_apply=True),
        _=object(),
    )
    execution_id = queued["result"]["id"]

    unsigned = system_ops.DeploymentPipelineExecutionCallbackIn(status="succeeded", external_run_id="wf-signed-001")
    try:
        system_ops.deployment_pipeline_execution_callback(created["item"]["id"], execution_id, unsigned, _=object())
        raise AssertionError("unsigned callback should be rejected")
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 401

    signed = system_ops.DeploymentPipelineExecutionCallbackIn(
        status="succeeded",
        actor="temporal-worker",
        external_run_id="wf-signed-001",
        timestamp=int(time.time()),
        nonce="nonce-001",
        evidence_url="https://deploy.example.com/runs/wf-signed-001",
        exit_code=0,
        metadata={"worker": "temporal"},
    )
    payload = system_ops._deployment_pipeline_callback_signature_payload(created["item"]["id"], execution_id, signed)
    signed.signature = "sha256=" + hmac.new(b"callback-secret", payload.encode("utf-8"), hashlib.sha256).hexdigest()
    callback = system_ops.deployment_pipeline_execution_callback(created["item"]["id"], execution_id, signed, _=object())

    assert callback["result"]["status"] == "succeeded"
    assert callback["result"]["callback_signature"]["status"] == "verified"
    assert callback["result"]["external_request"]["callback_signature"]["secret_ref"] == "env://SOP_DEPLOY_CALLBACK_SECRET"


def test_deployment_pipeline_remediation_previews_runbook_and_creates_tasks(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    created = system_ops.create_deployment_pipeline(
        system_ops.DeploymentPipelineRunIn(
            package_id=package["item"]["id"],
            environment="production",
            action="deploy",
            operator="release-manager",
            dry_run=False,
            approval_required=False,
        ),
        _=object(),
    )
    run_id = created["item"]["id"]
    system_ops.deployment_pipeline_execute(
        run_id,
        system_ops.DeploymentPipelineExecuteIn(executor_id="managed-local", command_id="apply", dry_run=False, allow_apply=False, actor="release-manager"),
        _=object(),
    )
    system_ops.deployment_pipeline_action(
        run_id,
        system_ops.DeploymentPipelineActionIn(action="mark_failed", actor="release-manager", message="apply guard blocked production deploy"),
        _=object(),
    )
    preview = system_ops.deployment_pipeline_remediation(
        run_id,
        system_ops.DeploymentPipelineRemediationIn(dry_run=True, include_low=True, priority="P1", assigned_to="ReleaseOps", dev_tool="codex"),
        _=object(),
    )

    from sop_manager.routers import tasks

    created_payloads = []

    def fake_create_task(body):
        created_payloads.append(body)
        return {"ok": True, "id": f"T-HEAL-{len(created_payloads)}", "title": body.title}

    monkeypatch.setattr(tasks, "create_task", fake_create_task)
    applied = system_ops.deployment_pipeline_remediation(
        run_id,
        system_ops.DeploymentPipelineRemediationIn(dry_run=False, include_low=True, priority="P1", assigned_to="ReleaseOps", dev_tool="codex"),
        _=object(),
    )

    assert preview["result"]["summary"]["findings"] >= 2
    assert any(item["id"] == "pipeline_terminal_state" for item in preview["result"]["findings"])
    assert any(item["id"].startswith("execution_blocked_") for item in preview["result"]["findings"])
    assert preview["result"]["runbook"]["steps"]
    assert preview["result"]["planned"][0]["source"] == "system_ops.pipeline_self_heal"
    assert applied["result"]["created"]
    assert applied["item"]["self_heal_task_count"] == len(applied["result"]["created"])
    assert created_payloads[0].source == "system_ops.pipeline_self_heal"
    assert any(event["kind"] == "self_heal" for event in applied["run"]["events"])


def test_deployment_rollback_drill_creates_preview_pipeline(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    created = system_ops.create_deployment_rollback_drill(
        system_ops.DeploymentRollbackDrillIn(
            package_id=package["item"]["id"],
            name="rollback drill before production",
            environment="staging",
            scenario="manual_rehearsal",
            operator="release-manager",
            approval_required=True,
            create_pipeline=True,
            notes="prove rollback readiness",
        ),
        _=object(),
    )
    listed = system_ops.list_deployment_rollback_drills(profile="prod-oceanbase", _=object())
    detail = system_ops.get_deployment_rollback_drill(created["item"]["id"], _=object())

    assert created["item"]["status"] == "draft"
    assert created["item"]["check_total"] >= 5
    assert created["drill"]["preview_pipeline_run_id"]
    assert created["drill"]["rollback_pipeline_run_id"] == ""
    assert created["drill"]["preview_pipeline"]["action"] == "rollback"
    assert created["drill"]["preview_pipeline"]["dry_run"] is True
    assert listed["total"] == 1
    assert detail["drill"]["events"][0]["kind"] == "created"


def test_deployment_rollback_drill_complete_creates_execution_pipeline(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    created = system_ops.create_deployment_rollback_drill(
        system_ops.DeploymentRollbackDrillIn(package_id=package["item"]["id"], operator="release-manager"),
        _=object(),
    )
    drill_id = created["item"]["id"]
    started = system_ops.deployment_rollback_drill_action(
        drill_id,
        system_ops.DeploymentRollbackDrillActionIn(action="start", actor="ops-lead"),
        _=object(),
    )
    check_ids = [check["id"] for check in started["drill"]["checks"]]
    for check_id in check_ids:
        system_ops.deployment_rollback_drill_action(
            drill_id,
            system_ops.DeploymentRollbackDrillActionIn(action="pass_check", actor="ops-lead", check_id=check_id),
            _=object(),
        )
    completed = system_ops.deployment_rollback_drill_action(
        drill_id,
        system_ops.DeploymentRollbackDrillActionIn(action="complete", actor="release-manager", create_pipeline=True),
        _=object(),
    )
    pipelines = system_ops.list_deployment_pipelines(profile="prod-oceanbase", _=object())

    assert completed["item"]["status"] == "completed"
    assert completed["item"]["check_passed"] == completed["item"]["check_total"]
    assert completed["drill"]["rollback_pipeline"]["dry_run"] is False
    assert completed["drill"]["rollback_pipeline"]["environment"] == "rollback"
    assert any(run["id"] == completed["item"]["rollback_pipeline_run_id"] for run in pipelines["items"])
    assert any(event["kind"] == "complete" for event in completed["drill"]["events"])


def test_deployment_rollback_drill_failed_check_blocks_completion(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    created = system_ops.create_deployment_rollback_drill(
        system_ops.DeploymentRollbackDrillIn(package_id=package["item"]["id"], create_pipeline=False),
        _=object(),
    )
    drill_id = created["item"]["id"]
    system_ops.deployment_rollback_drill_action(
        drill_id,
        system_ops.DeploymentRollbackDrillActionIn(action="start", actor="ops-lead"),
        _=object(),
    )
    risk = system_ops.deployment_rollback_drill_action(
        drill_id,
        system_ops.DeploymentRollbackDrillActionIn(action="fail_check", actor="ops-lead", check_id="approval_route", note="missing reviewer"),
        _=object(),
    )

    assert risk["item"]["status"] == "risk"
    try:
        system_ops.deployment_rollback_drill_action(
            drill_id,
            system_ops.DeploymentRollbackDrillActionIn(action="complete", actor="release-manager"),
            _=object(),
        )
    except Exception as exc:
        assert getattr(exc, "status_code", None) == 409
    else:
        raise AssertionError("failed rollback drill check must block completion")


def test_deployment_rollback_runbook_generates_steps_preview_and_tasks(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    drill = system_ops.create_deployment_rollback_drill(
        system_ops.DeploymentRollbackDrillIn(package_id=package["item"]["id"], create_pipeline=True),
        _=object(),
    )
    created = system_ops.create_deployment_rollback_runbook(
        system_ops.DeploymentRollbackRunbookIn(
            package_id=package["item"]["id"],
            drill_id=drill["item"]["id"],
            name="production rollback runbook",
            trigger="canary_gate_failure",
            create_preview_pipeline=True,
            assigned_to="ReleaseOps",
        ),
        _=object(),
    )
    listed = system_ops.list_deployment_rollback_runbooks(profile="prod-oceanbase", _=object())
    detail = system_ops.get_deployment_rollback_runbook(created["item"]["id"], _=object())
    task_preview = system_ops.deployment_rollback_runbook_action(
        created["item"]["id"],
        system_ops.DeploymentRollbackRunbookActionIn(action="create_tasks", dry_run=True, priority="P1"),
        _=object(),
    )

    assert created["item"]["preview_pipeline_run_id"]
    assert created["item"]["step_total"] >= 8
    assert any(step["id"] == "verify_package" and step["status"] == "completed" for step in created["runbook"]["steps"])
    assert listed["total"] == 1
    assert detail["runbook"]["drill_id"] == drill["item"]["id"]
    assert task_preview["result"]["planned"]
    assert task_preview["result"]["planned"][0]["source"] == "system_ops.rollback_runbook"


def test_deployment_rollback_runbook_creates_execution_pipeline(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    created = system_ops.create_deployment_rollback_runbook(
        system_ops.DeploymentRollbackRunbookIn(package_id=package["item"]["id"], create_preview_pipeline=False),
        _=object(),
    )
    executed = system_ops.deployment_rollback_runbook_action(
        created["item"]["id"],
        system_ops.DeploymentRollbackRunbookActionIn(action="create_pipeline", actor="release-manager", dry_run=False),
        _=object(),
    )
    pipelines = system_ops.list_deployment_pipelines(profile="prod-oceanbase", _=object())

    assert executed["item"]["rollback_pipeline_run_id"]
    assert executed["result"]["pipeline"]["dry_run"] is False
    assert executed["result"]["pipeline"]["environment"] == "rollback"
    assert any(run["id"] == executed["item"]["rollback_pipeline_run_id"] for run in pipelines["items"])
    assert any(event["kind"] == "create_pipeline" for event in executed["runbook"]["events"])


def test_deployment_execution_audit_links_release_evidence(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    pipeline = system_ops.create_deployment_pipeline(
        system_ops.DeploymentPipelineRunIn(
            package_id=package["item"]["id"],
            environment="production",
            action="deploy",
            operator="release-manager",
            dry_run=False,
            approval_required=False,
        ),
        _=object(),
    )
    succeeded = system_ops.deployment_pipeline_action(
        pipeline["item"]["id"],
        system_ops.DeploymentPipelineActionIn(action="start", actor="release-manager"),
        _=object(),
    )
    succeeded = system_ops.deployment_pipeline_action(
        succeeded["item"]["id"],
        system_ops.DeploymentPipelineActionIn(action="mark_success", actor="release-manager"),
        _=object(),
    )
    audit = system_ops.create_deployment_execution_audit(
        system_ops.DeploymentExecutionAuditIn(
            package_id=package["item"]["id"],
            pipeline_run_id=succeeded["item"]["id"],
            environment="production",
            action="deploy",
            status="succeeded",
            actor="release-manager",
            change_ticket="CHG-20260524-001",
            evidence_url="audit://deploy/prod/20260524",
            risk_level="medium",
            metadata={"service": "manager"},
        ),
        _=object(),
    )
    listed = system_ops.list_deployment_execution_audits(profile="prod-oceanbase", _=object())
    detail = system_ops.get_deployment_execution_audit(audit["item"]["id"], _=object())

    assert audit["item"]["evidence_passed"] == audit["item"]["evidence_total"]
    assert audit["item"]["missing_required"] == 0
    assert audit["audit"]["refs"]["pipeline_run_id"] == succeeded["item"]["id"]
    assert audit["item"]["risk_level"] in {"medium", "high"}
    assert listed["total"] == 1
    assert detail["audit"]["metadata"]["service"] == "manager"


def test_deployment_execution_audit_task_preview_for_missing_evidence(monkeypatch, tmp_path: Path) -> None:
    package = _seed_package(tmp_path, monkeypatch)
    audit = system_ops.create_deployment_execution_audit(
        system_ops.DeploymentExecutionAuditIn(
            package_id=package["item"]["id"],
            environment="production",
            action="deploy",
            status="blocked",
            actor="release-manager",
            risk_level="high",
            notes="missing execution evidence and pipeline linkage",
        ),
        _=object(),
    )
    task_preview = system_ops.deployment_execution_audit_tasks(
        audit["item"]["id"],
        system_ops.DeploymentExecutionAuditTaskIn(dry_run=True, priority="P1", assigned_to="ReleaseOps"),
        _=object(),
    )

    planned = task_preview["result"]["planned"]
    assert audit["item"]["missing_required"] >= 2
    assert audit["item"]["risk_level"] in {"high", "critical"}
    assert planned
    assert planned[0]["source"] == "system_ops.execution_audit"
    assert any("execution_evidence" in task["description"] for task in planned)
