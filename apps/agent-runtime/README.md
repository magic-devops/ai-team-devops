# sop-agentd

> ai-team-devops **项目侧守护进程** — Go 单二进制，跨平台。

## 职责

- 心跳 + 主动上报状态/反思/告警到 Manager
- 监听 `memory/` / `.ai-memory/` 文件变化（fsnotify）
- 持久化 outbox（SQLite WAL）+ 退避重试 + DLQ
- 暴露本地 Unix socket：AI hooks / CLI 都通过它发事件（< 5ms）
- 嵌入 MCP Hub：把 lancedb/knowledge/tasks/files/llm 暴露给 AI 工具（M9）
- A2A Node：暴露 Agent Card，参与跨项目协作（M9）
- 可选 gRPC 高频通道（M9）

## 构建

```bash
cd apps/agent-runtime
make build           # bin/sop-agentd
make cross           # bin/sop-agentd-{darwin,linux,windows}-{arm64,amd64}
```

## 运行

```bash
export PROJECT_PATH=$(pwd)
./bin/sop-agentd
# 或通过 CLI：
sop agentd install && sop agentd start
```

## 目录结构

```
apps/agent-runtime/
├── cmd/sop-agentd/main.go        ← 入口（< 80 行）
├── internal/
│   ├── config/    ← agent.toml 解析（与 sop_sdk.config 一致）
│   ├── daemon/    ← 主循环 + IPC + heartbeat + outbox sender
│   ├── outbox/    ← SQLite 持久化事件队列 + DLQ
│   ├── security/  ← HMAC + ts + nonce 签名
│   ├── transport/http/  ← Manager REST 客户端
│   ├── logging/   ← zap 结构化日志
│   ├── mcp/       ← MCP Hub（M9 落地）
│   └── a2a/       ← A2A Node（M9 落地）
└── Makefile  go.mod
```

## 自检

```bash
sop-agentd doctor
```

## 与 Manager 协议

详见 [`docs/architecture/PROTOCOLS.md`](../../docs/architecture/PROTOCOLS.md)。
