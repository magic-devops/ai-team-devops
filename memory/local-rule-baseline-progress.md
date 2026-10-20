# 本地规则与能力声明恢复

阶段：`T-local-rule-baseline`；2026-10-20；开始时HEAD为`61e9b7868fb823c28b470545845c5efa6152537d`。

- 根`.ai-memory`由旧外部失效目标改为仓库内相对`.sop-runtime/ai-memory`。仅解除链接自身，没有访问或改写旧目标。
- 保留现有runtime全部1个文件和4个目录；只新增原先缺失的`rules/RULES.md`与`ai_capabilities.json`。前者逐字节来自已追踪的`docs/PROJECT_RULES.md`，后者来自原固定Ops `ae24f7c`的唯一注册模板。
- 普通权限创建临时链接遇WinError1314，原件未改动；获准恢复后，实际读取又发现正斜杠reparse目标的Windows I/O问题。改用原生路径表示后，从根别名实际读取规则和注册文件，不以仅可resolve代替可读验证。
- 本阶段只做文件、路径和JSON核验，不运行hook、初始化器、应用、测试、SDK、模型或服务，不启用新hook或覆盖可选policy。
- 能力声明不是连接证明；Claude统一hook绑定、CLI规则资产同步的拒链接契约仍待独立实现和验收。Manager12/Web6及当前Reflection增量仍待正式回归，完整目标未完成。

提交范围仅为根链接、两份本阶段文档和本记录；本地配置和业务数据继续忽略，未验证的业务改动不混入。详情见`docs/LOCAL_RULE_BASELINE.md`，证据与提交身份见`.sop-runtime/delivery-evidence/local-rule-baseline/`。未推送。
