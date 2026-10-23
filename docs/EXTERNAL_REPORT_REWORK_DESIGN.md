# 外部报告返工与固定来源

阶段 `T-external-report-rework`，基线 `4d06264a58b6b19a16e8a3a3ce0bce767ee58cc5`。继续已确认的紧凑协作工作台与服务端业务归属，完善退回后的再次交付。应用导入、测试收集/执行、类型、构建、服务和浏览器验证按用户安排后置；本文描述实现合同，不代表运行验收。

## 已确认的缺口

当前报告详情能读取历史 S 和人工 Decision，退回后也能把固定反馈派给执行资源，但没有准备返工报告的完整入口。空白新稿需要重新录入；现有 `adoptSubmissionDraft` 会保留匹配条件的结论和整组测试，不能作为历史报告复用器。

`freeze_feedback` 已验证完整原报告、精确 S/digest/Decision、真实审查记录及历史运行范围权限，可复用为来源准入。当前 S 原件没有返工谱系，共享范围查询只读取自身 native boundary 和 W；若只在界面加链接，会遗漏历史材料的读取权限。

## 业务选择

返工从用户明确选中的报告及退回决定开始，不自动选择最新记录。允许沿用已授权的说明文字和 artifact 材料，但不沿用结论：当前全部验收条件重置为 unknown、证据引用清空；源测试只保留 id/title，状态为 not_run、引用清空。本次 source 身份须重新明确填写，不借用原 submitted_by；旧 W、停止声明和测试通过状态不继承。

历史材料可用于对照和编辑，界面及新报告审阅显示其固定来源。自动复用不会把这些材料变成本次已通过证据。用户编辑后仍按现有明确填报、人工审查及当前依据准入完成报告。若需关联当前 W，须本次明确选择并重新确认停止声明。

采用服务端统一生成草稿；不在 Web、SDK、CLI 各维护一套复制规则。不创建另一套任务、返工运行器、journal 或可变的谱系存储。

## 正式合同

只读预览为 `POST /api/v1/delivery/tasks/{T}/delivery-submissions/rework-preview`，请求只含 `rework_reference`，其类型复用 `FeedbackReference` 的三元组 submission_id、submission_digest、decision_id。

预览返回项目/任务/版本/查询代数、当前 SubmissionCurrent、固定 reference 与 rework_basis、完整 feedback_context 与摘要，以及统一 draft、allowed 和 reasons。draft 的 source 为 null，summary/artifacts 来自已授权历史材料，criteria 来自当前完整条件，tests 按上述规则重置；draft 不含可继承的 work_order。

rework_basis 确定性绑定引用、完整反馈摘要与固定范围、当前 task/definition/native bases、当前 W 上下文及重置模板。时间、刷新次数和“最新 S”不参与；原件准备后的版本与请求键仍由现有命令机制保护。完整预览不得超过 256 KiB，预算不足明确失败，不截断原件或材料。

当前事实不可读时直接返回明确错误，不伪造 current。来源不存在、无权限、损坏或超预算分别使用真实 HTTP 错误；不另造成功响应但上下文、basis 和草稿全为空的分支。仅当前 can_submit=false 时允许完整预览配 allowed=false 与理由，仍保留已核实的来源。

`task.delivery.submit` 增加成对的 rework_reference 与 rework_basis。普通已保存原件缺少这对字段时保持原样，不补 null 或替换历史版本。选择谱系后必须完整成对。提交时重新校验来源原件、权限、当前定义和 basis，不能相信客户端的复制或声明。

选中时，正式 Submit ACK 的 result 回显同一 rework_reference 与 rework_basis；客户端须按保存原件严格核对。普通报告及 Review ACK 保持现有正式语义：审查原件中的 S/digest 已固定完整报告及谱系，不额外扩展审查请求。历史 Command fingerprint 使用原始请求，新增可选字段不得改变已有原件重放的身份。

## 持久化与权限

沿用不可变 S 原件，在 original.rework 中保存 `manager.submission-rework.v1` 的 reference、basis、完整 feedback_context、feedback_context_sha256、feedback_runtime_scopes 与必填的 target_work_order（当前 W 薄上下文或 null）。该对象被 S 的完整摘要保护，既有写入守卫保护其不可变性；不新增数据库表或独立存储。

target_work_order 只固定预览所见的当前上下文，不表示本次已关联工单或已停止执行。即使本次报告不选择 W，固定范围仍须合并该当前 W 的运行读取范围；因为保存的上下文已包含它的身份及执行资源。显式 W 关联继续使用本次独立停止声明。

原件校验核对 payload 与谱系的引用、basis 和上下文。共享 scope loader 薄读固定谱系范围并合并自身及 W 范围，后续返工继承源 S 已固定的完整范围；不通过递归下载全部历史链获取权限。

这条范围规则必须进入详情、历史、locator、正式回执重放、事件和后续反馈消费者。读取新的报告不能绕过所沿用历史材料的权限。来源损坏、缺少选中谱系或范围不可校验时明确拒绝，不修补原件。

## 界面流程

在明确选中的退回报告旁提供“准备返工报告”。一次预览集中展示来源决定、当前条件差异、可沿用材料和重置清单；用户明确采用后进入现有报告编辑界面，再核对、确认提交。

预览前及异步完成后检查当前账号、项目、路由、选中 S/digest/Decision 和其他草稿。读取失败保留原位置与已编辑正文。准备前复核相同 reference/basis；若定义发生变化，提示明确重新采用，不能静默把新条件摘要塞入旧结论。

关闭编辑与当前写权限分开，避免撤权后无法退出；草稿和未知原件使用现有退出保护与单一操作所有者。未知命令恢复只发送原版本、原正文和原请求键，不重新预览或选择来源。

## SDK 与 CLI

SDK 提供 rework_draft 与 prepare_rework，仍使用现有八动作的正式 submit 和 DeliveryJournal。CLI 在既有 operation 下增加 rework-draft 与 prepare-rework。

rework-draft 读取明确 S 的详情及该 S 的退回决定，然后输出服务端预览与可编辑 adopted 源。采用文档 schema 为 `manager.submission-rework-adoption.v1`，包含完整 preview 与 authored。预览上限 256 KiB，完整采用文档上限 512 KiB，本次正式报告仍受 48 KiB 限制。CLI 可用 `--output` 独占创建 UTF-8 文件，已有文件不覆盖；不指定时输出 JSON。此步骤不创建 journal。

用户只修改本次 authored 字段，保留完整 preview 及已采用的 rework_reference 与 rework_basis。prepare-rework 必须读取这份固定来源，再对同一 server preview 复核；变化时不建立 journal、不发正式 command，并要求明确重新采用。无关的最新报告身份、查询时间和代数变化不改变已采用的业务来源；当前事实和权限仍必须重新满足。

不能用裸报告加 S-ID 在准备时自动取得新 basis。发送与恢复阶段也不能补条件、更新预览或替换原件。普通报告与既有原件仍按其实际保存字段恢复。

## 源码交付与待验

先编写覆盖实际 HTTP、权限撤销、正式回执、后续反馈、Web 回调以及 SDK/CLI 消费者的检查定义，再实现对应行为；本阶段定义不收集或运行。独立源码审查覆盖实际消费者和合同，不能替代运行验证。

本阶段保留 81 项独立工作原件。必要混合文件只提交 HEAD 加阶段增量，不整文件纳入其他工作。缓存、原始凭据及会话数据不入 Git。阶段提交使用精确清单、源码摘要和提交回执，不推送。

完整研发全链路目标继续保持 active。版本化工具执行配置、自动执行适配和完整运行验收仍需后续完成，本阶段不能据此宣称全部平台已接通或全流程已验证。
