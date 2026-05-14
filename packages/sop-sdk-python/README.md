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
cli.update_task("t-123", {"status": "completed", "confidence": 0.92})
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

无需走 Manager，hook / 脚本里直接用：

```python
from sop_sdk import AgentdIpcClient

ipc = AgentdIpcClient()
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
| 兼容承诺 | 公开方法 v1 内向后兼容 ≥ 12 月 |

## 兼容旧脚本

`ai-sop-ops/manager_client.py` 在 M3 完成后会改为 SDK 的薄包装；保持函数式 API：

```python
from sop_tools.manager_client import report_task_status  # 现状写法不变
```

底层全部走 `ManagerClient`，自动获得签名 / 重试 / 错误映射的增强。
