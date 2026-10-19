# 工具问题来源与人工需求回流

在项目交付工作台进入“问题与改进”，来源筛选选择“工具事件”。来源仅代表已成功执行的真实业务操作，不代表问题已经修复、测试通过或任务通过验收。

打开具体问题，展开工具来源目录。每条来源显示创建、修改或删除、上报账号、处理时间和指定回执。目录默认每页20条，点击下一页继续读取；刷新首页开始新的窗口，已有窗口不会混入后来上报的事件。来源中的文本不能授予运行工作区权限，也不能被当作运行链接。

点击“查看回执”打开该条来源的精确原件；返回后保留项目、问题与来源页。事件正文只在回执详情明确展开。原问题已删除时，已授权的来源历史仍可按明确问题ID读取，页面会说明当前问题不存在。原件缺失或不一致的来源明确不可用，不能作为诊断证据。

## 选取证据与审阅

在问题诊断中展开工具来源，逐项勾选需要发送的证据。选择跨页保留，下方列出已选来源并允许移除；问题记录为必选项，总计最多32项。默认问题证据与来源目录独立，系统不会替操作者选择第一页或把全部事件发送给模型。

提交前核对证据预览，再选择AI或规则诊断。诊断固定原问题、原版本、所选来源ID与摘要。来源选择变化仅影响未提交草稿；处理中或结果未知时保留原请求，先读取原结果，需要重放时仍使用原内容与原键。规则诊断提供调查与验收建议，不调用外部模型。

人工采纳前，服务器重新校验问题和所选原件。问题正文变化、原件损坏或权限不足时禁止采纳。编辑需求标题、描述和验收条件，填写人工意见后确认；一个问题只生成一个关联需求，重复原请求返回原结果。采纳后问题继续保持原状态，功能修复、测试和质量验收按后续需求链路完成。

## 工具查询

SDK在明确项目下使用：

```python
client.delivery_issues(source="event")
page = client.delivery_issue_origins(issue_id, limit=20)
if page["next_cursor"]:
    client.delivery_issue_origins(issue_id, limit=20, cursor=page["next_cursor"])
client.delivery_issue_origin(issue_id, origin_id)
```

CLI使用：

```text
sop delivery issues --source event
sop delivery issue-origins ISSUE_ID --limit 20 --json
sop delivery issue-origins ISSUE_ID --limit 20 --cursor 原游标 --json
sop delivery issue-origins ISSUE_ID --id ORIGIN_ID --json
```

精确来源查询不混用分页游标。`sop task issue`先保存固定原事件；输出中入队、送达和业务处理分开。只有已存真实回执的`processing.state=processed`与实际`result.target_id`能说明业务Issue已创建。pending或failed不表示业务成功；展示已有回执不会重新投递或换原事件。

## 已有项目与验证边界

查询结构版本为4。已有项目由具有configure权限的操作者明确执行既有`POST /api/v1/delivery/query/rebuild`，补齐可核验的成功Issue来源与查询索引。响应`origin_rebuild`分别报告新增、已有和跳过；不能证明规范操作的历史结果会跳过。重建不重新执行事件、不修改业务版本，GET不会自动补写。问题详情的`origin_summary.projection=rebuild_required`提示需要派生维护，不代表业务问题缺失。

`sop.issue.opened`及结构化`sop.sync.push`的issues创建、修改和删除共用实际业务门禁。任意事件里的issue_id、subject或描述不构成关联；没有配置真实处理器的generic/reflection仍待处理。

本阶段证据在`.sop-runtime/delivery-evidence/issue-origins/`。自动化交互、接口和构建检查与真实浏览器视觉分开记录；当前390px中英日实机视觉、其他数据库、生产身份/模型/基础设施及长期规模验证仍未完成。整体进度以`memory/delivery-workbench-progress.md`为准。
