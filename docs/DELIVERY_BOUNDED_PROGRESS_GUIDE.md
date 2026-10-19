# 进度、历史原件与基线冻结

进度工作台按当前项目和范围展示真实观察曲线。可选项目、里程碑或迭代；指标覆盖整个所选范围，列表的页大小不影响总数。只有已通过有效人工验收的任务计入 `verified_completed` 并减少剩余量，执行完成、等待验收、需求验收与发布含义不同，不能相互替代。日期以UTC为准，缺失及未来日期保留空点。

## 查看原计划和历史事实

打开基线目录后，明确选择“使用”或“查看原计划”。界面目录固定每页20项，API最多允许100项；选择页外基线也按明确ID读取。原观察、原基线、当前任务是不同事实：历史保留原标题、原范围和原内容，即使当前任务已修改或删除，仍可读取原件。打开当前任务会重新检查当前项目权限和实际父需求。

任务、需求及差异分类分别分页。展开某项才读取完整原项。分页游标固定原来源、阅读者、范围和页大小；基线目录还固定初始命令版本水位，翻页不会混入新创建的基线。不要将游标用于其他账户、范围、页大小或来源。当前比较固定查询代次，代次变化时需要明确刷新。

差异摘要提供新增、移除、计划变化、未变化和信息不完整的总量。计划变化与信息不完整可能重叠，不能把这些数字相加当作总任务数。旧原件缺少某项计划信息时会保留未知状态，不会猜成空值。原件损坏、单项过大、权限失效和读取失败都有明确反馈；失败不会替换成当前内容或假空列表。

## 记录观察与冻结基线

刷新和其他GET读取不会创建观察。选择“记录观察”才会发出明确写入命令。

冻结前先读取完整范围证明，再审阅任务数、范围、标题、日期和备注。完整证明表示已捕获全部范围，不表示全部任务已通过验收。合法空范围可以冻结为空计划；缺失、损坏或超预算的范围不能按空范围冻结。固定预算为10000范围任务、10000必要闭包任务、10000需求、64层依赖深度、16MiB总输入和1MiB单项，依赖环也会明确拒绝；服务端写入会重新核验。

提交响应不确定时，界面保留原内容、原版本和原请求键，并锁定退出及竞争操作。点击“重试原请求”使用同一原件重试；接口会返回已应用的原结果或继续处理该原请求。重新加载后仍恢复同会话原请求；不能修改标题或任务集合后冒用原请求重试。只有收到明确拒绝后，才可明确重新读取证明并准备新的请求。记录观察与冻结基线分别保存，互不覆盖。

## SDK与命令行

SDK使用显式项目与当前身份。以下读取分别返回小型曲线、小头、摘要页、精确原项、比较或完整证明，不会自动下载全部任务，也不会自动提交。

| 用途 | Python SDK |
| --- | --- |
| 进度曲线 | `delivery_progress(scope="milestone", scope_id="M-one")` |
| 基线目录 | `delivery_progress_baselines(limit=20, cursor="")` |
| 基线小头 | `delivery_baseline(baseline_id)` |
| 原观察小头 | `delivery_progress_observation(observation_id, scope="project")` |
| 原观察任务页 | `delivery_progress_observation_items(observation_id, collection="tasks", limit=20)` |
| 原观察需求原项 | `delivery_progress_observation_item(observation_id, requirement_id, collection="requirements")` |
| 基线任务页/原项 | `delivery_baseline_items(baseline_id)` / `delivery_baseline_item(baseline_id, task_id)` |
| 比较摘要 | `delivery_baseline_comparison(baseline_id)` |
| 分类页/原项 | `delivery_baseline_comparison_items(baseline_id, kind="changed", query_generation=generation)` / `delivery_baseline_comparison_item(baseline_id, task_id, kind="changed", query_generation=generation)` |
| 完整范围证明 | `delivery_progress_freeze_proof(scope="sprint", scope_id="S-one")` |

命令行对应入口如下。`--generation` 使用比较摘要返回的 `query_generation`；`--cursor` 使用同一读取返回的 `next_cursor`。需求原件使用 `--collection requirements`。

```text
sop delivery progress --scope milestone --scope-id M-one --json
sop delivery baselines --limit 20 --json
sop delivery baseline BASELINE_ID --json
sop delivery observation-items OBSERVATION_ID --limit 20 --json
sop delivery observation-item OBSERVATION_ID TASK_ID --json
sop delivery baseline-items BASELINE_ID --collection requirements --json
sop delivery baseline-item BASELINE_ID TASK_ID --json
sop delivery baseline-comparison BASELINE_ID --json
sop delivery baseline-comparison-items BASELINE_ID --kind changed --generation GENERATION --json
sop delivery baseline-comparison-item BASELINE_ID TASK_ID --kind changed --generation GENERATION --json
sop delivery progress-freeze-proof --scope sprint --scope-id S-one --json
sop delivery tasks --sprint S-one
```

读取完整证明不会自动生成命令。实际冻结仍使用 `baseline.create`，payload包含 `title/scope/scope_id/task_ids/basis/starts_on/ends_on/note`，外层包含原 `expected_version` 和 `idempotency_key`。记录观察仍使用 `progress.record`。只有具有实际项目批准权限的身份能够冻结基线。

## 验证边界与后续范围

本阶段采用唯一的新读取合同，取消整包进度读取的旧兼容设计。原业务实体与不可变JSON历史继续是事实来源，当前进度使用同事务更新的派生查询事实。GET不会隐式重建；需要维护时，具有配置权限的身份明确执行查询重建。

SQL历史读取的验证范围为SQLite。其他数据库方言未验证，不能使用整包读取加Python切片伪装为有界读取。数据库仍可能解析原JSON，受限传输与按需解码不代表恒定磁盘I/O。

完整证明与冻结前的必要闭包校验有明确预算。冻结成功后的原有观察及查询投影仍在同一事务捕获整个项目，因此整个写事务还存在全项目成本；本阶段没有将这个成本冒称为已消除，也不会用部分历史替代完整观察。

实际浏览器、390px中英日视觉验收及生产部署尚未验证。需求历史及当前需求抽屉本阶段修复权限失效或原件不存在后的旧缓存；其当前影响链路的有界拆分，以及整体生命周期其他待完成能力继续跟踪在项目进度中。
