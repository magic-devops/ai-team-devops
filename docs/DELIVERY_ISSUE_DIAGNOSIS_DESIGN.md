# 项目问题诊断与需求回流设计

基线79b634d。前一阶段已实际验证并统一提交，属于实质进展。本阶段完成固定问题证据→结构化诊断提案→人工核对→既有唯一需求回流的可操作纵向流程，继续完整目标，不把它缩减为分类或假成功。用户授权按最佳统一设计推进，不保留无必要历史桥接。使用brainstorming/feature-development/writing-plans/TDD及已批准紧凑工作台方向；已有设计和持续授权无需重复审批。12ui安装/上传及浏览器协议先前策略拒绝保持，不绕过。

## 选择与归属

现有bug_triage Workflow只分类并完结自己的workflow，不改变业务Issue；不把它作为诊断事实或Issue解决证明。扩张旧tracker的ops-tasks会绕过需求/CAS与验收。采用delivery领域的固定证据和持久化提案，复用当前模型网关和原issue.promote→tasks.plan，保留当前Issue/Requirement/Task唯一归属。

新增IssueDiagnosis支持表（不是第二个Issue），结构仿RequirementAssistance：id(64 SHA namespace tenant/project/actor/key)/tenant_id/project_id(FK)/issue_id/user_id/request_hash/status(generating|succeeded|failed|cancelled)/data(JSON)/created_at。data保存原request_key、generator、固定已脱敏snapshot、issue_basis、selected证据、原runtime workspace scopes、model/provider/usage、result/error及review。不把Issue ID塞进requirement_id，不改已有生成历史。新表通过既有Base.metadata.create_all创建，不隐式ALTER现有表；补SQLite和PostgreSQL DDL验证。项目Session写保护照常生效。

## 固定证据

新增delivery_issue_evidence.py负责issue_snapshot(db,project,data,user,issue_id,*,store=None,execution=None)->dict。返回issue(serialize真实Issue)、issue_basis(64hex)、evidence(list)、requirement_id(str|null)，内部另含evidence_scopes={evidence_id:workspace_id}、runtime_scopes(list)、evidence_digests={id:实际证据语义SHA}，内部字段不出API。assert_evidence_access(store,user,project,workspace_ids)用于历史提案当前访问核验。

Issue在当前项目/租户中明确查询；来源仅从Workspace.executions/deployments的issue_id反向关联，不解析description或信任用户提交source ID。真实Task、执行/测试结果、部署operation/探针/恢复历史通过白名单投影；无来源、缺失和受限分别显示。runtime read/workspace访问不足只返回受限条目，不暴露原私有日志/计划。事实、未知结果、历史物理成功与当前业务有效性分开，不把计划比例或旧登记当证据。

EvidenceItem严格字段：id、kind(issue|task|execution|deployment|node|probe)、label、status(str|null)、summary、facts(list[{label,value:str}])、excerpt(str<=4000)、truncated(bool)、missing(bool)、restricted(bool)、redacted(bool)、target(dict明确project_id/view/detail及实际task_id/execution_id/deployment_id/requirement_id/issue_id)。ID稳定且唯一（如issue:<id>、execution:<id>、node:<run>:<node>）。facts.label使用稳定代码，UI翻译。最多32条；超过明确截断，不自动改选另一来源。issue_basis只绑定真实Issue及Manager canonical反向来源语义，跨读者一致；排除as_of/observed_at/presence等无语义时间及单纯新增的回流需求关系。实际Core结果及身份由内部evidence_digests另行绑定，只按当前真实用户授权读取，不用内部SQL或伪Principal绕权。receipt保存全部原选中digest和workspace scope；历史当前性与采纳再比较全部原选中digest及授权，真实Task/需求定义或运行结果变化立即失效。未选私有来源的可见性差异不使提案误失效。

日志不是天然脱敏。仅发送用户明确选择的当前证据；不拼接workspace/config/env/argv或任意文件。excerpt做私钥、Bearer、常见token/password/API-key值过滤，标记redacted和truncated。固定提案只存脱敏证据，不存原始日志。事实本身不证明模型建议正确。历史提案若当前读者无原选中workspace读取权限，返回restricted元数据、result=null，不泄漏生成内容；当前采纳者同样重验。

## 生成与提案

POST生成先取得项目锁并重读账号/项目write及来源，再提交持久化生成receipt，然后释放业务事务/锁调用现有llm_gateway（cache_ttl=0，task_type=classify，Request带真实项目身份）。相同actor/key不同输入409，相同原输入从原receipt返回，不重复模型计费。没有receipt前不调用provider；不同key是用户明确的新生成。模型失败不静默规则回退，规则必须明确选择。服务中断留下generating只称处理中或结果未知；GET不续跑、不写、不自动认为失败。取消是放弃此提案采纳，不声称已中止远端模型。迟到输出不覆盖cancelled/已审阅；用量仍由gateway审计，provider原异常不泄漏到UI。

输出严格JSON，拒绝重复键/非有限值/多余字段，<=32768 UTF8字节。DiagnosisSuggestion：summary(1..2000)、hypotheses(<=8条，每条hypothesis、confidence low|medium|high、evidence_ids仅本次selected IDs且非空、verification_steps非空列表)、checks(<=12条title/instructions/evidence_ids)、risks(<=12字符串)、requirement{title1..256,description<=20000,priority P0..P3,acceptance_criteria1..40非空条目}、open_questions(<=12字符串)。无工具调用、shell执行、自动assignment/resolve/修复成功字段。未知证据引用拒绝，提示明确区分推测与事实。规则输出同schema，source=rules，model/provider空，不伪造AI或诊断根因。

生成完成重读原actor及权限、Issue/选中来源，变化保留原输出但current=false，不能采纳；不以新的Issue替换旧snapshot。GET仅投影，不改generating或写默认Workspace。

## 人工审阅与唯一回流

新Command actions issue.diagnosis.adopt / issue.diagnosis.dismiss，使用已有Delivery CAS/Receipt/Event/Project→Workspace锁。adopt需项目approve，生成需write，dismiss允许原生成者write或项目approve。归档只读，paused/planning可做诊断与计划维护，不启动执行。采纳固定来源、当前证据、当前原selected runtime访问、successful且未拒绝提案，记录明确comment和reviewer。跨账号批准可以，但不扩权读取原私有证据。

adopt调用原_promote_issue；检查所有flow.source_issue_id候选，仅复用同租户、同项目真实现存需求（按ID稳定选择），不让已删除或外项目候选遮蔽真实关系；存在时返回其ID且不覆盖已有需求/原来源，新需求才应用人工编辑的title/description/priority/criteria，并在flow保存source_diagnosis(id/basis/result_sha/reviewer/comment)。不同key/不同actor并发不会产生重复需求。Issue保持原状态，不自动关闭或标修复。后续任务拆解/负责人/执行/测试/人审仍沿既有流程。dismiss存拒绝或取消审阅记录及理由，不删除历史。generating提案阻止项目归档，明确dismiss后可继续；provider调用期间无业务长锁。

## 精确API与DTO（backend owner先冻结）

GET /api/v1/delivery/issues/{issue_id} -> IssueDetail {project_id,version,as_of,issue,issue_basis,evidence,requirement_id,diagnoses:list[DiagnosisView]最多20,next_cursor,permissions:{can_generate,can_adopt,can_dismiss},reasons:list[{code,message}]}。
GET /api/v1/delivery/issues/{issue_id}/diagnoses?cursor= -> DiagnosisHistory {project_id,issue_id,issue_basis,items,next_cursor}，游标绑定项目/Issue，20项。
GET /api/v1/delivery/issues/{issue_id}/diagnoses/{diagnosis_id} -> DiagnosisView，精确查tenant/project/issue/id，即使原Issue删除仍可核对允许访问的固定历史。原Issue缺失时current/can_adopt=false并返回source_missing原因，原scope重新核权；生成者或approve可按服务端授权明确dismiss，不能伪造当前Issue或回落首项。
POST /api/v1/delivery/issues/{issue_id}/diagnoses -> DiagnosisView。IssueDiagnosisGenerate输入{expected_version,issue_basis,selected_evidence_ids(1..32,包括issue:<id>),generator:ai|rules默认ai,instructions<=4000默认空,idempotency_key8..100}；原receipt pending返回其generating view而非再次调用模型。Provider失败返回typed DiagnosisView(status=failed,error安全消息)，scope/input/CAS保留4xx；原key只返回原outcome。
DiagnosisView {id,issue_id,request_key,requested_by:{id,name},generator,status,issue_basis,current,restricted,snapshot(已脱敏|null),result(DiagnosisSuggestion|null),error({code,message}|null),model,provider,usage,created_at,review(null|{decision:adopted|rejected|cancelled,actor:{id,name},comment,at,requirement_id}),actions:{can_adopt,can_dismiss,reasons}}。restricted隐藏snapshot/result/error、模型/提供方/用量及审阅内容，actions仍按当前真实权限提供can_dismiss，不能用restricted一并禁止放弃；can_adopt保持严格不可用。
IssueDiagnosisAdopt {issue_id,diagnosis_id,issue_basis,comment,title,description,priority,acceptance_criteria}；IssueDiagnosisDismiss {issue_id,diagnosis_id,issue_basis,comment}。外层Command固定expected_version/key。

后端函数issue_detail(db,project,data,user,id,*,version,store=None,execution=None)、diagnosis_history(...id,*,cursor='',store=None,execution=None)、diagnosis_detail(db,project,user,issue_id,diagnosis_id,*,store=None,execution=None)、generate_diagnosis(db,project,user,issue_id,body,request,*,store=None,execution=None)、apply_issue_diagnosis(db,project,user,data,action,body,*,store=None,execution=None)->(resource_id,before,result)、active_diagnosis_ids(db,project)->list[str]。DTO位于delivery_issue_contract.py；领域delivery_issue_diagnosis.py，可拆generation模块。root负责路由及commands接线、归档门禁、SDKCLI/OpenAPI/实际全量/唯一增量审查/记忆及全部commit。

## 四界面与状态

以现有dev-flow?view=issues&issue=<id>&project_id=<id>为唯一规范入口，抽出问题队列/固定详情/诊断草稿/人工需求预览，不另造顶级产品。队列按严重度、状态及真实来源筛选，无假健康分；窄屏纵向卡片。详情实际事实、建议、回流结果分开，精确返回执行/部署/任务/需求；unknown ID不回落。

诊断前展示固定且已脱敏的发送范围，明确AI/规则；来源缺失/限制/截断保留。生成元数据、已知事实和推测原因分开。409保留编辑内容，读取当前Issue/Workspace并精确读取原diagnosis ID，不依赖历史首屏20项，再明确采用当前Workspace版本；issue_basis变动必须重新生成。未知提交保留原key/body和身份，禁改表单/自动换key；可查询同一原请求。projectSessionKey核对请求前后，旧响应不进入新项目。useDrawerIdentity保留退场身份；忙碌/未知时统一限制关闭/遮罩/Escape。人工决定成功及显式刷新同步更新当前详情和精确提案缓存；孤立历史不留旧generating状态。三语、主题和键盘沿已有组件，实际390px未授权可用表面前不冒称视觉完成。

## 验证

RED/GREEN覆盖结构化来源、不解析描述、权限/归档/账号变动、provider前durable receipt和跨会话/不同key竞态、故障/中断pending不重复计费、strictJSON和伪引用、选择/脱敏/截断、证据变动不可采纳、原提案历史访问、取消后迟到结果、不同actor/key唯一需求及不覆盖已有需求、Issue不自动关闭、纯GET所有表不变。UI实际回调覆盖固定key/basis、409/unknown、项目/会话、退场/深链/三语。使用本地真实HTTP provider fixture经网关实际计费审计，不冒称厂商模型质量。root完成全量Manager/Web、相关SDKCLI/类型构建/OpenAPI及唯一独立增量审查；安全清点哈希后清理.cache/delivery-issue-diagnosis，只保存公共证据，不push。完整goal active。
