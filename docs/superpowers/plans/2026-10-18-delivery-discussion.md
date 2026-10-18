# 对象讨论与明确采纳实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在现有需求/任务/问题详情完成讨论、固定结论、来源追踪和明确采纳的全纵向流程。

**Architecture:** 独立同库支持表维护讨论版本/不可变消息历史/幂等回执及来源。业务修改复用现有Command事务、版本与验收门禁，纯讨论不写业务Workspace/DeliveryEvent或触发全项目观测。

**Tech Stack:** 现有FastAPI/SQLAlchemy/Pydantic、React/TypeScript/AntD、Python SDK/CLI，不新增依赖。

**Spec:** docs/DELIVERY_DISCUSSION_DESIGN.md

## Global Constraints

- 真实认证User发言，原runtime引用在读/采纳/回执重放时核当前原作用域；不能伪造Agent或system作者。
- 只在现有业务动作明确确认后改变定义/任务；讨论解决不等于业务验收或任务完成。
- 版本、幂等、错误/未知结果原key、409保留草稿、当前作用域与UTC时间均明确表达。
- 纯讨论有界SQL，无业务观测/派生代次变化，无GET初始化或历史迁移；新增事实append-only。
- scratch仅.cache/delivery-discussion，证据.sop-runtime/delivery-evidence/delivery-discussion。保留既有浏览器与12ui审批限制，不绕过。

## Review Focus

- 来源后来编辑或重开不能改写已经采用的快照；原业务key重放复核原权限而非重新执行。
- 项目/会话/筛选A→B→A、未挂载详情和迟到响应不能丢稿/误导航。
- 消息正文、可信运行引用和已撤回占位分别处理，受限引用不从旧snapshot泄露。
- Project→Thread锁后重验真实权限，回滚不留线程版本/消息/来源/成功回执。
- 采纳多任务结果必须准确关联每个Task；Issue唯一需求回流沿用原约束。

### Task 1: 讨论独立事务与读取

**Files:** 新delivery_discussion*.py及tests/test_delivery_discussions*.py；sql_models.py支持表；project_write_guard.py。

- [x] 冻结精确请求/响应及source verifier/record_adoption内部接口，与前端/root核对。
- [x] 先失败测试覆盖创建/回复/编辑历史/撤回/结论/恢复归档/引用/当前授权/幂等和CAS。
- [x] 实现同库六表、有界分页与只读来源摘要，纯讨论零业务写和全项目计算。
- [x] 测试回滚、删除/转属历史、原runtime权限、追加保护及生产autoflush=False。

### Task 2: 明确业务采纳与clients契约

**Files:** delivery_source_contract.py、delivery_contract.py、delivery.py、新采纳测试；SDK client.py、CLI delivery.py、OpenAPI。

- [x] 先RED：根source_reference只允许5动作，精确版本/不可伪造字段，来源纳入固定请求指纹。
- [x] 同一业务事务内校验固定结论并记录真实结果来源，原回执权限包含原source runtime scopes。
- [x] 五业务动作全部成功/回滚/重放/来源变更冲突及有效验收语义回归。
- [x] SDK/CLI精确读写与file重试，严格OpenAPI模型/路径/引用和真实调用验证。

### Task 3: 紧凑讨论与来源交互

**Files:** 新Discussion/Source组件、前端lib、三语/CSS/测试；既有Workbench/Task/Issue编辑器接入。

- [x] 先落四flow具体界面/交互设计，再实现需求/任务/问题共用面板及项目讨论定位。
- [x] 分页、深链、历史按需、固定来源/明确采纳；草稿按真实身份/上下文隔离。
- [x] DOM回归发送新输入保护、409显式采用、超时原key、403/404留页、ABA、键盘与窄屏规则。

### Task 4: 验证、审查与阶段交付

- [x] 真实隔离HTTP四flow、纯讨论业务/运行表无变化及现有验收保持。
- [x] 万级对象/讨论SQL测量，明确fixture和生产验证边界。
- [x] 唯一增量独立审查并原RED→GREEN；完整受影响Manager/Web/clients、类型与生产构建。
- [x] 更新完整目标待办、保留hash/唯一证据/产物，安全清理精确scratch；全部已验证阶段更改commit，不push。
