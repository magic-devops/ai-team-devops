# Bounded Requirements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development or executing-plans. Preserve original RED/GREEN and source-pinned evidence; continue authorized tasks autonomously.

**Goal:** 同一需求详情的thin head/精确定义、版本metadata/原件、当前records/影响、完整preview与可靠更新工作流。

**Architecture:** 原Task/Requirement/Workspace及固定Version保持唯一事实；schema5/SQL关系投影提供小读，必要canonical闭包提供完整proof，复用持久原请求控制器。移除旧聚合合同并同步所有消费者。

**Tech Stack:** FastAPI/Pydantic/SQLAlchemy/SQLite；React/Ant Design/现主题三语；Python SDK/Typer。

**Spec:** `docs/DELIVERY_BOUNDED_REQUIREMENTS_DESIGN.md`。

## Global Constraints

- 基线ed00a4bfa0f6f7d4135503bb8f1ec2b3540091e2；整体goal active；阶段全部本地commit、不push。
- 普通页20/max100，cursor4000；proof 10000影响/闭包Task/必要Req/每关联集合，深度64，总16777216字节，单项1048576字节。
- 新DTO extra=forbid；Req/Task ID Unicode64、摘要Unicode256；不保持旧全包响应/假空/影子任务。
- definition/records页和exact/impact items页和exact必须显式query_generation>=1；history固定seq独立当前代。
- scratch `.cache/bounded-requirements/`，evidence `.sop-runtime/delivery-evidence/bounded-requirements/`；不重试审批拒绝的浏览器/安装/上传。

## Review Focus

- 小响应不证明小源读取；真实canonical字节预算在解码前，preview/write所有入口在全项目副效应前。
- 只换薄head不能丢现artifact/review/legacy release功能，Task编辑不能把未取criteria当[]。
- 影响必须全历史+闭包+hidden IDs语义hash，当前ACL与generation控制展示，不污染semantic hash。
- 当前读取404/503不阻断固定历史或未知原请求恢复；late/ABA不复活旧缓存。
- metadata/no-op/null规范化、原hash与真实gate保持；requirement version保护不能阻断实际hook或改变归档门禁优先级。

### Task 1: Canonical Manager contract and proof

**Files:** 新delivery_requirement_contract/read/impact/proof.py、delivery_input_budget.py（只小范围抽共用字节预算）；改delivery.py、query_read/contract、activity_contract、requirement_history、progress_proof、必要quality_scope/service/project_write_guard/event_business/requirements_assistance；tests含bounded_requirements及现真实业务测试迁移。

**Interfaces:** 产生spec全部typed路径；`complete requirement change proof`供router及所有写入口共享；原requirement.update body/key/basis不变。

- [x] 永久RED：27Task/81review成本、版本Session/Core forge/update/delete、当前/历史/preview新合同、scope/ACL/gen/cursor和记录位置。
- [x] 运行RED确认缺失行为；实现SQL head/definition/history/records/impact summary-page-exact，不装整Workspace后切片。
- [x] 运行RED预算/形状/所有历史/原hash差分，统一完整canonical preview与锁下三类入口前置校验；保no-op/回滚/幂等。
- [x] 新/相关Manager测试GREEN，按root pyproject110 Ruff，冻结owned生产+tests与合同示例；不擅跑全量或改其他agent文件。

### Task 2: Product detail and durable edit

**Files:** Web deliveryQuery/Collaboration/types，RequirementHistory/ChangeEditor/Workbench、必要TaskPlanEditor/DiscussionAdoption/导航消费者、独立RequirementRecords/Impact组件、三语/CSS及有意义交互测试。

**Interfaces:** 消费Task1唯一路径/字段；复用shared command controller/session/ACK，route requirement_edit=1提供独立恢复host。

- [x] 先永久RED：head移除原文后显式定义、保三records tab、metadata+页外版本与impact、404/503独立历史/unknown重载。
- [x] 实现四态UI与各独立分页/精确读取，保真实project/return/session/basis/generation守卫和safe target；无空criteria回退。
- [x] 实现完整preview审阅和持久原件编辑，竞争/退出/late callback锁定、明确拒绝后再准备；严格actual ACK。
- [x] 当前/历史各加载、空态、失败、无权、窄屏布局/键盘及三语的SSR/控制器回归GREEN、定向TSC、冻结owned源；不声称实际浏览器视觉。

### Task 3: Canonical SDK/CLI

**Files:** packages/sop-sdk-python/sop_sdk/client.py与对应tests；packages/sop-cli/sop_cli/commands/delivery.py与对应tests；仅实际需要的消费者。

**Interfaces:** requirement thin head；新增requirement_definition、records/record position、impact/items/item；history新metadata，preview {}合法，严格original inputs。

- [x] methods/CLI参数路径与generation/position0/Unicode64/limits输入先RED，不自动翻页/写入/更换proof。
- [x] 实现唯一路径，迁移help/数据消费者，保持local intent/sync原件wire，不造响应兼容层。
- [x] 定向GREEN/Ruff，输出method/command矩阵与冻结清单，等待root全量SDKCLI和wheel字节核验。

### Task 4: Publish, independently verify and deliver

**Files:** root持有OpenAPI、正式design/guide/plan、docs/DELIVERY_WORKBENCH.md、memory与本阶段证据/验证脚本。

- [x] 设计/计划固定、任务并行边界和当前状态外化。
- [x] Task1 schema定稿后实际OpenAPI定点发布，仅相关paths/models更新，退不可达旧DTO。
- [x] 各owner冻结后独立审查source/实际边界，永久RED复现→原probe GREEN；不扩大无关范围。
- [x] 稳定生产源完整Manager业务集检查及仅两leaf测试迁移增量复验（明确不宣称新单次全量通过）；完整Web/SDKCLI、TSC/Vite、Ruff、公开合同/wheel与真实HTTP+编译TS原请求重放/36表GET零写。
- [x] 更新已实现/未验证/后续差距；重要源与唯一证据保全、精确进程/清理核对；全部阶段本地commit并核字节与clean，不push。
