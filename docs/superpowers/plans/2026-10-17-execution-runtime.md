# 执行日志与受控操作实施计划

> **For agentic workers:** 使用当前会话独立owner并行实施，root负责集成、实际验证及唯一最终独立审查。

**Goal:** 让真实节点输出、停止事实与业务受控操作在同一交付链路可读可恢复。
**Architecture:** 现Task/run/events/receipts/outbox；agentd流协议，Manager语义预览/CAS，四界面原位增强。
**Tech Stack:** 既有Go/Python/FastAPI/SQLAlchemy/React/AntD，无新依赖。
**Spec:** docs/DELIVERY_EXECUTION_RUNTIME_DESIGN.md。

## Task 1 Core与agentd（runtime owner）
- [x] 冻结共享run_controls/日志/stop helper合同通知Manager；新增严格协议测试RED。
- [x] agentd JSONL/控制、原子进程树与真实EOF停止证据；native消费/记录与安全净化。
- [x] paired独立持久日志批次/stop ACK，重放/权限/顺序/限额及原有outbox不重复保证。
- [x] 通用托管写入口收敛，共享start/retry/approval/cancel服务；专属GREEN/Go/格式/源证据hash后冻结。

## Task 2 Manager（domain owner）
- [x] 先冻结runtime/output/control-preview/payload DTO及函数通知UI/root。
- [x] 精确来源输出、历史read权限、净化observations、语义basis及受控commands领域逻辑，真实双权限和恢复。
- [x] 专属RED/GREEN与生产autoflush=False、旧来源/未知stop事实，不做服务/full/Git。

## Task 3 四界面（UI owner）
- [x] 根据冻结DTO完成API/helper真实回调RED，固定身份/key/body/409/unknown。
- [x] 运行概况/步骤日志/操作确认/历史恢复，原组件集成、三语、深链、分页、会话和退场。
- [x] 专属GREEN/类型一致性与源hash冻结，不服务/full/浏览器/安装/Git。

## Task 4 Root集成和交付
- [x] delivery routes/commands/后台仅已提交event调度；归档/项目组合纳入未确认stop，Issue节点定位。
- [x] SDK/CLI/OpenAPI/用户说明及当前待办清单更新，无兼容伪成功。
- [x] 真实native/paired agentd日志和停止/未知恢复、纯读/权限/验收保持；一次独立增量审查及原始复验。
- [x] 最终完整回归/类型/构建/Go/契约/lint，准确记录视觉/生产未验证项。
- [x] 更新memory与验收证据，安全清点/hash/精确清理；全部commit、不push及clean由外部commit-receipt.json确认，完整goal active。
