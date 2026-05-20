"""系统页面能力地图：新平台模块、细粒度能力权限与 legacy 能力承接注册表。"""
from __future__ import annotations

import json
import hashlib
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from sop_manager.path_config import resolved_ai_memory_root
from .auth_sql import USER_ROLES, User, current_user
from .tasks import TaskCreate, create_task, list_tasks

router = APIRouter(prefix="/api/v1/system/pages", tags=["system-pages"])


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
        "module_ids": ["analytics", "analyticsCatalog", "analyticsReports", "analyticsLineage", "dataExchange", "dataSources", "dataIngest", "dataQualityCenter", "metricsCenter", "tagService", "dataDev"],
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
    "organization": [("tenant_users", "租户成员"), ("business_lines", "业务线"), ("project_members", "项目成员"), ("role_policy", "角色策略"), ("access_review", "权限体检")],
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
    "dataMetricsTags": [("metric_definitions", "指标口径"), ("tag_rules", "标签规则"), ("ownership", "负责人")],
    "dataServices": [("service_catalog", "服务目录"), ("publishing", "发布管理"), ("health", "健康检查")],
    "dataQuality": [("alerts", "质量告警"), ("notify", "通知"), ("fix_tasks", "修复任务")],
    "dataDevelopment": [("templates", "开发模板"), ("schedules", "调度历史"), ("agent_feed", "Agent Feed"), ("evidence", "质量证据"), ("runbook", "Runbook")],
    "analyticsLineage": [("lineage_graph", "血缘图谱"), ("impact_analysis", "影响分析"), ("dataset_relation", "数据集关系")],
    "dataExchange": [("export_jobs", "导出作业"), ("import_jobs", "导入作业"), ("preview_merge", "导入预检"), ("archive", "归档治理")],
    "analyticsNlq": [("natural_query", "自然语言问数"), ("semantic_context", "语义上下文"), ("save_report", "保存报告")],
    "copilot": [("chat", "会话问答"), ("commands", "命令中心"), ("tool_plan", "工具计划"), ("plan_to_tasks", "计划转任务")],
    "intelligence": [("knowledge", "知识库"), ("rag", "RAG 检索"), ("memory", "记忆"), ("rules", "规则"), ("distill", "蒸馏审核"), ("specs", "规范文档"), ("design_docs", "技术方案"), ("datasources", "数据源"), ("worker", "WorkerOps"), ("sync", "SyncOps"), ("events", "事件流水"), ("usage", "用量治理")],
    "knowledgeBase": [("documents", "知识文档"), ("index", "索引"), ("search", "检索")],
    "ragSearch": [("retrieval", "检索增强"), ("citations", "引用证据"), ("prompt_context", "提示词上下文")],
    "aiMemory": [("recent", "最近记忆"), ("search", "记忆检索"), ("attach_run", "运行挂载")],
    "ruleCenter": [("proposals", "规则提案"), ("apply", "规则应用"), ("sync", "规则同步")],
    "reflectionDistill": [("run", "蒸馏运行"), ("proposal_review", "提案审核"), ("rule_apply", "规则入库")],
    "workerOps": [("job_types", "任务类型"), ("enqueue", "任务投递"), ("monitor", "运行监控")],
    "syncOps": [("modules", "同步模块"), ("pull", "拉取预览"), ("asset_push", "资产推送")],
    "eventStream": [("cloud_events", "CloudEvents"), ("sync_events", "同步事件"), ("agent_events", "Agent 事件")],
    "usageOps": [("quota", "配额"), ("alerts", "告警"), ("governance_tasks", "治理任务")],
    "platforms": [("tool_profiles", "工具接入"), ("mcp_hub", "MCP Hub"), ("agents", "Agent 注册"), ("agent_runs", "Agent 运行中心"), ("models", "模型管理"), ("ops", "运行治理"), ("a2a", "A2A 专家组")],
    "marketplace": [("catalog", "资产目录"), ("installed", "已安装资产"), ("rating", "评分反馈"), ("signature", "签名状态")],
    "notify": [("connectors", "连接器"), ("channels", "通道模板"), ("outbound", "出站消息"), ("inbound", "入站消息"), ("messages", "消息流水"), ("action_conversion", "消息转任务/需求")],
    "audit": [("hash_chain", "审计哈希链"), ("events", "事件检索"), ("module_actions", "模块动作审计"), ("approvals", "动作审批"), ("export", "合规导出")],
    "systemMap": [("registry", "页面注册表"), ("manifest", "模块 Manifest"), ("capabilities", "能力权限"), ("actions", "动作目录"), ("legacy", "Legacy 收敛"), ("migration", "迁移任务")],
    "settings": [("account", "账户会话"), ("runtime", "运行状态"), ("sso", "企业 SSO"), ("billing", "商业计费"), ("profiles", "环境 Profile"), ("observability", "日志观测")],
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
    ("copilot", "chat"): "#/copilot/chat",
    ("copilot", "commands"): "#/copilot/commands",
    ("copilot", "tool_plan"): "#/copilot/tool-plan",
    ("intelligence", "knowledge"): "#/intelligence/kb",
    ("intelligence", "rag"): "#/intelligence/rag",
    ("intelligence", "memory"): "#/intelligence/memory",
    ("intelligence", "rules"): "#/intelligence/rules",
    ("intelligence", "distill"): "#/intelligence/distill",
    ("intelligence", "specs"): "#/intelligence/specs",
    ("intelligence", "design_docs"): "#/intelligence/design-docs",
    ("intelligence", "datasources"): "#/intelligence/datasources",
    ("intelligence", "worker"): "#/intelligence/worker",
    ("intelligence", "sync"): "#/intelligence/sync",
    ("intelligence", "events"): "#/intelligence/events",
    ("intelligence", "usage"): "#/intelligence/usage",
    ("platforms", "tool_profiles"): "#/platforms/tools",
    ("platforms", "mcp_hub"): "#/platforms/mcp",
    ("platforms", "agents"): "#/platforms/agents",
    ("platforms", "agent_runs"): "#/platforms/agent-runs",
    ("platforms", "models"): "#/platforms/models",
    ("platforms", "ops"): "#/platforms/ops",
    ("marketplace", "catalog"): "#/marketplace/catalog",
    ("marketplace", "installed"): "#/marketplace/installed",
    ("marketplace", "rating"): "#/marketplace/ratings",
    ("notify", "channels"): "#/notify/channels",
    ("notify", "outbound"): "#/notify/outbound",
    ("notify", "inbound"): "#/notify/inbound",
    ("notify", "connectors"): "#/notify/connectors",
    ("notify", "messages"): "#/notify/messages",
    ("audit", "hash_chain"): "#/audit/chain",
    ("audit", "events"): "#/audit/events",
    ("audit", "module_actions"): "#/audit/module-actions",
    ("audit", "approvals"): "#/audit/approvals",
    ("systemMap", "registry"): "#/system-map/registry",
    ("systemMap", "manifest"): "#/system-map/manifest",
    ("systemMap", "capabilities"): "#/system-map/capabilities",
    ("systemMap", "actions"): "#/system-map/actions",
    ("settings", "account"): "#/settings/account",
    ("settings", "runtime"): "#/settings/runtime",
    ("settings", "sso"): "#/settings/sso",
    ("settings", "billing"): "#/settings/billing",
    ("settings", "profiles"): "#/settings/profiles",
    ("settings", "observability"): "#/settings/observability",
}


def _submodules_for(page_id: str, capability: str, policies: dict[str, list[str]]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for sub_id, name in SUBMODULES_BY_PAGE.get(page_id, []):
        sub_cap = f"{capability}.{sub_id}"
        path = SUBMODULE_PATHS.get((page_id, sub_id), f"#/{page_id}/{sub_id}")
        rows.append(
            {
                "id": sub_id,
                "name": name,
                "path": path,
                "capability": sub_cap,
                "actions": [
                    {"id": "read", "name": "查看", "capability": f"{sub_cap}.read", "roles": policies["read"]},
                    {"id": "write", "name": "编辑", "capability": f"{sub_cap}.write", "roles": policies["write"]},
                    {"id": "admin", "name": "管理", "capability": f"{sub_cap}.admin", "roles": policies["admin"]},
                ],
            }
        )
    return rows


class BacklogTaskIn(BaseModel):
    ids: list[str] = Field(default_factory=list)
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = "Coder"


class GovernanceTaskIn(BaseModel):
    scope: str = Field("all", pattern="^(all|registry_consistency|legacy_convergence|module_permission_ai|module_maturity)$")
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = "Coder"
    max_items: int = Field(12, ge=1, le=100)


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
    {"id": "dataMetricsTags", "path": "#/analytics/catalog/metrics", "domain": "data", "capability": "data.analytics.catalog.metrics"},
    {"id": "dataServices", "path": "#/analytics/catalog/services", "domain": "data", "capability": "data.analytics.catalog.services"},
    {"id": "dataQuality", "path": "#/analytics/catalog/quality", "domain": "data", "capability": "data.analytics.catalog.quality"},
    {"id": "dataDevelopment", "path": "#/analytics/catalog/development", "domain": "data", "capability": "data.analytics.catalog.development"},
    {"id": "analyticsLineage", "path": "#/analytics/lineage", "domain": "data", "capability": "data.analytics.lineage"},
    {"id": "dataExchange", "path": "#/analytics/exchange", "domain": "data", "capability": "data.exchange"},
    {"id": "analyticsNlq", "path": "#/analytics/nlq", "domain": "data", "capability": "data.analytics.nlq"},
    {"id": "copilot", "path": "#/copilot", "domain": "ai", "capability": "ai.copilot"},
    {"id": "vibe", "path": "#/vibe", "domain": "ai", "capability": "ai.vibe"},
    {"id": "globalSearch", "path": "#/search", "domain": "ai", "capability": "ai.search"},
    {"id": "intelligence", "path": "#/intelligence", "domain": "ai", "capability": "ai.intelligence"},
    {"id": "knowledgeBase", "path": "#/intelligence/kb", "domain": "ai", "capability": "ai.intelligence.knowledge"},
    {"id": "ragSearch", "path": "#/intelligence/rag", "domain": "ai", "capability": "ai.intelligence.rag"},
    {"id": "aiMemory", "path": "#/intelligence/memory", "domain": "ai", "capability": "ai.intelligence.memory"},
    {"id": "ruleCenter", "path": "#/intelligence/rules", "domain": "ai", "capability": "ai.intelligence.rules"},
    {"id": "reflectionDistill", "path": "#/intelligence/distill", "domain": "ai", "capability": "ai.intelligence.distill"},
    {"id": "specs", "path": "#/intelligence/specs", "domain": "ai", "capability": "ai.intelligence.specs"},
    {"id": "designDocs", "path": "#/intelligence/design-docs", "domain": "ai", "capability": "ai.intelligence.design-docs"},
    {"id": "dataSources", "path": "#/intelligence/datasources", "domain": "ai", "capability": "ai.intelligence.datasources"},
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
    {"id": "platformOps", "path": "#/platforms/ops", "domain": "ecosystem", "capability": "ecosystem.platforms.ops"},
    {"id": "cliTools", "path": "#/platforms/cli", "domain": "ecosystem", "capability": "ecosystem.platforms.cli"},
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
    {"id": "webhooks", "path": "#/notify/webhooks", "domain": "ecosystem", "capability": "ecosystem.notify.webhooks"},
    {"id": "audit", "path": "#/audit", "domain": "governance", "capability": "governance.audit"},
    {"id": "systemMap", "path": "#/system-map", "domain": "governance", "capability": "governance.system-map"},
    {"id": "settings", "path": "#/settings", "domain": "system", "capability": "system.settings"},
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
    {"id": "organization", "name": "组织权限", "domain": "portfolio", "path": "#/organization", "status": "active", "maturity": 86, "apis": ["/api/v1/organization/summary", "/api/v1/organization/policy", "/api/v1/organization/access-review", "/api/v1/auth/users", "/api/v1/businesses", "/api/v1/projects/{id}/members"], "capabilities": ["组织摘要", "租户成员", "业务线", "项目成员", "角色策略", "权限体检", "治理任务"], "next": ["ABAC 策略", "审批流联动"]},
    {"id": "analytics", "name": "指标概览", "domain": "data", "path": "#/analytics", "status": "active", "maturity": 92, "apis": ["/api/v1/analytics/overview"], "capabilities": ["项目指标摘要", "关键指标快照", "原始指标 JSON"], "next": ["指标权限", "趋势图", "异常阈值"]},
    {"id": "analyticsBlueprint", "name": "数据智能蓝图", "domain": "data", "path": "#/analytics/blueprint", "status": "active", "maturity": 82, "apis": ["/api/v1/analytics/blueprint", "/api/v1/analytics/blueprint/summary", "/api/v1/analytics/blueprint/charts", "/api/v1/analytics/blueprint/tasks"], "capabilities": ["数据能力地图", "成熟度评估", "技术栈矩阵", "缺口任务化"], "next": ["质量中心", "指标/标签任务模板"]},
    {"id": "analyticsReports", "name": "洞察报告", "domain": "data", "path": "#/analytics/reports", "status": "active", "maturity": 96, "apis": ["/api/v1/analytics/reports", "/api/v1/analytics/reports/summary", "/api/v1/analytics/reports/charts", "/api/v1/analytics/report-subscription", "/api/v1/analytics/report-subscription/test", "/api/v1/analytics/reports/{id}/status", "/api/v1/analytics/reports/{id}/meta", "/api/v1/analytics/reports/{id}/action-tasks", "/api/v1/analytics/reports/{id}.md", "/api/v1/analytics/reports/{id}/notify"], "capabilities": ["洞察报告沉淀", "报告运营摘要", "报告搜索筛选", "报告资产元数据治理", "报告生成执行任务", "报告发布归档", "Markdown 导出", "报告通知发送", "报告订阅策略", "订阅通道测试"], "next": ["报告订阅调度", "报告权限", "AI 自动洞察"]},
    {"id": "analyticsCatalog", "name": "数据资产治理中心", "domain": "data", "path": "#/analytics/catalog", "status": "active", "maturity": 88, "apis": ["/api/v1/analytics/governance/hub", "/api/v1/analytics/export.csv"], "capabilities": ["治理中心", "四层能力栈", "五大专业域入口", "CSV 导出"], "next": ["对接湖仓元数据", "指标变更审核"]},
    {"id": "dataAssets", "name": "数据资产", "domain": "data", "path": "#/analytics/catalog/assets", "status": "active", "maturity": 84, "apis": ["/api/v1/analytics/assets", "/api/v1/analytics/quality/evaluate", "/api/v1/analytics/governance/tasks"], "capabilities": ["资产目录", "状态治理", "质量评估", "治理任务化"], "next": ["资产详情页", "字段级血缘"]},
    {"id": "dataMetricsTags", "name": "指标与标签", "domain": "data", "path": "#/analytics/catalog/metrics", "status": "active", "maturity": 83, "apis": ["/api/v1/analytics/metrics", "/api/v1/analytics/tags"], "capabilities": ["指标口径", "标签规则", "负责人治理", "目录维护"], "next": ["指标审批", "标签试算"]},
    {"id": "dataServices", "name": "数据服务", "domain": "data", "path": "#/analytics/catalog/services", "status": "active", "maturity": 84, "apis": ["/api/v1/analytics/services", "/api/v1/analytics/services/{id}/publish"], "capabilities": ["服务目录", "发布暂停", "健康评分", "消费者管理"], "next": ["服务 SLA", "调用日志"]},
    {"id": "dataQuality", "name": "质量告警", "domain": "data", "path": "#/analytics/catalog/quality", "status": "active", "maturity": 84, "apis": ["/api/v1/analytics/quality/alerts", "/api/v1/analytics/quality/alerts/tasks"], "capabilities": ["质量告警", "告警任务化", "通知处置"], "next": ["告警订阅", "根因分析"]},
    {"id": "dataDevelopment", "name": "数据开发", "domain": "data", "path": "#/analytics/catalog/development", "status": "active", "maturity": 86, "apis": ["/api/v1/analytics/development/templates", "/api/v1/analytics/development/schedule", "/api/v1/analytics/development/agent-feed", "/api/v1/analytics/development/evidence", "/api/v1/analytics/development/runbook"], "capabilities": ["开发模板", "智能调度", "Agent Feed", "质量证据", "自动化 Runbook"], "next": ["Runbook 历史", "开发 DAG 可视化"]},
    {"id": "analyticsLineage", "name": "数据血缘", "domain": "data", "path": "#/analytics/lineage", "status": "active", "maturity": 85, "apis": ["/api/v1/analytics/lineage", "/api/v1/analytics/lineage/impact"], "capabilities": ["血缘图谱", "影响分析", "上下游追溯", "节点筛选"], "next": ["血缘权限", "变更订阅"]},
    {"id": "dataExchange", "name": "数据交换", "domain": "data", "path": "#/analytics/exchange", "status": "active", "maturity": 88, "apis": ["/api/v1/data-exchange/summary", "/api/v1/data-exchange/charts", "/api/v1/data-exchange/export", "/api/v1/data-exchange/preview", "/api/v1/data-exchange/import", "/api/v1/data-exchange/jobs", "/api/v1/data-exchange/export-job"], "capabilities": ["数据港导入导出", "导入预检", "数据交换作业流水", "选择模块导出"], "next": ["导入任务异步化", "对象存储归档", "跨项目数据服务联邦"]},
    {"id": "analyticsNlq", "name": "NLQ 问数", "domain": "data", "path": "#/analytics/nlq", "status": "active", "maturity": 82, "apis": ["/api/v1/analytics/nlq", "/api/v1/analytics/overview"], "capabilities": ["自然语言问数", "LLM 指标解释", "问答保存为报告"], "next": ["指标语义层", "权限感知 NLQ", "SQL 生成审计"]},
    {"id": "notify", "name": "通信集成", "domain": "ecosystem", "path": "#/notify", "status": "active", "maturity": 84, "apis": ["/api/v1/notify/hub", "/api/v1/notify/summary", "/api/v1/notify/charts", "/api/v1/notify/timeline", "/api/v1/notify/connectors", "/api/v1/notify/channels", "/api/v1/notify/messages", "/api/v1/notify/inbound"], "capabilities": ["连接器矩阵", "通道摘要", "消息时间线", "统一通道模板", "出站发送", "入站记录", "通道测试", "入站转需求/任务", "独立子路由"], "next": ["Agent 自动订阅策略", "消息重试策略"]},
    {"id": "notifyConnectors", "name": "连接器矩阵", "domain": "ecosystem", "path": "#/notify/connectors", "status": "active", "maturity": 84, "apis": ["/api/v1/notify/connectors"], "capabilities": ["企业微信", "钉钉", "Webhook", "Slack", "签名模板"], "next": ["连接器健康探测"]},
    {"id": "notifyChannels", "name": "通道管理", "domain": "ecosystem", "path": "#/notify/channels", "status": "active", "maturity": 84, "apis": ["/api/v1/notify/channels"], "capabilities": ["通道列表", "启停配置", "模板配置"], "next": ["密钥托管"]},
    {"id": "notifyOutbound", "name": "出站发送", "domain": "ecosystem", "path": "#/notify/outbound", "status": "active", "maturity": 83, "apis": ["/api/v1/notify/send", "/api/v1/notify/messages"], "capabilities": ["发送测试", "通知草稿", "消息落账"], "next": ["重试策略"]},
    {"id": "notifyInbound", "name": "入站处置", "domain": "ecosystem", "path": "#/notify/inbound", "status": "active", "maturity": 83, "apis": ["/api/v1/notify/inbound", "/api/v1/notify/inbound/{message_id}/action"], "capabilities": ["入站消息", "转任务", "转需求", "处置审计"], "next": ["意图识别"]},
    {"id": "notifyMessages", "name": "消息流水", "domain": "ecosystem", "path": "#/notify/messages", "status": "active", "maturity": 82, "apis": ["/api/v1/notify/messages", "/api/v1/notify/timeline"], "capabilities": ["全量消息表", "方向筛选", "日聚合时间线", "入站处置入口"], "next": ["消息检索索引", "死信重试"]},
    {"id": "webhooks", "name": "Webhook", "domain": "ecosystem", "path": "#/notify/webhooks", "status": "active", "maturity": 88, "apis": ["/api/v1/webhooks", "/api/v1/webhooks/events", "/api/v1/webhooks/{id}/deliveries"], "capabilities": ["出站 Webhook", "事件订阅", "HMAC 签名", "投递测试", "投递时间线"], "next": ["重试策略可视化", "死信队列"]},
    {"id": "dataSources", "name": "数据源", "domain": "ai", "path": "#/intelligence/datasources", "status": "active", "maturity": 84, "apis": ["/api/v1/db-config/connections"], "capabilities": ["连接配置", "驱动目录", "连接测试"], "next": ["SecretRef", "SCIM 同步"]},
    {"id": "envOps", "name": "环境运维", "domain": "system", "path": "#/ops/env", "status": "active", "maturity": 86, "apis": ["/api/v1/env/check/full", "/api/v1/env/docker/ps"], "capabilities": ["环境检查", "Docker 列表", "Compose 入口"], "next": ["镜像构建 UI", "受控修复向导"]},
    {"id": "audit", "name": "安全审计", "domain": "governance", "path": "#/audit", "status": "active", "maturity": 90, "apis": ["/api/v1/audit/hub", "/api/v1/audit/chain/state", "/api/v1/audit/chain/verify", "/api/v1/audit/summary", "/api/v1/audit/charts", "/api/v1/audit/timeline", "/api/v1/audit/events", "/api/v1/audit/record", "/api/v1/audit/export.csv", "/api/v1/system/pages/actions/runs"], "capabilities": ["治理中心", "哈希链状态", "链校验", "ECharts 活动趋势", "动作/资源分布", "按日时间线", "合规 CSV 导出", "模块动作审计"], "next": ["合规报表模板", "风险规则告警", "对象存储 WORM 锚定"]},
    {"id": "copilot", "name": "AI 助手", "domain": "ai", "path": "#/copilot", "status": "active", "maturity": 82, "apis": ["/api/v1/copilot/hub", "/api/v1/copilot/ask", "/api/v1/copilot/sessions", "/api/v1/copilot/commands", "/api/v1/copilot/commands/resolve", "/api/v1/copilot/plan"], "capabilities": ["会话", "run_id", "项目上下文", "transcript", "全局 CmdK 命令中心", "工具调用计划"], "next": ["命令权限策略", "跨工具执行器", "更多页面操作注册"]},
    {"id": "vibe", "name": "Vibe Coding", "domain": "ai", "path": "#/vibe", "status": "active", "maturity": 86, "apis": ["/api/v1/vibe/sessions", "/api/v1/vibe/run", "/api/v1/vibe/templates"], "capabilities": ["编码会话", "CLI 执行", "模板", "附件上传"], "next": ["终端沙箱", "多模态增强"]},
    {"id": "globalSearch", "name": "全局搜索", "domain": "ai", "path": "#/search", "status": "active", "maturity": 92, "apis": ["/api/v1/search", "/api/v1/semantic-search", "/api/v1/semantic-search/status"], "capabilities": ["关键词检索", "语义向量检索", "混合检索", "索引健康", "设计文档/规约检索"], "next": ["跨项目联邦检索", "检索权限策略"]},
    {"id": "intelligence", "name": "智能与知识", "domain": "ai", "path": "#/intelligence", "status": "active", "maturity": 88, "apis": ["/api/v1/intelligence/hub", "/api/v1/knowledge", "/api/v1/rag/search", "/api/v1/memory", "/api/v1/reflections/proposals", "/api/v1/worker/jobs", "/api/v1/sync/summary"], "capabilities": ["治理中心", "知识库", "RAG", "记忆", "规则", "蒸馏审核", "WorkerOps", "SyncOps", "数据源", "事件", "用量"], "next": ["图谱 RAG", "Worker 真实执行器", "同步冲突合并"]},
    {"id": "knowledgeBase", "name": "知识库", "domain": "ai", "path": "#/intelligence/kb", "status": "active", "maturity": 86, "apis": ["/api/v1/knowledge"], "capabilities": ["知识文档", "索引", "检索", "分类标签"], "next": ["批量导入", "知识版本"]},
    {"id": "ragSearch", "name": "RAG 检索", "domain": "ai", "path": "#/intelligence/rag", "status": "active", "maturity": 84, "apis": ["/api/v1/rag/search"], "capabilities": ["检索增强", "引用证据", "提示词上下文"], "next": ["混合检索", "图谱 RAG"]},
    {"id": "aiMemory", "name": "AI 记忆", "domain": "ai", "path": "#/intelligence/memory", "status": "active", "maturity": 86, "apis": ["/api/v1/memory"], "capabilities": ["最近记忆", "记忆检索", "运行挂载", "本地优先同步"], "next": ["长期记忆压缩", "画像本体"]},
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
    {"id": "agentRuns", "name": "Agent 运行中心", "domain": "ecosystem", "path": "#/platforms/agent-runs", "status": "active", "maturity": 84, "apis": ["/api/v1/agents/runs", "/api/v1/agents/runs/summary", "/api/v1/tasks/agent-feed/claims", "/api/v1/tasks/{id}/agent-report"], "capabilities": ["运行列表", "能力画像", "活跃租约", "负载统计", "成功率", "最近心跳"], "next": ["Run 表持久化", "Agent SLO", "自动再平衡"]},
    {"id": "modelOps", "name": "模型管理", "domain": "ecosystem", "path": "#/platforms/models", "status": "active", "maturity": 85, "apis": ["/api/v1/models"], "capabilities": ["模型目录", "默认模型", "提供商连接", "角色绑定"], "next": ["模型评测", "成本路由"]},
    {"id": "platformOps", "name": "运行治理", "domain": "ecosystem", "path": "#/platforms/ops", "status": "active", "maturity": 86, "apis": ["/api/v1/platforms/ops-plan", "/api/v1/platforms/ops-tasks"], "capabilities": ["健康评分", "风险清单", "治理 Runbook", "AI 操作包", "治理任务预览", "治理任务落地"], "next": ["多工具 SLO", "Agent 执行审计", "自愈策略"]},
    {"id": "cliTools", "name": "CLI 工具", "domain": "ecosystem", "path": "#/platforms/cli", "status": "active", "maturity": 86, "apis": ["/api/v1/cli", "/api/v1/cli/run"], "capabilities": ["工具目录", "受控执行", "自定义工具", "安装提示"], "next": ["执行审计", "配额策略"]},
    {"id": "systemMap", "name": "模块治理", "domain": "governance", "path": "#/system-map", "status": "active", "maturity": 88, "apis": ["/api/v1/system/pages/hub", "/api/v1/system/pages", "/api/v1/system/pages/domains", "/api/v1/system/pages/manifest"], "capabilities": ["治理中心", "模块注册表", "能力地图", "legacy 能力承接", "域成熟度", "细粒度权限", "模块动作目录"], "next": ["页面插件清单", "按钮级权限矩阵"]},
    {"id": "settings", "name": "设置", "domain": "system", "path": "#/settings", "status": "active", "maturity": 92, "apis": ["/api/v1/auth/me", "/api/v1/health", "/api/v1/billing", "/api/v1/sso/config", "/api/v1/system/ops/profiles", "/api/v1/system/ops/observability", "/api/v1/system/ops/logs"], "capabilities": ["模块化系统配置", "账户", "运行状态", "日志观测", "事件摘要", "主题", "商业计费", "企业 SSO 配置", "SSO 组到角色映射", "SSO JIT 用户落库", "环境 Profile", "部署自检", "配置变更审计", "compose 覆盖文件生成"], "next": ["SSO SCIM 同步", "部署包版本化", "一键部署流水线", "Trace 关联检索"]},
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
    {"id": "db_config", "console_id": "db-config", "name": "数据库配置", "domain": "legacy-data", "path": "/console.html#db-config", "status": "active", "maturity": 84, "target": "#/intelligence/datasources", "next": ["SecretRef", "向量库联邦"]},
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
                "submodules": submodules,
                "submodule_count": len(submodules),
                "action_count": sum(len(row.get("actions", [])) for row in submodules),
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
            "chunk_strategy": ["react-vendor", "query-vendor", "ui-vendor", "icon-vendor", "i18n-vendor", "vendor", "route-chunks"],
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
            "name": "Hermes Portal",
            "positioning": "统一身份、统一上下文、统一菜单权限契约、统一微应用注册与运行治理的主应用控制面。",
            "mode": "portal_control_plane",
            "shell": "portal-only",
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
