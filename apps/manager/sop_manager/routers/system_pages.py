"""系统页面能力地图：新平台模块、细粒度能力权限与 legacy 能力承接注册表。"""
from __future__ import annotations

import json
import hashlib
import gzip
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from shlex import quote as shell_quote
from typing import Any
from urllib.parse import quote
from uuid import uuid4

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from sop_manager.path_config import resolved_ai_memory_root
from .auth_sql import USER_ROLES, User, current_user
from .tasks import TaskBulkUpdate, TaskCreate, bulk_update_tasks, create_task, list_tasks

router = APIRouter(prefix="/api/v1/system/pages", tags=["system-pages"])

TASK_STATUS_PATTERN = "^(pending|in_progress|blocked|completed)$"
TASK_PRIORITY_PATTERN = "^P[0-3]$"
SYSTEM_GOVERNANCE_TASK_STATUSES = ("pending", "in_progress", "blocked", "completed")
SYSTEM_GOVERNANCE_TASK_PRIORITIES = ("P0", "P1", "P2", "P3")
SYSTEM_GOVERNANCE_TASKS_API = "/api/v1/system/pages/governance-tasks"
SYSTEM_GOVERNANCE_TASKS_BULK_UPDATE_API = "/api/v1/system/pages/governance-tasks/bulk-update"
SYSTEM_GOVERNANCE_TASKS_ROUTE = "#/system-map/governance-tasks"
SYSTEM_TASK_CENTER_ROUTE = "#/tasks"


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _action_runs_file():
    d = resolved_ai_memory_root() / "system-pages-v4"
    d.mkdir(parents=True, exist_ok=True)
    return d / "module_action_runs.jsonl"


def _action_policy_file():
    d = resolved_ai_memory_root() / "system-pages-v4"
    d.mkdir(parents=True, exist_ok=True)
    return d / "module_action_policy.json"


def _action_approvals_file():
    d = resolved_ai_memory_root() / "system-pages-v4"
    d.mkdir(parents=True, exist_ok=True)
    return d / "module_action_approvals.jsonl"


def _isolation_scan_runs_file() -> Path:
    d = resolved_ai_memory_root() / "system-pages-v4"
    d.mkdir(parents=True, exist_ok=True)
    return d / "isolation_scan_runs.jsonl"


def _menu_prefs_dir() -> Path:
    d = resolved_ai_memory_root() / "system-pages-v4" / "menu_prefs"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _menu_prefs_file(user: User) -> Path:
    tenant = str(getattr(user, "tenant_id", "") or "default").replace("/", "_")
    uid = str(getattr(user, "id", "") or getattr(user, "username", "") or "anonymous").replace("/", "_")
    return _menu_prefs_dir() / f"{tenant}__{uid}.json"


def _default_action_policy() -> dict[str, Any]:
    return {
        "enabled": True,
        "mode": "advisory",
        "approval_threshold": 60,
        "alert_threshold": 35,
        "block_threshold": 90,
        "notify_channels": [],
        "notes": "默认建议模式：高风险动作给出审批/告警建议，不阻断现有操作。",
    }


def _read_action_policy() -> dict[str, Any]:
    path = _action_policy_file()
    if not path.exists():
        return _default_action_policy()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        raw = {}
    policy = {**_default_action_policy(), **(raw if isinstance(raw, dict) else {})}
    for key in ("approval_threshold", "alert_threshold", "block_threshold"):
        try:
            policy[key] = max(0, min(int(policy.get(key, 0)), 100))
        except Exception:
            policy[key] = _default_action_policy()[key]
    policy["mode"] = policy.get("mode") if policy.get("mode") in {"advisory", "enforce"} else "advisory"
    policy["notify_channels"] = [str(x) for x in policy.get("notify_channels", []) if str(x).strip()]
    return policy


def _write_action_policy(policy: dict[str, Any]) -> dict[str, Any]:
    current = _read_action_policy()
    merged = {**current, **policy, "updated_at": _utc_now()}
    path = _action_policy_file()
    path.write_text(json.dumps(merged, ensure_ascii=False, indent=2), encoding="utf-8")
    return merged


def _append_action_run(row: dict[str, Any]) -> dict[str, Any]:
    path = _action_runs_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")
    return row


def _append_approval(row: dict[str, Any]) -> dict[str, Any]:
    path = _action_approvals_file()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(row, ensure_ascii=False, default=str) + "\n")
    return row


def _read_approvals(status: str = "", limit: int = 100) -> list[dict[str, Any]]:
    path = _action_approvals_file()
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        if status and status != "all" and str(row.get("status")) != status:
            continue
        rows.append(row)
    rows.sort(key=lambda item: str(item.get("updated_at") or item.get("created_at") or ""), reverse=True)
    return rows[: max(1, min(int(limit or 100), 500))]


def _approval_exists(run_id: str) -> bool:
    return any(str(item.get("run_id")) == run_id for item in _read_approvals(status="all", limit=500))


def _create_approval_request(run: dict[str, Any], *, reason: str) -> dict[str, Any] | None:
    run_id = str(run.get("id") or "")
    if not run_id or _approval_exists(run_id):
        return None
    row = {
        "id": f"maa-{uuid4().hex[:12]}",
        "run_id": run_id,
        "status": "pending",
        "reason": reason,
        "module_id": run.get("module_id"),
        "module_name": run.get("module_name"),
        "action_id": run.get("action_id"),
        "action_name": run.get("action_name"),
        "risk": run.get("risk") or {},
        "policy": run.get("policy") or {},
        "requested_by": run.get("role") or "",
        "created_at": _utc_now(),
        "updated_at": _utc_now(),
        "reviewer": "",
        "review_note": "",
    }
    return _append_approval(row)


def _review_approval(approval_id: str, *, status: str, reviewer: str, note: str = "") -> dict[str, Any] | None:
    rows = _read_approvals(status="all", limit=500)
    target: dict[str, Any] | None = None
    out: list[dict[str, Any]] = []
    for row in rows:
        if str(row.get("id")) == approval_id:
            row = {
                **row,
                "status": status,
                "reviewer": reviewer,
                "review_note": note,
                "updated_at": _utc_now(),
            }
            target = row
        out.append(row)
    if target is None:
        return None
    path = _action_approvals_file()
    path.write_text(
        "".join(json.dumps(row, ensure_ascii=False, default=str) + "\n" for row in sorted(out, key=lambda item: str(item.get("created_at") or ""))),
        encoding="utf-8",
    )
    return target


def _risk_level(score: int) -> str:
    if score >= 80:
        return "critical"
    if score >= 60:
        return "high"
    if score >= 35:
        return "medium"
    return "low"


def _assess_action_run_risk(run: dict[str, Any], action: dict[str, Any] | None = None) -> dict[str, Any]:
    score = 10
    reasons: list[str] = []
    recommendations: list[str] = []
    action_type = str(run.get("action_type") or (action.get("type") if action else "") or "")
    action_id = str(run.get("action_id") or "")
    required_action = str(action.get("required_action") or "") if action else ""
    if action_type in {"admin"} or required_action == "admin":
        score += 45
        reasons.append("admin_action")
        recommendations.append("保留管理员审批与审计链证据。")
    if action_type == "task" or action_id in {"create_delivery_task", "create_legacy_migration_tasks"}:
        score += 25
        reasons.append("creates_delivery_work")
        recommendations.append("确认生成任务的负责人、优先级和范围，避免批量误派。")
    if action_id == "create_legacy_migration_tasks":
        score += 15
        reasons.append("bulk_legacy_migration")
        recommendations.append("建议分批迁移并在任务看板跟踪验收。")
    if action_type == "copilot":
        score += 12
        reasons.append("ai_assisted_action")
        recommendations.append("复核 AI 分析上下文，敏感配置不要进入提示词。")
    if not run.get("executed"):
        score += 8
        reasons.append("not_executed")
    evidence = run.get("evidence") or {}
    if evidence:
        chain = evidence.get("audit_chain") or {}
        event = evidence.get("event") or {}
        if isinstance(chain, dict) and chain.get("error"):
            score += 20
            reasons.append("audit_chain_error")
            recommendations.append("检查审计链写入状态，必要时重新链入证据。")
        if isinstance(event, dict) and event.get("error"):
            score += 15
            reasons.append("event_publish_error")
            recommendations.append("检查事件流水与 WSS 广播，避免 Agent 漏消费。")
    else:
        score += 18
        reasons.append("missing_evidence")
        recommendations.append("补齐审计链与事件证据后再进入生产自动化。")
    score = max(0, min(score, 100))
    if not recommendations:
        recommendations.append("保持当前审计与事件证据完整。")
    return {
        "score": score,
        "level": _risk_level(score),
        "reasons": reasons or ["standard_action"],
        "recommendations": recommendations,
    }


def _evaluate_action_policy(risk: dict[str, Any], *, policy: dict[str, Any] | None = None) -> dict[str, Any]:
    policy = policy or _read_action_policy()
    score = int(risk.get("score") or 0)
    decision = "allow"
    matched: list[str] = []
    next_steps: list[str] = []
    if not policy.get("enabled", True):
        return {"decision": "allow", "mode": policy.get("mode", "advisory"), "matched_rules": ["policy_disabled"], "next_steps": ["策略未启用，按默认动作执行。"]}
    if score >= int(policy.get("block_threshold", 90)):
        decision = "block" if policy.get("mode") == "enforce" else "requires_approval"
        matched.append("block_threshold")
        next_steps.append("严重风险动作需要管理员确认；强制模式下应阻断执行。")
    elif score >= int(policy.get("approval_threshold", 60)):
        decision = "requires_approval"
        matched.append("approval_threshold")
        next_steps.append("建议进入审批流，审批通过后再执行或落任务。")
    elif score >= int(policy.get("alert_threshold", 35)):
        decision = "alert"
        matched.append("alert_threshold")
        next_steps.append("建议通知项目负责人并在审计页持续跟踪。")
    else:
        matched.append("standard")
        next_steps.append("风险较低，保留审计链和事件证据即可。")
    channels = policy.get("notify_channels") or []
    if channels and decision in {"alert", "requires_approval", "block"}:
        next_steps.append(f"通知通道: {', '.join(channels)}")
    return {
        "decision": decision,
        "mode": policy.get("mode", "advisory"),
        "matched_rules": matched,
        "next_steps": next_steps,
    }


def _read_action_runs(limit: int = 50, module_id: str = "", action_id: str = "", risk_level: str = "") -> list[dict[str, Any]]:
    path = _action_runs_file()
    if not path.exists():
        return []
    rows: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            row = json.loads(line)
        except Exception:
            continue
        if module_id and str(row.get("module_id")) != module_id:
            continue
        if action_id and str(row.get("action_id")) != action_id:
            continue
        if not row.get("risk"):
            row["risk"] = _assess_action_run_risk(row)
        if not row.get("policy"):
            row["policy"] = _evaluate_action_policy(row["risk"])
        if risk_level and risk_level != "all" and str(row.get("risk", {}).get("level")) != risk_level:
            continue
        rows.append(row)
    rows.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
    return rows[: max(1, min(int(limit or 50), 500))]


def _publish_action_run(run: dict[str, Any]) -> dict[str, Any]:
    evidence: dict[str, Any] = {"audit_chain": None, "event": None, "broadcast": False}
    try:
        from sop_manager.routers.audit_chain import append_audit

        evidence["audit_chain"] = append_audit(
            "system.module_action.execute",
            user_id=str(run.get("role") or ""),
            tenant_id="system",
            project_id=str(run.get("project_code") or ""),
            resource_type="system_page_action",
            resource_id=str(run.get("id") or ""),
            details=run,
        )
    except Exception as err:  # pragma: no cover
        evidence["audit_chain"] = {"error": str(err)}
    try:
        from sop_manager.sync_journal import append_event

        event = append_event(
            module="system_pages",
            action="system.module_action.execute",
            record_id=str(run.get("id") or ""),
            idempotency_key=str(run.get("id") or ""),
            payload={
                "specversion": "1.0",
                "id": str(run.get("id") or ""),
                "type": "sop.system.module_action.executed",
                "source": "manager.system_pages",
                "subject": f"{run.get('module_id')}.{run.get('action_id')}",
                "time": run.get("created_at"),
                "data": run,
            },
        )
        evidence["event"] = event
        try:
            from sop_manager.routers.ws_events import broadcast

            broadcast(
                str(run.get("project_code") or ""),
                {
                    "type": "sop.system.module_action.executed",
                    "id": run.get("id"),
                    "subject": f"{run.get('module_id')}.{run.get('action_id')}",
                    "data": run,
                    "journal": event,
                },
            )
            evidence["broadcast"] = True
        except Exception as err:  # pragma: no cover
            evidence["broadcast_error"] = str(err)
    except Exception as err:  # pragma: no cover
        evidence["event"] = {"error": str(err)}
    return evidence


DOMAINS: list[dict[str, Any]] = [
    {"id": "overview", "name": "战略总览", "name_en": "Executive Overview", "order": 10, "owner": "platform-office", "capability": "overview", "description": "跨项目运营驾驶舱、平台蓝图、风险与下一步动作。"},
    {"id": "portfolio", "name": "组织项目", "name_en": "Organization & Portfolio", "order": 20, "owner": "portfolio", "capability": "portfolio", "description": "租户、业务线、项目组合、成员权限和 AI 接入资产。"},
    {"id": "product", "name": "产品需求", "name_en": "Product Requirements", "order": 30, "owner": "product", "capability": "product", "description": "需求池、智能评审、验收标准、路线图和需求到任务。"},
    {"id": "delivery", "name": "研发交付", "name_en": "Engineering Delivery", "order": 40, "owner": "delivery", "capability": "delivery", "description": "任务、依赖关系调度、Sprint、工作流、部署和执行证据。"},
    {"id": "data", "name": "数据智能", "name_en": "Data Intelligence", "order": 50, "owner": "data", "capability": "data", "description": "数据接入、指标、血缘、标签、NLQ、洞察报告和数据治理。"},
    {"id": "ai", "name": "AI 智能", "name_en": "AI Intelligence", "order": 60, "owner": "ai", "capability": "ai", "description": "Copilot、知识、记忆、RAG、Worker、模型评估和智能决策。"},
    {"id": "ecosystem", "name": "平台生态", "name_en": "Platform Ecosystem", "order": 70, "owner": "ecosystem", "capability": "ecosystem", "description": "Agent、MCP、A2A、模型、资产市场、通信连接器和插件生态。"},
    {"id": "governance", "name": "安全治理", "name_en": "Security Governance", "order": 80, "owner": "governance", "capability": "governance", "description": "审计链、模块治理、动作审批、风险策略、权限能力矩阵。"},
    {"id": "system", "name": "系统运维", "name_en": "System Operations", "order": 90, "owner": "system", "capability": "system", "description": "系统设置、SSO、部署 Profile、计费、日志、观测和高可用配置。"},
]

DOMAIN_BY_ID = {d["id"]: d for d in DOMAINS}

MICRO_APPS: list[dict[str, Any]] = [
    {
        "id": "main-admin",
        "name": "主应用 · 基础管理",
        "owner": "Platform Admin",
        "route": "#/apps/main-admin",
        "runtime_url": "/",
        "entry": "index.html",
        "mode": "native",
        "domains": ["overview", "portfolio", "governance", "system"],
        "module_ids": ["dashboard", "projects", "organization", "microAppGovernance", "systemMap", "settings"],
        "responsibilities": ["基础管理", "账号权限", "组织管理", "服务治理", "能力控制面"],
    },
    {
        "id": "ai-foundation",
        "name": "智能基础服务",
        "owner": "AI Platform",
        "route": "#/apps/ai-foundation",
        "runtime_url": "/subapps/ai-foundation/",
        "entry": "subapps/ai-foundation/index.html",
        "mode": "standalone",
        "domains": ["ai", "ecosystem"],
        "module_ids": ["intelligence", "platforms", "marketplace", "skillsHub", "agentOps", "llmGateway", "knowledgeGraph", "a2aGateway"],
        "responsibilities": ["开发环境", "CLI 工具", "知识记忆", "技能插件", "Agent/MCP/A2A"],
    },
    {
        "id": "ai-rd-center",
        "name": "智能研发中心",
        "owner": "Engineering AI",
        "route": "#/apps/ai-rd-center",
        "runtime_url": "/subapps/ai-rd-center/",
        "entry": "subapps/ai-rd-center/index.html",
        "mode": "standalone",
        "domains": ["product", "delivery", "ai"],
        "module_ids": ["requirements", "tasks", "issues", "devFlow", "orchestration", "workflows", "copilot", "vibe", "globalSearch"],
        "responsibilities": ["需求方案", "AI 开发", "任务下发", "调度监控", "质量评审", "运维闭环"],
    },
    {
        "id": "ai-data-center",
        "name": "智能数据中心",
        "owner": "Data Platform",
        "route": "#/apps/ai-data-center",
        "runtime_url": "/subapps/ai-data-center/",
        "entry": "subapps/ai-data-center/index.html",
        "mode": "standalone",
        "domains": ["data"],
        "module_ids": ["analytics", "analyticsCatalog", "analyticsReports", "analyticsLineage", "metadataManagement", "dataExchange", "dataSources", "dataIngest", "dataQualityCenter", "metricsCenter", "tagService", "dataDev"],
        "responsibilities": ["数据源", "数据接入", "元数据血缘", "数据开发", "指标标签", "数据服务"],
    },
    {
        "id": "ai-ops-center",
        "name": "智能运营中心",
        "owner": "Operations",
        "route": "#/apps/ai-ops-center",
        "runtime_url": "/subapps/ai-ops-center/",
        "entry": "subapps/ai-ops-center/index.html",
        "mode": "standalone",
        "domains": ["governance", "system", "ecosystem"],
        "module_ids": ["notify", "webhooks", "audit", "settings", "envOps", "opsCenter"],
        "responsibilities": ["商业计费", "安全审计", "企业 SSO", "通信集成", "智能运维"],
    },
]

DOMAIN_ROLE_MATRIX: dict[str, dict[str, list[str]]] = {
    "overview": {"read": ["viewer", "developer", "devops", "product_manager", "analyst", "project_admin", "tenant_admin", "super_admin"], "write": ["project_admin", "tenant_admin", "super_admin"], "admin": ["tenant_admin", "super_admin"]},
    "portfolio": {"read": ["viewer", "developer", "devops", "product_manager", "analyst", "project_admin", "tenant_admin", "super_admin"], "write": ["project_admin", "tenant_admin", "super_admin"], "admin": ["tenant_admin", "super_admin"]},
    "product": {"read": ["viewer", "developer", "devops", "product_manager", "analyst", "project_admin", "tenant_admin", "super_admin"], "write": ["developer", "product_manager", "project_admin", "tenant_admin", "super_admin"], "admin": ["project_admin", "tenant_admin", "super_admin"]},
    "delivery": {"read": ["viewer", "developer", "devops", "product_manager", "analyst", "project_admin", "tenant_admin", "super_admin"], "write": ["developer", "devops", "project_admin", "tenant_admin", "super_admin"], "admin": ["project_admin", "tenant_admin", "super_admin"]},
    "data": {"read": ["viewer", "developer", "devops", "product_manager", "analyst", "project_admin", "tenant_admin", "super_admin"], "write": ["analyst", "devops", "project_admin", "tenant_admin", "super_admin"], "admin": ["project_admin", "tenant_admin", "super_admin"]},
    "ai": {"read": ["developer", "devops", "product_manager", "analyst", "project_admin", "tenant_admin", "super_admin"], "write": ["developer", "devops", "project_admin", "tenant_admin", "super_admin"], "admin": ["tenant_admin", "super_admin"]},
    "ecosystem": {"read": ["developer", "devops", "project_admin", "tenant_admin", "super_admin"], "write": ["devops", "tenant_admin", "super_admin"], "admin": ["tenant_admin", "super_admin"]},
    "governance": {"read": ["devops", "project_admin", "tenant_admin", "super_admin"], "write": ["devops", "tenant_admin", "super_admin"], "admin": ["tenant_admin", "super_admin"]},
    "system": {"read": ["tenant_admin", "super_admin"], "write": ["tenant_admin", "super_admin"], "admin": ["super_admin"]},
}

AI_SURFACE_BY_DOMAIN: dict[str, list[str]] = {
    "overview": ["platform_blueprint", "risk_summary", "next_action"],
    "portfolio": ["project_onboarding", "team_governance", "permission_suggest"],
    "product": ["requirement_split", "acceptance_review", "priority_suggest"],
    "delivery": ["task_plan", "dag_schedule", "dependency_detect", "risk_debug"],
    "data": ["metric_explain", "nlq", "insight_to_task"],
    "ai": ["copilot", "rag", "memory", "worker"],
    "ecosystem": ["agent_profile", "mcp_tool_plan", "model_route", "connector_health"],
    "governance": ["audit_explain", "module_policy", "risk_review", "approval_suggest"],
    "system": ["ops_doctor", "sso_policy", "billing_alert"],
}

SUBMODULES_BY_PAGE: dict[str, list[tuple[str, str]]] = {
    "dashboard": [("executive_overview", "运营总览"), ("platform_blueprint", "平台蓝图"), ("risk_board", "风险看板"), ("technology_upgrade", "技术升级"), ("next_actions", "下一步动作")],
    "projects": [("portfolio", "项目组合"), ("businesses", "业务线"), ("tenants", "租户范围"), ("tenant_users", "租户成员"), ("project_members", "项目成员"), ("onboarding", "AI 接入"), ("templates", "项目模板"), ("smart_governance", "智能治理")],
    "projectPortfolio": [("project_list", "项目清单"), ("health_summary", "健康摘要"), ("create_project", "创建项目")],
    "projectBusinesses": [("business_lines", "业务线"), ("ownership", "负责人"), ("create_business", "创建业务")],
    "tenantUsers": [("user_directory", "成员目录"), ("role_status", "角色状态"), ("password_reset", "密码重置")],
    "projectMembers": [("member_table", "项目成员"), ("candidate_users", "候选成员"), ("role_binding", "角色绑定")],
    "projectOnboarding": [("overview", "接入总览"), ("commands", "命令清单"), ("env", "环境变量"), ("agent_toml", "agent.toml"), ("tool_profiles", "工具 Profile"), ("context_assets", "上下文资产")],
    "projectTemplates": [("overview", "模板总览"), ("template_catalog", "模板目录"), ("clone_wizard", "克隆向导"), ("capability_flags", "能力开关")],
    "projectGovernance": [("readiness", "健康评估"), ("ops_plan", "治理操作包"), ("governance_tasks", "治理任务化"), ("agent_prompt", "Agent 接手提示词")],
    "organization": [("tenant_users", "租户成员"), ("business_lines", "业务线"), ("project_members", "项目成员"), ("role_policy", "角色策略"), ("abac", "ABAC"), ("field_security", "字段级安全"), ("row_filter", "行级过滤"), ("policy_simulation", "策略试算"), ("access_review", "权限体检")],
    "requirements": [("requirement_pool", "需求池"), ("smart_review", "智能评审"), ("task_generation", "任务拆解"), ("batch_governance", "批量治理")],
    "tasks": [("execution_table", "执行列表"), ("kanban", "状态看板"), ("dag_dependencies", "任务依赖关系"), ("scheduler_center", "依赖调度执行"), ("agent_feed", "Agent Feed"), ("bulk_governance", "批量治理")],
    "taskExecution": [("execution_table", "执行表格"), ("filters", "筛选器"), ("bulk_update", "批量治理")],
    "taskBoard": [("kanban", "状态看板"), ("drag_status", "状态流转"), ("priority_columns", "优先级视图")],
    "taskSprints": [("sprint_list", "迭代列表"), ("sprint_tasks", "迭代任务"), ("progress", "进度跟踪")],
    "taskDependencies": [("dependency_graph", "依赖图"), ("blockers", "阻塞来源"), ("cycle_check", "环路检查")],
    "taskScheduler": [("dag_plan", "依赖执行计划"), ("agent_feed", "Agent Feed"), ("quality_gates", "质量卡点"), ("event_wakeup", "事件唤醒")],
    "workflows": [("templates", "流程模板"), ("instances", "运行实例"), ("events", "事件流水"), ("signals", "信号控制"), ("bulk_ops", "运行治理")],
    "analytics": [("metrics_overview", "指标总览"), ("raw_metrics", "原始指标"), ("metric_export", "指标导出")],
    "analyticsBlueprint": [("capability_map", "能力地图"), ("stack_matrix", "技术栈矩阵"), ("gap_tasks", "缺口任务化")],
    "analyticsReports": [("report_assets", "报告资产"), ("report_subscription", "报告订阅"), ("action_tasks", "报告转任务"), ("notification", "报告分发")],
    "analyticsCatalog": [("capability_stack", "四层能力栈"), ("domain_overview", "五大专业域"), ("governance_export", "治理导出")],
    "dataAssets": [("asset_catalog", "资产目录"), ("quality_evaluate", "质量评估"), ("governance_tasks", "治理任务")],
    "metadataManagement": [("overview", "元数据总览"), ("assets", "资产目录"), ("fields", "字段目录"), ("lineage", "血缘影响")],
    "dataMetricsTags": [("metric_definitions", "指标口径"), ("tag_rules", "标签规则"), ("ownership", "负责人")],
    "dataServices": [("service_catalog", "服务目录"), ("publishing", "发布管理"), ("health", "健康检查")],
    "dataQuality": [("alerts", "质量告警"), ("notify", "通知"), ("fix_tasks", "修复任务")],
    "dataDevelopment": [("templates", "开发模板"), ("schedules", "调度历史"), ("agent_feed", "Agent Feed"), ("evidence", "质量证据"), ("runbook", "Runbook")],
    "analyticsLineage": [("lineage_graph", "血缘图谱"), ("impact_analysis", "影响分析"), ("dataset_relation", "数据集关系")],
    "dataExchange": [("export_jobs", "导出作业"), ("import_jobs", "导入作业"), ("preview_merge", "导入预检"), ("archive", "归档治理")],
    "dataSources": [("overview", "数据源总览"), ("connections", "连接目录"), ("metadata", "元数据同步"), ("security", "安全治理")],
    "dataIngest": [("connectors", "连接器管理"), ("dry_run", "连接器 Dry-run"), ("schema_registry", "Schema Registry"), ("cdc_cursors", "CDC 游标"), ("batch_jobs", "批量作业"), ("run_history", "运行历史")],
    "analyticsNlq": [("natural_query", "自然语言问数"), ("semantic_context", "语义上下文"), ("save_report", "保存报告")],
    "copilot": [("chat", "会话问答"), ("commands", "命令中心"), ("tool_plan", "工具计划"), ("plan_to_tasks", "计划转任务")],
    "intelligence": [("knowledge_assets", "知识资产"), ("retrieval_memory", "检索与记忆"), ("rules_distill", "规则与蒸馏"), ("runtime_ops", "运行治理"), ("spec_designs", "规约方案"), ("data_context", "数据上下文")],
    "knowledgeBase": [("documents", "知识文档"), ("index", "索引"), ("search", "检索")],
    "ragSearch": [("retrieval", "检索增强"), ("citations", "引用证据"), ("prompt_context", "提示词上下文")],
    "aiMemory": [("recent", "最近记忆"), ("search", "记忆检索"), ("attach_run", "运行挂载"), ("lifecycle", "生命周期")],
    "knowledgeGraph": [("build", "图谱构建"), ("query", "Graph RAG"), ("lineage", "血缘关联"), ("profile_merge", "画像合并")],
    "ruleCenter": [("proposals", "规则提案"), ("apply", "规则应用"), ("sync", "规则同步")],
    "reflectionDistill": [("run", "蒸馏运行"), ("proposal_review", "提案审核"), ("rule_apply", "规则入库")],
    "workerOps": [("job_types", "任务类型"), ("enqueue", "任务投递"), ("monitor", "运行监控")],
    "syncOps": [("modules", "同步模块"), ("pull", "拉取预览"), ("asset_push", "资产推送")],
    "eventStream": [("cloud_events", "CloudEvents"), ("sync_events", "同步事件"), ("agent_events", "Agent 事件")],
    "usageOps": [("quota", "配额"), ("alerts", "告警"), ("governance_tasks", "治理任务")],
    "llmGateway": [("routing", "模型路由"), ("cost", "成本控制"), ("attribution", "成本归因"), ("eval", "模型评测"), ("audit", "Prompt 审计"), ("health", "运行健康")],
    "platforms": [("tool_profiles", "工具接入"), ("mcp_hub", "MCP Hub"), ("agents", "Agent 注册"), ("agent_runs", "Agent 运行中心"), ("models", "模型管理"), ("ops", "运行治理"), ("a2a", "A2A 专家组")],
    "agentRuns": [("run_list", "运行列表"), ("heartbeat", "心跳监控"), ("capability_profiles", "能力画像"), ("retry", "失败重试"), ("evidence", "交付证据"), ("slo_rebalance", "SLO 与再平衡")],
    "a2aGateway": [("registry", "Agent 注册"), ("negotiate", "能力协商"), ("sla", "外部 SLA"), ("windows", "执行窗口"), ("dispatch", "任务分发"), ("evidence", "执行证据")],
    "a2aRegistry": [("agent_directory", "Agent 目录"), ("credential_rotation", "凭证轮换"), ("heartbeat", "双向心跳"), ("trust_policy", "信任策略"), ("lease_flow", "租约流转"), ("progress_sync", "进度回写")],
    "a2aWorkbench": [("health", "协议健康"), ("registry", "Agent 注册"), ("negotiate", "能力协商"), ("sessions", "协商时间线"), ("sla", "外部 SLA"), ("windows", "执行窗口"), ("dispatch", "任务分发"), ("evidence", "执行证据")],
    "a2aDispatch": [("dispatch_queue", "分发队列"), ("packet_preview", "协议包预览"), ("retry", "失败重试"), ("reassign", "任务改派"), ("lease_ops", "租约操作"), ("evidence_sync", "证据同步")],
    "marketplace": [("catalog", "资产目录"), ("installed", "已安装资产"), ("rating", "评分反馈"), ("signature", "签名状态")],
    "notify": [("connectors", "连接器"), ("channels", "通道模板"), ("outbound", "出站消息"), ("inbound", "入站消息"), ("messages", "消息流水"), ("subscriptions", "报告订阅"), ("subscription_runs", "订阅运行中心"), ("action_conversion", "消息转任务/需求")],
    "audit": [("hash_chain", "审计哈希链"), ("events", "事件检索"), ("module_actions", "模块动作审计"), ("approvals", "动作审批"), ("export", "合规导出")],
    "opsCenter": [("pipeline", "部署流水线"), ("alerts", "告警源治理"), ("rca", "智能根因分析"), ("runbook", "Runbook 治理"), ("self-heal", "自愈策略")],
    "opsCenterPipeline": [("release_flow", "发布流"), ("executor", "执行器"), ("callbacks", "回调证据")],
    "opsCenterAlerts": [("alert_sources", "告警源"), ("noise_policies", "降噪策略"), ("slo_escalation", "SLO 升级"), ("strategy_canary", "策略灰度"), ("strategy_linkage", "策略联动"), ("alert_events", "告警事件")],
    "opsCenterRca": [("incident_list", "故障清单"), ("verification", "验证计划"), ("insights", "智能洞察"), ("tasking", "任务化")],
    "opsCenterRunbook": [("runbook_library", "Runbook 库"), ("versions", "版本治理"), ("evidence", "执行证据")],
    "opsCenterSelfHeal": [("policies", "策略目录"), ("evaluation", "策略评估"), ("guardrail_actions", "护栏动作"), ("rollback", "回滚留证")],
    "systemMap": [
        ("registry", "页面注册表"),
        ("contract", "模块契约"),
        ("manifest", "模块 Manifest"),
        ("capabilities", "能力权限"),
        ("readiness", "模块完整度"),
        ("three_code_isolation", "三码隔离审计"),
        ("source_scan", "源码隔离扫描"),
        ("baseline_compare", "智能基线对比"),
        ("governance_tasks", "治理任务化"),
        ("actions", "动作目录"),
        ("legacy", "Legacy 收敛"),
        ("migration", "迁移任务"),
    ],
    "settings": [("account", "账户会话"), ("runtime", "运行状态"), ("management_entries", "管理入口"), ("sso", "企业 SSO"), ("billing", "商业计费"), ("profiles", "环境 Profile"), ("observability", "日志观测"), ("storage", "生产存储"), ("appearance", "外观主题")],
    "settingsSso": [("config", "SSO 配置"), ("risk", "风险报表"), ("scim", "SCIM 同步"), ("saml", "SAML 元数据"), ("runbooks", "风险 Runbook"), ("escalation", "自动升级")],
    "settingsBilling": [("subscription", "订阅套餐"), ("quota", "权益配额"), ("invoices", "账单发票"), ("payments", "收款回款"), ("dunning", "催收策略")],
    "settingsProfiles": [("profiles", "环境 Profile"), ("packages", "部署包"), ("approvals", "发布审批"), ("canary", "灰度策略"), ("pipelines", "部署流水线"), ("rollback", "回滚演练"), ("audit", "执行审计"), ("targets", "执行目标")],
    "legacyConsole": [("bridge", "Legacy 桥接"), ("target_jump", "目标跳转"), ("migration_task", "迁移任务")],
}


SUBMODULE_PATHS: dict[tuple[str, str], str] = {
    ("projects", "portfolio"): "#/projects/portfolio",
    ("projects", "businesses"): "#/projects/businesses",
    ("projects", "tenant_users"): "#/projects/users",
    ("projects", "project_members"): "#/projects/members",
    ("projects", "onboarding"): "#/projects/onboarding",
    ("projects", "templates"): "#/projects/templates",
    ("projects", "smart_governance"): "#/projects/governance",
    ("projectOnboarding", "overview"): "#/projects/onboarding/overview",
    ("projectOnboarding", "commands"): "#/projects/onboarding/commands",
    ("projectOnboarding", "env"): "#/projects/onboarding/env",
    ("projectOnboarding", "agent_toml"): "#/projects/onboarding/agent",
    ("projectOnboarding", "tool_profiles"): "#/projects/onboarding/profiles",
    ("projectOnboarding", "context_assets"): "#/projects/onboarding/context",
    ("projectTemplates", "overview"): "#/projects/templates/overview",
    ("projectTemplates", "template_catalog"): "#/projects/templates/catalog",
    ("projectTemplates", "clone_wizard"): "#/projects/templates/clone",
    ("projectTemplates", "capability_flags"): "#/projects/templates/capabilities",
    ("projectGovernance", "readiness"): "#/projects/governance/review",
    ("projectGovernance", "ops_plan"): "#/projects/governance/ops",
    ("projectGovernance", "governance_tasks"): "#/projects/governance/actions",
    ("projectGovernance", "agent_prompt"): "#/projects/governance/prompt",
    ("llmGateway", "routing"): "#/ai/llm-gateway/routing",
    ("llmGateway", "cost"): "#/ai/llm-gateway/cost",
    ("llmGateway", "attribution"): "#/ai/llm-gateway/attribution",
    ("llmGateway", "eval"): "#/ai/llm-gateway/eval",
    ("llmGateway", "audit"): "#/ai/llm-gateway/audit",
    ("llmGateway", "health"): "#/ai/llm-gateway/health",
    ("organization", "tenant_users"): "#/organization/users",
    ("organization", "business_lines"): "#/organization/businesses",
    ("organization", "project_members"): "#/organization/project-members",
    ("organization", "role_policy"): "#/organization/role-policy",
    ("organization", "access_review"): "#/organization/access-review",
    ("requirements", "requirement_pool"): "#/requirements/pool",
    ("requirements", "smart_review"): "#/requirements/review",
    ("requirements", "task_generation"): "#/requirements/generation",
    ("requirements", "batch_governance"): "#/requirements/batch",
    ("tasks", "execution_table"): "#/tasks/execution",
    ("tasks", "kanban"): "#/tasks/board",
    ("tasks", "dag_dependencies"): "#/tasks/dependencies",
    ("tasks", "scheduler_center"): "#/tasks/scheduler",
    ("workflows", "templates"): "#/workflows/templates",
    ("workflows", "instances"): "#/workflows/instances",
    ("workflows", "events"): "#/workflows/events",
    ("workflows", "signals"): "#/workflows/signals",
    ("workflows", "bulk_ops"): "#/workflows/bulk_ops",
    ("analyticsReports", "report_assets"): "#/analytics/reports/assets",
    ("analyticsReports", "report_subscription"): "#/analytics/reports/subscription",
    ("analyticsReports", "action_tasks"): "#/analytics/reports/action-tasks",
    ("analyticsCatalog", "capability_stack"): "#/analytics/catalog",
    ("analyticsCatalog", "domain_overview"): "#/analytics/catalog",
    ("analyticsCatalog", "governance_export"): "#/analytics/catalog",
    ("metadataManagement", "overview"): "#/data/metadata/overview",
    ("metadataManagement", "assets"): "#/data/metadata/assets",
    ("metadataManagement", "fields"): "#/data/metadata/fields",
    ("metadataManagement", "lineage"): "#/data/metadata/lineage",
    ("copilot", "chat"): "#/copilot/chat",
    ("copilot", "commands"): "#/copilot/commands",
    ("copilot", "tool_plan"): "#/copilot/tool-plan",
    ("intelligence", "knowledge_assets"): "#/intelligence/kb",
    ("intelligence", "retrieval_memory"): "#/intelligence/rag",
    ("intelligence", "rules_distill"): "#/intelligence/rules",
    ("intelligence", "runtime_ops"): "#/intelligence/worker",
    ("intelligence", "spec_designs"): "#/intelligence/specs",
    ("intelligence", "data_context"): "#/data/sources",
    ("platforms", "tool_profiles"): "#/platforms/tools",
    ("platforms", "mcp_hub"): "#/platforms/mcp",
    ("platforms", "agents"): "#/platforms/agents",
    ("platforms", "agent_runs"): "#/platforms/agent-runs",
    ("platforms", "models"): "#/platforms/models",
    ("platforms", "ops"): "#/platforms/ops",
    ("platforms", "a2a"): "#/ecosystem/a2a",
    ("agentRuns", "run_list"): "#/ai/agent-ops/runs",
    ("agentRuns", "heartbeat"): "#/ai/agent-ops/heartbeat",
    ("agentRuns", "capability_profiles"): "#/ai/agent-ops/profiles",
    ("agentRuns", "retry"): "#/ai/agent-ops/retry",
    ("agentRuns", "evidence"): "#/tasks?tab=scheduler&panel=agent-reports",
    ("agentRuns", "slo_rebalance"): "#/platforms/agent-runs",
    ("a2aGateway", "registry"): "#/ecosystem/a2a/registry",
    ("a2aGateway", "negotiate"): "#/ecosystem/a2a/negotiate",
    ("a2aGateway", "sla"): "#/ecosystem/a2a/sla",
    ("a2aGateway", "windows"): "#/ecosystem/a2a/windows",
    ("a2aGateway", "dispatch"): "#/ecosystem/a2a/dispatch",
    ("a2aGateway", "evidence"): "#/ecosystem/a2a/evidence",
    ("a2aRegistry", "agent_directory"): "#/ecosystem/a2a/registry",
    ("a2aRegistry", "credential_rotation"): "#/ecosystem/a2a/registry",
    ("a2aRegistry", "heartbeat"): "#/ecosystem/a2a/registry",
    ("a2aRegistry", "trust_policy"): "#/ecosystem/a2a/registry",
    ("a2aRegistry", "lease_flow"): "#/ecosystem/a2a/registry",
    ("a2aRegistry", "progress_sync"): "#/ecosystem/a2a/registry",
    ("a2aWorkbench", "health"): "#/ecosystem/a2a/workbench",
    ("a2aWorkbench", "registry"): "#/ecosystem/a2a/registry",
    ("a2aWorkbench", "negotiate"): "#/ecosystem/a2a/negotiate",
    ("a2aWorkbench", "sessions"): "#/ecosystem/a2a/negotiate?tab=sessions",
    ("a2aWorkbench", "sla"): "#/ecosystem/a2a/sla",
    ("a2aWorkbench", "windows"): "#/ecosystem/a2a/windows",
    ("a2aWorkbench", "dispatch"): "#/ecosystem/a2a/dispatch",
    ("a2aWorkbench", "evidence"): "#/ecosystem/a2a/evidence",
    ("a2aDispatch", "dispatch_queue"): "#/ecosystem/a2a/dispatch",
    ("a2aDispatch", "packet_preview"): "#/ecosystem/a2a/dispatch",
    ("a2aDispatch", "retry"): "#/ecosystem/a2a/dispatch",
    ("a2aDispatch", "reassign"): "#/ecosystem/a2a/dispatch",
    ("a2aDispatch", "lease_ops"): "#/ecosystem/a2a/dispatch",
    ("a2aDispatch", "evidence_sync"): "#/ecosystem/a2a/evidence",
    ("dataSources", "overview"): "#/data/sources/overview",
    ("dataSources", "connections"): "#/data/sources/connections",
    ("dataSources", "metadata"): "#/data/sources/metadata",
    ("dataSources", "security"): "#/data/sources/security",
    ("dataIngest", "connectors"): "#/data/ingest/connectors",
    ("dataIngest", "dry_run"): "#/data/ingest/connectors",
    ("dataIngest", "schema_registry"): "#/data/ingest/schema",
    ("dataIngest", "cdc_cursors"): "#/data/ingest/cdc",
    ("dataIngest", "batch_jobs"): "#/data/ingest/batch",
    ("dataIngest", "run_history"): "#/data/ingest/cdc",
    ("marketplace", "catalog"): "#/marketplace/catalog",
    ("marketplace", "installed"): "#/marketplace/installed",
    ("marketplace", "rating"): "#/marketplace/ratings",
    ("notify", "channels"): "#/notify/channels",
    ("notify", "outbound"): "#/notify/outbound",
    ("notify", "inbound"): "#/notify/inbound",
    ("notify", "connectors"): "#/notify/connectors",
    ("notify", "messages"): "#/notify/messages",
    ("notify", "subscriptions"): "#/notify/subscriptions",
    ("notify", "subscription_runs"): "#/notify/subscription-runs",
    ("audit", "hash_chain"): "#/audit/chain",
    ("audit", "events"): "#/audit/events",
    ("audit", "module_actions"): "#/audit/module-actions",
    ("audit", "approvals"): "#/audit/approvals",
    ("opsCenter", "pipeline"): "#/system/ops-center/pipeline",
    ("opsCenter", "alerts"): "#/system/ops-center/alerts",
    ("opsCenter", "rca"): "#/system/ops-center/rca",
    ("opsCenter", "runbook"): "#/system/ops-center/runbook",
    ("opsCenter", "self-heal"): "#/system/ops-center/self-heal",
    ("opsCenterPipeline", "release_flow"): "#/system/ops-center/pipeline",
    ("opsCenterPipeline", "executor"): "#/system/ops-center/pipeline",
    ("opsCenterPipeline", "callbacks"): "#/system/ops-center/pipeline",
    ("opsCenterAlerts", "alert_sources"): "#/system/ops-center/alerts",
    ("opsCenterAlerts", "noise_policies"): "#/system/ops-center/alerts",
    ("opsCenterAlerts", "slo_escalation"): "#/system/ops-center/alerts",
    ("opsCenterAlerts", "strategy_canary"): "#/system/ops-center/alerts",
    ("opsCenterAlerts", "strategy_linkage"): "#/system/ops-center/alerts",
    ("opsCenterAlerts", "alert_events"): "#/system/ops-center/alerts",
    ("opsCenterRca", "incident_list"): "#/system/ops-center/rca",
    ("opsCenterRca", "verification"): "#/system/ops-center/rca",
    ("opsCenterRca", "insights"): "#/system/ops-center/rca",
    ("opsCenterRca", "tasking"): "#/system/ops-center/rca",
    ("opsCenterRunbook", "runbook_library"): "#/system/ops-center/runbook",
    ("opsCenterRunbook", "versions"): "#/system/ops-center/runbook",
    ("opsCenterRunbook", "evidence"): "#/system/ops-center/runbook",
    ("opsCenterSelfHeal", "policies"): "#/system/ops-center/self-heal",
    ("opsCenterSelfHeal", "evaluation"): "#/system/ops-center/self-heal",
    ("opsCenterSelfHeal", "guardrail_actions"): "#/system/ops-center/self-heal",
    ("opsCenterSelfHeal", "rollback"): "#/system/ops-center/self-heal",
    ("systemMap", "registry"): "#/system-map/registry",
    ("systemMap", "contract"): "#/system-map/contract",
    ("systemMap", "manifest"): "#/system-map/manifest",
    ("systemMap", "capabilities"): "#/system-map/capabilities",
    ("systemMap", "readiness"): "#/system-map/readiness",
    ("systemMap", "three_code_isolation"): "#/system-map/three-code-isolation",
    ("systemMap", "source_scan"): "#/system-map/source-scan",
    ("systemMap", "baseline_compare"): "#/system-map/baseline-compare",
    ("systemMap", "governance_tasks"): "#/system-map/governance-tasks",
    ("systemMap", "actions"): "#/system-map/actions",
    ("settings", "account"): "#/settings/account",
    ("settings", "runtime"): "#/settings/runtime",
    ("settings", "management_entries"): "#/settings/workspace",
    ("settings", "sso"): "#/settings/sso",
    ("settings", "billing"): "#/settings/billing",
    ("settings", "profiles"): "#/settings/profiles",
    ("settings", "observability"): "#/settings/observability",
    ("settings", "storage"): "#/settings/storage",
    ("settings", "appearance"): "#/settings/appearance",
    ("settingsSso", "config"): "#/settings/sso",
    ("settingsSso", "risk"): "#/settings/sso",
    ("settingsSso", "scim"): "#/settings/sso",
    ("settingsSso", "saml"): "#/settings/sso",
    ("settingsSso", "runbooks"): "#/settings/sso",
    ("settingsSso", "escalation"): "#/settings/sso",
    ("settingsBilling", "subscription"): "#/settings/billing",
    ("settingsBilling", "quota"): "#/settings/billing",
    ("settingsBilling", "invoices"): "#/settings/billing",
    ("settingsBilling", "payments"): "#/settings/billing",
    ("settingsBilling", "dunning"): "#/settings/billing",
    ("settingsProfiles", "profiles"): "#/settings/profiles",
    ("settingsProfiles", "packages"): "#/settings/profiles",
    ("settingsProfiles", "approvals"): "#/settings/profiles",
    ("settingsProfiles", "canary"): "#/settings/profiles",
    ("settingsProfiles", "pipelines"): "#/settings/profiles",
    ("settingsProfiles", "rollback"): "#/settings/profiles",
    ("settingsProfiles", "audit"): "#/settings/profiles",
    ("settingsProfiles", "targets"): "#/settings/profiles",
}

SUBMODULE_PARENTS: dict[tuple[str, str], str] = {
    ("systemMap", "manifest"): "contract",
    ("systemMap", "capabilities"): "contract",
    ("systemMap", "actions"): "contract",
}


def _submodules_for(page_id: str, capability: str, policies: dict[str, list[str]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for sub_id, name in SUBMODULES_BY_PAGE.get(page_id, []):
        sub_cap = f"{capability}.{sub_id}"
        path = SUBMODULE_PATHS.get((page_id, sub_id), f"#/{page_id}/{sub_id}")
        parent_id = SUBMODULE_PARENTS.get((page_id, sub_id))
        rows.append(
            {
                "id": sub_id,
                "name": name,
                "path": path,
                "capability": sub_cap,
                "parent_id": parent_id,
                "navigation_role": "contract_tab" if parent_id else "primary",
                "actions": [
                    {"id": "read", "name": "查看", "capability": f"{sub_cap}.read", "roles": policies["read"]},
                    {"id": "write", "name": "编辑", "capability": f"{sub_cap}.write", "roles": policies["write"]},
                    {"id": "admin", "name": "管理", "capability": f"{sub_cap}.admin", "roles": policies["admin"]},
                ],
            }
        )
    return rows


def _capability_actions_for(capability: str, policies: dict[str, list[str]]) -> list[dict[str, Any]]:
    return [
        {"id": "read", "name": "查看", "capability": f"{capability}.read", "roles": policies["read"]},
        {"id": "write", "name": "编辑", "capability": f"{capability}.write", "roles": policies["write"]},
        {"id": "admin", "name": "管理", "capability": f"{capability}.admin", "roles": policies["admin"]},
    ]


class BacklogTaskIn(BaseModel):
    ids: list[str] = Field(default_factory=list)
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = "Coder"


class ReadinessTaskIn(BaseModel):
    ids: list[str] = Field(default_factory=list)
    domain: str = "all"
    status: str = Field("watch", pattern="^(all|complete|watch|risk)$")
    q: str = ""
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = "Coder"
    max_items: int = Field(12, ge=1, le=100)
    include_complete: bool = False


class ExperienceTaskIn(BaseModel):
    ids: list[str] = Field(default_factory=list)
    domain: str = "all"
    status: str = Field("watch", pattern="^(all|simple|watch|complex)$")
    q: str = ""
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = "Designer"
    max_items: int = Field(12, ge=1, le=100)
    include_simple: bool = False


class FrontendPerformanceTaskIn(BaseModel):
    names: list[str] = Field(default_factory=list)
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = "FrontendAgent"
    max_items: int = Field(8, ge=1, le=50)
    include_watch: bool = True


class IsolationTaskIn(BaseModel):
    ids: list[str] = Field(default_factory=list)
    status: str = Field("watch", pattern="^(all|protected|watch|risk)$")
    q: str = ""
    dry_run: bool = True
    priority: str = Field("P0", pattern="^P[0-3]$")
    assigned_to: str = "SecurityAgent"
    max_items: int = Field(12, ge=1, le=100)
    include_protected: bool = False


class IsolationScanTaskIn(BaseModel):
    ids: list[str] = Field(default_factory=list)
    status: str = Field("watch", pattern="^(all|protected|watch|risk)$")
    q: str = ""
    dry_run: bool = True
    priority: str = Field("P0", pattern="^P[0-3]$")
    assigned_to: str = "SecurityAgent"
    max_items: int = Field(12, ge=1, le=100)
    include_protected: bool = False


class IsolationScanRunIn(BaseModel):
    status: str = Field("all", pattern="^(all|protected|watch|risk)$")
    q: str = ""
    note: str = ""
    created_by: str = "SystemMap"
    max_items: int = Field(20, ge=1, le=100)


class IsolationScanCompareTaskIn(BaseModel):
    base_id: str = ""
    target_id: str = ""
    status: str = Field("all", pattern="^(all|protected|watch|risk)$")
    q: str = ""
    dry_run: bool = True
    priority: str = Field("P0", pattern="^P[0-3]$")
    assigned_to: str = "SecurityAgent"
    max_items: int = Field(12, ge=1, le=100)
    include_resolved: bool = False


class GovernanceTaskIn(BaseModel):
    scope: str = Field("all", pattern="^(all|registry_consistency|legacy_convergence|module_permission_ai|module_maturity)$")
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = "Coder"
    max_items: int = Field(12, ge=1, le=100)


class GovernanceTaskBulkUpdateIn(BaseModel):
    ids: list[str] = Field(default_factory=list, min_length=1, max_length=200)
    dry_run: bool = True
    status: str | None = Field(default=None, pattern=TASK_STATUS_PATTERN)
    priority: str | None = Field(default=None, pattern=TASK_PRIORITY_PATTERN)
    assigned_to: str | None = None


class CapabilityCheckIn(BaseModel):
    capability: str
    action: str = Field("read", pattern="^(read|write|admin)$")


class ModuleActionPlanIn(BaseModel):
    module_id: str
    action_id: str
    dry_run: bool = True


class ModuleActionExecuteIn(BaseModel):
    module_id: str
    action_id: str
    dry_run: bool = False
    assigned_to: str = "Coder"
    priority: str = Field("P1", pattern="^P[0-3]$")


class ModuleActionPolicyIn(BaseModel):
    enabled: bool = True
    mode: str = Field("advisory", pattern="^(advisory|enforce)$")
    approval_threshold: int = Field(60, ge=0, le=100)
    alert_threshold: int = Field(35, ge=0, le=100)
    block_threshold: int = Field(90, ge=0, le=100)
    notify_channels: list[str] = Field(default_factory=list)
    notes: str = ""


class ModuleActionApprovalReviewIn(BaseModel):
    status: str = Field(..., pattern="^(approved|rejected)$")
    note: str = ""


class MenuPreferencesIn(BaseModel):
    favorites: list[str] | None = None
    quick_access: list[str] | None = None
    recents: list[str] | None = None
    density: str | None = Field(None, pattern="^(compact|comfortable|cozy)$")
    menu_layout: str | None = Field(None, pattern="^(grouped|stream|minimal)$")
    menu_effect: str | None = Field(None, pattern="^(soft|outline|quiet)$")
    show_recents: bool | None = None
    show_favorites: bool | None = None
    show_menu_counts: bool | None = None
    show_menu_meta: bool | None = None
    show_quick_panel: bool | None = None
    collapsed_groups: dict[str, bool] | None = None
    collapsed_categories: dict[str, bool] | None = None
    collapsed_modules: dict[str, bool] | None = None


NAV_CONTRACT: list[dict[str, Any]] = [
    {"id": "microAppMainAdmin", "path": "#/apps/main-admin", "domain": "overview", "capability": "overview.micro-apps.main-admin", "entry_type": "micro_app_shell"},
    {"id": "microAppAiFoundation", "path": "#/apps/ai-foundation", "domain": "ai", "capability": "ai.micro-apps.foundation", "entry_type": "micro_app_shell"},
    {"id": "microAppAiRdCenter", "path": "#/apps/ai-rd-center", "domain": "delivery", "capability": "delivery.micro-apps.rd-center", "entry_type": "micro_app_shell"},
    {"id": "microAppAiDataCenter", "path": "#/apps/ai-data-center", "domain": "data", "capability": "data.micro-apps.data-center", "entry_type": "micro_app_shell"},
    {"id": "microAppAiOpsCenter", "path": "#/apps/ai-ops-center", "domain": "system", "capability": "system.micro-apps.ops-center", "entry_type": "micro_app_shell"},
    {"id": "microAppGovernance", "path": "#/micro-apps", "domain": "governance", "capability": "governance.micro-apps.registry", "entry_type": "micro_app_shell"},
    {"id": "dashboard", "path": "#/dashboard", "domain": "overview", "capability": "overview.dashboard"},
    {"id": "projects", "path": "#/projects", "domain": "portfolio", "capability": "portfolio.projects"},
    {"id": "projectPortfolio", "path": "#/projects/portfolio", "domain": "portfolio", "capability": "portfolio.projects.portfolio"},
    {"id": "projectBusinesses", "path": "#/projects/businesses", "domain": "portfolio", "capability": "portfolio.projects.businesses"},
    {"id": "tenantUsers", "path": "#/projects/users", "domain": "portfolio", "capability": "portfolio.projects.tenant-users"},
    {"id": "projectMembers", "path": "#/projects/members", "domain": "portfolio", "capability": "portfolio.projects.members"},
    {"id": "projectOnboarding", "path": "#/projects/onboarding", "domain": "portfolio", "capability": "portfolio.projects.onboarding"},
    {"id": "projectOnboardingOverview", "path": "#/projects/onboarding/overview", "domain": "portfolio", "capability": "portfolio.projects.onboarding.overview"},
    {"id": "projectOnboardingCommands", "path": "#/projects/onboarding/commands", "domain": "portfolio", "capability": "portfolio.projects.onboarding.commands"},
    {"id": "projectOnboardingEnv", "path": "#/projects/onboarding/env", "domain": "portfolio", "capability": "portfolio.projects.onboarding.env"},
    {"id": "projectOnboardingAgent", "path": "#/projects/onboarding/agent", "domain": "portfolio", "capability": "portfolio.projects.onboarding.agent-toml"},
    {"id": "projectOnboardingProfiles", "path": "#/projects/onboarding/profiles", "domain": "portfolio", "capability": "portfolio.projects.onboarding.tool-profiles"},
    {"id": "projectOnboardingContext", "path": "#/projects/onboarding/context", "domain": "portfolio", "capability": "portfolio.projects.onboarding.context-assets"},
    {"id": "projectTemplates", "path": "#/projects/templates", "domain": "portfolio", "capability": "portfolio.projects.templates"},
    {"id": "projectTemplatesOverview", "path": "#/projects/templates/overview", "domain": "portfolio", "capability": "portfolio.projects.templates.overview"},
    {"id": "projectTemplatesCatalog", "path": "#/projects/templates/catalog", "domain": "portfolio", "capability": "portfolio.projects.templates.catalog"},
    {"id": "projectTemplatesClone", "path": "#/projects/templates/clone", "domain": "portfolio", "capability": "portfolio.projects.templates.clone"},
    {"id": "projectTemplatesCapabilities", "path": "#/projects/templates/capabilities", "domain": "portfolio", "capability": "portfolio.projects.templates.capabilities"},
    {"id": "projectGovernance", "path": "#/projects/governance", "domain": "portfolio", "capability": "portfolio.projects.governance"},
    {"id": "projectGovernanceReview", "path": "#/projects/governance/review", "domain": "portfolio", "capability": "portfolio.projects.governance.review"},
    {"id": "projectGovernanceOps", "path": "#/projects/governance/ops", "domain": "portfolio", "capability": "portfolio.projects.governance.ops"},
    {"id": "projectGovernanceActions", "path": "#/projects/governance/actions", "domain": "portfolio", "capability": "portfolio.projects.governance.actions"},
    {"id": "projectGovernancePrompt", "path": "#/projects/governance/prompt", "domain": "portfolio", "capability": "portfolio.projects.governance.prompt"},
    {"id": "organization", "path": "#/organization", "domain": "portfolio", "capability": "portfolio.organization"},
    {"id": "requirements", "path": "#/requirements", "domain": "product", "capability": "product.requirements"},
    {"id": "tasks", "path": "#/tasks", "domain": "delivery", "capability": "delivery.tasks"},
    {"id": "issues", "path": "#/issues", "domain": "delivery", "capability": "delivery.issues"},
    {"id": "devFlow", "path": "#/dev-flow", "domain": "delivery", "capability": "delivery.dev-flow"},
    {"id": "orchestration", "path": "#/orchestration", "domain": "delivery", "capability": "delivery.orchestration"},
    {"id": "taskExecution", "path": "#/tasks/execution", "domain": "delivery", "capability": "delivery.tasks.execution"},
    {"id": "taskBoard", "path": "#/tasks/board", "domain": "delivery", "capability": "delivery.tasks.board"},
    {"id": "taskSprints", "path": "#/tasks/sprints", "domain": "delivery", "capability": "delivery.tasks.sprints"},
    {"id": "taskDependencies", "path": "#/tasks/dependencies", "domain": "delivery", "capability": "delivery.tasks.dependencies"},
    {"id": "taskScheduler", "path": "#/tasks/scheduler", "domain": "delivery", "capability": "delivery.tasks.scheduler"},
    {"id": "workflows", "path": "#/workflows", "domain": "delivery", "capability": "delivery.workflows"},
    {"id": "workflowTemplates", "path": "#/workflows/templates", "domain": "delivery", "capability": "delivery.workflows.templates"},
    {"id": "workflowInstances", "path": "#/workflows/instances", "domain": "delivery", "capability": "delivery.workflows.instances"},
    {"id": "workflowEvents", "path": "#/workflows/events", "domain": "delivery", "capability": "delivery.workflows.events"},
    {"id": "workflowSignals", "path": "#/workflows/signals", "domain": "delivery", "capability": "delivery.workflows.signals"},
    {"id": "workflowBulkOps", "path": "#/workflows/bulk_ops", "domain": "delivery", "capability": "delivery.workflows.bulk_ops"},
    {"id": "analytics", "path": "#/analytics", "domain": "data", "capability": "data.analytics.overview"},
    {"id": "analyticsBlueprint", "path": "#/analytics/blueprint", "domain": "data", "capability": "data.analytics.blueprint"},
    {"id": "analyticsReports", "path": "#/analytics/reports", "domain": "data", "capability": "data.analytics.reports"},
    {"id": "analyticsCatalog", "path": "#/analytics/catalog", "domain": "data", "capability": "data.analytics.catalog"},
    {"id": "dataAssets", "path": "#/analytics/catalog/assets", "domain": "data", "capability": "data.analytics.catalog.assets"},
    {"id": "metadataManagement", "path": "#/data/metadata", "domain": "data", "capability": "data.metadata"},
    {"id": "metadataOverview", "path": "#/data/metadata/overview", "domain": "data", "capability": "data.metadata.overview"},
    {"id": "metadataAssets", "path": "#/data/metadata/assets", "domain": "data", "capability": "data.metadata.assets"},
    {"id": "metadataFields", "path": "#/data/metadata/fields", "domain": "data", "capability": "data.metadata.fields"},
    {"id": "metadataLineage", "path": "#/data/metadata/lineage", "domain": "data", "capability": "data.metadata.lineage"},
    {"id": "dataMetricsTags", "path": "#/analytics/catalog/metrics", "domain": "data", "capability": "data.analytics.catalog.metrics"},
    {"id": "dataServices", "path": "#/analytics/catalog/services", "domain": "data", "capability": "data.analytics.catalog.services"},
    {"id": "dataQuality", "path": "#/analytics/catalog/quality", "domain": "data", "capability": "data.analytics.catalog.quality"},
    {"id": "dataDevelopment", "path": "#/analytics/catalog/development", "domain": "data", "capability": "data.analytics.catalog.development"},
    {"id": "analyticsLineage", "path": "#/analytics/lineage", "domain": "data", "capability": "data.analytics.lineage"},
    {"id": "dataExchange", "path": "#/analytics/exchange", "domain": "data", "capability": "data.exchange"},
    {"id": "dataSources", "path": "#/data/sources", "domain": "data", "capability": "data.sources"},
    {"id": "dataSourcesOverview", "path": "#/data/sources/overview", "domain": "data", "capability": "data.sources.overview"},
    {"id": "dataSourcesConnections", "path": "#/data/sources/connections", "domain": "data", "capability": "data.sources.connections"},
    {"id": "dataSourcesMetadata", "path": "#/data/sources/metadata", "domain": "data", "capability": "data.sources.metadata"},
    {"id": "dataSourcesSecurity", "path": "#/data/sources/security", "domain": "data", "capability": "data.sources.security"},
    {"id": "dataIngest", "path": "#/data/ingest", "domain": "data", "capability": "data.ingest"},
    {"id": "dataIngestConnectors", "path": "#/data/ingest/connectors", "domain": "data", "capability": "data.ingest.connectors"},
    {"id": "dataIngestSchema", "path": "#/data/ingest/schema", "domain": "data", "capability": "data.ingest.schema"},
    {"id": "dataIngestCdc", "path": "#/data/ingest/cdc", "domain": "data", "capability": "data.ingest.cdc"},
    {"id": "dataIngestBatch", "path": "#/data/ingest/batch", "domain": "data", "capability": "data.ingest.batch"},
    {"id": "analyticsNlq", "path": "#/analytics/nlq", "domain": "data", "capability": "data.analytics.nlq"},
    {"id": "copilot", "path": "#/copilot", "domain": "ai", "capability": "ai.copilot"},
    {"id": "vibe", "path": "#/vibe", "domain": "ai", "capability": "ai.vibe"},
    {"id": "globalSearch", "path": "#/search", "domain": "ai", "capability": "ai.search"},
    {"id": "intelligence", "path": "#/intelligence", "domain": "ai", "capability": "ai.intelligence"},
    {"id": "knowledgeBase", "path": "#/intelligence/kb", "domain": "ai", "capability": "ai.intelligence.knowledge"},
    {"id": "ragSearch", "path": "#/intelligence/rag", "domain": "ai", "capability": "ai.intelligence.rag"},
    {"id": "aiMemory", "path": "#/intelligence/memory", "domain": "ai", "capability": "ai.intelligence.memory"},
    {"id": "knowledgeGraph", "path": "#/ai/knowledge-graph", "domain": "ai", "capability": "ai.knowledgeGraph"},
    {"id": "ruleCenter", "path": "#/intelligence/rules", "domain": "ai", "capability": "ai.intelligence.rules"},
    {"id": "reflectionDistill", "path": "#/intelligence/distill", "domain": "ai", "capability": "ai.intelligence.distill"},
    {"id": "specs", "path": "#/intelligence/specs", "domain": "ai", "capability": "ai.intelligence.specs"},
    {"id": "designDocs", "path": "#/intelligence/design-docs", "domain": "ai", "capability": "ai.intelligence.design-docs"},
    {"id": "workerOps", "path": "#/intelligence/worker", "domain": "ai", "capability": "ai.intelligence.worker"},
    {"id": "syncOps", "path": "#/intelligence/sync", "domain": "ai", "capability": "ai.intelligence.sync"},
    {"id": "eventStream", "path": "#/intelligence/events", "domain": "ai", "capability": "ai.intelligence.events"},
    {"id": "usageOps", "path": "#/intelligence/usage", "domain": "ai", "capability": "ai.intelligence.usage"},
    {"id": "platforms", "path": "#/platforms", "domain": "ecosystem", "capability": "ecosystem.platforms"},
    {"id": "platformTools", "path": "#/platforms/tools", "domain": "ecosystem", "capability": "ecosystem.platforms.tools"},
    {"id": "mcpHub", "path": "#/platforms/mcp", "domain": "ecosystem", "capability": "ecosystem.platforms.mcp"},
    {"id": "agentRegistry", "path": "#/platforms/agents", "domain": "ecosystem", "capability": "ecosystem.platforms.agents"},
    {"id": "agentRuns", "path": "#/platforms/agent-runs", "domain": "ecosystem", "capability": "ecosystem.platforms.agent-runs"},
    {"id": "modelOps", "path": "#/platforms/models", "domain": "ecosystem", "capability": "ecosystem.platforms.models"},
    {"id": "llmGateway", "path": "#/ai/llm-gateway", "domain": "ecosystem", "capability": "ecosystem.llmGateway"},
    {"id": "llmGatewayAttribution", "path": "#/ai/llm-gateway/attribution", "domain": "ecosystem", "capability": "ai.llm-gateway.attribution"},
    {"id": "llmGatewayEval", "path": "#/ai/llm-gateway/eval", "domain": "ecosystem", "capability": "ai.llm-gateway.eval"},
    {"id": "platformOps", "path": "#/platforms/ops", "domain": "ecosystem", "capability": "ecosystem.platforms.ops"},
    {"id": "cliTools", "path": "#/platforms/cli", "domain": "ecosystem", "capability": "ecosystem.platforms.cli"},
    {"id": "a2aGateway", "path": "#/ecosystem/a2a", "domain": "ecosystem", "capability": "ecosystem.a2a"},
    {"id": "a2aWorkbench", "path": "#/ecosystem/a2a/workbench", "domain": "ecosystem", "capability": "ecosystem.a2a.workbench"},
    {"id": "a2aRegistry", "path": "#/ecosystem/a2a/registry", "domain": "ecosystem", "capability": "ecosystem.a2a.registry"},
    {"id": "a2aNegotiate", "path": "#/ecosystem/a2a/negotiate", "domain": "ecosystem", "capability": "ecosystem.a2a.negotiate"},
    {"id": "a2aSla", "path": "#/ecosystem/a2a/sla", "domain": "ecosystem", "capability": "ecosystem.a2a.sla"},
    {"id": "a2aWindows", "path": "#/ecosystem/a2a/windows", "domain": "ecosystem", "capability": "ecosystem.a2a.windows"},
    {"id": "a2aDispatch", "path": "#/ecosystem/a2a/dispatch", "domain": "ecosystem", "capability": "ecosystem.a2a.dispatch"},
    {"id": "a2aEvidence", "path": "#/ecosystem/a2a/evidence", "domain": "ecosystem", "capability": "ecosystem.a2a.evidence"},
    {"id": "marketplace", "path": "#/marketplace", "domain": "ecosystem", "capability": "ecosystem.marketplace"},
    {"id": "skillsHub", "path": "#/skills-hub", "domain": "ecosystem", "capability": "ecosystem.skills-hub"},
    {"id": "skillsCatalog", "path": "#/skills-hub/skills", "domain": "ecosystem", "capability": "ecosystem.skills-hub.skills"},
    {"id": "skillsRepos", "path": "#/skills-hub/repos", "domain": "ecosystem", "capability": "ecosystem.skills-hub.repos"},
    {"id": "notify", "path": "#/notify", "domain": "ecosystem", "capability": "ecosystem.notify"},
    {"id": "notifyConnectors", "path": "#/notify/connectors", "domain": "ecosystem", "capability": "ecosystem.notify.connectors"},
    {"id": "notifyChannels", "path": "#/notify/channels", "domain": "ecosystem", "capability": "ecosystem.notify.channels"},
    {"id": "notifyOutbound", "path": "#/notify/outbound", "domain": "ecosystem", "capability": "ecosystem.notify.outbound"},
    {"id": "notifyInbound", "path": "#/notify/inbound", "domain": "ecosystem", "capability": "ecosystem.notify.inbound"},
    {"id": "notifyMessages", "path": "#/notify/messages", "domain": "ecosystem", "capability": "ecosystem.notify.messages"},
    {"id": "notifySubscriptions", "path": "#/notify/subscriptions", "domain": "ecosystem", "capability": "ecosystem.notify.subscriptions"},
    {"id": "notifySubscriptionRuns", "path": "#/notify/subscription-runs", "domain": "ecosystem", "capability": "ecosystem.notify.subscription-runs"},
    {"id": "opsCenter", "path": "#/system/ops-center", "domain": "system", "capability": "system.ops-center"},
    {"id": "opsCenterPipeline", "path": "#/system/ops-center/pipeline", "domain": "system", "capability": "system.ops-center.pipeline"},
    {"id": "opsCenterAlerts", "path": "#/system/ops-center/alerts", "domain": "system", "capability": "system.ops-center.alerts"},
    {"id": "opsCenterRca", "path": "#/system/ops-center/rca", "domain": "system", "capability": "system.ops-center.rca"},
    {"id": "opsCenterRunbook", "path": "#/system/ops-center/runbook", "domain": "system", "capability": "system.ops-center.runbook"},
    {"id": "opsCenterSelfHeal", "path": "#/system/ops-center/self-heal", "domain": "system", "capability": "system.ops-center.self-heal"},
    {"id": "webhooks", "path": "#/notify/webhooks", "domain": "ecosystem", "capability": "ecosystem.notify.webhooks"},
    {"id": "audit", "path": "#/audit", "domain": "governance", "capability": "governance.audit"},
    {"id": "systemMap", "path": "#/system-map", "domain": "governance", "capability": "governance.system-map"},
    {"id": "frontendPerformanceGovernance", "path": "#/system-map/performance", "domain": "governance", "capability": "governance.system-map.frontend-performance"},
    {"id": "settings", "path": "#/settings", "domain": "system", "capability": "system.settings"},
    {"id": "settingsAccount", "path": "#/settings/account", "domain": "system", "capability": "system.settings.account"},
    {"id": "settingsRuntime", "path": "#/settings/runtime", "domain": "system", "capability": "system.settings.runtime"},
    {"id": "settingsWorkspace", "path": "#/settings/workspace", "domain": "system", "capability": "system.settings.workspace"},
    {"id": "settingsSso", "path": "#/settings/sso", "domain": "system", "capability": "system.settings.sso"},
    {"id": "settingsBilling", "path": "#/settings/billing", "domain": "system", "capability": "system.settings.billing"},
    {"id": "settingsProfiles", "path": "#/settings/profiles", "domain": "system", "capability": "system.settings.profiles"},
    {"id": "settingsObservability", "path": "#/settings/observability", "domain": "system", "capability": "system.settings.observability"},
    {"id": "settingsStorage", "path": "#/settings/storage", "domain": "system", "capability": "system.settings.storage"},
    {"id": "settingsAppearance", "path": "#/settings/appearance", "domain": "system", "capability": "system.settings.appearance"},
    {"id": "envOps", "path": "#/ops/env", "domain": "system", "capability": "system.env-ops"},
]

LEGACY_CONSOLE_IDS: list[str] = [
    "dashboard",
    "dev-flow",
    "analytics",
    "requirements",
    "plan",
    "iteration",
    "sprints",
    "sprints-mgr",
    "issues",
    "search",
    "vibe",
    "spec-editor",
    "docker",
    "cli",
    "specs",
    "design-docs",
    "knowledge-mgr",
    "rules",
    "custom",
    "agents",
    "skills",
    "skill-repo",
    "models",
    "orchestration",
    "mcp",
    "logs",
    "logs-viewer",
    "notify",
    "config",
    "system",
    "auth",
    "tenants",
    "db-config",
    "health",
    "audit",
    "webhook",
]


SETTINGS_REACT_PAGES: list[dict[str, Any]] = [
    {"id": "settings", "name": "系统配置中心", "domain": "system", "path": "#/settings", "status": "active", "maturity": 99, "apis": ["/api/v1/settings/hub"], "capabilities": ["设置总览", "配置域导航", "运行健康摘要", "计费与 Profile 摘要", "AI 配置治理入口"], "next": []},
    {"id": "settingsAccount", "name": "账户会话", "domain": "system", "path": "#/settings/account", "status": "active", "maturity": 96, "apis": ["/api/v1/auth/me"], "capabilities": ["当前用户", "租户会话", "项目上下文", "安全登出"], "next": []},
    {"id": "settingsRuntime", "name": "运行状态", "domain": "system", "path": "#/settings/runtime", "status": "active", "maturity": 96, "apis": ["/api/v1/health", "/api/v1/system/ops/observability", "/api/v1/system/ops/logs"], "capabilities": ["Manager 健康", "运行指标入口", "事件摘要", "日志检索"], "next": []},
    {"id": "settingsWorkspace", "name": "管理入口", "domain": "system", "path": "#/settings/workspace", "status": "active", "maturity": 92, "apis": ["/api/v1/settings/hub"], "capabilities": ["组织权限入口", "数据源入口", "控制台入口", "统一登录入口"], "next": []},
    {"id": "settingsSso", "name": "企业 SSO", "domain": "system", "path": "#/settings/sso", "status": "active", "maturity": 99, "apis": ["/api/v1/sso/config", "/api/v1/sso/providers/{provider}/test", "/api/v1/sso/providers/{provider}/risk-report", "/api/v1/sso/providers/{provider}/risk-tasks", "/api/v1/sso/providers/{provider}/risk-im-briefing", "/api/v1/sso/providers/{provider}/risk-subscription", "/api/v1/sso/providers/{provider}/risk-subscription/test", "/api/v1/sso/providers/{provider}/risk-escalation", "/api/v1/sso/providers/{provider}/risk-escalation/run", "/api/v1/sso/providers/{provider}/risk-runbooks", "/api/v1/sso/providers/{provider}/risk-runbooks/{runbook_id}", "/api/v1/sso/providers/{provider}/risk-runbooks/{runbook_id}/action", "/api/v1/sso/providers/{provider}/scim-token", "/api/v1/sso/providers/{provider}/scim/test", "/api/v1/sso/providers/{provider}/scim/audit", "/api/v1/sso/scim/v2/{provider}/Users", "/api/v1/sso/scim/v2/{provider}/Groups", "/api/v1/sso/scim/v2/{provider}/Groups/{role}", "/api/v1/sso/{provider}/saml/metadata", "/api/v1/sso/{provider}/saml/login", "/api/v1/sso/{provider}/saml/acs"], "capabilities": ["企业 SSO 配置", "SSO 组到角色映射", "SSO JIT 用户落库", "SAML SP Metadata", "SAML 签名断言处理", "SAML 依赖诊断", "SSO 风险报表", "SSO 治理任务化", "SSO 风险 IM 通知", "SSO 风险订阅策略", "SSO 风险自动升级", "SSO 风险处置 Runbook", "SSO 风险处置验证", "SCIM 用户自动开通", "SCIM Token 轮换", "SCIM 用户停用", "SCIM Groups 成员同步", "SCIM 审计报表"], "next": []},
    {"id": "settingsBilling", "name": "商业计费", "domain": "system", "path": "#/settings/billing", "status": "active", "maturity": 99, "apis": ["/api/v1/billing/subscription", "/api/v1/billing/summary", "/api/v1/billing/alerts", "/api/v1/billing/overage-policy", "/api/v1/billing/entitlements/check", "/api/v1/billing/dunning", "/api/v1/billing/invoices/{invoice_id}/audit"], "capabilities": ["商业计费", "权益校验", "租户配额联动", "超额策略", "催收状态", "发票生命周期审计"], "next": []},
    {"id": "settingsProfiles", "name": "环境 Profile 与部署", "domain": "system", "path": "#/settings/profiles", "status": "active", "maturity": 99, "apis": ["/api/v1/system/ops/profiles", "/api/v1/system/ops/profiles/{profile}/deployment-packages", "/api/v1/system/ops/deployment-packages/{package_id}", "/api/v1/system/ops/deployment-packages/{package_id}/compose.override.yml", "/api/v1/system/ops/deployment-package-approvals", "/api/v1/system/ops/deployment-package-approvals/{approval_id}", "/api/v1/system/ops/deployment-package-approvals/{approval_id}/action", "/api/v1/system/ops/deployment-canary-policies", "/api/v1/system/ops/deployment-canary-policies/{policy_id}", "/api/v1/system/ops/deployment-canary-policies/{policy_id}/action", "/api/v1/system/ops/deployment-canary-policies/{policy_id}/im-briefing", "/api/v1/system/ops/deployment-canary-metric-sources", "/api/v1/system/ops/deployment-canary-metric-sources/{source_id}", "/api/v1/system/ops/deployment-canary-policies/{policy_id}/metric-collection", "/api/v1/system/ops/deployment-rollback-drills", "/api/v1/system/ops/deployment-rollback-drills/{drill_id}", "/api/v1/system/ops/deployment-rollback-drills/{drill_id}/action", "/api/v1/system/ops/deployment-rollback-runbooks", "/api/v1/system/ops/deployment-rollback-runbooks/{runbook_id}", "/api/v1/system/ops/deployment-rollback-runbooks/{runbook_id}/action", "/api/v1/system/ops/deployment-execution-audits", "/api/v1/system/ops/deployment-execution-audits/{audit_id}", "/api/v1/system/ops/deployment-execution-audits/{audit_id}/tasks", "/api/v1/system/ops/deployment-pipelines", "/api/v1/system/ops/deployment-pipelines/{run_id}", "/api/v1/system/ops/deployment-pipelines/{run_id}/action", "/api/v1/system/ops/deployment-pipeline-executors", "/api/v1/system/ops/deployment-executor-targets", "/api/v1/system/ops/deployment-executor-targets/{target_id}", "/api/v1/system/ops/deployment-executor-targets/{target_id}/action", "/api/v1/system/ops/deployment-pipelines/{run_id}/execute", "/api/v1/system/ops/deployment-pipelines/{run_id}/executions/{execution_id}/callback", "/api/v1/system/ops/deployment-pipelines/{run_id}/remediation"], "capabilities": ["环境 Profile", "部署自检", "配置变更审计", "compose 覆盖文件生成", "部署包版本化", "部署包审批发布", "灰度发布策略", "指标卡点放量", "灰度指标源自动采集", "灰度指标历史", "灰度 IM 风险通知", "发布回滚演练", "回滚检查项留证", "回滚 Runbook 自动化", "回滚任务化", "跨环境执行审计", "执行证据任务化", "一键部署流水线", "真实执行器", "分布式执行目标", "外部编排排队", "外部执行回调", "执行目标配置检查", "执行计划审计", "流水线自愈诊断", "自愈任务化", "发布审批卡点"], "next": []},
    {"id": "settingsObservability", "name": "日志观测", "domain": "system", "path": "#/settings/observability", "status": "active", "maturity": 97, "apis": ["/api/v1/system/ops/observability", "/api/v1/system/ops/observability/traces", "/api/v1/system/ops/logs"], "capabilities": ["日志观测", "事件摘要", "Trace 关联检索", "失败根因导航"], "next": []},
    {"id": "settingsStorage", "name": "生产存储", "domain": "system", "path": "#/settings/storage", "status": "active", "maturity": 96, "apis": ["/api/v1/system/ops/storage/migration-plan", "/api/v1/system/ops/storage/migration-smoke"], "capabilities": ["OceanBase 迁移", "备份恢复清单", "SQLite 开发路径"], "next": []},
    {"id": "settingsAppearance", "name": "外观主题", "domain": "system", "path": "#/settings/appearance", "status": "active", "maturity": 92, "apis": ["/api/v1/settings/hub"], "capabilities": ["主题切换", "本地偏好同步", "自适应布局"], "next": []},
]


REACT_PAGES: list[dict[str, Any]] = [
    {"id": "microAppMainAdmin", "name": "主应用 · 基础管理", "domain": "overview", "path": "#/apps/main-admin", "status": "active", "maturity": 86, "apis": ["/api/v1/auth/me", "/api/v1/system/pages/manifest", "/api/v1/system/pages/capabilities/me"], "capabilities": ["基础管理", "账号权限", "组织项目", "服务治理", "门户控制面"], "next": ["服务目录独立页", "跨子应用权限审计"]},
    {"id": "microAppAiFoundation", "name": "智能基础服务", "domain": "ai", "path": "#/apps/ai-foundation", "status": "active", "maturity": 82, "apis": ["/api/v1/intelligence/hub", "/api/v1/platforms/hub", "/api/v1/skills/hub", "/api/v1/marketplace/summary"], "capabilities": ["开发环境", "CLI 工具", "知识记忆", "技能插件", "Agent/MCP/A2A"], "next": ["拆分 ai-foundation-web 独立仓", "沉淀独立应用 SDK"]},
    {"id": "microAppAiRdCenter", "name": "智能研发中心", "domain": "delivery", "path": "#/apps/ai-rd-center", "status": "active", "maturity": 84, "apis": ["/api/v1/requirements/summary", "/api/v1/tasks/summary", "/api/v1/tasks/scheduler/ops-summary", "/api/v1/workflows/ops-plan"], "capabilities": ["需求到任务", "AI 开发", "任务下发", "DAG 调度", "质量评审", "交付审计"], "next": ["拆分 ai-rd-center-web 独立仓", "研发流可视化设计器"]},
    {"id": "microAppAiDataCenter", "name": "智能数据中心", "domain": "data", "path": "#/apps/ai-data-center", "status": "active", "maturity": 84, "apis": ["/api/v1/db-config/connections", "/api/v1/analytics/overview", "/api/v1/data-exchange/summary", "/api/v1/analytics/lineage"], "capabilities": ["数据源", "数据接入", "元数据血缘", "数据开发调度", "指标标签", "数据服务"], "next": ["拆分 ai-data-center-web 独立仓", "湖仓元数据接入"]},
    {"id": "microAppAiOpsCenter", "name": "智能运营中心", "domain": "system", "path": "#/apps/ai-ops-center", "status": "active", "maturity": 82, "apis": ["/api/v1/billing/summary", "/api/v1/sso/config", "/api/v1/audit/summary", "/api/v1/notify/summary"], "capabilities": ["商业计费", "企业 SSO", "安全审计", "通信集成", "智能运维"], "next": ["拆分 ai-ops-center-web 独立仓", "运营 Runbook 自动化"]},
    {"id": "microAppGovernance", "name": "微应用管理", "domain": "governance", "path": "#/micro-apps", "status": "active", "maturity": 88, "apis": ["/api/v1/system/pages/micro-apps", "/api/v1/system/pages/hub"], "capabilities": ["微应用注册表", "独立应用入口", "模块归属", "能力覆盖", "成熟度健康"], "next": ["子应用发布流水线", "运行时心跳探测"]},
    {"id": "dashboard", "name": "运营驾驶舱", "domain": "overview", "path": "#/dashboard", "status": "active", "maturity": 88, "apis": ["/api/v1/dashboard/summary", "/api/v1/dashboard/charts", "/api/v1/hermes/blueprint", "/api/v1/audit/chain/state"], "capabilities": ["跨项目摘要", "ECharts 趋势图", "状态分布图", "平台蓝图", "风险看板"], "next": ["接入实时事件流", "补充 worker/同步实时状态"]},
    {"id": "projects", "name": "项目组合", "domain": "portfolio", "path": "#/projects", "status": "active", "maturity": 86, "apis": ["/api/v1/projects", "/api/v1/projects/{id}/onboarding", "/api/v1/projects/{id}/review"], "capabilities": ["项目组合", "业务线", "项目模板", "成员权限", "AI/CLI 接入包", "智能治理"], "next": ["项目组合容量规划", "跨项目依赖"]},
    {"id": "projectPortfolio", "name": "项目组合", "domain": "portfolio", "path": "#/projects/portfolio", "status": "active", "maturity": 86, "apis": ["/api/v1/projects", "/api/v1/projects/summary"], "capabilities": ["项目清单", "项目创建", "健康摘要", "业务归属"], "next": ["项目容量规划", "跨项目依赖"]},
    {"id": "projectBusinesses", "name": "业务线管理", "domain": "portfolio", "path": "#/projects/businesses", "status": "active", "maturity": 84, "apis": ["/api/v1/businesses"], "capabilities": ["业务线列表", "业务创建", "负责人治理", "删除保护"], "next": ["业务线成本中心", "业务级权限策略"]},
    {"id": "tenantUsers", "name": "租户成员", "domain": "portfolio", "path": "#/projects/users", "status": "active", "maturity": 85, "apis": ["/api/v1/auth/users"], "capabilities": ["成员目录", "角色状态", "密码重置", "成员删除"], "next": ["SCIM 同步", "成员导入"]},
    {"id": "projectMembers", "name": "项目成员", "domain": "portfolio", "path": "#/projects/members", "status": "active", "maturity": 84, "apis": ["/api/v1/projects/{id}/members", "/api/v1/projects/{id}/member-candidates"], "capabilities": ["项目成员", "候选成员", "角色绑定", "移除成员"], "next": ["项目级 ABAC", "权限变更审批"]},
    {"id": "projectOnboarding", "name": "AI 接入", "domain": "portfolio", "path": "#/projects/onboarding", "status": "active", "maturity": 89, "apis": ["/api/v1/projects/{id}/onboarding"], "capabilities": ["接入总览", "命令清单", "环境变量", "agent.toml", "工具 Profile", "上下文资产"], "next": ["接入包版本化", "工具健康回传"]},
    {"id": "projectOnboardingOverview", "name": "AI 接入总览", "domain": "portfolio", "path": "#/projects/onboarding/overview", "status": "active", "maturity": 89, "apis": ["/api/v1/projects/{id}/onboarding"], "capabilities": ["接入检查", "三码作用域", "推荐流程", "能力地图"], "next": ["接入包版本化"]},
    {"id": "projectOnboardingCommands", "name": "接入命令", "domain": "portfolio", "path": "#/projects/onboarding/commands", "status": "active", "maturity": 88, "apis": ["/api/v1/projects/{id}/onboarding"], "capabilities": ["注册命令", "上下文准备", "健康检查", "同步监听"], "next": ["命令执行审计"]},
    {"id": "projectOnboardingEnv", "name": "接入环境变量", "domain": "portfolio", "path": "#/projects/onboarding/env", "status": "active", "maturity": 88, "apis": ["/api/v1/projects/{id}/onboarding"], "capabilities": ["SOP 环境变量", "Manager API", "租户业务项目作用域"], "next": ["SecretRef 托管"]},
    {"id": "projectOnboardingAgent", "name": "Agent 配置", "domain": "portfolio", "path": "#/projects/onboarding/agent", "status": "active", "maturity": 87, "apis": ["/api/v1/projects/{id}/onboarding"], "capabilities": ["agent.toml", "工具上下文", "任务领取配置"], "next": ["多 Agent 模板"]},
    {"id": "projectOnboardingProfiles", "name": "工具 Profile", "domain": "portfolio", "path": "#/projects/onboarding/profiles", "status": "active", "maturity": 87, "apis": ["/api/v1/projects/{id}/onboarding"], "capabilities": ["Codex", "Claude", "Cursor", "Qoder", "Hermes Agent"], "next": ["工具健康回传"]},
    {"id": "projectOnboardingContext", "name": "上下文资产", "domain": "portfolio", "path": "#/projects/onboarding/context", "status": "active", "maturity": 87, "apis": ["/api/v1/projects/{id}/onboarding"], "capabilities": ["Agent 上下文 JSON", "规约资产", "任务入口", "同步入口"], "next": ["上下文版本差异"]},
    {"id": "projectTemplates", "name": "项目模板", "domain": "portfolio", "path": "#/projects/templates", "status": "active", "maturity": 82, "apis": ["/api/v1/projects/templates", "/api/v1/projects/templates/{id}/clone"], "capabilities": ["模板清单", "克隆选项", "模板能力开关"], "next": ["模板市场", "模板质量评分"]},
    {"id": "projectTemplatesOverview", "name": "模板总览", "domain": "portfolio", "path": "#/projects/templates/overview", "status": "active", "maturity": 83, "apis": ["/api/v1/projects/templates"], "capabilities": ["模板规模", "可复用项目", "业务线覆盖"], "next": ["模板质量评分"]},
    {"id": "projectTemplatesCatalog", "name": "模板目录", "domain": "portfolio", "path": "#/projects/templates/catalog", "status": "active", "maturity": 83, "apis": ["/api/v1/projects/templates"], "capabilities": ["模板清单", "设为模板", "取消模板"], "next": ["模板版本"]},
    {"id": "projectTemplatesClone", "name": "克隆向导", "domain": "portfolio", "path": "#/projects/templates/clone", "status": "active", "maturity": 82, "apis": ["/api/v1/projects/templates/{id}/clone"], "capabilities": ["业务线继承", "路径配置", "资产复制"], "next": ["克隆预检"]},
    {"id": "projectTemplatesCapabilities", "name": "模板能力", "domain": "portfolio", "path": "#/projects/templates/capabilities", "status": "active", "maturity": 82, "apis": ["/api/v1/projects/templates/{id}/clone"], "capabilities": ["需求模板", "任务模板", "知识库", "规则库"], "next": ["能力开关策略"]},
    {"id": "projectGovernance", "name": "项目智能治理", "domain": "portfolio", "path": "#/projects/governance", "status": "active", "maturity": 83, "apis": ["/api/v1/projects/{id}/review", "/api/v1/projects/{id}/bootstrap-tasks"], "capabilities": ["就绪体检", "治理任务", "Agent 接手提示词"], "next": ["治理策略配置", "自动修复闭环"]},
    {"id": "projectGovernanceReview", "name": "健康评估", "domain": "portfolio", "path": "#/projects/governance/review", "status": "active", "maturity": 84, "apis": ["/api/v1/projects/{id}/review"], "capabilities": ["健康评分", "检查项", "整改建议"], "next": ["策略配置"]},
    {"id": "projectGovernanceOps", "name": "治理操作包", "domain": "portfolio", "path": "#/projects/governance/ops", "status": "active", "maturity": 84, "apis": ["/api/v1/projects/{id}/ops-plan"], "capabilities": ["治理命令", "候选任务", "三码作用域"], "next": ["自动修复 Runbook"]},
    {"id": "projectGovernanceActions", "name": "治理任务化", "domain": "portfolio", "path": "#/projects/governance/actions", "status": "active", "maturity": 84, "apis": ["/api/v1/projects/{id}/bootstrap-tasks", "/api/v1/projects/{id}/ops-tasks"], "capabilities": ["任务预览", "任务生成", "风险处置"], "next": ["审批流"]},
    {"id": "projectGovernancePrompt", "name": "Agent 接手提示词", "domain": "portfolio", "path": "#/projects/governance/prompt", "status": "active", "maturity": 83, "apis": ["/api/v1/projects/{id}/review"], "capabilities": ["Agent Prompt", "复制交付", "上下文提示"], "next": ["多 Agent Prompt 模板"]},
    {"id": "tasks", "name": "任务", "domain": "delivery", "path": "#/tasks", "status": "active", "maturity": 88, "apis": ["/api/v1/tasks", "/api/v1/tasks/dependencies", "/api/v1/sprints"], "capabilities": ["看板", "优先级", "Sprint", "任务依赖图", "阻塞关系", "AI/工具来源追踪", "洞察报告任务溯源"], "next": ["WSS 实时刷新", "任务依赖自动推断"]},
    {"id": "taskExecution", "name": "任务执行", "domain": "delivery", "path": "#/tasks/execution", "status": "active", "maturity": 90, "apis": ["/api/v1/tasks", "/api/v1/tasks/summary", "/api/v1/tasks/bulk"], "capabilities": ["执行表格", "筛选分页", "批量治理", "智能分发"], "next": ["执行 SLA", "任务风险预测"]},
    {"id": "taskBoard", "name": "任务看板", "domain": "delivery", "path": "#/tasks/board", "status": "active", "maturity": 84, "apis": ["/api/v1/tasks"], "capabilities": ["状态看板", "优先级看板", "状态流转"], "next": ["拖拽排序", "泳道配置"]},
    {"id": "taskSprints", "name": "迭代管理", "domain": "delivery", "path": "#/tasks/sprints", "status": "active", "maturity": 88, "apis": ["/api/v1/sprints", "/api/v1/sprints/summary", "/api/v1/sprints/{id}/progress", "/api/v1/sprints/{id}/burndown"], "capabilities": ["迭代列表", "迭代任务", "进度跟踪", "燃尽曲线"], "next": ["容量规划", "历史燃尽归档"]},
    {"id": "taskDependencies", "name": "依赖关系", "domain": "delivery", "path": "#/tasks/dependencies", "status": "active", "maturity": 86, "apis": ["/api/v1/tasks/dependencies"], "capabilities": ["依赖图", "阻塞来源", "环路防护"], "next": ["依赖自动推断", "关键路径"]},
    {"id": "taskScheduler", "name": "任务依赖调度", "domain": "delivery", "path": "#/tasks/scheduler", "status": "active", "maturity": 88, "apis": ["/api/v1/tasks/scheduler/plan", "/api/v1/tasks/agent-feed", "/api/v1/tasks/quality"], "capabilities": ["任务依赖执行计划", "Agent Feed", "质量卡点", "事件唤醒", "租约心跳"], "next": ["分布式执行器", "依赖调度日历"]},
    {"id": "requirements", "name": "需求", "domain": "product", "path": "#/requirements", "status": "active", "maturity": 90, "apis": ["/api/v1/requirements", "/api/v1/requirements/summary", "/api/v1/requirements/{id}/generate-tasks"], "capabilities": ["CRUD", "服务端检索筛选", "需求运营摘要", "验收标准", "Agent/工具字段", "需求拆任务", "任务看板联动", "依赖自动生成"], "next": ["需求评审流", "LLM 需求拆解策略", "A2A 多 Agent 分工"]},
    {"id": "issues", "name": "问题中心", "domain": "delivery", "path": "#/issues", "status": "active", "maturity": 88, "apis": ["/api/v1/issues"], "capabilities": ["缺陷跟踪", "严重级别", "解决闭环", "任务关联", "筛选分页"], "next": ["与任务看板联动", "批量导入导出"]},
    {"id": "devFlow", "name": "研发全流程", "domain": "delivery", "path": "#/dev-flow", "status": "active", "maturity": 92, "apis": ["/api/v1/dev-flow/summary", "/api/v1/dev-flow/charts", "/api/v1/dev-flow/burndown"], "capabilities": ["需求任务问题聚合", "ECharts 分布图", "AntV 燃尽曲线", "状态分布", "仓库线索"], "next": ["AI 流程模板", "历史燃尽归档"]},
    {"id": "orchestration", "name": "编排工作室", "domain": "delivery", "path": "#/orchestration", "status": "active", "maturity": 84, "apis": ["/api/v1/orchestration/tools", "/api/v1/orchestration/workflows"], "capabilities": ["开发工具目录", "编排工作流定义", "工具可用性", "与 Workflows 联动"], "next": ["可视化 DAG", "Temporal 执行态"]},
    {"id": "workflows", "name": "工作流", "domain": "delivery", "path": "#/workflows", "status": "active", "maturity": 92, "apis": ["/api/v1/workflows/types", "/api/v1/workflows/start", "/api/v1/workflows/instances", "/api/v1/workflows/{id}/detail", "/api/v1/workflows/engine/status", "/api/v1/workflows/events"], "capabilities": ["模板目录", "启动执行", "AntV DAG 可视化", "Temporal 状态", "事件流水", "信号/取消"], "next": ["人工审批节点表单", "Temporal 历史回放"]},
    {"id": "workflowTemplates", "name": "流程模板", "domain": "delivery", "path": "#/workflows/templates", "status": "active", "maturity": 84, "apis": ["/api/v1/workflows/templates"], "capabilities": ["模板目录", "模板启停", "编排配置"], "next": ["模板版本", "可视化设计器"]},
    {"id": "workflowInstances", "name": "运行实例", "domain": "delivery", "path": "#/workflows/instances", "status": "active", "maturity": 84, "apis": ["/api/v1/workflows/instances"], "capabilities": ["实例列表", "状态跟踪", "失败诊断"], "next": ["实例 SLA", "重试策略"]},
    {"id": "workflowEvents", "name": "事件流水", "domain": "delivery", "path": "#/workflows/events", "status": "active", "maturity": 83, "apis": ["/api/v1/workflows/events"], "capabilities": ["事件查询", "事件过滤", "运行追踪"], "next": ["事件检索索引"]},
    {"id": "workflowSignals", "name": "信号控制", "domain": "delivery", "path": "#/workflows/signals", "status": "active", "maturity": 83, "apis": ["/api/v1/workflows/instances", "/api/v1/workflows/signals"], "capabilities": ["目标实例", "信号发送", "运行干预"], "next": ["信号审批", "信号审计"]},
    {"id": "workflowBulkOps", "name": "批量治理", "domain": "delivery", "path": "#/workflows/bulk_ops", "status": "active", "maturity": 82, "apis": ["/api/v1/workflows/ops-plan", "/api/v1/workflows/ops-tasks"], "capabilities": ["治理操作包", "批量任务化", "风险处置"], "next": ["自动化 Runbook"]},
    {"id": "organization", "name": "组织权限", "domain": "portfolio", "path": "#/organization", "status": "active", "maturity": 91, "apis": ["/api/v1/organization/summary", "/api/v1/organization/policy", "/api/v1/organization/policy/check", "/api/v1/organization/policy/history", "/api/v1/organization/access-review", "/api/v1/auth/users", "/api/v1/businesses", "/api/v1/projects/{id}/members"], "capabilities": ["组织摘要", "租户成员", "业务线", "项目成员", "角色策略", "字段级安全", "行级 ABAC", "策略试算", "策略审计", "权限体检", "治理任务"], "next": ["审批流联动", "临时授权过期回收"]},
    {"id": "analytics", "name": "指标概览", "domain": "data", "path": "#/analytics", "status": "active", "maturity": 92, "apis": ["/api/v1/analytics/overview"], "capabilities": ["项目指标摘要", "关键指标快照", "原始指标 JSON"], "next": ["指标权限", "趋势图", "异常阈值"]},
    {"id": "analyticsBlueprint", "name": "数据智能蓝图", "domain": "data", "path": "#/analytics/blueprint", "status": "active", "maturity": 82, "apis": ["/api/v1/analytics/blueprint", "/api/v1/analytics/blueprint/summary", "/api/v1/analytics/blueprint/charts", "/api/v1/analytics/blueprint/tasks"], "capabilities": ["数据能力地图", "成熟度评估", "技术栈矩阵", "缺口任务化"], "next": ["质量中心", "指标/标签任务模板"]},
    {"id": "analyticsReports", "name": "洞察报告", "domain": "data", "path": "#/analytics/reports", "status": "active", "maturity": 96, "apis": ["/api/v1/analytics/reports", "/api/v1/analytics/reports/summary", "/api/v1/analytics/reports/charts", "/api/v1/analytics/report-subscription", "/api/v1/analytics/report-subscription/test", "/api/v1/analytics/reports/{id}/status", "/api/v1/analytics/reports/{id}/meta", "/api/v1/analytics/reports/{id}/action-tasks", "/api/v1/analytics/reports/{id}.md", "/api/v1/analytics/reports/{id}/notify"], "capabilities": ["洞察报告沉淀", "报告运营摘要", "报告搜索筛选", "报告资产元数据治理", "报告生成执行任务", "报告发布归档", "Markdown 导出", "报告通知发送", "报告订阅策略", "订阅通道测试"], "next": ["报告订阅调度", "报告权限", "AI 自动洞察"]},
    {"id": "analyticsCatalog", "name": "数据资产治理中心", "domain": "data", "path": "#/analytics/catalog", "status": "active", "maturity": 88, "apis": ["/api/v1/analytics/governance/hub", "/api/v1/analytics/export.csv"], "capabilities": ["治理中心", "四层能力栈", "五大专业域入口", "CSV 导出"], "next": ["对接湖仓元数据", "指标变更审核"]},
    {"id": "dataAssets", "name": "数据资产", "domain": "data", "path": "#/analytics/catalog/assets", "status": "active", "maturity": 84, "apis": ["/api/v1/analytics/assets", "/api/v1/analytics/quality/evaluate", "/api/v1/analytics/governance/tasks"], "capabilities": ["资产目录", "状态治理", "质量评估", "治理任务化"], "next": ["资产详情页", "字段级血缘"]},
    {"id": "metadataManagement", "name": "元数据管理", "domain": "data", "path": "#/data/metadata", "status": "active", "maturity": 88, "apis": ["/api/v1/metadata/summary", "/api/v1/metadata/assets", "/api/v1/metadata/fields", "/api/v1/metadata/lineage/impact", "/api/v1/metadata/assets/{asset_id}/classify"], "capabilities": ["元数据总览", "资产目录", "字段目录", "分类治理", "血缘影响", "Agent 消费入口"], "next": ["字段级权限", "湖仓自动采样"]},
    {"id": "metadataOverview", "name": "元数据总览", "domain": "data", "path": "#/data/metadata/overview", "status": "active", "maturity": 88, "apis": ["/api/v1/metadata/summary"], "capabilities": ["资产统计", "字段统计", "敏感字段", "治理缺口"], "next": ["趋势分析"]},
    {"id": "metadataAssets", "name": "元数据资产目录", "domain": "data", "path": "#/data/metadata/assets", "status": "active", "maturity": 88, "apis": ["/api/v1/metadata/assets", "/api/v1/metadata/assets/{asset_id}/classify"], "capabilities": ["资产检索", "负责人维护", "密级配置", "质量规则绑定"], "next": ["审批流"]},
    {"id": "metadataFields", "name": "字段元数据", "domain": "data", "path": "#/data/metadata/fields", "status": "active", "maturity": 87, "apis": ["/api/v1/metadata/fields", "/api/v1/data-ingest/schema-registry"], "capabilities": ["字段检索", "敏感字段候选", "来源追踪", "分类标记"], "next": ["字段血缘"]},
    {"id": "metadataLineage", "name": "元数据血缘影响", "domain": "data", "path": "#/data/metadata/lineage", "status": "active", "maturity": 87, "apis": ["/api/v1/metadata/lineage", "/api/v1/metadata/lineage/impact"], "capabilities": ["资产选择", "上游依赖", "下游影响", "变更范围"], "next": ["变更订阅"]},
    {"id": "dataMetricsTags", "name": "指标与标签", "domain": "data", "path": "#/analytics/catalog/metrics", "status": "active", "maturity": 92, "apis": ["/api/v1/analytics/metrics", "/api/v1/analytics/tags", "/api/v1/metrics-service/catalog", "/api/v1/metrics-service/catalog/{id}/publish", "/api/v1/metrics-service/catalog/{id}/versions", "/api/v1/metrics-service/catalog/{id}/impact", "/api/v1/metrics-service/query/{id}", "/api/v1/metrics-service/api-publish", "/api/v1/tag-service/catalog", "/api/v1/tag-service/rules", "/api/v1/tag-service/rules/evaluate", "/api/v1/tag-service/ontology", "/api/v1/tag-service/profiles/build", "/api/v1/tag-service/profiles/builds", "/api/v1/tag-service/ontology/entities/{id}/publish"], "capabilities": ["指标口径", "标签规则", "负责人治理", "目录维护", "公式校验", "指标版本发布", "查询契约", "血缘影响分析", "规则试算", "画像构建", "画像发布契约"], "next": ["指标审批", "实时标签计算"]},
    {"id": "dataServices", "name": "数据服务", "domain": "data", "path": "#/analytics/catalog/services", "status": "active", "maturity": 84, "apis": ["/api/v1/analytics/services", "/api/v1/analytics/services/{id}/publish"], "capabilities": ["服务目录", "发布暂停", "健康评分", "消费者管理"], "next": ["服务 SLA", "调用日志"]},
    {"id": "dataQuality", "name": "质量告警", "domain": "data", "path": "#/analytics/catalog/quality", "status": "active", "maturity": 90, "apis": ["/api/v1/analytics/quality/alerts", "/api/v1/analytics/quality/alerts/tasks", "/api/v1/data-quality/rules", "/api/v1/data-quality/runs", "/api/v1/data-quality/alerts", "/api/v1/data-quality/alerts/tasks", "/api/v1/data-quality/summary"], "capabilities": ["质量告警", "告警任务化", "通知处置", "规则执行", "运行历史", "告警归因", "运行任务化"], "next": ["告警订阅", "指标血缘联动"]},
    {"id": "dataDevelopment", "name": "数据开发", "domain": "data", "path": "#/analytics/catalog/development", "status": "active", "maturity": 86, "apis": ["/api/v1/analytics/development/templates", "/api/v1/analytics/development/schedule", "/api/v1/analytics/development/agent-feed", "/api/v1/analytics/development/evidence", "/api/v1/analytics/development/runbook"], "capabilities": ["开发模板", "智能调度", "Agent Feed", "质量证据", "自动化 Runbook"], "next": ["Runbook 历史", "开发 DAG 可视化"]},
    {"id": "analyticsLineage", "name": "数据血缘", "domain": "data", "path": "#/analytics/lineage", "status": "active", "maturity": 85, "apis": ["/api/v1/analytics/lineage", "/api/v1/analytics/lineage/impact"], "capabilities": ["血缘图谱", "影响分析", "上下游追溯", "节点筛选"], "next": ["血缘权限", "变更订阅"]},
    {"id": "dataExchange", "name": "数据交换", "domain": "data", "path": "#/analytics/exchange", "status": "active", "maturity": 88, "apis": ["/api/v1/data-exchange/summary", "/api/v1/data-exchange/charts", "/api/v1/data-exchange/export", "/api/v1/data-exchange/preview", "/api/v1/data-exchange/import", "/api/v1/data-exchange/jobs", "/api/v1/data-exchange/export-job"], "capabilities": ["数据港导入导出", "导入预检", "数据交换作业流水", "选择模块导出"], "next": ["导入任务异步化", "对象存储归档", "跨项目数据服务联邦"]},
    {"id": "dataSources", "name": "数据源管理", "domain": "data", "path": "#/data/sources", "status": "active", "maturity": 94, "apis": ["/api/v1/db-config/connections", "/api/v1/db-config/connections/summary", "/api/v1/db-config/connections/{name}/metadata-preview", "/api/v1/db-config/connections/{name}/metadata-sync", "/api/v1/db-config/connections/{name}/security-scan", "/api/v1/db-config/connections/{name}/test", "/api/v1/db-config/drivers", "/api/v1/data-ingest/schema-registry"], "capabilities": ["模块总览", "连接目录", "驱动目录", "SecretRef", "连接测试", "元数据预览", "Schema Registry 同步", "安全扫描", "敏感字段候选", "三码隔离字段检查", "Agent 消费入口"], "next": []},
    {"id": "dataSourcesOverview", "name": "数据源总览", "domain": "data", "path": "#/data/sources/overview", "status": "active", "maturity": 90, "apis": ["/api/v1/db-config/connections/summary"], "capabilities": ["数据源健康", "能力覆盖", "专业入口"], "next": ["角色化默认入口"]},
    {"id": "dataSourcesConnections", "name": "连接目录", "domain": "data", "path": "#/data/sources/connections", "status": "active", "maturity": 91, "apis": ["/api/v1/db-config/connections", "/api/v1/db-config/connections/{name}/test", "/api/v1/db-config/drivers"], "capabilities": ["连接 CRUD", "SecretRef", "连接测试", "只读策略"], "next": ["密钥托管审计"]},
    {"id": "dataSourcesMetadata", "name": "元数据同步", "domain": "data", "path": "#/data/sources/metadata", "status": "active", "maturity": 91, "apis": ["/api/v1/db-config/connections/{name}/metadata-preview", "/api/v1/db-config/connections/{name}/metadata-sync", "/api/v1/data-ingest/schema-registry"], "capabilities": ["元数据预览", "敏感字段候选", "Schema Registry 同步"], "next": []},
    {"id": "dataSourcesSecurity", "name": "数据源安全治理", "domain": "data", "path": "#/data/sources/security", "status": "active", "maturity": 92, "apis": ["/api/v1/db-config/connections/summary", "/api/v1/db-config/connections/{name}/security-scan"], "capabilities": ["SecretRef 检查", "只读策略", "敏感字段候选", "三码隔离字段检查", "治理任务候选", "Agent consumption"], "next": []},
    {"id": "dataIngest", "name": "数据接入", "domain": "data", "path": "#/data/ingest", "status": "active", "maturity": 93, "apis": ["/api/v1/data-ingest/connectors", "/api/v1/data-ingest/connectors/{id}/dry-run", "/api/v1/data-ingest/connectors/{id}/schema", "/api/v1/data-ingest/schema-registry", "/api/v1/data-ingest/jobs", "/api/v1/data-ingest/jobs/{id}/run", "/api/v1/data-ingest/jobs/{id}/status", "/api/v1/data-ingest/runs", "/api/v1/data-ingest/cdc-cursors", "/api/v1/data-ingest/summary"], "capabilities": ["连接器管理", "连接器测试", "连接器 Dry-run", "Schema Registry", "接入作业", "批量作业", "CDC 游标", "运行历史", "三码隔离", "Agent 消费入口"], "next": ["实时延迟指标", "接入质量联动"]},
    {"id": "dataIngestConnectors", "name": "接入连接器", "domain": "data", "path": "#/data/ingest/connectors", "status": "active", "maturity": 91, "apis": ["/api/v1/data-ingest/connectors", "/api/v1/data-ingest/connectors/{id}/test", "/api/v1/data-ingest/connectors/{id}/dry-run", "/api/v1/data-ingest/connectors/{id}/schema"], "capabilities": ["连接器 CRUD", "连接测试", "Dry-run 采样", "Schema 发现"], "next": ["敏感字段扫描"]},
    {"id": "dataIngestSchema", "name": "接入 Schema Registry", "domain": "data", "path": "#/data/ingest/schema", "status": "active", "maturity": 91, "apis": ["/api/v1/data-ingest/schema-registry", "/api/v1/data-ingest/connectors/{id}/schema"], "capabilities": ["Schema 注册", "表字段版本", "连接器来源追踪"], "next": ["Schema 版本对比"]},
    {"id": "dataIngestCdc", "name": "CDC 游标", "domain": "data", "path": "#/data/ingest/cdc", "status": "active", "maturity": 90, "apis": ["/api/v1/data-ingest/cdc-cursors", "/api/v1/data-ingest/runs", "/api/v1/data-ingest/jobs/{id}/status"], "capabilities": ["CDC 游标", "运行历史", "进度回写", "失败追踪"], "next": ["实时延迟指标"]},
    {"id": "dataIngestBatch", "name": "批量接入作业", "domain": "data", "path": "#/data/ingest/batch", "status": "active", "maturity": 90, "apis": ["/api/v1/data-ingest/jobs", "/api/v1/data-ingest/jobs/{id}/run", "/api/v1/data-ingest/jobs/{id}/status", "/api/v1/data-ingest/runs"], "capabilities": ["批量作业", "作业运行", "完成回写", "运行历史"], "next": ["调度器接入"]},
    {"id": "analyticsNlq", "name": "NLQ 问数", "domain": "data", "path": "#/analytics/nlq", "status": "active", "maturity": 82, "apis": ["/api/v1/analytics/nlq", "/api/v1/analytics/overview"], "capabilities": ["自然语言问数", "LLM 指标解释", "问答保存为报告"], "next": ["指标语义层", "权限感知 NLQ", "SQL 生成审计"]},
    {"id": "notify", "name": "通信集成", "domain": "ecosystem", "path": "#/notify", "status": "active", "maturity": 95, "apis": ["/api/v1/notify/hub", "/api/v1/notify/summary", "/api/v1/notify/charts", "/api/v1/notify/timeline", "/api/v1/notify/connectors", "/api/v1/notify/connectors/health", "/api/v1/notify/channels", "/api/v1/notify/messages", "/api/v1/notify/inbound", "/api/v1/notify/approvals/callback", "/api/v1/notify/tasks/status-push", "/api/v1/notify/report-subscriptions", "/api/v1/notify/report-subscriptions/runs", "/api/v1/notify/report-subscriptions/run"], "capabilities": ["连接器矩阵", "连接器健康", "通道摘要", "消息时间线", "统一通道模板", "出站发送", "入站记录", "入站去重", "审批回调", "任务状态推送", "报告订阅", "订阅运行中心", "订阅投递预览", "订阅运行历史", "通道测试", "入站转需求/任务", "独立子路由"], "next": ["消息重试策略", "死信重投"]},
    {"id": "notifyConnectors", "name": "连接器矩阵", "domain": "ecosystem", "path": "#/notify/connectors", "status": "active", "maturity": 84, "apis": ["/api/v1/notify/connectors"], "capabilities": ["企业微信", "钉钉", "Webhook", "Slack", "签名模板"], "next": ["连接器健康探测"]},
    {"id": "notifyChannels", "name": "通道管理", "domain": "ecosystem", "path": "#/notify/channels", "status": "active", "maturity": 84, "apis": ["/api/v1/notify/channels"], "capabilities": ["通道列表", "启停配置", "模板配置"], "next": ["密钥托管"]},
    {"id": "notifyOutbound", "name": "出站发送", "domain": "ecosystem", "path": "#/notify/outbound", "status": "active", "maturity": 83, "apis": ["/api/v1/notify/send", "/api/v1/notify/messages"], "capabilities": ["发送测试", "通知草稿", "消息落账"], "next": ["重试策略"]},
    {"id": "notifyInbound", "name": "入站处置", "domain": "ecosystem", "path": "#/notify/inbound", "status": "active", "maturity": 83, "apis": ["/api/v1/notify/inbound", "/api/v1/notify/inbound/{message_id}/action"], "capabilities": ["入站消息", "转任务", "转需求", "处置审计"], "next": ["意图识别"]},
    {"id": "notifyMessages", "name": "消息流水", "domain": "ecosystem", "path": "#/notify/messages", "status": "active", "maturity": 82, "apis": ["/api/v1/notify/messages", "/api/v1/notify/timeline"], "capabilities": ["全量消息表", "方向筛选", "日聚合时间线", "入站处置入口"], "next": ["消息检索索引", "死信重试"]},
    {"id": "notifySubscriptions", "name": "报告订阅", "domain": "ecosystem", "path": "#/notify/subscriptions", "status": "active", "maturity": 88, "apis": ["/api/v1/notify/report-subscriptions"], "capabilities": ["订阅配置", "周期策略", "通道绑定", "过滤条件"], "next": ["订阅审批"]},
    {"id": "notifySubscriptionRuns", "name": "订阅运行中心", "domain": "ecosystem", "path": "#/notify/subscription-runs", "status": "active", "maturity": 90, "apis": ["/api/v1/notify/report-subscriptions/runs", "/api/v1/notify/report-subscriptions/run"], "capabilities": ["订阅运行历史", "投递预览", "立即执行", "IM 简报", "通道投递计划"], "next": ["定时调度器接入", "失败自动重试"]},
    {"id": "webhooks", "name": "Webhook", "domain": "ecosystem", "path": "#/notify/webhooks", "status": "active", "maturity": 88, "apis": ["/api/v1/webhooks", "/api/v1/webhooks/events", "/api/v1/webhooks/{id}/deliveries"], "capabilities": ["出站 Webhook", "事件订阅", "HMAC 签名", "投递测试", "投递时间线"], "next": ["重试策略可视化", "死信队列"]},
    {"id": "envOps", "name": "环境运维", "domain": "system", "path": "#/ops/env", "status": "active", "maturity": 86, "apis": ["/api/v1/env/check/full", "/api/v1/env/docker/ps"], "capabilities": ["环境检查", "Docker 列表", "Compose 入口"], "next": ["镜像构建 UI", "受控修复向导"]},
    {"id": "audit", "name": "安全审计", "domain": "governance", "path": "#/audit", "status": "active", "maturity": 90, "apis": ["/api/v1/audit/hub", "/api/v1/audit/chain/state", "/api/v1/audit/chain/verify", "/api/v1/audit/summary", "/api/v1/audit/charts", "/api/v1/audit/timeline", "/api/v1/audit/events", "/api/v1/audit/record", "/api/v1/audit/export.csv", "/api/v1/system/pages/actions/runs"], "capabilities": ["治理中心", "哈希链状态", "链校验", "ECharts 活动趋势", "动作/资源分布", "按日时间线", "合规 CSV 导出", "模块动作审计"], "next": ["合规报表模板", "风险规则告警", "对象存储 WORM 锚定"]},
    {"id": "copilot", "name": "AI 助手", "domain": "ai", "path": "#/copilot", "status": "active", "maturity": 88, "apis": ["/api/v1/copilot/hub", "/api/v1/copilot/ask", "/api/v1/copilot/sessions", "/api/v1/copilot/commands", "/api/v1/copilot/commands/resolve", "/api/v1/copilot/commands/execute", "/api/v1/copilot/commands/approvals", "/api/v1/copilot/commands/approvals/callback", "/api/v1/copilot/plan"], "capabilities": ["会话", "run_id", "项目上下文", "transcript", "全局 CmdK 命令中心", "命令权限策略", "风险分级", "审批队列", "批准/驳回", "外部审批回调", "审计证据", "工具调用计划"], "next": ["跨工具执行器", "更多页面操作注册", "审批凭证校验"]},
    {"id": "vibe", "name": "Vibe Coding", "domain": "ai", "path": "#/vibe", "status": "active", "maturity": 86, "apis": ["/api/v1/vibe/sessions", "/api/v1/vibe/run", "/api/v1/vibe/templates"], "capabilities": ["编码会话", "CLI 执行", "模板", "附件上传"], "next": ["终端沙箱", "多模态增强"]},
    {"id": "globalSearch", "name": "全局搜索", "domain": "ai", "path": "#/search", "status": "active", "maturity": 92, "apis": ["/api/v1/search", "/api/v1/semantic-search", "/api/v1/semantic-search/status"], "capabilities": ["关键词检索", "语义向量检索", "混合检索", "索引健康", "设计文档/规约检索"], "next": ["跨项目联邦检索", "检索权限策略"]},
    {"id": "intelligence", "name": "智能与知识", "domain": "ai", "path": "#/intelligence", "status": "active", "maturity": 94, "apis": ["/api/v1/intelligence/hub"], "capabilities": ["AI 智能中枢", "知识资产分流", "检索记忆分流", "规则蒸馏分流", "运行治理分流", "规约方案分流", "数据上下文分流"], "next": []},
    {"id": "knowledgeBase", "name": "知识库", "domain": "ai", "path": "#/intelligence/kb", "status": "active", "maturity": 86, "apis": ["/api/v1/knowledge"], "capabilities": ["知识文档", "索引", "检索", "分类标签"], "next": ["批量导入", "知识版本"]},
    {"id": "ragSearch", "name": "RAG 检索", "domain": "ai", "path": "#/intelligence/rag", "status": "active", "maturity": 84, "apis": ["/api/v1/rag/search"], "capabilities": ["检索增强", "引用证据", "提示词上下文"], "next": ["混合检索", "图谱 RAG"]},
    {"id": "aiMemory", "name": "AI 记忆", "domain": "ai", "path": "#/intelligence/memory", "status": "active", "maturity": 88, "apis": ["/api/v1/memory", "/api/v1/memory/{id}/lifecycle"], "capabilities": ["最近记忆", "记忆检索", "运行挂载", "本地优先同步", "记忆生命周期"], "next": ["长期记忆压缩", "画像本体"]},
    {"id": "knowledgeGraph", "name": "知识图谱", "domain": "ai", "path": "#/ai/knowledge-graph", "status": "active", "maturity": 90, "apis": ["/api/v1/knowledge-graph/summary", "/api/v1/knowledge-graph/build", "/api/v1/knowledge-graph/query", "/api/v1/knowledge-graph/lineage", "/api/v1/knowledge-graph/entities", "/api/v1/knowledge-graph/edges", "/api/v1/knowledge-graph/entity-profiles/merge", "/api/v1/memory/{id}/lifecycle"], "capabilities": ["图谱构建", "Graph RAG", "血缘关联", "来源权限检查", "证据链", "实体画像合并", "记忆生命周期", "Agent 上下文包"], "next": ["多模态证据", "跨项目联邦图谱"]},
    {"id": "ruleCenter", "name": "规则中心", "domain": "ai", "path": "#/intelligence/rules", "status": "active", "maturity": 84, "apis": ["/api/v1/rules", "/api/v1/reflections/proposals"], "capabilities": ["规则提案", "规则应用", "蒸馏审核", "规则同步"], "next": ["规则评测", "灰度发布"]},
    {"id": "reflectionDistill", "name": "蒸馏审核", "domain": "ai", "path": "#/intelligence/distill", "status": "active", "maturity": 83, "apis": ["/api/v1/reflections/distill", "/api/v1/reflections/proposals", "/api/v1/reflections/proposals/{proposal_id}/review"], "capabilities": ["反思采样", "规则蒸馏", "提案审核", "规则入库"], "next": ["模型评测", "自动化置信度策略"]},
    {"id": "workerOps", "name": "WorkerOps", "domain": "ai", "path": "#/intelligence/worker", "status": "active", "maturity": 82, "apis": ["/api/v1/worker/jobs"], "capabilities": ["任务类型", "幂等投递", "运行监控", "取消重试"], "next": ["真实执行池", "资源配额"]},
    {"id": "syncOps", "name": "SyncOps", "domain": "ai", "path": "#/intelligence/sync", "status": "active", "maturity": 82, "apis": ["/api/v1/sync/summary", "/api/v1/sync/pull"], "capabilities": ["同步模块", "拉取预览", "资产推送", "流水查看"], "next": ["冲突合并", "双向同步策略"]},
    {"id": "eventStream", "name": "事件流水", "domain": "ai", "path": "#/intelligence/events", "status": "active", "maturity": 82, "apis": ["/api/v1/events", "/ws/events"], "capabilities": ["CloudEvents 查询", "同步事件", "Agent 事件", "实时订阅"], "next": ["事件检索索引", "事件驱动自动修复"]},
    {"id": "usageOps", "name": "用量治理", "domain": "ai", "path": "#/intelligence/usage", "status": "active", "maturity": 84, "apis": ["/api/v1/usage/summary", "/api/v1/usage/alerts", "/api/v1/usage/alerts/tasks"], "capabilities": ["配额进度", "用量告警", "治理任务", "来源分析"], "next": ["成本归因", "自动限流策略"]},
    {"id": "specs", "name": "规范文档", "domain": "ai", "path": "#/intelligence/specs", "status": "active", "maturity": 86, "apis": ["/api/v1/specs", "/api/v1/specs/content"], "capabilities": ["规约列表", "Markdown 编辑", "分类浏览", "保存同步"], "next": ["版本发布", "知识库索引"]},
    {"id": "designDocs", "name": "技术方案", "domain": "ai", "path": "#/intelligence/design-docs", "status": "active", "maturity": 84, "apis": ["/api/v1/design-docs", "/api/v1/design-docs/{id}"], "capabilities": ["方案 CRUD", "版本正文", "分类标签"], "next": ["文档索引进度", "规则提案联动"]},
    {"id": "marketplace", "name": "资产市场", "domain": "ecosystem", "path": "#/marketplace", "status": "active", "maturity": 90, "apis": ["/api/v1/marketplace/summary", "/api/v1/marketplace/charts", "/api/v1/marketplace/packages", "/api/v1/marketplace/packages/{name}/verify", "/api/v1/marketplace/packages/{name}/ratings", "/api/v1/marketplace/install", "/api/v1/marketplace/rate"], "capabilities": ["Workbench 资产目录", "签名验证", "评分反馈", "安装治理", "运营摘要"], "next": ["私有 registry 管理", "生产级签名链", "评分同步"]},
    {"id": "skillsHub", "name": "技能中心", "domain": "ecosystem", "path": "#/skills-hub", "status": "active", "maturity": 86, "apis": ["/api/v1/skills/hub", "/api/v1/skills", "/api/v1/skill-repo/repos", "/api/v1/skill-repo/installed"], "capabilities": ["治理中心", "技能目录", "技能仓库", "同步安装", "内置技能保护"], "next": ["签名校验", "技能市场评分"]},
    {"id": "skillsCatalog", "name": "技能目录", "domain": "ecosystem", "path": "#/skills-hub/skills", "status": "active", "maturity": 86, "apis": ["/api/v1/skills"], "capabilities": ["技能列表", "角色标记", "删除治理"], "next": ["技能版本", "依赖检查"]},
    {"id": "skillsRepos", "name": "技能仓库", "domain": "ecosystem", "path": "#/skills-hub/repos", "status": "active", "maturity": 84, "apis": ["/api/v1/skill-repo/repos", "/api/v1/skill-repo/repos/{id}/sync"], "capabilities": ["仓库注册", "分支同步", "已安装清单"], "next": ["仓库签名校验", "离线镜像"]},
    {"id": "platforms", "name": "Agent 平台", "domain": "ecosystem", "path": "#/platforms", "status": "active", "maturity": 90, "apis": ["/api/v1/platforms/hub", "/api/v1/platforms", "/api/v1/platforms/ops-plan", "/api/v1/mcp", "/api/v1/models", "/api/v1/agents", "/api/v1/agents/runs"], "capabilities": ["治理中心", "CLI/IDE/Agent 接入", "MCP Hub", "MCP Profile 导出", "Agent 注册表", "Agent 运行中心", "A2A 专家组", "运行治理", "治理任务生成", "MCP 工具 Profile", "模型提供商", "默认模型", "角色模型"], "next": ["Agent 能力包市场", "多工具健康策略", "A2A/MCP 运行态观测"]},
    {"id": "platformTools", "name": "工具接入", "domain": "ecosystem", "path": "#/platforms/tools", "status": "active", "maturity": 86, "apis": ["/api/v1/platforms"], "capabilities": ["CLI/IDE 接入", "工具目录", "接入 Profile"], "next": ["工具健康回传"]},
    {"id": "mcpHub", "name": "MCP Hub", "domain": "ecosystem", "path": "#/platforms/mcp", "status": "active", "maturity": 86, "apis": ["/api/v1/mcp"], "capabilities": ["MCP 模板", "命令探测", "Profile 导出"], "next": ["MCP 运行态观测"]},
    {"id": "agentRegistry", "name": "Agent 注册表", "domain": "ecosystem", "path": "#/platforms/agents", "status": "active", "maturity": 85, "apis": ["/api/v1/agents", "/api/v1/agents/summary"], "capabilities": ["Agent 角色", "能力画像", "A2A 专家组"], "next": ["能力包市场"]},
    {"id": "agentRuns", "name": "Agent 运行中心", "domain": "ecosystem", "path": "#/platforms/agent-runs", "status": "active", "maturity": 94, "apis": ["/api/v1/agents/runs", "/api/v1/agents/runs/summary", "/api/v1/agents/runs/slo", "/api/v1/agents/runs/rebalance-tasks", "/api/v1/agent-runs", "/api/v1/agent-runs/summary", "/api/v1/agent-runs/profiles", "/api/v1/agent-runs/{id}/heartbeat", "/api/v1/agent-runs/{id}/status", "/api/v1/agent-runs/{id}/retry", "/api/v1/agent-runs/{id}/cancel", "/api/v1/agent-runs/{id}/evidence", "/api/v1/tasks/agent-feed/claims", "/api/v1/tasks/agent-feed/reports", "/api/v1/tasks/{id}/agent-report", "/api/v1/a2a/dispatch"], "capabilities": ["运行列表", "持久化 Run 生命周期", "运行状态回写", "心跳监控", "失败重试", "运行取消", "证据回写", "A2A Dispatch 关联", "能力画像", "活跃租约", "负载统计", "成功率", "最近心跳", "Agent SLO", "自动再平衡任务", "交付审计"], "next": ["质量门禁自动判定"]},
    {"id": "a2aGateway", "name": "A2A 网关", "domain": "ecosystem", "path": "#/ecosystem/a2a", "status": "active", "maturity": 99, "apis": ["/api/v1/a2a/registry", "/api/v1/a2a/registry/{id}/heartbeat", "/api/v1/a2a/registry/{id}/credentials/rotate", "/api/v1/a2a/registry/{id}/tasks/pull", "/api/v1/a2a/registry/{id}/tasks/ack", "/api/v1/a2a/registry/{id}/tasks/renew", "/api/v1/a2a/leases/expire", "/api/v1/a2a/registry/{id}/progress", "/api/v1/a2a/trust", "/api/v1/a2a/trust/policy", "/api/v1/a2a/trust/tasks", "/api/v1/a2a/negotiate", "/api/v1/a2a/sessions", "/api/v1/a2a/sessions/{id}", "/api/v1/a2a/sla", "/api/v1/a2a/sla/tasks", "/api/v1/a2a/sla/policy", "/api/v1/a2a/sla/escalations", "/api/v1/a2a/execution-windows", "/api/v1/a2a/execution-windows/policy", "/api/v1/a2a/execution-windows/tasks", "/api/v1/a2a/execution-windows/actions", "/api/v1/a2a/dispatch", "/api/v1/a2a/dispatch/{id}/packet", "/api/v1/a2a/dispatch/{id}/retry", "/api/v1/a2a/dispatch/{id}/reassign", "/api/v1/a2a/evidence", "/api/v1/a2a/health", "/api/v1/a2a/governance-tasks", "/api/v1/a2a/im-briefing", "/api/v1/agent-runs"], "capabilities": ["Agent 注册", "外部 Agent 凭证", "双向心跳", "跨组织信任策略", "信任治理任务", "双向任务拉取", "任务租约确认", "任务租约续期", "租约过期回收", "拒绝任务重派", "执行窗口审计", "执行窗口任务化", "执行窗口自动动作", "执行窗口策略配置", "执行窗口动作阻断解释", "进度回写", "能力协商", "协商会话历史", "外部 Agent SLA", "SLA 策略配置", "SLA 自动升级动作", "任务分发", "协议包预览", "Agent Run 关联", "失败分发重试", "证据回写同步质量门禁", "协议健康", "治理任务生成", "IM 风险简报"], "next": ["A2A 签名与跨租户 federation"]},
    {"id": "a2aWorkbench", "name": "A2A 工作台", "domain": "ecosystem", "path": "#/ecosystem/a2a/workbench", "status": "active", "maturity": 99, "apis": ["/api/v1/a2a/health", "/api/v1/a2a/registry", "/api/v1/a2a/registry/{id}/heartbeat", "/api/v1/a2a/registry/{id}/credentials/rotate", "/api/v1/a2a/registry/{id}/tasks/pull", "/api/v1/a2a/registry/{id}/tasks/ack", "/api/v1/a2a/registry/{id}/tasks/renew", "/api/v1/a2a/leases/expire", "/api/v1/a2a/registry/{id}/progress", "/api/v1/a2a/trust", "/api/v1/a2a/trust/policy", "/api/v1/a2a/trust/tasks", "/api/v1/a2a/sessions", "/api/v1/a2a/sla", "/api/v1/a2a/sla/tasks", "/api/v1/a2a/sla/policy", "/api/v1/a2a/sla/escalations", "/api/v1/a2a/execution-windows", "/api/v1/a2a/execution-windows/policy", "/api/v1/a2a/execution-windows/tasks", "/api/v1/a2a/execution-windows/actions", "/api/v1/a2a/dispatch", "/api/v1/a2a/dispatch/{id}/reassign"], "capabilities": ["协议健康", "运行风险", "外部 Agent 凭证", "双向心跳", "跨组织信任策略", "信任治理任务", "双向任务拉取", "任务租约确认", "任务租约续期", "租约过期回收", "拒绝任务重派", "执行窗口审计", "执行窗口任务化", "执行窗口自动动作", "执行窗口策略配置", "执行窗口动作阻断解释", "进度回写", "协商会话历史", "外部 Agent SLA", "SLA 策略配置", "SLA 自动升级动作", "Agent Run 关联", "IM 简报"], "next": ["A2A 签名与跨租户 federation"]},
    {"id": "a2aRegistry", "name": "A2A Agent 注册", "domain": "ecosystem", "path": "#/ecosystem/a2a/registry", "status": "active", "maturity": 99, "apis": ["/api/v1/a2a/registry", "/api/v1/a2a/registry/{id}/status", "/api/v1/a2a/registry/{id}/heartbeat", "/api/v1/a2a/registry/{id}/credentials/rotate", "/api/v1/a2a/registry/{id}/tasks/pull", "/api/v1/a2a/registry/{id}/tasks/ack", "/api/v1/a2a/registry/{id}/tasks/renew", "/api/v1/a2a/leases/expire", "/api/v1/a2a/registry/{id}/progress", "/api/v1/a2a/trust", "/api/v1/a2a/trust/policy", "/api/v1/a2a/trust/tasks"], "capabilities": ["Agent 注册", "能力画像", "启停治理", "外部 Agent 凭证", "双向心跳", "跨组织信任策略", "信任治理任务", "双向任务拉取", "任务租约确认", "任务租约续期", "租约过期回收", "进度回写", "可信状态"], "next": ["A2A 签名与跨租户 federation"]},
    {"id": "a2aNegotiate", "name": "A2A 能力协商", "domain": "ecosystem", "path": "#/ecosystem/a2a/negotiate", "status": "active", "maturity": 90, "apis": ["/api/v1/a2a/negotiate", "/api/v1/a2a/sessions", "/api/v1/a2a/sessions/{id}"], "capabilities": ["能力匹配", "风险解释", "推荐分发", "协商会话历史"], "next": ["会话 SLA"]},
    {"id": "a2aSla", "name": "A2A 外部 Agent SLA", "domain": "ecosystem", "path": "#/ecosystem/a2a/sla", "status": "active", "maturity": 94, "apis": ["/api/v1/a2a/sla", "/api/v1/a2a/sla/tasks", "/api/v1/a2a/sla/policy", "/api/v1/a2a/sla/escalations", "/api/v1/a2a/dispatch/{id}/retry"], "capabilities": ["SLA 健康分", "超时识别", "缺证据治理", "治理任务生成", "SLA 策略配置", "SLA 自动升级动作", "Agent Run 追溯"], "next": ["外部 Agent 凭证与双向心跳"]},
    {"id": "a2aWindows", "name": "A2A 执行窗口", "domain": "ecosystem", "path": "#/ecosystem/a2a/windows", "status": "active", "maturity": 99, "apis": ["/api/v1/a2a/execution-windows", "/api/v1/a2a/execution-windows/policy", "/api/v1/a2a/execution-windows/tasks", "/api/v1/a2a/execution-windows/actions", "/api/v1/a2a/registry/{id}/tasks/renew", "/api/v1/a2a/leases/expire", "/api/v1/a2a/dispatch/{id}/reassign"], "capabilities": ["执行窗口审计", "执行窗口任务化", "执行窗口自动动作", "执行窗口策略配置", "执行窗口动作阻断解释", "任务租约续期", "租约过期回收", "拒绝任务重派", "Agent Run 追溯"], "next": ["跨组织 A2A 信任策略"]},
    {"id": "a2aDispatch", "name": "A2A 任务分发", "domain": "ecosystem", "path": "#/ecosystem/a2a/dispatch", "status": "active", "maturity": 99, "apis": ["/api/v1/a2a/dispatch", "/api/v1/a2a/dispatch/{id}/packet", "/api/v1/a2a/dispatch/{id}/retry", "/api/v1/a2a/dispatch/{id}/reassign", "/api/v1/a2a/registry/{id}/tasks/pull", "/api/v1/a2a/registry/{id}/tasks/ack", "/api/v1/a2a/registry/{id}/tasks/renew", "/api/v1/a2a/leases/expire", "/api/v1/a2a/registry/{id}/progress", "/api/v1/a2a/sla", "/api/v1/a2a/execution-windows", "/api/v1/a2a/execution-windows/tasks", "/api/v1/a2a/execution-windows/actions", "/api/v1/agent-runs"], "capabilities": ["任务分发", "协议包预览", "Agent Run 关联", "失败分发重试", "拒绝任务重派", "双向任务拉取", "任务租约确认", "任务租约续期", "租约过期回收", "执行窗口审计", "执行窗口任务化", "执行窗口自动动作", "进度回写", "SLA 状态追踪"], "next": ["执行窗口策略调优"]},
    {"id": "a2aEvidence", "name": "A2A 执行证据", "domain": "ecosystem", "path": "#/ecosystem/a2a/evidence", "status": "active", "maturity": 92, "apis": ["/api/v1/a2a/evidence", "/api/v1/a2a/sla", "/api/v1/a2a/sla/tasks", "/api/v1/agent-runs/{id}/evidence"], "capabilities": ["证据回写", "质量评分", "Agent Run 状态同步", "SLA 超时治理"], "next": ["SLA 策略配置"]},
    {"id": "modelOps", "name": "模型管理", "domain": "ecosystem", "path": "#/platforms/models", "status": "active", "maturity": 85, "apis": ["/api/v1/models"], "capabilities": ["模型目录", "默认模型", "提供商连接", "角色绑定"], "next": ["模型评测", "成本路由"]},
    {"id": "llmGateway", "name": "模型网关", "domain": "ecosystem", "path": "#/ai/llm-gateway", "status": "active", "maturity": 99, "apis": ["/api/v1/llm-gateway/routes", "/api/v1/llm-gateway/decision", "/api/v1/llm-gateway/policies", "/api/v1/llm-gateway/provider-health", "/api/v1/llm-gateway/policy-evaluate", "/api/v1/llm-gateway/fallback-drill", "/api/v1/llm-gateway/cost", "/api/v1/llm-gateway/cost-anomalies/tasks", "/api/v1/llm-gateway/cost-attribution/runs", "/api/v1/llm-gateway/cost-attribution/run", "/api/v1/llm-gateway/cost-attribution/tasks", "/api/v1/llm-gateway/model-evals/runs", "/api/v1/llm-gateway/model-evals/run", "/api/v1/llm-gateway/model-evals/tasks", "/api/v1/llm-gateway/prompt-audit/runs", "/api/v1/llm-gateway/prompt-audit/run", "/api/v1/llm-gateway/prompt-audit/tasks", "/api/v1/llm-gateway/throttle", "/api/v1/llm-gateway/health", "/api/v1/llm-gateway/governance-tasks", "/api/v1/llm-gateway/im-briefing"], "capabilities": ["路由规则", "调用决策", "策略化路由", "预算护栏", "Provider 健康", "Fallback 演练", "成本统计", "成本异常任务化", "跨 Provider 成本归因", "成本归因历史", "成本归因任务化", "模型评测", "评测历史", "评测任务化", "Prompt 审计", "Prompt 风险任务化", "密钥与 PII 检测", "提示词注入检测", "限流策略", "治理任务生成", "IM 风险简报"], "next": ["真实账单导入", "按项目成本中心分摊"]},
    {"id": "llmGatewayAttribution", "name": "成本归因", "domain": "ecosystem", "path": "#/ai/llm-gateway/attribution", "status": "active", "maturity": 96, "apis": ["/api/v1/llm-gateway/cost-attribution/runs", "/api/v1/llm-gateway/cost-attribution/run", "/api/v1/llm-gateway/cost-attribution/tasks", "/api/v1/usage/summary"], "capabilities": ["Provider 成本分布", "模型成本分布", "任务类型归因", "调用来源归因", "归因历史", "归因任务化", "Agent consumption"], "next": ["真实账单导入", "按项目成本中心分摊"]},
    {"id": "llmGatewayEval", "name": "模型评测", "domain": "ecosystem", "path": "#/ai/llm-gateway/eval", "status": "active", "maturity": 96, "apis": ["/api/v1/llm-gateway/model-evals/runs", "/api/v1/llm-gateway/model-evals/run", "/api/v1/llm-gateway/model-evals/tasks", "/api/v1/llm-gateway/provider-health", "/api/v1/llm-gateway/throttle"], "capabilities": ["评测 Suite", "模型排名", "质量评分", "成本效率评分", "延迟 SLO", "Prompt 安全评分", "评测历史", "评测任务化", "Agent consumption"], "next": ["真实在线评测执行器", "人工标注反馈集"]},
    {"id": "platformOps", "name": "运行治理", "domain": "ecosystem", "path": "#/platforms/ops", "status": "active", "maturity": 86, "apis": ["/api/v1/platforms/ops-plan", "/api/v1/platforms/ops-tasks"], "capabilities": ["健康评分", "风险清单", "治理 Runbook", "AI 操作包", "治理任务预览", "治理任务落地"], "next": ["多工具 SLO", "Agent 执行审计", "自愈策略"]},
    {"id": "cliTools", "name": "CLI 工具", "domain": "ecosystem", "path": "#/platforms/cli", "status": "active", "maturity": 86, "apis": ["/api/v1/cli", "/api/v1/cli/run"], "capabilities": ["工具目录", "受控执行", "自定义工具", "安装提示"], "next": ["执行审计", "配额策略"]},
    {"id": "systemMap", "name": "模块治理", "domain": "governance", "path": "#/system-map", "status": "active", "maturity": 94, "apis": ["/api/v1/system/pages/hub", "/api/v1/system/pages", "/api/v1/system/pages/domains", "/api/v1/system/pages/manifest", "/api/v1/system/pages/readiness", "/api/v1/system/pages/production-readiness", "/api/v1/system/pages/experience-review", "/api/v1/system/pages/experience-review/tasks", "/api/v1/system/pages/readiness/tasks", "/api/v1/system/pages/governance-tasks", "/api/v1/system/pages/governance-tasks/bulk-update", "/api/v1/system/pages/isolation-audit", "/api/v1/system/pages/isolation-audit/scan", "/api/v1/system/pages/isolation-audit/scan/runs", "/api/v1/system/pages/isolation-audit/scan/runs/compare", "/api/v1/system/pages/isolation-audit/scan/runs/compare/tasks", "/api/v1/system/pages/isolation-audit/scan/tasks", "/api/v1/system/pages/isolation-audit/tasks"], "capabilities": ["治理中心", "子路由聚焦", "模块注册表", "能力地图", "legacy 能力承接", "域成熟度", "体验治理矩阵", "体验治理任务化", "生产就绪矩阵", "细粒度权限", "模块动作目录", "治理任务运营", "治理任务批量处置", "模块完整度任务化", "三码隔离任务化", "隔离源代码扫描", "隔离扫描快照", "智能基线对比", "对比风险任务化", "隔离源码任务化"], "next": ["页面插件清单", "字段级权限矩阵"]},
    {"id": "frontendPerformanceGovernance", "name": "前端性能治理", "domain": "governance", "path": "#/system-map/performance", "status": "active", "maturity": 90, "capability": "governance.system-map.frontend-performance", "apis": ["/api/v1/system/pages/frontend-performance"], "capabilities": ["构建产物审计", "Chunk 预算", "路由拆分证据", "移动首屏性能治理", "AI 拆包建议"], "next": ["真实 Web Vitals 采集", "移动端截图性能门禁"]},
    {"id": "opsCenter", "name": "智能运维中心", "domain": "system", "path": "#/system/ops-center", "status": "active", "maturity": 99, "apis": ["/api/v1/ops-center/summary", "/api/v1/ops-center/im-briefing"], "capabilities": ["运行中枢", "健康摘要", "风险简报", "AI 运维入口", "专业模块分流"], "next": []},
    {"id": "opsCenterPipeline", "name": "部署流水线", "domain": "system", "path": "#/system/ops-center/pipeline", "status": "active", "maturity": 94, "capability": "system.ops-center.pipeline", "apis": ["/api/v1/ops-center/pipelines"], "capabilities": ["部署流水线", "发布阶段", "审批证据", "执行记录"], "next": ["外部执行目标分层"]},
    {"id": "opsCenterAlerts", "name": "告警源治理", "domain": "system", "path": "#/system/ops-center/alerts", "status": "active", "maturity": 96, "capability": "system.ops-center.alerts", "apis": ["/api/v1/ops-center/alert-sources", "/api/v1/ops-center/alert-sources/{id}/test", "/api/v1/ops-center/alert-sources/{id}/toggle", "/api/v1/ops-center/alert-sources/sync", "/api/v1/ops-center/alerts", "/api/v1/ops-center/alert-noise/policies", "/api/v1/ops-center/alert-noise/evaluate", "/api/v1/ops-center/alert-noise/evaluations", "/api/v1/ops-center/alert-noise/silences", "/api/v1/ops-center/alert-noise/recommendations", "/api/v1/ops-center/alert-noise/recommendations/{recommendation_id}/action", "/api/v1/ops-center/alert-noise/strategy-compare", "/api/v1/ops-center/alert-noise/strategy-compare/runs", "/api/v1/ops-center/alert-noise/slo-prediction", "/api/v1/ops-center/alert-noise/slo-prediction/runs", "/api/v1/ops-center/alert-noise/slo-escalation-policy", "/api/v1/ops-center/alert-noise/slo-escalation/run", "/api/v1/ops-center/alert-noise/slo-escalation/runs", "/api/v1/ops-center/alert-noise/strategy-canary/audit", "/api/v1/ops-center/alert-noise/strategy-canary/audits", "/api/v1/ops-center/alert-noise/strategy-canary/audits/{audit_id}/action", "/api/v1/ops-center/strategy-linkage/runs", "/api/v1/ops-center/strategy-linkage/run"], "capabilities": ["生产告警源", "告警源测试", "告警同步", "告警标准化", "告警降噪策略", "维护静默窗口", "策略智能推荐", "策略 A/B 对比", "跨源 SLO 预测", "SLO 自动升级", "策略灰度准入审计", "跨模块策略联动"], "next": ["外部 CMDB/ITSM 联动"]},
    {"id": "opsCenterRca", "name": "根因分析", "domain": "system", "path": "#/system/ops-center/rca", "status": "active", "maturity": 94, "capability": "system.ops-center.rca", "apis": ["/api/v1/ops-center/rca", "/api/v1/ops-center/rca/{id}/verification-plan", "/api/v1/ops-center/rca/{id}/verify", "/api/v1/ops-center/rca/insights", "/api/v1/ops-center/rca/insights/tasks", "/api/v1/ops-center/rca/insights/rca"], "capabilities": ["根因分析", "RCA 验证计划", "RCA 验证关闭", "智能归因", "多源告警聚合", "归因任务化", "RCA 自动入库"], "next": ["观测 Trace 自动关联"]},
    {"id": "opsCenterRunbook", "name": "Runbook 治理", "domain": "system", "path": "#/system/ops-center/runbook", "status": "active", "maturity": 94, "capability": "system.ops-center.runbook", "apis": ["/api/v1/ops-center/runbooks", "/api/v1/ops-center/runbooks/{id}/versions", "/api/v1/ops-center/runbooks/{id}/versions/diff", "/api/v1/ops-center/runbooks/{id}/versions/{version_id}/action", "/api/v1/ops-center/runbooks/evidence", "/api/v1/ops-center/runbooks/evidence/backfill", "/api/v1/ops-center/runbooks/evidence/{record_id}/action"], "capabilities": ["Runbook 推荐", "Runbook 版本治理", "不可变快照", "版本差异对比", "历史版本恢复", "执行证据自动回填", "证据覆盖评分", "证据确认归档"], "next": ["Runbook 模板市场"]},
    {"id": "opsCenterSelfHeal", "name": "自愈策略", "domain": "system", "path": "#/system/ops-center/self-heal", "status": "active", "maturity": 96, "capability": "system.ops-center.self-heal", "apis": ["/api/v1/ops-center/self-heal", "/api/v1/ops-center/self-heal/evaluate", "/api/v1/ops-center/self-heal/evaluations", "/api/v1/ops-center/self-heal/tasks", "/api/v1/ops-center/self-heal/actions", "/api/v1/ops-center/self-heal/actions/{id}/approve", "/api/v1/ops-center/self-heal/actions/{id}/apply", "/api/v1/ops-center/self-heal/actions/{id}/verify", "/api/v1/ops-center/self-heal/actions/{id}/rollback"], "capabilities": ["自愈策略", "自愈审批", "动作应用", "动作验证", "回滚留证", "审计载荷", "治理任务生成"], "next": ["动作沙箱与策略回放"]},
    *SETTINGS_REACT_PAGES,
]


LEGACY_PAGES: list[dict[str, Any]] = [
    {"id": "legacy_dashboard", "console_id": "dashboard", "name": "Legacy 总览", "domain": "legacy-workspace", "path": "/console.html#dashboard", "status": "migrating", "maturity": 78, "target": "#/dashboard", "next": ["收敛跨项目摘要", "统一健康指标卡"]},
    {"id": "dev_flow", "console_id": "dev-flow", "name": "研发全流程", "domain": "legacy-delivery", "path": "/console.html#dev-flow", "status": "active", "maturity": 86, "target": "#/dev-flow", "next": ["燃尽图", "AI 流程模板"]},
    {"id": "legacy_analytics", "console_id": "analytics", "name": "统计分析", "domain": "legacy-data", "path": "/console.html#analytics", "status": "migrating", "maturity": 72, "target": "#/analytics", "next": ["迁移指标趋势", "统一到数据洞察子菜单"]},
    {"id": "legacy_requirements", "console_id": "requirements", "name": "Legacy 需求管理", "domain": "legacy-product", "path": "/console.html#requirements", "status": "migrating", "maturity": 84, "target": "#/requirements", "next": ["迁移搜索筛选体验", "统一需求拆任务入口"]},
    {"id": "plan", "console_id": "plan", "name": "执行计划", "domain": "legacy-delivery", "path": "/console.html#plan", "status": "active", "maturity": 82, "target": "#/tasks/scheduler", "next": ["AI 计划生成", "关键路径"]},
    {"id": "iteration", "console_id": "iteration", "name": "迭代进度", "domain": "legacy-delivery", "path": "/console.html#iteration", "status": "legacy", "maturity": 56, "target": "#/tasks", "next": ["合并 Sprint 进度", "补燃尽与风险预测"]},
    {"id": "sprints", "console_id": "sprints", "name": "Sprint", "domain": "legacy-delivery", "path": "/console.html#sprints", "status": "migrating", "maturity": 70, "target": "#/tasks", "next": ["迁移 Sprint 列表", "接入任务依赖图"]},
    {"id": "sprints_mgr", "console_id": "sprints-mgr", "name": "Sprint 管理", "domain": "legacy-delivery", "path": "/console.html#sprints-mgr", "status": "migrating", "maturity": 70, "target": "#/tasks", "next": ["迁移 Sprint CRUD", "接入迭代容量与负责人"]},
    {"id": "issues", "console_id": "issues", "name": "问题中心", "domain": "legacy-delivery", "path": "/console.html#issues", "status": "active", "maturity": 88, "target": "#/issues", "next": ["与任务看板深度联动", "保留 issue 直连 CLI"]},
    {"id": "search", "console_id": "search", "name": "全局搜索", "domain": "legacy-ai", "path": "/console.html#search", "status": "active", "maturity": 84, "target": "#/search", "next": ["语义搜索", "知识库并入"]},
    {"id": "vibe", "console_id": "vibe", "name": "Vibe Coding", "domain": "legacy-dev", "path": "/console.html#vibe", "status": "active", "maturity": 86, "target": "#/vibe", "next": ["终端沙箱", "多模态增强"]},
    {"id": "spec_editor", "console_id": "spec-editor", "name": "规范编辑", "domain": "legacy-product", "path": "/console.html#spec-editor", "status": "migrating", "maturity": 72, "target": "#/intelligence/specs", "next": ["收敛到规范文档工作台", "接入审核与同步队列"]},
    {"id": "docker", "console_id": "docker", "name": "Docker / 环境", "domain": "legacy-ops", "path": "/console.html#docker", "status": "active", "maturity": 86, "target": "#/ops/env", "next": ["镜像构建面板", "Compose 一键操作"]},
    {"id": "cli_tools", "console_id": "cli", "name": "CLI 工具", "domain": "legacy-dev", "path": "/console.html#cli", "status": "active", "maturity": 86, "target": "#/platforms/cli", "next": ["执行审计", "配额策略"]},
    {"id": "specs", "console_id": "specs", "name": "规范文档", "domain": "legacy-product", "path": "/console.html#specs", "status": "active", "maturity": 86, "target": "#/intelligence/specs", "next": ["接入知识库索引", "支持规约版本与发布"]},
    {"id": "design_docs", "console_id": "design-docs", "name": "技术方案", "domain": "legacy-product", "path": "/console.html#design-docs", "status": "active", "maturity": 84, "target": "#/intelligence/design-docs", "next": ["文档索引进度", "规则提案"]},
    {"id": "knowledge_mgr", "console_id": "knowledge-mgr", "name": "知识库", "domain": "legacy-ai", "path": "/console.html#knowledge-mgr", "status": "migrating", "maturity": 82, "target": "#/intelligence", "next": ["统一 KB/RAG 入口", "批量索引进度"]},
    {"id": "rules", "console_id": "rules", "name": "规则库", "domain": "legacy-product", "path": "/console.html#rules", "status": "migrating", "maturity": 78, "target": "#/intelligence", "next": ["规则提案审核", "规则同步冲突处理"]},
    {"id": "custom", "console_id": "custom", "name": "自定义模块", "domain": "legacy-platform", "path": "/console.html#custom", "status": "legacy", "maturity": 42, "target": "#/marketplace", "next": ["转为插件化资产", "接入权限与安装记录"]},
    {"id": "agents", "console_id": "agents", "name": "Agent 管理", "domain": "legacy-ai", "path": "/console.html#agents", "status": "migrating", "maturity": 72, "target": "#/platforms", "next": ["Agent 注册表", "能力 Profile"]},
    {"id": "skills", "console_id": "skills", "name": "技能管理", "domain": "legacy-ai", "path": "/console.html#skills", "status": "active", "maturity": 86, "target": "#/skills-hub", "next": ["技能版本", "评分与签名"]},
    {"id": "skill_repo", "console_id": "skill-repo", "name": "技能仓库", "domain": "legacy-ai", "path": "/console.html#skill-repo", "status": "active", "maturity": 84, "target": "#/skills-hub/repos", "next": ["仓库索引", "签名校验"]},
    {"id": "models", "console_id": "models", "name": "模型配置", "domain": "legacy-ai", "path": "/console.html#models", "status": "migrating", "maturity": 76, "target": "#/platforms", "next": ["补模型调用健康", "密钥 SecretRef"]},
    {"id": "orchestration", "console_id": "orchestration", "name": "编排工作流", "domain": "legacy-dev", "path": "/console.html#orchestration", "status": "active", "maturity": 84, "target": "#/orchestration", "next": ["可视化 DAG", "Temporal 执行态"]},
    {"id": "mcp", "console_id": "mcp", "name": "MCP Server", "domain": "legacy-dev", "path": "/console.html#mcp", "status": "migrating", "maturity": 70, "target": "#/platforms", "next": ["迁移 MCP Server 管理", "健康检查"]},
    {"id": "logs", "console_id": "logs", "name": "Agent 日志", "domain": "legacy-ops", "path": "/console.html#logs", "status": "legacy", "maturity": 46, "target": "#/settings", "next": ["日志查询", "trace 关联"]},
    {"id": "logs_viewer", "console_id": "logs-viewer", "name": "日志查看", "domain": "legacy-ops", "path": "/console.html#logs-viewer", "status": "migrating", "maturity": 76, "target": "#/settings", "next": ["统一到运行观测", "接入关键字/级别过滤"]},
    {"id": "notify_legacy", "console_id": "notify", "name": "消息通知", "domain": "legacy-ops", "path": "/console.html#notify", "status": "migrating", "maturity": 72, "target": "#/notify", "next": ["统一消息通道模板", "迁移 Webhook 发送记录"]},
    {"id": "config", "console_id": "config", "name": "项目配置", "domain": "legacy-system", "path": "/console.html#config", "status": "legacy", "maturity": 52, "target": "#/projects", "next": ["并入项目接入包", "增加项目级配置审计"]},
    {"id": "system", "console_id": "system", "name": "系统管理", "domain": "legacy-system", "path": "/console.html#system", "status": "migrating", "maturity": 75, "target": "#/settings", "next": ["拆分系统配置模块", "接入 Profile/SSO/观测"]},
    {"id": "auth", "console_id": "auth", "name": "账号管理", "domain": "legacy-admin", "path": "/console.html#auth", "status": "migrating", "maturity": 74, "target": "#/organization", "next": ["统一到成员权限", "SSO JIT 用户联动"]},
    {"id": "tenants", "console_id": "tenants", "name": "组织管理", "domain": "legacy-admin", "path": "/console.html#tenants", "status": "migrating", "maturity": 72, "target": "#/organization", "next": ["套餐/配额联动", "ABAC"]},
    {"id": "db_config", "console_id": "db-config", "name": "数据库配置", "domain": "legacy-data", "path": "/console.html#db-config", "status": "active", "maturity": 84, "target": "#/data/sources", "next": ["SecretRef", "向量库联邦"]},
    {"id": "health", "console_id": "health", "name": "健康监控", "domain": "legacy-ops", "path": "/console.html#health", "status": "migrating", "maturity": 80, "target": "#/settings", "next": ["统一到运行状态", "补充自动诊断建议"]},
    {"id": "audit_legacy", "console_id": "audit", "name": "审计日志", "domain": "legacy-ops", "path": "/console.html#audit", "status": "migrating", "maturity": 78, "target": "#/audit", "next": ["合并审计事件检索", "链验证体验统一"]},
    {"id": "webhook", "console_id": "webhook", "name": "Webhook", "domain": "legacy-ops", "path": "/console.html#webhook", "status": "active", "maturity": 84, "target": "#/notify/webhooks", "next": ["重试策略", "死信队列"]},
    {"id": "data_exchange", "console_id": "data-exchange", "name": "数据港", "domain": "legacy-data", "path": "/console.html#data-exchange", "status": "migrating", "maturity": 88, "target": "#/analytics/exchange", "next": ["导入导出任务异步化", "数据血缘联动"]},
]


def _target_domain(item: dict[str, Any]) -> str | None:
    target = str(item.get("target", ""))
    if not target:
        return None
    for page in REACT_PAGES:
        if str(page.get("path")) == target:
            return str(page.get("domain"))
    return None


def _summary(items: list[dict[str, Any]]) -> dict[str, Any]:
    statuses = Counter(str(i.get("status", "unknown")) for i in items)
    domains = Counter(str(i.get("domain", "unknown")) for i in items)
    avg = round(sum(int(i.get("maturity", 0)) for i in items) / max(len(items), 1), 1)
    return {"total": len(items), "avg_maturity": avg, "by_status": dict(statuses), "by_domain": dict(domains)}


def _legacy_cockpit_summary(legacy: list[dict[str, Any]]) -> dict[str, Any]:
    plan = _legacy_migration_plan(legacy)
    summary = _summary(legacy)
    open_rows = [item for item in legacy if str(item.get("status") or "legacy") in {"legacy", "migrating"}]
    low_maturity = [item for item in legacy if int(item.get("maturity", 0)) < 70]
    domains = Counter(str(item.get("effective_domain") or item.get("domain") or "unknown") for item in legacy)
    return {
        **summary,
        "by_effective_domain": dict(domains),
        "coverage": {
            "covered": plan["covered"],
            "partial": plan["partial"],
            "missing_target": plan["missing_target"],
            "rate": round(plan["covered"] / max(1, plan["total"]) * 100, 1),
        },
        "open_count": len(open_rows),
        "low_maturity_count": len(low_maturity),
        "backlog_count": len(_migration_backlog(legacy, limit=100)),
        "recommended_next": [
            "优先迁移 maturity < 70 且仍为 legacy 的入口。",
            "每个 legacy 入口迁移时同时补齐 API、权限能力码、AI surface、审计事件和任务化验收。",
            "迁移完成后在 SystemMap validate 中校验 target、导航和能力注册一致性。",
        ],
    }


def _domain_matrix(react: list[dict[str, Any]], legacy: list[dict[str, Any]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for domain in DOMAINS:
        react_rows = [p for p in react if p.get("domain") == domain["id"]]
        target_paths = {str(p.get("path")) for p in react_rows}
        legacy_rows = [p for p in legacy if str(p.get("target", "")) in target_paths or p.get("domain") == f"legacy-{domain['id']}"]
        maturities = [int(p.get("maturity", 0)) for p in [*react_rows, *legacy_rows]]
        rows.append(
            {
                **domain,
                "react_count": len(react_rows),
                "legacy_count": len(legacy_rows),
                "total": len(react_rows) + len(legacy_rows),
                "avg_maturity": round(sum(maturities) / max(len(maturities), 1), 1),
                "react_pages": [p["id"] for p in react_rows],
                "legacy_pages": [p["id"] for p in legacy_rows],
            }
        )
    return rows


def _enrich_pages(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    enriched = []
    for item in items:
        raw_domain = str(item.get("domain", ""))
        target_domain = _target_domain(item)
        effective_domain = raw_domain if raw_domain in DOMAIN_BY_ID else target_domain or raw_domain
        domain = DOMAIN_BY_ID.get(effective_domain)
        enriched.append(
            {
                **item,
                "source_domain": raw_domain,
                "target_domain": target_domain,
                "effective_domain": effective_domain,
                "domain_name": domain.get("name") if domain else item.get("domain"),
                "domain_order": domain.get("order", 999) if domain else 999,
                "capability_key": f"{effective_domain}.{item.get('id')}",
            }
        )
    return sorted(enriched, key=lambda p: (int(p.get("domain_order", 999)), str(p.get("id"))))


def _filter_pages(
    items: list[dict[str, Any]],
    *,
    domain: str | None = None,
    status: str | None = None,
    q: str | None = None,
) -> list[dict[str, Any]]:
    query = (q or "").strip().lower()
    result: list[dict[str, Any]] = []
    for item in items:
        if domain and domain != "all" and item.get("effective_domain") != domain and item.get("domain") != domain:
            continue
        if status and status != "all" and item.get("status") != status:
            continue
        if query:
            haystack = " ".join(
                [
                    str(item.get("id", "")),
                    str(item.get("name", "")),
                    str(item.get("domain", "")),
                    str(item.get("domain_name", "")),
                    str(item.get("path", "")),
                    str(item.get("target", "")),
                    " ".join(str(x) for x in item.get("capabilities", [])),
                    " ".join(str(x) for x in item.get("next", [])),
                ]
            ).lower()
            if query not in haystack:
                continue
        result.append(item)
    return result


def _migration_backlog(legacy: list[dict[str, Any]], *, limit: int = 8) -> list[dict[str, Any]]:
    rows = sorted(
        legacy,
        key=lambda item: (
            0 if item.get("status") == "migrating" else 1,
            int(item.get("maturity", 0)),
            str(item.get("id", "")),
        ),
    )
    return [
        {
            "id": item.get("id"),
            "name": item.get("name"),
            "status": item.get("status"),
            "maturity": item.get("maturity"),
            "path": item.get("path"),
            "target": item.get("target"),
            "target_domain": item.get("target_domain"),
            "domain_name": item.get("domain_name"),
            "next": item.get("next", []),
        }
        for item in rows[:limit]
    ]


def _legacy_migration_plan(legacy: list[dict[str, Any]]) -> dict[str, Any]:
    target_by_path = {str(item.get("path")): item for item in _enrich_pages(REACT_PAGES)}
    groups: dict[str, list[dict[str, Any]]] = {}
    rows: list[dict[str, Any]] = []
    for item in legacy:
        target = target_by_path.get(str(item.get("target") or ""))
        maturity = int(item.get("maturity", 0))
        target_maturity = int(target.get("maturity", 0)) if target else 0
        status = str(item.get("status") or "legacy")
        priority_score = (100 - maturity) + (20 if status == "legacy" else 8 if status == "migrating" else 0)
        coverage = "covered" if target and target_maturity >= 85 and status != "legacy" else "partial" if target else "missing_target"
        row = {
            "id": item.get("id"),
            "console_id": item.get("console_id"),
            "name": item.get("name"),
            "source_path": item.get("path"),
            "target": item.get("target"),
            "target_module": target.get("id") if target else "",
            "target_name": target.get("name") if target else "",
            "domain": item.get("effective_domain") or item.get("target_domain") or item.get("domain"),
            "domain_name": item.get("domain_name"),
            "status": status,
            "coverage": coverage,
            "maturity": maturity,
            "target_maturity": target_maturity,
            "priority_score": priority_score,
            "priority": "P0" if priority_score >= 70 else "P1" if priority_score >= 45 else "P2",
            "next": item.get("next", []),
            "recommended_slice": [
                f"迁移 legacy 入口 {item.get('path')} 到 {item.get('target')}",
                "补齐 React 页面 API、权限、AI surface 与审计动作",
                "在 SystemMap 校验注册表、能力码和 legacy target",
            ],
        }
        rows.append(row)
        groups.setdefault(str(row["domain"] or "unknown"), []).append(row)
    rows.sort(key=lambda row: (-int(row.get("priority_score", 0)), str(row.get("id"))))
    group_rows = [
        {
            "domain": domain,
            "total": len(items),
            "missing_target": sum(1 for item in items if item["coverage"] == "missing_target"),
            "partial": sum(1 for item in items if item["coverage"] == "partial"),
            "covered": sum(1 for item in items if item["coverage"] == "covered"),
            "items": sorted(items, key=lambda row: (-int(row.get("priority_score", 0)), str(row.get("id")))),
        }
        for domain, items in sorted(groups.items())
    ]
    return {
        "total": len(rows),
        "covered": sum(1 for row in rows if row["coverage"] == "covered"),
        "partial": sum(1 for row in rows if row["coverage"] == "partial"),
        "missing_target": sum(1 for row in rows if row["coverage"] == "missing_target"),
        "items": rows,
        "groups": group_rows,
    }


def _governance_status(react: list[dict[str, Any]], legacy: list[dict[str, Any]]) -> dict[str, Any]:
    validation = _registry_validation()
    react_ready = [item for item in react if int(item.get("maturity", 0)) >= 85]
    react_improve = [item for item in react if int(item.get("maturity", 0)) < 85]
    legacy_open = [item for item in legacy if item.get("status") in {"legacy", "migrating"}]
    backlog = _migration_backlog(legacy, limit=100)
    tasks = [
        {
            "id": "registry_consistency",
            "name": "注册一致性治理",
            "status": "done" if validation["ok"] else "todo",
            "description": "确保前端菜单、后端模块注册表、legacy 能力承接清单和目标模块保持一致。",
            "next_action": "检查缺失菜单、域不一致和失效迁移目标。",
            "metric": validation["score"],
        },
        {
            "id": "legacy_convergence",
            "name": "Legacy 能力收敛",
            "status": "todo" if backlog else "done",
            "description": "把 console.html 中仍有价值的能力迁移到 React 模块，退役 Babel 单页兜底。",
            "next_action": "从 Legacy 迁移 Backlog 选择候选并生成交付任务。",
            "metric": len(backlog),
        },
        {
            "id": "module_permission_ai",
            "name": "权限与 AI 能力治理",
            "status": "active",
            "description": "统一维护模块能力码、角色读写管权限、AI surfaces 和模块动作入口。",
            "next_action": "在权限矩阵中校验当前角色可见能力，并为模块动作接入审批与审计。",
            "metric": len(react),
        },
        {
            "id": "module_maturity",
            "name": "模块成熟度提升",
            "status": "todo" if react_improve else "done",
            "description": "对成熟度低于 85 的 React 模块补齐交互、API、权限、AI 与运维能力。",
            "next_action": "优先处理低成熟度模块的 next 建议。",
            "metric": len(react_improve),
        },
    ]
    return {
        "purpose": "页面管理不是业务待办页，而是 Manager 自身的模块治理中心：统一管理模块注册、菜单归类、权限能力码、AI 入口、legacy 能力承接、模块动作和审计策略。",
        "is_task_page": False,
        "completion_status": {
            "registry_ready": validation["ok"],
            "react_ready": len(react_ready),
            "react_need_improvement": len(react_improve),
            "legacy_need_convergence": len(legacy_open),
            "migration_backlog": len(backlog),
        },
        "tasks": tasks,
    }


def _backlog_task_payload(item: dict[str, Any], *, priority: str, assigned_to: str) -> dict[str, Any]:
    next_items = [str(x) for x in item.get("next", [])]
    return {
        "title": f"迁移 legacy 页面：{item.get('name')}",
        "description": "\n".join(
            [
                f"legacy_path: {item.get('path')}",
                f"target: {item.get('target')}",
                f"domain: {item.get('domain_name') or item.get('target_domain') or item.get('domain')}",
                "",
                "迁移/增强任务:",
                *[f"- {x}" for x in next_items],
            ]
        ).strip(),
        "priority": priority,
        "estimate": "M",
        "assigned_to": assigned_to or "Coder",
        "dev_tool": "codex",
        "source": "system_page_backlog",
        "source_report_id": str(item.get("id") or ""),
        "source_report_title": str(item.get("name") or ""),
        "debug_notes": f"Generated from system page migration backlog: {item.get('id')} -> {item.get('target')}",
    }


def _existing_backlog_task_ids() -> set[str]:
    try:
        existing = list_tasks(source="system_page_backlog")
    except Exception:
        return set()
    return {str(x.get("source_report_id") or "") for x in existing if x.get("source_report_id")}


def _existing_governance_task_ids() -> set[str]:
    try:
        existing = list_tasks(source="system_page_governance")
    except Exception:
        return set()
    return {str(x.get("source_report_id") or "") for x in existing if x.get("source_report_id")}


def _existing_readiness_task_ids() -> set[str]:
    try:
        existing = list_tasks(source="system_page_readiness")
    except Exception:
        return set()
    return {str(x.get("source_report_id") or "") for x in existing if x.get("source_report_id")}


def _existing_experience_task_ids() -> set[str]:
    try:
        existing = list_tasks(source="system_page_experience")
    except Exception:
        return set()
    return {str(x.get("source_report_id") or "") for x in existing if x.get("source_report_id")}


def _existing_frontend_performance_task_ids() -> set[str]:
    try:
        existing = list_tasks(source="system_frontend_performance")
    except Exception:
        return set()
    return {str(x.get("source_report_id") or "") for x in existing if x.get("source_report_id")}


def _existing_isolation_task_ids() -> set[str]:
    try:
        existing = list_tasks(source="system_page_isolation")
    except Exception:
        return set()
    return {str(x.get("source_report_id") or "") for x in existing if x.get("source_report_id")}


def _existing_isolation_scan_task_ids() -> set[str]:
    try:
        existing = list_tasks(source="system_page_isolation_scan")
    except Exception:
        return set()
    return {str(x.get("source_report_id") or "") for x in existing if x.get("source_report_id")}


def _existing_isolation_scan_compare_task_ids() -> set[str]:
    try:
        existing = list_tasks(source="system_page_isolation_scan_compare")
    except Exception:
        return set()
    return {str(x.get("source_report_id") or "") for x in existing if x.get("source_report_id")}


def _list_tasks_safe(**filters: Any) -> list[dict[str, Any]]:
    try:
        raw = list_tasks(**filters) if filters else list_tasks()
    except Exception:
        return []
    return [item for item in raw if isinstance(item, dict)]


SYSTEM_PAGE_GOVERNANCE_TASK_SOURCES: list[dict[str, str]] = [
    {
        "source": "system_page_experience",
        "label": "体验治理",
        "route": "#/system-map/experience",
        "task_api": "/api/v1/system/pages/experience-review/tasks",
        "cli": "sop pages experience-tasks --dry-run --json",
    },
    {
        "source": "system_page_readiness",
        "label": "模块完整度",
        "route": "#/system-map/readiness",
        "task_api": "/api/v1/system/pages/readiness/tasks",
        "cli": "sop pages readiness-tasks --dry-run --json",
    },
    {
        "source": "system_frontend_performance",
        "label": "前端性能治理",
        "route": "#/system-map/performance",
        "task_api": "/api/v1/system/pages/frontend-performance/tasks",
        "cli": "sop pages frontend-performance-tasks --dry-run --json",
    },
    {
        "source": "system_page_isolation",
        "label": "三码隔离审计",
        "route": "#/system-map/three-code-isolation",
        "task_api": "/api/v1/system/pages/isolation-audit/tasks",
        "cli": "sop pages isolation-tasks --dry-run --json",
    },
    {
        "source": "system_page_isolation_scan",
        "label": "源码隔离扫描",
        "route": "#/system-map/source-scan",
        "task_api": "/api/v1/system/pages/isolation-audit/scan/tasks",
        "cli": "sop pages isolation-scan-tasks --dry-run --json",
    },
    {
        "source": "system_page_isolation_scan_compare",
        "label": "智能基线对比",
        "route": "#/system-map/baseline-compare",
        "task_api": "/api/v1/system/pages/isolation-audit/scan/runs/compare/tasks",
        "cli": "sop pages isolation-scan-compare-tasks --dry-run --json",
    },
    {
        "source": "system_page_backlog",
        "label": "Legacy 迁移",
        "route": "#/system-map/migration",
        "task_api": "/api/v1/system/pages/backlog/tasks",
        "cli": "sop pages backlog-tasks --dry-run --json",
    },
    {
        "source": "system_page_governance",
        "label": "模块治理",
        "route": SYSTEM_GOVERNANCE_TASKS_ROUTE,
        "task_api": "/api/v1/system/pages/governance/tasks",
        "cli": "sop pages governance-tasks --json",
    },
    {
        "source": "system_module_action",
        "label": "模块动作",
        "route": "#/system-map/actions",
        "task_api": "/api/v1/system/pages/actions/execute",
        "cli": "sop pages actions --json",
    },
]


def _governance_task_source_meta() -> dict[str, dict[str, str]]:
    return {item["source"]: item for item in SYSTEM_PAGE_GOVERNANCE_TASK_SOURCES}


def _governance_task_text(item: dict[str, Any]) -> str:
    return "\n".join(
        str(item.get(key) or "")
        for key in (
            "id",
            "title",
            "description",
            "assigned_to",
            "priority",
            "status",
            "source",
            "source_report_id",
            "source_report_title",
        )
    ).lower()


def _task_url(item: dict[str, Any]) -> str:
    source = str(item.get("source") or "")
    task_id = str(item.get("id") or "")
    q = str(item.get("source_report_id") or task_id)
    return f"#/tasks?source={quote(source)}&q={quote(q)}"


def _decorate_governance_task(item: dict[str, Any], source_meta: dict[str, dict[str, str]]) -> dict[str, Any]:
    source = str(item.get("source") or "")
    meta = source_meta.get(source, {"label": source or "未分类", "route": SYSTEM_GOVERNANCE_TASKS_ROUTE, "task_api": "", "cli": ""})
    return {
        **item,
        "source": source,
        "source_label": meta.get("label") or source,
        "source_route": meta.get("route") or SYSTEM_GOVERNANCE_TASKS_ROUTE,
        "source_task_api": meta.get("task_api") or "",
        "source_cli": meta.get("cli") or "",
        "task_url": _task_url(item),
    }


def _system_governance_task_bulk_cli(ids: list[str], patch: dict[str, str], *, dry_run: bool) -> str:
    args = ["sop pages governance-tasks-update"]
    if ids:
        args.append(f"--ids {','.join(ids[:5])}")
    args.append("--dry-run" if dry_run else "--apply")
    if patch.get("status"):
        args.append(f"--status {patch['status']}")
    if patch.get("priority"):
        args.append(f"--priority {patch['priority']}")
    if patch.get("assigned_to"):
        args.append(f"--assigned-to {shell_quote(str(patch['assigned_to']))}")
    args.append("--json")
    return " ".join(args)


def _system_governance_tasks_payload(*, status: str, source: str, q: str, limit: int) -> dict[str, Any]:
    source_meta = _governance_task_source_meta()
    source_order = {item["source"]: index for index, item in enumerate(SYSTEM_PAGE_GOVERNANCE_TASK_SOURCES)}
    safe_status = status if status in {"all", *SYSTEM_GOVERNANCE_TASK_STATUSES} else "all"
    safe_source = source if source in source_meta else "all"
    q_norm = q.strip().lower()
    raw_tasks = _list_tasks_safe()
    rows = [task for task in raw_tasks if str(task.get("source") or "") in source_meta]
    if safe_status != "all":
        rows = [task for task in rows if str(task.get("status") or "") == safe_status]
    if safe_source != "all":
        rows = [task for task in rows if str(task.get("source") or "") == safe_source]
    if q_norm:
        rows = [task for task in rows if q_norm in _governance_task_text(task)]

    def _sort_key(task: dict[str, Any]) -> tuple[int, str, str]:
        priority = str(task.get("priority") or "P9").upper()
        priority_rank = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}.get(priority, 9)
        updated = str(task.get("updated_at") or task.get("created_at") or "")
        return (priority_rank, source_order.get(str(task.get("source") or ""), 99), updated)

    rows = sorted(rows, key=_sort_key)[: max(1, min(int(limit or 50), 200))]
    decorated = [_decorate_governance_task(item, source_meta) for item in rows]
    by_status = Counter(str(item.get("status") or "unknown") for item in decorated)
    by_priority = Counter(str(item.get("priority") or "P3").upper() for item in decorated)
    by_source = Counter(str(item.get("source") or "") for item in decorated)
    lanes = []
    for meta in SYSTEM_PAGE_GOVERNANCE_TASK_SOURCES:
        lane_rows = [item for item in decorated if item.get("source") == meta["source"]]
        lanes.append(
            {
                "source": meta["source"],
                "label": meta["label"],
                "route": meta["route"],
                "task_api": meta["task_api"],
                "cli": meta["cli"],
                "count": len(lane_rows),
                "open": sum(1 for item in lane_rows if item.get("status") != "completed"),
                "completed": sum(1 for item in lane_rows if item.get("status") == "completed"),
                "latest_task_id": str(lane_rows[0].get("id") or "") if lane_rows else "",
            }
        )
    source_options = [{"value": "all", "label": "全部治理任务"}] + [
        {"value": item["source"], "label": item["label"], "route": item["route"]} for item in SYSTEM_PAGE_GOVERNANCE_TASK_SOURCES
    ]
    return {
        "ok": True,
        "filters": {"status": safe_status, "source": safe_source, "q": q, "limit": max(1, min(int(limit or 50), 200))},
        "items": decorated,
        "lanes": lanes,
        "summary": {
            "total": len(decorated),
            "open": sum(1 for item in decorated if item.get("status") != "completed"),
            "pending": by_status.get("pending", 0),
            "in_progress": by_status.get("in_progress", 0),
            "blocked": by_status.get("blocked", 0),
            "completed": by_status.get("completed", 0),
            "by_status": dict(by_status),
            "by_priority": dict(by_priority),
            "by_source": dict(by_source),
            "source_options": source_options,
            "status_options": [{"value": "all", "label": "全部状态"}] + [{"value": value, "label": value} for value in SYSTEM_GOVERNANCE_TASK_STATUSES],
            "bulk_actions": {
                "statuses": list(SYSTEM_GOVERNANCE_TASK_STATUSES),
                "priorities": list(SYSTEM_GOVERNANCE_TASK_PRIORITIES),
                "fields": ["status", "priority", "assigned_to"],
                "max_ids": 200,
                "assigned_to_max_length": 64,
                "dry_run_default": True,
            },
        },
        "agent_consumption": {
            "purpose": "聚合 SystemMap 各专业治理单元生成的真实任务，供人、CLI 和 Agent 按来源、状态、优先级持续跟踪闭环。",
            "api": SYSTEM_GOVERNANCE_TASKS_API,
            "cli": "sop pages governance-tasks --json",
            "sources": [item["source"] for item in SYSTEM_PAGE_GOVERNANCE_TASK_SOURCES],
            "task_center": SYSTEM_TASK_CENTER_ROUTE,
        },
    }


def _system_governance_tasks_bulk_update_payload(body: GovernanceTaskBulkUpdateIn) -> dict[str, Any]:
    requested_ids = [str(tid).strip() for tid in body.ids if str(tid).strip()]
    requested_ids = list(dict.fromkeys(requested_ids))
    patch: dict[str, str] = {}
    if body.status is not None:
        patch["status"] = str(body.status)
    if body.priority is not None:
        patch["priority"] = str(body.priority).upper()
    if body.assigned_to is not None and str(body.assigned_to).strip():
        patch["assigned_to"] = str(body.assigned_to).strip()[:64]
    payload = _system_governance_tasks_payload(status="all", source="all", q="", limit=200)
    governance_by_id = {str(item.get("id") or ""): item for item in payload.get("items") or [] if item.get("id")}
    all_known_ids = {str(item.get("id") or "") for item in _list_tasks_safe() if item.get("id")}
    planned: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for task_id in requested_ids:
        item = governance_by_id.get(task_id)
        if item:
            planned.append({"id": task_id, "title": item.get("title"), "source": item.get("source"), "patch": patch})
        elif task_id in all_known_ids:
            skipped.append({"id": task_id, "reason": "not_governance_task"})
        else:
            skipped.append({"id": task_id, "reason": "not_found"})
    updated = 0
    bulk_result: dict[str, Any] = {}
    if planned and patch and not body.dry_run:
        bulk_body = TaskBulkUpdate(ids=[item["id"] for item in planned], **patch)
        bulk_result = bulk_update_tasks(bulk_body)
        updated = int(bulk_result.get("updated") or len(planned))
    elif not patch:
        skipped.extend({"id": item["id"], "reason": "no_update_fields"} for item in planned)
        planned = []
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "planned": planned,
        "updated": bulk_result,
        "skipped": skipped,
        "summary": {"planned": len(planned), "updated": updated, "skipped": len(skipped)},
        "agent_consumption": {
            "purpose": "对 SystemMap 治理任务运营看板中选中的真实治理任务做 scoped 批量处置，普通任务不会被此接口更新。",
            "api": SYSTEM_GOVERNANCE_TASKS_BULK_UPDATE_API,
            "cli": _system_governance_task_bulk_cli(requested_ids, patch, dry_run=body.dry_run),
            "allowed_sources": [item["source"] for item in SYSTEM_PAGE_GOVERNANCE_TASK_SOURCES],
            "allowed_statuses": list(SYSTEM_GOVERNANCE_TASK_STATUSES),
            "allowed_priorities": list(SYSTEM_GOVERNANCE_TASK_PRIORITIES),
            "task_center": SYSTEM_TASK_CENTER_ROUTE,
        },
    }


def _readiness_task_payload(item: dict[str, Any], *, priority: str, assigned_to: str) -> dict[str, Any]:
    gaps = item.get("gaps") or []
    next_actions = [str(x) for x in item.get("next_actions") or [] if str(x).strip()]
    contract = item.get("implementation_contract") or {}
    module_id = str(item.get("id") or "")
    return {
        "title": f"补齐模块完整度：{item.get('name') or module_id}",
        "description": "\n".join(
            [
                f"module_id: {module_id}",
                f"path: {item.get('path') or ''}",
                f"domain: {item.get('domain_name') or item.get('domain') or ''}",
                f"status: {item.get('status')}",
                f"readiness_score: {item.get('readiness_score')}",
                "",
                "gaps:",
                *[
                    f"- {gap.get('dimension')}: score={gap.get('score')} detail={gap.get('detail')}"
                    for gap in gaps[:8]
                    if isinstance(gap, dict)
                ],
                "",
                "next_actions:",
                *[f"- {x}" for x in next_actions[:8]],
                "",
                "implementation_contract:",
                json.dumps(contract, ensure_ascii=False, indent=2),
            ]
        ).strip(),
        "priority": priority,
        "estimate": "M" if str(item.get("status")) == "risk" else "S",
        "assigned_to": assigned_to or "Coder",
        "dev_tool": "codex",
        "source": "system_page_readiness",
        "source_report_id": f"readiness:{module_id}",
        "source_report_title": str(item.get("name") or module_id),
        "debug_notes": f"Generated from SystemMap module readiness: {module_id}",
    }


def _experience_task_payload(item: dict[str, Any], *, priority: str, assigned_to: str) -> dict[str, Any]:
    module_id = str(item.get("id") or "")
    recommendations = [str(x) for x in item.get("recommendations") or [] if str(x).strip()]
    dimensions = item.get("dimensions") or {}
    contract = item.get("implementation_contract") or {}
    ui_contract = item.get("ui_contract") or {}
    return {
        "title": f"优化页面体验：{item.get('name') or module_id}",
        "description": "\n".join(
            [
                f"module_id: {module_id}",
                f"path: {item.get('path') or ''}",
                f"domain: {item.get('domain_name') or item.get('domain') or ''}",
                f"experience_status: {item.get('status')}",
                f"experience_score: {item.get('experience_score')}",
                "",
                "experience_dimensions:",
                *[
                    f"- {key}: score={value.get('score')} status={value.get('status')} detail={value.get('detail')}"
                    for key, value in dimensions.items()
                    if isinstance(value, dict)
                ],
                "",
                "recommendations:",
                *[f"- {x}" for x in recommendations[:8]],
                "",
                "ui_contract:",
                json.dumps(ui_contract, ensure_ascii=False, indent=2),
                "",
                "implementation_contract:",
                json.dumps(contract, ensure_ascii=False, indent=2),
            ]
        ).strip(),
        "priority": priority,
        "estimate": "M" if str(item.get("status")) == "complex" else "S",
        "assigned_to": assigned_to or "Designer",
        "dev_tool": "codex",
        "source": "system_page_experience",
        "source_report_id": f"experience:{module_id}",
        "source_report_title": str(item.get("name") or module_id),
        "debug_notes": f"Generated from SystemMap experience review: {module_id}",
    }


def _frontend_performance_task_payload(item: dict[str, Any], *, priority: str, assigned_to: str) -> dict[str, Any]:
    name = str(item.get("name") or "")
    budget = item.get("budget") or {}
    status = str(budget.get("status") or "watch")
    load_scope = str(item.get("load_scope") or "shared")
    impact = "首屏阻塞" if load_scope == "initial" else "低频延迟加载" if load_scope.startswith(("deferred", "route-lazy")) else "共享依赖"
    return {
        "title": f"拆分前端构建产物：{name}",
        "description": "\n".join(
            [
                f"chunk: {name}",
                f"type: {item.get('type') or ''}",
                f"load_scope: {load_scope}",
                f"impact: {impact}",
                f"size_kb: {item.get('size_kb')}",
                f"gzip_kb: {item.get('gzip_kb')}",
                f"budget_status: {status}",
                "",
                "optimization_scope:",
                "- 首屏 initial chunk 优先拆命令面板、菜单偏好和低频治理面板",
                "- deferred/route-lazy chunk 保持低频入口后置，并继续拆图谱、图表和复杂依赖",
                "- 保持页面聚焦、移动端首屏轻量和成熟组件复用",
                "",
                "budget:",
                json.dumps(budget, ensure_ascii=False, indent=2),
            ]
        ).strip(),
        "priority": "P0" if status == "risk" and load_scope == "initial" else "P1" if status == "risk" else priority,
        "estimate": "M" if status == "risk" else "S",
        "assigned_to": assigned_to or "FrontendAgent",
        "dev_tool": "codex",
        "source": "system_frontend_performance",
        "source_report_id": f"frontend-performance:{name}",
        "source_report_title": name,
        "debug_notes": f"Generated from SystemMap frontend performance: {name}",
    }


def _isolation_task_payload(item: dict[str, Any], *, scope_contract: dict[str, Any], priority: str, assigned_to: str) -> dict[str, Any]:
    domain_id = str(item.get("id") or "")
    tests = [str(x) for x in item.get("tests") or [] if str(x).strip()]
    scope_fields = [str(x) for x in item.get("scope_fields") or [] if str(x).strip()]
    return {
        "title": f"加固三码隔离：{item.get('name') or domain_id}",
        "description": "\n".join(
            [
                f"domain_id: {domain_id}",
                f"module: {item.get('module') or ''}",
                f"storage: {item.get('storage') or ''}",
                f"status: {item.get('status') or ''}",
                f"guard: {item.get('guard') or ''}",
                f"read_protected: {item.get('read_protected')}",
                f"write_protected: {item.get('write_protected')}",
                "",
                "scope_fields:",
                *[f"- {field}" for field in scope_fields],
                "",
                "tests:",
                *[f"- {test}" for test in tests],
                "",
                "scope_contract:",
                json.dumps(scope_contract, ensure_ascii=False, indent=2),
            ]
        ).strip(),
        "priority": priority,
        "estimate": "M" if str(item.get("status")) != "protected" else "S",
        "assigned_to": assigned_to or "SecurityAgent",
        "dev_tool": "codex",
        "source": "system_page_isolation",
        "source_report_id": f"isolation:{domain_id}",
        "source_report_title": str(item.get("name") or domain_id),
        "debug_notes": f"Generated from SystemMap three-code isolation audit: {domain_id}",
    }


def _isolation_scan_task_payload(item: dict[str, Any], *, priority: str, assigned_to: str) -> dict[str, Any]:
    module = str(item.get("module") or "").strip()
    source_id = module or str(item.get("id") or "").replace("source:", "")
    return {
        "title": f"加固源码隔离扫描项：{module or item.get('file') or source_id}",
        "description": "\n".join(
            [
                f"module: {module}",
                f"file: {item.get('file') or ''}",
                f"storage: {item.get('storage') or ''}",
                f"status: {item.get('status') or ''}",
                f"risk_level: {item.get('risk_level') or ''}",
                "",
                "scope_guard:",
                json.dumps(item.get("scope_guard") or {}, ensure_ascii=False, indent=2),
                "",
                "signals:",
                json.dumps(item.get("signals") or {}, ensure_ascii=False, indent=2),
                "",
                "missing:",
                *[f"- {x}" for x in item.get("missing") or []],
                "",
                "recommendation:",
                str(item.get("recommendation") or ""),
            ]
        ).strip(),
        "priority": priority,
        "estimate": "M" if str(item.get("status")) != "protected" else "S",
        "assigned_to": assigned_to or "SecurityAgent",
        "dev_tool": "codex",
        "source": "system_page_isolation_scan",
        "source_report_id": f"isolation_scan:{source_id}",
        "source_report_title": str(item.get("file") or module or source_id),
        "debug_notes": f"Generated from SystemMap source isolation scan: {source_id}",
    }


def _isolation_scan_compare_task_payload(item: dict[str, Any], *, priority: str, assigned_to: str) -> dict[str, Any]:
    module = str(item.get("module") or item.get("id") or "").strip()
    change = str(item.get("change") or "changed")
    source_id = module or str(item.get("id") or "").strip()
    effective_priority = "P0" if change in {"new_risk", "regressed"} else priority
    return {
        "title": f"处置源码隔离基线差异：{module or source_id}（{change}）",
        "description": "\n".join(
            [
                f"module: {module}",
                f"file: {item.get('file') or ''}",
                f"change: {change}",
                f"before={item.get('before_status') or ''}",
                f"after={item.get('after_status') or ''}",
                f"risk_level: {item.get('risk_level') or ''}",
                "",
                "recommendation:",
                str(item.get("recommendation") or ""),
                "",
                "compare_api: /api/v1/system/pages/isolation-audit/scan/runs/compare",
                "task_cli: sop pages isolation-scan-compare-tasks --dry-run --json",
            ]
        ).strip(),
        "priority": effective_priority,
        "estimate": "M" if change in {"new_risk", "regressed"} else "S",
        "assigned_to": assigned_to or "SecurityAgent",
        "dev_tool": "codex",
        "source": "system_page_isolation_scan_compare",
        "source_report_id": f"isolation_scan_compare:{source_id}:{change}",
        "source_report_title": str(item.get("file") or module or source_id),
        "debug_notes": f"Generated from SystemMap source isolation baseline compare: {source_id}/{change}",
    }


def _governance_task_payloads(*, scope: str, priority: str, assigned_to: str, max_items: int) -> list[dict[str, Any]]:
    react = _enrich_pages(REACT_PAGES)
    legacy = _enrich_pages(LEGACY_PAGES)
    validation = _registry_validation()
    rows: list[dict[str, Any]] = []
    include_all = scope == "all"
    if include_all or scope == "registry_consistency":
        if not validation["ok"]:
            rows.append(
                {
                    "title": "治理页面注册一致性",
                    "description": json.dumps(validation, ensure_ascii=False, indent=2),
                    "priority": priority,
                    "estimate": "S",
                    "assigned_to": assigned_to or "Coder",
                    "dev_tool": "codex",
                    "source": "system_page_governance",
                    "source_report_id": "registry_consistency",
                    "source_report_title": "页面注册一致性治理",
                    "debug_notes": "Generated from SystemMap governance registry consistency check.",
                }
            )
    if include_all or scope == "legacy_convergence":
        for item in _migration_backlog(legacy, limit=max_items):
            payload = _backlog_task_payload(item, priority=priority, assigned_to=assigned_to)
            rows.append(
                {
                    **payload,
                    "source": "system_page_governance",
                    "source_report_id": f"legacy_convergence:{item.get('id')}",
                    "source_report_title": f"Legacy 收敛：{item.get('name')}",
                    "debug_notes": f"Generated from SystemMap governance legacy convergence: {item.get('id')}",
                }
            )
    if include_all or scope == "module_permission_ai":
        rows.append(
            {
                "title": "完善模块权限与 AI 能力治理",
                "description": "\n".join(
                    [
                        "目标: 校验所有 React 模块的 capability、读写管角色、AI surfaces 与模块动作入口。",
                        "交付:",
                        "- 对齐前端 navigation.tsx 与 system/pages capabilities",
                        "- 检查当前角色可见性与 CapabilityGate 使用点",
                        "- 为关键模块补齐 AI 分析、动作审计和审批策略",
                    ]
                ),
                "priority": priority,
                "estimate": "M",
                "assigned_to": assigned_to or "Coder",
                "dev_tool": "codex",
                "source": "system_page_governance",
                "source_report_id": "module_permission_ai",
                "source_report_title": "权限与 AI 能力治理",
                "debug_notes": "Generated from SystemMap governance module_permission_ai.",
            }
        )
    if include_all or scope == "module_maturity":
        improve = sorted(
            [item for item in react if int(item.get("maturity", 0)) < 85],
            key=lambda item: (int(item.get("maturity", 0)), str(item.get("id"))),
        )[:max_items]
        for item in improve:
            next_items = [str(x) for x in item.get("next", [])]
            rows.append(
                {
                    "title": f"提升 React 模块成熟度：{item.get('name')}",
                    "description": "\n".join(
                        [
                            f"module_id: {item.get('id')}",
                            f"path: {item.get('path')}",
                            f"domain: {item.get('domain_name') or item.get('domain')}",
                            f"maturity: {item.get('maturity')}",
                            "",
                            "待增强:",
                            *[f"- {x}" for x in next_items],
                        ]
                    ).strip(),
                    "priority": priority,
                    "estimate": "M",
                    "assigned_to": assigned_to or "Coder",
                    "dev_tool": "codex",
                    "source": "system_page_governance",
                    "source_report_id": f"module_maturity:{item.get('id')}",
                    "source_report_title": str(item.get("name") or item.get("id") or ""),
                    "debug_notes": f"Generated from SystemMap governance module maturity: {item.get('id')}",
                }
            )
    return rows[:max_items] if include_all else rows


def _registry_validation() -> dict[str, Any]:
    react_by_id = {str(item.get("id")): item for item in REACT_PAGES}
    nav_by_id = {str(item.get("id")): item for item in NAV_CONTRACT}
    nav_paths = {str(item.get("path")) for item in NAV_CONTRACT}
    legacy_console_ids = {str(item.get("console_id") or item.get("id")) for item in LEGACY_PAGES}
    missing_nav = sorted(page_id for page_id in react_by_id if page_id not in nav_by_id)
    stale_nav = sorted(page_id for page_id, item in nav_by_id.items() if not item.get("legacy") and page_id not in react_by_id)
    missing_legacy_console = sorted(page_id for page_id in LEGACY_CONSOLE_IDS if page_id not in legacy_console_ids)
    stale_legacy_console = sorted(page_id for page_id in legacy_console_ids if page_id not in LEGACY_CONSOLE_IDS and page_id != "data-exchange")
    domain_mismatches = [
        {
            "id": page_id,
            "page_domain": react_by_id[page_id].get("domain"),
            "nav_domain": nav_by_id[page_id].get("domain"),
        }
        for page_id in sorted(set(react_by_id) & set(nav_by_id))
        if react_by_id[page_id].get("domain") != nav_by_id[page_id].get("domain")
    ]
    broken_legacy_targets = [
        {
            "id": item.get("id"),
            "name": item.get("name"),
            "target": item.get("target"),
        }
        for item in LEGACY_PAGES
        if item.get("target") and item.get("target") not in nav_paths
    ]
    warnings = [
        *missing_nav,
        *stale_nav,
        *missing_legacy_console,
        *stale_legacy_console,
        *domain_mismatches,
        *broken_legacy_targets,
    ]
    score = max(
        0,
        100
        - len(missing_nav) * 20
        - len(stale_nav) * 15
        - len(missing_legacy_console) * 8
        - len(stale_legacy_console) * 4
        - len(domain_mismatches) * 10
        - len(broken_legacy_targets) * 8,
    )
    return {
        "ok": not warnings,
        "score": score,
        "nav_count": len(NAV_CONTRACT),
        "react_count": len(REACT_PAGES),
        "legacy_count": len(LEGACY_PAGES),
        "legacy_console_count": len(LEGACY_CONSOLE_IDS),
        "missing_nav": missing_nav,
        "stale_nav": stale_nav,
        "missing_legacy_console": missing_legacy_console,
        "stale_legacy_console": stale_legacy_console,
        "domain_mismatches": domain_mismatches,
        "broken_legacy_targets": broken_legacy_targets,
    }


def _frontend_i18n_nav_keys(locale: str) -> set[str]:
    path = Path(__file__).resolve().parents[3] / "manager-web" / "src" / "i18n" / f"{locale}.json"
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return set()
    nav = data.get("nav") if isinstance(data, dict) else {}
    if not isinstance(nav, dict):
        return set()
    keys = {str(key) for key in nav.keys()}
    sub = nav.get("sub")
    if isinstance(sub, dict):
        keys.update(f"sub.{key}" for key in sub.keys())
    return keys


def _menu_health_issue(
    *,
    category: str,
    severity: str,
    module_id: str,
    title: str,
    detail: str,
    recommendation: str,
    path: str = "",
    capability: str = "",
) -> dict[str, Any]:
    penalty = {"critical": 15, "high": 10, "medium": 5, "low": 2}.get(severity, 3)
    issue_key = hashlib.sha1(f"{category}:{module_id}:{title}".encode("utf-8")).hexdigest()[:10]
    return {
        "id": f"{category}:{module_id}:{issue_key}",
        "category": category,
        "severity": severity,
        "penalty": penalty,
        "module_id": module_id,
        "path": path,
        "capability": capability,
        "title": title,
        "detail": detail,
        "recommendation": recommendation,
    }


def _menu_health() -> dict[str, Any]:
    react = _enrich_pages(REACT_PAGES)
    registry = _capability_registry(react)
    react_by_id = {str(item.get("id")): item for item in react}
    react_by_path = {str(item.get("path")): item for item in react if item.get("path")}
    nav_by_id = {str(item.get("id")): item for item in NAV_CONTRACT}
    capability_by_id = {str(item.get("id")): item for item in registry}
    zh_nav_keys = _frontend_i18n_nav_keys("zh-CN")
    en_nav_keys = _frontend_i18n_nav_keys("en-US")
    issues: list[dict[str, Any]] = []

    for nav in NAV_CONTRACT:
        module_id = str(nav.get("id") or "")
        path = str(nav.get("path") or "")
        capability = str(nav.get("capability") or "")
        page = react_by_id.get(module_id)
        if not nav.get("legacy") and page is None:
            issues.append(
                _menu_health_issue(
                    category="fake_menu",
                    severity="critical",
                    module_id=module_id,
                    path=path,
                    capability=capability,
                    title="菜单没有对应 React 页面注册",
                    detail=f"{module_id} 存在导航项，但 REACT_PAGES 未注册同名模块。",
                    recommendation="补齐 REACT_PAGES 注册，或将该导航项显式标记为 legacy/hidden 兜底入口。",
                )
            )
        if not capability and not nav.get("legacy"):
            issues.append(
                _menu_health_issue(
                    category="missing_capability",
                    severity="high",
                    module_id=module_id,
                    path=path,
                    title="菜单缺少 capability 能力码",
                    detail=f"{module_id} 无法进入 RBAC/ABAC 与 AI surfaces 治理矩阵。",
                    recommendation="为导航项补齐稳定 capability，建议按 domain.module.submodule 命名。",
                )
            )
        if path and page and str(page.get("path") or "") != path:
            issues.append(
                _menu_health_issue(
                    category="path_mismatch",
                    severity="medium",
                    module_id=module_id,
                    path=path,
                    capability=capability,
                    title="导航路径与页面注册路径不一致",
                    detail=f"nav={path}，page={page.get('path')}",
                    recommendation="统一 navigation.tsx 与 system/pages 的 path，避免 Agent 和用户跳转到不同入口。",
                )
            )
        nav_key = module_id
        if nav_key not in zh_nav_keys or nav_key not in en_nav_keys:
            missing = [locale for locale, keys in (("zh-CN", zh_nav_keys), ("en-US", en_nav_keys)) if nav_key not in keys]
            issues.append(
                _menu_health_issue(
                    category="missing_i18n",
                    severity="medium",
                    module_id=module_id,
                    path=path,
                    capability=capability,
                    title="菜单缺少多语言文案",
                    detail=f"{module_id} 缺少 nav 文案: {', '.join(missing)}。",
                    recommendation="补齐 i18n nav 键，避免菜单搜索、面包屑和页面标题退化为技术 ID。",
                )
            )

    for page in react:
        module_id = str(page.get("id") or "")
        capability_item = capability_by_id.get(module_id)
        capability = str((capability_item or {}).get("capability") or "")
        path = str(page.get("path") or "")
        apis = page.get("apis") or []
        capabilities = page.get("capabilities") or []
        if module_id not in nav_by_id:
            issues.append(
                _menu_health_issue(
                    category="missing_nav",
                    severity="high",
                    module_id=module_id,
                    path=path,
                    capability=capability,
                    title="页面未进入菜单导航契约",
                    detail=f"{module_id} 已注册页面，但 NAV_CONTRACT 缺少对应入口。",
                    recommendation="补齐导航入口或在页面注册中标明 hidden/agent-only 语义。",
                )
            )
        if path not in react_by_path:
            issues.append(
                _menu_health_issue(
                    category="broken_path",
                    severity="medium",
                    module_id=module_id,
                    path=path,
                    capability=capability,
                    title="页面路径不可解析",
                    detail=f"{module_id} path={path} 未进入页面路径索引。",
                    recommendation="检查页面 path 是否为空或重复，确保浏览器、CLI 和 Agent 可直接跳转。",
                )
            )
        if not apis:
            issues.append(
                _menu_health_issue(
                    category="missing_api",
                    severity="medium",
                    module_id=module_id,
                    path=path,
                    capability=capability,
                    title="页面缺少 API 契约",
                    detail=f"{module_id} 没有声明 apis，Agent 无法准确判断后端依赖。",
                    recommendation="在 REACT_PAGES 中补齐该模块实际调用的后端 API 清单。",
                )
            )
        if not capabilities:
            issues.append(
                _menu_health_issue(
                    category="missing_feature",
                    severity="low",
                    module_id=module_id,
                    path=path,
                    capability=capability,
                    title="页面缺少功能能力描述",
                    detail=f"{module_id} 没有声明 capabilities，菜单地图的产品语义不完整。",
                    recommendation="补齐用户可理解的能力短语，帮助权限治理和 AI 任务拆解。",
                )
            )
        ai = (capability_item or {}).get("ai") or {}
        if not ai.get("enabled") or not ai.get("surfaces"):
            issues.append(
                _menu_health_issue(
                    category="missing_ai_surface",
                    severity="high",
                    module_id=module_id,
                    path=path,
                    capability=capability,
                    title="页面缺少 AI 能力面",
                    detail=f"{module_id} 未声明可被 Copilot/CLI/Agent 消费的 AI surfaces。",
                    recommendation="在能力注册中补齐 ai.surfaces 与 prompt_context，确保模块可被 AI 自动增强。",
                )
            )
        for sub in (capability_item or {}).get("submodules") or []:
            sub_id = str(sub.get("id") or "")
            sub_path = str(sub.get("path") or "")
            if sub_id and f"sub.{sub_id}" not in zh_nav_keys and f"sub.{sub_id}" not in en_nav_keys:
                issues.append(
                    _menu_health_issue(
                        category="missing_sub_i18n",
                        severity="low",
                        module_id=f"{module_id}.{sub_id}",
                        path=sub_path,
                        capability=str(sub.get("capability") or capability),
                        title="子菜单缺少多语言文案",
                        detail=f"{module_id}/{sub_id} 缺少 nav.sub 文案。",
                        recommendation="补齐 nav.sub 文案，确保多级菜单、搜索和权限面板展示专业名称。",
                    )
                )
            if not sub_path:
                issues.append(
                    _menu_health_issue(
                        category="missing_sub_path",
                        severity="medium",
                        module_id=f"{module_id}.{sub_id}",
                        path=path,
                        capability=str(sub.get("capability") or capability),
                        title="子菜单缺少独立路径",
                        detail=f"{module_id}/{sub_id} 没有 path，无法作为独立权限与 AI 开发入口。",
                        recommendation="为子菜单补齐可跳转 path，并在前端 focused 页面中承接。",
                    )
                )

    by_category = Counter(str(item["category"]) for item in issues)
    by_severity = Counter(str(item["severity"]) for item in issues)
    total_penalty = (
        min(by_severity.get("critical", 0) * 15, 60)
        + min(by_severity.get("high", 0) * 10, 40)
        + min(by_severity.get("medium", 0) * 5, 30)
        + min(by_severity.get("low", 0) * 2, 20)
    )
    score = max(0, 100 - total_penalty)
    status = "excellent" if score >= 90 else "good" if score >= 75 else "needs_attention" if score >= 55 else "critical"
    top_issues = sorted(issues, key=lambda item: ({"critical": 0, "high": 1, "medium": 2, "low": 3}.get(str(item["severity"]), 4), -int(item.get("penalty") or 0), str(item["module_id"])))
    return {
        "ok": score >= 75 and not by_severity.get("critical"),
        "score": score,
        "status": status,
        "summary": {
            "modules": len(react),
            "nav_items": len(NAV_CONTRACT),
            "issues": len(issues),
            "critical": by_severity.get("critical", 0),
            "high": by_severity.get("high", 0),
            "medium": by_severity.get("medium", 0),
            "low": by_severity.get("low", 0),
            "categories": dict(by_category),
        },
        "issues": top_issues,
        "top_issues": top_issues[:12],
        "checks": [
            {"id": "fake_menu", "name": "假菜单检查", "description": "导航项必须能映射到 React 页面注册或明确 legacy 语义。"},
            {"id": "missing_capability", "name": "能力码检查", "description": "所有模块入口必须具备稳定 capability，支撑权限、审计与 AI surfaces。"},
            {"id": "missing_i18n", "name": "多语言检查", "description": "菜单与子菜单必须具备产品化文案，避免技术 ID 进入界面。"},
            {"id": "missing_api", "name": "API 契约检查", "description": "页面需声明 API 依赖，便于 Agent 自动理解前后端边界。"},
            {"id": "missing_ai_surface", "name": "AI 能力面检查", "description": "模块必须能被 Copilot、CLI、Agent 或 MCP 消费。"},
            {"id": "missing_sub_path", "name": "子菜单路径检查", "description": "可独立授权/开发的子能力需要独立可跳转路径。"},
        ],
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 自动识别菜单治理缺口、生成修复任务、补齐权限和模块文案。",
            "cli": "sop pages health --json",
            "api": "/api/v1/system/pages/health",
            "recommended_next": ["修复 critical/high 问题", "补齐 i18n 和 API 契约", "为高价值子模块补齐独立 path"],
        },
    }


def _readiness_dimension(status: str, score: int, detail: str) -> dict[str, Any]:
    return {
        "status": status,
        "score": max(0, min(int(score), 100)),
        "detail": detail,
    }


def _readiness_status(score: float) -> str:
    if score >= 90:
        return "complete"
    if score >= 75:
        return "watch"
    return "risk"


def _module_readiness_matrix() -> list[dict[str, Any]]:
    react = _enrich_pages(REACT_PAGES)
    registry = {str(item.get("id")): item for item in _capability_registry(react)}
    nav_by_id = {str(item.get("id")): item for item in NAV_CONTRACT}
    menu_issues = _menu_health().get("issues") or []
    issues_by_module: dict[str, list[dict[str, Any]]] = {}
    for issue in menu_issues:
        module_id = str(issue.get("module_id") or "").split(".", 1)[0]
        if module_id:
            issues_by_module.setdefault(module_id, []).append(issue)
    rows: list[dict[str, Any]] = []
    for page in react:
        module_id = str(page.get("id") or "")
        nav = nav_by_id.get(module_id) or {}
        capability_item = registry.get(module_id) or {}
        apis = [str(item) for item in page.get("apis") or [] if str(item).strip()]
        capabilities = [str(item) for item in page.get("capabilities") or [] if str(item).strip()]
        ai_surfaces = [str(item) for item in (capability_item.get("ai") or {}).get("surfaces") or [] if str(item).strip()]
        submodules = capability_item.get("submodules") or []
        module_issues = issues_by_module.get(module_id, [])
        high_issues = [item for item in module_issues if item.get("severity") in {"critical", "high"}]
        maturity = max(0, min(int(page.get("maturity") or 0), 100))
        frontend_score = 100 if nav and page.get("path") else 70 if page.get("path") else 35
        backend_score = 100 if len(apis) >= 2 else 85 if len(apis) == 1 else 35
        ai_score = 100 if ai_surfaces else 45
        governance_score = 100
        if not capability_item.get("capability"):
            governance_score -= 35
        if high_issues:
            governance_score -= min(len(high_issues) * 12, 45)
        if not submodules:
            governance_score -= 8
        product_score = maturity
        dimensions = {
            "frontend": _readiness_dimension("complete" if frontend_score >= 90 else "watch" if frontend_score >= 75 else "risk", frontend_score, "前端路由与菜单契约" if nav else "缺少菜单导航契约"),
            "backend": _readiness_dimension("complete" if backend_score >= 90 else "watch" if backend_score >= 75 else "risk", backend_score, f"声明 {len(apis)} 个后端 API 契约"),
            "ai": _readiness_dimension("complete" if ai_score >= 90 else "risk", ai_score, "已接入 AI surfaces" if ai_surfaces else "缺少 Copilot/CLI/Agent 可消费入口"),
            "governance": _readiness_dimension("complete" if governance_score >= 90 else "watch" if governance_score >= 75 else "risk", governance_score, f"能力码、权限与菜单健康问题 {len(module_issues)} 个"),
            "product": _readiness_dimension("complete" if product_score >= 90 else "watch" if product_score >= 75 else "risk", product_score, "基于模块成熟度和 next 建议"),
        }
        readiness_score = round(
            dimensions["frontend"]["score"] * 0.18
            + dimensions["backend"]["score"] * 0.24
            + dimensions["ai"]["score"] * 0.18
            + dimensions["governance"]["score"] * 0.2
            + dimensions["product"]["score"] * 0.2,
            1,
        )
        gaps: list[dict[str, Any]] = []
        for key, value in dimensions.items():
            if int(value["score"]) < 90:
                gaps.append({"dimension": key, "score": value["score"], "detail": value["detail"]})
        for issue in module_issues[:4]:
            gaps.append(
                {
                    "dimension": "menu_health",
                    "score": max(0, 100 - int(issue.get("penalty") or 0) * 5),
                    "detail": issue.get("title") or issue.get("category") or "菜单健康问题",
                    "severity": issue.get("severity"),
                }
            )
        next_actions = [str(item) for item in page.get("next") or [] if str(item).strip()]
        if not apis:
            next_actions.append("补齐后端 API 契约与前端调用封装")
        if not ai_surfaces:
            next_actions.append("补齐 Copilot、CLI 或 Agent 消费入口")
        if high_issues:
            next_actions.append("优先修复菜单、能力码或权限高风险问题")
        rows.append(
            {
                "id": module_id,
                "name": page.get("name") or module_id,
                "domain": page.get("effective_domain") or page.get("domain"),
                "domain_name": page.get("domain_name") or page.get("domain"),
                "path": page.get("path") or "",
                "status": _readiness_status(readiness_score),
                "readiness_score": readiness_score,
                "maturity": maturity,
                "capabilities": capabilities,
                "dimensions": dimensions,
                "gaps": gaps[:8],
                "next_actions": next_actions[:8],
                "implementation_contract": {
                    "route": page.get("path") or "",
                    "api_count": len(apis),
                    "apis": apis,
                    "capability": capability_item.get("capability") or nav.get("capability") or page.get("capability_key") or "",
                    "ai_surfaces": ai_surfaces,
                    "submodule_count": len(submodules),
                    "action_count": int(capability_item.get("action_count") or 0),
                },
            }
        )
    return sorted(rows, key=lambda item: ({"risk": 0, "watch": 1, "complete": 2}.get(str(item["status"]), 3), float(item["readiness_score"]), str(item["id"])))


def _module_readiness_payload(*, domain: str | None = None, status: str | None = None, q: str | None = None) -> dict[str, Any]:
    query = (q or "").strip().lower()
    rows = []
    for item in _module_readiness_matrix():
        if domain and domain != "all" and item.get("domain") != domain:
            continue
        if status and status != "all" and item.get("status") != status:
            continue
        if query:
            haystack = " ".join(
                [
                    str(item.get("id") or ""),
                    str(item.get("name") or ""),
                    str(item.get("domain") or ""),
                    " ".join(str(x) for x in item.get("capabilities") or []),
                    " ".join(str(x) for x in item.get("next_actions") or []),
                ]
            ).lower()
            if query not in haystack:
                continue
        rows.append(item)
    by_status = Counter(str(item.get("status")) for item in rows)
    domain_summary: dict[str, dict[str, Any]] = {}
    for item in rows:
        domain_id = str(item.get("domain") or "unknown")
        bucket = domain_summary.setdefault(
            domain_id,
            {
                "domain": domain_id,
                "domain_name": item.get("domain_name") or domain_id,
                "total": 0,
                "complete": 0,
                "watch": 0,
                "risk": 0,
                "avg_score": 0,
            },
        )
        bucket["total"] += 1
        bucket[str(item.get("status"))] = int(bucket.get(str(item.get("status")), 0)) + 1
        bucket["avg_score"] += float(item.get("readiness_score") or 0)
    for bucket in domain_summary.values():
        bucket["avg_score"] = round(float(bucket["avg_score"]) / max(1, int(bucket["total"])), 1)
    avg_score = round(sum(float(item.get("readiness_score") or 0) for item in rows) / max(1, len(rows)), 1)
    return {
        "ok": True,
        "items": rows,
        "summary": {
            "total": len(rows),
            "avg_score": avg_score,
            "complete": by_status.get("complete", 0),
            "watch": by_status.get("watch", 0),
            "risk": by_status.get("risk", 0),
        },
        "domain_summary": sorted(domain_summary.values(), key=lambda item: (float(item["avg_score"]), str(item["domain"]))),
        "filters": {"domain": domain or "all", "status": status or "all", "q": q or ""},
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 判断每个模块是否前后端完整、是否具备 API/权限/AI surface，并据此生成增强任务。",
            "api": "/api/v1/system/pages/readiness",
            "task_api": "/api/v1/system/pages/readiness/tasks",
            "recommended_next": ["优先处理 risk 模块", "为 watch 模块补 API 契约与 AI surfaces", "把 gaps 转成 SystemMap 治理任务"],
            "fields": ["items.id", "items.readiness_score", "items.dimensions", "items.gaps", "items.implementation_contract"],
        },
    }


def _production_dimension(status: str, score: int, detail: str, evidence: list[str], recommendation: str = "") -> dict[str, Any]:
    return {
        "status": status,
        "score": max(0, min(int(score), 100)),
        "detail": detail,
        "evidence": [item for item in evidence if item][:6],
        "recommendation": recommendation,
    }


def _production_status(score: float) -> str:
    if score >= 85:
        return "ready"
    if score >= 70:
        return "partial"
    return "gap"


def _contains_any(text: str, words: tuple[str, ...]) -> bool:
    lower = text.lower()
    return any(word.lower() in lower for word in words)


def _production_readiness_matrix() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in _module_readiness_matrix():
        contract = item.get("implementation_contract") or {}
        api_count = int(contract.get("api_count") or 0)
        action_count = int(contract.get("action_count") or 0)
        ai_surface_count = len(contract.get("ai_surfaces") or [])
        maturity = int(item.get("maturity") or 0)
        readiness_score = float(item.get("readiness_score") or 0)
        blob = " ".join(
            [
                str(item.get("id") or ""),
                str(item.get("name") or ""),
                str(item.get("domain") or ""),
                " ".join(str(x) for x in item.get("capabilities") or []),
                " ".join(str(x) for x in item.get("next_actions") or []),
                " ".join(str(x) for x in contract.get("apis") or []),
            ]
        )

        runtime_score = 92 if api_count >= 3 and maturity >= 88 else 78 if api_count >= 1 else 42
        runtime_data = _production_dimension(
            _production_status(runtime_score),
            runtime_score,
            f"声明 {api_count} 个 API 契约，模块成熟度 {maturity}",
            [f"api_count={api_count}", f"maturity={maturity}", f"readiness_score={readiness_score}"],
            "" if runtime_score >= 85 else "补真实运行摘要、分页检索、空/错/加载态和端到端 smoke 证据。",
        )

        external_required = _contains_any(
            blob,
            (
                "connection",
                "connector",
                "provider",
                "secretref",
                "sso",
                "mcp",
                "a2a",
                "webhook",
                "notify",
                "billing",
                "payment",
                "db-config",
                "llm",
                "data-ingest",
            ),
        )
        external_score = 90 if not external_required else 86 if _contains_any(blob, ("secretref", "test", "health", "audit", "config")) else 58
        external_connections = _production_dimension(
            "not_required" if not external_required else _production_status(external_score),
            external_score,
            "无需外部连接配置" if not external_required else "依赖外部连接、Provider 或企业集成，需要配置、测试和密钥托管证据",
            ["external_required=true" if external_required else "external_required=false"],
            "" if external_score >= 85 else "接入 SecretRef、连接测试、连通性审计和失败重试证据。",
        )

        async_required = _contains_any(
            blob,
            (
                "worker",
                "scheduler",
                "workflow",
                "job",
                "runs",
                "agent",
                "queue",
                "cdc",
                "ingest",
                "quality",
                "report-subscription",
            ),
        )
        async_score = 90 if not async_required else 84 if _contains_any(blob, ("scheduler", "runs", "lease", "heartbeat", "workflow", "job")) else 62
        async_worker = _production_dimension(
            "not_required" if not async_required else _production_status(async_score),
            async_score,
            "同步页面，无异步执行底座要求" if not async_required else "存在异步执行、任务调度或 Agent 运行要求",
            ["async_required=true" if async_required else "async_required=false"],
            "" if async_score >= 85 else "补 Worker 健康、幂等键、失败重试、DLQ 和状态回写。",
        )

        coverage_score = 86 if readiness_score >= 90 and api_count >= 2 else 74 if readiness_score >= 75 else 45
        test_coverage = _production_dimension(
            _production_status(coverage_score),
            coverage_score,
            "基于模块契约、API 覆盖和现有路由测试的生产化测试证据",
            [f"contract_status={item.get('status')}", f"apis={api_count}"],
            "" if coverage_score >= 85 else "补 focused route、表单校验、空/错/加载态、跨 scope 和 TestClient smoke。",
        )

        deploy_score = 82 if maturity >= 90 else 74 if maturity >= 82 else 56
        deployment_evidence = _production_dimension(
            _production_status(deploy_score),
            deploy_score,
            "前端构建、模块注册和发布流水证据的完整度",
            [f"route={contract.get('route') or ''}", f"maturity={maturity}"],
            "" if deploy_score >= 85 else "补可部署 profile、发布包、回滚脚本和部署 smoke 记录。",
        )

        observability_score = 88 if _contains_any(blob, ("summary", "health", "timeline", "audit", "trace", "metrics")) else 72 if api_count >= 2 else 55
        observability = _production_dimension(
            _production_status(observability_score),
            observability_score,
            "运行监控、审计、trace/correlation id 与指标摘要信号",
            [f"ai_surfaces={ai_surface_count}", f"api_count={api_count}"],
            "" if observability_score >= 85 else "补 summary/health、trace_id、correlation_id、错误预算和仪表盘入口。",
        )

        policy_score = 90 if contract.get("capability") and action_count > 0 else 82 if contract.get("capability") else 52
        permission_policy = _production_dimension(
            _production_status(policy_score),
            policy_score,
            "能力码、权限策略和可审计动作覆盖状态",
            [f"capability={contract.get('capability') or ''}", f"action_count={action_count}"],
            "" if policy_score >= 85 else "补字段级权限、动作审批、拒绝审计和 SystemMap 能力策略注册。",
        )

        dimensions = {
            "runtime_data": runtime_data,
            "external_connections": external_connections,
            "async_worker": async_worker,
            "test_coverage": test_coverage,
            "deployment_evidence": deployment_evidence,
            "observability": observability,
            "permission_policy": permission_policy,
        }
        production_score = round(
            runtime_data["score"] * 0.18
            + external_connections["score"] * 0.12
            + async_worker["score"] * 0.14
            + test_coverage["score"] * 0.16
            + deployment_evidence["score"] * 0.12
            + observability["score"] * 0.14
            + permission_policy["score"] * 0.14,
            1,
        )
        contract_complete = readiness_score >= 90
        runtime_ready = runtime_data["score"] >= 75 and observability["score"] >= 70 and permission_policy["score"] >= 75
        production_ready = contract_complete and production_score >= 85 and all(
            value["status"] in {"ready", "not_required"} for value in dimensions.values()
        )
        stage = "production_ready" if production_ready else "runtime_ready" if runtime_ready else "contract_complete" if contract_complete else "gap"
        recommendations = [
            value["recommendation"]
            for value in dimensions.values()
            if value.get("recommendation")
        ][:8]
        rows.append(
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "domain": item.get("domain"),
                "domain_name": item.get("domain_name"),
                "path": item.get("path"),
                "contract_complete": contract_complete,
                "runtime_ready": runtime_ready,
                "production_ready": production_ready,
                "stage": stage,
                "readiness_score": readiness_score,
                "production_score": production_score,
                "dimensions": dimensions,
                "recommendations": recommendations,
                "implementation_contract": contract,
            }
        )
    order = {"gap": 0, "contract_complete": 1, "runtime_ready": 2, "production_ready": 3}
    return sorted(rows, key=lambda row: (order.get(str(row.get("stage")), 0), float(row.get("production_score") or 0), str(row.get("id"))))


def _module_production_readiness_payload(*, domain: str | None = None, stage: str | None = None, q: str | None = None) -> dict[str, Any]:
    query = (q or "").strip().lower()
    rows = []
    for item in _production_readiness_matrix():
        if domain and domain != "all" and item.get("domain") != domain:
            continue
        if stage and stage != "all" and item.get("stage") != stage:
            continue
        if query:
            haystack = " ".join(
                [
                    str(item.get("id") or ""),
                    str(item.get("name") or ""),
                    str(item.get("domain") or ""),
                    " ".join(str(x) for x in item.get("recommendations") or []),
                ]
            ).lower()
            if query not in haystack:
                continue
        rows.append(item)
    by_stage = Counter(str(item.get("stage") or "gap") for item in rows)
    avg_score = round(sum(float(item.get("production_score") or 0) for item in rows) / max(1, len(rows)), 1)
    return {
        "ok": True,
        "items": rows,
        "summary": {
            "total": len(rows),
            "avg_production_score": avg_score,
            "contract_complete": sum(1 for item in rows if item.get("contract_complete")),
            "runtime_ready": sum(1 for item in rows if item.get("runtime_ready")),
            "production_ready": sum(1 for item in rows if item.get("production_ready")),
            "gap": by_stage.get("gap", 0),
            "by_stage": dict(by_stage),
        },
        "filters": {"domain": domain or "all", "stage": stage or "all", "q": q or ""},
        "agent_consumption": {
            "purpose": "供 SystemMap、CLI 和 Agent 区分契约完整、运行可用和生产就绪，避免页面 complete 掩盖真实生产缺口。",
            "api": "/api/v1/system/pages/production-readiness",
            "task_api": "/api/v1/system/pages/readiness/tasks",
            "recommended_next": ["先补 runtime_ready 的关键证据", "把 production gap 转为治理任务", "按外部连接和异步执行要求补 smoke"],
            "fields": ["items.contract_complete", "items.runtime_ready", "items.production_ready", "items.dimensions"],
        },
    }


def _experience_status(score: float) -> str:
    if score >= 86:
        return "simple"
    if score >= 72:
        return "watch"
    return "complex"


def _experience_dimension(score: int, detail: str, recommendation: str = "") -> dict[str, Any]:
    score = max(0, min(int(score), 100))
    return {
        "score": score,
        "status": _experience_status(score),
        "detail": detail,
        "recommendation": recommendation,
    }


def _module_experience_review_matrix() -> list[dict[str, Any]]:
    production_by_id = {str(item.get("id")): item for item in _production_readiness_matrix()}
    rows: list[dict[str, Any]] = []
    for item in _module_readiness_matrix():
        contract = item.get("implementation_contract") or {}
        api_count = int(contract.get("api_count") or 0)
        action_count = int(contract.get("action_count") or 0)
        submodule_count = int(contract.get("submodule_count") or 0)
        module_units = max(1, submodule_count)
        api_density = (api_count + module_units - 1) // module_units
        action_density = (action_count + module_units - 1) // module_units
        ai_surface_count = len(contract.get("ai_surfaces") or [])
        maturity = int(item.get("maturity") or 0)
        next_actions = [str(x) for x in item.get("next_actions") or [] if str(x).strip()]
        production = production_by_id.get(str(item.get("id"))) or {}
        production_score = float(production.get("production_score") or 0)

        complexity_penalty = min(api_density * 3 + action_density * 2 + submodule_count * 2 + len(next_actions) * 2, 65)
        maturity_bonus = 8 if maturity >= 90 else 3 if maturity >= 80 else 0
        simplicity_score = max(35, min(100, 100 - complexity_penalty + maturity_bonus))
        if api_density <= 5 and action_density <= 6 and submodule_count <= 8:
            simplicity_score = min(100, simplicity_score + 8)
        simplicity_recommendation = ""
        if simplicity_score < 86:
            simplicity_recommendation = (
                "补齐专业子路由或模块契约，把低频操作从首屏拆出去。"
                if submodule_count <= 1 and api_count > 8
                else "继续收敛首屏，只保留当前子模块的高频操作。"
            )
        simplicity = _experience_dimension(
            simplicity_score,
            f"{api_count} API / {action_count} 动作 / {submodule_count} 子能力；密度 {api_density} API/{action_density} 动作",
            simplicity_recommendation,
        )

        responsive_score = 92
        if api_density > 8 or action_density > 10:
            responsive_score -= 18
        if submodule_count > 8:
            responsive_score -= 6
        if item.get("status") != "complete":
            responsive_score -= 6
        responsive = _experience_dimension(
            responsive_score,
            "桌面表格 + 移动端卡片/横向滚动的响应式要求",
            "" if responsive_score >= 86 else "为宽表格补横向滚动、移动卡片和底部高频操作区。",
        )

        component_score = 88 if api_count >= 1 else 55
        if action_count >= 1:
            component_score += 6
        if api_density > 10:
            component_score -= 10
        componentization = _experience_dimension(
            component_score,
            "优先使用 Ant Design Form/Table/Drawer/Steps/Segmented 等成熟组件",
            "" if component_score >= 86 else "把原生输入、JSON pre 和手填 ID 收敛成表单、抽屉和步骤式确认。",
        )

        permission_score = 92 if contract.get("capability") and action_count > 0 else 78 if contract.get("capability") else 45
        permission = _experience_dimension(
            permission_score,
            "能力码、动作权限、审批与拒绝审计的页面落点",
            "" if permission_score >= 86 else "补按钮级能力码、字段级可见性和动作审批证据。",
        )

        ai_score = 94 if ai_surface_count >= 2 else 84 if ai_surface_count == 1 else 58
        if api_count >= 2:
            ai_score = min(100, ai_score + 4)
        ai_editability = _experience_dimension(
            ai_score,
            f"{ai_surface_count} 个 AI surface，{api_count} 个可调用 API",
            "" if ai_score >= 86 else "补 Copilot/CLI/Agent 消费字段，输出稳定 source_report_id 和 task_api。",
        )

        commercial_score = 88 if production_score >= 80 and permission_score >= 86 else 74 if production_score >= 70 else 58
        commercialization = _experience_dimension(
            commercial_score,
            "面向套餐、配额、审计、运维和客户成功的专业化管理能力",
            "" if commercial_score >= 86 else "补套餐/配额/审计口径和客户可解释的运营指标。",
        )

        dimensions = {
            "simplicity": simplicity,
            "responsive": responsive,
            "componentization": componentization,
            "permission": permission,
            "ai_editability": ai_editability,
            "commercialization": commercialization,
        }
        experience_score = round(
            simplicity["score"] * 0.22
            + responsive["score"] * 0.18
            + componentization["score"] * 0.16
            + permission["score"] * 0.16
            + ai_editability["score"] * 0.16
            + commercialization["score"] * 0.12,
            1,
        )
        recommendations = [value["recommendation"] for value in dimensions.values() if value.get("recommendation")]
        if not recommendations:
            recommendations = ["保持当前模块化结构，继续以成熟组件和权限策略增量增强。"]
        ui_contract = {
            "preferred_components": ["Segmented", "Table", "Form", "Drawer", "Steps", "Tag"],
            "layout": "summary-left + focused-detail-right + responsive-table",
            "mobile_rule": "宽表格横向滚动；复杂工作流进入抽屉；固定操作区只保留高频动作。",
            "permission_rule": "所有写操作绑定 capability/action，禁用态展示拒绝原因。",
            "ai_rule": "接口返回 fields/task_api/source_report_id，便于 Agent 安全改造。",
        }
        rows.append(
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "domain": item.get("domain"),
                "domain_name": item.get("domain_name"),
                "path": item.get("path"),
                "status": _experience_status(experience_score),
                "experience_score": experience_score,
                "maturity": maturity,
                "dimensions": dimensions,
                "recommendations": recommendations[:8],
                "ui_contract": ui_contract,
                "implementation_contract": contract,
            }
        )
    order = {"complex": 0, "watch": 1, "simple": 2}
    return sorted(rows, key=lambda row: (order.get(str(row.get("status")), 0), float(row.get("experience_score") or 0), str(row.get("id"))))


def _module_experience_review_payload(*, domain: str | None = None, status: str | None = None, q: str | None = None) -> dict[str, Any]:
    query = (q or "").strip().lower()
    rows = []
    for item in _module_experience_review_matrix():
        if domain and domain != "all" and item.get("domain") != domain:
            continue
        if status and status != "all" and item.get("status") != status:
            continue
        if query:
            haystack = " ".join(
                [
                    str(item.get("id") or ""),
                    str(item.get("name") or ""),
                    str(item.get("domain") or ""),
                    " ".join(str(x) for x in item.get("recommendations") or []),
                    " ".join(str(x) for x in (item.get("implementation_contract") or {}).get("apis") or []),
                ]
            ).lower()
            if query not in haystack:
                continue
        rows.append(item)
    by_status = Counter(str(item.get("status") or "complex") for item in rows)
    avg_score = round(sum(float(item.get("experience_score") or 0) for item in rows) / max(1, len(rows)), 1)
    domain_summary: dict[str, dict[str, Any]] = {}
    for item in rows:
        domain_id = str(item.get("domain") or "unknown")
        bucket = domain_summary.setdefault(
            domain_id,
            {
                "domain": domain_id,
                "domain_name": item.get("domain_name") or domain_id,
                "total": 0,
                "simple": 0,
                "watch": 0,
                "complex": 0,
                "avg_score": 0,
            },
        )
        bucket["total"] += 1
        bucket[str(item.get("status") or "complex")] = int(bucket.get(str(item.get("status") or "complex"), 0)) + 1
        bucket["avg_score"] += float(item.get("experience_score") or 0)
    for bucket in domain_summary.values():
        bucket["avg_score"] = round(float(bucket["avg_score"]) / max(1, int(bucket["total"])), 1)
    return {
        "ok": True,
        "items": rows,
        "summary": {
            "total": len(rows),
            "avg_experience_score": avg_score,
            "simple": by_status.get("simple", 0),
            "watch": by_status.get("watch", 0),
            "complex": by_status.get("complex", 0),
            "needs_simplification": by_status.get("watch", 0) + by_status.get("complex", 0),
            "mobile_risk": sum(1 for item in rows if int((item.get("dimensions") or {}).get("responsive", {}).get("score") or 0) < 86),
            "permission_gap": sum(1 for item in rows if int((item.get("dimensions") or {}).get("permission", {}).get("score") or 0) < 86),
            "ai_edit_gap": sum(1 for item in rows if int((item.get("dimensions") or {}).get("ai_editability", {}).get("score") or 0) < 86),
            "by_status": dict(by_status),
        },
        "domain_summary": sorted(domain_summary.values(), key=lambda item: (float(item["avg_score"]), str(item["domain"]))),
        "filters": {"domain": domain or "all", "status": status or "all", "q": q or ""},
        "agent_consumption": {
            "purpose": "供 SystemMap、产品经理和 AI Agent 评估菜单分类、页面复杂度、响应式、权限与 AI 可改造性，优先把复杂页面拆成清晰模块。",
            "api": "/api/v1/system/pages/experience-review",
            "task_api": "/api/v1/system/pages/experience-review/tasks",
            "recommended_next": ["先拆 complex 页面", "为 watch 页面补移动端表格/卡片和成熟表单组件", "把权限与 AI gap 写入治理任务"],
            "fields": ["items.experience_score", "items.dimensions", "items.recommendations", "items.ui_contract", "items.implementation_contract"],
        },
    }


def _isolation_audit_payload() -> dict[str, Any]:
    domains = [
        {
            "id": "tasks_sql",
            "name": "任务执行与调度",
            "module": "tasks",
            "storage": "sql_adapter",
            "scope_fields": ["tenant_id", "tenant_code", "business_code", "project_id", "project_code"],
            "read_protected": True,
            "write_protected": True,
            "guard": "db_sql_compat._base_q + resolved request scope",
            "tests": ["Task SQL adapter filters tenant_id/project_id; business code is bound by project scope middleware."],
            "status": "protected",
        },
        {
            "id": "requirements_sql",
            "name": "需求工作台",
            "module": "requirements",
            "storage": "sql_adapter",
            "scope_fields": ["tenant_id", "tenant_code", "business_code", "project_id", "project_code"],
            "read_protected": True,
            "write_protected": True,
            "guard": "db_sql_compat._base_q + resolved request scope",
            "tests": ["Requirement SQL adapter filters tenant_id/project_id; business code is bound by project scope middleware."],
            "status": "protected",
        },
        {
            "id": "analytics_reports",
            "name": "智能报表与归因分析",
            "module": "analytics",
            "storage": "jsonl",
            "scope_fields": ["tenant_id", "tenant_code", "business_code", "project_id", "project_code"],
            "read_protected": True,
            "write_protected": True,
            "guard": "scope_guard.attach_scope + scope_guard.scope_matches",
            "tests": ["test_analytics_reports_do_not_cross_business_scope", "test_analytics_report_write_rejects_cross_business_scope"],
            "status": "protected",
        },
        {
            "id": "notify_messages",
            "name": "IM/Notify 消息流水",
            "module": "notify",
            "storage": "jsonl",
            "scope_fields": ["tenant_code", "business_code", "project_id", "project_code"],
            "read_protected": True,
            "write_protected": True,
            "guard": "scope_guard.attach_scope + scope_guard.scope_matches",
            "tests": ["test_notify_messages_do_not_cross_project_scope", "test_notify_inbound_action_rejects_cross_project_scope"],
            "status": "protected",
        },
        {
            "id": "agent_runs",
            "name": "Agent 运行中心",
            "module": "tasks/agents",
            "storage": "json/jsonl",
            "scope_fields": ["tenant_id", "tenant_code", "business_code", "project_id", "project_code"],
            "read_protected": True,
            "write_protected": True,
            "guard": "scope_guard.attach_scope + scope_guard.scope_matches",
            "tests": ["test_agent_claims_and_reports_do_not_cross_business_scope", "test_agent_runs_do_not_cross_business_scope", "test_agent_heartbeat_rejects_cross_business_claim"],
            "status": "protected",
        },
        {
            "id": "ops_records",
            "name": "OpsCenter 运行记录",
            "module": "ops_center",
            "storage": "json",
            "scope_fields": ["tenant_id", "tenant_code", "business_code", "project_id", "project_code"],
            "read_protected": True,
            "write_protected": True,
            "guard": "scope_guard.attach_scope + scope_guard.scope_matches",
            "tests": ["test_ops_center_records_do_not_cross_project_scope", "test_ops_center_write_rejects_cross_project_scope"],
            "status": "protected",
        },
        {
            "id": "data_governance_records",
            "name": "数据治理与数据开发记录",
            "module": "data_analytics",
            "storage": "json",
            "scope_fields": ["tenant_id", "tenant_code", "business_code", "project_id", "project_code"],
            "read_protected": True,
            "write_protected": True,
            "guard": "scoped data-governance store + scope_guard.attach_scope",
            "tests": ["test_data_governance_records_do_not_cross_business_scope", "test_data_development_templates_do_not_cross_project_scope"],
            "status": "protected",
        },
        {
            "id": "usage_and_billing_ledgers",
            "name": "用量与计费流水",
            "module": "usage/billing",
            "storage": "json/jsonl",
            "scope_fields": ["tenant_id", "tenant_code", "business_code", "project_id", "project_code"],
            "read_protected": True,
            "write_protected": True,
            "guard": "usage scoped file key + billing scope_guard.attach_scope/scope_guard.scope_matches",
            "tests": ["test_usage_ledger_does_not_cross_business_scope", "test_billing_invoices_do_not_cross_business_scope", "test_billing_payment_rejects_cross_project_invoice"],
            "status": "protected",
        },
    ]
    watch: list[dict[str, Any]] = []
    protected = sum(1 for item in domains if item["read_protected"] and item["write_protected"])
    score = round((protected / max(1, len(domains))) * 100)
    source_scan = _isolation_source_scan_payload()
    return {
        "ok": True,
        "summary": {
            "score": score,
            "protected": protected,
            "domains": len(domains),
            "watch": len(watch),
            "high_risk": 0,
            "guard": "scope_guard",
        },
        "domains": domains,
        "watch": watch,
        "source_scan_summary": source_scan["summary"],
        "scope_contract": {
            "required_headers": ["X-Tenant-Code", "X-Business-Code", "X-Project-Id", "X-Project-Code"],
            "required_row_fields": ["tenant_id", "tenant_code", "business_code", "project_id", "project_code"],
            "write_rule": "所有文件型写入必须 attach_scope，缺失三码视为不可跨 scope 读取。",
            "read_rule": "所有文件型读取、查找、更新、删除必须 scope_matches 当前请求作用域。",
        },
        "agent_consumption": {
            "purpose": "供 AI CLI/Agent 判断核心领域是否具备 tenant_code/business_code/project_id 隔离，以及下一步应加固哪些文件型存储。",
            "api": "/api/v1/system/pages/isolation-audit",
            "task_api": "/api/v1/system/pages/isolation-audit/tasks",
            "scan_api": "/api/v1/system/pages/isolation-audit/scan",
            "cli": "sop pages isolation --json",
            "task_cli": "sop pages isolation-tasks --dry-run --json",
            "scan_cli": "sop pages isolation-scan --json",
            "recommended_next": ["新增文件型 store 必须先接入 scope_guard 回归测试", "将 scope_guard 纳入代码审查清单", "持续在 SystemMap 审计矩阵中暴露 protected/watch 状态"],
        },
    }


ISOLATION_SCAN_SCOPE_FIELDS = ["tenant_id", "tenant_code", "business_code", "project_id", "project_code"]
ISOLATION_SCAN_STORAGE_MARKERS = {
    "jsonl": [".jsonl", "splitlines()", "append_event"],
    "json": ["json.loads", "json.dumps", ".json", "read_text", "write_text"],
    "sql": ["sql_adapter", "select(", "insert(", "update(", "delete("],
}


def _storage_signals(source: str) -> list[str]:
    signals: list[str] = []
    for storage, markers in ISOLATION_SCAN_STORAGE_MARKERS.items():
        if any(marker in source for marker in markers):
            signals.append(storage)
    return signals


def _source_scan_status(*, file_backed: bool, attach_scope: bool, scope_matches: bool, scope_fields: list[str]) -> str:
    if file_backed and attach_scope and scope_matches and {"tenant_code", "business_code", "project_id"} <= set(scope_fields):
        return "protected"
    if file_backed and (not attach_scope) and (not scope_matches):
        return "risk"
    if file_backed:
        return "watch"
    if attach_scope and scope_matches:
        return "protected"
    return "watch"


def _isolation_source_scan_payload(q: str = "", status: str = "all") -> dict[str, Any]:
    router_dir = Path(__file__).parent
    scanned_files = 0
    items: list[dict[str, Any]] = []
    for path in sorted(router_dir.glob("*.py")):
        name = path.name
        if name.startswith("test_") or name in {"__init__.py", "sql_models.py"}:
            continue
        scanned_files += 1
        try:
            source = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            source = path.read_text(errors="ignore")
        storage = _storage_signals(source)
        scope_fields = [field for field in ISOLATION_SCAN_SCOPE_FIELDS if field in source]
        attach_scope = "attach_scope(" in source or "scope_guard.attach_scope" in source
        scope_matches = "scope_matches(" in source or "scope_guard.scope_matches" in source
        current_scope = any(marker in source for marker in ("resolved_tenant_code", "resolved_business_code", "resolved_project_id", "current_scope", "request_scope"))
        file_backed = bool({"json", "jsonl"} & set(storage)) or "resolved_ai_memory_root" in source
        if not (file_backed or attach_scope or scope_matches or len(scope_fields) >= 2):
            continue
        item_status = _source_scan_status(
            file_backed=file_backed,
            attach_scope=attach_scope,
            scope_matches=scope_matches,
            scope_fields=scope_fields,
        )
        missing: list[str] = []
        if file_backed and not attach_scope:
            missing.append("attach_scope")
        if file_backed and not scope_matches:
            missing.append("scope_matches")
        for field in ("tenant_code", "business_code", "project_id"):
            if field not in scope_fields:
                missing.append(field)
        risk_level = "high" if item_status == "risk" else "medium" if item_status == "watch" else "low"
        module = path.stem
        recommendation = (
            "已检测到 attach_scope + scope_matches，可纳入持续回归扫描。"
            if item_status == "protected"
            else f"补齐 {', '.join(missing[:4])}，并增加跨 tenant/business/project 读取与写入回归测试。"
        )
        items.append(
            {
                "id": f"source:{module}",
                "module": module,
                "file": str(path.relative_to(router_dir.parent.parent)),
                "storage": "+".join(storage) if storage else "scope",
                "status": item_status,
                "risk_level": risk_level,
                "scope_guard": {
                    "attach_scope": attach_scope,
                    "scope_matches": scope_matches,
                    "current_scope": current_scope,
                    "resolved_scope": any(marker in source for marker in ("resolved_tenant_code", "resolved_business_code", "resolved_project_id")),
                },
                "signals": {
                    "storage": storage,
                    "scope_fields": scope_fields,
                    "file_backed": file_backed,
                },
                "missing": missing,
                "recommendation": recommendation,
            }
        )

    query = (q or "").strip().lower()
    if query:
        items = [
            item
            for item in items
            if query
            in " ".join(
                [
                    str(item.get("id") or ""),
                    str(item.get("module") or ""),
                    str(item.get("file") or ""),
                    str(item.get("storage") or ""),
                    str(item.get("recommendation") or ""),
                    " ".join(str(x) for x in (item.get("signals") or {}).get("scope_fields") or []),
                    " ".join(str(x) for x in item.get("missing") or []),
                ]
            ).lower()
        ]
    if status and status != "all":
        items = [item for item in items if str(item.get("status") or "") == status]
    by_status = Counter(str(item.get("status")) for item in items)
    protected = by_status.get("protected", 0)
    watch = by_status.get("watch", 0)
    risk = by_status.get("risk", 0)
    score = round((protected / max(1, len(items))) * 100)
    return {
        "ok": True,
        "items": items,
        "summary": {
            "scanned_files": scanned_files,
            "total": len(items),
            "protected": protected,
            "watch": watch,
            "risk": risk,
            "score": score,
        },
        "filters": {"q": q or "", "status": status or "all"},
        "agent_consumption": {
            "purpose": "扫描 Manager Router 源码中的文件型存储与 scope_guard 使用情况，帮助 AI Agent 发现新增模块的三码隔离风险。",
            "api": "/api/v1/system/pages/isolation-audit/scan",
            "task_api": "/api/v1/system/pages/isolation-audit/scan/tasks",
            "history_api": "/api/v1/system/pages/isolation-audit/scan/runs",
            "cli": "sop pages isolation-scan --json",
            "task_cli": "sop pages isolation-scan-tasks --dry-run --json",
            "history_cli": "sop pages isolation-scan-runs --json",
            "fields": ["items.file", "items.storage", "items.scope_guard", "items.missing", "items.recommendation"],
            "recommended_next": ["对 watch/risk 文件补 attach_scope/scope_matches", "为新增文件型 store 增加跨 scope 回归测试", "把扫描结果接入 SystemMap 安全治理节奏"],
        },
    }


def _read_isolation_scan_runs(limit: int = 20) -> list[dict[str, Any]]:
    path = _isolation_scan_runs_file()
    if not path.exists():
        return []
    max_items = max(1, min(int(limit or 20), 100))
    rows: list[dict[str, Any]] = []
    for line in reversed(path.read_text(encoding="utf-8").splitlines()):
        try:
            item = json.loads(line)
        except Exception:
            continue
        if isinstance(item, dict):
            rows.append(item)
        if len(rows) >= max_items:
            break
    return rows


def _append_isolation_scan_run(run: dict[str, Any]) -> None:
    path = _isolation_scan_runs_file()
    with path.open("a", encoding="utf-8") as f:
        f.write(json.dumps(run, ensure_ascii=False) + "\n")


def _isolation_scan_run_by_id(run_id: str, runs: list[dict[str, Any]] | None = None) -> dict[str, Any] | None:
    target = str(run_id or "").strip()
    if not target:
        return None
    for item in runs if runs is not None else _read_isolation_scan_runs(limit=100):
        if str(item.get("id") or "") == target:
            return item
    return None


def _isolation_finding_key(item: dict[str, Any]) -> str:
    return str(item.get("module") or item.get("id") or "").replace("source:", "")


def _isolation_scan_compare_payload(
    *,
    base_id: str = "",
    target_id: str = "",
    q: str = "",
    status: str = "all",
) -> dict[str, Any]:
    runs = _read_isolation_scan_runs(limit=100)
    base = _isolation_scan_run_by_id(base_id, runs) if base_id else (runs[0] if runs else None)
    if target_id:
        target_run = _isolation_scan_run_by_id(target_id, runs)
        target_items = list((target_run or {}).get("findings") or [])
        target_summary = dict((target_run or {}).get("summary") or {})
        target_meta = {
            "mode": "saved_run",
            "id": target_run.get("id") if target_run else target_id,
            "created_at": target_run.get("created_at") if target_run else None,
        }
    else:
        scan = _isolation_source_scan_payload(q=q, status=status)
        target_items = list(scan.get("items") or [])
        target_summary = dict(scan.get("summary") or {})
        target_meta = {"mode": "current_scan", "filters": scan.get("filters") or {"q": q, "status": status}}

    base_items = list((base or {}).get("findings") or [])
    base_by_key = {_isolation_finding_key(item): item for item in base_items if _isolation_finding_key(item)}
    target_by_key = {_isolation_finding_key(item): item for item in target_items if _isolation_finding_key(item)}
    keys = sorted(set(base_by_key) | set(target_by_key))
    rows: list[dict[str, Any]] = []
    for key in keys:
        before = base_by_key.get(key)
        after = target_by_key.get(key)
        before_status = str((before or {}).get("status") or "missing")
        after_status = str((after or {}).get("status") or "missing")
        if before_status in {"risk", "watch"} and after_status == "protected":
            change = "resolved"
        elif before_status == "protected" and after_status in {"risk", "watch"}:
            change = "regressed"
        elif before is None and after_status in {"risk", "watch"}:
            change = "new_risk"
        elif after is None and before_status in {"risk", "watch"}:
            change = "resolved"
        elif before_status != after_status:
            change = "changed"
        else:
            change = "unchanged"
        rows.append(
            {
                "id": key,
                "module": str((after or before or {}).get("module") or key),
                "file": str((after or before or {}).get("file") or ""),
                "before_status": before_status,
                "after_status": after_status,
                "change": change,
                "risk_level": str((after or before or {}).get("risk_level") or "low"),
                "recommendation": str((after or before or {}).get("recommendation") or ""),
            }
        )
    by_change = Counter(str(item.get("change")) for item in rows)
    base_score = int(((base or {}).get("summary") or {}).get("score") or 0)
    target_score = int(target_summary.get("score") or 0)
    new_risks = by_change.get("new_risk", 0) + by_change.get("regressed", 0)
    recommendations = [
        {
            "kind": "create_tasks",
            "priority": "P0",
            "title": "为新增或回退的源码隔离风险生成治理任务",
            "cli": "sop pages isolation-scan-tasks --status all --dry-run --json",
        }
    ] if new_risks else [
        {
            "kind": "keep_protected",
            "priority": "P2",
            "title": "将已修复源码项纳入持续回归扫描基线",
            "cli": "sop pages isolation-scan-run --status all --json",
        }
    ] if by_change.get("resolved", 0) else [
        {
            "kind": "monitor",
            "priority": "P2",
            "title": "当前源码隔离基线稳定，保持周期性扫描",
            "cli": "sop pages isolation-scan-compare --json",
        }
    ]
    return {
        "ok": True,
        "base": {
            "id": (base or {}).get("id"),
            "created_at": (base or {}).get("created_at"),
            "score": base_score,
            "missing": base is None,
        },
        "target": {**target_meta, "score": target_score},
        "items": rows,
        "summary": {
            "total": len(rows),
            "new_risks": new_risks,
            "resolved": by_change.get("resolved", 0),
            "changed": by_change.get("changed", 0),
            "unchanged": by_change.get("unchanged", 0),
            "score_delta": target_score - base_score,
        },
        "recommendations": recommendations,
        "agent_consumption": {
            "purpose": "对比源代码隔离扫描快照和当前扫描，识别新增风险、回退、已修复项和下一步 Agent 治理动作。",
            "api": "/api/v1/system/pages/isolation-audit/scan/runs/compare",
            "cli": "sop pages isolation-scan-compare --json",
            "task_cli": "sop pages isolation-scan-tasks --status all --dry-run --json",
        },
    }


def _capability_registry(react: list[dict[str, Any]]) -> list[dict[str, Any]]:
    nav_by_id = {str(item.get("id")): item for item in NAV_CONTRACT}
    rows: list[dict[str, Any]] = []
    for item in react:
        page_id = str(item.get("id", ""))
        domain = str(item.get("effective_domain") or item.get("domain") or "")
        nav = nav_by_id.get(page_id, {})
        capability = str(nav.get("capability") or item.get("capability_key") or f"{domain}.{page_id}")
        policies = DOMAIN_ROLE_MATRIX.get(domain, DOMAIN_ROLE_MATRIX["overview"])
        ai_surfaces = AI_SURFACE_BY_DOMAIN.get(domain, ["copilot"])
        submodules = _submodules_for(page_id, capability, policies)
        actions = _capability_actions_for(capability, policies)
        rows.append(
            {
                "id": page_id,
                "name": item.get("name"),
                "domain": domain,
                "domain_name": item.get("domain_name") or domain,
                "path": item.get("path"),
                "capability": capability,
                "permission": {
                    "read": policies["read"],
                    "write": policies["write"],
                    "admin": policies["admin"],
                },
                "actions": actions,
                "submodules": submodules,
                "submodule_count": len(submodules),
                "action_count": len(actions) + sum(len(row.get("actions", [])) for row in submodules),
                "ai": {
                    "enabled": True,
                    "entry": "#/copilot",
                    "surfaces": ai_surfaces,
                    "prompt_context": {
                        "module": item.get("name"),
                        "domain": item.get("domain_name") or domain,
                        "capability": capability,
                        "page": item.get("path"),
                    },
                },
            }
        )
    return rows


def _action_allowed(item: dict[str, Any], role: str, action: str = "read") -> bool:
    permission = item.get("permission") or {}
    roles = permission.get(action) or []
    return str(role) in roles


def _decorate_capabilities_for_role(registry: list[dict[str, Any]], role: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for item in registry:
        allowed = {
            "read": _action_allowed(item, role, "read"),
            "write": _action_allowed(item, role, "write"),
            "admin": _action_allowed(item, role, "admin"),
        }
        rows.append({**item, "allowed": allowed, "visible": allowed["read"]})
    return rows


def _capability_payload(registry: list[dict[str, Any]], *, role: str | None = None) -> dict[str, Any]:
    items = _decorate_capabilities_for_role(registry, role) if role else registry
    by_domain: dict[str, list[dict[str, Any]]] = {}
    for item in items:
        by_domain.setdefault(str(item["domain"]), []).append(item)
    visible_items = [item for item in items if item.get("visible", True)]
    return {
        "ok": True,
        "role": role,
        "roles": list(USER_ROLES),
        "domains": DOMAINS,
        "items": items,
        "visible_items": visible_items,
        "by_domain": by_domain,
        "summary": {
            "total": len(items),
            "visible": len(visible_items),
            "ai_enabled": sum(1 for item in items if item.get("ai", {}).get("enabled")),
            "domains": len(by_domain),
            "submodules": sum(int(item.get("submodule_count") or 0) for item in items),
            "actions": sum(int(item.get("action_count") or 0) for item in items),
        },
    }


def _module_actions_for(module: dict[str, Any], *, role: str | None = None) -> list[dict[str, Any]]:
    allowed = module.get("allowed") or {}
    can_read = bool(allowed.get("read", True)) if role else True
    can_write = bool(allowed.get("write", True)) if role else True
    can_admin = bool(allowed.get("admin", True)) if role else True
    module_id = str(module.get("id") or "")
    module_name = str(module.get("name") or module_id)
    domain = str(module.get("domain") or "")
    capability = str(module.get("capability") or "")
    path = str(module.get("path") or "")
    actions = [
        {
            "id": "open",
            "name": "打开模块",
            "type": "navigate",
            "scope": "frontend",
            "required_action": "read",
            "allowed": can_read,
            "target": path,
            "capability": capability,
            "description": f"进入 {module_name} 页面进行人工操作。",
        },
        {
            "id": "module_ai",
            "name": "模块 AI 分析",
            "type": "copilot",
            "scope": "ai",
            "required_action": "read",
            "allowed": can_read,
            "target": "#/copilot",
            "capability": capability,
            "description": f"携带 {module_name} 模块上下文调用 Copilot 生成分析与执行建议。",
            "prompt": f"请分析模块 {module_name}，领域 {domain}，能力码 {capability}，页面 {path}，并给出可执行改进计划。",
        },
        {
            "id": "create_delivery_task",
            "name": "生成交付任务",
            "type": "task",
            "scope": "delivery",
            "required_action": "write",
            "allowed": can_write,
            "target": "/api/v1/tasks",
            "capability": capability,
            "description": f"把 {module_name} 的改造建议沉淀为任务，进入任务看板与 CLI/Agent 执行闭环。",
        },
        {
            "id": "inspect_manifest",
            "name": "查看模块 Manifest",
            "type": "api",
            "scope": "governance",
            "required_action": "read",
            "allowed": can_read,
            "target": "/api/v1/system/pages/manifest/me",
            "capability": "governance.system-map",
            "description": "查看当前角色可见的模块、权限、AI surfaces 与前端分包策略。",
        },
    ]
    if module_id == "legacyConsole":
        actions.append(
            {
                "id": "create_legacy_migration_tasks",
                "name": "生成 Legacy 迁移任务",
                "type": "task",
                "scope": "migration",
                "required_action": "write",
                "allowed": can_write,
                "target": "/api/v1/system/pages/backlog/tasks",
                "capability": "governance.system-map",
                "description": "按 legacy backlog 批量生成迁移任务，逐步替换 iframe 桥接为原生 React 模块。",
            }
        )
    if domain in {"governance", "system"}:
        actions.append(
            {
                "id": "governance_admin",
                "name": "治理配置",
                "type": "admin",
                "scope": "governance",
                "required_action": "admin",
                "allowed": can_admin,
                "target": "#/settings",
                "capability": capability,
                "description": "进入系统设置与治理配置，维护 SSO、运维、计费、观测等系统级能力。",
            }
        )
    return actions


def _module_actions_payload(*, role: str | None = None) -> dict[str, Any]:
    manifest = _module_manifest(role=role)
    modules = manifest["modules"]
    actions_by_module = {
        str(module["id"]): _module_actions_for(module, role=role)
        for module in modules
    }
    all_actions = [
        {**action, "module_id": str(module["id"]), "module_name": module.get("name"), "domain": module.get("domain")}
        for module in modules
        for action in actions_by_module[str(module["id"])]
    ]
    allowed_actions = [action for action in all_actions if action.get("allowed", True)]
    return {
        "ok": True,
        "role": role,
        "modules": modules,
        "items": all_actions,
        "by_module": actions_by_module,
        "summary": {
            "modules": len(modules),
            "actions": len(all_actions),
            "allowed": len(allowed_actions),
            "blocked": len(all_actions) - len(allowed_actions),
            "by_type": dict(Counter(str(action.get("type", "unknown")) for action in all_actions)),
        },
    }


def _module_action_lookup(module_id: str, action_id: str, *, role: str) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    payload = _module_actions_payload(role=role)
    module = next((item for item in payload["modules"] if str(item.get("id")) == module_id), None)
    action = next(
        (
            item
            for item in payload["items"]
            if str(item.get("module_id")) == module_id and str(item.get("id")) == action_id
        ),
        None,
    )
    return module, action


def _module_action_plan(module: dict[str, Any], action: dict[str, Any], *, role: str, dry_run: bool) -> dict[str, Any]:
    risk = _assess_action_run_risk(
        {
            "module_id": module.get("id"),
            "module_name": module.get("name"),
            "action_id": action.get("id"),
            "action_type": action.get("type"),
            "executed": False,
        },
        action,
    )
    steps = [
        {"order": 1, "title": "读取模块上下文", "detail": f"module={module.get('name')} capability={module.get('capability')} path={module.get('path')}"},
        {"order": 2, "title": "执行标准动作", "detail": f"{action.get('name')} -> {action.get('target')}"},
        {"order": 3, "title": "风险与证据治理", "detail": f"risk={risk['level']} score={risk['score']}；写入审计链、事件流水与运行台账。"},
    ]
    return {
        "ok": True,
        "dry_run": dry_run,
        "role": role,
        "module": module,
        "action": action,
        "steps": steps,
        "execution": {
            "mode": "planned",
            "side_effects": [] if dry_run else ["external_action_required"],
        },
        "risk": risk,
        "policy": _evaluate_action_policy(risk),
    }


def _execute_module_action(module: dict[str, Any], action: dict[str, Any], body: ModuleActionExecuteIn, *, role: str) -> dict[str, Any]:
    plan = _module_action_plan(module, action, role=role, dry_run=body.dry_run)
    action_id = str(action.get("id") or "")
    module_id = str(module.get("id") or "")
    module_name = str(module.get("name") or module_id)
    if body.dry_run:
        return {**plan, "executed": False, "run_id": "", "result": {"mode": "dry_run"}}
    pre_run = {
        "id": f"mar-{uuid4().hex[:12]}",
        "created_at": _utc_now(),
        "role": role,
        "module_id": module_id,
        "module_name": module_name,
        "action_id": action_id,
        "action_name": action.get("name"),
        "action_type": action.get("type"),
        "capability": action.get("capability"),
        "target": action.get("target"),
        "executed": False,
        "result_type": "approval_required",
        "result_ref": "",
    }
    pre_run["risk"] = _assess_action_run_risk({**pre_run, "executed": True}, action)
    pre_run["policy"] = _evaluate_action_policy(pre_run["risk"])
    if pre_run["policy"].get("mode") == "enforce" and pre_run["policy"].get("decision") in {"requires_approval", "block"}:
        approval = _create_approval_request(pre_run, reason="enforce_pre_approval")
        evidence = _publish_action_run(pre_run)
        persisted_run = _append_action_run({**pre_run, "approval": approval, "evidence": evidence})
        return {
            **plan,
            "executed": False,
            "run_id": pre_run["id"],
            "run": persisted_run,
            "result": {"type": "approval_required", "approval": approval, "policy": pre_run["policy"]},
        }
    if action_id in {"open", "governance_admin"}:
        output = {
            **plan,
            "executed": True,
            "result": {"type": "navigate", "target": action.get("target")},
        }
    elif action_id == "module_ai":
        output = {
            **plan,
            "executed": True,
            "result": {
                "type": "copilot_prefill",
                "target": action.get("target"),
                "prompt": action.get("prompt"),
                "context": {
                    "module_id": module_id,
                    "module_name": module_name,
                    "domain": module.get("domain"),
                    "capability": module.get("capability"),
                    "path": module.get("path"),
                },
            },
        }
    elif action_id == "inspect_manifest":
        output = {
            **plan,
            "executed": True,
            "result": {"type": "manifest", "target": action.get("target"), "manifest": _module_manifest(role=role)},
        }
    elif action_id == "create_legacy_migration_tasks":
        result = system_page_backlog_tasks(BacklogTaskIn(dry_run=False, priority=body.priority, assigned_to=body.assigned_to))
        output = {**plan, "executed": True, "result": {"type": "legacy_migration_tasks", **result}}
    elif action_id == "create_delivery_task":
        task = create_task(
            TaskCreate(
                title=f"增强模块：{module_name}",
                description="\n".join(
                    [
                        f"模块: {module_name}",
                        f"领域: {module.get('domain_name') or module.get('domain')}",
                        f"路径: {module.get('path')}",
                        f"能力码: {module.get('capability')}",
                        "",
                        "目标:",
                        f"- {action.get('description')}",
                        *[f"- {item}" for item in module.get("next", [])],
                    ]
                ).strip(),
                priority=body.priority,
                estimate="M",
                assigned_to=body.assigned_to,
                dev_tool="codex",
                source="system_module_action",
                source_report_id=module_id,
                source_report_title=module_name,
                debug_notes=f"Generated from module action catalog: {module_id}.{action_id}",
            )
        )
        output = {**plan, "executed": True, "result": {"type": "task", "task": task}}
    else:
        output = {**plan, "executed": False, "result": {"type": "unsupported_action", "action_id": action_id}}
    result = output.get("result") or {}
    result_ref = ""
    if isinstance(result, dict):
        task = result.get("task")
        result_ref = str(task.get("id") or "") if isinstance(task, dict) else str(result.get("target") or "")
    run = {
        "id": pre_run["id"],
        "created_at": _utc_now(),
        "role": role,
        "module_id": module_id,
        "module_name": module_name,
        "action_id": action_id,
        "action_name": action.get("name"),
        "action_type": action.get("type"),
        "capability": action.get("capability"),
        "target": action.get("target"),
        "executed": bool(output.get("executed")),
        "result_type": result.get("type") if isinstance(result, dict) else "",
        "result_ref": result_ref,
    }
    run["risk"] = _assess_action_run_risk(run, action)
    run["policy"] = _evaluate_action_policy(run["risk"])
    approval = None
    if run["policy"].get("decision") in {"requires_approval", "block"}:
        approval = _create_approval_request(run, reason="post_execution_governance")
    evidence = _publish_action_run(run)
    persisted_run = _append_action_run({**run, "approval": approval, "evidence": evidence})
    return {**output, "run_id": run["id"], "run": persisted_run}


def _module_manifest(*, role: str | None = None) -> dict[str, Any]:
    react = _enrich_pages(REACT_PAGES)
    legacy = _enrich_pages(LEGACY_PAGES)
    capability_registry = _capability_registry(react)
    capabilities = _decorate_capabilities_for_role(capability_registry, role) if role else capability_registry
    capability_by_id = {str(item["id"]): item for item in capabilities}
    react_by_id = {str(item["id"]): item for item in react}
    nav_modules: list[dict[str, Any]] = []
    for nav in NAV_CONTRACT:
        page_id = str(nav["id"])
        page = react_by_id.get(page_id, {})
        cap = capability_by_id.get(page_id, {})
        nav_modules.append(
            {
                "id": page_id,
                "name": page.get("name") or page_id,
                "path": nav.get("path"),
                "domain": nav.get("domain"),
                "domain_name": page.get("domain_name"),
                "capability": nav.get("capability"),
                "status": page.get("status"),
                "maturity": page.get("maturity"),
                "apis": page.get("apis", []),
                "features": page.get("capabilities", []),
                "submodules": cap.get("submodules", []),
                "submodule_count": cap.get("submodule_count", 0),
                "action_count": cap.get("action_count", 0),
                "next": page.get("next", []),
                "permission": cap.get("permission", {}),
                "allowed": cap.get("allowed"),
                "visible": cap.get("visible", True),
                "ai": cap.get("ai", {}),
                "frontend": {
                    "route": nav.get("path"),
                    "lazy": True,
                    "chunk_group": str(nav.get("domain") or "overview"),
                    "shell": "manager-web",
                },
                "extension": {
                    "slot": f"manager.{nav.get('domain')}.{page_id}",
                    "configurable": True,
                    "plugin_ready": page_id in {"marketplace", "platforms", "intelligence", "legacyConsole", "systemMap"},
                },
            }
        )
    return {
        "ok": True,
        "version": "2026.05.v4-module-manifest",
        "shell": {
            "name": "manager-web",
            "default_entry": "/?shell=1#/dashboard",
            "routing": "hash",
            "auth_required": True,
            "layout": "fixed-sidebar-independent-workbench",
        },
        "domains": DOMAINS,
        "modules": nav_modules,
        "legacy_modules": [
            {
                "id": item.get("id"),
                "console_id": item.get("console_id") or item.get("id"),
                "name": item.get("name"),
                "path": item.get("path"),
                "bridge_path": f"#/legacy/{item.get('console_id') or item.get('id')}",
                "target": item.get("target"),
                "status": item.get("status"),
                "maturity": item.get("maturity"),
                "domain": item.get("effective_domain"),
                "next": item.get("next", []),
            }
            for item in legacy
        ],
        "ai": {
            "entry": "#/copilot",
            "module_prompt_template": "module={{module}} domain={{domain}} capability={{capability}} path={{path}}",
            "surfaces_by_domain": AI_SURFACE_BY_DOMAIN,
            "all_modules_enabled": all(item.get("ai", {}).get("enabled") for item in capability_registry),
            "action_catalog": "/api/v1/system/pages/actions/me",
            "agent_consumption": {
                "purpose": "供 CLI/IDE/Agent 自动选择专业菜单、校验 capability、定位 API 与 AI surfaces",
                "local_files": {
                    "pages_manifest": ".sop-runtime/pages_manifest.json",
                    "pages_capabilities": ".sop-runtime/pages_capabilities.json",
                    "agent_context": ".sop-runtime/agent_context.json",
                },
                "refresh_command": "sop context prepare --pages",
                "selector_fields": ["id", "domain", "capability", "path", "apis", "submodules", "ai.surfaces"],
            },
        },
        "security": {
            "roles": list(USER_ROLES),
            "capability_check": "/api/v1/system/pages/capabilities/check",
            "capability_me": "/api/v1/system/pages/capabilities/me",
            "domain_role_matrix": DOMAIN_ROLE_MATRIX,
        },
        "frontend": {
            "code_splitting": True,
            "chunk_strategy": [
                "react-vendor",
                "query-vendor",
                "antd-core-vendor",
                "antd-runtime-vendor",
                "echarts-vendor",
                "antv-vendor",
                "icon-vendor",
                "i18n-vendor",
                "vendor",
                "route-chunks",
            ],
            "module_registry_source": "apps/manager-web/src/navigation.tsx",
            "page_registry_source": "apps/manager/sop_manager/routers/system_pages.py",
        },
        "quality": {
            "validation": _registry_validation(),
            "react_summary": _summary(react),
            "legacy_summary": _summary(legacy),
            "domain_matrix": _domain_matrix(REACT_PAGES, LEGACY_PAGES),
        },
    }


def _manager_web_dist_assets_dir() -> Path:
    return Path(__file__).resolve().parents[4] / "apps" / "manager-web" / "dist" / "assets"


def _chunk_type(filename: str) -> str:
    if "vendor" in filename:
        return "vendor"
    if filename.startswith(("index-", "main-", "bootstrap-", "navigation-registry-")):
        return "shell"
    if filename.startswith("api-client-"):
        return "shared"
    return "route"


def _chunk_load_scope(filename: str, chunk_type: str) -> str:
    lowered = filename.lower()
    if chunk_type == "shell":
        return "initial"
    if lowered.startswith(("antv-vendor", "echarts-", "echarts-core-vendor", "echarts-charts-vendor", "echarts-components-vendor")):
        return "deferred-visualization"
    if chunk_type == "route":
        return "route-lazy"
    return "shared"


def _frontend_performance_payload() -> dict[str, Any]:
    assets_dir = _manager_web_dist_assets_dir()
    files = sorted(assets_dir.glob("*.js")) if assets_dir.exists() else []
    chunks: list[dict[str, Any]] = []
    for file in files:
        content = file.read_bytes()
        size_bytes = len(content)
        gzip_bytes = len(gzip.compress(content))
        chunk_type = _chunk_type(file.name)
        load_scope = _chunk_load_scope(file.name, chunk_type)
        over_raw_budget = size_bytes > 500 * 1024
        over_gzip_budget = gzip_bytes > 180 * 1024
        chunks.append(
            {
                "name": file.name,
                "type": chunk_type,
                "load_scope": load_scope,
                "size_bytes": size_bytes,
                "size_kb": round(size_bytes / 1024, 1),
                "gzip_bytes": gzip_bytes,
                "gzip_kb": round(gzip_bytes / 1024, 1),
                "budget": {
                    "raw_kb": 500,
                    "gzip_kb": 180,
                    "over_raw_budget": over_raw_budget,
                    "over_gzip_budget": over_gzip_budget,
                    "status": "risk" if over_gzip_budget else "watch" if over_raw_budget else "ok",
                },
            }
        )
    by_type = Counter(str(item["type"]) for item in chunks)
    raw_total = sum(int(item["size_bytes"]) for item in chunks)
    gzip_total = sum(int(item["gzip_bytes"]) for item in chunks)
    oversize_raw = [item for item in chunks if item["budget"]["over_raw_budget"]]
    oversize_gzip = [item for item in chunks if item["budget"]["over_gzip_budget"]]
    route_oversize = [item for item in oversize_raw if item["type"] == "route"]
    vendor_oversize = [item for item in oversize_raw if item["type"] == "vendor"]
    initial_oversize = [item for item in oversize_raw if item.get("load_scope") == "initial"]
    deferred_oversize = [item for item in oversize_raw if str(item.get("load_scope") or "").startswith(("deferred", "route-lazy"))]
    score = max(0, 100 - len(oversize_gzip) * 10 - len(route_oversize) * 6 - len(vendor_oversize) * 4 - len(initial_oversize) * 8)
    status = "excellent" if score >= 92 else "good" if score >= 82 else "watch" if score >= 68 else "risk"
    recommendations: list[str] = []
    if not files:
        recommendations.append("先执行 pnpm --dir apps/manager-web build 生成 dist/assets 后再查看真实性能证据。")
    if route_oversize:
        names = ", ".join(str(item["name"]).split("-")[0] for item in route_oversize[:4])
        recommendations.append(f"优先继续拆分路由工作台 chunk：{names}，把低频抽屉、图表和表单逻辑后置加载。")
    if vendor_oversize:
        vendor_names = {str(item["name"]).split("-")[0] for item in vendor_oversize}
        if vendor_names == {"antv"}:
            recommendations.append("当前仅 AntV 图谱包仍超过预算；优先将 G6 图谱运行时继续后置到血缘/编排等低频图谱场景。")
        else:
            recommendations.append("继续拆分超预算 vendor 包，避免首屏加载与专业工作台强耦合。")
    if any(item["type"] == "shell" and item["budget"]["over_raw_budget"] for item in chunks):
        if any(str(item["name"]).startswith("navigation-registry-") for item in chunks if item["budget"]["over_raw_budget"]):
            recommendations.append("导航注册表 chunk 仍偏大，后续继续拆菜单元数据、图标映射和微应用定义，避免首屏主壳被低频治理信息拖重。")
        recommendations.append("主壳 index/main/navigation chunk 仍偏大，后续可把菜单偏好、图标映射和低频治理面板继续改为按需 import。")
    if deferred_oversize and not initial_oversize:
        recommendations.append("当前超预算主要是延迟加载 chunk；继续保持首屏轻量，按图谱/血缘/编排专业入口逐步拆包。")
    if not recommendations:
        recommendations.append("当前构建产物未发现超 500KB raw chunk，可进入移动端首屏真实渲染和交互耗时检查。")
    return {
        "ok": True,
        "assets_dir": str(assets_dir),
        "available": bool(files),
        "summary": {
            "score": score,
            "status": status,
            "chunks": len(chunks),
            "route_chunks": by_type.get("route", 0),
            "vendor_chunks": by_type.get("vendor", 0),
            "shell_chunks": by_type.get("shell", 0),
            "shared_chunks": by_type.get("shared", 0),
            "total_kb": round(raw_total / 1024, 1),
            "total_gzip_kb": round(gzip_total / 1024, 1),
            "oversize_raw": len(oversize_raw),
            "oversize_gzip": len(oversize_gzip),
            "initial_oversize": len(initial_oversize),
            "deferred_oversize": len(deferred_oversize),
        },
        "budgets": {
            "chunk_raw_kb": 500,
            "chunk_gzip_kb": 180,
            "route_goal": "专业工作台按路由懒加载，低频图表和抽屉按操作懒加载。",
            "mobile_goal": "移动端只加载当前聚焦模块，不因菜单或图表库阻塞首屏。",
        },
        "top_chunks": sorted(chunks, key=lambda item: int(item["size_bytes"]), reverse=True)[:16],
        "oversize_chunks": sorted(oversize_raw, key=lambda item: int(item["size_bytes"]), reverse=True),
        "recommendations": recommendations,
        "agent_consumption": {
            "purpose": "供 AI 和开发者按真实构建产物识别大包、拆分低频工作台和验证前端自适配性能治理。",
            "api": "/api/v1/system/pages/frontend-performance",
            "task_api": "/api/v1/system/pages/frontend-performance/tasks",
            "route": "#/system-map/performance",
            "build_command": "pnpm --dir apps/manager-web build",
            "fields": ["summary.score", "summary.initial_oversize", "summary.deferred_oversize", "top_chunks", "recommendations"],
        },
    }


@router.get("/manifest")
def system_page_manifest() -> dict[str, Any]:
    return _module_manifest()


@router.get("/manifest/me")
def system_page_manifest_me(user: User = Depends(current_user)) -> dict[str, Any]:
    manifest = _module_manifest(role=user.role)
    manifest["role"] = user.role
    manifest["modules"] = [item for item in manifest["modules"] if item.get("visible", True)]
    manifest["quality"]["visible_module_count"] = len(manifest["modules"])
    return manifest


@router.get("/actions")
def system_page_actions() -> dict[str, Any]:
    return _module_actions_payload()


@router.get("/actions/me")
def system_page_actions_me(user: User = Depends(current_user)) -> dict[str, Any]:
    return _module_actions_payload(role=user.role)


@router.get("/actions/policy")
def system_page_action_policy(user: User = Depends(current_user)) -> dict[str, Any]:
    policy = _read_action_policy()
    return {
        "ok": True,
        "role": user.role,
        "policy": policy,
        "editable": user.role in {"tenant_admin", "super_admin"},
    }


@router.put("/actions/policy")
def system_page_action_policy_update(body: ModuleActionPolicyIn, user: User = Depends(current_user)) -> dict[str, Any]:
    if user.role not in {"tenant_admin", "super_admin"}:
        return {"ok": False, "reason": "permission_denied", "role": user.role}
    policy = _write_action_policy(body.model_dump() if hasattr(body, "model_dump") else body.dict())
    try:
        from sop_manager.routers.audit_chain import append_audit

        chain = append_audit(
            "system.module_action.policy.update",
            user_id=user.username or user.id,
            tenant_id="system",
            resource_type="system_page_action_policy",
            resource_id="default",
            details=policy,
        )
    except Exception as err:  # pragma: no cover
        chain = {"error": str(err)}
    return {"ok": True, "policy": policy, "audit_chain": chain}


@router.get("/actions/approvals")
def system_page_action_approvals(
    status: str = "pending",
    limit: int = 100,
    user: User = Depends(current_user),
) -> dict[str, Any]:
    rows = _read_approvals(status=status, limit=limit)
    by_status = Counter(str(item.get("status") or "unknown") for item in _read_approvals(status="all", limit=500))
    return {
        "ok": True,
        "role": user.role,
        "editable": user.role in {"tenant_admin", "super_admin"},
        "items": rows,
        "total": len(rows),
        "summary": {"by_status": dict(by_status), "pending": by_status.get("pending", 0)},
    }


@router.post("/actions/approvals/{approval_id}/review")
def system_page_action_approval_review(
    approval_id: str,
    body: ModuleActionApprovalReviewIn,
    user: User = Depends(current_user),
) -> dict[str, Any]:
    if user.role not in {"tenant_admin", "super_admin"}:
        return {"ok": False, "reason": "permission_denied", "role": user.role}
    row = _review_approval(approval_id, status=body.status, reviewer=user.username or user.id, note=body.note)
    if not row:
        return {"ok": False, "reason": "not_found", "approval_id": approval_id}
    try:
        from sop_manager.routers.audit_chain import append_audit

        chain = append_audit(
            "system.module_action.approval.review",
            user_id=user.username or user.id,
            tenant_id="system",
            resource_type="system_page_action_approval",
            resource_id=approval_id,
            details=row,
        )
    except Exception as err:  # pragma: no cover
        chain = {"error": str(err)}
    return {"ok": True, "item": row, "audit_chain": chain}


@router.post("/actions/plan")
def system_page_action_plan(body: ModuleActionPlanIn, user: User = Depends(current_user)) -> dict[str, Any]:
    module, action = _module_action_lookup(body.module_id, body.action_id, role=user.role)
    if not module or not action:
        return {
            "ok": False,
            "reason": "unknown_module_action",
            "module_id": body.module_id,
            "action_id": body.action_id,
        }
    if not action.get("allowed", True):
        return {
            "ok": False,
            "reason": "permission_denied",
            "role": user.role,
            "module_id": body.module_id,
            "action_id": body.action_id,
            "required_action": action.get("required_action"),
            "capability": action.get("capability"),
        }
    return _module_action_plan(module, action, role=user.role, dry_run=body.dry_run)


@router.post("/actions/execute")
def system_page_action_execute(body: ModuleActionExecuteIn, user: User = Depends(current_user)) -> dict[str, Any]:
    module, action = _module_action_lookup(body.module_id, body.action_id, role=user.role)
    if not module or not action:
        return {
            "ok": False,
            "reason": "unknown_module_action",
            "module_id": body.module_id,
            "action_id": body.action_id,
        }
    if not action.get("allowed", True):
        return {
            "ok": False,
            "reason": "permission_denied",
            "role": user.role,
            "module_id": body.module_id,
            "action_id": body.action_id,
            "required_action": action.get("required_action"),
            "capability": action.get("capability"),
        }
    return _execute_module_action(module, action, body, role=user.role)


@router.get("/actions/runs")
def system_page_action_runs(
    limit: int = 50,
    module_id: str = "",
    action_id: str = "",
    risk_level: str = "",
    user: User = Depends(current_user),
) -> dict[str, Any]:
    rows = _read_action_runs(limit=limit, module_id=module_id, action_id=action_id, risk_level=risk_level)
    by_type = Counter(str(item.get("action_type") or "unknown") for item in rows)
    by_module = Counter(str(item.get("module_id") or "unknown") for item in rows)
    by_risk = Counter(str(item.get("risk", {}).get("level") or "unknown") for item in rows)
    return {
        "ok": True,
        "role": user.role,
        "items": rows,
        "total": len(rows),
        "summary": {
            "executed": sum(1 for item in rows if item.get("executed")),
            "by_type": dict(by_type),
            "by_module": dict(by_module),
            "by_risk": dict(by_risk),
            "highest_risk": max((int(item.get("risk", {}).get("score") or 0) for item in rows), default=0),
        },
    }


def _role_menu_strategy(role: str) -> dict[str, Any]:
    base_groups = {str(domain["id"]): False for domain in DOMAINS}
    default_collapsed_categories = {"data-engineering-ops", "ai-runtime-ops"}
    category_keys = {
        "overview-command",
        "project-lifecycle",
        "org-governance",
        "requirement-intake",
        "requirement-ai-governance",
        "delivery-execution",
        "dependency-scheduling",
        "workflow-orchestration",
        "data-strategy",
        "data-insight-reporting",
        "data-asset-governance",
        "data-engineering-ops",
        "ai-command",
        "ai-knowledge",
        "ai-runtime-ops",
        "agent-platform",
        "asset-market",
        "communication-integration",
        "security-audit",
        "module-governance",
        "runtime-config",
    }
    base_categories = {key: key in default_collapsed_categories for key in category_keys}
    presets: dict[str, dict[str, Any]] = {
        "super_admin": {
            "home": "#/dashboard",
            "default_favorites": ["dashboard", "systemMap", "audit", "settings", "platforms", "agentRuns"],
            "expanded_groups": ["overview", "portfolio", "delivery", "ai", "ecosystem", "governance", "system"],
            "collapsed_groups": [],
            "expanded_categories": ["overview-command", "module-governance", "agent-platform", "security-audit", "runtime-config"],
            "density": "compact",
        },
        "tenant_admin": {
            "home": "#/dashboard",
            "default_favorites": ["dashboard", "projects", "organization", "tasks", "platforms", "settings"],
            "expanded_groups": ["overview", "portfolio", "product", "delivery", "ai", "ecosystem"],
            "collapsed_groups": ["governance", "system"],
            "expanded_categories": ["project-lifecycle", "org-governance", "delivery-execution", "agent-platform"],
            "density": "comfortable",
        },
        "project_admin": {
            "home": "#/projects",
            "default_favorites": ["projects", "projectOnboarding", "projectGovernance", "requirements", "tasks", "agentRuns"],
            "expanded_groups": ["portfolio", "product", "delivery", "ai", "ecosystem"],
            "collapsed_groups": ["data", "governance", "system"],
            "expanded_categories": ["project-lifecycle", "requirement-intake", "delivery-execution", "dependency-scheduling", "agent-platform"],
            "density": "comfortable",
        },
        "developer": {
            "home": "#/tasks",
            "default_favorites": ["tasks", "taskScheduler", "agentRuns", "copilot", "vibe", "globalSearch"],
            "expanded_groups": ["delivery", "ai", "ecosystem"],
            "collapsed_groups": ["portfolio", "data", "governance", "system"],
            "expanded_categories": ["delivery-execution", "dependency-scheduling", "ai-command", "agent-platform"],
            "density": "compact",
        },
        "viewer": {
            "home": "#/dashboard",
            "default_favorites": ["dashboard", "requirements", "tasks", "analytics", "analyticsReports"],
            "expanded_groups": ["overview", "product", "delivery", "data"],
            "collapsed_groups": ["portfolio", "ai", "ecosystem", "governance", "system"],
            "expanded_categories": ["overview-command", "requirement-intake", "delivery-execution", "data-insight-reporting"],
            "density": "comfortable",
        },
    }
    preset = presets.get(role, presets["viewer"])
    groups = {**base_groups}
    for group in preset.get("collapsed_groups", []):
        groups[str(group)] = True
    for group in preset.get("expanded_groups", []):
        groups[str(group)] = False
    categories = {**base_categories}
    for category in preset.get("expanded_categories", []):
        categories[str(category)] = False
    return {
        "role": role,
        "home": preset["home"],
        "density": preset["density"],
        "default_favorites": preset["default_favorites"],
        "collapsed_groups": groups,
        "collapsed_categories": categories,
        "collapsed_modules": {},
        "show_recents": True,
        "show_favorites": True,
        "recent_limit": 8,
        "favorite_limit": 24,
        "reason": "按角色聚焦高频工作域，降低专业化多级菜单的认知负担。",
    }


def _sanitize_menu_keys(keys: list[str] | None, *, limit: int) -> list[str]:
    valid = {str(item.get("id")) for item in NAV_CONTRACT}
    out: list[str] = []
    for key in keys or []:
        k = str(key)
        if not k or k in out:
            continue
        if k in valid:
            out.append(k)
        if len(out) >= limit:
            break
    return out


def _read_menu_prefs(user: User) -> dict[str, Any]:
    path = _menu_prefs_file(user)
    if not path.exists():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    return raw if isinstance(raw, dict) else {}


def _menu_preferences_payload(user: User) -> dict[str, Any]:
    role = str(getattr(user, "role", "") or "viewer")
    strategy = _role_menu_strategy(role)
    stored = _read_menu_prefs(user)
    favorites = _sanitize_menu_keys(stored.get("favorites") or strategy["default_favorites"], limit=int(strategy["favorite_limit"]))
    quick_access = _sanitize_menu_keys(stored.get("quick_access") or [], limit=12)
    recents = _sanitize_menu_keys(stored.get("recents") or [], limit=int(strategy["recent_limit"]))
    prefs = {
        "favorites": favorites,
        "quick_access": quick_access,
        "recents": recents,
        "density": stored.get("density") or strategy["density"],
        "menu_layout": stored.get("menu_layout") or "grouped",
        "menu_effect": stored.get("menu_effect") or "soft",
        "show_recents": bool(stored.get("show_recents", strategy["show_recents"])),
        "show_favorites": bool(stored.get("show_favorites", strategy["show_favorites"])),
        "show_menu_counts": bool(stored.get("show_menu_counts", True)),
        "show_menu_meta": bool(stored.get("show_menu_meta", True)),
        "show_quick_panel": bool(stored.get("show_quick_panel", True)),
        "collapsed_groups": {**strategy["collapsed_groups"], **(stored.get("collapsed_groups") if isinstance(stored.get("collapsed_groups"), dict) else {})},
        "collapsed_categories": {**strategy["collapsed_categories"], **(stored.get("collapsed_categories") if isinstance(stored.get("collapsed_categories"), dict) else {})},
        "collapsed_modules": stored.get("collapsed_modules") if isinstance(stored.get("collapsed_modules"), dict) else {},
        "updated_at": stored.get("updated_at") or "",
    }
    return {
        "ok": True,
        "role": role,
        "strategy": strategy,
        "preferences": prefs,
        "agent_consumption": {
            "purpose": "供前端、CLI 和 AI Agent 读取当前角色推荐菜单、最近访问与折叠策略。",
            "api": "/api/v1/system/pages/menu/preferences/me",
            "cli": "sop pages menu-prefs --json",
            "fields": ["role", "strategy.home", "preferences.quick_access", "preferences.recents", "preferences.favorites", "preferences.collapsed_groups"],
        },
    }


def _micro_app_registry() -> list[dict[str, Any]]:
    pages_by_id = {str(page.get("id")): page for page in _enrich_pages(REACT_PAGES)}
    rows: list[dict[str, Any]] = []
    for app in MICRO_APPS:
        module_ids = [str(item) for item in app.get("module_ids", [])]
        modules = [pages_by_id[item] for item in module_ids if item in pages_by_id]
        all_domain_pages = [
            page
            for page in pages_by_id.values()
            if str(page.get("domain")) in set(str(domain) for domain in app.get("domains", []))
        ]
        maturity_values = [int(page.get("maturity") or 0) for page in modules or all_domain_pages]
        avg_maturity = round(sum(maturity_values) / len(maturity_values), 1) if maturity_values else 0
        status = "healthy" if avg_maturity >= 85 else "watch" if avg_maturity >= 75 else "risk"
        rows.append({
            **app,
            "status": status,
            "avg_maturity": avg_maturity,
            "module_count": len(modules),
            "domain_module_count": len(all_domain_pages),
            "capability_count": sum(len(page.get("capabilities") or []) for page in modules),
            "modules": [
                {
                    "id": page.get("id"),
                    "name": page.get("name"),
                    "path": page.get("path"),
                    "domain": page.get("domain"),
                    "maturity": page.get("maturity"),
                    "capabilities": page.get("capabilities") or [],
                }
                for page in modules
            ],
            "agent_consumption": {
                "purpose": "供 AI Agent 按独立微应用边界选择专业模块、门户入口和运行入口。",
                "route": app.get("route"),
                "runtime_url": app.get("runtime_url"),
                "domains": app.get("domains", []),
                "module_ids": module_ids,
            },
        })
    return rows


def _write_menu_preferences(user: User, body: MenuPreferencesIn) -> dict[str, Any]:
    current = _menu_preferences_payload(user)["preferences"]
    raw = body.model_dump(exclude_none=True) if hasattr(body, "model_dump") else body.dict(exclude_none=True)
    if "favorites" in raw:
        current["favorites"] = _sanitize_menu_keys(raw.get("favorites"), limit=24)
    if "quick_access" in raw:
        current["quick_access"] = _sanitize_menu_keys(raw.get("quick_access"), limit=12)
    if "recents" in raw:
        current["recents"] = _sanitize_menu_keys(raw.get("recents"), limit=8)
    for key in ("density", "menu_layout", "menu_effect", "show_recents", "show_favorites", "show_menu_counts", "show_menu_meta", "show_quick_panel"):
        if key in raw:
            current[key] = raw[key]
    for key in ("collapsed_groups", "collapsed_categories", "collapsed_modules"):
        if isinstance(raw.get(key), dict):
            current[key] = {str(k): bool(v) for k, v in raw[key].items()}
    current["updated_at"] = _utc_now()
    path = _menu_prefs_file(user)
    path.write_text(json.dumps(current, ensure_ascii=False, indent=2), encoding="utf-8")
    return _menu_preferences_payload(user)


@router.get("/hub")
def system_pages_hub(user: User = Depends(current_user)) -> dict[str, Any]:
    react_all = _enrich_pages(REACT_PAGES)
    legacy_all = _enrich_pages(LEGACY_PAGES)
    react_sum = _summary(react_all)
    legacy_sum = _summary(legacy_all)
    validation = _registry_validation()
    menu_health = _menu_health()
    micro_apps = _micro_app_registry()
    role = str(getattr(user, "role", "") or "viewer")
    tenant_id = str(getattr(user, "tenant_id", "") or "default")
    capability_payload = _capability_payload(_capability_registry(react_all), role=role)
    menu_preferences = _menu_preferences_payload(user)
    issues = validation.get("issues") if isinstance(validation.get("issues"), list) else []
    health_summary = menu_health.get("summary", {}) if isinstance(menu_health.get("summary"), dict) else {}
    readiness = {
        "identity": bool(getattr(user, "id", None) or getattr(user, "username", None)),
        "context": bool(tenant_id),
        "menu_contract": int(health_summary.get("critical") or 0) == 0,
        "permission_contract": bool(capability_payload.get("summary", {}).get("visible")),
        "micro_apps": bool(micro_apps) and all(str(app.get("mode") or "") == "standalone" for app in micro_apps),
    }
    governance_actions = [
        {
            "id": "menu-contract",
            "title": "菜单权限契约治理",
            "path": "#/admin/menu",
            "priority": "P0" if int(health_summary.get("critical") or 0) else "P1",
            "metric": f"{menu_health.get('score', 0)} 分",
            "description": "统一页面树、能力码、域、隐藏状态、i18n 和 API 契约健康检查。",
        },
        {
            "id": "permission-matrix",
            "title": "权限矩阵治理",
            "path": "#/admin/permissions",
            "priority": "P1",
            "metric": f"{capability_payload.get('summary', {}).get('visible', 0)} 可见能力",
            "description": "按 super_admin/tenant_admin/project_admin/developer/viewer 对比 read/write/admin。",
        },
        {
            "id": "micro-app-registry",
            "title": "微应用注册治理",
            "path": "#/admin/micro-app-registry",
            "priority": "P1",
            "metric": f"{len(micro_apps)} 个应用",
            "description": "统一维护独立微应用入口、模块清单、运行模式、沙箱配置和通信协议。",
        },
    ]
    return {
        "ok": True,
        "portal": {
            "name": "门户管理",
            "positioning": "统一身份、统一上下文、统一菜单权限契约、统一微应用注册与运行治理的主应用控制面。",
            "mode": "portal_control_plane",
            "shell": "portal-only",
            "capabilities": ["统一身份", "统一上下文", "菜单权限契约", "微应用注册", "运行治理"],
            "updated_at": _utc_now(),
        },
        "identity": {
            "user_id": str(getattr(user, "id", "") or ""),
            "username": str(getattr(user, "username", "") or ""),
            "role": role,
            "tenant_id": tenant_id,
            "session_status": "active",
        },
        "workspace_context": {
            "tenant_id": tenant_id,
            "tenant_code": tenant_id,
            "business_code": "all",
            "project_id": "",
            "project_code": "",
            "propagation": {
                "query_keys": ["tenant", "business", "projectId", "project", "workspace", "shell"],
                "shell": "hermes-portal",
                "description": "独立微应用打开时由 Portal 注入同一工作区上下文，避免各应用自行复制上下文。",
            },
        },
        "readiness": {
            **readiness,
            "score": round(sum(1 for enabled in readiness.values() if enabled) / max(1, len(readiness)) * 100, 1),
        },
        "contracts": {
            "menu": {
                "nav_items": len(NAV_CONTRACT),
                "react_pages": react_sum.get("total", 0),
                "domains": len(DOMAINS),
                "health_score": menu_health.get("score", 0),
                "issues": int(health_summary.get("issues") or 0),
                "critical": int(health_summary.get("critical") or 0),
                "high": int(health_summary.get("high") or 0),
            },
            "permission": capability_payload.get("summary", {}),
            "menu_preferences": menu_preferences.get("preferences", {}),
        },
        "governance_actions": governance_actions,
        "summary": {
            "react_pages": react_sum.get("total", 0),
            "legacy_pages": legacy_sum.get("total", 0),
            "micro_apps": len(micro_apps),
            "avg_maturity": react_sum.get("avg_maturity", 0),
            "validation_issues": len(issues) + int(menu_health.get("summary", {}).get("issues") or 0),
            "menu_health_score": menu_health.get("score", 0),
            "domains_count": len(DOMAINS),
        },
        "micro_apps": micro_apps,
        "stack_layers": _domain_matrix(REACT_PAGES, LEGACY_PAGES)[:8],
        "domains": [
            {"id": "registry", "path": "#/system-map/registry", "capability": "governance.system-map.registry"},
            {"id": "contract", "path": "#/system-map/contract", "capability": "governance.system-map.manifest"},
            {"id": "manifest", "path": "#/system-map/manifest", "capability": "governance.system-map.manifest"},
            {"id": "capabilities", "path": "#/system-map/capabilities", "capability": "governance.system-map.capabilities"},
            {"id": "actions", "path": "#/system-map/actions", "capability": "governance.system-map.actions"},
        ],
    }


@router.get("/micro-apps")
def system_pages_micro_apps() -> dict[str, Any]:
    apps = _micro_app_registry()
    return {
        "ok": True,
        "apps": apps,
        "summary": {
            "total": len(apps),
            "standalone": sum(1 for app in apps if app.get("mode") == "standalone"),
            "healthy": sum(1 for app in apps if app.get("status") == "healthy"),
            "watch": sum(1 for app in apps if app.get("status") == "watch"),
            "risk": sum(1 for app in apps if app.get("status") == "risk"),
            "module_count": sum(int(app.get("module_count") or 0) for app in apps),
            "capability_count": sum(int(app.get("capability_count") or 0) for app in apps),
        },
        "agent_consumption": {
            "purpose": "供前端、CLI 和 AI Agent 获取微应用拆分边界、运行入口和模块归属。",
            "api": "/api/v1/system/pages/micro-apps",
            "fields": ["apps.id", "apps.runtime_url", "apps.domains", "apps.modules", "apps.agent_consumption"],
        },
    }


@router.get("/domains")
def system_page_domains() -> dict[str, Any]:
    return {"ok": True, "domains": DOMAINS, "matrix": _domain_matrix(REACT_PAGES, LEGACY_PAGES)}


@router.get("/validate")
def system_page_registry_validate() -> dict[str, Any]:
    return {"ok": True, "validation": _registry_validation()}


@router.get("/health")
def system_page_menu_health() -> dict[str, Any]:
    return {"ok": True, "health": _menu_health()}


@router.get("/readiness")
def system_pages_readiness(
    domain: str | None = None,
    status: str | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    if status and status not in {"all", "complete", "watch", "risk"}:
        status = "all"
    return _module_readiness_payload(domain=domain, status=status, q=q)


@router.get("/production-readiness")
def system_pages_production_readiness(
    domain: str | None = None,
    stage: str | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    if stage and stage not in {"all", "gap", "contract_complete", "runtime_ready", "production_ready"}:
        stage = "all"
    return _module_production_readiness_payload(domain=domain, stage=stage, q=q)


@router.get("/experience-review")
def system_pages_experience_review(
    domain: str | None = None,
    status: str | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    if status and status not in {"all", "simple", "watch", "complex"}:
        status = "all"
    return _module_experience_review_payload(domain=domain, status=status, q=q)


@router.get("/frontend-performance")
def system_pages_frontend_performance() -> dict[str, Any]:
    return _frontend_performance_payload()


@router.post("/frontend-performance/tasks")
def system_pages_frontend_performance_tasks(body: FrontendPerformanceTaskIn) -> dict[str, Any]:
    payload = _frontend_performance_payload()
    rows = list(payload.get("oversize_chunks") or [])
    if body.include_watch:
        seen = {str(item.get("name") or "") for item in rows}
        rows.extend(
            item
            for item in (payload.get("top_chunks") or [])
            if str(item.get("name") or "") not in seen and str((item.get("budget") or {}).get("status") or "") == "watch"
        )
    selected = {str(x) for x in body.names or [] if str(x).strip()}
    if selected:
        rows = [item for item in rows if str(item.get("name") or "") in selected]
    rows = rows[: max(1, min(int(body.max_items or 8), 50))]
    existing_ids = _existing_frontend_performance_task_ids()
    planned: list[dict[str, Any]] = []
    created: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for item in rows:
        payload_item = _frontend_performance_task_payload(item, priority=body.priority, assigned_to=body.assigned_to)
        report_id = str(payload_item.get("source_report_id") or "")
        if report_id in existing_ids:
            skipped.append({"id": str(item.get("name") or ""), "reason": "task_exists", "title": payload_item["title"]})
            continue
        planned.append(payload_item)
        if not body.dry_run:
            created.append(create_task(TaskCreate(**payload_item)))
            existing_ids.add(report_id)
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "planned": planned,
        "created": created,
        "skipped": skipped,
        "summary": {"planned": len(planned), "created": len(created), "skipped": len(skipped)},
        "agent_consumption": {
            "purpose": "将前端构建产物超预算风险转为可分派治理任务，驱动大包拆分、移动端首屏优化和 AI 辅助重构。",
            "source": "system_frontend_performance",
            "api": "/api/v1/system/pages/frontend-performance/tasks",
            "cli": "sop pages frontend-performance-tasks --dry-run --json",
            "task_center": SYSTEM_TASK_CENTER_ROUTE,
        },
    }


@router.post("/experience-review/tasks")
def system_page_experience_tasks(body: ExperienceTaskIn) -> dict[str, Any]:
    status = body.status if body.status in {"all", "simple", "watch", "complex"} else "watch"
    payload = _module_experience_review_payload(
        domain=body.domain if body.domain and body.domain != "all" else None,
        status=status,
        q=body.q,
    )
    rows = payload.get("items") or []
    selected = {str(x) for x in body.ids or [] if str(x).strip()}
    if selected:
        rows = [item for item in rows if str(item.get("id") or "") in selected]
    if not body.include_simple and status != "simple":
        rows = [item for item in rows if str(item.get("status") or "") != "simple"]
    rows = rows[: max(1, min(int(body.max_items or 12), 100))]
    existing_ids = _existing_experience_task_ids()
    planned: list[dict[str, Any]] = []
    created: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for item in rows:
        payload_item = _experience_task_payload(item, priority=body.priority, assigned_to=body.assigned_to)
        report_id = str(payload_item.get("source_report_id") or "")
        if report_id in existing_ids:
            skipped.append({"id": str(item.get("id") or ""), "reason": "task_exists", "title": payload_item["title"]})
            continue
        planned.append(payload_item)
        if not body.dry_run:
            created.append(create_task(TaskCreate(**payload_item)))
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "filters": {
            "ids": sorted(selected),
            "domain": body.domain or "all",
            "status": status,
            "q": body.q,
            "include_simple": body.include_simple,
        },
        "planned": planned,
        "created": created,
        "skipped": skipped,
        "summary": {"planned": len(planned), "created": len(created), "skipped": len(skipped)},
        "agent_consumption": {
            "purpose": "把 SystemMap 体验治理中的 complex/watch 模块转成可由设计、前端和 AI Agent 领取的优化任务。",
            "source": "system_page_experience",
            "api": "/api/v1/system/pages/experience-review/tasks",
            "cli": "sop pages experience-tasks --dry-run --json",
        },
    }


@router.post("/readiness/tasks")
def system_page_readiness_tasks(body: ReadinessTaskIn) -> dict[str, Any]:
    status = body.status if body.status in {"all", "complete", "watch", "risk"} else "watch"
    payload = _module_readiness_payload(
        domain=body.domain if body.domain and body.domain != "all" else None,
        status=status,
        q=body.q,
    )
    rows = payload.get("items") or []
    selected = {str(x) for x in body.ids or [] if str(x).strip()}
    if selected:
        rows = [item for item in rows if str(item.get("id") or "") in selected]
    if not body.include_complete and status != "complete":
        rows = [item for item in rows if str(item.get("status") or "") != "complete"]
    rows = rows[: max(1, min(int(body.max_items or 12), 100))]
    existing_ids = _existing_readiness_task_ids()
    planned: list[dict[str, Any]] = []
    created: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for item in rows:
        payload_item = _readiness_task_payload(item, priority=body.priority, assigned_to=body.assigned_to)
        report_id = str(payload_item.get("source_report_id") or "")
        if report_id in existing_ids:
            skipped.append({"id": str(item.get("id") or ""), "reason": "task_exists", "title": payload_item["title"]})
            continue
        planned.append(payload_item)
        if not body.dry_run:
            created.append(create_task(TaskCreate(**payload_item)))
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "filters": {
            "ids": sorted(selected),
            "domain": body.domain or "all",
            "status": status,
            "q": body.q,
            "include_complete": body.include_complete,
        },
        "planned": planned,
        "created": created,
        "skipped": skipped,
        "summary": {"planned": len(planned), "created": len(created), "skipped": len(skipped)},
        "agent_consumption": {
            "purpose": "把 SystemMap readiness 的 watch/risk 模块转成可由 AI CLI/Agent 领取的治理任务。",
            "source": "system_page_readiness",
            "api": "/api/v1/system/pages/readiness/tasks",
            "cli": "sop pages readiness-tasks --dry-run --json",
        },
    }


@router.get("/governance-tasks")
def system_pages_governance_tasks(
    status: str = "all",
    source: str = "all",
    q: str = "",
    limit: int = 50,
) -> dict[str, Any]:
    return _system_governance_tasks_payload(status=status, source=source, q=q, limit=limit)


@router.post("/governance-tasks/bulk-update")
def system_pages_governance_tasks_bulk_update(body: GovernanceTaskBulkUpdateIn) -> dict[str, Any]:
    return _system_governance_tasks_bulk_update_payload(body)


@router.get("/isolation-audit")
def system_pages_isolation_audit() -> dict[str, Any]:
    return _isolation_audit_payload()


@router.get("/isolation-audit/scan")
def system_pages_isolation_scan(status: str = "all", q: str = "") -> dict[str, Any]:
    return _isolation_source_scan_payload(q=q, status=status)


@router.get("/isolation-audit/scan/runs")
def system_pages_isolation_scan_runs(limit: int = 20) -> dict[str, Any]:
    rows = _read_isolation_scan_runs(limit=limit)
    risk_runs = sum(1 for item in rows if int((item.get("summary") or {}).get("risk") or 0) > 0)
    watch_runs = sum(1 for item in rows if int((item.get("summary") or {}).get("watch") or 0) > 0)
    return {
        "ok": True,
        "items": rows,
        "summary": {
            "total": len(rows),
            "risk_runs": risk_runs,
            "watch_runs": watch_runs,
            "latest_id": rows[0].get("id") if rows else None,
        },
        "agent_consumption": {
            "purpose": "读取 SystemMap 源代码隔离扫描快照历史，供人和 AI Agent 对比风险收敛趋势。",
            "api": "/api/v1/system/pages/isolation-audit/scan/runs",
            "cli": "sop pages isolation-scan-runs --json",
        },
    }


@router.get("/isolation-audit/scan/runs/compare")
def system_pages_isolation_scan_run_compare(
    base_id: str = "",
    target_id: str = "",
    q: str = "",
    status: str = "all",
) -> dict[str, Any]:
    safe_status = status if status in {"all", "protected", "watch", "risk"} else "all"
    return _isolation_scan_compare_payload(base_id=base_id, target_id=target_id, q=q, status=safe_status)


@router.post("/isolation-audit/scan/runs/compare/tasks")
def system_page_isolation_scan_compare_tasks(body: IsolationScanCompareTaskIn) -> dict[str, Any]:
    compare = _isolation_scan_compare_payload(
        base_id=body.base_id,
        target_id=body.target_id,
        q=body.q,
        status=body.status,
    )
    task_changes = {"new_risk", "regressed", "changed"}
    if body.include_resolved:
        task_changes.add("resolved")
    rows = [item for item in compare.get("items") or [] if str(item.get("change") or "") in task_changes]
    rows = rows[: max(1, min(int(body.max_items or 12), 100))]
    existing_ids = _existing_isolation_scan_compare_task_ids()
    planned: list[dict[str, Any]] = []
    created: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for item in rows:
        payload_item = _isolation_scan_compare_task_payload(item, priority=body.priority, assigned_to=body.assigned_to)
        report_id = str(payload_item.get("source_report_id") or "")
        if report_id in existing_ids:
            skipped.append({"id": str(item.get("id") or ""), "reason": "task_exists", "title": payload_item["title"]})
            continue
        planned.append(payload_item)
        if not body.dry_run:
            created.append(create_task(TaskCreate(**payload_item)))
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "filters": {
            "base_id": body.base_id,
            "target_id": body.target_id,
            "status": body.status,
            "q": body.q,
            "include_resolved": body.include_resolved,
        },
        "compare_summary": compare.get("summary") or {},
        "planned": planned,
        "created": created,
        "skipped": skipped,
        "summary": {"planned": len(planned), "created": len(created), "skipped": len(skipped)},
        "agent_consumption": {
            "purpose": "把源码隔离智能基线对比中的新增风险、回退和变化项转成可由 SecurityAgent/Codex 领取的治理任务。",
            "source": "system_page_isolation_scan_compare",
            "api": "/api/v1/system/pages/isolation-audit/scan/runs/compare/tasks",
            "cli": "sop pages isolation-scan-compare-tasks --dry-run --json",
        },
    }


@router.post("/isolation-audit/scan/runs")
def system_page_isolation_scan_run_create(body: IsolationScanRunIn) -> dict[str, Any]:
    scan = _isolation_source_scan_payload(q=body.q, status=body.status)
    findings = list(scan.get("items") or [])[: max(1, min(int(body.max_items or 20), 100))]
    run = {
        "id": f"isolation-scan-run-{uuid4().hex[:12]}",
        "created_at": _utc_now(),
        "created_by": body.created_by.strip() or "SystemMap",
        "note": body.note.strip(),
        "filters": scan.get("filters") or {"q": body.q, "status": body.status},
        "summary": scan.get("summary") or {},
        "findings": findings,
        "agent_consumption": {
            "source_api": "/api/v1/system/pages/isolation-audit/scan",
            "task_api": "/api/v1/system/pages/isolation-audit/scan/tasks",
            "history_api": "/api/v1/system/pages/isolation-audit/scan/runs",
            "history_cli": "sop pages isolation-scan-runs --json",
        },
    }
    _append_isolation_scan_run(run)
    return {
        "ok": True,
        "run": run,
        "agent_consumption": {
            "purpose": "保存一次源代码隔离扫描快照，作为模块治理、安全回归和 Agent 任务化的审计基线。",
            "api": "/api/v1/system/pages/isolation-audit/scan/runs",
            "cli": "sop pages isolation-scan-run --q <keyword> --json",
        },
    }


@router.post("/isolation-audit/scan/tasks")
def system_page_isolation_scan_tasks(body: IsolationScanTaskIn) -> dict[str, Any]:
    scan = _isolation_source_scan_payload(q=body.q, status=body.status)
    rows = list(scan.get("items") or [])
    if not body.include_protected and body.status != "protected":
        rows = [item for item in rows if str(item.get("status") or "") != "protected"]
    selected = {str(x).strip().replace("source:", "") for x in body.ids or [] if str(x).strip()}
    if selected:
        rows = [
            item
            for item in rows
            if str(item.get("module") or "") in selected or str(item.get("id") or "").replace("source:", "") in selected
        ]
    rows = rows[: max(1, min(int(body.max_items or 12), 100))]
    existing_ids = _existing_isolation_scan_task_ids()
    planned: list[dict[str, Any]] = []
    created: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    for item in rows:
        payload_item = _isolation_scan_task_payload(item, priority=body.priority, assigned_to=body.assigned_to)
        report_id = str(payload_item.get("source_report_id") or "")
        if report_id in existing_ids:
            skipped.append({"id": str(item.get("id") or ""), "reason": "task_exists", "title": payload_item["title"]})
            continue
        planned.append(payload_item)
        if not body.dry_run:
            created.append(create_task(TaskCreate(**payload_item)))
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "filters": {
            "ids": sorted(selected),
            "status": body.status,
            "q": body.q,
            "include_protected": body.include_protected,
        },
        "planned": planned,
        "created": created,
        "skipped": skipped,
        "summary": {"planned": len(planned), "created": len(created), "skipped": len(skipped)},
        "agent_consumption": {
            "purpose": "把 SystemMap 源代码隔离扫描项转成可由 SecurityAgent/Codex 领取的源码加固任务。",
            "source": "system_page_isolation_scan",
            "api": "/api/v1/system/pages/isolation-audit/scan/tasks",
            "cli": "sop pages isolation-scan-tasks --dry-run --json",
        },
    }


@router.post("/isolation-audit/tasks")
def system_page_isolation_tasks(body: IsolationTaskIn) -> dict[str, Any]:
    audit = _isolation_audit_payload()
    rows = list(audit.get("domains") or [])
    if body.status and body.status != "all":
        rows = [item for item in rows if str(item.get("status") or "") == body.status]
    if not body.include_protected and body.status != "protected":
        rows = [item for item in rows if str(item.get("status") or "") != "protected"]
    selected = {str(x).strip() for x in body.ids or [] if str(x).strip()}
    if selected:
        rows = [item for item in rows if str(item.get("id") or "") in selected]
    query = (body.q or "").strip().lower()
    if query:
        rows = [
            item
            for item in rows
            if query
            in " ".join(
                [
                    str(item.get("id") or ""),
                    str(item.get("name") or ""),
                    str(item.get("module") or ""),
                    str(item.get("storage") or ""),
                    str(item.get("guard") or ""),
                    " ".join(str(x) for x in item.get("scope_fields") or []),
                    " ".join(str(x) for x in item.get("tests") or []),
                ]
            ).lower()
        ]
    rows = rows[: max(1, min(int(body.max_items or 12), 100))]
    existing_ids = _existing_isolation_task_ids()
    planned: list[dict[str, Any]] = []
    created: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    scope_contract = audit.get("scope_contract") or {}
    for item in rows:
        payload_item = _isolation_task_payload(item, scope_contract=scope_contract, priority=body.priority, assigned_to=body.assigned_to)
        report_id = str(payload_item.get("source_report_id") or "")
        if report_id in existing_ids:
            skipped.append({"id": str(item.get("id") or ""), "reason": "task_exists", "title": payload_item["title"]})
            continue
        planned.append(payload_item)
        if not body.dry_run:
            created.append(create_task(TaskCreate(**payload_item)))
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "filters": {
            "ids": sorted(selected),
            "status": body.status,
            "q": body.q,
            "include_protected": body.include_protected,
        },
        "planned": planned,
        "created": created,
        "skipped": skipped,
        "summary": {"planned": len(planned), "created": len(created), "skipped": len(skipped)},
        "agent_consumption": {
            "purpose": "把 SystemMap 三码隔离审计项转成可由 AI CLI/Agent 领取的安全治理任务。",
            "source": "system_page_isolation",
            "api": "/api/v1/system/pages/isolation-audit/tasks",
            "cli": "sop pages isolation-tasks --dry-run --json",
        },
    }


@router.get("/menu/preferences/me")
def system_page_menu_preferences_me(user: User = Depends(current_user)) -> dict[str, Any]:
    return _menu_preferences_payload(user)


@router.put("/menu/preferences/me")
def system_page_menu_preferences_update(body: MenuPreferencesIn, user: User = Depends(current_user)) -> dict[str, Any]:
    return _write_menu_preferences(user, body)


@router.get("/capabilities")
def system_page_capabilities() -> dict[str, Any]:
    react = _enrich_pages(REACT_PAGES)
    registry = _capability_registry(react)
    return _capability_payload(registry)


@router.get("/capabilities/me")
def system_page_capabilities_me(user: User = Depends(current_user)) -> dict[str, Any]:
    react = _enrich_pages(REACT_PAGES)
    registry = _capability_registry(react)
    return _capability_payload(registry, role=user.role)


@router.post("/capabilities/check")
def system_page_capabilities_check(body: CapabilityCheckIn, user: User = Depends(current_user)) -> dict[str, Any]:
    react = _enrich_pages(REACT_PAGES)
    registry = _capability_registry(react)
    item = next((x for x in registry if x.get("capability") == body.capability), None)
    if not item:
        return {
            "ok": True,
            "allowed": False,
            "reason": "unknown_capability",
            "role": user.role,
            "capability": body.capability,
            "action": body.action,
        }
    return {
        "ok": True,
        "allowed": _action_allowed(item, user.role, body.action),
        "reason": "matched_policy",
        "role": user.role,
        "capability": body.capability,
        "action": body.action,
        "item": item,
    }


@router.post("/backlog/tasks")
def system_page_backlog_tasks(body: BacklogTaskIn) -> dict[str, Any]:
    legacy_all = _enrich_pages(LEGACY_PAGES)
    backlog = _migration_backlog(legacy_all, limit=100)
    selected = set(body.ids or [])
    if selected:
        backlog = [item for item in backlog if str(item.get("id")) in selected]
    existing_ids = _existing_backlog_task_ids()
    planned = []
    skipped = []
    created = []
    for item in backlog:
        item_id = str(item.get("id") or "")
        payload = _backlog_task_payload(item, priority=body.priority, assigned_to=body.assigned_to)
        if item_id in existing_ids:
            skipped.append({"id": item_id, "reason": "task_exists", "title": payload["title"]})
            continue
        planned.append(payload)
        if not body.dry_run:
            created.append(create_task(TaskCreate(**payload)))
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "planned": planned,
        "created": created,
        "skipped": skipped,
        "summary": {"planned": len(planned), "created": len(created), "skipped": len(skipped)},
    }


@router.get("/legacy/migration-plan")
def system_pages_legacy_migration_plan() -> dict[str, Any]:
    legacy_all = _enrich_pages(LEGACY_PAGES)
    plan = _legacy_migration_plan(legacy_all)
    return {
        "ok": True,
        "strategy": "以新平台模块为主入口，按页面地图注册表承接 legacy 能力；每项能力必须按新交互补齐 API、权限、AI surface、审计和任务化验收。",
        "plan": plan,
        "backlog": _migration_backlog(legacy_all, limit=100),
    }


@router.get("/legacy/{console_id}")
def system_page_legacy(console_id: str) -> dict[str, Any]:
    normalized = console_id.strip().lower()
    legacy_all = _enrich_pages(LEGACY_PAGES)
    item = next(
        (
            row
            for row in legacy_all
            if str(row.get("console_id") or "").lower() == normalized
            or str(row.get("id") or "").lower() == normalized
        ),
        None,
    )
    if not item:
        item = next((row for row in legacy_all if str(row.get("console_id") or row.get("id")) == "dashboard"), None)
    return {
        "ok": item is not None,
        "id": console_id,
        "item": item,
        "items": legacy_all,
        "summary": _legacy_cockpit_summary(legacy_all),
        "migration": {
            "bridge_path": f"#/legacy/{console_id}",
            "console_path": item.get("path") if item else "/console.html",
            "target": item.get("target") if item else "#/dashboard",
        },
    }


@router.get("")
def system_pages(
    view: str = "all",
    domain: str | None = None,
    status: str | None = None,
    q: str | None = None,
) -> dict[str, Any]:
    if view not in {"all", "react", "legacy"}:
        view = "all"
    react_all = _enrich_pages(REACT_PAGES)
    legacy_all = _enrich_pages(LEGACY_PAGES)
    react = _filter_pages(react_all, domain=domain, status=status, q=q)
    legacy = _filter_pages(legacy_all, domain=domain, status=status, q=q)
    items = [*react, *legacy]
    if view == "react":
        items = react
    elif view == "legacy":
        items = legacy
    return {
        "ok": True,
        "domains": DOMAINS,
        "domain_matrix": _domain_matrix(REACT_PAGES, LEGACY_PAGES),
        "capability_registry": _capability_registry(react_all),
        "react": react,
        "legacy": legacy,
        "items": items,
        "summary": {
            "all": _summary(items),
            "react": _summary(react),
            "legacy": _summary(legacy),
        },
        "validation": _registry_validation(),
        "menu_health": _menu_health(),
        "governance": _governance_status(react_all, legacy_all),
        "active_filters": {
            "view": view,
            "domain": domain or "all",
            "status": status or "all",
            "q": q or "",
        },
        "migration": {
            "strategy": "New platform modules are the default workbench; legacy entries are capability references until each target module reaches maturity >= 85.",
            "default_entry_target": "/?shell=1#/dashboard",
            "legacy_entry": "/console.html",
            "backlog": _migration_backlog(legacy_all),
        },
    }
