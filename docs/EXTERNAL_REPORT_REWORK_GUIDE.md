# 从退回报告继续交付

对应 `T-external-report-rework`。以下为源码实现的操作说明；本阶段按用户要求尚未执行应用、测试、类型检查、构建和浏览器验证。

## 页面操作

进入任务的交付报告，选中需要修改的退回报告，点击“准备返工报告”。预览集中展示审查意见、当前验收条件、可沿用材料和需要重新填报的测试。确认来源正确后，明确采用，再进入现有报告编辑窗口。

历史说明和材料供本次对照编辑。所有当前验收条件重置为“未知”，测试重置为“未运行”，证据引用全部清空。请选择本次实际作者类型并填写名称，按本次事实补充证据及结果；历史报告的作者、通过结论、工单和停止声明不会自动继承。

准备提交前会重新核对同一份来源和当前条件。来源、定义或当前工单变化时，已编辑正文继续保留，需要先查看新依据并明确采用。重新采用会清空验收和测试结果及引用，避免旧结果对应到新条件。正在编辑的来源报告保持固定，不随“最新报告”变化而切换。

需要同时回写当前工单时，明确选择该工单并作出本次停止声明；仅提交报告时不自动替你停止外部工具。报告成功提交表示等待审查，仍需当前规则允许的人工验收。

网络中断后，使用现有“恢复同一操作”入口。恢复会发送原来保存的正文、版本和请求键，不重新采用其他报告。已确认但刷新失败时，可以完成本地记录后再刷新。当前权限不足仍可关闭未发送编辑窗口；未知操作继续保留原件。

## 命令行

使用已配置好的 Manager 账号和项目。以下身份占位符须替换为项目内的实际值，示例尚未运行。先读取选定退回报告并保存完整采用文档：

```text
sop delivery operation rework-draft --task <Task-ID> --submission <S-ID> --output .cache/rework-adopted.json
```

输出文件的父目录须存在；文件已存在时会拒绝覆盖。也可省略 `--output` 查看完整 JSON。此步骤只读取来源，不建立交付操作。

文档包含 `schema`、`preview` 和 `authored`。保留完整 `preview`，只编辑 `authored` 中的 `source`、`summary`、`artifacts`、`criteria` 和 `tests`。`source` 初始为 null，须填写本次作者，例如 `{"kind":"tool","name":"本次执行工具","url":""}`。不要手改来源引用、摘要或当前条件摘要来消除冲突。

```text
sop delivery operation prepare-rework --task <Task-ID> --file .cache/rework-adopted.json
sop delivery operation inspect --operation <Operation-ID>
sop delivery operation send --operation <Operation-ID>
sop delivery operation finish --operation <Operation-ID>
```

`prepare-rework` 再次读取同一来源的正式预览，确认当前允许提交后才保存新原件。来源或条件变化时不会创建操作；重新使用 `rework-draft` 查看并采用新依据，再把仍适用的本次编辑内容明确转入新文档。正式发送前应通过 `inspect` 审阅完整原件。

如需关联当前 W 工单，准备时显式增加 `--work-order <W-ID> --stopped`；两者须同时提供。本次声明不能从旧文件继承。

```text
sop delivery operation list
sop delivery operation resume --operation <Operation-ID>
```

结果未知时在同一 journal 恢复同一 `Operation-ID`。不要重新准备来替换未知操作。默认 journal 为 `.sop-runtime/delivery-operations`，可给有 journal 的命令统一指定 `--journal <Directory>`。未发送的 prepared 草稿可 `discard`；已确认操作可 `finish`，原件和回执均保留。

## SDK 与读取权限

Python 使用 `sop_sdk.delivery_operations.DeliveryOperations.rework_draft(task_id, submission_id)` 获取完整采用文档，编辑 `authored` 后交给 `prepare_rework(task_id, adopted)`；查看、发送、恢复和结束沿用现有操作 API。

服务端在新报告中固定原报告、退回决定、完整反馈及摘要和读取范围。新报告的详情、历史、回执、事件及后续派发均继承来源权限；被撤销来源运行范围权限后，不能通过新报告继续读取历史材料。预览超预算或来源损坏会明确失败，不返回截断材料。

本阶段完善受控返工交付。外部工具自动执行、版本化执行配置和全链路运行验收仍需后续推进，不应将这份操作说明视为已完成平台握手或生产验收的证据。
