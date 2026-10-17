# External Agent Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development；runtime、Manager、Web与root契约分工，同一stage统一验收提交。

**Goal:** 让公开配置的真实远程Agent执行、后置命令测试、人工验收和问题回流形成一个可核验交付链。

**Architecture:** 复用Task/DeliveryWorkspace intent及Hermes device/run/events；独立presence与配置CAS、完整依据预览、串行Agent+测试，同源证据与业务人审。

**Tech Stack:** 现FastAPI/SQLAlchemy/Pydantic、Hermes Python/Go agentd、React/AntD、SDK/Typer，无新运行依赖。

**Spec:** docs/DELIVERY_EXTERNAL_EXECUTION_DESIGN.md

## Global Constraints

- 基线17145e3；user无需不必要历史兼容；不扩生产账户/收费调用。
- 设备presence120秒、独立表不改变device配置版本；auth未知；策略和能力双判。
- 单Agent后置command测试不自动验收，失败issue唯一；server校验固定Agent绑定。
- task/target依据、配置版本、SQL CAS与原身份幂等；纯预览所有表零写。
- 只有runtime owner修改Hermes；root统一full/build/service/browser/commit。

## Review Focus

- worker替换/能力变化/凭据轮换使旧目标不可静默继续，心跳时间不导致持续409。
- Agent伪成功不能解锁后置测试；Agent文本不变成测试报告。
- 公开配置与读取不泄漏/扩大凭据；项目、workspace与device授权分别检查。
- 工作区切换/目标撤销/409保留草稿，第二次读取失败清候选，不能自动退成本机。
- 失败、断线和重试不重复运行或issue；实际观测与缺失/未知/截断明确。

## Task 1 Runtime

- [x] 先真实SQL/API RED，补公开runtime-policy、device presence及共享目标读取/选择/校验，向Manager锁定函数/精确shape。
- [x] 单Agent后置test_nodes、remote结果绑定、worker检测与续鲜/outbox，最小来源证据与恢复复验。
- [x] 现有相关Hermes定向和新增tests、lint冻结，不服务/full/commit。

## Task 2 Manager

- [x] typed targets/preview/observations、ExecutionQueue固定task/target/mode/Agent/测试、共享validation和原始snapshot。
- [x] 纯读审计豁免、后台投影结构证据/三阶段与具体issue关系，依赖/验收/幂等/失效门禁不旁路。
- [x] 真实SQL/API RED→GREEN、相关定向冻结，不Hermes/服务/full/commit。

## Task 3 Web

- [x] 先会话/接口/预览/冲突/URL/状态 RED，等待精确typed shape，不猜字段。
- [x] 四界面与命令表单、当前运行/历史/测试证据/具体issue，移除旧名称领取/心跳/报告写UI。
- [x] 三语/390/键盘/作用域/失败保留、定向/tsc冻结，不服务/full/build/commit。

## Task 4 Root contracts and completion

- [x] 删除旧不可信写路由及SDK/CLI入口，补canonical SDK/CLI和OpenAPI实际模型/条件/纯读契约。
- [x] 唯一独立审查、全相关回归/类型/build/实际公开API真worker进程、桌面/390/三语/键盘。
- [x] 更新完整待办/memory、源和证据hash、精确scratch清理、全部commit并clean，不push；最终Git事务及clean状态以同阶段commit-receipt.json为准。
