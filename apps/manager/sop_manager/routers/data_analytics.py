"""
@module: routers.data_analytics
@purpose: AI 数据分析概览（指标目录、用量、规则兜底 NLQ）
"""
from __future__ import annotations

import csv
import copy
import io
import json
from sop_manager.task_owner import TaskOwnerId, TaskOwnerInput

from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from uuid import uuid4

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from sop_manager.path_config import (
    request_scope_active,
    resolved_business_code,
    resolved_project_code,
    resolved_project_id,
    resolved_runtime_dir,
    resolved_tenant_code,
    resolved_tenant_id,
)
from sop_manager.routers.analytics_report_core import (
    aggregate_report_intelligence,
    analyze_metric_attribution,
    build_attribution_tasks,
    build_decision_attribution_engine,
    build_decision_tasks,
    build_report_intelligence_tasks,
    generate_insight_report,
    summarize_report_intelligence,
)
from sop_manager.routers.auth_sql import User, current_user
from sop_manager.routers.business_access import require_business_access
from sop_manager.routers.db_sql_compat import now, rows, table
from sop_manager.routers.scope_guard import attach_scope, scope_matches
from sop_manager.routers.sql_models import Issue, Requirement, Task, get_session

router = APIRouter(prefix="/api/v1/analytics", tags=["analytics"])

METRIC_CATALOG: list[dict[str, Any]] = [
    {"key": "tasks_total", "name": "任务总数", "domain": "delivery", "unit": "count", "source": "tasks", "grain": "project", "description": "当前项目任务数量。"},
    {"key": "tasks_by_status", "name": "任务状态分布", "domain": "delivery", "unit": "count", "source": "tasks", "grain": "project,status", "description": "按状态聚合的任务数量。"},
    {"key": "requirements_total", "name": "需求总数", "domain": "product", "unit": "count", "source": "requirements", "grain": "project", "description": "当前项目需求数量。"},
    {"key": "issues_total", "name": "缺陷总数", "domain": "quality", "unit": "count", "source": "issues", "grain": "project", "description": "当前项目缺陷/问题数量。"},
    {"key": "issues_by_priority", "name": "缺陷优先级分布", "domain": "quality", "unit": "count", "source": "issues", "grain": "project,priority", "description": "按优先级聚合的缺陷数量。"},
    {"key": "agent_reflections_sampled", "name": "Agent 反思采样", "domain": "aiops", "unit": "count", "source": "agent_reflections", "grain": "workspace", "description": "可用于蒸馏的 Agent 反思样本数量。"},
]

DEFAULT_DATA_ASSETS: list[dict[str, Any]] = [
    {
        "id": "asset-requirements",
        "name": "需求事实表",
        "type": "table",
        "domain": "product",
        "source": "requirements",
        "owner": "ProductOps",
        "status": "active",
        "security_level": "internal",
        "description": "项目需求、优先级、验收标准、AI 拆解来源和生命周期状态。",
        "tags": ["需求", "产品", "研发协同"],
        "metrics": ["requirements_total"],
        "quality_rules": ["required_owner", "freshness_24h", "status_valid"],
        "lineage_upstream": [],
        "lineage_downstream": ["analytics_overview", "analytics_reports", "data_nlq"],
        "ai_surfaces": ["需求完整性评估", "相似需求识别", "任务拆解建议"],
    },
    {
        "id": "asset-tasks",
        "name": "研发任务事实表",
        "type": "table",
        "domain": "delivery",
        "source": "tasks",
        "owner": "DeliveryOps",
        "status": "active",
        "security_level": "internal",
        "description": "任务状态、依赖、Agent 领取、质量卡点、执行报告与交付闭环数据。",
        "tags": ["任务", "DAG", "Agent Feed"],
        "metrics": ["tasks_total", "tasks_by_status"],
        "quality_rules": ["required_owner", "status_valid", "quality_gate_trace"],
        "lineage_upstream": ["requirements"],
        "lineage_downstream": ["analytics_overview", "scheduler_plan", "quality_center"],
        "ai_surfaces": ["智能分发", "阻塞归因", "交付风险预测"],
    },
    {
        "id": "asset-issues",
        "name": "问题缺陷事实表",
        "type": "table",
        "domain": "quality",
        "source": "issues",
        "owner": "QualityOps",
        "status": "active",
        "security_level": "internal",
        "description": "缺陷、风险、严重级别和解决状态，用于质量趋势与治理任务生成。",
        "tags": ["质量", "缺陷", "风险"],
        "metrics": ["issues_total", "issues_by_priority"],
        "quality_rules": ["required_owner", "priority_valid", "resolution_trace"],
        "lineage_upstream": [],
        "lineage_downstream": ["analytics_overview", "quality_alerts", "audit_tasks"],
        "ai_surfaces": ["缺陷归因", "修复建议", "质量趋势分析"],
    },
    {
        "id": "asset-agent-reflections",
        "name": "Agent 反思样本库",
        "type": "vector_collection",
        "domain": "ai",
        "source": "agent_reflections",
        "owner": "AIOps",
        "status": "planned",
        "security_level": "confidential",
        "description": "Agent 运行反思、上下文片段和可蒸馏知识样本，服务 RAG、记忆和模型优化。",
        "tags": ["AI 记忆", "RAG", "蒸馏"],
        "metrics": ["agent_reflections_sampled"],
        "quality_rules": ["pii_redaction", "embedding_ready", "retention_policy"],
        "lineage_upstream": ["agent_runs", "copilot_sessions"],
        "lineage_downstream": ["knowledge_base", "modelops_eval", "data_nlq"],
        "ai_surfaces": ["语义检索", "知识蒸馏", "Agent 画像"],
    },
]

DEFAULT_TAGS: list[dict[str, Any]] = [
    {"id": "tag-delivery-risk", "name": "交付风险", "category": "risk", "owner": "DeliveryOps", "status": "active", "rule": "blocked tasks or P0 issues > 0", "target_assets": ["asset-tasks", "asset-issues"], "freshness": "realtime", "description": "识别当前项目交付阻塞和高优缺陷风险。"},
    {"id": "tag-ai-ready", "name": "AI 可接手", "category": "agent", "owner": "AIOps", "status": "active", "rule": "requirements have acceptance criteria and tasks have dev_tool", "target_assets": ["asset-requirements", "asset-tasks"], "freshness": "daily", "description": "标记适合 AI CLI/Agent 自动领取开发的需求和任务。"},
    {"id": "tag-data-sensitive", "name": "敏感数据", "category": "security", "owner": "SecurityOps", "status": "planned", "rule": "asset.security_level in confidential/restricted", "target_assets": ["asset-agent-reflections"], "freshness": "daily", "description": "标记需脱敏、审计和权限强化的数据资产。"},
]

DEFAULT_QUALITY_RULES: list[dict[str, Any]] = [
    {"id": "required_owner", "name": "资产负责人完整性", "severity": "high", "dimension": "completeness", "description": "数据资产、指标、标签必须有 owner。"},
    {"id": "freshness_24h", "name": "24 小时新鲜度", "severity": "medium", "dimension": "freshness", "description": "核心事实数据应在 24 小时内有更新或可追溯同步记录。"},
    {"id": "status_valid", "name": "状态枚举有效", "severity": "medium", "dimension": "validity", "description": "状态字段必须在平台标准枚举内。"},
    {"id": "quality_gate_trace", "name": "质量卡点可追溯", "severity": "high", "dimension": "traceability", "description": "任务执行数据应关联质量评估与产物证据。"},
    {"id": "pii_redaction", "name": "隐私字段脱敏", "severity": "critical", "dimension": "security", "description": "AI 记忆、反思和多模态数据需要脱敏策略。"},
    {"id": "lineage_declared", "name": "血缘声明完整", "severity": "high", "dimension": "lineage", "description": "服务型资产必须声明上游或下游血缘。"},
]

DEFAULT_DATA_SERVICES: list[dict[str, Any]] = [
    {
        "id": "svc-project-delivery-overview",
        "name": "项目交付指标服务",
        "type": "metric_api",
        "status": "published",
        "owner": "DataOps",
        "endpoint": "/api/v1/analytics/overview",
        "method": "GET",
        "auth_policy": "tenant_business_project_scope",
        "rate_limit": "600/min",
        "sla": "99.5%",
        "assets": ["asset-requirements", "asset-tasks", "asset-issues"],
        "metrics": ["tasks_total", "tasks_by_status", "requirements_total", "issues_total"],
        "consumers": ["manager-web", "sop-cli", "agent-feed"],
        "description": "按 tenant_code/business_code/project_id 输出项目交付、需求与质量概要，供 Dashboard、报表和 Agent 决策使用。",
        "ai_surfaces": ["指标解释", "风险摘要", "任务生成建议"],
        "version": "v1",
    },
    {
        "id": "svc-data-governance-catalog",
        "name": "数据治理目录服务",
        "type": "governance_api",
        "status": "draft",
        "owner": "Data Governance Agent",
        "endpoint": "/api/v1/analytics/assets",
        "method": "GET",
        "auth_policy": "tenant_business_project_scope",
        "rate_limit": "300/min",
        "sla": "99.0%",
        "assets": ["asset-requirements", "asset-tasks", "asset-issues", "asset-agent-reflections"],
        "metrics": [],
        "consumers": ["manager-web", "sop-cli", "data-agents"],
        "description": "提供资产、质量、血缘、指标和标签治理元数据，供 AI Agent 自动理解数据语义和治理要求。",
        "ai_surfaces": ["Schema 解释", "治理建议", "血缘问答"],
        "version": "v1",
    },
]

DEFAULT_DATA_DEV_TEMPLATES: list[dict[str, Any]] = [
    {
        "id": "tpl-batch-quality",
        "name": "离线数据质量巡检",
        "type": "quality_batch",
        "engine": "Spark",
        "status": "active",
        "priority": "P1",
        "owner": "Data Governance Agent",
        "dev_tool": "codex",
        "assets": ["asset-requirements", "asset-tasks", "asset-issues"],
        "quality_gates": ["schema_valid", "owner_declared", "lineage_declared", "quality_report"],
        "dag": [
            {"id": "profile", "name": "字段画像与统计", "depends_on": []},
            {"id": "rule_check", "name": "规则校验", "depends_on": ["profile"]},
            {"id": "alert", "name": "告警与任务化", "depends_on": ["rule_check"]},
        ],
        "description": "生成可调度的离线质量巡检任务，输出质量报告、异常告警和治理任务建议。",
    },
    {
        "id": "tpl-realtime-cdc",
        "name": "实时 CDC 接入与湖仓落表",
        "type": "realtime_ingestion",
        "engine": "Flink CDC + Paimon",
        "status": "active",
        "priority": "P1",
        "owner": "Data Platform Agent",
        "dev_tool": "codex",
        "assets": ["asset-requirements", "asset-tasks"],
        "quality_gates": ["source_connection", "schema_registry", "checkpoint", "replay_test"],
        "dag": [
            {"id": "connect", "name": "源端连接与位点", "depends_on": []},
            {"id": "schema", "name": "Schema Registry", "depends_on": ["connect"]},
            {"id": "sink", "name": "Paimon/OceanBase 落表", "depends_on": ["schema"]},
            {"id": "monitor", "name": "延迟与错误监控", "depends_on": ["sink"]},
        ],
        "description": "建立实时 CDC 接入链路，沉淀湖仓表、延迟监控、回放测试和告警任务。",
    },
    {
        "id": "tpl-metric-service",
        "name": "指标口径开发与服务发布",
        "type": "metric_development",
        "engine": "StarRocks/OceanBase SQL",
        "status": "active",
        "priority": "P2",
        "owner": "Metrics Agent",
        "dev_tool": "codex",
        "assets": ["asset-tasks", "asset-issues"],
        "quality_gates": ["metric_owner", "formula_review", "lineage_impact", "api_contract"],
        "dag": [
            {"id": "semantic", "name": "语义口径设计", "depends_on": []},
            {"id": "sql", "name": "SQL/物化视图开发", "depends_on": ["semantic"]},
            {"id": "service", "name": "指标 API 发布", "depends_on": ["sql"]},
        ],
        "description": "把业务指标从口径、SQL、血缘影响到服务发布完整任务化。",
    },
    {
        "id": "tpl-tag-profile",
        "name": "标签开发与画像服务",
        "type": "tag_development",
        "engine": "Flink + OceanBase + Lance",
        "status": "planned",
        "priority": "P2",
        "owner": "Profile Agent",
        "dev_tool": "codex",
        "assets": ["asset-agent-reflections"],
        "quality_gates": ["privacy_review", "tag_rule_review", "sample_validation", "serving_contract"],
        "dag": [
            {"id": "ontology", "name": "本体/标签语义", "depends_on": []},
            {"id": "compute", "name": "标签计算", "depends_on": ["ontology"]},
            {"id": "profile", "name": "画像服务发布", "depends_on": ["compute"]},
        ],
        "description": "开发实时/离线标签与画像服务，支撑人、项目、Agent 的智能决策。",
    },
]

DATA_STACK_CATALOG: list[dict[str, Any]] = [
    {
        "id": "oceanbase",
        "name": "OceanBase",
        "role": "primary",
        "maturity": 86,
        "scenarios": ["多租户事务", "HTAP", "JSON/向量/全文多模态", "安全审计", "统一元数据"],
        "integration": ["sql", "vector", "json", "cdc", "governance"],
        "recommendation": "作为企业默认主存储和数据服务底座，承载租户、业务、项目、指标、标签和审计核心数据。",
    },
    {
        "id": "starrocks",
        "name": "StarRocks",
        "role": "olap",
        "maturity": 78,
        "scenarios": ["高并发指标服务", "实时看板", "宽表分析", "湖仓查询"],
        "integration": ["olap", "semantic_metric", "query_acceleration"],
        "recommendation": "作为高并发指标查询和报表加速引擎，承载企业级指标中心的在线分析层。",
    },
    {
        "id": "hologres",
        "name": "Hologres",
        "role": "realtime_warehouse",
        "maturity": 72,
        "scenarios": ["实时数仓", "向量检索", "实时服务", "PostgreSQL 生态"],
        "integration": ["realtime", "serving", "vector"],
        "recommendation": "适合云上实时数据服务和实时特征服务，对接 Flink/Paimon 形成实时链路。",
    },
    {
        "id": "greenplum",
        "name": "Greenplum / GP",
        "role": "mpp_warehouse",
        "maturity": 68,
        "scenarios": ["离线数仓", "复杂 SQL", "历史归因分析", "大宽表"],
        "integration": ["warehouse", "batch", "attribution"],
        "recommendation": "适合存量企业数仓与复杂归因分析场景，作为可选 MPP 引擎接入。",
    },
    {
        "id": "elasticsearch-opensearch",
        "name": "ElasticSearch / OpenSearch",
        "role": "search_observability",
        "maturity": 75,
        "scenarios": ["日志检索", "全文搜索", "知识检索", "告警检索"],
        "integration": ["search", "log", "alert", "knowledge"],
        "recommendation": "承载日志、文档、知识和告警检索能力，与 RAG/Observability 共享索引治理。",
    },
    {
        "id": "spark",
        "name": "Spark",
        "role": "batch_compute",
        "maturity": 70,
        "scenarios": ["离线 ETL", "数据质量批检", "特征加工", "模型训练样本"],
        "integration": ["batch", "quality", "feature", "ml"],
        "recommendation": "作为离线数据开发和训练样本加工引擎，接入调度中心与质量卡点。",
    },
    {
        "id": "flink-cdc-paimon",
        "name": "Flink / Flink CDC / Paimon",
        "role": "stream_lakehouse",
        "maturity": 74,
        "scenarios": ["CDC 接入", "实时 ETL", "流式质量", "湖仓表", "实时标签"],
        "integration": ["cdc", "stream", "lakehouse", "quality"],
        "recommendation": "作为实时集成与湖仓层核心，支撑事件唤醒、实时标签和实时指标。",
    },
    {
        "id": "lance",
        "name": "Lance / LanceDB",
        "role": "multimodal_vector",
        "maturity": 80,
        "scenarios": ["本地向量库", "多模态资产", "代码/文档检索", "Agent 记忆"],
        "integration": ["vector", "multimodal", "memory", "rag"],
        "recommendation": "作为本地优先和轻量多模态向量能力，服务 CLI/Agent、知识库和记忆画像。",
    },
]


def _data_scope() -> dict[str, str]:
    return {
        "tenant_id": resolved_tenant_id(),
        "tenant_code": resolved_tenant_code(),
        "business_code": resolved_business_code(),
        "project_id": resolved_project_id(),
        "project_code": resolved_project_code(),
    }


def _data_capabilities() -> list[dict[str, Any]]:
    return [
        {
            "id": "data.ingestion",
            "domain": "integration",
            "name": "智能数据接入",
            "maturity": 72,
            "status": "active",
            "modules": ["data-exchange", "db-config", "notify", "worker"],
            "stack": ["OceanBase", "Flink CDC", "Paimon", "Kafka/Redis Streams"],
            "ai_surfaces": ["Schema 识别", "CDC 接入建议", "字段语义推断", "接入风险评估"],
            "next": "补齐连接器注册、Schema registry、增量同步位点、脱敏策略和接入任务模板。",
        },
        {
            "id": "data.development",
            "domain": "engineering",
            "name": "智能数据开发",
            "maturity": 64,
            "status": "planned",
            "modules": ["workflows", "tasks", "analytics", "marketplace"],
            "stack": ["Spark", "Flink", "Paimon", "Python", "SQL"],
            "ai_surfaces": ["SQL/ETL 生成", "任务依赖推断", "代码审查", "回滚脚本生成"],
            "next": "新增数据开发项目模板、SQL/ETL 任务类型、质量卡点和调度发布链路。",
        },
        {
            "id": "data.quality",
            "domain": "governance",
            "name": "数据质量评估与监控",
            "maturity": 66,
            "status": "enhancing",
            "modules": ["analytics", "audit", "notify", "tasks"],
            "stack": ["OceanBase", "Spark", "Flink", "OpenSearch"],
            "ai_surfaces": ["质量规则推荐", "异常归因", "告警转任务", "修复建议"],
            "next": "补齐质量规则目录、批流质量运行、SLO/阈值、异常聚类和自动治理任务。",
        },
        {
            "id": "metrics.center",
            "domain": "serving",
            "name": "智能指标中心",
            "maturity": 70,
            "status": "active",
            "modules": ["analytics", "reports", "nlq"],
            "stack": ["StarRocks", "OceanBase", "Hologres"],
            "ai_surfaces": ["指标口径生成", "指标血缘", "指标问答", "指标变更影响分析"],
            "next": "引入语义层、指标版本、指标负责人、口径审批和高并发指标服务。",
        },
        {
            "id": "tag.service",
            "domain": "serving",
            "name": "智能标签服务",
            "maturity": 52,
            "status": "planned",
            "modules": ["analytics", "profiles", "tasks"],
            "stack": ["OceanBase", "Flink", "StarRocks", "Lance"],
            "ai_surfaces": ["标签建议", "标签圈选", "画像生成", "实时标签更新"],
            "next": "新增标签目录、标签开发、标签计算、画像服务和标签权限策略。",
        },
        {
            "id": "ontology.memory.profile",
            "domain": "ai",
            "name": "本体论 AI 记忆画像",
            "maturity": 58,
            "status": "planned",
            "modules": ["memory", "kb", "rag", "analytics"],
            "stack": ["Lance", "OceanBase", "OpenSearch", "Graph RAG"],
            "ai_surfaces": ["实体本体", "人/项目/Agent 画像", "关系推理", "跨模态检索"],
            "next": "建立业务本体、实体关系、画像属性、记忆生命周期和跨租户隔离策略。",
        },
        {
            "id": "data.service",
            "domain": "serving",
            "name": "统一安全数据服务",
            "maturity": 62,
            "status": "enhancing",
            "modules": ["auth", "data-exchange", "analytics", "audit"],
            "stack": ["OceanBase", "StarRocks", "Hologres", "API Gateway"],
            "ai_surfaces": ["数据 API 生成", "权限裁决", "字段脱敏", "调用风险解释"],
            "next": "补齐数据服务目录、API 发布、ABAC/字段级权限、限流、审计和配额计量。",
        },
        {
            "id": "data.ops",
            "domain": "ops",
            "name": "智能数据运维与告警",
            "maturity": 60,
            "status": "planned",
            "modules": ["system-ops", "notify", "workflows", "tasks"],
            "stack": ["Prometheus", "OpenSearch", "Flink", "Temporal"],
            "ai_surfaces": ["根因分析", "Runbook 推荐", "自愈任务", "容量预测"],
            "next": "打通数据链路观测、指标/质量告警、事件唤醒、自动修复和复盘报告。",
        },
        {
            "id": "data.ip.governance",
            "domain": "enterprise",
            "name": "数据知产治理",
            "maturity": 50,
            "status": "planned",
            "modules": ["audit", "billing", "marketplace", "kb"],
            "stack": ["OceanBase", "Object Storage", "Audit WORM"],
            "ai_surfaces": ["资产分级", "授权建议", "合规检查", "价值评估"],
            "next": "建立数据资产分级、授权、血缘、使用计量、合规审计和资产市场化能力。",
        },
    ]


def _data_gaps(capabilities: list[dict[str, Any]]) -> list[dict[str, Any]]:
    gaps: list[dict[str, Any]] = []
    for item in capabilities:
        maturity = int(item.get("maturity") or 0)
        if maturity >= 82:
            continue
        priority = "P0" if maturity < 58 else "P1" if maturity < 70 else "P2"
        gaps.append({
            "id": f"data-gap-{item['id']}",
            "capability_id": item["id"],
            "title": f"增强 {item['name']}",
            "priority": priority,
            "maturity": maturity,
            "target_maturity": 88,
            "recommendation": item["next"],
            "modules": item["modules"],
            "stack": item["stack"],
        })
    return gaps

LINEAGE_GRAPH: dict[str, Any] = {
    "nodes": [
        {"id": "requirements", "type": "table", "label": "requirements"},
        {"id": "tasks", "type": "table", "label": "tasks"},
        {"id": "issues", "type": "table", "label": "issues"},
        {"id": "agent_reflections", "type": "vector_collection", "label": "agent_reflections"},
        {"id": "analytics_overview", "type": "dataset", "label": "analytics overview"},
        {"id": "analytics_nlq", "type": "ai_dataset", "label": "analytics NLQ"},
    ],
    "edges": [
        {"from": "requirements", "to": "analytics_overview", "kind": "aggregate"},
        {"from": "tasks", "to": "analytics_overview", "kind": "aggregate"},
        {"from": "issues", "to": "analytics_overview", "kind": "aggregate"},
        {"from": "agent_reflections", "to": "analytics_overview", "kind": "sample"},
        {"from": "analytics_overview", "to": "analytics_nlq", "kind": "prompt_context"},
    ],
}


def _utc_now() -> str:
    return datetime.utcnow().replace(microsecond=0).isoformat() + "Z"


def _reports_file() -> Path:
    return resolved_runtime_dir() / "analytics" / "reports.jsonl"


def _subscriptions_file() -> Path:
    return resolved_runtime_dir() / "analytics" / "report-subscriptions.json"


def _governance_file() -> Path:
    return resolved_runtime_dir() / "analytics" / "data-governance.json"


def _default_governance() -> dict[str, Any]:
    return {
        "scope": _data_scope(),
        "assets": copy.deepcopy(DEFAULT_DATA_ASSETS),
        "metrics": [
            {
                **m,
                "id": m["key"],
                "owner": "DataOps" if m["domain"] != "quality" else "QualityOps",
                "status": "active",
                "version": "v1",
                "quality_score": 86 if m["domain"] != "quality" else 82,
                "service_level": "project",
                "tags": [m["domain"], m["source"]],
            }
            for m in METRIC_CATALOG
        ],
        "tags": copy.deepcopy(DEFAULT_TAGS),
        "quality_rules": copy.deepcopy(DEFAULT_QUALITY_RULES),
        "services": copy.deepcopy(DEFAULT_DATA_SERVICES),
        "dev_templates": copy.deepcopy(DEFAULT_DATA_DEV_TEMPLATES),
        "dev_schedules": [],
        "updated_at": _utc_now(),
    }


def _governance_scope_key(scope: dict[str, Any] | None = None) -> str:
    source = scope if isinstance(scope, dict) else _data_scope()
    return "|".join(
        [
            str(source.get("tenant_id") or ""),
            str(source.get("tenant_code") or ""),
            str(source.get("business_code") or ""),
            str(source.get("project_id") or ""),
            str(source.get("project_code") or ""),
        ]
    )


def _empty_governance_store() -> dict[str, Any]:
    return {"version": 2, "scoped_governance": True, "scopes": {}, "updated_at": _utc_now()}


def _read_governance_store() -> dict[str, Any]:
    path = _governance_file()
    if not path.exists():
        return _empty_governance_store()
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        raw = {}
    if isinstance(raw, dict) and raw.get("scoped_governance") is True and isinstance(raw.get("scopes"), dict):
        raw.setdefault("version", 2)
        raw.setdefault("updated_at", _utc_now())
        return raw
    store = _empty_governance_store()
    if isinstance(raw, dict) and any(isinstance(raw.get(key), list) for key in ("assets", "metrics", "tags", "quality_rules", "services", "dev_templates", "dev_schedules")):
        legacy = dict(raw)
        legacy_scope = legacy.get("scope") if isinstance(legacy.get("scope"), dict) else _data_scope()
        store["scopes"][_governance_scope_key(legacy_scope)] = legacy
    return store


def _normalize_governance(data: dict[str, Any]) -> dict[str, Any]:
    default = _default_governance()
    for key in ("assets", "metrics", "tags", "quality_rules", "services", "dev_templates", "dev_schedules", "dev_runbooks"):
        if not isinstance(data.get(key), list):
            data[key] = copy.deepcopy(default.get(key) or [])
    attach_scope(data, overwrite=True)
    data["updated_at"] = data.get("updated_at") or _utc_now()
    return data


def _write_governance_store(store: dict[str, Any]) -> None:
    from sop_manager.project_write_guard import project_file_write_scope

    store["version"] = 2
    store["scoped_governance"] = True
    store["updated_at"] = _utc_now()
    with project_file_write_scope():
        path = _governance_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(store, ensure_ascii=False, indent=2), encoding="utf-8")


def _load_governance() -> dict[str, Any]:
    store = _read_governance_store()
    scopes = store.setdefault("scopes", {})
    key = _governance_scope_key()
    data = scopes.get(key) if isinstance(scopes.get(key), dict) else None
    if data is None:
        data = _default_governance()
    return _normalize_governance(dict(data))


def _save_governance(data: dict[str, Any]) -> dict[str, Any]:
    store = _read_governance_store()
    scopes = store.setdefault("scopes", {})
    data = _normalize_governance(dict(data))
    data["updated_at"] = _utc_now()
    scopes[_governance_scope_key()] = data
    _write_governance_store(store)
    return data


def _asset_quality(asset: dict[str, Any], rules: list[dict[str, Any]]) -> dict[str, Any]:
    blockers: list[str] = []
    warnings: list[str] = []
    if not str(asset.get("owner") or "").strip():
        blockers.append("missing_owner")
    if not asset.get("lineage_upstream") and not asset.get("lineage_downstream"):
        warnings.append("missing_lineage")
    if str(asset.get("security_level") or "") in {"confidential", "restricted"} and "pii_redaction" not in (asset.get("quality_rules") or []):
        blockers.append("missing_pii_redaction")
    if not asset.get("metrics") and asset.get("type") in {"table", "dataset", "mart"}:
        warnings.append("missing_metrics")
    declared = set(asset.get("quality_rules") or [])
    critical_rules = {str(r.get("id")) for r in rules if str(r.get("severity")) in {"critical", "high"}}
    missing_critical = sorted(x for x in critical_rules if x in {"required_owner", "lineage_declared"} and x not in declared)
    warnings.extend([f"rule_not_declared:{x}" for x in missing_critical])
    score = max(0, 100 - len(blockers) * 24 - len(warnings) * 8)
    decision = "block" if blockers else "warn" if warnings else "pass"
    return {
        "asset_id": asset.get("id"),
        "score": score,
        "decision": decision,
        "blockers": blockers,
        "warnings": warnings,
        "rules_checked": len(rules),
        "evaluated_at": _utc_now(),
    }


def _governance_summary(data: dict[str, Any]) -> dict[str, Any]:
    assets = list(data.get("assets") or [])
    metrics = list(data.get("metrics") or [])
    tags = list(data.get("tags") or [])
    rules = list(data.get("quality_rules") or [])
    services = list(data.get("services") or [])
    dev_templates = list(data.get("dev_templates") or [])
    dev_schedules = list(data.get("dev_schedules") or [])
    quality = [_asset_quality(asset, rules) for asset in assets]
    by_domain: dict[str, int] = {}
    for asset in assets:
        domain = str(asset.get("domain") or "unknown")
        by_domain[domain] = by_domain.get(domain, 0) + 1
    avg_quality = round(sum(int(x["score"]) for x in quality) / max(1, len(quality)), 1)
    return {
        "assets": len(assets),
        "metrics": len(metrics),
        "tags": len(tags),
        "quality_rules": len(rules),
        "services": len(services),
        "published_services": sum(1 for x in services if str(x.get("status")) == "published"),
        "dev_templates": len(dev_templates),
        "active_dev_templates": sum(1 for x in dev_templates if str(x.get("status")) == "active"),
        "dev_schedules": len(dev_schedules),
        "quality_avg": avg_quality,
        "quality_blocked": sum(1 for x in quality if x["decision"] == "block"),
        "quality_warn": sum(1 for x in quality if x["decision"] == "warn"),
        "by_domain": by_domain,
    }


def _service_health(service: dict[str, Any], data: dict[str, Any]) -> dict[str, Any]:
    asset_ids = {str(x.get("id")) for x in data.get("assets", [])}
    missing_assets = [str(x) for x in service.get("assets", []) if str(x) not in asset_ids]
    warnings: list[str] = []
    blockers: list[str] = []
    if not service.get("owner"):
        blockers.append("missing_owner")
    if not service.get("endpoint"):
        blockers.append("missing_endpoint")
    if missing_assets:
        blockers.append("missing_assets:" + ",".join(missing_assets))
    if str(service.get("status")) == "published" and not service.get("auth_policy"):
        blockers.append("missing_auth_policy")
    if not service.get("rate_limit"):
        warnings.append("missing_rate_limit")
    if not service.get("sla"):
        warnings.append("missing_sla")
    score = max(0, 100 - len(blockers) * 25 - len(warnings) * 8)
    return {
        "service_id": service.get("id"),
        "score": score,
        "decision": "block" if blockers else "warn" if warnings else "pass",
        "blockers": blockers,
        "warnings": warnings,
        "checked_at": _utc_now(),
    }


def _quality_alerts(data: dict[str, Any]) -> list[dict[str, Any]]:
    rules = list(data.get("quality_rules") or [])
    alerts: list[dict[str, Any]] = []
    for asset in data.get("assets") or []:
        quality = _asset_quality(asset, rules)
        if quality["decision"] == "pass":
            continue
        severity = "critical" if quality["decision"] == "block" else "warning"
        alerts.append({
            "id": f"alert-{asset.get('id')}",
            "type": "asset_quality",
            "severity": severity,
            "status": "open",
            "title": f"数据资产质量{ '阻断' if severity == 'critical' else '预警' }：{asset.get('name')}",
            "asset_id": asset.get("id"),
            "asset_name": asset.get("name"),
            "score": quality["score"],
            "decision": quality["decision"],
            "blockers": quality["blockers"],
            "warnings": quality["warnings"],
            "recommendation": "完善 owner、血缘、质量规则、敏感数据策略与指标映射。",
            "created_at": quality["evaluated_at"],
        })
    for service in data.get("services") or []:
        health = _service_health(service, data)
        if health["decision"] == "pass":
            continue
        severity = "critical" if health["decision"] == "block" else "warning"
        alerts.append({
            "id": f"alert-{service.get('id')}",
            "type": "service_health",
            "severity": severity,
            "status": "open",
            "title": f"数据服务发布健康{ '阻断' if severity == 'critical' else '预警' }：{service.get('name')}",
            "service_id": service.get("id"),
            "service_name": service.get("name"),
            "score": health["score"],
            "decision": health["decision"],
            "blockers": health["blockers"],
            "warnings": health["warnings"],
            "recommendation": "补齐 endpoint、鉴权策略、限流、SLA、资产依赖与消费方说明。",
            "created_at": health["checked_at"],
        })
    alerts.sort(key=lambda x: (x["severity"] != "critical", str(x.get("created_at", ""))))
    return alerts


def _load_subscription() -> dict[str, Any]:
    path = _subscriptions_file()
    if not path.exists():
        return {
            "enabled": False,
            "auto_on_publish": False,
            "channels": [],
            "event": "analytics_report_published",
            "updated_at": "",
        }
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        data = {}
    return {
        "enabled": bool(data.get("enabled")),
        "auto_on_publish": bool(data.get("auto_on_publish")),
        "channels": [str(x) for x in data.get("channels", []) if str(x).strip()],
        "event": str(data.get("event") or "analytics_report_published"),
        "updated_at": str(data.get("updated_at") or ""),
    }


def _save_subscription(data: dict[str, Any]) -> dict[str, Any]:
    row = {
        "enabled": bool(data.get("enabled")),
        "auto_on_publish": bool(data.get("auto_on_publish")),
        "channels": [str(x).strip() for x in data.get("channels", []) if str(x).strip()],
        "event": "analytics_report_published",
        "updated_at": _utc_now(),
    }
    from sop_manager.project_write_guard import project_file_write_scope

    with project_file_write_scope():
        path = _subscriptions_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(row, ensure_ascii=False, indent=2), encoding="utf-8")
    return row


def _read_all_reports() -> list[dict[str, Any]]:
    path = _reports_file()
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        try:
            item = json.loads(line)
        except Exception:
            continue
        out.append(item)
    return out


def _read_reports(limit: int = 30, status: str = "", source: str = "", q: str = "") -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    q_norm = q.strip().lower()
    for item in _read_all_reports():
        if not scope_matches(item):
            continue
        if status and str(item.get("status") or "draft") != status:
            continue
        if source and str(item.get("source") or "") != source:
            continue
        if q_norm:
            haystack = "\n".join(
                [
                    str(item.get("title") or ""),
                    str(item.get("question") or ""),
                    str(item.get("answer") or ""),
                    str(item.get("owner") or ""),
                    str(item.get("note") or ""),
                    " ".join(str(x) for x in item.get("tags", []) if x),
                    " ".join(str(x) for x in item.get("highlights", []) if x),
                ]
            ).lower()
            if q_norm not in haystack:
                continue
        out.append(item)
    out.sort(key=lambda x: (bool(x.get("pinned")), str(x.get("created_at", ""))), reverse=True)
    return out[: max(1, min(int(limit), 200))]


def _rewrite_reports(items: list[dict[str, Any]]) -> None:
    from sop_manager.project_write_guard import project_file_write_scope

    with project_file_write_scope():
        path = _reports_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as f:
            for item in items:
                f.write(json.dumps(item, ensure_ascii=False, default=str) + "\n")


def _append_report(report: dict[str, Any]) -> None:
    from sop_manager.project_write_guard import project_file_write_scope

    with project_file_write_scope():
        path = _reports_file()
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("a", encoding="utf-8") as stream:
            stream.write(json.dumps(report, ensure_ascii=False, default=str) + "\n")


def _find_scoped_report(report_id: str) -> dict[str, Any] | None:
    for item in _read_all_reports():
        if item.get("id") == report_id and scope_matches(item):
            return item
    return None


def _replace_scoped_report(report_id: str, patch: dict[str, Any]) -> dict[str, Any]:
    items = _read_all_reports()
    updated: dict[str, Any] | None = None
    for item in items:
        if item.get("id") == report_id and scope_matches(item):
            item.update(patch)
            updated = item
            break
    if not updated:
        raise HTTPException(404, "报告不存在")
    _rewrite_reports(items)
    return updated


def _report_markdown(report: dict[str, Any]) -> str:
    highlights = report.get("highlights") if isinstance(report.get("highlights"), list) else []
    metrics = report.get("metrics_snapshot") if isinstance(report.get("metrics_snapshot"), dict) else {}
    tags = [str(x) for x in report.get("tags", []) if str(x).strip()]
    lines = [
        f"# {report.get('title') or '项目数据洞察报告'}",
        "",
        f"- 报告 ID: `{report.get('id')}`",
        f"- 项目: `{report.get('project_id')}`",
        f"- 状态: `{report.get('status', 'draft')}`",
        f"- 负责人: {report.get('owner') or '-'}",
        f"- 标签: {', '.join(tags) if tags else '-'}",
        f"- 创建人: {report.get('actor') or '-'}",
        f"- 创建时间: {report.get('created_at') or '-'}",
    ]
    if report.get("published_at"):
        lines.append(f"- 发布时间: {report.get('published_at')}")
    if report.get("question"):
        lines.extend(["", "## 问题", "", str(report.get("question"))])
    lines.extend(["", "## 结论", "", str(report.get("answer") or "")])
    if highlights:
        lines.extend(["", "## 亮点"])
        for item in highlights:
            lines.append(f"- {item}")
    if report.get("note"):
        lines.extend(["", "## 治理备注", "", str(report.get("note") or "")])
    if metrics:
        lines.extend(["", "## 指标快照", "", "```json", json.dumps(metrics, ensure_ascii=False, indent=2), "```"])
    return "\n".join(lines) + "\n"


def _report_highlights(metrics: dict[str, Any]) -> list[str]:
    tasks_total = int(metrics.get("tasks_total") or 0)
    reqs_total = int(metrics.get("requirements_total") or 0)
    issues_total = int(metrics.get("issues_total") or 0)
    tasks_by_status = metrics.get("tasks_by_status") if isinstance(metrics.get("tasks_by_status"), dict) else {}
    issues_by_priority = metrics.get("issues_by_priority") if isinstance(metrics.get("issues_by_priority"), dict) else {}
    blocked = int(tasks_by_status.get("blocked") or 0)
    in_progress = int(tasks_by_status.get("in_progress") or 0)
    p0_issues = int(issues_by_priority.get("P0") or 0)
    highlights = [
        f"当前项目共有 {reqs_total} 个需求、{tasks_total} 个任务、{issues_total} 个问题。",
        f"任务推进中 {in_progress} 个，阻塞 {blocked} 个。",
    ]
    if p0_issues:
        highlights.append(f"存在 {p0_issues} 个 P0 问题，需要优先治理。")
    if not blocked and not p0_issues:
        highlights.append("未发现阻塞任务或 P0 问题，整体交付风险较低。")
    return highlights


def _reports_summary() -> dict[str, Any]:
    items = _read_reports(200)
    by_status: dict[str, int] = {}
    notified = 0
    pinned = 0
    tags: dict[str, int] = {}
    owners: dict[str, int] = {}
    last_created = ""
    last_published = ""
    last_notified = ""
    for item in items:
        status = str(item.get("status") or "draft")
        by_status[status] = by_status.get(status, 0) + 1
        if item.get("pinned"):
            pinned += 1
        owner = str(item.get("owner") or "").strip()
        if owner:
            owners[owner] = owners.get(owner, 0) + 1
        for tag in item.get("tags", []) if isinstance(item.get("tags"), list) else []:
            tag_s = str(tag).strip()
            if tag_s:
                tags[tag_s] = tags.get(tag_s, 0) + 1
        created_at = str(item.get("created_at") or "")
        published_at = str(item.get("published_at") or "")
        notified_at = str(item.get("last_notified_at") or "")
        if notified_at:
            notified += 1
        last_created = max(last_created, created_at)
        last_published = max(last_published, published_at)
        last_notified = max(last_notified, notified_at)
    sub = _load_subscription()
    subscription_health = "ready" if sub.get("enabled") and sub.get("channels") else "inactive"
    if sub.get("enabled") and not sub.get("channels"):
        subscription_health = "missing_channel"
    intelligence = summarize_report_intelligence(items)
    return {
        "total": len(items),
        "by_status": by_status,
        "draft": by_status.get("draft", 0),
        "published": by_status.get("published", 0),
        "archived": by_status.get("archived", 0),
        "notified": notified,
        "pinned": pinned,
        "tags": tags,
        "owners": owners,
        "last_created_at": last_created,
        "last_published_at": last_published,
        "last_notified_at": last_notified,
        "subscription": sub,
        "subscription_health": subscription_health,
        "intelligence": intelligence,
        **intelligence,
    }


def _require_scope() -> str:
    if not request_scope_active():
        raise HTTPException(400, detail="需要登录且携带 X-Project-Id")
    pid = resolved_project_id()
    if not pid:
        raise HTTPException(400, detail="未解析到 project_id")
    return pid


def _build_metrics(db: Session, pid: str) -> dict[str, Any]:
    tasks = db.query(Task).filter_by(project_id=pid).all()
    reqs = db.query(Requirement).filter_by(project_id=pid).all()
    issues = db.query(Issue).filter_by(project_id=pid).all()
    task_by_status: dict[str, int] = {}
    for t in tasks:
        st = str(t.status or "unknown")
        task_by_status[st] = task_by_status.get(st, 0) + 1
    issue_by_prio: dict[str, int] = {}
    for i in issues:
        pr = str(getattr(i, "priority", None) or getattr(i, "severity", None) or "P3")
        issue_by_prio[pr] = issue_by_prio.get(pr, 0) + 1
    reflections = 0
    try:
        reflections = len(rows("agent_reflections", 5000))
    except Exception:  # noqa: S110
        pass
    return {
        "tasks_total": len(tasks),
        "tasks_by_status": task_by_status,
        "requirements_total": len(reqs),
        "issues_total": len(issues),
        "issues_by_priority": issue_by_prio,
        "agent_reflections_sampled": reflections,
    }


class DataAssetPatchIn(BaseModel):
    owner: str | None = Field(default=None, max_length=80)
    status: str | None = Field(default=None, pattern="^(active|planned|deprecated|paused)$")
    security_level: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=2000)
    tags: list[str] | None = Field(default=None, max_length=30)
    quality_rules: list[str] | None = Field(default=None, max_length=30)
    lineage_upstream: list[str] | None = Field(default=None, max_length=60)
    lineage_downstream: list[str] | None = Field(default=None, max_length=60)


class DataMetricIn(BaseModel):
    id: str = Field(..., min_length=2, max_length=80)
    name: str = Field(..., min_length=2, max_length=120)
    domain: str = Field("business", max_length=60)
    source: str = Field("", max_length=120)
    grain: str = Field("project", max_length=120)
    unit: str = Field("count", max_length=40)
    owner: str = Field("DataOps", max_length=80)
    status: str = Field("active", pattern="^(active|planned|deprecated|paused)$")
    description: str = Field("", max_length=2000)
    formula: str = Field("", max_length=4000)
    tags: list[str] = Field(default_factory=list, max_length=30)


class DataTagIn(BaseModel):
    id: str = Field(..., min_length=2, max_length=80)
    name: str = Field(..., min_length=2, max_length=120)
    category: str = Field("business", max_length=60)
    owner: str = Field("DataOps", max_length=80)
    status: str = Field("active", pattern="^(active|planned|deprecated|paused)$")
    rule: str = Field("", max_length=4000)
    target_assets: list[str] = Field(default_factory=list, max_length=60)
    freshness: str = Field("daily", max_length=60)
    description: str = Field("", max_length=2000)


class DataServiceIn(BaseModel):
    id: str = Field(..., min_length=2, max_length=100)
    name: str = Field(..., min_length=2, max_length=160)
    type: str = Field("metric_api", max_length=80)
    status: str = Field("draft", pattern="^(draft|published|paused|deprecated)$")
    owner: str = Field("DataOps", max_length=80)
    endpoint: str = Field("", max_length=300)
    method: str = Field("GET", max_length=12)
    auth_policy: str = Field("tenant_business_project_scope", max_length=120)
    rate_limit: str = Field("300/min", max_length=80)
    sla: str = Field("99.0%", max_length=80)
    assets: list[str] = Field(default_factory=list, max_length=80)
    metrics: list[str] = Field(default_factory=list, max_length=80)
    consumers: list[str] = Field(default_factory=list, max_length=80)
    description: str = Field("", max_length=3000)


class DataServicePublishIn(BaseModel):
    status: str = Field("published", pattern="^(published|paused|deprecated|draft)$")
    note: str = Field("", max_length=1000)


class DataDevTemplateIn(BaseModel):
    id: str = Field(..., min_length=2, max_length=100)
    name: str = Field(..., min_length=2, max_length=160)
    type: str = Field("data_development", max_length=80)
    engine: str = Field("SQL", max_length=120)
    status: str = Field("active", pattern="^(active|planned|deprecated|paused)$")
    priority: str = Field("P1", pattern="^P[0-3]$")
    owner: str = Field("Data Platform Agent", max_length=80)
    dev_tool: str = Field("codex", max_length=80)
    assets: list[str] = Field(default_factory=list, max_length=80)
    quality_gates: list[str] = Field(default_factory=list, max_length=80)
    dag: list[dict[str, Any]] = Field(default_factory=list, max_length=40)
    description: str = Field("", max_length=3000)


class DataDevTasksIn(TaskOwnerInput):
    ids: list[str] = Field(default_factory=list, max_length=100)
    dry_run: bool = True
    priority: str = Field("", max_length=2)
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field("", max_length=80)


class DataDevScheduleIn(TaskOwnerInput):
    ids: list[str] = Field(default_factory=list, max_length=100)
    dry_run: bool = True
    max_parallel: int = Field(4, ge=1, le=20)
    policy: str = Field("quality_first", pattern="^(quality_first|balanced|throughput|cost_saver)$")
    priority: str = Field("", max_length=2)
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field("", max_length=80)
    event: str = Field("manual", max_length=80)


class DataDevScheduleActionIn(TaskOwnerInput):
    action: str = Field(..., pattern="^(rerun|cancel|archive|restore)$")
    dry_run: bool = True
    max_parallel: int = Field(4, ge=1, le=20)
    policy: str = Field("quality_first", pattern="^(quality_first|balanced|throughput|cost_saver)$")
    priority: str = Field("", max_length=2)
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field("", max_length=80)
    note: str = Field("", max_length=1000)


class DataDevPacketActionIn(BaseModel):
    schedule_id: str = Field(..., min_length=2, max_length=120)
    packet_id: str = Field(..., min_length=2, max_length=120)
    action: str = Field(..., pattern="^(claim|heartbeat|report)$")
    agent: str = Field("Data Platform Agent", max_length=120)
    progress: int = Field(0, ge=0, le=100)
    status: str = Field("running", max_length=40)
    summary: str = Field("", max_length=2000)
    artifact_url: str = Field("", max_length=500)
    evidence: list[dict[str, Any]] = Field(default_factory=list, max_length=80)
    blockers: list[str] = Field(default_factory=list, max_length=80)
    warnings: list[str] = Field(default_factory=list, max_length=80)
    note: str = Field("", max_length=1000)


class DataDevEvidenceTasksIn(TaskOwnerInput):
    schedule_id: str = Field("", max_length=120)
    packet_id: str = Field("", max_length=120)
    decisions: list[str] = Field(default_factory=lambda: ["block", "warn"], max_length=5)
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field("codex", max_length=80)


class DataDevEvidenceNotifyIn(BaseModel):
    schedule_id: str = Field("", max_length=120)
    packet_id: str = Field("", max_length=120)
    decisions: list[str] = Field(default_factory=lambda: ["block", "warn"], max_length=5)
    channels: list[str] = Field(default_factory=list, max_length=20)
    dry_run: bool = True


class DataDevRunbookIn(TaskOwnerInput):
    schedule_id: str = Field("", max_length=120)
    packet_id: str = Field("", max_length=120)
    decisions: list[str] = Field(default_factory=lambda: ["block", "warn"], max_length=5)
    include_unclaimed: bool = True
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field("codex", max_length=80)


class DataQualityEvaluateIn(BaseModel):
    asset_ids: list[str] = Field(default_factory=list, max_length=100)


class DataAlertNotifyIn(BaseModel):
    channels: list[str] = Field(default_factory=list, max_length=20)
    dry_run: bool = True


class DataGovernanceTasksIn(TaskOwnerInput):
    ids: list[str] = Field(default_factory=list, max_length=100)
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field("codex", max_length=80)


@router.get("/health")
def analytics_health() -> dict[str, Any]:
    return {"ok": True, "service": "analytics"}


@router.get("/overview")
def analytics_overview(db: Session = Depends(get_session)) -> dict[str, Any]:
    pid = _require_scope()
    return {
        "ok": True,
        "project_id": pid,
        "metrics": _build_metrics(db, pid),
        "nlq": {"enabled": True, "hint": "POST /api/v1/analytics/nlq 自然语言提问"},
    }


@router.get("/charts")
def analytics_charts(db: Session = Depends(get_session)) -> dict[str, Any]:
    """ECharts 友好：任务/需求/问题分布与近 7 日创建趋势。"""
    pid = _require_scope()
    metrics = _build_metrics(db, pid)
    tasks = db.query(Task).filter_by(project_id=pid).all()
    reqs = db.query(Requirement).filter_by(project_id=pid).all()

    def _pie(counter: dict[str, int]) -> list[dict[str, Any]]:
        return [{"name": k, "value": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0])) if v > 0]

    now = datetime.now(timezone.utc)
    days: list[str] = []
    task_trend: list[int] = []
    req_trend: list[int] = []
    for offset in range(6, -1, -1):
        d = (now - timedelta(days=offset)).date()
        days.append(d.isoformat())
        task_trend.append(sum(1 for t in tasks if getattr(t, "created_at", None) and t.created_at.date() == d))
        req_trend.append(sum(1 for r in reqs if getattr(r, "created_at", None) and r.created_at.date() == d))

    return {
        "ok": True,
        "project_id": pid,
        "task_status": _pie(metrics.get("tasks_by_status") or {}),
        "issue_priority": _pie(metrics.get("issues_by_priority") or {}),
        "activity_trend": {
            "days": days,
            "series": [
                {"name": "tasks", "data": task_trend},
                {"name": "requirements", "data": req_trend},
            ],
        },
    }


GOVERNANCE_DOMAINS = frozenset({"assets", "metrics", "services", "quality", "development"})


def _pie_items(counter: dict[str, int]) -> list[dict[str, Any]]:
    return [{"name": k, "value": v} for k, v in sorted(counter.items(), key=lambda x: (-x[1], x[0])) if v > 0]


def _domain_summary(domain: str, data: dict[str, Any]) -> dict[str, Any]:
    base = _governance_summary(data)
    rules = list(data.get("quality_rules") or [])
    assets = list(data.get("assets") or [])
    if domain == "assets":
        by_status: dict[str, int] = {}
        for asset in assets:
            st = str(asset.get("status") or "unknown")
            by_status[st] = by_status.get(st, 0) + 1
        return {
            "domain": domain,
            "total": len(assets),
            "active": by_status.get("active", 0),
            "quality_blocked": base.get("quality_blocked", 0),
            "quality_avg": base.get("quality_avg", 0),
            "by_status": by_status,
        }
    if domain == "metrics":
        metrics = list(data.get("metrics") or [])
        tags = list(data.get("tags") or [])
        by_domain: dict[str, int] = {}
        for row in metrics:
            d = str(row.get("domain") or "unknown")
            by_domain[d] = by_domain.get(d, 0) + 1
        return {"domain": domain, "metrics": len(metrics), "tags": len(tags), "domains": len(by_domain), "by_domain": by_domain}
    if domain == "services":
        services = list(data.get("services") or [])
        by_status: dict[str, int] = {}
        for row in services:
            st = str(row.get("status") or "draft")
            by_status[st] = by_status.get(st, 0) + 1
        published = sum(1 for x in services if str(x.get("status")) == "published")
        return {"domain": domain, "total": len(services), "published": published, "draft": by_status.get("draft", 0), "by_status": by_status}
    if domain == "quality":
        alerts = _quality_alerts(data)
        by_severity: dict[str, int] = {}
        open_count = 0
        for alert in alerts:
            sev = str(alert.get("severity") or "warning")
            by_severity[sev] = by_severity.get(sev, 0) + 1
            if str(alert.get("status") or "open") == "open":
                open_count += 1
        return {
            "domain": domain,
            "rules": len(rules),
            "alerts": len(alerts),
            "open_alerts": open_count,
            "quality_blocked": base.get("quality_blocked", 0),
            "by_severity": by_severity,
        }
    dev_templates = list(data.get("dev_templates") or [])
    dev_schedules = list(data.get("dev_schedules") or [])
    by_engine: dict[str, int] = {}
    for row in dev_templates:
        eng = str(row.get("engine") or "unknown")
        by_engine[eng] = by_engine.get(eng, 0) + 1
    return {
        "domain": domain,
        "templates": len(dev_templates),
        "active_templates": base.get("active_dev_templates", 0),
        "schedules": len(dev_schedules),
        "by_engine": by_engine,
    }


def _domain_charts(domain: str, data: dict[str, Any]) -> dict[str, Any]:
    rules = list(data.get("quality_rules") or [])
    assets = list(data.get("assets") or [])
    if domain == "assets":
        by_domain: dict[str, int] = {}
        by_decision: dict[str, int] = {}
        for asset in assets:
            d = str(asset.get("domain") or "unknown")
            by_domain[d] = by_domain.get(d, 0) + 1
            q = _asset_quality(asset, rules)
            dec = str(q.get("decision") or "unknown")
            by_decision[dec] = by_decision.get(dec, 0) + 1
        return {"by_domain": _pie_items(by_domain), "by_quality": _pie_items(by_decision)}
    if domain == "metrics":
        by_domain: dict[str, int] = {}
        for row in data.get("metrics") or []:
            d = str(row.get("domain") or "unknown")
            by_domain[d] = by_domain.get(d, 0) + 1
        by_category: dict[str, int] = {}
        for row in data.get("tags") or []:
            c = str(row.get("category") or "unknown")
            by_category[c] = by_category.get(c, 0) + 1
        return {"metrics_by_domain": _pie_items(by_domain), "tags_by_category": _pie_items(by_category)}
    if domain == "services":
        by_status: dict[str, int] = {}
        by_type: dict[str, int] = {}
        for row in data.get("services") or []:
            by_status[str(row.get("status") or "draft")] = by_status.get(str(row.get("status") or "draft"), 0) + 1
            by_type[str(row.get("type") or "unknown")] = by_type.get(str(row.get("type") or "unknown"), 0) + 1
        return {"by_status": _pie_items(by_status), "by_type": _pie_items(by_type)}
    if domain == "quality":
        by_severity: dict[str, int] = {}
        for alert in _quality_alerts(data):
            sev = str(alert.get("severity") or "warning")
            by_severity[sev] = by_severity.get(sev, 0) + 1
        return {"by_severity": _pie_items(by_severity)}
    by_engine: dict[str, int] = {}
    by_status: dict[str, int] = {}
    for row in data.get("dev_templates") or []:
        by_engine[str(row.get("engine") or "unknown")] = by_engine.get(str(row.get("engine") or "unknown"), 0) + 1
        by_status[str(row.get("status") or "draft")] = by_status.get(str(row.get("status") or "draft"), 0) + 1
    return {"templates_by_engine": _pie_items(by_engine), "templates_by_status": _pie_items(by_status)}


def _governance_hub_payload(data: dict[str, Any]) -> dict[str, Any]:
    summary = _governance_summary(data)
    domains = [
        {
            "id": "assets",
            "path": "#/analytics/catalog/assets",
            "summary": _domain_summary("assets", data),
            "capabilities": ["asset_catalog", "quality_evaluate", "governance_tasks", "lineage_link"],
        },
        {
            "id": "metrics",
            "path": "#/analytics/catalog/metrics",
            "summary": _domain_summary("metrics", data),
            "capabilities": ["metric_definitions", "tag_rules", "semantic_layer", "ownership"],
        },
        {
            "id": "services",
            "path": "#/analytics/catalog/services",
            "summary": _domain_summary("services", data),
            "capabilities": ["service_catalog", "publishing", "health", "consumer_governance"],
        },
        {
            "id": "quality",
            "path": "#/analytics/catalog/quality",
            "summary": _domain_summary("quality", data),
            "capabilities": ["alerts", "notify", "fix_tasks", "rules_engine"],
        },
        {
            "id": "development",
            "path": "#/analytics/catalog/development",
            "summary": _domain_summary("development", data),
            "capabilities": ["templates", "schedules", "agent_feed", "evidence", "runbook"],
        },
    ]
    stack_layers = [
        {
            "id": "data",
            "title": "数据层",
            "items": ["接入 CDC", "湖仓建模", "血缘", "质量规则"],
            "engines": ["OceanBase", "StarRocks", "Spark", "Flink", "Paimon"],
        },
        {
            "id": "ai",
            "title": "AI 层",
            "items": ["NLQ", "Copilot", "Agent Feed", "蒸馏规则"],
            "engines": ["LLM Gateway", "RAG", "Memory", "MCP"],
        },
        {
            "id": "business",
            "title": "业务层",
            "items": ["指标语义", "标签画像", "租户隔离", "审批治理"],
            "engines": ["tenant/business/project scope", "Audit", "Billing"],
        },
        {
            "id": "application",
            "title": "应用层",
            "items": ["数据服务 API", "报表订阅", "任务闭环", "Notify"],
            "engines": ["Manager API", "CLI/SDK", "Workflow", "Webhook"],
        },
    ]
    return {
        "ok": True,
        "scope": _data_scope(),
        "summary": summary,
        "domains": domains,
        "stack_layers": stack_layers,
        "vision": "data_plus_ai_plus_business_plus_application",
    }


@router.get("/hub")
def analytics_data_hub(db: Session = Depends(get_session)) -> dict[str, Any]:
    """数据智能域总入口：项目级指标 + 各数据子域导航。"""
    pid = _require_scope()
    metrics = _build_metrics(db, pid)
    charts = analytics_charts(db)
    return {
        "ok": True,
        "summary": {
            "tasks_total": metrics.get("tasks_total", 0),
            "requirements_total": metrics.get("requirements_total", 0),
            "issues_total": metrics.get("issues_total", 0),
            "reflections": metrics.get("agent_reflections_sampled", 0),
        },
        "charts": {
            "task_status": charts.get("task_status") or [],
            "issue_priority": charts.get("issue_priority") or [],
        },
        "domains": [
            {"id": "overview", "path": "#/analytics/overview", "capability": "data.analytics.overview"},
            {"id": "catalog", "path": "#/analytics/catalog", "capability": "data.analytics.catalog"},
            {"id": "blueprint", "path": "#/analytics/blueprint", "capability": "data.analytics.blueprint"},
            {"id": "reports", "path": "#/analytics/reports", "capability": "data.analytics.reports"},
            {"id": "exchange", "path": "#/analytics/exchange", "capability": "data.exchange"},
            {"id": "lineage", "path": "#/analytics/lineage", "capability": "data.analytics.lineage"},
            {"id": "nlq", "path": "#/analytics/nlq", "capability": "data.analytics.nlq"},
        ],
    }


@router.get("/governance/hub")
def analytics_governance_hub() -> dict[str, Any]:
    _require_scope()
    return _governance_hub_payload(_load_governance())


@router.get("/governance/domains/{domain}/summary")
def analytics_governance_domain_summary(domain: str) -> dict[str, Any]:
    _require_scope()
    if domain not in GOVERNANCE_DOMAINS:
        raise HTTPException(404, "未知数据治理域")
    data = _load_governance()
    return {"ok": True, "scope": _data_scope(), "summary": _domain_summary(domain, data)}


@router.get("/governance/domains/{domain}/charts")
def analytics_governance_domain_charts(domain: str) -> dict[str, Any]:
    _require_scope()
    if domain not in GOVERNANCE_DOMAINS:
        raise HTTPException(404, "未知数据治理域")
    data = _load_governance()
    return {"ok": True, "scope": _data_scope(), "domain": domain, "charts": _domain_charts(domain, data)}


@router.get("/catalog")
def analytics_catalog() -> dict[str, Any]:
    _require_scope()
    return {"ok": True, "items": METRIC_CATALOG, "total": len(METRIC_CATALOG)}


@router.get("/assets")
def analytics_assets(
    type: str = Query("", max_length=80),  # noqa: A002
    status: str = Query("", max_length=40),
    q: str = Query("", max_length=200),
) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    rules = list(data.get("quality_rules") or [])
    q_norm = q.strip().lower()
    items: list[dict[str, Any]] = []
    for asset in data.get("assets") or []:
        if type and str(asset.get("type") or "") != type:
            continue
        if status and str(asset.get("status") or "") != status:
            continue
        if q_norm:
            hay = " ".join(
                [
                    str(asset.get("id") or ""),
                    str(asset.get("name") or ""),
                    str(asset.get("domain") or ""),
                    str(asset.get("source") or ""),
                    str(asset.get("owner") or ""),
                    str(asset.get("description") or ""),
                    " ".join(str(x) for x in asset.get("tags", []) if x),
                ]
            ).lower()
            if q_norm not in hay:
                continue
        items.append({**asset, "quality": _asset_quality(asset, rules)})
    return {"ok": True, "scope": _data_scope(), "summary": _governance_summary(data), "items": items, "total": len(items)}


@router.patch("/assets/{asset_id}")
def analytics_asset_patch(asset_id: str, body: DataAssetPatchIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    patch = body.model_dump(exclude_none=True)
    for asset in data.get("assets") or []:
        if str(asset.get("id")) == asset_id:
            asset.update(patch)
            asset["updated_at"] = _utc_now()
            _save_governance(data)
            return {"ok": True, "item": {**asset, "quality": _asset_quality(asset, list(data.get("quality_rules") or []))}}
    raise HTTPException(404, "数据资产不存在")


@router.get("/metrics/center")
def analytics_metrics_center(domain: str = Query("", max_length=80), q: str = Query("", max_length=200)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    q_norm = q.strip().lower()
    items: list[dict[str, Any]] = []
    for metric in data.get("metrics") or []:
        if domain and str(metric.get("domain") or "") != domain:
            continue
        if q_norm:
            hay = json.dumps(metric, ensure_ascii=False).lower()
            if q_norm not in hay:
                continue
        items.append(metric)
    return {"ok": True, "scope": _data_scope(), "items": items, "total": len(items)}


@router.post("/metrics/center")
def analytics_metric_upsert(body: DataMetricIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    row = {
        **body.model_dump(),
        "key": body.id,
        "version": "v1",
        "quality_score": 80 if body.owner else 56,
        "service_level": "project",
        "updated_at": _utc_now(),
    }
    metrics = list(data.get("metrics") or [])
    replaced = False
    for idx, item in enumerate(metrics):
        if str(item.get("id") or item.get("key")) == body.id:
            metrics[idx] = {**item, **row}
            replaced = True
            break
    if not replaced:
        metrics.append(row)
    data["metrics"] = metrics
    _save_governance(data)
    return {"ok": True, "created": not replaced, "item": row}


@router.get("/tags")
def analytics_tags(category: str = Query("", max_length=80), q: str = Query("", max_length=200)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    q_norm = q.strip().lower()
    items: list[dict[str, Any]] = []
    for tag in data.get("tags") or []:
        if category and str(tag.get("category") or "") != category:
            continue
        if q_norm and q_norm not in json.dumps(tag, ensure_ascii=False).lower():
            continue
        items.append(tag)
    return {"ok": True, "scope": _data_scope(), "items": items, "total": len(items)}


@router.post("/tags")
def analytics_tag_upsert(body: DataTagIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    row = {**body.model_dump(), "updated_at": _utc_now()}
    tags = list(data.get("tags") or [])
    replaced = False
    for idx, item in enumerate(tags):
        if str(item.get("id")) == body.id:
            tags[idx] = {**item, **row}
            replaced = True
            break
    if not replaced:
        tags.append(row)
    data["tags"] = tags
    _save_governance(data)
    return {"ok": True, "created": not replaced, "item": row}


@router.get("/services")
def analytics_data_services(status: str = Query("", max_length=40), q: str = Query("", max_length=200)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    q_norm = q.strip().lower()
    items: list[dict[str, Any]] = []
    for service in data.get("services") or []:
        if status and str(service.get("status") or "") != status:
            continue
        if q_norm and q_norm not in json.dumps(service, ensure_ascii=False).lower():
            continue
        items.append({**service, "health": _service_health(service, data)})
    return {"ok": True, "scope": _data_scope(), "summary": _governance_summary(data), "items": items, "total": len(items)}


@router.post("/services")
def analytics_data_service_upsert(body: DataServiceIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    row = {**body.model_dump(), "updated_at": _utc_now(), "version": "v1"}
    services = list(data.get("services") or [])
    replaced = False
    for idx, item in enumerate(services):
        if str(item.get("id")) == body.id:
            row = {**item, **row}
            services[idx] = row
            replaced = True
            break
    if not replaced:
        services.append(row)
    data["services"] = services
    _save_governance(data)
    return {"ok": True, "created": not replaced, "item": {**row, "health": _service_health(row, data)}}


@router.post("/services/{service_id}/publish")
def analytics_data_service_publish(service_id: str, body: DataServicePublishIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    for service in data.get("services") or []:
        if str(service.get("id")) != service_id:
            continue
        patch = {
            "status": body.status,
            "published_at": _utc_now() if body.status == "published" else service.get("published_at", ""),
            "publish_note": body.note,
            "updated_at": _utc_now(),
        }
        service.update(patch)
        _save_governance(data)
        return {"ok": True, "item": {**service, "health": _service_health(service, data)}}
    raise HTTPException(404, "数据服务不存在")


def _template_task_item(template: dict[str, Any], body: DataDevTasksIn) -> dict[str, Any]:
    dag = template.get("dag") if isinstance(template.get("dag"), list) else []
    gates = [str(x) for x in template.get("quality_gates", []) if str(x).strip()]
    return {
        "title": f"数据开发：{template.get('name')}",
        "description": (
            "Hermes 数据开发模板任务。\n\n"
            f"模板 ID: {template.get('id')}\n"
            f"类型: {template.get('type')}\n"
            f"计算引擎: {template.get('engine')}\n"
            f"依赖资产: {', '.join(template.get('assets') or []) or '-'}\n"
            f"质量卡点: {', '.join(gates) or '-'}\n"
            f"DAG: {json.dumps(dag, ensure_ascii=False)}\n\n"
            f"{template.get('description') or ''}\n\n"
            "请按 tenant_code/business_code/project_id 隔离要求实现数据开发、调度、质量评估、事件唤醒、告警和数据服务发布闭环。"
        ),
        "priority": body.priority or template.get("priority") or "P1",
        "estimate": "L",
        "owner_id": body.owner_id,
        "dev_tool": body.dev_tool or template.get("dev_tool") or "codex",
        "source": "data_development_template",
        "source_report_id": template.get("id"),
        "source_report_title": template.get("name"),
        "quality_gates": gates,
        "debug_notes": f"data_template={template.get('id')} engine={template.get('engine')}",
    }


def _template_quality_gates(template: dict[str, Any]) -> list[dict[str, Any]]:
    raw_gates = [str(x).strip() for x in template.get("quality_gates", []) if str(x).strip()]
    standard = [
        ("scope.isolation", "三码隔离 tenant_code/business_code/project_id 已声明并贯穿数据访问。", "blocking"),
        ("data.lineage", "输入、输出、血缘、消费方和资产影响范围可追溯。", "blocking"),
        ("data.quality", "质量规则、阈值、异常处置和告警通道有证据。", "blocking"),
        ("schedule.dag", "DAG 依赖、重试、并发、补数和事件唤醒策略已配置。", "blocking"),
        ("service.contract", "指标/标签/API/报表消费契约和权限策略已同步。", "advisory"),
    ]
    gates = [
        {
            "id": gate_id,
            "name": gate_id,
            "type": "data_development",
            "severity": severity,
            "required": severity == "blocking",
            "status": "pending",
            "evidence": evidence,
        }
        for gate_id, evidence, severity in standard
    ]
    existing = {str(g["id"]) for g in gates}
    for gate in raw_gates:
        gate_id = f"template.{gate}"
        if gate_id in existing:
            continue
        gates.append(
            {
                "id": gate_id,
                "name": gate,
                "type": "template_quality",
                "severity": "blocking" if gate in {"freshness_check", "schema_check", "lineage_check", "sla_check"} else "advisory",
                "required": True,
                "status": "pending",
                "evidence": f"模板质量卡点 {gate} 需要在 Agent report 中提交执行证据。",
            }
        )
    return gates


def _template_dag_steps(template: dict[str, Any]) -> list[dict[str, Any]]:
    dag = template.get("dag") if isinstance(template.get("dag"), list) else []
    if dag:
        return [dict(step) for step in dag if isinstance(step, dict)]
    tid = str(template.get("id") or "template")
    return [
        {"id": f"{tid}.spec", "name": "需求与数据契约解析", "depends_on": [], "agent_role": "data-product-agent"},
        {"id": f"{tid}.build", "name": "数据开发与调度配置", "depends_on": [f"{tid}.spec"], "agent_role": "data-engineer-agent"},
        {"id": f"{tid}.quality", "name": "质量评估与告警验证", "depends_on": [f"{tid}.build"], "agent_role": "quality-agent"},
        {"id": f"{tid}.publish", "name": "数据服务发布与知识沉淀", "depends_on": [f"{tid}.quality"], "agent_role": "data-service-agent"},
    ]


def _template_packet(template: dict[str, Any], body: DataDevScheduleIn, *, order: int, lane: int) -> dict[str, Any]:
    template_id = str(template.get("id") or "")
    owner_id = body.owner_id
    dev_tool = body.dev_tool or str(template.get("dev_tool") or "codex")
    steps = _template_dag_steps(template)
    blocked_by = [] if str(template.get("status") or "") == "active" else [f"template_status:{template.get('status') or 'unknown'}"]
    return {
        "packet_id": f"data-pkt-{uuid4().hex[:12]}",
        "order": order,
        "lane": lane,
        "ready": not blocked_by,
        "blocked_by": blocked_by,
        "task_id": f"data-template:{template_id}",
        "template_id": template_id,
        "title": f"数据开发：{template.get('name')}",
        "priority": body.priority or template.get("priority") or "P1",
        "status": template.get("status") or "active",
        "owner_id": owner_id,
        "dev_tool": dev_tool,
        "dispatch_reason": f"data_template type={template.get('type')} engine={template.get('engine')} policy={body.policy}",
        "scope": _data_scope(),
        "contract": {
            "objective": f"按模板 {template.get('name')} 完成数据开发、调度、质量和发布闭环。",
            "template_id": template_id,
            "template_type": template.get("type") or "data_development",
            "engine": template.get("engine") or "SQL",
            "assets": template.get("assets") or [],
            "dag": steps,
            "done_definition": [
                "数据开发实现与模板描述、资产范围、质量卡点一致。",
                "DAG 依赖、事件唤醒、重试补数、调度并发与告警策略可被调度中心消费。",
                "Agent report 回写质量证据、产物地址、发布状态和下一步动作。",
            ],
        },
        "quality_gates": _template_quality_gates(template),
        "callbacks": {
            "schedule": "POST /api/v1/analytics/development/schedule",
            "create_tasks": "POST /api/v1/analytics/development/tasks",
            "agent_feed": "GET /api/v1/tasks/agent-feed",
            "quality_evaluate": "POST /api/v1/tasks/quality/evaluate",
            "events_ingest": "POST /api/v1/events:ingest",
        },
        "suggested_commands": [
            "sop context prepare --flush",
            f"sop data dev-schedule --ids {template_id} --json",
            f"sop data dev-tasks --ids {template_id} --apply",
            "sop task feed --json",
        ],
    }


def _development_schedule_plan(templates: list[dict[str, Any]], body: DataDevScheduleIn) -> dict[str, Any]:
    def rank(template: dict[str, Any]) -> tuple[int, int, str]:
        priority_rank = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}.get(str(template.get("priority") or "P3"), 9)
        gate_count = len(template.get("quality_gates") or [])
        if body.policy == "throughput":
            return priority_rank, len(_template_dag_steps(template)), str(template.get("id") or "")
        if body.policy == "cost_saver":
            return priority_rank, gate_count, str(template.get("id") or "")
        if body.policy == "quality_first":
            return priority_rank, -gate_count, str(template.get("id") or "")
        return priority_rank, 0, str(template.get("id") or "")

    ordered = sorted(templates, key=rank)
    packets = [
        _template_packet(tpl, body, order=idx, lane=((idx - 1) % body.max_parallel) + 1)
        for idx, tpl in enumerate(ordered, start=1)
    ]
    stages = [
        {
            "stage": idx,
            "template_id": str(tpl.get("id") or ""),
            "template": tpl.get("name") or "",
            "engine": tpl.get("engine") or "",
            "status": tpl.get("status") or "",
            "lane": ((idx - 1) % body.max_parallel) + 1,
            "steps": _template_dag_steps(tpl),
            "quality_gates": [g["id"] for g in _template_quality_gates(tpl)],
        }
        for idx, tpl in enumerate(ordered, start=1)
    ]
    event_wakeups = [
        {"event": "data.template.created", "action": "rebuild_data_dev_schedule", "target": "data_scheduler"},
        {"event": "data.quality.alert", "action": "prioritize_related_template_packet", "target": "data_scheduler"},
        {"event": "task.agent_reported", "action": "evaluate_quality_gate_and_unlock_next_dag_step", "target": "quality_center"},
        {"event": "notify.inbound", "action": "convert_data_request_to_template_task", "target": "intake"},
        {"event": "workflow.signal", "action": "wake_paused_data_pipeline", "target": "workflow_ops"},
    ]
    return {
        "ok": True,
        "dry_run": body.dry_run,
        "schedule_id": f"data-sched-{uuid4().hex[:12]}",
        "scope": _data_scope(),
        "policy": body.policy,
        "max_parallel": body.max_parallel,
        "event": body.event,
        "summary": {
            "templates": len(ordered),
            "ready": sum(1 for x in packets if x.get("ready")),
            "blocked": sum(1 for x in packets if not x.get("ready")),
            "stages": len(stages),
            "packets": len(packets),
            "dag_steps": sum(len(stage["steps"]) for stage in stages),
            "quality_gates": sum(len(packet["quality_gates"]) for packet in packets),
            "event_wakeups": len(event_wakeups),
        },
        "stages": stages,
        "agent_packets": packets,
        "event_wakeups": event_wakeups,
    }


def _schedule_record_matches(record: dict[str, Any], schedule_id: str) -> bool:
    return str(record.get("id") or record.get("schedule_id") or "") == schedule_id


def _schedule_history_item(record: dict[str, Any]) -> dict[str, Any]:
    summary = record.get("summary") if isinstance(record.get("summary"), dict) else {}
    return {
        "id": record.get("id") or record.get("schedule_id") or "",
        "scope": record.get("scope") or _data_scope(),
        "policy": record.get("policy") or "",
        "event": record.get("event") or "",
        "max_parallel": record.get("max_parallel") or 0,
        "template_ids": record.get("template_ids") or [],
        "created_task_ids": record.get("created_task_ids") or [],
        "summary": summary,
        "created_at": record.get("created_at") or "",
        "status": record.get("status") or "applied",
        "templates": summary.get("templates", len(record.get("template_ids") or [])),
        "packets": summary.get("packets", len(record.get("agent_packets") or [])),
        "quality_gates": summary.get("quality_gates", 0),
        "event_wakeups": summary.get("event_wakeups", len(record.get("event_wakeups") or [])),
        "created_tasks": len(record.get("created_task_ids") or record.get("created_tasks") or []),
    }


def _append_schedule_event(record: dict[str, Any], event: str, note: str = "") -> None:
    events = list(record.get("events") or [])
    events.insert(0, {"event": event, "note": note, "at": _utc_now()})
    record["events"] = events[:100]
    record["updated_at"] = _utc_now()


def _dev_agent_feed_items(data: dict[str, Any], *, schedule_id: str = "", include_blocked: bool = False, agent: str = "", limit: int = 20) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    agent_norm = agent.strip().lower()
    for record in data.get("dev_schedules") or []:
        if not isinstance(record, dict):
            continue
        rid = str(record.get("id") or "")
        if schedule_id and rid != schedule_id:
            continue
        if str(record.get("status") or "applied") not in {"applied", "running"}:
            continue
        claims = record.get("packet_claims") if isinstance(record.get("packet_claims"), dict) else {}
        reports = record.get("packet_reports") if isinstance(record.get("packet_reports"), dict) else {}
        for packet in record.get("agent_packets") or []:
            if not isinstance(packet, dict):
                continue
            if not include_blocked and not bool(packet.get("ready")):
                continue
            if agent_norm and agent_norm not in str(packet.get("owner_id") or "").lower():
                continue
            packet_id = str(packet.get("packet_id") or "")
            claim = claims.get(packet_id) if isinstance(claims.get(packet_id), dict) else None
            report = reports.get(packet_id) if isinstance(reports.get(packet_id), dict) else None
            items.append(
                {
                    **packet,
                    "schedule_id": rid,
                    "schedule_status": record.get("status") or "applied",
                    "created_at": record.get("created_at") or "",
                    "claim": claim,
                    "report": report,
                    "packet_status": (report or {}).get("status") or (claim or {}).get("status") or ("ready" if packet.get("ready") else "blocked"),
                    "callbacks": {
                        **(packet.get("callbacks") or {}),
                        "data_packet_action": "POST /api/v1/analytics/development/agent-feed/action",
                    },
                }
            )
            if len(items) >= limit:
                return items
    return items


def _find_schedule_record(data: dict[str, Any], schedule_id: str) -> dict[str, Any] | None:
    for record in data.get("dev_schedules") or []:
        if isinstance(record, dict) and _schedule_record_matches(record, schedule_id):
            return record
    return None


def _packet_evidence_score(packet: dict[str, Any], report: dict[str, Any] | None) -> dict[str, Any]:
    gates = packet.get("quality_gates") if isinstance(packet.get("quality_gates"), list) else []
    evidence = report.get("evidence") if report and isinstance(report.get("evidence"), list) else []
    blockers = list(report.get("blockers") or []) if report else []
    warnings = list(report.get("warnings") or []) if report else []
    required = [g for g in gates if isinstance(g, dict) and bool(g.get("required"))]
    evidence_gate_ids = {str(e.get("gate_id") or e.get("id") or "") for e in evidence if isinstance(e, dict)}
    missing = [str(g.get("id") or "") for g in required if str(g.get("id") or "") not in evidence_gate_ids]
    if report and str(report.get("status") or "") in {"failed", "blocked"}:
        blockers.append(f"report_status:{report.get('status')}")
    score = max(0, 100 - len(missing) * 12 - len(blockers) * 20 - len(warnings) * 6)
    decision = "block" if blockers or missing else "warn" if warnings else "pass"
    return {
        "score": score,
        "decision": decision,
        "required_gates": len(required),
        "evidence_count": len(evidence),
        "missing_required_gates": missing,
        "blockers": blockers,
        "warnings": warnings,
    }


def _dev_evidence_items(data: dict[str, Any], *, schedule_id: str = "", packet_id: str = "", decision: str = "", limit: int = 50) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for record in data.get("dev_schedules") or []:
        if not isinstance(record, dict):
            continue
        rid = str(record.get("id") or "")
        if schedule_id and rid != schedule_id:
            continue
        reports = record.get("packet_reports") if isinstance(record.get("packet_reports"), dict) else {}
        claims = record.get("packet_claims") if isinstance(record.get("packet_claims"), dict) else {}
        for packet in record.get("agent_packets") or []:
            if not isinstance(packet, dict):
                continue
            pid = str(packet.get("packet_id") or "")
            if packet_id and pid != packet_id:
                continue
            report = reports.get(pid) if isinstance(reports.get(pid), dict) else None
            quality = _packet_evidence_score(packet, report)
            if decision and quality["decision"] != decision:
                continue
            items.append(
                {
                    "schedule_id": rid,
                    "packet_id": pid,
                    "title": packet.get("title") or "",
                    "owner_id": packet.get("owner_id") or "",
                    "ready": bool(packet.get("ready")),
                    "claim": claims.get(pid) if isinstance(claims.get(pid), dict) else None,
                    "report": report,
                    "quality": quality,
                    "artifact_url": (report or {}).get("artifact_url") or "",
                    "reported_at": (report or {}).get("reported_at") or "",
                }
            )
            if len(items) >= limit:
                return items
    return items


def _dev_ops_summary(data: dict[str, Any]) -> dict[str, Any]:
    schedules = [x for x in data.get("dev_schedules") or [] if isinstance(x, dict)]
    packets = _dev_agent_feed_items(data, include_blocked=True, limit=1000)
    evidence = _dev_evidence_items(data, limit=1000)
    pass_count = sum(1 for x in evidence if x.get("quality", {}).get("decision") == "pass")
    warn_count = sum(1 for x in evidence if x.get("quality", {}).get("decision") == "warn")
    block_count = sum(1 for x in evidence if x.get("quality", {}).get("decision") == "block")
    reported = sum(1 for x in evidence if x.get("report"))
    claimed = sum(1 for x in packets if x.get("claim"))
    ready = sum(1 for x in packets if x.get("ready"))
    applied = sum(1 for x in schedules if str(x.get("status") or "applied") == "applied")
    archived = sum(1 for x in schedules if str(x.get("status") or "") == "archived")
    cancelled = sum(1 for x in schedules if str(x.get("status") or "") == "cancelled")
    total_packets = len(packets)
    health = max(0, 100 - block_count * 18 - warn_count * 8 - max(0, total_packets - reported) * 4)
    recommendations: list[dict[str, Any]] = []
    if block_count:
        recommendations.append({"id": "fix_blocked_evidence", "priority": "P0", "title": "优先修复阻断质量证据", "action": "sop data dev-evidence-tasks --decisions block --apply"})
    if warn_count:
        recommendations.append({"id": "triage_warn_evidence", "priority": "P1", "title": "治理警告质量证据", "action": "sop data dev-evidence-tasks --decisions warn --apply"})
    if total_packets and claimed < total_packets:
        recommendations.append({"id": "claim_ready_packets", "priority": "P1", "title": "领取未处理数据开发包", "action": "sop data dev-feed --include-blocked"})
    if not schedules:
        recommendations.append({"id": "create_schedule", "priority": "P1", "title": "先生成数据开发智能调度", "action": "sop data dev-schedule --apply"})
    by_agent: dict[str, int] = {}
    for packet in packets:
        agent = str(packet.get("owner_id") or "unassigned")
        by_agent[agent] = by_agent.get(agent, 0) + 1
    return {
        "ok": True,
        "scope": _data_scope(),
        "summary": {
            "health": health,
            "schedules": len(schedules),
            "applied_schedules": applied,
            "archived_schedules": archived,
            "cancelled_schedules": cancelled,
            "packets": total_packets,
            "ready_packets": ready,
            "claimed_packets": claimed,
            "reported_packets": reported,
            "evidence": len(evidence),
            "pass": pass_count,
            "warn": warn_count,
            "block": block_count,
            "created_tasks": sum(len(x.get("created_task_ids") or []) for x in schedules),
        },
        "by_agent": [{"agent": k, "packets": v} for k, v in sorted(by_agent.items(), key=lambda x: (-x[1], x[0]))],
        "recommendations": recommendations[:8],
        "latest_schedules": [_schedule_history_item(x) for x in schedules[:5]],
    }


def _dev_runbook_steps(data: dict[str, Any], body: DataDevRunbookIn) -> list[dict[str, Any]]:
    decisions = {str(x).strip() for x in body.decisions if str(x).strip()}
    steps: list[dict[str, Any]] = []
    evidence_items = [
        item
        for item in _dev_evidence_items(data, schedule_id=body.schedule_id, packet_id=body.packet_id, limit=200)
        if (item.get("quality") or {}).get("decision") in decisions
    ]
    for idx, item in enumerate(evidence_items, start=1):
        quality = item.get("quality") or {}
        missing = quality.get("missing_required_gates") or []
        blockers = quality.get("blockers") or []
        warnings = quality.get("warnings") or []
        decision = str(quality.get("decision") or "warn")
        steps.append(
            {
                "id": f"runbook-evidence-{idx}",
                "type": "quality_evidence_fix",
                "priority": "P0" if decision == "block" else body.priority,
                "schedule_id": item.get("schedule_id") or "",
                "packet_id": item.get("packet_id") or "",
                "title": f"修复质量证据：{item.get('title') or item.get('packet_id')}",
                "reason": f"decision={decision} score={quality.get('score')} missing={','.join(missing) or '-'}",
                "agent": body.owner_id,
                "dev_tool": body.dev_tool,
                "commands": [
                    f"sop data dev-evidence --schedule-id {item.get('schedule_id')} --packet-id {item.get('packet_id')} --json",
                    f"sop data dev-packet-action --schedule-id {item.get('schedule_id')} --packet-id {item.get('packet_id')} --action report --status completed --progress 100 --evidence scope.isolation=checked --evidence data.quality=checked --evidence schedule.dag=checked",
                ],
                "acceptance": [
                    "补齐所有 required quality_gates 的 evidence",
                    "blockers 为空，warnings 已给出处置说明",
                    "重新回报 packet 后质量决策不再为 block",
                ],
                "context": {
                    "decision": decision,
                    "score": quality.get("score"),
                    "missing_required_gates": missing,
                    "blockers": blockers,
                    "warnings": warnings,
                    "artifact_url": item.get("artifact_url") or "",
                },
            }
        )
    if body.include_unclaimed:
        packets = _dev_agent_feed_items(data, schedule_id=body.schedule_id, include_blocked=False, limit=200)
        for packet in packets:
            if packet.get("claim") or packet.get("report"):
                continue
            if body.packet_id and str(packet.get("packet_id") or "") != body.packet_id:
                continue
            steps.append(
                {
                    "id": f"runbook-claim-{len(steps) + 1}",
                    "type": "claim_ready_packet",
                    "priority": packet.get("priority") or body.priority,
                    "schedule_id": packet.get("schedule_id") or "",
                    "packet_id": packet.get("packet_id") or "",
                    "title": f"领取并执行数据开发包：{packet.get('title') or packet.get('packet_id')}",
                    "reason": "packet ready but not claimed/reported",
                    "agent": packet.get("owner_id") or body.owner_id,
                    "dev_tool": packet.get("dev_tool") or body.dev_tool,
                    "commands": [
                        f"sop data dev-packet-action --schedule-id {packet.get('schedule_id')} --packet-id {packet.get('packet_id')} --action claim --agent \"{packet.get('owner_id') or body.owner_id}\"",
                        f"sop data dev-packet-action --schedule-id {packet.get('schedule_id')} --packet-id {packet.get('packet_id')} --action heartbeat --progress 50",
                        f"sop data dev-packet-action --schedule-id {packet.get('schedule_id')} --packet-id {packet.get('packet_id')} --action report --status completed --progress 100",
                    ],
                    "acceptance": [
                        "Agent 已领取 packet 并持续心跳",
                        "产物、证据和执行摘要已回写",
                        "调度历史和运营汇总能看到已报告状态",
                    ],
                    "context": {
                        "lane": packet.get("lane"),
                        "ready": packet.get("ready"),
                        "quality_gates": packet.get("quality_gates") or [],
                        "depends_on": packet.get("depends_on") or [],
                    },
                }
            )
    return steps


def _dev_runbook_history_item(item: dict[str, Any]) -> dict[str, Any]:
    summary = item.get("summary") if isinstance(item.get("summary"), dict) else {}
    return {
        "id": item.get("id") or "",
        "created_at": item.get("created_at") or "",
        "steps": summary.get("steps", len(item.get("steps") or [])),
        "quality_steps": summary.get("quality_steps", 0),
        "claim_steps": summary.get("claim_steps", 0),
        "created_tasks": len(item.get("created_task_ids") or []),
        "created_task_ids": item.get("created_task_ids") or [],
    }


@router.get("/development/templates")
def analytics_dev_templates(status: str = Query("", max_length=40), q: str = Query("", max_length=200)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    q_norm = q.strip().lower()
    items: list[dict[str, Any]] = []
    for tpl in data.get("dev_templates") or []:
        if status and str(tpl.get("status") or "") != status:
            continue
        if q_norm and q_norm not in json.dumps(tpl, ensure_ascii=False).lower():
            continue
        items.append(tpl)
    return {"ok": True, "scope": _data_scope(), "summary": _governance_summary(data), "items": items, "total": len(items)}


@router.get("/development/ops-summary")
def analytics_dev_ops_summary() -> dict[str, Any]:
    _require_scope()
    return _dev_ops_summary(_load_governance())


@router.post("/development/runbook")
def analytics_dev_runbook(body: DataDevRunbookIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    steps = _dev_runbook_steps(data, body)
    tasks = []
    for step in steps:
        tasks.append(
            {
                "title": step["title"],
                "description": (
                    "Hermes 数据开发自动化 Runbook 任务。\n\n"
                    f"步骤类型: {step.get('type')}\n"
                    f"调度 ID: {step.get('schedule_id')}\n"
                    f"Packet ID: {step.get('packet_id')}\n"
                    f"原因: {step.get('reason')}\n"
                    f"推荐 Agent: {step.get('agent')}\n"
                    f"推荐工具: {step.get('dev_tool')}\n\n"
                    "建议命令:\n"
                    + "\n".join(f"- {cmd}" for cmd in step.get("commands") or [])
                    + "\n\n验收标准:\n"
                    + "\n".join(f"- {item}" for item in step.get("acceptance") or [])
                ),
                "priority": step.get("priority") or body.priority,
                "estimate": "M",
                "owner_id": body.owner_id,
                "dev_tool": step.get("dev_tool") or body.dev_tool,
                "source": "data_development_runbook",
                "source_report_id": f"{step.get('schedule_id')}:{step.get('packet_id')}:{step.get('type')}",
                "source_report_title": step.get("title") or "",
                "debug_notes": f"data_runbook_step={step.get('id')} reason={step.get('reason')}",
            }
        )
    summary = {
        "steps": len(steps),
        "quality_steps": sum(1 for x in steps if x.get("type") == "quality_evidence_fix"),
        "claim_steps": sum(1 for x in steps if x.get("type") == "claim_ready_packet"),
    }
    if body.dry_run:
        return {"ok": True, "dry_run": True, "scope": _data_scope(), "summary": summary, "steps": steps, "items": tasks}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created: list[dict[str, Any]] = []
    for item in tasks:
        out = create_task(TaskCreate(**item))
        created.append({**item, "id": out.get("id")})
    runbooks = list(data.get("dev_runbooks") or [])
    runbooks.insert(
        0,
        {
            "id": f"data-runbook-{uuid4().hex[:12]}",
            "created_at": _utc_now(),
            "summary": summary,
            "created_task_ids": [x.get("id") for x in created if x.get("id")],
            "steps": steps,
        },
    )
    data["dev_runbooks"] = runbooks[:100]
    _save_governance(data)
    return {"ok": True, "dry_run": False, "scope": _data_scope(), "summary": summary, "created": len(created), "steps": steps, "items": created}


@router.post("/development/templates")
def analytics_dev_template_upsert(body: DataDevTemplateIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    row = {**body.model_dump(), "updated_at": _utc_now()}
    items = list(data.get("dev_templates") or [])
    replaced = False
    for idx, item in enumerate(items):
        if str(item.get("id")) == body.id:
            items[idx] = {**item, **row}
            replaced = True
            break
    if not replaced:
        items.append(row)
    data["dev_templates"] = items
    _save_governance(data)
    return {"ok": True, "created": not replaced, "item": row}


@router.post("/development/tasks")
def analytics_dev_template_tasks(body: DataDevTasksIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    wanted = {str(x) for x in body.ids if str(x).strip()}
    templates = [tpl for tpl in data.get("dev_templates") or [] if (not wanted or str(tpl.get("id")) in wanted)]
    items = [_template_task_item(tpl, body) for tpl in templates]
    if body.dry_run:
        return {"ok": True, "dry_run": True, "created": 0, "items": items}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created: list[dict[str, Any]] = []
    for item in items:
        payload = {k: v for k, v in item.items() if k != "quality_gates"}
        out = create_task(TaskCreate(**payload))
        created.append({**item, "id": out.get("id")})
    return {"ok": True, "dry_run": False, "created": len(created), "items": created}


@router.post("/development/schedule")
def analytics_dev_schedule(body: DataDevScheduleIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    wanted = {str(x).strip() for x in body.ids if str(x).strip()}
    templates = [tpl for tpl in data.get("dev_templates") or [] if (not wanted or str(tpl.get("id")) in wanted)]
    plan = _development_schedule_plan(templates, body)
    if body.dry_run:
        return plan

    from sop_manager.routers.tasks import TaskCreate, create_task

    task_body = DataDevTasksIn(
        ids=[str(tpl.get("id")) for tpl in templates],
        dry_run=False,
        priority=body.priority,
        owner_id=body.owner_id,
        dev_tool=body.dev_tool,
    )
    created: list[dict[str, Any]] = []
    for tpl in templates:
        item = _template_task_item(tpl, task_body)
        payload = {k: v for k, v in item.items() if k != "quality_gates"}
        out = create_task(TaskCreate(**payload))
        created.append({**item, "id": out.get("id")})
    plan["dry_run"] = False
    plan["created"] = len(created)
    plan["created_tasks"] = created
    schedule_record = {
        "id": plan["schedule_id"],
        "scope": _data_scope(),
        "policy": body.policy,
        "event": body.event,
        "max_parallel": body.max_parallel,
        "template_ids": [str(tpl.get("id")) for tpl in templates],
        "created_task_ids": [str(item.get("id")) for item in created if item.get("id")],
        "status": "applied",
        "summary": plan["summary"],
        "stages": plan.get("stages") or [],
        "agent_packets": plan.get("agent_packets") or [],
        "event_wakeups": plan.get("event_wakeups") or [],
        "created_tasks": created,
        "events": [{"event": "schedule.applied", "note": body.event, "at": _utc_now()}],
        "created_at": _utc_now(),
    }
    schedules = list(data.get("dev_schedules") or [])
    schedules.insert(0, schedule_record)
    data["dev_schedules"] = schedules[:200]
    _save_governance(data)
    return plan


@router.get("/development/schedules")
def analytics_dev_schedules(limit: int = Query(20, ge=1, le=100), q: str = Query("", max_length=200)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    q_norm = str(q or "").strip().lower() if isinstance(q, str) else ""
    items: list[dict[str, Any]] = []
    for record in data.get("dev_schedules") or []:
        if not isinstance(record, dict):
            continue
        if q_norm and q_norm not in json.dumps(record, ensure_ascii=False).lower():
            continue
        items.append(_schedule_history_item(record))
    return {
        "ok": True,
        "scope": _data_scope(),
        "items": items[:limit],
        "total": len(items),
        "summary": {
            "schedules": len(items),
            "created_tasks": sum(int(x.get("created_tasks") or 0) for x in items),
            "packets": sum(int(x.get("packets") or 0) for x in items),
            "quality_gates": sum(int(x.get("quality_gates") or 0) for x in items),
        },
    }


@router.get("/development/schedules/{schedule_id}")
def analytics_dev_schedule_detail(schedule_id: str) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    for record in data.get("dev_schedules") or []:
        if isinstance(record, dict) and _schedule_record_matches(record, schedule_id):
            return {"ok": True, "scope": _data_scope(), "item": record}
    raise HTTPException(404, "数据开发调度记录不存在")


@router.post("/development/schedules/{schedule_id}/action")
def analytics_dev_schedule_action(schedule_id: str, body: DataDevScheduleActionIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    schedules = list(data.get("dev_schedules") or [])
    record: dict[str, Any] | None = None
    for item in schedules:
        if isinstance(item, dict) and _schedule_record_matches(item, schedule_id):
            record = item
            break
    if record is None:
        raise HTTPException(404, "数据开发调度记录不存在")

    if body.action == "rerun":
        template_ids = [str(x) for x in record.get("template_ids") or [] if str(x).strip()]
        schedule_body = DataDevScheduleIn(
            ids=template_ids,
            dry_run=body.dry_run,
            max_parallel=body.max_parallel,
            policy=body.policy,
            priority=body.priority,
            owner_id=body.owner_id,
            dev_tool=body.dev_tool,
            event=f"rerun:{schedule_id}",
        )
        templates = [tpl for tpl in data.get("dev_templates") or [] if str(tpl.get("id")) in set(template_ids)]
        plan = _development_schedule_plan(templates, schedule_body)
        plan["parent_schedule_id"] = schedule_id
        if body.dry_run:
            _append_schedule_event(record, "schedule.rerun_previewed", body.note)
            _save_governance(data)
            return plan

        from sop_manager.routers.tasks import TaskCreate, create_task

        task_body = DataDevTasksIn(
            ids=template_ids,
            dry_run=False,
            priority=body.priority,
            owner_id=body.owner_id,
            dev_tool=body.dev_tool,
        )
        created: list[dict[str, Any]] = []
        for tpl in templates:
            item = _template_task_item(tpl, task_body)
            payload = {k: v for k, v in item.items() if k != "quality_gates"}
            out = create_task(TaskCreate(**payload))
            created.append({**item, "id": out.get("id")})
        plan["dry_run"] = False
        plan["created"] = len(created)
        plan["created_tasks"] = created
        child_record = {
            "id": plan["schedule_id"],
            "parent_schedule_id": schedule_id,
            "scope": _data_scope(),
            "policy": body.policy,
            "event": f"rerun:{schedule_id}",
            "max_parallel": body.max_parallel,
            "template_ids": template_ids,
            "created_task_ids": [str(item.get("id")) for item in created if item.get("id")],
            "status": "applied",
            "summary": plan["summary"],
            "stages": plan.get("stages") or [],
            "agent_packets": plan.get("agent_packets") or [],
            "event_wakeups": plan.get("event_wakeups") or [],
            "created_tasks": created,
            "events": [{"event": "schedule.rerun_applied", "note": body.note or schedule_id, "at": _utc_now()}],
            "created_at": _utc_now(),
        }
        _append_schedule_event(record, "schedule.rerun_applied", child_record["id"])
        schedules.insert(0, child_record)
        data["dev_schedules"] = schedules[:200]
        _save_governance(data)
        return plan

    status_by_action = {"cancel": "cancelled", "archive": "archived", "restore": "applied"}
    record["status"] = status_by_action[body.action]
    _append_schedule_event(record, f"schedule.{body.action}", body.note)
    data["dev_schedules"] = schedules
    _save_governance(data)
    return {"ok": True, "scope": _data_scope(), "item": record}


@router.get("/development/agent-feed")
def analytics_dev_agent_feed(
    schedule_id: str = Query("", max_length=120),
    agent: str = Query("", max_length=120),
    include_blocked: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    sid = str(schedule_id or "") if isinstance(schedule_id, str) else ""
    agent_filter = str(agent or "") if isinstance(agent, str) else ""
    lim = int(limit) if isinstance(limit, int) else 20
    items = _dev_agent_feed_items(data, schedule_id=sid, include_blocked=bool(include_blocked), agent=agent_filter, limit=lim)
    return {
        "ok": True,
        "scope": _data_scope(),
        "items": items,
        "total": len(items),
        "summary": {
            "ready": sum(1 for x in items if x.get("ready")),
            "blocked": sum(1 for x in items if not x.get("ready")),
            "claimed": sum(1 for x in items if x.get("claim")),
            "reported": sum(1 for x in items if x.get("report")),
        },
    }


@router.post("/development/agent-feed/action")
def analytics_dev_agent_feed_action(body: DataDevPacketActionIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    record = _find_schedule_record(data, body.schedule_id)
    if record is None:
        raise HTTPException(404, "数据开发调度记录不存在")
    packets = [p for p in record.get("agent_packets") or [] if isinstance(p, dict)]
    packet = next((p for p in packets if str(p.get("packet_id") or "") == body.packet_id), None)
    if packet is None:
        raise HTTPException(404, "数据开发调度包不存在")
    now_at = _utc_now()
    claims = record.get("packet_claims") if isinstance(record.get("packet_claims"), dict) else {}
    reports = record.get("packet_reports") if isinstance(record.get("packet_reports"), dict) else {}
    if body.action == "claim":
        claim = {
            "claim_id": f"data-claim-{uuid4().hex[:12]}",
            "schedule_id": body.schedule_id,
            "packet_id": body.packet_id,
            "agent": body.agent,
            "status": "claimed",
            "progress": max(0, body.progress),
            "note": body.note,
            "claimed_at": now_at,
            "updated_at": now_at,
        }
        claims[body.packet_id] = claim
        record["packet_claims"] = claims
        _append_schedule_event(record, "packet.claimed", f"{body.packet_id}:{body.agent}")
        out = claim
    elif body.action == "heartbeat":
        claim = claims.get(body.packet_id) if isinstance(claims.get(body.packet_id), dict) else {
            "claim_id": f"data-claim-{uuid4().hex[:12]}",
            "schedule_id": body.schedule_id,
            "packet_id": body.packet_id,
            "agent": body.agent,
            "claimed_at": now_at,
        }
        claim.update({"agent": body.agent, "status": body.status or "running", "progress": body.progress, "note": body.note, "updated_at": now_at})
        claims[body.packet_id] = claim
        record["packet_claims"] = claims
        _append_schedule_event(record, "packet.heartbeat", f"{body.packet_id}:{body.progress}%")
        out = claim
    else:
        report = {
            "schedule_id": body.schedule_id,
            "packet_id": body.packet_id,
            "agent": body.agent,
            "status": body.status or "completed",
            "progress": body.progress or 100,
            "summary": body.summary,
            "artifact_url": body.artifact_url,
            "evidence": body.evidence,
            "blockers": body.blockers,
            "warnings": body.warnings,
            "note": body.note,
            "reported_at": now_at,
        }
        report["quality"] = _packet_evidence_score(packet, report)
        reports[body.packet_id] = report
        record["packet_reports"] = reports
        if body.packet_id in claims:
            claims[body.packet_id]["status"] = report["status"]
            claims[body.packet_id]["progress"] = report["progress"]
            claims[body.packet_id]["updated_at"] = now_at
            record["packet_claims"] = claims
        _append_schedule_event(record, "packet.reported", f"{body.packet_id}:{report['status']}")
        out = report
    data["dev_schedules"] = list(data.get("dev_schedules") or [])
    _save_governance(data)
    return {"ok": True, "scope": _data_scope(), "packet": packet, "result": out}


@router.get("/development/evidence")
def analytics_dev_evidence(
    schedule_id: str = Query("", max_length=120),
    packet_id: str = Query("", max_length=120),
    decision: str = Query("", max_length=20),
    limit: int = Query(50, ge=1, le=200),
) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    sid = str(schedule_id or "") if isinstance(schedule_id, str) else ""
    pid = str(packet_id or "") if isinstance(packet_id, str) else ""
    dec = str(decision or "") if isinstance(decision, str) else ""
    lim = int(limit) if isinstance(limit, int) else 50
    items = _dev_evidence_items(data, schedule_id=sid, packet_id=pid, decision=dec, limit=lim)
    return {
        "ok": True,
        "scope": _data_scope(),
        "items": items,
        "total": len(items),
        "summary": {
            "pass": sum(1 for x in items if x.get("quality", {}).get("decision") == "pass"),
            "warn": sum(1 for x in items if x.get("quality", {}).get("decision") == "warn"),
            "block": sum(1 for x in items if x.get("quality", {}).get("decision") == "block"),
            "reported": sum(1 for x in items if x.get("report")),
            "missing_required_gates": sum(len(x.get("quality", {}).get("missing_required_gates") or []) for x in items),
        },
    }


@router.post("/development/evidence/tasks")
def analytics_dev_evidence_tasks(body: DataDevEvidenceTasksIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    decisions = {str(x).strip() for x in body.decisions if str(x).strip()}
    items_src = _dev_evidence_items(data, schedule_id=body.schedule_id, packet_id=body.packet_id, limit=200)
    candidates = [item for item in items_src if (item.get("quality") or {}).get("decision") in decisions]
    task_items = []
    for item in candidates:
        quality = item.get("quality") or {}
        report = item.get("report") or {}
        missing = quality.get("missing_required_gates") or []
        blockers = quality.get("blockers") or []
        warnings = quality.get("warnings") or []
        task_items.append(
            {
                "title": f"修复数据开发质量证据：{item.get('title') or item.get('packet_id')}",
                "description": (
                    "Hermes 数据开发质量证据修复任务。\n\n"
                    f"调度 ID: {item.get('schedule_id')}\n"
                    f"Packet ID: {item.get('packet_id')}\n"
                    f"质量决策: {quality.get('decision')}，得分: {quality.get('score')}\n"
                    f"缺失必需卡点: {', '.join(missing) or '-'}\n"
                    f"阻断项: {', '.join(blockers) or '-'}\n"
                    f"预警项: {', '.join(warnings) or '-'}\n"
                    f"报告状态: {report.get('status') or '-'}\n"
                    f"产物链接: {item.get('artifact_url') or '-'}\n\n"
                    "请补齐缺失质量证据、修复阻断项，并通过 sop data dev-packet-action --action report 回写新的 evidence/blockers/warnings。"
                ),
                "priority": "P0" if quality.get("decision") == "block" else body.priority,
                "estimate": "M",
                "owner_id": body.owner_id,
                "dev_tool": body.dev_tool,
                "source": "data_development_evidence",
                "source_report_id": f"{item.get('schedule_id')}:{item.get('packet_id')}",
                "source_report_title": item.get("title") or item.get("packet_id"),
                "debug_notes": f"data_evidence_decision={quality.get('decision')} score={quality.get('score')}",
            }
        )
    if body.dry_run:
        return {"ok": True, "dry_run": True, "created": 0, "items": task_items}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created: list[dict[str, Any]] = []
    for item in task_items:
        out = create_task(TaskCreate(**item))
        created.append({**item, "id": out.get("id")})
    return {"ok": True, "dry_run": False, "created": len(created), "items": created}


@router.post("/development/evidence/notify")
def analytics_dev_evidence_notify(body: DataDevEvidenceNotifyIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    decisions = {str(x).strip() for x in body.decisions if str(x).strip()}
    items = [
        item
        for item in _dev_evidence_items(data, schedule_id=body.schedule_id, packet_id=body.packet_id, limit=100)
        if (item.get("quality") or {}).get("decision") in decisions
    ]
    title = f"数据开发质量证据告警：{len(items)} 条"
    content = "\n".join(
        [
            (
                f"- [{(item.get('quality') or {}).get('decision')}] {item.get('title') or item.get('packet_id')} "
                f"score={(item.get('quality') or {}).get('score')} "
                f"missing={','.join((item.get('quality') or {}).get('missing_required_gates') or []) or '-'} "
                f"packet={item.get('packet_id')}"
            )
            for item in items[:12]
        ]
    ) or "当前无需要通知的数据开发质量证据问题。"
    draft = {
        "title": title,
        "content": content,
        "level": "error" if any((x.get("quality") or {}).get("decision") == "block" for x in items) else "warn" if items else "info",
        "decisions": sorted(decisions),
    }
    if body.dry_run:
        return {"ok": True, "dry_run": True, "draft": draft, "items": items, "total": len(items)}
    from sop_manager.routers.notify import NotifyMsg, send_msg

    results: dict[str, Any] = {}
    for channel in body.channels:
        results[channel] = send_msg(NotifyMsg(channel=channel, title=title, content=content, level=draft["level"]))
    return {"ok": True, "dry_run": False, "draft": draft, "results": results, "items": items, "total": len(items)}


@router.get("/quality/rules")
def analytics_quality_rules() -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    return {"ok": True, "scope": _data_scope(), "items": data.get("quality_rules") or [], "total": len(data.get("quality_rules") or [])}


@router.post("/quality/evaluate")
def analytics_quality_evaluate(body: DataQualityEvaluateIn) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    rules = list(data.get("quality_rules") or [])
    wanted = {str(x) for x in body.asset_ids if str(x).strip()}
    items = [
        _asset_quality(asset, rules)
        for asset in data.get("assets") or []
        if not wanted or str(asset.get("id")) in wanted
    ]
    return {"ok": True, "summary": _governance_summary(data), "items": items, "total": len(items)}


@router.get("/quality/alerts")
def analytics_quality_alerts(severity: str = Query("", max_length=40), q: str = Query("", max_length=200)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    q_norm = q.strip().lower()
    alerts = []
    for alert in _quality_alerts(data):
        if severity and str(alert.get("severity")) != severity:
            continue
        if q_norm and q_norm not in json.dumps(alert, ensure_ascii=False).lower():
            continue
        alerts.append(alert)
    return {
        "ok": True,
        "scope": _data_scope(),
        "summary": {
            "total": len(alerts),
            "critical": sum(1 for x in alerts if x.get("severity") == "critical"),
            "warning": sum(1 for x in alerts if x.get("severity") == "warning"),
        },
        "items": alerts,
        "total": len(alerts),
    }


@router.post("/quality/alerts/notify")
def analytics_quality_alert_notify(body: DataAlertNotifyIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    alerts = _quality_alerts(data)
    title = f"数据质量告警：{len(alerts)} 条"
    content = "\n".join(
        [
            f"- [{a.get('severity')}] {a.get('title')} score={a.get('score')} blockers={','.join(a.get('blockers') or []) or '-'}"
            for a in alerts[:12]
        ]
    ) or "当前无数据质量告警。"
    draft = {"title": title, "content": content, "level": "warn" if alerts else "info"}
    if body.dry_run:
        return {"ok": True, "dry_run": True, "draft": draft, "alerts": alerts}
    from sop_manager.routers.notify import NotifyMsg, send_msg

    results: dict[str, Any] = {}
    for channel in body.channels:
        results[channel] = send_msg(NotifyMsg(channel=channel, title=title, content=content, level=draft["level"]))
    return {"ok": True, "dry_run": False, "draft": draft, "results": results, "alerts": alerts}


@router.post("/governance/tasks")
def analytics_governance_tasks(body: DataGovernanceTasksIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    wanted = {str(x) for x in body.ids if str(x).strip()}
    rules = list(data.get("quality_rules") or [])
    candidates: list[dict[str, Any]] = []
    for asset in data.get("assets") or []:
        quality = _asset_quality(asset, rules)
        if wanted and str(asset.get("id")) not in wanted:
            continue
        if quality["decision"] == "pass" and not wanted:
            continue
        candidates.append({"asset": asset, "quality": quality})
    items = [
        {
            "title": f"治理数据资产：{row['asset'].get('name')}",
            "description": (
                "Hermes 数据资产治理任务。\n\n"
                f"资产 ID: {row['asset'].get('id')}\n"
                f"领域: {row['asset'].get('domain')}\n"
                f"来源: {row['asset'].get('source')}\n"
                f"质量决策: {row['quality'].get('decision')}，得分: {row['quality'].get('score')}\n"
                f"阻断项: {', '.join(row['quality'].get('blockers') or []) or '-'}\n"
                f"预警项: {', '.join(row['quality'].get('warnings') or []) or '-'}\n\n"
                "请完善 owner、血缘、指标映射、质量规则、敏感数据策略、CLI/Agent 可读元数据和审计闭环。"
            ),
            "priority": body.priority,
            "estimate": "M",
            "owner_id": body.owner_id,
            "dev_tool": body.dev_tool,
            "source": "data_governance_quality",
            "source_report_id": row["asset"].get("id"),
            "source_report_title": row["asset"].get("name"),
        }
        for row in candidates
    ]
    if body.dry_run:
        return {"ok": True, "dry_run": True, "created": 0, "items": items}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created: list[dict[str, Any]] = []
    for item in items:
        out = create_task(TaskCreate(**item))
        created.append({**item, "id": out.get("id")})
    return {"ok": True, "dry_run": False, "created": len(created), "items": created}


@router.post("/quality/alerts/tasks")
def analytics_quality_alert_tasks(body: DataGovernanceTasksIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    wanted = {str(x) for x in body.ids if str(x).strip()}
    alerts = [a for a in _quality_alerts(data) if not wanted or str(a.get("id")) in wanted or str(a.get("asset_id") or a.get("service_id")) in wanted]
    items = [
        {
            "title": f"处理数据质量告警：{alert.get('title')}",
            "description": (
                "Hermes 数据质量/服务健康告警治理任务。\n\n"
                f"告警 ID: {alert.get('id')}\n"
                f"类型: {alert.get('type')}\n"
                f"严重级别: {alert.get('severity')}\n"
                f"质量得分: {alert.get('score')}\n"
                f"阻断项: {', '.join(alert.get('blockers') or []) or '-'}\n"
                f"预警项: {', '.join(alert.get('warnings') or []) or '-'}\n"
                f"建议: {alert.get('recommendation')}\n\n"
                "请按平台规约补齐数据资产/数据服务治理信息，必要时联动调度、质量卡点、Notify 与审计。"
            ),
            "priority": body.priority if alert.get("severity") != "critical" else "P0",
            "estimate": "M",
            "owner_id": body.owner_id,
            "dev_tool": body.dev_tool,
            "source": "data_quality_alert",
            "source_report_id": alert.get("id"),
            "source_report_title": alert.get("title"),
        }
        for alert in alerts
    ]
    if body.dry_run:
        return {"ok": True, "dry_run": True, "created": 0, "items": items}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created: list[dict[str, Any]] = []
    for item in items:
        out = create_task(TaskCreate(**item))
        created.append({**item, "id": out.get("id")})
    return {"ok": True, "dry_run": False, "created": len(created), "items": created}


@router.get("/lineage")
def analytics_lineage() -> dict[str, Any]:
    _require_scope()
    data = _load_governance()
    nodes = list(LINEAGE_GRAPH["nodes"])
    node_ids = {str(x.get("id")) for x in nodes}
    edges = list(LINEAGE_GRAPH["edges"])
    for asset in data.get("assets") or []:
        aid = str(asset.get("id") or "")
        if not aid:
            continue
        source = str(asset.get("source") or aid)
        if source not in node_ids:
            nodes.append({"id": source, "type": asset.get("type") or "asset", "label": asset.get("name") or source, "domain": asset.get("domain")})
            node_ids.add(source)
        for up in asset.get("lineage_upstream") or []:
            if str(up) not in node_ids:
                nodes.append({"id": str(up), "type": "upstream", "label": str(up)})
                node_ids.add(str(up))
            edges.append({"from": str(up), "to": source, "kind": "asset_upstream"})
        for down in asset.get("lineage_downstream") or []:
            if str(down) not in node_ids:
                nodes.append({"id": str(down), "type": "downstream", "label": str(down)})
                node_ids.add(str(down))
            edges.append({"from": source, "to": str(down), "kind": "asset_downstream"})
    return {
        "ok": True,
        "scope": _data_scope(),
        "nodes": nodes,
        "edges": edges,
        "summary": _governance_summary(data),
        "visualization": {"engine": "antv-g6", "layout": "dagre", "rankdir": "LR"},
    }


@router.get("/lineage/impact")
def analytics_lineage_impact(node_id: str = "") -> dict[str, Any]:
    """节点上下游影响分析（基于声明血缘边）。"""
    _require_scope()
    if not node_id.strip():
        raise HTTPException(400, "node_id required")
    payload = analytics_lineage()
    nid = node_id.strip()
    edges = payload.get("edges") or []
    upstream: list[str] = []
    downstream: list[str] = []
    for e in edges:
        frm = str(e.get("from") or "")
        to = str(e.get("to") or "")
        if to == nid and frm not in upstream:
            upstream.append(frm)
        if frm == nid and to not in downstream:
            downstream.append(to)
    nodes = {str(n.get("id")): n for n in payload.get("nodes") or []}
    return {
        "ok": True,
        "node_id": nid,
        "node": nodes.get(nid),
        "upstream": [nodes.get(u, {"id": u, "label": u}) for u in upstream],
        "downstream": [nodes.get(d, {"id": d, "label": d}) for d in downstream],
        "upstream_count": len(upstream),
        "downstream_count": len(downstream),
    }


@router.get("/blueprint")
def analytics_blueprint() -> dict[str, Any]:
    _require_scope()
    capabilities = _data_capabilities()
    gaps = _data_gaps(capabilities)
    maturity = round(sum(int(x["maturity"]) for x in capabilities) / max(1, len(capabilities)), 1)
    architecture = {
        "name": "Hermes AI Data Intelligence Plane",
        "positioning": "覆盖数据接入、集成、开发、质量、监控、指标、标签、问数、报表、归因、知识、记忆画像、数据服务与数据知产治理的一栈式智能数据平台。",
        "principles": [
            "tenant_code / business_code / project_id 三层作用域贯穿数据资产、指标、标签、质量、服务和审计。",
            "OceanBase 作为主数据与多模态能力底座，按场景接入 StarRocks、Hologres、GP、OpenSearch、Spark、Flink/Paimon、Lance。",
            "所有数据开发与数据服务进入任务、工作流、质量卡点、事件唤醒和审计链闭环。",
            "AI 能力默认覆盖 Schema 理解、指标口径、标签建议、质量规则、异常归因、Runbook 和报告生成。",
            "技术选型优先成熟组件，平台只沉淀标准契约、权限治理、任务化和可观测控制面。",
        ],
        "layers": [
            "Source & Connector: DB/API/文件/IM/Webhook/Agent/CDC 多入口接入",
            "Lakehouse & Warehouse: OceanBase + Paimon + StarRocks/Hologres/GP",
            "Compute: Spark batch + Flink stream + Worker/Temporal 调度",
            "Semantic: 指标语义层 + 标签语义层 + 业务本体",
            "AI Intelligence: NLQ + RAG/Graph RAG + 记忆画像 + 多模态检索",
            "Serving: 数据 API + 指标服务 + 标签服务 + 报表订阅",
            "Governance: 质量/SLO/血缘/权限/审计/计量/知产治理",
        ],
    }
    return {
        "ok": True,
        "scope": _data_scope(),
        "architecture": architecture,
        "stack": DATA_STACK_CATALOG,
        "capabilities": capabilities,
        "gaps": gaps,
        "summary": {
            "maturity": maturity,
            "capabilities": len(capabilities),
            "stack_items": len(DATA_STACK_CATALOG),
            "gaps": len(gaps),
            "critical_gaps": sum(1 for x in gaps if x["priority"] == "P0"),
            "domains": sorted({str(x["domain"]) for x in capabilities}),
        },
    }


@router.get("/blueprint/summary")
def analytics_blueprint_summary() -> dict[str, Any]:
    _require_scope()
    blueprint = analytics_blueprint()
    return {"ok": True, "scope": blueprint.get("scope"), "summary": blueprint.get("summary") or {}}


@router.get("/blueprint/charts")
def analytics_blueprint_charts() -> dict[str, Any]:
    _require_scope()
    blueprint = analytics_blueprint()
    capabilities = list(blueprint.get("capabilities") or [])
    gaps = list(blueprint.get("gaps") or [])
    by_domain: dict[str, int] = {}
    maturity_buckets: dict[str, int] = {"80+": 0, "60-79": 0, "<60": 0}
    for cap in capabilities:
        domain = str(cap.get("domain") or "other")
        by_domain[domain] = by_domain.get(domain, 0) + 1
        m = int(cap.get("maturity") or 0)
        if m >= 80:
            maturity_buckets["80+"] += 1
        elif m >= 60:
            maturity_buckets["60-79"] += 1
        else:
            maturity_buckets["<60"] += 1
    by_priority: dict[str, int] = {}
    for gap in gaps:
        pr = str(gap.get("priority") or "P2")
        by_priority[pr] = by_priority.get(pr, 0) + 1
    return {
        "ok": True,
        "by_domain": [{"name": k, "value": v} for k, v in sorted(by_domain.items(), key=lambda x: (-x[1], x[0]))],
        "maturity_buckets": [{"name": k, "value": v} for k, v in maturity_buckets.items()],
        "gaps_by_priority": [{"name": k, "value": v} for k, v in sorted(by_priority.items(), key=lambda x: (-x[1], x[0]))],
    }


@router.post("/blueprint/tasks")
def analytics_blueprint_tasks(body: DataBlueprintTasksIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    blueprint = analytics_blueprint()
    gaps = list(blueprint["gaps"])
    if body.ids:
        wanted = {str(x) for x in body.ids}
        gaps = [gap for gap in gaps if str(gap.get("id")) in wanted]
    items = [
        {
            "title": gap["title"],
            "description": (
                "Hermes 数据智能平台能力缺口治理。\n\n"
                f"能力: {gap['capability_id']}\n"
                f"当前成熟度: {gap['maturity']}，目标成熟度: {gap['target_maturity']}\n"
                f"建议: {gap['recommendation']}\n"
                f"模块: {', '.join(gap['modules'])}\n"
                f"技术栈: {', '.join(gap['stack'])}\n\n"
                "请按 tenant_code/business_code/project_id 隔离要求设计前后端、CLI/Agent 接口、质量卡点、事件唤醒和审计闭环。"
            ),
            "priority": body.priority or gap["priority"],
            "estimate": "L",
            "owner_id": body.owner_id,
            "dev_tool": body.dev_tool or "codex",
            "source": "data_intelligence_blueprint_gap",
            "source_report_id": gap["id"],
            "source_report_title": gap["title"],
        }
        for gap in gaps
    ]
    if body.dry_run:
        return {"ok": True, "dry_run": True, "created": 0, "items": items}
    from sop_manager.routers.tasks import TaskCreate, create_task

    created: list[dict[str, Any]] = []
    for item in items:
        out = create_task(TaskCreate(**item))
        created.append({**item, "id": out.get("id")})
    return {"ok": True, "dry_run": False, "created": len(created), "items": created}


@router.get("/export.csv")
def analytics_export_csv(db: Session = Depends(get_session)) -> Response:
    pid = _require_scope()
    metrics = _build_metrics(db, pid)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["project_id", "metric", "dimension", "value"])
    for key, value in metrics.items():
        if isinstance(value, dict):
            for dim, dim_value in value.items():
                writer.writerow([pid, key, dim, dim_value])
        else:
            writer.writerow([pid, key, "", value])
    return Response(
        buf.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": 'attachment; filename="analytics-overview.csv"'},
    )


class NlqIn(BaseModel):
    question: str = Field(..., min_length=2, max_length=2000)


def _safe_int(value: Any) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _metric_card(label: str, value: Any, metric: str, *, tone: str = "neutral") -> dict[str, Any]:
    return {"label": label, "value": _safe_int(value), "metric": metric, "tone": tone}


def _answer_nlq_with_metrics(question: str, metrics: dict[str, Any]) -> dict[str, Any]:
    """Deterministic metric NLQ fallback for availability and auditable behavior."""
    q = (question or "").strip().lower()
    tasks_by_status = metrics.get("tasks_by_status") if isinstance(metrics.get("tasks_by_status"), dict) else {}
    issues_by_priority = metrics.get("issues_by_priority") if isinstance(metrics.get("issues_by_priority"), dict) else {}
    requirements_total = _safe_int(metrics.get("requirements_total"))
    tasks_total = _safe_int(metrics.get("tasks_total"))
    issues_total = _safe_int(metrics.get("issues_total"))
    pending = _safe_int(tasks_by_status.get("pending"))
    in_progress = _safe_int(tasks_by_status.get("in_progress"))
    blocked = _safe_int(tasks_by_status.get("blocked"))
    completed = _safe_int(tasks_by_status.get("completed"))
    p0_issues = _safe_int(issues_by_priority.get("P0") or issues_by_priority.get("p0"))

    intent_rules: list[tuple[str, tuple[str, ...]]] = [
        ("status_distribution", ("状态", "分布", "阻塞", "blocked", "进行", "in_progress", "完成", "completed", "pending")),
        ("requirements", ("需求", "requirement", "prd")),
        ("issues", ("问题", "缺陷", "bug", "issue", "风险", "p0")),
        ("delivery_overview", ("概览", "总览", "overview", "项目", "交付", "整体")),
    ]
    matched = [intent for intent, words in intent_rules if any(word in q for word in words)]
    if not matched:
        matched = ["delivery_overview"]
    if "delivery_overview" not in matched and len(matched) > 1:
        matched.append("delivery_overview")

    cards = [
        _metric_card("需求总数", requirements_total, "requirements_total"),
        _metric_card("任务总数", tasks_total, "tasks_total"),
        _metric_card("问题总数", issues_total, "issues_total", tone="warning" if issues_total else "neutral"),
        _metric_card("阻塞任务", blocked, "tasks_by_status.blocked", tone="danger" if blocked else "neutral"),
        _metric_card("P0 问题", p0_issues, "issues_by_priority.P0", tone="danger" if p0_issues else "neutral"),
    ]

    lines: list[str] = []
    if "delivery_overview" in matched:
        lines.append(f"项目交付概览：需求总数：{requirements_total}，任务总数：{tasks_total}，问题总数：{issues_total}。")
    if "status_distribution" in matched:
        lines.append(
            "任务状态分布："
            f"任务总数：{tasks_total}，待处理：{pending}，进行中：{in_progress}，阻塞：{blocked}，已完成：{completed}。"
        )
    if "requirements" in matched and "delivery_overview" not in matched:
        lines.append(f"需求总数：{requirements_total}。建议优先检查高优先级需求是否已经完成验收标准和任务拆解。")
    if "issues" in matched and "delivery_overview" not in matched:
        lines.append(f"问题总数：{issues_total}，其中 P0 问题：{p0_issues}。")
    if blocked or p0_issues:
        lines.append(f"风险提示：当前存在阻塞任务 {blocked} 个、P0 问题 {p0_issues} 个，建议先任务化跟进责任人和处理时限。")
    else:
        lines.append("风险提示：当前未发现阻塞任务或 P0 问题，可继续关注进行中任务的验收证据和完成节奏。")

    confidence = 0.86 if "delivery_overview" in matched or "status_distribution" in matched else 0.72
    return {
        "ok": True,
        "engine": "rules",
        "confidence": confidence,
        "matched_intents": matched,
        "answer": "\n".join(lines),
        "cards": cards,
        "metrics_snapshot": metrics,
        "limitations": ["规则问数基于当前指标快照回答；需要复杂归因、跨表分析或自由推理时会优先使用 LLM Gateway。"],
    }


class ReportIn(BaseModel):
    title: str = Field("", max_length=160)
    question: str = Field("", max_length=2000)
    answer: str = Field("", max_length=12000)
    metrics_snapshot: dict[str, Any] | None = None


class InsightReportIn(BaseModel):
    title: str = Field("项目智能洞察与归因报告", max_length=160)
    publish: bool = False


class ReportStatusIn(BaseModel):
    status: str = Field(..., pattern="^(draft|published|archived)$")


class ReportMetaIn(BaseModel):
    title: str | None = Field(default=None, max_length=160)
    owner: str | None = Field(default=None, max_length=80)
    tags: list[str] | None = Field(default=None, max_length=20)
    note: str | None = Field(default=None, max_length=2000)
    pinned: bool | None = None


class ReportActionTasksIn(TaskOwnerInput):
    preview: bool = True
    max_tasks: int = Field(3, ge=1, le=8)
    priority: str = Field("P2", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field("sop", max_length=80)


class AttributionTasksIn(TaskOwnerInput):
    preview: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field("codex", max_length=80)


class ReportAttributionBatchIn(BaseModel):
    report_ids: list[str] = Field(default_factory=list, max_length=100)
    only_missing: bool = False


class ReportIntelligenceTasksIn(TaskOwnerInput):
    preview: bool = True
    priority: str = Field("", pattern="^(|P[0-3])$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field("codex", max_length=80)


class DecisionExplainIn(BaseModel):
    question: str = Field("", max_length=1000)
    report_ids: list[str] = Field(default_factory=list, max_length=50)
    include_evidence: bool = True
    max_reports: int = Field(10, ge=1, le=50)


class DecisionTasksIn(DecisionExplainIn, TaskOwnerInput):
    preview: bool = True
    priority: str = Field("", pattern="^(|P[0-3])$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field("codex", max_length=80)
    max_tasks: int = Field(5, ge=1, le=10)


class ReportNotifyIn(BaseModel):
    channels: list[str] = Field(default_factory=list)
    dry_run: bool = False


class ReportSubscriptionIn(BaseModel):
    enabled: bool = False
    auto_on_publish: bool = False
    channels: list[str] = Field(default_factory=list)


class DataBlueprintTasksIn(TaskOwnerInput):
    ids: list[str] = Field(default_factory=list, max_length=80)
    dry_run: bool = True
    priority: str = Field("P1", pattern="^P[0-3]$")
    owner_id: TaskOwnerId = ""
    dev_tool: str = Field("codex", max_length=80)


def _notify_report(report: dict[str, Any], channels: list[str], *, touch_report: bool = True) -> dict[str, Any]:
    title = f"数据洞察报告：{report.get('title') or report.get('id')}"
    highlights = report.get("highlights") if isinstance(report.get("highlights"), list) else []
    content_parts = [
        f"状态：{report.get('status', 'draft')}",
        f"项目：{report.get('project_id')}",
        "",
        str(report.get("answer") or "").strip(),
    ]
    if highlights:
        content_parts.extend(["", "重点：", *[f"- {x}" for x in highlights[:5]]])
    content_parts.extend(["", f"报告 ID：{report.get('id')}"])
    content = "\n".join([x for x in content_parts if x is not None])
    draft = {"title": title, "content": content, "level": "info", "event": "analytics_report_published"}
    from sop_manager.routers.notify import NotifyMsg, send_msg

    results: dict[str, Any] = {}
    for channel in channels:
        results[channel] = send_msg(NotifyMsg(channel=channel, title=title, content=content, level="info"))
    if channels and touch_report:
        _replace_scoped_report(str(report.get("id")), {"last_notified_at": _utc_now(), "last_notified_channels": channels})
    return {"draft": draft, "results": results}


def _report_action_candidates(report: dict[str, Any], body: ReportActionTasksIn) -> list[dict[str, Any]]:
    highlights = [str(x).strip() for x in report.get("highlights", []) if str(x).strip()]
    answer_lines = [x.strip(" -\t") for x in str(report.get("answer") or "").splitlines() if x.strip(" -\t")]
    raw_items = highlights or answer_lines or [str(report.get("title") or "数据洞察报告")]
    seen: set[str] = set()
    out: list[dict[str, Any]] = []
    for idx, text in enumerate(raw_items):
        normalized = " ".join(text.split())
        if not normalized or normalized in seen:
            continue
        seen.add(normalized)
        title = normalized
        if not title.startswith(("治理", "修复", "跟进", "优化", "处理")):
            title = f"跟进数据洞察：{title}"
        title = title[:120]
        out.append(
            {
                "title": title,
                "description": "\n".join(
                    [
                        f"来源报告：{report.get('title') or report.get('id')}",
                        f"报告 ID：{report.get('id')}",
                        f"洞察条目：{normalized}",
                        "",
                        "请结合项目需求、任务、问题和相关数据指标完成分析、拆解、修复或治理，并在任务完成后回填结果。",
                    ]
                ),
                "priority": body.priority,
                "estimate": "M" if idx < 2 else "S",
                "owner_id": body.owner_id.strip(),
                "dev_tool": body.dev_tool.strip() or "sop",
                "debug_notes": f"analytics_report_id={report.get('id')}",
                "source_report_id": report.get("id"),
            }
        )
        if len(out) >= body.max_tasks:
            break
    return out


@router.post("/nlq", dependencies=[Depends(require_business_access)])
def analytics_nlq(body: NlqIn, db: Session = Depends(get_session)) -> dict[str, Any]:
    pid = _require_scope()
    metrics = _build_metrics(db, pid)
    fallback = _answer_nlq_with_metrics(body.question, metrics)
    try:
        from sop_manager.routers.llm_gateway import ChatIn, Message, llm_chat
    except Exception as e:
        return {
            **fallback,
            "fallback_reason": "llm_gateway_unavailable",
            "provider_errors": [type(e).__name__],
        }
    prompt = (
        "你是项目数据分析助手。根据以下 JSON 指标摘要，用中文简洁回答用户问题；"
        "若数据不足请说明。\n\n指标："
        f"{metrics}\n\n问题：{body.question}"
    )
    chat_in = ChatIn(messages=[Message(role="user", content=prompt)], task_type="summarize")
    try:
        out = llm_chat(chat_in, None)
        return {
            **fallback,
            "engine": "llm",
            "confidence": 0.95,
            "answer": out.content,
            "model": out.model,
            "provider": out.provider,
            "usage": out.usage.model_dump(),
            "fallback_answer": fallback["answer"],
            "provider_errors": [],
        }
    except HTTPException as e:
        error = f"HTTP {e.status_code}"
    except Exception as e:
        error = type(e).__name__
    return {
        **fallback,
        "fallback_reason": "llm_provider_failed",
        "provider_errors": [error],
    }


@router.get("/reports")
def analytics_reports(
    limit: int = Query(30, ge=1, le=200),
    status: str = Query("", pattern="^(|draft|published|archived)$"),
    source: str = Query("", pattern="^(|overview|nlq|insight)$"),
    q: str = Query("", max_length=200),
    _: User = Depends(current_user),
) -> dict[str, Any]:
    _require_scope()
    items = _read_reports(limit, status=status, source=source, q=q)
    return {"ok": True, "items": items, "total": len(items)}


@router.get("/reports/summary")
def analytics_reports_summary(_: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    return {"ok": True, "summary": _reports_summary()}


@router.get("/reports/charts")
def analytics_reports_charts(_: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    summary = _reports_summary()
    by_status = summary.get("by_status") if isinstance(summary.get("by_status"), dict) else {}
    status_labels = {"draft": "草稿", "published": "已发布", "archived": "已归档"}
    by_status_chart = [
        {"name": status_labels.get(k, k), "value": int(v)}
        for k, v in by_status.items()
        if int(v) > 0
    ]
    tags = summary.get("tags") if isinstance(summary.get("tags"), dict) else {}
    top_tags = sorted(tags.items(), key=lambda x: (-int(x[1]), x[0]))[:8]
    by_tag = [{"name": k, "value": int(v)} for k, v in top_tags]
    owners = summary.get("owners") if isinstance(summary.get("owners"), dict) else {}
    top_owners = sorted(owners.items(), key=lambda x: (-int(x[1]), x[0]))[:6]
    by_owner = [{"name": k or "未指定", "value": int(v)} for k, v in top_owners]
    subscription = summary.get("subscription") if isinstance(summary.get("subscription"), dict) else {}
    sub_health = [
        {"name": "已启用", "value": 1 if subscription.get("enabled") else 0},
        {"name": "自动发布通知", "value": 1 if subscription.get("auto_on_publish") else 0},
    ]
    sub_health = [x for x in sub_health if x["value"] > 0]
    return {
        "ok": True,
        "by_status": by_status_chart,
        "by_tag": by_tag,
        "by_owner": by_owner,
        "subscription_health": sub_health,
    }


@router.get("/report-subscription")
def get_report_subscription(_: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    return {"ok": True, "subscription": _load_subscription()}


@router.put("/report-subscription")
def put_report_subscription(body: ReportSubscriptionIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    return {"ok": True, "subscription": _save_subscription(body.model_dump())}


@router.post("/report-subscription/test")
def test_report_subscription(_: User = Depends(current_user)) -> dict[str, Any]:
    pid = _require_scope()
    sub = _load_subscription()
    channels = list(sub.get("channels") or [])
    if not sub.get("enabled"):
        raise HTTPException(400, "报告订阅未启用")
    if not channels:
        raise HTTPException(400, "报告订阅未配置通知通道")
    sample = {
        "id": "subscription-test",
        "tenant_id": resolved_tenant_id(),
        "project_id": pid,
        "title": "报告订阅测试",
        "status": "draft",
        "answer": "这是一条报告订阅测试消息，用于确认默认通知通道是否可用。",
        "highlights": ["订阅配置已启用", f"默认通道：{', '.join(channels)}"],
    }
    sent = _notify_report(sample, channels, touch_report=False)
    return {"ok": True, "subscription": sub, **sent}


@router.post("/reports")
def create_analytics_report(
    body: ReportIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    pid = _require_scope()
    metrics = body.metrics_snapshot if isinstance(body.metrics_snapshot, dict) else _build_metrics(db, pid)
    highlights = _report_highlights(metrics)
    attribution = analyze_metric_attribution(metrics)
    title = (body.title or "").strip() or (body.question[:80] if body.question else "项目数据洞察报告")
    answer = (body.answer or "").strip() or "\n".join(highlights)
    report = {
        "id": f"ar-{uuid4().hex[:12]}",
        "created_at": _utc_now(),
        "actor": getattr(user, "username", "") or getattr(user, "id", ""),
        "title": title,
        "question": body.question.strip(),
        "answer": answer,
        "highlights": highlights,
        "attribution": attribution,
        "metrics_snapshot": metrics,
        "source": "nlq" if body.question else "overview",
        "status": "draft",
        "owner": getattr(user, "username", "") or "",
        "tags": [],
        "note": "",
        "pinned": False,
        "published_at": "",
        "archived_at": "",
    }
    attach_scope(report, overwrite=True)
    _append_report(report)
    return {"ok": True, "report": report}


@router.post("/reports/insight")
def create_analytics_insight_report(
    body: InsightReportIn,
    user: User = Depends(current_user),
    db: Session = Depends(get_session),
) -> dict[str, Any]:
    pid = _require_scope()
    metrics = _build_metrics(db, pid)
    insight = generate_insight_report(metrics, title=body.title.strip() or "项目智能洞察与归因报告")
    status = "published" if body.publish else "draft"
    report = {
        "id": f"ar-{uuid4().hex[:12]}",
        "created_at": _utc_now(),
        "actor": getattr(user, "username", "") or getattr(user, "id", ""),
        "title": insight["title"],
        "question": "请基于当前项目指标生成智能洞察和归因分析",
        "answer": insight["answer"],
        "highlights": insight["highlights"],
        "metrics_snapshot": metrics,
        "attribution": insight["attribution"],
        "source": "insight",
        "status": status,
        "owner": getattr(user, "username", "") or "DataOps",
        "tags": insight["tags"],
        "note": "",
        "pinned": bool(insight["attribution"].get("risk_level") in {"high", "critical"}),
        "published_at": _utc_now() if status == "published" else "",
        "archived_at": "",
    }
    attach_scope(report, overwrite=True)
    _append_report(report)
    return {"ok": True, "report": report, "attribution": insight["attribution"]}


@router.get("/reports/intelligence")
def get_reports_intelligence(_: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    reports = _read_reports(200)
    intelligence = aggregate_report_intelligence(reports)
    return {"ok": True, **intelligence}


@router.get("/decision/overview")
def analytics_decision_overview(
    question: str = Query("", max_length=1000),
    include_evidence: bool = Query(True),
    max_reports: int = Query(10, ge=1, le=50),
    _: User = Depends(current_user),
) -> dict[str, Any]:
    _require_scope()
    reports = _read_reports(200)
    packet = build_decision_attribution_engine(
        reports,
        question=question,
        include_evidence=include_evidence,
        max_reports=max_reports,
    )
    return {"ok": True, **packet}


@router.post("/decision/explain")
def analytics_decision_explain(body: DecisionExplainIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    wanted = {str(x).strip() for x in body.report_ids if str(x).strip()}
    reports = _read_reports(200)
    if wanted:
        reports = [row for row in reports if str(row.get("id") or "") in wanted]
    packet = build_decision_attribution_engine(
        reports,
        question=body.question,
        include_evidence=body.include_evidence,
        max_reports=body.max_reports,
    )
    return {"ok": True, "selected_report_ids": sorted(wanted), **packet}


@router.post("/decision/tasks")
def analytics_decision_tasks(body: DecisionTasksIn, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    wanted = {str(x).strip() for x in body.report_ids if str(x).strip()}
    reports = _read_reports(200)
    if wanted:
        reports = [row for row in reports if str(row.get("id") or "") in wanted]
    packet = build_decision_attribution_engine(
        reports,
        question=body.question,
        include_evidence=body.include_evidence,
        max_reports=body.max_reports,
    )
    candidates = build_decision_tasks(
        packet,
        priority=body.priority,
        owner_id=body.owner_id,
        dev_tool=body.dev_tool,
        max_tasks=body.max_tasks,
    )
    if body.preview:
        return {"ok": True, "preview": True, "items": candidates, "total": len(candidates), "decision_packet": packet}
    from sop_manager.routers.tasks import TaskCreate, create_task
    created = [create_task(TaskCreate(**item)) for item in candidates]
    return {
        "ok": True,
        "preview": False,
        "items": candidates,
        "created": created,
        "created_count": len(created),
        "decision_packet": packet,
    }


@router.post("/reports/attribution-batch")
def refresh_reports_attribution_batch(
    body: ReportAttributionBatchIn,
    _: User = Depends(current_user),
) -> dict[str, Any]:
    _require_scope()
    wanted = {str(x).strip() for x in body.report_ids if str(x).strip()}
    items = _read_all_reports()
    updated: list[dict[str, Any]] = []
    for item in items:
        if not scope_matches(item):
            continue
        if wanted and str(item.get("id") or "") not in wanted:
            continue
        if body.only_missing and isinstance(item.get("attribution"), dict):
            continue
        metrics = item.get("metrics_snapshot") if isinstance(item.get("metrics_snapshot"), dict) else {}
        attribution = analyze_metric_attribution(metrics)
        existing_tags = [str(x) for x in item.get("tags", []) if str(x).strip()]
        item.update(
            {
                "attribution": attribution,
                "updated_at": _utc_now(),
                "tags": list(dict.fromkeys([*existing_tags, "归因分析", f"risk:{attribution['risk_level']}"])),
            }
        )
        updated.append(item)
    if updated:
        _rewrite_reports(items)
    scoped_reports = _read_reports(200)
    intelligence = aggregate_report_intelligence(scoped_reports)
    return {"ok": True, "updated_count": len(updated), "items": updated[:50], "intelligence": intelligence}


@router.post("/reports/intelligence/tasks")
def create_reports_intelligence_tasks(
    body: ReportIntelligenceTasksIn,
    _: User = Depends(current_user),
) -> dict[str, Any]:
    _require_scope()
    reports = _read_reports(200)
    intelligence = aggregate_report_intelligence(reports)
    candidates = build_report_intelligence_tasks(
        intelligence,
        priority=body.priority,
        owner_id=body.owner_id,
        dev_tool=body.dev_tool,
    )
    if body.preview:
        return {"ok": True, "preview": True, "items": candidates, "total": len(candidates), "intelligence": intelligence}
    from sop_manager.routers.tasks import TaskCreate, create_task
    created = [create_task(TaskCreate(**item)) for item in candidates]
    return {
        "ok": True,
        "preview": False,
        "items": candidates,
        "created": created,
        "created_count": len(created),
        "intelligence": intelligence,
    }


@router.post("/reports/{report_id}/attribution")
def refresh_report_attribution(
    report_id: str,
    _: User = Depends(current_user),
) -> dict[str, Any]:
    _require_scope()
    report = _find_scoped_report(report_id)
    if not report:
        raise HTTPException(404, "报告不存在")
    metrics = report.get("metrics_snapshot") if isinstance(report.get("metrics_snapshot"), dict) else {}
    attribution = analyze_metric_attribution(metrics)
    existing_tags = [str(x) for x in report.get("tags", []) if str(x).strip()]
    updated = _replace_scoped_report(
        report_id,
        {
            "attribution": attribution,
            "updated_at": _utc_now(),
            "tags": list(dict.fromkeys([*existing_tags, "归因分析", f"risk:{attribution['risk_level']}"])),
        },
    )
    return {"ok": True, "report": updated, "attribution": attribution}


@router.post("/reports/{report_id}/attribution-tasks")
def create_report_attribution_tasks(
    report_id: str,
    body: AttributionTasksIn,
    _: User = Depends(current_user),
) -> dict[str, Any]:
    _require_scope()
    report = _find_scoped_report(report_id)
    if not report:
        raise HTTPException(404, "报告不存在")
    attribution = report.get("attribution") if isinstance(report.get("attribution"), dict) else analyze_metric_attribution(report.get("metrics_snapshot") or {})
    candidates = build_attribution_tasks(
        attribution,
        priority=body.priority,
        owner_id=body.owner_id,
        dev_tool=body.dev_tool,
    )
    if body.preview:
        return {"ok": True, "preview": True, "items": candidates, "total": len(candidates), "attribution": attribution}
    from sop_manager.routers.tasks import TaskCreate, create_task
    created = []
    for item in candidates:
        created.append(create_task(TaskCreate(**{**item, "source_report_id": report_id, "source_report_title": str(report.get("title") or "")})))
    previous = [str(x) for x in report.get("action_task_ids", []) if str(x).strip()]
    created_ids = [str(x.get("id") or "") for x in created if x.get("id")]
    updated = _replace_scoped_report(
        report_id,
        {
            "action_task_ids": list(dict.fromkeys([*previous, *created_ids])),
            "attribution_tasks_created_at": _utc_now(),
            "updated_at": _utc_now(),
        },
    )
    return {"ok": True, "preview": False, "items": candidates, "created": created, "report": updated, "attribution": attribution}


@router.patch("/reports/{report_id}/status")
def update_analytics_report_status(
    report_id: str,
    body: ReportStatusIn,
    _: User = Depends(current_user),
) -> dict[str, Any]:
    _require_scope()
    patch: dict[str, Any] = {"status": body.status, "updated_at": _utc_now()}
    notify_result: dict[str, Any] | None = None
    if body.status == "published":
        patch["published_at"] = _utc_now()
        patch["archived_at"] = ""
    if body.status == "archived":
        patch["archived_at"] = _utc_now()
    if body.status == "draft":
        patch["archived_at"] = ""
    report = _replace_scoped_report(report_id, patch)
    sub = _load_subscription()
    if body.status == "published" and sub.get("enabled") and sub.get("auto_on_publish") and sub.get("channels"):
        notify_result = _notify_report(report, list(sub.get("channels") or []))
        report = _find_scoped_report(report_id) or report
    return {"ok": True, "report": report, "notify": notify_result}


@router.patch("/reports/{report_id}/meta")
def update_analytics_report_meta(
    report_id: str,
    body: ReportMetaIn,
    _: User = Depends(current_user),
) -> dict[str, Any]:
    _require_scope()
    raw = body.model_dump(exclude_unset=True)
    patch: dict[str, Any] = {"updated_at": _utc_now()}
    if "title" in raw:
        title = str(raw.get("title") or "").strip()
        if not title:
            raise HTTPException(400, "报告标题不能为空")
        patch["title"] = title
    if "owner" in raw:
        patch["owner"] = str(raw.get("owner") or "").strip()
    if "note" in raw:
        patch["note"] = str(raw.get("note") or "").strip()
    if "pinned" in raw:
        patch["pinned"] = bool(raw.get("pinned"))
    if "tags" in raw:
        seen: set[str] = set()
        tags: list[str] = []
        for item in raw.get("tags") or []:
            tag = str(item).strip()
            if not tag or tag in seen:
                continue
            if len(tag) > 40:
                raise HTTPException(400, "单个标签最多 40 个字符")
            seen.add(tag)
            tags.append(tag)
            if len(tags) >= 20:
                break
        patch["tags"] = tags
    report = _replace_scoped_report(report_id, patch)
    return {"ok": True, "report": report}


@router.post("/reports/{report_id}/action-tasks")
def create_analytics_report_action_tasks(
    report_id: str,
    body: ReportActionTasksIn,
    _: User = Depends(current_user),
) -> dict[str, Any]:
    _require_scope()
    report = _find_scoped_report(report_id)
    if not report:
        raise HTTPException(404, "报告不存在")
    candidates = _report_action_candidates(report, body)
    if body.preview:
        return {"ok": True, "preview": True, "items": candidates, "total": len(candidates)}
    t = table("tasks")
    if t is None:
        raise HTTPException(503, "数据库不可用")
    rows_to_add: list[dict[str, Any]] = []
    fields: dict[str, dict[str, Any]] = {}
    created_ids: list[str] = []
    for item in candidates:
        tid = f"T-ar-{uuid4().hex[:10]}"
        created_ids.append(tid)
        rows_to_add.append(
            {
                "id": tid,
                "project_id": resolved_project_id(),
                "req_id": "",
                "sprint_id": "",
                "title": item["title"],
                "description": item["description"],
                "status": "pending",
                "priority": item["priority"],
                "estimate": item["estimate"],
                "owner_id": item["owner_id"],
                "actual_hours": 0.0,
                "confidence": 0.0,
                "human_notes": f"由洞察报告 {report_id} 生成",
                "created_at": now(),
                "updated_at": now(),
            }
        )
        fields[tid] = {
            "dev_tool": item["dev_tool"],
            "debug_notes": item["debug_notes"],
            "source": "analytics_report",
            "source_report_id": str(report_id),
            "source_report_title": str(report.get("title") or ""),
        }
    if rows_to_add:
        try:
            t.add(rows_to_add)
        except Exception as exc:
            raise HTTPException(409, "任务创建失败，请确认当前项目已在 Manager 注册") from exc
        try:
            from sop_manager.routers.tasks import _ui_append_to_column, _ui_load, _ui_save

            st = _ui_load()
            for row in rows_to_add:
                _ui_append_to_column(st, str(row["id"]), str(row["priority"]))
            st.setdefault("fields", {}).update(fields)
            _ui_save(st)
        except Exception:
            pass
        try:
            from sop_manager.routers.webhook import notify_webhook

            notify_webhook(
                "analytics.report_action_tasks_created",
                {"report_id": report_id, "task_ids": created_ids, "count": len(created_ids)},
                tenant_id=resolved_tenant_id(),
                project_id=resolved_project_id(),
            )
        except Exception:
            pass
    previous = [str(x) for x in report.get("action_task_ids", []) if str(x).strip()]
    merged = list(dict.fromkeys([*previous, *created_ids]))
    updated = _replace_scoped_report(
        report_id,
        {
            "action_task_ids": merged,
            "action_tasks_created_at": _utc_now(),
            "updated_at": _utc_now(),
        },
    )
    return {"ok": True, "preview": False, "items": [{**item, "id": tid} for item, tid in zip(candidates, created_ids)], "task_ids": created_ids, "report": updated}


@router.get("/reports/{report_id}.md")
def export_analytics_report_markdown(report_id: str, _: User = Depends(current_user)) -> Response:
    _require_scope()
    report = _find_scoped_report(report_id)
    if not report:
        raise HTTPException(404, "报告不存在")
    filename = f"{report_id}.md"
    return Response(
        _report_markdown(report),
        media_type="text/markdown; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/reports/{report_id}/notify")
def notify_analytics_report(
    report_id: str,
    body: ReportNotifyIn,
    _: User = Depends(current_user),
) -> dict[str, Any]:
    _require_scope()
    report = _find_scoped_report(report_id)
    if not report:
        raise HTTPException(404, "报告不存在")
    if body.dry_run:
        preview = _notify_report({**report, "id": report_id}, [])
        return {"ok": True, "draft": preview["draft"], "results": {}}
    channels = [x.strip() for x in body.channels if x and x.strip()]
    if not channels:
        sub = _load_subscription()
        if sub.get("enabled"):
            channels = list(sub.get("channels") or [])
    if not channels:
        raise HTTPException(400, "至少选择一个通知通道")
    sent = _notify_report(report, channels)
    return {"ok": True, **sent}


@router.delete("/reports/{report_id}")
def delete_analytics_report(report_id: str, _: User = Depends(current_user)) -> dict[str, Any]:
    _require_scope()
    items = _read_all_reports()
    kept = [
        x
        for x in items
        if not (x.get("id") == report_id and scope_matches(x))
    ]
    if len(kept) == len(items):
        raise HTTPException(404, "报告不存在")
    _rewrite_reports(kept)
    return {"ok": True, "deleted": report_id}
