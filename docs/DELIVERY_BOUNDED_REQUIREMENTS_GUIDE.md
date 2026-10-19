# 需求详情、版本和变更审阅

需求工作台将当前状态、当前定义、历史版本、过程记录和受影响工作分开读取。普通打开只显示当前阶段、真实门禁和必要计数；正文、验收条件及各类详情按需加载。执行完成、人工验收和发布仍按原业务规则分别判断。

## 查看需求与过程记录

正文和验收条件来自精确定义，编辑和任务验收条件映射前必须成功读取。未读、失败或没有权限不能当成空正文或空条件。当前定义变化后，需要明确刷新并重新审阅，不能拿旧内容提交。

产物、评审与旧发布记录保留原用途，分别每页20条；展开才读取该条完整内容。API页上限100。记录位置只在同一查询代次有效，刷新后不能把旧位置当成永久历史ID。已有添加产物、阶段推进、退回和发布导航继续使用原业务命令。

## 固定版本与当前影响

版本目录只展示编号、时间、来源与记录者；选中版本再读取当时实际保存的原文。翻页固定最初窗口，不混入新记录。早期未观察的历史保持未知。当前需求已删除或当前索引不可用时，已保存版本仍可读取；当前定义不可读时，界面明确不能比较。

当前影响分为直接任务、依赖后继、执行记录、发布候选和部署。每类有独立计数、分页和精确目标；执行和部署按当前访问权限重新检查。无权对象仅显示受限数量，不暴露对象ID。计数与当前页来自同一代，发生变化时需刷新，不能拼接两代页面。

## 审阅并提交定义变更

修改标题、正文或验收条件前，先读取当前定义，再生成完整变更预览。预览展示真实字段差异、完整影响数量，以及旧测试、验收或发布是否会失效。当前显示的一页不是批准范围，完整预览不能只验证这一页。

完整预览在固定预算内校验必要原事实：最多10000影响任务、10000闭包任务、10000需求及每关联集合10000记录，依赖深度64，总输入16MiB，单项1MiB。预算按实际读取源的字节计算，包含JSON语法和存储转义，文本字符数不直接等于读取字节数。超限、缺关联、损坏或未就绪会明确禁止提交，不会将部分内容当作完整证明。提交时服务端在项目锁下重新核验。

提交结果未知时，保留原内容、原版本、原请求键及原预览依据，并锁定竞争操作和退出。重新加载同项目会话后仍恢复原请求；“重试原请求”只重放该原件，不能先换内容、更新依据或另造请求键。即使当前需求读取失败，也不能据此认定刚才写入失败。明确拒绝后才能显式重新读取并准备新请求。

## 客户端与维护边界

SDK与CLI提供独立的需求头、精确定义、版本目录/原件、过程记录页/原项、当前影响摘要/页/精确目标以及完整变更预览。当前definition、records与impact items必须带head或摘要返回的query_generation。游标固定项目、身份、对象、分类、页大小及必要代次，不可跨参数复用。读取不自动翻页、不自动写入，也不会自动生成批准命令。

SDK对应入口：`delivery_requirement`、`delivery_requirement_definition`、`delivery_requirement_history/version`、`delivery_requirement_records/record`、`delivery_requirement_impact/items/item`、`delivery_requirement_change_preview`。

先读取需求头或影响摘要取得实际GENERATION，再按需调用；不要使用示例数字代替实际返回值：

```text
sop delivery requirement --id REQUIREMENT_ID --json
sop delivery requirement-definition --id REQUIREMENT_ID --generation GENERATION --json
sop delivery requirement-history --id REQUIREMENT_ID --limit 20 --json
sop delivery requirement-history --id REQUIREMENT_ID --version VERSION_ID --json
sop delivery requirement-records --id REQUIREMENT_ID --collection reviews --generation GENERATION --json
sop delivery requirement-record --id REQUIREMENT_ID --collection artifacts --position 0 --generation GENERATION --json
sop delivery requirement-impact --id REQUIREMENT_ID --json
sop delivery requirement-impact-items --id REQUIREMENT_ID --kind dependent_task --generation GENERATION --limit 20 --json
sop delivery requirement-impact-item --id REQUIREMENT_ID --kind dependent_task --item TASK_ID --generation GENERATION --json
sop delivery requirement-change-preview --id REQUIREMENT_ID --file reviewed-proposal.json --json
```

预览文件结构为 `{ "requirement_basis": "实际64位摘要", "changes": { "description": "拟采用的正文" } }`。`changes: {}`合法，只读取完整当前影响；显式null不表示不变，应省略未修改字段。

需求更新仍使用requirement.update，携原requirement_basis、已审change_preview_basis、expected_version与idempotency_key。优先级等元数据修改与没有实际变化的请求不伪增定义版本。历史版本只允许实际观察追加，不能通过一般编辑修改历史。

当前SQL验证范围为SQLite，其他未验证方言明确不可用。受限传输与按需解码不代表恒定磁盘I/O。最终观察/查询投影仍有全项目写成本，未用部分历史替代。实际浏览器窄屏视觉与生产身份、模型、数据库和基础设施接入须另行验证。
