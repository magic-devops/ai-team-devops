# 团队稳定身份 Implementation Plan

> **For agentic workers:** Use subagent-driven-development to implement the independent tasks below; root integrates, verifies and commits the stage.

**Goal:** 统一稳定任务归属，完善团队列表、详情、负责人选择与执行计划中的身份表达。

**Architecture:** SQL Task.owner_id 是唯一归属，当前成员由现有授权与项目登记解析。证据语义排除名称，审计保留原名称；失效在原事务内持久化。

**Tech Stack:** Existing Python/FastAPI/SQLAlchemy, React/TypeScript/Ant Design, pytest/Vitest.

**Spec:** docs/DELIVERY_TEAM_IDENTITY_DESIGN.md

## Global Constraints

- 不增加依赖，不按姓名推断，不保留双写归属入口，不自动授予运行权限。
- 项目/租户隔离、读操作无副作用、写入原子性与现有验收门禁继续有效。
- scratch 在 .cache/team-identity；证据在 .sop-runtime/delivery-evidence/team-identity。
- 全阶段验证后一次提交，不推送；其他全生命周期待办继续有效。

## Review Focus

- 同名/改名是否会接管他人任务或导致原验收无故失效。
- 停用/移除后恢复，是否错误复活已失效证据。
- 通用、同步、导入及治理任务是否仍从角色标签制造归属。
- 迁移是否仅使用同范围明确关联，失败时能原子回滚。
- 失效当前选择、深链返回及窄屏是否保留可理解的上下文。

### Task 1: 规范归属与交付证据（backend agent）

- [x] 增加改名、同名、停用/恢复、工具、范围隔离的失败测试并记录 RED。
- [x] 新 delivery_team.py 统一 resolver；更新 delivery service/verification/snapshot/semantic basis/schedule/inbox/progress，删除 task_owners 运行来源。
- [x] 保留原审计显示信息；状态失效持久化，完成定向回归。

### Task 2: 普通写通道（runtime agent）

- [x] 增加 SQL owner_id、普通 CRUD/批量/sync/import 的失败测试。
- [x] Task 写入统一 owner_id，拒绝 assigned_to 名称写入；显示名称只读投影，自动任务缺少 ID 时未分配。
- [x] 同范围统一校验，完成相关测试，不改 runtime 协议。

### Task 3: 团队工作台（UI agent）

- [x] 增加 owner 选项、失效选择、过滤、team_member 深链与往返测试。
- [x] 实现共用身份呈现、团队列表/详情、四状态、三语和响应式；清理普通任务的文本分配入口。
- [x] 完成定向测试，根任务统一构建和真实浏览器核验。

### Task 4: 显式迁移、公开契约与实际验证（root）

- [x] 写旧 SQLite 明确关联/悬空 ID/范围隔离/无姓名推断/原子回滚迁移测试并记录 RED。
- [x] 扩展 schema verify/apply，迁移规范 owner_id 并移除旧 map；同步 CLI/SDK/OpenAPI。
- [x] 完成跨域测试、类型与生产构建、真实 HTTP 与 UI、一次独立增量审查并修复确认问题。
- [x] 更新项目记忆、证据与待办，检查 diff 与秘密，提交全部阶段修改并保存提交回执。

验证完成：Manager850、Web360/63、SDKCLI24、路由3，类型/最终构建及真实HTTP/三语浏览器通过；唯一审查P2已复验。阶段提交由根执行并以忽略证据commit-receipt.json确认。
