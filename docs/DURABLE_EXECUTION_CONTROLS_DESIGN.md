# 耐久执行控制与启动投递

阶段`T-durable-execution-controls`；基点`87b7ab47ef51a70690166e8174c03895db628bf8`。目标覆盖启动、重试、取消、批准/拒绝，以及受阻原件的明确结束；同时修补本地响应回调丢失与远端自治领取的边界。正式Project/Task/E/Core Run继续是业务与运行权威，控制原件C和启动票据不是另一套任务系统。

## 受理与实际效果分开

原四个`execution.start/retry/cancel/approval`继续走固定预览、完整正文、原项目版本和幂等键。同一Manager SQL事务只接受不可变C、事件及原Manager回执；不在未提交的受理事务内控制Core。ACK的resource仍为同E，result精确为`{control_operation_id, request_digest}`。`applied_version`证明受理版本，不代表进程已开始或已停止。

完整原件固定协议、租户、业务、工作区、原请求者、C/P/E/任务、原动作/正文/版本/键、受理版本、运行信封/定义、较早控制、可选H或关闭目标。原key回放只返回同C、同摘要、原受理版本；项目后续版本推进不影响已经保存的原回执。普通SQL不能改写原件或跳过技术状态机。C的revision/fence/租约/attempt只描述处理，不能改变业务请求。

## Core原子终态与关闭

复用Core已有收据表，用私有`manager.control:<C>`身份保存完整终态结果。apply和close串行同一个全局C身份和原件摘要。apply先回放已有终态，真正新效果才检查当前执行/审批权限。close若取得未发生效果的终态，写入`closed_no_effect`，迟到apply永远不能再产生效果；缺少收据、租约到期或后来的403本身均不是未发生证明。

一次Core事务包括真实run/approval变更、标准效果收据、完整C结果及需要的启动票据。审批拒绝的决定与run失败原子提交，不留下决定已拒绝、运行仍等待的半份结果。完整结果固定当时真实run/approval/resume及来源，回放不拼接当前状态冒充原效果。

待派发取消须在同一Core事务关闭原H并记录C结果。受理cancel C会在Project锁内阻止H产生新计划；既有Core事实仍可纯读恢复。若原空run预览之后计划先成立，返回真实计划并要求新预览，不自动更换原run，也不回执为not_started。

## 停止与优先级

运行取消的明确语义是停止固定R/attempt，正常节点推进或心跳不改变目标。Core锁内核对相同R/attempt、原managed source与定义，再使用当前技术版本CAS并捕获当下owner/node生成停止请求；原正文和摘要保持不变。重试导致attempt改变时必须重新确认，不停止新attempt。启动、重试和审批继续保持原固定版本/依据条件。

若固定运行已经completed/failed/cancelled，保存其真实终态观察与原控制收据，使用`run_terminal`结果映射`needs_review`；不改写原Run状态或停止凭证，也不把已完成执行伪称为本次取消成功。

同E一般仅有一个活动控制；新的明确cancel可以优先于已受理的start/retry/approve。受理时固定被优先结束的较早C集合，不在worker中临时猜“最新”。Core同事务封闭较早控制原件、撤销未领取启动资格，再处理精确停止。已经领取的物理效果不能撤销，必须查看requested/unknown/confirmed的真实停止证据。

新增`execution.control.close`也先接受为耐久控制K，正文固定`id:E, control_operation_id:C, request_digest, reason`。它只指向非close原件，禁止递归结束close自身。后台取得目标的Core关闭终态；若目标已经applied，返回真实事实并提示操作实际运行，不把它称为撤销成功，也不伪造旧命令ACK。当前项目write、runtime read以及原件本人或项目审批权限控制该入口。

## 启动票据和领取

启动型效果原子生成LaunchTicket，固定C/P/E/W/R、attempt、resume批准节点及版本、定义和activation身份。新activation撤销旧未领取票据；同attempt不同审批检查点不能共用模糊的“已启动”标记。票据不通过通用资源API编辑，run内部activation字段也不能由公开PATCH伪造。

本地执行和远端领取走同一票据验证。首次run.claimed与票据领取在同一Core事务提交；重复投递不能产生第二个owner。远端每个节点后的合法继续领取仍核同一activation及该节点的assignment，不因首节点已领取而封死整个运行。已领取后失联只走现有租约、未知停止及人工审查，不自动重跑同attempt。

Manager从耐久C恢复有界本地投递，不以添加内存任务为投递完成。物理领取前，Core在任何Core事务/锁之前进入Manager的`managed_launch_authority`上下文：重新读原C、当前原用户、Project、任务/依赖及真实权限，持SQL Project锁，随后仅在短Core领取事务内授权；退出即释放，不包裹长执行。local/remote共用回调，缺失回调不能启动managed运行；独立工作区保持原能力。该顺序保留SQL→Core，避免引入Core→SQL锁反序。

领取只是owner建立，不能叫进程已经启动。节点启动、输出、测试、代码证据和人工验收继续读取各自真实事实。响应后BackgroundTasks不再承担新C的持久投递责任。

## 当前版本投影、查询与交互

先提交领取，再按同一完整C处理；到期扫描、退避和错误均有界且单项隔离。已有Core事实按当前Manager版本和C fence作窄技术投影，原用户撤权或项目归档不阻止记录既有事实，也不授予新执行权。不能改Task完成、flow验收或需求定义，不能把新运行观察降回旧效果快照。

C公开状态为accepted/applying/retry_wait/blocked/awaiting_executor/applied/closed，effect outcome为applied/closed/needs_review，launch另为ready/claimed/revoked。精确详情及E分页列表使用当前账号/项目/运行工作区权限，默认20、上限100，签名游标固定受理时间上界。公开列不取完整原件或Core大结果。

界面仍用唯一执行操作原件槽。HTTP回执未知时保留原正文/键/版本和恢复宿主；收到真实受理ACK后清理该槽并释放导航，转为后台状态读取。C/runtime读取不能代替原ACK。后台等待与受阻不锁整个页面；新的取消仍需明确预览和确认。受阻原件可进入带理由的结束确认，目标已处理时转向实际运行。技术身份和请求明细折叠，状态、原因和下一步保持可见。

## 合同与验证

Core入口为`ManagedControls.apply/probe/close(principal,W,request=...)`，纯`managed_control_digest`及`control_definition_hash`。固定request使用`manager.execution-control.v1`，完整JSON独立限制4MiB，内嵌H仍执行原1MiB限制；较早原件最多8个，不允许递归prior或close目标。Core结果字段由实现API证据固定，UI不下载私有原件来重算摘要。

公共GET为`/executions/{E}/control-operations`及`/executions/{E}/control-operations/{C}`。SDK/CLI同步增加单页读取。写命令仍用通用版本/键合同，新增close payload和受理result同步维护OpenAPI源码、严格ACK校验及实际消费者定义。

通用`/commands`的OpenAPI操作通过显式`x-delivery-command-contracts`扩展发布五个动作的payload/result合同；合同直接取相应Pydantic模型schema，保留close四字段、extra禁止、摘要约束及accepted result两字段，不把其它业务命令的通用result改成控制受理结果。实际OpenAPI消费者定义检查扩展内容，仍须在恢复窗口中运行确认。

本阶段继续遵从用户要求，运行测试、收集、应用导入、Node/类型/构建、浏览器和服务等待资源/共享验证窗口；可执行源码文本、标准库AST/JSON/摘要及Git阶段核对。既有旧协议无Manager ACK的未知原件不能自动转换为新C成功，需独立授权对账。完整全流程目标、其它部署边界和全局Core并发锁图仍保留，源码阶段不等于生产或全目标验收。
