# 从根因记录继续正式处置

根因列表的状态、评分和健康字段是来源自报。选择“核对并纳入问题”，检查完整脱敏来源、标题、严重程度和补充说明；已纳入时打开原问题。原始来源的关闭标记不会关闭正式问题。

问题详情继续使用既有诊断和人工审核，采纳到需求池后拆解任务、分配人或正式运行资源、执行测试并验收。部署与回滚仍使用受控发布工作台。归因和任务预览可继续使用；实际任务创建通过这条主链。

来源变化、版本冲突时保留输入，明确采用当前来源后再提交。超时或回执未知时恢复同一原请求；可以保留操作稍后继续。来源或列表读取失败时仍保留恢复入口。原请求同时绑定来源类型、项目、账号、版本、摘要和幂等键，不使用不同来源替代未知请求。

新增纯读 `/api/v1/delivery/rca/{source_id}/intake`，命令 `issue.rca.intake`。载荷恰含 source_id、source_digest、title、description、severity；正文还含 action、expected_version、idempotency_key。SDK 用 `delivery_rca_intake_source(source_id)` 读取，用 `delivery_ops_intake(original)` 提交保存的完整原件。CLI：

```text
sop delivery rca-intake-source --source-id <来源ID>
sop delivery rca-intake --file <完整原请求JSON>
```

同 ID 的 RCA 和自愈建议是独立来源，各自仅关联一个原问题。旧自愈原请求合同仍可按原 action 恢复。

数据库已有不含 source_type 的 ops_issue_sources 表时，启动会提示显式升级。恢复验证窗口后，先停止 Manager，使用相同 DATABASE_URL 执行既有 `sop-manager schema verify` 和 `sop-manager schema apply`，再验证并启动。升级保留原 Issue ID、摘要、原件、作者及时间；不会重绑历史记录或在 GET 时修复。遇到未知/中间表结构会拒绝，不自动丢弃数据。

旧 RCA verify、resolve、verification-plan 接口退出。Runbook 只归集来源记录，自报验收、执行记录不能填平正式验证缺口。

当前仅源码实现与审查，HTTP、数据库升级、客户端、类型、构建及浏览器行为尚未运行；自动运维、真实探针和生产闭环仍未验收。
