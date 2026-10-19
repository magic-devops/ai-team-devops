# 问题诊断与需求回流

在项目交付工作台打开“问题与改进”，按状态、严重度和实际来源筛选，点击明确问题进入详情。来源由服务器关联执行、部署及真实成功工具事件，问题描述中的运行 ID 不会被当作已验证来源。工具来源使用独立分页目录和精确回执，支持跨页选择诊断证据；操作见 [工具问题来源与人工需求回流](ISSUE_EVENT_ORIGINS_GUIDE.md)。

## 核对证据并生成提案

“证据”显示当前问题、关联任务、执行步骤和部署健康观察。受限或缺失来源会明确标记，日志只显示脱敏后的有限片段。每条来源都有精确项目入口；历史尝试与当前状态分开呈现。

在“诊断”选择 AI 或规则，逐项选择可发送的证据并查看固定提交内容。问题记录是必选项。AI 使用当前项目配置的模型网关；规则提供调查和验收清单，两者都不会执行命令、修改系统或宣称问题已修复。AI 结果只引用本次选择的证据，可能原因需要独立核实。

每次提交固定项目、问题、证据依据、版本和原请求键。请求中断时先查询原请求；如需重试，保留原内容和原键。处理中或结果未知的请求不会因读取自动再调用模型。明确取消只结束该提案的采纳流程，不代表上游模型已经停止。

## 人工审阅与需求规划

从诊断历史选择明确提案，编辑需求标题、描述、优先级和逐条验收条件，填写人工意见，先预览再确认。服务端重新核对真实账号权限、当前问题、原始选中证据和工作区访问权限。依据变化后必须重新生成提案；版本冲突保留草稿，需要明确读取并采用当前版本。

一个问题只回流一个需求。已有需求时返回原需求，保留原内容。采纳记录保留原始提案、人工意见和需求关系；采纳或驳回都不会关闭问题，也不会代替功能测试或质量验收。进入关联需求后继续使用既有需求拆解、任务计划、派发、测试、人审与发布链路。

原问题删除后，可通过明确问题 ID 与提案 ID 查看允许访问的固定历史，并按权限取消未决提案；不能把历史记录当作当前问题采纳。项目归档前必须处理未决诊断，归档后只读。

## 工具入口

SDK 使用 `ManagerClient(project_id=明确项目)` 的 `delivery_issue(id)`、`delivery_issue_diagnoses(id, cursor=原游标)`、`delivery_issue_diagnosis(id, diagnosis_id)` 和 `delivery_issue_diagnose(id, body)`。写入采纳/取消仍使用统一 Delivery command。

CLI 在明确项目上下文中使用：

```text
sop delivery issue --id ISS-...
sop delivery issue-diagnoses --id ISS-... --cursor 原游标
sop delivery issue-diagnoses --id ISS-... --diagnosis-id 精确提案ID
sop delivery issue-diagnose --id ISS-... --file 固定请求.json
sop delivery command --file 固定人工决定.json
```

生成文件必须包含 `expected_version`、`issue_basis`、`selected_evidence_ids`、`generator`、`instructions` 和 `idempotency_key`。人工决定 action 为 `issue.diagnosis.adopt` 或 `issue.diagnosis.dismiss`，包含原提案/问题/依据及人工意见，并使用当前明确版本和原幂等键。工具不会替操作者选择首项、生成新的重试键或自动采纳。

## 验证范围

阶段验证和未完成范围以 `memory/delivery-workbench-progress.md` 及 `.sop-runtime/delivery-evidence/delivery-issue-diagnosis/` 为准。本地协议模型 fixture 仅验证真实 HTTP 网关与流程，不代表外部厂商模型质量或生产认证。实际窄屏中英日视觉复核、生产账户/模型及长期规模验证继续列为待办。
