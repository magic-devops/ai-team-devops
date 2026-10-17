# T-delivery-attention 实施计划

基线 `7bd27cd`；设计见 `docs/DELIVERY_ATTENTION_DESIGN.md`。完整产品目标保持 active。

1. 已完成只读核验：默认 inbox/progress 全项目读取及独立人工任务遗漏，保留 SQL 探针；对象级讨论及客户端基线另记。
2. 后端先 RED：schema 2 派生待办、SQL 分页与当前资格、轻量 summary，证明纯 GET 无全量载入与写入；实现同事务索引刷新。
3. 前端先 RED：服务端分类/分页、URL 返回恢复、过期重置、人工/执行标签；首页使用 summary 和 context 代次，不保留独立全量轮询。
4. SDK/CLI 先 RED：inbox category/limit/cursor 与 progress-summary；同步 OpenAPI 及使用示例。
5. 定向与完整受影响套件、类型/构建、实际本地 HTTP、规模读探针；记录真实限制，独立复核修复已验证问题。
6. 更新能力矩阵与项目记忆，保留证据与源码散列，清理精确任务目录；全部已验证修改 commit，不推送。

所有权：workflow agent 负责后端；collaboration agent 负责前端；clients agent 负责 SDK/CLI；root 负责契约、集成验证、文档、收尾和提交。不交叉覆盖他人修改，不新增依赖。

已完成步骤1–5并更新记忆；全量结果与范围见工作台增量记录及phase-verification.json。步骤6由root核对源码、清理精确任务目录并commit。完整产品目标仍active。
