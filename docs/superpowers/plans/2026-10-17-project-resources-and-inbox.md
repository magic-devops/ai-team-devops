# 项目资料与交付待办实现

设计：docs/DELIVERY_PROJECT_INBOX_DESIGN.md。完整目标继续 active。

- [x] 项目资源与设置：真实 Project 字段、可恢复归档、作用域/角色、CAS/幂等/活动。
- [x] 交付待办：真实快照投影、个人身份、门禁/失效/阻塞/日期及纯读取。
- [x] 交互：资源编辑与冲突、个人/团队筛选与详情定位、概览关联、三语/窄屏/键盘。
- [x] OpenAPI、SDK、CLI与新增输入/响应一致。
- [x] 独立审查、定向与整体回归、构建、真实服务与浏览器验证、状态和完整待办更新。

最终验收：Manager 全量 384 项（80.82 秒）、SDK/CLI 定向 40 项、Web 全量 241 项（36 文件）、TypeScript 与 Vite 生产构建通过（77 秒，既有大包警告）。唯一一次独立审查的 1 项 Important 已修复并确认；实际 HTTP、桌面/390px 三语和键盘验证完成。最终项目切换第二项目 0 待办、0 资料，账号保持；返回原项目恢复 3 条资源及已保存草稿内容，没有误导只读。

证据：`.sop-runtime/delivery-evidence/project-inbox/`，最终日志归档于 `validation/`；文档定稿后由 root 统一保存 UI/验证汇总、源码与证据散列、临时目录清点及清理回执。完整剩余范围见 `docs/DELIVERY_WORKBENCH.md` 和 `memory/delivery-workbench-progress.md`，下一项为连续进度、基线、容量及项目组合归档治理，完整主目标 active、生产集成状态仍为 false。

收尾并发缺陷已修复：同一有效 token、两个完整项目作用域交替，12 并发 48 个纯 GET `/auth/me`，StaticPool 为 44 个 200、4 个 401，无写入且顺序全部 200；中间 QueuePool 为 19 个 200、29 个超时。最终文件 SQLite 使用 NullPool，内存 SQLite 保留 StaticPool，MySQL 及权限规则不变；相同并发全部 48 个 200、0 超时，新增 5 项连接池回归、定向 118 项及最终全量通过。`auth-concurrency-before.json`、`auth-concurrency-verified.json` 保留证据，修复前 Manager 379 项保留为历史，最终结果使用上述 384 项。

验收证据已完成清点：594 个本轮临时文件已计算散列，31 份重要日志/脚本/基线报告已保留到证据目录 validation/；随后仅清理已核实的 .cache/project-resources-inbox/。cleanup-receipt.json 记录删除范围及清点散列，源码、最终截图和运行中的隔离预览均保留。
