# Bounded Progress and Immutable History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans. Track each task and preserve evidence.

**Goal:** 小型真实进度图表、独立固定历史分页与完整基线proof/可靠原请求冻结形成同一可用工作流。

**Architecture:** Canonical business entities and original JSON snapshots stay authoritative; extend the existing transaction-bound QueryFact for current progress, SQL-project immutable arrays, and reuse the durable command controller. No monolithic-read compatibility track.

**Tech Stack:** FastAPI/SQLAlchemy, existing SQLite/DB dialect helpers, React/Ant Design/ECharts, Python SDK/Typer.

**Spec:** `docs/DELIVERY_BOUNDED_PROGRESS_DESIGN.md`.

## Global Constraints

- 基线af965c862ab8e774fd9e93ce453606d5a7b8c600；整体goal active，阶段验证后全部本地commit、不push。
- 普通page20/max100，cursor4000；UTC最多366天；完整proof16MiB/10000scope及必要闭包/64层依赖/单项1MiB，超限不回部分。
- 历史唯一原JSON，当前唯一现有QueryFact派生索引schema5；GET零写、不隐式重建；无新业务Task或可编辑计划。
- scratch `.cache/bounded-progress/`；证据 `.sop-runtime/delivery-evidence/bounded-progress/`。不重试先前拒绝的浏览器/安装/上传，不冒称视觉验收。

## Review Focus

- day范围有界不代表单snapshot有界；SQL只取所需小路径或所选limit+1原项，不先全读再切。
- JSON缺键/null/空及对象键顺序、数组顺序与incomplete/changed重叠的canonical语义。
- immutable历史与mutable当前/generation分开；删除scope、来源损坏、权限撤销都不替换原件或假空成功。
- 选中页外source、不同分类/页大小、项目/reader/sessionABA及迟到响应不混。
- proof完整与验收通过分开；unknown命令保留原件、reload/replay严格ACK，不能以分页范围批准部分。

### Task 1: Canonical contract and bounded backend

Owned: Manager production/tests; new delivery_progress_contract.py plus focused SQL JSON/history/comparison/proof modules; existing query index/hooks/guard/router/capture/baseline.

- [x] 固定原读取成本、缺失新DTO/页、原件保护与proof边界的永久RED。
- [x] 写严格DTO，当前schema5派生progress事实，series SQL聚合与有界reference/Task scope读取。
- [x] metadata、目录、两source task/req页和精确项、语义diff总数/分类页；无全source ORM/无全当前Task正文。
- [x] 独立完整proof及写端同预算/完整basis重验，真实capture/baseline原件保护。
- [x] 测UTC last-valid/null/ideal固定IDs、JSON未知/语义、SQL预算、cursor/auth/删除历史/GET全表零写、真实写故障回滚。

### Task 2: Product interaction and durable commands

Owned: Web progress models/read helpers/route/components/i18n/CSS/tests; RequirementHistory及历史→当前需求导航的Workbench父详情仅定点403404清缓存。

- [x] 将路由丢project/return、拒绝缓存、256项整包及实际baseline未知恢复风险永久RED；四态交互说明写入本阶段证据。
- [x] 小chart+remote refs+独立baseline目录/精确header，snapshot/diff独立page/exact/当前Task返回及混代/会话检查。
- [x] 明确proof准备/审阅/冻结及record双namespace持久原件，parent unresolved/退出锁、拒绝后明确重读、严格ACK与重载恢复。
- [x] 三语主题/窄屏结构及无浏览器callback/SSR回归，明确实际视觉未验证。

### Task 3: Canonical clients and published contracts

Owned: SDKCLI agent仅packages相关源码与tests；root持有OpenAPI/docs/evidence。

- [x] 新读取methods/CLI与旧大response退出、page/exact/proof输入校验先RED，保留空完整scope。
- [x] 同步actual路径/DTO；baseline.create与progress.record仍原command文件/version/key，不自动选首项或造部分proof。
- [x] 同步公开OpenAPI所有相关路径/模型、使用说明，离线wheel字节匹配；相关客户端回归。

### Task 4: Independently verify and deliver

- [x] 独立后端/交互/合同审查，所有确认缺陷保留原RED→修复GREEN再冻结。
- [x] 全部相关完整Manager/Web/SDKCLI、类型/构建/Ruff，前后源一致；真实HTTP与编译TS完整proof/丢ACK重放链路。
- [x] 更新项目记忆/实际范围/后续缺口，保全源/唯一证据再精确清理，全部阶段变更本地提交并核committed bytes/clean。
