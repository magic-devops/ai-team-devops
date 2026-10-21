# T-delivery-operation-workflow

上一目标回合属于 progress：实际提交 `f716b65499ce18e37cf26f89f5438b8317a7bc25` 的 48 个相关文件；原件、源码审查、精确提交及空暂存区在 `.sop-runtime/delivery-evidence/external-tool-workflow/commit-receipt.json` 中核实，运行仍未验证。

本轮重新读取实际 HEAD、上一提交 48 个实际 blob 和回执，核对完整 80 项独立 Reflection 工作区原字节/删除状态并封存新 baseline。唯一用户原件继续保留。新证据目录 `.sop-runtime/delivery-evidence/delivery-operation-workflow/`，临时脚本 `.cache/delivery-operation-workflow/`。

源码审计区分了已有能力与真缺口：单独 Task GET 失败时 W/S 已能恢复；更高父查询/启动发现、重挂载 known ACK 和唯一所有者仍有缺口。SDK/CLI 没有严格正式 CommandAck 与原件 journal；原生无测试执行仍可能接受并计入验证进度，需要覆盖实际接受及统计链。

本阶段设计 `docs/DELIVERY_OPERATION_RECOVERY_DESIGN.md`：Web 完整 W/S 原件恢复、SDK/CLI 八动作原件流程、原生质量门。返工报告持久谱系与版本化工具执行配置继续作为完整后续切片，不用临时复制或 W 名称登记冒充实现。用户要求先源码与交互，全部应用导入、测试收集/执行、类型、构建、服务、模型、浏览器仍后置。阶段相关增量经独立源码审查后精确 commit，不推送；全目标继续 active。

独立源码读审已定位并反馈修正：SDK 严格响应解析与既有 events 局部 import 的同名遮蔽；仅配置三码的正式 W/S 消费者不能拿空 project_id 校验成功回执；prepared 占用任务槽位后需要安全取消未发送草稿；丢失操作 ID 后需要本地有界摘要列表。CLI 不应把所有可恢复错误都只显示异常类名，也不能回显原始认证或 HTTP 错误正文。

Web 正常面板与更高父查询失败页切换时，W/S pending 状态需按 kind/Task 转移到同一个父槽位，不能留下无法解除的 Task 聚合锁。恢复页主区显示实际动作，完整 JSON 留在详情；回执不匹配不能误报为本地存储故障。

质量读审确认 Manager 调用 Core TaskReview 为 dry_run，不能误称该调用已经写入 Core。Manager 在检查本地固定计划后核对相同 Core 质量事实，再由 Manager 保存正式业务审查。当前测试通过与历史审查仍有效需分别表达，界面“已验证”应绑定当前 run 版本、原证据摘要和保存质量事实，而不是只看 accepted 标签。

使用路径记录在 `docs/DELIVERY_OPERATION_RECOVERY_GUIDE.md`。上述均为源码与交互复核，尚未作为执行、渲染或生产稳定性证据；实际消费者检查定义随源码完善，但本阶段不收集或执行。

最终阶段按 Web 恢复 17、Core/Manager/界面质量 39、SDK/CLI 11 和 Root 阶段记录 4 个路径组装；只提交这 71 项相关增量。Web v2 修正初次 DOM 存储读失败的分类并提供受保护的重新载入入口；质量 v2 对损坏节点定义明确返回 invalid，不能静默丢掉异常元素或在没有 run 时抛出加载错误。旧冻结证据保留，候选只能使用最终版本。

独立源码审查、候选清单、HEAD 加阶段投影、原 80 项工作区隔离和提交回执分别写入本阶段证据目录。`client.py` 与 `memory/current_state.json` 是两个授权混合路径，必须只提交阶段投影并保留独立 Reflection 工作原件；其他 78 项原状态不纳入阶段提交。实际 commit、精确路径/blob、空暂存区和原件保全以最终 `commit-receipt.json` 为准，不在提交正文内预填自指 commit hash。

查询 schema 已提升为 7，但尚未运行显式授权重建。Windows 文件持久化、并发、崩溃恢复、HTTP 实际闭环、React 类型/渲染、可访问性和浏览器交互仍须在用户恢复验证窗口后核验。外部平台自动运行、历史报告持久谱系及完整研发全链路仍未全部完成；本阶段不声明 goal complete。
