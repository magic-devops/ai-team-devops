# 问题诊断与需求回流实施计划

> **For agentic workers:** native subagent-driven execution with isolated ownership; one final independent incremental review by root.

**Goal:** 固定真实问题证据生成可核对诊断，人工明确采用到唯一需求，继承已有任务交付链路。
**Architecture:** SQL Issue唯一业务源、新IssueDiagnosis支持receipt；来源由执行/部署记录反查。Provider无业务锁，采纳走Delivery CAS/Receipt/Event及原issue.promote。
**Tech Stack:** 既有FastAPI/SQLAlchemy/React/AntD/模型网关，无新依赖，只有新增支持表。
**Spec:** docs/DELIVERY_ISSUE_DIAGNOSIS_DESIGN.md（精确DTO/API/权限/上限）。

## Global Constraints

- 不把Issue ID塞进requirement_id，不造第二个Issue/Task/workflow事实；不自动执行建议/关闭问题。
- Project→Workspace锁、真实账号和原selected runtime授权；provider前receipt提交，未知不自动重发。
- Source/JSON/secret filtering/引用严格，原结果与当前可采纳性分开；无历史basis补签/兼容别名。
- scratch .cache/delivery-issue-diagnosis；证据 .sop-runtime/delivery-evidence/delivery-issue-diagnosis；root统一服务/全量/Git。

## Review Focus

- 缺失/受限/多来源，来源文字伪造、日志秘密值和用户选择边界。
- 模型费前durable receipt、同key异内容、并发采纳、provider返回时权限/Issue变化。
- generating/中断/取消/迟到输出，读取不复跑或写入。
- 当前账号/项目/工作区权限，历史访问不泄漏，归档在途阻塞。
- UI异步身份、原body/key、409显式采用、unknown锁、退出动画和精确返回。

## Task 1：来源事实与脱敏（evidence owner）
Files：delivery_issue_evidence.py、专属tests/test_delivery_issue_evidence.py。
- [x] RED：执行/部署反向关联、真实结果/不可见/缺失、脱敏/截断、稳定basis/真实变化。
- [x] 实现spec issue_snapshot/assert_evidence_access，冻结接口通知backend，不改root/DTO/SQL。
- [x] 专属GREEN/lint，源和证据hash。

## Task 2：生成与人工回流（backend owner）
Files：delivery_issue_contract.py、delivery_issue_diagnosis.py/必要generation拆分、sql_models.py新增IssueDiagnosis、专属tests。
- [x] 先冻结DTO通知UI/evidence；RED覆盖receipt/provider/strict输出/权限/变更/取消/唯一采纳。
- [x] 实现spec函数和新增表，不调用root接线或新工作流。
- [x] 专属GREEN/lint/SQLite与PostgreSQL DDL，不全量/服务/安装/Git。

## Task 3：问题四界面（UI owner）
Files：deliveryIssue.ts/helper/routes/tests、delivery-issue.ts、DeliveryIssueWorkbench/Detail/Diagnosis/Review及局部CSS。
- [x] RED实际回调：显式证据/AI规则、固定key/basis、409编辑保留、unknown、scope/session和退场。
- [x] 按冻结DTO实现四界面，来源事实与提案、需求、修复验收分开；精确返回和三语。
- [x] 专属GREEN/tsc，提供组件接线props；不改DeliveryWorkbench/delivery.ts/i18n.ts，不full/服务/浏览器/安装/Git。

## Task 4：集成和证据（root）
Files：delivery.py/contract、project_lifecycle/portfolio、DeliveryWorkbench/delivery.ts/i18n.ts、SDKCLI/OpenAPI、文档/记忆。
- [x] 路由/commands/归档在途、精确问题链接，保留真实权限和纯读。
- [x] 公开HTTP规则+真实本地gateway provider→人工改稿→唯一需求→原tasks.plan，未知/失败/作用域/纯读及实际视觉许可边界。
- [x] 完整Manager/Web、相关SDKCLI/类型/构建/契约lint；唯一独立增量审查定点修复。
- [x] 更新状态及清单、源/证据hash/安全清理，阶段全部commit并验证clean，不push；完整goal保持active。

最终核验见 `.sop-runtime/delivery-evidence/delivery-issue-diagnosis/validation.json`；实机视觉和完整目标仍待继续，最终提交/清理由独立receipt记录。
