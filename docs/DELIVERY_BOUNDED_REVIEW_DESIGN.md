# 有界人工验收与原请求恢复

任务：`T-bounded-review`；基线：`46e2b0e0c29cafb718fd372c741f6d9d14020d21`。

## 目标与边界

人工验收详情分为当前依据、历史目录、指定原件。历史目录不再计算全项目质量，不发送完整快照及证据正文。当前依据使用已有 canonical 验收算法的必要完整依赖闭包；预算不足明确失败，不以部分任务替代完整证明。写入继续在项目事务中校验完整版本、权限、任务依据与幂等键。无需保留旧组合读取契约。

进度/基线/需求影响有界读取及 Issue 反向来源另有阶段，不在本阶段声称完成。实机视觉、生产数据库和长期规模验证仍待完成。

## 读取契约

- `GET /api/v1/delivery/tasks/{task_id}/review-current`：`project_id/task_id/version/query_generation/as_of/current/effective_review_id`。当前任务证明用共享任务闭包加载器，包含父需求的全部任务、前置任务及必要身份/执行/质量证据；上限 500 个任务、依赖深度 64，单 JSON 叶子上限 1 MiB。沿用现有超限/缺失的明确错误，禁止截断后放行。读取前后确认相同查询代次；不修复索引，不写数据库。
- `GET /api/v1/delivery/tasks/{task_id}/reviews?limit=20&cursor=...`：`project_id/task_id/as_of/reviews/total/next_cursor/limit`。默认 20，最大 100；首次固定当前最大序号，后续页绑定租户、项目、阅读者、任务、页大小、固定窗口。新增记录不挤入旧窗口。每条只有 `id/task_id/decision/created_at/reviewer/task_basis/comment_summary/has_evidence/invalidated/invalidated_at/invalidated_reason/source`，摘要最多 240 字。不得装载完整 snapshot/comment/evidence，不返回 current 或 valid。
- `GET /api/v1/delivery/tasks/{task_id}/reviews/{review_id}`：`project_id/task_id/as_of/review`，review 包含原始快照、审查意见、证据和永久失效元数据，不含派生 valid。仅精确读取项目、任务及记录一致的原件。任务删除、当前证明过大或索引未刷新都不妨碍授权用户读取已存在的历史。没有任务且没有原件则 404。

历史接受记录表示一次人工决定；当前有效性只能来自当前证明。`effective_review_id` 只有当前 canonical 证明支持的人工接受可返回；运行证据托管任务不获得人工绕过路径。原件读取不尝试重新推断当前有效性。

## 交互与提交

当前验收区、历史目录独立加载和报错；查看原件才取完整证据。重试当前依据不重抓全部已加载历史页。历史明确区分曾接受、要求修改、永久失效与当前有效，失败时不将旧缓存显示成当前通过。保留现有主题、紧凑事实展示和可响应换行设计，中英日文案同步。

提交前冻结项目/会话、任务、依据、原版本、原键和完整 payload，并持久化原请求。结果未知只能重放该原件，不能修改、取消后重新发一个请求；刷新后能够恢复。明确拒绝后允许保留意见并显式读取/采用新依据再提交。项目、登录身份或路由改变后，旧请求不得借新会话发送，迟到响应不得覆盖当前页面。

提取已有 release command 状态机中可共享的原件存储、会话门禁及严格回执校验，保持 release 外部 API。人工命令回执必须匹配项目、action、`task_review` 类型及非空记录 ID、原版本 +1、单调当前版本、正查询代次和结构正确 result。affected refs 必须同时包含实际评审记录和原请求的 task ID；服务端结果返回该 task_ids，以既有统一回执机制绑定真实目标。错误回执按未知处理，保留原件。

## 验证与证据

先固定全项目装载、分页大正文及未知结果可变更的失败症状，再实现。覆盖同项目完整闭包与 canonical 结果相同、跨项目/用户游标拒绝、固定窗口、删除后原件可读、超限不误通过、GET 零数据库写入、持久化/会话切换/未知重放/严格回执。同步 SDK、CLI、OpenAPI 和永久测试。执行相关独立审查及最终完整 Manager、Web、SDK/CLI 回归、类型检查、构建和真实 HTTP 联调；证据保存在 `.sop-runtime/delivery-evidence/bounded-review/`。全部验证后按用户要求本地提交，不 push。
