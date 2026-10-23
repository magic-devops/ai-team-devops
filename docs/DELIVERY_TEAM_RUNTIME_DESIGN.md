# 团队执行成员与运行配置关联

## 目标与模型

在已确认的紧凑工作台中，团队 Agent 和开发工具可明确关联真实运行配置，任务派发可选择该成员。业务负责人、执行成员、运行配置、设备是四项独立事实，不按名称、角色或工具标签推导身份。

唯一存储为 `DeliveryWorkspace.member_runtime_bindings[member_id]`：`generation`、`status:bound|unbound`、`binding:null|{workspace_id,agent_id,agent_version,profile_digest,source:{workspace_name,agent_title,provider},bound_by,bound_at}`、`changed_by/at/reason`。绑定、采用版本、解绑递增代次；解绑保留墓碑。停用成员解除关联并递增；恢复必须明确重绑。改名和角色描述不改变代次。同一配置可供不同成员使用，不合并身份。

绑定基准摘要租户、项目、成员 ID、代次、固定配置身份，排除姓名、设备、心跳和工作区总体版本。无新 SQL 身份表、运行引擎或兼容别名。

## 权限与契约

保存要求项目 configure、同租户运行工作区 read 和实际访问范围，不要求或授予 runtime execute/config。仅启用的 Agent 和开发工具可绑定；项目配置者可在运行不可达、成员停用时解除已存关联。读取不暴露配置正文、环境或凭据；无法读取当前配置时仅显示项目已保存的来源。

- GET `/api/v1/delivery/team-runtime-bindings`：project_id/version/as_of/runtime_configured；workspaces 为 id/name/agents{id,version,title,provider}；members 为 member_id/member_name/member_kind/binding_basis/generation/binding/status/reasons/permissions。status 为 unbound/current/stale/unavailable，permissions 分别 can_bind/can_unbind。纯读。
- commands 新增 `member.runtime.bind`（member_id/workspace_id/agent_id/agent_version）、`member.runtime.unbind`（member_id）。沿用 expected_version/idempotency_key；409 保留草稿，不自动采用更新。
- ExecutionQueue 新增成对 `executor_member_id` / `executor_binding_basis`，默认空且只可 Agent 模式。原 workspace_id/agent_id/version 必须精确匹配，仍可直接派发 Agent/命令而不关联成员。
- 新预览和 execution 固定 `executor_snapshot`（可 null）：member_id/member_name/binding_basis/binding_generation/workspace_id/workspace_name/agent_id/agent_version/agent_title/profile_digest/provider/recorded_at/recorded_by。recorded_* 来自绑定时点，避免每次预览摘要变化。姓名仅审计，不能补造历史关联。

## 交接与恢复

预览、排队、未交接派发共同校验。变化以独立 `executor_binding_invalidated` 永久阻止原 pending intent，A→B→A 不复活；不改变 owner/task_basis/Task stale/原验收/排期基准。业务写在同事务持久化标记；GET 仅投影。

外部 run/dispatch receipt 持久化是交接边界，包括 planned。跨库重试先恢复原 receipt，再判定是否尚未交接，避免重复 run。交接后保留原成员与配置；解绑只影响未来计划，不能宣称撤销既有运行或阻止 Core start/claim。Core 继续校验原固定配置、目标及权限。取消失效 intent 不要求当前关联有效。

## 四界面

| 界面 | 正常与空态 | 失败、受限、失效 |
| --- | --- | --- |
| 成员详情 | Agent 与工具显示工作区/配置/版本/提供方；未绑定明示；人员无运行配置入口 | 读取重试；停用、陈旧、不可访问分开；只称关联有效，不暗示设备或凭据可执行 |
| 绑定编辑 | 工作区→配置→固定版本；换工作区清空配置；解除独立 | can_bind/can_unbind 分开；失败保留草稿；409 展示最新事实后明确采用 |
| 任务派发 | 可选执行成员，与负责人分开；固定配置，设备另选；明确改为直接配置 | 失效保留选择，不悄悄回退；目录失败不阻直接派发；切命令模式清关联 |
| 预览与记录 | 固定执行成员、负责人、配置、设备分别呈现 | 历史缺字段显示未记录关联，新 null 显示未关联；pending 失效需取消重新计划，已交接保留当时事实 |

沿用主题、焦点与 Drawer 退场身份机制。三语、390px 单列、长 ID 换行、Modal 限高及按钮换行，实际浏览器验证键盘、窄屏、错误恢复和预览。

## 验收

TDD 覆盖代次墓碑、ACL、精确版本、改名稳定、停用恢复、A→B→A、无 execute 可绑定不可派发、跨库 receipt 恢复、交接后测试人审、失效取消、纯读。再实际 HTTP/UI、Manager/Web、类型构建、OpenAPI/CLI/SDK。留档后阶段统一 commit，无 push。
