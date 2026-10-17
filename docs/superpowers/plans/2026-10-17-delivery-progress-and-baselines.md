# 真实进度历史与计划基线实施计划

> **For agentic workers:** 使用 subagent-driven-development 分工，按每项 RED→GREEN→集成验证推进，最终统一阶段提交。

**Goal:** 从真实事务保存持久进度观测，提供不可变计划基线、范围变化对比及可操作的进度图表。

**Architecture:** 现有 Project/Requirement/Task/Issue 与执行模块继续作为事实来源；新增 SQL 观测/基线，通过事务钩子和真实每日采集记录。新增只读 progress API 与原 Command 接口、SDK/CLI及紧凑工作台页面。

**Tech Stack:** FastAPI / SQLAlchemy / Python SDK / Typer / React / AntD / ECharts；不新增运行依赖。

**Spec:** docs/DELIVERY_PROGRESS_DESIGN.md。

- [x] 观测与事务：新 SQL 模型/捕获服务、有效状态口径、通用事务覆盖/Core登记、回滚与幂等、每日分页扫描及独立 lifespan；先写真实 SQL 行为红测。
- [x] 计划与查询：不可变 baseline.create、progress.record、日期/范围/basis/CAS/权限、历史日序列/缺口/当前比较及观测详情；新增 API 行为红测。
- [x] 交互与可视化：Progress 页、概览入口、双图与同源键盘明细、冻结与409恢复、历史详情、范围变化、三语/主题/390px/URL；先 helper/渲染行为红测。
- [x] API 契约与开发工具：OpenAPI 增量合并并保留既有契约，SDK progress/observation/baseline，CLI progress/observation/baseline 与固定 Command 示例；真实传输红绿验证。
- [x] 一次独立范围审查、最终定向与整体回归/类型/构建、隔离实际 HTTP/桌面/窄屏验证、证据及进度留档、清理临时目录、全部阶段 commit。

容量日历、项目组合/归档治理、可信 CI、真实部署回滚、生产身份及智能运维仍在完整主计划中，不能因为本阶段通过而删去或标记完成。

验收日志、临时目录清理及本阶段 Git 提交 SHA 以 `.sop-runtime/delivery-evidence/progress-baselines/` 回执为准。完整主目标继续 active。
