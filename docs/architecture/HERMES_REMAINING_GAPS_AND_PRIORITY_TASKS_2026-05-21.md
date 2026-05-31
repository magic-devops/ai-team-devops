# Hermes Remaining Gaps And Priority Tasks

> Date: 2026-05-21
> Source: `HERMES_PLATFORM_GAP_ANALYSIS_AND_UPGRADE_PLAN.md`, `HERMES_PLATFORM_DEVELOPMENT_PLAN.md`, `/api/v1/system/pages/readiness`, `/api/v1/system/pages/health`

## Current Snapshot

- Module readiness: 109 modules, average readiness 95.4, complete 109, watch 0, risk 0.
- Menu health: score 100/excellent, issues 0 after Task 24 A2A top-level navigation i18n cleanup.
- Main immediate product gap: visible governance contract and menu i18n gaps are closed; next work should focus on deeper runtime, execution, and production hardening.
- Main remaining architecture gaps are no longer basic page/API availability; they are production-grade execution, isolation, storage, observability, data intelligence, and external ecosystem depth.

## P0 - Fix Governance Contract And Platform Safety

### P0-1 Micro-App Navigation Contract

Scope:
- Add or mark navigation contract for `microAppMainAdmin`, `microAppAiFoundation`, `microAppAiRdCenter`, `microAppAiDataCenter`, `microAppAiOpsCenter`, `microAppGovernance`.
- Decide whether each is a visible portal entry or hidden/agent-only module.

Acceptance:
- `/api/v1/system/pages/validate` has no `missing_nav`.
- `/api/v1/system/pages/readiness` has no `watch` modules caused by missing navigation.
- SystemMap menu health no longer reports high `missing_nav` issues.

### P0-2 Submodule I18n Cleanup

Status: Completed through Task 24, including both submodule keys and A2A top-level focused route keys.

Scope:
- Add missing `nav.sub.*` keys for SystemMap capability submodules.
- Prioritize AI memory, analytics catalog, audit, system map, notify, workflows, platforms.
- Add top-level navigation keys when newly registered focused pages such as A2A registry, negotiation, SLA, execution windows, dispatch, and evidence become first-class routes.

Acceptance:
- `/api/v1/system/pages/health` low `missing_sub_i18n` count is reduced to zero or intentionally suppressed for internal-only submodules.
- `/api/v1/system/pages/health` `missing_i18n` count is zero for visible focused routes.

### P0-3 Three-Code Isolation Audit

Status: Completed in Task 16.

Scope:
- Audit high-traffic routers for `tenant_code`, `business_code`, `project_id` propagation.
- Add reusable scope guard helpers where routers still use file-backed stores.
- Convert isolation audit domains into security governance tasks through `/api/v1/system/pages/isolation-audit/tasks`.
- Expose the audit and task generation workflow in SystemMap, Python SDK, and CLI through `sop pages isolation` and `sop pages isolation-tasks`.

Acceptance:
- Tasks, requirements, data assets, Agent runs, reports, Notify events, and Ops records cannot cross tenant/business/project scope.
- Add tests for at least one read and one write endpoint per domain.
- SystemMap can preview or create isolation hardening tasks without leaving the module governance page.
- Generated tasks carry `source=system_page_isolation`, scope fields, guard name, regression tests, and the shared scope contract.

### P0-4 SystemMap Readiness Task Generation

Status: Completed in Task 15.

Scope:
- Convert SystemMap readiness gaps into task drafts through `/api/v1/system/pages/readiness/tasks`.
- Support preview and create modes, module/domain/status/keyword filters, duplicate protection by `source_report_id`, and optional complete-module inclusion for continuous enhancement.
- Expose the workflow in SystemMap, Python SDK, and CLI through `sop pages readiness` and `sop pages readiness-tasks`.

Acceptance:
- SystemMap can preview or create module readiness governance tasks without leaving the page.
- AI CLI/Agent can inspect readiness and turn watch/risk or selected complete modules into executable tasks.
- Generated tasks carry `source=system_page_readiness`, implementation contract details, module route, API list, capability code, and AI surfaces.

## P1 - Complete AI Autonomous Execution Loop

### P1-1 Agent Run Persistence And Retry

Scope:
- Upgrade Agent run center from aggregate view to durable run lifecycle: create, start, heartbeat, report, fail, retry, cancel.
- Persist retry_count, artifact, quality gate result, error, lease owner, last heartbeat.

Acceptance:
- Agent can recover an interrupted run and retry a failed run without duplicate task completion.
- Frontend Agent run center exposes retry/cancel and run detail evidence.

### P1-2 A2A Protocol Depth

Scope:
- Add A2A conversation/session history, protocol negotiation transcript, evidence SLA, failed dispatch retry.
- Link A2A dispatches to Agent runs and task quality gates.

Acceptance:
- External Agent handoff can be traced from negotiation to dispatch, evidence, quality decision, and task update.

### P1-3 LLM Gateway Production Controls

Scope:
- Add policy-based route evaluation, budget guardrails, provider health, fallback drill, prompt/token audit.
- Add model route simulation and cost anomaly tasks.

Acceptance:
- Gateway can block or fallback based on budget, health, latency, and task type policy.
- Cost and usage anomalies can be converted to governance tasks.

## P2 - Complete Data Intelligence Platform

### P2-1 Data Quality Engine

Scope:
- Turn quality rules into executable checks with run records, alert attribution, quality reports, and task generation.
- Add severity policy and subscription notification.

Acceptance:
- A data quality issue can be detected, explained, notified, and converted into a task.

### P2-2 Metrics Semantic Layer

Scope:
- Add metric formula/version/owner, dimensions, lineage, publish status, API query contract, impact analysis.

Acceptance:
- A metric can be published, queried, versioned, traced to source assets, and monitored.

### P2-3 Tag And Ontology Service

Scope:
- Add ontology entities, tag-rule evaluation, profile build records, tag API publication.

Acceptance:
- Tags can be authored, evaluated against sample data, attached to profile entities, and published.

### P2-4 Real-Time Data Ingest

Scope:
- Add CDC connector registry, schema registry, streaming job state, and ingest run history.

Acceptance:
- A connector can be configured, schema-discovered, dry-run validated, and represented as a running or failed ingest job.

## P3 - Production Operations And Enterprise Hardening

### P3-1 OceanBase Production Storage Path

Scope:
- Define migration scripts, indexes for three-code scope, file-store to database transition, and backup/restore checks.

Acceptance:
- Core domains can run on OceanBase-compatible storage with migration smoke tests.

### P3-2 OpenTelemetry Observability

Scope:
- Add API traces, queue/worker metrics, Agent run metrics, LLM gateway metrics, data job metrics, and log correlation.

Acceptance:
- A failed task or Agent run can be traced across API, worker, model call, data job, event, and audit record.

### P3-3 ABAC And Field-Level Security

Scope:
- Add field masks, row filters, dynamic policy checks, and audit records for denied access.

Acceptance:
- Sensitive fields and cross-project rows are hidden even when a role has broad module read permission.

## P4 - Collaboration, Mobile, And Commercialization

### P4-1 IM Deep Workflow

Scope:
- Expand IM from briefing delivery to approval callback, task status push, report subscription, inbound deduplication, and connector health.

Acceptance:
- Inbound IM can create/approve/update tasks; outbound IM can deliver status, approval, alert, and report messages with audit trace.

### P4-2 Billing And Commercial Ops

Scope:
- Upgrade current billing records to plan entitlement checks, overage policy, dunning, invoice lifecycle, and tenant quota enforcement.

Acceptance:
- Plan change updates quota, overage generates alert, invoice/payment state is auditable.

### P4-3 Mobile And Responsive Console

Status: Completed in Task 14.

Scope:
- Add mobile navigation drawer, compact dashboard cards, responsive tables, touch-friendly controls.

Acceptance:
- Core workflows are usable on mobile for dashboard, tasks, requirements, approvals, alerts, and IM-triggered actions.
- Implemented with a mobile drawer, bottom action bar, compact workbench shell, responsive Ant Design table handling, and desktop/mobile screenshot verification.

## Execution Order

1. P0-1 and P0-2: finish visible governance gaps and reduce SystemMap health noise.
2. P0-3: strengthen isolation before adding more production flows. Completed in Task 16.
3. P1-1, P1-2, P1-3: complete AI autonomous execution across Agent, A2A, and LLM Gateway.
4. P2-1, P2-2, P2-3, P2-4: complete data intelligence runtime, not only workbench UI.
5. P3-1, P3-2, P3-3: production hardening.
6. P4-1, P4-2, P4-3: collaboration, commercial, and mobile polish.

## Next Recommended Sprint

- Sprint goal: eliminate platform governance gaps and prepare safe execution for deeper AI/data features.
- Tasks:
  1. Fix micro-app navigation contract.
  2. Add missing submodule i18n keys.
  3. Add scope audit tests for core routers.
  4. Add Agent run retry lifecycle design and first backend tests.
  5. Add SystemMap readiness task generation for watch/risk modules. Completed in Task 15.
