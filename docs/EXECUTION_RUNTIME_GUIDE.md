# 执行过程、日志与人工干预

从任务详情打开执行卡片，或从项目组合、问题证据进入某次执行。运行概况、操作确认、步骤日志和历史记录共用同一业务执行身份。

## 查看过程

- 步骤日志必须选定步骤、执行批次及标准输出或错误输出；未知步骤或批次显示不可用，不改为展示另一条记录。
- “实时采集”表示执行期间持久保存的日志；“完成结果”表示已有完成证据。尚未采集或超过上限的内容明确标示缺失或截断。
- 暂停读取只暂停当前界面的观察。跟随最新、搜索及复制只处理已经加载并经服务端脱敏的文本。
- 旧批次成功步骤可能被复用；其原始批次持续可辨，不冒充本批次重新执行。
- 问题中的节点证据可直接定位步骤和原始批次，保留返回问题的路径。历史摘要按需展开一次执行。

## 明确确认操作

启动、恢复已排队启动、重试、取消和审批都需先填写原因并查看预览，再明确确认。预览固定业务版本、执行身份、运行批次、审批版本及语义基准。

本地命令计划可勾选“执行前人工确认”。审批步骤独立于实际命令和测试，批准后才继续执行；暂停或需求范围变化后，仍可由有当前审批权限的人拒绝收尾。远程配对执行暂不支持审批检查点，预览会明确拒绝这类计划。

响应丢失或服务异常时，保持原操作和请求身份，先读取原状态，再用原内容重试。不要另建启动请求。事实冲突时保留原因，查看并明确采用新预览；权限撤回、项目暂停、任务范围或执行配置改变会限制继续执行。

执行中的操作或提交结果未知时，界面保护关闭和离页，避免丢失原请求恢复入口；账号切换不会被这项保护阻止。恢复读取不会自动重跑命令。

## 取消和停止事实

“业务已取消”与“执行进程确实停止”分开呈现：

| 停止事实 | 含义 | 后续处理 |
| --- | --- | --- |
| 未启动 | 已确认没有启动外部进程 | 可按业务规则准备新计划 |
| 已请求 | 已保存停止请求，执行器尚未确认 | 继续读取原执行 |
| 已确认 | 执行器证明受控进程树退出、等待完成且输出已排空 | 明确同步停止结果 |
| 未知 | 控制进程、连接或租约丢失，缺少完整停止证据 | 核查外部副作用，等待原执行器的真实回执 |

已请求或未知会阻止重新派发、重跑及项目归档。收到真实停止回执后，明确同步才将停止事实纳入业务记录。取消不回滚已经产生的文件、提交或外部操作。租约到期不证明进程停止。

命令执行成功和审批通过仍不等于任务完成；测试证据及人工质量验收继续决定有效进度。

## SDK

```python
from sop_sdk.client import ManagerClient
from sop_sdk.security import BearerAuth

with ManagerClient(base_url, auth=BearerAuth(token), project_id=project_id) as client:
    runtime = client.delivery_execution_runtime(execution_id)
    logs = client.delivery_execution_output(
        execution_id, "tests", attempt=2, stream="stderr", limit=50,
    )
    preview = client.delivery_execution_control_preview({
        "id": execution_id,
        "action": "execution.cancel",
        "reason": "人工确认结束这次执行，核查已产生的外部副作用。",
    })
```

预览不执行操作。提交时使用 `/api/v1/delivery/commands`，将预览的 `payload` 原样保留，`expected_version` 使用预览的 `version`，`idempotency_key` 在首次提交前生成并持续保留。四个动作 `execution.start`、`execution.retry`、`execution.cancel`、`execution.approval` 共用严格控制载荷；仅传 `id` 的取消请求会被拒绝。

## CLI

```text
sop delivery execution-runtime --id EXECUTION_ID
sop delivery execution-output --id EXECUTION_ID --node tests --attempt 2 --stream stderr
sop delivery execution-control-preview --file control-preview.json
sop delivery command --file fixed-command.json
```

`control-preview.json` 是包含 `id`、`action`、`reason` 的预览输入；审批还需明确 `approval_id` 和 `decision`。`fixed-command.json` 包含四个字段：`action`、预览原样返回的 `payload`、预览版本对应的 `expected_version`、首次提交前生成的 `idempotency_key`。重试复用整个原文件。

## 验证边界

本阶段不新增厂商账号接入或自动修复权限。日志和进程验证不能代替生产环境验证。实际 390px 三语视觉检查仍受当前浏览器协议策略限制；组件和布局检查不替代真实渲染验收。
