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

## 固定问题证据与人工需求回流

使用明确 `project_id` 的已认证客户端。`delivery_issue(issue_id)` 读取当前问题、已脱敏证据与版本；来源由实际执行/部署关联确定，不从问题正文猜测。只有明确选择的证据进入诊断，`issue:<id>` 必须包含在选择中；受限或缺失证据不可选。发送前应核对截断、脱敏和未知结果标记。

```python
import json
from pathlib import Path
from uuid import uuid4

issue_id = "ISS-example"
current = cli.delivery_issue(issue_id)
body = {
    "expected_version": current["version"],
    "issue_basis": current["issue_basis"],
    "selected_evidence_ids": [f"issue:{issue_id}"],  # 审阅后可明确加选实际节点/探针 ID
    "generator": "ai",  # 明确选择 rules 才使用规则，不自动回退
    "instructions": "区分已知事实与假设，列出可独立核验的排查步骤。",
    "idempotency_key": uuid4().hex,
}
request_file = Path(".sop-runtime/issue-diagnosis.json")
request_file.parent.mkdir(parents=True, exist_ok=True)
request_file.write_bytes(json.dumps(body, ensure_ascii=False, indent=2).encode("utf-8"))
proposal = cli.delivery_issue_diagnose(issue_id, body)
print(proposal["id"], proposal["status"], proposal["error"])
```

请求发出前保存原文件。网络结果未知时读取 `delivery_issue_diagnoses(issue_id, cursor="...")` 的分页历史，按原 `request_key` 定位，或使用 `delivery_issue_diagnosis(issue_id, diagnosis_id)` 精确读取；也可重交同一原文件查询原请求结果，不会再次调用模型。`generating` 仅表示处理中或结果未知；`failed` 返回安全错误，不能当作规则成功或改用新键自动重发。`409` 后保留草稿，明确核对当前版本/依据；真实问题或选中证据变化需要重新生成提案。

诊断只是建议。具备项目 `approve` 权限且仍能读取原选中证据的人工审阅者，核对原提案、当前事实并编辑需求后，使用通用版本命令保存决定：

```python
# 以下步骤在人工核对后执行；cli 须属于有 approve 权限的当前项目审阅者。
proposal = cli.delivery_issue_diagnosis(issue_id, proposal["id"])
current = cli.delivery_issue(issue_id)
if not proposal["actions"]["can_adopt"]:
    raise ValueError(proposal["actions"]["reasons"])
adoption = {
    "action": "issue.diagnosis.adopt",
    "expected_version": current["version"],
    "idempotency_key": uuid4().hex,
    "payload": {
        "issue_id": issue_id,
        "diagnosis_id": proposal["id"],
        "issue_basis": proposal["issue_basis"],
        "comment": "已核对原始证据，以下为人工确认的需求范围。",
        "title": "调查并修复已确认的问题",
        "description": "先确认原因，再实施修复并保留独立验证证据。",
        "priority": "P1",
        "acceptance_criteria": ["问题可复现或未知结果已安全确认", "修复通过关联任务的独立测试和人工验收"],
    },
}
Path(".sop-runtime/issue-adoption.json").write_bytes(
    json.dumps(adoption, ensure_ascii=False, indent=2).encode("utf-8")
)
result = cli.delivery_command(adoption)
```

采纳沿用 `issue.promote` 的唯一需求关联，不覆盖已有回流需求，也不自动关闭问题、创建执行或证明修复完成。后续拆解、派发、测试及验收仍走既有需求/任务流程。原生成者具有写权限或审阅者具有批准权限时，可用 `issue.diagnosis.dismiss`，payload 为 `issue_id/diagnosis_id/issue_basis/comment`，明确放弃待定提案；取消不表示远端模型已停止。原问题已删除时，精确提案接口仍显示历史且禁止采纳，允许授权取消，避免无法解除归档阻止项。归档项目只读，历史原工作区权限不足时隐藏提案内容。

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

质量与发布候选使用当前项目作用域：`delivery_quality(requirement_ids=[...], task_ids=[...])` 返回明确范围的 `scope_basis`（空范围不自动选择）；关联任务须选择整个需求，`task_ids` 仅指独立任务。`delivery_releases()` 读取策略/签名证明/候选；`delivery_release(id)` 读取精确详情；`delivery_release_preview(body)` 只预览。所有写入继续使用 `delivery_command(body)` 的固定版本和幂等键，不自动采用冲突后的最新依据。

CI导入的 `payload.envelope` 必须是原始DSSE JSON文本，不能预先解析后丢失重复字段。CI保管Ed25519私钥，Manager只配置可信公钥。`scripts/delivery-ci-attest.py --help` 提供真实干净Git checkout、构建/测试子进程、JUnit及新制品的签名入口；先读取明确质量范围再固定传入依据。人工记录、候选已批准与实际部署分别表达，当前候选审批不触发基础设施操作。协议与权限见 `docs/DELIVERY_RELEASE_DESIGN.md`。

受控部署使用 `delivery_deployments()`、`delivery_deployment(id)` 和 `delivery_deployment_preview(body)`。预览需明确候选、环境及理由，或明确 `rollback_of` 和理由；不会默认选择环境或基线。所有动作继续通过 `delivery_command(body)` 提交固定版本、依据与幂等键。部署创建、派发、开始、灰度晋级、只读观察、取消与结果同步分别表达；未知结果不能自动重跑。详情返回服务端允许操作、固定执行目标、真实探针和唯一失败问题。环境配置不是运行授权，100% 实际流量及健康验证通过才建立当前发布事实。详见 `docs/DELIVERY_DEPLOYMENT_DESIGN.md`。

- CLI 命令：`packages/sop-cli/README.md`
- 安装与环境：`docs/TOOLS_AND_SCRIPTS.md`
- 同步与 IPC：`ai-sop-ops/SYNC_AND_PLATFORMS.md`
