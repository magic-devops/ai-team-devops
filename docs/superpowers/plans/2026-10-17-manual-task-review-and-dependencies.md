# 人工任务验收与交付依赖消费实施计划

> **For agentic workers:** 使用 subagent-driven-development，后端验收/事务与依赖消费、界面、契约客户端并行，完成后统一集成验证与阶段提交。

**Goal:** 让人工任务获得可核对的验收证据，并让进度、依赖和旧派单消费同一有效交付事实。

**Architecture:** canonical Task/Requirement不复制；新增SQL审查历史及永久失效，复用Command CAS/receipt和通用事务观测，提取无递归验收判定。派单与依赖操作按真实作用域直接使用唯一交付图，不增加历史兼容或双源桥。UI复用任务详情与固定表单基准。

**Tech Stack:** FastAPI/SQLAlchemy/Pydantic、React/AntD、SDK/Typer，无新运行依赖。

**Spec:** docs/DELIVERY_MANUAL_REVIEW_DESIGN.md。

- [x] 验收后端：真实行为红测，独立审查表/资格/basis/审查/幂等/权限、查询分页与删除历史、通用事务永久失效、六态与依赖口径一致。
- [x] 统一依赖：DeliveryWorkspace图进入dispatch/scheduler/feed与依赖操作，真实作用域/有效验收/权限和版本；移除旧文件图消费及不必要兼容，定向红绿测试。
- [x] 界面：当前资格、专用人工验收表单、证据/决定/失效历史，固定基准与409显式恢复，独立任务/三语/窄屏/深链；先行为红测。
- [x] 契约与客户端：实际response_model/OpenAPI增量保留既有接口，SDK task reviews 与 CLI reviews，真实传输和错误测试。
- [x] 一次独立范围审查、回归/类型/构建、隔离HTTP/浏览器，证据与完整剩余范围留档，清点清理临时目录，全部阶段commit。

实际验收、散列清点、临时目录清理及本阶段Git提交SHA以 `.sop-runtime/delivery-evidence/manual-task-review/` 回执为准。完整主目标继续active，未推送。
