# 外部智能体与测试交付链路

基线17145e3。继续原完整目标，优先修复真实外部执行到测试验收的断点。沿用唯一业务Task、DeliveryWorkspace意图与Hermes运行，不新增执行器或并行完成口径；不保留不必要的旧名称领取/报告写通道。已授权紧凑工作台、当前技术栈、阶段全部commit不push。

## 本阶段行为

公开配置远程设备运行策略，通过设备凭据报告能力与最近联系；在同一原任务快照中执行固定版本单Agent，再执行明确命令测试，后台回写后由人审查，失败关联问题可定位并转需求。运行、测试与业务验收分别显示。已有5秒后台同步、配对、租约/outbox、失败问题去重和人工门禁直接复用。

Agent账号认证保持unknown；程序存在只证明已检测到命令。不自动安装、登录、启动或调用厂商模型。真实验证使用任务目录内协议fixture、实际worker/agentd与真实Python测试，不冒称厂商生产认证。团队登记名称、策略分工与真实设备身份分别表达。

## 设备协议与唯一数据归属

Runtime owner负责全部packages/hermes-core源、协议和定向测试；Manager owner不得同时编辑这些文件。新增remote presence独立SQL表（挂载时初始化），不在GET创建表/记录，不更新devices.version。POST /api/hermes/v1/remote/presence仅Device Bearer+X-Hermes-Device-Id，body严格为idempotency_key、worker_id、worker_version、runtime_capabilities、providers；providers每项provider id与executable_present，版本可null，auth只unknown，不接受路径/凭据。设备作用域由凭据确定，不能由body选择。

presence 120秒有效；闲置worker轮询与执行heartbeat续鲜，worker实例随机ID。capability_digest只含规范化能力，不含last_seen；policy/entity版本仅配置变动改变。凭据撤销/轮换使旧presence失效，不得在新配对下沿用。能力失效/worker替换不可静默继续未执行派发，已领取运行按现有租约/不确定副作用规则处理，不重放进程。

POST /api/hermes/v1/devices/{id}/runtime-policy要求config+execute及工作区权限，标准RunAction expected_version/idempotency_key/dry_run，全量替换allowed_runtimes(command/agent)、allowed_providers(codex/claude/opencode)。[]显式禁用，严格类型、唯一/有界。策略不等于程序已安装，presence不授予权限。新设备仍默认仅command，Agent必须明确授权。

Runtime提供execution_targets.py中可复用的读取/选择/校验函数给Manager，锁定精确Python函数名与typed字段后立即通知Manager/UI/root。目标basis包含workspace/device配置版本、策略、worker实例/能力digest；不含联系时间。task_basis与Agent固定版本另外检查，避免无关心跳使草稿每次409。保存、跨库同步、run start与claim重新检查配对/策略/新鲜度/运行类型/provider；预览成功不是继续执行授权。执行中的策略撤销不释放未验收业务状态。

AgentDispatch新增test_nodes:list[Node]，仅command，最多32、唯一ID、不允许保留agent_*命名；生成[agent_1,*test_nodes]，直接用现串行引擎保证Agent成功后才测试。记录固定原Agent绑定与后置测试定义；squad与后置测试组合本阶段明确拒绝，不复制第二套调度。remote/result的Agent成功必须对照领取节点的provider/agent_id/profile_version及有效terminal证据，不只相信exit0。命令成功仍需实际预期退出码。拒绝后不释放下一节点；保留失败证据且不自动验收。

## Manager契约

ExecutionQueue继续既有Command、CAS、原派发人/跨库幂等，新增必填task_basis、target_basis、target_kind(local/device)；target_device_id仅device模式非空，本机明确选择，不能从缺失设备默默回退。Agent模式允许test_nodes，只用于明确命令测试；原nodes仍仅命令模式，test_node_ids命令模式指向计划节点。Agent模式客户端不另填test_node_ids，由服务端从test_nodes派生，防重复源。所有节点用既有Node严格模型，不允许任意JSON绕过校验。

GET /api/v1/delivery/execution-targets改为typed纯读，as_of/runtime_configured/can_execute与workspaces[{id,name,version,agents,local,devices}]。每目标提供稳定id/kind/name/version/basis、paired、online、last_seen_at、expires_at、runtime_capabilities、providers（程序存在性、auth=unknown）、policy、can_execute和原因codes。local在线/配对为null，只按当前executor权限/可执行文件/root判断；远程不能套用Manager主机的which结果。选中Agent版本及provider单独固定，所有catalog/preview/writes使用同一权威validator。Manager先向UI/root发布精确typed shape，前端不猜字段。

POST /api/v1/delivery/execution-preview与ExecutionQueue相同body、同一校验，纯读无Task/intent/run/receipt/审计/进度写；全局审计仅精确豁免此只读POST。返回task/requirement原始验收快照、目标snapshot、固定Agent、归一化节点/测试及完整内容basis，预览前后可核对。queue存服务器target_snapshot且复验task_basis/target_basis，409保留草稿后明确采用，不自动重试。工作区/模式/Agent改变需明确重新选择兼容目标，撤销或不存在对象不可采用。

新增GET /api/v1/delivery/executions/{id}/observations，当前业务项目与runtime工作区双权限、只读。用既有Store.stream按run entity顺序分页，不复制事件存储；limit1..100，游标绑定project/execution，不能跨运行复用。返回event{id,seq,at,type,node_id,status,message}、next_cursor、run_version、observed_at、节点结果/测试摘要与权限动作；明确节点内实时输出尚不可用，不把完成后日志叫流式实时日志。限制日志/事件长度，未知用量为null且不跨provider合计。Manager投影保留provider、固定Agent版本、已观测用量、attempt、duration/截断来源等已存在结构证据，不从文本推断测试。

旧POST /tasks/agent-feed/claim、/agent-feed/heartbeat、/{id}/agent-report及对应SDK/CLI写入口删除；真实执行只能经上述身份与运行协议。旧文件型读取如仍保留只作历史登记，不参与任务完成或在线判定。root负责tasks.py和SDK/CLI，UI owner移除旧写按钮/API调用并纠正旧回调介绍，不删历史用户文件。普通任务状态编辑仍遵守既有统一验收门禁。

## 四个关键界面

1. 同任务派发编辑器：工作区→命令/Agent→明确目标；目标健康、能力、授权原因与最近联系可见，未知账号不显示connected。Agent后置测试使用紧凑参数表单，可增删命令/timeout/预期码，JSON仅高级查看；固定快照纯预览后保存。409保留所有节点草稿，读最新后明确采用，缺失/撤销不可采用，保存中不关闭。
2. 设备策略：现工作区/执行目标内按权限提供完整运行类型/provider授权；配置与检测结果分栏，失败保留，明确采用新版本，配对沿用已有流程，不在页面直出长期凭据。
3. 当前运行：Agent实现、命令测试、人工审查三阶段；真实节点时间线/游标观测/最新联系、错误/断线/重连/日志截断可读；百分比只表示已观测节点完成，不是业务完成。权限动作由服务端返回，不用自造run深链跳入无法解析的旧Workspace。
4. 失败与历史：当前尝试在上、旧尝试折叠，原需求/Agent/目标/测试/审查证据可查；具体Issue深链保留背景，可追踪转需求而不自动解决。390px单列、三语、键盘与焦点、scope切换隔离、URL返回/刷新，复用现tokens。

独立任务原生执行与任务自身验收条件、完整节点内日志流、团队成员与runtime身份绑定、生产账户/CI签名和发布运维仍属于完整目标后续工作，本轮不伪称实现。不得用名称领取或人工报告弥补这些缺口。

## 实际验证与阶段收尾

RED→GREEN：真实SQL/API公开策略、设备认证presence/120秒过期/不抖动版本、作用域/撤销/凭据轮换、目标basis并发、Agent结果绑定、Agent后置测试成功/失败/未知、原任务变更、全有或全无/重放、纯preview/GET零所有表写。核心执行现有tests与新增回归都要覆盖。

实际回路全走公开API：隔离workspace/device→policy→pair→worker presence→任务预览/queue/sync→public start→独立worker/真agentd→协议fixture Agent→真实Python测试→后台回写→人工accept；另失败test→唯一Issue→转需求幂等。worker网络中断/outbox重传、过期/取消不重复执行，记录实际进程与输出。fixture独立Go标准库编译，只前置worker子进程PATH，不触碰真实厂商CLI；不收费/不安装。

root统一Manager/Hermes/相关SDKCLI/Go定向、Web/类型/build与真实桌面/390/三语/键盘核验，最多一次完整增量独立审查，随后定点修复复验。scratch仅.cache/external-delivery/；证据.sop-runtime/delivery-evidence/external-delivery/，清理前库存/hash/保留唯一源码与截图。阶段全部非忽略改动commit，不push，完整目标继续active。
