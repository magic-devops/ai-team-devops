# 智能体问题回流的真实事件来源

任务 `T-issue-origins`，基线 `9526181c3d7be2de11aab89a3317002853df9679`。本阶段落实工具原件、可靠处理回执、真实 SQL Issue、问题来源、固定诊断和人工转需求之间的追溯。主产品继续使用现有任务、执行、Issue 和需求，不新建第二套业务对象。

## 已确认缺口

前阶段隔离生产路由探针已确认：`sop.issue.opened` 和 `sop.sync.push` 的 issues/create 都产生真实 Issue 和成功处理结果，但 Issue 详情没有反向事件来源，队列将两者归入 other。报告与可执行探针在 `.sop-runtime/delivery-evidence/bounded-review/next-issue-origin-audit/`。generic 事件中的 issue_id、subject、描述或 run 字符串不构成来源证据。

## 正式归属与事务

EventInbox 保留不可变原文，EventProcessingAttempt 保留不可变处理结果。新增小型索引投影 `IssueEventOrigin`，不是另一种 Issue 或讨论采纳记录。字段至少包含稳定 origin ID、内部 seq、tenant/project、issue_id、receipt_id（唯一）、原成功 attempt_id、真实操作 create/update/delete、effect_kind、原 digest 和处理时间；索引按 tenant/project/issue/seq。Issue 外键不级联删除历史；receipt/attempt 的真实原件及身份每次读取都重新核验。

来源只在成功业务处理事务中写入：opened 的真实 issue_created；结构化 issues 操作的真实 record_upserted/record_deleted。操作类型来自已通过规范校验并实际执行的业务命令，不能把 upserted 标签一概称为创建。原件、业务效果、attempt、origin 和派生来源标签一起提交或一起回滚。同 receipt 重放不产生新 origin，不增加业务版本，不重复创建 Issue。

原件与 origin 均追加保护，普通写入口不能篡改来源。新表遵循现有 metadata 建表方式，不对旧表隐式 ALTER。查询结构版本升级；既有项目通过已有 configure 权限的 `POST /delivery/query/rebuild` 显式重建来源投影与查询事实。重建只从真实成功 attempt 及可核验的原规范操作补缺，不执行旧事件、不写业务对象、不自动修复 GET；不能确定的旧结果明确统计为跳过，不能编造创建来源。重复重建不能重复 origin。重建允许既有派生维护所允许的归档项目读取场景。

## API

统一需当前活跃身份、显式项目和实际项目权限，复用事件回执读取授权。来源字符串不授予任何运行工作区权限；原运行证据继续按既有 runtime scope 校验。

- `GET /api/v1/delivery/issues/{issue_id}/origins?limit=20&cursor=...`：默认20、最大100；返回 `project_id/issue_id/issue_available/as_of/items/total/limit/next_cursor`。游标绑定 tenant/project/reader/issue/limit 及首次最大 seq。追加新事件不混入旧窗口。没有 Issue 且没有来源则404；已有历史但 Issue 已删除仍可读，并明确 issue_available=false。
- `GET /api/v1/delivery/issues/{issue_id}/origins/{origin_id}`：精确来源；返回 `project_id/issue_id/issue_available/as_of/origin`。不能回退第一条或其他任务/项目。
- 每个 origin：`id/issue_id/receipt_id/attempt_id/operation/effect_kind/digest/basis/event_id/event_type/source/producer/processed_at/available/unavailable_reason/evidence`。`producer` 为真实 producer 的 id/name；原文缺失时相关显示字段可为空。`evidence` 使用现有 EvidenceItem，新增 kind=event 和 target.receipt_id/origin_id；ID 为 `event:<origin_id>`。仅包括经过清洗的实际处理元数据，不含 event_json、任意 payload 或完整 ack。
- 问题详情增加紧凑 `origin_summary`：`total`及`projection=current|rebuild_required`，不下载来源全集；队列 source_kinds/filter 增加 event。查询结构版本为4，重建响应增加`origin_rebuild={added,existing,skipped}`。历史接受/回执 processed 均不能冒充测试通过、功能验收或 Issue 已关闭。

目录和精确读取只选所需 SQL 列，不能先载入/解码全项目事件、原文或 attempts 再切片。每个 origin 每次核原 receipt、成功 attempt、真实 effect/目标及 digest；缺失/不一致明确 unavailable，不变成可选诊断证据。相同 tenant/project/Issue 的投影不得通过任意客户端输入创建。

## 诊断与需求回流

来源目录独立分页，不挤占现有默认32项证据。用户可选择页外明确 origin；最多32项总选择，仍需选择 Issue 本身。生成、重放、查看及采纳均按所选原 ID 精确重新解析来源，不能用当前第一页代替所选集合。固定快照只包含选中的清洗元数据和稳定 digest/basis；重试次数、处理当前状态及更新时刻等可变信息不进入语义依据。

Issue 自身 basis 保持当前业务语义，不能因为出现另一个无关来源而静默替换旧建议；已选来源缺失、原件变化或当前权限不足必须使旧建议不可采纳。诊断失败/未知仍走已验证的原请求恢复；采纳保持真实人审批、唯一来源需求、原版本/依据检查和 Issue 保持 open 的现有规则。generic/reflection 的业务处理另列待办，不以新来源标签宣称已完成。

## 交互

沿用紧凑问题工作台和现有主题。问题列表能筛选“工具事件”；详情以紧凑来源摘要打开独立来源目录，展示创建/更新/删除、真实 producer、处理时间及可用性。点击指定来源跳转精确 receipt 并保持项目和返回路径；不把 source/subject 当可点击运行地址。原始事件正文只在现有回执详情明确展开。

目录加载/空态/失败与问题正文、诊断互相独立。跨页已选来源保持，明确展示选择总数和上限，不能自动选第一页首项。切换项目/身份立即失效，旧请求和迟到响应不得污染新页面；403/404清除受限原件，不退回缓存假成功。新来源选择只改变未提交草稿；未知诊断请求不能被换稿或换键。中英日、键盘、窄屏换行与当前主题同步。

## SDK、CLI 与真实验证

SDK 增加来源分页与精确读取；CLI 同步 `sop delivery issue-origins ISSUE_ID --limit/--cursor/--id/--json`。`sop task issue` 与 SDK IPC 的成功入队继续不等于业务成功；有已保存真实回执时，按已有 local_intents 方式展示 processed 实际 Issue ID，pending/failed 明确区分，不为展示自动重送或创建新原件。不恢复旧 Go issue.report 操作。

先固定缺口 RED，再做成功/失败/回滚/重放、两种事件、create/update/delete区分、伪关联、身份/跨项目、归档与删除历史、固定窗口、页外选择/采纳失效和 GET 零写回归。实际 socket HTTP 应完成工具原件投递、断 ACK 原件恢复、唯一 Issue、来源/精确原件、规则诊断和人工唯一转需求；外部模型不是来源证明的前提。同步 OpenAPI、SDK/CLI、使用说明和项目记忆，完整相关回归后本地 commit，不 push。

阶段临时目录 `.cache/issue-origins/`，证据 `.sop-runtime/delivery-evidence/issue-origins/`。先保全重要原件和散列再清理。沿用先前审批边界：不重试已拒绝的浏览器协议或12ui安装上传；控制器/SSR/构建不是390px浏览器实机证明。整体目标保持 active，进度/基线/需求影响有界详情、generic/reflection和生产/长期验证继续待办。
