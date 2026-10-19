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
- [x] 早期工作台已完成构建、接口、核心交互与窄屏视觉验证；后续增量的实际验证与限制逐阶段记录，不能沿用早期截图代替当前视觉核验。完整范围见 docs/DELIVERY_WORKBENCH.md。

## 环境与决定

- 当前分支 branch-3.x，初始工作区干净；在用户指定工作区实现并按后续授权阶段全部提交，不推送。
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

1. 连续每日历史与累计流、冻结计划基线、依赖时间线、成员每日容量/日历、资源预留及原子批量排期已在后续增量实现。本阶段补充活动导航、需求观测版本/变更影响与 Sprint 有效验收统计；当前390px三语实机视觉及万级需求/任务定向读取、服务端分页仍待完成。
2. 项目组合、项目生命周期/归档治理、资料可恢复归档、个人/团队交付待办及团队稳定身份/运行关联已在后续增量实现。跨存储与通用入口的统一活动仍待完善；本阶段通用需求写只采内容历史，不伪装成交付命令事件。生产长期保留策略及项目详情的规模整合继续跟进。
3. 项目模型与需求解析/评审/原型已统一网关；继续完成 v2 治理策略、生产账户验证、更细用量归因及生成中断恢复。现有本地工作流 journal 可恢复等待，不等于生产 Temporal worker 或自动重放模型。
4. 可信 CI 签名/提交证据与候选、受控部署及隔离真实回滚、问题证据诊断与人工唯一需求回流已实现；生产 CI/原生 Sigstore、真实基础设施灰度与环境授权、告警接入、自动修复执行及长期质量验证仍待完成。
5. 厂商真实鉴权与生产模型、生产角色授权、Temporal worker、MySQL/OceanBase、干净锁定安装、性能与当前完整视觉验证仍未完成。统一 Agent 稳定身份已实现；旧 workflow 超时自动批准与需求直接 provider/规则回退已修复，不再列作待办。完整范围以 `docs/DELIVERY_WORKBENCH.md` 为准。

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
- 新进度页提供 UTC 日期和范围筛选、燃尽/累计流、同源键盘列表、图表点击、历史详情、当前任务精确导航及返回/刷新定位。Sprint 数字 day 图与日期图均使用实际历史并保留缺口；统计已在下方协作增量统一为有效验收六态。此进度阶段的中文/英文/日文和 390px 布局已实际核验，不替代后续增量视觉验证。
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

## 外部 Agent 与测试交付增量（2026-10-17）

设计 `docs/DELIVERY_EXTERNAL_EXECUTION_DESIGN.md`，计划 `docs/superpowers/plans/2026-10-17-external-agent-delivery.md`。使用原业务 Task、交付意图与 Hermes 运行，明确本机/设备目标及固定 task/target/Agent 依据；不保留名称领取、名称心跳和人工报告三个旧写通道来模拟实际执行。

- [x] 公开设备运行策略：工作区权限、config+execute、设备 CAS、完整替换及固定身份重放；权威 can_configure_policy 供 UI 控制入口。设备凭据 presence 与配置版本分开，120 秒时效、worker/能力依据、撤销及配对凭据轮换；程序检测不冒称厂商账号认证，auth 保持 unknown。
- [x] 单 Agent 后置命令测试复用串行引擎；绑定 provider/Agent/固定配置版本与有效终态，派发同时校验 Agent 和后置 command 能力。Agent 文本与 exit 0 不冒充测试；失败不自动完成业务任务，人审和当前有效验收仍是唯一交付门禁。
- [x] typed targets、纯 execution-preview、游标 observations 及 SDK/CLI/OpenAPI 同步；固定 task_basis/target_basis、项目版本和重试身份，预览零业务/运行/审计写入。原目标、Agent、计划节点、测试定义、尝试与原结果来源保持可追溯。
- [x] 四界面落地：明确目标/命令表单/固定预览/409 保留与显式采用；完整设备策略编辑；实现、测试、人审三阶段与游标事件、已观测输出；当前和历史尝试、具体 Issue 与背景返回。当前失效覆盖旧 accepted 观测；未配置后置测试仍可合法人工核验，保持未配置标识且不造测试产物。三语及窄屏实现沿用现有主题与组件。
- [x] 旧名称 claim/heartbeat/report API、SDK/CLI 与 Web 写入口删除；历史登记只读，不代表在线、有效测试或已验证交付。失败问题转需求去重，原问题不自动关闭。

本阶段唯一增量独立审查 3 个 P2 已定点修复：UI 无测试人审被禁、旧终态观测遮蔽当前失效、畸形 provider 嵌套事件产生 500 或错误接受。非法事件返回 422，后置测试不被解锁；保留真实 RED→GREEN 回归，不进行第二轮广泛审查。

root 已核验 Manager 全量 **576 项/135.14 秒**、Web 全量 **322 项/53 文件**、SDK/CLI 相关 **114 项**，TypeScript 退出 0、最终生产构建退出 0（31.01 秒）。Web 定点修复整卡渲染回归先复现无测试按钮 disabled 与旧失效仍显示 Verified delivery，再验证修复；日志 `web-review-red.log`、`web-review-green.log`、`web-review-types.log`。Hermes 全量170通过/15环境平台跳过（111.57秒），已有原生agentd补充6文件84通过/2 POSIX跳过；生成器1项通过。

实际公开回路 `.sop-runtime/delivery-evidence/external-delivery/actual-loop-proof.json` 已成功：公开 policy→pair→presence，持续真实 worker/agentd→本地 Codex 协议 fixture→独立 Python 单测→后台回写→人工验收。成功任务经人 accepted；失败测试生成唯一 Issue `ISS-4f0f1975a70c4318`，转需求重放保持唯一 `REQ-5deecce1ed9f42e9`，Issue 仍 open。首次结果上传返回网络 503，durable outbox 实际落盘重发；两个业务运行只启动 **2 次** Agent 进程，确认传输重试不重复执行。外部厂商模型调用 **0**，账号认证 unknown，未宣称生产模型或厂商实机认证通过。

证据统一在 `.sop-runtime/delivery-evidence/external-delivery/`。源码与current_state记录当前验证状态，最终源/证据散列、scratch清点清理与阶段全部commit由root收尾，不push；保留本地凭据、运行数据库和历史用户文件。

完整目标保持 **active**，`production_integration_complete=false`。下一项与完整剩余范围继续保留：独立任务原生执行及自身验收条件、完整节点内部日志/干预恢复、团队与 runtime 稳定身份绑定、生产账户/模型、可信 CI 与提交级证据、项目组合/项目归档治理、版本和质量发布、真实部署/灰度/回滚、问题智能处理与运维闭环及规模验证。参考平台按具体能力吸收或接入，不成为全平台强制深接条件；不得用本阶段局部通过缩减用户全链路目标。

最终UI与真实HTTP：ui-proof.json记录390px三语页面390/390、抽屉375/375、派发表单311/311；具体Issue/键盘返回、任务变更409保留参数→读取→显式采用→重预览→保存均通过，未启动计划随后取消。最后恢复已验收任务。纯GET对28张Manager/运行/检查点表零写，跨运行cursor422、跨项目404、原验收保留。严格YAML与559/118引用、25运行模型/54动作、216包lock离线check通过。相关lint与既有债分类留档。Windows测试解释器PID/Git CRLF按本机实证修fixture，不改生产检查。生产干净locked安装仍属后续验证边界。

## 任务自身验收与独立交付增量（2026-10-17）

设计 `docs/DELIVERY_TASK_ACCEPTANCE_DESIGN.md`，计划 `docs/superpowers/plans/2026-10-17-task-acceptance.md`，统一术语见根 `GLOSSARY.md`。SQL Task 自身文本条件为唯一正式定义；原整数需求关联明确命名 `requirement_criteria_indices`，不保留歧义别名、不隐式继承整份需求或创建假需求。草稿可空，派发/人工通过前必须有当前有效条件。

独立与关联任务共用原生派发、测试、人审、失败 Issue 及转需求。共享纯定义固定自身条件、来源、可选真实需求、负责人及依赖，正常状态/日期不导致执行自行失效。变更、转属、删除和身份失活/改名在原事务永久作废旧证据；A→B→A不能恢复。集体需求验收同样作废，带锁/条件版本写避免覆盖新意图；工作台显式 reservation 保证命令不重复推进版本。

普通 API、同步、导入、CLI/离线队列及智能体任务资料携带自身条件。Task JSON 绑定校验与 Session Core guard覆盖普通/批量/绑定参数，拒绝非法文本和无法验证的表达式；进度观察器按实际参数定位作用域。`recorded_status` 与六态交付状态分别呈现，旧未采集条件明确未知。显式 schema verify/apply 不在正常启动隐式 ALTER；SQLite 升级已实测，PostgreSQL仅DDL编译，旧MySQL/OceanBase自动升级明确拒绝，仍需目标库迁移验证。

统一任务详情复用执行面板：逐条条件增删排序、明确需求条目、真实条件/目标预览、当前与历史证据；成功三阶段优先显示。独立详情聚焦，Issue精确返回原任务。实际390px条件编辑、键盘排序、保存刷新、409保留三条条件及描述→查看最新→Enter明确采用→保存均通过；三语无横向溢出，手机顶部改紧凑标题与工具行。

唯一完整增量独立审查发现P1和P2各一项，均已定点修复复验：失效completed旧运行可安全关闭原意图、保留运行结果及当前Task，并重新派发；Core写入不能提交数字/布尔/null条件。没有新增广泛审查，未解决审查项0。真实最终HTTP也运行本地Python命令到completed后修改条件、关闭旧意图并再次queue，运行结果和当前pending状态保持，未启动的新意图随后关闭。

root核验Web全量339项/57文件、SDKCLI相关85项、TypeScript构建及最终Vite构建通过（移动CSS后73秒）。Manager全量653通过/2处旧fixture断言失败（485.02秒），修正后两文件49项通过；最终跨域139项及最新SQL/作用域69项通过，统计有重叠，不累加冒称全量次数。相关新代码lint与差异检查通过；既有弃用和大包警告保留。最初pnpm自动依赖检查因无TTY终止，未清空依赖；使用现有依赖的直接本地工具完成实际测试和构建。

真实公开Agent回路：两个独立任务均未生成需求；真实worker/agentd与本地协议fixture完成实现、Python成功/失败测试。成功任务经人审为已验证并解锁前置；失败仅创建一个Issue，转需求重复提交保持唯一，Issue仍open。厂商模型调用0，认证仍unknown。最终35任务/30需求、项目version219，28张Manager/运行/检查点表在纯GET前后完全相同，跨项目404、跨运行cursor422，原已验证任务保留有效。

证据 `.sop-runtime/delivery-evidence/task-acceptance/` 包含validation-proof、actual-loop-proof、actual-stale-completed-recovery、final-http-proof、ui-proof、contract-proof、唯一审查及定点复验、三语/桌面截图、源码与证据散列、scratch清理和commit回执。scratch清点哈希并保存重要源码后清理，活跃预览数据库和凭据保持忽略。按用户要求全部阶段非忽略更改commit，不push；.pnpm-store零跟踪。

完整目标仍active，production_integration_complete=false。继续团队成员与runtime稳定身份绑定、项目组合与归档治理、完整节点内日志/干预恢复、生产账户/模型与干净锁定安装、可信CI提交级证据、版本/质量发布、真实部署灰度回滚、问题智能处理与运维闭环及规模验证。参考平台按具体能力选择吸收/接入，不以本阶段子集缩减用户全链路目标。

## 团队稳定身份与协作工作台增量（2026-10-17）

设计 `docs/DELIVERY_TEAM_IDENTITY_DESIGN.md`，计划 `docs/superpowers/plans/2026-10-17-team-identity.md`。SQL `Task.owner_id` 是唯一任务归属源，删除名称存储列和 `DeliveryWorkspace.task_owners` 旧 map。`assigned_to` 仅为当前名称只读投影，普通 CRUD、批量、计划、调度、同步、导入、74 个治理 DTO 及 Web/CLI 写入都使用稳定 ID。默认角色标签不再制造负责人；缺少明确身份时保存未分配草稿，派发和验收必须有有效人员或 Agent，工具不能担责。

新规范下改名不改变 Task basis、原生或人工验收、集体需求审批与进度基线；原审计名称保留。停用、移出项目、重新分配在原事务永久作废旧证明，恢复旧值不能复活。人工审批人仍需真实 approve 权限，责任 Agent 的人工验收明确标记 manual，不冒充真实 Agent 运行，也不能绕过已有 native 意图。普通及 Core/批量绑定 SQL 共用范围校验与生命周期观察。

显式 schema verify/apply 仅迁移同租户、同项目真实任务的明确旧 ID，不按名字推断；缺失成员 ID 保留为不可用。冲突、非法 ID、DDL 失败的 SQLite 事务回滚已实测。旧无版本 tested_work/dependency_basis 不改绑为新依据，须重新评审；原审计不改。PostgreSQL 仅 DDL 编译，现有 MySQL/OceanBase 升级仍拒绝。预览实际迁移31个明确负责人；捕获的数据库快照核验为升级后，已如实标注，未冒称升级前回滚备份。

团队列表、成员详情、共用负责人选择和任务派发表达统一：搜索/类型/登记状态筛选与 team_member 深链，姓名+类型+稳定ID区分同名，停用/缺失选择有明确提示，角色说明不授予权限，真实执行者/设备独立选择。本次不虚构运行绑定或已连接状态。负责人变更带当前所见 task_basis，409不自动采用新依据。关闭动画保留原可见内容到退场结束，未知非空ID不回退，跨项目不保留；修复旧grid样式冲突与负责人原因三语遗漏。

root最终核验：Manager完整850项通过（412.67秒），Web完整360项/63文件通过（28.99秒），SDK/CLI相关24项、额外路由定点3项通过，TypeScript noEmit和最终生产构建通过（57.52秒）。此前完整833通过/1处旧改名断言已修复，并在最终完整运行消除。唯一独立增量审查的1个P2空值协议问题已修复并独立定点复验；没有第二轮宽审。旧代码E9/F债对比无新增，弃用与大包警告留档。

真实公开HTTP证明：Agent同名不转移归属、改名保留basis/验收/原审计、停用恢复不复活、普通编辑省略保持/空串清空/重分配、工具/未知/跨项目拒绝、未分配草稿阻止派发。原真实native成功任务在人类用户名实际ORM改名及恢复后仍verified，原执行快照与运行/检查点不变。最终37任务/30需求、项目version229；纯GET前后28张表完全相同。非法写入按原审计机制追加4条审计，业务/进度/运行无变化；未关闭审计以制造零写结论。厂商模型调用0，未声称生产认证。

实际浏览器：团队搜索与成员深链、键盘进入成员和关联Task、停用保存、不可用负责人提示、稳定ID搜索并Enter重新分配成功，刷新仍为新owner，返回保留成员/筛选；关闭两类详情不再闪missing。390px中英日document390/390、drawer390/390，最终桌面1280/1280、详情560/560，恢复中文和默认视口。证据 `.sop-runtime/delivery-evidence/team-identity/` 包含验证、HTTP、UI、严格契约711引用、审查复验、截图、源码散列、清理与commit回执。

本阶段全部非忽略源码、测试、契约、文档和记忆统一commit，不push；`.pnpm-store/`仍忽略且0跟踪。完整目标继续active，production_integration_complete=false。紧接着完成团队成员与真实AgentProfile可选绑定的预览/派发/重检闭环，再推进项目组合/归档、质量与版本发布、真实部署灰度回滚、问题智能处理与运维闭环、生产账户/模型、可信CI与规模验证；不以本阶段子集缩减全流程目标。

## 团队执行成员与运行配置关联增量（2026-10-17）

设计 `docs/DELIVERY_TEAM_RUNTIME_DESIGN.md`，计划 `docs/superpowers/plans/2026-10-17-team-runtime.md`。Agent 成员可在详情中关联真实工作区、配置及固定版本；任务准备派发时明确选择执行成员，仍单独选择位置和后置测试。负责人、执行成员、配置、设备各自呈现。人员和工具不充当 Agent 绑定入口，同名不推导关联。

关联使用独立代次和解绑墓碑，绑定/采用版本/解绑递增，停用解除后恢复须明确重绑；改名不改变依据。绑定要求项目 configure 与同租户工作区 read/实际访问，不要求或授予 execute/config。配置者可在运行不可读时解除坏关联。目录只读且不返回配置正文/环境/凭据，状态只称关联有效，不能代表设备在线、账号认证或执行授权。

派发前重新校验固定关联，变化永久阻止原 pending 意图，A→B→A不复活；标记独立于Task stale、负责人、验收及排期依据。外部receipt/run（包括planned）是交接边界，跨库恢复先查原receipt，不重复创建运行。交接后原成员/配置快照和测试人审保留；解绑不能冒称撤销Core运行或阻止其启动领取。未知原始定义不能重建receipt请求，保持原数据并关闭操作，不补造历史关联。

成员详情、关联编辑、派发计划、预览/历史四界面完整覆盖空态、读取失败、受限、版本冲突及明确采用。选择失效保留草稿，不静默转直接配置；can_bind/can_unbind分开。`GET /delivery/team-runtime-bindings`、两项commands、ExecutionQueue成对executor字段、新快照及观测、严格OpenAPI同步；CLI `sop delivery team-runtime --json` 和SDK `delivery_team_runtime_bindings()`纯读，写入沿用已有固定版本/幂等通用命令。

root最终Manager全量 **904通过**（295.54秒），Web全量 **384项/69文件**（27.54秒），SDK/CLI相关 **13项**、类型及生产构建通过（47.03秒）。初始Manager903通过/1处未知原快照回归已最小修复并在最终全量消除；类型检查发现新增测试fixture缺字段，补全真实契约后通过。唯一独立增量审查1个P2的两项恢复界面症状已修复复验：已交接不再提示重新计划、启动使用恢复出的run ID。lint差异新增0；现有弃用/大包提示留档，统计有重叠不相加。

真实公开HTTP+原生worker/agentd+本地Codex协议fixture证明：pending解绑重绑永久拒绝并可取消；已planned后解绑仍完成真实产物/独立Python测试/人工验收，负责人保持人员，原执行快照不变。实际GUI键盘保存关联、明确成员/设备/测试预览与保存、失效提示/取消、已验证三阶段展示均通过；390px三语document390/drawer390，派发表单374/374，最后恢复中文默认视口。改名关联依据/代次/任务验收不变；纯GET前后28张表一致。外部模型调用0、厂商账号认证仍未知，没有宣称生产模型质量已验。

证据 `.sop-runtime/delivery-evidence/team-runtime/`：validation/actual-loop/final-http/ui/contract、唯一审查、RED/GREEN与完整日志、原三库before-stage一致备份、截图、源码/证据散列及清理/commit回执。无新schema迁移。阶段全部非忽略改动统一commit，不push；依赖store、凭据、隔离数据库保持忽略。

完整目标继续active，production_integration_complete=false。下一阶段推进项目组合与项目归档治理，再补质量/版本发布、可信CI提交证据、真实部署灰度回滚、问题智能处理与运维闭环、节点内部日志/干预、生产账户/模型及规模验证。参考平台按实际能力吸收，不以本阶段局部交付缩减全链路范围。

## 项目组合与生命周期增量（2026-10-17）

设计 `docs/PROJECT_PORTFOLIO_LIFECYCLE_DESIGN.md`，计划 `docs/superpowers/plans/2026-10-17-project-portfolio-lifecycle.md`。SQL Project.status 是唯一当前状态，复用 DeliveryWorkspace.version、Receipt/Event；没有新增 schema 或重复项目实体。普通项目 PATCH、DELETE 和 set-template 写入口退出，配置统一使用固定版本 project.update；状态使用明确目标、理由、预览依据和幂等键的 project.lifecycle。

项目组合按完整授权及筛选范围计算实时有效进度和七类风险，然后分页；风险分类可重叠，总数按对象去重，不按登记完成当已验证。详情提供规范项目定位、精确任务/需求/问题/执行意图入口和真实日期里程碑。归档时点的事实单独保留为历史，每次完整结果进入事件，当前有效验收继续实时核算，不从旧归档数制造成功。

四态按业务能力执行：planning/paused 可维护计划，禁止新的 queue/尚未交接 dispatch；外部 receipt/run 包括 planned 是交接边界，暂停后先恢复已有回执并允许收尾。archived 只读，恢复必须明确选择目标；所有非 CLOSED Manager 意图均阻止归档，包括已失去 Task 的意图。未完成任务仅提示，不自动完成或抹除；归档不撤销独立执行平台权限或终止外部进程。

写入锁序固定 Project→Workspace→实际修改/交接。ORM、可证明有限范围的 typed/Core/bound/batch SQL 共用项目锁；不可变项目归属与主键、无法证明的 SQL、文本 Session、INSERT SELECT、冲突 upsert 和旧 bulk_* 明确拒绝。合法批量使用固定标量 PK 围栏，普通内容表达式保留原领域条件/归属校验。直接 Engine/离线修改不属于应用保护，不添加生产兼容豁免。

已核实的项目文件、配置、模板发布、工作流、记忆与向量实际写段使用可重入短锁，避免持锁跨独立 SQL 会话；默认读取不再建目录或保存初始化值。项目向量克隆只报告实际复制条数，失败返回明确提示，删除未实现的 clone_specs 声明。个人菜单偏好、真实请求/用量审计、租户计费和固定主机市场目录按实际归属区分；它们不被当作项目内容修改。全局身份停用/恢复仍永久作废旧证明，受限 capture 不能借归档权限修改任意业务内容。

组合查看与显式进入分开；业务、项目、任务与返回筛选使用完整上下文。失效或未知项目不再回退首项，切换业务后明确待选项目。详情、配置和生命周期草稿保持固定依据，冲突明确重读并采用，网络未知使用原 key。孤立执行意图可精确查看并取消。三语窄屏、键盘确认、退场身份及不透明详情背景均核验，保持现有主题和组件。

唯一一次独立增量审查发现一项 P1（等锁后使用旧权限）和一项 P2（历史工作流 GET 持久化导致归档读取失败），均修复并独立复验。锁内重读真实 User/成员权限；所有工作流 GET 使用深拷贝期限/恢复投影，不改文件、原 handle 或缓存，已超时的原 pending_phase 保持不变。

root最终Manager完整 **1118通过**（316.30秒），Web完整 **405项/75文件**（44.08秒），SDK/CLI相关 **72项**（3.21秒），TypeScript noEmit与最终生产构建通过（24.44秒）。初次Manager完整1035通过/64失败，包含真实项目fixture缺失、合法有界批量/内容表达式回归及旧文本/移动/删除假设，逐项修复后在最终完整运行消除；初次Web一项旧首项目回退断言按明确选择契约修正。完整运行后仅记忆2个生产模块收口另跑 **15项**（12新增+3既有，4.73秒），RED11失败→GREEN；另有格式后37项回归通过，未冒称最终完整包含新增记忆案例。旧路由193、模型路由53、Copilot/知识图谱12项通过，统计有重叠不相加。修改旧Python文件64个E9/F对比新增0，新Python文件26个全规则0；既有弃用与大包提示留档。

最终记忆公开HTTP验证活动写入200、归档后5类写入409、内容不变且可读；实际公开 HTTP 验证归档/恢复、固定版本冲突、重复请求、规范及旧通道拒绝、暂停不授予执行、有效人工验收保持；此前真实原生 Agent 测试和人审任务仍有效。本阶段外部模型调用为 0。最终只读测量 10 个 GET 前后 28 张 Manager/运行/检查点表散列相同；没有关闭失败请求审计。实际 GUI 完成归档和键盘恢复，跨项目门禁→精确任务→返回原组合筛选，390px 中英日 document/drawer 均390，无横向溢出。

SDK/CLI/OpenAPI 同步：项目 portfolio/detail、固定 lifecycle preview，写入复用原固定版本命令；757处引用及严格无重复 YAML 验证。证据位于 `.sop-runtime/delivery-evidence/project-portfolio/`，包含停止预览后的三库一致备份、实际 HTTP/只读/UI、审查、RED/GREEN/完整日志、源码与证据散列及清理/commit回执。缓存与依赖 store 不提交，阶段全部非忽略源码、测试、契约、文档和记忆统一 commit，不 push。

完整目标继续 active，production_integration_complete=false。下一阶段继续质量与版本发布、可信 CI/提交级证据、实际部署灰度回滚、问题智能处理与运维闭环、节点内部日志/干预、生产账户/模型与规模验证；不以本阶段项目管理交付缩减用户全链路要求。

## 当前质量与可信发布候选增量（2026-10-17）

设计见 `docs/DELIVERY_RELEASE_DESIGN.md`，计划见 `docs/superpowers/plans/2026-10-17-delivery-release.md`。当前质量以有效任务证明及需求验收为准，明确范围包含完整关联任务和独立任务；高优问题阻塞与已有验收分别呈现。质量清单、CI证据、固定候选编制/预览、候选详情/评审四界面共用严格API、完整作用域、固定版本与幂等、原草稿冲突恢复、精确深链及三语文案。

供应商无关的DSSE/in-toto/Ed25519证明固定项目、policy代次、仓库/工作流、真实提交、测试统计和制品摘要。原始JSON严格验签并拒绝重复键、非有限值、旧序号和同序异内容。新失败证明、范围/信任/审批资格变化永久作废旧候选，恢复旧值不复活；候选快照与原审批不改写。真实CI生产者执行明确argv构建/测试，核验新鲜实际制品、JUnit及前后完整受控源码，拒绝Git隐藏修改标志并支持正常Windows换行。API只接收公钥和签名证明，不接收私钥。

移除旧release.save命令/DTO/编辑入口；人工记录仅历史，无补造签名、兼容写别名或迁移成功。候选批准不执行部署，release阶段仍要求真实部署验证。复用Workspace/CAS/Receipt/Event和项目共享锁，无新schema。归档可读且新写409；全局身份捕获仅追加候选永久失效字段。SDK/CLI/OpenAPI同步，严格YAML822引用、41个模型和5路径校验通过。

Manager完整1212项通过（325.18秒），Web完整437项/83文件通过（98.36秒），最终CI专项79项（53 verifier+26 producer，51.85秒），SDK/CLI相关75项及最终严格输入3项通过；计数有重叠不相加。最终TypeScript构建27.68秒、Vite生产构建28.80秒均退出0。10个修改旧Python与HEAD E9/F比较、11个新文件默认规则无新增诊断。唯一独立审查P1隐藏源码签名、P2已验收任务高优问题关注过滤均修复，原始3复现全部通过。旧Windows进程启动失败、空日志及解释器启动器恢复事实保留，最终79 GREEN；不推断未证实原因，弃用/大包提示仍在。

实际本地clean Git及子进程生成通过→失败→通过三份CI证明，经公开HTTP导入、固定版本冲突409、原key重放、评审及永久失效验证；修复后第四次真实producer两测试通过且直接DSSE和Manager验签均通过，没有导入干扰已有候选。GUI明确范围、填写、预览并键盘创建1.0.2-local，HTTP确认原pending候选存在；最终批准由真实用户经API执行，快照保留。签名篡改401且业务版本/内容不变，未知ID404，归档写409/详情200与恢复均通过；既有原生任务仍verified_completed，无新worker或外部模型调用。

纯GET三请求前后28张Manager/运行/检查点表全部相同；另含POST预览的窗口保留正常请求审计新增1条，其余27表不变，没有关闭审计。证据 `.sop-runtime/delivery-evidence/delivery-release/` 包含公开制品/JUnit/签名、HTTP/GUI事实、唯一审查、RED/GREEN/完整日志、源码/证据散列和清理/commit回执。测试私钥仅清点散列后清理，依赖store与凭据不提交，全部阶段非忽略更改提交且不push。

本阶段桌面表单及固定预览截图已采集。后续既有浏览器标签因URL协议策略拒绝访问，未绕过；本阶段390px中英日及最终详情实机视觉复核仍为明确待办，不以历史阶段截图或组件测试冒称已完成。完整目标保持active，production_integration_complete=false；继续视觉复核、真实部署/灰度/回滚及环境授权、智能运维问题闭环、生产身份/模型、原生Sigstore适配、长期流水线与规模验证。

## 受控部署、真实健康与恢复增量（2026-10-17）

采用 `docs/DELIVERY_DEPLOYMENT_DESIGN.md` 和 `docs/CONTROLLED_DEPLOYMENT_GUIDE.md`。Manager固定环境代次、已批准候选、真实目标、稳定基线与操作计划；Hermes复用managed run、设备授权及可靠outbox，执行端runner在副作用前持久化journal，严格HTTPS来源/字节摘要/大小、独立实际探针与观察时长。没有新业务Task或schema，普通run重试/重放/PATCH不能绕过。正常release→operations不使质量自失效，重开继续失效；没有历史basis兼容或补签。

环境、预览、运行健康与失败/回滚四界面接入服务端操作能力、原key/CAS、冲突显式读取采用、精确部署深链和三语。未知结果不自动重跑，失败探针展示真实错误和耗时。41个旧执行、JSON灰度、手工成功及无作用域历史路由退役；配置导出仅configuration_only，OpsCenter只读项目历史及规范发布入口。

真实公开HTTP、本地Git/构建测试/签名、HTTPS制品、本机agentd和配对worker验证25%不计发布、100%实际健康后计发布、构建通过但运行健康失败、恢复前个真实稳定制品、唯一Issue不自动关闭、问题转需求重复提交不重复。实际终止runner后保持unknown并阻止再次apply，只读observe恢复且原operation的apply记录仅一条。正常心跳不改变预览语义依据，worker身份变化仍阻止领取。纯GET三请求前后28张表一致，POST预览仅正常审计增加1条，其余27表不变；暂停新预览被阻止，既有原生验收任务仍有效。

最终Manager完整1265通过（365.00秒）；Web完整470项/92文件（48.89秒）、类型（29.765秒）与生产构建（46.15秒）通过。Core完整222通过/5 Windows跳过（333.30秒）在最终P2修复前，修复后部署专项46通过/1跳过（112.11秒），未重跑完整Core。旧路由98、旧Web31、退役负责人契约74、root相关56、SDK/CLI最终相关15、最终三语增量9均通过，计数重叠不相加。独立审查P1暂停项目新副作用、P2已知非零apply经observe误成成功均修复，原始6复现全部通过。40个Python文件对照HEAD无新增lint，严格OpenAPI853引用/37模型/4路径，41退役路径检查通过。

初次Manager1255通过/4旧DTO假设失败，修改为明确不存在/退役契约后最终完整清零。Windows完整Core环境故障使用已有时区资源与源码路径的进程局部配置，100实际probe测试预算从20至60秒；无安装或系统环境修改。原始失败、辅助脚本编码/HTTP状态/Windows launcher及并发冲突事实均留档。13旧文件仅EOL/EOF规范化已按原hash精确证明；Web构建后仅三语提示及测试小改另9项通过。

证据 `.sop-runtime/delivery-evidence/delivery-deployment/` 包含三库before-stage一致备份、公开制品/JUnit/签名/源码、实际路由探针及journal、HTTP边界、唯一审查、RED/GREEN/完整日志、源码与证据散列、精确清理及commit回执。验证服务停止，执行工作区和真实历史保留；测试私钥/凭据只清点散列后清理，不提交缓存、不push。本阶段390px中英日与最终部署详情实机视觉仍待复核，先前浏览器协议策略阻止访问，未绕过。完整目标active、production_integration_complete=false；继续智能问题诊断与处理提案、内部日志/受控干预、生产身份/模型及规模验证。

## 问题诊断与人工需求回流增量（2026-10-17）

采用 `docs/DELIVERY_ISSUE_DIAGNOSIS_DESIGN.md`，操作说明见 `docs/ISSUE_DIAGNOSIS_GUIDE.md`。SQL Issue仍为唯一问题事实；新增IssueDiagnosis支持表保存原请求、固定脱敏证据、诊断结果及人工决定，不创建第二套问题或工作流。来源由Manager执行/部署反向关联，描述文字、同名或调用者提交的运行ID不会冒充来源。问题业务依据与选中运行证据摘要分开；心跳不改变语义，真实内容或原权限变化立即阻止旧提案采纳。

生成前持久化receipt，模型调用期间不持有业务SQL锁；真实项目模型网关、AI与规则明确选择，严格JSON和引用范围检查。原请求重放不再调用模型，处理中/结果未知可查询或明确放弃，迟到结果不能覆盖决定。人工编辑与明确预览后回流唯一需求，保留原提案和审核意见；已有需求不覆盖，Issue不自动关闭，任务继续既有拆解/计划/派发/测试/人审链路。

队列筛选、来源事实、诊断草稿和人工审阅四界面保留现有主题与紧凑协作布局，包含固定发送预览、三语、历史分页、精确项目/来源/返回深链、冲突保留改稿并明确采用、未知结果原key恢复、会话切换与退场身份。原问题缺失时只读明确提案历史并允许授权取消，不伪造当前问题或回退首项；未决诊断阻止归档，归档只读。

最终Manager完整 **1315通过**（387.82秒），Web完整 **505项/98文件**（52.04秒），SDK/CLI相关84项（3.91秒），最终类型检查（64.406秒）与生产构建（33.156秒）通过。后端定点35、证据17、UI30、root路由4及原始审查复现3均通过，计数有重叠不相加。首轮Manager1310/Web502通过发生在最终修复之前，最终已完整重跑。9个修改旧Python按HEAD同文件E9/F、11个新Python默认规则均无新增诊断。严格OpenAPI886引用/25相关schema/4新增操作通过，22模型逐项一致；41个无效认证引用规范为既有bearerAuth，145未涉路径及337未涉schema语义不变。

真实公开HTTP通过当前项目模型网关到本地Ollama协议服务，证明原key重放不再调用、严格输出失败、上游失败安全返回、人工改稿回流唯一需求并沿tasks.plan建Task、Issue不自动关闭、真实进程中断保留generating且不重调用、原Issue删除后的精确查询及明确取消。实际本地HTTP4次、外部厂商模型调用0，不代表厂商模型质量或生产认证。三次纯GET覆盖Manager/运行/检查点三库29表全部不变；原生Task仍verified_completed。

实际服务先发现生产autoflush=False首次采纳404，补同事务flush并把整套领域fixture改为相同设置后，复用原请求完成实际链路。唯一独立审查3个P2均修复：删除旧回流需求后检查全部真实同租户/项目候选，直接转需求与诊断均不重复创建；受限提案按服务端授权可取消但不能采纳；首屏20条之外旧提案409通过精确读取恢复人工改稿。原始三场景在root复验通过；历史冲突脚本仅补新精确读API mock并断言原project/issue/id，原RED脚本保留。最终三个P2后没有新增实机模型调用，原始复现和完整回归覆盖最终源。

新增IssueDiagnosis支持表在既有SQLite启动上真实创建且旧表不变，PostgreSQL DDL仅编译验证，未冒称live PostgreSQL。证据 `.sop-runtime/delivery-evidence/delivery-issue-diagnosis/` 包含三库before-live备份、真实HTTP与中断恢复、首次失败及修复、唯一审查、RED/GREEN/完整日志、公共契约、源码/证据散列和精确清理/commit回执。验证服务停止，临时凭据已删除，测试私钥仅清点散列后清理；阶段全部非忽略改动commit、不push，依赖store保持忽略且0跟踪。

本阶段390px中英日和最终详情实机视觉仍待复核，之前浏览器协议策略拒绝后未绕过，组件测试不代替实际视觉。完整目标继续active，production_integration_complete=false；继续节点内部日志与受控干预、生产身份/模型与数据库验证、规模和长期运行验证及实际视觉复核。

## 2026-10-17：执行过程、实时日志与受控干预

复用现Task/run/events/receipts/outbox，将运行概况、精确步骤日志、固定操作确认和按需历史集成回任务与执行详情。真实agentd JSONL支持stdout/stderr、原始attempt和游标续读；分段令牌、PEM和凭据先净化再落盘/上传，流预算显式截断后继续排空。日志不逐块提升run业务版本，Git NUL证据保留独立atomic接口。

Manager统一start/retry/cancel/approval的预览、业务CAS、双域权限、固定语义basis及原key恢复，去掉仅id取消。提交event和Core claim同时固定attempt，旧回执不授权新批次；queued恢复要新明确预览。正常公开队列可创建本地纯人工审批gate，不当测试；批准和拒绝能力分开，暂停或范围变化仍允许授权拒绝收尾。配对审批提前明确拒绝。

业务cancelled与requested/confirmed/unknown/not_started分别展示。Windows suspended→Job→resume关闭抢跑窗口，仅进程树归零/Wait/EOF确认停止。lease丢失先冻结assignment；未知阻重派/重试/归档，显式sync才采纳真实停止。配对日志先ACK、终态结果断网上传与cancel竞态通过原assignment stop ACK恢复，不重跑。

最终Manager完整1350通过/450.68秒（wall479.708秒），Core完整247通过/5个平台skip/303.26秒（wall309.25秒），Web完整532项/105文件/47.37秒，SDK/CLI相关86项/3.56秒。TypeScript58.249秒、Vite41.67秒（wall43.044秒）通过，Go新流测试通过。42个Python文件完整规则对HEAD无新增或变差诊断，原28诊断降26；两个C901下降消息另列，未用例外隐藏旧债。

首次Manager完整1347通过/1旧仅id取消断言失败，按canonical preview更新后最终完整通过；首次Core235通过/3失败/5skip，2项为Windows venv缺tzdata，使用已有随附IANA数据的进程局部PYTHONTZPATH验证，1项shared control的delivery_closed优先级回归已修，最终完整重跑。Web首次528，审查修复后完整532。旧Python弃用、AntD弃用、大包提示和Windows下5个既有POSIX Go夹具失败明确留档，未称全平台全套Go通过。

真实HTTP：原生/配对日志beforeexit，UTF8及脱敏、Windows孙进程停止确认、强杀父控制进程unknown并阻retry、人工审批继续但Task不自动验收、同run批次1/2输出隔离、真实SDK和CLI、原已验收Task有效。纯GET跨Manager/runtime/checkpoint三库29表散列相同。配对专门用本地代理先503终态上传、再Manager取消，恢复经409→heartbeat原stop发现→stop ACK200确认，无节点重跑。外部模型调用0。

唯一独立审查2个P2已修，原始两个复现root各1pass；公开审批边界、离页/关闭/unknown回调、权限撤回及outbox离线/重启/ACK丢失有永久回归。Manager OpenAPI911引用/14当前模型/3新增操作，149未涉路径与360未涉schema不变；Hermes47路径/27schema/124引用验证，文档例子可解析。

证据 `.sop-runtime/delivery-evidence/delivery-execution-runtime/`，含一致三库before-live备份、首次失败、RED/GREEN、唯一审查、真实进程/HTTP、完整日志、source与evidence散列、精确cleanup及commit回执。临时凭据只留hash不留内容，源码/重要文件先留档再清理task scratch；新二进制升入既有runtime位置、旧二进制备份。阶段全部非忽略更改commit、不push，依赖store零跟踪。

390px中英日实机视觉仍受原浏览器协议策略限制，未绕过，组件测试不代替实机。配对审批、生产账户与模型、真实数据库/基础设施、跨存储统一活动及规模/长期验证继续；日历容量已在先前排期增量实现，活动导航/需求版本在下方协作增量补齐。full goal active，production_integration_complete=false。

## 2026-10-17：协作活动、需求观测版本与固定变更影响

依据 `docs/DELIVERY_COLLABORATION_DESIGN.md`，操作说明 `docs/DELIVERY_COLLABORATION_GUIDE.md`。沿用唯一业务实体、已有进度和组件；日历容量、资源预留、依赖时间线及原子批量排期已实现，不再列作当前缺失。

项目/需求活动先按服务端授权范围与当时关联过滤，再按绑定范围/固定上界的游标分页；精确事件只返回白名单事实，当前对象和运行访问另行核验。任务转属不迁移旧历史，批量操作共享同一事件，旧未知关联不补造。活动/详情/变更预览/历史四界面保留精确ID、URL及来源返回、失败与权限状态、固定草稿、409明确采用和未知原key恢复，沿用现主题及三语。

需求定义由真实ORM/Core事务观察，内容版本保留规范标题/描述/验收条件、basis、观察序号和时间；不补造早期历史，不把观察时间当原始修改时间。通用写只采内容版本，不假称全部入口已接统一activity。编辑先预览字段前后和直接/下游影响，再绑定requirement basis、preview basis、项目CAS及幂等身份提交。沿用已有永久失效，不自动改期、派发、重跑或验收。Sprint进度、燃尽stats、summary与治理风险共用有效验收六态，登记完成和待验收不再造成100%交付。

第四次实际HTTP回路 `actual-http-proof-4.json` 通过，汇总 `actual-http-proof.json`：210条活动固定上界分页、转属历史不迁移、定义预览/重复命令/通用观察3版、SDK5方法及CLI5选择真实HTTP，三库31表纯GET零写；预览只有正常audit_logs变化。原Task仍verified，外部模型调用0，覆盖14个生产文件前后hash完全一致，服务确认已停。前3次HTTP失败原样留档；root确认的产品缺陷是Link/Event外键落盘顺序与None错误字段变化，均保留原症状RED→GREEN；CLI业务/项目作用域工具失败单列，不增加产品finding。

唯一独立增量审查新增P1/P2=0；独立2项SQL不变量通过（2.83秒），覆盖通用内容A→B→A永久失效与savepoint回滚不产生幽灵版本，没有第二轮泛扫。Web完整560项/109文件通过，54.29秒（wall55.888秒）；TypeScript33.238秒、Vite wall73.268秒通过，SDK/CLI相关92项/2.88秒通过。统计有重叠不相加。

完整SDK+CLI初轮190pass/5fail；原5失败在process-local PYTHONUTF8=1、COLUMNS=160及已有bundled PYTHONTZPATH下重跑3pass/2fail。仍失败为Windows IPC固定unix断言及Pages旧--assigned-to源码契约，相关源码与测试逐字节/AST与HEAD一致；未改测试以变绿，未宣称全clients通过。已有弃用/大包提示留档。

首轮Manager完整1369pass，538.05秒（wall574.267秒），但运行中源码漂移，不作为最终冻结源验证。最终冻结源码 Manager 完整 **1374 项通过/0失败**（424.85秒，wall 454.657秒）；`verification-manager-2.json` 记录退出0及运行前后源码散列一致。

Ruff21个Python文件完整规则对HEAD新增/变差0，原70诊断降69；OpenAPI17模型938引用5操作，152未涉路径/374未涉schema保持不变，9文档Python例子可解析。协作支持表 `delivery_activity_links`、`delivery_requirement_versions` 的PostgreSQL DDL仅编译验证，非live PostgreSQL。

证据 `.sop-runtime/delivery-evidence/delivery-collaboration/`，包括实际HTTP/纯读、三库备份、初次失败、验证/客户端基线、契约及源码散列；清理和阶段提交以root后续回执为准，commit receipt预期位于该目录 `commit-receipt.json`，不push。临时凭据不保留，唯一文件及重要证据清点散列后再清理任务scratch。

当前390px中英日实机视觉仍未验证，遵守已有浏览器协议限制；组件/HTTP验证不当作实机。父workbench仍全workspace读取，万级定向读取/服务端列表分页、基线摘要规模及跨存储统一事件留待下一阶段。生产身份/模型、真实数据库/基础设施、长期与规模验证继续；完整目标active，production_integration_complete=false，不以本阶段局部验证缩减全流程目标。

## 2026-10-18：有界查询、精确协作工作区与一致交互

设计见 `docs/DELIVERY_QUERY_DESIGN.md`，操作见 `docs/DELIVERY_QUERY_GUIDE.md`。沿用唯一业务实体；两个可重建支持表只存派生查询事实。共享验收计算一次读取canonical集合、按需求分组，保持集体验收和永久失效；写时在同事务刷新索引，优先级等未新增进度点的变化也刷新。回滚和保存点不留下超前代次；归档项目可单独授权维护派生查询，业务编辑仍禁用。

context、需求/任务/问题分页、精确需求/任务/执行、引用目录及显式重建共9条新操作。SQL先过滤再count/keyset分页；正文与流程局部JSON按精确对象读取，全项目计数不从当前窗口推断。可变游标签名绑定项目/身份/筛选/排序/页大小/查询代次；100选中ID的实际游标280字符。命令统一Ack保存原对象与原业务结果，重放不猜当前数组，且重新核验原运行空间访问；首次和重放不生成完整workspace快照。旧完整workspace仅作显式工具导出。

全部first-party交付UI退出export workspace。需求列表/看板、独立详情、远程候选、成员/资源/里程碑各自按需读取；看板校验跨列代次，context更新刷新对应查询，会话revision统一隔离，固定编辑不自动采用新依据。页外任务精确读取，历史当前跳转先核验真实对象，404不导航；需求读取失败与重试位于抽屉内。窄屏卡片与三语沿用现主题。人工评审显式展开才加载，已有完整依赖验证成本另行保留。

独立审查6项P2已修并复验：无任务/成员记录的管理员目录刷新、受限执行引用，以及详情错误遮挡、跨列混代重复、context变化后目录陈旧、同token新会话持续只读；运行回执当前权限与长游标等关联边界也有回归。初轮Web565pass/9fail为旧mock/当前跳转假设，保留固定依据、原key、草稿及删除/迁属行为断言后完成最终验证。初轮Manager1399pass/1fail为旧整包回执断言，改为原Ack+精确详情+SQL唯一性后4项定向通过。

最终Manager完整 **1400通过/0失败**（392.8秒，wall 426.564秒），Web完整 **587项/114文件通过**（58.14秒，wall 60.509秒），完整TypeScript和生产构建通过（wall 65.664 / 34.018秒）。SDK/CLI相关 **105通过**；广域206pass/2fail仍为未改动的Windows IPC unix固定断言及Pages旧--assigned-to断言，源字节与HEAD一致，不宣称全clients通过。上述最终运行均有前后源hash一致回执，既有弃用和大包提示保留。

旧万级整包SQL函数基准117.53秒/约60MB；共享完整评估5.04–6.20秒。最终冻结源码万条需求+万条任务夹具15次纯SQL函数读取：context9.8–12.5ms/1658B，需求20条132–137ms/10378B，任务20条21–27ms/11607B，精确任务11.6–13.3ms/3335B。完整workspace解码0，列表canonical业务ORM载入0；精确任务只载1Task+1父需求。427源文件、实际70依赖模块前后hash一致，FK开启且derived setup历史0→0。该平面夹具非HTTP/auth/生产及尾延迟测量，Manager并行回归会影响计时，context夹具比实际API少query_rebuild权限字段；不夸大生产规模或复杂依赖覆盖。

最终第3次真实HTTP回路通过：SDK9方法与CLI9选择、页外详情、已记录完成不当验收、变更后旧cursor409、原创建对象删除后原Ack重放、100选中ID游标及真实执行排序。三库33表纯GET散列一致，显式重建只改query状态和正常HTTP审计；原已验收Task保持有效。17个覆盖生产源最终hash一致，服务确认停止、临时认证bootstrap只留hash后清理，外部模型调用0。Ruff 32变更Python文件按原规则对HEAD原4→3诊断，新增/变差0；OpenAPI12当前模型、960引用、9新操作与Ack更新，156未涉路径/392schema语义不变，9文档Python例子可解析。新派生表PostgreSQL DDL仅编译，未测live PostgreSQL。

证据 `.sop-runtime/delivery-evidence/delivery-query/` 包含首次失败、审查、RED/GREEN、完整回归、实际HTTP、万级读测、SQL与源散列、清理及commit回执。盘点重要源和唯一证据后清理精确task scratch，不遍历链接，不保存临时密钥；全部非忽略阶段更改commit，不push，依赖store零跟踪。

完整目标保持active、production_integration_complete=false。分页当前首页/下一页，浏览器返回恢复URL窗口；显式人工评审和部分专属接口仍有完整项目计算成本。390px中英日真实视觉仍未验证，遵守先前浏览器协议及12ui安装/上传审批拒绝，不绕过；源码/组件/HTTP与构建不代替实机。通用/跨存储活动来源、复杂依赖与长期规模、生产身份/模型、真实数据库和基础设施继续按实际授权推进。

## 有界待办与概览进度增量（2026-10-18）

设计和使用说明见 `docs/DELIVERY_ATTENTION_DESIGN.md`、`docs/DELIVERY_ATTENTION_GUIDE.md`。基线7bd27cd，阶段T-delivery-attention，完整目标继续active。

- schema2沿用派生查询表，在写事务中生成每对象单行待办；GET按当前身份/角色、scope/category在SQL过滤计数和分页，不回退完整workspace。counts覆盖完整所选scope，total为分类匹配数；游标固定身份/筛选/权限/UTC日期/generation，变化后明确首屏恢复。缺索引需有权限者显式重建，读取不修库。
- 无执行管理的completed未有效验收任务进入人工待验收，通过后移除、定义变化使原验收失效后重新出现；原生执行保持独立审查。卡片分别显示人工与执行验收，点击任务按当前精确归属进入，删除/403留页重试，切项目/身份/筛选及A→B→A迟到请求不导航。没有新增快速批准。
- 首页仅取limit1待办以展示全范围计数；进度summary仅读取当前指标和UTC观测日期/时间。跟随context代次/日期刷新，不另起全量定时计算。分类计数可键盘筛选，URL保留页码/游标，错误和空态分开，阻塞最多5条摘要并保留完整计数。
- Manager完整1415项、Web完整603项、SDK/CLI交付相关140项通过，TypeScript及Vite构建通过；Python变更文件无新增或恶化的配置诊断。广域客户端241通过、2失败，仍为Windows测试固定Unix假设和Pages旧--assigned-to断言，原审计已查证；另确认默认Windows pipe地址不一致的真实P2，后续独立修复。
- 实际隔离HTTP验证3项人工待审→接受1项剩2→内容变化重现为3，游标跨scope422/数据变化409，SDK2方法及CLI2命令，3库33表纯GET不变，原有效原生验收保持。首轮HTTP辅助断言曾把recorded_completed误计为3，按六态互斥口径应为2，修正辅助断言后原生产代码通过，失败证据保留。
- 万级内存SQL探针：10,000需求/10,001任务，12次读取均4条subject SQL、0 canonical ORM载入、0完整workspace/观测JSON、0写。首页待办973B，20条人工待审9,838B，summary1,146B；206个Manager源码和51个实际加载模块散列稳定。这是SQL函数fixture测量，非HTTP/生产尾延迟压测；写时全范围evaluation仍存在。
- 独立后端4探针及15原行为用例通过，无新增可复现P1/P2；前端独立发现非Task空ID匹配busy及分类A→B→A无替代点击残留busy两项P2，均按原症状RED→GREEN修复。实际390px三语与生产验证未完成；完整progress、人工评审、历史影响、quality/release等显式详情仍有全项目成本。对象讨论及结论/来源集中展示仍未实现。

证据 `.sop-runtime/delivery-evidence/delivery-attention/`，包含原审计、RED/GREEN、完整回归、HTTP/SQL和契约检查。所有已验证修改阶段性提交，不推送；不提交.pnpm-store缓存。

## 原生执行器与可靠生命周期增量（2026-10-18）

阶段T-native-ipc，基线590ca69，设计见 `docs/NATIVE_AGENTD_LIFECYCLE_DESIGN.md`。SDK/CLI/Go按相同项目及locator选择原生端点，Windows invariant大小写API与共同向量避免Unicode分歧；相对路径、非默认CWD、PIPE/SOCK覆盖和目录junction均真实验证。不保留旧固定pipe回退。Windows SDK使用CPython>=3.10原生overlapped I/O，总请求期限覆盖连接/写入/分片读取；超时取消并回收句柄，available不消费服务端连接。

health返回真实pid/project_path/instance_id，PID文件仅诊断；停止必须匹配当前实例及项目并在写完ACK后取消。绑定成功后才登记PID，重复启动不覆盖/删除其他实例PID，退出等待已接收连接再关闭队列。CLI固定发现时的可执行绝对路径，健康/停止响应须在确认预算内到达，失败只清理自有Popen。stop_accepted与stopped分别表示接受请求与原IPC实例离开，不替代操作系统进程退出证据。

原CGO0 binary只能执行部分工具，真实daemon因队列不可用退出。改为单一modernc SQLite1.60.1与Go1.26.9，移除CGO驱动及不可用替身。WAL/FULL/单连接/immediate事务下验证重开、幂等、并发重试、取消、旧表互读与异常进程退出恢复；修复删除失败谎报成功和退避溢出。锁等待取消可能到5秒busy timeout，跨SQLite删除与JSONL DLQ追加仍需后续原子化。

真实联调发现旧HTTP退避忽略取消：IPC已离开而进程仍存活，修为可取消timer及末次不等待，原失败和最终退出证据分别保留。旧终端显式close后EOF重复关闭ConPTY导致0xc0000374；单次关闭控制探针确认根因后，按会话唯一资源归属和closeOnce修复，真实原例exit0，旧Wait不删除替代ID，独立并发/归属探针通过。

最终Go完整49项通过、3项原有Windows符号链接跳过，vet及CGO0构建通过；Linux/amd64和macOS/arm64交叉编译通过，仅编译、未在目标系统运行；SDK/CLI完整299项通过，原两旧断言已改为实际平台和owner_id契约，未恢复旧姓名写入。Python配置lint无新增或恶化诊断。Core原生相关7文件95通过/2原有POSIX跳过，使用终端修复前binary；运行期间仅未执行的Go测试夹具变动，binary不变，未冒充完整Core复验。最终终端修改另经完整Go、真实ConPTY及独立审查验证。

最终binary真实启动A/B、CLI新建、自定义locator/pipe、Unicode与junction，停止后5个原Popen全部exit0，无强制清理；错项目/旧实例停止被拒绝，队列重启事件保留，stale PID指向的无关自有sentinel存活且文件不变。实际SDK/CLI及binary验证前后hash一致。先前一轮客户端298pass/1fail的2秒进程看门狗没有阶段观测，原个案原因未确定；后续压力观测证明启动/import可超过2秒而实际请求均正确超时。测试分开有界准备和请求，保留严格实际请求耗时断言，最终全量通过。

证据 `.sop-runtime/delivery-evidence/native-ipc/` 含原失败、精确RED/GREEN、独立复核、工具链与模块校验、最终回归与真实进程。缓存只在保留源码/唯一证据/最终binary及来源散列后精确清理；不全量复制可重取第三方工具链/模块缓存。全部阶段非忽略改动本地commit，不推送，依赖store零跟踪。

完整目标继续active。对象讨论/明确采纳仍为设计草案，未冒充实现；事件可靠交接、来源/诊断集中展示、通用跨存储活动、专属详情有界化、当前390px三语视觉和生产身份/模型/数据库/基础设施及长期验证继续保留。遵守既有浏览器协议及12ui安装/上传审批限制，不绕过。

## 对象讨论、固定来源与明确采纳增量（2026-10-18）

阶段T-delivery-discussion，基线603226d。设计见 `docs/DELIVERY_DISCUSSION_DESIGN.md`，操作说明见 `docs/DELIVERY_DISCUSSION_GUIDE.md`。项目讨论入口、需求页签、共享任务与问题详情接入同一讨论/来源能力；沿用现有紧凑主题和业务编辑器，没有新增另一套需求/任务流水线。

六个同库支持表保存线程、消息、不可变修订、独立事件、原回执和来源链接。真实User发言；作者编辑，作者或configure撤回，结论固定单条消息修订，新回复或修改结论会重开，归档恢复保留历史。Project→Thread锁后重新核当前身份权限，版本CAS、严格DTO、同key原结果重放、追加事实保护和整事务回滚均已验证。20条默认分页与精确页外消息/版本读取不下载完整工作区；纯讨论不触发业务观测、业务事件或查询代次更新。

仅五个原业务动作允许可选根source_reference：需求修改、任务修改、任务拆解、问题转需求、诊断采纳。人工确认前只形成可编辑草稿，确认后在原事务中核固定结论并按实际结果记录来源，拆解对应每个真实Task。原业务CAS/basis/影响预览/审核和永久失效规则继续生效；同key重放不再次执行，来源变化参与请求指纹。普通来源关联保住人工与原生有效验收，实际定义变化按原规则使验收失效；Issue仍open、保留唯一来源需求规则。

引用由服务器从精确字段或真实执行摘要冻结，当前/历史/来源卡片每次读取核原runtime scope，撤权隐藏受限引用；采纳和原回执重放也复核原权限。独立检查发现原业务回执会枚举10000个工作区，改为只检查原相关工作区，原失败探针及永久测试RED→GREEN保留。新前端保留草稿、在飞新输入、未知结果原key恢复、409显式采用、会话/项目ABA与精确当前归属导航；统一主题token和窄屏换行，中英日完整注册。验证包括SSR/组件结构、mock状态与请求契约，不冒称浏览器生命周期或390px实机视觉。

完整Manager **1472通过**（442.09秒，wall477.981秒），完整Web **633通过**，完整SDK/CLI **378通过**，TypeScript与最终Vite构建通过。Manager全套期间仅main空行与pytest fixture noqa注释两处字节漂移，精确原hash重建证明AST相同；最终31项与真实HTTP7在最终源字节稳定下通过，未把全套字节稳定写成true。前端初轮623pass/7fail为共享面板未保护location的真实SSR缺陷，保留原7断言并新增3项真实静态渲染后修复，最终全套通过。客户端初轮376pass/2fail为终端帮助截断和本机IANA数据未配置，恢复已有进程局部COLUMNS/PYTHONTZPATH后全套源稳定通过，无全局安装或生产回退。

真实隔离HTTP使用原登录/权限和生产autoflush=False：18个新SDK方法、9组CLI读取、五业务动作、实际多任务IDs与原key、已验收保持/失效、来源后变更和只读零写均通过。Manager与运行存储30个非讨论表保持不变，正常HTTP写审计单独保留；checkpoint数据库保持惰性未创建。先前HTTP helper误假定checkpoint已存在、忽略正常审计、使用错误CLI位置参数，以及两次仅main注释/空行漂移均保留，不列为产品缺陷。OpenAPI新增14路径/18操作/36schema，167原路径及409无关schema语义不变，重复键与1166个局部引用通过检查。

规模fixture为10001需求/10001任务/20000线程事件：page20使用10条SQL、24ORM行、7451字节；单回复49SQL、5ORM行，完整Workspace解码0。它是隔离SQL测试测量，不是生产延迟压测。独立backend源码复核、原runtime权限3探针、frontend限定19探针各自保留审查边界与hash；当前无新增未处理的已确认P1/P2。

证据 `.sop-runtime/delivery-evidence/delivery-discussion/` 保存原失败、完整/定向回归、真实HTTP/SQL、契约、独立复核及源码/产物散列。全部已验证阶段更改本地commit，不push；.pnpm-store零跟踪。清理仅在重要源/全部唯一证据盘点保留后处理精确任务scratch，不遍历链接。

完整目标继续active、production_integration_complete=false。已独立复现但未在本阶段修改的Manager事件接收4项可靠性RED及Go跨SQLite/JSONL死信交接待下阶段原子化；通用跨存储活动、部分显式progress/人审/历史影响/quality/release详情仍有全项目成本。当前390px中英日真实视觉、生产身份/模型/数据库/基础设施和长期规模验证继续保留；既有浏览器协议与12ui安装/上传审批限制不绕过。

## 可靠事件交接、真实处理与精确恢复增量（2026-10-18）

阶段T-event-handoff，基线9ffc692a59408b0711986aa47ca3e4a1950d4706。设计 `docs/DURABLE_EVENT_HANDOFF_DESIGN.md`、指南 `docs/DURABLE_EVENT_HANDOFF_GUIDE.md`。完整平台目标保持active、production_integration_complete=false，阶段提交结果见 `.sop-runtime/delivery-evidence/event-handoff/commit-receipt.json`，不push。

Go/Python采用同一SQLite v1规范，SHA256为16a95d7fe6e1b4f02bd8cb22c50f2d303e49b688fdc7bc0b32632e3555122988。原文/ID/摘要及首次认证tenant/project/User/Manager来源固定；pending/dead_letter/acked原子CAS，保留匹配原回执和原控制请求，有限分页与显式v0迁移保留全部有符号rowid范围。发送前完整ACK校验，未知/重复/错scope结果不吞原件；SQL失败、取消、坏ACK及错旧账号均保留原件。旧pusher及自动JSONL发送退出，剩余实体/规则/watch仅保留隔离草稿，不冒称全生产端统一。

Manager不可变Inbox、Processing及追加Attempt为权威；真实身份/项目锁后复核、固定原key、严格JSON/大小/引用/游标、写后最小WS通知及逐帧授权。task.status、issue.create、sync.record.apply沿用原版本/业务门禁，业务效果、事件/命令回执与processed同SQL事务。文件先保存固定计划，验证原模块/解析路径/摘要，原子替换后可按原operation恢复；不宣称对任意外部写入者提供跨文件SQL原子性。已有Requirement定义变化缺预览明确失败，保留原正文和审批；通用/reflection无处理器只保存在pending。

原事件页面沿用现主题/AntD，默认20条、精确详情与尝试、送达/处理/验收分离，实际对象当前归属导航与同项目返回，原始JSON折叠为文本。人工恢复使用当前能力、原因、原修订和原键；未知结果防退出，409保稿、明确读取采用，403/404不暴露旧原文，会话/项目ABA及SSR有回归。独立UI复核修复：只有重放原键后服务端锁内双查键发出的409 event_revision_conflict或403 event_retry_denied可解除未知；普通错误和单独GET processed不能解除，明确采用可显示最新只读结果而不再次提交。

独立确认并修复原资产junction改向、错误asset结构导致混合batch整体失败、Task最终引用+completed门禁、SDK公开ACK伪造证明、IPC非bool成功、非法时区分钟、负/零rowid迁移及旧绑定队首阻塞等边界；原RED和固定症状GREEN、永久回归分别保留。旧独立Requirement探针把stage=intake当作唯一通过条件，正确安全实现为缺preview明确拒绝，故该旧断言仍RED；新增真实回归证明原定义/审批不变及正常预览入口有效，不能据旧oracle放松门禁。

最终Manager完整1532通过（pytest5776.79秒，wall5823.031秒，源前后完全一致）；Web完整678项/128文件通过，TypeScript无错误、最终Vite构建通过；SDK/CLI完整426通过；Go完整75主项+38子例/6包通过，3个原Windows符号链接用例跳过，vet及CGO0最终binary成功。最后仅移除CLI三文件EOF多余空行后另有冻结源完整客户端复验，不把旧426运行快照写成最终相同。Python根21文件及后端单独lint均无新增/恶化配置诊断。OpenAPI新增6路径/6操作/23schema，180无关路径及445无关schema语义不变，1211局部引用解析；SDK最终wheel含与源码相同的Python文件和规范SQL。

真实HTTP RUN4使用原FastAPI/login/middleware与autoflush=False：提交后丢ACK、实际Manager进程重启、轮换HMAC仍返回原receipt/time/digest；相同ID异原文拒绝；真实Task/Issue/Requirement效果只一次、旧版本失败、CRLF/UTF8资产保留、跨scope/无项目与读者retry拒绝、8项纯GET全部SQL表不变。实际CLI HTTP三项读取；通用事件不创建Workspace、不假装业务完成。真实Windowsbinary+SDK命名管道验证70,465字节帧/60,212字节冻结原文、重复原件、异原文冲突、Python入同库Go送实际Manager、真实心跳内容、任务回写（confidence仅审计/verified=false）、SDK report_issue实际open问题一次；Manager离线保留、原实例停止、双端重启后原件获得ACK。RUN4自有3个Manager和2个native进程全部停止，外部模型调用0。

原失败完整保留：Go原测试受TEMP正斜线影响、真实Python首次WAL竞争、离线UV缓存缺构建依赖、native RUN2夹具帧9000字节不足分别记明；只将真实产品边界计入finding。工具链/模块来自原锁定版本，在任务目录校验；最终wheel复用已缓存纯Python构建依赖，未全局安装或改环境。所有重要源/唯一证据先盘点散列保留，清理不遍历链接；清理与实际commit以独立回执为准，.pnpm-store保持忽略且零跟踪。

继续工作：旧实体/规则/watch草稿生产端的明确原版本事件意图；通用跨存储活动与reflection处理器；显式完整progress、人工评审、历史影响、quality/release详情的有界读取；当前390px中英日实机视觉，生产身份/模型/数据库/基础设施和长期可靠性。既有浏览器协议及12ui安装/上传审批拒绝不绕过，SSR/状态/结构/HTTP证据不冒充实际视觉。

## 本地原意图、审阅资产与接入一致性增量（2026-10-18）

阶段T-local-intents，基线90e47f6。设计 `docs/LOCAL_INTENTS_DESIGN.md`、使用 `docs/LOCAL_INTENTS_GUIDE.md`、接入 `docs/playbooks/PROJECT_ONBOARDING.md`。17类需求/任务/问题/迭代写命令要求原版本/键/时间，创建还需稳定业务ID；先入唯一SQLite，再可选送达。create/update明确存在性，更新仅传指定字段；保留原需求preview/Task basis及验收门禁，不再造第二套local实体、Markdown、tombstone或JSONL。旧文件只读盘点，不自动发送、压缩或修复。

watch仅输出UTF-8/CRLF原快照，单次50条/1MiB、单文件60KiB，格式与Manager五种保持一致；审阅后enqueue-plan明确一条、原版本及远端SHA/absent，不重读变化后的源。输出与扫描根重叠被拒绝，pull原子替换目录项保护硬链接其他原件。规则提案完整写入后唯一发布，稳定marker及项目锁覆盖重复/并发和正文先落盘恢复。SDK/IPC/HTTP透传原basis，已ACK旧原件不能冒充另一个Manager/用户的成功。

work v2不再合并legacy overlay。实时需求/任务/问题各最多100条并核同代，Sprint为独立首页；loaded、实际total、continuation与统计范围分开。缓存总数/当前验收未知，不把完成当通过。context.prepare及init接入helper采用同一配置和新的原子缓存快照writer；旧私有导入退出。浏览器高级资产同步提供准备/审阅/处理、会话内持久原件、唯一键、未知锁与原件重放、三语/当前主题及退出保护；实际HTTP头绑定审阅会话，保存后复核scope，不能把A正文带B头发送。实际canonical target独立展示，Windows合法大小写差异不误判未知。

完整Manager1562、SDK/CLI633通过，前后319/122项源与契约稳定；Web定向108项/10文件、TypeScript与Vite构建通过，主壳和全部子应用500项源稳定。本阶段未重复原完整678项前端套件。Go75主项+38子例/6包通过，3项原Windows符号链接跳过；vet、离线SDK wheel全部Python/SQL字节与OpenAPI仅2schema变更、187路径/467无关schema及1211引用核验通过。44个Python变更文件无新增或恶化诊断。

真实HTTP Run1验证17命令及原键重放、实际preview/Task basis/活动原新关联、断ACK+Manager重启、旧版本/403和18GET全35表零写；Run2/3验证真实103–104实体的work分页、规则、实际prepare和全新init helper；Run4验证最终五格式发现/拒绝与原SHA文件；Run9编译真实前端helper，经真实Manager验证3个中文/Emoji标识向量、4次处理、3次重复回执、2次明确失败及文件不变。各轮受影响来源分别冻结，没有将后续helper改动冒充早期全源相同。所有owned进程已停止，模型调用0。Node Run5–8的Vite环境、散列脚本及资产不递增业务workspace版本的夹具假设失败完整保留，不计作产品缺陷。

独立复核的任务删除/转属活动遗漏、已ACK跨origin误成功、提案半写发布、work旧overlay、pull硬链接覆盖、watch自反馈，以及浏览器canonical路径/错scope请求头均有原RED、修复和原探针GREEN。额外真实接入遗留导入及不支持格式也有回归。证据 `.sop-runtime/delivery-evidence/local-intents/`；先保全重要源/唯一文件及散列再精确清理，不遍历链接。清理与实际本地提交以各自receipt为准，不push，.pnpm-store零跟踪。

完整目标保持active，production_integration_complete=false。generic/reflection真实处理、Issue反向全来源、显式quality/release/progress/人审/历史影响详情有界化，当前390px中英日实际视觉、生产身份/模型/数据库/基础设施及长期规模仍待完善。已独立审计大详情成本；既有浏览器协议与12ui安装/上传审批限制不绕过，SSR/控制器/HTTP及构建不能代替实机视觉。

## 质量与版本有界目录、完整范围和按需原件（2026-10-18）

阶段T-bounded-delivery，基线8a42018。设计 `docs/DELIVERY_BOUNDED_READS_DESIGN.md`，使用 `docs/DELIVERY_QUALITY_RELEASE_GUIDE.md`。schema3查询投影在同一写事务维护，质量、候选、CI和人工历史各自SQL分页；列表不携带全工作区、证明正文、CI声明或候选快照。当前视图只请求所需目录，筛选/代次/返回与跨页范围选择明确，详情主动展开。

范围检查复用canonical验收，加载必要前驱及其父需求完整兄弟；只读原路径、当前真实身份及最新证明，不截断宣布通过。500任务、64层依赖、500关键Issue及单JSON源1MiB为同步检查边界，超限quality413。已有原件在预算不足时仍可查看并明确unverified；批准禁止，拒绝/撤回使用固定原件/决定/历史依据，批准继续锁内完整验算；预算不足不永久锁存业务失效。删除范围仍保留原件可管理，未捕获失效与完整canonical依据一致。

Web原意图保存在会话内，未知仅重放原正文/版本/键；明确拒绝后显式重读采用，父context刷新和混代禁写、项目/会话ABA、严格真实ACK类型/版本/资源匹配、三语及SSR均有回归。独立后端预算原件不可管理与前端畸形ACK假成功两项P2已真实复现并修复，原探针分别12/34项通过；读失败采用缓存与refused重开疑点已在最终实现修正，未作未证实finding。

最终Manager完整1602、Web完整761/133文件、SDK/CLI完整637通过，来源前后324/501/124项精确一致；TypeScript/Vite通过，20个Python变更文件Ruff零诊断。OpenAPI6个相关路径（新增3）/13schema与1220引用核验，184无关路径不变；SDK wheel12个Python与共享SQL原字节一致。本阶段Go源未变，未重复Go测试。

真实HTTP最终Run6使用原登录/权限/中间件/会话和120需求、241项目任务，验证分页/精确范围、真实人工验收、签名CI、预览、创建、批准、取代失效及撤回。直接编译实际TS控制器并经真实HTTP制造成功后丢ACK，再以同原键重放，严格接收原receipt且业务版本只增加1。8直接GET+4SDK+4CLI读取覆盖35表零写，所有自有服务已停止，外部模型调用0。Run1缺fixture导入、Run2空Bearer启动、Run3未等正常POST异步审计、Run5误用缺失顶层esbuild路径均保留为夹具错误；Run4 Python链已成功，Run6是最终新源及TS控制器验证。Manager首轮1598通过，但3个测试仅导入格式变化导致来源检查失败；此后又修复独立边界，本节使用包含最终修复的完整复跑。

证据 `.sop-runtime/delivery-evidence/bounded-delivery/`；源码、唯一测试文件和产物先盘点/散列保留，再清理精确任务scratch，不遍历链接。实际全部本地commit以commit-receipt为准，不push，.pnpm-store保持忽略及零跟踪。真实390px中英日浏览器视觉、PG/MySQL/MariaDB连接、生产身份/模型/数据库/基础设施和长期规模尚未验证；既有大chunk/非本阶段Deployment Drawer告警保留。完整目标active，production_integration_complete=false；人工评审/进度/基线/需求影响详情、Issue反向事件来源与generic/reflection真实处理继续待办。

## 人工验收有界详情与原请求恢复（2026-10-19）

阶段T-bounded-review，基线46e2b0e。设计 `docs/DELIVERY_BOUNDED_REVIEW_DESIGN.md`，使用 `docs/DELIVERY_MANUAL_REVIEW_GUIDE.md`。当前依据、历史小摘要和指定原件分开读取；目录只在SQL取240字意见摘要与是否有证据，不再加载全项目或历史快照正文。游标绑定租户/项目/阅读者/任务/页大小及固定序号窗口，追加决定不改变旧窗口。删除任务、当前证明超限或索引不可用时，授权历史原件仍独立可读。

当前依据复用canonical完整必要依赖闭包，包括关联需求的全部兄弟任务、前驱、真实归属与有效证据。500任务/64层依赖和1MiB原件边界明确失败，不能将部分任务判为通过；写入继续完整事务证明。历史接受不冒充当前有效，通过effective_review_id对应真正有效人工决定。SQL中合法nullable req_id曾使独立任务查询索引写入非空parent_id失败；独立审查发现计划/流程显式null及非object被误当默认。两类真实症状均已修复并保留永久回归；普通Task创建接口本身已规范空值，未声称其必然触发SQL边界。

Web沿用现主题，当前/历史各自加载刷新，展开才读取原件，取消整段历史轮询。共享release和manual命令的持久原件状态机，保留原正文/版本/键及会话；未知结果锁定并支持刷新恢复、原件重放，明确拒绝后保留意见并显式采用最新依据。三语文案、迟到读取/会话ABA、混代与严格真实ACK有回归；未把SSR或控制器测试当作浏览器视觉。

最终Manager完整1637、Web完整796/135文件、SDK/CLI完整670通过，源码前后327/505/124项精确一致，TypeScript/Vite通过。OpenAPI三个相关读取路径和全部引用模型与实际应用核验，无关路径不变；离线SDK wheel12个Python文件与共享SQL原字节一致。Go源未改，本阶段未重复Go。

真实HTTP使用原FastAPI/login/权限/中间件/会话，在1200个无关任务、600任务父需求及35份大历史背景下验证有界读取、完整范围失败、删除历史、账号/项目/任务游标隔离和数据库35表零写。实际Python命令幂等、SDK/CLI三个读取，以及编译真实TS控制器成功后丢ACK、重建控制器恢复同原件重放均通过；记录只新增一次且业务版本只加1。所有自有服务已停止，模型调用0。独立审查及失败夹具、RED/GREEN、源与证据散列在 `.sop-runtime/delivery-evidence/bounded-review/`，最终提交与精确临时目录清理以独立receipt为准。

完整目标active。下一阶段优先补齐智能体实际创建问题的反向事件来源，再继续显式进度、基线和需求影响有界详情；generic/reflection真实处理仍待完善。真实390px中英日浏览器、其他数据库/生产接入和长期可靠性仍未验证；既有浏览器协议和12ui安装/上传审批限制不绕过。`.pnpm-store`保持忽略、零跟踪；本地提交、不push。
