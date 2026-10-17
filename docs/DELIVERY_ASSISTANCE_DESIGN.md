# 需求辅助与人工审查设计

继续既有完整主计划，当前增量完善已存在的需求接入、评审、原型和工作流。前一目标轮完成业务权限、有效模型配置和会话一致性，属于实质进展；本轮直接推进下一待办。

## 业务约束

1. AI 与本地规则由操作者明确选择。AI 失败保留输入、旧预览与失败凭据，不能自动回退后把规则结果显示成 AI 成功；规则不调用模型，也标明来源。
2. 解析、评审、原型共用实际模型网关。网络前保存 SQL 生成凭据；同一请求重放不重复调用，处理中、失败、输入冲突均明确。生成结果记录模型、提供商、用量和不可变基准。
3. 生成是预览。选中/编辑条目后才导入；验收建议与原型经明确采用才写业务记录。确认动作使用版本和幂等检查。需求变化后的旧建议不能冒充新版本证据；失败不清空草稿。
4. 原型采用追加交付产物，历史可读；生成时不覆盖旧文件。尚未进入项目图片网关的配图请求明确不可用，不能绕过项目配置读取全局图片凭据。
5. 工作流超时仍待处理，人工意见必须明确提交。真正消费 approve/request_changes/reject 信号，记录操作者、意见和稳定请求身份；审查结案不等于代码合并、业务任务完成或发布成功。
6. 工作流作用域和角色与业务项目一致，当前数据库权限有效；跨项目 ID 不可查询、审批、取消；同 ID 在不同项目相互隔离。同步模型调用离开事件循环，等待状态保留可恢复证据，不把未实现 Temporal worker 说成可用。

## 三个界面

- 需求接入：上方来源及文档选项，中部输入和可编辑预览，底部确认所选条目；生成来源和用量紧邻结果。失败保留上一份结果，重新生成明确替换，导入冲突显示服务器版本并需明确核对。
- 需求评审与原型：选择当前需求，规则/AI 评审分别标记；建议验收条件可以编辑，原型可预览 Markdown、编辑和确认。历史列出成功、失败、来源、模型及对应需求基准，旧快照只作为历史，不直接应用到新基准。
- 工作流详情：阶段、AI 建议、人工审查、活动依序展示；待人审及超时待处理使用等待语义。审批用带意见的专用表单，按实际 approve 权限控制；其他信号保留高级操作。终态不提供再次变更结论的入口。

沿用紧凑协作工作台、AntD、现有颜色和间距变量；390px 时输入及操作纵向排列，状态及来源可换行，按钮可键盘操作。

Ruling: 用户已批准完整主计划并要求持续实现，按现有方案推进，不重复请求设计确认。12ui 技能的第三方设计上传在前轮被自动审批拒绝，本轮不重试；使用 WorkBuddy 本地参考及实际浏览器渲染验证。产品不引入第三方设计服务依赖。

## 验收

- 同一生成请求一次模型调用；明确规则零模型调用；失败、额度不足、禁用提供商不伪装成功。
- 导入、采用及信号重复提交不产生重复记录；并发版本冲突保留编辑内容。
- 旧需求基准、其他操作者或项目的生成凭据不能作为当前采用依据。
- 工作流 timeout/AI失败/sprint未验证不能自动通过；授权人有意见的信号实际改变可查询的状态。
- 完成相关后端、前端、SDK/CLI、OpenAPI、构建和隔离服务的实际验证，更新完整待办。

## CLI 使用

先在当前项目完成 `sop login` 与项目绑定。以下需求 ID、工作流 ID 和请求 ID 为示例，应替换为实际值；同一操作断线重试时保持原 ID、输入和参数。明确重新生成、修改输入或采用不同版本时使用新的请求 ID。

```sh
sop requirement parse-doc --file prd.md --generator ai --request-id intake-preview-001 --json
sop requirement parse-doc --file prd.md --generator rules --request-id intake-rules-001 --json
sop requirement review REQ-EXAMPLE --generator ai --request-id review-preview-001 --json
sop requirement prototype REQ-EXAMPLE --mode wireframe --generator ai --request-id prototype-preview-001 --json
sop requirement assistance-history REQ-EXAMPLE --json
```

这些命令默认只生成预览。规则来源不调用模型，AI 失败不会改用规则。`parse-doc --apply` 明确导入该预览的全部条目，`review --apply-acceptance` 明确采用该预览的建议验收条件；若需选择、编辑条目或验收条件，使用浏览器工作台或 SDK，再提交保留来源凭据的采用请求。

原型支持 `wireframe`、`user_journey`、`ia`。核对预览后创建 UTF-8 JSON 文件 `prototype-adoption.json`，保留预览返回的 `generation.id`、`generation.basis`、`expected_version`，填写编辑后的 `content`、可选 `title` 和本次确认的稳定 `idempotency_key`，然后执行：

```sh
sop requirement prototype-apply REQ-EXAMPLE --file prototype-adoption.json --json
```

这会追加设计交付产物。请求失败时保留文件，未知网络结果使用原文件重试；409 时先加载最新状态并明确核对。工作区版本变化且需求基准仍一致，可采用新版本及新确认键；需求基准变化须重新生成，不能删除 `generation_id` 绕过来源检查。

工作流启动必须提供固定 `--id`，人工审查必须提供结论、意见和稳定 `--request-id`：

```sh
sop workflow start code_review --id review-example-001 --args '{}' --json
sop workflow detail review-example-001 --json
sop workflow review review-example-001 --decision request_changes --comment "缺少测试证据，请补齐后重新审查" --request-id review-decision-001 --json
sop workflow instances --status awaiting_human --type code_review --json
sop workflow events --workflow-id review-example-001 --json
sop workflow ops-plan --json
sop workflow ops-tasks --json
```

启动示例未提供 `diff`，自动审查会明确记录缺少材料并等待人工处理；实际审查应在 `--args` JSON 中提供真实 `diff`。`workflow review` 适用于 `code_review`，结论为 `approve`、`request_changes` 或 `reject`，只记录本次审查结果。迭代与问题分诊使用工作台对应类型操作或 SDK `signal_workflow`，不能发送代码审查专用信号。治理任务默认预览，仅 `ops-tasks --apply` 创建任务。

## Python SDK 使用

`build_default_client()` 复用当前项目配置和登录身份。建议生成、编辑、确认分开进行；以下第一段只生成预览并写入待编辑文件，不调用采用接口：

```python
import json
from pathlib import Path
from sop_sdk import build_default_client

with build_default_client() as client:
    preview = client.generate_requirement_prototype("REQ-EXAMPLE", {
        "generator": "ai",
        "mode": "wireframe",
        "gen_image": False,
        "extra_context": "重点完善窄屏操作和错误恢复",
        "idempotency_key": "prototype-preview-001",
    })

generation = preview["generation"]
adoption = {
    "content": preview["content"],
    "title": "需求交互设计",
    "generation_id": generation["id"],
    "requirement_basis": generation["basis"],
    "expected_version": preview["expected_version"],
    "idempotency_key": "prototype-adoption-001",
}
Path("prototype-adoption.json").write_text(
    json.dumps(adoption, ensure_ascii=False, indent=2), encoding="utf-8"
)
```

人工编辑、核对文件后，另行执行 `sop requirement prototype-apply`，或明确调用以下接口：

```python
with build_default_client() as client:
    body = json.loads(Path("prototype-adoption.json").read_text(encoding="utf-8"))
    result = client.apply_requirement_prototype("REQ-EXAMPLE", body)
```

其他方法与采用字段保持一致：`parse_requirements_document` / `batch_create_requirements`、`review_requirement` / `apply_requirement_review`、`requirement_assistance_history`。批量导入保留 `generation_id`、`expected_version`、`idempotency_key`；评审采用再保留 `requirement_basis`，只提交已核对的验收条件、标签或说明。

```python
with build_default_client() as client:
    client.start_workflow({
        "type": "code_review",
        "workflow_id": "review-example-001",
        "args": {},
    })
    detail = client.workflow_detail("review-example-001")
    # 核对材料、阶段和权限后，由授权人明确提交意见。
    client.review_workflow(
        "review-example-001", "request_changes",
        "缺少测试证据，请补齐后重新审查", "review-decision-001",
    )
```

`signal_workflow` 用于其他已注册信号：迭代的 `complete_task` 另需 `task_id`，问题分诊的 `reassign` 另需 `assignee`；所有人工信号均保留 `payload.comment` 和稳定 `payload.signal_id`。服务端核验当前权限、类型和阶段，超时不会替代人工验收。
