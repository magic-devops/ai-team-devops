# sop-cli

> ai-team-devops **统一命令行**：`sop` 一个命令通杀。

## 如何获得 `sop` 命令

`sop` 由本包 `pyproject.toml` 的 `[project.scripts]` 注册，安装 **sop-cli**（依赖 **sop-sdk**）后出现在 Python 环境的 `bin/` 目录。

| 场景 | 命令 |
|------|------|
| **本仓开发（推荐）** | 在仓库根目录：`bash scripts/build-sop.sh --venv .venv && source .venv/bin/activate` |
| **Make 快捷** | `make build-sop` 或 `make install-sop` |
| **uv workspace** | `uv sync`（根目录 `pyproject.toml` 已含 dev 组 sop-cli）后 `source .venv/bin/activate` |
| **一键 bootstrap** | `bash ai-sop-ops/bootstrap-dev.sh` |
| **仅打 wheel** | `bash scripts/build-sop.sh --wheel` → `pip install dist/sop_*.whl` |
| **PyPI / 离线包** | `pip install "sop-cli[all]"`（需已发布或本地 wheel） |

验证：

```bash
which sop          # 例如 .venv/bin/sop
sop --help
sop doctor
```

若 `command not found`：确认已 `source .venv/bin/activate`，或将 `$(python3 -m site --user-base)/bin` 加入 `PATH`。

## 安装

```bash
# 仓库根目录
bash scripts/build-sop.sh

# 或手动 pip 可编辑安装
pip install -e packages/sop-sdk-python -e "packages/sop-cli[all]"
```

## 快速上手

```bash
# 1. 一键初始化并注册到 Manager（推荐新工程使用）
sop register my-app --manager https://mgr.example.com --username admin

# 也可分步初始化项目（写 memory/, .ai-memory/, 多 AI 工具配置, agent.toml 骨架）
sop init my-app --manager https://mgr.example.com

# 2. 分步模式下配对 Manager（OAuth 浏览器流）
sop login --pair --manager https://mgr.example.com

# 3. 安装 + 启动 agentd 守护进程
sop agentd install
sop agentd start

# 4. 自检（含 Manager、`/api/v1/rag/health` 向量后端探测）
sop doctor

# 5. 状态总览
sop status
sop status --json --out .sop-runtime/status_snapshot.json

# 探测远端能力；不可用时 CLI 会尽量使用本地文件兜底
sop context services
sop context manifest --write
sop context env --out .sop-runtime/sop.env
sop context prepare --flush

# 6. 干活
sop requirement create "统一项目注册流程" --priority P1 --acceptance "sop register 可一键接入"
sop requirement list --priority P1
sop issue create "登录回调异常" --severity P1 --type bug
sop sprint create "MVP 闭环" --points 20
sop work next --local
sop work export --local --out .sop-runtime/work_snapshot.json
sop memory add "项目采用本地优先、远端增强" --local
sop memory search "本地优先" --local
sop memory flush
sop kb add "项目接入规范" "CLI/Agent 读取 .sop-runtime/sop.env 接入。" --local
sop kb flush
sop rule propose "所有 CLI/Agent 先读取 .sop-runtime/sop.env" --local
sop rule list --local --proposals
sop copilot ask "下一步该做什么？" --local --remember
sop copilot sessions
sop event emit sop.agent.run.completed --data run_id=demo --local
sop event flush
sop event subscribe --json
sop usage summary --json
sop usage check llm_tokens 1000
sop usage record llm_tokens 123 --unit tokens --source codex --local
sop db-config drivers --json
sop db-config list --json
sop db-config add prod-ob --type oceanbase --role business --capability sql --capability vector --host ob.example.com --port 2881 --database app --username app --secret-ref env://APP_OB_URL
sop db-config test prod-ob --url "$APP_OB_URL"
sop task list --status pending
sop delivery references --kind member  # 查看当前页的稳定成员 ID
sop task create "实现登录页 SSO 对接" --priority P1 --owner-id "user:<成员ID>"
sop task update "T-<任务ID>" --owner-id ""  # 明确清空负责人；省略该选项保持原负责人
sop task pull T-123
sop task done T-123 --confidence 0.9

# 6. 通过 Gateway 调 LLM（统一计费/缓存/Fallback）
sop llm chat "总结这次需求" --task-type summarize --cache-ttl 600
sop llm search "JWT 鉴权" -k 8

# 8. 同步与多平台
sop sync                    # agentd 完整同步周期
sop sync doctor             # 本地同步自检
sop sync repair --dry-run   # 预览队列修复
sop sync compact            # 压缩本地离线队列
sop sync flush              # 直连 Manager 冲刷本地离线队列
sop sync enqueue-file specs docs/spec.md --remote-path demo/spec.md
sop sync pull --direct --materialize  # 直连拉取并物化到 .sop-runtime/sync/entities
sop sync watch --once       # 扫描规则/规约/模板变更并写入队列
sop sync pull -o out.json   # 直连 Manager 拉取
sop sync status             # 本地游标 / 实体 / 推送队列
sop platforms init all      # 按 registry 生成 CLI/IDE/Agent 接入文件
sop platforms doctor        # AI 平台 shim 自检
sop ops health              # health-check.sh
sop ops stack doctor        # 本地栈 + sop doctor
```

## 项目组合、归档与恢复

```bash
sop project portfolio --status active --status paused --risk blocked --limit 30 --json
sop project portfolio --query "项目名称或ID" --risk recorded_completed --json
sop delivery lifecycle-preview --target archived --reason "阶段交付结束，保留资料与验收历史"
```

组合读取不会切换当前工作项目。`summary_scope=filtered_projects` 的统计来自完整筛选结果，`next_cursor` 用 `--cursor` 原样续读，并保持原筛选条件；不是只统计当前页。风险分类可重叠，`total_items` 按实体去重；登记完成不等于已验证完成。全部项目状态都显示实时 `live` 事实，归档时点记录单独保存在详情来源中。

预览后审阅全部阻止项，将输出的 `version`、`target_status`、`reason`、`preview_basis` 与一次生成的幂等键写入 JSON 文件，然后提交：

```bash
sop delivery command --file .sop-runtime/lifecycle-command.json
```

文件顶层必须是 `action/payload/expected_version/idempotency_key`，其中 `action` 为 `project.lifecycle`，`payload` 为预览的 `target_status/reason/preview_basis`。完整保存示例见 [SDK 生命周期说明](../sop-sdk-python/README.md#项目组合与生命周期)。网络结果未知时重试同一文件；收到 `409` 后明确审阅新事实，采用新预览并生成新请求，不能自动替换版本或依据。

只有 `active` 可以创建新执行。`planning/paused` 允许业务维护以及已交接执行的同步、人工验收和取消；已提交的 Hermes receipt/run（含 `planned`）算已交接。归档会阻止所有尚未关闭的 Manager 执行意图，包括任务已删除的意图；未完成任务只作为警示。归档后业务只读；恢复使用新的固定预览并明确选择 `planning/active/paused`，不隐式恢复历史状态。归档不撤销独立 Hermes 权限，也不停止外部进程。

项目配置统一通过 `project.update` 固定版本命令。原项目 PATCH、物理 DELETE、set-template 入口已移除；配置写入需要权限，状态只能走 `project.lifecycle`。创建项目初态限 `planning/active/paused`。

## 数据平面与向量后端

CLI / Agent 与具体向量实现解耦；由 Manager 环境变量控制（`VECTOR_DB_TYPE`、`DATABASE_URL` 等）。  
完整说明见 **[`ai-sop-ops/DATA_AND_VECTOR.md`](../../ai-sop-ops/DATA_AND_VECTOR.md)**（仓库根相对路径）与 **[`docs/architecture/DATA_PLANE.md`](../../docs/architecture/DATA_PLANE.md)**。

## 子命令一览

| 命令 | 作用 |
|------|------|
| `sop init`    | 项目初始化（取代 `init-ai-project.sh`），并生成 manifest / work snapshot / agent context |
| `sop register` | 一键初始化、注册 Manager、生成各 CLI/IDE/Agent 接入配置并刷新 Agent 上下文 |
| `sop login`   | 用户名密码登录 / OAuth 配对 |
| `sop status`  | 本地 + Manager 状态总览；支持 `--json/--out` 输出 Agent 健康快照 |
| `sop project portfolio` | 完整筛选范围的实时项目事实、风险与游标分页；查看不切换工作项目 |
| `sop delivery lifecycle-preview` / `command` | 固定项目状态预览与 CAS/幂等提交；归档/显式恢复使用同一命令协议 |
| `sop agentd`  | 守护进程：start/stop/status/logs/install |
| `sop requirement` | 需求：list/create/update/delete；Manager 不可用时写本地离线队列 |
| `sop issue`   | 问题/缺陷：list/create/update/resolve/delete；支持本地离线队列 |
| `sop sprint`  | 迭代：list/create/update/complete/progress/delete；支持本地离线队列 |
| `sop work`    | 聚合工作台：summary/list/next/export；支持远端优先、本地离线视图和机器可读快照 |
| `sop event`   | CloudEvent 事件：emit/flush/list/subscribe；支持本地 outbox、Manager journal 和 WSS 订阅 |
| `sop usage`   | 用量计量与配额：record/flush/summary/quota/check；支撑租户套餐、出账和限额 |
| `sop task`    | 任务：list/create/update/pull/done/fail/delete/issue；任务状态和 issue 上报均支持本地离线队列 |
| `sop rule`    | 规则：list/propose/apply/flush；支持本地提案、应用到 RULES.md、写入 sync 队列并推送 Manager |
| `sop sync`    | 触发同步（pull+push，需 agentd） |
| `sop sync pull` / `push` / `enqueue` / `push-file` / `enqueue-file` / `watch` / `doctor` / `repair` / `compact` / `flush` / `status` | 直连 Manager、离线入队、文件监听入队、物化远端数据、自检/修复/压缩/冲刷本地队列或查看本地状态 |
| `sop platforms` | AI 平台 list / init / doctor / install-shims |
| `sop memory` / `context` / `kb` / `copilot` | v4 记忆、上下文、知识库、助手；`sop context prepare --flush` 可生成 Agent 上下文包、刷新远端无密钥 DB 配置并冲刷 outbox；memory 与 kb 均支持本地 outbox + flush，copilot 支持会话/run_id/transcript |
| `sop db-config` | 远端数据库配置：drivers/list/add/test/delete/export；支持 OceanBase、PostgreSQL、MySQL、SQLite 和向量/分析/记忆等能力声明 |
| `sop ops` | 运维：health/stack/deploy/snapshot/notify/worker |
| `sop doctor`  | 端到端自检（含 sync 本地队列、manifest、平台） |
| `sop llm`     | LLM Gateway 客户端：chat/embed/search |

每条都支持 `--help`。浏览全部子命令：

本地优先与远端增强：`sop requirement`、`sop task`、`sop issue`、`sop sprint`、`sop memory`、`sop event`、`sop usage`、`sop kb search/add`、`sop rule list/propose` 会优先调用 Manager；远端不可达时自动回退到 `.sop-runtime/local/`、`.sop-runtime/memory/`、`.sop-runtime/kb/`、`.sop-runtime/rules/proposals.jsonl`、`.sop-runtime/events/outbox.jsonl`、`.sop-runtime/usage/outbox.jsonl`、`sop/custom/`、`.ai-memory/rules/`、`ai-sop/` 等本地资产。连接 Manager 后可用 `sop sync`、`sop sync watch`、`sop sync enqueue-file`、`sop sync doctor`、`sop sync repair`、`sop sync compact`、`sop sync flush`、`sop sync pull --materialize`、`sop sync push-file`、`sop memory flush`、`sop kb flush`、`sop rule flush`、`sop event flush`、`sop usage flush` 或 `sop kb index` 更新远端数据。各 IDE/CLI/Agent 可读取 `sop context manifest --write` 生成的 `.sop-runtime/project_manifest.json` 完成标准接入，读取 `sop context env --out .sop-runtime/sop.env` 生成通用环境变量，读取 `sop status --json` 判断项目健康，读取 `sop work export --local` 生成的 `.sop-runtime/work_snapshot.json` 获取需求、任务、问题、迭代和下一步建议；也可直接运行 `sop context prepare` 生成 `.sop-runtime/agent_context.json` 索引全部本地入口。

```bash
sop commands              # 表格
sop commands --examples   # 含常用流程
sop commands --group 同步 # 只看某一类常用流程
sop commands --json       # 机器可读
sop help sync             # 查看指定顶层命令摘要
```

## Shell 自动补全

支持 **bash / zsh / fish**（Typer/Click 动态补全 + 可选静态 bash 增强）。

```bash
# 持久安装（写入 shell 配置）
sop completion install bash
sop completion install zsh

# 当前终端临时启用
eval "$(sop completion show bash)"

# 静态增强（子命令 / 常用 flag，仅 bash）
source packages/sop-cli/sop_cli/completions/sop.bash

# 检查补全环境
sop completion doctor
```

顶层 Typer 选项（**自动检测当前 shell**，不接收 bash/zsh 参数）：

```bash
sop --install-completion    # 写入 ~/.bashrc 等
sop --show-completion       # 打印当前 shell 的补全脚本
```

指定 shell 时请用 `sop completion install bash` / `sop completion show bash`。

完整同步与多平台说明见 **[`ai-sop-ops/SYNC_AND_PLATFORMS.md`](../../ai-sop-ops/SYNC_AND_PLATFORMS.md)**。

## 故障排查

| 现象 | 处理 |
|------|------|
| `sop: command not found` | `make build-sop` 后 `source .venv/bin/activate` |
| doctor — **sop-agentd IPC** 失败 | `make build-agentd && sop agentd start` |
| doctor — **sync API** 跳过 | 正常；执行 `sop login --pair` 启用 sync |
| doctor — **Manager 连通** 失败 | `bash ai-sop-ops/start-manager.sh` |
| `sop sync` 提示 agentd 未运行 | `sop agentd start` |

失败时 `sop doctor` 会列出修复建议。完整说明：**[`docs/TOOLS_AND_SCRIPTS.md`](../../docs/TOOLS_AND_SCRIPTS.md)**。

## 问题诊断与需求回流

先在登录/接入配置中明确当前项目（`PROJECT_ID` 或现有项目配置）；以下命令都使用该项目作用域，不会通过问题 ID 自动切换项目。

```bash
sop delivery issue --id ISS-example
sop delivery issue-diagnose --id ISS-example --file .sop-runtime/issue-diagnosis.json
sop delivery issue-diagnoses --id ISS-example
sop delivery issue-diagnoses --id ISS-example --cursor "原next_cursor"
sop delivery issue-diagnoses --id ISS-example --diagnosis-id "原diagnosis_id"
```

生成文件包含 `expected_version`、`issue_basis`、明确的 `selected_evidence_ids`（必须包含 `issue:ISS-example`）、`generator`（`ai` 或明确选择 `rules`）、`instructions` 和一次生成的 `idempotency_key`。先读取问题详情并核对发送范围、脱敏、截断、缺失及受限标记，再保存固定原文件并提交。完整示例见 [SDK 问题诊断说明](../sop-sdk-python/README.md#固定问题证据与人工需求回流)。

网络结果未知时保留原文件和键，先查历史中的原 `request_key`，或按 `--diagnosis-id` 精确读取；历史有 `next_cursor` 时继续原项目/问题分页。重交原文件仅恢复原请求结果，不重复调用模型。`generating` 表示处理中或结果未知，`failed` 是明确失败记录，不自动切换规则或新键重发。`409` 后保留草稿并明确核对新版本；问题或所选证据变化需要重新生成。

人工核对并编辑需求草稿后，通过 `sop delivery command --file .sop-runtime/issue-adoption.json` 提交 `issue.diagnosis.adopt`。外层固定 `expected_version/idempotency_key`，payload 包含 `issue_id/diagnosis_id/issue_basis/comment/title/description/priority/acceptance_criteria`；需要项目批准权限及原证据访问权限。采用只回到该问题的唯一需求，不覆盖已有需求、关闭问题或宣称修复/验收完成；后续任务继续沿既有拆解、派发、测试和人工验收流程。

放弃提案同样使用通用命令，action 为 `issue.diagnosis.dismiss`，payload 为 `issue_id/diagnosis_id/issue_basis/comment`。待定提案会阻止项目归档；明确取消解除该意图，但不声称远端模型已停止。问题已删除仍可按原 `--diagnosis-id` 精确读取历史并授权取消；原证据权限不足时内容隐藏，归档项目保持只读。

## 质量与固定发布候选

`sop delivery quality` 读取当前项目质量；重复 `--requirement-id` 与 `--task-id` 明确选择完整需求及独立任务，取得CI所需的固定 `scope_basis`。`sop delivery releases` 读取目录，`sop delivery releases --id <id>` 只读取该候选；未知ID不回落首项。

`sop delivery release-preview --file candidate.json` 仅预览当前文件。保存使用现有 `sop delivery command --file command.json`，显式提供原 `expected_version`、`preview_basis` 和 `idempotency_key`；网络结果未知重试原文件，冲突后核对再重新预览。新命令为 `release.policy.save`、`release.ci.import`、`release.candidate.create`、`release.candidate.review`、`release.candidate.revoke`；旧人工 `release.save` 已退出。

CI使用 `scripts/delivery-ci-attest.py --help`，从实际干净checkout构建/测试新制品，再签DSSE证明。导入命令的 `payload.envelope` 保留文件原始JSON文本，私钥不进入API或命令文件。批准候选不等于已部署；详见 `docs/DELIVERY_RELEASE_DESIGN.md`。

`sop delivery deployments` 读取当前项目的受控环境和部署意图；`--id <id>` 读取精确部署详情、实际运行、健康证据及失败问题。`sop delivery deployment-preview --file deployment.json` 预览明确的 `candidate_id`、`environment_id`、`reason`，回滚则只提交 `rollback_of` 和 `reason`。保存继续使用 `sop delivery command --file command.json`，携带预览原版本、`preview_basis` 及固定幂等键。

部署通过 `deployment.environment.save`、`deployment.create`、`deployment.dispatch`、`deployment.start`、`deployment.advance`、`deployment.observe`、`deployment.cancel`、`deployment.sync` 操作。环境配置与实际运行权限分别检查；开始、灰度晋级和回滚都需明确操作。结果未知时查询原意图或执行只读观察，不能自动重新执行 apply。只有当前候选的实际 100% 流量及健康检查通过才计入已发布。执行端需安装标准 runner，并配置受信 HTTPS 来源和独立探针；协议、配置和恢复说明见 `docs/DELIVERY_DEPLOYMENT_DESIGN.md`。
## 执行过程与人工干预

新增 `sop delivery execution-runtime --id ...`、`execution-output --id ... --node ... --attempt 2 --stream stderr`、`execution-control-preview --file ...`。步骤与批次必须明确选择，续读使用原查询游标。详见 [执行过程指南](../../docs/EXECUTION_RUNTIME_GUIDE.md)。

`execution.start`、`execution.retry`、`execution.cancel`、`execution.approval` 通过 `sop delivery command` 提交预览固定载荷；保留原版本和请求键以恢复未知结果。取消不证明外部进程已经停止，也不回滚副作用。


## 活动与需求版本

`sop delivery activity --scope requirement --scope-id REQ-example --limit 20` 读取已记录的范围活动；分页原样使用返回的 `next_cursor`，`--event <event-id>` 只读取精确事件。`sop delivery requirement-history --id REQ-example` 读取观测版本，`--version <version-id>` 查看精确内容，不会恢复或覆盖当前需求。

`sop delivery requirement-change-preview --id REQ-example --file proposal.json` 预览固定的 `requirement_basis` 和定义 `changes`（title/description/acceptance_criteria）。人工核对字段差异和影响后，用原 `version`、`requirement_basis`、`preview_basis` 构造 `requirement.update` 的 command 文件；payload 中预览指纹名为 `change_preview_basis`。保存仍用 `sop delivery command --file command.json`。原文件和幂等键用于未知结果恢复；409之后必须明确采用最新状态并重新预览，不静默重试新范围。完整步骤见 [协作活动与变更指南](../../docs/DELIVERY_COLLABORATION_GUIDE.md)。

## 有界项目查询

```bash
sop delivery context
sop delivery requirements --query 交付 --stage design --limit 20 --sort due_asc
sop delivery requirement --id REQ-example
sop delivery tasks --requirement REQ-example --status recorded_completed --limit 20
sop delivery task --id T-example
sop delivery issues --task T-example --severity P0
sop delivery execution --id execution-example
sop delivery references --kind member --query 设计
sop delivery references --kind task --ids T-example,T-predecessor
```

列表的 `total` 为全部匹配数量，下一页使用原参数加 `--cursor <next_cursor>`。变更导致游标过期时回到第一页，不能静默拼接不同代次。详情始终按精确ID读取。`command` 输出原对象的统一回执，无需从完整项目快照猜结果；未知提交仍用原文件和幂等键恢复。

`sop delivery query-rebuild` 是有配置权限时的显式派生索引重建；普通读取不执行修复写入。`workspace` 仅用于明确的完整导出。详见 [查询与详情指南](../../docs/DELIVERY_QUERY_GUIDE.md)。
