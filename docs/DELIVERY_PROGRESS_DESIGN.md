# 真实进度历史与计划基线

继续已批准的紧凑协作工作台及完整主计划。上一阶段 `00e237b` 已提交；本阶段补齐独立、持久的进度观测、冻结基线及可追溯图表，不把连续历史、容量、项目组合、生产部署等完整目标缩减为本轮范围。

## 当前证据与选择

现有 workspace.history 只读取最近 200 个交付事件的汇总，前端又按本地日期裁为 12 点；不能恢复长期任务状态、验收证据或范围变化。旧 Sprint 图只保留当前观测，缺失历史没有伪造。Task 估算是 XS/S/M/L/XL，并非工时。

使用独立 SQL 观测表和不可变基线表，沿用现有业务实体、有效执行验收口径和事务。日图按 UTC 当天最后一次实际观测展示；原始观测追加保留。没有记录的日期为 null，不前填、不插值、不补零。当前实时状态与已落盘历史分别标注。

Ruling：本阶段是已授权主计划中的进度历史/基线实现。用户已批准紧凑方向并要求持续实现、验证和阶段提交，现有要求足以决定本地实现，不重复请求审批。继续应用 brainstorming、writing-plans、TDD、12ui/WorkBuddy 指导；此前 12ui 第三方上传被自动审批拒绝，不重试上传，使用本地参考和实际浏览器核验。

## 观测与事务

- 新增 DeliveryProgressObservation：稳定公开 id、递增内部序号、tenant/project、UTC observed_day、observed_at、source、actor、source_version、fingerprint 和最小事实快照。快照含项目日期、里程碑/迭代范围、需求阶段/修订/basis，以及任务 id/标题/需求/迭代/里程碑/负责人/估算/日期/内容基准/有效状态；不复制执行日志、模型凭据或权限。
- 业务 ORM 变化通过 Session before_flush 收集真实作用域，在外层 before_commit flush 后捕获有效 reconcile/materialize 结果，与业务提交原子保存。覆盖 Requirement、Task、Issue、Sprint、Project、DeliveryWorkspace 及 DeliveryEvent。Core/bulk 删除或写入若不触发 ORM dirty，显式登记作用域；不能只覆盖交付路由而漏掉旧 API、同步或组织派单。
- 只有实际变化或当天第一条观测才追加；比较最近一条事实，不能按“日期＋内容哈希”全局去重，以免同日 A→B→A 丢失最后 A。人工记录及冻结基线可明确追加当前观测。回滚、失败 CAS、失败幂等和嵌套事务不得留下成功观测或丢掉外层最终状态。
- 每日采集独立于 Hermes 可用性，后台在真实 active Tenant/Project 上分页扫描，不用环境默认项目、不伪造管理员。唯一 daily checkpoint 防止多实例重复；仅写观测，不推进需求、创建事件、改变 workspace.version、启动任务或调用模型。服务中断的历史缺口保留。
- GET 只读，首次查看不能创建观测。已有旧交付事件保留；不能根据其简单汇总伪造过去任务明细。现有 history 兼容字段可以保留，新的进度页使用独立历史。
- ORM、Core 与按主键批量更新转移真实 tenant/project 时，保存原作用域与更新后目标作用域的最终观测；过期 ORM 属性从 flush 前数据库读取原归属。未知写入者留空，不套用历史审核人。
- 项目查询先在 SQL 限制日期并按 observed_at/seq 选每日最后快照，coverage 首末使用轻量 MIN/MAX。命名范围的首末仅分页投影 scopes 元信息，请求范围内只装载每日最后有效完整事实，避免短日期查询解码整个生命周期快照。

## 任务与需求口径

图表单位为任务数。任务互斥状态由服务端计算：pending、in_progress、blocked、awaiting_review、recorded_completed、verified_completed。

- recorded_completed 是没有当前有效验收依据的完成记录，不能称为已验证。
- verified_completed 须为有效 completed，且有当前有效执行验收，或关联需求当前有效修订已通过质量验收进入 release/operations；旧失效证据不计。
- awaiting_review 使用当前最新、未失效的实际执行记录；运行成功不直接计为 verified_completed。
- 同时返回 tasks_total、recorded_completed、verified_completed、awaiting_review、remaining（未验证任务数）及独立的 requirements_total/requirements_accepted/requirements_released。不得混算任务数和需求数。
- 估算仅保留分类及缺失情况，不把分类擅自换算成工时、容量或确定预测。

## 冻结计划

新增 Command `baseline.create`，沿用 approve 权限、CAS 和幂等收据。payload 包括 title、scope（project/milestone/sprint）、scope_id、显式 task_ids、basis、可选 starts_on/ends_on 和 note。

冻结前核对当前范围完整任务集合、内容 basis、当前项目与所选里程碑/迭代关系。旧 API 在 workspace.version 不变时修改任务，也必须被 basis/任务集合检查拦住。输入日期真实有效、有序，不猜测缺失日期；没有完整日期时只冻结范围，不绘制理想线。

DeliveryProgressBaseline 独立保存创建者、创建时间、源版本、范围、计划日期和完整最小事实快照。记录不可编辑或覆盖；重新计划创建新基线。重复固定请求仅产生一条基线。

比较当前范围与选定基线，返回 added、removed、changed（含 before/after 与变化字段）和 unchanged_count。已删除任务保留冻结标题和只读状态；查看当前任务时必须明确跳转，不能把历史状态冒充当前状态。固定理想线按基线任务总量与明确计划日期计算，不随新增范围变化；实际线区分当前范围剩余与基线内剩余。

## 读取契约

`GET /api/v1/delivery/progress`：必须 X-Project-Id；query 为 starts_on、ends_on（缺省最近 30 个 UTC 日期，最多 366 天）、scope=project|milestone|sprint、scope_id、baseline_id。非法范围/日期和跨项目资源明确拒绝。

响应统一包含：

- project_id、version、as_of、timezone=UTC、scope={kind,id,label}、range={starts_on,ends_on}。
- scopes={milestones,sprints}，供实际范围选择；不提供虚构迭代。
- current：实时最小任务/需求事实、task_ids、basis、metrics；与历史分开。
- coverage：first_observed_at、last_observed_at，以及 observed_days、missing_days、future_days 三个 UTC 日期数组；界面从数组长度显示数量。未来日期不算已丢失的历史。
- days：逐日 date、observation_id、observed_at、source、metrics、baseline_remaining；缺失观测对应 null，不能显示零任务。
- baselines：当前范围的基线摘要；baseline：当前选择的不可变基线；comparison：具体范围变化；ideal：明确标记为参考计划的 date/remaining。

current 的任务事实为 id/title/req_id/sprint_id/milestone_id/owner_id/assigned_to/estimate/starts_on/ends_on/basis/status/recorded_status；metrics 包含 status_counts 六类互斥计数。comparison.changed 只比较计划/范围字段及内容 basis，不把正常状态推进单独误报为范围变化。

`GET /api/v1/delivery/progress/observations/{observation_id}`：读取同项目实际历史快照，可指定 scope/scope_id 从该时点事实筛选；历史已删除范围保留快照标签与明细。

`GET /api/v1/delivery/progress/baselines/{baseline_id}`：读取同项目不可变基线与当前比较。

`progress.record` command 的 payload={}，需要 write；使用原 CAS/幂等机制明确记录当前事实，不自动完成工作。API 不支持客户端指定过去的观测日期或伪造完成状态。

## 页面与四个关键状态

工作台新增“进度”页，概览只保留简洁的最新记录、覆盖提示及入口，移除以有限事件柱条冒充完整历史的主要展示。保留原有需求、任务、执行和资料入口。

1. **正常查看**：日期范围、项目/里程碑/迭代、基线选择与记录按钮；覆盖行；并列燃尽与累计流；同源可键盘操作的日期/观测表。图表点击与表格按钮打开同一历史详情，URL 保留范围、基线和观测定位。
2. **无记录/缺口/无日期**：显示首次观测后的真实历史，空日期留断点；无完整计划日期时隐藏理想线并说明；单点只显示点，不构造曲线。
3. **冻结/并发冲突**：展示将冻结的任务数量、范围和计划日期；固定打开时版本/basis/任务集合；失败保留输入；409 查看最新范围后明确核对并采用，再重新提交。基线只读，重新计划新增。
4. **历史与变化详情**：显示实际观测时间、来源和当时任务；added/removed/changed 可展开；“打开当前任务”显式导航，删除的任务只读。不存在/跨项目观测、读取失败、权限不足分别提示。

沿用 ECharts、AntD 和主题变量，新增图表适配而不改变旧数字 day 图的语义。实际曲线 connectNulls=false；图例和 tooltip 含明确单位与 UTC 日期。ECharts 点击不是唯一入口，表格/列表按钮支持键盘及读屏；失败保留已有数据并提示过期。390px 图表上下排列、控件换行、历史表转列表，减少动画设置有效。中文、英文、日文齐全。

## 验证与交付

真实 SQL 事务（含旧写入口、Core 删除、rollback、嵌套事务）、超过 200 个事件、A→B→A、每日/重启/多实例、GET 零写、scope/CAS/basis/幂等、不可变基线、当前/历史区分、验收失效及缺失日期；图表空点、口径、范围变化、深链/返回、键盘/窄屏；CLI/SDK/OpenAPI 同步。

本阶段最多一次独立范围审查，修复后只定点确认；适当全量回归和实际隔离服务/browser 验证后，按用户约定统一 commit。完整目标保持 active，生产集成仍 false。

临时目录 `.cache/delivery-progress-baselines/`，最终证据 `.sop-runtime/delivery-evidence/progress-baselines/`。清理前清点并散列重要证据，保留唯一文件，不遍历链接目标，不在盘符根创建目录，不改变机器/用户环境变量。

## 开发工具示例

`sop delivery progress --from 2026-10-01 --to 2026-10-17 --scope project --json` 原样输出当前项目的真实 UTC 观测与缺口。里程碑或迭代范围使用 `--scope milestone|sprint --scope-id <ID>`，基线比较使用 `--baseline <ID>`。

`sop delivery observation <ID> --json` 读取历史任务；`sop delivery baseline <ID> --json` 读取冻结计划和当前范围变化。SDK 对应 `delivery_progress(...)`、`delivery_progress_observation(id, ...)` 与 `delivery_baseline(id)`，均复用登录/项目/HMAC及现有错误处理。

人工记录或冻结计划继续使用 `sop delivery command --file <JSON>` / `client.delivery_command(body)`。先读取 workspace.version 和 progress.current 的 basis/task_ids；固定 expected_version、idempotency_key 与实际已核对的 payload。网络结果不明时复用原请求，409 明确查看新范围后再决定，不能自动换版本覆盖。

只读接口失败会报出实际错误，不生成本地假历史。示例日期仅说明输入格式，不意味着该日期已有观测。
