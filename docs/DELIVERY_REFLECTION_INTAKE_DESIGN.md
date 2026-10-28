# 反思收集、可核验原件与固定输入

阶段 `T-reflection-intake`，基线 `16a64f16fdfed4f6358731c763f1facc7f7d27f2`，2026-10-19。本文是当前规范设计；实现与验证状态见阶段计划、使用说明与项目记忆。完整全流程目标仍在推进。

## 目标与权威

在现有 Intelligence 工作区完成规范收集、回看原件、核对来源和固定后续分析输入。反思内容是提交者陈述，收集成功只证明认证身份、原件和所引用对象身份经过规范处理，不证明陈述真实，也不是测试、验收或部署证据。

唯一正文是不可变 `EventInbox.event_json`。复用真实事件收件、原字节 SHA256、producer+project+event ID 去重、尝试记录和原操作重试。新增投影只保存引用事实，固定输入只保存选择本身的事实及原引用。固定输入使用现有 Delivery 命令、项目锁、版本、幂等键和可靠 ACK，不建立另一套版本状态机。

规范入口为 `#/intelligence/reflections`，替换旧 `#/intelligence/distill`，不保留别名。同步退役旧全局 distill/proposals/review HTTP、Web、SDK 调用及零向量/JSONL/自动应用实现。历史用户文件保留原样，不猜测迁移身份，不删除。本阶段不运行模型、蒸馏、规则生成或应用；后续能力必须以本阶段固定原件为依据另行建立审核链路。

## 收集合同

CloudEvent type 为 `sop.reflection.recorded`，handler 为 `reflection.record`，subject 必须为空。data 严格拒绝多余字段：

| 字段 | 规则 |
| --- | --- |
| schema_version | 整数 literal 1，拒绝 bool |
| category | coding / testing / security / workflow / review / other |
| title | 1..160 Unicode 码点，不能全空白 |
| observation | 1..12000 码点，不能全空白 |
| lesson | 0..8000 码点，省略为空字符串 |
| references | 0..8 项，kind+id 唯一；task ID 1..64、execution ID 1..200 |

引用 ID 拒绝首尾空白、C0/C1、斜杠与反斜杠。项目/租户/producer 来自真实认证与明确项目，不接受 body 自报身份。事件原 time 必须有时区，发生时间索引规范成 UTC；发生时间仍是提交者声明。原件沿既有单件64KiB、收件批次1MiB上限，不重序列化或截断正文。

intake 在写锁内验证 typed 内容与每个实际同项目引用，并形成服务器冻结的 `reflection_visibility` plan：原 digest、逐项核实的身份、实际 execution workspace/run 绑定及 runtime scopes。plan 不保存第二份正文，也不信客户端 scope。无效 typed 数据按原 ingest 单件 rejected；5xx 使未提交批次回滚并保留 sender 原件。无合法 plan 不变成可共享原文。

处理时重验原 producer 当前 active/write、原文/digest/plan 与引用身份。execution 换绑不能跟随新 workspace 扩权；明确失败并保留真实尝试。已成功的历史不会因 producer 后来离职而被改写。旧 handler=None 同 type 原件不猜迁移、不由 GET 补计划；需重新审阅后以新事件 ID 投递规范事件。

成功效果严格为 `{kind:"reflection_recorded",target_kind:"reflection",target_id:receipt_id}`。收集不推进 Task、验收或 DeliveryWorkspace；真正成功 attempt 与 ReflectionRecord 同事务，任何插入/提交失败不得留下假 processed。

## 不可变引用事实

`reflection_records`：seq、id=receipt ID、tenant/project、唯一 receipt/attempt、认证 producer ID、digest、category、声明发生时间 UTC、服务器 collected_at、核实引用和冻结 runtime scopes。category/时间仅为可重建 SQL 索引，不是第二正文。无 Task/execution 级联删除。

`reflection_inputs`：seq、id、tenant/project、title1..160、rationale1..2000、服务器创建人/时间、source_version、有序唯一 sources1..32、manifest_digest 与服务器冻结 scopes。source 仅有 `reflection_id/source_digest/attempt_id`。status 是常量 prepared，无虚构 queued/running/succeeded；改选择需新建另一输入。

普通 ORM 与 Session Core 不得伪造、更新、删除以上事实。Record 仅实际事件处理追加，Input 仅规范命令追加，复用精确能力与归档门禁。支持表正常启动创建，不在 GET 建表/补列/修历史；不完整 schema 必须明确失败，不能报告空池。

## 读取、权限与真实计数

所有新路由有真实认证、明确 `X-Project-Id` 和当前项目角色。静态 inputs 路由先于动态 reflection ID。

| 路由 | 行为 |
| --- | --- |
| GET /api/v1/reflections | category、occurred_from/to、limit 默认20/最大100、cursor 最大4000；SQL 固定首次 seq 上界的轻目录 |
| GET /api/v1/reflections/{reflection_id} | 页外独立 exact；核原字节、digest、plan、成功 attempt、投影一致性后返回陈述、原件、核验事实、当前来源和 selection_reference |
| GET /api/v1/reflections/inputs | 固定输入轻目录，独立游标，不展开正文 |
| GET /api/v1/reflections/inputs/{input_id} | 有权时读取原 manifest 及逐项当前可用性；原 runtime scopes 受限时整个 manifest/rationale403、runtime离线503，不泄露受限源集合；不 inline32份正文，不用其他原件替换失源 |

目录 `total` 明确定义为项目、筛选和固定窗口内的收集事实数，包括原文受限的脱敏壳；不是当前用户可读正文数。项目级元数据允许展示收集存在性、类别、发生/收集时间、认证 producer。受限项不显示 title、摘要、source/subject、refs、workspace/run、正文或可导航目标。SQL COUNT 不读正文，最多核当前页100项固定 scopes，不全项目扫描 runtime ACL。UI 必须说明这一计数口径，不将受限壳称为可用样本。

游标绑定 tenant/project/reader/filters/limit，固定首次 seq 水位，新增反思不改变原窗口；每次读仍重核当前权限。恶意、跨域或参数失配 cursor 明确422。目录仅表示 collected 事实，exact 才提供可用于新固定选择的原引用。

共用 visibility resolver 覆盖新目录/exact/Input、通用 events 目录/detail/attempt/结果目标，不能只保护新页面。合法冻结 plan 依原 scopes 核当前权限；缺/坏 plan、旧 handler=None 不能默认为项目公开。受限通用目录返回脱敏壳（空 source/subject、无 result target），通用 detail/attempt 明确403，不返回 raw。新 exact 不可用状态不得回退旧正文缓存。来源对象当前缺失/索引不可用与原件损坏分开，保留历史陈述但禁用无效导航和新选择。

所有 GET 零业务写，不调用 reconcile/capture/rebuild/mkdir/模型，不自动修复。HTTP 全链路零写另作实测，不能用 handler 单测代替。

## 固定输入及可靠恢复

命令 `reflection.input.create` 沿 `POST /api/v1/delivery/commands`：`expected_version`、原 `idempotency_key`、payload `{title,rationale,sources:[{reflection_id,source_digest,attempt_id}]}`。1..32项有序唯一，单源原 UTF8<=64KiB、合计<=2MiB。先在 SQL 量所选源字节，再加载精确原件。项目锁内重新核全部原件/成功 attempt/plan/当前角色与来源权限；任一失配则全拒绝，不部分保存。

ACK 使用真正 Delivery 格式，resource.kind 为 reflection_input，result 仅 `{status:"prepared",source_count:n}`，affected_refs 仅 input opaque ID，不夹 title/rationale/源 ID/正文。初次写必须有全项当下权限；已提交同 body/key 重放只核原操作人仍 active、当前项目可读以及原回执/body hash，以原小 ACK 解锁 unknown，不依赖当前目录、原件、runtime 或版本仍可用。该动作的原操作人后来降为 viewer 仍能只读确认原小回执，新键或查无原回执仍要求 write；不改变其他动作权限。归档项目允许既有原回执只读重放，新写仍拒绝。同键异 body 冲突。源 scopes 用于输入正文读取，不加入这份无敏感内容 ACK 的访问依赖。

保留现有规范命令全项目 reconcile、final observation、query projection 写成本，不能声称写入常量 I/O。固定选择后不自动调用模型。未来模型消费必须重新核完整输入与权限，不准把不可用成员当空数组继续。

## 交互与接入

复用紧凑 Intelligence 工作台、主题 token 和中英日文案。已收集/固定输入两个列表；轻目录、页外 exact、当前来源核对独立读取。唯一不可变原件继续打开 Events 回执并携带严格同项目 allowlist 返回路径。正文/密钥/manifest 不入 URL。禁用旧 distill 写按钮与伪进度/置信度。

初版收集通过 typed SDK/CLI+真正 EventOutbox：本地持久化后再投递，stored 与 collected 分开。Web 提供接入说明、待处理收件和精确回执导航，不放没有真实发送/恢复实现的手工收集按钮。本轮不为第二种 ACK 协议复制控制器。

用户明确阅读 exact 并采用后才能加入选择；跨页保留已选引用，禁止隐式全量选中。预览列出成员、选择标题/依据与阻断原因；单一主操作固定输入。固定成功展示 prepared 事实和“尚未运行蒸馏/规则应用”。限制、受限、真实空态、损坏、503、过期与 unknown 各有可读状态和实际重读动作。

固定命令独立外置 recovery host，先于目录/context/exact/source 失败分支。首次发出前持久保存完整原请求，同步防双提交；unknown 只恢复同正文/版本/键。当前403/404/503不能迫使换键；GET 最新成功不能证明原键确认。完整核验 ACK 再解锁。当前实际项目仍为P但深链误指Q时，禁止Q新读取/写入；保留明确标注原项目P的外置恢复入口，只允许用户显式恢复P原件，不自动切项目。实际会话项目切为Q时P控制器立即失效，不能残留P正文或恢复按钮。会话/项目/路由 A→B→A 和迟到回调用同步 epoch/serial 防护；StrictMode 首次有效动作可用；storage失败零发送。

宽屏列表与详情合理分栏，窄屏单列/Drawer；长文本换行，原 JSON 默认折叠，明确 label/aria/键盘状态，主题颜色伴随文字。SSR/实际控制器回调可验证语义，不能冒称390px浏览器、焦点、对比度实测。已有浏览器及12ui安装上传审批限制不重试、不绕过。

## 验证边界

先永久 RED 再实现，覆盖 typed/字节/去重/事务回滚、冻结 ACL 及通用旁路、分页 SQL/固定窗口/页外 exact、坏源/失源/跨项目、选择全有全无与容量、ACK丢失恢复/同键冲突、普通写保护/归档、GET零写、旧路径退役。Python/Go event effect 接收方同步，真实 SDKCLI outbox 行为必须验证。独立后端与实际 UI host 审查后作 source-pinned 检查、OpenAPI/离线 wheel/真实认证 socket HTTP。生产身份、模型、基础设施、其他数据库、真实视觉与长期规模验证仍单列未完成。

## 能力目录的未评估状态

新反思入口不得编造60%等精确成熟度。能力目录使用 `maturity:null, assessment_state:unassessed` 表示未评估，统一按值是否有实际评估区分，不能按 reflection ID 加例外。summary/domain/microapp 聚合排除未知并报告 assessed/unassessed 数量，全部未知时平均值为 null；治理任务与 readiness/production/experience 派生公式不把未知当0分或生成伪结论。前端/CLI显示未评估，不能显示0%、null%或NaN。

本阶段只建立新入口与共用缺失值语义，不把现有目录其他硬编码分数称为真实验收或开发进度。全目录改为证据支持的已实现/部分/缺失/未验证状态，是已识别的后续完善项，不能用静态成熟度宣称完整目标完成。
