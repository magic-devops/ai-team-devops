# sop-cli

> ai-team-devops **统一命令行**：`sop` 一个命令通杀。

## 安装

```bash
pip install "sop-cli[all]"
# 或开发模式
pip install -e packages/sop-cli -e packages/sop-sdk-python
```

## 快速上手

```bash
# 1. 初始化项目（写 memory/, .ai-memory/, 多 AI 工具配置, agent.toml 骨架）
sop init my-app --manager https://mgr.example.com

# 2. 配对 Manager（OAuth 浏览器流）
sop login --pair --manager https://mgr.example.com

# 3. 安装 + 启动 agentd 守护进程
sop agentd install
sop agentd start

# 4. 自检（含 Manager、`/api/v1/rag/health` 向量后端探测）
sop doctor

# 5. 状态总览
sop status

# 6. 干活
sop task list --status pending
sop task pull T-123
sop task done T-123 --confidence 0.9

# 7. 通过 Gateway 调 LLM（统一计费/缓存/Fallback）
sop llm chat "总结这次需求" --task-type summarize --cache-ttl 600
sop llm search "JWT 鉴权" -k 8
```

## 数据平面与向量后端

CLI / Agent 与具体向量实现解耦；由 Manager 环境变量控制（`VECTOR_DB_TYPE`、`DATABASE_URL` 等）。  
完整说明见 **[`sop/tools/DATA_AND_VECTOR.md`](../../sop/tools/DATA_AND_VECTOR.md)**（仓库根相对路径）与 **[`docs/architecture/DATA_PLANE.md`](../../docs/architecture/DATA_PLANE.md)**。

## 子命令一览

| 命令 | 作用 |
|------|------|
| `sop init`    | 项目初始化（取代 `init-ai-project.sh`） |
| `sop login`   | 用户名密码登录 / OAuth 配对 |
| `sop status`  | 本地 + Manager 状态总览 |
| `sop agentd`  | 守护进程：start/stop/status/logs/install |
| `sop task`    | 任务：list/pull/done/fail/issue |
| `sop rule`    | 规则：list/propose |
| `sop sync`    | 触发一次性同步 |
| `sop doctor`  | 端到端自检 |
| `sop llm`     | LLM Gateway 客户端：chat/embed/search |

每条都支持 `--help`。
