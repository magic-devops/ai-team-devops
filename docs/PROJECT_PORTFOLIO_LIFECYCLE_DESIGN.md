# 项目组合与生命周期

## 目标与规范状态

在已确认的紧凑工作台上完成可信项目组合、精确风险下钻、真正的归档/恢复和明确项目上下文。SQL Project 是唯一项目实体，status 是唯一当前状态；DeliveryWorkspace.version、DeliveryReceipt/Event 继续提供并发、幂等和历史。无新增 schema。直接状态 PATCH 和常规物理删除退出产品入口；元数据统一经现有 project.update。

| 操作 | planning / paused | active | archived |
| --- | --- | --- | --- |
| 项目、成员、需求、任务、计划、配置维护 | 允许，仍需权限 | 允许，仍需权限 | 拒绝 |
| 新 queue / 尚未交接的新 dispatch | 拒绝 | 允许，仍需运行权限 | 拒绝 |
| 已交接运行同步、人审、取消 | 允许 | 允许 | 拒绝 |
| 业务及历史读取 | 允许 | 允许 | 允许 |
| 明确恢复至指定状态 | 不适用 | 不适用 | 项目配置者允许 |

初态仅 planning/active/paused。状态变更统一 project.lifecycle，必须当前固定预览、理由、版本和请求身份。同状态拒绝；恢复明确选择目标，不隐式回到历史状态。归档不要求所有任务完成，但阻止全部非 CLOSED Manager 执行意图（包括丢失 Task 的意图），完整返回阻止项。Hermes receipt/run（含 planned）是交接边界；暂停后先恢复已持久化 receipt，既有运行继续收尾。归档不撤销独立 Hermes 权限或停止进程。

## 事务与写入边界

锁序固定 Project → DeliveryWorkspace → 业务修改/外部交接。所有 Manager ORM、typed Core、支持的 Session.execute 批次写使用同一项目锁，归档持锁重读事实；SQLite 用保留 updated_at 的无变化更新，PG 用行锁。项目/租户归属及实体主键创建后不可变。支持明确 scope literal/bind 或有限 PK；无法证明范围的任意 SQL、INSERT SELECT、动态 scope、Session raw mutation 明确拒绝。ManagerSession 禁止旧 bulk_*，不能假称 Session events 覆盖它们。直接 Engine/离线迁移和外部数据库篡改不属于应用守卫。

Manager Session 的读取也采用 typed select，不执行原始文本语句，避免包装读取中的可写 SQL。当前边界明确拒绝 conflict/upsert 及 INSERT SELECT，不为旧调用增加旁路；有明确范围的普通字段表达式仍可用，验收条件和成员身份继续由各自领域校验。有限 PK 围栏采用固定标量谓词，支持合法 Core executemany 批次。

archived 限制业务修改；全局身份停用/删除仍可永久作废相关证明。可信身份 capture 只能在精确项目下单向失效既有 Review/flow/execution/产物并追加观察，不得修改 Task 内容/owner/status、成员或任意 workspace JSON。User 真正删除的成员级联独立验证。生命周期事务只记录生命周期事实，不误触发普通跨日进度 capture；身份变化仍捕获。每日检查点在锁内复核 active。Project 物理删除及吞掉项目的父级级联拒绝。

文件/向量写入还须统一 HTTP 项目写权限门禁；已发现的 GET 初始化写改纯读取投影。审计仍按真实请求记录，不为零写测试关闭审计。归档来源只记录于 data.lifecycle.last_archive（id/at/actor_id/actor_name/reason/preview_basis/facts），不复制当前 status；每次完整归档结果进入 DeliveryEvent.data.result。恢复保留原来源。未采集的旧来源返回 null，不补造。

## 接口与事实

- POST `/api/v1/delivery/project-lifecycle-preview`：`{target_status, reason}`，纯读；响应 project_id/version/from_status/target_status/reason/preview_basis/allowed/blockers/warnings/facts/permissions。facts 为 as_of/basis/metrics（既有 ProgressMetrics）/risk_counts/unclosed_intents_total。blockers 全量，不截断。
- 原 commands 新增 `project.lifecycle`：payload 为 target_status/reason/preview_basis；外层 expected_version/idempotency_key 不变。校验当前权限后可返回合法旧 receipt；archived 新写仅恢复。preview_basis 摘要规范 Project 配置、完整成员、语义交付事实和全部意图，排除瞬时时钟和外层 CAS version；涉及逾期以固定 UTC 日参与依据。提交持锁重新计算。
- 扩现有 `project.update` 的可选配置字段 business_id/project_path/vector_db/vector_db_config/is_template；同租户引用验证，配置字段须 configure。原 goal/owner/date 规则保留。废除普通项目 PATCH/DELETE，调用方改为固定版本命令。
- GET `/api/v1/projects/portfolio`：q/business_id/status（可重复）/risk（可重复）/cursor/limit 1..100。权限→基础筛选→完整范围实时事实→风险筛选→准确统计→稳定 Project.id 分页。响应 as_of/rows/total/next_cursor/limit/summary/summary_scope='filtered_projects'。
- GET `/api/v1/projects/{project_id}/portfolio`：同一项目行、完整风险对象及精确 target、lifecycle 来源；未知/无权明确返回，不回退其他项目。

每行 project 为规范项目定位字段与 version、permissions（can_enter/can_write/can_dispatch/can_configure/can_transition/can_archive/can_restore），facts_source='live'，facts_as_of/basis/metrics/risk_counts/unclosed_intents_total/nearest_milestone。当前有效事实始终实时计算，包括 archived；归档时点 facts 仅在 provenance 内明确显示历史，不能冒充当前有效验收。

风险固定 blocked/awaiting_review/recorded_completed/overdue_unverified/acceptance_unavailable/owner_unavailable/open_issues。来源为现 capture_facts/VerificationContext/规范 Issue；没有日期不推断逾期，登记完成不当已验证。明细按实体去重并携带 categories；分类数可以重叠，total_items 为唯一实体数，不能相加冒充总量。每项 target 为 project_id + 既有 DeliveryInboxTarget；近里程碑来自真实起止日期和范围。未知或读取失败不显示为 0，不做推测健康分。

## 四界面与状态

| 界面 | 正常/空态 | 失败、受限和恢复 |
| --- | --- | --- |
| 项目组合 | 规范 portfolio 路由，搜索/业务线/状态/风险/选中项目入 URL；紧凑列表与390px卡片；查看不切全局 scope | 无项目与筛选无结果分开；刷新失败保留事实并标注；统计标明完整范围，分页不截断总数 |
| 项目详情/风险 | 稳定ID抽屉；项目→当前事实→精确风险→配置→生命周期；显式进入工作台 | 未知ID不回退；草稿不被后台刷新覆盖；archived服务端权限控制只读；跨项目/会话隔离 |
| 生命周期预览 | 目标状态/理由/影响/全部阻止项；固定依据；成功才关闭 | 保存失败保留；409明确重读和确认；网络结果未知用原key重试；恢复不能授予执行权限 |
| 进入/返回 | 完整tenant/business/project scope；风险精确目标；返回恢复组合筛选 | 无效当前ID保留失效态；业务线变化后待选项目；直接深链scope不符先明确进入，不拿旧项目查新实体；切项目清除旧详情参数 |

ProjectSelector 明示当前 archived只读，默认新工作列表排除归档并提供查看入口。创建成功只选中详情，不自动进入；保留已有 await 成功关弹窗实现。组合返回单独规范化白名单，不扩宽现执行 return_to。全部新文案三语、长ID换行、键盘/焦点/退场身份、390px不溢出，沿用主题和组件。

## 验收

TDD覆盖多通道归档阻写、整批原子拒绝、不可证明SQL拒绝、新项目+成员同事务、归档/queue竞争、暂停收尾/receipt恢复、身份停用恢复不复活、预览CAS/幂等/纯读、超过12条风险准确分页、查看不切scope、未知项目不首选、跨项目深链门禁和显式返回。原完整目标继续；新增变更经实际HTTP/浏览器、相关及完整测试、类型构建、一次增量审查后全部commit，不push。SQLite实测和PG编译/并发验证分开报告，不外推。
