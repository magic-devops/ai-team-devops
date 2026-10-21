# 交付操作恢复与质量门禁

阶段 `T-delivery-operation-workflow`，基线 `f716b65499ce18e37cf26f89f5438b8317a7bc25`。用户要求继续优先代码与交互，运行、测试、类型、构建及浏览器验证后置。本文记录源码设计与后续验证范围，不代表接通外部平台或运行通过。

## 已核实的断点

W/S 两个正常面板已独立于 Task GET，不能把 Task 请求失败时的恢复宣称为全新能力。实际缺口在更高层 workspace、requirement/context 和启动选择门：现 fallback 只发现 TaskEdit/原生执行原件，W/S 没有同等入口。W/S 成功回执还可能在重挂载时按通用默认行为被清空；新增 fallback 若另造 controller 会产生多所有者。

SDK 的 W/S 写入汇入 `delivery_command`，当前二百响应直接返回，未消费严格 CommandAck；通用请求还可能自动重试写入。CLI 需要完整版本、依据和请求键 JSON，没有正式命令原件 journal。CloudEvent processing receipt 与正式交付 CommandAck 不等价。

原生执行接受目前只要求 completed 与节点成功，未要求声明的测试非空。Manager 因此可能将没有测试的执行标为 accepted/completed，而验证统计只检查接受记录。外部 S 接受已要求测试证据，两条路径应形成一致的正式质量语义。

## 操作与归属

| 部分 | 正式归属与行为 |
| --- | --- |
| 浏览器 W/S 原件 | 正常面板、启动发现和父查询失败 fallback 共用实际账号会话、项目、Task 与操作类限定的单一 controller。 |
| 当前新操作 | 仍读取最新定义和权限，显式预览，再保存完整原件。恢复入口不因此开放新写入。 |
| 未知结果 | 仅重放原版本、原请求键、原正文；不能因 GET 失败、重新登录或改选来源而重新创建。 |
| 已确认回执 | 保留严格核验的回执；本地确认/清理与刷新当前事实分离，不要求先有成功 GET。 |
| SDK/CLI journal | 固定端点、服务端账号/租户/项目范围、正式原件与必要预览绑定；写前持久化，单次发送，严格 ACK 后确认。 |
| 原生质量 | 执行完成、人工退回、测试通过和接受分别表达；未声明测试或缺少实际成功结果不能成为已验证交付。 |

W 仍是显式外部协作，不新增独立运行所有者。正式 tool 自动执行应有版本化执行配置，并复用 E/Core 的既有 H、启动授权、fence、进度、停止和测试消费者，不能按登记字符串直接启动进程。

## 浏览器交互

启动和父级失败页显示当前授权浏览器标签会话内的 W/S 原件入口。恢复视图展示原项目、Task、操作、版本和完整正文；未知结果显示同原件恢复，known ACK 显示已确认结果与本地完成清理。当前数据恢复后，正常面板仍接续同一个所有者。

registry 以实际授权会话确定身份，调用方临时 session 标签不能拆分原件。每次存储写入比较之前读取的原字节；损坏、不可用或并发变更必须明确失败，不能静默覆盖。仅 W/S 单独启用成功回执保留，不改变通用默认行为。不宣称跨账号、跨浏览器标签或跨会话恢复。

## SDK 与 CLI

完整业务流程为准备、查看、显式发送、同原件恢复及确认结果。准备可以读取当前事实与预览，一次生成请求键并保存；发送和恢复不得补版本、换依据或重建正文。作用域使用当前服务端 `context_me` 的稳定账号与租户/项目信息，以及规范端点；凭据轮换不能改变账号身份，凭据、认证头和凭据摘要不进入 journal。

严格处理完整有限 UTF-8 JSON、重复键、字段、摘要与大小。命令单次发送，写前保存未知状态；只有与原件及预览绑定一致的正式 ACK 才确认。先前未知后收到权限或冲突错误，仍不能当作从未提交。持久化采用实际事务/比较写入和并发互斥，不能只靠普通覆盖文件。journal 保存用户明确提交的正文，应位于忽略目录；不保存原始认证错误响应，不运行工单，也不把自报停止或测试升级为真实运行证明。

SDK 采用 `DeliveryOperations`、`DeliveryJournal` 和纯 `delivery_ack` 校验模块，覆盖 W create/claim/progress/cancel/release/report 与 S submit/review 八动作。CLI 通过现有 delivery 入口挂 operation 子命令，包含 prepare、prepare-work-order、prepare-submit、prepare-review、list、inspect、send、resume、finish 与 discard；具体选项以实际命令定义为准。list 在本地返回有界活动操作摘要，显式 --all 才包含已结束记录，避免丢失 ID 后无法找回。finish 只完成本地活动标记，保留原件和已确认回执。discard 仅允许尚未发送的 prepared 记为 cancelled 并释放活动槽位，保留完整原件；结果未知不得借取消开始第二份操作。

W create 保存 packet 摘要等明确预览绑定；其余 W 动作保存原 request 摘要、revision 与 state。S 审核固定原 S 和摘要，不选最新替代。新 S 准备从本次当前事实生成依据和条件文本摘要，业务输入仍由用户明确提供；停止声明与本次 W 绑定必须显式确认，不能继承旧报告。所有二百响应仍须 strict finite JSON 和正式 ACK 核对，空体、文本或宽松 JSON 不能成为确认。

## 范围与验证

原生质量同时覆盖接受准入、实际 Core/运行证据、固定交接定义、已验证进度与需求验收，不能只禁用按钮。退回修改仍须可用，不引入没有权威证明的豁免状态。

固定 `source.test_plan` 采用 `manager.execution-test-plan.v1`，包含有序 `node_ids` 与每个选中 command 节点规范定义的 `command_sha256`。只摘要测试 command，避免把含 source 的 Agent prompt 再纳入来源而形成循环。该计划进入既有 H 全请求摘要，并固定到实际 run。显式空计划允许准备与执行，但测试状态为 not_configured，不能接受。

Core 的纯质量判定检查同一任务/运行固定计划、实际 command 定义、结果、整型退出码与当前 attempt；成功必须非 skipped、明确 succeeded、无 error 且退出码符合定义。既有同一固定运行定义中复用的成功结果必须明确表达，不允许跨 run 借证。Manager 的观察、runtime、接受和 SQL 验证视图采用同一质量语义；接受记录保存固定质量快照并绑定原 run 证据摘要。无快照、定义或结果不符的旧 accepted 不得继续算 verified。

本机和配对结果生产者以服务端实际 run、node、command 定义及 attempt 写入 `evidence_binding`，覆盖调用方自带声明。质量判定拒绝缺绑定、跨运行、改定义或缺退出码的“成功”，不补默认通过；Manager 投影保留同一结构化事实，不能拿截断日志拼出另一个摘要。

Web 消费后端 `can_accept` 与质量原因，保留退回入口；没有配置测试时不再自行允许接受。独立工作区的 standalone 手工审阅不冒充 Manager 托管测试证明。查询索引 schema 与默认查询契约从 6 提升为 7，避免旧 verified 缓存继续 ready；保持现有明确授权重建，不在 GET 隐式修复，重建的实际验证继续后置。

历史报告受控复用是下一完整垂直切片：持久绑定明确 S/digest/Decision 与来源权限，当前条件重建 unknown，旧测试计划重置 not_run，停止与 W 绑定不继承。现有 `adoptSubmissionDraft` 不能直接作为历史复用器，因为它会保留匹配的旧结果和整份 tests。

本阶段用实际 HTTP、controller/回调、SDK 传输/journal 和 CLI 消费者检查定义覆盖原件、已确认回执、父查询失败、并发、作用域、严格响应、质量门及进度统计；所有定义仍待运行窗口。只读 Git、文本、标准库 AST/JSON/hash 支持各自源码范围，不能替代类型、渲染、运行或生产验证。完整全流程目标保持 active。
