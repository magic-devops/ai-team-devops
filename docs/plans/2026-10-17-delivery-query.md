# 有界交付查询实施

任务T-delivery-query；基线1cec3e6，设计见docs/DELIVERY_QUERY_DESIGN.md。完整目标继续active，阶段验证后全部commit，不push。

1. 核验基线并完成SQL/数据流/真实万级审计，冻结派生索引、精确读取、统一ack和四界面设计。
2. 共享事实计算器消除重复读取及需求×任务遍历，保持现有验收/依赖/永久失效规则。
3. 同事务派生索引、准确分页/全范围统计、局部JSON读取、精确对象、引用目录及统一命令回执。
4. UI全部first-party交付路径切换窄数据服务；固定编辑、返回、候选和未知提交恢复保持，不回退整包。
5. SDK/CLI、OpenAPI、使用说明同步；相关和万级SQL、实际HTTP、交互/三语/类型/构建验证。
6. 一次最终独立审查、原问题复验、最终回归；状态与证据留档，盘点清理任务scratch后全部commit。

所有权：query_backend_audit负责新query模块/派生表/后端路由及command ack；query_scale_audit负责既有事实计算和实际规模证据；query_ui_audit负责交付UI与窄类型/调用链；root负责合同协调、SDK/CLI/OpenAPI、状态/文档与最终集成验证。共享文件修改提前协调，已冻结源在最终验证中不变动。

2026-10-18阶段验证完成：最终Manager1400、Web587/114文件、相关SDK/CLI105通过，完整类型与构建通过；6项P2修复后独立复验通过。万级15次定向读与真实HTTP均通过。完整客户端仍有2项未变的既存断言失败，390px实机及生产集成未完成；显式人工评审仍保留全项目计算成本。完整目标继续active，清理与全部阶段提交以 `.sop-runtime/delivery-evidence/delivery-query/commit-receipt.json` 为准，不push。
