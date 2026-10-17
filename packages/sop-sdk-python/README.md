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

## 项目组合与生命周期

项目组合读取不修改客户端当前工作项目。统计覆盖完整筛选结果，分页只限制返回的项目行；`risk_counts` 的分类可以重叠，`total_items` 按实际对象去重。`recorded_completed` 是登记完成，只有 `verified_completed` 才计为有效验收完成。

```python
page = cli.project_portfolio(
    status=["planning", "active", "paused"],
    risk=["blocked", "recorded_completed"],
    limit=30,
)
print(page["summary_scope"], page["summary"])  # filtered_projects
if page["next_cursor"]:
    next_page = cli.project_portfolio(
        status=["planning", "active", "paused"],
        risk=["blocked", "recorded_completed"],
        cursor=page["next_cursor"], limit=30,
    )
detail = cli.project_portfolio_detail("proj-xxx")
print(detail["risks"])  # 每项含精确 project_id 与任务、需求或问题目标
```

所有状态的 `facts_source` 都是 `live`，归档项目也重新计算当前有效证据；`lifecycle.last_archive.facts` 只代表归档时点。没有采集过的归档来源为 `null`。分页游标绑定当前租户、调用者与筛选条件；每次请求读取当前事实，不冻结后续页面。

状态只能通过固定预览和 `project.lifecycle` 命令变更。先在明确选定项目的客户端获取预览、审阅全部阻止项和警示，再持久化完整请求：

```python
import json
from pathlib import Path
from uuid import uuid4

preview = cli.delivery_project_lifecycle_preview({
    "target_status": "archived", "reason": "阶段交付结束，保留资料与验收历史",
})
if not preview["allowed"]:
    raise ValueError(preview["blockers"])
# 审阅预览后，保存原请求；网络结果未知时重试同一份文件。
body = {
    "action": "project.lifecycle",
    "expected_version": preview["version"],
    "idempotency_key": uuid4().hex,
    "payload": {key: preview[key] for key in ("target_status", "reason", "preview_basis")},
}
request_file = Path(".sop-runtime/lifecycle-command.json")
request_file.parent.mkdir(parents=True, exist_ok=True)
request_file.write_text(json.dumps(body, ensure_ascii=False, indent=2), encoding="utf-8")
result = cli.delivery_command(body)
```

`409` 后需要明确审阅新预览，采用新依据并创建新请求身份；不能悄悄刷新版本后重发旧决定。网络结果未知则保持原版本、依据、正文和幂等键重试。恢复必须明确选择 `planning`、`active` 或 `paused`，不隐式恢复历史状态，也不授予运行权限。

只有 `active` 允许新 queue/dispatch。`planning`、`paused` 可以维护需求、任务、团队和配置，并收尾已交接的执行；已提交的 Hermes receipt/run（包括 `planned`）是交接边界。归档必须先关闭所有 Manager 执行意图，未完成任务本身只作警示。归档后业务只读，仅允许显式恢复与合法成功请求重放；这不会撤销独立 Hermes 权限或停止外部进程。

元数据统一使用 `project.update`，省略字段保持原值。规范 SQL 配置字段 `name/description/business_id/project_path/vector_db/vector_db_config/is_template` 需要项目配置权限；目标、负责人和日期保留原写权限。状态不属于该 payload；旧项目 PATCH、物理 DELETE 和 set-template 写入口已移除。

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
