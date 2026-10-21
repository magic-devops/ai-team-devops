# 交付操作与质量验收

对应 `T-delivery-operation-workflow`。本文描述本阶段源码实现及计划中的使用流程；应用、测试、类型、构建和浏览器验证均按用户要求后置，不能将示例视为运行记录。

## 页面中的最短操作路径

任务中先选择实际可用的执行资源，再预览本次交付内容并确认。外部协作的 W 工单与 S 报告继续使用同一任务入口，不需要手工拼版本、依据或请求键。

网络中断后，先查看保留的操作原件。页面会区分发送中、结果未知、已确认和明确拒绝；未知结果只能恢复同一份原件。启动时或项目、需求等上层查询失败时，也有独立恢复入口，不必先等所有查询恢复。正常面板与恢复入口共享同一个作用域内的操作所有者。

已确认的回执可以直接完成本地清理，再刷新业务数据；刷新失败不等于写入失败。当前新操作仍需当前权限、定义和预览。恢复能力限定在同一授权浏览器标签会话，不能用切换账号或项目的方式重建未知操作。

项目不存在、账号不可访问或作用域不匹配时，应修正当前项目选择和访问范围。恢复入口不会伪造项目，也不会将旧项目数据写入另一个项目。

## SDK 与命令行

客户端采用“准备 → 查看 → 显式发送 → 确认后结束”的流程。准备时读取当前事实，一次固定账号、项目、版本、依据、原正文及请求键；发送时不重新预览、不补字段、不选择最新报告替换原报告。

命令通过既有 `sop delivery operation` 入口提供。以下占位值须替换为实际 Manager 项目中的身份；这些示例本阶段未执行。

```text
sop delivery operation prepare-work-order --action create --task <Task-ID> --executor <Member-ID> --instructions "本次交付说明"
sop delivery operation inspect --operation <Operation-ID>
sop delivery operation send --operation <Operation-ID>
sop delivery operation finish --operation <Operation-ID>
```

第一步返回本地 `Operation-ID`。`list` 可在本地找回活动操作，显式 `list --all` 再查看已结束记录；列表只显示摘要，不展开完整业务正文。`inspect` 展示完整原件、固定作用域和状态，不需要网络；应先确认执行资源及正文，再发送。准备错误但尚未发送时，可用 `discard --operation <Operation-ID>` 明确取消该本地草稿并保留记录；结果未知后不能取消来释放任务槽位。

```text
sop delivery operation resume --operation <Operation-ID>
```

`resume` 只发送已保存原件。此前未知的写入即使后来遇到权限或版本错误，仍保持未知，避免生成第二份操作。成功 HTTP 响应还必须通过完整正式回执核验；空响应、错误格式或身份不匹配不会被当作已确认。

W 的 create、claim、progress、cancel、release、report 均由 `prepare-work-order --action` 进入。后五类动作使用 `--id <W-ID>`；progress 支持 `--percent`、`--status`、`--message`，省略百分比表示未知。release/report 必须明确提供本次 `--stopped`，report 还需固定 `--submission <S-ID>`，不能自动选择最新提交。

S 报告使用 `prepare-submit --task <Task-ID> --file <Report-JSON>`。文件只填写本次 `source`、`summary`、`artifacts`、`criteria` 结果和 `tests`；当前条件文本摘要与版本由准备步骤固定。结果仍须明确填写，不能从旧报告继承测试通过或停止声明。与 W 联动时显式提供 `--work-order <W-ID> --stopped`。

S 审核使用 `prepare-review --task <Task-ID> --submission <S-ID> --decision accept|request_changes --comment "审核结论"`。接受与退回都针对指定报告原件，接受还需满足当前验收权限。

`prepare --file` 仅导入完整的 prepared 操作记录，包含原 scope、binding 和摘要；普通 wire 命令 JSON 不足以证明历史预览绑定。unknown 应在原 journal 中恢复，不能导入为一个新草稿。

默认记录目录为忽略目录 `.sop-runtime/delivery-operations`，可用 `--journal` 指定同一操作目录。记录包含用户明确提交的业务正文与回执，应保持为当前操作系统用户的私有目录；不写入认证头、令牌或凭据摘要。并发进程争用、文件损坏或目录替换会明确拒绝覆盖。`finish` 只结束已确认操作的活动标记，完整记录继续保留。

Python 使用 `sop_sdk.delivery_operations.DeliveryOperations` 与 `sop_sdk.delivery_journal.DeliveryJournal`，方法与上述准备、查看、发送、恢复、结束流程对应。没有自动运行外部工具的隐式副作用。

## 原生执行的验收含义

“运行完成”和“质量验收通过”分别显示。没有声明测试计划时可以准备和执行，但不能接受为已验证交付。缺少结果、测试失败、跳过或来源不匹配时，界面说明原因，并保留退回修改入口。

实际测试证据固定到本次执行、运行、command 定义与 attempt。本机或已授权配对结果生产者写入来源绑定；自报 `succeeded`、跨运行复制结果或更换 command 定义不能替代证据。同一固定运行内复用的先前成功结果会明确标记。

需求验收、已验证进度与当前执行审查消费同一质量规则。查询索引质量版本提升为 7，旧索引必须通过既有授权入口显式重建；读取页面不会自动重建。本阶段尚未执行重建或验证运行结果。

## 仍待完成的范围

历史返工报告的受控复用，需要持久化来源谱系、权限和当前条件重置，继续作为后续完整实现。版本化工具执行配置及原生自动执行适配也继续推进；当前外部 W 工单不代表工具已经自动接通。完整项目、团队与研发全链路目标仍在进行，阶段提交不代表全链路运行验收完成。
