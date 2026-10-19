# 人工任务验收与交付依赖消费

上一阶段 `68912bc` 已完成并提交。完整主目标继续 active，团队日历/容量/依赖时间线和项目组合继续保留。只读检查发现应先补齐的事实口径：`dependency_status` 的注释声称 verified，但没有执行记录的 raw completed 会解锁后续；进度却将其判为 recorded_completed。没有人工任务逐项验收入口，使纯人工任务无法获得同等可核对的交付证据。

本阶段补齐真实人工任务验收、永久失效、已验证依赖与旧调度入口对交付依赖的消费。沿用已批准主计划、紧凑工作台、现有权限和技术栈；brainstorming 的本地适配允许沿用已有明确授权，不重复设计审批。12ui 第三方上传此前被自动审核拒绝，本阶段不重试上传，使用本地参考与实际界面核验。应用 feature-development/TDD/WorkBuddy/12ui 指导；验证后全部 commit。

## 人工验收

- 独立 SQL DeliveryTaskReview 保存稳定 id、内部 seq、tenant/project/task、创建时间、真实审核人、decision、task_basis、原始最小快照、审核意见及人工登记的证据正文/HTTP(S)链接。证据标明人工登记，不声称 CI 签名或实际运行测试。验收不调用模型、不启动执行。
- Command `task.manual_review` 使用 approve、原 workspace CAS/receipt/SQL事务。payload 包括 task_id、decision=accept|request_changes、basis、comment、evidence_content、evidence_url。意见必需；accept 至少一项证据。客户端固定打开时 basis/version/重试身份。旧 API 修改但 version 不变，仍须 basis 409，失败保留草稿并明确采用最新内容。
- 人工验收针对没有执行记录、当前可唯一归属活跃人类成员的任务；已关联执行的任务继续走已有 execution.review，不能通过人工入口绕过运行模块权限、失败或待审查证据。工具不能成为人工交付负责人。新决定权限重新检查；历史审核人后来失活不抹除其当时合法记录。
- accept 要求任务已登记 completed、前置任务满足有效验收、没有显式阻塞；只登记完成仍是 recorded_completed。request_changes 保留结论并将任务退回进行中，旧通过不再生效。原决定及证据不可覆盖，新的审查追加一条。
- basis 绑定 canonical 任务内容、当前需求定义/修订/验收条件、真实归属、规划验收关联与依赖；纯日期改期不作废交付结果。依赖定义/前置内容或状态变化须使旧决定不能冒充新验收。无需求的独立任务也可审查；缺失数据不伪造需求。
- 通用 SQL 事务采集链在观测前将已通过但依据变化的人工决定标记永久失效；覆盖 ORM、Core、旧兼容表及同步入口，回滚与业务原子。A→B→A 不恢复旧通过；删除/跨项目迁移保留原项目只读历史，不跨项目追认。

## 进度与依赖

同一个有效人工验收事实被进度六态、交付依赖及相关任务视图消费；新增通过后计为 verified_completed，退回或失效后不再计为已验证。保留 recorded_completed，不把运行成功或旧完成记录偷偷升级。

提取可复用且无循环调用的验收依据判定。`capture_facts → materialize → dependency_status` 不能反向调用 capture_facts。依赖按实际任务图检查链路与环；原生运行验收和当前有效需求验收继续有效。旧测试中“直接 raw completed 解锁”是此次明确修正的旧行为，应替换成先展示阻塞、显式人工验收后解锁的真实测试。

按用户最新要求不增加历史兼容层：dispatch/scheduler/agent-feed 和依赖操作直接使用 DeliveryWorkspace 中唯一的任务依赖图与有效验收，不再合并旧文件关系，也不维护双向桥。读取 SQL 必须使用真实 tenant/project，不回退环境默认项目、不创建数据。旧关系入口若继续可操作，必须直接落入统一图，采用相同权限、版本及最终图校验；不再保留旧数据格式适配。实际开始/完成写操作执行同一服务端依赖门禁，include_blocked 只允许展示、不能授权执行。

## 读取契约与界面

人工验收读取按 `docs/DELIVERY_BOUNDED_REVIEW_DESIGN.md` 分为三个契约，均需当前身份及显式 X-Project-Id。`GET /api/v1/delivery/tasks/{task_id}/review-current` 返回固定版本/查询代次、当前完整依据和有效人工决定 ID；必要闭包超限明确失败。`GET /tasks/{task_id}/reviews` 只返回固定窗口的历史小摘要，默认20/最大100条，不含当前证明、原快照及证据正文。`GET /tasks/{task_id}/reviews/{review_id}` 精确读取指定原件。Task 已删除、当前证明太大或索引失效时历史仍独立可读；跨项目或错任务原件404。历史接受不是当前有效通过，不能推导 valid。

任务详情内的“人工验收”区独立展示当前依据和历史目录，各自加载、刷新及报错；展开原件才读取完整快照及证据。没有执行记录的人工任务可打开审核，原生执行仍使用原入口。表单固定 basis/version，展示验收条件与当前任务内容；请求结果未知时锁定原正文、版本、键及会话，刷新后恢复且只能重放原请求。明确拒绝后保留意见/证据，读取最新事实并显式采用，不自动升级基准。失效、退回、历史接受与当前有效分开呈现。无权限、未完成、依赖未交付、无活跃人类归属和已删除分别说明。三语、主题、键盘与390px均需实际核验；组件与构建通过不代表实机视觉已验证。

## 验证和收尾

先真实 SQL/API 红测：只登记完成不解锁→人工通过解锁；真实身份/权限/原生执行拒绝、依据冲突/幂等、退回/重审、内容A→B→A永久失效、日期保持、依赖链、旧写入口与迁移、删除历史、只读零写、跨租户隔离。scheduler/dispatch/feed 真实消费唯一交付依赖，不自动执行；验证旧文件不会重新覆盖当前图。前端真实表单/错误/历史/独立任务行为、实际HTTP+桌面/窄屏，再回归和构建。

最多一次独立本增量审查，定点修复不重复泛扫。临时目录 `.cache/manual-task-review/`，最终证据 `.sop-runtime/delivery-evidence/manual-task-review/`；清理前清点散列并保留唯一证据。验证后全部提交当前分支，不推送。

## 最新设计约束

用户明确无需历史兼容或保留不必要的旧设计，按最佳合理目标实现。必要的验收快照、证据、撤销/失效与审计属于交付有效性，不是旧版本兼容；继续保留。后续契约允许有目的重构，删除重复状态与存储，文档按最终实现更新。

SDK `delivery_task_reviews(task_id, limit=20, cursor="")` 和 CLI `sop delivery reviews TASK_ID --limit 20 --json` 只读历史小摘要。`next_cursor` 原样传回，绑定账号/租户/项目/任务/页大小及固定序号窗口；新决定不会混入旧窗口。当前依据用 SDK `delivery_task_review_current(task_id)` / CLI `sop delivery review-current TASK_ID --json`；原件用 SDK `delivery_task_review(task_id, review_id)` / CLI `sop delivery review TASK_ID REVIEW_ID --json`。写入仍提交固定 `task.manual_review` Command，保留原始 expected_version/basis/idempotency_key 重试；明确采用最新依据后使用新请求身份。

统一任务计划编辑覆盖有关联需求和独立任务：materialize返回任务basis，task.update关联编辑固定task_basis；移除该payload旧requirement_basis/revision双重基准。基准包含关联需求定义，因此需求变化也被核验；无需求任务验收索引只能为空，前置依赖仍可维护。模板预览及新建计划保留各自需求依据。旧依赖POST/DELETE及Web重复写表单移除，保留只读图和到统一计划编辑的精确入口。
