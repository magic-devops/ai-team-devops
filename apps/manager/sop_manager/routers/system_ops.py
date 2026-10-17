"""系统运维配置：环境 Profile、部署模式与运行时自检。"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import shlex
import subprocess
import time
import urllib.parse
import urllib.request
import uuid
from sop_manager.task_owner import TaskOwnerId, TaskOwnerInput

from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field

from sop_manager.db import oceanbase_migration_plan, oceanbase_migration_smoke
from sop_manager.routers.metrics import current_trace_context
from sop_manager.routers.auth_sql import current_user, require_role

router = APIRouter(prefix="/api/v1/system/ops", tags=["system-ops"])


class EnvProfileIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    mode: str = Field("single", pattern="^(single|saas|local|private)$")
    database: str = Field("sqlite", pattern="^(sqlite|postgresql|mysql|oceanbase)$")
    manager_url: str = ""
    public_url: str = ""
    features: dict[str, bool] = Field(default_factory=dict)
    env: dict[str, str] = Field(default_factory=dict)
    notes: str = ""


class DeploymentPackageIn(BaseModel):
    version: str = ""
    channel: str = Field("manual", pattern="^(manual|staging|production|rollback)$")
    release_notes: str = ""
    created_by: str = "ops-admin"


class DeploymentPackageApprovalIn(BaseModel):
    package_id: str
    environment: str = Field("staging", pattern="^(dev|staging|production|rollback)$")
    requested_by: str = "release-manager"
    reviewers: list[str] = Field(default_factory=list)
    policy: str = Field("single", pattern="^(single|two_person|change_board)$")
    notes: str = ""


class DeploymentPackageApprovalActionIn(BaseModel):
    action: str = Field(..., pattern="^(approve|reject|publish|cancel)$")
    actor: str = "ops-admin"
    note: str = ""
    create_pipeline: bool = True


class DeploymentPipelineRunIn(BaseModel):
    package_id: str = ""
    profile: str = ""
    environment: str = Field("staging", pattern="^(dev|staging|production|rollback)$")
    action: str = Field("preview", pattern="^(preview|deploy|rollback)$")
    operator: str = "ops-admin"
    dry_run: bool = True
    approval_required: bool = True
    notes: str = ""


class DeploymentPipelineActionIn(BaseModel):
    action: str = Field(..., pattern="^(approve|start|mark_success|mark_failed|cancel)$")
    actor: str = "ops-admin"
    message: str = ""


class DeploymentPipelineExecuteIn(BaseModel):
    executor_id: str = "managed-local"
    command_id: str = ""
    stage_id: str = ""
    actor: str = "ops-admin"
    dry_run: bool = True
    allow_apply: bool = False
    evidence_url: str = ""
    note: str = ""
    timeout_seconds: int = Field(30, ge=1, le=300)


class DeploymentExecutorTargetIn(BaseModel):
    profile: str = ""
    name: str = Field(..., min_length=1, max_length=120)
    target_type: str = Field("webhook", pattern="^(webhook|github_actions|gitlab_ci|jenkins|kubernetes_job|temporal_workflow|remote_agent)$")
    endpoint: str = ""
    enabled: bool = True
    supports: list[str] = Field(default_factory=lambda: ["validate", "verify", "deploy", "rollback"])
    auth_ref: str = ""
    callback_secret_ref: str = ""
    require_callback_signature: bool = False
    callback_skew_seconds: int = Field(300, ge=30, le=3600)
    concurrency_limit: int = Field(1, ge=1, le=50)
    timeout_seconds: int = Field(120, ge=5, le=3600)
    labels: dict[str, str] = Field(default_factory=dict)
    notes: str = ""
    actor: str = "ops-admin"


class DeploymentExecutorTargetActionIn(BaseModel):
    action: str = Field(..., pattern="^(test|enable|disable|delete)$")
    actor: str = "ops-admin"
    note: str = ""


class DeploymentPipelineExecutionCallbackIn(BaseModel):
    status: str = Field(..., pattern="^(queued|running|succeeded|failed|blocked|cancelled)$")
    actor: str = "external-orchestrator"
    external_run_id: str = ""
    timestamp: int | None = None
    nonce: str = ""
    signature: str = ""
    evidence_url: str = ""
    stdout: str = ""
    stderr: str = ""
    exit_code: int | None = None
    note: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class DeploymentPipelineRemediationIn(TaskOwnerInput):
    dry_run: bool = True
    include_low: bool = False
    priority: str = Field("P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = "codex"
    actor: str = "ops-admin"
    note: str = ""


class DeploymentCanaryPolicyIn(BaseModel):
    package_id: str
    name: str = Field("progressive rollout", min_length=1, max_length=120)
    environment: str = Field("staging", pattern="^(dev|staging|production)$")
    strategy: str = Field("linear", pattern="^(linear|exponential|manual)$")
    traffic_steps: list[int] = Field(default_factory=lambda: [5, 25, 50, 100])
    max_error_rate: float = Field(0.02, ge=0, le=1)
    latency_p95_ms: int = Field(1000, ge=1)
    min_observation_minutes: int = Field(10, ge=0, le=1440)
    auto_promote: bool = False
    created_by: str = "release-manager"
    notes: str = ""


class DeploymentCanaryActionIn(BaseModel):
    action: str = Field(..., pattern="^(start|advance|pause|resume|rollback|complete)$")
    actor: str = "ops-admin"
    note: str = ""
    metrics: dict[str, Any] = Field(default_factory=dict)
    create_pipeline: bool = True


class DeploymentCanaryImBriefingIn(BaseModel):
    dry_run: bool = True
    channels: list[str] = Field(default_factory=list)
    event: str = "canary_risk"
    title: str = ""
    limit: int = Field(6, ge=1, le=20)


class DeploymentCanaryMetricSourceIn(BaseModel):
    policy_id: str
    name: str = Field("canary metrics source", min_length=1, max_length=120)
    source_type: str = Field("manual", pattern="^(prometheus|grafana|datadog|manual|synthetic)$")
    endpoint: str = ""
    error_rate_query: str = ""
    latency_p95_query: str = ""
    window_minutes: int = Field(10, ge=1, le=1440)
    enabled: bool = True
    sample_error_rate: float = Field(0.005, ge=0, le=1)
    sample_latency_p95_ms: int = Field(320, ge=0)
    labels: dict[str, str] = Field(default_factory=dict)
    created_by: str = "release-manager"
    notes: str = ""


class DeploymentCanaryMetricCollectIn(BaseModel):
    dry_run: bool = True
    source_id: str = ""
    actor: str = "ops-admin"
    metrics: dict[str, Any] = Field(default_factory=dict)
    apply_to_gate: bool = False
    advance_on_pass: bool = False


class DeploymentRollbackDrillIn(BaseModel):
    package_id: str = ""
    profile: str = ""
    name: str = Field("release rollback drill", min_length=1, max_length=120)
    environment: str = Field("staging", pattern="^(dev|staging|production|rollback)$")
    scenario: str = Field("post_deploy_regression", pattern="^(post_deploy_regression|canary_gate_failure|dependency_outage|manual_rehearsal)$")
    operator: str = "release-manager"
    approval_required: bool = True
    create_pipeline: bool = True
    notes: str = ""


class DeploymentRollbackDrillActionIn(BaseModel):
    action: str = Field(..., pattern="^(start|pass_check|fail_check|create_rollback_pipeline|complete|cancel)$")
    actor: str = "ops-admin"
    note: str = ""
    check_id: str = ""
    create_pipeline: bool = True


class DeploymentRollbackRunbookIn(TaskOwnerInput):
    package_id: str = ""
    profile: str = ""
    drill_id: str = ""
    name: str = Field("release rollback runbook", min_length=1, max_length=120)
    environment: str = Field("production", pattern="^(dev|staging|production|rollback)$")
    trigger: str = Field("manual", pattern="^(manual|canary_gate_failure|post_deploy_regression|dependency_outage|slo_breach)$")
    operator: str = "release-manager"
    approval_required: bool = True
    create_preview_pipeline: bool = True
    task_priority: str = Field("P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = "codex"
    notes: str = ""


class DeploymentRollbackRunbookActionIn(TaskOwnerInput):
    action: str = Field(..., pattern="^(mark_ready|create_tasks|create_pipeline|archive)$")
    actor: str = "ops-admin"
    note: str = ""
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = "codex"


class DeploymentExecutionAuditIn(BaseModel):
    package_id: str = ""
    profile: str = ""
    pipeline_run_id: str = ""
    canary_policy_id: str = ""
    rollback_drill_id: str = ""
    rollback_runbook_id: str = ""
    environment: str = Field("production", pattern="^(dev|staging|production|rollback)$")
    action: str = Field("deploy", pattern="^(deploy|rollback|canary|runbook|manual)$")
    status: str = Field("pending", pattern="^(pending|running|succeeded|failed|blocked)$")
    actor: str = "release-manager"
    change_ticket: str = ""
    evidence_url: str = ""
    risk_level: str = Field("medium", pattern="^(low|medium|high|critical)$")
    notes: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class DeploymentExecutionAuditTaskIn(TaskOwnerInput):
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = "codex"
    include_low: bool = False


def _runtime_dir() -> Path:
    return Path(os.getenv("SOP_RUNTIME_DIR", ".sop-runtime")).resolve()


def _log_dir() -> Path:
    return Path(os.getenv("LOG_DIR", Path(os.getenv("PROJECT_PATH", ".")) / "logs")).resolve()


def _profiles_path() -> Path:
    return _runtime_dir() / "env-profiles.json"


def _deployment_packages_path() -> Path:
    return _runtime_dir() / "deploy" / "deployment-packages.json"


def _deployment_pipeline_runs_path() -> Path:
    return _runtime_dir() / "deploy" / "deployment-pipelines.json"


def _deployment_executor_targets_path() -> Path:
    return _runtime_dir() / "deploy" / "deployment-executor-targets.json"


def _deployment_package_approvals_path() -> Path:
    return _runtime_dir() / "deploy" / "deployment-package-approvals.json"


def _deployment_canary_policies_path() -> Path:
    return _runtime_dir() / "deploy" / "deployment-canary-policies.json"


def _deployment_canary_metric_sources_path() -> Path:
    return _runtime_dir() / "deploy" / "deployment-canary-metric-sources.json"


def _deployment_rollback_drills_path() -> Path:
    return _runtime_dir() / "deploy" / "deployment-rollback-drills.json"


def _deployment_rollback_runbooks_path() -> Path:
    return _runtime_dir() / "deploy" / "deployment-rollback-runbooks.json"


def _deployment_execution_audits_path() -> Path:
    return _runtime_dir() / "deploy" / "deployment-execution-audits.json"


def _now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _safe_name(name: str) -> str:
    out = "".join(c for c in name.strip().lower() if c.isalnum() or c in "-_")[:64]
    if not out:
        raise HTTPException(400, "profile 名称不能为空")
    return out


def _safe_version(value: str) -> str:
    out = "".join(c for c in value.strip().lower() if c.isalnum() or c in "-_.")[:80]
    if not out:
        out = datetime.now(timezone.utc).strftime("v%Y%m%d.%H%M%S")
    return out


def _load() -> dict[str, Any]:
    path = _profiles_path()
    if not path.is_file():
        return {"active": "local-dev", "profiles": {}}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"active": "local-dev", "profiles": {}}
    except Exception:
        return {"active": "local-dev", "profiles": {}}


def _save(data: dict[str, Any]) -> None:
    path = _profiles_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _load_deployment_packages() -> dict[str, Any]:
    path = _deployment_packages_path()
    if not path.is_file():
        return {"items": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"items": []}
    except Exception:
        return {"items": []}


def _save_deployment_packages(data: dict[str, Any]) -> None:
    path = _deployment_packages_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _load_deployment_pipeline_runs() -> dict[str, Any]:
    path = _deployment_pipeline_runs_path()
    if not path.is_file():
        return {"items": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"items": []}
    except Exception:
        return {"items": []}


def _save_deployment_pipeline_runs(data: dict[str, Any]) -> None:
    path = _deployment_pipeline_runs_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _load_deployment_executor_targets() -> dict[str, Any]:
    path = _deployment_executor_targets_path()
    if not path.is_file():
        return {"items": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"items": []}
    except Exception:
        return {"items": []}


def _save_deployment_executor_targets(data: dict[str, Any]) -> None:
    path = _deployment_executor_targets_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _load_deployment_package_approvals() -> dict[str, Any]:
    path = _deployment_package_approvals_path()
    if not path.is_file():
        return {"items": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"items": []}
    except Exception:
        return {"items": []}


def _save_deployment_package_approvals(data: dict[str, Any]) -> None:
    path = _deployment_package_approvals_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _load_deployment_canary_policies() -> dict[str, Any]:
    path = _deployment_canary_policies_path()
    if not path.is_file():
        return {"items": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"items": []}
    except Exception:
        return {"items": []}


def _save_deployment_canary_policies(data: dict[str, Any]) -> None:
    path = _deployment_canary_policies_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _load_deployment_canary_metric_sources() -> dict[str, Any]:
    path = _deployment_canary_metric_sources_path()
    if not path.is_file():
        return {"items": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"items": []}
    except Exception:
        return {"items": []}


def _save_deployment_canary_metric_sources(data: dict[str, Any]) -> None:
    path = _deployment_canary_metric_sources_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _load_deployment_rollback_drills() -> dict[str, Any]:
    path = _deployment_rollback_drills_path()
    if not path.is_file():
        return {"items": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"items": []}
    except Exception:
        return {"items": []}


def _save_deployment_rollback_drills(data: dict[str, Any]) -> None:
    path = _deployment_rollback_drills_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _load_deployment_rollback_runbooks() -> dict[str, Any]:
    path = _deployment_rollback_runbooks_path()
    if not path.is_file():
        return {"items": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"items": []}
    except Exception:
        return {"items": []}


def _save_deployment_rollback_runbooks(data: dict[str, Any]) -> None:
    path = _deployment_rollback_runbooks_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _load_deployment_execution_audits() -> dict[str, Any]:
    path = _deployment_execution_audits_path()
    if not path.is_file():
        return {"items": []}
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else {"items": []}
    except Exception:
        return {"items": []}


def _save_deployment_execution_audits(data: dict[str, Any]) -> None:
    path = _deployment_execution_audits_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")


def _audit_change(action: str, profile: str, details: dict[str, Any]) -> None:
    try:
        from sop_manager.routers.audit_chain import append_audit

        append_audit(
            action,
            resource_type="system_ops_profile",
            resource_id=profile,
            details=details,
        )
    except Exception:
        pass


def _templates() -> list[dict[str, Any]]:
    return [
        {
            "name": "local-dev",
            "mode": "local",
            "database": "sqlite",
            "manager_url": "http://localhost:8765",
            "public_url": "http://localhost:8765",
            "features": {"billing": False, "sso": False, "worker": False, "temporal": False},
            "env": {"ADMIN_MODE": "single", "DB_TYPE": "sqlite", "WORKFLOW_ENGINE": "memory"},
            "notes": "本地开发和单项目演示。",
        },
        {
            "name": "saas-pg",
            "mode": "saas",
            "database": "postgresql",
            "manager_url": "https://manager.example.com",
            "public_url": "https://manager.example.com",
            "features": {"billing": True, "sso": True, "worker": True, "temporal": True},
            "env": {"ADMIN_MODE": "saas", "DB_TYPE": "postgresql", "WORKFLOW_ENGINE": "temporal"},
            "notes": "SaaS 多租户标准部署模板。",
        },
        {
            "name": "private-oceanbase",
            "mode": "private",
            "database": "oceanbase",
            "manager_url": "https://sop.internal",
            "public_url": "https://sop.internal",
            "features": {"billing": True, "sso": True, "worker": True, "temporal": True, "audit_worm": True},
            "env": {"ADMIN_MODE": "saas", "DB_TYPE": "oceanbase", "WORKFLOW_ENGINE": "temporal"},
            "notes": "企业私有化和 OceanBase 场景。",
        },
    ]


def _is_secret_key(key: str) -> bool:
    k = key.lower()
    return any(x in k for x in ("secret", "password", "token", "key"))


def _mask_env(env: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    for key, value in env.items():
        text = str(value)
        out[str(key)] = "***" if _is_secret_key(str(key)) and text else text
    return out


def _merge_profiles() -> dict[str, dict[str, Any]]:
    data = _load()
    profiles = data.get("profiles", {}) if isinstance(data.get("profiles"), dict) else {}
    merged = {x["name"]: x for x in _templates()}
    merged.update(profiles)
    return merged


def _public_profile(name: str, row: dict[str, Any], active: str) -> dict[str, Any]:
    return {
        "name": name,
        "mode": row.get("mode", "single"),
        "database": row.get("database", "sqlite"),
        "manager_url": row.get("manager_url", ""),
        "public_url": row.get("public_url", ""),
        "features": row.get("features", {}),
        "env": _mask_env(row.get("env", {}) if isinstance(row.get("env"), dict) else {}),
        "notes": row.get("notes", ""),
        "active": name == active,
        "updated_at": row.get("updated_at", ""),
    }


def _effective_env() -> dict[str, str]:
    keys = [
        "ADMIN_MODE", "DB_TYPE", "DATABASE_URL", "PROJECT_ID", "TENANT_ID",
        "MANAGER_PUBLIC_URL", "WORKFLOW_ENGINE", "TEMPORAL_HOST", "REDIS_URL",
        "MEMORY_BACKEND", "SOP_RUNTIME_DIR", "LANCE_DB_PATH",
    ]
    return {k: os.getenv(k, "") for k in keys if os.getenv(k, "")}


def _compose_override(profile: str, row: dict[str, Any]) -> str:
    env = row.get("env", {}) if isinstance(row.get("env"), dict) else {}
    features = row.get("features", {}) if isinstance(row.get("features"), dict) else {}
    lines = [
        "# Generated by SOP Manager system ops profile",
        f"# profile: {profile}",
        "services:",
        "  manager:",
        "    environment:",
    ]
    for key, value in sorted(env.items()):
        lines.append(f"      {key}: {json.dumps(str(value), ensure_ascii=False)}")
    if row.get("manager_url"):
        lines.append(f"      MANAGER_URL: {json.dumps(str(row.get('manager_url')), ensure_ascii=False)}")
    if row.get("public_url"):
        lines.append(f"      MANAGER_PUBLIC_URL: {json.dumps(str(row.get('public_url')), ensure_ascii=False)}")
    if features.get("worker"):
        lines.extend([
            "  worker:",
            "    environment:",
            f"      WORKER_PROFILE: {json.dumps(profile, ensure_ascii=False)}",
        ])
    if features.get("temporal"):
        lines.extend([
            "  temporal:",
            "    profiles:",
            "      - temporal",
        ])
    return "\n".join(lines) + "\n"


def _env_shell(profile: str, row: dict[str, Any]) -> str:
    env = row.get("env", {}) if isinstance(row.get("env"), dict) else {}
    merged = dict(env)
    if row.get("manager_url"):
        merged["MANAGER_URL"] = str(row.get("manager_url"))
    if row.get("public_url"):
        merged["MANAGER_PUBLIC_URL"] = str(row.get("public_url"))
    return "\n".join(f"export {k}={json.dumps(str(v), ensure_ascii=False)}" for k, v in sorted(merged.items()))


def _masked_env_shell(profile: str, row: dict[str, Any]) -> str:
    env = row.get("env", {}) if isinstance(row.get("env"), dict) else {}
    merged = dict(env)
    if row.get("manager_url"):
        merged["MANAGER_URL"] = str(row.get("manager_url"))
    if row.get("public_url"):
        merged["MANAGER_PUBLIC_URL"] = str(row.get("public_url"))
    return "\n".join(f"export {k}={json.dumps(str(v), ensure_ascii=False)}" for k, v in sorted(_mask_env(merged).items()))


def _runbook(profile: str, row: dict[str, Any]) -> str:
    return "\n".join([
        f"# SOP Deployment Profile: {profile}",
        "",
        f"- mode: {row.get('mode', '-')}",
        f"- database: {row.get('database', '-')}",
        f"- manager_url: {row.get('manager_url', '-')}",
        f"- public_url: {row.get('public_url', '-')}",
        "",
        "## Apply",
        "",
        "```bash",
        f"source .sop-runtime/deploy/{profile}/profile.env",
        f"docker compose -f docker-compose.yml -f .sop-runtime/deploy/{profile}/docker-compose.override.yml up -d",
        "```",
        "",
        "## Notes",
        "",
        str(row.get("notes") or "-"),
        "",
    ])


def _sha256_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _deployment_bundle_files(profile: str, row: dict[str, Any]) -> dict[str, str]:
    return {
        "profile.env": _env_shell(profile, row) + "\n",
        "docker-compose.override.yml": _compose_override(profile, row),
        "README.md": _runbook(profile, row),
    }


def _public_deployment_package(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id", ""),
        "profile": item.get("profile", ""),
        "version": item.get("version", ""),
        "channel": item.get("channel", ""),
        "created_at": item.get("created_at", ""),
        "created_by": item.get("created_by", ""),
        "release_notes": item.get("release_notes", ""),
        "dir": item.get("dir", ""),
        "mode": item.get("mode", ""),
        "database": item.get("database", ""),
        "file_count": len(item.get("files", [])) if isinstance(item.get("files"), list) else 0,
        "checksum": item.get("checksum", ""),
        "release_status": item.get("release_status", "draft"),
        "published_at": item.get("published_at", ""),
        "published_by": item.get("published_by", ""),
        "published_environment": item.get("published_environment", ""),
        "published_approval_id": item.get("published_approval_id", ""),
        "canary_policy_id": item.get("canary_policy_id", ""),
        "canary_completed_at": item.get("canary_completed_at", ""),
        "canary_completed_by": item.get("canary_completed_by", ""),
    }


def _find_deployment_package(package_id: str) -> dict[str, Any]:
    data = _load_deployment_packages()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    for item in items:
        if isinstance(item, dict) and item.get("id") == package_id:
            return item
    raise HTTPException(404, f"unknown deployment package: {package_id}")


def _latest_deployment_package_for_profile(profile: str) -> dict[str, Any]:
    data = _load_deployment_packages()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    for item in items:
        if isinstance(item, dict) and item.get("profile") == profile:
            return item
    raise HTTPException(404, f"profile has no deployment package: {profile}")


def _replace_deployment_package(item: dict[str, Any]) -> None:
    data = _load_deployment_packages()
    items = [row for row in data.get("items", []) if isinstance(row, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [item if row.get("id") == item.get("id") else row for row in items]
    _save_deployment_packages(data)


def _create_deployment_package(profile: str, row: dict[str, Any], body: DeploymentPackageIn) -> dict[str, Any]:
    version = _safe_version(body.version)
    package_id = f"{profile}-{version}"
    data = _load_deployment_packages()
    items = [item for item in data.get("items", []) if isinstance(item, dict)] if isinstance(data.get("items"), list) else []
    if any(item.get("id") == package_id for item in items):
        package_id = f"{package_id}-{uuid.uuid4().hex[:8]}"
    out_dir = _runtime_dir() / "deploy" / profile / "packages" / package_id
    out_dir.mkdir(parents=True, exist_ok=True)
    files = _deployment_bundle_files(profile, row)
    file_rows = []
    for filename, content in files.items():
        path = out_dir / filename
        path.write_text(content, encoding="utf-8")
        file_rows.append({
            "name": filename,
            "path": str(path),
            "size": len(content.encode("utf-8")),
            "sha256": _sha256_text(content),
        })
    manifest = {
        "id": package_id,
        "profile": profile,
        "version": version,
        "channel": body.channel,
        "created_at": _now(),
        "created_by": body.created_by or "ops-admin",
        "release_notes": body.release_notes,
        "dir": str(out_dir),
        "mode": row.get("mode", "single"),
        "database": row.get("database", "sqlite"),
        "features": row.get("features", {}) if isinstance(row.get("features"), dict) else {},
        "files": file_rows,
        "checksum": _sha256_text("\n".join(f"{item['name']}:{item['sha256']}" for item in file_rows)),
        "agent_consumption": {
            "surface": "settings.profiles.deployment_packages",
            "api": f"/api/v1/system/ops/profiles/{profile}/deployment-packages",
            "purpose": "Versioned deployment package manifest for rollout, rollback, audit, and AI operations planning.",
        },
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True), encoding="utf-8")
    manifest["files"].append({
        "name": "manifest.json",
        "path": str(out_dir / "manifest.json"),
        "size": (out_dir / "manifest.json").stat().st_size,
        "sha256": _sha256_text((out_dir / "manifest.json").read_text(encoding="utf-8")),
    })
    data["items"] = [manifest, *items][:100]
    _save_deployment_packages(data)
    _audit_change("system_ops.deployment_package.create", profile, {"package_id": package_id, "version": version, "channel": body.channel})
    return manifest


def _approval_event(kind: str, actor: str, note: str = "", extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": f"evt-{uuid.uuid4().hex[:10]}",
        "kind": kind,
        "actor": actor or "ops-admin",
        "note": note,
        "at": _now(),
        "extra": extra or {},
    }


def _public_deployment_package_approval(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id", ""),
        "package_id": item.get("package_id", ""),
        "profile": item.get("profile", ""),
        "version": item.get("version", ""),
        "channel": item.get("channel", ""),
        "environment": item.get("environment", ""),
        "status": item.get("status", ""),
        "policy": item.get("policy", ""),
        "requested_by": item.get("requested_by", ""),
        "reviewers": item.get("reviewers", []) if isinstance(item.get("reviewers"), list) else [],
        "approved_by": item.get("approved_by", ""),
        "published_by": item.get("published_by", ""),
        "pipeline_run_id": item.get("pipeline_run_id", ""),
        "created_at": item.get("created_at", ""),
        "updated_at": item.get("updated_at", ""),
        "notes": item.get("notes", ""),
    }


def _create_deployment_package_approval(body: DeploymentPackageApprovalIn) -> dict[str, Any]:
    package = _find_deployment_package(body.package_id)
    approval_id = f"pkg-approval-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"
    now = _now()
    reviewers = [str(item).strip() for item in body.reviewers if str(item).strip()]
    row = {
        "id": approval_id,
        "package_id": str(package.get("id") or body.package_id),
        "profile": str(package.get("profile") or ""),
        "version": str(package.get("version") or ""),
        "channel": str(package.get("channel") or ""),
        "environment": body.environment,
        "status": "pending",
        "policy": body.policy,
        "requested_by": body.requested_by or "release-manager",
        "reviewers": reviewers,
        "approved_by": "",
        "rejected_by": "",
        "published_by": "",
        "pipeline_run_id": "",
        "notes": body.notes,
        "created_at": now,
        "updated_at": now,
        "package_checksum": package.get("checksum", ""),
        "checks": [
            {"id": "package_checksum", "status": "passed", "value": package.get("checksum", "")},
            {"id": "immutable_bundle", "status": "passed", "value": package.get("dir", "")},
            {"id": "approval_policy", "status": "pending", "value": body.policy},
        ],
        "events": [_approval_event("requested", body.requested_by, body.notes, {"policy": body.policy})],
        "agent_consumption": {
            "surface": "settings.profiles.deployment_package_approval",
            "api": "/api/v1/system/ops/deployment-package-approvals",
            "purpose": "Govern versioned deployment package release approvals and publish records before rollout.",
        },
    }
    data = _load_deployment_package_approvals()
    items = [item for item in data.get("items", []) if isinstance(item, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [row, *items][:200]
    _save_deployment_package_approvals(data)
    _audit_change("system_ops.deployment_package_approval.request", str(package.get("profile") or ""), {"approval_id": approval_id, "package_id": package.get("id")})
    return row


def _find_deployment_package_approval(approval_id: str) -> dict[str, Any]:
    data = _load_deployment_package_approvals()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    for item in items:
        if isinstance(item, dict) and item.get("id") == approval_id:
            return item
    raise HTTPException(404, f"unknown deployment package approval: {approval_id}")


def _replace_deployment_package_approval(item: dict[str, Any]) -> None:
    data = _load_deployment_package_approvals()
    items = [row for row in data.get("items", []) if isinstance(row, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [item if row.get("id") == item.get("id") else row for row in items]
    _save_deployment_package_approvals(data)


def _apply_deployment_package_approval_action(item: dict[str, Any], body: DeploymentPackageApprovalActionIn) -> dict[str, Any]:
    status = str(item.get("status") or "pending")
    actor = body.actor or "ops-admin"
    events = item.get("events", []) if isinstance(item.get("events"), list) else []
    if status in {"rejected", "cancelled", "published"}:
        raise HTTPException(409, f"deployment package approval already finalized: {status}")
    if body.action == "approve":
        if status != "pending":
            raise HTTPException(409, f"approval cannot be approved from status: {status}")
        item["status"] = "approved"
        item["approved_by"] = actor
        item["approved_at"] = _now()
        for check in item.get("checks", []) if isinstance(item.get("checks"), list) else []:
            if isinstance(check, dict) and check.get("id") == "approval_policy":
                check["status"] = "passed"
    elif body.action == "reject":
        if status not in {"pending", "approved"}:
            raise HTTPException(409, f"approval cannot be rejected from status: {status}")
        item["status"] = "rejected"
        item["rejected_by"] = actor
        item["rejected_at"] = _now()
    elif body.action == "cancel":
        if status not in {"pending", "approved"}:
            raise HTTPException(409, f"approval cannot be cancelled from status: {status}")
        item["status"] = "cancelled"
        item["cancelled_by"] = actor
        item["cancelled_at"] = _now()
    elif body.action == "publish":
        if status != "approved":
            raise HTTPException(409, "deployment package must be approved before publish")
        package = _find_deployment_package(str(item.get("package_id") or ""))
        item["status"] = "published"
        item["published_by"] = actor
        item["published_at"] = _now()
        package["release_status"] = "published"
        package["published_at"] = item["published_at"]
        package["published_by"] = actor
        package["published_environment"] = item.get("environment", "")
        package["published_approval_id"] = item.get("id", "")
        _replace_deployment_package(package)
        if body.create_pipeline:
            run = _create_deployment_pipeline_run(DeploymentPipelineRunIn(
                package_id=str(item.get("package_id") or ""),
                environment=str(item.get("environment") or "staging"),
                action="rollback" if item.get("environment") == "rollback" else "deploy",
                operator=actor,
                dry_run=False,
                approval_required=False,
                notes=body.note or f"published from approval {item.get('id')}",
            ))
            item["pipeline_run_id"] = run.get("id", "")
            item["pipeline"] = _public_pipeline_run(run)
    item["updated_at"] = _now()
    events.append(_approval_event(body.action, actor, body.note, {"status": item.get("status", "")}))
    item["events"] = events
    _replace_deployment_package_approval(item)
    _audit_change("system_ops.deployment_package_approval.action", str(item.get("profile") or ""), {"approval_id": item.get("id"), "action": body.action, "status": item.get("status")})
    return item


def _pipeline_event(kind: str, actor: str, message: str = "", extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": f"evt-{uuid.uuid4().hex[:10]}",
        "kind": kind,
        "actor": actor or "ops-admin",
        "message": message,
        "at": _now(),
        "extra": extra or {},
    }


def _pipeline_stage(stage_id: str, status: str, required: bool = True, params: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": stage_id,
        "label_key": f"page.settings.pipelineStage.{stage_id}",
        "status": status,
        "required": required,
        "params": params or {},
        "updated_at": _now(),
    }


def _deployment_pipeline_stages(action: str, environment: str, dry_run: bool, approval_required: bool) -> list[dict[str, Any]]:
    apply_required = not dry_run and action in {"deploy", "rollback"}
    approval_status = "pending" if approval_required and apply_required else "skipped"
    return [
        _pipeline_stage("package_validate", "completed", True, {"environment": environment}),
        _pipeline_stage("render_artifacts", "completed", True),
        _pipeline_stage("approval_gate", approval_status, approval_required and apply_required),
        _pipeline_stage("preflight_smoke", "pending" if apply_required else "skipped", apply_required),
        _pipeline_stage("deploy_apply", "pending" if apply_required else "skipped", apply_required),
        _pipeline_stage("post_deploy_verify", "pending" if apply_required else "skipped", apply_required),
        _pipeline_stage("rollback_plan", "pending" if action == "rollback" and apply_required else "skipped", action == "rollback" and apply_required),
    ]


def _deployment_pipeline_commands(item: dict[str, Any], environment: str, action: str, dry_run: bool) -> list[dict[str, Any]]:
    compose_path = ""
    for file in item.get("files", []) if isinstance(item.get("files"), list) else []:
        if isinstance(file, dict) and file.get("name") == "docker-compose.override.yml":
            compose_path = str(file.get("path") or "")
            break
    base = "docker compose -f docker-compose.yml"
    compose = f"{base} -f {compose_path}" if compose_path else base
    return [
        {"id": "validate", "intent": "validate", "command": f"{compose} config", "safe_to_copy": True},
        {
            "id": "apply",
            "intent": action,
            "command": f"{compose} up -d" if action != "rollback" else f"{compose} up -d --force-recreate",
            "safe_to_copy": not dry_run,
            "environment": environment,
        },
        {"id": "verify", "intent": "verify", "command": "sop status --json", "safe_to_copy": True},
    ]


def _profile_executor_settings(profile: str) -> dict[str, str]:
    row = _merge_profiles().get(profile, {})
    env = row.get("env", {}) if isinstance(row.get("env"), dict) else {}
    return {
        "mode": str(env.get("DEPLOY_EXECUTOR_MODE") or "simulated"),
        "executor": str(env.get("DEPLOY_EXECUTOR") or "managed-local"),
        "allow_apply": str(env.get("DEPLOY_EXECUTOR_ALLOW_APPLY") or os.getenv("SOP_DEPLOY_EXECUTOR_ALLOW_APPLY", "")).lower(),
    }


def _normalize_executor_supports(values: list[str]) -> list[str]:
    allowed = {"validate", "verify", "deploy", "rollback"}
    out = []
    for value in values:
        item = str(value or "").strip().lower()
        if item in allowed and item not in out:
            out.append(item)
    return out or ["validate", "verify"]


def _public_deployment_executor_target(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id", ""),
        "profile": item.get("profile", ""),
        "name": item.get("name", ""),
        "target_type": item.get("target_type", ""),
        "endpoint": item.get("endpoint", ""),
        "enabled": bool(item.get("enabled", False)),
        "supports": _normalize_executor_supports(item.get("supports", []) if isinstance(item.get("supports"), list) else []),
        "auth_ref": item.get("auth_ref", ""),
        "callback_secret_ref": item.get("callback_secret_ref", ""),
        "require_callback_signature": bool(item.get("require_callback_signature", False)),
        "callback_skew_seconds": int(item.get("callback_skew_seconds") or 300),
        "concurrency_limit": int(item.get("concurrency_limit") or 1),
        "timeout_seconds": int(item.get("timeout_seconds") or 120),
        "labels": item.get("labels", {}) if isinstance(item.get("labels"), dict) else {},
        "notes": item.get("notes", ""),
        "last_check": item.get("last_check", {}),
        "created_at": item.get("created_at", ""),
        "updated_at": item.get("updated_at", ""),
    }


def _target_as_deployment_executor(item: dict[str, Any]) -> dict[str, Any]:
    public = _public_deployment_executor_target(item)
    guards = ["no_inline_secret", "queued_external_execution", "apply_requires_flag", "pipeline_stage_gate", "audit_event"]
    if public.get("require_callback_signature"):
        guards.append("signed_callback")
    return {
        **public,
        "type": "external_orchestrator",
        "mode": public["target_type"],
        "guards": guards,
        "description": f"Queues governed pipeline commands to {public['target_type']} target {public['name']}. Secrets are referenced by auth_ref/callback_secret_ref and never stored inline.",
    }


def _deployment_executor_targets_for_profile(profile: str = "") -> list[dict[str, Any]]:
    safe_profile = _safe_name(profile) if profile.strip() else ""
    data = _load_deployment_executor_targets()
    rows = [item for item in data.get("items", []) if isinstance(item, dict)] if isinstance(data.get("items"), list) else []
    out = []
    for item in rows:
        item_profile = str(item.get("profile") or "")
        if safe_profile and item_profile not in {"", safe_profile}:
            continue
        out.append(_public_deployment_executor_target(item))
    return out


def _deployment_executor_catalog(profile: str = "") -> list[dict[str, Any]]:
    settings = _profile_executor_settings(profile) if profile else {"mode": "simulated", "executor": "managed-local", "allow_apply": ""}
    builtins = [
        {
            "id": "managed-local",
            "name": "Managed Local Executor",
            "type": "local_command",
            "mode": settings["mode"],
            "enabled": True,
            "supports": ["validate", "verify", "deploy", "rollback"],
            "guards": ["non_shell_exec", "timeout", "apply_requires_flag", "pipeline_stage_gate", "audit_event"],
            "description": "Runs pipeline commands through a controlled local adapter. Apply commands require explicit allow_apply and DEPLOY_EXECUTOR_ALLOW_APPLY.",
        },
        {
            "id": "dry-run",
            "name": "Dry-run Planner",
            "type": "planner",
            "mode": "dry_run",
            "enabled": True,
            "supports": ["validate", "verify", "deploy", "rollback"],
            "guards": ["no_side_effect", "command_plan_only", "audit_event"],
            "description": "Produces execution plans and evidence without mutating infrastructure.",
        },
    ]
    return [*builtins, *[_target_as_deployment_executor(item) for item in _deployment_executor_targets_for_profile(profile)]]


def _find_deployment_executor(executor_id: str, profile: str = "") -> dict[str, Any]:
    for item in _deployment_executor_catalog(profile):
        if item["id"] == executor_id:
            return item
    raise HTTPException(404, f"unknown deployment executor: {executor_id}")


def _find_deployment_executor_target(target_id: str) -> dict[str, Any]:
    data = _load_deployment_executor_targets()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    for item in items:
        if isinstance(item, dict) and item.get("id") == target_id:
            return item
    raise HTTPException(404, f"unknown deployment executor target: {target_id}")


def _replace_deployment_executor_target(target: dict[str, Any]) -> None:
    data = _load_deployment_executor_targets()
    items = [item for item in data.get("items", []) if isinstance(item, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [target if item.get("id") == target.get("id") else item for item in items]
    _save_deployment_executor_targets(data)


def _upsert_deployment_executor_target(body: DeploymentExecutorTargetIn, target_id: str = "") -> dict[str, Any]:
    safe_profile = _safe_name(body.profile) if body.profile.strip() else ""
    now = _now()
    existing = _find_deployment_executor_target(target_id) if target_id else {}
    item = {
        "id": target_id or f"exec-target-{uuid.uuid4().hex[:10]}",
        "profile": safe_profile,
        "name": body.name.strip(),
        "target_type": body.target_type,
        "endpoint": body.endpoint.strip(),
        "enabled": body.enabled,
        "supports": _normalize_executor_supports(body.supports),
        "auth_ref": body.auth_ref.strip(),
        "callback_secret_ref": body.callback_secret_ref.strip(),
        "require_callback_signature": bool(body.require_callback_signature),
        "callback_skew_seconds": body.callback_skew_seconds,
        "concurrency_limit": body.concurrency_limit,
        "timeout_seconds": body.timeout_seconds,
        "labels": {str(k): str(v) for k, v in body.labels.items()},
        "notes": body.notes,
        "created_at": existing.get("created_at") or now,
        "updated_at": now,
        "last_check": existing.get("last_check", {}) if isinstance(existing.get("last_check"), dict) else {},
    }
    data = _load_deployment_executor_targets()
    rows = [row for row in data.get("items", []) if isinstance(row, dict)] if isinstance(data.get("items"), list) else []
    if target_id:
        data["items"] = [item if row.get("id") == target_id else row for row in rows]
    else:
        data["items"] = [item, *rows][:200]
    _save_deployment_executor_targets(data)
    _audit_change("system_ops.deployment_executor_target.upsert", safe_profile, {"target_id": item["id"], "type": item["target_type"], "enabled": item["enabled"], "actor": body.actor})
    return item


def _deployment_executor_target_check(target: dict[str, Any], actor: str = "system", note: str = "") -> dict[str, Any]:
    endpoint = str(target.get("endpoint") or "").strip()
    target_type = str(target.get("target_type") or "")
    issues = []
    if not target.get("enabled"):
        issues.append("target_disabled")
    if target_type in {"webhook", "github_actions", "gitlab_ci", "jenkins"} and not endpoint.startswith(("http://", "https://")):
        issues.append("http_endpoint_required")
    if target_type in {"kubernetes_job", "temporal_workflow", "remote_agent"} and not endpoint:
        issues.append("endpoint_required")
    if not target.get("auth_ref"):
        issues.append("auth_ref_missing")
    if target.get("require_callback_signature") and not (target.get("callback_secret_ref") or os.getenv("SOP_DEPLOY_CALLBACK_SECRET")):
        issues.append("callback_secret_ref_missing")
    result = {
        "status": "ready" if not issues else "blocked",
        "issues": issues,
        "checked_at": _now(),
        "checked_by": actor or "system",
        "note": note,
        "mode": "configuration_check",
    }
    target["last_check"] = result
    target["updated_at"] = _now()
    _replace_deployment_executor_target(target)
    _audit_change("system_ops.deployment_executor_target.test", str(target.get("profile") or ""), {"target_id": target.get("id"), "status": result["status"], "issues": issues})
    return result


def _apply_deployment_executor_target_action(target: dict[str, Any], body: DeploymentExecutorTargetActionIn) -> dict[str, Any]:
    if body.action == "test":
        result = _deployment_executor_target_check(target, body.actor, body.note)
        return {"target": target, "result": result}
    if body.action == "delete":
        data = _load_deployment_executor_targets()
        rows = [row for row in data.get("items", []) if isinstance(row, dict)] if isinstance(data.get("items"), list) else []
        data["items"] = [row for row in rows if row.get("id") != target.get("id")]
        _save_deployment_executor_targets(data)
        _audit_change("system_ops.deployment_executor_target.delete", str(target.get("profile") or ""), {"target_id": target.get("id"), "actor": body.actor})
        return {"target": target, "result": {"status": "deleted", "at": _now()}}
    target["enabled"] = body.action == "enable"
    target["updated_at"] = _now()
    _replace_deployment_executor_target(target)
    _audit_change("system_ops.deployment_executor_target.action", str(target.get("profile") or ""), {"target_id": target.get("id"), "action": body.action, "actor": body.actor})
    return {"target": target, "result": {"status": "enabled" if target["enabled"] else "disabled", "at": _now()}}


def _pipeline_status_from_stages(stages: list[dict[str, Any]]) -> str:
    statuses = {str(stage.get("status")) for stage in stages if isinstance(stage, dict)}
    if "failed" in statuses:
        return "failed"
    if "running" in statuses:
        return "running"
    if "cancelled" in statuses:
        return "cancelled"
    if "pending" in statuses:
        return "awaiting_approval" if any(stage.get("id") == "approval_gate" and stage.get("status") == "pending" for stage in stages) else "ready"
    return "succeeded"


def _public_pipeline_run(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id", ""),
        "package_id": item.get("package_id", ""),
        "profile": item.get("profile", ""),
        "version": item.get("version", ""),
        "channel": item.get("channel", ""),
        "environment": item.get("environment", ""),
        "action": item.get("action", ""),
        "dry_run": bool(item.get("dry_run", False)),
        "approval_required": bool(item.get("approval_required", False)),
        "status": item.get("status", ""),
        "operator": item.get("operator", ""),
        "notes": item.get("notes", ""),
        "created_at": item.get("created_at", ""),
        "updated_at": item.get("updated_at", ""),
        "stage_total": len(item.get("stages", [])) if isinstance(item.get("stages"), list) else 0,
        "stage_done": len([stage for stage in item.get("stages", []) if isinstance(stage, dict) and stage.get("status") in {"completed", "skipped"}]) if isinstance(item.get("stages"), list) else 0,
        "executor_id": item.get("executor_id", ""),
        "execution_count": len(item.get("executions", [])) if isinstance(item.get("executions"), list) else 0,
        "last_execution_status": item.get("last_execution_status", ""),
        "self_heal_finding_count": len(item.get("self_heal", {}).get("findings", [])) if isinstance(item.get("self_heal"), dict) and isinstance(item.get("self_heal", {}).get("findings"), list) else 0,
        "self_heal_task_count": len(item.get("self_heal_task_ids", [])) if isinstance(item.get("self_heal_task_ids"), list) else 0,
    }


def _create_deployment_pipeline_run(body: DeploymentPipelineRunIn) -> dict[str, Any]:
    package_id = body.package_id.strip()
    profile = _safe_name(body.profile) if body.profile.strip() else ""
    item = _find_deployment_package(package_id) if package_id else _latest_deployment_package_for_profile(profile)
    package_id = str(item.get("id") or "")
    profile = str(item.get("profile") or profile)
    action = body.action
    dry_run = bool(body.dry_run or action == "preview")
    approval_required = bool(body.approval_required)
    stages = _deployment_pipeline_stages(action, body.environment, dry_run, approval_required)
    status = "preview" if dry_run else _pipeline_status_from_stages(stages)
    run_id = f"deploy-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"
    now = _now()
    run = {
        "id": run_id,
        "package_id": package_id,
        "profile": profile,
        "version": item.get("version", ""),
        "channel": item.get("channel", ""),
        "environment": body.environment,
        "action": action,
        "dry_run": dry_run,
        "approval_required": approval_required,
        "status": status,
        "operator": body.operator or "ops-admin",
        "notes": body.notes,
        "created_at": now,
        "updated_at": now,
        "stages": stages,
        "events": [
            _pipeline_event("created", body.operator, body.notes, {"dry_run": dry_run, "action": action}),
            _pipeline_event("preview_ready" if dry_run else "awaiting_control", "system", "", {"status": status}),
        ],
        "commands": _deployment_pipeline_commands(item, body.environment, action, dry_run),
        "risk": {
            "level": "low" if dry_run else ("high" if body.environment == "production" else "medium"),
            "approval_required": approval_required,
            "guards": ["package_checksum", "masked_env_preview", "stage_state_machine", "audit_event"],
        },
        "agent_consumption": {
            "surface": "settings.profiles.deployment_pipeline",
            "api": "/api/v1/system/ops/deployment-pipelines",
            "purpose": "Create governed deployment pipeline previews and controlled rollout records from versioned deployment packages.",
        },
    }
    data = _load_deployment_pipeline_runs()
    items = [row for row in data.get("items", []) if isinstance(row, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [run, *items][:200]
    _save_deployment_pipeline_runs(data)
    _audit_change("system_ops.deployment_pipeline.create", profile, {"run_id": run_id, "package_id": package_id, "status": status})
    return run


def _find_deployment_pipeline_run(run_id: str) -> dict[str, Any]:
    data = _load_deployment_pipeline_runs()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    for item in items:
        if isinstance(item, dict) and item.get("id") == run_id:
            return item
    raise HTTPException(404, f"unknown deployment pipeline run: {run_id}")


def _replace_deployment_pipeline_run(run: dict[str, Any]) -> None:
    data = _load_deployment_pipeline_runs()
    items = [item for item in data.get("items", []) if isinstance(item, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [run if item.get("id") == run.get("id") else item for item in items]
    _save_deployment_pipeline_runs(data)


def _set_pipeline_stage(stages: list[dict[str, Any]], stage_id: str, status: str) -> None:
    for stage in stages:
        if isinstance(stage, dict) and stage.get("id") == stage_id:
            stage["status"] = status
            stage["updated_at"] = _now()
            return


def _first_active_pipeline_stage(stages: list[dict[str, Any]]) -> dict[str, Any] | None:
    for stage in stages:
        if isinstance(stage, dict) and stage.get("status") in {"pending", "running"}:
            return stage
    return None


def _pipeline_command_for_execution(run: dict[str, Any], body: DeploymentPipelineExecuteIn) -> dict[str, Any]:
    commands = run.get("commands", []) if isinstance(run.get("commands"), list) else []
    if body.command_id:
        for command in commands:
            if isinstance(command, dict) and command.get("id") == body.command_id:
                return command
        raise HTTPException(404, f"unknown pipeline command: {body.command_id}")
    for command in commands:
        if not isinstance(command, dict):
            continue
        if body.stage_id == "deploy_apply" and command.get("id") == "apply":
            return command
        if body.stage_id == "preflight_smoke" and command.get("id") == "validate":
            return command
        if body.stage_id == "post_deploy_verify" and command.get("id") == "verify":
            return command
    for command in commands:
        if isinstance(command, dict):
            return command
    raise HTTPException(409, "pipeline run has no executable commands")


def _pipeline_stage_for_command(command: dict[str, Any], fallback: str = "") -> str:
    if fallback:
        return fallback
    command_id = str(command.get("id") or "")
    if command_id == "validate":
        return "preflight_smoke"
    if command_id == "apply":
        return "deploy_apply"
    if command_id == "verify":
        return "post_deploy_verify"
    return "deploy_apply"


def _execute_pipeline_command(run: dict[str, Any], executor: dict[str, Any], command: dict[str, Any], body: DeploymentPipelineExecuteIn) -> dict[str, Any]:
    command_text = str(command.get("command") or "")
    intent = str(command.get("intent") or command.get("id") or "")
    dry_run = bool(body.dry_run or executor.get("id") == "dry-run" or run.get("dry_run"))
    apply_intent = intent in {"deploy", "rollback"} or str(command.get("id")) == "apply"
    settings = _profile_executor_settings(str(run.get("profile") or ""))
    apply_allowed = body.allow_apply and settings["allow_apply"] in {"1", "true", "yes", "on"}
    result = {
        "id": f"exec-{uuid.uuid4().hex[:10]}",
        "executor_id": executor.get("id"),
        "executor_type": executor.get("type"),
        "executor_mode": executor.get("mode"),
        "command_id": command.get("id"),
        "intent": intent,
        "command": command_text,
        "dry_run": dry_run,
        "status": "planned",
        "started_at": _now(),
        "finished_at": "",
        "exit_code": None,
        "stdout": "",
        "stderr": "",
        "evidence_url": body.evidence_url,
        "guards": executor.get("guards", []),
    }
    if dry_run:
        result.update({"status": "planned", "stdout": f"dry-run plan for {command_text}"})
    elif apply_intent and not apply_allowed:
        result.update({"status": "blocked", "stderr": "apply command requires allow_apply=true and DEPLOY_EXECUTOR_ALLOW_APPLY=true"})
    elif executor.get("type") == "external_orchestrator":
        supported = set(executor.get("supports", []) if isinstance(executor.get("supports"), list) else [])
        if not executor.get("enabled"):
            result.update({"status": "blocked", "stderr": "external executor target is disabled"})
        elif intent not in supported and str(command.get("id") or "") not in supported:
            result.update({"status": "blocked", "stderr": f"external executor target does not support intent: {intent}"})
        else:
            request_id = f"ext-{uuid.uuid4().hex[:10]}"
            result.update({
                "status": "queued",
                "stdout": f"queued external orchestration request {request_id} for {executor.get('target_type')}",
                "external_request": {
                    "id": request_id,
                    "target_id": executor.get("id"),
                    "target_type": executor.get("target_type"),
                    "endpoint": executor.get("endpoint"),
                    "auth_ref": executor.get("auth_ref"),
                    "profile": run.get("profile"),
                    "pipeline_run_id": run.get("id"),
                    "package_id": run.get("package_id"),
                    "environment": run.get("environment"),
                    "command_id": command.get("id"),
                    "command": command_text,
                    "queued_at": _now(),
                    "timeout_seconds": executor.get("timeout_seconds"),
                    "callback": {
                        "requires_signature": bool(executor.get("require_callback_signature")),
                        "secret_ref": executor.get("callback_secret_ref") or ("env://SOP_DEPLOY_CALLBACK_SECRET" if executor.get("require_callback_signature") else ""),
                        "algorithm": "hmac-sha256",
                        "timestamp_skew_seconds": int(executor.get("callback_skew_seconds") or 300),
                    },
                },
            })
    elif executor.get("type") != "local_command":
        result.update({"status": "planned", "stdout": "executor does not perform local side effects"})
    else:
        try:
            args = shlex.split(command_text)
            if not args:
                raise ValueError("empty command")
            completed = subprocess.run(args, capture_output=True, text=True, timeout=body.timeout_seconds, check=False)
            result.update({
                "status": "succeeded" if completed.returncode == 0 else "failed",
                "exit_code": completed.returncode,
                "stdout": completed.stdout[-4000:],
                "stderr": completed.stderr[-4000:],
            })
        except subprocess.TimeoutExpired as exc:
            result.update({"status": "failed", "stderr": f"command timed out after {body.timeout_seconds}s: {exc}"})
        except Exception as exc:
            result.update({"status": "failed", "stderr": str(exc)})
    result["finished_at"] = _now()
    return result


def _apply_deployment_pipeline_execute(run: dict[str, Any], body: DeploymentPipelineExecuteIn) -> dict[str, Any]:
    if run.get("status") in {"succeeded", "failed", "cancelled"}:
        raise HTTPException(409, f"pipeline run already finalized: {run.get('status')}")
    executor = _find_deployment_executor(body.executor_id, str(run.get("profile") or ""))
    command = _pipeline_command_for_execution(run, body)
    stage_id = _pipeline_stage_for_command(command, body.stage_id)
    stages = run.get("stages", []) if isinstance(run.get("stages"), list) else []
    if any(stage.get("id") == "approval_gate" and stage.get("status") == "pending" for stage in stages if isinstance(stage, dict)):
        raise HTTPException(409, "pipeline approval gate is still pending")
    if run.get("status") == "preview" and not body.dry_run:
        raise HTTPException(409, "preview pipeline cannot execute with side effects")
    _set_pipeline_stage(stages, stage_id, "running")
    run["stages"] = stages
    run["status"] = "running"
    result = _execute_pipeline_command(run, executor, command, body)
    if result["status"] in {"succeeded", "planned"}:
        _set_pipeline_stage(stages, stage_id, "completed" if not body.dry_run else "skipped")
    elif result["status"] == "queued":
        _set_pipeline_stage(stages, stage_id, "running")
        run["status"] = "running"
    elif result["status"] == "blocked":
        _set_pipeline_stage(stages, stage_id, "pending")
        run["status"] = "ready"
    else:
        _set_pipeline_stage(stages, stage_id, "failed")
        run["status"] = "failed"
    if result["status"] in {"succeeded", "planned"}:
        run["status"] = _pipeline_status_from_stages(stages)
        if run["status"] == "ready" and all(stage.get("status") in {"completed", "skipped"} for stage in stages if isinstance(stage, dict) and stage.get("id") != "rollback_plan"):
            run["status"] = "succeeded"
    run["updated_at"] = _now()
    run["executor_id"] = executor.get("id")
    run["last_execution_status"] = result["status"]
    executions = run.get("executions", []) if isinstance(run.get("executions"), list) else []
    executions.append(result)
    run["executions"] = executions[-100:]
    events = run.get("events", []) if isinstance(run.get("events"), list) else []
    events.append(_pipeline_event("execute", body.actor, body.note, {"executor_id": executor.get("id"), "command_id": command.get("id"), "stage_id": stage_id, "status": result["status"]}))
    run["events"] = events
    _replace_deployment_pipeline_run(run)
    _audit_change("system_ops.deployment_pipeline.execute", str(run.get("profile") or ""), {"run_id": run.get("id"), "executor_id": executor.get("id"), "command_id": command.get("id"), "status": result["status"]})
    return {"run": run, "result": result, "executor": executor}


def _find_pipeline_execution(run: dict[str, Any], execution_id: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    executions = run.get("executions", []) if isinstance(run.get("executions"), list) else []
    for execution in executions:
        if not isinstance(execution, dict):
            continue
        external_request = execution.get("external_request", {}) if isinstance(execution.get("external_request"), dict) else {}
        if execution.get("id") == execution_id or external_request.get("id") == execution_id:
            return executions, execution
    raise HTTPException(404, f"unknown pipeline execution: {execution_id}")


def _callback_body_dump(body: DeploymentPipelineExecutionCallbackIn) -> dict[str, Any]:
    if hasattr(body, "model_dump"):
        return body.model_dump()
    return body.dict()


def _deployment_pipeline_callback_signature_payload(run_id: str, execution_id: str, body: DeploymentPipelineExecutionCallbackIn) -> str:
    raw = _callback_body_dump(body)
    signed = {
        key: raw.get(key)
        for key in sorted(raw)
        if key not in {"signature"}
    }
    canonical = json.dumps(signed, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return f"{run_id}.{execution_id}.{canonical}"


def _resolve_callback_secret(secret_ref: str) -> str:
    ref = secret_ref.strip()
    if ref.startswith("env://"):
        return os.getenv(ref.removeprefix("env://"), "")
    if ref.startswith("env:"):
        return os.getenv(ref.removeprefix("env:"), "")
    return os.getenv("SOP_DEPLOY_CALLBACK_SECRET", "")


def _verify_deployment_pipeline_callback_signature(run: dict[str, Any], execution_id: str, execution: dict[str, Any], body: DeploymentPipelineExecutionCallbackIn) -> dict[str, Any]:
    external_request = execution.get("external_request", {}) if isinstance(execution.get("external_request"), dict) else {}
    callback_contract = external_request.get("callback", {}) if isinstance(external_request.get("callback"), dict) else {}
    target_id = str(external_request.get("target_id") or execution.get("executor_id") or "")
    target: dict[str, Any] = {}
    if target_id:
        try:
            target = _find_deployment_executor_target(target_id)
        except HTTPException:
            target = {}
    required = bool(target.get("require_callback_signature", callback_contract.get("requires_signature", False)))
    if not required:
        return {"required": False, "status": "skipped", "algorithm": "hmac-sha256"}
    timestamp = body.timestamp
    nonce = body.nonce.strip()
    signature = body.signature.strip()
    if timestamp is None or not nonce or not signature:
        raise HTTPException(401, "callback signature, timestamp and nonce are required")
    skew_seconds = int(target.get("callback_skew_seconds") or callback_contract.get("timestamp_skew_seconds") or 300)
    if abs(int(time.time()) - int(timestamp)) > skew_seconds:
        raise HTTPException(401, "callback timestamp outside allowed skew")
    secret_ref = str(target.get("callback_secret_ref") or callback_contract.get("secret_ref") or "env://SOP_DEPLOY_CALLBACK_SECRET")
    secret = _resolve_callback_secret(secret_ref)
    if not secret:
        raise HTTPException(503, f"callback secret is not resolvable: {secret_ref}")
    payload = _deployment_pipeline_callback_signature_payload(str(run.get("id") or ""), execution_id, body)
    expected = "sha256=" + hmac.new(secret.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    normalized = signature if signature.startswith("sha256=") else f"sha256={signature}"
    if not hmac.compare_digest(expected, normalized):
        raise HTTPException(401, "invalid callback signature")
    return {
        "required": True,
        "status": "verified",
        "algorithm": "hmac-sha256",
        "secret_ref": secret_ref,
        "timestamp": timestamp,
        "nonce": nonce,
        "verified_at": _now(),
    }


def _apply_deployment_pipeline_execution_callback(run: dict[str, Any], execution_id: str, body: DeploymentPipelineExecutionCallbackIn) -> dict[str, Any]:
    executions, execution = _find_pipeline_execution(run, execution_id)
    signature_check = _verify_deployment_pipeline_callback_signature(run, execution_id, execution, body)
    if execution.get("status") in {"succeeded", "failed", "blocked", "cancelled"} and body.status not in {execution.get("status"), "running"}:
        raise HTTPException(409, f"execution already finalized: {execution.get('status')}")
    now = _now()
    previous_status = str(execution.get("status") or "")
    execution["status"] = body.status
    execution["callback_at"] = now
    execution["callback_actor"] = body.actor
    execution["external_run_id"] = body.external_run_id or execution.get("external_run_id", "")
    if body.evidence_url:
        execution["evidence_url"] = body.evidence_url
    if body.stdout:
        execution["stdout"] = body.stdout[-4000:]
    if body.stderr:
        execution["stderr"] = body.stderr[-4000:]
    if body.exit_code is not None:
        execution["exit_code"] = body.exit_code
    if body.status in {"succeeded", "failed", "blocked", "cancelled"}:
        execution["finished_at"] = now
    execution["callback_signature"] = signature_check
    external_request = execution.get("external_request", {}) if isinstance(execution.get("external_request"), dict) else {}
    external_request.update({
        "status": body.status,
        "external_run_id": body.external_run_id or external_request.get("external_run_id", ""),
        "last_callback_at": now,
        "metadata": body.metadata,
        "callback_signature": signature_check,
    })
    execution["external_request"] = external_request

    command = {"id": execution.get("command_id"), "intent": execution.get("intent")}
    stage_id = _pipeline_stage_for_command(command)
    stages = run.get("stages", []) if isinstance(run.get("stages"), list) else []
    if body.status in {"queued", "running"}:
        _set_pipeline_stage(stages, stage_id, "running")
        run["status"] = "running"
    elif body.status == "succeeded":
        _set_pipeline_stage(stages, stage_id, "completed")
        run["status"] = _pipeline_status_from_stages(stages)
        if run["status"] == "ready" and all(stage.get("status") in {"completed", "skipped"} for stage in stages if isinstance(stage, dict) and stage.get("id") != "rollback_plan"):
            run["status"] = "succeeded"
    elif body.status == "blocked":
        _set_pipeline_stage(stages, stage_id, "pending")
        run["status"] = "ready"
    elif body.status == "cancelled":
        _set_pipeline_stage(stages, stage_id, "cancelled")
        run["status"] = "cancelled"
    else:
        _set_pipeline_stage(stages, stage_id, "failed")
        run["status"] = "failed"

    run["stages"] = stages
    run["executions"] = executions[-100:]
    run["last_execution_status"] = body.status
    run["updated_at"] = now
    events = run.get("events", []) if isinstance(run.get("events"), list) else []
    events.append(_pipeline_event("external_callback", body.actor, body.note, {"execution_id": execution.get("id"), "external_request_id": external_request.get("id"), "previous_status": previous_status, "status": body.status, "stage_id": stage_id, "signature_status": signature_check.get("status")}))
    run["events"] = events
    _replace_deployment_pipeline_run(run)
    _audit_change("system_ops.deployment_pipeline.execution_callback", str(run.get("profile") or ""), {"run_id": run.get("id"), "execution_id": execution.get("id"), "status": body.status, "actor": body.actor})
    return {"run": run, "result": execution}


def _pipeline_remediation_findings(run: dict[str, Any], include_low: bool = False) -> list[dict[str, Any]]:
    findings: list[dict[str, Any]] = []
    status = str(run.get("status") or "")
    if status in {"failed", "cancelled"}:
        findings.append({
            "id": "pipeline_terminal_state",
            "severity": "high" if status == "failed" else "medium",
            "title": f"Pipeline is {status}",
            "recommendation": "Review failed stage and create a guarded retry or rollback path before further promotion.",
            "params": {"status": status},
        })
    elif status in {"awaiting_approval", "ready", "running"}:
        findings.append({
            "id": "pipeline_incomplete_state",
            "severity": "medium",
            "title": f"Pipeline is still {status}",
            "recommendation": "Complete the pending control gate or capture evidence before marking the release healthy.",
            "params": {"status": status},
        })
    stages = run.get("stages", []) if isinstance(run.get("stages"), list) else []
    for stage in stages:
        if not isinstance(stage, dict):
            continue
        stage_status = str(stage.get("status") or "")
        if stage_status == "failed":
            findings.append({
                "id": f"stage_failed_{stage.get('id')}",
                "severity": "high",
                "title": f"Stage failed: {stage.get('id')}",
                "recommendation": "Capture stage logs, rerun the matching executor command in dry-run mode, then decide retry or rollback.",
                "params": {"stage_id": stage.get("id"), "updated_at": stage.get("updated_at")},
            })
        elif stage_status == "pending" and stage.get("required") and include_low:
            findings.append({
                "id": f"stage_pending_{stage.get('id')}",
                "severity": "low",
                "title": f"Required stage is pending: {stage.get('id')}",
                "recommendation": "Assign an owner and finish the pending gate before release closure.",
                "params": {"stage_id": stage.get("id")},
            })
    executions = run.get("executions", []) if isinstance(run.get("executions"), list) else []
    for execution in executions[-10:]:
        if not isinstance(execution, dict):
            continue
        execution_status = str(execution.get("status") or "")
        if execution_status in {"failed", "blocked"}:
            findings.append({
                "id": f"execution_{execution_status}_{execution.get('id')}",
                "severity": "high" if execution_status == "failed" else "medium",
                "title": f"Executor {execution_status}: {execution.get('command_id')}",
                "recommendation": "Inspect executor stdout/stderr, verify apply guard configuration, and rerun only after approval.",
                "params": {
                    "execution_id": execution.get("id"),
                    "command_id": execution.get("command_id"),
                    "stderr": str(execution.get("stderr") or "")[:500],
                },
            })
    if not executions and include_low:
        findings.append({
            "id": "execution_missing",
            "severity": "low",
            "title": "No executor evidence captured",
            "recommendation": "Run a dry-run executor plan or attach external execution evidence before archiving.",
            "params": {},
        })
    severity_rank = {"high": 0, "medium": 1, "low": 2}
    return sorted(findings, key=lambda item: (severity_rank.get(str(item.get("severity")), 3), str(item.get("id"))))[:20]


def _pipeline_remediation_steps(run: dict[str, Any], findings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    steps = [
        {"id": "capture_snapshot", "title": "Capture deployment pipeline snapshot", "status": "completed", "owner": "ReleaseOps", "api": f"/api/v1/system/ops/deployment-pipelines/{run.get('id')}", "evidence": {"status": run.get("status"), "package_id": run.get("package_id")}},
        {"id": "dry_run_executor", "title": "Run executor dry-run plan for the affected command", "status": "pending", "owner": "ReleaseOps", "api": f"/api/v1/system/ops/deployment-pipelines/{run.get('id')}/execute", "evidence": {"executor": "dry-run"}},
    ]
    for finding in findings:
        steps.append({
            "id": f"remediate_{finding.get('id')}",
            "title": str(finding.get("recommendation") or finding.get("title") or "Remediate pipeline finding"),
            "status": "pending",
            "owner": "ReleaseOps",
            "severity": finding.get("severity"),
            "evidence": finding.get("params", {}),
        })
    steps.extend([
        {"id": "decide_retry_or_rollback", "title": "Decide retry, rollback, or cancellation path", "status": "pending", "owner": "ReleaseOps", "api": "/api/v1/system/ops/deployment-rollback-runbooks"},
        {"id": "archive_execution_evidence", "title": "Archive remediation evidence in cross-environment execution audit", "status": "pending", "owner": "ReleaseOps", "api": "/api/v1/system/ops/deployment-execution-audits"},
    ])
    return steps[:20]


def _pipeline_remediation_task_plan(run: dict[str, Any], findings: list[dict[str, Any]], body: DeploymentPipelineRemediationIn) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    for finding in findings:
        severity = str(finding.get("severity") or "medium")
        if severity == "low" and not body.include_low:
            continue
        priority = "P0" if severity == "high" and run.get("environment") == "production" else (body.priority if severity in {"high", "medium"} else "P2")
        tasks.append({
            "title": f"[Pipeline Self-Heal] {finding.get('title') or finding.get('id')} ({run.get('environment')})"[:200],
            "description": "\n".join([
                f"Pipeline: {run.get('id')}",
                f"Package: {run.get('package_id')}",
                f"Profile: {run.get('profile')}",
                f"Action/status: {run.get('action')} / {run.get('status')}",
                f"Finding: {finding.get('id')} severity={severity}",
                f"Recommendation: {finding.get('recommendation')}",
                f"Params: {json.dumps(finding.get('params', {}), ensure_ascii=False, sort_keys=True)}",
                body.note,
            ]),
            "priority": priority if priority in {"P0", "P1", "P2", "P3"} else "P1",
            "estimate": "S" if severity == "low" else "M",
            "owner_id": body.owner_id,
            "dev_tool": body.dev_tool,
            "source": "system_ops.pipeline_self_heal",
            "source_report_id": str(run.get("id") or ""),
            "source_report_title": f"Deployment pipeline self-heal {run.get('environment')}/{run.get('action')}",
            "artifact_path": "docs/architecture/HERMES_PLATFORM_LATEST_ARCHITECTURE.md",
        })
    return tasks[:20]


def _apply_deployment_pipeline_remediation(run: dict[str, Any], body: DeploymentPipelineRemediationIn) -> dict[str, Any]:
    findings = _pipeline_remediation_findings(run, include_low=body.include_low)
    steps = _pipeline_remediation_steps(run, findings)
    planned = _pipeline_remediation_task_plan(run, findings, body)
    result: dict[str, Any] = {
        "summary": {
            "findings": len(findings),
            "high": len([item for item in findings if item.get("severity") == "high"]),
            "medium": len([item for item in findings if item.get("severity") == "medium"]),
            "low": len([item for item in findings if item.get("severity") == "low"]),
            "planned_tasks": len(planned),
        },
        "findings": findings,
        "runbook": {"steps": steps, "step_total": len(steps)},
        "planned": planned,
        "created": [],
        "dry_run": body.dry_run,
    }
    if not body.dry_run:
        try:
            from sop_manager.routers.tasks import TaskCreate, create_task

            for task in planned:
                created = create_task(TaskCreate(**task))
                result["created"].append(created)
            task_ids = [str(item.get("id") or "") for item in result["created"] if isinstance(item, dict) and item.get("id")]
            run["self_heal_task_ids"] = [*(run.get("self_heal_task_ids", []) if isinstance(run.get("self_heal_task_ids"), list) else []), *task_ids]
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(503, f"create pipeline self-heal tasks failed: {exc}") from exc
    run["self_heal"] = {
        "last_run_at": _now(),
        "last_actor": body.actor,
        "last_dry_run": body.dry_run,
        "summary": result["summary"],
        "findings": findings,
        "runbook": result["runbook"],
    }
    run["updated_at"] = _now()
    events = run.get("events", []) if isinstance(run.get("events"), list) else []
    events.append(_pipeline_event("self_heal", body.actor, body.note, {"dry_run": body.dry_run, "findings": len(findings), "created": len(result["created"])}))
    run["events"] = events
    _replace_deployment_pipeline_run(run)
    _audit_change("system_ops.deployment_pipeline.self_heal", str(run.get("profile") or ""), {"run_id": run.get("id"), "dry_run": body.dry_run, "findings": len(findings), "created": len(result["created"])})
    return {"run": run, "result": result}


def _apply_deployment_pipeline_action(run: dict[str, Any], body: DeploymentPipelineActionIn) -> dict[str, Any]:
    stages = run.get("stages", []) if isinstance(run.get("stages"), list) else []
    events = run.get("events", []) if isinstance(run.get("events"), list) else []
    actor = body.actor or "ops-admin"
    action = body.action
    if run.get("status") in {"succeeded", "failed", "cancelled"} and action not in {"mark_success", "mark_failed"}:
        raise HTTPException(409, f"pipeline run already finalized: {run.get('status')}")
    if action == "approve":
        if run.get("status") != "awaiting_approval":
            raise HTTPException(409, "pipeline run is not awaiting approval")
        _set_pipeline_stage(stages, "approval_gate", "completed")
        run["status"] = _pipeline_status_from_stages(stages)
    elif action == "start":
        if run.get("status") not in {"ready", "awaiting_approval"}:
            raise HTTPException(409, f"pipeline run cannot start from status: {run.get('status')}")
        if any(stage.get("id") == "approval_gate" and stage.get("status") == "pending" for stage in stages if isinstance(stage, dict)):
            raise HTTPException(409, "pipeline approval gate is still pending")
        _set_pipeline_stage(stages, "preflight_smoke", "completed")
        _set_pipeline_stage(stages, "deploy_apply", "running")
        run["status"] = "running"
    elif action == "mark_success":
        for stage in stages:
            if isinstance(stage, dict) and stage.get("status") in {"pending", "running"}:
                stage["status"] = "completed"
                stage["updated_at"] = _now()
        run["status"] = "succeeded"
    elif action == "mark_failed":
        stage = _first_active_pipeline_stage(stages)
        if stage:
            stage["status"] = "failed"
            stage["updated_at"] = _now()
        run["status"] = "failed"
    elif action == "cancel":
        for stage in stages:
            if isinstance(stage, dict) and stage.get("status") in {"pending", "running"}:
                stage["status"] = "cancelled"
                stage["updated_at"] = _now()
        run["status"] = "cancelled"
    run["stages"] = stages
    run["updated_at"] = _now()
    events.append(_pipeline_event(action, actor, body.message, {"status": run.get("status", "")}))
    run["events"] = events
    _replace_deployment_pipeline_run(run)
    _audit_change("system_ops.deployment_pipeline.action", str(run.get("profile") or ""), {"run_id": run.get("id"), "action": action, "status": run.get("status")})
    return run


def _rollback_drill_event(kind: str, actor: str, note: str = "", extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": f"evt-{uuid.uuid4().hex[:10]}",
        "kind": kind,
        "actor": actor or "ops-admin",
        "note": note,
        "at": _now(),
        "extra": extra or {},
    }


def _rollback_drill_check(check_id: str, status: str, required: bool = True, params: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": check_id,
        "label_key": f"page.settings.rollbackDrillCheck.{check_id}",
        "status": status,
        "required": required,
        "params": params or {},
        "updated_at": _now(),
    }


def _rollback_drill_checks(package: dict[str, Any], scenario: str) -> list[dict[str, Any]]:
    return [
        _rollback_drill_check("package_checksum", "passed", True, {"checksum": package.get("checksum", "")}),
        _rollback_drill_check("rollback_artifact", "pending", True, {"package_dir": package.get("dir", "")}),
        _rollback_drill_check("approval_route", "pending", True, {"scenario": scenario}),
        _rollback_drill_check("rollback_pipeline_preview", "pending", True),
        _rollback_drill_check("recovery_verification", "pending", True),
    ]


def _rollback_drill_check_counts(checks: list[dict[str, Any]]) -> dict[str, int]:
    rows = [check for check in checks if isinstance(check, dict)]
    return {
        "check_total": len(rows),
        "check_passed": len([check for check in rows if check.get("status") == "passed"]),
        "check_failed": len([check for check in rows if check.get("status") == "failed"]),
    }


def _public_rollback_drill(item: dict[str, Any]) -> dict[str, Any]:
    checks = item.get("checks", []) if isinstance(item.get("checks"), list) else []
    counts = _rollback_drill_check_counts(checks)
    return {
        "id": item.get("id", ""),
        "package_id": item.get("package_id", ""),
        "profile": item.get("profile", ""),
        "version": item.get("version", ""),
        "channel": item.get("channel", ""),
        "name": item.get("name", ""),
        "environment": item.get("environment", ""),
        "scenario": item.get("scenario", ""),
        "status": item.get("status", ""),
        "operator": item.get("operator", ""),
        "approval_required": bool(item.get("approval_required", False)),
        "preview_pipeline_run_id": item.get("preview_pipeline_run_id", ""),
        "rollback_pipeline_run_id": item.get("rollback_pipeline_run_id", ""),
        "created_at": item.get("created_at", ""),
        "updated_at": item.get("updated_at", ""),
        "notes": item.get("notes", ""),
        **counts,
    }


def _find_deployment_rollback_drill(drill_id: str) -> dict[str, Any]:
    data = _load_deployment_rollback_drills()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    for item in items:
        if isinstance(item, dict) and item.get("id") == drill_id:
            return item
    raise HTTPException(404, f"unknown deployment rollback drill: {drill_id}")


def _replace_deployment_rollback_drill(item: dict[str, Any]) -> None:
    data = _load_deployment_rollback_drills()
    items = [row for row in data.get("items", []) if isinstance(row, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [item if row.get("id") == item.get("id") else row for row in items]
    _save_deployment_rollback_drills(data)


def _set_rollback_drill_check(checks: list[dict[str, Any]], check_id: str, status: str, note: str = "") -> dict[str, Any]:
    target = None
    if check_id:
        target = next((check for check in checks if isinstance(check, dict) and check.get("id") == check_id), None)
        if target is None:
            raise HTTPException(404, f"unknown rollback drill check: {check_id}")
    else:
        target = next((check for check in checks if isinstance(check, dict) and check.get("status") in {"pending", "failed"}), None)
    if target is None:
        raise HTTPException(409, "rollback drill has no pending check")
    target["status"] = status
    target["note"] = note
    target["updated_at"] = _now()
    return target


def _create_rollback_pipeline_for_drill(drill: dict[str, Any], *, dry_run: bool, actor: str, note: str) -> dict[str, Any]:
    return _create_deployment_pipeline_run(DeploymentPipelineRunIn(
        package_id=str(drill.get("package_id") or ""),
        environment=str(drill.get("environment") or "rollback") if dry_run else "rollback",
        action="rollback",
        operator=actor or str(drill.get("operator") or "release-manager"),
        dry_run=dry_run,
        approval_required=bool(drill.get("approval_required", True)) and not dry_run,
        notes=note or f"rollback drill {drill.get('id')}",
    ))


def _create_deployment_rollback_drill(body: DeploymentRollbackDrillIn) -> dict[str, Any]:
    package_id = body.package_id.strip()
    profile = _safe_name(body.profile) if body.profile.strip() else ""
    package = _find_deployment_package(package_id) if package_id else _latest_deployment_package_for_profile(profile)
    drill_id = f"rollback-drill-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"
    now = _now()
    row = {
        "id": drill_id,
        "package_id": str(package.get("id") or body.package_id),
        "profile": str(package.get("profile") or profile),
        "version": str(package.get("version") or ""),
        "channel": str(package.get("channel") or ""),
        "name": body.name.strip() or "release rollback drill",
        "environment": body.environment,
        "scenario": body.scenario,
        "status": "draft",
        "operator": body.operator or "release-manager",
        "approval_required": body.approval_required,
        "notes": body.notes,
        "package_checksum": package.get("checksum", ""),
        "preview_pipeline_run_id": "",
        "rollback_pipeline_run_id": "",
        "created_at": now,
        "updated_at": now,
        "checks": _rollback_drill_checks(package, body.scenario),
        "events": [_rollback_drill_event("created", body.operator, body.notes, {"scenario": body.scenario})],
        "agent_consumption": {
            "surface": "settings.profiles.rollback_drill",
            "api": "/api/v1/system/ops/deployment-rollback-drills",
            "purpose": "Rehearse release rollback readiness with versioned package evidence, gated checks, and controlled rollback pipeline linkage.",
        },
    }
    if body.create_pipeline:
        run = _create_rollback_pipeline_for_drill(row, dry_run=True, actor=body.operator, note=body.notes or f"preview rollback drill {drill_id}")
        row["preview_pipeline_run_id"] = run.get("id", "")
        row["preview_pipeline"] = _public_pipeline_run(run)
        for check in row["checks"]:
            if isinstance(check, dict) and check.get("id") == "rollback_pipeline_preview":
                check["status"] = "passed"
                check["params"] = {"run_id": run.get("id", "")}
                check["updated_at"] = _now()
    data = _load_deployment_rollback_drills()
    items = [item for item in data.get("items", []) if isinstance(item, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [row, *items][:200]
    _save_deployment_rollback_drills(data)
    _audit_change("system_ops.rollback_drill.create", str(package.get("profile") or ""), {"drill_id": drill_id, "package_id": package.get("id"), "status": row.get("status")})
    return row


def _apply_deployment_rollback_drill_action(drill: dict[str, Any], body: DeploymentRollbackDrillActionIn) -> dict[str, Any]:
    status = str(drill.get("status") or "draft")
    actor = body.actor or "ops-admin"
    action = body.action
    checks = drill.get("checks", []) if isinstance(drill.get("checks"), list) else []
    events = drill.get("events", []) if isinstance(drill.get("events"), list) else []
    if status in {"completed", "cancelled"} and action not in {"create_rollback_pipeline"}:
        raise HTTPException(409, f"rollback drill already finalized: {status}")
    if action == "start":
        if status not in {"draft", "risk"}:
            raise HTTPException(409, f"rollback drill cannot start from status: {status}")
        drill["status"] = "running"
    elif action == "pass_check":
        if status not in {"draft", "running", "risk"}:
            raise HTTPException(409, f"rollback drill cannot pass check from status: {status}")
        _set_rollback_drill_check(checks, body.check_id, "passed", body.note)
        if status == "draft":
            drill["status"] = "running"
        elif all(check.get("status") == "passed" for check in checks if isinstance(check, dict)):
            drill["status"] = "ready"
        elif drill.get("status") == "risk" and not any(check.get("status") == "failed" for check in checks if isinstance(check, dict)):
            drill["status"] = "running"
    elif action == "fail_check":
        if status not in {"draft", "running", "risk"}:
            raise HTTPException(409, f"rollback drill cannot fail check from status: {status}")
        _set_rollback_drill_check(checks, body.check_id, "failed", body.note)
        drill["status"] = "risk"
    elif action == "create_rollback_pipeline":
        run = _create_rollback_pipeline_for_drill(drill, dry_run=False, actor=actor, note=body.note or f"execute rollback drill {drill.get('id')}")
        drill["rollback_pipeline_run_id"] = run.get("id", "")
        drill["rollback_pipeline"] = _public_pipeline_run(run)
        if drill.get("status") == "draft":
            drill["status"] = "running"
    elif action == "complete":
        failed = [check for check in checks if isinstance(check, dict) and check.get("status") == "failed"]
        pending = [check for check in checks if isinstance(check, dict) and check.get("status") == "pending" and check.get("required", True)]
        if failed:
            raise HTTPException(409, "rollback drill has failed checks")
        if pending:
            raise HTTPException(409, "rollback drill still has pending checks")
        if body.create_pipeline:
            current_run_id = str(drill.get("rollback_pipeline_run_id") or "")
            current_run = _find_deployment_pipeline_run(current_run_id) if current_run_id else {}
            if not current_run or bool(current_run.get("dry_run", False)):
                run = _create_rollback_pipeline_for_drill(drill, dry_run=False, actor=actor, note=body.note or f"complete rollback drill {drill.get('id')}")
                drill["rollback_pipeline_run_id"] = run.get("id", "")
                drill["rollback_pipeline"] = _public_pipeline_run(run)
        drill["status"] = "completed"
        drill["completed_by"] = actor
        drill["completed_at"] = _now()
    elif action == "cancel":
        if status not in {"draft", "running", "risk", "ready"}:
            raise HTTPException(409, f"rollback drill cannot cancel from status: {status}")
        drill["status"] = "cancelled"
        drill["cancelled_by"] = actor
        drill["cancelled_at"] = _now()
    drill["checks"] = checks
    drill["updated_at"] = _now()
    events.append(_rollback_drill_event(action, actor, body.note, {"status": drill.get("status", ""), "check_id": body.check_id}))
    drill["events"] = events
    _replace_deployment_rollback_drill(drill)
    _audit_change("system_ops.rollback_drill.action", str(drill.get("profile") or ""), {"drill_id": drill.get("id"), "action": action, "status": drill.get("status")})
    return drill


def _runbook_event(kind: str, actor: str, note: str = "", extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": f"evt-{uuid.uuid4().hex[:10]}",
        "kind": kind,
        "actor": actor or "ops-admin",
        "note": note,
        "at": _now(),
        "extra": extra or {},
    }


def _runbook_step(step_id: str, title: str, owner: str, command: str = "", api: str = "", status: str = "pending", required: bool = True, evidence: str = "") -> dict[str, Any]:
    return {
        "id": step_id,
        "title": title,
        "owner": owner or "ReleaseOps",
        "status": status,
        "required": required,
        "command": command,
        "api": api,
        "evidence": evidence,
        "updated_at": _now(),
    }


def _rollback_runbook_steps(package: dict[str, Any], body: DeploymentRollbackRunbookIn, drill: dict[str, Any] | None) -> list[dict[str, Any]]:
    profile = str(package.get("profile") or body.profile or "")
    package_id = str(package.get("id") or body.package_id or "")
    drill_status = str((drill or {}).get("status") or "")
    drill_ready = drill_status in {"ready", "completed"}
    preview_id = str((drill or {}).get("preview_pipeline_run_id") or "")
    return [
        _runbook_step(
            "declare_incident",
            "Declare rollback trigger and freeze release window",
            body.owner_id,
            command=f"sop pages manifest --q {json.dumps(profile, ensure_ascii=False)} --json",
            status="pending",
            evidence=body.trigger,
        ),
        _runbook_step(
            "verify_package",
            "Verify immutable deployment package checksum",
            body.owner_id,
            api=f"/api/v1/system/ops/deployment-packages/{package_id}",
            status="completed" if package.get("checksum") else "pending",
            evidence=str(package.get("checksum") or ""),
        ),
        _runbook_step(
            "confirm_drill",
            "Confirm rollback drill readiness and evidence",
            body.owner_id,
            api=f"/api/v1/system/ops/deployment-rollback-drills/{(drill or {}).get('id', '')}" if drill else "",
            status="completed" if drill_ready else "pending",
            required=bool(drill),
            evidence=drill_status or "no_drill_linked",
        ),
        _runbook_step(
            "preview_pipeline",
            "Preview rollback pipeline and commands",
            body.owner_id,
            api=f"/api/v1/system/ops/deployment-pipelines/{preview_id}" if preview_id else "/api/v1/system/ops/deployment-pipelines",
            status="completed" if preview_id else "pending",
            evidence=preview_id,
        ),
        _runbook_step(
            "notify_stakeholders",
            "Notify release owner, SRE, support, and tenant admin",
            body.owner_id,
            command="sop ops notify-send --event deploy.rollback --json",
            status="pending",
        ),
        _runbook_step(
            "execute_rollback",
            "Execute guarded rollback pipeline",
            body.owner_id,
            api="/api/v1/system/ops/deployment-pipelines",
            status="pending",
        ),
        _runbook_step(
            "verify_recovery",
            "Verify health, metrics, audit chain, and user traffic recovery",
            body.owner_id,
            command="sop status --json",
            status="pending",
        ),
        _runbook_step(
            "archive_evidence",
            "Archive rollback evidence and follow-up tasks",
            body.owner_id,
            api="/api/v1/audit/events",
            status="pending",
        ),
    ]


def _runbook_counts(steps: list[dict[str, Any]]) -> dict[str, int]:
    rows = [step for step in steps if isinstance(step, dict)]
    return {
        "step_total": len(rows),
        "step_done": len([step for step in rows if step.get("status") in {"completed", "skipped"}]),
        "step_pending": len([step for step in rows if step.get("status") == "pending"]),
        "step_failed": len([step for step in rows if step.get("status") == "failed"]),
    }


def _runbook_status(steps: list[dict[str, Any]], archived: bool = False) -> str:
    if archived:
        return "archived"
    counts = _runbook_counts(steps)
    if counts["step_failed"]:
        return "risk"
    if counts["step_pending"] == 0:
        return "ready"
    return "draft"


def _public_rollback_runbook(item: dict[str, Any]) -> dict[str, Any]:
    steps = item.get("steps", []) if isinstance(item.get("steps"), list) else []
    counts = _runbook_counts(steps)
    return {
        "id": item.get("id", ""),
        "package_id": item.get("package_id", ""),
        "profile": item.get("profile", ""),
        "version": item.get("version", ""),
        "drill_id": item.get("drill_id", ""),
        "name": item.get("name", ""),
        "environment": item.get("environment", ""),
        "trigger": item.get("trigger", ""),
        "status": item.get("status", ""),
        "operator": item.get("operator", ""),
        "approval_required": bool(item.get("approval_required", False)),
        "preview_pipeline_run_id": item.get("preview_pipeline_run_id", ""),
        "rollback_pipeline_run_id": item.get("rollback_pipeline_run_id", ""),
        "task_count": len(item.get("task_ids", [])) if isinstance(item.get("task_ids"), list) else 0,
        "created_at": item.get("created_at", ""),
        "updated_at": item.get("updated_at", ""),
        "notes": item.get("notes", ""),
        **counts,
    }


def _find_deployment_rollback_runbook(runbook_id: str) -> dict[str, Any]:
    data = _load_deployment_rollback_runbooks()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    for item in items:
        if isinstance(item, dict) and item.get("id") == runbook_id:
            return item
    raise HTTPException(404, f"unknown deployment rollback runbook: {runbook_id}")


def _replace_deployment_rollback_runbook(runbook: dict[str, Any]) -> None:
    data = _load_deployment_rollback_runbooks()
    items = [item for item in data.get("items", []) if isinstance(item, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [runbook if item.get("id") == runbook.get("id") else item for item in items]
    _save_deployment_rollback_runbooks(data)


def _create_deployment_rollback_runbook(body: DeploymentRollbackRunbookIn) -> dict[str, Any]:
    package_id = body.package_id.strip()
    profile = _safe_name(body.profile) if body.profile.strip() else ""
    package = _find_deployment_package(package_id) if package_id else _latest_deployment_package_for_profile(profile)
    drill = _find_deployment_rollback_drill(body.drill_id.strip()) if body.drill_id.strip() else None
    if drill and drill.get("package_id") != package.get("id"):
        raise HTTPException(409, "rollback drill package does not match runbook package")
    runbook_id = f"rollback-runbook-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"
    now = _now()
    steps = _rollback_runbook_steps(package, body, drill)
    row = {
        "id": runbook_id,
        "package_id": str(package.get("id") or body.package_id),
        "profile": str(package.get("profile") or profile),
        "version": str(package.get("version") or ""),
        "channel": str(package.get("channel") or ""),
        "drill_id": str((drill or {}).get("id") or ""),
        "name": body.name.strip() or "release rollback runbook",
        "environment": body.environment,
        "trigger": body.trigger,
        "status": _runbook_status(steps),
        "operator": body.operator or "release-manager",
        "approval_required": body.approval_required,
        "task_priority": body.task_priority,
        "owner_id": body.owner_id,
        "dev_tool": body.dev_tool or "codex",
        "notes": body.notes,
        "package_checksum": package.get("checksum", ""),
        "preview_pipeline_run_id": "",
        "rollback_pipeline_run_id": "",
        "task_ids": [],
        "created_at": now,
        "updated_at": now,
        "steps": steps,
        "events": [_runbook_event("created", body.operator, body.notes, {"trigger": body.trigger, "drill_id": body.drill_id})],
        "agent_consumption": {
            "surface": "settings.profiles.rollback_runbook",
            "api": "/api/v1/system/ops/deployment-rollback-runbooks",
            "purpose": "Generate reusable, taskable rollback runbooks from deployment packages, drills, pipeline commands, and recovery checks.",
        },
    }
    if body.create_preview_pipeline:
        run = _create_deployment_pipeline_run(DeploymentPipelineRunIn(
            package_id=str(package.get("id") or ""),
            environment=body.environment,
            action="rollback",
            operator=body.operator,
            dry_run=True,
            approval_required=False,
            notes=body.notes or f"preview rollback runbook {runbook_id}",
        ))
        row["preview_pipeline_run_id"] = run.get("id", "")
        row["preview_pipeline"] = _public_pipeline_run(run)
        for step in row["steps"]:
            if isinstance(step, dict) and step.get("id") == "preview_pipeline":
                step["status"] = "completed"
                step["api"] = f"/api/v1/system/ops/deployment-pipelines/{run.get('id')}"
                step["evidence"] = run.get("id", "")
                step["updated_at"] = _now()
    row["status"] = _runbook_status(row["steps"])
    data = _load_deployment_rollback_runbooks()
    items = [item for item in data.get("items", []) if isinstance(item, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [row, *items][:200]
    _save_deployment_rollback_runbooks(data)
    _audit_change("system_ops.rollback_runbook.create", str(package.get("profile") or ""), {"runbook_id": runbook_id, "package_id": package.get("id"), "status": row.get("status")})
    return row


def _rollback_runbook_task_plan(runbook: dict[str, Any], body: DeploymentRollbackRunbookActionIn) -> list[dict[str, Any]]:
    steps = runbook.get("steps", []) if isinstance(runbook.get("steps"), list) else []
    tasks: list[dict[str, Any]] = []
    for step in steps:
        if not isinstance(step, dict) or step.get("status") == "completed":
            continue
        title = f"[Rollback Runbook] {step.get('title') or step.get('id')}"
        tasks.append({
            "title": title[:200],
            "description": "\n".join([
                f"Runbook: {runbook.get('name') or runbook.get('id')}",
                f"Package: {runbook.get('package_id')}",
                f"Step: {step.get('id')}",
                f"Command: {step.get('command') or '-'}",
                f"API: {step.get('api') or '-'}",
                body.note or str(runbook.get("notes") or ""),
            ]),
            "priority": body.priority or str(runbook.get("task_priority") or "P1"),
            "owner_id": body.owner_id or str(runbook.get("owner_id") or ""),
            "dev_tool": body.dev_tool or str(runbook.get("dev_tool") or "codex"),
            "source": "system_ops.rollback_runbook",
            "source_report_id": str(runbook.get("id") or ""),
            "source_report_title": str(runbook.get("name") or "Release rollback runbook"),
        })
    return tasks


def _apply_deployment_rollback_runbook_action(runbook: dict[str, Any], body: DeploymentRollbackRunbookActionIn) -> dict[str, Any]:
    action = body.action
    actor = body.actor or "ops-admin"
    events = runbook.get("events", []) if isinstance(runbook.get("events"), list) else []
    if str(runbook.get("status") or "") == "archived" and action != "archive":
        raise HTTPException(409, "rollback runbook already archived")
    result: dict[str, Any] = {}
    if action == "mark_ready":
        for step in runbook.get("steps", []) if isinstance(runbook.get("steps"), list) else []:
            if isinstance(step, dict) and step.get("status") == "pending":
                step["status"] = "completed"
                step["updated_at"] = _now()
        runbook["status"] = "ready"
    elif action == "create_pipeline":
        run = _create_deployment_pipeline_run(DeploymentPipelineRunIn(
            package_id=str(runbook.get("package_id") or ""),
            environment="rollback",
            action="rollback",
            operator=actor,
            dry_run=bool(body.dry_run),
            approval_required=bool(runbook.get("approval_required", True)) and not body.dry_run,
            notes=body.note or f"rollback runbook {runbook.get('id')}",
        ))
        key = "preview_pipeline_run_id" if body.dry_run else "rollback_pipeline_run_id"
        runbook[key] = run.get("id", "")
        result["pipeline"] = _public_pipeline_run(run)
        for step in runbook.get("steps", []) if isinstance(runbook.get("steps"), list) else []:
            if isinstance(step, dict) and step.get("id") == ("preview_pipeline" if body.dry_run else "execute_rollback"):
                step["status"] = "completed" if body.dry_run else "pending"
                step["api"] = f"/api/v1/system/ops/deployment-pipelines/{run.get('id')}"
                step["evidence"] = run.get("id", "")
                step["updated_at"] = _now()
    elif action == "create_tasks":
        planned = _rollback_runbook_task_plan(runbook, body)
        result["planned"] = planned
        result["created"] = []
        if not body.dry_run:
            try:
                from sop_manager.routers.tasks import TaskCreate, create_task

                for task in planned:
                    created = create_task(TaskCreate(**task))
                    result["created"].append(created)
                task_ids = [str(item.get("id") or "") for item in result["created"] if isinstance(item, dict) and item.get("id")]
                runbook["task_ids"] = [*(runbook.get("task_ids", []) if isinstance(runbook.get("task_ids"), list) else []), *task_ids]
            except HTTPException:
                raise
            except Exception as exc:
                raise HTTPException(503, f"create rollback runbook tasks failed: {exc}") from exc
    elif action == "archive":
        runbook["status"] = "archived"
        runbook["archived_by"] = actor
        runbook["archived_at"] = _now()
    if action != "archive":
        runbook["status"] = _runbook_status(runbook.get("steps", []) if isinstance(runbook.get("steps"), list) else [])
    runbook["updated_at"] = _now()
    events.append(_runbook_event(action, actor, body.note, {"dry_run": body.dry_run, **{k: v for k, v in result.items() if k != "planned"}}))
    runbook["events"] = events
    _replace_deployment_rollback_runbook(runbook)
    _audit_change("system_ops.rollback_runbook.action", str(runbook.get("profile") or ""), {"runbook_id": runbook.get("id"), "action": action, "status": runbook.get("status")})
    return {"runbook": runbook, "result": result}


def _find_deployment_execution_audit(audit_id: str) -> dict[str, Any]:
    data = _load_deployment_execution_audits()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    for item in items:
        if isinstance(item, dict) and item.get("id") == audit_id:
            return item
    raise HTTPException(404, f"unknown deployment execution audit: {audit_id}")


def _replace_deployment_execution_audit(audit: dict[str, Any]) -> None:
    data = _load_deployment_execution_audits()
    items = [item for item in data.get("items", []) if isinstance(item, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [audit if item.get("id") == audit.get("id") else item for item in items]
    _save_deployment_execution_audits(data)


def _resolve_execution_audit_refs(body: DeploymentExecutionAuditIn) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    refs: dict[str, dict[str, Any]] = {}
    if body.pipeline_run_id.strip():
        refs["pipeline"] = _find_deployment_pipeline_run(body.pipeline_run_id.strip())
    if body.canary_policy_id.strip():
        refs["canary_policy"] = _find_deployment_canary_policy(body.canary_policy_id.strip())
    if body.rollback_drill_id.strip():
        refs["rollback_drill"] = _find_deployment_rollback_drill(body.rollback_drill_id.strip())
    if body.rollback_runbook_id.strip():
        refs["rollback_runbook"] = _find_deployment_rollback_runbook(body.rollback_runbook_id.strip())
    package_id = body.package_id.strip()
    for ref in refs.values():
        if not package_id and ref.get("package_id"):
            package_id = str(ref.get("package_id") or "")
        elif package_id and ref.get("package_id") and str(ref.get("package_id")) != package_id:
            raise HTTPException(409, "linked deployment evidence points to a different package")
    profile = _safe_name(body.profile) if body.profile.strip() else ""
    package = _find_deployment_package(package_id) if package_id else _latest_deployment_package_for_profile(profile)
    for key, ref in refs.items():
        if ref.get("package_id") and str(ref.get("package_id")) != str(package.get("id")):
            raise HTTPException(409, f"{key} package does not match execution audit package")
    return package, refs


def _execution_audit_evidence(body: DeploymentExecutionAuditIn, package: dict[str, Any], refs: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    rows = [
        {"id": "package", "label": "Deployment package", "status": "passed", "required": True, "ref_id": package.get("id", ""), "summary": package.get("checksum", "")},
        {"id": "change_ticket", "label": "Change ticket", "status": "passed" if body.change_ticket.strip() else "missing", "required": True, "ref_id": body.change_ticket.strip(), "summary": body.change_ticket.strip()},
        {"id": "execution_evidence", "label": "Execution evidence", "status": "passed" if body.evidence_url.strip() else "missing", "required": True, "ref_id": body.evidence_url.strip(), "summary": body.evidence_url.strip()},
    ]
    pipeline = refs.get("pipeline")
    if pipeline:
        rows.append({
            "id": "pipeline",
            "label": "Deployment pipeline",
            "status": "passed" if pipeline.get("status") in {"succeeded", "preview"} else ("failed" if pipeline.get("status") == "failed" else "warning"),
            "required": body.action in {"deploy", "rollback"},
            "ref_id": pipeline.get("id", ""),
            "summary": f"{pipeline.get('action', '-')}/{pipeline.get('environment', '-')}/{pipeline.get('status', '-')}",
        })
    elif body.action in {"deploy", "rollback"}:
        rows.append({"id": "pipeline", "label": "Deployment pipeline", "status": "missing", "required": True, "ref_id": "", "summary": ""})
    canary = refs.get("canary_policy")
    if canary:
        gates = canary.get("gates", []) if isinstance(canary.get("gates"), list) else []
        last_gate = gates[-1] if gates and isinstance(gates[-1], dict) else {}
        status = "passed" if canary.get("status") in {"completed", "running"} and last_gate.get("status") != "failed" else ("failed" if canary.get("status") in {"blocked", "rolled_back"} or last_gate.get("status") == "failed" else "warning")
        rows.append({"id": "canary_policy", "label": "Canary policy", "status": status, "required": body.action == "canary", "ref_id": canary.get("id", ""), "summary": f"{canary.get('status', '-')}/{last_gate.get('status', '-')}"})
    elif body.action == "canary":
        rows.append({"id": "canary_policy", "label": "Canary policy", "status": "missing", "required": True, "ref_id": "", "summary": ""})
    drill = refs.get("rollback_drill")
    if drill:
        rows.append({"id": "rollback_drill", "label": "Rollback drill", "status": "passed" if drill.get("status") == "completed" else ("failed" if drill.get("status") == "risk" else "warning"), "required": body.action == "rollback", "ref_id": drill.get("id", ""), "summary": f"{drill.get('status', '-')}/{drill.get('check_passed', 0)}/{drill.get('check_total', 0)}"})
    runbook = refs.get("rollback_runbook")
    if runbook:
        rows.append({"id": "rollback_runbook", "label": "Rollback runbook", "status": "passed" if runbook.get("status") == "ready" else ("failed" if runbook.get("status") == "risk" else "warning"), "required": body.action in {"rollback", "runbook"}, "ref_id": runbook.get("id", ""), "summary": f"{runbook.get('status', '-')}/{runbook.get('operator', '-')}"})
    elif body.action in {"rollback", "runbook"}:
        rows.append({"id": "rollback_runbook", "label": "Rollback runbook", "status": "missing", "required": True, "ref_id": "", "summary": ""})
    return rows


def _execution_audit_risk(body: DeploymentExecutionAuditIn, evidence: list[dict[str, Any]]) -> dict[str, Any]:
    level_weight = {"low": 20, "medium": 45, "high": 70, "critical": 90}
    score = level_weight.get(body.risk_level, 45)
    if body.environment == "production":
        score = max(score, 65)
    if body.status in {"failed", "blocked"}:
        score = max(score, 85)
    failed = [row for row in evidence if row.get("status") == "failed"]
    missing_required = [row for row in evidence if row.get("required") and row.get("status") == "missing"]
    warnings = [row for row in evidence if row.get("status") == "warning"]
    if failed:
        score = max(score, 82)
    if missing_required:
        score = max(score, 75)
    if warnings:
        score = max(score, 60)
    level = "critical" if score >= 85 else "high" if score >= 70 else "medium" if score >= 40 else "low"
    return {
        "score": score,
        "level": level,
        "failed_count": len(failed),
        "missing_required_count": len(missing_required),
        "warning_count": len(warnings),
    }


def _public_execution_audit(item: dict[str, Any]) -> dict[str, Any]:
    evidence = item.get("evidence", []) if isinstance(item.get("evidence"), list) else []
    passed = len([row for row in evidence if isinstance(row, dict) and row.get("status") == "passed"])
    required_missing = len([row for row in evidence if isinstance(row, dict) and row.get("required") and row.get("status") == "missing"])
    return {
        "id": item.get("id", ""),
        "package_id": item.get("package_id", ""),
        "profile": item.get("profile", ""),
        "version": item.get("version", ""),
        "environment": item.get("environment", ""),
        "action": item.get("action", ""),
        "status": item.get("status", ""),
        "actor": item.get("actor", ""),
        "change_ticket": item.get("change_ticket", ""),
        "risk_level": item.get("risk", {}).get("level", item.get("risk_level", "")) if isinstance(item.get("risk"), dict) else item.get("risk_level", ""),
        "risk_score": item.get("risk", {}).get("score", 0) if isinstance(item.get("risk"), dict) else 0,
        "evidence_passed": passed,
        "evidence_total": len(evidence),
        "missing_required": required_missing,
        "task_count": len(item.get("task_ids", [])) if isinstance(item.get("task_ids"), list) else 0,
        "created_at": item.get("created_at", ""),
        "updated_at": item.get("updated_at", ""),
        "notes": item.get("notes", ""),
    }


def _create_deployment_execution_audit(body: DeploymentExecutionAuditIn) -> dict[str, Any]:
    package, refs = _resolve_execution_audit_refs(body)
    evidence = _execution_audit_evidence(body, package, refs)
    risk = _execution_audit_risk(body, evidence)
    audit_id = f"exec-audit-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"
    now = _now()
    row = {
        "id": audit_id,
        "package_id": str(package.get("id") or ""),
        "profile": str(package.get("profile") or ""),
        "version": str(package.get("version") or ""),
        "channel": str(package.get("channel") or ""),
        "environment": body.environment,
        "action": body.action,
        "status": body.status,
        "actor": body.actor or "release-manager",
        "change_ticket": body.change_ticket.strip(),
        "evidence_url": body.evidence_url.strip(),
        "risk_level": body.risk_level,
        "risk": risk,
        "notes": body.notes,
        "metadata": body.metadata,
        "package_checksum": package.get("checksum", ""),
        "refs": {
            "pipeline_run_id": str((refs.get("pipeline") or {}).get("id") or body.pipeline_run_id),
            "canary_policy_id": str((refs.get("canary_policy") or {}).get("id") or body.canary_policy_id),
            "rollback_drill_id": str((refs.get("rollback_drill") or {}).get("id") or body.rollback_drill_id),
            "rollback_runbook_id": str((refs.get("rollback_runbook") or {}).get("id") or body.rollback_runbook_id),
        },
        "evidence": evidence,
        "task_ids": [],
        "created_at": now,
        "updated_at": now,
        "events": [_pipeline_event("audit_recorded", body.actor, body.notes, {"status": body.status, "risk": risk})],
        "agent_consumption": {
            "surface": "settings.profiles.execution_audit",
            "api": "/api/v1/system/ops/deployment-execution-audits",
            "purpose": "Audit cross-environment deployment execution by linking package, pipeline, canary, rollback drill, runbook, ticket, and evidence into taskable release governance.",
        },
    }
    data = _load_deployment_execution_audits()
    items = [item for item in data.get("items", []) if isinstance(item, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [row, *items][:300]
    _save_deployment_execution_audits(data)
    _audit_change("system_ops.execution_audit.create", str(package.get("profile") or ""), {"audit_id": audit_id, "package_id": package.get("id"), "status": body.status, "risk": risk})
    return row


def _execution_audit_task_plan(audit: dict[str, Any], body: DeploymentExecutionAuditTaskIn) -> list[dict[str, Any]]:
    tasks: list[dict[str, Any]] = []
    evidence = audit.get("evidence", []) if isinstance(audit.get("evidence"), list) else []
    for row in evidence:
        if not isinstance(row, dict):
            continue
        status = str(row.get("status") or "")
        if status == "passed":
            continue
        if status == "warning" and not body.include_low:
            continue
        priority = body.priority if status in {"failed", "missing"} else "P2"
        tasks.append({
            "title": f"[Execution Audit] {row.get('label') or row.get('id')} evidence follow-up"[:200],
            "description": "\n".join([
                f"Audit: {audit.get('id')}",
                f"Package: {audit.get('package_id')}",
                f"Environment/action: {audit.get('environment')} / {audit.get('action')}",
                f"Evidence: {row.get('id')} status={status}",
                f"Reference: {row.get('ref_id') or '-'}",
                str(audit.get("notes") or ""),
            ]),
            "priority": priority,
            "owner_id": body.owner_id,
            "dev_tool": body.dev_tool,
            "source": "system_ops.execution_audit",
            "source_report_id": str(audit.get("id") or ""),
            "source_report_title": f"Deployment execution audit {audit.get('environment')}/{audit.get('action')}",
        })
    if audit.get("status") in {"failed", "blocked"}:
        tasks.insert(0, {
            "title": f"[Execution Audit] Release status is {audit.get('status')}"[:200],
            "description": f"Audit {audit.get('id')} for package {audit.get('package_id')} is {audit.get('status')}. Review rollback, canary, and execution evidence before further rollout.",
            "priority": body.priority,
            "owner_id": body.owner_id,
            "dev_tool": body.dev_tool,
            "source": "system_ops.execution_audit",
            "source_report_id": str(audit.get("id") or ""),
            "source_report_title": f"Deployment execution audit {audit.get('environment')}/{audit.get('action')}",
        })
    return tasks[:20]


def _apply_execution_audit_tasks(audit: dict[str, Any], body: DeploymentExecutionAuditTaskIn) -> dict[str, Any]:
    planned = _execution_audit_task_plan(audit, body)
    result: dict[str, Any] = {"planned": planned, "created": []}
    if not body.dry_run:
        try:
            from sop_manager.routers.tasks import TaskCreate, create_task

            for task in planned:
                created = create_task(TaskCreate(**task))
                result["created"].append(created)
            task_ids = [str(item.get("id") or "") for item in result["created"] if isinstance(item, dict) and item.get("id")]
            audit["task_ids"] = [*(audit.get("task_ids", []) if isinstance(audit.get("task_ids"), list) else []), *task_ids]
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(503, f"create execution audit tasks failed: {exc}") from exc
    audit["updated_at"] = _now()
    events = audit.get("events", []) if isinstance(audit.get("events"), list) else []
    events.append(_pipeline_event("tasks_previewed" if body.dry_run else "tasks_created", body.owner_id, "", {"count": len(planned)}))
    audit["events"] = events
    _replace_deployment_execution_audit(audit)
    _audit_change("system_ops.execution_audit.tasks", str(audit.get("profile") or ""), {"audit_id": audit.get("id"), "dry_run": body.dry_run, "count": len(planned)})
    return result


def _canary_event(kind: str, actor: str, note: str = "", extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": f"evt-{uuid.uuid4().hex[:10]}",
        "kind": kind,
        "actor": actor or "ops-admin",
        "note": note,
        "at": _now(),
        "extra": extra or {},
    }


def _normalize_traffic_steps(steps: list[int]) -> list[int]:
    cleaned: list[int] = []
    for value in steps or [5, 25, 50, 100]:
        try:
            step = int(value)
        except Exception:
            continue
        if step <= 0 or step > 100:
            continue
        if not cleaned or step > cleaned[-1]:
            cleaned.append(step)
    if not cleaned:
        cleaned = [5, 25, 50, 100]
    if cleaned[-1] != 100:
        cleaned.append(100)
    return cleaned[:8]


def _public_canary_policy(item: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": item.get("id", ""),
        "package_id": item.get("package_id", ""),
        "profile": item.get("profile", ""),
        "version": item.get("version", ""),
        "channel": item.get("channel", ""),
        "name": item.get("name", ""),
        "environment": item.get("environment", ""),
        "strategy": item.get("strategy", ""),
        "status": item.get("status", ""),
        "traffic_steps": item.get("traffic_steps", []) if isinstance(item.get("traffic_steps"), list) else [],
        "current_step_index": int(item.get("current_step_index", -1)),
        "current_traffic": int(item.get("current_traffic", 0) or 0),
        "max_error_rate": item.get("max_error_rate", 0),
        "latency_p95_ms": item.get("latency_p95_ms", 0),
        "auto_promote": bool(item.get("auto_promote", False)),
        "pipeline_run_id": item.get("pipeline_run_id", ""),
        "created_by": item.get("created_by", ""),
        "updated_at": item.get("updated_at", ""),
        "created_at": item.get("created_at", ""),
        "notes": item.get("notes", ""),
    }


def _canary_gate(policy: dict[str, Any], metrics: dict[str, Any]) -> dict[str, Any]:
    error_rate = metrics.get("error_rate", metrics.get("errorRate"))
    latency = metrics.get("latency_p95_ms", metrics.get("latencyP95Ms"))
    checks: list[dict[str, Any]] = []
    passed = True
    if error_rate is not None:
        try:
            value = float(error_rate)
        except Exception:
            value = 1.0
        limit = float(policy.get("max_error_rate") or 0)
        ok = value <= limit
        passed = passed and ok
        checks.append({"id": "error_rate", "status": "passed" if ok else "failed", "value": value, "limit": limit})
    else:
        checks.append({"id": "error_rate", "status": "pending", "limit": policy.get("max_error_rate", 0)})
    if latency is not None:
        try:
            value = int(latency)
        except Exception:
            value = int(policy.get("latency_p95_ms") or 0) + 1
        limit = int(policy.get("latency_p95_ms") or 0)
        ok = value <= limit
        passed = passed and ok
        checks.append({"id": "latency_p95_ms", "status": "passed" if ok else "failed", "value": value, "limit": limit})
    else:
        checks.append({"id": "latency_p95_ms", "status": "pending", "limit": policy.get("latency_p95_ms", 0)})
    return {
        "id": f"gate-{uuid.uuid4().hex[:10]}",
        "status": "passed" if passed else "failed",
        "metrics": metrics,
        "checks": checks,
        "evaluated_at": _now(),
    }


def _create_deployment_canary_policy(body: DeploymentCanaryPolicyIn) -> dict[str, Any]:
    package = _find_deployment_package(body.package_id)
    policy_id = f"canary-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"
    now = _now()
    traffic_steps = _normalize_traffic_steps(body.traffic_steps)
    row = {
        "id": policy_id,
        "package_id": str(package.get("id") or body.package_id),
        "profile": str(package.get("profile") or ""),
        "version": str(package.get("version") or ""),
        "channel": str(package.get("channel") or ""),
        "name": body.name.strip() or "progressive rollout",
        "environment": body.environment,
        "strategy": body.strategy,
        "status": "draft",
        "traffic_steps": traffic_steps,
        "current_step_index": -1,
        "current_traffic": 0,
        "max_error_rate": body.max_error_rate,
        "latency_p95_ms": body.latency_p95_ms,
        "min_observation_minutes": body.min_observation_minutes,
        "auto_promote": body.auto_promote,
        "pipeline_run_id": "",
        "created_by": body.created_by or "release-manager",
        "notes": body.notes,
        "created_at": now,
        "updated_at": now,
        "package_checksum": package.get("checksum", ""),
        "gates": [],
        "events": [_canary_event("created", body.created_by, body.notes, {"traffic_steps": traffic_steps})],
        "agent_consumption": {
            "surface": "settings.profiles.canary_policy",
            "api": "/api/v1/system/ops/deployment-canary-policies",
            "purpose": "Configure progressive rollout traffic steps and metric gates for versioned deployment packages.",
        },
    }
    data = _load_deployment_canary_policies()
    items = [item for item in data.get("items", []) if isinstance(item, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [row, *items][:200]
    _save_deployment_canary_policies(data)
    _audit_change("system_ops.canary_policy.create", str(package.get("profile") or ""), {"policy_id": policy_id, "package_id": package.get("id")})
    return row


def _find_deployment_canary_policy(policy_id: str) -> dict[str, Any]:
    data = _load_deployment_canary_policies()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    for item in items:
        if isinstance(item, dict) and item.get("id") == policy_id:
            return item
    raise HTTPException(404, f"unknown deployment canary policy: {policy_id}")


def _replace_deployment_canary_policy(item: dict[str, Any]) -> None:
    data = _load_deployment_canary_policies()
    items = [row for row in data.get("items", []) if isinstance(row, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [item if row.get("id") == item.get("id") else row for row in items]
    _save_deployment_canary_policies(data)


def _public_canary_metric_source(item: dict[str, Any]) -> dict[str, Any]:
    samples = item.get("samples", []) if isinstance(item.get("samples"), list) else []
    latest = samples[0] if samples and isinstance(samples[0], dict) else {}
    return {
        "id": item.get("id", ""),
        "policy_id": item.get("policy_id", ""),
        "package_id": item.get("package_id", ""),
        "profile": item.get("profile", ""),
        "name": item.get("name", ""),
        "source_type": item.get("source_type", ""),
        "endpoint": item.get("endpoint", ""),
        "window_minutes": item.get("window_minutes", 0),
        "enabled": bool(item.get("enabled", False)),
        "sample_count": len(samples),
        "last_collected_at": latest.get("collected_at", ""),
        "last_status": latest.get("gate", {}).get("status", "") if isinstance(latest.get("gate"), dict) else "",
        "last_error_rate": latest.get("metrics", {}).get("error_rate", "") if isinstance(latest.get("metrics"), dict) else "",
        "last_latency_p95_ms": latest.get("metrics", {}).get("latency_p95_ms", "") if isinstance(latest.get("metrics"), dict) else "",
        "created_at": item.get("created_at", ""),
        "updated_at": item.get("updated_at", ""),
        "notes": item.get("notes", ""),
    }


def _find_canary_metric_source(source_id: str) -> dict[str, Any]:
    data = _load_deployment_canary_metric_sources()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    for item in items:
        if isinstance(item, dict) and item.get("id") == source_id:
            return item
    raise HTTPException(404, f"unknown deployment canary metric source: {source_id}")


def _replace_canary_metric_source(source: dict[str, Any]) -> None:
    data = _load_deployment_canary_metric_sources()
    items = [item for item in data.get("items", []) if isinstance(item, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [source if item.get("id") == source.get("id") else item for item in items]
    _save_deployment_canary_metric_sources(data)


def _create_canary_metric_source(body: DeploymentCanaryMetricSourceIn) -> dict[str, Any]:
    policy = _find_deployment_canary_policy(body.policy_id)
    source_id = f"canary-metrics-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"
    now = _now()
    row = {
        "id": source_id,
        "policy_id": str(policy.get("id") or body.policy_id),
        "package_id": str(policy.get("package_id") or ""),
        "profile": str(policy.get("profile") or ""),
        "version": str(policy.get("version") or ""),
        "environment": str(policy.get("environment") or ""),
        "name": body.name.strip() or "canary metrics source",
        "source_type": body.source_type,
        "endpoint": body.endpoint.strip(),
        "error_rate_query": body.error_rate_query.strip(),
        "latency_p95_query": body.latency_p95_query.strip(),
        "window_minutes": body.window_minutes,
        "enabled": body.enabled,
        "sample_error_rate": body.sample_error_rate,
        "sample_latency_p95_ms": body.sample_latency_p95_ms,
        "labels": body.labels,
        "created_by": body.created_by or "release-manager",
        "notes": body.notes,
        "created_at": now,
        "updated_at": now,
        "samples": [],
        "agent_consumption": {
            "surface": "settings.profiles.canary_metric_source",
            "api": "/api/v1/system/ops/deployment-canary-metric-sources",
            "purpose": "Configure reusable canary metric sources so release gates can collect error rate and latency automatically instead of relying on manual input.",
        },
    }
    data = _load_deployment_canary_metric_sources()
    items = [item for item in data.get("items", []) if isinstance(item, dict)] if isinstance(data.get("items"), list) else []
    data["items"] = [row, *items][:200]
    _save_deployment_canary_metric_sources(data)
    _audit_change("system_ops.canary_metric_source.create", str(policy.get("profile") or ""), {"source_id": source_id, "policy_id": policy.get("id")})
    return row


def _prometheus_query_value(endpoint: str, query: str) -> float | None:
    if not endpoint or not query:
        return None
    base = endpoint.rstrip("/")
    url = f"{base}/api/v1/query?{urllib.parse.urlencode({'query': query})}"
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=3) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
    except Exception:
        return None
    result = ((payload.get("data") or {}).get("result") or []) if isinstance(payload, dict) else []
    if not result:
        return None
    value = result[0].get("value") if isinstance(result[0], dict) else None
    if isinstance(value, list) and len(value) >= 2:
        try:
            return float(value[1])
        except Exception:
            return None
    return None


def _source_metrics(source: dict[str, Any], body: DeploymentCanaryMetricCollectIn) -> tuple[dict[str, Any], str]:
    override = body.metrics if isinstance(body.metrics, dict) else {}
    if override:
        return {
            "error_rate": float(override.get("error_rate", override.get("errorRate", 0)) or 0),
            "latency_p95_ms": int(float(override.get("latency_p95_ms", override.get("latencyP95Ms", 0)) or 0)),
        }, "request_override"
    source_type = str(source.get("source_type") or "manual")
    if source_type in {"prometheus", "grafana", "datadog"} and not body.dry_run:
        error_rate = _prometheus_query_value(str(source.get("endpoint") or ""), str(source.get("error_rate_query") or ""))
        latency = _prometheus_query_value(str(source.get("endpoint") or ""), str(source.get("latency_p95_query") or ""))
        if error_rate is not None and latency is not None:
            return {"error_rate": error_rate, "latency_p95_ms": int(latency)}, source_type
    return {
        "error_rate": float(source.get("sample_error_rate") or 0),
        "latency_p95_ms": int(source.get("sample_latency_p95_ms") or 0),
    }, "configured_sample"


def _default_canary_metric_source(policy_id: str) -> dict[str, Any]:
    sources = _load_deployment_canary_metric_sources().get("items", [])
    candidates = [item for item in sources if isinstance(item, dict) and item.get("policy_id") == policy_id and item.get("enabled", True)]
    if candidates:
        return candidates[0]
    raise HTTPException(404, f"policy has no enabled canary metric source: {policy_id}")


def _collect_canary_metrics(policy: dict[str, Any], body: DeploymentCanaryMetricCollectIn) -> dict[str, Any]:
    source = _find_canary_metric_source(body.source_id) if body.source_id.strip() else _default_canary_metric_source(str(policy.get("id") or ""))
    if source.get("policy_id") != policy.get("id"):
        raise HTTPException(409, "metric source does not belong to canary policy")
    if not source.get("enabled", True):
        raise HTTPException(409, "metric source is disabled")
    metrics, mode = _source_metrics(source, body)
    metrics.update({
        "source_id": source.get("id", ""),
        "source_type": source.get("source_type", ""),
        "collection_mode": mode,
        "window_minutes": int(source.get("window_minutes") or 10),
        "collected_at": _now(),
    })
    gate = _canary_gate(policy, metrics)
    result: dict[str, Any] = {
        "ok": True,
        "dry_run": body.dry_run,
        "policy_id": policy.get("id", ""),
        "source": _public_canary_metric_source(source),
        "metrics": metrics,
        "gate": gate,
        "applied": False,
        "advanced": False,
        "agent_consumption": {
            "surface": "settings.profiles.canary_metric_collection",
            "api": f"/api/v1/system/ops/deployment-canary-policies/{policy.get('id')}/metric-collection",
            "purpose": "Collect release metrics, preview gate decisions, and optionally apply them to canary rollout state.",
        },
    }
    if body.dry_run:
        return result
    samples = source.get("samples", []) if isinstance(source.get("samples"), list) else []
    samples = [{"id": f"sample-{uuid.uuid4().hex[:10]}", "metrics": metrics, "gate": gate, "actor": body.actor, "collected_at": metrics["collected_at"]}, *samples][:100]
    source["samples"] = samples
    source["updated_at"] = _now()
    _replace_canary_metric_source(source)
    if body.apply_to_gate:
        if body.advance_on_pass and gate.get("status") == "passed" and str(policy.get("status") or "draft") in {"draft", "running"}:
            action = "start" if str(policy.get("status") or "draft") == "draft" else "advance"
            updated = _apply_deployment_canary_action(policy, DeploymentCanaryActionIn(
                action=action,
                actor=body.actor,
                note=f"auto metric collection from {source.get('name')}",
                metrics=metrics,
                create_pipeline=False,
            ))
            result["advanced"] = True
            result["policy"] = updated
        else:
            gates = policy.get("gates", []) if isinstance(policy.get("gates"), list) else []
            gates.append(gate)
            policy["gates"] = gates
            if gate.get("status") == "failed":
                policy["status"] = "blocked"
            events = policy.get("events", []) if isinstance(policy.get("events"), list) else []
            events.append(_canary_event("metric_collected", body.actor, str(source.get("name") or ""), {"gate": gate, "source_id": source.get("id")}))
            policy["events"] = events
            policy["updated_at"] = _now()
            _replace_deployment_canary_policy(policy)
            result["policy"] = policy
        result["applied"] = True
    _audit_change("system_ops.canary_metrics.collect", str(policy.get("profile") or ""), {"policy_id": policy.get("id"), "source_id": source.get("id"), "gate_status": gate.get("status"), "applied": result["applied"]})
    result["source"] = _public_canary_metric_source(source)
    return result


def _apply_deployment_canary_action(policy: dict[str, Any], body: DeploymentCanaryActionIn) -> dict[str, Any]:
    status = str(policy.get("status") or "draft")
    actor = body.actor or "ops-admin"
    action = body.action
    if status in {"completed", "rolled_back"} and action not in {"rollback"}:
        raise HTTPException(409, f"canary policy already finalized: {status}")
    traffic_steps = _normalize_traffic_steps(policy.get("traffic_steps", []))
    gates = policy.get("gates", []) if isinstance(policy.get("gates"), list) else []
    events = policy.get("events", []) if isinstance(policy.get("events"), list) else []
    if action in {"start", "advance"}:
        if status not in {"draft", "running"}:
            raise HTTPException(409, f"canary policy cannot {action} from status: {status}")
        gate = _canary_gate(policy, body.metrics)
        gates.append(gate)
        if gate["status"] == "failed":
            policy["status"] = "blocked"
            policy["gates"] = gates
            policy["updated_at"] = _now()
            events.append(_canary_event("gate_failed", actor, body.note, {"gate": gate}))
            policy["events"] = events
            _replace_deployment_canary_policy(policy)
            raise HTTPException(409, "canary gate failed")
        next_index = 0 if status == "draft" or int(policy.get("current_step_index", -1)) < 0 else int(policy.get("current_step_index", -1)) + 1
        if next_index >= len(traffic_steps):
            next_index = len(traffic_steps) - 1
        policy["status"] = "running"
        policy["current_step_index"] = next_index
        policy["current_traffic"] = traffic_steps[next_index]
        policy["gates"] = gates
    elif action == "pause":
        if status != "running":
            raise HTTPException(409, f"canary policy cannot pause from status: {status}")
        policy["status"] = "paused"
    elif action == "resume":
        if status != "paused":
            raise HTTPException(409, f"canary policy cannot resume from status: {status}")
        policy["status"] = "running"
    elif action == "rollback":
        if status == "completed":
            raise HTTPException(409, "completed canary policy cannot rollback from this control")
        policy["status"] = "rolled_back"
        policy["current_traffic"] = 0
        policy["rolled_back_by"] = actor
        policy["rolled_back_at"] = _now()
    elif action == "complete":
        if status != "running" or int(policy.get("current_traffic", 0) or 0) < 100:
            raise HTTPException(409, "canary policy must reach 100 traffic before completion")
        policy["status"] = "completed"
        policy["completed_by"] = actor
        policy["completed_at"] = _now()
        package = _find_deployment_package(str(policy.get("package_id") or ""))
        package["release_status"] = "canary_completed"
        package["canary_policy_id"] = policy.get("id", "")
        package["canary_completed_at"] = policy["completed_at"]
        package["canary_completed_by"] = actor
        _replace_deployment_package(package)
        if body.create_pipeline:
            run = _create_deployment_pipeline_run(DeploymentPipelineRunIn(
                package_id=str(policy.get("package_id") or ""),
                environment=str(policy.get("environment") or "staging"),
                action="deploy",
                operator=actor,
                dry_run=False,
                approval_required=False,
                notes=body.note or f"completed canary policy {policy.get('id')}",
            ))
            policy["pipeline_run_id"] = run.get("id", "")
            policy["pipeline"] = _public_pipeline_run(run)
    policy["updated_at"] = _now()
    events.append(_canary_event(action, actor, body.note, {"status": policy.get("status"), "traffic": policy.get("current_traffic", 0)}))
    policy["events"] = events
    _replace_deployment_canary_policy(policy)
    _audit_change("system_ops.canary_policy.action", str(policy.get("profile") or ""), {"policy_id": policy.get("id"), "action": action, "status": policy.get("status")})
    return policy


def _canary_im_risks(policy: dict[str, Any], limit: int) -> list[dict[str, Any]]:
    risks: list[dict[str, Any]] = []
    status = str(policy.get("status") or "draft")
    gates = policy.get("gates", []) if isinstance(policy.get("gates"), list) else []
    failed_gates = [gate for gate in gates if isinstance(gate, dict) and gate.get("status") == "failed"]
    pending_gates = [gate for gate in gates if isinstance(gate, dict) and gate.get("status") == "pending"]
    if status == "blocked":
        risks.append({"level": "high", "title": "canary_gate_blocked", "recommendation": "review_failed_gate_and_pause_rollout"})
    if status == "rolled_back":
        risks.append({"level": "high", "title": "canary_rolled_back", "recommendation": "verify_recovery_and_create_followup_task"})
    if failed_gates:
        risks.append({"level": "high", "title": "canary_metric_gate_failed", "recommendation": "inspect_error_rate_or_latency_gate", "count": len(failed_gates)})
    if status in {"running", "paused"} and int(policy.get("current_traffic", 0) or 0) >= 50:
        risks.append({"level": "medium", "title": "canary_high_traffic_in_progress", "recommendation": "keep_observation_window_and_notify_release_owner"})
    if pending_gates:
        risks.append({"level": "medium", "title": "canary_gate_pending", "recommendation": "submit_latest_error_rate_and_latency_metrics", "count": len(pending_gates)})
    if not risks and status == "completed":
        risks.append({"level": "low", "title": "canary_completed", "recommendation": "archive_release_evidence_and_monitor_post_deploy"})
    if not risks:
        risks.append({"level": "low", "title": "canary_ready", "recommendation": "start_canary_with_metric_gate_observation"})
    return risks[:limit]


def _canary_health_score(policy: dict[str, Any], risks: list[dict[str, Any]]) -> int:
    score = 100
    status = str(policy.get("status") or "draft")
    if status in {"blocked", "rolled_back"}:
        score -= 45
    elif status == "paused":
        score -= 20
    elif status == "running":
        score -= 10
    for risk in risks:
        level = str(risk.get("level") or "low")
        score -= 20 if level == "high" else 10 if level == "medium" else 0
    return max(0, min(100, score))


def _canary_im_briefing(policy: dict[str, Any], body: DeploymentCanaryImBriefingIn) -> dict[str, Any]:
    risks = _canary_im_risks(policy, body.limit)
    gates = policy.get("gates", []) if isinstance(policy.get("gates"), list) else []
    failed_gates = [gate for gate in gates if isinstance(gate, dict) and gate.get("status") == "failed"]
    summary = {
        "health_score": _canary_health_score(policy, risks),
        "status": policy.get("status", ""),
        "profile": policy.get("profile", ""),
        "version": policy.get("version", ""),
        "environment": policy.get("environment", ""),
        "current_traffic": int(policy.get("current_traffic", 0) or 0),
        "traffic_steps": len(policy.get("traffic_steps", [])) if isinstance(policy.get("traffic_steps"), list) else 0,
        "gate_total": len(gates),
        "gate_failed": len(failed_gates),
        "pipeline_run_id": policy.get("pipeline_run_id", ""),
    }
    recommendations = [str(item.get("recommendation") or item.get("title") or "") for item in risks if item.get("recommendation") or item.get("title")]
    from sop_manager.routers.im_integration_core import build_im_briefing, build_im_delivery_plan
    from sop_manager.routers.notify import NotifyMsg, list_channels, send_msg

    event = body.event or ("canary_risk" if risks and risks[0].get("level") in {"high", "medium"} else "deploy")
    briefing = build_im_briefing(
        module="system_ops.canary",
        title=body.title or f"Canary Risk Briefing: {policy.get('name') or policy.get('id')}",
        summary=summary,
        risks=risks,
        recommendations=recommendations,
        scope={"profile": policy.get("profile", ""), "package_id": policy.get("package_id", ""), "policy_id": policy.get("id", "")},
        actions=[
            {"label": "Open Settings Profile", "href": "#/settings/profiles"},
            {"label": "Canary policy detail API", "api": f"/api/v1/system/ops/deployment-canary-policies/{policy.get('id')}"},
            {"label": "Canary action API", "api": f"/api/v1/system/ops/deployment-canary-policies/{policy.get('id')}/action"},
        ],
    )
    plan = build_im_delivery_plan(briefing, list_channels(), requested_channels=body.channels, event=event)
    if body.dry_run or not plan.get("ready"):
        return {
            "ok": True,
            "dry_run": True,
            "policy_id": policy.get("id", ""),
            "risk": {"status": policy.get("status", ""), "summary": summary, "items": risks},
            "briefing": briefing,
            "delivery_plan": plan,
            "sent": [],
            "agent_consumption": {
                "surface": "settings.profiles.canary_im",
                "api": f"/api/v1/system/ops/deployment-canary-policies/{policy.get('id')}/im-briefing",
                "purpose": "Preview canary release risk briefings and Notify delivery targets before sending to enterprise IM channels.",
            },
        }
    sent = [send_msg(NotifyMsg(channel=msg["channel"], title=msg["title"], content=msg["content"], level=msg["level"])) for msg in plan.get("messages", [])]
    audit = {
        "policy_id": policy.get("id", ""),
        "package_id": policy.get("package_id", ""),
        "event": event,
        "delivery_audit": plan.get("audit", {}),
        "sent_count": len(sent),
        "ok_count": sum(1 for item in sent if isinstance(item, dict) and item.get("ok") is not False),
        "failed_count": sum(1 for item in sent if isinstance(item, dict) and item.get("ok") is False),
    }
    try:
        from sop_manager.routers.audit_chain import append_audit

        append_audit(
            "system_ops.canary.im_briefing",
            resource_type="deployment_canary_policy",
            resource_id=str(policy.get("id") or ""),
            details=audit,
        )
    except Exception:
        pass
    events = policy.get("events", []) if isinstance(policy.get("events"), list) else []
    events.append(_canary_event("im_briefing", "system", body.title, audit))
    policy["events"] = events
    policy["last_im_briefing_at"] = _now()
    policy["updated_at"] = _now()
    _replace_deployment_canary_policy(policy)
    return {
        "ok": True,
        "dry_run": False,
        "policy_id": policy.get("id", ""),
        "risk": {"status": policy.get("status", ""), "summary": summary, "items": risks},
        "briefing": briefing,
        "delivery_plan": plan,
        "sent": sent,
        "audit": audit,
        "agent_consumption": {
            "surface": "settings.profiles.canary_im",
            "api": f"/api/v1/system/ops/deployment-canary-policies/{policy.get('id')}/im-briefing",
            "purpose": "Send canary release risk briefings through configured enterprise IM channels with delivery audit.",
        },
    }


def _doctor() -> dict[str, Any]:
    checks = []
    data = _load()
    active = data.get("active", "local-dev")
    profiles = data.get("profiles", {}) if isinstance(data.get("profiles"), dict) else {}
    checks.append({"id": "profile", "ok": active in profiles or active in {x["name"] for x in _templates()}, "message": f"active={active}"})
    checks.append({"id": "runtime_dir", "ok": _runtime_dir().exists(), "message": str(_runtime_dir())})
    checks.append({"id": "database", "ok": bool(os.getenv("DATABASE_URL") or os.getenv("DB_TYPE", "sqlite")), "message": os.getenv("DB_TYPE", "sqlite")})
    checks.append({"id": "worker", "ok": bool(os.getenv("REDIS_URL", "")), "message": "REDIS_URL configured" if os.getenv("REDIS_URL") else "file/memory fallback"})
    checks.append({"id": "temporal", "ok": os.getenv("WORKFLOW_ENGINE", "memory") == "temporal", "message": os.getenv("WORKFLOW_ENGINE", "memory")})
    failed = [c for c in checks if not c["ok"] and c["id"] in {"profile", "runtime_dir", "database"}]
    return {"ok": not failed, "checks": checks, "failed": len(failed)}


def _file_info(path: Path) -> dict[str, Any]:
    try:
        st = path.stat()
        return {
            "name": path.name,
            "path": str(path),
            "size": st.st_size,
            "updated_at": datetime.fromtimestamp(st.st_mtime, timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        }
    except OSError:
        return {"name": path.name, "path": str(path), "size": 0, "updated_at": ""}


def _tail_lines(path: Path, limit: int = 200) -> list[str]:
    if not path.is_file():
        return []
    try:
        limit = max(1, min(int(limit or 200), 1000))
    except Exception:
        limit = 200
    try:
        with path.open("rb") as fh:
            fh.seek(0, os.SEEK_END)
            pos = fh.tell()
            chunk = 8192
            data = b""
            while pos > 0 and data.count(b"\n") <= limit:
                step = min(chunk, pos)
                pos -= step
                fh.seek(pos)
                data = fh.read(step) + data
        text = data.decode("utf-8", errors="replace")
        return text.splitlines()[-limit:]
    except OSError:
        return []


def _parse_log_line(line: str, source: str) -> dict[str, Any]:
    parts = line.split(" ", 3)
    ts = parts[0] if parts else ""
    level = parts[1].strip() if len(parts) > 1 else ""
    message = parts[3] if len(parts) > 3 else line
    return {"ts": ts, "level": level, "source": source, "message": message, "raw": line}


def _nested(row: dict[str, Any], *keys: str) -> Any:
    value: Any = row
    for key in keys:
        if not isinstance(value, dict):
            return None
        value = value.get(key)
    return value


def _row_ids(row: dict[str, Any]) -> set[str]:
    ids = {
        str(row.get("trace_id") or ""),
        str(row.get("correlation_id") or ""),
        str(row.get("agent_run_id") or ""),
        str(row.get("run_id") or ""),
        str(row.get("id") or ""),
        str(row.get("task_id") or ""),
        str(_nested(row, "meta", "trace_id") or ""),
        str(_nested(row, "meta", "correlation_id") or ""),
        str(_nested(row, "payload", "data", "trace_id") or ""),
        str(_nested(row, "payload", "data", "correlation_id") or ""),
        str(_nested(row, "payload", "data", "agent_run_id") or ""),
        str(_nested(row, "data", "trace_id") or ""),
        str(_nested(row, "data", "correlation_id") or ""),
        str(_nested(row, "data", "agent_run_id") or ""),
    }
    data = row.get("data")
    if isinstance(data, dict):
        ids.update({str(data.get("trace_id") or ""), str(data.get("correlation_id") or ""), str(data.get("agent_run_id") or "")})
        details = data.get("details")
        if isinstance(details, dict):
            ids.update({str(details.get("trace_id") or ""), str(details.get("correlation_id") or ""), str(details.get("agent_run_id") or "")})
    details = row.get("details")
    if isinstance(details, dict):
        ids.update({str(details.get("trace_id") or ""), str(details.get("correlation_id") or ""), str(details.get("agent_run_id") or "")})
    return {x for x in ids if x}


def _matches(row: dict[str, Any], needles: set[str]) -> bool:
    return bool(needles & _row_ids(row))


def _audit_payload(entry: dict[str, Any]) -> dict[str, Any]:
    data = entry.get("data") if isinstance(entry.get("data"), dict) else {}
    return {
        **data,
        "id": entry.get("hash", ""),
        "hash": entry.get("hash", ""),
        "prev_hash": entry.get("prev_hash", ""),
    }


def _node(kind: str, row: dict[str, Any]) -> dict[str, Any]:
    if kind == "agent_run":
        return {
            "type": kind,
            "id": row.get("id", ""),
            "run_id": row.get("id", ""),
            "status": row.get("status", ""),
            "title": f"Agent {row.get('agent_id') or '-'} / {row.get('task_id') or '-'}",
            "timestamp": row.get("finished_at") or row.get("started_at") or "",
            "risk_level": "high" if row.get("status") == "failed" else "medium" if row.get("status") in {"cancelled", "retrying"} else "low",
            "detail": row.get("error_msg") or row.get("cancel_reason") or "",
            "link": "#/platforms/agent-runs",
        }
    if kind == "llm_call":
        latency = int(row.get("latency_ms") or 0)
        return {
            "type": kind,
            "id": row.get("id", ""),
            "run_id": row.get("agent_run_id", ""),
            "status": "slow" if latency >= 5000 else "ok",
            "title": f"LLM {row.get('model_id') or '-'}",
            "timestamp": row.get("created_at") or "",
            "risk_level": "high" if latency >= 5000 else "medium" if float(row.get("cost_usd") or 0) >= 1 else "low",
            "detail": f"latency={latency}ms cost=${row.get('cost_usd', 0)}",
            "link": "#/ai/llm-gateway",
        }
    if kind == "data_job":
        return {
            "type": kind,
            "id": row.get("id", ""),
            "run_id": row.get("agent_run_id") or row.get("run_id") or "",
            "status": row.get("status", ""),
            "title": f"Data ingest {row.get('name') or row.get('job_id') or '-'}",
            "timestamp": row.get("finished_at") or row.get("started_at") or "",
            "risk_level": "high" if row.get("status") == "failed" else "low",
            "detail": row.get("error_msg") or f"rows={row.get('rows_ingested', 0)}",
            "link": "#/data/ingest",
        }
    if kind == "event":
        payload = row.get("payload") if isinstance(row.get("payload"), dict) else {}
        return {
            "type": kind,
            "id": row.get("id", ""),
            "run_id": _nested(payload, "data", "agent_run_id") or "",
            "status": row.get("action", ""),
            "title": f"Event {row.get('action') or row.get('module') or '-'}",
            "timestamp": row.get("ts") or "",
            "risk_level": "medium" if "failed" in str(row.get("action") or "") else "low",
            "detail": str(_nested(payload, "data", "reason") or row.get("record_id") or ""),
            "link": "/api/v1/events",
        }
    return {
        "type": kind,
        "id": row.get("hash") or row.get("id") or "",
        "run_id": row.get("agent_run_id", ""),
        "status": row.get("action", ""),
        "title": f"Audit {row.get('action') or '-'}",
        "timestamp": row.get("ts") or "",
        "risk_level": "medium",
        "detail": row.get("resource_type") or "",
        "link": "#/audit",
    }


def _load_trace_sources(limit: int) -> dict[str, list[dict[str, Any]]]:
    try:
        from sop_manager.routers import agent_runs
        runs = agent_runs._all_runs()[:limit]
    except Exception:
        runs = []
    try:
        from sop_manager.routers import llm_gateway_v2
        llm_usage = llm_gateway_v2._load_all("usage")[:limit]
    except Exception:
        llm_usage = []
    try:
        from sop_manager.routers import data_ingest
        data_runs = data_ingest._load_all("runs")[:limit]
    except Exception:
        data_runs = []
    try:
        from sop_manager.sync_journal import recent_events
        events = recent_events(limit=limit)
    except Exception:
        events = []
    try:
        from sop_manager.routers.audit_chain import recent_audit_entries
        audit = [_audit_payload(x) for x in recent_audit_entries(limit=limit)]
    except Exception:
        audit = []
    return {"agent_runs": runs, "llm_usage": llm_usage, "data_runs": data_runs, "events": events, "audit": audit}


def _derive_needles(sources: dict[str, list[dict[str, Any]]], *, run_id: str, trace_id: str, correlation_id: str) -> set[str]:
    needles = {x for x in {run_id, trace_id, correlation_id} if x}
    for run in sources["agent_runs"]:
        if run_id and str(run.get("id") or "") == run_id:
            needles.update(_row_ids(run))
    return {x for x in needles if x}


@router.get("/profiles")
def list_profiles(_: Any = Depends(current_user)) -> dict[str, Any]:
    data = _load()
    active = str(data.get("active") or "local-dev")
    merged = _merge_profiles()
    return {
        "ok": True,
        "active": active,
        "items": [_public_profile(name, row, active) for name, row in sorted(merged.items())],
        "templates": _templates(),
        "effective_env": _mask_env(_effective_env()),
        "config_path": str(_profiles_path()),
        "doctor": _doctor(),
    }


@router.get("/observability")
def observability(_: Any = Depends(current_user)) -> dict[str, Any]:
    log_dir = _log_dir()
    logs = sorted([_file_info(p) for p in log_dir.glob("*.log")], key=lambda x: x.get("updated_at", ""), reverse=True) if log_dir.exists() else []
    events_summary: dict[str, Any] = {"total": 0, "by_action": {}, "latest": []}
    try:
        from sop_manager.sync_journal import recent_events

        events = recent_events(limit=200)
        by_action: dict[str, int] = {}
        for evt in events:
            action = str(evt.get("action") or evt.get("type") or "unknown")
            by_action[action] = by_action.get(action, 0) + 1
        events_summary = {"total": len(events), "by_action": by_action, "latest": events[:20]}
    except Exception:
        pass
    doctor = _doctor()
    return {
        "ok": doctor.get("ok", False),
        "runtime_dir": str(_runtime_dir()),
        "log_dir": str(log_dir),
        "logs": logs,
        "events": events_summary,
        "doctor": doctor,
        "links": {
            "health": "/api/v1/health",
            "metrics": "/metrics",
            "events": "/api/v1/events",
            "audit": "/api/v1/audit/events",
        },
    }


@router.get("/observability/traces")
def observability_trace_summary(
    run_id: str = Query("", max_length=200),
    trace_id: str = Query("", max_length=64),
    correlation_id: str = Query("", max_length=200),
    limit: int = Query(100, ge=1, le=500),
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    run_id = run_id if isinstance(run_id, str) else ""
    trace_id = trace_id if isinstance(trace_id, str) else ""
    correlation_id = correlation_id if isinstance(correlation_id, str) else ""
    try:
        limit = max(1, min(int(limit), 500))
    except Exception:
        limit = 100
    sources = _load_trace_sources(limit)
    needles = _derive_needles(sources, run_id=run_id, trace_id=trace_id, correlation_id=correlation_id)
    if not needles and (trace_id or correlation_id or run_id):
        needles = {x for x in {trace_id, correlation_id, run_id} if x}
    if not needles:
        ctx = current_trace_context()
        needles = {ctx["trace_id"], ctx["correlation_id"]}

    runs = [row for row in sources["agent_runs"] if _matches(row, needles)]
    llm = [row for row in sources["llm_usage"] if _matches(row, needles)]
    data = [row for row in sources["data_runs"] if _matches(row, needles)]
    events = [row for row in sources["events"] if _matches(row, needles)]
    audit = [row for row in sources["audit"] if _matches(row, needles)]
    all_rows = runs + llm + data + events + audit
    selected_trace = trace_id or next((str(x.get("trace_id") or _nested(x, "meta", "trace_id") or _nested(x, "payload", "data", "trace_id") or _nested(x, "details", "trace_id") or "") for x in all_rows if _matches(x, needles)), "")
    selected_corr = correlation_id or next((str(x.get("correlation_id") or _nested(x, "meta", "correlation_id") or _nested(x, "payload", "data", "correlation_id") or _nested(x, "details", "correlation_id") or "") for x in all_rows if _matches(x, needles)), "")
    failed_runs = [row for row in runs if row.get("status") == "failed"]
    failed_data = [row for row in data if row.get("status") == "failed"]
    slow_llm = [row for row in llm if int(row.get("latency_ms") or 0) >= 5000]
    nodes = (
        [_node("agent_run", row) for row in runs]
        + [_node("llm_call", row) for row in llm]
        + [_node("data_job", row) for row in data]
        + [_node("event", row) for row in events]
        + [_node("audit", row) for row in audit]
    )
    nodes.sort(key=lambda x: str(x.get("timestamp") or ""))
    risk_level = "high" if failed_runs or failed_data or slow_llm else "medium" if events or audit else "low"
    likely_causes = []
    if slow_llm:
        likely_causes.append("LLM latency exceeded 5000ms")
    if failed_data:
        likely_causes.append("Data ingest job failed")
    if failed_runs:
        likely_causes.append(str(failed_runs[0].get("error_msg") or "Agent run failed"))
    return {
        "ok": True,
        "filters": {"run_id": run_id, "trace_id": trace_id, "correlation_id": correlation_id, "limit": limit},
        "trace": {"trace_id": selected_trace, "correlation_id": selected_corr, "needles": sorted(needles)},
        "summary": {
            "agent_runs": len(runs),
            "failed_runs": len(failed_runs),
            "llm_calls": len(llm),
            "slow_llm_calls": len(slow_llm),
            "data_jobs": len(data),
            "failed_data_jobs": len(failed_data),
            "events": len(events),
            "audit_entries": len(audit),
            "nodes": len(nodes),
        },
        "root_cause": {
            "risk_level": risk_level,
            "likely_causes": likely_causes,
            "recommended_next": ["检查慢模型或 fallback 策略", "查看 Agent Run 证据", "核对数据接入游标与审计链"],
        },
        "root_cause_navigation": nodes,
        "agent_consumption": {
            "api": "/api/v1/system/ops/observability/traces",
            "safe_for_agents": True,
            "purpose": "按 trace_id/correlation_id/run_id 聚合 API、Agent Run、LLM、数据作业、事件和审计链，供失败根因导航。",
        },
    }


@router.get("/logs")
def read_logs(
    name: str = Query("sop.app.log", max_length=120),
    limit: int = Query(200, ge=1, le=1000),
    level: str = Query("", max_length=16),
    q: str = Query("", max_length=200),
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    safe = "".join(c for c in name if c.isalnum() or c in "._-")
    if not safe.endswith(".log"):
        safe = f"{safe}.log"
    path = (_log_dir() / safe).resolve()
    if _log_dir() not in path.parents and path != _log_dir():
        raise HTTPException(400, "非法日志文件")
    lines = [_parse_log_line(x, safe) for x in _tail_lines(path, limit=limit)]
    if level:
        lv = level.upper()
        lines = [x for x in lines if str(x.get("level", "")).upper().startswith(lv)]
    if q:
        needle = q.lower()
        lines = [x for x in lines if needle in str(x.get("raw", "")).lower()]
    by_level: dict[str, int] = {}
    for row in lines:
        lv = str(row.get("level") or "UNKNOWN").upper()
        by_level[lv] = by_level.get(lv, 0) + 1
    return {"ok": True, "file": _file_info(path), "items": lines, "total": len(lines), "by_level": by_level}


@router.get("/storage/migration-plan")
def storage_migration_plan(_: Any = Depends(current_user)) -> dict[str, Any]:
    return oceanbase_migration_plan()


@router.post("/storage/migration-smoke")
def storage_migration_smoke(_: Any = Depends(current_user)) -> dict[str, Any]:
    return oceanbase_migration_smoke()


@router.put("/profiles/{profile}")
def upsert_profile(profile: str, body: EnvProfileIn, _: Any = Depends(require_role("tenant_admin"))) -> dict[str, Any]:
    name = _safe_name(profile)
    data = _load()
    profiles = data.setdefault("profiles", {})
    if not isinstance(profiles, dict):
        profiles = {}
        data["profiles"] = profiles
    row = body.model_dump()
    row["name"] = name
    row["updated_at"] = _now()
    profiles[name] = row
    if not data.get("active"):
        data["active"] = name
    _save(data)
    _audit_change("system_ops.profile.upsert", name, {"mode": row.get("mode"), "database": row.get("database"), "features": row.get("features", {})})
    return {"ok": True, "item": _public_profile(name, row, str(data.get("active") or ""))}


@router.post("/profiles/{profile}/activate")
def activate_profile(profile: str, _: Any = Depends(require_role("tenant_admin"))) -> dict[str, Any]:
    name = _safe_name(profile)
    data = _load()
    known = set((data.get("profiles") or {}).keys()) | {x["name"] for x in _templates()}
    if name not in known:
        raise HTTPException(404, f"unknown profile: {name}")
    data["active"] = name
    _save(data)
    _audit_change("system_ops.profile.activate", name, {"active": name})
    return {"ok": True, "active": name}


@router.delete("/profiles/{profile}")
def delete_profile(profile: str, _: Any = Depends(require_role("tenant_admin"))) -> dict[str, Any]:
    name = _safe_name(profile)
    data = _load()
    profiles = data.setdefault("profiles", {})
    if isinstance(profiles, dict):
        profiles.pop(name, None)
    if data.get("active") == name:
        data["active"] = "local-dev"
    _save(data)
    _audit_change("system_ops.profile.delete", name, {"profile": name})
    return {"ok": True}


@router.get("/profiles/{profile}/env")
def export_profile_env(profile: str, _: Any = Depends(current_user)) -> dict[str, Any]:
    name = _safe_name(profile)
    merged = _merge_profiles()
    row = merged.get(name)
    if not row:
        raise HTTPException(404, f"unknown profile: {name}")
    env = row.get("env", {}) if isinstance(row.get("env"), dict) else {}
    return {"ok": True, "profile": name, "env": _mask_env(env), "shell": _env_shell(name, row)}


@router.get("/profiles/{profile}/bundle")
def export_profile_bundle(profile: str, _: Any = Depends(current_user)) -> dict[str, Any]:
    name = _safe_name(profile)
    row = _merge_profiles().get(name)
    if not row:
        raise HTTPException(404, f"unknown profile: {name}")
    out_dir = _runtime_dir() / "deploy" / name
    out_dir.mkdir(parents=True, exist_ok=True)
    env_file = out_dir / "profile.env"
    compose_file = out_dir / "docker-compose.override.yml"
    runbook_file = out_dir / "README.md"
    env_file.write_text(_env_shell(name, row) + "\n", encoding="utf-8")
    compose_file.write_text(_compose_override(name, row), encoding="utf-8")
    runbook_file.write_text(_runbook(name, row), encoding="utf-8")
    _audit_change("system_ops.profile.export_bundle", name, {"dir": str(out_dir)})
    return {
        "ok": True,
        "profile": name,
        "dir": str(out_dir),
        "files": {
            "env": str(env_file),
            "compose": str(compose_file),
            "runbook": str(runbook_file),
        },
        "shell": _env_shell(name, row),
        "compose": _compose_override(name, row),
        "runbook": _runbook(name, row),
    }


@router.get("/profiles/{profile}/compose.override.yml")
def download_compose_override(profile: str, _: Any = Depends(current_user)) -> Response:
    name = _safe_name(profile)
    row = _merge_profiles().get(name)
    if not row:
        raise HTTPException(404, f"unknown profile: {name}")
    return Response(
        _compose_override(name, row),
        media_type="text/yaml; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{name}.docker-compose.override.yml"'},
    )


@router.get("/profiles/{profile}/deployment-packages")
def list_deployment_packages(
    profile: str,
    limit: int = Query(20, ge=1, le=100),
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    name = _safe_name(profile)
    if name not in _merge_profiles():
        raise HTTPException(404, f"unknown profile: {name}")
    data = _load_deployment_packages()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    filtered = [_public_deployment_package(item) for item in items if isinstance(item, dict) and item.get("profile") == name]
    safe_limit = limit if isinstance(limit, int) else 20
    safe_limit = max(1, min(int(safe_limit or 20), 100))
    return {
        "ok": True,
        "profile": name,
        "items": filtered[:safe_limit],
        "total": len(filtered),
        "index_path": str(_deployment_packages_path()),
        "agent_consumption": {
            "surface": "settings.profiles.deployment_packages",
            "api": f"/api/v1/system/ops/profiles/{name}/deployment-packages",
            "purpose": "List versioned deployment packages for rollout traceability and rollback selection.",
        },
    }


@router.post("/profiles/{profile}/deployment-packages")
def create_deployment_package(
    profile: str,
    body: DeploymentPackageIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_name(profile)
    row = _merge_profiles().get(name)
    if not row:
        raise HTTPException(404, f"unknown profile: {name}")
    item = _create_deployment_package(name, row, body)
    return {"ok": True, "item": _public_deployment_package(item), "manifest": item, "preview": {"shell": _masked_env_shell(name, row), "compose": _compose_override(name, row), "runbook": _runbook(name, row)}}


@router.get("/deployment-packages/{package_id}")
def get_deployment_package(package_id: str, _: Any = Depends(current_user)) -> dict[str, Any]:
    item = _find_deployment_package(package_id)
    profile = str(item.get("profile") or "")
    row = _merge_profiles().get(profile, {})
    files = {str(file.get("name")): Path(str(file.get("path"))) for file in item.get("files", []) if isinstance(file, dict) and file.get("name") and file.get("path")}
    compose = files.get("docker-compose.override.yml")
    runbook = files.get("README.md")
    return {
        "ok": True,
        "item": _public_deployment_package(item),
        "manifest": item,
        "preview": {
            "shell": _masked_env_shell(profile, row) if row else "",
            "compose": compose.read_text(encoding="utf-8") if compose and compose.is_file() else "",
            "runbook": runbook.read_text(encoding="utf-8") if runbook and runbook.is_file() else "",
        },
        "agent_consumption": {
            "surface": "settings.profiles.deployment_package.detail",
            "api": f"/api/v1/system/ops/deployment-packages/{package_id}",
            "purpose": "Inspect a deployment package manifest, checksums, and safe previews before rollout or rollback.",
        },
    }


@router.get("/deployment-packages/{package_id}/compose.override.yml")
def download_deployment_package_compose(package_id: str, _: Any = Depends(current_user)) -> Response:
    item = _find_deployment_package(package_id)
    files = {str(file.get("name")): Path(str(file.get("path"))) for file in item.get("files", []) if isinstance(file, dict) and file.get("name") and file.get("path")}
    path = files.get("docker-compose.override.yml")
    if not path or not path.is_file():
        raise HTTPException(404, f"compose override missing for package: {package_id}")
    return Response(
        path.read_text(encoding="utf-8"),
        media_type="text/yaml; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{package_id}.docker-compose.override.yml"'},
    )


@router.get("/deployment-canary-policies")
def list_deployment_canary_policies(
    profile: str = "",
    package_id: str = "",
    status: str = "",
    limit: int = Query(20, ge=1, le=100),
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    safe_profile = _safe_name(profile) if profile.strip() else ""
    safe_limit = limit if isinstance(limit, int) else 20
    safe_limit = max(1, min(int(safe_limit or 20), 100))
    data = _load_deployment_canary_policies()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    filtered = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if safe_profile and item.get("profile") != safe_profile:
            continue
        if package_id and item.get("package_id") != package_id:
            continue
        if status and item.get("status") != status:
            continue
        filtered.append(_public_canary_policy(item))
    return {
        "ok": True,
        "items": filtered[:safe_limit],
        "total": len(filtered),
        "index_path": str(_deployment_canary_policies_path()),
        "agent_consumption": {
            "surface": "settings.profiles.canary_policy",
            "api": "/api/v1/system/ops/deployment-canary-policies",
            "purpose": "List progressive rollout policies, traffic status, and metric gate results for release governance.",
        },
    }


@router.post("/deployment-canary-policies")
def create_deployment_canary_policy(
    body: DeploymentCanaryPolicyIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    policy = _create_deployment_canary_policy(body)
    return {"ok": True, "item": _public_canary_policy(policy), "policy": policy}


@router.get("/deployment-canary-policies/{policy_id}")
def get_deployment_canary_policy(policy_id: str, _: Any = Depends(current_user)) -> dict[str, Any]:
    policy = _find_deployment_canary_policy(policy_id)
    return {"ok": True, "item": _public_canary_policy(policy), "policy": policy}


@router.post("/deployment-canary-policies/{policy_id}/action")
def deployment_canary_policy_action(
    policy_id: str,
    body: DeploymentCanaryActionIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    policy = _find_deployment_canary_policy(policy_id)
    updated = _apply_deployment_canary_action(policy, body)
    return {"ok": True, "item": _public_canary_policy(updated), "policy": updated}


@router.post("/deployment-canary-policies/{policy_id}/im-briefing")
def deployment_canary_policy_im_briefing(
    policy_id: str,
    body: DeploymentCanaryImBriefingIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    policy = _find_deployment_canary_policy(policy_id)
    return _canary_im_briefing(policy, body)


@router.get("/deployment-canary-metric-sources")
def list_deployment_canary_metric_sources(
    profile: str = "",
    policy_id: str = "",
    package_id: str = "",
    source_type: str = "",
    limit: int = Query(20, ge=1, le=100),
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    safe_profile = _safe_name(profile) if profile.strip() else ""
    safe_limit = limit if isinstance(limit, int) else 20
    safe_limit = max(1, min(int(safe_limit or 20), 100))
    data = _load_deployment_canary_metric_sources()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    filtered = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if safe_profile and item.get("profile") != safe_profile:
            continue
        if policy_id and item.get("policy_id") != policy_id:
            continue
        if package_id and item.get("package_id") != package_id:
            continue
        if source_type and item.get("source_type") != source_type:
            continue
        filtered.append(_public_canary_metric_source(item))
    return {
        "ok": True,
        "items": filtered[:safe_limit],
        "total": len(filtered),
        "index_path": str(_deployment_canary_metric_sources_path()),
        "agent_consumption": {
            "surface": "settings.profiles.canary_metric_source",
            "api": "/api/v1/system/ops/deployment-canary-metric-sources",
            "purpose": "List configured metric sources for automatic canary gate collection.",
        },
    }


@router.post("/deployment-canary-metric-sources")
def create_deployment_canary_metric_source(
    body: DeploymentCanaryMetricSourceIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    source = _create_canary_metric_source(body)
    return {"ok": True, "item": _public_canary_metric_source(source), "source": source}


@router.get("/deployment-canary-metric-sources/{source_id}")
def get_deployment_canary_metric_source(source_id: str, _: Any = Depends(current_user)) -> dict[str, Any]:
    source = _find_canary_metric_source(source_id)
    return {"ok": True, "item": _public_canary_metric_source(source), "source": source}


@router.post("/deployment-canary-policies/{policy_id}/metric-collection")
def deployment_canary_metric_collection(
    policy_id: str,
    body: DeploymentCanaryMetricCollectIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    policy = _find_deployment_canary_policy(policy_id)
    result = _collect_canary_metrics(policy, body)
    policy_payload = result.get("policy") if isinstance(result.get("policy"), dict) else policy
    return {"ok": True, "item": _public_canary_policy(policy_payload), **result}


@router.get("/deployment-rollback-drills")
def list_deployment_rollback_drills(
    profile: str = "",
    package_id: str = "",
    status: str = "",
    limit: int = Query(20, ge=1, le=100),
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    safe_profile = _safe_name(profile) if profile.strip() else ""
    safe_limit = limit if isinstance(limit, int) else 20
    safe_limit = max(1, min(int(safe_limit or 20), 100))
    data = _load_deployment_rollback_drills()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    filtered = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if safe_profile and item.get("profile") != safe_profile:
            continue
        if package_id and item.get("package_id") != package_id:
            continue
        if status and item.get("status") != status:
            continue
        filtered.append(_public_rollback_drill(item))
    return {
        "ok": True,
        "items": filtered[:safe_limit],
        "total": len(filtered),
        "index_path": str(_deployment_rollback_drills_path()),
        "agent_consumption": {
            "surface": "settings.profiles.rollback_drill",
            "api": "/api/v1/system/ops/deployment-rollback-drills",
            "purpose": "List release rollback drill readiness, check evidence, and linked rollback pipeline runs.",
        },
    }


@router.post("/deployment-rollback-drills")
def create_deployment_rollback_drill(
    body: DeploymentRollbackDrillIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    drill = _create_deployment_rollback_drill(body)
    return {"ok": True, "item": _public_rollback_drill(drill), "drill": drill}


@router.get("/deployment-rollback-drills/{drill_id}")
def get_deployment_rollback_drill(drill_id: str, _: Any = Depends(current_user)) -> dict[str, Any]:
    drill = _find_deployment_rollback_drill(drill_id)
    return {"ok": True, "item": _public_rollback_drill(drill), "drill": drill}


@router.post("/deployment-rollback-drills/{drill_id}/action")
def deployment_rollback_drill_action(
    drill_id: str,
    body: DeploymentRollbackDrillActionIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    drill = _find_deployment_rollback_drill(drill_id)
    updated = _apply_deployment_rollback_drill_action(drill, body)
    return {"ok": True, "item": _public_rollback_drill(updated), "drill": updated}


@router.get("/deployment-rollback-runbooks")
def list_deployment_rollback_runbooks(
    profile: str = "",
    package_id: str = "",
    drill_id: str = "",
    status: str = "",
    limit: int = Query(20, ge=1, le=100),
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    safe_profile = _safe_name(profile) if profile.strip() else ""
    safe_limit = limit if isinstance(limit, int) else 20
    safe_limit = max(1, min(int(safe_limit or 20), 100))
    data = _load_deployment_rollback_runbooks()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    filtered = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if safe_profile and item.get("profile") != safe_profile:
            continue
        if package_id and item.get("package_id") != package_id:
            continue
        if drill_id and item.get("drill_id") != drill_id:
            continue
        if status and item.get("status") != status:
            continue
        filtered.append(_public_rollback_runbook(item))
    return {
        "ok": True,
        "items": filtered[:safe_limit],
        "total": len(filtered),
        "index_path": str(_deployment_rollback_runbooks_path()),
        "agent_consumption": {
            "surface": "settings.profiles.rollback_runbook",
            "api": "/api/v1/system/ops/deployment-rollback-runbooks",
            "purpose": "List generated rollback runbooks with package, drill, pipeline, task, and recovery evidence coverage.",
        },
    }


@router.post("/deployment-rollback-runbooks")
def create_deployment_rollback_runbook(
    body: DeploymentRollbackRunbookIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    runbook = _create_deployment_rollback_runbook(body)
    return {"ok": True, "item": _public_rollback_runbook(runbook), "runbook": runbook}


@router.get("/deployment-rollback-runbooks/{runbook_id}")
def get_deployment_rollback_runbook(runbook_id: str, _: Any = Depends(current_user)) -> dict[str, Any]:
    runbook = _find_deployment_rollback_runbook(runbook_id)
    return {"ok": True, "item": _public_rollback_runbook(runbook), "runbook": runbook}


@router.post("/deployment-rollback-runbooks/{runbook_id}/action")
def deployment_rollback_runbook_action(
    runbook_id: str,
    body: DeploymentRollbackRunbookActionIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    runbook = _find_deployment_rollback_runbook(runbook_id)
    updated = _apply_deployment_rollback_runbook_action(runbook, body)
    return {"ok": True, "item": _public_rollback_runbook(updated["runbook"]), "runbook": updated["runbook"], "result": updated["result"]}


@router.get("/deployment-execution-audits")
def list_deployment_execution_audits(
    profile: str = "",
    package_id: str = "",
    environment: str = "",
    action: str = "",
    status: str = "",
    risk_level: str = "",
    limit: int = Query(20, ge=1, le=100),
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    safe_profile = _safe_name(profile) if profile.strip() else ""
    safe_limit = limit if isinstance(limit, int) else 20
    safe_limit = max(1, min(int(safe_limit or 20), 100))
    data = _load_deployment_execution_audits()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    filtered = []
    for item in items:
        if not isinstance(item, dict):
            continue
        public = _public_execution_audit(item)
        if safe_profile and public.get("profile") != safe_profile:
            continue
        if package_id and public.get("package_id") != package_id:
            continue
        if environment and public.get("environment") != environment:
            continue
        if action and public.get("action") != action:
            continue
        if status and public.get("status") != status:
            continue
        if risk_level and public.get("risk_level") != risk_level:
            continue
        filtered.append(public)
    return {
        "ok": True,
        "items": filtered[:safe_limit],
        "total": len(filtered),
        "index_path": str(_deployment_execution_audits_path()),
        "agent_consumption": {
            "surface": "settings.profiles.execution_audit",
            "api": "/api/v1/system/ops/deployment-execution-audits",
            "purpose": "List cross-environment deployment execution audits with package, environment, status, risk, evidence coverage, and task linkage.",
        },
    }


@router.post("/deployment-execution-audits")
def create_deployment_execution_audit(
    body: DeploymentExecutionAuditIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    audit = _create_deployment_execution_audit(body)
    return {"ok": True, "item": _public_execution_audit(audit), "audit": audit}


@router.get("/deployment-execution-audits/{audit_id}")
def get_deployment_execution_audit(audit_id: str, _: Any = Depends(current_user)) -> dict[str, Any]:
    audit = _find_deployment_execution_audit(audit_id)
    return {"ok": True, "item": _public_execution_audit(audit), "audit": audit}


@router.post("/deployment-execution-audits/{audit_id}/tasks")
def deployment_execution_audit_tasks(
    audit_id: str,
    body: DeploymentExecutionAuditTaskIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    audit = _find_deployment_execution_audit(audit_id)
    result = _apply_execution_audit_tasks(audit, body)
    updated = _find_deployment_execution_audit(audit_id)
    return {"ok": True, "item": _public_execution_audit(updated), "audit": updated, "result": result}


@router.get("/deployment-package-approvals")
def list_deployment_package_approvals(
    profile: str = "",
    package_id: str = "",
    status: str = "",
    limit: int = Query(20, ge=1, le=100),
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    safe_profile = _safe_name(profile) if profile.strip() else ""
    safe_limit = limit if isinstance(limit, int) else 20
    safe_limit = max(1, min(int(safe_limit or 20), 100))
    data = _load_deployment_package_approvals()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    filtered = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if safe_profile and item.get("profile") != safe_profile:
            continue
        if package_id and item.get("package_id") != package_id:
            continue
        if status and item.get("status") != status:
            continue
        filtered.append(_public_deployment_package_approval(item))
    return {
        "ok": True,
        "items": filtered[:safe_limit],
        "total": len(filtered),
        "index_path": str(_deployment_package_approvals_path()),
        "agent_consumption": {
            "surface": "settings.profiles.deployment_package_approval",
            "api": "/api/v1/system/ops/deployment-package-approvals",
            "purpose": "List deployment package approval and publish records for release governance.",
        },
    }


@router.post("/deployment-package-approvals")
def create_deployment_package_approval(
    body: DeploymentPackageApprovalIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    approval = _create_deployment_package_approval(body)
    return {"ok": True, "item": _public_deployment_package_approval(approval), "approval": approval}


@router.get("/deployment-package-approvals/{approval_id}")
def get_deployment_package_approval(approval_id: str, _: Any = Depends(current_user)) -> dict[str, Any]:
    approval = _find_deployment_package_approval(approval_id)
    return {"ok": True, "item": _public_deployment_package_approval(approval), "approval": approval}


@router.post("/deployment-package-approvals/{approval_id}/action")
def deployment_package_approval_action(
    approval_id: str,
    body: DeploymentPackageApprovalActionIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    approval = _find_deployment_package_approval(approval_id)
    updated = _apply_deployment_package_approval_action(approval, body)
    return {"ok": True, "item": _public_deployment_package_approval(updated), "approval": updated}


@router.get("/deployment-pipelines")
def list_deployment_pipelines(
    profile: str = "",
    package_id: str = "",
    status: str = "",
    limit: int = Query(20, ge=1, le=100),
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    safe_profile = _safe_name(profile) if profile.strip() else ""
    safe_limit = limit if isinstance(limit, int) else 20
    safe_limit = max(1, min(int(safe_limit or 20), 100))
    data = _load_deployment_pipeline_runs()
    items = data.get("items", []) if isinstance(data.get("items"), list) else []
    filtered = []
    for item in items:
        if not isinstance(item, dict):
            continue
        if safe_profile and item.get("profile") != safe_profile:
            continue
        if package_id and item.get("package_id") != package_id:
            continue
        if status and item.get("status") != status:
            continue
        filtered.append(_public_pipeline_run(item))
    return {
        "ok": True,
        "items": filtered[:safe_limit],
        "total": len(filtered),
        "index_path": str(_deployment_pipeline_runs_path()),
        "executors": _deployment_executor_catalog(safe_profile),
        "agent_consumption": {
            "surface": "settings.profiles.deployment_pipeline",
            "api": "/api/v1/system/ops/deployment-pipelines",
            "purpose": "List governed one-click deployment pipeline records with approval and execution status.",
        },
    }


@router.post("/deployment-pipelines")
def create_deployment_pipeline(
    body: DeploymentPipelineRunIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    run = _create_deployment_pipeline_run(body)
    return {"ok": True, "item": _public_pipeline_run(run), "run": run}


@router.get("/deployment-pipelines/{run_id}")
def get_deployment_pipeline(run_id: str, _: Any = Depends(current_user)) -> dict[str, Any]:
    run = _find_deployment_pipeline_run(run_id)
    return {"ok": True, "item": _public_pipeline_run(run), "run": run, "executors": _deployment_executor_catalog(str(run.get("profile") or ""))}


@router.post("/deployment-pipelines/{run_id}/action")
def deployment_pipeline_action(
    run_id: str,
    body: DeploymentPipelineActionIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    run = _find_deployment_pipeline_run(run_id)
    updated = _apply_deployment_pipeline_action(run, body)
    return {"ok": True, "item": _public_pipeline_run(updated), "run": updated}


@router.get("/deployment-pipeline-executors")
def list_deployment_pipeline_executors(profile: str = "", _: Any = Depends(current_user)) -> dict[str, Any]:
    safe_profile = _safe_name(profile) if profile.strip() else ""
    return {
        "ok": True,
        "profile": safe_profile,
        "items": _deployment_executor_catalog(safe_profile),
        "agent_consumption": {
            "surface": "settings.profiles.deployment_executor",
            "api": "/api/v1/system/ops/deployment-pipeline-executors",
            "purpose": "List safe deployment executor adapters, supported intents, and runtime guards for pipeline execution.",
        },
    }


@router.get("/deployment-executor-targets")
def list_deployment_executor_targets(
    profile: str = "",
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    safe_profile = _safe_name(profile) if profile.strip() else ""
    items = _deployment_executor_targets_for_profile(safe_profile)
    return {
        "ok": True,
        "profile": safe_profile,
        "items": items,
        "total": len(items),
        "index_path": str(_deployment_executor_targets_path()),
        "agent_consumption": {
            "surface": "settings.profiles.deployment_executor_targets",
            "api": "/api/v1/system/ops/deployment-executor-targets",
            "purpose": "Manage governed distributed deployment executor targets for external orchestrators and remote agents.",
        },
    }


@router.post("/deployment-executor-targets")
def create_deployment_executor_target(
    body: DeploymentExecutorTargetIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    target = _upsert_deployment_executor_target(body)
    return {"ok": True, "item": _public_deployment_executor_target(target), "target": target}


@router.put("/deployment-executor-targets/{target_id}")
def update_deployment_executor_target(
    target_id: str,
    body: DeploymentExecutorTargetIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    target = _upsert_deployment_executor_target(body, target_id)
    return {"ok": True, "item": _public_deployment_executor_target(target), "target": target}


@router.post("/deployment-executor-targets/{target_id}/action")
def deployment_executor_target_action(
    target_id: str,
    body: DeploymentExecutorTargetActionIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    target = _find_deployment_executor_target(target_id)
    updated = _apply_deployment_executor_target_action(target, body)
    return {"ok": True, "item": _public_deployment_executor_target(updated["target"]), **updated}


@router.post("/deployment-pipelines/{run_id}/execute")
def deployment_pipeline_execute(
    run_id: str,
    body: DeploymentPipelineExecuteIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    run = _find_deployment_pipeline_run(run_id)
    updated = _apply_deployment_pipeline_execute(run, body)
    return {"ok": True, "item": _public_pipeline_run(updated["run"]), **updated}


@router.post("/deployment-pipelines/{run_id}/executions/{execution_id}/callback")
def deployment_pipeline_execution_callback(
    run_id: str,
    execution_id: str,
    body: DeploymentPipelineExecutionCallbackIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    run = _find_deployment_pipeline_run(run_id)
    updated = _apply_deployment_pipeline_execution_callback(run, execution_id, body)
    return {"ok": True, "item": _public_pipeline_run(updated["run"]), **updated}


@router.post("/deployment-pipelines/{run_id}/remediation")
def deployment_pipeline_remediation(
    run_id: str,
    body: DeploymentPipelineRemediationIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    run = _find_deployment_pipeline_run(run_id)
    updated = _apply_deployment_pipeline_remediation(run, body)
    return {"ok": True, "item": _public_pipeline_run(updated["run"]), **updated}


@router.get("/doctor")
def system_ops_doctor(_: Any = Depends(current_user)) -> dict[str, Any]:
    return {"ok": True, **_doctor()}


settings_router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


@router.get("/hub")
def env_ops_hub(_: Any = Depends(current_user)) -> dict[str, Any]:
    profiles_payload = list_profiles(_)
    obs = observability(_)
    doctor = _doctor()
    items = profiles_payload.get("items") if isinstance(profiles_payload.get("items"), list) else []
    logs = obs.get("logs") if isinstance(obs.get("logs"), list) else []
    toolchain_available = 0
    toolchain_total = 0
    by_category: dict[str, int] = {}
    try:
        from sop_manager.routers.orchestration import list_tools

        for tool in list_tools():
            if not isinstance(tool, dict):
                continue
            toolchain_total += 1
            if tool.get("available"):
                toolchain_available += 1
            cat = str(tool.get("category") or "unknown")
            by_category[cat] = by_category.get(cat, 0) + 1
    except Exception:
        pass

    def _pie(counter: dict[str, int]) -> list[dict[str, Any]]:
        return [{"name": k, "value": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0])) if v > 0]

    return {
        "ok": True,
        "summary": {
            "doctor_ok": bool(doctor.get("ok")),
            "profiles": len(items),
            "active_profile": str(profiles_payload.get("active") or "—"),
            "log_files": len(logs),
            "events_total": int((obs.get("events") or {}).get("total") or 0),
            "toolchain_available": toolchain_available,
            "toolchain_total": toolchain_total,
        },
        "charts": {"toolchain_category": _pie(by_category)},
        "domains": [
            {"id": "workbench", "path": "#/ops/env/workbench", "capability": "system.env-ops.workbench"},
            {"id": "profiles", "path": "#/settings/profiles", "capability": "system.settings.profiles"},
            {"id": "observability", "path": "#/settings/observability", "capability": "system.settings.observability"},
            {"id": "storage", "path": "#/settings/storage", "capability": "system.settings.storage"},
            {"id": "orchestration", "path": "#/orchestration", "capability": "delivery.orchestration"},
        ],
    }


@settings_router.get("/hub")
def settings_hub(_: Any = Depends(current_user)) -> dict[str, Any]:
    from sop_manager.routers.billing import billing_summary
    from sop_manager.routers.health import health_v1

    bill = billing_summary()
    health = health_v1()
    profiles = _load()
    profile_count = len(profiles.get("profiles") or {}) if isinstance(profiles.get("profiles"), dict) else 0
    doctor = _doctor()
    return {
        "ok": True,
        "summary": {
            "health_ok": bool(health.get("ok")),
            "admin_mode": str(health.get("admin_mode") or "single"),
            "invoice_count": bill.get("invoice_count", 0),
            "outstanding_usd": bill.get("outstanding_usd", 0),
            "env_profiles": profile_count,
            "doctor_ok": bool(doctor.get("ok")),
        },
        "domains": [
            {"id": "account", "path": "#/settings/account", "capability": "system.settings.account"},
            {"id": "runtime", "path": "#/settings/runtime", "capability": "system.settings.runtime"},
            {"id": "workspace", "path": "#/settings/workspace", "capability": "system.settings.workspace"},
            {"id": "sso", "path": "#/settings/sso", "capability": "system.settings.sso"},
            {"id": "billing", "path": "#/settings/billing", "capability": "system.settings.billing"},
            {"id": "profiles", "path": "#/settings/profiles", "capability": "system.settings.profiles"},
            {"id": "observability", "path": "#/settings/observability", "capability": "system.settings.observability"},
            {"id": "storage", "path": "#/settings/storage", "capability": "system.settings.storage"},
            {"id": "appearance", "path": "#/settings/appearance", "capability": "system.settings.appearance"},
        ],
    }
