"""
Hermes 平台架构控制面：把平台定位沉淀为可查询、可治理、可执行的能力蓝图。
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter
from pydantic import BaseModel, Field

from sop_manager.path_config import (
    resolved_business_code,
    resolved_project_code,
    resolved_project_id,
    resolved_tenant_code,
    resolved_tenant_id,
)

router = APIRouter(prefix="/api/v1/hermes", tags=["hermes"])


class BlueprintTaskIn(BaseModel):
    ids: list[str] = Field(default_factory=list, max_length=50)
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    assigned_to: str = "Platform Agent"
    dev_tool: str = "codex"


def _scope() -> dict[str, Any]:
    return {
        "tenant_id": resolved_tenant_id(),
        "tenant_code": resolved_tenant_code(),
        "business_code": resolved_business_code(),
        "project_id": resolved_project_id(),
        "project_code": resolved_project_code(),
        "isolation": [
            {"level": "tenant", "key": "tenant_code", "purpose": "企业/客户级数据、权限、账单和配置隔离"},
            {"level": "business", "key": "business_code", "purpose": "业务线级团队、资产、流程和指标隔离"},
            {"level": "project", "key": "project_id", "purpose": "研发项目级需求、任务、Agent、记忆和交付隔离"},
        ],
    }


def _capabilities() -> list[dict[str, Any]]:
    return [
        {
            "id": "idea.requirement",
            "domain": "product",
            "name": "想法/需求输入",
            "maturity": 82,
            "status": "active",
            "modules": ["requirements", "copilot", "knowledge", "rules"],
            "ai_surfaces": ["需求评审", "验收标准生成", "相似需求检测", "需求拆任务"],
            "next": "增强自然语言/文档/IM 多入口需求采集与结构化归档。",
        },
        {
            "id": "requirement.task",
            "domain": "delivery",
            "name": "需求到任务拆解",
            "maturity": 86,
            "status": "active",
            "modules": ["requirements", "tasks", "workflow"],
            "ai_surfaces": ["智能拆任务", "依赖生成", "优先级建议", "任务验收口径"],
            "next": "把拆解策略开放为可配置模板，支持团队/业务线定制。",
        },
        {
            "id": "task.dispatch",
            "domain": "ai",
            "name": "AI/CLI/Agent 智能分发",
            "maturity": 84,
            "status": "active",
            "modules": ["tasks", "agents", "platforms", "mcp"],
            "ai_surfaces": ["任务分发计划", "工具推荐", "Agent 角色推荐", "依赖阻塞识别", "Agent feed"],
            "next": "接入真实 Agent 能力画像、负载、成功率和工具健康度做动态路由。",
        },
        {
            "id": "scheduler.dag",
            "domain": "delivery",
            "name": "DAG 调度、质量卡点与事件唤醒",
            "maturity": 76,
            "status": "active",
            "modules": ["tasks", "workflows", "notify", "events", "agents"],
            "ai_surfaces": ["DAG 批次", "并发泳道", "质量卡点", "事件唤醒", "执行回写"],
            "next": "把调度策略升级为租户/业务线可配置策略，并接入 Agent 心跳、负载、SLA 与自动重试。",
        },
        {
            "id": "agent.execution",
            "domain": "ai",
            "name": "AI 执行与工具链",
            "maturity": 72,
            "status": "active",
            "modules": ["platforms", "mcp", "marketplace", "copilot"],
            "ai_surfaces": ["CLI/IDE 接入包", "MCP Hub", "Skill 市场", "模型路由", "WorkBuddy/OpenClaw/Hermes Agent 对接"],
            "next": "统一 A2A 协议、Agent 工作区沙箱、执行证据和失败自动恢复。",
        },
        {
            "id": "integration.omnichannel",
            "domain": "ecosystem",
            "name": "通信与外部服务集成",
            "maturity": 68,
            "status": "enhancing",
            "modules": ["notify", "webhook", "copilot", "tasks", "workflows"],
            "ai_surfaces": ["微信/钉钉/Slack 入站", "Webhook 事件", "WorkBuddy/OpenClaw/Hermes Agent", "入站转需求/任务"],
            "next": "补齐统一连接器注册、签名验签、事件映射、双向回调和连接健康监控。",
        },
        {
            "id": "workflow.ops",
            "domain": "delivery",
            "name": "流程编排/部署/运维",
            "maturity": 70,
            "status": "active",
            "modules": ["workflows", "settings", "worker", "notify"],
            "ai_surfaces": ["工作流启动", "批量取消", "部署 Profile", "告警入站转任务"],
            "next": "补齐部署流水线、运行环境拓扑、自动回滚和变更审批闭环。",
        },
        {
            "id": "observability.optimization",
            "domain": "governance",
            "name": "监控、审计与自动优化",
            "maturity": 76,
            "status": "active",
            "modules": ["audit", "usage", "dashboard", "system-map"],
            "ai_surfaces": ["审计事件任务化", "配额告警任务化", "风险看板", "模块治理动作"],
            "next": "引入 SLO、异常聚类、根因分析和自动修复建议。",
        },
        {
            "id": "data.insight",
            "domain": "data",
            "name": "数据开发、分析与决策",
            "maturity": 74,
            "status": "active",
            "modules": ["analytics", "data-exchange", "reports", "nlq"],
            "ai_surfaces": ["NLQ 问数", "洞察报告", "报告转任务", "订阅分发"],
            "next": "增强指标语义层、数据质量规则、血缘影响分析和智能决策建议。",
        },
        {
            "id": "governance.security",
            "domain": "governance",
            "name": "企业级安全、权限与商业化",
            "maturity": 80,
            "status": "active",
            "modules": ["organization", "sso", "billing", "capabilities"],
            "ai_surfaces": ["角色能力裁决", "SSO 映射", "商业化告警", "租户级隔离"],
            "next": "补齐 ABAC、细粒度数据权限、跨租户审计报表和企业策略模板。",
        },
    ]


def _technology_upgrades() -> list[dict[str, Any]]:
    return [
        {
            "id": "storage.oceanbase",
            "domain": "system",
            "name": "统一企业级主存储",
            "target_stack": ["OceanBase", "MySQL-compatible SQL", "tenant scoped schema"],
            "status": "target",
            "phase": "P0",
            "strategy": "以 OceanBase 作为 SaaS/私有化默认主存储，保留 SQLite 仅作本地开发模式。",
            "guardrails": ["所有业务表携带 tenant_code/business_code/project_id", "组合索引和审计字段标准化", "密钥使用 SecretRef"],
        },
        {
            "id": "data.lakehouse",
            "domain": "data",
            "name": "批流一体数据底座",
            "target_stack": ["Flink CDC", "Spark", "Paimon", "StarRocks", "Hologres", "Greenplum"],
            "status": "planned",
            "phase": "P1",
            "strategy": "将数据接入、数据开发、质量评估、指标服务和标签服务沉淀为统一数据智能控制面。",
            "guardrails": ["Schema Registry", "数据血缘", "质量 SLO", "告警转任务"],
        },
        {
            "id": "ai.memory.graph",
            "domain": "ai",
            "name": "知识图谱与多模态记忆",
            "target_stack": ["Lance", "OpenSearch", "Graph RAG", "Ontology Memory"],
            "status": "planned",
            "phase": "P1",
            "strategy": "将规约、代码、需求、运行证据、数据血缘统一进入知识/记忆层，让 Agent 可检索、可推理、可复用。",
            "guardrails": ["租户向量 namespace", "记忆生命周期", "敏感内容脱敏", "检索证据回传"],
        },
        {
            "id": "scheduler.temporal",
            "domain": "delivery",
            "name": "企业级调度与工作流内核",
            "target_stack": ["Temporal-ready WorkflowOps", "Redis Streams", "Outbox/DLQ", "CloudEvents"],
            "status": "enhancing",
            "phase": "P1",
            "strategy": "调度中心负责 AI 可消费任务包、DAG、事件唤醒、质量卡点；长事务工作流逐步接入 Temporal。",
            "guardrails": ["幂等键", "重试策略", "人工审批节点", "执行证据"],
        },
        {
            "id": "agent.runtime",
            "domain": "ecosystem",
            "name": "Agent/MCP/A2A 运行底座",
            "target_stack": ["sop-agentd", "MCP Hub", "A2A Gateway", "Skill Marketplace"],
            "status": "enhancing",
            "phase": "P0",
            "strategy": "统一 Agent 注册、能力画像、工具权限、心跳、任务领取和执行回写，服务 WorkBuddy/OpenClaw/Hermes Agent 接入。",
            "guardrails": ["工具白名单", "沙箱执行", "HMAC/JWT", "动作审计"],
        },
        {
            "id": "frontend.productized",
            "domain": "overview",
            "name": "产品化前端与模块治理",
            "target_stack": ["React 18", "Ant Design 6", "TanStack Query", "lazy route chunks"],
            "status": "active",
            "phase": "P0",
            "strategy": "以专业域菜单、模块 Manifest、细粒度 capability 和 AI surfaces 组织前端，支持后续插件化和权限治理。",
            "guardrails": ["域/模块/子能力统一注册", "按钮动作可审计", "模块懒加载", "页面地图校验"],
        },
        {
            "id": "observability.security",
            "domain": "governance",
            "name": "安全可观测与企业治理",
            "target_stack": ["OpenTelemetry", "Prometheus", "Grafana", "Loki", "Audit WORM", "ABAC"],
            "status": "planned",
            "phase": "P2",
            "strategy": "把日志、指标、链路、审计、用量、账单和审批策略统一为治理面，支持企业高可用和合规。",
            "guardrails": ["字段级权限", "审计不可篡改", "配额限流", "策略审批"],
        },
    ]


def _product_navigation() -> list[dict[str, Any]]:
    return [
        {"id": "overview", "name": "战略总览", "modules": ["运营驾驶舱"], "goal": "平台级经营、成熟度、风险和下一步动作入口", "permission": "overview.*", "ai_surfaces": ["platform_blueprint", "risk_summary"]},
        {"id": "portfolio", "name": "组织项目", "modules": ["项目组合", "组织权限"], "goal": "企业、业务线、项目、团队和 AI 接入资产治理", "permission": "portfolio.*", "ai_surfaces": ["project_onboarding", "permission_suggest"]},
        {"id": "product", "name": "产品需求", "modules": ["需求工作台"], "goal": "把想法、需求、验收标准和任务拆解标准化", "permission": "product.*", "ai_surfaces": ["requirement_split", "acceptance_review"]},
        {"id": "delivery", "name": "研发交付", "modules": ["任务调度", "流程编排"], "goal": "DAG 调度、Agent Feed、质量卡点和工作流执行", "permission": "delivery.*", "ai_surfaces": ["dag_schedule", "task_plan"]},
        {"id": "data", "name": "数据智能", "modules": ["指标总览", "数据智能蓝图", "洞察报告", "指标目录", "数据血缘", "数据交换", "NLQ 问数"], "goal": "数据开发、质量、指标、标签、问数、报表和洞察闭环", "permission": "data.*", "ai_surfaces": ["nlq", "insight_to_task"]},
        {"id": "ai", "name": "AI 智能", "modules": ["AI 指挥台", "知识记忆"], "goal": "Copilot、RAG、记忆、规则、Worker 和智能评估", "permission": "ai.*", "ai_surfaces": ["copilot", "rag", "memory"]},
        {"id": "ecosystem", "name": "平台生态", "modules": ["Agent 平台", "资产市场", "通信集成"], "goal": "Agent、MCP、A2A、模型、插件和外部通信连接器", "permission": "ecosystem.*", "ai_surfaces": ["agent_profile", "connector_health"]},
        {"id": "governance", "name": "安全治理", "modules": ["安全审计", "模块治理"], "goal": "审计、权限、模块动作、审批、风险和策略治理", "permission": "governance.*", "ai_surfaces": ["audit_explain", "module_policy"]},
        {"id": "system", "name": "系统运维", "modules": ["系统设置"], "goal": "SSO、部署、Profile、计费、观测、高可用和运行参数", "permission": "system.*", "ai_surfaces": ["ops_doctor", "billing_alert"]},
    ]


def _gaps(capabilities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = []
    for item in capabilities:
        maturity = int(item.get("maturity") or 0)
        if maturity >= 85:
            continue
        priority = "P0" if maturity < 70 else "P1" if maturity < 80 else "P2"
        gaps.append({
            "id": f"gap-{item['id']}",
            "capability_id": item["id"],
            "title": f"增强 {item['name']}",
            "priority": priority,
            "maturity": maturity,
            "target_maturity": 90,
            "recommendation": item["next"],
            "modules": item["modules"],
        })
    return gaps


def _integrations() -> list[dict[str, Any]]:
    return [
        {
            "id": "wechat-work",
            "category": "communication",
            "name": "企业微信 / WeCom",
            "direction": ["inbound", "outbound"],
            "auth": ["webhook", "signing_secret"],
            "events": ["message.received", "task.assigned", "alert.triggered", "approval.requested"],
            "status": "supported",
            "maturity": 76,
            "target_modules": ["notify", "tasks", "requirements", "audit"],
            "next": "增强机器人回调验签、会话线程映射和审批卡片。",
        },
        {
            "id": "dingtalk",
            "category": "communication",
            "name": "钉钉 / DingTalk",
            "direction": ["inbound", "outbound"],
            "auth": ["webhook", "signing_secret"],
            "events": ["message.received", "task.assigned", "deploy.changed", "incident.created"],
            "status": "supported",
            "maturity": 76,
            "target_modules": ["notify", "tasks", "workflows", "audit"],
            "next": "增强互动卡片、审批流联动和事件去重。",
        },
        {
            "id": "slack",
            "category": "communication",
            "name": "Slack",
            "direction": ["outbound", "inbound"],
            "auth": ["webhook", "bot_token"],
            "events": ["message.received", "task.assigned", "report.published"],
            "status": "supported",
            "maturity": 70,
            "target_modules": ["notify", "analytics", "tasks"],
            "next": "补齐 bot token 配置、slash command 和线程回写。",
        },
        {
            "id": "generic-webhook",
            "category": "event",
            "name": "通用 Webhook / CloudEvents",
            "direction": ["inbound", "outbound"],
            "auth": ["hmac", "api_key"],
            "events": ["cloud_event.ingested", "task.created", "workflow.completed", "audit.recorded"],
            "status": "supported",
            "maturity": 82,
            "target_modules": ["events", "notify", "audit", "workflow"],
            "next": "统一事件 Schema registry、重放和死信队列。",
        },
        {
            "id": "workbuddy",
            "category": "agent",
            "name": "WorkBuddy",
            "direction": ["inbound", "outbound"],
            "auth": ["oauth", "api_key", "webhook"],
            "events": ["agent.ready", "task.accepted", "artifact.produced", "run.failed"],
            "status": "planned",
            "maturity": 45,
            "target_modules": ["agents", "tasks", "platforms", "audit"],
            "next": "新增 WorkBuddy connector、能力画像同步、任务接单与执行证据回写。",
        },
        {
            "id": "openclaw",
            "category": "agent",
            "name": "OpenClaw Agent",
            "direction": ["inbound", "outbound"],
            "auth": ["api_key", "mcp", "a2a"],
            "events": ["crawler.started", "knowledge.extracted", "artifact.produced", "task.completed"],
            "status": "planned",
            "maturity": 42,
            "target_modules": ["mcp", "knowledge", "tasks", "analytics"],
            "next": "补齐 MCP 工具注册、采集任务模板、知识库入库和洞察报告联动。",
        },
        {
            "id": "hermes-agent",
            "category": "agent",
            "name": "Hermes Agent",
            "direction": ["inbound", "outbound"],
            "auth": ["a2a", "jwt", "hmac"],
            "events": ["agent.heartbeat", "task.dispatched", "run.progress", "run.completed", "self_heal.applied"],
            "status": "target",
            "maturity": 58,
            "target_modules": ["agents", "tasks", "workflows", "memory", "audit"],
            "next": "实现 Hermes Agent 标准接入协议、心跳、能力注册、沙箱执行和自愈回写。",
        },
        {
            "id": "mcp-a2a",
            "category": "protocol",
            "name": "MCP / A2A 协议网关",
            "direction": ["inbound", "outbound"],
            "auth": ["oauth", "jwt", "hmac"],
            "events": ["tool.called", "agent.delegated", "memory.updated", "approval.required"],
            "status": "enhancing",
            "maturity": 66,
            "target_modules": ["mcp", "agents", "copilot", "marketplace"],
            "next": "统一工具 Schema、Agent 委托协议、权限裁决和调用审计。",
        },
    ]


@router.get("/blueprint")
def hermes_blueprint() -> dict[str, Any]:
    capabilities = _capabilities()
    gaps = _gaps(capabilities)
    integrations = _integrations()
    technology_upgrades = _technology_upgrades()
    product_navigation = _product_navigation()
    maturity = round(sum(int(x["maturity"]) for x in capabilities) / max(1, len(capabilities)), 1)
    architecture = {
        "name": "Hermes AI Full-stack DevOps Platform",
        "positioning": "目标态一栈式 AI 全栈研发运维与数据智能平台：人负责需求、团队和决策，AI/CLI/Agent 负责拆解、执行、部署、运维、数据洞察、优化与持续迭代；legacy 作为能力承接清单和验收参考，不作为旧交互兼容约束。",
        "principles": [
            "tenant_code / business_code / project_id 三层隔离",
            "优先采用成熟技术与成熟组件，避免过度自研",
            "所有核心能力按域、模块、子能力、动作四级拆分，支撑细粒度权限和审计",
            "AI 能力贯穿需求、任务、执行、数据、运维、安全和治理",
            "所有建议必须能落到任务、工作流、审计或知识资产中形成闭环",
        ],
        "layers": [
            "体验层: React + Ant Design + 专业域菜单 + 模块化工作台 + 全局 Copilot",
            "控制面: FastAPI routers + 权限裁决 + scope middleware + capability registry",
            "智能面: LLM Gateway + Copilot + AgentOps + MCP + Skill Marketplace + A2A",
            "执行面: Tasks + Workflow + Worker + CLI/IDE 接入包",
            "知识面: Memory + KB + RAG + Rules + Specs",
            "数据面: Analytics + Data Exchange + Reports + NLQ + Lineage",
            "治理面: Audit + Usage Quota + Billing + SSO + Observability",
        ],
        "navigation_model": "domain -> module -> submodule -> action/capability",
        "legacy_strategy": "承接 legacy 能力，不复制 legacy 交互；所有历史入口能力按新域、新模块、新权限和新 AI surfaces 重建。",
    }
    return {
        "ok": True,
        "scope": _scope(),
        "architecture": architecture,
        "capabilities": capabilities,
        "integrations": integrations,
        "technology_upgrades": technology_upgrades,
        "product_navigation": product_navigation,
        "gaps": gaps,
        "summary": {
            "maturity": maturity,
            "capabilities": len(capabilities),
            "integrations": len(integrations),
            "technology_upgrades": len(technology_upgrades),
            "navigation_domains": len(product_navigation),
            "gaps": len(gaps),
            "critical_gaps": sum(1 for x in gaps if x["priority"] == "P0"),
            "domains": sorted({str(x["domain"]) for x in capabilities}),
        },
    }


@router.post("/blueprint/tasks")
def hermes_blueprint_tasks(body: BlueprintTaskIn) -> dict[str, Any]:
    blueprint = hermes_blueprint()
    gaps = blueprint["gaps"]
    if body.ids:
        wanted = set(body.ids)
        gaps = [x for x in gaps if str(x["id"]) in wanted]
    items = [
        {
            "title": gap["title"],
            "description": (
                f"Hermes 平台能力缺口治理。\n\n能力: {gap['capability_id']}\n"
                f"当前成熟度: {gap['maturity']}，目标成熟度: {gap['target_maturity']}\n"
                f"建议: {gap['recommendation']}\n模块: {', '.join(gap['modules'])}"
            ),
            "priority": body.priority or gap["priority"],
            "estimate": "L",
            "assigned_to": body.assigned_to or "Platform Agent",
            "dev_tool": body.dev_tool or "codex",
            "source": "hermes_blueprint_gap",
            "source_report_id": gap["id"],
            "source_report_title": gap["title"],
        }
        for gap in gaps
    ]
    if body.dry_run:
        return {"ok": True, "dry_run": True, "created": 0, "items": items}
    from .tasks import TaskCreate, create_task

    created: list[dict[str, Any]] = []
    for item in items:
        out = create_task(TaskCreate(**item))
        created.append({**item, "id": out.get("id")})
    return {"ok": True, "dry_run": False, "created": len(created), "items": created}
