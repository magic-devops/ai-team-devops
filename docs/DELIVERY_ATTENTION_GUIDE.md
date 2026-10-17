# 交付待办与概览

研发全流程的概览显示本人事项的四类计数。点击工作、阶段评审、待验收或阻塞数字进入对应列表；本人/团队、分类和当前页保存在网址，浏览器返回可以恢复。列表数字表示当前分类全部匹配数量，卡片仅为当前页；分类计数覆盖所选本人或团队的完整范围。

“待人工验收”表示任务已登记完成，尚无当前有效验收；“执行待审查”表示当前运行需要审核。打开卡片时重新读取任务，按当前归属进入详情。任务删除、无权或读取失败时保留列表并显示错误；打开详情和标记完成都不会自动通过验收。

有审批权限的成员可以在原任务评审区核对当前定义、证据及意见。通过后待验收事项消失；任务内容变化导致原验收失效时重新出现。原生执行管理的任务继续从执行证据审查，不能借人工入口绕过。

## API 与客户端

`GET /api/v1/delivery/inbox` 支持 scope、category、limit 和 cursor。默认 mine/all/20，limit 为 1..100，category 为 all/work/approval/acceptance/blocked/overdue。counts 为完整所选 scope，total 为当前分类匹配数，items 为本页；has_more 与 next_cursor 指示是否可继续。最多显示 5 条阻塞摘要，blocked_reason_count 是完整条数。

```python
page = client.delivery_inbox(scope="mine", category="acceptance", limit=20)
if page["has_more"]:
    next_page = client.delivery_inbox(
        scope="mine", category="acceptance", limit=20,
        cursor=page["next_cursor"],
    )
summary = client.delivery_progress_summary()
```

```text
sop delivery inbox --scope mine --category acceptance --limit 20 --json
sop delivery inbox --scope mine --category acceptance --limit 20 --cursor <next_cursor> --json
sop delivery progress-summary --starts-on 2026-10-01 --ends-on 2026-10-18 --json
```

下一页必须保留相同项目、身份、scope、category 和 limit。项目数据、审批资格或 UTC 日期变化时旧游标返回 409，应明确返回首屏；不要把新旧页合并。跨身份、项目或筛选的游标返回 422。

`GET /api/v1/delivery/progress/summary` 返回项目当前有效指标与 UTC 日期覆盖，不含任务、历史正文或计划基线。开始/结束日期最多 366 日；缺失历史为空缺，未来日期单列。完整历史图、冻结基线比较及观测详情仍在进度页按需打开。

派生查询 schema 为 2。缺少当前索引返回 `delivery_query_rebuild_required`，context 将状态标为 rebuild_required；具备项目配置权限的成员可在界面或使用 `sop delivery query-rebuild` 明确重建。GET 不修库，重建不制造进度观测或修改业务记录。

## 已知范围

概览与待办已采用有界读取；主动打开的完整进度、人工评审、需求影响和质量等专属详情仍有全项目计算，后续继续改进。对象讨论、结论采纳、来源摘要与通用活动仍待补齐。实际 390px 三语渲染及生产集成未完成验证，不能将结构与交互测试当作实机视觉结论。
