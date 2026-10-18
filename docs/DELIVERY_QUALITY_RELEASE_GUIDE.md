# 质量检查与版本目录

交付工作台的“质量”页浏览需求和独立任务，“版本”页浏览候选、CI 证据及人工历史。每类目录独立读取一页，显示当前页条数和完整匹配总数；搜索与筛选由服务器执行。下一页沿用当前查询代次，浏览器返回可恢复原窗口。

## 检查与选择

勾选需求会选择它的全部任务，独立任务可单独勾选。选择跨页保留，也可逐个取消；不会自动选择第一条。打开“检查质量”后才读取验收条件、任务证明及阻塞原因。显示的完整范围摘要与本页目录数量分别计算。

范围检查包括相关前驱，以及这些前驱所属需求的完整工作集。最多 500 个任务、依赖深度最多 64 层，过大范围明确提示无法在本次同步检查完成；不会只检查前 500 条并宣布通过。单个大需求不能通过只勾选部分关联任务绕过限制。此时需要调整合理的交付边界；超大完整范围的后台验算尚未实现。

目录中的 CI 通过或候选批准是已登记的结果，当前有效性在详情重新核验。原提交、制品摘要、签名信封、候选快照、评审历史仍以选中的原件为准。历史人工记录仅是摘要，不产生可信构建或已验证部署。

候选创建后，若当前范围增长而超过同步检查预算，仍可查看原候选和 CI 原件，并明确显示当前证明未完成；此时不能批准，也不会把“无法完成本次检查”当作永久失效。具有资格的人员仍可拒绝或撤回该原件。

## 编制与恢复

先明确范围、检查质量，再导入该范围的签名 CI。编制候选时通过独立分页的 CI 目录选择证据，填写版本、环境、制品链接、说明和回退方案，然后读取服务端预览。修改内容需重新预览；批准候选后仍需完成实际部署验证。

并发变化会要求刷新与核对。页面按项目、会话及查询代次隔离读取，不能把新目录和旧范围混合后继续提交。请求结果未知时保留原内容、原版本与原键，只能重试原请求；不要修改正文另发一次。明确拒绝后可读取新依据，核对后再建立新意图。

## CLI 与 SDK

以下命令每次只读取一页，不自动翻页。继续时原样传回 `next_cursor`；游标不能用于另一个项目、账号、筛选或页大小。

```powershell
sop delivery quality --kind requirement --readiness attention --limit 20
sop delivery quality --task-id T-independent
sop delivery releases --kind candidate --limit 20
sop delivery releases --kind evidence --query COMMIT_SHA --limit 20
sop delivery releases --kind evidence --id CI_ID
sop delivery releases --id RELEASE_ID
sop delivery release-context
```

SDK 对应 `delivery_quality_catalogue()`、`delivery_quality(requirement_ids=..., task_ids=...)`、`delivery_release_page(kind=...)`、`delivery_release_evidence(id)`、`delivery_release(id)` 和 `delivery_releases()`。最后一个方法只读策略、权限与目录总数。空范围的 `delivery_quality()` 明确拒绝。

索引缺失或结构版本过旧时，有项目配置权限的成员执行 `sop delivery query-rebuild`。这只维护派生查询数据；普通读取不会自动修复，也不创建业务工作区。新写入仍需原版本与幂等键。

当前真实 390px 中英日视觉、生产接入及长期规模验证仍待完成；组件、静态渲染和构建检查不能替代这些验证。
