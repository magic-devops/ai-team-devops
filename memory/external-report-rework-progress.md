# T-external-report-rework

上一已提交阶段为 progress：实际 HEAD `4d06264a58b6b19a16e8a3a3ce0bce767ee58cc5` 包含 71 项精确阶段增量，正式回执核实路径/blob、空暂存区、78 排除原字节及 2 个混合工作原件。额外出现的 DesignLibraryWorkbench 一行改动原样留在工作区，没有混入该提交。运行验证仍后置。

上一目标回合分类为 progress：实际源码审计定位了返工材料复用、固定 S/digest/Decision 谱系和来源 ACL 的真实缺口，并封存了 81 项下一阶段 baseline；该回合尚未实施返工生产代码，也没有运行测试。SDK 审计代理因用量限制结束，不能把此前意图当作仍在运行；本轮重新确认实际代理状态后分派新实现者。

本轮重新核实 HEAD、空暂存区、本地规则和 81 项 baseline 全部原字节/删除状态。baseline 位于 `.sop-runtime/delivery-evidence/external-report-rework/baseline/`，pin SHA256 `dc62acaf06428648ad50a2f3185bc026525d48afe7165333b6ad32d3bbe69638`。唯一用户源继续保留，不清理活动临时目录。

已确认设计见 `docs/EXTERNAL_REPORT_REWORK_DESIGN.md`。Manager、Web 与 SDK/CLI 分别实施服务端统一预览及不可变谱系、明确采用与草稿保护、固定来源的准备及原件恢复。历史说明和授权材料可复用，当前条件/测试结论及引用清空，不继承作者、W 或停止声明；变化需明确重新采用。

本轮属于 progress：已实际实施 Manager 7 路径、Web 13 路径、SDK/CLI 7 路径，以及设计、指南和阶段记录。SDK 实现者遇容量限制终止后，Root 先封存它的 7 项部分源码，再接续完成；Manager 实现者后来同样终止，不能把已停止代理当作仍在验证。Web 实现者完成 Manager/SDK 独立源码复核，Root 独立复核 Web。没有切换模型或启动运行负载。

Manager 正式只读预览统一生成授权历史材料和当前重置模板，提交再次核对精确来源与 basis。S 原件固定完整反馈、摘要、来源范围及当前 W 上下文，详情、历史、回执、事件、review 与后续反馈共用继承权限；不递归读取全部历史链。普通原件不补新增 null，只有选中谱系的 Submit ACK 回显严格 pair，Review ACK 不变。

Web 已落“选定退回报告 → 预览 → 明确采用 → 现有报告编辑/核对/提交”。采用时固定选中 S，避免新报告成为 latest 后阻断正在编辑的旧来源；异步回调重新核对账号、路由、权限、来源及其他编辑 scope。来源变化保留本次编辑，重新采用重置结果和引用；无当前写权限仍能关闭未发送编辑。沿用现有未知原件恢复机制。

SDK/CLI 保存完整 adopted preview 与显式 authored，准备前复核同一受保护业务来源，忽略无关 latest 和查询时间/代数。无效 authored 在 fresh 网络读取前拒绝；变化不创建 journal。CLI `rework-draft --output` 以 UTF-8 独占创建，不覆盖已有文件；send/resume 只发送既有原件，不重新选择或预览来源。

源码封版为 manager-source-final-v2（7 路径，18 个实际检查函数定义）、web-source-final-v1（13 路径）与 sdk-source-final-v1（7 路径，13 个检查函数定义）。Manager v2 仅新增一项实际 HTTP 定义，明确证明 S0 原范围为空而当前 W 有范围时，无 W binding/stop 的返工仍保存 W 范围，W 保持 claimed。上述定义全部未运行；函数数不是通过数量。独立源码复核记录位于阶段 evidence 的 independent-review/。

使用说明见 `docs/EXTERNAL_REPORT_REWORK_GUIDE.md`。本阶段拟精确提交 31 个相关路径；delivery.py、client.py 与 memory/current_state.json 必须按 HEAD 加本阶段增量投影，保留 Reflection 等独立工作原字节。81 项 baseline、唯一用户源和未拥有的 DesignLibrary 一行修复继续保留，不清理活动目录、不提交依赖缓存。实际 commit 身份与路径/blob、暂存区、原字节保留结果以阶段 `commit-receipt.json` 为准。

候选范围核对额外发现 5 项独立工作：登录页、skill_encoding.py、skill_repo.py、skills.py 和 test_skill_encoding.py。它们未进入原 81 项 baseline，已另外封存原字节、HEAD/index 和摘要于 additional-unowned-change-v1/RECEIPT.json（SHA256 `525f2f7d7564e088a8f738c8f21f8e77e7b2bb597d965ba0b1b74f9ab8404de7`）。这些源码不属于返工阶段，继续排除并保留；原 baseline 不被覆盖或追改，提交后应保留 86 项独立路径。

继续遵守用户源码和交互优先安排：全部应用导入、测试收集/执行、类型、构建、服务、provider 与浏览器验证均未启动。源码独立复核不代表功能稳定性或实际渲染验收。完成精确候选范围核对后按授权阶段 commit，不推送。下一步在窗口恢复后运行固定源码的后端、SDK/CLI、前端、类型、构建及浏览器检查，并继续版本化工具执行配置、自动执行适配和项目/需求/进度/质量/运维的完整主线。完整目标仍 active。
