# 团队执行关联实施计划

> **For agentic workers:** current native execution with isolated parallel ownership; root integrates and conducts one independent incremental review.

**Goal:** Agent 关联真实配置，任务选择执行成员并保留固定溯源。
**Architecture:** 项目 JSON 独立关联和代次，现有运行配置固定版本；派发前门禁与交接后证据分离。
**Tech Stack:** FastAPI / SQLAlchemy / Hermes / React / TypeScript / Ant Design。
**Spec:** `docs/DELIVERY_TEAM_RUNTIME_DESIGN.md`。

## Global Constraints

- 负责人、成员、配置、设备独立；不按名称匹配或授予权限。
- GET 零写，变化不改 Task basis / 已交接证据，沿用 CAS 和幂等。
- scratch `.cache/team-runtime/`、证据 `.sop-runtime/delivery-evidence/team-runtime/`，保留清单哈希后清理。
- 根统一全量测试、服务、浏览器、文档及 commit，代理不操作 git/服务。

## Review Focus

- Store 不独立施加 ACL，绑定须验证访问范围及同租户。
- SQL 丢提交但外部 receipt 已有时，解绑不能遮蔽交接或重建 run。
- 停用恢复/解绑重绑到原配置不能复活 pending。
- 目录失败/版本变化保留选择，不静默直接派发。
- 改名不抖基准，历史保留原名称。

## Task 1: 独立运行关联（runtime agent）

Files: 新 delivery_team_runtime.py、test_delivery_team_runtime.py。根持有契约。
Interfaces: binding_basis(project,data,member_id)；execution_binding_current(project,data,member_id,expected_basis)；resolve_executor_binding(db,project,data,user,store,*,member_id,expected_basis,workspace_id,agent_id,agent_version)；invalidate_member_runtime_binding(data,member_id,*,actor,reason)；apply_runtime_binding(db,project,data,user,store,action,body)；runtime_bindings_view(db,project,data,user,store,*,can_configure,version)。
- [x] RED：精确版本、configure/read 无 execute 可绑定、跨租户访问拒绝、代次 A→B→A、改名不变、停用墓碑、纯读。
- [x] 实现模块与约定目录、快照；同用例 GREEN 并保存日志。

## Task 2: 运行交接（backend agent）

Files: delivery_execution.py、delivery_execution_observations.py、delivery_service.py、delivery_progress_capture.py、必要 verification 与专属测试。Consumes Task1；不改根 contract/router。
- [x] RED：pending 永久失效、停用恢复、交接后测试人审、失效取消、receipt 恢复、Task basis 不变。
- [x] 固定快照；reconcile/事务捕获持久化独立 pending 标记；member.save 停用失效，run 后保留原证据。
- [x] 相关用例 GREEN，报告实际条数和边界。

## Task 3: 四界面（web agent）

Files: 新 deliveryTeamRuntime/DeliveryMemberRuntime/MemberRuntimeBindingEditor/ExecutionExecutorFacts；现有 TeamMembers/Scheduling/ExecutionPlanEditor/ObservationCard/类型和独立文案样式。
- [x] RED：切换清空、失效保留、冲突明确采用、快照展示、直接派发不依赖目录。
- [x] 实现四界面状态、三语、窄屏、键盘、返回；专属交互 GREEN，根实际浏览器验收。

## Task 4: 接线、验证与提交（root）

Files: 新 delivery_team_runtime_contract.py；delivery_contract/execution_contract/delivery.py；生成 OpenAPI、必要 CLI/SDK、glossary 与进度。
- [x] RED：成对严格输入、Agent 限定、权限/CAS/幂等/纯读。
- [x] typed 契约、GET/commands 接线和生成契约。
- [x] Manager/Web 全量、类型、构建、相关 CLI/SDK、实际 HTTP/UI/截图。
- [x] 一次独立增量审查并修复复验。
- [x] 更新记忆、保留清单哈希、清理并统一 commit，验证 clean，无 push。
