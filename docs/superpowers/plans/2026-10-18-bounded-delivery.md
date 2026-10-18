# Bounded Quality and Release Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将质量与版本列表和明确范围详情变为有界读取，保留完整验收与写入门禁。

**Architecture:** 写事务维护轻量目录事实，列表使用绑定查询代次的 SQL 分页。选中范围通过窄 JSON 路径及完整必要证明闭包复用 canonical VerificationContext；Web 按当前视图及用户展开状态请求，SDK/CLI 使用同一契约。

**Tech Stack:** FastAPI / SQLAlchemy / Pydantic / Python SDK / Typer / React Query / Ant Design / Vitest。

**Spec:** `docs/DELIVERY_BOUNDED_READS_DESIGN.md`

## Global Constraints

- 默认 20、最多 100 条；最多 500 个任务的完整证明闭包，超出 413 `quality_scope_too_large`。
- GET 不补投影、不创建工作区、不写库；不保留旧全集读取兼容层。
- 原版本、原预览依据、原幂等键及未知结果恢复规则保持有效。
- scratch 使用 `.cache/bounded-delivery/`，证据使用 `.sop-runtime/delivery-evidence/bounded-delivery/`；本地阶段 commit，不 push。

## Review Focus

- 关联需求的兄弟任务或跨需求前驱变更必须使相同证明正确失效。
- 成员撤权、重复登记身份或最新人工拒绝不得被缓存摘要掩盖。
- 游标跨项目、读者、过滤、代次必须拒绝，不能串页或漏记总数。
- 抽屉切换及读取失败不能保留可写的旧项目/旧范围证据。
- 超限完整范围必须明确失败，不能把本页数据当作全范围通过。

### Task 1: Exact scoped proof

**Files:** 新建 `apps/manager/sop_manager/routers/delivery_quality_scope.py` 与其测试；最小修改 `delivery_verification.py` / `delivery_team.py`。

**Interfaces:** 生成 `load_quality_scope(db, project, *, requirement_ids, task_ids, task_limit=500) -> VerificationContext`，包含 reconcile 后必要 canonical 数据；不修改写调用默认完整语义。

- [x] 写大项目有界 SQL、兄弟闭包、跨需求前驱、成员撤权和 413 无截断的失败用例并记录 RED。
- [x] 实现窄路径加载和可注入上下文。
- [x] 比较完整 canonical quality 的 basis/eligibility，运行相关测试并记录 GREEN。

### Task 2: Paged catalogues and selected details

**Files:** `delivery_query_index.py`、`delivery_release.py`、`delivery_release_contract.py`、新 `delivery_release_query.py`、新后端分页测试、路由 `delivery.py`。

**Interfaces:** `GET /quality/catalogue`；`GET /quality` 明确范围；`GET /releases` 小上下文；`GET /release-pages?kind=candidate|evidence|legacy`；`GET /release-evidence/{id}`；`GET /releases/{id}`。

- [x] 先写列表无重正文、完整计数、游标绑定、GET 零写入和精确详情的 RED。
- [x] 在同一 evaluation 事务维护 schema 3 的目录/位置事实，接入有界读取及当前权限/证明检查。
- [x] 接入 FastAPI 响应契约并验证完整写门禁无退化。

### Task 3: Web catalogue, explicit inspection and client access

**Files:** `deliveryRelease.ts`、交付 release 组件和路由、三语文案与相关测试；`packages/sop-sdk-python/sop_sdk/client.py`；`packages/sop-cli/sop_cli/commands/delivery.py` 及测试。

**Interfaces:** 消费 Task 2 读契约；候选编辑器消费小上下文与独立分页证据选择。

- [x] 写跨视图请求、按需原文、跨页选择、失效读禁写、未知意图/会话控制和客户端参数传递的 RED。
- [x] 实现服务器筛选、独立分页、明确详情与三语状态。
- [x] 运行相关组件/API/CLI 测试、类型检查和构建。

### Task 4: Independent verification and phase commit

**Files:** 设计/指南、`memory/current_state.json`、`memory/delivery-workbench-progress.md`、阶段证据目录。

- [x] 独立复查权限、证明等价、SQL 读取和 UI 状态；修复有证据的问题。
- [x] 冻结最终源码，执行 Manager 完整回归、SDK/CLI 与 Web 相关回归、真实本地 HTTP/规模样例。
- [x] 记录实际通过及未验证项，更新进度；重要证据先清单和哈希，再清理本阶段 disposable scratch。
- [x] 检查所有阶段源码与验证快照一致，全部本地提交 `feat(delivery): ... [T-bounded-delivery]`；验证 commit 与工作区状态，不 push。
