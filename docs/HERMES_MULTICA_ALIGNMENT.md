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
| Agent 目录与运行适配 | Codex/Claude/OpenCode 显式 CLI 适配器、版本化配置、任务派发、终止事件与 usage 证据；Codex 已真实调用 | 其余 Multica runtime、ACP、认证探测、预算和能力协商未全覆盖；安装状态不表示认证成功 |
| 人与 Agent Squads | 固定一个 Leader、版本化成员快照、Leader JSON 委派、未选择成员跳过；真实 Codex Leader/成员调用已验证 | 非任意动态并行团队；人类成员、通知与多轮团队会话未交付；角色不是权限 |
| 项目与仓库上下文 | 固定提交、每运行独立 detached/locked worktree、代码差异快照、Web/Flutter 审查、CLI/SDK 已贯通 | 仓库缓存、上下文索引、分支合并、托管平台 PR 和工作树清理控制面尚未交付 |
| Daemon 与远程执行 | 一次性配对邀请、独立设备凭据、主动轮询、命令领取、心跳、结果回传、撤销和过期租约拒绝；真实进程回归 | 当前 command-only workspace 执行；远程 Agent/worktree/审批、多主机网络、断网结果重传与端侧签名安装未全覆盖 |
| Autopilot 与周期调度 | 事务化间隔调度、自动到期执行、错过合并、重叠抑制、暂停/恢复、运行历史与固定 Agent 快照 | Cron/时区、多触发器、Webhook、自动创建任务和补偿工作流未交付 |
| 独立 Agent Chat | 会话资源可管理 | 多提供方流式对话、工具消息、中断未闭环 |
| 技能共享与安装 | 资产可登记、分类和编辑 | 原生安装、依赖解析、工具授权和卸载影响未全覆盖 |
| 成本与运行质量 | 真实节点日志、退出码、提供方终止事件及原始 usage 可审计 | 未统一跨提供方计费、预算和费用聚合；缺失费用不得估造 |
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

完整对齐仍需扩展 Agent runtime、Git 托管集成、远程 Agent、Cron/Webhook、团队收件箱、
技能安装、成本和渠道集成。每项同时交付协议、权限、UI、CLI、失败恢复和真实执行证据。

## 自动化交付边界

本轮行为参考官方 [Squads](https://multica.ai/docs/squads)、
[Autopilots](https://multica.ai/docs/autopilots)、
[Daemon runtimes](https://multica.ai/docs/daemon-runtimes)、
[Security model](https://multica.ai/docs/security-model)。独立实现，不复制源码。

- Agent 配置与 Squad 成员在派发时固定版本；运行前若配置变更则拒绝执行，不悄悄改用新配置。
- Codex/Claude/OpenCode 使用各自 CLI 的非交互协议与认证；不追加跳过权限的危险参数。
- `exit_code=0` 不是 Agent 成功的充分条件，还需要提供方的成功终止事件。
- Squad 只先唤醒 Leader，由其选择已登记成员；没有被选择的成员不执行。
  所有执行成功后任务仍进入人工审查，不能把运行完成等同交付验收。
- 周期调度需要 config + execute 授权，保存服务器取得的身份和工作空间配置快照。
  工作空间变更时要求重新配置。周期运行不绕过审批节点或质量检查。
- 远程设备凭据不进入资源 JSON 或审计事件；一次性邀请过期、兑换或撤销后不能继续使用。
  Worker 只接受显式工作空间目录映射，服务端拒绝过期租约、错误设备与旧配对凭据。
- Worker 使用当前 OS 用户权限运行命令；目录映射、worktree 和 Agent CLI 权限模式不是 OS 沙箱。
  远程公网入口需要受控 HTTPS 部署，不能直接暴露独立桌面 Core。

```sh
sop agent catalog --json
sop squad catalog --json
sop task v1 agent-dispatch TASK_ID --agent-id AGENT_ID --target-version 1 --expected-version 1 --prompt '核对验收条件并执行测试' --dry-run --json
sop schedule configure SCHEDULE_ID --data "$(cat schedule.json)" --dry-run --json
sop schedule history SCHEDULE_ID --json
sop device pairing DEVICE_ID --expected-version 1 --dry-run --json
sop system remote-worker --help
```

真实环境参数使用 `HERMES_URL`、`HERMES_TOKEN_FILE`、`HERMES_WORKSPACE`。
命令预览、结构测试、真实提供方执行、五平台签名发布是不同证据等级，不混用。

端侧运行包提供 `hermes-core remote-worker`，不要求目标机器预装 Python。
通过 `--pair-secret-stdin` 兑换短期邀请，凭据仅写入新建的受限文件；
Worker 将凭据绑定到配对服务地址，不跟随 HTTP 重定向发送凭据。
执行使用 `--workspace-map WORKSPACE_ID=/absolute/path` 和随包的 `--agentd`。
`--once` 最多领取一个节点；长期轮询由部署的进程管理器管理，撤销后退出并返回错误。

## 隔离代码交付

派发显式选择 `isolation=git_worktree` 并携带完整 `base_commit`；预览读取仓库状态，
应用仍使用原 SHA，不在确认时悄悄切换 HEAD。未提交草稿不复制、不暂存、不回滚。
默认 `workspace` 模式仍用于直接在项目中运行的 SQL/Python/Shell 等操作。

Core 数据目录须位于源仓库之外。执行目录按 tenant/business/workspace/run 分配，
使用 Git `worktree add --detach --lock`；暂停审批、失败、验收后均保留工作树。
已登记目录缺失、符号链接替换、仓库身份变化或遗留未登记目录时拒绝继续，不重建后跳过成功节点。
异常目录由运维核对 Git `worktree list --porcelain`、运行记录和备份；需要恢复关联时使用 Git 官方 repair 流程。
本阶段没有自动 merge、commit、unlock、remove 或 prune，不以删除目录冒充回滚。

Git worktree 是检出隔离，不是安全沙箱。Git 对象、引用和配置仍共享；具有 execute
权限的任意命令仍具备本机进程权限。只对可信仓库和可信执行者开放本地执行。
内部 Git 操作关闭 hooks/fsmonitor，清除继承的 `GIT_*` 环境变量；不宣称 OS 容器隔离。

运行结束或审批暂停时保存相对基线的差异、文件状态、未跟踪文件、HEAD、时间与 SHA-256，
并在审计事件中保留快照。失败也尽力采集，采集失败不能使用上次结果冒充本次证据。
差异截断、未跟踪文件或子模块脏状态使 `complete=false`，禁止验收通过；可退回修改。
代码快照描述采集时的文件状态，不是签名制品，也不保证工作树此后未被外部进程修改。

新增只读接口：`GET /workspaces/{id}/repository`、`GET /runs/{id}/changes`。
后者只返回已存储快照，不执行新的 Git 操作。代码证据与执行目录是服务端字段，客户端不能写入。

```sh
sop workspace repository WORKSPACE_ID --json
sop task v1 dispatch TASK_ID --plan plan.json --expected-version 1 --isolation git_worktree --base-commit COMMIT_SHA --dry-run --json
sop run changes RUN_ID --json
```

设计依据：[Git worktree 生命周期](https://git-scm.com/docs/git-worktree)、
[Git 仓库布局](https://git-scm.com/docs/gitrepository-layout)。
