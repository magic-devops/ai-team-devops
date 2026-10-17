# sop-sdk

> ai-team-devops **项目侧 Python SDK** — Manager HTTP 客户端 + 本地 agentd IPC + 配置加载。

## 安装

```bash
pip install "sop-sdk[keyring]"
```

## 5 行用起来

```python
from sop_sdk import build_default_client

cli = build_default_client()           # 自动读取 .sop-runtime/agent.toml + 环境变量
print(cli.health())
tasks = cli.list_tasks(status="pending")
members = cli.delivery_workspace()["members"]  # 当前授权项目中的稳定身份
cli.update_task("T-example", {"owner_id": members[0]["id"]})  # 选择有效人员或 Agent
```

## 显式构造

```python
from sop_sdk import ManagerClient, BearerAuth, HmacAuth

# Bearer JWT
cli = ManagerClient("https://mgr.example.com",
                    auth=BearerAuth("eyJ..."),
                    project_id="proj-xxx")

# API Key + HMAC（推荐自动化 / CI）
cli = ManagerClient("https://mgr.example.com",
                    auth=HmacAuth("sop_xxxxxxxx"),
                    project_id="proj-xxx")
```

## 本地 agentd IPC

无需走 Manager，hook / 脚本里直接用。SDK 默认在 macOS/Linux 使用项目内 `.sop-runtime/agentd.sock`，Windows 使用 `SOP_AGENTD_PIPE` 指定的 named pipe；也可以用 `SOP_AGENTD_SOCK` 覆盖 Unix Socket 路径。连接失败会返回结构化错误，不会打断调用方的离线降级逻辑。

```python
from sop_sdk import AgentdIpcClient

ipc = AgentdIpcClient()
print(ipc.diagnose())  # transport / endpoint / available / timeout
if ipc.available():
    ipc.event("tool.pre", tool="Bash", command="git status")
    ipc.task_done("t-123", "完成实现 + 测试通过", confidence=0.85)
```

## 设计原则

| 原则 | 说明 |
|------|------|
| Schema-First | 公开方法与 `apis/openapi/openapi.yaml` 一一对应 |
| 失败优雅 | IPC 不可达 / 网络抖动自动降级；不抛骚扰异常 |
| 安全默认 | HMAC 自带 ts+nonce 防重放；keyring 优先 |
| 明确契约 | Task 写入只使用稳定 owner_id，旧名称分配被拒绝；省略保持，空字符串清空 |

## 兼容旧脚本

`ai-sop-ops/manager_client.py` 在 M3 完成后会改为 SDK 的薄包装；保持函数式 API：

```python
from sop_tools.manager_client import report_task_status  # 现状写法不变
```

底层全部走 `ManagerClient`，自动获得签名 / 重试 / 错误映射的增强。

## 相关文档

- CLI 命令：`packages/sop-cli/README.md`
- 安装与环境：`docs/TOOLS_AND_SCRIPTS.md`
- 同步与 IPC：`ai-sop-ops/SYNC_AND_PLATFORMS.md`
