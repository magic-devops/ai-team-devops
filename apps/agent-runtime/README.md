# sop-agentd

> ai-team-devops **项目侧守护进程** — Go 单二进制，跨平台。

## 职责

- 心跳与通用事件通过 `POST /api/v1/events:ingest` 可靠交接到 Manager
- `GET /api/v1/sync/pull` 增量拉取与本地物化
- 单一持久化 outbox（SQLite WAL）：pending / dead_letter / acked，原事件字节与 ID 保留
- 暴露项目内原生 IPC：macOS/Linux Unix socket、Windows named pipe，供 AI hooks / CLI 发事件
- 本地物化：`.sop-runtime/sync/entities/*.json` 供离线读取

## 构建

使用 Go >=1.26，模块 toolchain 固定为 Go1.26.9。持久化使用单一纯 Go SQLite 后端，`CGO_ENABLED=0` 也提供真实 WAL 队列，不需要安装 C 编译器。

```bash
cd apps/agent-runtime
make build           # bin/sop-agentd
make cross           # 多平台交叉编译
```

Windows PowerShell 可直接构建：

```powershell
cd apps/agent-runtime
$env:CGO_ENABLED = '0'
go build -trimpath -o bin/sop-agentd.exe ./cmd/sop-agentd
go test ./...
```

## 运行

```bash
export PROJECT_PATH=$(pwd)
# 须先 sop login --pair 写入 project_id 与 Bearer
./bin/sop-agentd
# 或通过 CLI：
sop agentd install && sop agentd start
```

## 同步与事件交接

| 组件 | 路径 | 说明 |
|------|------|------|
| Puller | `internal/puller` | 游标拉取，写 `sync_state.json` + `latest.json` |
| Event sender | `internal/daemon/events_sender.go` | 单次身份快照、逐 ID durable receipt 校验、SQLite CAS |
| Outbox | `internal/outbox` | 与 Python SDK 共用 `.sop-runtime/outbox.sqlite`，schema v1 |
| Store | `internal/syncstore` | 物化 `entities/{tasks,requirements,issues,sprints}.json` |

每个事件先冻结完整 envelope 的 UTF-8 JSON 字节、原 ID 和 SHA256，再持久入队。发送前从 `GET /api/v1/events:identity` 验证真实 tenant / project / producer，并一次性绑定 Manager 完整 base URL。更换身份或 Manager 地址不能重绑旧事件；发送不跟随 HTTP 重定向。心跳也使用同一条交接路径，health 成功不能确认事件。

Manager 的 matching `stored` / `duplicate` receipt 仅确认持久交接。`processing.state` 的 pending / processed / failed 独立显示；已交接事件留在 acked，不因业务失败改新 ID 重发。网络故障、缺失回执和可重试拒绝进入本地退避，达到上限原子转 dead_letter。SQL 写入失败不报告入队或 ACK 成功。

## IPC 操作

| op | data / 说明 |
|----|------|
| `health` | pid、project_path、instance_id、outbox 统计或存储错误、旧文件盘点 |
| `daemon.stop` | 当前 instance_id / project_path；完整 ACK 写出后有序退出 |
| `event.enqueue` | `{id,event_json,digest,intended_project_id}`；精确冻结字节，重复原 ID / 字节幂等 |
| `outbox.stats` | `{}`；pending、due、dead_letter、acked、队列身份与 generation |
| `outbox.list` | `{state?,limit?,cursor?}`；默认 all / 20，最多 50，仅元数据 |
| `outbox.inspect` | `{id}`；单条原事件与持久回执 |
| `outbox.requeue` | `{id,expected_revision,reason,idempotency_key}`；仅可重试 dead_letter，原 ID / 字节不变 |
| `sync.trigger` | 拉取后尝试统一 outbox sender，返回各本地状态数 |
| `sync.pull` | 仅拉取 |

旧裸 `event` / `task.update` / `issue.report` / `sync.push` 写操作返回 `event_frozen_required`，调用端先冻结完整事件再使用 `event.enqueue`。单事件 JSON 不超过 64 KiB；IPC 单行帧不超过 512 KiB（含转义外壳），总请求期限 3 秒。批量发送最多 50 条及 1 MiB 冻结字节。游标绑定当前 SQLite queue_id、generation、筛选与页长；变化后需从首页重新读取。

requeue 的 key 绑定原 ID、revision 和完整 reason；同 key 重放返回原回执，即使事件随后再次变化。acked 保留原 ID，避免本地重复 enqueue 成为新事件。

## 旧数据迁移

空的新库直接建立 schema v1。已知旧七列且空的 v0 可在一个事务内升级；未知表、未知列、版本高于 1 或非空 v0 返回 `migration_required`，Open 不修改原数据库字节。操作人明确选择原 intended project 后才调用 `outbox.MigrateLegacy` / Python SDK 显式迁移；原 ID、payload 字节和旧版本信息保留，无效旧 envelope 进入不可重排的 dead_letter，不能补当前最新版本。

历史 `sync/push_queue.jsonl`、`events/outbox.jsonl` 和 `dlq/` 仅在 health 中盘点元数据，不自动投递、不删除、不猜测合并。运行时只有共享 SQLite 一个事件权威。完整合同见 [可靠事件交接设计](../../docs/DURABLE_EVENT_HANDOFF_DESIGN.md)。

## 目录结构

```
apps/agent-runtime/
├── cmd/sop-agentd/main.go
├── internal/
│   ├── config/       ← agent.toml + Bearer 解析
│   ├── daemon/       ← 主循环 + IPC
│   ├── puller/       ← sync pull
│   ├── syncstore/    ← 本地实体物化
│   ├── outbox/       ← 共享 SQLite v1 事件与回执
│   └── transport/http/
└── Makefile
```

## 自检

```bash
sop-agentd doctor
sop doctor              # 含 sync API + agentd IPC
```

## 运维速查

| 操作 | 命令 |
|------|------|
| 构建 | `make build` 或 `make -C apps/agent-runtime build` |
| 后台启动 | `sop agentd start`（项目根目录） |
| 前台调试 | `sop agentd start -f` |
| 状态 / IPC | `sop agentd status` |
| 日志 | `sop agentd logs -n 100` |
| 停止 | `sop agentd stop` |
| 开机自启 | `sop agentd install`（macOS launchd / Linux systemd） |

**环境变量：** `PROJECT_PATH` 指向业务项目根；Bearer / `project_id` 来自 `sop login --pair` 写入的 `.sop-runtime/agent.toml`。

SDK 与 Go 按同一项目 locator 派生 Windows 管道；`SOP_AGENTD_SOCK` 覆盖 locator，`SOP_AGENTD_PIPE` 覆盖本机管道。CLI `start/status/stop/logs --project <目录>` 支持从其他目录操作；`PROJECT_PATH` 为默认项目。`start/status/stop --json` 返回实际健康结果，未确认健康或未确认停止返回非零状态。停止必须经过实例绑定 IPC，PID 文件仅辅助诊断。后台启动 Windows 进程不弹窗口。

停止与 accepted IPC 连接收尾沿用 [原生生命周期设计](../../docs/NATIVE_AGENTD_LIFECYCLE_DESIGN.md)。本地 dead_letter 已与事件及重排回执处于同一 SQLite 事务域。

**doctor IPC 失败：** socket 不存在 → 先 `make build-agentd`，再 `sop agentd start`。详见 [`docs/TOOLS_AND_SCRIPTS.md`](../../docs/TOOLS_AND_SCRIPTS.md)。

## 与 Manager 协议

详见 [`docs/architecture/PROTOCOLS.md`](../../docs/architecture/PROTOCOLS.md) 与 [`UPGRADE_v4_ENGINEERING.md`](../../docs/architecture/UPGRADE_v4_ENGINEERING.md)。
