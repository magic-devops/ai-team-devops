# Bounded Manual Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 独立有界人工验收依据、历史目录和原件，以及可信的原请求恢复交互。

**Architecture:** canonical 当前证明使用共享必要闭包；历史直接用项目范围 SQL 序号分页，不读取 Workspace JSON。Web 共用持久化命令状态机，SDK/CLI 与公开契约同步。

**Tech Stack:** FastAPI, SQLAlchemy, React, TypeScript, Ant Design, Python SDK/Typer。

**Spec:** `docs/DELIVERY_BOUNDED_REVIEW_DESIGN.md`。

## Global Constraints

- 不保留旧组合读取兼容层，不弱化事务写入的完整证明。
- 默认 20/最大 100；任务闭包上限 500、依赖深度 64、JSON 叶子 1 MiB；摘要最多 240 字。
- GET 不写入或自动修复；历史在当前证明失败时独立可读。
- `.cache/bounded-review` 为阶段临时目录；证据在 `.sop-runtime/delivery-evidence/bounded-review`。
- 不重试已被拒绝的浏览器协议或设计安装/上传；实机视觉不得声称已验证。

## Review Focus

- 后续新记录、身份/项目切换和任务删除不会混入另一目录或读取其他原件。
- 孤立任务、父需求缺失、复杂依赖与预算不足不会被标为已验收。
- 当前依据失败时历史仍可读，历史接受不被错误标为当前有效。
- 未知提交刷新/会话 ABA/错误回执只能恢复原请求，不能改稿换键重复写入。
- 明确拒绝后保留意见并显式采用最新依据；读取迟到响应不污染当前页面。

### Task 1: Backend bounded current/history/original

Files: `delivery_manual_review.py`, new focused query module if useful, `delivery_quality_scope.py`, `delivery_contract.py`, `delivery.py`, Manager review tests.

- [x] 固定旧读取全项目和完整历史正文的 RED 探针。
- [x] 实现三个读取契约、绑定固定窗口游标及共享任务闭包，保持 canonical 写入不变。
- [x] 永久测试精确范围/完整证明/超限/缺失/游标身份和新增记录/删除原件/零写入。
- [x] 后端定向通过并记录来源及证据。

### Task 2: Independent UI reads and durable command recovery

Files: `deliveryTaskReview.ts`, `DeliveryManualReviewPanel.tsx`, CSS/i18n, shared controller and release wrapper, frontend tests.

- [x] 固定分页大正文和未知结果可变更/会话问题的 RED 测试。
- [x] 拆当前依据/历史/指定原件，独立错误、分页和手动刷新，安全标记当前有效性。
- [x] 抽共用原件状态机并接入人工评审，严格 ACK、未知冻结恢复、拒绝显式采用新依据。
- [x] 中英日和响应式源检查、控制器/面板永久测试通过。

### Task 3: Public clients and contracts

Files: SDK client/test, CLI delivery/test, `apis/openapi/openapi.yaml`, manual review guide/design.

- [x] SDK/CLI 测试先覆盖 opaque cursor、当前依据、精确原件和参数拒绝。
- [x] 更新规范 API 和 CLI 操作，无旧组合读取兼容路径。
- [x] 公开 OpenAPI 与实际应用一致，其他接口保持原义。

### Task 4: Independent verification and phase delivery

- [x] 独立审查，修复确认的问题并补原症状测试。
- [x] 稳定源码后完整 Manager/Web/SDK-CLI、类型/构建及真实 HTTP 只读与未知重放验证。
- [x] 更新进度/剩余范围和证据清单，核对缓存不跟踪。
- [x] 保存重要快照和证据后清理本阶段临时目录；本地 commit 全部已验证阶段变更，不 push。
