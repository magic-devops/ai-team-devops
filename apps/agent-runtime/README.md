# sop-agentd

> ai-team-devops **项目侧守护进程** — Go 单二进制，跨平台。

## 职责

- 心跳 + 主动上报状态到 Manager
- **双向同步**：`GET /api/v1/sync/pull` 增量拉取 + `POST /api/v1/sync/push` 推送本地变更
- 持久化 outbox（SQLite WAL）+ 退避重试 + DLQ
- 暴露本地 Unix socket：AI hooks / CLI 通过 IPC 发事件（< 5ms）
- 本地物化：`.sop-runtime/sync/entities/*.json` 供离线读取

## 构建

```bash
cd apps/agent-runtime
make build           # bin/sop-agentd
make cross           # 多平台交叉编译
```

## 运行

```bash
export PROJECT_PATH=$(pwd)
# 须先 sop login --pair 写入 project_id 与 Bearer
./bin/sop-agentd
# 或通过 CLI：
sop agentd install && sop agentd start
```

## 同步（pull + push）

| 组件 | 路径 | 说明 |
|------|------|------|
| Puller | `internal/puller` | 游标拉取，写 `sync_state.json` + `latest.json` |
| Pusher | `internal/pusher` | `push_queue.jsonl` → Manager sync/push |
| Store | `internal/syncstore` | 物化 `entities/{tasks,requirements,issues,sprints}.json` |

```bash
sop sync              # IPC sync.trigger：pull + push + outbox flush
sop sync pull         # 直连 Manager 拉取
sop sync push tasks '{"id":"T-1","status":"completed"}'
sop sync status       # 本地游标与队列深度
```

详见 [`ai-sop-ops/SYNC_AND_PLATFORMS.md`](../../ai-sop-ops/SYNC_AND_PLATFORMS.md)。

## IPC 操作

| op | 说明 |
|----|------|
| `health` | agent_id、outbox_depth |
| `sync.trigger` | 完整同步周期 |
| `sync.pull` | 仅拉取 |
| `sync.push` | 入队并尝试立即推送 |
| `task.update` | 任务变更 → sync push (module=tasks) |

## 目录结构

```
apps/agent-runtime/
├── cmd/sop-agentd/main.go
├── internal/
│   ├── config/       ← agent.toml + Bearer 解析
│   ├── daemon/       ← 主循环 + IPC
│   ├── puller/       ← sync pull
│   ├── pusher/       ← sync push
│   ├── syncstore/    ← 本地实体物化
│   ├── outbox/       ← SQLite 事件队列
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

**doctor IPC 失败：** socket 不存在 → 先 `make build-agentd`，再 `sop agentd start`。详见 [`docs/TOOLS_AND_SCRIPTS.md`](../../docs/TOOLS_AND_SCRIPTS.md)。

## 与 Manager 协议

详见 [`docs/architecture/PROTOCOLS.md`](../../docs/architecture/PROTOCOLS.md) 与 [`UPGRADE_v4_ENGINEERING.md`](../../docs/architecture/UPGRADE_v4_ENGINEERING.md)。
