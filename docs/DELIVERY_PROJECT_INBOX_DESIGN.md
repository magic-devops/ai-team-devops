# 项目资源与交付待办

沿用已确认的紧凑协作工作台。需求辅助与人工工作流已完成本轮验收；本增量继续补齐完整主计划中的项目资料和个人交付聚合，不替代生产集成、归档治理及其他剩余范围。

## 项目资料

- 项目名称、简介继续以现有 Project 为准，目标、负责人、日期继续使用交付元数据。编辑只变更实际提交的字段，不清空未编辑内容。名称及简介编辑需要 configure 权限。
- 资源存于现有 DeliveryWorkspace 的 resources 集合，与项目版本、事件、幂等凭据一起提交；不创建第二套项目库。类型为 repository / document / design / other，包含名称、HTTP(S) 链接、说明、可选仓库分支/引用。
- 新增 resource.save 和 resource.archive。归档保留完整记录，可用同一 ID 恢复，不永久删除。资源配置使用 configure 权限；其他成员可查看。
- 链接不携带账户口令；拒绝可执行协议、控制字符及明显的凭据查询参数。只登记链接，不拉取仓库、下载文档或隐式执行。页面再次验证链接，外部链接有清晰标识。
- 资源编辑使用打开时的项目版本及固定请求身份。失败保留输入，409 展示最新内容并由用户核对后明确采用；旧项目没有 resources 时按空集合兼容。

## 个人与团队交付待办

- GET /api/v1/delivery/inbox，必须明确 X-Project-Id，scope=mine|team 默认 mine。复用当前项目访问权限；投影真实业务及交付记录，读取不写库、不推进阶段。
- 响应包含 project_id、version、scope、current_user_id、as_of、counts、items。items 稳定 ID、kind（requirement/task/issue）、resource_id、title、requirement_id、task_id、status、stage、owner_id、due_on、priority、categories、blocked_reasons、overdue、target。待验收复用 task 项，不再增加重复执行条目。
- categories 为 work / approval / acceptance / blocked。counts 按分类统计，items 每个领域记录只出现一次，多类保留为标签，不将重复标签累加为总数。目标 target 包含 view、requirement_id、detail、可选 task_id；既有详情标签为 details/tasks/evidence/release/activity，前端编码后准确定位。
- current_user_id 返回真实 User.id，owner_id 则使用名册的 user:ID。mine 的个人任务与需求使用稳定 user:ID 身份。不能把同名智能体、工具或歧义旧姓名当作当前用户；团队视图显示当前项目事项。只有当前 approve 角色才把团队的可评审阶段纳入个人 approval；阶段须满足实际门禁且没有阻塞，不伪造已批准。
- awaiting_review 的当前有效执行进入 acceptance；失效、旧派发或其他任务执行不能继续冒充当前待验收。入口仅查看既有执行面板，实际执行审查继续由原入口核验运行及项目权限。
- 个人阻塞来自本人任务、本人需求及其关联未解决问题；团队视图可查看项目阻塞。日期只来自已登记计划，UTC 日期作为比较口径；缺失日期不判延期。
- 不新增快速完成/批量批准，工作台中的原门禁仍是唯一变更入口。切换项目、会话或用户使用既有缓存隔离，筛选不改变领域状态。

## 页面

- 项目概览新增紧凑的近期里程碑、资料入口和待处理入口；已有历史与活动可继续查看。
- 资源页使用列表、类型筛选和“显示已归档”，查看与编辑权限明确，表单包括加载、空态、失败、版本冲突和恢复。
- 待办页有“我的事项/团队事项”和四类筛选，显示数量、日期、阻塞原因和真实状态；点击进入需求/任务/问题位置，支持 URL 定位、刷新及返回。
- 问题入口保留具体 issue ID，不自动打开关联需求抽屉；问题行提供明确的关联需求/任务按钮，返回恢复原问题。无需求任务使用实际独立路由 `#/tasks/execution?task_id=…`，按 ID 精确过滤，不自动批量勾选，刷新保留目标。
- 权限尚在加载、请求失败和已确认只读分别显示，错误不冒充只读；权限变化后提交前再次核验。
- 390px 下为纵向卡片，长名称与链接换行，按钮及筛选可键盘操作；沿用现有 AntD、主题变量和中文/英文/日文文案。

Ruling：继续已获授权的完整主计划，常规实现选择不重复要求设计确认。12ui 第三方上传此前被自动审批拒绝，不重试；使用已读取的本地 WorkBuddy 参考、Multica 资源与我的事项组织方式及实际浏览器验证，不复制其源代码或增加部署依赖。

## 验证

资源创建/编辑/归档/恢复、固定请求重放、版本冲突、旧状态兼容、租户及权限；个人身份歧义、分类去重、阶段门禁、失效执行、关联问题、日期口径、纯读取；SDK/CLI/OpenAPI；真实服务及桌面/窄屏、键盘、项目切换；一次独立审查后修复并落盘进度。

目录：测试、构建及临时脚本使用仓库忽略目录 `.cache/project-resources-inbox/`；最终截图、验收报告及校验清单保存在 `.sop-runtime/delivery-evidence/project-inbox/`，文档留在 docs/ 与 memory/。清理前先清点并计算唯一证据散列，不遍历或清理链接目标，不在盘符根创建目录，不改变机器或用户环境变量。

## 客户端

`sop delivery inbox --scope mine --json` 读取当前项目个人事项，`--scope team` 查看团队事项。默认文字输出可快速阅读；JSON 保留分类、数量及准确定位信息。读取失败明确报错，不生成本地假待办。Python SDK 使用 `client.delivery_inbox(scope="mine")`，沿用当前登录和项目。

资源写入复用 `sop delivery command --file resource-command.json` 或 `client.delivery_command(body)`。先调用 workspace 取得当前版本，再明确准备 `{action, payload, expected_version, idempotency_key}`；网络结果未知时保留原文件及请求身份重试。

- `resource.save` 的 payload 为 `{kind, title, url, description?, ref?, id?, archived?}`，kind 为 repository/document/design/other。新建省略 id；编辑提供原 id 及完整资源内容。归档后的同 id 保存 `archived: false` 即恢复。
- `resource.archive` 使用 `{id, comment?}`，保留原始记录及事件，不删除历史。
- `project.update` 的 name/description 更新原有 Project，只有明确提供的字段改变；省略字段保留原值，简介用空字符串清空，不能用 null 清空名称。

资源与项目名称/简介写入都需要 configure。409 必须加载最新内容并人工核对，不能自动换版本覆盖；页面提供明确的核对与采用步骤。
