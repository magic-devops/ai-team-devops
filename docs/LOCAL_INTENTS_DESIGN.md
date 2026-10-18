# 本地写入意图收敛

阶段 T-local-intents，基线90e47f6。沿用已确认的唯一业务实体、原版本/原键、明确预览和持久回执设计。旧命令在任意HTTP失败后另造本地记录、用synced旧副本覆盖未送修改、自动压缩JSONL以及未审查watch直接推送均退出。

## 写入与读取

需求、任务、问题、Sprint的创建/修改/完成/删除沿用原命令入口，但写入要求显式`--expected-version`、`--key`和`--time`；创建额外要求稳定`--record-id`。新操作在唯一SQLite保存冻结原件，然后按需送达。`--local`仅入同一队列，不造另一份业务实体、tombstone或Markdown。错误不自动换ID、改版本或重建内容。

创建使用明确`create`，修改使用`update`，删除使用`delete`。现有显式同步`upsert`仍作为有意选择的同步语义，不用于创建/修改便利命令。create目标已存在、update目标不存在时明确失败；重发通过原事件/业务回执处理，不再次执行。更新只包含明确指定字段，不能把旧缓存整包回写。所有HTTP错误/断线均保留原件，成功入队、送达和业务处理分别表达。

本地读取仅显示Manager实际拉取的只读缓存，注明缓存性质；不再将旧未送local overlay混入真实业务集合。旧文件不删除、不自动转换/发送，只读盘点。`sync compact/repair`等改变旧意图的命令退出。

工作概览采用`sop.work.snapshot.v2`，单命令固定配置，显式区分Manager实时观察与项目缓存。远端需求/任务/问题各取最多100条，校验相同项目、版本及查询代次，Sprint为独立offset观察；total只取实际服务端总数，状态分布与下一步候选仅覆盖loaded rows，提供原cursor/next_page。缓存每模块最多100条，保留缓存行数/摘要/采集信息，完整项目总数及有效验收标unknown；远端失败不自动回落。

## 原业务门禁

`SyncRecordApply.action`扩展为create/update/upsert/delete；加入可选`task_basis`、`requirement_basis`、`change_preview_basis`，严格按模块校验。现有事件类型仍为`sop.sync.push`。

已有需求的title/description/acceptance_criteria变化仍通过原`RequirementEdit`及`require_change_preview`，这次显式透传已审查basis，不能以sync绕过。status仍只能走阶段/评审。已有任务明确修改owner_id或acceptance_criteria时必须有匹配原task_basis；任何提供的task_basis都应比较当前任务，不推导最新值。任务转属、状态、依赖、受管执行、发布/运维保护和永久验收失效保持原规则。新Task创建禁止completed。

问题/Sprint继续使用严格规范字段。旧assigned-agent/dev-tool/branch/debug等不属于规范业务记录的写字段退出，负责人使用稳定owner_id；不得静默忽略输入或伪造测试/验收证据。

## 规则与文件监听

规则提案是明确人工本地操作，保存独立提案文档；应用只改本地规则文件，使用稳定提案标识避免重复正文。远端写入通过显式冻结文件操作，不调用旧无版本rules POST或追加JSONL。只有入队后才报告queued。

watch负责只读发现变更及保存可审查的文件快照清单；不后台猜最新workspace版本，也不自动发送。使用项目内规范路径：rules相对`.ai-memory/rules`，specs相对`sop/custom/specs`，templates相对`sop/custom`，仅监听`sop/custom/templates`，不把内置模板另根映射成同名目标。读取保留原UTF8字节/CRLF，拒绝出项目路径、链接改向和过大内容。旧文件不受扫描删除影响。

明确的`sync enqueue-plan <file> --entry module:path --expected-version N --key K --time T --expected-sha256 SHA|absent`消费审查清单中的一个明确选项，冻结唯一事件后入同一SQLite；清单含固定内容和摘要，不重读已变化的源文件。整个清单先验证，再提交所选原ID及真实入队状态；重试使用同一选项、内容、版本、键和时间。每次只提交一个明确原操作，避免多文件部分入队后改变清单或选择范围却沿用同一控制键。文件原远端basis由操作者明确提供，不能将未知当作不存在。

资产记录增加必需`expected_sha256`（64位hex或显式null表示原目标不存在）。入站计划先核原项目版本和目标原摘要；目标不符时原件保存、处理失败，不覆盖。重试沿用已固定的原计划，不能捕获另一个当前目标作为新依据。显式push-file/enqueue-file/rule flush同步要求原摘要或明确absent。

旧浏览器资产表单同时收敛到同一契约：高级同步面板明确原项目版本和目标摘要/确实不存在，审阅后冻结请求与独立操作键，不能继续以文件路径作为长期幂等键。结果未知保留原件，仅允许重放同一次请求；换项目/会话不采纳迟到结果，明确拒绝后才选择新依据。成功送达和真实业务处理分别展示。

原请求在会话内持久保留并绑定首次审阅的身份范围；保存sending后再次核验scope，实际HTTP头使用绑定会话快照，不能重新捕获另一个项目或账号。父页面标签切换和外部路由分别受当前scope的退出保护。处理完成回执核原事件及原digest/receipt，并展示服务端安全项目相对实际目标，不以输入路径字符串大小写猜测成功或失败。

文件快照输出不得与任何扫描根互为祖先/后代，防止自反馈；拉取的资产/缓存/state采用原子替换目录项，不能就地改写硬链接的其他文件。规则提案完整写入并fsync后唯一发布正式文档，正文与状态之间的恢复使用稳定marker及项目锁。已ACK的本地行不能在另一Manager或用户下显示为当前成功，读取处理回执前需验证实际当前身份；本地模式不能绕过验证。

## 活动与接入指导

issue.create及sync.record.apply按真实action/module/result补活动目标关联，不从任意payload猜对象。既有当前权限/当前归属导航继续复用。Agent接入指导使用规范heartbeat类型、subject及明确原事件ID/原时间，不再下发无法执行的命令。

## 验证与边界

先保留原403错误回退、已提交后丢响应、连续patch回滚、模板碰撞/CRLF、规则重复应用等真实RED。验证真实SQLite与Manager原认证、旧版本/目标存在性/预览basis/任务basis、混合结果与重发、只读缓存和旧文件不变；更新CLI/SDK/OpenAPI/接入清单和使用说明，完整受影响回归后阶段commit不push。

完整平台范围保持active。generic/reflection真实处理器、Issue反向来源链和专属详情有界化仍单列；审计已真实复现，不因本阶段结束而消失。390px三语实机与生产验证继续遵守原工具/审批边界，不以结构或HTTP证据代替。
