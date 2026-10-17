# 质量证据与发布候选实施计划

> **For agentic workers:** native execution with isolated parallel ownership; root integrates and conducts one independent incremental review.

**Goal:** 当前质量、真实CI签名、固定commit/制品和发布评审形成可操作链路，不以手工登记充当部署。
**Architecture:** 复用Workspace JSON/CAS/Receipt/Event、Project共享锁；三个独立领域单元：CI签名、质量/候选、工作台交互。
**Tech Stack:** FastAPI / SQLAlchemy / React / TypeScript / cryptography Ed25519；无新schema。
**Spec:** `docs/DELIVERY_RELEASE_DESIGN.md`。

## Global Constraints

- 四界面、完整scope、严格签名协议、固定版本/依据/幂等、三语390px按spec。
- 原人工release.save退役，历史只读；审批不等于部署，旧operations不能直接计已验证发布。
- 文件/SQL归档保护及身份受限capture保持；root统一依赖、服务、全量、浏览器和git。
- scratch `.cache/delivery-release/`，交付 `.sop-runtime/delivery-evidence/delivery-release/`。

## Review Focus

- 同一已签字节解析、UTF8 PAE、Base64两种编码、重复JSON和同序异内容。
- 范围内失败/遗漏任务/跨scope，单纯登记完成或旧手工记录不能成为发布证据。
- policy/身份/定义A→B→A不复活；共享锁内重新鉴权、CAS/replay一致。
- 候选固定内容和review_basis，未知ID/网络结果未知/409不能切首项或丢草稿。
- 新CI失败、Key撤销、归档历史读取、当前质量和历史快照清楚区分。

## Task 1：CI协议与实际生产者（CI owner）

Files: 新 `apps/manager/sop_manager/routers/delivery_ci.py`、`delivery_ci_contract.py`、`apps/manager/tests/test_delivery_ci.py`，`scripts/delivery-ci-attest.py` 和专属script测试。
Interfaces: `verify_envelope(envelope,policy,*,tenant_id,project_id,scope_basis,now=None)->dict`（返回已验签statement、key_id、envelope_digest、passed）；`policy_value(body,generation)->dict`；`pae(payload_type,payload_bytes)->bytes`；DTO不依赖delivery_contract避免循环。
- [x] RED：协议、真实性、严格输入、完整作用域/计数，实际脚本构建测试/dirty/旧制品/变更/失败。
- [x] 实现标准验签和脚本，私钥不进入API/输出；脚本可在安装Manager后运行。
- [x] 定向GREEN及标准边界说明，冻结源；不安装/服务/完整suite/git。

## Task 2：质量与候选领域（backend owner）

Files: 新 `delivery_release.py`、`delivery_release_contract.py`、专属 `test_delivery_release*.py`；根持有其他接线文件。
Interfaces: `quality(db,project,data,*,requirement_ids=None,task_ids=None)->dict`；`release_index(db,project,data,user,*,version)->dict`；`release_detail(db,project,data,user,id,*,version)->dict`；`preview(db,project,data,user,body,*,version)->dict`；`apply_release(db,project,user,data,action,body)->tuple`；`reconcile_releases(db,project,data)->None`（在拷贝视图或事务state内永久标记失效）。
- [x] RED：完整scope、独立任务、纯读、签名导入序号、重复/篡改、固定预览/评审、失效、权限和旧记录边界。
- [x] 实现quality、policy/CI/candidate动作、只读投影、不可变快照；目录权限不从角色名推断额外执行授权。
- [x] 定向GREEN；协调CI owner接口，不编辑root/UI所有文件。

## Task 3：四界面（UI owner）

Files: 新release API/helpers/i18n/components/tests/CSS；必要DeliveryWorkbench/lib/delivery.ts集成，根不改这些。
- [x] RED：范围显式、四态来源、固定预览/CAS/key、成功才关闭、未知ID/退场/跨项目、三语。
- [x] 按spec四界面与真实typedAPI；移除旧releaseEditor，旧记录仅历史，实际部署明确未交接。
- [x] 专属GREEN/类型检查，root实际GUI；不服务/完整suite/git。

## Task 4：契约接线与证明（root）

Files: delivery.py/contract/service/verification/progress_facts/hooks/project_write_guard必要接线；Manager运行依赖/锁、SDK/CLI/OpenAPI、设计/记忆。
- [x] RED：HTTP权限/旧入口退出/归档/CAS/角色撤销与受限capture；released指标不得由旧手工operations产生。
- [x] 接线、生命周期/身份失效、严格DTO与可审计Event结果；移除旧ReleaseSave。
- [x] 安装明确必要运行依赖并验证锁；实际producer→公开HTTP→预览/评审、浏览器桌面表单与固定预览；完整Manager/Web、SDK/CLI、类型构建。四界面的组件回归通过，390px实际视觉另行复核。
- [x] 唯一独立增量审查定点修复；记录已实现与剩余、源/证据散列、安全清理scratch、全部阶段commit验证clean，不push。

## 视觉复核待办

- [ ] 本阶段390px中文/英文/日文与最终候选详情的实际浏览器视觉复核。访问既有标签时浏览器协议策略拒绝，未绕过；桌面已采集表单与固定预览截图，审批最终结果另以业务API核验，不冒称GUI完成。功能实现与回归可阶段提交，完整交付目标继续active。
