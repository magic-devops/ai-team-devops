# 有界交付待办与概览进度

阶段 `T-delivery-attention`，基于 `7bd27cd`。沿用已确认的紧凑协作工作台及 AntD/主题，不新增依赖，不要求保留旧的全量读取契约。

## 核实的问题

- 120 个需求、121 个任务的隔离 SQL 探针中，首页 inbox 为 231 字节仍载入完整 Workspace、121 Task、120 Requirement；首页 progress 为 98,628 字节并载入两次完整 Workspace。父组件去除 workspace 请求后，这两条专属轮询仍重复全项目计算。
- 独立人工任务已登记 completed，当前人工评审 `can_accept=true`，但本人和团队待办均不含该任务。旧待办仅覆盖原生运行待审，未随人工验收扩展。
- 人工评审、需求影响历史和质量等主动打开的专属详情仍有全项目计算；本阶段只处理默认概览与待办，不将这些详情宣称有界。

## 数据归属与读取

Project/Requirement/Task/Issue 仍是唯一业务实体；沿用 `DeliveryQueryState` 和 `DeliveryQueryFact`。派生 schema 升至 2，在同一业务事务、同一 evaluation 中替换 `kind=inbox` 的每对象单行事实。索引可以显式重建，不迁移或猜测旧历史。缺少当前 schema 时返回 `delivery_query_rebuild_required`，GET 不重建、不调用完整 workspace。

事实保存分类资格、真实负责人和关联需求负责人、日期、优先级、有限阻塞摘要和目标 ID。每个对象最多一条，多分类不重复总数；使用预分组及已有门禁，避免逐需求扫描全项目任务。查询依据当前已授权 user 与角色筛选，不把名册 Agent/工具当发言或登录身份。

`GET /api/v1/delivery/inbox` 参数：`scope=mine|team`、`category=all|work|approval|acceptance|blocked|overdue`、`limit=1..100`（默认 20）、`cursor`。SQL 先按本人/团队资格过滤，分类在 SQL 内筛选后分页；counts 为完整所选 scope 的分类、延期与唯一总数，total 为当前分类匹配数。响应沿用项目、版本、当前用户、时间、counts/items，增加 query_generation/category/total/limit/has_more/next_cursor。

游标签名绑定 tenant/project/user/scope/category/limit/当前审批资格/UTC 日期/generation。代次或日期变化后明确刷新首屏，不能静默续接；首尾代次核对避免混读。排序为延期优先、业务优先级、关注类型、日期、稳定 ID。阻塞原因最多返回 5 条，并附 blocked_reason_count。

## 人工验收闭环

没有执行管理记录、仅登记 completed 且没有当前有效验收的任务进入 acceptance，保留 `status=recorded_completed` 与 `acceptance_kind=manual`；原生有效运行待审为 `acceptance_kind=execution`。失效原生运行不能转成可人工验收。当前有效人工验收后从待验收移除；定义变更使验收失效后重新出现，阻塞与未完成条件仍由原详情解释并阻止验收。

本人范围包括真实有效负责人、相关需求负责人，以及具备当前审批资格的待审事项；团队范围展示团队事项，不授予任何审批权限。点击按当前精确任务读取再进入原详情，任务转属、删除及权限变化依旧核验。没有快速完成或批量通过。

## 首页轻量进度

新增 `GET /api/v1/delivery/progress/summary`，只支持项目范围和 starts_on/ends_on（UTC，最多 366 日）。返回 project_id/version/query_generation/as_of/timezone/range/current.metrics/coverage。当前指标来自相同 query generation；历史只投影观测日期和时间，计算 first/last/observed_days/missing_days/future_days，不读取历史事实正文或全项目实体。完整进度详情保持原有真实事实、基线比较与显式打开方式。

## 四个关键交互

1. 概览：context 提供当前代次；待办仅请求首条以取得完整 counts，进度使用 summary。随 context 代次和 UTC 日期刷新，避免重复独立轮询全量数据；错误可重试，旧数据不冒充新代次。
2. 待办：本人/团队、四类计数和延期按钮直接驱动服务端筛选。显示当前页及匹配总数，提供下一页与返回首屏，URL 保存 inbox_page/inbox_cursor，返回恢复；切 scope/category 清空页游标。
3. 人工交付：明确显示“待人工验收”与执行待审的区别，打开准确任务并沿用原评审。失效、依赖阻塞及权限不足保持真实状态。
4. 并发与失败：旧代次/午夜游标显示刷新首屏提示，读失败保留当前筛选并可重试；会话、项目切换隔离请求，加载、无事项和失败区分。卡片长文本换行，按钮可键盘操作，窄屏纵向排列。

## 验证与边界

先复现人工遗漏和全量读取，再验证筛选/计数/分页/租户与角色/游标/UTC/纯 GET；新增 summary 不加载任务、需求、Workspace 或历史 JSON。同步 SDK、CLI、OpenAPI；验证渲染交互、三语、类型及生产构建。保留独立审查和实际本地 HTTP 验证证据。

对象级讨论、单一结论与明确采纳、来源摘要，以及通用/跨存储活动仍是已核实后续缺口。Windows SDK 默认 pipe 与 agentd 项目派生地址不一致是独立待修 P2；两项广域客户端旧测试应按真实平台/owner_id 契约修正，不能据此恢复旧设计。

当前浏览器自动化此前被策略拒绝，本阶段不通过其他浏览器、原始协议或截图工具绕过；390px 中英日实际渲染继续标明未验证。没有外部模型、生产设施或厂商账户验证。完整目标继续 active。

临时文件仅 `.cache/delivery-attention/`；审计临时文件 `.cache/delivery-next-audit/`。最终证据 `.sop-runtime/delivery-evidence/delivery-attention/`，阶段完成核对与保存重要证据散列后仅清理这两个任务目录。全部已验证修改一起 commit，不推送。
