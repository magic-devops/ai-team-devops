# Hermes v1：Multica 功能对齐与交付边界

产品版本：1.0.0。核对日期：2026-09-08。本文不是全量对齐完成声明。

## 参考基线

以 Multica 提交 `200dcb44cc1527ef24a1c892e9c3e5508377b386` 为本轮参考：

- [产品与功能目录](https://github.com/multica-ai/multica/blob/200dcb44cc1527ef24a1c892e9c3e5508377b386/README.md)
- [CLI 与 Daemon](https://github.com/multica-ai/multica/blob/200dcb44cc1527ef24a1c892e9c3e5508377b386/CLI_AND_DAEMON.md)
- [许可证原文](https://github.com/multica-ai/multica/blob/200dcb44cc1527ef24a1c892e9c3e5508377b386/LICENSE)
- [Zed 外部 Agent](https://zed.dev/docs/ai/external-agents)

本轮独立实现任务交付行为，没有复制 Multica 源码。该提交的许可证包含额外条款，
不能仅按普通 Apache-2.0 描述；将来引入其代码或分发衍生产品必须另行审查原文。
保留 Flutter、React、Python Core、Go agentd 的职责分工，不复制参考项目的技术栈。
原生工作空间以 `/api/hermes/v1` 为唯一协议，不增加旧版兼容入口。

## 功能映射

| 能力 | Hermes v1 当前状态 | 未完成的验收边界 |
| --- | --- | --- |
| 任务分派与交付审查 | 本轮实现事务派发、版本化验收、退回修改、审计；Web/Flutter/CLI/SDK 同步 | 不等于自然语言自动完成任意任务 |
| 执行、超时、重试、审批 | 复用 LangGraph 命令节点、审批检查点、Go 执行器结果 | 任意拓扑并行 DAG、补偿动作和外部 Agent 中断未全覆盖 |
| Agent 目录与运行适配 | 保存负责人标签及派发快照 | 标签不是运行时；CLI/ACP 适配器、认证探测、预算与能力协商未完成 |
| 人与 Agent Squads | 原生侧未实现执行级团队路由 | 需要成员模型、路由、委派证据和权限验证 |
| 项目与仓库上下文 | 工作空间根目录、任务验收条件进入运行快照 | Git worktree 隔离、仓库缓存、差异审查及上下文索引未形成完整原生闭环 |
| Daemon 与远程执行 | 本地 Core/agentd 启停、诊断、受控命令执行已有实现 | 设备登记不是配对；主动连接、远程领取、撤销和跨设备恢复未验收 |
| Autopilot 与周期调度 | 有调度资源登记 | 原生周期执行、事件唤醒和可靠补偿未完成 |
| 独立 Agent Chat | 会话资源可管理 | 多提供方流式对话、工具消息、中断未闭环 |
| 技能共享与安装 | 资产可登记、分类和编辑 | 原生安装、依赖解析、工具授权和卸载影响未全覆盖 |
| 成本与运行质量 | 真实节点日志和退出码可审计 | Token/费用需要提供方真实 usage，不可估造 |
| 收件箱与审查 | 运行审批队列已有实现，本轮增加任务交付审查 | 通知订阅、团队分配、批量收件箱未完成 |
| Git 托管与消息渠道 | 原生闭环未接入 | GitHub/GitLab/Gitea/Forgejo、Slack/Lark 等需要鉴权、Webhook 幂等和真实环境验收 |
| 权限与隔离 | read/write/execute/approve/export/config、身份作用域、版本、幂等键 | 团队成员管理与远程设备权限仍需端到端验收 |
| 安装与分发 | 已有便携安装、清单校验、诊断及 Flutter 五平台工程 | 不是五平台签名安装；本机缺完整 Xcode，其他平台及商店发布未验收 |

既有 Manager 的相关模块不能自动计入原生功能完成率。能力必须经过原生协议、权限、
实际运行、客户端交互和对应环境验证后更新本表。

## 本轮交付模型

1. 任务记录标题、验收条件、负责人；没有验收条件不能派发。
2. dispatch 预览验证节点、命令参数、版本、作用域，不写实体或事件。
3. 应用在同一事务创建 planned run、更新任务关联、写入审计及幂等回执。
4. 启动为单独 execute 动作；argv 不通过隐式 Shell 执行，执行器再次校验权限。
5. 运行完成后任务仍为进行中；成功来自真实执行结果，不能通过任务编辑伪造。
6. 审查绑定 task version、run version、结论、身份、trace 和运行证据 SHA-256。
7. 仅所有节点成功的 completed run 可以验收；failed/cancelled 可退回修改。
8. 退回后可编辑任务并派发新运行，旧运行不得再启动或重试；历史审查保留在事件中。
9. 已验收任务不可改写；后续工作建立新任务。任务运行 replay 仅预览，实际重跑重新派发。

这是验收条件、可执行测试计划和结果审查的基础链路，**不是自动 TDD Agent**。
Red/Green 可以分别登记测试命令与预期退出码；测试正确性、需求覆盖仍须审查。

| 动作 | 路径（前缀 `/api/hermes/v1`） | 权限 |
| --- | --- | --- |
| 交付详情 | GET `/tasks/{id}/delivery` | read |
| 预览/派发 | POST `/tasks/{id}/dispatch` | write + execute |
| 预览/验收 | POST `/tasks/{id}/review` | approve |
| 审计导出 | POST `/runs/{id}/export` | export |

使用认证身份和 `X-Workspace-Id`。写动作携带 `expected_version`、`idempotency_key`、
`dry_run`；审查另携带 `run_version`。预览和应用使用同一计划、幂等键；编辑后预览失效。
重复应用返回原回执，不重复创建运行。服务端拒绝伪造任务来源、交付结果和节点证据。

```sh
sop task v1 delivery TASK_ID --json
sop task v1 dispatch TASK_ID --plan plan.json --expected-version 1 --dry-run --json
sop task v1 dispatch TASK_ID --plan plan.json --expected-version 1 --apply --idempotency-key KEY --json
sop task v1 review TASK_ID --run-id RUN_ID --run-version 6 --expected-version 2 --decision accept --comment '已核对测试证据' --dry-run --json
```

Core URL、Token、Workspace 通过已有 Hermes 配置传递，不写入示例或审计包。
Python SDK、Web client、Dart client 提供交付详情、派发和审查方法；OpenAPI 同步生成
TaskDispatch/TaskReview 契约。readiness 加入三个 task v1 子命令的 help 检查。

## 交互与后续验收

- Web 任务详情内完成计划与审查，关联按钮定位具体运行；CLI 和 JSON 按需展开。
- Flutter 任务进入独立交付弹层，窄屏垂直滚动；当前计划仍使用高级 JSON 编辑，不宣称已具备完整可视化流程编辑器。
- 离线或权限不足禁止写入；作用域切换不复用上一身份的缓存、预览或执行目标。
- 失败运行不能提交“验收通过”；错误保留原因，成功刷新版本。
- 负责人标签、设备登记、资产登记不能分别显示为 Agent 已执行、设备已配对、插件已安装。

完整对齐仍需外部 Agent/Git worktree、设备配对/租约、周期调度、Squads/收件箱、
技能安装、成本和渠道集成。每项同时交付协议、权限、UI、CLI、失败恢复和真实执行证据。
