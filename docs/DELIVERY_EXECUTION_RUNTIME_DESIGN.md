# 执行日志、受控操作与停止回执设计（2026-10-17）

## 目标与基线

在现业务Task和Hermes run上补足真实执行中输出、跨设备可靠回传及受控启动/重试/审批/取消。保持已确认的紧凑协作AntD主题，不新增TaskRun业务实体，不自动执行模型建议、不把运行成功当业务验收。基线90a4c97，上一阶段Issue诊断已提交。用户已授权全流程建设、最佳canonical设计、阶段全部commit且不push。

当前证据：agentd只最终JSON，Manager只有完成结果尾部；start从UI直呼Core再sync两次操作；cancel逻辑取消无物理停止回执。暂停观测只停止UI读取，不能变成未实现的运行暂停按钮。源码参考本地Multica输出批次/seq合并，不能照搬失败即丢批次行为。

## Core技术事实与协议

复用现hermes_entities/events/receipts及remote outbox，无新增业务表。agentd `run-tool --events` 明确JSONL协议（非TTY）：首行执行请求保持stdin打开，后续仅允许取消控制行{op:'cancel',request_id}。输出tool.started/tool.output/tool.completed，有全局source_seq、stdout或stderr、UTF8文本/元信息及最终exit结果。原子执行接口供其它用途继续明确非流模式，不把旧单JSON冒充stream。

原生与paired都消费相同协议；按流增量UTF8、完整行拼接后脱敏再持久化。跨chunk的Bearer、赋值凭据、URL认证、已知token及多行PEM须过滤；超长行整体隐藏直到换行/EOF，不暴露前缀，不停止drain造成死锁。EOF尾行有界处理；每节点/流/批次总量上限与一次截断元信息，丢失区间明确，不承诺完整未采集历史。最终完成输出和Agent语义证据保留原独立事实。

Store批次append校验run、node、attempt、原owner/assignment、source_seq、当前真实workspace权限，拒绝过期/乱序/同序异内容；相同批次幂等。日志只追加技术event和小ACK，不每chunk复制run.data或提升run业务version。原生读取控制不持Manager SQL长锁。paired先本地fsync持久化已净化批次后上传，日志ACK在终态result/stop ACK之前；崩溃/断网不自动重跑executing副作用。新增remote/events及remote/stop-ack通过真实device credential和冻结assignment授权，不能续租或伪造成功。

## 真实停止

run.logical cancelled和stop_request分开，后者字段为{id,state:requested|confirmed|unknown|not_started,reason,owner,node_id,attempt,requested_at,confirmed_at,evidence}，私有owner/lease不出Manager API。已确定未spawn才not_started。运行中取消先持久化请求，执行器经stdin请求agentd停止并排空日志；只有agentd证据证明受控进程树已退出、Wait及输出EOF完成才confirmed。硬杀agentd父进程、断网、超预算或进程丢失只能unknown，禁止用run.status或lease到期补造停止成功。unknown可由原assignment的真实迟到stop ACK变confirmed。

Windows须关闭Start后Assign job的抢跑窗口，使用原子JOB_LIST或suspended→assign→resume，失败应不执行用户命令。Job不允许breakaway；TerminateJobObject后查询活动进程0再确认。POSIX确认受控process group，无证据时仍unknown。参考Microsoft Job Objects文档和原子Job List说明，链接在末尾。

requested/unknown stop阻止重新执行、重新派发及项目归档；停止确认不代表外部副作用已撤回。Manager纯GET可投影超时unknown，不持久化/补ACK。已取消Manager intent仍可读原run的真实stop事实。

## Core共享控制接口

新增hermes_core.run_controls（或明确等价小模块），向Manager提供同步函数：

- apply_run_action(store,execution,principal,workspace,run_id,action,body,*,managed=False,receipt_request=None)->run，action start/retry/cancel，保留现RunAction、scope/task delivery/workspace version/Agent target/precondition/CAS/receipt约束。receipt_request是内部固定Manager命令的幂等内容，非HTTP客户端可指定。Manager先核对语义basis，再以当前run.version做实际Core CAS，心跳版本变化不能让原固定请求的receipt hash改变。
- decide_approval(store,execution,principal,workspace,approval_id,body,*,managed=False,receipt_request=None)->{approval,run,resume}，完整复用定义hash/attempt/checkpoint/当前workspace/approve及执行权限，不复制成空壳。
- request/ack stop及append logs可为Store方法或独立service，冻结导出signature后通知Manager owner。

从run.task_source查runtime Task.data.source.kind==manager.delivery判定托管。通用Core start/retry/cancel/approval写明确要求走业务控制，独立工作区普通run保持原用途；managed是内部调用参数，不给HTTP绕过字段。部署托管路径及journal/observe安全逻辑保持原专用能力。

## Manager业务控制

复用Project→Workspace锁、当前账号/成员权限重读、CAS/Receipt/Event。新增execution.start、execution.retry、execution.approval；规范execution.cancel改为同一固定预览payload（不保留仅id的隐式取消兼容）。payload固定{id,run_id,run_version,attempt,control_basis,reason,approval_id?,approval_version?,decision?}；reason非空、有界。每个操作同时核项目权限及runtime当前权限；审批/副作用未知重试另需approve。start/retry/approve继续执行要求active项目、当前Task/需求/依赖/执行成员/目标与配置有效，不能从generic Core绕过。取消用于收尾，仍允许暂停/planning，归档只读。

新增纯读runtime detail，精确node/attempt/output GET及control-preview POST，路由和严格DTO由Manager owner先冻结。服务端反查原workspace/run，客户端不能传其它run/workspace。output游标绑定project/execution/run/node/attempt/stream，未知ID或attempt不回退首项或当前；source明确live_capture/completed_node_result/unavailable，包含availability、净化/截断、缺失区间、chunks、next_cursor/more/complete及实际available_attempts。停用workspace仍可按真实read访问历史，不授予execute。

control_basis绑定Task有效定义、entry/run/attempt、状态/active_node、目标/Agent/审批及stop语义和项目能力，排除日志chunk、观测时间、lease/presence心跳。body.run_version是预览事实；仅技术版本改变且语义basis一致时可用当前Core CAS。真实语义变化必须409，草稿保留并明确采用。Core receipt请求内容始终为原固定命令，不随重试的当前version变动。

Core排队是可恢复跨存储效果；Manager SQL失败后原Core receipt可恢复，重放不新建/重复启动。原生只在Manager已提交event.start_run/resume明确对应原run、当前操作者及原上下文权限仍有效时schedule；已queued重放只恢复已有交接，不新建运行。paired可领取的已授权原queued保持真实未知状态，不把500当未发生。receipt不授予新权限。

提交事件必须固定结果attempt；后台调度及Core实际claim事务同时核对expected_attempt，旧receipt不能授权同run的后续批次。队列已保存但未交接时，以新的明确启动预览恢复原run/attempt，不由GET或普通同步隐式启动。

批准和拒绝使用独立的服务端能力：controls.approval与required controls.approval_reject。前者要求当前可继续执行，后者采用取消收尾条件并仍要求项目和运行两域的当前审批权限及精确待审批项；暂停、范围或配置变化不能使合法拒绝入口失效。命令计划可包含纯approval gate，至少保留实际command且gate不能作为测试；本轮仅支持本地检查点，paired预览提前明确拒绝。

当前observations所有stdout/stderr/error/Agent message及事件文字统一服务端脱敏，usage只投影安全有界结构；保留completed_node_result来源。新增runtime summary暴露active node、lease recovery需人审、stop和每项can/reasons，但不露env、argv凭据、owner token。Issue node证据目标增加明确node/attempt定位，UI保持完整返回。

## 四个关键界面

1. 运行概况：原Drawer/Task卡内，实施/测试/人工审查三阶段；执行和观测状态分开，停止请求/确认/未知可辨，真实服务端能力及禁止原因。
2. 步骤日志：桌面步骤列表+日志，窄屏先选步骤后单面板；明确attempt与旧成功节点复用事实，stdout/stderr分开，来源/缺失/净化/截断提示，分页续读去重、跟随最新与暂停读取、只搜索复制已净化已加载内容。只读文本，不执行HTML/ANSI。
3. 操作确认：固定运行身份/basis/原因/原key/body的预览与明确确认；忙/unknown禁止关闭/换操作。unknown先查原状态/按原意图重试，不自动再启动；409只读取并明确采用兼容新事实，保留草稿；不能重复提交直呼start+sync。
4. 历史恢复：历史摘要按需精确打开，不一次全部展开；execution/node/attempt深链和返回选择完整，旧来源持续只读。恢复读取与重跑分开，副作用未知明确先核对。

保留现主题/组件、三语/键盘/会话与退场身份。CUA此前协议策略拒绝、12ui install/upload自动审查拒绝，不重试绕过；390px实机视觉继续明确待验证，组件测试不能代替。

## 验证与交付

先RED后实现：真实agentd输出在命令结束前持久可读、UTF8/秘密跨chunk/PEM/超长行/预算drain；native与paired断网/重启/ACK乱序/旧claim、不重复副作用；真实Windows孙进程取消后不存在、正常确认与强杀unknown；Manager作用域/纯GET/旧attempt/Project paused/archive/权限变化/CAS/幂等/跨存储恢复；UI真实回调固定key/unknown/409/退出/分页/精确深链。独立增量审查一次后修复原始复现，root最终全量Manager/Web/Core相关或全量、SDKCLI、Go、类型/build/OpenAPI，记录未验证平台和既有警告。

scratch .cache/delivery-execution-runtime；证据 .sop-runtime/delivery-evidence/delivery-execution-runtime。重要文件先清点/hash，停止所属服务，不留临时凭据/私钥，精确清理并保留源/证据hash，阶段全部commit不push，完整goal继续active。

参考：[Multica](https://github.com/multica-ai/multica)、[Microsoft Job Objects](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects)、[原子Job List](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812/)。
