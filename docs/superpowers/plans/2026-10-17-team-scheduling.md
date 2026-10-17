# Team Scheduling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development；后端领域/事务、界面、客户端/契约分工实施，root统一集成和阶段commit。

**Goal:** 让真实团队资源日历、显式工作预留和统一依赖排期可查看、编辑、比较冲突并原子保存。

**Architecture:** 使用现DeliveryWorkspace.member_calendars及task_details.allocations，独立planning_basis、共享单任务/批量最终图校验，纯读日格和预览；不复制Task/owner或创建兼容桥。

**Tech Stack:** FastAPI/SQLAlchemy/Pydantic、React/AntD、语义CSS grid/SVG、现SDK/Typer；不新增运行依赖。

**Spec:** docs/DELIVERY_SCHEDULING_DESIGN.md

## Global Constraints

- 人小时/日步长0.5，Agent/tool整数槽位/日；weekly null未知/0不可用；不从XS–XL推算，不混合利用率。
- 显式weekday周一0..周日6、日期含首尾，容量改变不重排预留；只有有效验收释放活动负荷。
- 固定完整项目planning_basis/CAS/幂等，单任务与batch共享校验，纯规划不作废验收。
- 纯读取/预览不写数据或调用模型；当前项目作用域不冒称跨项目余力。
- 基线4fd0618；用户无需不必要历史兼容；完成验证后全部commit，不推送。

## Review Focus

- 日期/预留同次改期仍按最终对象校验，不能有单任务旁路或批次部分生效。
- 全量日历替换不遗漏窗口外例外；null、0和未登记工作量不可混淆。
- 成员失活/删除、同名/跨项目、kind变更不能重新解释或重新归属预留。
- 过滤器外依赖和负荷仍参与冲突；已结束但未验收不被移动或误释放。
- 编辑期间数据刷新/删除不丢草稿；最新读取失败清旧候选，URL返回恢复真实上下文。

## Task 1: 领域、接口与事务（backend owner）

Files: 新 delivery_scheduling.py / delivery_scheduling_contract.py 与 test_delivery_scheduling.py；修改 delivery_contract.py、delivery.py、delivery_service.py、delivery_plan.py等实际复用点。

- [x] 真实SQL/API红测严格单位、weekdays/重叠/范围、null与0、跨项目/失活、新旧写门禁和原子回滚。
- [x] 实现MemberEdit去capacity、不可变kind、完整日历与显式预留、全项目planning_basis、typedGET/纯读preview/两Command；向UI/root锁定精确shape。
- [x] 实现同源活动负荷/全部预留与异常；验证只有verified释放、日期/预留/日历不失效验收、窗口外例外和筛选外图/负荷。
- [x] 定向红绿、相关lint，冻结源交root，不自行服务/fullsuite/commit。

## Task 2: 界面（UI owner）

Files: 新共享 scheduling helpers/types、DeliveryScheduling、CapacityCalendar、DependencyTimeline、资源编辑器/批量预览及三语/CSS；修改Workbench team/timeline、共享TaskPlanMaintenance/Editor、深链保存与行为测试。

- [x] 先合同/编辑会话/冲突/真实渲染行为红测，覆盖四界面状态和数据单位。
- [x] 团队/里程碑二级模式、同源日期栅格及390列表、辅助依赖连线与键盘、筛选URL/任务精确定位和返回恢复。
- [x] 完整容量编辑/显式预留/批量预览原子提交，失败保留、旧基准明确采用及删除保护；移除旧capacity负载和表单。
- [x] 定向测试/类型检查冻结；root真实浏览器，UI owner不运行full/build/服务。

## Task 3: 客户端与契约（root）

- [x] SDK GET schedule/preview、CLI schedule/schedule-preview 传输与错误红绿，严格日期/范围及固定原body。
- [x] OpenAPI使用实际模型与条件，替换MemberEdit/TaskEdit正确schema，新增路径/动作并核验引用及真实模型边界。

## Task 4: 集成验收与提交（root）

- [x] 唯一独立范围审查，修复定点发现并验证原问题。
- [x] Manager/Web/client相关回归、类型/构建、最终源真实HTTP与桌面/390/三语/键盘；无外部模型调用。
- [x] 更新完整剩余范围与memory，重要源/截图/证据散列，安全清理任务scratch，全部阶段commit，核对clean、不push。
