# 受控部署与运维交接实施计划

> **For agentic workers:** native execution with isolated parallel ownership; root integrates and conducts one independent incremental review.

**Goal:** 已批准候选通过现有执行底座实际部署、独立健康观察、灰度晋级/明确回滚并回流真实Issue。
**Architecture:** Manager环境和不可变意图、Hermes受控run与设备、runner副作用journal；复用CAS/receipt/事件/目标/outbox，不造业务Task。
**Tech Stack:** FastAPI/SQLAlchemy/React/TypeScript/现有Hermes Python及agentd，无新依赖/schema。
**Spec:** `docs/DELIVERY_DEPLOYMENT_DESIGN.md`，含精确接口与DTO。

## Global Constraints

- 当前项目主体和紧凑四界面；旧手工success/JSON流量退出可信路径，无兼容桥。
- 项目approve和runtime execute独立重验，原操作人/target/workspace/环境代次/候选/基线固定，同环境单在途部署。
- unknown禁止重跑apply，journal副作用前持久化；只读observe和新明确回滚用于恢复，没有人工mark verified。
- scratch .cache/delivery-deployment；证据 .sop-runtime/delivery-evidence/delivery-deployment；root统一服务/全量/安装/Git。

## Review Focus

- 同key异内容、不同操作人并发、跨库commit缝隙原receipt恢复。
- 进程中断/租约失效/丢结果、迟到结果、通用retry/replay/PATCH旁路和只读observe。
- URL来源/redirect/TLS/大小/摘要/链接路径，非法JSON/NaN/bool-as-int，旧时间/假比例/缺样本probe。
- 候选/环境/target/身份变化，归档暂停，固定物理历史与当前业务有效性、无递归。
- 灰度不能计verified，rollback须真实稳定基线，Issue唯一且不自动关闭，UI固定basis/key/409和定位退场。

## Task 1：Runtime与实际runner（runtime owner）

Files: 新packages/hermes-core/hermes_core/deployment_contract.py、deployment_runner.py、deployments.py；必要api.py managed guard；专属tests/test_deployment_*.py。
Interfaces: spec精确接口，不依赖Manager。
- [x] RED：实际TLSartifact/子进程/探针观察、重复不执行、中断unknown/observe、managed run权限/receipt/guard。
- [x] strict协议、runner/journal、独立run派发/开始/取消和通用旁路拒绝，不造Task。
- [x] 专属GREEN/ruff，冻结源并提供边界；不安装/服务/全量/Git。

## Task 2：Manager领域与契约（Manager owner）

Files: 新apps/manager/sop_manager/routers/delivery_deployment_contract.py、delivery_deployment.py、必要runtime拆分、专属tests/test_delivery_deployment*.py。不改root接线。
Interfaces: spec函数/actions/DTO及runtime公共服务。
- [x] RED：完整scope/环境/权限/并发基线、固定意图/灰度/rollback、receipt恢复、unknown/Issue唯一及纯读。
- [x] 先冻结DTO通知UI；环境/预览/意图/动作/投影，当前有效部署pure helper与归档活动意图查询。
- [x] 专属GREEN/ruff，协调runtime，不服务/全量/Git。

## Task 3：四界面（UI owner）

Files: 新deployment API/helper/i18n/组件/tests/CSS，必要ReleaseWorkbench/Detail/route/i18n.ts UI集成。
- [x] RED：显式环境、固定预览/CAS/key、成功才关闭/冲突保留、unknown查询、权限、深链/退场/三语。
- [x] 按冻结DTO实现四界面及真实API，缺环境不假成功，运行/健康/物理历史与有效性分开。
- [x] 专属GREEN/typecheck；实机GUI不足明确留档；不绕过browser/12ui拒绝，不服务/全量/Git。

## Task 4：接线、旧入口退出和证明（root）

Files: delivery.py/contract/service/sync/progress/release/lifecycle/guard；SDK/CLI/OpenAPI；旧SystemOps/OpsCenter假成功入口及UI退出（协调UI owner），文档/记忆。
- [x] RED：公开HTTP、锁/CAS/权限、stage/released/current有效性、归档在途、后台只观测不启动。
- [x] 接线和权威gate/指标，旧假成功不能作为执行入口。
- [x] 实际HTTPS制品→本机/remote执行→probe→灰度→失败→rollback→Issue/需求；未知恢复、完整Manager/Web/Hermes/SDKCLI/类型构建/契约lint。
- [x] 唯一独立增量审查定点修复；视觉不足如实保留，记忆/源证据散列/安全清理、阶段全部commit验证clean，不push。完整目标active。

## 最终验证及明确待办

Manager最终1265通过；Web完整470项/92文件、类型及生产构建通过，最终三语增量另9项通过。Core完整222通过/5 Windows跳过在最终P2修复前，修复后部署专项46通过/1跳过，未冒称重跑完整Core。独立审查2项修复，原6复现通过。真实HTTPS+本机agentd+配对worker完成25→100、失败回滚、终止实际runner后unknown→observe且apply只一次、问题转需求；41旧路由退出。详本阶段validation-proof.json，计数有重叠。

- [ ] 本阶段390px中英日及最终部署详情实机视觉复核；先前协议策略阻止，未绕过，不以测试冒称完成。
- [ ] 实际生产身份/环境、智能问题处理提案、节点内部日志与干预、长期规模和剩余全链路增强；完整goal保持active。
