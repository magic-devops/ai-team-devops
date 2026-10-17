# 项目组合与生命周期实施计划

> **For agentic workers:** native execution with isolated parallel ownership; root integrates and conducts one independent incremental review.

**Goal:** 项目组合展示可行动的有效交付事实，归档/恢复具备全业务边界与并发保护。
**Architecture:** Project.status唯一源，复用DeliveryWorkspace CAS及Receipt/Event；共同Project锁和受限内部失效权限。
**Tech Stack:** FastAPI / SQLAlchemy / React / TypeScript，现有主题与组件，无新schema。
**Spec:** `docs/PROJECT_PORTFOLIO_LIFECYCLE_DESIGN.md`。

## Global Constraints

- 四态/交接矩阵、精确输入与事实按spec；不按登记completed或截断风险计算成功。
- SQL 边界只执行 typed 读写；conflict/upsert、INSERT SELECT 明确拒绝。合法有界 Core executemany 和普通非身份字段表达式须保留，领域校验继续独立生效。
- 锁序Project→Workspace；GET/preview纯读；全局身份治理永久失效不被归档抑制。
- `.cache/project-portfolio/` scratch、`.sop-runtime/delivery-evidence/project-portfolio/`交付；重要文件散列保留后清理。
- root统一服务、完整测试、浏览器、提交；代理不git/服务/完整suite。

## Review Focus

- 归档与新queue/普通写并发必须共享锁，不得跨Projectscope幻影漏锁。
- 狭窄身份capture不能放行业务数据变更，也不能阻全局User停用/删除。
- 归档快照是历史，当前有效验收不能复活或被历史数覆盖。
- 组合分页/风险筛选后计数来自完整匹配范围，查看不改变全局项目。
- 恢复/配置草稿和网络未知重试维持原basis/key，不静默采用新事实。

## Task 1: 写入守卫（runtime owner）

Files: 新project_write_guard.py、专属tests；business_access.py、progress_hooks.py、必要纯GET初始化函数。root持有sql_models安装/ManagerSession接线。
Produces: lock_project_scopes(db,scopes)；require_project_operation(db,tenant_id,project_id,operation='write'|'dispatch')；lifecycle_scope(db,tenant_id,project_id)；identity_capture_scope(db,tenant_id,project_id)；install_project_write_guard()；ManagerSession。
- [x] RED：ORM/Core/bound/batch归档拒绝、作用域不可变、非法SQL、legacybulk拒绝、User级联、可信capture字段越界、Project/父级delete拒绝、普通GET不写。
- [x] 实现共享锁和最小权限scope、HTTP文件写门禁及已确认GET初始化纯读。
- [x] 专属GREEN，实际能力/PG边界报告。

## Task 2: 生命周期与组合事实（backend owner）

Files: 新project_lifecycle.py、project_portfolio.py、专属tests；delivery_resources/service/execution/observations/progress_capture/sync必要集成。根不改这些源。
Interfaces: project_lifecycle.preview(db,project,user,data,body,*,version)；apply_lifecycle(db,project,user,data,body)→(id,before,result)；project_portfolio.portfolio(db,user,*,q,business_id,status,risk,cursor,limit)；project_detail(db,user,project_id)；shared project_facts(db,project,data=None,*,as_of=None)。
- [x] RED：纯预览、完整未关闭意图、ABA/CAS/replay、暂停receipt收尾、归档/queue竞争、身份恢复不复活、metadata同租户、超过12风险/分页统计/精确targets。
- [x] 实现既有CAS内lifecycle与provenance/result，实时事实复用ProgressMetrics，先facts后分页；metadata唯一命令与派发矩阵。
- [x] 对接Task1，相关GREEN，不宣称外部Core撤权。

## Task 3: 四界面（UI owner）

Files: 现Projects/PortfolioModule/Inspector/Hub/Hero/ProjectSelector及新projectPortfolio helpers、生命周期面板、三语样式；DeliveryWorkbench上下文门禁/归档提示/返回与里程碑精确定位。
- [x] RED：查看/进入分离、无效ID不首选、create成功才关且不切scope、固定preview冲突/原key重试、风险返回、scope隔离。
- [x] 完整四界面与三语、390px、键盘、失败/受限状态。
- [x] 专属GREEN，根实际浏览器核验。

## Task 4: 契约接线与验证（root）

Files: 新project_lifecycle_contract.py/project_portfolio_contract.py；delivery_contract/delivery.py/tenants.py/sql_models.py接线；SDK/CLI/OpenAPI、glossary/记忆。
- [x] RED：strict DTO、权限、metadata旧入口移除、read模型与命令scope。
- [x] 实现契约、路由与ManagerSession安装；移除Project PATCH/DELETE，所有调用转固定版本命令。
- [x] 实际HTTP/竞争/纯读取、浏览器四界面、完整Manager/Web、类型构建、相关客户端验证。
- [x] 一次独立增量审查，定点修复复验；更新清单、散列证据、清理scratch，全部阶段commit验证clean。

阶段验证与提交凭据：`.sop-runtime/delivery-evidence/project-portfolio/validation-proof.json`、`commit-receipt.json`。PostgreSQL锁语义由实现/编译与定向契约覆盖，未运行实际PostgreSQL并发环境；实际竞争使用SQLite独立连接。
