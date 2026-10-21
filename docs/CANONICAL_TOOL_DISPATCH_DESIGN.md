# T-canonical-tool-dispatch

正式外部工单复用真实 Task、团队资源、项目命令幂等/CAS、外部交付报告 S 与唯一人工 Review；不创建另一套 Task 或模拟 Core run。当前阶段仅源码实现及定义，应用、测试、类型、构建、浏览器与外部供应商验证全部后置。

## 冻结接口

公开 DTO 以 `apps/manager/sop_manager/routers/delivery_external_work_order_contract.py` 为唯一字段来源。

- `GET /api/v1/delivery/tasks/{T}/work-orders/current` → Current。含真实 Task basis/metadata-only ExecutionSnapshot、definition_digest、native_boundary_digest（闭合不可验证时 null）、formal executor选项及准入原因。未知状态禁止 fresh create。
- `POST /api/v1/delivery/tasks/{T}/work-order-preview`，严格 JSON `{task_basis,executor_member_id,instructions:""}` → Preview。只读，完整固定原件超限明确失败；不截断。返回 preview_basis、packet_digest、executor、complete/allowed/reasons。
- `GET /api/v1/delivery/work-orders?task_id=&state=&limit=20&cursor=` → Page。state为 queued/claimed/cancel_requested/reported/closed或空，limit 1..100；固定排序created_at/id，游标绑定过滤、用户、项目与当前版本/查询代次。
- `GET /api/v1/delivery/work-orders/{W}` → Detail。固定 definition/metadata 和当前 permissions；正文只在下一个接口中读取。
- `GET /api/v1/delivery/work-orders/{W}/packet` → PacketView。明确读取/导出完整固定原件，SHA-256核对，不执行任意endpoint。packet含schema、project_id、task_id、固定definition与digest、native_boundary_digest、executor、instructions、design_context固定版本全文、registered_unverified仓库链接；总UTF-8 JSON≤512KiB，三类设计各≤64KiB。缺失或损坏必须失败，不回退当前Doc head。

所有写入仅 `POST /api/v1/delivery/commands`，完整原件 `{action,expected_version,idempotency_key,payload}`。恢复必须原key、原版本和原payload；GET不确认ACK，不推断写失败后重建key。动作与payload：

```text
work_order.create  {task_id,task_basis,definition_digest,native_boundary_digest,executor_member_id,preview_basis,instructions:""}
work_order.claim   {id,order_revision}
work_order.progress{id,order_revision,percent:null|0..100,status:"running"|"blocked",message}
work_order.cancel  {id,order_revision,comment}
work_order.release {id,order_revision,stopped_attestation:true,comment}
work_order.report  {id,order_revision,submission_id,submission_digest,stopped_attestation:true}
```

ACK resource `{kind:"work_order",id:W}`；result精确为 `{work_order_id,task_ids:[T],request_digest,packet_digest,order_revision,state,submission_id:null|S}`；affected_refs含工单、真实Task及report时S，去重。对当前状态只能另发读取，不改写原ACK状态。

## 状态与权限

queued表示已受理且未领取。claim要求fresh项目write账号，绑定真实claim actor与时间；claimed不表示物理进程已被平台启动。progress为明确自报，未知percent必须null，不得默认50/100；禁止success/completed终态。claimed/cancel_requested的progress仅同claimant，取消请求后只可记录阻塞或执行停止。

新派发与新claim要求项目active；planning/paused不能新占有任务，已claim工作可在paused继续自报并明确停止/交付收敛。归档仍只读。

queued cancel可closed并保留never_claimed；claimed cancel仅cancel_requested，不宣称停止。release只能同claimant明确stopped_attestation，闭合来源标external_reported_stop；不冒充Core confirmed。无TTL自动重新派发或恢复native。stale是永久单向标记，不释放active slot；原件A→B→A不会复活。queued stale可取消，已claim原件需同claimant释放。

report仅链接已存在同Task/definition_digest/native_boundary_digest且提交actor等于claimant的固定S+digest；S必须当前有效。提交者在同一次动作明确工作已停止，closure保留external_reported_stop，不把产物报告本身当作停止证明。S已有报告和Issue回流原链保持；报告不是验收。report后显示reported，delivery_state单独投影awaiting_review/accepted/changes_requested/invalidated，不新增人工验收事实或默认passed。

永久source invalidation只扫描仍占用Task的active工单，完整metadata总量预检后再读，失效不释放占用。reported历史不参与每次业务写的全量扫描；其delivery_state由固定S及唯一Review的永久失效事实派生，row.invalidated专指尚占用时已记录的工单原件失效。仓库目录只是registered_unverified固定参考链接，不是所选checkout/ref；编辑目录不静默换packet，也不宣称已验证代码来源，本阶段不将这种目录编辑当Task重新采用。

formal executor只允许本项目唯一active team resource（agent/tool）；责任人仍是Task正式owner。创建和claim核owner/依赖/需求开放状态、所有native E/H/C正向闭合以及单Task唯一active slot。active工单反向阻止native计划/重启/审批、旧manual review、普通Task completed。S提交只为同claimant及固定definition/native边界放行，其余提交禁止抢占。

所有账号撤权即时生效。本阶段不新增disabled认证特例；归档前必须先取消queued或由同claimant释放claimed工单。撤权后工单继续占用，需要恢复同claimant授权后释放，不自动推断外部进程已停；归档预览/应用需明确阻止active工单。

## 旧入口与保全

旧a2a与agent-runs公开文件写入口全部410，避免假Task、自造50%进度、默认success和无租约evidence继续旁路。旧文件不删除；读取只作明确legacy reported/unverified诊断，禁止当作正式工作台健康/完成证据。正式工作台和SDK/CLI只使用上述工单入口，不直接执行外部endpoint。

## 实现顺序与验证定义

先固定合同及真实故障定义，再新增一张SQL工单表（不可变原件+受控技术字段、nullable active_task_id scoped唯一约束）；复用既有DeliveryEvent/Receipt为每一步持久幂等。服务重核项目和对象权限，所有SQL写受领域scope约束。实现bounded目录/明细/packet及S链接，补native/manual反向门和归档门，再替换旧UI交互。

真实定义覆盖：虚构/跨项目Task拒绝、formal executor、未领取不运行、固定设计/原key恢复、claim竞争与actor绑定、source永久失效、unknown进度、无权限写入、active native互斥、S actor/Task/definition/native错配、reported与人工验收分开、同Issue需求回流、归档/撤权保留占用、旧写入410。所有定义本阶段不运行；AST或源码审查不等于运行通过。
