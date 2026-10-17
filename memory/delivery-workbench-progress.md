# 全流程交付工作台实施记录

日期：2026-10-17

## 已确认方向

- 当前项目为产品主体；Multica、Hermes、Harness、dsh、OpenClaw 等为实现参考。
- Manager 保持业务数据权威；复用已有任务、设计、Agent、质量、运维能力。
- 紧凑协作工作台：列表/看板、详情侧栏、可定位的进度与阻塞、完整错误反馈。
- 覆盖项目、混合团队、需求、拆解、产品/UED/架构设计、开发、测试、验收、版本发布、运维与问题回流。

## 实施分解

- [x] 持久化交付流程、团队、里程碑、版本/产物与审查记录；真实任务/需求关联。
- [x] 权限、乐观版本、重复操作与阶段门禁行为测试。
- [x] 紧凑工作台：概览、需求列表/看板、里程碑计划、团队、详情与操作。
- [x] 修复项目创建失败反馈；真实进度观测与图表标识。
- [x] 完成构建、接口、核心交互与窄屏视觉验证；完整范围与剩余工作记录于 docs/DELIVERY_WORKBENCH.md。

## 环境与决定

- 当前分支 branch-3.x，开始时工作区干净；在用户指定工作区完成修改，不提交或发布。
- `.ai-memory` 是指向其他机器目录的失效符号链接；不替换用户链接，运行测试使用隔离临时数据目录。
- 规约子模块工作目录为空，但 Git 对象可读，已读取控制平面规范。
- 已安装锁定前端依赖和独立 Python 虚拟环境；移除与锁文件不一致的冗余 tslib override，保留直接依赖。
- 新增业务流程通过现有 SQL 会话及身份检查实现，不能以浏览器本地状态作为业务真源。

## 验证及审查

- 后端新增 19 项测试通过；前端全量 174 项通过；Hermes 执行/交付回归 17 项通过。
- 独立审查发现并修复：表单基准版本漂移、重试幂等身份丢失、任务修改沿用旧测试、失败设计产物放行、同页深链接不同步。
- 补齐冲突恢复：保留草稿，显示服务器最新内容，由用户明确核对后采用新版本并再次提交。已在实际浏览器中制造冲突验证成功。
- 页面截图发现的侧栏背景透字已修正；测试数据仅位于隔离运行时目录。
- 12ui 外部设计请求被自动审批拒绝，原因是未获准向第三方披露项目流程设计内容；没有重试绕过，采用本地设计和浏览器实测。
- `.pnpm-store/` 已加入 Git 忽略并验证，`pnpm-lock.yaml` 保留跟踪。
- 可信 CI 证据、实际部署/回滚、智能诊断修复、自动需求入池仍待实现，不标记全产品完成；执行回写已在下方增量实现并验证。

## 执行桥接增量（2026-10-16）

上一目标轮为进展：已写入业务执行桥接、后台回写、嵌入式执行与验收界面及 CLI/SDK。缓存问答为旁支核验，本轮继续工作并取得以下新证据。

- [x] `execution.queue/sync/review/cancel`：先保存固定快照意图、跨存储稳定去重、独立启动、真实进度、成功待审查、人工验收完成业务任务。
- [x] 后台每 5 秒回写已关联运行的新版本；无变化不写事件，失败同步可恢复；不自动启动运行。
- [x] 失败自动建问题、重复同步去重、问题转需求保留来源与原问题状态。
- [x] 通用 SQL/批量编辑不能直接完成执行纳管任务；需求或任务内容/归属变更使执行证据失效。
- [x] SDK/CLI/OpenAPI 同步维护；三个 delivery 路径、17 个 action、所有本地引用校验通过。
- [x] 任务详情标签 URL 持久化、390px 侧栏宽度修正、测试证据来源和失效标识。

审查与修复记录：一次独立审查发现两个 Important，均复现后修复（RED→GREEN）：快照缺少实际 task.req_id；原派发人失活导致当前授权管理员无法接管。未重复审查。随后按范围核验另复现旧运行测试报告可被任务变更/重新派发沿用的问题，两项失败回归证明门禁仍放行，修正具体执行关联与失效计算后 GREEN。

最新验证：Manager 35 项、Web 174 项、Hermes 17 项、SDK 1 项、远程真实进程 1 项通过；TypeScript、生产构建、Ruff 通过。生产构建仍有既有大包警告，Python 有既有 utcnow 弃用警告。远程测试首次 WinError10013 临时端口绑定失败，原测试重试后实际通过；不推断未证实的系统原因。

实际联调：原生执行器运行真实 2 项进度测试成功，后台进入待审查，人工验收后任务 1/1。另一个真实失败进程退出码 3，后台创建问题；两次同步、两次转需求后均保持单个来源记录，任务 blocked、问题 open。SDK 和 CLI 对真实隔离服务读取成功。服务/数据/截图仅在 `.sop-runtime/`，未触碰项目实际业务数据。

截图：`.sop-runtime/delivery-execution-verified.png`、`.sop-runtime/delivery-execution-mobile.png`、`.sop-runtime/delivery-execution-failure.png`、`.sop-runtime/delivery-issue-feedback.png`、`.sop-runtime/delivery-stale-evidence.png`。失败链路证明：`.sop-runtime/delivery-failure-proof.json`；实际修改已验收任务后的失效证明：`.sop-runtime/delivery-stale-proof.json`。预览原成功任务现在刻意修改了内容，用于演示旧验收失效，完成状态截图保留修改前的验证时刻。新设计：`docs/DELIVERY_EXECUTION_DESIGN.md`。

Ruling: 保持已有运行权限而不自动授予业务角色 execute — 避免借工作台扩大权限 — 当前普通项目管理员可能只能查看执行，生产角色配置列为待办。

## 任务计划增量验收（2026-10-16）

上一目标轮有进展：已写入任务计划的前后端与客户端。中断后复验源码、缺失进程句柄及本地监听状态，确认预览服务已停再恢复；没有仅因观测超时重复启动。

设计 `docs/DELIVERY_TASK_PLAN_DESIGN.md`，计划 `docs/superpowers/plans/2026-10-16-delivery-task-plan.md` 的四项均已验收。新增独立 SQL 生成凭据、模板/真实网关代码路径、可调整计划、原子确认、依赖及验收追踪、创建后维护、SDK/CLI/OpenAPI。失败不自动回退模板，同一生成请求不重复模型调用；未调用真实收费模型。

一次独立增量审查发现5个 Important，均完成 RED→GREEN：旧任务空/部分planning渲染；AI缺省key规范化；legacy需求basis；前后依赖日期校验；已删除前置关系维护。后续关联变化永久作废旧运行，同值数组和纯日期保存保留验收；清除依赖与改期在最终图上原子校验。审查后未重复泛扫。

最终验证：Manager delivery 74项、Web 181项、SDK定向5项；TypeScript、生产构建、修改范围Ruff和diff检查通过。OpenAPI四路由、17动作、74本地引用、四模型105约束及16个TaskEdit边界案例一致。构建仍有既有大包警告；Python UTC弃用警告未改。此前全SDK有时区数据和Windows IPC断言两项既有失败，未声称全SDK通过。

真实浏览器：模板四项调整后只创建选中两项，标题/描述原样保存，后续任务等待前置交付。模拟另一协作者重排/新增验收条件后，提交409保留输入；查看最新需求并明确采用，原条件从索引0映射至1，最终只创建一项且数据库关联正确。TaskEdit日期维护保存成功。SDK和CLI对真实隔离服务重放同一个模板预览，结果ID一致。

桌面1440px及390px渲染验证、键盘Escape关闭通过；修正新计划弹窗背景透字。截图 `.sop-runtime/task-plan-editor-desktop.png`、`task-plan-editor-mobile.png`、`task-plan-created.png`；HTTP证据 `task-plan-ui-proof.json`、`task-plan-client-proof.json`；回归 `plan-fixes-final3.log`、`task-plan-web-tests.log`、`task-plan-build.log`。这些只在忽略目录内，不含认证秘密。演示编辑器截图为已取消的未提交草稿，创建结果另有独立截图与数据库证明。

## 下一项待办（仍保持完整目标）

1. 连续每日历史与累计流、跨入口统一事件流、计划基线、依赖甘特及图表联动、成员日历与工时容量、万级需求分页。下一项标识 `continuous_progress_baselines_capacity_and_portfolio_governance`。
2. 项目组合、项目本身的归档协作及保留策略、项目详情的需求/迭代/风险进一步整合。项目仓库/文档资料的可恢复归档及个人/团队交付事项聚合已在下方增量实现，不能据此标记项目归档治理完成。
3. 项目模型与需求解析/评审/原型已统一网关；继续完成 v2 治理策略、生产账户验证、更细用量归因及生成中断恢复。现有本地工作流 journal 可恢复等待，不等于生产 Temporal worker 或自动重放模型。
4. 可信 CI 测试/构建制品及具体提交的验收关联；真实部署、灰度、回滚及环境授权；智能告警、诊断、修复和需求回流闭环。
5. 厂商真实鉴权执行、统一 Agent 身份与生产角色授权、Temporal worker 及作用域审查合约、MySQL/OceanBase、性能与完整视觉回归仍未完成。旧 workflow 超时自动批准与需求直接 provider/规则回退已修复，不再列作待办；完整范围以 `docs/DELIVERY_WORKBENCH.md` 为准。

## 权限、模型与会话增量（2026-10-16）

前次中断前只启动下一项调查，没有修改，按无实质进展处理；缓存问答是旁支核验。本轮复核工作区后立即推进安全可执行项，保持完整目标 active，不缩减到本增量。

- [x] requirements/tasks/issues/sprints 统一有效 Bearer/已验证 HMAC、显式项目和读写角色；当前失活身份拒绝，API Key 依赖内绑定正确作用域。项目参数、正文及关联引用不得跨项目；保护路径的未知项目不隐式创建。真实 GET task 详情补齐，与列表单项一致。
- [x] models 配置实际进入 Chat、Embedding 及数据问答；任务模型/默认模型、凭据、地址、禁用均生效；已配置提供商失败不静默跨供应商。项目配置与凭据指纹隔离缓存，缓存命中零新增用量，错误及公开返回脱敏。
- [x] 同根目录的配置按 tenant/project SHA256 文件名隔离；旧 models.json 须运维明确指定唯一归属。环境引用仅当前项目专用前缀，拒绝服务端 SECRET_KEY/DATABASE_URL/global模型凭据和其他项目引用。既有非法引用明确失败，迁移说明已写入 docs/DELIVERY_MODEL_ACCESS.md。
- [x] 请求账号、登录修订、项目固定；迟到401/成功响应/自动项目绑定不能修改新会话，旧操作不在新账号下重发。主壳和全部独立子应用清理查询并重挂载观察者，刷新用户资料保留用户选择的项目；登录页探测同样固定会话。

一次独立审查发现 3 个 Important：clear缓存但observer仍保留旧数据、同路径配置跨项目、任意ENV引用外传。两项模型缺陷9个RED后GREEN；跨scope引用也拒绝。observer真实浏览器去掉重挂载key复现A→A，恢复key验证A→B；另用实际独立研发子应用验证11需求→第二项目0需求→切回恢复。没有重复泛扫。

最新验证：Manager 199项（74交付、69访问、53模型、3NLQ）、Web 202项、SDK/CLI定向17项；TypeScript、生产Vite构建40.48秒、新模块Ruff、diff检查通过。OpenAPI YAML无重复键、159本地引用及17 delivery动作正确。旧analytics文件51条lint与HEAD基线一致，requirements既有重复类定义未清理；弃用警告和大包警告仍保留。

实际HTTP：本地Ollama协议桩0收费、非真实AI。chat重放仅1网络、缓存0新token；AI预览凭据重放仅1网络、0自动创建Task；空路径第二项目初始配置空、禁用后503且无网络、第一项目仍enabled；匿名5类旧接口401，真实任务详情200。纯证据 model-transport-proof.json。真实页面从编辑器发起新AI预览显示ollama/local-transport-plan/28 tokens及协议桩说明，草稿随后取消。

窄屏新增证据暴露长验收多选字段横向溢出6px，修正grid minmax及select最小宽度；正文scrollWidth=clientWidth=311，截图model-plan-preview-mobile.png。桌面model-plan-preview-desktop.png、独立子应用standalone-project-isolation.png；观测者session-observer-browser.png。诊断HTML及认证bootstrap均在忽略规则内，原业务数据未改。

本轮最后补齐SDK get_task与CLI sop task show ID [--json]；新client/CLI测试12项RED→GREEN，加旧delivery5项共17通过，root复跑17通过。真实SDK/CLI与HTTP17字段完全相同，证据task-detail-client-proof.json。另追踪保护路径同类问题，在delivery/analytics/nlq观察到middleware仍调用旧初始化（2 RED），扩展禁止自动provision范围及确保初始化函数零调用后全Manager199通过；不是第二次独立泛扫。最后此保护路径扩展未重启SaaS演示服务，SaaS行为本已禁止自动provision，代码在测试进程验证，后续服务重启自然加载。

服务状态：Manager由business_access代理启动并持有session26932，Ollama协议桩session14688端口58519；Vite原root session66351。句柄在代理间不可共享，root原Manager40665已明确Ctrl-C终止后才重启，未因观测超时推断停止或重复占端口。隔离数据仍.sop-runtime/delivery-preview-ui。测试需求REQ-c786601b48ba472e，第二项目proj-6df00e1aa89b；诊断页面曾改变project code，已修复引导HTML及delivery_preview.py，今后启动同时恢复完整scope和独立登录revision。

## 需求辅助与工作流人审增量（2026-10-17）

上一目标轮为实质进展：已修改需求辅助后端、工作流实际人审、交互、客户端及契约，完成新的测试和隔离服务联调；本轮按已有证据继续验收，不缩减完整目标。设计 `docs/DELIVERY_ASSISTANCE_DESIGN.md`，计划 `docs/superpowers/plans/2026-10-16-requirements-assistance-and-workflow.md`。

- [x] 需求解析/评审/原型统一使用模型网关；用户明确选择 AI 或规则；失败不会静默规则回退；严格校验结构与生成来源，记录 model/provider/usage。
- [x] 网络前独立提交 SQL 生成凭据，成功、失败及进行中的固定请求不重复模型调用；采用按 generation、需求 basis、项目 CAS 及幂等身份检查；同内容重放优先于新基准检查。
- [x] 采集草稿逐条编辑和选择后原子导入；评审条件及原型先编辑再确认；旧基准冲突保留输入、查看最新内容并明确采用。原型预览不写业务，采用追加修订产物与来源历史，不自动推进阶段。
- [x] workflow 信号实际改变代码审查、迭代及问题分诊状态；意见和固定信号身份必需，审核人由服务端记录；超时继续等待、失活/跨项目拒绝，终态不能改写。本地 journal 恢复已记录等待/决定，不自动重放模型，也不直接完成业务 Task 或 Issue。
- [x] 前端明确 AI/规则、来源、用量和旧预览；失败重试及冲突不清空草稿；按工作流类型、阶段及权限显示人工操作。SDK/CLI 提供固定启动身份、审查意见、历史、原型预览和显式采用。
- [x] OpenAPI 与真实输入、认证、作用域及响应一致：新增 19 路径/20 操作/49 schema，389 个本地引用解析通过，既有 17 个 delivery action 保留。
- [x] 最后来源名称、epoch 时间格式文案修正后的浏览器复验与截图；来源显示项目 AI 模型，审查时间使用本地日期。真实 API 再核验 4 条验收、人工编辑原型、要求修改意见/审核人及仅 1 条信号持久化，原业务任务仍 pending。

一次独立审查发现 3 个 Important，已复现并修复；没有再次泛扫。旧 `admin` 角色别名维持既有租户管理权限且不改数据库角色。源码等价类型修正后需求辅助输入 schema 对照保持一致，减少新代码 lint，旧文件遗留项未声称清零。

回归证据：`assistance-manager-full.log` 为 Manager 309 项通过，`assistance-web-tests.log` 为 Web 223 项通过，SDK/CLI 35 项通过；最后修正后 `assistance-final-check-manager.log` 需求辅助 27 项、`assistance-final-check-clients.log` 客户端 35 项再次通过。TypeScript、Vite 生产构建（48.75 秒）、新增模块和工作流 Ruff 检查通过。Python UTC/Pydantic 弃用、旧文件 lint 与大包警告保留。OpenAPI 证据 `assistance-workflow-openapi-proof.json`；不声称全 SDK 或所有旧模块均通过。

真实 HTTP 证据 `assistance-http-proof.json`：同一 AI 请求仅 1 次网络、规则零请求；模型错误 502 且重试不再请求、没有规则回退；仅导入选中的编辑条目，重放 ID 一致；评审采用重放和旧基准 409；原型预览保留现有内容、追加 2 版且重放不追加。workflow 超时无决定，人工要求修改记录 `preview-lead` 且信号重放只有 1 条；迭代暂停、恢复、逐项审查及关闭成功，业务任务仍 pending。

真实浏览器：规则两草稿选择一条并人工编辑，导入 `REQ-ed097be8b3d24354`；AI 评审 30 tokens，制造 409 后输入保留，查看最新基准并明确采用后 4 条验收条件持久化；人工编辑原型后保存实际设计产物。故障重试没有新增模型调用，旧预览保留。390px 下表单 clientWidth/scrollWidth 均 273，页面均 375，截图 `requirements-assistance-mobile.png`。工作流 `ui-review-a903e4102b` 超时无决定，随后人工要求修改及意见实际成功并记录审核人。证明 `assistance-ui-fixture.json`、`assistance-ui-proof.json`；最后来源/时间已修正，并保存 `workflow-human-review-desktop.png` 与 `workflow-human-review-mobile.png`，窄屏审查区域 clientWidth/scrollWidth 同为 306px。

以上服务及业务数据均为 `.sop-runtime/` 隔离 fixture。模型仅 loopback Ollama 协议桩，未调用收费或真实外部推理，不能证明生产账户质量。完整目标保持 active，`production_integration_complete=false`，未提交 Git。待办继续覆盖项目资源与个人交付聚合、连续历史/基线/容量/甘特/分页、v2/生产授权、可信 CI、真实部署回滚及智能运维。

最终显示修正后：Web 全量 224 项通过（33 文件，14.89 秒），TypeScript 与 Vite 生产构建通过（44.86 秒，既有大包提示）；新增 epoch 时间/三语来源渲染测试先失败后通过。日志 `assistance-date-red.log`、`assistance-date-green.log`、`assistance-web-final-tests.log`、`assistance-web-final-types.log`、`assistance-web-final-build.log`。实际 UI 与 HTTP 证据 `assistance-ui-proof.json`，视口覆盖已恢复，未修改正式业务数据。

## 项目资料与交付待办增量验收（2026-10-17）

本轮继续完整主计划，完成项目资料及个人/团队交付聚合。设计 `docs/DELIVERY_PROJECT_INBOX_DESIGN.md`，计划 `docs/superpowers/plans/2026-10-17-project-resources-and-inbox.md` 五项均完成验收；文档定稿后的证据散列和清理回执由 root 统一生成。

- [x] 真实 Project 名称、简介按提交字段保存；configure 与原有 write 权限分开，未编辑目标、负责人和日期保留。资源分类、编辑、归档及同 ID 恢复保留来源，使用既有 CAS/幂等/活动事务，危险 URL 拒绝。
- [x] inbox 投影真实快照，稳定 User.id 个人归属、同名身份歧义处理、mine/team 范围、分类去重、实际门禁、当前有效待验收、失效执行及 UTC 日期；读取不写库、不推进阶段。
- [x] 概览关联、资源编辑及冲突恢复、个人/团队筛选与精确定位；问题入口不自动打开需求抽屉，明确点击关联任务/需求并可返回。无需求任务进入独立任务执行页，按 task_id 精确过滤，不自动批量勾选；刷新保留目标，返回恢复团队待办。
- [x] SDK/CLI/OpenAPI 同步；当前 19 个 delivery action、403 个本地引用及既有契约保留核验通过。
- [x] 独立审查修复、最终全量回归与构建、真实 HTTP/浏览器及项目切换验证、状态和完整待办更新。

唯一一次独立审查发现 1 个 Important（问题精确入口被需求抽屉遮挡，关闭后又丢定位），已完成 RED→GREEN 定点修复和独立确认。独立后端 70 项、客户端 5 项、前端 14 项通过，当前审查范围没有未解决的 Critical/Important，没有重复泛扫。root 浏览器另修复独立任务路由、权限加载/失败误显示只读，以及固定阻塞原因的三语显示。

root 最终回归：文件 SQLite NullPool 方案下 Manager 全量 384 项通过（80.82 秒，`manager-final-pool.log`，退出 0）；SDK/CLI 定向 40 项、Web 全量 241 项（36 文件，31.48 秒）通过，TypeScript 及 Vite 生产构建退出 0（77 秒，既有大包警告）。日志归档于最终证据目录 `validation/`，包括 `web-verified.log`、`web-build-verified.log`；既有 Python 弃用、旧 lint 和大包问题的历史边界继续保留。

真实 HTTP `http-proof.json` 验证 canonical Project 部分更新、资源创建/编辑/归档/恢复、固定请求重放、409 无副作用、5 类危险链接 422、跨项目资源拒绝、个人/团队分类去重、SDK/CLI 响应相同及读取版本/事件数不变。真实本机 Python 进程退出码 0，当前有效执行进入 awaiting_review，业务 Task 仍 in_progress，没有自动验收。

真实浏览器新增、编辑、归档和恢复均成功；危险链接失败和并发 409 保留输入，查看最新数据后明确采用并提交。问题→关联任务→返回→刷新及独立任务精确列表经过实测；中文、英文、日文 390px 无横向溢出，键盘 Tab 可达。最终切换第二项目显示 0 待办、0 资料，账号“林晓”保持；返回原项目恢复 3 条资源及已保存草稿内容，没有误导只读，截图 `project-switch-empty-inbox.png`、`resources-desktop.png`。资料示例明确标为 Multica 参考及本地测试规范，不冒充当前代码库或真实生产资料。

最终证据统一在 `.sop-runtime/delivery-evidence/project-inbox/`：`resources-contract-verification.json`、`http-proof.json`、`independent-review.md`、`independent-review-verification.json`、`auth-concurrency-verified.json`、`validation/` 回归日志及桌面/窄屏截图。汇总 UI/验证证明、源码与证据散列、临时目录清点及清理回执由 root 在文档定稿后保存。临时测试/构建目录为 `.cache/project-resources-inbox/`，遵守先清点散列、保留唯一证据、验证路径、不遍历链接目标的清理规则。未在盘符根创建目录、未改变机器/用户环境变量。

所有服务和数据均为本地隔离 fixture，外部模型调用 0，未提交或发布。完整主目标 active，`production_integration_complete=false`；后续仍包括连续进度/基线/容量、项目组合归档、生产身份与模型治理、可信 CI、实际部署回滚及智能运维，以上“下一项待办”保留全部未完成范围。

并发认证缺陷修复记录（保留失败与中间验证）：同一最新有效 token、当前/第二项目完整作用域交替，12 并发共 48 个纯 GET `/auth/me`，文件 SQLite StaticPool 得到 44 个 200、4 个 401“用户不存在或已禁用”，无写入；顺序全部 200。证据 `auth-concurrency-before.json`，定位至 StaticPool 跨请求复用连接。中间 QueuePool 方案得到 19 个 200、29 个超时，未采用。最终文件 SQLite 改用 NullPool，内存 SQLite 保留 StaticPool，MySQL 和权限规则不改；相同 12 并发 48 请求全部 200、0 超时，证据 `auth-concurrency-verified.json`。新增 5 项连接池回归先失败后通过，定向 118 项及最终 Manager 384 项通过。此前 Manager 379 项为该修复前的通过记录，保留历史；旧作用域权限修复的历史结论不改写。

验收证据已完成清点：594 个本轮临时文件已计算散列，31 份重要日志/脚本/基线报告已保留到证据目录 validation/；随后仅清理已核实的 .cache/project-resources-inbox/。cleanup-receipt.json 记录删除范围及清点散列，源码、最终截图和运行中的隔离预览均保留。

## 阶段性提交约定（2026-10-17）

用户要求阶段性完成后统一提交全部改动。后续每个阶段完成实现与相关验证后，将该阶段全部非忽略源码、测试、契约、文档及进度记录提交到当前工作分支。依赖缓存、本机认证、运行数据库及临时目录继续忽略。

本次提交范围为已验证的项目交付工作台、执行与人工验收、任务计划、权限与模型隔离、需求辅助与工作流人审、项目资料及交付待办，共 130 个文件。提交前逐一核对与最终源码散列相同；随后追加提交约定，并统一 4 个 Python 文件的换行及末尾空行，前后 AST 一致，业务逻辑不变。最终验证记录为 Manager 384 项、Web 241 项、SDK/CLI 定向 40 项、TypeScript 和生产构建通过；完整产品目标及未完成清单继续保留。

## 真实进度与不可变计划基线增量（2026-10-17）

设计见 `docs/DELIVERY_PROGRESS_DESIGN.md`，实施计划 `docs/superpowers/plans/2026-10-17-delivery-progress-and-baselines.md`。本节更新先前历史记录中的“下一步连续历史/基线”，完整主目标继续 active。

- 独立 SQL 观测与业务事务原子保存，覆盖旧任务/需求/同步入口、ORM 与 Core 批量写入。嵌套回滚不留幽灵记录，同日 A→B→A 保留；转移项目/租户时两侧都保存最终实际范围，未知写者不冒领此前审核人。
- 每日采集独立于 Hermes，分页检查真实活跃租户/项目，多实例 checkpoint 去重。GET 不写历史，停机缺口不补造。项目日期查询在 SQL 选择每日最后事实，coverage 使用聚合；命名范围仅分页投影轻量 scopes 元信息，避免短窗口装载全期快照。
- 六类任务状态互斥，运行成功、待验收、仅登记完成与已验证完成分别表达；需求验收/发布独立计数。冻结基线使用 approve、完整 task_ids、内容 basis、项目 CAS 与固定重试身份。基线不可覆盖；新计划另建，新增/移出/计划字段变化显示真实前后值，删除任务保留只读快照。
- 新进度页提供 UTC 日期和范围筛选、燃尽/累计流、同源键盘列表、图表点击、历史详情、当前任务精确导航及返回/刷新定位。旧 Sprint 保留兼容字段，实际历史同源并明确未验证口径，两种图形实现都保留缺口。中文/英文/日文和 390px 布局已实际核验。
- OpenAPI 新增 4 个读取路径（含旧 Sprint 契约）、保留 21 个 delivery 动作，475 个本地引用解析通过；52 个既有路径和 100 个既有 schema 保持语义不变，原 Command 仅追加两动作/条件与说明。SDK/CLI 三个只读入口与固定 Command 同步。

唯一一次独立审查发现三项 Important：变化值未显示、Core 迁移漏记目标项目、短窗口加载整个历史，均定点修复。root 原复现脚本确认目标项目新观测包含迁入任务，1 日查询的 53 份完整快照从全部装载降为 1 份，范围外装载 0；更大 project/命名范围/Sprint 测试为 455/602/251→各 1。没有进行第二轮泛扫。

浏览器另发现并修复 ECharts 默认导出兼容、缺少 scroll legend 模块及旧基准 409 恢复分类。实际图表已有两份 canvas，单日真实点与固定计划参考线分别表达；点击点或键盘列表都打开同一历史。日期原生键盘调整与应用生效；工具的 date fill 事件有限，不把自动化适配限制误称为产品失败。冻结冲突保留名称和说明，查看最新任务的负责人/估算/日期、明确采用后实际保存新基线。历史跳当前任务与返回恢复经过实测；已删除任务继续只读。

最终验证：Manager **440 项**（197.32 秒）、Web **263 项/41 文件**（60.98 秒）、SDK/CLI 定向 **55 项**通过；TypeScript 与 Vite 生产构建退出 0（1 分 1 秒）。Python/Pydantic 弃用、既有测试提示及大包警告保留，未声称全 SDK、旧 lint 或生产数据库均已通过。

真实隔离 HTTP 验证手工记录/基线重放零重复、旧任务修改不增 workspace.version 仍被 basis 409 拦住、失败零副作用、跨项目读取拒绝、冻结与删除历史不可变、固定理想线与真实缺口、SDK/CLI 三读取一致。最终服务重启后再次确认两份基线和原历史保留，读取前后 11 份观测、2 份基线、103 条事件均不变。当前示例 14 任务中 1 待验收、0 已验证，未通过图表自动完成工作。390px 页面 clientWidth/scrollWidth 均 375，进度区域均 333；三语无横向溢出。

证据统一在 `.sop-runtime/delivery-evidence/progress-baselines/`：`http-proof.json`、`http-final-read-proof.json`、`ui-proof.json`、`independent-review.md`、`review-probes-fixed.json`、OpenAPI 回执、测试日志和桌面/窄屏截图。所有服务与数据均为本地隔离 fixture，外部模型调用 0。清理仅限已清点散列并保留重要证据的 `.cache/delivery-progress-baselines/`，最终清理和 Git SHA 见回执。

按用户约定，本阶段全部非忽略代码、测试、契约、文档和进度记录统一提交到当前分支，不推送。完整目标仍 active，production_integration_complete=false；下一步继续成员日历/容量、依赖时间线与项目组合/归档治理，生产身份/模型、可信 CI、实际部署回滚、智能运维及规模验证保留待办。

## 人工任务验收与统一依赖增量（2026-10-17）

设计见 `docs/DELIVERY_MANUAL_REVIEW_DESIGN.md`。按用户最新要求，以合理目标设计直接重构，不新增历史格式兼容层或双源桥。必要的原始验收依据、人工证据及永久失效记录用于判断交付有效性，继续保留。

- 新增 SQL `delivery_task_reviews`，人工任务通过明确审查和证据登记获得有效交付。无原生执行、当前唯一活跃人类负责人、已登记完成且无真实阻塞才可通过；原生任务继续使用运行审查，人工入口不能绕过。退回追加决定并回到进行中，不覆盖原意见与证据。
- 审查固定任务 basis、项目版本及幂等身份。内容、需求、归属或依赖变化在业务事务内永久作废旧通过，A→B→A不会复活；纯日期维护保留有效交付。身份失活/移除、ORM/Core及回滚参与同一观测链。历史审核人后来失活不抹除其当时合法记录。当前判定以 SQL 每任务最新 seq 查询，分页证据另按游标读取。
- DeliveryWorkspace 是唯一任务前置图。图、派单、调度、订阅、领取及状态写门禁消费同一有效验收；删除旧文件图与重复依赖 POST/DELETE。仅登记 completed 不解锁依赖，include_blocked 只控制可见性。需求/任务显式阻塞继续阻止开始，只有单纯状态阻塞时允许明确恢复。
- 有关联需求和独立任务共享计划编辑器，关联写固定 `task_basis`，移除该 Command payload 的旧 requirement_basis/revision；模板预览与新计划仍使用自身需求依据。独立任务可维护前置关系，不能伪造需求验收索引。只读依赖图节点和任务标题精确进入同一计划/验收入口。
- 需求详情和独立任务提供人工验收区、资格说明、原始证据与失效记录。409保留意见/证据，读取最新事实后明确采用；删除任务时计划草稿保留，缺失新任务不可采用。编辑中固定工作区快照；读取最新失败清除旧可采用候选。任务页原始完成指标明确为登记口径，三语和document.lang同步。
- typed GET `/api/v1/delivery/tasks/{task_id}/reviews`、SDK `delivery_task_reviews`、CLI `sop delivery reviews` 与 OpenAPI 同步。契约22个delivery动作、496个本地引用解析通过，严格YAML无重复key，9项实际输入模型边界核验。任务计划Command schema正确使用TaskEdit，普通Task PATCH TaskUpdate保持实际接口定义。

唯一一次独立审查发现4项P2：需求阻塞漏入门禁、单纯状态阻塞无法直接恢复、独立任务编辑可能卸载丢稿、静态TaskEdit/TaskUpdate契约错置，均已定点修复。原2项SQL探针与回归83项通过；root最终服务真实HTTP验证前两项，实际界面验证删除草稿保护，接口导出与模型边界验证第四项，没有第二轮泛扫。

最终验证：Manager **479项**（325.14秒）、Web **281项/46文件**（61.46秒）、SDK/CLI相关 **40项**通过；TypeScript、生产构建（1分45秒）、相关Python Ruff及差异检查通过。既有Python/Pydantic/AntD弃用和构建大包提示保留，未声称全SDK、全部lint债务、所有主题/浏览器或生产数据库已验证。

实际隔离HTTP验证了登记完成阻塞→人工通过解锁、重试零重复、内容A→B→A永久失效、日期保持、旧表单409零写、退回、独立计划、分页/权限/跨项目及SDK/CLI一致。最终服务重启后审查证据保留，人工入口拒绝原生运行任务，需求阻塞两入口均409、单纯blocked可200恢复；GET不写证据/观测/事件/receipt。实际界面完成独立和需求任务审查、409明确恢复、计划保存导致旧验收失效、删除任务后保留草稿、键盘关闭及390px三语无横向溢出。

证据统一在 `.sop-runtime/delivery-evidence/manual-task-review/`，含原审查与修复回执、HTTP/UI证明、桌面/窄屏截图、完整测试/类型/构建日志、源与证据散列、临时目录清理和阶段提交回执。初次测试收集受到既有失效.ai-memory链接影响，使用明确测试根后完整通过；pnpm自动依赖检查中止后直接使用现有已安装工具完成测试和构建，没有重装依赖或外部模型调用。

`.pnpm-store/`继续忽略且0跟踪；新增忽略`*.tsbuildinfo`并取消已生成构建缓存的Git跟踪，保留本地缓存。完整主目标继续active；本阶段全部非忽略代码、测试、契约与文档统一commit，不推送。下一阶段继续成员容量/日历、依赖时间线、项目组合和归档治理。现有启发式派单名称不等于真实在线Agent身份，生产外部账户/模型、可信CI、实际部署回滚、智能运维及规模验证继续保留待办。

## 团队资源日历与依赖排期增量（2026-10-17）

阶段设计与最终实现/边界见 docs/DELIVERY_SCHEDULING_DESIGN.md 和 docs/DELIVERY_WORKBENCH.md 本增量。移除旧capacity计数和固定默认，小时/槽位分开、null未知/0不可用；完整日历与显式预留、统一最终图校验、全项目planning_basis、纯读预览和原子批次落地。仅有效验收释放活动负荷，纯计划维护保留验收，预留进入实际观测与不可变任务基线，旧未采集字段明确未知。

唯一独立审查2个P2已定点修复：严格civil date与最大366日预留；实际HTTP原问题422/366日200复验通过。联调修复预览审计副作用，GET/preview前后21张表散列一致；普通写请求审计保留。排期与进度六态统一。最终Manager547、Web304/49文件、相关SDKCLI55绿；最后小幅展示整理后表单5、TypeScript/生产构建39.39秒绿，相关PythonRuff与差异检查绿。

真实浏览器完成容量409保留/读取/明确采用、完整窗口外例外、两任务前后预览与保存、筛选外占用、任务定位/返回/刷新、三语390px/键盘与项目隔离。最终隔离项目version140，C每日3小时、周二项目6.5/4超2.5，原已验证交付保留。第二项目0任务/容量未知，原项目已恢复。页面375/375、规划区333/333，表单374/374及抽屉375/375无横向溢出。验证工具的分段标签/浮层动画需正确target和hidden等待，已排除产品bug，未为适配限制修改业务逻辑。

证据 .sop-runtime/delivery-evidence/team-scheduling/ 包含http-proof.json、final-http-verification.json、final-read-after-ui.json、ui-proof.json、审查/修复、测试/构建、源与证据散列及清理/提交回执。磁盘满导致接口文档写入中断，从完整快照恢复并核验新导出；旧dist/.vite先散列再清理，重要源和截图保留。任务scratch仅清理已核实范围，活跃预览和本地认证保持忽略。

阶段全部非忽略改动commit，不push；.pnpm-store缓存0跟踪。完整主目标active，production_integration_complete=false；下一步项目组合/项目归档/团队治理，生产身份与模型、可信CI、质量发布、部署回退、智能问题与运维闭环、规模验证继续待办。参考平台按具体能力接入，不作为强制部署依赖。
