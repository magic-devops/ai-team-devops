"""
@module: routers.sso
@purpose: 企业 SSO —— OIDC（Authorization Code + PKCE）和 SAML 2.0
@stable: /api/v1/sso/* 路径稳定；SP 入口 /api/v1/sso/{provider}/login 重定向
@ai_safe_edit:
  - 新增 IdP：在 _PROVIDERS 加配置项；不动 _oidc_login/_oidc_callback
  - 改 token 字段映射：改 _make_session_token() 的 claims
@deps_in: authlib / python3-saml（可选）；缺包时只暴露元数据接口

最佳实践：
  1. 多租户：domain → tenant 映射，登录后强制租户隔离
  2. PKCE：OIDC code flow 强制开启（防止 code 劫持）
  3. SAML：签名验证；不验证 → 拒绝
  4. JIT Provisioning：首次登录自动建用户，按 IdP groups 映射默认角色
"""
from __future__ import annotations

import base64
import calendar
import hmac
import hashlib
import html
import json
import logging
import os
import secrets
import time
import urllib.parse
import uuid
import xml.etree.ElementTree as ET
from sop_manager.task_owner import TaskOwnerId, TaskOwnerInput

from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse, Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from sop_manager.routers.auth_sql import USER_ROLES, _hash, _make_token, _norm_role, current_user, require_role
from sop_manager.routers.im_integration_core import build_im_briefing, build_im_delivery_plan
from sop_manager.routers.sql_models import Tenant, User, get_session
from sop_manager.routers.tasks import TaskCreate, create_task

_log = logging.getLogger("sop.sso")
router = APIRouter(prefix="/api/v1/sso", tags=["security"])

# 多 IdP 配置：环境变量 / DB 二选一；这里先支持 env 配置多实例
# 格式：SOP_SSO_PROVIDERS=okta,azure
#       SOP_SSO_OKTA_TYPE=oidc / saml
#       SOP_SSO_OKTA_ISSUER=https://...
#       SOP_SSO_OKTA_CLIENT_ID=...
#       SOP_SSO_OKTA_CLIENT_SECRET=...

_STATE_TTL = 600
_STATE_CACHE: dict[str, dict[str, Any]] = {}


class SsoProviderIn(BaseModel):
    type: str = Field("oidc", pattern="^(oidc|saml)$")
    issuer: str = ""
    client_id: str = ""
    client_secret: str = ""
    redirect_uri: str = ""
    scope: str = "openid profile email"
    metadata_url: str = ""
    sso_url: str = ""
    x509_cert: str = ""
    name_id_format: str = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"
    scim_enabled: bool = False
    enabled: bool = True
    tenant_domain_map: dict[str, str] = Field(default_factory=dict)
    role_map: dict[str, str] = Field(default_factory=dict)


class SsoRolePreviewIn(BaseModel):
    email: str = ""
    groups: list[str] = Field(default_factory=list)
    tenant_domain_map: dict[str, str] = Field(default_factory=dict)
    role_map: dict[str, str] = Field(default_factory=dict)


class ScimTokenRotateIn(BaseModel):
    enabled: bool = True


class ScimTestIn(BaseModel):
    userName: str = "scim.user@example.com"
    active: bool = True
    displayName: str = "SCIM User"
    emails: list[dict[str, Any]] = Field(default_factory=list)
    groups: list[dict[str, Any] | str] = Field(default_factory=list)
    apply: bool = False


class SsoRiskTasksIn(TaskOwnerInput):
    dry_run: bool = True
    include_low: bool = False
    limit: int = Field(6, ge=1, le=20)
    priority: str = "P1"
    owner_id: TaskOwnerId = ""
    dev_tool: str = "codex"


class SsoRiskImBriefingIn(BaseModel):
    dry_run: bool = True
    include_low: bool = False
    limit: int = Field(6, ge=1, le=20)
    channels: list[str] = Field(default_factory=list)
    event: str = "sso_risk"
    title: str = ""


class SsoRiskSubscriptionIn(BaseModel):
    enabled: bool = True
    channels: list[str] = Field(default_factory=list)
    min_severity: str = Field("medium", pattern="^(high|medium|low)$")
    score_threshold: int = Field(75, ge=0, le=100)
    frequency: str = Field("daily", pattern="^(hourly|daily|weekly|manual)$")
    include_low: bool = False
    limit: int = Field(6, ge=1, le=20)
    owner: str = "SecurityOps"
    title: str = ""
    event: str = "sso_risk_subscription"


class SsoRiskSubscriptionTestIn(BaseModel):
    dry_run: bool = True
    actor: str = "security-admin"
    force: bool = False


class SsoRiskEscalationPolicyIn(TaskOwnerInput):
    enabled: bool = True
    min_severity: str = Field("high", pattern="^(high|medium|low)$")
    score_threshold: int = Field(70, ge=0, le=100)
    actions: list[str] = Field(default_factory=lambda: ["create_tasks", "send_im"])
    channels: list[str] = Field(default_factory=list)
    priority: str = Field("P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = "codex"
    include_low: bool = False
    limit: int = Field(6, ge=1, le=20)
    cooldown_minutes: int = Field(60, ge=0, le=10080)
    title: str = ""
    owner: str = "SecurityOps"
    notes: str = ""


class SsoRiskEscalationRunIn(BaseModel):
    dry_run: bool = True
    actor: str = "security-admin"
    force: bool = False


class SsoRiskRunbookIn(TaskOwnerInput):
    include_low: bool = False
    limit: int = Field(6, ge=1, le=20)
    priority: str = Field("P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = "codex"
    owner: str = "SecurityOps"
    channels: list[str] = Field(default_factory=list)
    title: str = ""
    notes: str = ""


class SsoRiskRunbookActionIn(TaskOwnerInput):
    action: str = Field(..., pattern="^(preview_tasks|create_tasks|send_im|verify|mark_step_done|mark_step_failed|archive)$")
    actor: str = "security-admin"
    dry_run: bool = True
    step_id: str = ""
    note: str = ""
    include_low: bool = False
    priority: str = Field("P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = "codex"
    channels: list[str] = Field(default_factory=list)
    title: str = ""


def _config_path() -> str:
    base = os.getenv("SOP_RUNTIME_DIR", ".sop-runtime")
    return os.path.join(base, "sso-providers.json")


def _load_runtime_config() -> dict[str, Any]:
    path = _config_path()
    if not os.path.isfile(path):
        return {"providers": {}}
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return data if isinstance(data, dict) else {"providers": {}}
    except Exception:
        return {"providers": {}}


def _save_runtime_config(data: dict[str, Any]) -> None:
    path = _config_path()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, sort_keys=True)


def _mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "***"
    return f"{value[:3]}***{value[-3:]}"


def _hash_secret(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def _safe_provider_name(name: str) -> str:
    out = "".join(c for c in name.strip().lower() if c.isalnum() or c in "-_")[:64]
    if not out:
        raise HTTPException(400, "provider 名称不能为空")
    return out


def _parse_kv_env(raw: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for chunk in (raw or "").replace("\n", ",").split(","):
        item = chunk.strip()
        if not item or "=" not in item:
            continue
        k, v = item.split("=", 1)
        key = k.strip()
        if key:
            out[key] = v.strip()
    return out


def _saml_dependency_status() -> dict[str, Any]:
    try:
        from importlib.metadata import version
        from onelogin.saml2.auth import OneLogin_Saml2_Auth  # type: ignore[import-not-found]

        return {
            "installed": True,
            "package": "python3-saml",
            "version": version("python3-saml"),
            "auth_class": OneLogin_Saml2_Auth.__name__,
        }
    except Exception as e:
        return {
            "installed": False,
            "package": "python3-saml",
            "error": str(e),
            "install_hint": "Install the manager SSO extra: pip install 'sop-manager[sso]' or python3-saml>=1.16.0",
        }


def _scim_base_url(provider: str) -> str:
    base = os.getenv("SOP_PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
    return f"{base}/api/v1/sso/scim/v2/{provider}"


def _scim_public_config(provider: str, cfg: dict[str, Any]) -> dict[str, Any]:
    enabled = bool(cfg.get("scim_enabled")) and bool(cfg.get("scim_token_hash"))
    return {
        "enabled": enabled,
        "base_url": _scim_base_url(provider),
        "users_url": f"{_scim_base_url(provider)}/Users",
        "groups_url": f"{_scim_base_url(provider)}/Groups",
        "token_configured": bool(cfg.get("scim_token_hash")),
        "last_rotated_at": cfg.get("scim_token_rotated_at", ""),
        "supported": ["Users.list", "Users.create", "Users.get", "Users.put", "Users.patch", "Users.delete", "Groups.list", "Groups.get", "Groups.put", "Groups.patch"],
        "readiness": "ready" if enabled else "missing_token",
    }


def _save_provider_runtime_config(provider: str, patch: dict[str, Any]) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    data = _load_runtime_config()
    providers = data.setdefault("providers", {})
    if not isinstance(providers, dict):
        providers = {}
        data["providers"] = providers
    current = providers.get(name, {}) if isinstance(providers.get(name), dict) else {}
    merged = {**current, **patch}
    providers[name] = merged
    _save_runtime_config(data)
    return merged


def _sanitize_scim_audit_value(value: Any, *, depth: int = 0) -> Any:
    if depth > 4:
        return "[truncated]"
    if isinstance(value, dict):
        sanitized: dict[str, Any] = {}
        for key, item in value.items():
            safe_key = str(key)
            lowered = safe_key.lower()
            if any(marker in lowered for marker in ("token", "secret", "password", "x509", "assertion", "samlresponse")):
                sanitized[safe_key] = "***"
            else:
                sanitized[safe_key] = _sanitize_scim_audit_value(item, depth=depth + 1)
        return sanitized
    if isinstance(value, list):
        return [_sanitize_scim_audit_value(item, depth=depth + 1) for item in value[:50]]
    if isinstance(value, tuple) or isinstance(value, set):
        return [_sanitize_scim_audit_value(item, depth=depth + 1) for item in list(value)[:50]]
    if value is None or isinstance(value, bool) or isinstance(value, int) or isinstance(value, float):
        return value
    text = str(value)
    return text if len(text) <= 512 else f"{text[:512]}..."


def _load_scim_audit_events(provider: str) -> list[dict[str, Any]]:
    name = _safe_provider_name(provider)
    runtime = _load_runtime_config().get("providers", {})
    if not isinstance(runtime, dict):
        return []
    row = runtime.get(name, {})
    if not isinstance(row, dict):
        return []
    events = row.get("scim_audit", [])
    return [event for event in events if isinstance(event, dict)] if isinstance(events, list) else []


def _record_scim_audit(
    provider: str,
    event_type: str,
    *,
    actor: str = "scim",
    status: str = "ok",
    subject: str = "",
    details: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    event = {
        "event_id": f"scim-audit-{uuid.uuid4().hex[:16]}",
        "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "provider": name,
        "event_type": str(event_type or "unknown"),
        "actor": str(actor or "scim"),
        "status": str(status or "ok"),
        "subject": str(subject or ""),
        "details": _sanitize_scim_audit_value(details or {}),
    }
    events = _load_scim_audit_events(name)
    events.append(event)
    _save_provider_runtime_config(name, {"scim_audit": events[-200:]})
    return event


def _record_scim_audit_safe(provider: str, event_type: str, **kwargs: Any) -> dict[str, Any]:
    try:
        return _record_scim_audit(provider, event_type, **kwargs)
    except Exception as exc:
        _log.warning("failed to record SCIM audit event provider=%s event=%s error=%s", provider, event_type, exc)
        return {}


def _scim_audit_summary(events: list[dict[str, Any]]) -> dict[str, Any]:
    by_event: dict[str, int] = {}
    by_status: dict[str, int] = {}
    by_actor: dict[str, int] = {}
    skipped = 0
    for event in events:
        event_type = str(event.get("event_type") or "unknown")
        status = str(event.get("status") or "unknown")
        actor = str(event.get("actor") or "unknown")
        by_event[event_type] = by_event.get(event_type, 0) + 1
        by_status[status] = by_status.get(status, 0) + 1
        by_actor[actor] = by_actor.get(actor, 0) + 1
        details = event.get("details")
        if isinstance(details, dict):
            skipped += int(details.get("skipped_count") or 0)
    return {
        "total": len(events),
        "by_event": by_event,
        "by_status": by_status,
        "by_actor": by_actor,
        "failed": by_status.get("error", 0),
        "skipped": skipped,
        "last_event_at": events[-1].get("ts", "") if events else "",
    }


def _parse_utc_ts(raw: str) -> float:
    if not raw:
        return 0.0
    try:
        return float(calendar.timegm(time.strptime(raw.replace("+00:00", "Z"), "%Y-%m-%dT%H:%M:%SZ")))
    except Exception:
        return 0.0


def _risk_finding(kind: str, severity: str, impact: int, *, params: Optional[dict[str, Any]] = None, evidence: Optional[dict[str, Any]] = None) -> dict[str, Any]:
    return {
        "id": f"sso-risk-{kind}",
        "kind": kind,
        "severity": severity,
        "score_impact": impact,
        "params": _sanitize_scim_audit_value(params or {}),
        "evidence": _sanitize_scim_audit_value(evidence or {}),
        "recommendation_key": kind,
    }


def _sso_risk_report(provider: str, cfg: dict[str, Any]) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    findings: list[dict[str, Any]] = []
    provider_type = str(cfg.get("type") or "oidc")
    if provider_type == "oidc":
        missing = [key for key in ("issuer", "client_id", "client_secret") if not str(cfg.get(key) or "").strip()]
        if missing:
            findings.append(_risk_finding("oidc_contract_incomplete", "high", 24, params={"missing": ", ".join(missing)}, evidence={"missing": missing}))
    elif provider_type == "saml":
        readiness = _saml_readiness(name, cfg)
        missing = readiness.get("missing") or []
        if missing:
            severity = "high" if "python3-saml" in missing or "x509_cert or metadata_url" in missing else "medium"
            findings.append(_risk_finding("saml_contract_incomplete", severity, 24 if severity == "high" else 14, params={"missing": ", ".join(missing)}, evidence={"missing": missing}))
    else:
        findings.append(_risk_finding("provider_type_unknown", "high", 30, params={"type": provider_type}))

    tenant_map = _normalize_map(cfg.get("tenant_domain_map", {}))
    role_map = _normalize_map(cfg.get("role_map", {}))
    if not tenant_map:
        findings.append(_risk_finding("tenant_domain_map_missing", "medium", 12, evidence={"tenant_domain_map": tenant_map}))
    if not role_map:
        findings.append(_risk_finding("role_map_missing", "medium", 12, evidence={"role_map": role_map}))
    elif "*" not in role_map:
        findings.append(_risk_finding("role_map_fallback_missing", "low", 6, evidence={"role_map": role_map}))

    scim_enabled = bool(cfg.get("scim_enabled"))
    has_scim_token = bool(cfg.get("scim_token_hash"))
    rotated_at = str(cfg.get("scim_token_rotated_at") or "")
    if not scim_enabled:
        findings.append(_risk_finding("scim_disabled", "low", 5))
    elif not has_scim_token:
        findings.append(_risk_finding("scim_token_missing", "high", 24))
    elif rotated_at:
        rotated_ts = _parse_utc_ts(rotated_at)
        if rotated_ts:
            age_days = int(max((time.time() - rotated_ts) / 86400, 0))
            if age_days >= 180:
                findings.append(_risk_finding("scim_token_critical_age", "high", 22, params={"age_days": age_days}, evidence={"last_rotated_at": rotated_at}))
            elif age_days >= 90:
                findings.append(_risk_finding("scim_token_stale", "medium", 12, params={"age_days": age_days}, evidence={"last_rotated_at": rotated_at}))
        else:
            findings.append(_risk_finding("scim_token_rotation_unknown", "medium", 10, evidence={"last_rotated_at": rotated_at}))

    audit_events = _load_scim_audit_events(name)
    audit_summary = _scim_audit_summary(audit_events)
    if scim_enabled and has_scim_token and not audit_events:
        findings.append(_risk_finding("scim_audit_empty", "low", 4))
    if int(audit_summary.get("failed") or 0) > 0:
        failed = int(audit_summary.get("failed") or 0)
        findings.append(_risk_finding("scim_audit_failures", "high" if failed >= 3 else "medium", 20 if failed >= 3 else 12, params={"count": failed}, evidence={"by_status": audit_summary.get("by_status", {})}))
    if int(audit_summary.get("skipped") or 0) > 0:
        skipped = int(audit_summary.get("skipped") or 0)
        findings.append(_risk_finding("scim_group_skips", "medium", min(18, 8 + skipped), params={"count": skipped}, evidence={"skipped": skipped}))

    score = max(0, 100 - sum(int(item.get("score_impact") or 0) for item in findings))
    status = "healthy" if score >= 85 else "watch" if score >= 65 else "risk"
    by_severity: dict[str, int] = {}
    for item in findings:
        severity = str(item.get("severity") or "unknown")
        by_severity[severity] = by_severity.get(severity, 0) + 1
    action_plan = [
        {
            "order": idx + 1,
            "kind": item["kind"],
            "severity": item["severity"],
            "action_key": item["recommendation_key"],
            "api": f"/api/v1/sso/providers/{name}",
        }
        for idx, item in enumerate(sorted(findings, key=lambda row: {"high": 0, "medium": 1, "low": 2}.get(str(row.get("severity")), 3)))
    ][:6]
    return {
        "ok": True,
        "provider": name,
        "type": provider_type,
        "score": score,
        "status": status,
        "summary": {
            "findings": len(findings),
            "high": by_severity.get("high", 0),
            "medium": by_severity.get("medium", 0),
            "low": by_severity.get("low", 0),
            "audit_events": audit_summary.get("total", 0),
            "audit_failed": audit_summary.get("failed", 0),
            "audit_skipped": audit_summary.get("skipped", 0),
        },
        "findings": findings,
        "action_plan": action_plan,
        "scim_audit": audit_summary,
        "agent_consumption": {
            "surface": "settings.sso.risk",
            "api": f"/api/v1/sso/providers/{name}/risk-report",
            "purpose": "Structured SSO risk report for admins and AI agents to prioritize IdP, SAML, SCIM, and mapping hardening.",
        },
    }


_SSO_RISK_TASK_TEMPLATES: dict[str, dict[str, str]] = {
    "oidc_contract_incomplete": {"title": "补齐 OIDC Provider 契约", "runbook": "补齐 issuer/client_id/client_secret，保存后重新执行连接测试。"},
    "saml_contract_incomplete": {"title": "补齐 SAML Provider 契约", "runbook": "安装/确认 SAML 依赖，补齐 IdP SSO URL、Metadata 或 X.509 证书，并重新验证 SP Metadata/ACS。"},
    "provider_type_unknown": {"title": "修正 SSO Provider 类型", "runbook": "将 Provider 类型调整为 oidc 或 saml，并重新保存配置。"},
    "tenant_domain_map_missing": {"title": "配置 SSO 租户域名映射", "runbook": "按企业邮箱域名配置 tenant_domain_map，避免 JIT/SCIM 用户落入默认租户。"},
    "role_map_missing": {"title": "配置 IdP 组到平台角色映射", "runbook": "补齐 role_map，并使用登录映射预览验证 tenant_admin/devops/developer/viewer 等角色。"},
    "role_map_fallback_missing": {"title": "配置 SSO 角色兜底映射", "runbook": "为 role_map 增加 * 兜底角色，建议使用 developer 或 viewer。"},
    "scim_disabled": {"title": "评估并启用 SCIM 自动开通", "runbook": "如需 IdP 驱动账号生命周期，启用 SCIM 并完成 Token 配置。"},
    "scim_token_missing": {"title": "轮换并配置 SCIM Token", "runbook": "生成一次性 SCIM Token，立即配置到 IdP，并确认 ServiceProviderConfig 可访问。"},
    "scim_token_critical_age": {"title": "立即轮换过期 SCIM Token", "runbook": "轮换 SCIM Token，更新 IdP Bearer Token，并记录变更审计。"},
    "scim_token_stale": {"title": "安排 SCIM Token 轮换", "runbook": "在本期安全维护窗口内轮换 SCIM Token，并确认同步恢复。"},
    "scim_token_rotation_unknown": {"title": "恢复 SCIM Token 轮换时间审计", "runbook": "重新轮换 SCIM Token，使平台恢复可审计的 last_rotated_at。"},
    "scim_audit_empty": {"title": "验证 SCIM 审计链路", "runbook": "从 IdP 或 Settings 执行一次 dry-run/同步测试，确认 SCIM 审计报表有事件。"},
    "scim_audit_failures": {"title": "修复 SCIM 同步失败事件", "runbook": "查看 SCIM 审计报表失败事件，修正 IdP payload、租户域名映射或角色映射。"},
    "scim_group_skips": {"title": "治理 SCIM Groups 跳过成员", "runbook": "检查被跳过成员是否跨租户、已删除或为 super_admin，并修正 IdP 组成员。"},
}


def _sso_risk_task_payload(provider: str, finding: dict[str, Any], body: SsoRiskTasksIn) -> dict[str, Any]:
    kind = str(finding.get("kind") or "unknown")
    severity = str(finding.get("severity") or "medium")
    template = _SSO_RISK_TASK_TEMPLATES.get(kind, {"title": f"治理 SSO 风险 {kind}", "runbook": "按风险报表 evidence 修复配置后重新刷新风险报表。"})
    priority = "P0" if severity == "high" else "P2" if severity == "low" else body.priority
    params = finding.get("params") if isinstance(finding.get("params"), dict) else {}
    evidence = finding.get("evidence") if isinstance(finding.get("evidence"), dict) else {}
    return {
        "title": f"SSO治理：{template['title']}（{provider}）",
        "description": "\n".join([
            template["runbook"],
            "",
            f"Provider: {provider}",
            f"风险类型: {kind}",
            f"风险等级: {severity}",
            f"影响分: {finding.get('score_impact')}",
            f"参数: {json.dumps(params, ensure_ascii=False, sort_keys=True)}",
            f"证据: {json.dumps(evidence, ensure_ascii=False, sort_keys=True)}",
            "",
            "验证路径:",
            f"- GET /api/v1/sso/providers/{provider}/risk-report",
            f"- GET /api/v1/sso/providers/{provider}/scim/audit",
            "- Settings > 企业 SSO > SSO 风险报表",
        ]),
        "priority": priority if priority in {"P0", "P1", "P2", "P3"} else "P1",
        "estimate": "S" if severity == "low" else "M",
        "owner_id": body.owner_id,
        "dev_tool": body.dev_tool or "codex",
        "source": "sso_risk_governance",
        "source_report_id": str(finding.get("id") or kind),
        "source_report_title": template["title"],
        "artifact_path": "docs/architecture/HERMES_PLATFORM_LATEST_ARCHITECTURE.md",
    }


def _sso_risk_tasks(provider: str, cfg: dict[str, Any], body: SsoRiskTasksIn) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    report = _sso_risk_report(name, cfg)
    severity_rank = {"high": 0, "medium": 1, "low": 2}
    findings = [
        item for item in report.get("findings", [])
        if body.include_low or str(item.get("severity") or "") != "low"
    ]
    findings = sorted(findings, key=lambda item: (severity_rank.get(str(item.get("severity")), 3), str(item.get("kind"))))[: body.limit]
    planned = [_sso_risk_task_payload(name, item, body) for item in findings]
    created: list[dict[str, Any]] = []
    if not body.dry_run:
        for item in planned:
            created.append(create_task(TaskCreate(**item)))
            time.sleep(0.001)
    return {
        "ok": True,
        "provider": name,
        "dry_run": body.dry_run,
        "risk": {"score": report.get("score"), "status": report.get("status"), "summary": report.get("summary", {})},
        "items": planned,
        "created": created,
        "summary": {
            "planned": len(planned),
            "created": len(created),
            "skipped_low": len(report.get("findings", [])) - len(findings) if not body.include_low else 0,
        },
        "agent_consumption": {
            "surface": "settings.sso.risk.tasks",
            "source": "sso_risk_governance",
            "api": f"/api/v1/sso/providers/{name}/risk-tasks",
            "purpose": "Turn structured SSO risk findings into executable governance tasks for humans and AI agents.",
        },
    }


def _sso_risk_im_briefing(provider: str, cfg: dict[str, Any], body: SsoRiskImBriefingIn) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    report = _sso_risk_report(name, cfg)
    findings = [
        item for item in report.get("findings", [])
        if body.include_low or str(item.get("severity") or "") != "low"
    ][: body.limit]
    summary = dict(report.get("summary", {}) if isinstance(report.get("summary"), dict) else {})
    summary.update({
        "health_score": report.get("score", 0),
        "status": report.get("status", ""),
        "provider": name,
        "type": report.get("type", ""),
    })
    risks = [
        {
            "level": "high" if str(item.get("severity")) == "high" else "medium" if str(item.get("severity")) == "medium" else "low",
            "title": str(item.get("kind") or item.get("id") or "sso_risk"),
            "recommendation": str(item.get("recommendation_key") or item.get("kind") or ""),
            "kind": item.get("kind"),
            "params": item.get("params") if isinstance(item.get("params"), dict) else {},
        }
        for item in findings
    ]
    recommendations = [
        str(item.get("action_key") or item.get("kind") or "")
        for item in report.get("action_plan", [])
        if body.include_low or str(item.get("severity") or "") != "low"
    ][: body.limit]
    briefing = build_im_briefing(
        module="sso",
        title=body.title or f"SSO Risk Briefing: {name}",
        summary=summary,
        risks=risks,
        recommendations=recommendations,
        scope={"provider": name, "surface": "settings.sso.risk"},
        actions=[
            {"label": "Open SSO Settings", "href": "#/settings/sso"},
            {"label": "Risk report API", "api": f"/api/v1/sso/providers/{name}/risk-report"},
            {"label": "Risk tasks API", "api": f"/api/v1/sso/providers/{name}/risk-tasks"},
        ],
    )
    from sop_manager.routers.notify import NotifyMsg, list_channels, send_msg

    channels = list_channels()
    plan = build_im_delivery_plan(briefing, channels, requested_channels=body.channels, event=body.event or "sso_risk")
    if body.dry_run:
        return {
            "ok": True,
            "provider": name,
            "dry_run": True,
            "risk": {"score": report.get("score"), "status": report.get("status"), "summary": report.get("summary", {})},
            "briefing": briefing,
            "delivery_plan": plan,
            "sent": [],
            "agent_consumption": {
                "surface": "settings.sso.risk.im",
                "api": f"/api/v1/sso/providers/{name}/risk-im-briefing",
                "purpose": "Preview SSO risk IM notifications using Notify channel policy before sending.",
            },
        }
    sent = [
        send_msg(NotifyMsg(channel=msg["channel"], title=msg["title"], content=msg["content"], level=msg["level"]))
        for msg in plan.get("messages", [])
    ]
    audit = {
        "provider": name,
        "event": body.event or "sso_risk",
        "delivery_audit": plan.get("audit", {}),
        "sent_count": len(sent),
        "ok_count": sum(1 for item in sent if isinstance(item, dict) and item.get("ok") is not False),
        "failed_count": sum(1 for item in sent if isinstance(item, dict) and item.get("ok") is False),
    }
    try:
        from sop_manager.routers.audit_chain import append_audit

        append_audit(
            "sso.risk.im_briefing",
            resource_type="sso_provider",
            resource_id=name,
            details=audit,
        )
    except Exception:
        pass
    return {
        "ok": True,
        "provider": name,
        "dry_run": False,
        "risk": {"score": report.get("score"), "status": report.get("status"), "summary": report.get("summary", {})},
        "briefing": briefing,
        "delivery_plan": plan,
        "sent": sent,
        "audit": audit,
        "agent_consumption": {
            "surface": "settings.sso.risk.im",
            "api": f"/api/v1/sso/providers/{name}/risk-im-briefing",
            "purpose": "Send SSO risk briefings through configured enterprise IM channels with delivery audit.",
        },
    }


def _default_sso_risk_subscription() -> dict[str, Any]:
    return {
        "enabled": False,
        "channels": [],
        "min_severity": "medium",
        "score_threshold": 75,
        "frequency": "daily",
        "include_low": False,
        "limit": 6,
        "owner": "SecurityOps",
        "title": "",
        "event": "sso_risk_subscription",
        "last_sent_at": "",
        "updated_at": "",
        "updated_by": "",
    }


def _public_sso_risk_subscription(raw: dict[str, Any] | None) -> dict[str, Any]:
    merged = {**_default_sso_risk_subscription(), **(raw or {})}
    channels = merged.get("channels", [])
    if not isinstance(channels, list):
        channels = []
    return {
        "enabled": bool(merged.get("enabled", False)),
        "channels": [str(item) for item in channels if str(item).strip()],
        "min_severity": str(merged.get("min_severity") or "medium"),
        "score_threshold": int(merged.get("score_threshold") or 75),
        "frequency": str(merged.get("frequency") or "daily"),
        "include_low": bool(merged.get("include_low", False)),
        "limit": int(merged.get("limit") or 6),
        "owner": str(merged.get("owner") or "SecurityOps"),
        "title": str(merged.get("title") or ""),
        "event": str(merged.get("event") or "sso_risk_subscription"),
        "last_sent_at": str(merged.get("last_sent_at") or ""),
        "updated_at": str(merged.get("updated_at") or ""),
        "updated_by": str(merged.get("updated_by") or ""),
    }


def _sso_risk_subscription_history(provider: str, limit: int = 20) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    runtime = _load_runtime_config().get("providers", {})
    cfg = runtime.get(name, {}) if isinstance(runtime, dict) and isinstance(runtime.get(name), dict) else {}
    items = cfg.get("risk_subscription_history", []) if isinstance(cfg, dict) else []
    rows = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
    return {"items": rows[: max(1, min(limit, 100))], "total": len(rows)}


def _append_sso_risk_subscription_history(provider: str, row: dict[str, Any]) -> None:
    name = _safe_provider_name(provider)
    data = _load_runtime_config()
    providers = data.setdefault("providers", {})
    if not isinstance(providers, dict):
        providers = {}
        data["providers"] = providers
    cfg = providers.get(name, {}) if isinstance(providers.get(name), dict) else {}
    history = cfg.get("risk_subscription_history", []) if isinstance(cfg.get("risk_subscription_history"), list) else []
    cfg["risk_subscription_history"] = [row, *[item for item in history if isinstance(item, dict)]][:100]
    providers[name] = cfg
    _save_runtime_config(data)


def _sso_risk_subscription_triggered(report: dict[str, Any], subscription: dict[str, Any], *, force: bool = False) -> tuple[bool, str]:
    if force:
        return True, "forced"
    if not subscription.get("enabled"):
        return False, "subscription_disabled"
    score = int(report.get("score") or 0)
    if score <= int(subscription.get("score_threshold") or 75):
        return True, "score_threshold"
    severity_rank = {"high": 3, "medium": 2, "low": 1}
    minimum = severity_rank.get(str(subscription.get("min_severity") or "medium"), 2)
    for finding in report.get("findings", []):
        if not isinstance(finding, dict):
            continue
        if severity_rank.get(str(finding.get("severity") or ""), 0) >= minimum:
            return True, "severity_threshold"
    return False, "no_matching_risk"


def _run_sso_risk_subscription(provider: str, cfg: dict[str, Any], body: SsoRiskSubscriptionTestIn) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    runtime = _load_runtime_config().get("providers", {})
    runtime_cfg = runtime.get(name, {}) if isinstance(runtime, dict) and isinstance(runtime.get(name), dict) else {}
    subscription = _public_sso_risk_subscription(runtime_cfg.get("risk_subscription") if isinstance(runtime_cfg, dict) else {})
    report = _sso_risk_report(name, cfg)
    triggered, reason = _sso_risk_subscription_triggered(report, subscription, force=body.force)
    briefing_body = SsoRiskImBriefingIn(
        dry_run=True,
        include_low=subscription["include_low"],
        limit=subscription["limit"],
        channels=subscription["channels"],
        event=subscription["event"],
        title=subscription["title"] or f"SSO Risk Subscription: {name}",
    )
    preview = _sso_risk_im_briefing(name, cfg, briefing_body)
    if body.dry_run or not triggered:
        return {
            "ok": True,
            "provider": name,
            "dry_run": body.dry_run,
            "triggered": triggered,
            "reason": reason,
            "subscription": subscription,
            "risk": {"score": report.get("score"), "status": report.get("status"), "summary": report.get("summary", {})},
            "briefing": preview.get("briefing"),
            "delivery_plan": preview.get("delivery_plan"),
            "sent": [],
            "audit": {"sent_count": 0, "skipped": not triggered, "reason": reason},
            "agent_consumption": {
                "surface": "settings.sso.risk.subscription",
                "api": f"/api/v1/sso/providers/{name}/risk-subscription/test",
                "purpose": "Preview scheduled SSO risk subscription delivery decisions before automatic or manual sends.",
            },
        }
    sent_result = _sso_risk_im_briefing(
        name,
        cfg,
        SsoRiskImBriefingIn(
            dry_run=False,
            include_low=subscription["include_low"],
            limit=subscription["limit"],
            channels=subscription["channels"],
            event=subscription["event"],
            title=subscription["title"] or f"SSO Risk Subscription: {name}",
        ),
    )
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    audit = {
        "id": f"sso-risk-sub-{uuid.uuid4().hex[:10]}",
        "provider": name,
        "actor": body.actor,
        "created_at": now,
        "triggered": True,
        "reason": reason,
        "score": report.get("score"),
        "status": report.get("status"),
        "channels": subscription["channels"],
        "sent_count": sent_result.get("audit", {}).get("sent_count", 0) if isinstance(sent_result.get("audit"), dict) else 0,
        "ok_count": sent_result.get("audit", {}).get("ok_count", 0) if isinstance(sent_result.get("audit"), dict) else 0,
        "failed_count": sent_result.get("audit", {}).get("failed_count", 0) if isinstance(sent_result.get("audit"), dict) else 0,
    }
    _append_sso_risk_subscription_history(name, audit)
    runtime_cfg["risk_subscription"] = {**subscription, "last_sent_at": now}
    _save_provider_runtime_config(name, runtime_cfg)
    try:
        from sop_manager.routers.audit_chain import append_audit

        append_audit("sso.risk.subscription.send", resource_type="sso_provider", resource_id=name, details=audit)
    except Exception:
        pass
    return {
        **sent_result,
        "dry_run": False,
        "triggered": True,
        "reason": reason,
        "subscription": _public_sso_risk_subscription(runtime_cfg.get("risk_subscription")),
        "audit": audit,
        "agent_consumption": {
            "surface": "settings.sso.risk.subscription",
            "api": f"/api/v1/sso/providers/{name}/risk-subscription/test",
            "purpose": "Send configured SSO risk subscription digests and keep delivery audit history.",
        },
    }


def _default_sso_risk_escalation_policy() -> dict[str, Any]:
    return {
        "enabled": False,
        "min_severity": "high",
        "score_threshold": 70,
        "actions": ["create_tasks", "send_im"],
        "channels": [],
        "priority": "P1",
        "owner_id": "",
        "dev_tool": "codex",
        "include_low": False,
        "limit": 6,
        "cooldown_minutes": 60,
        "title": "",
        "owner": "SecurityOps",
        "notes": "",
        "last_run_at": "",
        "last_triggered_at": "",
        "updated_at": "",
        "updated_by": "",
    }


def _public_sso_risk_escalation_policy(raw: dict[str, Any] | None) -> dict[str, Any]:
    merged = {**_default_sso_risk_escalation_policy(), **(raw or {})}
    channels = merged.get("channels", [])
    actions = merged.get("actions", [])
    if not isinstance(channels, list):
        channels = []
    if not isinstance(actions, list):
        actions = []
    allowed_actions = {"create_tasks", "send_im"}
    selected_actions = [str(item) for item in actions if str(item) in allowed_actions]
    if not selected_actions:
        selected_actions = ["create_tasks"]
    severity = str(merged.get("min_severity") or "high")
    if severity not in {"high", "medium", "low"}:
        severity = "high"
    priority = str(merged.get("priority") or "P1")
    if priority not in {"P0", "P1", "P2", "P3"}:
        priority = "P1"
    return {
        "enabled": bool(merged.get("enabled", False)),
        "min_severity": severity,
        "score_threshold": max(0, min(int(merged.get("score_threshold") or 70), 100)),
        "actions": selected_actions,
        "channels": [str(item) for item in channels if str(item).strip()],
        "priority": priority,
        "owner_id": str(merged.get("owner_id") or ""),
        "dev_tool": str(merged.get("dev_tool") or "codex"),
        "include_low": bool(merged.get("include_low", False)),
        "limit": max(1, min(int(merged.get("limit") or 6), 20)),
        "cooldown_minutes": max(0, min(int(merged.get("cooldown_minutes") or 0), 10080)),
        "title": str(merged.get("title") or ""),
        "owner": str(merged.get("owner") or "SecurityOps"),
        "notes": str(merged.get("notes") or ""),
        "last_run_at": str(merged.get("last_run_at") or ""),
        "last_triggered_at": str(merged.get("last_triggered_at") or ""),
        "updated_at": str(merged.get("updated_at") or ""),
        "updated_by": str(merged.get("updated_by") or ""),
    }


def _sso_risk_escalation_history(provider: str, limit: int = 20) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    runtime = _load_runtime_config().get("providers", {})
    cfg = runtime.get(name, {}) if isinstance(runtime, dict) and isinstance(runtime.get(name), dict) else {}
    items = cfg.get("risk_escalation_history", []) if isinstance(cfg, dict) else []
    rows = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
    return {"items": rows[: max(1, min(limit, 100))], "total": len(rows)}


def _append_sso_risk_escalation_history(provider: str, row: dict[str, Any]) -> None:
    name = _safe_provider_name(provider)
    data = _load_runtime_config()
    providers = data.setdefault("providers", {})
    if not isinstance(providers, dict):
        providers = {}
        data["providers"] = providers
    cfg = providers.get(name, {}) if isinstance(providers.get(name), dict) else {}
    history = cfg.get("risk_escalation_history", []) if isinstance(cfg.get("risk_escalation_history"), list) else []
    cfg["risk_escalation_history"] = [row, *[item for item in history if isinstance(item, dict)]][:100]
    providers[name] = cfg
    _save_runtime_config(data)


def _sso_risk_escalation_triggered(report: dict[str, Any], policy: dict[str, Any], *, force: bool = False) -> tuple[bool, str]:
    if force:
        return True, "forced"
    if not policy.get("enabled"):
        return False, "policy_disabled"
    if str(policy.get("last_triggered_at") or "") and int(policy.get("cooldown_minutes") or 0) > 0:
        last_ts = _parse_utc_ts(str(policy.get("last_triggered_at") or ""))
        if last_ts and (time.time() - last_ts) < int(policy.get("cooldown_minutes") or 0) * 60:
            return False, "cooldown"
    score = int(report.get("score") or 0)
    if score <= int(policy.get("score_threshold") or 70):
        return True, "score_threshold"
    severity_rank = {"high": 3, "medium": 2, "low": 1}
    minimum = severity_rank.get(str(policy.get("min_severity") or "high"), 3)
    for finding in report.get("findings", []):
        if not isinstance(finding, dict):
            continue
        if severity_rank.get(str(finding.get("severity") or ""), 0) >= minimum:
            return True, "severity_threshold"
    return False, "no_matching_risk"


def _run_sso_risk_escalation(provider: str, cfg: dict[str, Any], body: SsoRiskEscalationRunIn) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    runtime = _load_runtime_config().get("providers", {})
    runtime_cfg = runtime.get(name, {}) if isinstance(runtime, dict) and isinstance(runtime.get(name), dict) else {}
    policy = _public_sso_risk_escalation_policy(runtime_cfg.get("risk_escalation") if isinstance(runtime_cfg, dict) else {})
    report = _sso_risk_report(name, cfg)
    triggered, reason = _sso_risk_escalation_triggered(report, policy, force=body.force)
    actions = policy["actions"] if triggered else []
    task_result: dict[str, Any] | None = None
    im_result: dict[str, Any] | None = None
    if "create_tasks" in actions:
        task_result = _sso_risk_tasks(
            name,
            cfg,
            SsoRiskTasksIn(
                dry_run=body.dry_run,
                include_low=policy["include_low"],
                limit=policy["limit"],
                priority=policy["priority"],
                owner_id=policy["owner_id"],
                dev_tool=policy["dev_tool"],
            ),
        )
    if "send_im" in actions:
        im_result = _sso_risk_im_briefing(
            name,
            cfg,
            SsoRiskImBriefingIn(
                dry_run=body.dry_run,
                include_low=policy["include_low"],
                limit=policy["limit"],
                channels=policy["channels"],
                event="sso_risk_escalation",
                title=policy["title"] or f"SSO Risk Auto Escalation: {name}",
            ),
        )
    created_count = int((task_result or {}).get("summary", {}).get("created", 0)) if isinstance((task_result or {}).get("summary"), dict) else 0
    planned_count = int((task_result or {}).get("summary", {}).get("planned", 0)) if isinstance((task_result or {}).get("summary"), dict) else 0
    sent_count = int((im_result or {}).get("audit", {}).get("sent_count", 0)) if isinstance((im_result or {}).get("audit"), dict) else 0
    target_count = int((im_result or {}).get("delivery_plan", {}).get("target_count", 0)) if isinstance((im_result or {}).get("delivery_plan"), dict) else 0
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    audit = {
        "id": f"sso-risk-esc-{uuid.uuid4().hex[:10]}",
        "provider": name,
        "actor": body.actor,
        "created_at": now,
        "dry_run": body.dry_run,
        "triggered": triggered,
        "reason": reason,
        "score": report.get("score"),
        "status": report.get("status"),
        "actions": actions,
        "planned_count": planned_count,
        "created_count": created_count,
        "target_count": target_count,
        "sent_count": sent_count,
    }
    if not body.dry_run:
        updated_policy = {**policy, "last_run_at": now}
        if triggered:
            updated_policy["last_triggered_at"] = now
        runtime_cfg["risk_escalation"] = updated_policy
        _save_provider_runtime_config(name, runtime_cfg)
        _append_sso_risk_escalation_history(name, audit)
        try:
            from sop_manager.routers.audit_chain import append_audit

            append_audit("sso.risk.escalation.run", resource_type="sso_provider", resource_id=name, details=audit)
        except Exception:
            pass
        policy = _public_sso_risk_escalation_policy(updated_policy)
    return {
        "ok": True,
        "provider": name,
        "dry_run": body.dry_run,
        "triggered": triggered,
        "reason": reason,
        "actions": actions,
        "policy": policy,
        "risk": {"score": report.get("score"), "status": report.get("status"), "summary": report.get("summary", {})},
        "task_result": task_result,
        "im_result": im_result,
        "audit": audit,
        "history": _sso_risk_escalation_history(name),
        "agent_consumption": {
            "surface": "settings.sso.risk.escalation",
            "api": f"/api/v1/sso/providers/{name}/risk-escalation/run",
            "purpose": "Apply configurable SSO risk escalation policies that can create governance tasks and notify enterprise IM channels.",
        },
    }


def _sso_risk_runbooks(provider: str, limit: int = 20) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    runtime = _load_runtime_config().get("providers", {})
    cfg = runtime.get(name, {}) if isinstance(runtime, dict) and isinstance(runtime.get(name), dict) else {}
    items = cfg.get("risk_runbooks", []) if isinstance(cfg, dict) else []
    rows = [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
    return {"items": rows[: max(1, min(int(limit or 20), 100))], "total": len(rows)}


def _save_sso_risk_runbook(provider: str, runbook: dict[str, Any]) -> None:
    name = _safe_provider_name(provider)
    data = _load_runtime_config()
    providers = data.setdefault("providers", {})
    if not isinstance(providers, dict):
        providers = {}
        data["providers"] = providers
    cfg = providers.get(name, {}) if isinstance(providers.get(name), dict) else {}
    items = [item for item in cfg.get("risk_runbooks", []) if isinstance(item, dict)] if isinstance(cfg.get("risk_runbooks"), list) else []
    cfg["risk_runbooks"] = [runbook if item.get("id") == runbook.get("id") else item for item in items]
    if not any(item.get("id") == runbook.get("id") for item in items):
        cfg["risk_runbooks"] = [runbook, *items]
    cfg["risk_runbooks"] = cfg["risk_runbooks"][:100]
    providers[name] = cfg
    _save_runtime_config(data)


def _find_sso_risk_runbook(provider: str, runbook_id: str) -> dict[str, Any]:
    items = _sso_risk_runbooks(provider, limit=100)["items"]
    for item in items:
        if isinstance(item, dict) and item.get("id") == runbook_id:
            return item
    raise HTTPException(404, f"unknown SSO risk runbook: {runbook_id}")


def _sso_risk_runbook_step(step_id: str, title: str, kind: str, owner: str, status: str = "pending", evidence: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": step_id,
        "title": title,
        "kind": kind,
        "owner": owner or "SecurityOps",
        "status": status,
        "evidence": evidence or {},
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }


def _sso_risk_runbook_event(kind: str, actor: str, note: str = "", extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "id": f"evt-{uuid.uuid4().hex[:10]}",
        "kind": kind,
        "actor": actor or "security-admin",
        "note": note,
        "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "extra": extra or {},
    }


def _sso_risk_runbook_counts(steps: list[dict[str, Any]]) -> dict[str, int]:
    rows = [step for step in steps if isinstance(step, dict)]
    return {
        "step_total": len(rows),
        "step_done": len([step for step in rows if step.get("status") in {"completed", "skipped"}]),
        "step_pending": len([step for step in rows if step.get("status") == "pending"]),
        "step_failed": len([step for step in rows if step.get("status") == "failed"]),
    }


def _sso_risk_runbook_status(steps: list[dict[str, Any]], archived: bool = False) -> str:
    if archived:
        return "archived"
    counts = _sso_risk_runbook_counts(steps)
    if counts["step_failed"]:
        return "risk"
    if counts["step_pending"] == 0:
        return "verified"
    return "draft"


def _public_sso_risk_runbook(item: dict[str, Any]) -> dict[str, Any]:
    steps = item.get("steps", []) if isinstance(item.get("steps"), list) else []
    counts = _sso_risk_runbook_counts(steps)
    return {
        "id": item.get("id", ""),
        "provider": item.get("provider", ""),
        "type": item.get("type", ""),
        "title": item.get("title", ""),
        "status": item.get("status", ""),
        "risk_score": item.get("risk", {}).get("score", 0) if isinstance(item.get("risk"), dict) else 0,
        "risk_status": item.get("risk", {}).get("status", "") if isinstance(item.get("risk"), dict) else "",
        "finding_count": len(item.get("findings", [])) if isinstance(item.get("findings"), list) else 0,
        "task_count": len(item.get("task_ids", [])) if isinstance(item.get("task_ids"), list) else 0,
        "owner": item.get("owner", ""),
        "created_at": item.get("created_at", ""),
        "updated_at": item.get("updated_at", ""),
        "notes": item.get("notes", ""),
        **counts,
    }


def _sso_risk_runbook_findings(report: dict[str, Any], body: SsoRiskRunbookIn) -> list[dict[str, Any]]:
    severity_rank = {"high": 0, "medium": 1, "low": 2}
    findings = [
        item for item in report.get("findings", [])
        if body.include_low or str(item.get("severity") or "") != "low"
    ]
    return sorted(findings, key=lambda item: (severity_rank.get(str(item.get("severity")), 3), str(item.get("kind"))))[: body.limit]


def _sso_risk_runbook_steps(provider: str, report: dict[str, Any], body: SsoRiskRunbookIn) -> list[dict[str, Any]]:
    findings = _sso_risk_runbook_findings(report, body)
    steps = [
        _sso_risk_runbook_step(
            "snapshot_risk_report",
            "Capture SSO risk report snapshot",
            "snapshot",
            body.owner,
            status="completed",
            evidence={"score": report.get("score"), "status": report.get("status"), "api": f"/api/v1/sso/providers/{provider}/risk-report"},
        )
    ]
    for idx, finding in enumerate(findings, start=1):
        kind = str(finding.get("kind") or f"finding_{idx}")
        template = _SSO_RISK_TASK_TEMPLATES.get(kind, {"title": f"治理 SSO 风险 {kind}", "runbook": "按风险报表 evidence 修复配置后重新刷新风险报表。"})
        steps.append(_sso_risk_runbook_step(
            f"remediate_{kind}",
            template["title"],
            kind,
            body.owner_id,
            evidence={
                "finding_id": finding.get("id") or kind,
                "severity": finding.get("severity"),
                "score_impact": finding.get("score_impact"),
                "params": finding.get("params") if isinstance(finding.get("params"), dict) else {},
                "runbook": template["runbook"],
            },
        ))
    steps.extend([
        _sso_risk_runbook_step("verify_sso_config", "Re-run SSO provider risk report and connection checks", "verification", body.owner, evidence={"api": f"/api/v1/sso/providers/{provider}/risk-report"}),
        _sso_risk_runbook_step("notify_security_channels", "Notify security and platform stakeholders", "notification", body.owner, evidence={"channels": body.channels}),
        _sso_risk_runbook_step("archive_evidence", "Archive remediation evidence and follow-up tasks", "archive", body.owner),
    ])
    return steps


def _create_sso_risk_runbook(provider: str, cfg: dict[str, Any], body: SsoRiskRunbookIn) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    report = _sso_risk_report(name, cfg)
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    runbook_id = f"sso-risk-runbook-{int(time.time())}-{uuid.uuid4().hex[:8]}"
    findings = _sso_risk_runbook_findings(report, body)
    steps = _sso_risk_runbook_steps(name, report, body)
    row = {
        "id": runbook_id,
        "provider": name,
        "type": report.get("type", ""),
        "title": body.title or f"SSO Risk Runbook: {name}",
        "status": _sso_risk_runbook_status(steps),
        "owner": body.owner or "SecurityOps",
        "owner_id": body.owner_id,
        "priority": body.priority,
        "dev_tool": body.dev_tool or "codex",
        "channels": body.channels,
        "include_low": body.include_low,
        "limit": body.limit,
        "notes": body.notes,
        "risk": {"score": report.get("score"), "status": report.get("status"), "summary": report.get("summary", {})},
        "findings": findings,
        "action_plan": report.get("action_plan", []),
        "steps": steps,
        "task_ids": [],
        "created_at": now,
        "updated_at": now,
        "events": [_sso_risk_runbook_event("created", body.owner, body.notes, {"score": report.get("score"), "status": report.get("status")})],
        "agent_consumption": {
            "surface": "settings.sso.risk.runbook",
            "api": f"/api/v1/sso/providers/{name}/risk-runbooks",
            "purpose": "Generate a reusable, taskable SSO risk remediation runbook from structured risk findings, IM channels, and verification gates.",
        },
    }
    _save_sso_risk_runbook(name, row)
    try:
        from sop_manager.routers.audit_chain import append_audit

        append_audit("sso.risk.runbook.create", resource_type="sso_provider", resource_id=name, details={"runbook_id": runbook_id, "risk": row["risk"]})
    except Exception:
        pass
    return row


def _sso_risk_runbook_task_plan(runbook: dict[str, Any], body: SsoRiskRunbookActionIn) -> list[dict[str, Any]]:
    priority = body.priority or str(runbook.get("priority") or "P1")
    assignee = body.owner_id or str(runbook.get("owner_id") or "")
    dev_tool = body.dev_tool or str(runbook.get("dev_tool") or "codex")
    tasks: list[dict[str, Any]] = []
    for step in runbook.get("steps", []) if isinstance(runbook.get("steps"), list) else []:
        if not isinstance(step, dict):
            continue
        if step.get("status") == "completed":
            continue
        evidence = step.get("evidence") if isinstance(step.get("evidence"), dict) else {}
        if step.get("kind") == "notification" and not body.include_low:
            continue
        step_priority = "P0" if evidence.get("severity") == "high" else priority
        tasks.append({
            "title": f"SSO Runbook：{step.get('title') or step.get('id')}（{runbook.get('provider')}）"[:200],
            "description": "\n".join([
                f"Runbook: {runbook.get('id')}",
                f"Provider: {runbook.get('provider')}",
                f"Step: {step.get('id')}",
                f"Kind: {step.get('kind')}",
                f"Evidence: {json.dumps(evidence, ensure_ascii=False, sort_keys=True)}",
                body.note or str(runbook.get("notes") or ""),
            ]),
            "priority": step_priority if step_priority in {"P0", "P1", "P2", "P3"} else "P1",
            "estimate": "S" if evidence.get("severity") == "low" else "M",
            "owner_id": assignee,
            "dev_tool": dev_tool,
            "source": "sso_risk_runbook",
            "source_report_id": str(runbook.get("id") or ""),
            "source_report_title": str(runbook.get("title") or "SSO risk runbook"),
            "artifact_path": "docs/architecture/HERMES_PLATFORM_LATEST_ARCHITECTURE.md",
        })
    return tasks[:20]


def _apply_sso_risk_runbook_action(provider: str, cfg: dict[str, Any], runbook: dict[str, Any], body: SsoRiskRunbookActionIn) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    action = body.action
    actor = body.actor or "security-admin"
    result: dict[str, Any] = {}
    if runbook.get("status") == "archived" and action != "archive":
        raise HTTPException(409, "SSO risk runbook already archived")
    if action in {"preview_tasks", "create_tasks"}:
        planned = _sso_risk_runbook_task_plan(runbook, body)
        result["planned"] = planned
        result["created"] = []
        if action == "create_tasks" and not body.dry_run:
            for item in planned:
                result["created"].append(create_task(TaskCreate(**item)))
                time.sleep(0.001)
            task_ids = [str(item.get("id") or "") for item in result["created"] if isinstance(item, dict) and item.get("id")]
            runbook["task_ids"] = [*(runbook.get("task_ids", []) if isinstance(runbook.get("task_ids"), list) else []), *task_ids]
    elif action == "send_im":
        im_result = _sso_risk_im_briefing(
            name,
            cfg,
            SsoRiskImBriefingIn(
                dry_run=body.dry_run,
                include_low=body.include_low or bool(runbook.get("include_low")),
                limit=int(runbook.get("limit") or 6),
                channels=body.channels or (runbook.get("channels", []) if isinstance(runbook.get("channels"), list) else []),
                event="sso_risk_runbook",
                title=body.title or str(runbook.get("title") or f"SSO Risk Runbook: {name}"),
            ),
        )
        result["im"] = im_result
        if not body.dry_run:
            for step in runbook.get("steps", []) if isinstance(runbook.get("steps"), list) else []:
                if isinstance(step, dict) and step.get("id") == "notify_security_channels":
                    step["status"] = "completed"
                    step["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                    step["evidence"] = {**(step.get("evidence") if isinstance(step.get("evidence"), dict) else {}), "sent_count": im_result.get("audit", {}).get("sent_count", 0) if isinstance(im_result.get("audit"), dict) else 0}
    elif action in {"mark_step_done", "mark_step_failed"}:
        if not body.step_id:
            raise HTTPException(400, "step_id is required")
        found = False
        for step in runbook.get("steps", []) if isinstance(runbook.get("steps"), list) else []:
            if isinstance(step, dict) and step.get("id") == body.step_id:
                step["status"] = "completed" if action == "mark_step_done" else "failed"
                step["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                step["note"] = body.note
                found = True
                break
        if not found:
            raise HTTPException(404, f"unknown runbook step: {body.step_id}")
    elif action == "verify":
        report = _sso_risk_report(name, cfg)
        ok = int(report.get("score") or 0) >= 85 and int(report.get("summary", {}).get("high", 0) if isinstance(report.get("summary"), dict) else 0) == 0
        result["risk"] = {"score": report.get("score"), "status": report.get("status"), "summary": report.get("summary", {})}
        for step in runbook.get("steps", []) if isinstance(runbook.get("steps"), list) else []:
            if isinstance(step, dict) and step.get("id") == "verify_sso_config":
                step["status"] = "completed" if ok else "failed"
                step["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
                step["evidence"] = result["risk"]
        runbook["risk"] = result["risk"]
    elif action == "archive":
        for step in runbook.get("steps", []) if isinstance(runbook.get("steps"), list) else []:
            if isinstance(step, dict) and step.get("id") == "archive_evidence":
                step["status"] = "completed"
                step["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
        runbook["archived_by"] = actor
        runbook["archived_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    steps = runbook.get("steps", []) if isinstance(runbook.get("steps"), list) else []
    runbook["status"] = _sso_risk_runbook_status(steps, archived=action == "archive")
    runbook["updated_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    events = runbook.get("events", []) if isinstance(runbook.get("events"), list) else []
    events.append(_sso_risk_runbook_event(action, actor, body.note, {"dry_run": body.dry_run, "result_keys": list(result.keys())}))
    runbook["events"] = events
    _save_sso_risk_runbook(name, runbook)
    try:
        from sop_manager.routers.audit_chain import append_audit

        append_audit("sso.risk.runbook.action", resource_type="sso_provider", resource_id=name, details={"runbook_id": runbook.get("id"), "action": action, "status": runbook.get("status")})
    except Exception:
        pass
    return {"runbook": runbook, "result": result}


def _normalize_x509_cert(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    raw = raw.replace("-----BEGIN CERTIFICATE-----", "").replace("-----END CERTIFICATE-----", "")
    return "".join(raw.split())


def _saml_sp_entity_id(provider: str, cfg: dict[str, Any]) -> str:
    configured = str(cfg.get("client_id") or "").strip()
    if configured:
        return configured
    base = os.getenv("SOP_PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
    return f"{base}/api/v1/sso/{provider}/saml/metadata"


def _saml_acs_url(provider: str, cfg: dict[str, Any]) -> str:
    configured = str(cfg.get("redirect_uri") or "").strip()
    if configured:
        return configured
    base = os.getenv("SOP_PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
    return f"{base}/api/v1/sso/{provider}/saml/acs"


def _saml_metadata_xml(provider: str, cfg: dict[str, Any]) -> str:
    entity_id = html.escape(_saml_sp_entity_id(provider, cfg), quote=True)
    acs_url = html.escape(_saml_acs_url(provider, cfg), quote=True)
    name_id = html.escape(str(cfg.get("name_id_format") or "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"), quote=True)
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="{entity_id}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <md:NameIDFormat>{name_id}</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="{acs_url}" index="1" isDefault="true"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>
"""


def _parse_saml_metadata_xml(raw_xml: str) -> dict[str, str]:
    if len(raw_xml.encode("utf-8")) > 1024 * 1024:
        raise ValueError("SAML metadata is larger than 1MB")
    root = ET.fromstring(raw_xml)
    entity_id = str(root.attrib.get("entityID") or "")
    sso_url = ""
    fallback_sso_url = ""
    x509_cert = ""
    for elem in root.iter():
        tag = elem.tag.rsplit("}", 1)[-1]
        if tag == "EntityDescriptor" and not entity_id:
            entity_id = str(elem.attrib.get("entityID") or "")
        if tag == "SingleSignOnService":
            binding = str(elem.attrib.get("Binding") or "")
            location = str(elem.attrib.get("Location") or "")
            if location and not fallback_sso_url:
                fallback_sso_url = location
            if location and binding.endswith(":HTTP-Redirect"):
                sso_url = location
        if tag == "X509Certificate" and elem.text and not x509_cert:
            x509_cert = _normalize_x509_cert(elem.text)
    return {
        "entity_id": entity_id,
        "sso_url": sso_url or fallback_sso_url,
        "x509_cert": x509_cert,
    }


async def _resolve_saml_idp_config(cfg: dict[str, Any]) -> dict[str, Any]:
    explicit = {
        "entity_id": str(cfg.get("issuer") or "").strip(),
        "sso_url": str(cfg.get("sso_url") or "").strip(),
        "x509_cert": _normalize_x509_cert(str(cfg.get("x509_cert") or "")),
        "source": "provider",
    }
    if explicit["entity_id"] and explicit["sso_url"] and explicit["x509_cert"]:
        return explicit
    metadata_url = str(cfg.get("metadata_url") or "").strip()
    if not metadata_url:
        return explicit
    async with httpx.AsyncClient(timeout=8.0) as c:
        r = await c.get(metadata_url)
        r.raise_for_status()
        parsed = _parse_saml_metadata_xml(r.text)
    return {
        "entity_id": explicit["entity_id"] or parsed.get("entity_id", ""),
        "sso_url": explicit["sso_url"] or parsed.get("sso_url", ""),
        "x509_cert": explicit["x509_cert"] or parsed.get("x509_cert", ""),
        "source": "metadata_url",
        "metadata_url": metadata_url,
    }


def _saml_readiness(name: str, cfg: dict[str, Any]) -> dict[str, Any]:
    dep = _saml_dependency_status()
    has_idp = bool((cfg.get("issuer") or cfg.get("metadata_url")) and (cfg.get("sso_url") or cfg.get("metadata_url")))
    has_cert = bool(_normalize_x509_cert(str(cfg.get("x509_cert") or "")) or cfg.get("metadata_url"))
    has_sp = bool(_saml_sp_entity_id(name, cfg) and _saml_acs_url(name, cfg))
    missing: list[str] = []
    if not dep.get("installed"):
        missing.append("python3-saml")
    if not has_idp:
        missing.append("issuer/sso_url or metadata_url")
    if not has_cert:
        missing.append("x509_cert or metadata_url")
    if not has_sp:
        missing.append("sp_entity_id/acs_url")
    return {
        "ready": not missing,
        "missing": missing,
        "dependency": dep,
        "sp_entity_id": _saml_sp_entity_id(name, cfg),
        "acs_url": _saml_acs_url(name, cfg),
        "metadata_url": f"/api/v1/sso/{name}/saml/metadata",
        "login_url": f"/api/v1/sso/{name}/saml/login",
    }


def _providers() -> dict[str, dict[str, Any]]:
    names = [n.strip() for n in (os.getenv("SOP_SSO_PROVIDERS") or "").split(",") if n.strip()]
    out: dict[str, dict[str, Any]] = {}
    for n in names:
        key = n.upper()
        out[n] = {
            "type": os.getenv(f"SOP_SSO_{key}_TYPE", "oidc"),
            "issuer": os.getenv(f"SOP_SSO_{key}_ISSUER", ""),
            "client_id": os.getenv(f"SOP_SSO_{key}_CLIENT_ID", ""),
            "client_secret": os.getenv(f"SOP_SSO_{key}_CLIENT_SECRET", ""),
            "redirect_uri": os.getenv(f"SOP_SSO_{key}_REDIRECT",
                                      f"http://localhost:8000/api/v1/sso/{n}/callback"),
            "scope": os.getenv(f"SOP_SSO_{key}_SCOPE", "openid profile email"),
            "metadata_url": os.getenv(f"SOP_SSO_{key}_METADATA", ""),
            "sso_url": os.getenv(f"SOP_SSO_{key}_SAML_SSO_URL", ""),
            "x509_cert": os.getenv(f"SOP_SSO_{key}_SAML_X509_CERT", ""),
            "name_id_format": os.getenv(f"SOP_SSO_{key}_SAML_NAME_ID_FORMAT", "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"),
            "scim_enabled": os.getenv(f"SOP_SSO_{key}_SCIM_ENABLED", "false").lower() == "true",
            "scim_token_hash": os.getenv(f"SOP_SSO_{key}_SCIM_TOKEN_HASH", ""),
            "scim_token_rotated_at": "",
            "enabled": "true",
            "source": "env",
            "tenant_domain_map": _parse_kv_env(os.getenv(f"SOP_SSO_{key}_TENANT_DOMAIN_MAP", "")),
            "role_map": _parse_kv_env(os.getenv(f"SOP_SSO_{key}_ROLE_MAP", "")),
        }
    runtime = _load_runtime_config().get("providers", {})
    if isinstance(runtime, dict):
        for name, cfg in runtime.items():
            if not isinstance(cfg, dict) or cfg.get("enabled", True) is False:
                continue
            provider = _safe_provider_name(str(name))
            out[provider] = {
                "type": str(cfg.get("type") or "oidc"),
                "issuer": str(cfg.get("issuer") or ""),
                "client_id": str(cfg.get("client_id") or ""),
                "client_secret": str(cfg.get("client_secret") or ""),
                "redirect_uri": str(cfg.get("redirect_uri") or f"http://localhost:8000/api/v1/sso/{provider}/callback"),
                "scope": str(cfg.get("scope") or "openid profile email"),
                "metadata_url": str(cfg.get("metadata_url") or ""),
                "sso_url": str(cfg.get("sso_url") or ""),
                "x509_cert": str(cfg.get("x509_cert") or ""),
                "name_id_format": str(cfg.get("name_id_format") or "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress"),
                "scim_enabled": bool(cfg.get("scim_enabled", False)),
                "scim_token_hash": str(cfg.get("scim_token_hash") or ""),
                "scim_token_rotated_at": str(cfg.get("scim_token_rotated_at") or ""),
                "enabled": "true",
                "source": "runtime",
                "tenant_domain_map": cfg.get("tenant_domain_map", {}),
                "role_map": cfg.get("role_map", {}),
            }
    return out


def _public_provider(name: str, cfg: dict[str, Any]) -> dict[str, Any]:
    item = {
        "name": name,
        "type": cfg.get("type", "oidc"),
        "issuer": cfg.get("issuer", ""),
        "client_id": cfg.get("client_id", ""),
        "client_secret_masked": _mask_secret(str(cfg.get("client_secret") or "")),
        "redirect_uri": cfg.get("redirect_uri", ""),
        "scope": cfg.get("scope", ""),
        "metadata_url": cfg.get("metadata_url", ""),
        "sso_url": cfg.get("sso_url", ""),
        "x509_cert_masked": _mask_secret(_normalize_x509_cert(str(cfg.get("x509_cert") or ""))),
        "name_id_format": cfg.get("name_id_format", ""),
        "source": cfg.get("source", "runtime"),
        "enabled": str(cfg.get("enabled", "true")).lower() != "false",
        "tenant_domain_map": cfg.get("tenant_domain_map", {}),
        "role_map": cfg.get("role_map", {}),
        "scim": _scim_public_config(name, cfg),
    }
    if item["type"] == "saml":
        item["saml"] = _saml_readiness(name, cfg)
    return item


def _normalize_groups(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        raw = value.replace(";", ",").split(",")
    elif isinstance(value, list):
        raw = value
    elif isinstance(value, tuple) or isinstance(value, set):
        raw = list(value)
    else:
        raw = [str(value)]
    out: list[str] = []
    for item in raw:
        group = str(item).strip()
        if group and group not in out:
            out.append(group)
    return out


def _normalize_map(value: Any) -> dict[str, str]:
    if isinstance(value, dict):
        return {str(k).strip(): str(v).strip() for k, v in value.items() if str(k).strip() and str(v).strip()}
    if isinstance(value, str):
        return _parse_kv_env(value)
    return {}


def _resolve_role(groups: list[str], cfg: Optional[dict[str, Any]] = None) -> str:
    role_map = _normalize_map((cfg or {}).get("role_map", {}))
    candidates = groups + [g.lower() for g in groups] + ["*"]
    for group in candidates:
        mapped = role_map.get(group)
        if not mapped:
            continue
        role = _norm_role(mapped)
        if role in USER_ROLES:
            return role
    return "developer"


def _tenant_code_from_email(email: str, cfg: Optional[dict[str, Any]] = None) -> str:
    default_tenant = os.getenv("TENANT_ID", "t-default")
    if "@" not in email:
        return default_tenant
    domain = email.rsplit("@", 1)[1].strip().lower()
    mapping = _parse_kv_env(os.getenv("SOP_SSO_DOMAIN_TENANT_MAP", ""))
    mapping.update(_normalize_map((cfg or {}).get("tenant_domain_map", {})))
    return mapping.get(domain, default_tenant)


def _slugify(value: str, fallback: str = "default") -> str:
    slug = "".join(c.lower() for c in (value or "").strip() if c.isalnum() or c in "-_")[:48]
    return slug or fallback


def _ensure_tenant(db: Session, tenant_code: str) -> Tenant:
    code = (tenant_code or os.getenv("TENANT_ID", "t-default")).strip()
    tenant = db.get(Tenant, code)
    if tenant:
        return tenant
    tenant = db.query(Tenant).filter_by(slug=code).first()
    if tenant:
        return tenant
    slug = _slugify(code.removeprefix("t-") if code.startswith("t-") else code)
    tenant_id = code if code.startswith("t-") else f"t-{slug}"
    tenant = db.get(Tenant, tenant_id) or db.query(Tenant).filter_by(slug=slug).first()
    if tenant:
        return tenant
    tenant = Tenant(id=tenant_id, slug=slug, name=slug, plan="enterprise", status="active")
    db.add(tenant)
    db.flush()
    return tenant


def _unique_username(db: Session, tenant_id: str, email: str, name: str) -> str:
    base = (email.split("@", 1)[0] if "@" in email else name or "sso-user").strip()
    username = _slugify(base, "sso-user")[:48]
    if not db.query(User).filter_by(tenant_id=tenant_id, username=username).first():
        return username
    for i in range(2, 1000):
        candidate = f"{username}-{i}"[:64]
        if not db.query(User).filter_by(tenant_id=tenant_id, username=candidate).first():
            return candidate
    return f"sso-{uuid.uuid4().hex[:12]}"


def _jit_user(db: Session, *, tenant: Tenant, email: str, name: str, role: str) -> User:
    email_norm = (email or "").strip().lower()
    user = None
    if email_norm:
        user = db.query(User).filter_by(tenant_id=tenant.id, email=email_norm).first()
    if not user and email_norm:
        username = email_norm.split("@", 1)[0]
        user = db.query(User).filter_by(tenant_id=tenant.id, username=username).first()
    if user:
        changed = False
        if user.status != "active":
            user.status = "active"
            changed = True
        if email_norm and user.email != email_norm:
            user.email = email_norm
            changed = True
        resolved_role = _norm_role(role)
        if resolved_role in USER_ROLES and user.role != "super_admin" and user.role != resolved_role:
            user.role = resolved_role
            changed = True
        if changed:
            db.add(user)
            db.flush()
        return user
    username = _unique_username(db, tenant.id, email_norm, name)
    user = User(
        id=f"u-{uuid.uuid4().hex[:12]}",
        tenant_id=tenant.id,
        username=username,
        email=email_norm,
        password_hash=_hash(secrets.token_urlsafe(32)),
        role=_norm_role(role) if _norm_role(role) in USER_ROLES else "developer",
        status="active",
    )
    db.add(user)
    db.flush()
    return user


def _scim_group_values(groups: Any) -> list[str]:
    out: list[str] = []
    if not isinstance(groups, list):
        return out
    for item in groups:
        if isinstance(item, str):
            value = item
        elif isinstance(item, dict):
            value = str(item.get("display") or item.get("value") or item.get("$ref") or "")
        else:
            value = str(item)
        value = value.strip()
        if value and value not in out:
            out.append(value)
    return out


def _scim_email(payload: dict[str, Any]) -> str:
    emails = payload.get("emails")
    if isinstance(emails, list):
        primary = next((x for x in emails if isinstance(x, dict) and x.get("primary")), None)
        row = primary or next((x for x in emails if isinstance(x, dict) and x.get("value")), None)
        if row:
            return str(row.get("value") or "").strip().lower()
    user_name = str(payload.get("userName") or "").strip().lower()
    return user_name if "@" in user_name else ""


def _scim_display_name(payload: dict[str, Any]) -> str:
    if payload.get("displayName"):
        return str(payload.get("displayName"))
    name = payload.get("name")
    if isinstance(name, dict):
        formatted = str(name.get("formatted") or "").strip()
        if formatted:
            return formatted
        return " ".join(str(name.get(k) or "").strip() for k in ("givenName", "familyName")).strip()
    return str(payload.get("userName") or "")


def _scim_user_resource(user: User) -> dict[str, Any]:
    return {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
        "id": user.id,
        "userName": user.email or user.username,
        "name": {"formatted": user.username},
        "displayName": user.username,
        "active": user.status == "active",
        "emails": [{"value": user.email, "primary": True, "type": "work"}] if user.email else [],
        "roles": [{"value": user.role, "display": user.role, "primary": True}],
        "meta": {
            "resourceType": "User",
            "location": f"/api/v1/sso/scim/v2/Users/{user.id}",
        },
    }


def _scim_role_id(group_id: str) -> str:
    role = _norm_role(group_id)
    if role not in USER_ROLES or role == "super_admin":
        raise _scim_error(404, f"SCIM group not found or unmanaged: {group_id}", "notFound")
    return role


def _scim_scope_tenant_ids(db: Session, cfg: dict[str, Any]) -> list[str]:
    mapped_tenants = list(_normalize_map(cfg.get("tenant_domain_map", {})).values())
    if not mapped_tenants:
        return [os.getenv("TENANT_ID", "t-default")]
    return [_ensure_tenant(db, code).id for code in mapped_tenants]


def _scim_scoped_users_query(db: Session, cfg: dict[str, Any]):
    tenant_ids = _scim_scope_tenant_ids(db, cfg)
    return db.query(User).filter(User.tenant_id.in_(tenant_ids))


def _scim_group_resource(provider: str, role: str, members: list[User]) -> dict[str, Any]:
    return {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
        "id": role,
        "displayName": role,
        "members": [
            {
                "value": user.id,
                "display": user.email or user.username,
                "$ref": f"/api/v1/sso/scim/v2/{provider}/Users/{user.id}",
            }
            for user in members
        ],
        "meta": {"resourceType": "Group", "location": f"/api/v1/sso/scim/v2/{provider}/Groups/{role}"},
    }


def _scim_member_ids(value: Any) -> list[str]:
    raw = value.get("members") if isinstance(value, dict) else value
    if not isinstance(raw, list):
        return []
    out: list[str] = []
    for item in raw:
        if isinstance(item, dict):
            user_id = str(item.get("value") or item.get("id") or "").strip()
        else:
            user_id = str(item).strip()
        if user_id and user_id not in out:
            out.append(user_id)
    return out


def _sync_scim_group_members(
    db: Session,
    cfg: dict[str, Any],
    role: str,
    member_ids: list[str],
    *,
    mode: str,
) -> dict[str, Any]:
    scoped = _scim_scoped_users_query(db, cfg)
    allowed_tenant_ids = set(_scim_scope_tenant_ids(db, cfg))
    changed: list[str] = []
    skipped: list[str] = []
    wanted = set(member_ids)
    if mode == "replace":
        for user in scoped.filter(User.role == role).all():
            if user.id not in wanted:
                user.role = "developer"
                db.add(user)
                changed.append(user.id)
    if mode in {"replace", "add"}:
        for user_id in member_ids:
            user = db.get(User, user_id)
            if not user or user.tenant_id not in allowed_tenant_ids or user.role == "super_admin":
                skipped.append(user_id)
                continue
            if user.role != role:
                user.role = role
                db.add(user)
                changed.append(user.id)
    elif mode == "remove":
        for user_id in member_ids:
            user = db.get(User, user_id)
            if not user or user.tenant_id not in allowed_tenant_ids or user.role != role:
                skipped.append(user_id)
                continue
            user.role = "developer"
            db.add(user)
            changed.append(user.id)
    db.commit()
    members = _scim_scoped_users_query(db, cfg).filter(User.role == role).order_by(User.username.asc()).all()
    return {"changed": changed, "skipped": skipped, "resource": _scim_group_resource(str(cfg.get("_provider") or ""), role, members)}


def _scim_error(status: int, detail: str, scim_type: str = "invalidValue") -> HTTPException:
    return HTTPException(
        status,
        {
            "schemas": ["urn:ietf:params:scim:api:messages:2.0:Error"],
            "scimType": scim_type,
            "detail": detail,
            "status": str(status),
        },
    )


def _scim_provider_from_request(request: Request, provider: str) -> tuple[str, dict[str, Any]]:
    name = _safe_provider_name(provider)
    auth = request.headers.get("authorization", "")
    scheme, _, token = auth.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise _scim_error(401, "SCIM Bearer token required", "unauthorized")
    cfg = _providers().get(name)
    if not cfg or not cfg.get("scim_enabled") or not cfg.get("scim_token_hash"):
        raise _scim_error(404, f"SCIM provider disabled: {name}", "notFound")
    if not hmac.compare_digest(_hash_secret(token.strip()), str(cfg.get("scim_token_hash") or "")):
        raise _scim_error(401, "Invalid SCIM token", "unauthorized")
    cfg = {**cfg, "_provider": name}
    return name, cfg


def _provision_scim_user(db: Session, cfg: dict[str, Any], payload: dict[str, Any], *, dry_run: bool = False) -> dict[str, Any]:
    email = _scim_email(payload)
    if not email:
        raise _scim_error(400, "SCIM user requires userName or primary email")
    groups = _scim_group_values(payload.get("groups"))
    role = _resolve_role(groups, cfg)
    tenant_code = _tenant_code_from_email(email, cfg)
    display_name = _scim_display_name(payload) or email
    active = bool(payload.get("active", True))
    if dry_run:
        return {
            "ok": True,
            "dry_run": True,
            "email": email,
            "displayName": display_name,
            "tenant": tenant_code,
            "role": role,
            "active": active,
            "groups": groups,
        }
    tenant = _ensure_tenant(db, tenant_code)
    user = _jit_user(db, tenant=tenant, email=email, name=display_name, role=role)
    user.status = "active" if active else "disabled"
    user.role = role
    db.add(user)
    db.commit()
    return {"ok": True, "resource": _scim_user_resource(user), "tenant": tenant.id, "role": role, "groups": groups}


def _templates() -> list[dict[str, str]]:
    base = os.getenv("SOP_PUBLIC_BASE_URL", "http://localhost:8000").rstrip("/")
    return [
        {
            "id": "okta",
            "name": "Okta OIDC",
            "type": "oidc",
            "issuer_hint": "https://dev-xxxxx.okta.com/oauth2/default",
            "redirect_hint": f"{base}/api/v1/sso/okta/callback",
            "scope": "openid profile email groups",
        },
        {
            "id": "azure",
            "name": "Azure AD / Entra ID",
            "type": "oidc",
            "issuer_hint": "https://login.microsoftonline.com/<tenant-id>/v2.0",
            "redirect_hint": f"{base}/api/v1/sso/azure/callback",
            "scope": "openid profile email User.Read",
        },
        {
            "id": "auth0",
            "name": "Auth0 OIDC",
            "type": "oidc",
            "issuer_hint": "https://<tenant>.auth0.com",
            "redirect_hint": f"{base}/api/v1/sso/auth0/callback",
            "scope": "openid profile email",
        },
        {
            "id": "saml",
            "name": "Generic SAML 2.0",
            "type": "saml",
            "issuer_hint": "https://idp.example.com/metadata",
            "redirect_hint": f"{base}/api/v1/sso/saml/saml/acs",
            "metadata_hint": "https://idp.example.com/metadata",
            "sso_url_hint": "https://idp.example.com/sso",
            "name_id_format": "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
            "scope": "",
        },
    ]


def _pkce_pair() -> tuple[str, str]:
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(
        hashlib.sha256(verifier.encode()).digest()
    ).rstrip(b"=").decode()
    return verifier, challenge


def _make_state() -> str:
    s = secrets.token_urlsafe(24)
    # 清理过期 state
    now = time.time()
    for k, v in list(_STATE_CACHE.items()):
        if now - v["ts"] > _STATE_TTL:
            _STATE_CACHE.pop(k, None)
    return s


@router.get("/providers")
def list_providers() -> dict[str, Any]:
    """公开列表：仅 type + issuer（无 secret）。"""
    return {
        "items": [
            {"name": n, "type": p["type"], "issuer": p["issuer"], "source": p.get("source", "env")}
            for n, p in _providers().items()
        ]
    }


@router.get("/config")
def sso_config(_: Any = Depends(current_user)) -> dict[str, Any]:
    providers = _providers()
    return {
        "ok": True,
        "enabled": bool(providers),
        "items": [_public_provider(name, cfg) for name, cfg in providers.items()],
        "templates": _templates(),
        "config_path": _config_path(),
        "domain_tenant_map": os.getenv("SOP_SSO_DOMAIN_TENANT_MAP", ""),
        "roles": list(USER_ROLES),
        "role_templates": [
            {"group": "sop-admins", "role": "tenant_admin"},
            {"group": "sop-devops", "role": "devops"},
            {"group": "sop-viewers", "role": "viewer"},
            {"group": "*", "role": "developer"},
        ],
        "saml_dependency": _saml_dependency_status(),
        "saml_enabled": _saml_dependency_status().get("installed", False),
    }


@router.put("/providers/{provider}")
def upsert_provider(provider: str, body: SsoProviderIn, _: Any = Depends(require_role("tenant_admin"))) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    data = _load_runtime_config()
    providers = data.setdefault("providers", {})
    if not isinstance(providers, dict):
        providers = {}
        data["providers"] = providers
    current = providers.get(name, {}) if isinstance(providers.get(name), dict) else {}
    row = body.model_dump()
    if not row.get("client_secret"):
        row["client_secret"] = current.get("client_secret", "")
    row["scim_token_hash"] = current.get("scim_token_hash", "")
    row["scim_token_rotated_at"] = current.get("scim_token_rotated_at", "")
    row["scim_audit"] = current.get("scim_audit", [])
    if not row.get("redirect_uri"):
        row["redirect_uri"] = f"http://localhost:8000/api/v1/sso/{name}/callback"
    providers[name] = row
    _save_runtime_config(data)
    return {"ok": True, "item": _public_provider(name, {**row, "source": "runtime"})}


@router.delete("/providers/{provider}")
def delete_provider(provider: str, _: Any = Depends(require_role("tenant_admin"))) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    data = _load_runtime_config()
    providers = data.setdefault("providers", {})
    if isinstance(providers, dict):
        providers.pop(name, None)
    _save_runtime_config(data)
    return {"ok": True}


@router.post("/providers/{provider}/test")
async def test_provider(provider: str, _: Any = Depends(current_user)) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    cfg = _providers().get(name)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {name}")
    if cfg.get("type") == "saml":
        dep = _saml_dependency_status()
        try:
            idp = await _resolve_saml_idp_config(cfg)
            missing = [
                key for key in ("entity_id", "sso_url", "x509_cert")
                if not idp.get(key)
            ]
            if not dep.get("installed"):
                missing.append("python3-saml")
            return {
                "ok": not missing,
                "type": "saml",
                "dependency": dep,
                "idp": {**idp, "x509_cert": "***configured***" if idp.get("x509_cert") else ""},
                "sp": {
                    "entity_id": _saml_sp_entity_id(name, cfg),
                    "acs_url": _saml_acs_url(name, cfg),
                    "metadata_url": f"/api/v1/sso/{name}/saml/metadata",
                    "login_url": f"/api/v1/sso/{name}/saml/login",
                },
                "missing": missing,
                "message": "SAML 可用" if not missing else "SAML 配置或依赖未就绪",
            }
        except Exception as e:
            return {
                "ok": False,
                "type": "saml",
                "dependency": dep,
                "error": str(e),
                "message": "SAML metadata 解析失败",
            }
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.get(str(cfg["issuer"]).rstrip("/") + "/.well-known/openid-configuration")
            r.raise_for_status()
            disc = r.json()
        return {
            "ok": True,
            "type": "oidc",
            "authorization_endpoint": disc.get("authorization_endpoint"),
            "token_endpoint": disc.get("token_endpoint"),
            "userinfo_endpoint": disc.get("userinfo_endpoint"),
        }
    except Exception as e:
        return {"ok": False, "type": "oidc", "error": str(e)}


@router.post("/providers/{provider}/role-preview")
def preview_provider_role(
    provider: str,
    body: SsoRolePreviewIn,
    _: Any = Depends(current_user),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    cfg = _providers().get(name)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {name}")
    effective_cfg = {
        **cfg,
        "tenant_domain_map": body.tenant_domain_map or cfg.get("tenant_domain_map", {}),
        "role_map": body.role_map or cfg.get("role_map", {}),
    }
    groups = _normalize_groups(body.groups)
    tenant_code = _tenant_code_from_email(body.email, effective_cfg)
    role = _resolve_role(groups, effective_cfg)
    return {
        "ok": True,
        "provider": name,
        "email": body.email,
        "tenant": tenant_code,
        "role": role,
        "groups": groups,
        "role_map": _normalize_map(effective_cfg.get("role_map", {})),
        "tenant_domain_map": _normalize_map(effective_cfg.get("tenant_domain_map", {})),
    }


@router.post("/providers/{provider}/scim-token")
def rotate_scim_token(
    provider: str,
    body: ScimTokenRotateIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    cfg = _providers().get(name)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {name}")
    raw = "scim_" + secrets.token_urlsafe(32)
    merged = _save_provider_runtime_config(
        name,
        {
            "scim_enabled": body.enabled,
            "scim_token_hash": _hash_secret(raw),
            "scim_token_rotated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        },
    )
    public = _scim_public_config(name, {**cfg, **merged})
    _record_scim_audit_safe(
        name,
        "token_rotated",
        actor=str(getattr(_, "username", "tenant_admin")),
        subject=name,
        details={"enabled": body.enabled, "readiness": public.get("readiness"), "token": raw},
    )
    return {
        "ok": True,
        "provider": name,
        "token": raw,
        "note": "SCIM token 仅本次返回，请立即配置到 IdP；后续只能重新轮换。",
        "scim": public,
    }


@router.post("/providers/{provider}/scim/test")
def test_scim_user(
    provider: str,
    body: ScimTestIn,
    _: Any = Depends(current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    cfg = _providers().get(name)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {name}")
    payload = body.model_dump()
    if not payload.get("emails"):
        payload["emails"] = [{"value": body.userName, "primary": True, "type": "work"}]
    result = _provision_scim_user(db, cfg, payload, dry_run=not body.apply)
    _record_scim_audit_safe(
        name,
        "test_apply" if body.apply else "test_dry_run",
        actor=str(getattr(_, "username", "admin")),
        subject=str(result.get("resource", {}).get("id") or result.get("email") or body.userName),
        details={
            "applied": body.apply,
            "email": result.get("email") or result.get("resource", {}).get("userName"),
            "tenant": result.get("tenant"),
            "role": result.get("role"),
            "groups": result.get("groups", []),
        },
    )
    return {"ok": True, "provider": name, "applied": body.apply, "result": result}


@router.get("/providers/{provider}/scim/audit")
def scim_audit_report(
    provider: str,
    event_type: str = "",
    status: str = "",
    limit: int = 50,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    if name not in _providers():
        raise HTTPException(404, f"unknown provider: {name}")
    all_events = _load_scim_audit_events(name)
    filtered = all_events
    if event_type:
        filtered = [event for event in filtered if str(event.get("event_type") or "") == event_type]
    if status:
        filtered = [event for event in filtered if str(event.get("status") or "") == status]
    safe_limit = max(1, min(int(limit or 50), 200))
    items = list(reversed(filtered))[:safe_limit]
    return {
        "ok": True,
        "provider": name,
        "summary": _scim_audit_summary(all_events),
        "filtered_summary": _scim_audit_summary(filtered),
        "items": items,
        "filters": {"event_type": event_type, "status": status, "limit": safe_limit},
        "agent_consumption": {
            "surface": "settings.sso.scim.audit",
            "api": f"/api/v1/sso/providers/{name}/scim/audit",
            "purpose": "SCIM provisioning audit report with sanitized event details and summary counters.",
        },
    }


@router.get("/providers/{provider}/risk-report")
def sso_risk_report(
    provider: str,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    cfg = _providers().get(name)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {name}")
    return _sso_risk_report(name, cfg)


@router.post("/providers/{provider}/risk-tasks")
def sso_risk_tasks(
    provider: str,
    body: SsoRiskTasksIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    cfg = _providers().get(name)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {name}")
    return _sso_risk_tasks(name, cfg, body)


@router.post("/providers/{provider}/risk-im-briefing")
def sso_risk_im_briefing(
    provider: str,
    body: SsoRiskImBriefingIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    cfg = _providers().get(name)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {name}")
    return _sso_risk_im_briefing(name, cfg, body)


@router.get("/providers/{provider}/risk-subscription")
def get_sso_risk_subscription(
    provider: str,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    if name not in _providers():
        raise HTTPException(404, f"unknown provider: {name}")
    runtime = _load_runtime_config().get("providers", {})
    cfg = runtime.get(name, {}) if isinstance(runtime, dict) and isinstance(runtime.get(name), dict) else {}
    return {
        "ok": True,
        "provider": name,
        "subscription": _public_sso_risk_subscription(cfg.get("risk_subscription") if isinstance(cfg, dict) else {}),
        "history": _sso_risk_subscription_history(name),
        "agent_consumption": {
            "surface": "settings.sso.risk.subscription",
            "api": f"/api/v1/sso/providers/{name}/risk-subscription",
            "purpose": "Read configured SSO risk subscription delivery policy and recent send history.",
        },
    }


@router.put("/providers/{provider}/risk-subscription")
def upsert_sso_risk_subscription(
    provider: str,
    body: SsoRiskSubscriptionIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    cfg = _providers().get(name)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {name}")
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    subscription = _public_sso_risk_subscription({
        **body.model_dump(),
        "updated_at": now,
        "updated_by": str(getattr(_, "username", "tenant_admin")),
    })
    runtime = _load_runtime_config().get("providers", {})
    current = runtime.get(name, {}) if isinstance(runtime, dict) and isinstance(runtime.get(name), dict) else {}
    merged = _save_provider_runtime_config(name, {**current, "risk_subscription": subscription})
    try:
        from sop_manager.routers.audit_chain import append_audit

        append_audit("sso.risk.subscription.update", resource_type="sso_provider", resource_id=name, details={"subscription": subscription})
    except Exception:
        pass
    return {
        "ok": True,
        "provider": name,
        "subscription": _public_sso_risk_subscription(merged.get("risk_subscription")),
        "history": _sso_risk_subscription_history(name),
    }


@router.post("/providers/{provider}/risk-subscription/test")
def test_sso_risk_subscription(
    provider: str,
    body: SsoRiskSubscriptionTestIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    cfg = _providers().get(name)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {name}")
    return _run_sso_risk_subscription(name, cfg, body)


@router.get("/providers/{provider}/risk-escalation")
def get_sso_risk_escalation(
    provider: str,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    if name not in _providers():
        raise HTTPException(404, f"unknown provider: {name}")
    runtime = _load_runtime_config().get("providers", {})
    cfg = runtime.get(name, {}) if isinstance(runtime, dict) and isinstance(runtime.get(name), dict) else {}
    return {
        "ok": True,
        "provider": name,
        "policy": _public_sso_risk_escalation_policy(cfg.get("risk_escalation") if isinstance(cfg, dict) else {}),
        "history": _sso_risk_escalation_history(name),
        "agent_consumption": {
            "surface": "settings.sso.risk.escalation",
            "api": f"/api/v1/sso/providers/{name}/risk-escalation",
            "purpose": "Read configured SSO risk auto-escalation policy and recent automated runs.",
        },
    }


@router.put("/providers/{provider}/risk-escalation")
def upsert_sso_risk_escalation(
    provider: str,
    body: SsoRiskEscalationPolicyIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    cfg = _providers().get(name)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {name}")
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    runtime = _load_runtime_config().get("providers", {})
    current = runtime.get(name, {}) if isinstance(runtime, dict) and isinstance(runtime.get(name), dict) else {}
    previous_policy = _public_sso_risk_escalation_policy(current.get("risk_escalation") if isinstance(current, dict) else {})
    policy = _public_sso_risk_escalation_policy({
        **previous_policy,
        **body.model_dump(),
        "updated_at": now,
        "updated_by": str(getattr(_, "username", "tenant_admin")),
    })
    merged = _save_provider_runtime_config(name, {**current, "risk_escalation": policy})
    try:
        from sop_manager.routers.audit_chain import append_audit

        append_audit("sso.risk.escalation.update", resource_type="sso_provider", resource_id=name, details={"policy": policy})
    except Exception:
        pass
    return {
        "ok": True,
        "provider": name,
        "policy": _public_sso_risk_escalation_policy(merged.get("risk_escalation")),
        "history": _sso_risk_escalation_history(name),
    }


@router.post("/providers/{provider}/risk-escalation/run")
def run_sso_risk_escalation(
    provider: str,
    body: SsoRiskEscalationRunIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    cfg = _providers().get(name)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {name}")
    return _run_sso_risk_escalation(name, cfg, body)


@router.get("/providers/{provider}/risk-runbooks")
def list_sso_risk_runbooks(
    provider: str,
    limit: int = 20,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    if name not in _providers():
        raise HTTPException(404, f"unknown provider: {name}")
    rows = _sso_risk_runbooks(name, limit=limit)
    return {
        "ok": True,
        "provider": name,
        "items": [_public_sso_risk_runbook(item) for item in rows["items"]],
        "total": rows["total"],
        "agent_consumption": {
            "surface": "settings.sso.risk.runbook",
            "api": f"/api/v1/sso/providers/{name}/risk-runbooks",
            "purpose": "List generated SSO risk remediation runbooks, step progress, task counts, and latest risk snapshot.",
        },
    }


@router.post("/providers/{provider}/risk-runbooks")
def create_sso_risk_runbook(
    provider: str,
    body: SsoRiskRunbookIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    cfg = _providers().get(name)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {name}")
    runbook = _create_sso_risk_runbook(name, cfg, body)
    return {"ok": True, "provider": name, "item": _public_sso_risk_runbook(runbook), "runbook": runbook}


@router.get("/providers/{provider}/risk-runbooks/{runbook_id}")
def get_sso_risk_runbook(
    provider: str,
    runbook_id: str,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    if name not in _providers():
        raise HTTPException(404, f"unknown provider: {name}")
    runbook = _find_sso_risk_runbook(name, runbook_id)
    return {"ok": True, "provider": name, "item": _public_sso_risk_runbook(runbook), "runbook": runbook}


@router.post("/providers/{provider}/risk-runbooks/{runbook_id}/action")
def sso_risk_runbook_action(
    provider: str,
    runbook_id: str,
    body: SsoRiskRunbookActionIn,
    _: Any = Depends(require_role("tenant_admin")),
) -> dict[str, Any]:
    name = _safe_provider_name(provider)
    cfg = _providers().get(name)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {name}")
    runbook = _find_sso_risk_runbook(name, runbook_id)
    updated = _apply_sso_risk_runbook_action(name, cfg, runbook, body)
    return {"ok": True, "provider": name, "item": _public_sso_risk_runbook(updated["runbook"]), "runbook": updated["runbook"], "result": updated["result"]}


@router.get("/{provider}/login")
async def login(provider: str, redirect: str = "/"):
    cfg = _providers().get(provider)
    if not cfg:
        raise HTTPException(404, f"unknown provider: {provider}")
    if cfg["type"] == "saml":
        return await saml_login(provider, redirect)
    if cfg["type"] != "oidc":
        raise HTTPException(400, f"provider {provider} 不是 oidc（请改用 SAML 入口）")
    if not cfg["issuer"] or not cfg["client_id"]:
        raise HTTPException(500, f"provider {provider} 配置不完整")

    # 发现端点（OIDC discovery）
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            r = await c.get(cfg["issuer"].rstrip("/") + "/.well-known/openid-configuration")
            r.raise_for_status()
            disc = r.json()
    except Exception as e:
        raise HTTPException(502, f"OIDC discovery 失败: {e}")

    state = _make_state()
    verifier, challenge = _pkce_pair()
    _STATE_CACHE[state] = {
        "ts": time.time(), "verifier": verifier, "provider": provider,
        "redirect": redirect, "token": disc.get("token_endpoint"),
        "userinfo": disc.get("userinfo_endpoint"),
    }
    auth_url = disc.get("authorization_endpoint")
    params = {
        "response_type": "code", "client_id": cfg["client_id"],
        "redirect_uri": cfg["redirect_uri"], "scope": cfg["scope"],
        "state": state, "code_challenge": challenge, "code_challenge_method": "S256",
    }
    return RedirectResponse(auth_url + "?" + urllib.parse.urlencode(params))


@router.get("/{provider}/callback")
async def callback(provider: str, request: Request, db: Session = Depends(get_session)):
    code = request.query_params.get("code", "")
    state = request.query_params.get("state", "")
    info = _STATE_CACHE.pop(state, None)
    if not info or info["provider"] != provider:
        raise HTTPException(400, "state 无效或过期")

    cfg = _providers().get(provider, {})
    try:
        async with httpx.AsyncClient(timeout=8.0) as c:
            tr = await c.post(info["token"], data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": cfg["redirect_uri"],
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "code_verifier": info["verifier"],
            })
            tr.raise_for_status()
            tok = tr.json()
            ur = await c.get(info["userinfo"],
                             headers={"Authorization": f"Bearer {tok.get('access_token','')}"})
            ur.raise_for_status()
            ui = ur.json()
    except Exception as e:
        raise HTTPException(502, f"OIDC 交换失败: {e}")

    # JIT provisioning
    email = ui.get("email") or ui.get("preferred_username") or ""
    external_sub = ui.get("sub") or email
    display_name = ui.get("name") or email or external_sub
    groups = _normalize_groups(ui.get("groups") or ui.get("roles") or [])
    tenant_code = _tenant_code_from_email(email, cfg)
    role = _resolve_role(groups, cfg)
    tenant = _ensure_tenant(db, tenant_code)
    user = _jit_user(db, tenant=tenant, email=email, name=display_name, role=role)
    db.commit()
    session = _make_token(user.id, user.tenant_id, user.role, user.username)

    # 写审计
    try:
        from sop_manager.routers.audit_chain import append_audit
        append_audit(
            "sso.login",
            user_id=user.id,
            tenant_id=user.tenant_id,
            details={
                "provider": provider,
                "external_sub": external_sub,
                "email": email,
                "groups": groups,
                "role": user.role,
                "tenant_slug": tenant.slug,
            },
        )
    except Exception:
        pass

    payload = {
        "token": session,
        "user": {
            "user_id": user.id,
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "tenant_id": user.tenant_id,
            "tenant_slug": tenant.slug,
            "tenant_name": tenant.name,
            "groups": groups,
            "sso_provider": provider,
        },
    }
    target = info.get("redirect") or "/?shell=1#/dashboard"
    html = f"""<!doctype html><meta charset="utf-8"><title>SSO Login</title>
<script>
const payload = {json.dumps(payload, ensure_ascii=False)};
localStorage.setItem("sop-token", payload.token);
localStorage.setItem("sop-user", JSON.stringify(payload.user));
location.replace({json.dumps(target)});
</script>
<p>SSO login succeeded. Redirecting...</p>"""
    return HTMLResponse(html)


def _resolve_tenant(email: str) -> str:
    """email 域名 → tenant_id；未配置则回 default。"""
    return _tenant_code_from_email(email)


# ── SAML 2.0（python3-saml 负责签名验证与断言处理） ─────────────
def _saml_settings(provider: str, cfg: dict[str, Any], idp: dict[str, Any]) -> dict[str, Any]:
    return {
        "strict": True,
        "debug": os.getenv("DEPLOY_ENV", "dev") != "production",
        "sp": {
            "entityId": _saml_sp_entity_id(provider, cfg),
            "assertionConsumerService": {
                "url": _saml_acs_url(provider, cfg),
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST",
            },
            "NameIDFormat": cfg.get("name_id_format") or "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
        },
        "idp": {
            "entityId": idp.get("entity_id", ""),
            "singleSignOnService": {
                "url": idp.get("sso_url", ""),
                "binding": "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect",
            },
            "x509cert": idp.get("x509_cert", ""),
        },
        "security": {
            "authnRequestsSigned": False,
            "wantAssertionsSigned": True,
            "wantMessagesSigned": False,
            "wantNameId": True,
            "wantNameIdEncrypted": False,
            "wantAttributeStatement": False,
            "requestedAuthnContext": True,
            "signatureAlgorithm": "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
            "digestAlgorithm": "http://www.w3.org/2001/04/xmlenc#sha256",
        },
    }


def _first_attr(attrs: dict[str, Any], *names: str) -> str:
    lowered = {str(k).lower(): v for k, v in attrs.items()}
    for name in names:
        value = attrs.get(name)
        if value is None:
            value = lowered.get(name.lower())
        if isinstance(value, list) and value:
            return str(value[0])
        if isinstance(value, str) and value:
            return value
    return ""


def _groups_from_attrs(attrs: dict[str, Any]) -> list[str]:
    for key in ("groups", "Groups", "memberOf", "roles", "Role"):
        if key in attrs:
            return _normalize_groups(attrs.get(key))
    return []


async def _saml_request_data(request: Request) -> dict[str, Any]:
    form = await request.form()
    host = request.headers.get("host") or request.url.hostname or "localhost"
    port = request.url.port or (443 if request.url.scheme == "https" else 80)
    return {
        "https": "on" if request.url.scheme == "https" else "off",
        "http_host": host,
        "server_port": str(port),
        "script_name": request.url.path,
        "get_data": dict(request.query_params),
        "post_data": dict(form),
    }


def _build_saml_auth(req: dict[str, Any], settings: dict[str, Any]) -> Any:
    try:
        from onelogin.saml2.auth import OneLogin_Saml2_Auth  # type: ignore[import-not-found]
    except Exception as e:
        raise HTTPException(503, f"SAML 依赖未安装：python3-saml ({e})")
    return OneLogin_Saml2_Auth(req, old_settings=settings)


@router.get("/{provider}/saml/metadata")
def saml_metadata(provider: str) -> Response:
    cfg = _providers().get(provider, {})
    if cfg.get("type") != "saml":
        raise HTTPException(404)
    xml = _saml_metadata_xml(provider, cfg)
    return Response(content=xml, media_type="application/samlmetadata+xml")


@router.get("/{provider}/saml/login")
async def saml_login(provider: str, redirect: str = "/?shell=1#/dashboard") -> RedirectResponse:
    cfg = _providers().get(provider)
    if not cfg or cfg.get("type") != "saml":
        raise HTTPException(404, f"unknown saml provider: {provider}")
    dep = _saml_dependency_status()
    if not dep.get("installed"):
        raise HTTPException(503, f"SAML 依赖未安装：{dep.get('install_hint')}")
    idp = await _resolve_saml_idp_config(cfg)
    missing = [key for key in ("entity_id", "sso_url", "x509_cert") if not idp.get(key)]
    if missing:
        raise HTTPException(400, f"SAML 配置不完整: {', '.join(missing)}")
    settings = _saml_settings(provider, cfg, idp)
    req = {
        "https": "on" if _saml_acs_url(provider, cfg).startswith("https://") else "off",
        "http_host": urllib.parse.urlparse(_saml_acs_url(provider, cfg)).netloc or "localhost",
        "server_port": "443" if _saml_acs_url(provider, cfg).startswith("https://") else "80",
        "script_name": urllib.parse.urlparse(_saml_acs_url(provider, cfg)).path,
        "get_data": {},
        "post_data": {},
    }
    auth = _build_saml_auth(req, settings)
    return RedirectResponse(auth.login(return_to=redirect))


@router.post("/{provider}/saml/acs")
async def saml_acs(provider: str, request: Request, db: Session = Depends(get_session)) -> HTMLResponse:
    """SAML Assertion Consumer Service：验签、JIT 用户落库并写入浏览器会话。"""
    cfg = _providers().get(provider)
    if not cfg or cfg.get("type") != "saml":
        raise HTTPException(404, f"unknown saml provider: {provider}")
    req = await _saml_request_data(request)
    if not req.get("post_data", {}).get("SAMLResponse"):
        raise HTTPException(400, "missing SAMLResponse")
    dep = _saml_dependency_status()
    if not dep.get("installed"):
        raise HTTPException(503, f"SAML 依赖未安装：{dep.get('install_hint')}")
    idp = await _resolve_saml_idp_config(cfg)
    missing = [key for key in ("entity_id", "sso_url", "x509_cert") if not idp.get(key)]
    if missing:
        raise HTTPException(400, f"SAML 配置不完整: {', '.join(missing)}")
    auth = _build_saml_auth(req, _saml_settings(provider, cfg, idp))
    auth.process_response()
    errors = auth.get_errors()
    if errors or not auth.is_authenticated():
        reason = auth.get_last_error_reason() if hasattr(auth, "get_last_error_reason") else ""
        raise HTTPException(401, f"SAML 断言校验失败: {', '.join(errors) or reason or 'unauthenticated'}")

    attrs = auth.get_attributes() or {}
    name_id = auth.get_nameid() or ""
    email = _first_attr(
        attrs,
        "email",
        "mail",
        "Email",
        "User.email",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
    ) or (name_id if "@" in name_id else "")
    if not email:
        raise HTTPException(400, "SAML assertion 缺少 email/nameID")
    display_name = _first_attr(
        attrs,
        "name",
        "displayName",
        "givenName",
        "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
    ) or email
    groups = _groups_from_attrs(attrs)
    tenant_code = _tenant_code_from_email(email, cfg)
    role = _resolve_role(groups, cfg)
    tenant = _ensure_tenant(db, tenant_code)
    user = _jit_user(db, tenant=tenant, email=email, name=display_name, role=role)
    db.commit()
    session = _make_token(user.id, user.tenant_id, user.role, user.username)

    try:
        from sop_manager.routers.audit_chain import append_audit
        append_audit(
            "sso.saml.login",
            user_id=user.id,
            tenant_id=user.tenant_id,
            details={
                "provider": provider,
                "name_id": name_id,
                "email": email,
                "groups": groups,
                "role": user.role,
                "tenant_slug": tenant.slug,
                "session_index": auth.get_session_index() if hasattr(auth, "get_session_index") else "",
            },
        )
    except Exception:
        pass

    relay_state = str(req.get("post_data", {}).get("RelayState") or "/?shell=1#/dashboard")
    payload = {
        "token": session,
        "user": {
            "user_id": user.id,
            "username": user.username,
            "email": user.email,
            "role": user.role,
            "tenant_id": user.tenant_id,
            "tenant_slug": tenant.slug,
            "tenant_name": tenant.name,
            "groups": groups,
            "sso_provider": provider,
            "saml_name_id": name_id,
        },
    }
    html_doc = f"""<!doctype html><meta charset="utf-8"><title>SAML Login</title>
<script>
const payload = {json.dumps(payload, ensure_ascii=False)};
localStorage.setItem("sop-token", payload.token);
localStorage.setItem("sop-user", JSON.stringify(payload.user));
location.replace({json.dumps(relay_state)});
</script>
<p>SAML login succeeded. Redirecting...</p>"""
    return HTMLResponse(html_doc)


@router.get("/scim/v2/{provider}/ServiceProviderConfig")
def scim_service_provider_config(provider: str, request: Request) -> dict[str, Any]:
    _scim_provider_from_request(request, provider)
    return {
        "schemas": ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
        "patch": {"supported": True},
        "bulk": {"supported": False, "maxOperations": 0, "maxPayloadSize": 0},
        "filter": {"supported": True, "maxResults": 100},
        "changePassword": {"supported": False},
        "sort": {"supported": False},
        "etag": {"supported": False},
        "authenticationSchemes": [
            {"type": "oauthbearertoken", "name": "Bearer Token", "primary": True}
        ],
    }


@router.get("/scim/v2/{provider}/Users")
def scim_list_users(
    provider: str,
    request: Request,
    filter: str = "",
    startIndex: int = 1,
    count: int = 100,
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    _, cfg = _scim_provider_from_request(request, provider)
    q = _scim_scoped_users_query(db, cfg)
    if filter:
        raw = filter.strip()
        lowered = raw.lower()
        if lowered.startswith("username eq ") or lowered.startswith('userName eq '.lower()):
            wanted = raw.split(" ", 2)[2].strip().strip('"')
            q = q.filter((User.email == wanted) | (User.username == wanted))
    total = q.count()
    items = q.order_by(User.username.asc()).offset(max(startIndex - 1, 0)).limit(max(min(count, 100), 1)).all()
    return {
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        "totalResults": total,
        "startIndex": startIndex,
        "itemsPerPage": len(items),
        "Resources": [_scim_user_resource(user) for user in items],
    }


@router.post("/scim/v2/{provider}/Users", status_code=201)
async def scim_create_user(provider: str, request: Request, db: Session = Depends(get_session)) -> dict[str, Any]:
    name, cfg = _scim_provider_from_request(request, provider)
    payload = await request.json()
    result = _provision_scim_user(db, cfg, payload)
    resource = result["resource"]
    _record_scim_audit_safe(
        name,
        "user_created",
        actor=f"scim:{name}",
        subject=str(resource.get("id") or ""),
        details={
            "email": resource.get("userName"),
            "tenant": result.get("tenant"),
            "role": result.get("role"),
            "active": resource.get("active"),
            "groups": result.get("groups", []),
        },
    )
    return result["resource"]


@router.get("/scim/v2/{provider}/Users/{user_id}")
def scim_get_user(provider: str, user_id: str, request: Request, db: Session = Depends(get_session)) -> dict[str, Any]:
    _scim_provider_from_request(request, provider)
    user = db.get(User, user_id)
    if not user:
        raise _scim_error(404, "SCIM user not found", "notFound")
    return _scim_user_resource(user)


@router.put("/scim/v2/{provider}/Users/{user_id}")
async def scim_put_user(provider: str, user_id: str, request: Request, db: Session = Depends(get_session)) -> dict[str, Any]:
    name, cfg = _scim_provider_from_request(request, provider)
    user = db.get(User, user_id)
    if not user:
        raise _scim_error(404, "SCIM user not found", "notFound")
    payload = await request.json()
    email = _scim_email(payload)
    if email:
        user.email = email
    groups = _scim_group_values(payload.get("groups"))
    if groups:
        user.role = _resolve_role(groups, cfg)
    user.status = "active" if bool(payload.get("active", True)) else "disabled"
    db.add(user)
    db.commit()
    resource = _scim_user_resource(user)
    _record_scim_audit_safe(
        name,
        "user_replaced",
        actor=f"scim:{name}",
        subject=user.id,
        details={"email": resource.get("userName"), "role": user.role, "active": resource.get("active")},
    )
    return resource


@router.patch("/scim/v2/{provider}/Users/{user_id}")
async def scim_patch_user(provider: str, user_id: str, request: Request, db: Session = Depends(get_session)) -> dict[str, Any]:
    name, _ = _scim_provider_from_request(request, provider)
    user = db.get(User, user_id)
    if not user:
        raise _scim_error(404, "SCIM user not found", "notFound")
    payload = await request.json()
    for op in payload.get("Operations", []):
        if not isinstance(op, dict):
            continue
        path = str(op.get("path") or "").lower()
        value = op.get("value")
        if path == "active" or (path == "" and isinstance(value, dict) and "active" in value):
            active = value if isinstance(value, bool) else bool(value.get("active"))
            user.status = "active" if active else "disabled"
        if isinstance(value, dict):
            if value.get("userName"):
                user.email = str(value.get("userName")).strip().lower()
            if value.get("emails"):
                user.email = _scim_email(value)
            if value.get("roles"):
                roles = _scim_group_values(value.get("roles"))
                if roles:
                    user.role = _norm_role(roles[0]) if _norm_role(roles[0]) in USER_ROLES else user.role
    db.add(user)
    db.commit()
    resource = _scim_user_resource(user)
    _record_scim_audit_safe(
        name,
        "user_patched",
        actor=f"scim:{name}",
        subject=user.id,
        details={"ops_count": len(payload.get("Operations", [])) if isinstance(payload.get("Operations"), list) else 0, "email": resource.get("userName"), "role": user.role, "active": resource.get("active")},
    )
    return resource


@router.delete("/scim/v2/{provider}/Users/{user_id}", status_code=204)
def scim_delete_user(provider: str, user_id: str, request: Request, db: Session = Depends(get_session)) -> Response:
    name, _ = _scim_provider_from_request(request, provider)
    user = db.get(User, user_id)
    if not user:
        raise _scim_error(404, "SCIM user not found", "notFound")
    user.status = "disabled"
    db.add(user)
    db.commit()
    _record_scim_audit_safe(
        name,
        "user_disabled",
        actor=f"scim:{name}",
        subject=user.id,
        details={"email": user.email or user.username, "role": user.role},
    )
    return Response(status_code=204)


@router.get("/scim/v2/{provider}/Groups")
def scim_list_groups(provider: str, request: Request) -> dict[str, Any]:
    _, cfg = _scim_provider_from_request(request, provider)
    roles = [
        {
            "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
            "id": role,
            "displayName": role,
            "members": [],
            "meta": {"resourceType": "Group", "location": f"/api/v1/sso/scim/v2/{provider}/Groups/{role}"},
        }
        for role in sorted(set(_normalize_map(cfg.get("role_map", {})).values()) or set(USER_ROLES))
        if role in USER_ROLES
    ]
    return {
        "schemas": ["urn:ietf:params:scim:api:messages:2.0:ListResponse"],
        "totalResults": len(roles),
        "startIndex": 1,
        "itemsPerPage": len(roles),
        "Resources": roles,
    }


@router.get("/scim/v2/{provider}/Groups/{group_id}")
def scim_get_group(provider: str, group_id: str, request: Request, db: Session = Depends(get_session)) -> dict[str, Any]:
    _, cfg = _scim_provider_from_request(request, provider)
    role = _scim_role_id(group_id)
    members = _scim_scoped_users_query(db, cfg).filter(User.role == role).order_by(User.username.asc()).all()
    return _scim_group_resource(provider, role, members)


@router.put("/scim/v2/{provider}/Groups/{group_id}")
async def scim_put_group(provider: str, group_id: str, request: Request, db: Session = Depends(get_session)) -> dict[str, Any]:
    name, cfg = _scim_provider_from_request(request, provider)
    role = _scim_role_id(group_id)
    payload = await request.json()
    result = _sync_scim_group_members(db, cfg, role, _scim_member_ids(payload), mode="replace")
    _record_scim_audit_safe(
        name,
        "group_replaced",
        actor=f"scim:{name}",
        subject=role,
        details={"role": role, "changed_count": len(result["changed"]), "skipped_count": len(result["skipped"]), "changed": result["changed"], "skipped": result["skipped"]},
    )
    return result["resource"]


@router.patch("/scim/v2/{provider}/Groups/{group_id}")
async def scim_patch_group(provider: str, group_id: str, request: Request, db: Session = Depends(get_session)) -> dict[str, Any]:
    name, cfg = _scim_provider_from_request(request, provider)
    role = _scim_role_id(group_id)
    payload = await request.json()
    changed: list[str] = []
    skipped: list[str] = []
    for op in payload.get("Operations", []):
        if not isinstance(op, dict):
            continue
        operation = str(op.get("op") or "").lower()
        if operation == "add":
            result = _sync_scim_group_members(db, cfg, role, _scim_member_ids(op.get("value")), mode="add")
            changed.extend(result["changed"])
            skipped.extend(result["skipped"])
        elif operation == "remove":
            result = _sync_scim_group_members(db, cfg, role, _scim_member_ids(op.get("value")), mode="remove")
            changed.extend(result["changed"])
            skipped.extend(result["skipped"])
        elif operation == "replace":
            result = _sync_scim_group_members(db, cfg, role, _scim_member_ids(op.get("value")), mode="replace")
            changed.extend(result["changed"])
            skipped.extend(result["skipped"])
    members = _scim_scoped_users_query(db, cfg).filter(User.role == role).order_by(User.username.asc()).all()
    _record_scim_audit_safe(
        name,
        "group_patched",
        actor=f"scim:{name}",
        subject=role,
        details={
            "role": role,
            "ops_count": len(payload.get("Operations", [])) if isinstance(payload.get("Operations"), list) else 0,
            "changed_count": len(set(changed)),
            "skipped_count": len(set(skipped)),
            "changed": sorted(set(changed)),
            "skipped": sorted(set(skipped)),
        },
    )
    return _scim_group_resource(provider, role, members)


# ── Casbin ABAC（带 fallback） ────────────────────────────────
_CASBIN_ENFORCER: Any = None


def _build_casbin() -> Any:
    global _CASBIN_ENFORCER
    if _CASBIN_ENFORCER is not None:
        return _CASBIN_ENFORCER
    try:
        import casbin  # type: ignore[import-not-found]
    except ImportError:
        _log.info("casbin 未安装，使用退化版 ABAC")
        _CASBIN_ENFORCER = _SimpleAbac()
        return _CASBIN_ENFORCER
    model = os.getenv("SOP_CASBIN_MODEL", "")
    policy = os.getenv("SOP_CASBIN_POLICY", "")
    if not model or not policy:
        _CASBIN_ENFORCER = _SimpleAbac()
        return _CASBIN_ENFORCER
    _CASBIN_ENFORCER = casbin.Enforcer(model, policy)
    return _CASBIN_ENFORCER


class _SimpleAbac:
    """fallback：从环境变量读策略 SOP_ABAC_POLICY=`role:admin/*` 任意 act。"""

    def enforce(self, sub: str, obj: str, act: str, ctx: Optional[dict] = None) -> bool:  # noqa: D401
        policies = (os.getenv("SOP_ABAC_POLICY") or "").split(",")
        for raw in policies:
            raw = raw.strip()
            if not raw:
                continue
            # 简单语法：role:<r>/<obj_pattern>:<act_pattern>
            try:
                _, r_obj_act = raw.split(":", 1)
                r_part, oa = r_obj_act.split("/", 1)
                obj_p, act_p = oa.split(":", 1)
                if ctx and r_part in (ctx.get("roles") or []) and (obj_p in ("*", obj)) and (act_p in ("*", act)):
                    return True
            except Exception:
                continue
        # 默认 admin 通过
        if ctx and "admin" in (ctx.get("roles") or []):
            return True
        return False


@router.post("/abac/enforce")
def abac_enforce(payload: dict[str, Any]) -> dict[str, bool]:
    """前端 / 服务可主动校验权限。

    body: {"sub":"u1","obj":"project/p1","act":"read",
            "ctx":{"roles":["admin"],"tenant_id":"t1"}}
    """
    e = _build_casbin()
    ok = e.enforce(payload.get("sub", ""), payload.get("obj", ""),
                   payload.get("act", ""), payload.get("ctx", {}))
    return {"allow": bool(ok)}
