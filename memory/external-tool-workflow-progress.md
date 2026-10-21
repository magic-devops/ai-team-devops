# T-external-tool-workflow

基线 `e76b81cefd5276cff15fe4700a389dc4e5b18f73`。上一目标回合属于 progress：已提交任务编辑与恢复的 32 个文件，实际提交内容、空暂存区及 80 项独立工作区保留有 `.sop-runtime/delivery-evidence/task-edit-recovery/commit-receipt.json` 证明。本轮重新核对 HEAD、提交原字节及这 80 项独立改动，并封存新基线；唯一用户原件继续保留。

本轮实际源码审计确认：W 没有工具运行消费者，SDK/CLI 仍需完整原件 JSON；原生 E 已有正式 Agent 绑定、目标、测试、H 与控制。统一入口可复用这条真实链，而不是把外部登记名称当作进程启动授权。退回 S 的 Decision/Issue 已有，但下次 E/W 输入没有消费原反馈；固定 W 的定义和说明也没有在已派发详情中完整展示。

本阶段实现统一真实能力派发、显式选定的固定返工反馈贯穿 E/W/Core 输入、固定 W 的可读内容。设计见 `docs/UNIFIED_DISPATCH_FEEDBACK_DESIGN.md`。Manager、Core、Web、SDK 分开负责正式合同与实际消费者。反馈为参考数据，不改 Task 定义、不代表测试通过或人审通过，不隐式选最新、不在活跃 W 下另起 E。

遵循用户安排，所有应用、测试、类型、构建、服务、浏览器与外部模型运行继续后置；只进行源码、标准库 AST/JSON/hash 和只读 Git 检查。阶段完成后仅精确提交相关增量，不推送；完整目标仍 active。证据 `.sop-runtime/delivery-evidence/external-tool-workflow/`，临时目录 `.cache/external-tool-workflow/`。

源码交叉审查发现并要求修正：S/D 引用标识须跨 Manager/Core/Web/SDK 一致，但不能重定义现有项目、Task 与审核人标识域；S 摘要属于完整 Manager original，不能误算成 payload 摘要。Core 修订 2 已保留上述边界，Root 对固定五源完成独立源码审查，运行仍未验证。

Manager H 原请求最初没有直接绑定新增反馈权限范围，仅有计划摘要且不重算，存在两边列表同时丢失后漏查的接缝；已把明确 scope 列表写入 envelope.source 由原 managed request 摘要覆盖，并拒绝缺字段。W 的完整 original 摘要已包含反馈与合并权限，无需另建授权协议。

Web 补齐派发时同 Task 切换反馈来源的草稿隔离、失败预览具体原因、精确新工单选择回写及历史标题/问题引用显示。SDK 三源已封存，覆盖 W optional/null 三字段引用、原文件/同键重放及完整工作包摘要；E 保留既有正式接口。SDK 严格 CommandAck 与会话 journal、独立 W 自动运行器仍是后续范围。所有新增实际消费者检查定义均未执行。

权限验证的具体限制：当前运行身份模型中，可执行身份与按工作区读取权限的身份不是任意组合。现撤权 HTTP/H/延迟启动定义可能先被既有目标读取门禁拒绝，不能单独证明新增反馈来源门禁；后者现阶段由独立源码调用链及固定摘要绑定核实。后续运行验证必须补充能区分两道门禁的证据，不能把这些未运行定义或普通 403 当作独立通过证明。
