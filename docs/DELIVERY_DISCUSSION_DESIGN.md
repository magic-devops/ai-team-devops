# 对象讨论与来源桥接设计

实施基线：603226d。原只读审计基线590ca69，业务与界面相关源码在603226d未改变。目标是让真实项目成员在现有需求、任务、问题详情中讨论、回复和形成结论，明确选择后把结论作为现有业务变更的来源。继续沿用唯一 Project / Requirement / Task / Issue、既有拆解、派发、测试和人工验收。UI 沿用紧凑 AntD、现有抽屉、主题和中英日文案。本轮按此设计实施；实际完成状态与证据单列，不将设计当作实现证明。

## 1. 已有实现与不能直接复用的写入入口

| 事实 | 当前源码证据（仓库内相对路径） | 设计影响 |
| --- | --- | --- |
| 正文、验收、任务、版本、活动已在需求详情集中 | apps/manager-web/subapps/ai-rd-center/src/pages/delivery/DeliveryWorkbench.tsx，details/tasks/history/activity 标签 | 新增讨论与来源摘要，不再造需求详情工作台 |
| Task 有正式文本条件与稳定 owner_id；human_notes 是单值字段 | apps/manager/sop_manager/routers/sql_models.py:180-198 | 不把 human_notes 伪装成可回复、可追溯讨论 |
| 交付命令预留 Workspace CAS 后无条件 reconcile，随后 remember_basis，更新 Workspace 并追加 DeliveryEvent | apps/manager/sop_manager/routers/delivery.py:1083-1154 | 不能把 comment.create / edit / resolve 直接塞入当前 commands |
| DeliveryWorkspace、DeliveryEvent 都是进度观察的 watched model | apps/manager/sop_manager/routers/delivery_progress_hooks.py:16-28、141-154 | 单独追加 DeliveryEvent 同样会触发全项目观察 |
| before_commit 对被标记项目调用 record_observation | apps/manager/sop_manager/routers/delivery_progress_hooks.py:309-370 | 不能靠“没修改 Task”宣称纯讨论写入有界 |
| record_observation 创建 VerificationContext、reconcile 并刷新派生事实 | apps/manager/sop_manager/routers/delivery_progress_capture.py:50-76；delivery_verification.py:27-54 | 纯讨论要完全离开该观察路径；不增加业务 query_generation |
| 当前 Receipt 只存项目版本，重放按相同 DeliveryEvent.version 找唯一 Ack | apps/manager/sop_manager/routers/sql_models.py:275-281；delivery_query_commands.py:105-122 | 不把 thread version 混入 DeliveryEvent.version，不重用现有 Receipt 表装讨论 Ack |
| 带 project_id 的新支持表自动受到项目生命周期写保护 | apps/manager/sop_manager/project_write_guard.py:410-436、519-545、570-591 | 可复用真实 Project 锁与归档约束，不需更新 Project 字段或全库扫描 |
| Project 锁按稳定顺序，无需改变 updated_at | apps/manager/sop_manager/project_write_guard.py:67-116 | 讨论也先锁 Project，随后锁 Thread；仍要重新核验当前 User 和成员权限 |
| 业务 Task basis 由明确语义快照生成 | apps/manager/sop_manager/routers/delivery_task_contract.py:10-39、118-138；delivery_verification.py:212-215 | 讨论版本、结论和来源链接不进入业务语义 basis |
| 真实内容变化、状态变化等已有永久失效保护 | apps/manager/sop_manager/routers/delivery_service.py:467-527 | 真正采用到内容时沿用保护，不能因“来自讨论”绕过 |
| Hermes 讨论按执行 workspace 频道组织，认证 actor 仍为真实 User | packages/hermes-core/hermes_core/collaboration.py:58-80；apps/manager/sop_manager/routers/hermes_workspace.py:20-34、58-66 | 不把执行 workspace 的聊天直接当作 Manager 对象讨论 |
| Issue 诊断已保存真实来源、固定证据和人工采纳 | apps/manager/sop_manager/routers/delivery_issue_diagnosis.py:425-462；delivery_service.py:531-558 | 复用其唯一需求回流，不建立另一条 Issue 或 AI 工作流 |

三种实现选择：

1. **推荐：Manager 独立讨论支持表与有界模块。** 讨论自己的版本、Receipt、Journal；实际业务采纳才接现有命令事务。数据和权限同库，能原子保存来源，不扰动验收。
2. 扩展 Hermes 频道 subject 字段：表面复用多，但 workspace ACL 与 Manager project ACL 不等价，跨存储采纳无法获得现有 SQL 原子性，且无真实 Agent 认证发言契约。暂不选。
3. 放入 Workspace JSON/DeliveryEvent：代码最短，但每条回复都进入全项目观察与业务 CAS，并污染现有事件版本/Receipt 唯一性。拒绝此路径。

## 2. 最小支持数据模型

仅新增六类支持表，不复制业务对象；所有表含 tenant_id / project_id。Project 外键沿用当前规范；subject 为多态稳定引用，不对 Requirement / Task / Issue 级联删除，避免对象删除顺便销毁讨论证据。

| 支持表 | 必要字段与约束 |
| --- | --- |
| delivery_discussion_threads | id；subject_kind=requirement/task/issue；subject_id；created_seq；version；state=open/resolved/archived；title；created_by_id/name；created_at；current_resolution_event_id 可空；last_activity_at。subject 与创建人不可改，version 单调递增 |
| delivery_discussion_messages | id；thread_id；parent_message_id 可空；author_id/name；created_seq/created_at；current_revision。父消息必须属于同 thread；作者不可改；首版所有消息作者都来自认证 User |
| delivery_discussion_message_versions | message_id + revision 唯一；body；editor_id/name；created_at；state=active/withdrawn；固定 source_quotes/refs。追加保存，不覆盖旧正文；撤回形成占位版本，不删除其回复 |
| delivery_discussion_events | seq 单调序号；id；thread_id；thread_version；subject_kind/id；action；actor_id/name；created_at；safe_data。每次 thread 变更一个版本、一个事件；resolve 记录 message_id + message_revision，保留旧决策 |
| delivery_discussion_receipts | id=hash(tenant,project,user,"discussion",key)；request_hash；event_id；original_ack；created_at。原 Ack 含原 thread/message/version 等精确标识，不存整包业务 Workspace；同 key 异输入 409 |
| delivery_source_links | id；source_kind（discussion_resolution 等）；source_id；固定 source_snapshot/digest；原 runtime_scopes；target_kind/id；business_event_id 可空；applied_by_id/name；created_at；relation=reference/adopted。保留原决定、原消息版本、原采用字段及真实结果对象 |

索引至少包含：Thread(tenant,project,subject_kind,subject_id,state,created_seq,id)；Message(tenant,project,thread_id,created_seq,id)；Version(message_id,revision) 唯一；Event(tenant,project,subject_kind,subject_id,seq)、Event(thread_id,thread_version) 唯一；SourceLink(tenant,project,target_kind,target_id,created_at,id)。

Version、Event、Receipt、SourceLink 是追加事实，禁止普通 ORM/Core 更新或删除；在项目写保护的最小分支中明确约束，不能靠 UI 隐藏按钮代替。Thread/Message 仅由讨论模块更新指针/状态。不要把这六种表加入 progress_hooks._models。

## 3. 独立版本、分页与事务规则

### 纯讨论写入

1. 使用现有 current_user、X-Project-Id 和项目访问检查。先查同作用域原 Receipt，随后按 Project → Thread 顺序取得锁，再读取当前活跃 User 和权限；重复请求在锁后再次检查。
2. 新建/回复是追加操作；回复验证精确 parent，但不要求整个业务项目版本保持不变。并发独立回复可以顺序成功，不因另一个人的新回复丢弃草稿。
3. 编辑必须提交 expected_message_revision；结论、重开、归档必须提交 expected_thread_version。服务端仍以条件 UPDATE 递增 thread.version，保证结论选择与消息编辑并发一致。
4. 编辑所选结论或撤回所选结论时，同事务清除当前结论并重开；新回复在同事务重开已解决讨论。编辑其他回复保留当前结论，但 thread.version 变化，任何旧采纳预览必须重新核对。
5. 追加版本/事件/Receipt 与指针变更同事务提交。异常或保存点回滚不能遗留版本、游标水位或成功 Receipt；未知结果只重放原 key。
6. 不写 canonical Task/Requirement/Issue、DeliveryWorkspace、DeliveryEvent、DeliveryReceipt；不调用 reconcile、VerificationContext、record_observation、remember_basis 或 replace_from_evaluation。正常 HTTP 请求审计继续保留。

### 列表与读取

- Thread 默认 20 项，按 created_seq/id 稳定排序；Message 默认 20 项，按 created_seq/id 顺序阅读。请求只读取当前窗口与有限关联，不下载整个讨论树、项目 Workspace 或历史版本正文。
- scope stamp 由相同 subject 范围内 max(DiscussionEvent.seq) 获取；项目讨论列表用同项目讨论事件水位。无需另加“项目讨论状态”实体。
- 签名 cursor 绑定 tenant/project/user/subject/filter/sort/limit/stamp/位置。新回复、编辑或状态变化使旧可变分页 409 discussion_cursor_stale；scope 变化 422。刷新首屏是显式动作，原输入保留。
- 列表在 count/page 前后核对同一 scope stamp，不组合并发前后不同事实。消息当前版本分页绑定 thread.version；不可变的消息编辑历史分页固定 upper_revision，后来的编辑不插入旧页，显式刷新才读取新版本。
- GET thread/message/version/source 精确查询只读；不存在讨论时返回空列表，不初始化表行。派生业务索引缺失不触发讨论回退全量计算。
- 对象删除后历史讨论可按其原项目权限读取，subject 明确 missing，新增/编辑/解决禁用；不回退首个需求或新造同名业务对象。
- Task 的 thread 始终绑定 Task ID。Task 转属不会移动 thread 或改写旧 event 当时关联；需求讨论首版只显示其自身 thread，任务讨论通过当前精确任务导航进入，避免把当前归属伪装为全部历史归属。

## 4. API 契约（现有认证与错误结构）

| 操作 | 输入/并发 | 成功输出与权限 |
| --- | --- | --- |
| GET /delivery/discussions | subject_kind + subject_id，或显式 project 范围；state=all/open/resolved/archived；limit≤50 默认20；cursor | project_id、discussion_stamp、as_of、scope、items、total、next_cursor；项目 read |
| GET /delivery/discussions/{id} | 精确 ID | subject current/missing、thread.version/state、当前固定结论、安全权限/能力、sources 摘要；项目 read |
| GET /delivery/discussions/{id}/messages | limit 默认20 + cursor | 当前消息窗口，每项含 author 与 current revision，编辑历史不全量展开 |
| GET /delivery/discussions/{id}/messages/{message_id}/versions | limit + cursor；另支持精确 revision | 追加正文/撤回历史与真实 editor；不能跨 thread 读取 |
| POST /delivery/discussions | subject、title≤160、body≤8000、有限 refs/quote、idempotency_key | 创建 thread + 首消息原子 Ack；项目 write |
| POST /delivery/discussions/{id}/messages | body、parent_message_id 可空、refs/quote、idempotency_key | 原 message id/revision/thread_version/event_id/replayed；项目 write |
| PATCH /delivery/discussions/{id}/messages/{message_id} | expected_message_revision、body、idempotency_key | 仅原作者可编辑，保存真实 editor；管理员只可撤回，不能改写别人的正文 |
| POST /delivery/discussions/{id}/messages/{message_id}/withdraw | expected_message_revision、reason、idempotency_key | 原作者可撤回自己的消息，项目 configure 成员可撤回任意消息；生成占位版本，回复和原历史保留 |
| POST /delivery/discussions/{id}/resolve | expected_thread_version、message_id、message_revision、note、idempotency_key | 单一结论事件；项目 write；不等于业务 approve |
| POST /delivery/discussions/{id}/reopen 或 archive | expected_thread_version、reason、idempotency_key | 记录真实动作；归档不删除历史 |
| POST /delivery/discussions/{id}/links | expected_thread_version、固定 conclusion id、target kind/id/content_basis、idempotency_key | 仅引用已有业务对象，不改其定义或有效验收；项目 write |
| GET /delivery/sources | target_kind/id、limit、cursor | 安全来源摘要：新 SourceLink + 已有真实 source_issue/source_diagnosis/plan 来源的只读适配；不补造历史或写入迁移 |

所有输入禁止 extra 字段。请求中无 author_id/name/kind、editor_id、system 标志；空白正文 422，非法父引用或跨作用域引用 422/404，未授权 403，目标缺失 404；编辑/结论/游标冲突 409。归档项目纯读可用，新写 409。幂等重放先核验当前账户/项目读取能力，返回原 Ack；不得根据目前最新消息猜测原结果。

首版权限固定为：只有原作者可编辑正文；原作者或项目 configure 成员可撤回；Thread 创建者或 configure 成员可归档；具有项目 write 的成员可回复、解决、重开。讨论解决只表示协作结论，不需要也不授予业务 approve 权限。不存在管理员改写后继续冒充原作者的正文编辑入口。

## 5. 结论采纳与来源桥接

### 两种动作必须区分

- **关联已有对象**：POST links，只写 SourceLink/讨论事实。即使对象已人工验收，通过来源关联也不能重算/失效它。
- **真正采用为业务修改**：已有 Command 增加可选根字段 source_reference={thread_id,expected_thread_version,resolution_event_id,message_id,message_revision}，仅对白名单 action 开放：requirement.update、task.update、tasks.plan、issue.promote、issue.diagnosis.adopt。缺省 null 不造来源。

真正采用继续用原 expected_version、business basis、preview basis 和 idempotency_key。Project 锁内先核验当前 resolved 结论、精确消息版本、原来源权限；调用现有业务动作后，在同一事务按真实返回资源（包含 tasks.plan 多个 Task IDs）保存 SourceLink 与原 DeliveryEvent 关联。任何来源冲突或目标创建失败都整事务回滚。响应仍是原业务 Ack，不另造任务。

来源验证返回可信的原 runtime workspace scopes，并入当前 command_ack_access（delivery_query_commands.py:89-121），让幂等重放继续检查原来源权限；SourceLink/quote每次读取也用保存的原 scopes 复核。不可只核验采纳当时一次后，把固定运行正文复制成所有项目成员永久可见的普通来源。

source_reference 不能随 canonical model 的 model_dump 写入 Task/Requirement，也不放进 task_details、flow.definition、accepted_work 或 Task semantic_snapshot。它只进入受控事件来源与 SourceLink。纯来源改变不触发任务 evidence invalidation；真正改了描述、验收、依赖、负责人等，仍使用现有永久失效和重开规则，不因讨论来源绕过。

编辑后的讨论不会追溯修改已经采用的需求或任务。来源区展示“采用时的结论”和“来源后来有新版本/已重开”两个事实；业务完成口径只看当前真实业务定义和已有证据。

旧来源摘要读取用 delivery_query_read.workspace_path（71-73）的精确 JSON path：只取选中需求的 flow.source_issue_id/source_diagnosis、选中任务的 task_details 来源，再精确读取对应 Issue/Diagnosis/Preview。不要读取完整 flow 集合、调用 materialize 或从描述/同名对象推断来源；没有记录的旧来源显示未知。新 SourceLink 与旧字段只读合并展示，不做双写回填或 GET 迁移。

前端 prepareDeliveryIntent/saveDelivery/submitRequirementChange 必须把 source_reference 一同固定并纳入请求指纹；用户换来源或改稿后新 key，超时重试保留原 key。不能只给 HTTP 体新增来源，而让 helper 的 signature 忽略它。

同 key 重放绝不重复建任务；不同 key 属于新的明确用户请求，预览展示已有采用记录并引导打开原对象，不偷偷重用或覆盖旧计划。Issue 仍沿现有 source_issue_id 唯一去重，讨论不改变此唯一性。

## 6. 真实身份和引用

- author 永远来自当前认证 User；锁后复核 status、tenant/project membership。创建时名称作当时显示快照，稳定 ID 作归属；作者改名/退出不能改写原作者。
- 登记 Agent/tool 是责任资源，不是认证发言人。首版不接受“代表 Agent 发布”，不开放客户端 system/agent 消息类型。
- 人引用真实运行时，显示“某真实用户引用了执行证据”，另列真实 run/attempt/executor 来源。不能把用户粘贴的内容升级为 Agent 输出。
- 执行引用复用精确运行权限和安全投影；每次读/采纳重新检查当前原 runtime workspace 访问。受限引用仅显示安全 unavailable，不能泄露旧日志正文、命令或凭据。
- 不复用 issue_snapshot 的整套诊断读取来解析普通讨论引用：其 delivery_issue_evidence.py:504 创建全项目 VerificationContext。抽取/调用单对象访问函数或精确 execution 适配器。
- 正文/验收引用由服务端按真实 canonical 字段及 source_content_basis 解析并冻结；重复验收文本保留固定版本的 index+text，不按当前 index 重解释。客户端只提交选择范围/目标，不提交可信作者或伪造历史正文。
- source_content_basis 是该引用内容的局部摘要；Task 自身文字只需精确 Task 行，不能调用全项目 VerificationContext.basis 来得到“更强”的摘要。它不冒称业务验收 basis。
- 不新增自动 @Agent 派发、自动外部消息、订阅工作流、AI 总结或通知流水线；使用现有派发操作才启动执行。

## 7. 四条关键 flow

### Flow 1：需求澄清到固定变更

需求详情正文/验收 → 新讨论（可选择已有真实字段引用）→ 回复 → 选择某一消息版本为结论 → “采用到需求”选择正文或验收条目，预填现有编辑器 → 人工改稿 → 现有影响预览 → 明确保存。来源/业务任一依据变化均保留草稿并要求明确核对；保存后需求来源区可返回原消息/原结论。讨论本身不改变需求 revision。

### Flow 2：任务协作到现有计划和验收

精确任务详情 → 任务讨论，引用自身条件或真实执行指针 → 人工结论 → “调整任务”复用 TaskPlanMaintenance，或“形成任务草稿”复用可编辑 TaskPlanEditor → 明确保存当前选中内容。Task 转属时导航先精确读取当前 req_id；实际内容变化按原规则使证据失效。对已验收任务只补来源/讨论时仍保持有效；“已解决讨论”不能调用 manual_review、execution.review 或标记 completed。

### Flow 3：问题与诊断到唯一来源需求

精确 Issue/既有诊断 → 问题讨论与事实引用 → 选择结论 → 打开已有“转需求”或“诊断人工采纳”预览 → 保存原唯一 source_issue_id 需求并原子附加讨论来源 → 沿原拆解/派发/测试/人审链路。Issue 不自动关闭，任务不自动完成，诊断结果仍保留自己的真实生成与审核来源。新需求来源摘要同时可打开原问题、诊断和讨论。

### Flow 4：项目跟进与精确返回

项目显式“讨论”入口 → 仅查询项目 open/resolved 等讨论窗口 → 精确 thread/message URL → 查看当前对象与固定引用/采用记录 → 跳转前重新核验当前对象 → 安全返回原筛选、分页和消息。无需把讨论计数塞进每5秒 context 或新增全量收件箱计算。可在面板可见时做有界刷新/显式刷新；切项目、会话、筛选、离开再返回必须用独立 epoch 丢弃旧结果。草稿按真实 tenant/project/user/subject/thread/message 隔离，刷新可恢复；发送成功仅清除本次提交版本，期间新输入保留。

URL 建议新增 detail=discussion、discussion_thread、discussion_message、discussion_cursor/page，沿用 project_id 与经过验证的 collaboration_return。深链缺失/403留当前面板错误，不转第一项。390px 单列，消息头换行，按钮可键盘操作，引用/历史按需展开；旧编辑/执行退出保护继续保留。

## 8. 最小完整垂直增量与明确文件所有权

交付范围：三种现有 subject 共用一个讨论模块；创建/回复/编辑历史/撤回占位/单一结论/重开；固定引用；来源摘要；对既有业务动作的原子来源桥接；四条 flow 的真实回调与 SQL/API 证明。首版正文用现有安全文本显示，不新增富文本编辑器、附件、反应、自动 Agent 回答或通知系统。

| 所有者 | 独占文件/任务 | 共享集成限制 |
| --- | --- | --- |
| root/integrator | delivery.py 原命令事务来源桥接；delivery_contract.py 根 source_reference；SDK/CLI/OpenAPI；设计/记忆与实际HTTP验证 | 这些共享文件由一人修改，先定 DTO 和调用 seam；不改 progress hooks watched 集合 |
| 后端讨论 owner | sql_models.py 六支持表、project_write_guard.py追加保护与路由挂载；新 delivery_discussions.py（router）、delivery_discussion_contract.py、delivery_discussion.py（有界事务/读取/安全来源内部函数）及 tests/test_delivery_discussions*.py | 对外隐藏锁顺序、receipt、引用授权、版本；只接统一接口，不在 UI/SDK重复这些规则 |
| 前端 owner | 新 DeliveryDiscussionPanel.tsx、DeliveryDiscussionThread.tsx、DeliverySourceSummary.tsx；lib/deliveryDiscussions.ts；独立三语/CSS/测试；在既有 Workbench/TaskDetail/IssueDetail 插入共享组件，编辑器接source_reference | 现有业务编辑器只加来源输入/固定预览，不能重写其冲突与退出逻辑；无全量workspace读取 |
| clients/contract owner | SDK/CLI 精确讨论读写与 source_reference；OpenAPI 新 schema/path；契约测试 | 保留当前project/session范围与file输入重试；不知道作者时不造author字段 |
| 独立 reviewer | 只读增量审查：权限、CAS/idempotency、引用来源、验收不变、查询边界及UI竞态 | 不同时修改上述共享文件；每个可复现缺陷保留原RED→GREEN |

实施顺序：先冻结 DTO 与6表的事务不变量 → SQL/API完成 requirement 单链（创建、回复、编辑、结论、requirement.update 原子来源）→ 相同适配器接 Task/Issue 与3个既有编辑器 → clients/OpenAPI → 四flow定向与唯一独立审查 → 相关全量、类型/构建及已授权隔离HTTP。讨论本身完成不得标记完整生产集成完成。

## 9. 可执行验收清单

### 数据/事务与规模

- 使用现有生产一致 autoflush=False fixture，完成创建首消息、并发回复、编辑冲突、单一结论、编辑结论重开、撤回占位、原key重放；不同正文复用key必须409。
- 事务/嵌套保存点回滚后，Thread.version、Message.current_revision、Version/Event/Receipt/SourceLink 计数均无幽灵事实。
- 给新模块禁止调用 VerificationContext、reconcile、record_observation、replace_from_evaluation、remember_basis 的 fail-fast spy；纯讨论CRUD及来源关联仍全部成功。
- 10k Requirement/10k Task、20k Discussion fixture：20项读取与单消息写仅有界SQL；不解码完整Workspace、不载canonical全表、不载整讨论树；全量count只做SQL。记录SQL数、ORM行、JSON/响应字节与source hash，标明非生产尾延迟。
- 讨论创建/回复/编辑/解决/引用关联前后：canonical业务表、DeliveryWorkspace、DeliveryEvent、业务Receipt、DeliveryQueryState/Fact、ProgressObservation、TaskReview、运行/检查点表散列不变；正常请求audit可增加。新增讨论支持表按预期变化。
- 当前有效人工与原生验收任务在上述纯讨论动作后仍verified；来源后来编辑/重开也不使已经采用但未改业务文本的任务失效。

### 授权、身份、历史与来源

- 伪造author_id、agent/system类型、editor、跨租户project/subject/thread/parent/version/source输入均拒绝；名称相同不能取得另一身份。
- Project锁等待期间撤销成员/禁用账户后，新写403且无业务/讨论成功记录；归档写409、历史可读、恢复可重新写。
- task转属、subject删除、source缺失、runtime无权均不改写历史关联或回退其它对象。运行引用在读取、采纳和原Receipt重放均核验当前原权限。
- 精确读取旧消息revision显示原body与原editor；新编辑保留旧决策/采用快照，旧source引用不按当前验收索引替换。
- 游标跨scope/身份/limit拒绝，新增/编辑/解决后旧stamp409；当前窗口和总数只反映明确服务端范围，GET零写。

### 真实采纳与现有交付

- 原结论预览后有新回复、编辑或重开，采纳409并保留草稿；明确读最新后才能形成新请求。
- requirement.update、task.update、tasks.plan、issue.promote、issue.diagnosis.adopt 所有开放来源动作的业务结果与SourceLink同事务；故障注入任一点均无半成功。
- 同原key超时重放返回原精确对象，不重复建Task/Requirement；根source_reference变化参与指纹，原key异来源409。
- 纯来源关联不触发验收失效；真实描述/验收/依赖/责任变化继续沿现有永久失效测试，A→B→A不复活旧通过。讨论解决不计任务完成。
- Issue回流保持原source_issue_id去重，Issue仍open；随后真实Task通过已有派发、测试、人审才计交付。

### 前端/契约

- 四flow真实回调，包含页外thread/message深链、编辑历史按需加载、消息/任务删除及403留页、返回原筛选/分页/消息。
- 409保留原稿并明确采用；未知结果原key恢复；提交期间新输入不被成功响应清空。会话/项目/筛选/离开再返回ABA与无replacement残留busy均有永久回归。
- 中英日状态/按钮/错误完整，原生键盘按钮、窄屏单列样式与现有主题；当前被拒绝的浏览器/12ui行为不重试，组件/源码检查不冒称390px实机视觉通过。
- SDK/CLI/OpenAPI与严格extra/nullable/枚举/错误/分页/版本契约逐项同步；CLI只从原file重试，不静默生成新key或作者身份。

## 10. 本地 Multica 的可吸收事实及取舍

- packages/core/types/comment.ts:18-46：Comment是issue绑定、稳定parent、独立revision、resolved_by和真实source_task；可吸收稳定消息/线程/修订/来源概念。
- server/internal/handler/comment.go:1713-1729：来源Agent/task由认证中间件重印，客户端头不能自选。当前Manager没有相等的Agent发言身份契约，因此先做真实人消息＋可信运行引用。
- server/internal/handler/comment.go:4033-4061：单一结论替换同事务，避免双结论；本方案直接令thread保存唯一resolution event，不复制其issue revision写入策略。
- server/internal/handler/comment.go:1910-1914：新回复重开；本方案与消息追加在同SQL事务，不接受跨事务半完成。
- packages/views/issues/components/comment-input.tsx:199-217：发送成功只清本次提交草稿；应吸收其并发输入保护。
- packages/views/issues/components/source-context-comment-list.tsx:25-89：固定来源与当前新增/修改/删除分别显示；应吸收展示语义，不移植整个来源存储。
- Multica会在评论变化时递增issue_revision、按提及自动触发Agent。这里业务basis和验收链路不同，不能照搬到Task/Requirement，也不移植自动触发/通知流水线。

实现状态：T-delivery-discussion已实现并完成本阶段验证，详见阶段记录、使用说明和证据；完整平台目标与实机/生产验证仍按实际范围保留。
