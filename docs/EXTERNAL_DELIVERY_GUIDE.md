# 同任务外部交付与验收

阶段 `T-external-delivery-loop`。当前源码增量尚未运行测试、类型检查、构建、服务或浏览器；下述描述实现意图与操作合同，不作为已通过验收的证明。

打开已有项目的任务详情，在“外部交付”填写工作来源、摘要、产物、逐条验收条件的证据和报告测试。来源可以是人、智能体或工具；填写 Codex、Zed 等名称不代表平台已认证或连接该工具。报告测试与原生实际运行、签名 CI 分开保存。

提交固定当前任务范围、验收条件和原生执行关闭依据，保存后等待人工审核。无需先把任务标记完成。已有原生执行必须逐项具有实际关闭或安全停止证据，未确认的派发、控制和运行会阻止接管。未配置原生运行环境的普通任务仍可提交外部交付。

外部原件接手的旧原生执行作为历史保留，不能继续启动、重试或审核后覆盖当前交付；同步、取消和原控制结束仍可处理。若需切回原生开发，应明确重新打开任务和需求、确认旧运行实际停止，再准备新计划。报告等待审核时，有效进度显示“待验收”；原生失败留下的任务登记阻塞状态单独保留，明确的阻塞原因和依赖仍需先解决。

审核时核对原件和当前依据，填写结论。只有有效人工验收才计入交付进度；通过要求逐条条件报告满足、报告测试非空且全部报告通过，并附证据。退回和报告失败关联真实问题，可继续使用已有诊断、人工采纳到需求池的流程。同一原件重放不重复建立报告、决定或问题。

范围变化不会自动替换草稿依据。界面提供重新读取和明确采用；原件失效后需准备新报告。新报告单向替代旧报告，原件及原决定仍可查。Task、需求、负责人、依赖或原生交付边界改变后，旧验收不能在范围恢复原样时再次生效。

请求超时或回执不明时，使用“恢复同一请求”，保留原正文、项目版本和幂等身份。当前详情不能证明旧请求失败，也不会触发替换提交。确认成功但本地清理失败时只完成清理，不再次写业务。原生执行验收使用同样的固定请求恢复方式。

## SDK 与 CLI

读取当前依据：`delivery_task_submission_current(task_id)`；目录读取 `delivery_task_submissions(task_id, limit=20, cursor=...)`；读取固定原件 `delivery_task_submission(task_id, submission_id)`。CLI 对应 `delivery submission-current`、`delivery submissions`、`delivery submission`。

提交 `delivery_task_submit(body)`，审核 `delivery_task_submit_review(body)`。body 必须恰含 `expected_version`、`idempotency_key`、`payload`；调用者保存旧版本与身份，不自动请求最新依据。CLI 为 `delivery task-submit --file saved.json` 和 `delivery task-submit-review --file saved.json`。保存文件不能包含密钥；认证沿现有客户端配置。结构化报告最多 48 KiB；文件读取有限额且拒绝重复 JSON 键和非有限数值。

报告必须关联本原件产物 ID。每条标准使用服务端返回的 `source`、`index`、`text_digest`；浏览器和外部工具不能自行猜测或改写当前标准摘要。详细字段以 `delivery_task_submission_contract.py` 和命令 OpenAPI 扩展为准。

## 可靠事件回写

`sop_sdk.task_submission_event.task_delivery_event` 显式传入 report、原 expected_version、event_id、time、source，只创建 `FrozenEvent`。subject 固定为 report.task_id，data 恰含 expected_version 与 report。继续使用已有 EventOutbox 入队、绑定身份、发送与恢复；无第二套队列，不自动发送。

事件 `sop.task.delivery_submitted` 调用同一个 `task.delivery.submit` 正式命令。`stored` 只说明原事件被保存；`processed` 且结果 `task_delivery_submitted/task_submission/S` 才说明保存了报告 S，仍不表示人工验收。业务冲突保留原事件与失败原因，不能自动采用新版本。事件结果按精确 S locator 打开同任务原件，保留事件页返回位置。

事件目录仅展示不含报告来源、对象和业务效果的轻量记录。精确回执、原文、处理历史、重试和重复发送回执重新校验原运行空间权限；事件入口不能绕过交付原件的读取限制。旧人工验收历史中的外部报告决定遵循同一范围限制。

## 待恢复的验证与后续范围

资源和共享验证窗口恢复后，按冻结源码运行 Manager、Web、SDK/CLI、Go Outbox、OpenAPI、类型/构建及实际交互验证；覆盖权限撤回、未知回执、原件重放、原生安全关闭、同源问题唯一、失效与新原生执行接续、进度和发布证明一致性。还需实际窄屏与键盘检查。

本阶段不代表所有平台已接通，也不代表完整研发、部署和运维目标完成。缺失的适配器实际握手/执行、端到端部署、异常智能处理和长期规模证明仍需继续按正式需求实现。
