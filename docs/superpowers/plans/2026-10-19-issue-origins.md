# Issue Event Origins Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans. Track each step below.

**Goal:** 工具真实问题事件与业务Issue、来源、精确回执、固定诊断及人工需求回流形成可核验链路。

**Architecture:** append-only indexed origin projection from successful immutable attempts, maintained in the existing business transaction. Independent fixed-window pages and exact selection resolve through existing permissions; no payload guessing or duplicate business entity.

**Tech Stack:** FastAPI/SQLAlchemy, React/Ant Design/TypeScript, Python SDK/Typer, existing native event transport.

**Spec:** `docs/ISSUE_EVENT_ORIGINS_DESIGN.md`.

## Global Constraints

- 基线9526181；只接受实际成功结果；opened与structured issues两条路径都覆盖。
- 默认20/最大100；固定window游标；来源和诊断总选择不混页，最多32项。
- GET零写，不隐式修复；显式configure query-rebuild只补真实投影，不重执事件。
- 不保留不必要旧设计，不绕过已拒绝的浏览器/安装/上传，不冒称视觉验收。
- `.cache/issue-origins` 为临时目录；证据在 `.sop-runtime/delivery-evidence/issue-origins`。

## Review Focus

- create/update/delete实际效果与来源命名正确，rollback和重复receipt不增副作用。
- 原件被删/改、跨项目、身份撤权、cursor篡改明确拒绝，不能猜subject关联。
- 页面之外的选择仍固定原ID/digest，当前第一页/新来源不替换原选择。
- 诊断未知结果、会话ABA、旧响应、403/404不得假成功或丢原稿。
- 维护投影不生成业务版本或虚假进度；来源标签和查询代次与业务同事务。

### Task 1: Real origin persistence and bounded read

Files: `sql_models.py`, `event_processing.py`, new origin module/contract, `project_write_guard.py`, query/service hooks and Manager tests.

- [x] 复制并永久化两种事件成功但来源缺失的RED症状。
- [x] 实现真实effect的同事务origin、追加保护及显式派生重建，schema4查询投影。
- [x] 实现来源page/exact/summary、当前授权/原件校验和固定window，不传全原文。
- [x] 测试失败/rollback/重复/伪来源、重建和全表零写及实际SQL装载预算。

### Task 2: Exact selected evidence and product interaction

Files: issue snapshot/diagnosis modules/contracts; Web deliveryIssue API, Issue detail/evidence selection, source filter, event navigation, CSS/i18n and tests.

- [x] 页外origin选择的RED及权限/缺失导致原建议不能采纳。
- [x] 实现精确所选来源解析、稳定basis/digest与既有人审唯一回流。
- [x] 实现独立目录、创建/修改区别、跨页选择及精确receipt返回；所有交互错误和会话原件恢复保持。
- [x] 三语/主题/键盘结构与受控UI/controller回归；记录真实视觉限制。

### Task 3: Clients and tool feedback

Files: SDK client/IPC tests, CLI delivery/task issue and corresponding tests; public OpenAPI and user guide.

- [x] SDK/CLI分页/精确和task issue业务结果反馈先RED。
- [x] 新来源读取及已存回执的真实processed/pending/failed输出；不自动换原件重送。
- [x] 同步实际公开合同与固定原件测试，保持既有Go event.enqueue协议。

### Task 4: Integrate and deliver

- [x] 独立后端/交互审查，确认问题用原症状修复。
- [x] 稳定源码完整Manager/Web/SDKCLI、类型/构建；实际HTTP工具事件→Issue→原件→诊断→人审唯一需求。
- [x] 更新记忆/范围/证据与未验证项目；保全重要源和产物再精确清理。
- [x] 封存全部已验证阶段变更与精确提交清单；本地commit、已提交字节及clean核对以 `.sop-runtime/delivery-evidence/issue-origins/commit-receipt.json` 为准，不push；完整目标active。
