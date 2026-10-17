# 受控部署、真实验证与恢复设计

## 目标和事实

以当前项目和已批准的不可变ReleaseCandidate为唯一交付入口，补上实际执行、健康观察、灰度晋级、明确回滚及失败Issue回流。沿用紧凑协作工作台、现有权限、Hermes目标发现/执行/事件/receipt/远程outbox。无第二套业务Task、Requirement或发布产品。旧system_ops/ops_center的手工success、JSON流量和queued external_request不构成实际部署证明，不为它们建立兼容桥。

基线80930fa。Release候选固定scope/commit/CI/artifact SHA256，尚未交接部署；release gate明确不通过。现有Hermes真实本机agentd和paired remote command可复用，但通用retry/replay可能重跑未知副作用。Store本身不鉴权，所有部署入口必须明确验证真实Principal权限和workspace。外部生产端点/凭据/稳定版本尚无权威配置，功能须能用隔离真实服务验证，不能宣称生产部署完成。

## 边界和方案

采用Manager独立部署领域+Hermes受控run+安装在执行端的标准runner。另一选择是继续SystemOps登记，无法证明副作用；新建独立调度器会重复设备/租约/可靠结果传输，故不采用。所有Manager状态复用DeliveryWorkspace.data及原CAS/Receipt/Event/Project锁，无新schema；Core复用runs实体，使用不可改写的deployment_source，不伪造Task。

Manager拥有环境、不可变部署意图、候选/环境/回滚基线、明确人工晋级和当前已验证版本。Hermes拥有实际设备授权、固定root、run/node事件和真实结果。执行端runner拥有受控操作日志、实际制品字节校验、受控argv和健康观察。凭据仅从执行端环境/受控工具解析；API没有私钥/密码/任意shell或请求方health metrics入口。

## 环境

Workspace键deployment_environments，列表对象：id/name/generation/active/created_at/updated_at/definition。definition固定workspace_id、target_device_id（空为明确本机）、runner_argv（非空前缀argv）、apply_argv、probe_argv、artifact_origins（1..8 HTTPS纯origin）、max_artifact_bytes（1..268435456）、timeout_seconds（3..3540，覆盖下载/执行/整个观察，须大于observation_seconds+1）、observation_seconds（1..600）、min_samples（1..100）、traffic_steps（1..10项严格递增1..100且末项100）。name与候选environment精确对应，同项目不重复。

configure权限才可保存，固定版本和幂等；代次单调递增，正在交接/运行/灰度等待/结果未知的环境不能修改。配置不是连通性或授权证明。实际target snapshot在计划预览时发现并固定，开始时重新验证。必须同时满足项目approve和runtime execute；configure不授予execute。workspace读权限用于目录/查看。权限不从角色名称或工具登记推断，不构造全权Principal。

命令仅结构化argv；允许在每个参数中替换已知token {artifact_path}、{artifact_sha256}、{commit_sha}、{operation_id}、{traffic_percent}；未知token和NUL拒绝。无shell。runner_argv是执行端已安装标准runner入口（例如明确Python路径、-m、hermes_core.deployment_runner），不在预览中下载/安装。环境操作者信任这些工具和探针；受信设备身份并不等于硬件远程证明。

## 不可变部署与灰度

Workspace键deployments。一部署固定id、candidate_id、candidate快照、环境definition+generation、target_snapshot、原发起User、原runtime Principal作用域、baseline（该环境最近完整100%且实际验证的部署快照或null）、preview_basis、traffic_steps、reason、created_at、operations。不能编辑原内容；每个operation固定id/index/kind/apply或observe、OperationPlan/plan_digest/Core run id/request receipt，保存真实观测与时间。

preview要求当前有效approved候选、完整质量/CI仍匹配、环境name一致且active、明确target可执行，捕获当前稳定基线和环境最新部署状态。同环境只允许一个在交接/运行/灰度等待/未知的部署。已失败且确知run终态可通过新预览/新部署向前修复，显示前次失败；不能把新意图称旧意图重试。结果未知时禁止新副作用，仅查询或观察恢复。

create使用preview_basis+外层CAS+原key；先提交Manager意图，再显式dispatch同一原发起人固定Core receipt，再显式start固定run。Receipt已存在时先恢复已有run，不能因恢复时配置/权限变化制造另一个run。没有外部receipt前按当前权限/项目active/候选/target重验；交接后原物理运行历史保留，当前有效性另算。环境独占和Project→Workspace锁覆盖并发不同操作人。所有未关闭部署意图纳入项目归档门禁。

一operation执行一个真实traffic step，apply与独立probe都通过才到awaiting_promotion或最终verified。晋级须明确用户approve+runtime execute及固定当前operation依据，重新检查候选与环境；新operation不重复之前副作用。没有流量采集证据不能用计划整数当已生效；probe报告实际traffic必须等于目标。100%最终验证后才能设环境当前稳定版本和候选deployment verified；节点结束数仅表示步骤结束。

## Runner协议与幂等

新包模块hermes_core.deployment_runner。公共接口execute_operation(plan:dict,root:Path,*,observe:bool=False)->dict，命令行 --plan-json JSON [--observe]，只输出一份标准JSON。严格OperationPlan protocol=sop.deployment.v1；字段operation_id/tenant_id/project_id/environment_id/environment_generation/candidate_id/kind(deploy|rollback)/artifact_url/artifact_sha256/commit_sha/traffic_percent/apply_argv/probe_argv/artifact_origins/max_artifact_bytes/timeout_seconds/observation_seconds/min_samples。不接受额外字段/非有限数字/重复JSON键/非法bool-as-int。operation_id和所有identity长度有界，整体JSON<=16384 UTF8字节，命令argv总长度<=Windows安全限额。

Runner在固定执行root的.sop-deploy目录内建立不可变request_digest和原子journal，所有路径不得链接/硬链接或越root。下载仅HTTPS且精确命中环境origins，无重定向/用户信息/query/fragment，TLS使用正常系统/进程信任（绝不disable）；流式限字节/超时，实际SHA256一致才有artifact_path，不能使用先前未核验文件。正常CA配置只在执行端进程，API不能传TLS绕过。实际本地验收使用独立HTTPS服务及过程内可信CA。

首次执行先原子持久记录started intent并fsync，再运行apply。相同operation_id+不同request_digest拒绝；相同已完成operation仅返回原证据，不重复apply。已有started但无完整结果称unknown，绝不自动重跑apply。Core retry/replay对deployment_source run拒绝；普通PATCH不得修改其run定义/结果。独立--observe只查询journal并运行只读probe，绝不调用apply。它是明确的恢复动作，不把人工文字当实际验证。

probe必须独立argv，返回严格JSON：healthy(bool)、artifact_sha256(64hex)、traffic_percent(int)、operation_id(str)、sample_count(int>=1)、observed_at(aware UTC时间)。匹配本operation/制品/真实traffic，时间在本次观察窗口内且非未来；每次实际命令退出0且healthy=true。至少min_samples个实际probe，观察实际持续时间>=observation_seconds，采样间隔有界；缺值/错误值/失败/timeout不通过，没有配置样本回退。child stdout/stderr有界截断，记录真实exit/duration和探针；不能以apply exit0单独称verified。

结果protocol=sop.deployment.result.v1，operation_id/request_digest/status(verified|failed|unknown)、artifact_sha256、traffic_percent、apply（真实执行事实或历史复用）、probes、started_at/finished_at、observation_seconds、error。终态journal原子保存且副作用前可识别；异常/进程中断保留unknown。结果不是供应商账号认证、生产覆盖或硬件证明。

## 恢复、回滚、问题

run结果和runner结果均匹配固定定义才可采信。租约过期/丢回执/未知active node产生unknown，保留原run，普通retry/replay不可用。deployment.observe以新只读run查询相同operation journal和实际probe，固定原plan_digest、设备/root；运行中或缺证据继续unknown，不能人工mark_success。所有结果写回复用现有可靠outbox/幂等观察；迟到结果不能覆盖新操作或原终态。

rollback是明确批准的新部署意图，不改原失败记录，使用冻结的上个已验证100% baseline制品、commit与环境配置。没有真实稳定baseline不提供假回滚；环境generation/target不相容明确阻塞。回滚也须下载/校验恢复字节、真实apply及健康观察，只有通过才称rolled_back。当前候选过期不改变物理历史，rollback来源明确历史已验证基线，不伪装当前候选审批。

失败/unknown在原Manager事务创建至多一个真实项目Issue，来源含deployment/operation/candidate/environment/阶段/证据；重复观察不重复。Issue不因回滚自动关闭。沿用issue.promote去重转换需求及验收条件，后续智能分诊继续使用现有模型网关，不默认未经人确认自动改业务。

stage_gates/released以当前有效候选、同范围、该环境最后100%验证且未被后续部署/回滚替代为准。实际历史verified与当前有效业务发布分开。手工operations、旧JSON成功、退出码0不参与。纯GET只投影无业务写；预览正常请求审计仍保留。

## 四界面

同一dev-flow releases上下文，不新建顶级产品。1环境列表与受控配置Drawer，显示配置/权限/设备在线分别状态。2已批准候选“准备部署”Drawer，固定候选事实、真实基线、环境代次、实际目标、步骤与健康要求；明确预览后开始，409保留输入/重新核对，未知结果原key查询。3部署详情同层Drawer，固定身份、阶段时间线、实际traffic/观测窗、只读日志/健康/固定计划Tabs；未知结果突出查询原请求/只读观察，不能当失败重跑。4失败排查与明确回滚，真实失败位置/证据和推测分开，打开唯一Issue→既有需求转换；回滚新意图独立确认。

三语/390px/键盘/主题/加载空态/读取失败/权限/未知ID/退场身份/项目会话切换沿用既有release组件与useDrawerIdentity。URL扩展deployment_id，不丢release_id/return_to。实际浏览器先前协议策略拒绝仍记录为待复核，不绕过。12ui安装/上传先前自动审查拒绝，不重试或绕过，沿已批准方向与现有组件实施。

## 验证与实施所有权

Runtime owner新runner+contracts+managed run服务/guard+专属Hermes测试；Manager owner新deployment领域和DTO及专属Manager测试；UI owner新API/helper/i18n/四界面/tests；root持有delivery.py/contract/service/progress/lifecycle/guard/sync接线、SDK/CLI/OpenAPI、旧假成功入口退出、真实服务完整回归/唯一独立增量审查/记忆/阶段全部commit。不混改文件。

RED/GREEN须覆盖副作用前持久标记、重复请求/不同内容、进程中断unknown、只读observe、实际TLS字节/摘要/独立探针、灰度真实比例、失败/回滚、原receipt跨库恢复、并发环境独占、scope/环境/身份变化、归档/权限、晚到结果、失败Issue去重、当前进度口径、UI fixed basis/key/409和深链。所有阶段证据.cache/delivery-deployment与.sop-runtime/delivery-evidence/delivery-deployment；清理前清点散列，测试秘密不保留，不push。完整目标保持active，生产平台认证/实际生产环境验收仍需明确配置，不冒称本地实测等于生产。

## 精确集成接口

Runtime owner提供hermes_core.deployment_contract.OperationPlan/OperationResult，execute_operation在deployment_runner中。hermes_core.deployments.ManagedDeployments(store,execution=None)：prepare(principal,workspace,*,plan,runner_argv,target_snapshot)->dict（pure，返回Core固定run data）；dispatch(principal,workspace,*,plan,runner_argv,target_snapshot,key,observe=False)->run envelope（先原receipt恢复，再新建planned run，不创建Task）；start(principal,workspace,run_id,*,key)->run envelope（固定managed run，原子queued，真实权限/target重验）；cancel(principal,workspace,run_id,*,key)->run envelope。receipt_request(plan,runner_argv,target_snapshot,observe=False)->dict为恢复固定内容的公共helper。dispatch receipt operation固定deployment.dispatch，key=Manager operation.id，start/cancel同类managed operation。source含plan/plan_digest/observe，id匹配，Core通用start/retry/replay/cancel及PATCH不能绕过。

Manager owner提供delivery_deployment_contract.py、delivery_deployment.py（可按责任拆分delivery_deployment_runtime.py）。输入DTO：DeploymentEnvironmentSave（flat字段与环境定义一致，id空表示新建）、DeploymentPreviewInput(candidate_id='',environment_id='',rollback_of='',reason; 正常部署需前二非空/rollback_of空，回滚只给rollback_of+reason)、DeploymentCreate(同preview+preview_basis)、DeploymentAction(id,basis,comment)、DeploymentSync(id)。actions：deployment.environment.save、deployment.create、deployment.dispatch、deployment.start、deployment.advance、deployment.observe、deployment.cancel、deployment.sync。环境save configure，其余副作用approve且runtime execute，sync只项目write+runtime read。所有body strict/extra forbid。

Manager函数：deployment_index(db,project,data,user,*,version,store=None,execution=None)->dict；deployment_detail(db,project,data,user,id,*,version,store=None,execution=None)->dict；deployment_preview(db,project,data,user,body,*,version,store=None,execution=None)->dict；apply_deployment(db,project,user,data,action,body,store=None,execution=None)->(resource_id,before,result)；deployment_verified_for_release(data,candidate_id)->bool（无递归/无写入）；active_deployment_ids(data)->list[str]。root将read接口挂GET /delivery/deployments、GET /delivery/deployments/{id}，POST /delivery/deployment-preview纯预览。read响应顶层project_id/version/as_of/environments/deployments/permissions，detail顶层project_id/version/as_of/deployment/environments/permissions；preview返回project_id/version/as_of/allowed/reasons/preview_basis/snapshot/permissions。reason形状code/message；permissions can_configure/can_prepare/can_operate/can_sync；deployment/detail有basis和actions（can_dispatch/start/advance/observe/cancel/sync/rollback）及原因，UI不推断权限。严格typed DTO由Manager owner定义并通知UI。

apply_deployment的result若有queued本机run，返回start_run={workspace_id,run_id}，root在Manager commit成功后用当前实际User的runtime_identity和BackgroundTasks调度execution.execute；结果只标排队。receipt已queued但Manager重试可再次调度同run，Core原子claim保证单owner。remote由既有worker领取。owner不改root持有文件。

root在delivery_sync加入当前operation run version的只观察同步（不能在sync偷偷dispatch/start），在progress、release gate与candidate详情接入当前有效部署，所有未关闭deployment纳入归档门禁。读取候选deployment状态单向调用纯helper，禁止从helper回调quality/reconcile造成递归。

当前质量scope语义不包含正常release→operations阶段标签；有效验收/修订/定义/证明继续纳入。root实测该自失效回归RED后修复，重开仍失效，不保留旧basis别名或补签。

操作结果采用严格64KiB解析上限，runner实际输出目标不超过60KiB，以适配agentd传输边界；计划与单次probe JSON仍限制16KiB。探针失败保留真实exit/duration、截断标志及error，不能从缺失值补造健康。

收口修复：预览依据剔除target的last_seen_at/expires_at两项心跳观测时间，仍固定basis、worker、能力/授权代次、环境与候选；同worker正常刷新不制造无尽409，身份或能力变化继续拒绝。非active项目不能准备或创建新的副作用；无外部receipt的新dispatch/start/advance重新检查active，原receipt读取、只读sync/observe及取消保留恢复能力。本机提交后补调度只针对该receipt事件中原start_run，旧start不能调度后续operation，暂停后也不能用重放开启新的本机执行。已明确非零apply结果即使在终态写前中断，也不能通过observe或reused标志变成verified；未知exit=None仍可由独立实际证据恢复。
