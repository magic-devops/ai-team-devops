# 需求详情、当前影响与完整变更设计

阶段 `T-bounded-requirements`，基线 `ed00a4bfa0f6f7d4135503bb8f1ec2b3540091e2`。目标是完整需求工作流：当前详情→原定义/产物/评审→固定版本原件→当前关联影响→完整变更审阅→可靠提交。沿用用户确认的紧凑协作工作台、现有主题/三语及唯一业务实体；直接迁移消费者，不保旧整包读取或影子需求。

## 已核证的问题与范围

上一阶段实际27Task/81flow review的隔离读取，当前头182931字节，history limit1仍读27Task与Workspace，change-preview累计57次/27唯一Task装载；精确版本已不依赖当前实体。证据 `.sop-runtime/delivery-evidence/bounded-progress/next-requirement-audit/REPORT.md`。当前消费者另确认：移除flow数组会丢产物/评审/旧发布三个tab；变更编辑器unknown仅存在ref，重载不一定恢复。这些都先写永久RED，不能用新DTO掩盖旧缺口。

本阶段保留创建/评审/拆解/任务计划/人工验收/发布的既有完整语义，补精确读取和可靠变更。全生命周期目标继续active；generic/reflection真实处理、其他数据库/生产接入和实际浏览器视觉仍单独跟踪。

## 信息层级和四种状态

1. 普通打开需求只读typed head：真实阶段/当前验收门禁、负责人与日期、任务计数、产物/评审/发布数量。正文与验收条件使用独立精确定义读取；编辑、Task映射及历史比较必须显式读取并核对basis/generation，未读不能猜成空条件。
2. 正文、相关任务、产物、评审、发布、历史仍在需求详情中可达。产物/评审/旧发布各用当前records页（20项），展开才读指定原项，保artifact.add、advance/reopen、release导航。review没有业务ID，使用同代原数组position，不能伪造稳定历史ID。CI evidence、activity和release candidate不替代原记录。
3. 版本目录仅metadata，固定seq水位；选中页外version独立取实际原定义。历史和当前影响分开：五类影响显示完整可读计数和受限计数，明确分类分页、精确归属和安全导航。当前实体404/索引503不阻止读取已保存版本；无法比较当前定义时明确不可用，不替换成当前内容或假空。
4. 变更先完整预览，展示单需求真实字段差异、完整影响计数、已有验收是否失效及明确预算。页面20项不是批准范围。complete/available/allowed都满足才准备原请求；unknown固定原body/version/key及preview依据、锁退出/竞争操作。编辑目标持久在路由 `requirement_edit=1`，恢复host独立挂载于current读失败之外；重载后仍恢复同项目/会话/target的原请求。只有明确拒绝后显式重读/重新预览。

每区分别处理loading/empty/error/denied，403/404清受限缓存和retained内容；late response、项目/reader/session ABA、scope/代次变化不得复活旧数据。所有路由保显式project和合法return_to。复用已有可靠命令控制器、精确ACK、session gates；不造第二状态机。窄屏记录/比较纵排，工具条换行，有明确标题、按钮文本和键盘焦点。实际浏览器/390px视觉未验证，既有浏览器协议及12ui安装/上传审批拒绝边界不重试或绕过；SSR/控制器测试不冒充视觉验收。

## 唯一合同与读取表面

前缀 `/api/v1/delivery`。全部使用现身份认证、显式项目及canonical权限。普通读取需要read；preview需要write并拒archived。当前读取的query_generation可在head/summary首次读取时省略；**definition、records页/position exact、impact items页/exact必须显式带正整数query_generation**。后端核前后代次、cursor与参数一致，不自动采用新代次。历史不依赖当前索引/代次。

| 路径 | 唯一响应 |
| --- | --- |
| GET /requirements/{id} | RequirementHeadResponse |
| GET /requirements/{id}/definition | RequirementDefinitionResponse |
| GET /requirements/{id}/history | RequirementHistoryPage，仅metadata |
| GET /requirements/{id}/history/{version_id} | RequirementVersionDetail，实际原件 |
| GET /requirements/{id}/records | RequirementRecordsPage，collection=artifacts/reviews/releases |
| GET /requirements/{id}/records/{position} | RequirementRecordDetail，同代原位置非负整数，0合法 |
| GET /requirements/{id}/impact | RequirementImpactSummary |
| GET /requirements/{id}/impact/items | RequirementImpactPage，kind五类 |
| GET /requirements/{id}/impact/items/{item_id} | RequirementImpactDetail，真实membership/ACL |
| POST /requirements/{id}/change-preview | RequirementChangePreview，原输入变化{}合法 |
| POST /commands，requirement.update | 原CommandAck、原basis与preview_basis门禁 |

普通页默认20/max100，cursor最长4000；Req/Task ID按既有64个Unicode codepoint，历史version与其他影响对象ID上限200个codepoint，C0/C1、首尾空白及路径分隔符`/`、`\`拒绝。资源ID必须是单一逻辑路径段，编码不能把它变成子路由。摘要文本最多256个codepoint，完整原文不暗中截断。history cursor绑定reader/tenant/project/requirement/limit/固定seq；records加collection/basis/generation/position；impact加kind/current ACL signature/稳定真实ID。source/reader/limit/ACL/generation混用明确拒绝。position强制同代，不把它当永久历史定位。

## 精确DTO


所有新DTO `extra=forbid`。UTC时间保留现ISO8601，业务civil date仍YYYY-MM-DD/null。原因统一 `{code:str,message:str}`。

`RequirementReadEnvelope`：`project_id:str, requirement_id:str, version:int, query_generation:int, as_of:str`。仅用于当前读；历史使用独立 `project_id,requirement_id,as_of`包络，不读取当前version/generation。

`RequirementGate`：`id:str, ok:bool`，来自现canonical `stage_gates`结果，不能从stage推测。

`RequirementRecordCounts`：`artifacts:int, reviews:int, releases:int`，非负SQL array_length；整个flow缺省沿现default_flow；显式null/坏shape不猜为0。

`RequirementFlowHead`：

```
stage: Stage
revision: int
owner_id: str
due_on: str | null
milestone_id: str
blocked_reason: str
closed: bool
legacy_completed: bool
gates: list[RequirementGate]
record_counts: RequirementRecordCounts
```

`RequirementHead`：

```
id: str
title: str
priority: P0|P1|P2|P3
status: str
sprint_id: str
basis: str                   # 保原requirement.basis命名；原定义hash
flow: RequirementFlowHead
tasks_total: int
tasks_done: int
tasks_recorded_done: int      # 当前QueryFact已实际使用的字段名
accepted: bool               # 同代canonical QueryFact结果
deployment_verified: bool    # 同代canonical部署门禁结果
```

`RequirementHeadResponse`：envelope + `requirement:RequirementHead`。不返回description/criteria/human_notes、reviews/artifacts/releases、完整影响或Task IDs。legacy_completed只是原记录状态，不能供accepted推导。业务上未关联sprint/owner/milestone沿既有空串规则。

`RequirementDefinitionResponse`：envelope + `requirement_basis:str, definition:RequirementDefinition`；Definition继续原 `{id,title,description,acceptance_criteria}`，真实nullable旧正文按现requirement_definition规范化。精确完整定义在SQL单项UTF8<=1MiB后才读取；无偷偷截断。basis在同一请求前后核代次。

`RequirementVersionMetadata`：`id,number,basis,at,actor:ActivityActor,source:delivery_command|sql_observed,flow_revision:int|null`。`RequirementHistoryPage`：`project_id,requirement_id,as_of,items:list[Metadata](<=100),limit,next_cursor,earlier_history_unknown:true`；不取definition/body，不需要重算current links。现精确 `RequirementVersionDetail`继续 `{project_id,requirement_id,item:RequirementVersion}`，其中item包含完整definition，单项SQL预算+shape检查；不补猜过去。

`RequirementRecordSummary`：`position:int,revision:int|null,kind:str|null,stage:str|null,title:str|null,result:str|null,decision:str|null,actor:str|null,at:str|null,stale:bool|null`。每字段只从原位置必要路径投影且限长；缺字段保null，不从comment/content猜标题或状态。不返回comment/content/snapshot等大正文。`RequirementRecordsPage`：envelope + `requirement_basis,collection,items,total,limit,next_cursor`。`RequirementRecordDetail`：envelope + `requirement_basis,collection,position,record:dict`；record为所选实际单原项，SQL字节<=1MiB再传输，保全部现业务字段。列表/exact保持原tab用途：manual artifacts不是CI evidence，review不是activity的近似替代，legacy release也不是候选发布真相。

`RequirementImpactKind`：`direct_task|dependent_task|execution|release_candidate|deployment`。

`RequirementImpactCounts`：`direct_task,dependent_task,execution,release_candidate,deployment,restricted_execution,restricted_deployment`均非负int；execution/deployment前者是当前可导航项数，后者是不返回原ID的受限计数。

`RequirementImpactSummary`：envelope + `requirement_basis,available:bool,complete:bool,counts:Counts|null,budget:RequirementReadBudget,reasons:list[Reason]`。普通summary不用全ID或semantic proof body；如果图不完整/预算不足，counts不能伪0且complete=false。这里没有invalidates标记（它依赖实际changes，属于preview）。

`RequirementImpactItem`：`id:str,kind:ImpactKind,title:str|null,status:str|null,target:ActivityTarget`；所有摘要限长。direct/dependent的target.kind均task，其他指向真实现业务对象；不复制Task/执行全文或runtime日志。`RequirementImpactPage`：envelope + `requirement_basis,kind,items,total,limit,next_cursor`；`RequirementImpactDetail`：envelope + `requirement_basis,kind,item`。exact先检查同代真实影响membership与当前ACL，再返回safe target；非成员/不存在404，权限沿现边界403或脱敏不可用，禁止通过输入字符串变成受信目标。

`RequirementReadBudget`：

```
max_tasks=10000
max_closure_tasks=10000
max_requirements=10000
max_records_per_collection=10000
max_bytes=16777216
max_item_bytes=1048576
max_dependency_depth=64
task_count:int|null
closure_task_count:int|null
requirement_count:int|null
execution_count:int|null
release_candidate_count:int|null
deployment_count:int|null
bytes_used:int|null
```

“records per collection”约束完整proof解码的必要关联原项；普通record目录页靠SQL count/page，不需要把其全部原项纳入proof。scope/闭包/字节预算明确同规则用于GET proof和锁内write，不能沿用quality默认500。初始预算值供正式设计锁定，不能靠partial counts/仅派生JSON bytes宣称完整。

`RequirementChangePreview`精确字段：

```
project_id, requirement_id, version, query_generation, as_of
requirement_basis: str
preview_basis: str | null
changes: list[FieldChange]    # 当前单需求完整真实before/after，原字段顺序
impact: {counts: RequirementImpactCounts | null,
         invalidates_current_acceptance: bool | null}
available: bool
complete: bool
allowed: bool
budget: RequirementReadBudget
reasons: list[Reason]
```

输入不改，允许{}，null/空条件/extra仍按现validator拒。合法空影响complete=true；预算/缺依赖/坏shape等响应完整性失败时 `preview_basis=null,allowed=false,complete=false`，不得批准partial；stale requirement_basis仍409。预览是write权限且拒archived，普通head/history/impact/records仍业务read。actual write预算不够413且零写，其余原409 reason保留。可识别不支持的SQL方言503，GET不修复或全包Python fallback。


## SQL与完整canonical证明

Task/Requirement/Workspace及固定RequirementVersion是原事实；复用schema5 QueryFact与canonical JSON关系投影，不增加可编辑业务表。head/records/definition只SQL投影必要列/小路径，版本目录不取definition，不用ORM先装完整Workspace后切片。Task.parent_id/Task窄列确定直接任务；canonical task_details依赖关系recursive CTE/UNION求反向传递闭包，循环必须终止，不能任意截断后称完整。全历史execution、全部candidate选中关联与全部关联deployment都纳入，不能套progress仅active-approved来源筛法。运行对象当前ACL复用真实runtime workspace访问规则；受限对象不返回ID/label，只计restricted，完整hidden ID仍入服务端hash。

必要完整输入预算固定：10000影响Task、10000必要闭包Task、10000必要Requirement、每关联集合10000条、依赖深度64、总16MiB、单项1MiB。预算和形状在SQL传输/解码前核实际canonical Task/Requirement/plan/flow/审查/执行/成员/release必要输入，不能只数派生小JSON；无用Issue正文及无关review正文不先装。读summary可SQL计数不解码全原件；显式preview才按完整必要集合解码、重验。 字节口径是SQL实际传输/解码的canonical JSON源UTF8（含JSON语法及存储ASCII转义），不是解码后字段文本或HTTP重新序列化大小；单条原项只量所选小路径，不以整个无关container替代。超过/坏shape/缺依赖/索引未就绪不能给partial basis或伪0，返回available=false/complete=false/allowed=false、preview_basis=null和原因；实际写同规则在Project锁下、全项目reconcile/capture/CAS副效应前拒绝（413）并零残留。合法空集合完整；stale requirement_basis与当前代次409。

原definition hash保持 `_fingerprint(requirement_snapshot)`，含id/title/description/criteria。preview保持原 `_fingerprint({project_id,requirement_basis,changes:differences,impact:semantic})`、默认separators/sort_keys/ensure_ascii=False/default=str；differences固定DEFINITION_FIELDS顺序，Task.id排序，req_id原nullable值、criteria/depends_on数组顺序保留。semantic精确含Task id/req_id/title/description/acceptance_criteria/owner_id/depends_on、目标flow stage/revision及全部影响IDs和原invalidates标志。空changes不使验收失效；generation只约束展示，不因无关heartbeat改变业务hash。

head accepted/deployment_verified/gates来自同代已验证canonical事实，不能由stage/closed推测。preview/write用必要闭包真实reconcile且证明确与完整gate语义一致。只允许同锁同事务复用已验证结果，当前事务overlay不得被旧QueryFact覆盖；外GET不能授权后续写入。真实修改仍revision前进、回intake、旧测试/人工验收/发布/旧执行失效，不能自动批准。metadata/no-op不伪增历史版本。

入口同时覆盖delivery命令、event_business sync的_guard/_record_basis、requirements_assistance apply-review和讨论采纳，保锁后身份重验、expected_version CAS、原key/body receipt及失败回滚。不允许在这些入口的full reconcile/CAS之后才预算而冒称前置有界。最后真实全项目Observation/查询投影的写成本保留并单独记录，不禁hook或写部分历史。SQLite SQL必须实证；其他未验证方言明确503，不全包Python fallback；不声称恒定磁盘I/O。

## 固定版本保护与验证

正常活动Session ORM/Core不能伪造、修改、删除RequirementVersion；只有实际definition capture窄能力可追加。归档项目先统一project_archived门禁，真实capture/身份失效路径保现规则。直接SQL定义变化按现hook仅记录实际观察新定义一次、rollback零残留，不补猜更早内容。GET不创建版本、不重建索引、不写业务或调用模型。

永久RED覆盖实际读取成本、关系闭包/ACL/所有历史、游标与代次、原件独立、数组position、真实阈值/坏shape、原hash差分、状态门禁/跨入口/回滚/幂等、unknown重载、403404/late/ABA及三语。稳定源完成Manager/Web/SDKCLI完整回归、类型/构建/Ruff、实际发布OpenAPI/wheel，并用生产socket/身份与编译生产TS控制器验证完整预览→写成功丢ACK→重构unknown→原件重放。独立审查已复现问题，保留原RED/GREEN，不以fixture错误代替产品缺陷。

scratch `.cache/bounded-requirements/`，证据 `.sop-runtime/delivery-evidence/bounded-requirements/`。全部阶段变更验证后本地commit `[T-bounded-requirements]`，不push；先盘点散列源/唯一产物，再只清精确本阶段目录，核提交字节与clean。整体goal不因本切片完成而结束。
