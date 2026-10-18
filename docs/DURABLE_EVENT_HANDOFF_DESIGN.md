# 可靠事件交接与业务回写

阶段 T-event-handoff，基线 9ffc692。完整平台目标继续推进，本阶段解决既有事件投递、实际任务/问题回写及人工恢复的共同缺口。按当前合理设计替换进程缓存去重、拆分死信写入和重复发送路径，不建立历史格式运行时兼容层。

## 事实与目标

上一阶段独立实证 Manager 四项故障：持久化失败后内存已经标记重复、同 ID 不同内容误去重、不同项目互相抑制、丢失进程缓存后重复落日志。本阶段在未改生产源前，用已校验的 Go1.26.9 和真实 SQLite 跑出另外两项 RED：超限删除后死信文件失败导致最后一份事件消失；心跳仅 GET health 成功即被删除。

当前 IPC task.update 同时写 pusher JSONL 与 SQLite 事件，也不能证明一次业务修改只执行一次。所有新事件使用单一持久投递路径。事件收到、下游处理、任务验收是三个不同事实，不通过标签或计数合并。

## 设计选择

1. **采用：SQLite outbox + Manager SQL inbox/原回执 + 原业务事务。** 不引入新服务；每个边界有固定原文、身份、状态与幂等结果，便于实际故障与重启验证。
2. 不采用“删除 SQLite 后追加 JSONL”：两个存储之间存在丢失窗口，文件追加失败不能补救已删除原件。
3. 不采用“继续内存去重或 Redis 去重后写日志”：去重与实际持久化不是一个提交，无法证明可确认回执。
4. 不将收到事件直接等同业务成功。Task/Issue/structured sync 迁移为真实同库处理；文件资产采用固定计划及可重试恢复；没有已证明处理器的通用事实明确只保存。

## 原始内容与认证边界

精确接口/DTO见本阶段 `backend/API_CONTRACT.md` 与可执行 schema，位于 `.sop-runtime/delivery-evidence/event-handoff/`。

`POST /api/v1/events:ingest` 的根字段为 `expected_tenant_id/expected_project_id/expected_producer_id/events`。每个事件包含 `id/event_json/digest`；inner ID 必须等于 outer ID。摘要为冻结字符串的 UTF-8 字节 SHA256，不跨语言重新序列化、不注入 trace、不改时间或 Unicode 表达。单条最多 64KiB、每批最多 50 条、总共最多 1MiB；拒绝重复 JSON 键、非有限数、非法 Unicode、额外控制字段和非法 envelope。

身份由当前真实 User 或已验证 HMAC API key 的有效所有者决定；key 本身仅为凭据审计。`source` 是来源说明，不能选择作者或权限。显式项目必须真实存在，不能在中间件或读取时自动创建。Project 锁后重新核账户、成员、key 状态和生命周期。

`GET /api/v1/events:identity` 同时支持 Bearer/HMAC，只返回实际可访问的当前身份三元组。发送方在第一次发送前持久绑定该三元组和 Manager base URL。凭据轮换可以沿用同一 User，切换账户、项目、租户或服务地址不能重归属旧队列行。离线仅保存明确 intended_project_id，尚未认证的绑定不能伪造为已验证身份。

逐 ID 结果保留原 digest、receipt_id、stored_at 和 stored/duplicate/rejected。只有完整响应通过项目、producer、原 ID、摘要及持久回执校验，才允许本地确认。缺失/重复/未知结果、空 JSON、200、health 和“processed”文字均不构成 ACK。批次部分拒绝与整体提交失败分别表达。

## 本地唯一权威

Go 与 Python CLI 共用原默认 `.sop-runtime/outbox.sqlite` 及同一 v1 schema。`events` 是唯一原文/投递状态权威，`queue_meta` 与 `queue_receipts` 只维护全局代次、队列身份及人工操作原回执。schema 规范写入 `apis/sqlite/event_outbox_v1.sql`；Go/Python 的打包副本以字节一致性测试维护。

- 状态 `pending/dead_letter/acked`；原 ID、原文、digest、创建时间和已绑定 scope 不可覆盖。收到回执后保留 acked 行，防止同一 ID 再入队形成另一操作。
- 重试/超限以 revision CAS 在一次 SQLite 事务内完成。死信不再复制到另一个文件。ACK 写入失败保留待发原文；取消不消耗重试次数或制造死信。
- daemon tick 与 sync.trigger 共用发送锁；不同 Go/Python sender 仍以服务端唯一回执及本地 CAS 保证不会重复业务效果。
- 统计、metadata 分页、精确原件查看与人工重排分开。游标绑定 queue_id、代次、筛选及 limit；每页默认20、最多50。GET不更新行。
- 人工重排仅允许 dead_letter，必须原 ID、expected_revision、原因和固定 key；事务内保存原操作回执。重排保留原文，不编辑 payload、不换 ID、不盲目 purge。跨语言控制指纹使用有域前缀、UTF-8 长度前缀与 big-endian revision，避免重新引入 JSON 表达差异。
- fresh/空旧库可以原子初始化；非空 v0 不能自动猜旧 scope。显式一次性迁移保存原 ID、原字节、重试信息及操作指定的项目，无法安全执行的旧原件保留为可检查死信。旧 JSONL 只盘点隔离，不按内容猜重、不自动投递或删除；不维持两种运行时权威。

## Manager 收件事实与真实效果

三个支持模型：不可变 `EventInbox` 本身即原持久回执；`EventProcessing` 保存当前处理状态和固定计划；追加的 `EventProcessingAttempt` 保存尝试、结果及人工恢复原 Ack。它们不加入业务进度 watched model。普通事实收取/读取不创建 Workspace、进度观测或业务 query_generation。

先提交 inbox/pending，再立即尝试已配置处理。严格保留原 `expected_version`，缺失或冲突不能以最新版本代替。处理失败保留可见的持久事实和明确原因，不能返回假业务成功。

- `sop.task.status_changed` 使用原 TaskEdit/Task transition/依赖与原生验收门禁。notes/confidence 仅为审计说明，不能成为测试或人工验收证据，不填充未提交的 owner/criteria 默认值。
- `sop.issue.opened` 使用最小规范 Issue 创建动作，真实原输入、引用和角色检查，原事件同一目标，Issue 保持 open。
- structured `sop.sync.push` 使用严格的模块/record 字段及原 scope/reference/Task 验收规则，禁止任意列覆盖。迁移后的直接 sync 路径复用同一实现。
- 抽取单一 `stage_delivery_command` contextmanager，保留原 Workspace CAS、业务变化、DeliveryEvent/Receipt 和观测 reservation。原命令入口与事件处理在 caller commit 时保持相同阶段，随后读取 Ack/调度。事件效果及 processed/attempt 在同一次提交；不增加 `commit=False` 分叉或另一业务实现。
- 规则/规范/模板文件先保存固定 operation plan：原身份、项目根、准确相对路径、before/desired 摘要、原字节和操作 ID。计划持久后立即执行；原权限/生命周期/路径重新核验。当前等于 desired 可恢复先前已完成的文件步骤；当前既非 before 也非 desired 则冲突，不盲覆盖。写入采用同目录临时文件、fsync、原子替换；SQL 状态失败时按同计划恢复。协作写入共享项目锁，不声称可对任意外部文件写入实现跨存储原子性。
- 通用事实及尚无可靠处理接缝的 reflection 显示“仅存储/未配置处理”，不冒称业务完成；其完整处理仍属于平台待办。

只有 commit 后发布最小、服务端 scope 的 receipt hint，通知失败不影响已存储事实。现 WebSocket 补齐真实 active User/exact Project/成员及逐帧权限复核、退出取消；不广播原 payload。Web 本阶段通过 HTTP 读取事实，通知不是可靠历史或验收依据。

## 原事件入口内完善交互

在现 `#/intelligence/events` 原地提供有界列表、筛选、精确 Drawer 和失败恢复；不新建第二工作台，也不从浏览器读取本地 IPC。服务端 summary 匹配总数与本页条数分开。

列表和详情分别显示存储事实与 pending/processed/failed、真实 producer、时间、最近原因及实际结果对象。通用事实不得显示“任务成功”；原始 JSON 默认折叠并按纯文本显示，不宣称已净化。Task 导航重新核当前归属，Issue 接原诊断/讨论/转需求/验收，403/404留页，安全返回保留筛选与精确 receipt。

重试由服务端当前 capabilities 控制，技术 retryable 不能替代 configure 权限。恢复只用原 receipt/revision/body/key，原因必须填写；未知结果保留原请求并禁关闭，409保稿并显式读/采用新依据，已 processed 打开原结果而不再执行。项目/会话/筛选 ABA、迟到响应、SSR、主题 token、三语与窄屏沿用已经验证的交互约束。历史浏览器/12ui审批限制不重试、不绕过，不将结构/SSR测试当作390px实机视觉。

## 验证与交付

必须验证：原6项故障 RED→GREEN；SQLite 写入故障与崩溃前后最后副本；同 ID 异内容、不同身份/scope、凭据轮换与错绑定；真实 HTTP commit 后断开+Manager进程重启返回原回执；健康成功/坏ACK不清队列；Go/Python双向数据库与并发 CAS；Task/Issue/sync 首次效果及原 ID 重投只发生一次；定义变化不复活旧验收；文件写后状态失败按原计划恢复/冲突拒绝；列表/详情纯读与规模边界；原 key 恢复、页面离开与SSR；完整受影响回归、类型、构建及独立复核。

scratch仅 `.cache/event-handoff/`，证据 `.sop-runtime/delivery-evidence/event-handoff/`。Go工具链与模块已独立校验，不全局安装。先保存重要源、唯一证据、原失败和最终产物的hash，再安全清理精确目录；阶段通过后全部本地commit，不push。完整目标保持active，生产/实机及尚无真实处理的能力按实际验证状态留档。
