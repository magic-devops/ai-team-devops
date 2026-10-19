# 进度工作台、有界历史与完整基线冻结

阶段 `T-bounded-progress`，基线 `af965c862ab8e774fd9e93ce453606d5a7b8c600`。本设计落实已确认的紧凑协作工作台，不保留旧整包读取的双轨兼容。整体全生命周期目标继续active；需求当前影响的后端拆分、generic/reflection及生产/视觉验证仍是后续工作。

## 已验证缺口与目标

上阶段当前源码审计在4需求/12任务/3基线中实际证明：单任务milestone进度仍装全项目任务/需求，精确基线仍重新装当前项目，需求history limit1仍拉完整影响。Web七个受控函数探针复现progress路由丢project/return、Progress和RequirementHistory在403/404后渲染旧数据，以及256历史任务全量渲染。来源在 `.sop-runtime/delivery-evidence/issue-origins/next-detail-backend-audit/` 和 `next-detail-ui-audit/`；这是对应小夹具/受控函数证据，不是浏览器视觉或生产规模证明。

本阶段完整打通：小型真实图表→独立基线目录→指定历史/基线头→任务和需求分页/精确原项→当前差异分类页→明确完整proof冻结/原请求恢复。需求历史及新历史→当前需求导航所使用的父详情抽屉，本轮定点清除已复现的403/404缓存；不能因此声称其current impact已分页。

## 信息层级与交互

1. 首屏保留UTC日期、scope、刷新、记录观察与冻结计划。指标覆盖完整scope，六类交付状态中只有verified_completed扣remaining；执行完成、人审和需求验收分开。scope下拉复用现有有界reference页，并精确解析已选页外ID；不下载全集。真实观察的燃尽/累计流图和键盘日期行使用同一个observation_id。缺失/未来日保持null，不插值。图表与selector不夹带全任务或全基线。
2. 基线按钮打开独立20行目录，显示标题、原scope、任务/需求数量、创建者/时间和日期。明确选择“使用”或“查看原计划”，不自动用首项。选中页外基线独立读取指定ID小头。观察和基线的任务/需求各自分页，展开才读完整原项；页面数量不能改变总量。拥有者仅解析可见页引用。历史任务的“打开当前任务”继续精确读当前Task与实际父需求，保留历史标题，不借当前列表代替原件。
3. 当前比较显示added/removed/changed/unchanged及不完整信息的完整总数，点击分类后只请求该页。changed与incomplete可重叠，不把分类相加冒称总任务。空历史、原件损坏、大项超限、请求失败和当前generation变化分别反馈。403/404清受限缓存并禁写；迟到响应/项目与身份ABA不得恢复旧内容。所有筛选、分页、观察、基线和返回保留显式项目及合法return_to。
4. 冻结先明确请求完整proof，再审阅scope/总数并填写或核对基线标题、日期、备注；日期默认留空。proof是完整范围捕获，不表示这些任务已通过验收。空的合法scope允许complete=true/task_ids=[]；损坏/超限不允许伪装空范围。未知命令锁定原payload/version/key、退出和竞争操作；刷新可恢复原件，明确拒绝后才能显式读取采用新proof。记录观察走独立namespace的同一可靠控制器，GET刷新不生成观察。

默认生成的基线标题遵守200字上限，保留人工草稿；日期可为空，但实际输入格式及顺序无效时明确提示并禁止确认。内部proof错误标识转换为中英日可理解的反馈，不直接显示程序token。当前需求刷新403/404同时清旧标题与正文，已失去读取依据的内容不能继续被标作当前需求。

沿用Ant Design、ECharts、主题变量和中英日；窄屏控件换行、图表纵排、历史差异前后纵排、按钮和键盘焦点清晰。四态详细说明由本阶段Web UI_DESIGN证据补充。真实390px视觉仍未验证；先前浏览器协议与12ui安装/上传的拒绝边界不绕过，SSR/回调/构建不冒充视觉。

## 唯一事实与读取边界

Task/Requirement继续是原业务实体，Observation.data和Baseline.data是唯一固定历史。现有DeliveryQueryFact可扩展progress_task/progress_requirement派生事实，与实际canonical evaluation同事务写入；普通Task列表不暴露这些重事实。查询结构升级5，通过现有configure query/rebuild显式建立；GET不修复，不重播业务，不制造观察。不能为页面再造可编辑计划或影子任务。

普通图表只用当前同代派生指标与SQL历史必要聚合，不调用capture_facts装整项目，不拉最多366份整snapshot。UTC每天按observed_at/seq取最后真实点；具名scope当天被删仍取当天最后仍含scope的点。baseline_remaining始终是固定基线ID集减当天verified ID集；ideal使用固定基线任务数量和原起止日期。

历史小头只读标量和必要JSON小路径。任务/需求页在数据库对canonical数组按稳定position过滤、排序、LIMIT+1，只取摘要列；精确原项按需并执行1MiB单项预算。必须检查真实array/object/presence，区分缺键、JSON null和空数组；未知不能猜空。当前Task/Requirement正文只在所选页/精确读取出现。数据库可能仍解析整JSON，不能将受限传输/解码/ORM装载称作恒定I/O。

SQLite json_each/json_tree具有实际项目内原型证据。JSON比较按叶路径/type/atom语义，对象键序无关、数组顺序有意义；缺失的旧计划字段继续unknown，不当empty。其他方言使用明确分支并单独记录验证范围；不支持的操作明确不可用，禁止退回整包Python切片后宣称有界。Observation/Baseline强化追加保护：正常Session/ORM/Core不能修改、删除或伪造来源；实际capture/baseline写入口显式可信作用域，维护不篡改历史。

所有项目写入先遵守共同的项目归档门禁，归档状态统一返回project_archived；其后仍执行观察/基线的追加来源和不可变保护。内部身份失效捕获仅使用已有精确能力作用域，不能凭归档例外修改历史原件。

## 正式读取表面

API前缀 `/api/v1/delivery`，全部要求显式项目、当前活跃身份与实际项目read权限。精确历史读取独立于当前实体存在/当前索引可用；需要当前比较/proof/series的部分明确依赖schema5和generation。

- `GET /progress`：新的小series，project_id/version/query_generation/as_of/timezone/scope/range/current={scope,metrics}/coverage/days/selected baseline小头与ideal。保留最多366天，不返回current.tasks/requirements/task_ids、全scope目录、全部baseline或全comparison。
- `GET /progress/baselines?scope/scope_id/limit/cursor`：固定原命令source_version水位的基线小目录，默认20/max100，以created_at/id稳定翻页，无task_ids或完整snapshot。实际创建基线的命令版本严格递增，因此时钟回退也不能把新创建项混入旧窗口；观察记录仍使用自身seq水位。
- `GET /progress/baselines/{id}` 与 `GET /progress/observations/{id}?scope/scope_id`：精确固定小头、原依据/来源、计数/完整性，不隐式求当前全项目比较。
- 两类source分别增加 `/tasks`、`/requirements` 独立page，以及 `/tasks/{task_id}`、`/requirements/{requirement_id}` 精确原项。
- `GET /progress/baselines/{id}/comparison`：原基线basis与当前query_generation下的全类别总数/完整性。`/comparison/items?kind=added|removed|changed|incomplete&limit/cursor` 独立分类页，`/comparison/items/{task_id}?kind` 精确比较事实。unknown字段、当前不存在与历史不存在保持原语义。
- `GET /progress/freeze-proof?scope/scope_id`：完整scope/独立progress basis/全部task_ids/metrics/total/version/generation/complete/available/budget/reasons。总输入16MiB、scope任务、必要闭包任务与需求各最多10000、依赖深度64、单原项1MiB。SQL先核依赖深度与环；预算不足、缺失或不完整时complete=false/available=false，basis与task_ids为空值，不能回部分IDs。完整空scope返回[]。

精确DTO以新的 `delivery_progress_contract.py` 为代码合同，OpenAPI/SDK/CLI/Web必须同时同步。所有page限20/100、cursor最长4000，签名绑定tenant/project/reader/source kind/id/原basis或fingerprint/scope/collection或kind/filter/limit/稳定position或固定水位；当前页/比较还绑定query generation。错reader/源/参数/签名、混代及读取中变更明确拒绝，不自动接新第一页。

## 完整写入与原件恢复

动作仍是 `baseline.create`（title/scope/scope_id/task_ids/basis/starts_on/ends_on/note），不是新增freeze动作。外层expected_version和idempotency_key保持。写端继续approve、真实关联、当前完整canonical范围与独立progress basis重验；不能凭已显示20项、Task definition basis或旧proof绕过。16MiB/10000/1MiB预算不能仅在UI执行，直接命令同样不能批准部分。

冻结在前置预算通过后，对必要闭包重新进行canonical重验，避免前置通用reconcile和remember_basis先装全项目。但命令最终仍同事务捕获真实全项目Observation并刷新现有查询投影；该写副效应的全项目成本保留并单独跟踪。本阶段的普通读取及批准输入边界不能冒称整个写事务都只计算小scope，也不能为了性能把全项目历史偷换成部分snapshot。

progress.record仍显式生成真实观察，资源ACK为observation；baseline.create资源ACK为baseline。复用现有deliveryCommandController与精确command receipt，不再造状态机。两个namespace互不覆盖，保存原件后才发送，重载保留同会话原件；未知只查原结果或同body/version/key重放。严格验证项目/action/resource类型和实际非空ID、applied_version、当前代次、affected_refs与gate。权限读取失败可清显示证据，但不能据此丢弃未知原请求或误认写入失败。任何读取不调用模型、不自动送写。

## 验证和交付

先将已复现症状与缺失合同写成永久RED，再实现。关键验证包括SQL只读选列/limit+1、放大天数和单snapshot任务分别测、总数与canonical语义差分、删除scope/实体仍可读原历史、reader/游标/代次/会话ABA、403404清缓存、预算不足/损坏unknown、完整proof空和超限、原件不可变、重复/并发/丢ACK刷新恢复及版本只增一次。规则/生产身份认证使用真实loopbackHTTP和编译实际TS控制器联调；SQLite证据不冒称其他生产数据库。

稳定源做完整相关Manager/Web/SDKCLI、类型/构建/公共合同/wheel核验并独立审查。新临时目录 `.cache/bounded-progress/`，证据 `.sop-runtime/delivery-evidence/bounded-progress/`；先盘点/散列重要源与唯一产物，再只清本阶段目录。全部阶段变更本地commit，核提交字节与验证一致、worktree clean，不push。完整目标继续active。
