# 协作活动与需求变更

在研发工作台选择明确项目，项目概览和需求详情的活动入口读取同一个活动服务。列表显示已记录的业务活动，运行日志仍在执行详情中查看。通过事件可以打开当时关联的对象；导航前会重新核验当前访问权限。对象已删除或访问受限时保留历史记录，不能借历史链接绕过权限。

## 查找与返回

活动服务目前覆盖交付命令和需求辅助采用时实际保存的业务事件；通用需求写入会保存内容观测版本，但不会伪装成交付命令事件。独立外部事件journal及所有通用入口的统一活动接入仍待完善。项目活动包含项目范围，需求活动只包含实际固化的需求关联。任务转属后不会把旧需求的活动迁到新需求；批量排期在多个需求中仍指向同一条事件。较早事件缺少当时关联时明确未知，不能按当前任务归属猜测。活动分页采用固定上界，翻阅过程中新增活动不会混入旧页；显式重新读取最新记录才能开始新的范围。

从事件打开来源时，来源显示当前实际状态；事件内容显示当时已记录事实。二者不是同一快照。使用返回动作恢复事件和范围；未知ID不能打开第一条作为替代。加载、读取失败、无权与确实不存在分别处理。

## 修改需求

1. 在需求详情打开编辑，修改标题、描述或验收条件，并保留需要调整的负责人、日期等管理字段。
2. 生成变更预览，核对具体字段前后值、当前修订及影响对象。定义内容变更沿用已有规则开启新修订并使旧交付依据失效；管理字段变化不等于所有证据失效。
3. 明确确认后提交。预览及提交都绑定需求内容指纹，提交还核对影响指纹和项目版本。预览后改变输入，需要重新预览。
4. 若发生并发冲突，保留草稿，读取最新状态后明确采用并重新核对。若请求结果未知，继续恢复原请求身份；不新建重复变更。

变更影响供人工跟进。系统保留旧执行、产物、评审和发布候选的历史，不能把旧内容的成功当成新需求的有效验收；不会自动移动排期、重新派发、重新运行或通过验收。影响列表的具体范围以服务端返回为准。

## 阅读版本

版本记录保存真实观察到的规范需求定义，包括标题、描述和验收条件，支持精确版本读取。观察序号、观察时间和流程修订分别表达：系统首次观察时可能已是较晚修订，未采集的早期内容不补造。历史版本只读，不能覆盖当前需求；旧任务或执行中已有的需求快照继续保留其原用途。

## CLI 与 SDK

```console
sop delivery activity --scope requirement --scope-id REQ-example --limit 20
sop delivery activity --event event-example
sop delivery requirement-history --id REQ-example
sop delivery requirement-history --id REQ-example --version version-example
sop delivery requirement-change-preview --id REQ-example --file proposal.json
```

预览文件包含 `requirement_basis` 和明确的 `changes`。提交文件包含 `action=requirement.update`、payload 中的 `id`、原变更字段、`requirement_basis`、`change_preview_basis`，以及外层原 `expected_version` 和固定 `idempotency_key`。SDK 对应 `delivery_activity`、`delivery_activity_event`、`delivery_requirement_history`、`delivery_requirement_version`、`delivery_requirement_change_preview` 和已有 `delivery_command`。

所有入口需要当前身份和明确的 `X-Project-Id`。历史GET不会初始化记录、调用模型、启动运行或替代人工验收。变更预览不写业务状态；正常HTTP操作审计仍按现有规则记录。

当前仍未完成本阶段390px中英日实机视觉复核；交互自动测试、类型与构建、实际HTTP验证分别留档，不能当作实机视觉证据。生产规模及外部身份验证继续作为完整目标后续工作。
