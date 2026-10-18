# 事件回执与恢复使用说明

本阶段完成原事件入口、Manager 收件与处理、Python SDK/CLI 和本地执行器的持久交接。所有新事件先写项目的同一 SQLite 队列；原文、事件 ID、摘要和首次验证的身份保持固定。设计依据见 [可靠事件交接设计](DURABLE_EVENT_HANDOFF_DESIGN.md)。

## 在界面中处理事件

从“智能中枢 → 事件回执”进入 `#/intelligence/events`。列表按项目和当前会话隔离，每页 20 条，可按处理状态、类型和作者筛选。筛选、分页和精确回执支持链接与返回。

| 事实 | 含义 | 后续操作 |
| --- | --- | --- |
| 已送达 | Manager 已持久保存原事件并给出匹配回执 | 查看独立的处理状态 |
| 待处理 | 原事件已保存，尚无处理结果 | 查看原因；未配置处理器的事实仅保存 |
| 已处理 | 已提交真实业务效果或事实记录 | 打开实际任务、问题或需求 |
| 处理失败 | 原事件仍保留，业务未成功完成 | 按当前权限和可重试能力恢复 |

详情展示真实作者、原时间、处理修订、尝试记录和结果对象。原始 JSON 默认折叠，以文本呈现。打开任务前会重新读取其当前需求归属；对象不可访问时留在原页。

可恢复的失败需要填写原因后明确提交。结果未知时，页面保留原请求和固定键，限制离开，并提供重放原请求。版本冲突保留草稿，先读取最新状态，再明确采用新依据。两个服务端已锁定并查过原键的明确拒绝可以结束未知状态；普通权限错误、网络错误和服务异常不能代替原回执。最新状态已处理时，可明确显示其只读结果，原重试不会再次提交。

## CLI 与 SDK

先用 `sop delivery context` 查看当前项目和业务版本。新事件必须保留其原 ID、原时间与内容，后续通过 `flush` 送达。例：

```powershell
sop event emit sop.agent.heartbeat --id check-001 --time 2026-10-18T00:00:00Z --data-json '{"uptime_ms":123}' --local
sop event flush --limit 20
sop event list --state failed --json
sop event show <receipt_id>
sop event attempts <receipt_id> --limit 20
sop event retry <receipt_id> --revision 3 --key fixed-retry-key --reason '原问题已修复，重试同一操作'
```

`sop event enqueue-file <path> --local` 接收完整 CloudEvent 的原始 UTF-8 文件，保留其字节表达。业务事件的数据必须携带原 `expected_version`；重试不会读取最新版本来替代它。

本地送达队列与 Manager 的业务重试分别操作：

```powershell
sop event stats
sop event list --local --state dead_letter --json
sop event show <event_id> --local
sop event requeue <event_id> --revision 4 --key fixed-requeue-key --reason '已恢复原账号和服务'
```

本地重排仅接受可恢复死信，保留原 ID、原文与身份。已经取得持久回执的行保留为 `acked`；业务处理失败应在 Manager 恢复，不能换一个事件 ID 再做一次。相同操作键重放返回原操作结果。

SDK 提供 `FrozenEvent`、`EventIdentity`、`EventOutbox`、`flush_outbox`，以及 Manager 的身份、收件、分页、详情、尝试和重试方法。本地 IPC 使用 `enqueue_event` 和 `outbox_*`；业务便捷方法必须携带原版本、项目、ID 和时间。IPC 结果未知时会附原始事件，供明确重发。

新同步命令同样先写唯一 SQLite：

```powershell
sop sync enqueue tasks '{"id":"T-1","title":"Reviewed title"}' --expected-version 7 --idempotency-key sync-001 --time 2026-10-18T00:00:00Z
sop sync flush --limit 20
```

已有需求的正文、标题或验收变化必须通过原需求编辑与变更预览提交。缺少这些依据的结构化同步会明确失败，保留原正文和审批。任务修改继续执行原状态、归属、依赖、交付与验收门禁；notes/confidence 仅为审计说明。

## 本地配置与旧数据

默认文件为 `<project>/.sop-runtime/outbox.sqlite`，Go 与 Python 共用 `reliability.outbox_path`。CLI 状态、诊断、接入清单和环境模板读取同一位置；损坏的队列显示不可读取，不显示零条成功。

首次真实身份验证绑定 tenant/project/User 与 Manager 地址。换账号或服务不能重新归属旧行；旧行会明确退避并保留，当前身份的新事件可继续送达。同一 User 的凭据轮换可以继续使用原回执。

非空旧版 SQLite 必须明确选择项目，执行 `sop event migrate-v0 --project-id <project>`。迁移保留全部合法行号范围的原 ID、原文和重试信息；无效原件保留为不可自动执行的死信。未知库不会被覆盖。

旧 JSONL 仅作为待审查草稿盘点，不自动绑定、发送、压成另一事件或删除。已有实体离线编辑、规则提案及 watch 的旧草稿生产端仍待整体收敛；`sync flush` 和执行器已停止投递旧文件。不要向 SQLite 文件追加 JSONL。当前 schema 规范为 `apis/sqlite/event_outbox_v1.sql`，两个打包副本逐字一致。

## 已验证范围与继续工作

本地真实登录/HTTP 已验证持久回执、进程重启后的原回执重放、HMAC 凭据轮换、项目与身份隔离、零写入读取、三种业务效果及旧版本拒绝。真实 Windows 执行器已验证 70,465 字节 IPC 帧、Python/Go 共用队列、实际心跳内容、任务回写和 SDK 问题上报、离线保留及双端重启恢复。

完成后端 1532 项、前端 678 项、SDK/CLI 426 项及完整 Go 回归；Go 三个原有 Windows 符号链接场景仍跳过。类型检查、生产构建、SDK wheel 的 schema 打包及独立边界复核均留有证据。

证据目录为 `.sop-runtime/delivery-evidence/event-handoff/`。当前 390px 三语实机视觉、生产身份/模型/数据库/基础设施和长期运行验证仍未完成。通用跨存储活动、reflection 真实处理、旧本地草稿生产端，以及主动打开的专属大详情读取仍列入完整平台待办。本阶段通过不代表完整平台目标结束。
