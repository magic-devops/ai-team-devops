# Hermes Next Gaps Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Hermes from "module/API contract complete" to production-grade autonomous execution, data intelligence runtime, enterprise governance, and commercial operations.

**Architecture:** Keep the current modular FastAPI + React workbench shape. For each feature, complete one closed loop before starting the next: backend policy/runtime, frontend workbench, System Pages contract, SDK/CLI where applicable, scoped tests, and build verification.

**Tech Stack:** FastAPI routers under `apps/manager/sop_manager/routers`, React/TanStack Query workbenches under `apps/manager-web`, file-backed scoped stores guarded by `scope_guard` until OceanBase migration, pytest + py_compile + pnpm typecheck/build.

---

## Current Inspection Snapshot

Local checks on 2026-05-21:

- `system_pages_readiness`: 105 modules, average readiness 95.2, complete 105, watch 0, risk 0.
- `system_pages_isolation_audit`: score 100, protected 8/8 domains, watch 0, high_risk 0.
- Current memory completed through P1-9 A2A execution window automatic actions.
- Older gap document `docs/architecture/HERMES_REMAINING_GAPS_AND_PRIORITY_TASKS_2026-05-21.md` is stale for P0 governance gaps; its production/runtime gaps remain useful.

## Remaining Incomplete Areas, Prioritized

### P0: Production Safety And Autonomous Execution

#### Task 1: LLM Gateway Production Policy Controls

**Why now:** All AI-heavy modules depend on stable model routing, cost guardrails, health fallback, and audit.

**Files:**
- Modify: `apps/manager/sop_manager/routers/llm_gateway_v2.py`
- Modify: `apps/manager-web/subapps/ai-foundation/src/pages/ai/LlmGatewayWorkbench.tsx`
- Modify: `apps/manager-web/src/lib/api.ts`
- Modify: `apps/manager/sop_manager/routers/system_pages.py`
- Test: `apps/manager/sop_manager/routers/test_llm_gateway_core.py`

- [ ] Write failing tests for policy decisions: budget block, unhealthy provider fallback, latency threshold warning, and cost anomaly task generation.
- [ ] Add backend policy model: route policy, provider health, budget window, fallback drill result, prompt/token audit summary.
- [ ] Add endpoints: `/api/v1/llm-gateway/policies`, `/policy-evaluate`, `/fallback-drill`, `/cost-anomalies/tasks`.
- [ ] Upgrade frontend LLM Gateway workbench with policy cards, simulation result, fallback drill, and anomaly tasks.
- [ ] Update System Pages capability contract.
- [ ] Verify with `PYTHONPATH=apps/manager python3 -m pytest apps/manager/sop_manager/routers/test_llm_gateway_core.py -q`, `py_compile`, `pnpm typecheck`, and `pnpm build`.

#### Task 2: OpsCenter Production Self-Heal Guardrails

**Why now:** Self-heal exists, but production use needs approvals, rollback evidence, and post-action verification.

**Files:**
- Modify: `apps/manager/sop_manager/routers/ops_center.py`
- Modify: `apps/manager-web/subapps/ai-ops-center/src/pages/system/OpsCenterWorkbench.tsx`
- Modify: `apps/manager-web/src/lib/api.ts`
- Modify: `apps/manager/sop_manager/routers/system_pages.py`
- Test: `apps/manager/sop_manager/routers/test_ops_center_core.py`

- [ ] Write failing tests for high-risk self-heal requiring approval and rollback evidence.
- [ ] Add action approval state: `preview`, `approval_required`, `approved`, `applied`, `verified`, `rolled_back`.
- [ ] Add endpoints for approval/apply/verify/rollback.
- [ ] Show approval queue, rollback command, verification result, and audit payload in frontend.
- [ ] Register capabilities and AI consumption contract.
- [ ] Verify backend tests and frontend build.

#### Task 3: A2A Execution Window Policy Tuning

**Why now:** P1-9 added automatic actions; next step is productizing strategy controls and safety thresholds.

**Files:**
- Modify: `apps/manager/sop_manager/routers/a2a_gateway.py`
- Modify: `apps/manager-web/subapps/ai-foundation/src/pages/ecosystem/A2aWorkbench.tsx`
- Modify: `apps/manager-web/src/lib/api.ts`
- Modify: `apps/manager/sop_manager/routers/system_pages.py`
- Test: `apps/manager/sop_manager/routers/test_a2a_agent_run_link.py`

- [ ] Write failing tests for configurable stale threshold, due-soon renewal threshold, max auto reassign count, and blocked high-risk action requiring preview.
- [ ] Add scoped policy endpoint `/api/v1/a2a/execution-windows/policy`.
- [ ] Make `/execution-windows/actions` read policy by default and explain why each action is allowed or blocked.
- [ ] Add frontend policy panel with thresholds and action mode.
- [ ] Update System Pages next action from strategy tuning to completion.
- [ ] Verify A2A regression suite and frontend build.

### P1: Data Intelligence Runtime Completion

#### Task 4: Data Quality Executable Engine

**Why now:** Current data quality has catalog/workbench capability; production value requires executable runs and explainable alerts.

**Files:**
- Modify: `apps/manager/sop_manager/routers/data_analytics.py`
- Modify: `apps/manager-web/subapps/ai-data-center/src/pages/data/DataQualityWorkbench.tsx`
- Modify: `apps/manager-web/src/lib/api.ts`
- Test: existing or new `apps/manager/sop_manager/routers/test_data_quality_core.py`

- [ ] Write failing tests for rule execution against sample rows, severity classification, run record, alert attribution, and task generation.
- [ ] Add rule evaluator for null/range/regex/freshness/uniqueness checks.
- [ ] Add quality run history and alert attribution payload.
- [ ] Add frontend run panel, alert drilldown, notification/task actions.
- [ ] Verify scoped isolation and build.

#### Task 5: Metrics Semantic Layer

**Why now:** Metrics currently have catalog-level governance; users still need formula/version/query/publish lifecycle.

**Files:**
- Modify: `apps/manager/sop_manager/routers/data_analytics.py`
- Modify: `apps/manager-web/subapps/ai-data-center/src/pages/data/MetricsWorkbench.tsx`
- Modify: `apps/manager-web/src/lib/api.ts`
- Test: new `apps/manager/sop_manager/routers/test_metrics_semantic_layer.py`

- [ ] Write failing tests for metric formula validation, version publish, query contract, lineage, and impact analysis.
- [ ] Add endpoints for semantic metric publish/query/version/impact.
- [ ] Add frontend formula/version/publish/query panels.
- [ ] Update System Pages contracts.
- [ ] Verify backend and frontend.

#### Task 6: Tag Ontology And Profile Build Service

**Why now:** Tags need ontology, rule evaluation, profile attachment, and API publication to become usable beyond static catalog.

**Files:**
- Modify: `apps/manager/sop_manager/routers/data_analytics.py`
- Modify: `apps/manager-web/subapps/ai-data-center/src/pages/data/TagWorkbench.tsx`
- Modify: `apps/manager-web/src/lib/api.ts`
- Test: new `apps/manager/sop_manager/routers/test_tag_ontology_service.py`

- [ ] Write failing tests for ontology entity CRUD, tag rule evaluation, profile build record, and publish contract.
- [ ] Add ontology store and profile build history.
- [ ] Add frontend ontology tree, rule test, profile build result.
- [ ] Verify scoped isolation and build.

#### Task 7: Real-Time Data Ingest Control Plane

**Why now:** Batch import/export exists; CDC/schema/job runtime is still the major data platform gap.

**Files:**
- Modify: `apps/manager/sop_manager/routers/data_ingest.py`
- Modify: `apps/manager-web/subapps/ai-data-center/src/pages/data/DataIngestWorkbench.tsx`
- Modify: `apps/manager-web/src/lib/api.ts`
- Test: new `apps/manager/sop_manager/routers/test_data_ingest_runtime.py`

- [ ] Write failing tests for connector dry-run, schema discovery, CDC cursor, job state, and run history.
- [ ] Add schema registry and ingest run history.
- [ ] Add frontend connector validation, schema preview, CDC state, run history.
- [ ] Verify build and scoped tests.

### P2: Knowledge, Security, And Platform Hardening

#### Task 8: Graph RAG And Memory Ontology Deepening

**Files:**
- Modify: `apps/manager/sop_manager/routers/knowledge_graph.py`
- Modify: `apps/manager/sop_manager/routers/memory_api.py`
- Modify: `apps/manager-web/subapps/ai-foundation/src/pages/ai/KnowledgeGraphWorkbench.tsx`

- [ ] Add source permission checks, graph evidence links, memory lifecycle state, and entity profile merge.
- [ ] Add tests for cross-scope graph/memory isolation and explainable retrieval.

#### Task 9: ABAC And Field-Level Security

**Files:**
- Modify: `apps/manager/sop_manager/routers/auth_sql.py`
- Modify: `apps/manager/sop_manager/routers/organization.py`
- Modify: `apps/manager-web/subapps/main-admin/src/pages/organization/RolePolicyModule.tsx`

- [ ] Add tests for masked fields, denied rows, dynamic condition checks, and audit events.
- [ ] Add policy model for field mask/read/write and row filters.
- [ ] Surface policy simulation and audit history in Organization.

#### Task 10: OceanBase Production Storage Path

**Files:**
- Modify: `apps/manager/sop_manager/db.py`
- Create: `apps/manager/migrations/`
- Modify: `docs/architecture/HERMES_PLATFORM_LATEST_ARCHITECTURE.md`

- [ ] Define OceanBase-compatible DDL for core domains with `tenant_code`, `business_code`, `project_id` indexes.
- [ ] Add migration smoke tests and backup/restore checklist.
- [ ] Keep SQLite dev path intact.

#### Task 11: OpenTelemetry Observability

**Files:**
- Modify: `apps/manager/sop_manager/routers/metrics.py`
- Modify: `apps/manager/sop_manager/routers/system_ops.py`
- Modify: `apps/manager-web/subapps/ai-ops-center/src/pages/Settings.tsx`

- [x] Add trace correlation IDs across API, Agent run, LLM call, task, data job, event, and audit.
- [x] Add observability summary for failed run root-cause navigation.

### P3: Collaboration, Commercial, And Experience

#### Task 12: IM Deep Workflow

**Files:**
- Modify: `apps/manager/sop_manager/routers/notify.py`
- Modify: `apps/manager/sop_manager/routers/im_integration_core.py`
- Modify: `apps/manager-web/subapps/ai-ops-center/src/pages/Notify.tsx`

- [x] Add inbound deduplication, approval callback, task status push, report subscription, and connector health.
- [x] Verify inbound-to-task/approval and outbound audit trace.

#### Task 13: Billing And Commercial Ops

**Files:**
- Modify: `apps/manager/sop_manager/routers/billing.py`
- Modify: `apps/manager-web/subapps/ai-ops-center/src/pages/Settings.tsx`

- [x] Add entitlement checks, overage policy, dunning state, invoice lifecycle audit, and tenant quota enforcement.

#### Task 14: Mobile And Responsive Console

**Files:**
- Modify: `apps/manager-web/src/App.tsx`
- Modify: `apps/manager-web/src/index.css`
- Modify core workbench pages as needed.

- [x] Add mobile drawer navigation and compact cards for dashboard, tasks, requirements, approvals, alerts, and IM actions.
- [x] Verify with desktop and mobile browser screenshots before completion.

## Execution Rule

Do not start Task N+1 until Task N has:

- failing test observed,
- implementation completed,
- backend tests passing,
- `py_compile` passing for touched routers,
- frontend `pnpm typecheck` passing when frontend changed,
- frontend `pnpm build` passing when frontend changed,
- `memory/current_state.json` updated.
