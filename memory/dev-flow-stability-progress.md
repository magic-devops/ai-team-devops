# 研发全流程入口稳定性修复

- 任务：T-dev-flow-stability；用户截图中的 `Task project scope does not exist`。
- 状态：本阶段修复与定向验证完成；对应提交使用 `[T-dev-flow-stability]` 标记，提交标识见 Git 历史及证据目录中的回执。
- 源码基线：`16a64f16fdfed4f6358731c763f1facc7f7d27f2`。并行的 T-reflection-intake 仍未完成，不能作为本次通过结论。
- 截图样式与 `public/console.html` 的 `LoadError` 一致；该页 `public/pages/dev_flow.js` 调用 `/api/v1/dev-flow/summary`。当前 React 正式 `#/dev-flow` 调用 `/api/v1/delivery/context`，必须区分两条入口。
- 已发现触发链：dev-flow 缺少统一业务项目依赖，且不在禁止读取时自动初始化项目的前缀集合中。single 模式下，中间件可能 `ensure_project` 后仅 flush，关闭 session 时回滚项目；下游 tasks 读取使用另一个 session，找不到已绑定项目，抛出截图错误。空 task 查询也会建立 TeamContext，因此没有任务也能触发。
- 目标：旧研发页面直接进入正式全流程工作台；dev-flow API 必须校验有效身份、明确项目及实际项目权限，读取不得创建项目；有效空项目正常返回真实零计数。
- 永久回归：`apps/manager/tests/test_dev_flow_scope.py`、`apps/manager-web/src/lib/devFlowEntry.test.ts`。
- 证据目录：`.sop-runtime/delivery-evidence/dev-flow-stability/`。
- 独立基线快照与导入来源审计：`.sop-runtime/delivery-evidence/reflection-intake/dev-flow-stability/`；以 Git 基线导出的独立源码检查本次补丁，避免依赖尚未验证的 reflection 修改。
- 2026-10-20 03:45 UTC 实际首轮：隔离基线 4 个 Manager 用例中 3 个业务失败、1 个空项目/零写用例通过；前端真实入口 1 个业务失败。均自然退出、源码未变，独立模块导入来源核验通过。
- Manager 精确复现失效项目和缺失项目返回截图同文 422，且发生 `ensure_project` 调用；还确认匿名请求错误地返回 200。前端确认旧入口会直接发出两项项目请求。
- 已实现：dev-flow 统一身份/项目读写校验，禁止读取时初始化项目；旧研发页直接进入正式工作台，并更新其脚本版本防止缓存继续使用旧内容；同步更正文档入口。
- 首轮证据：`reflection-intake/dev-flow-stability/dfr1/` 与 `dev-flow-stability/dfw1/`（相对于 `.sop-runtime/delivery-evidence/`）。四个已记录进程 PID 均已精确核验消失。
- 修复后实际验证（2026-10-20 04:04–04:05 UTC）：隔离基线 13 项全部通过，当前工作区同 13 项全部通过，前端两个文件 6 项全部通过，三个 Python 文件代码检查通过。两份后端导入来源正确，全部检查期间源码稳定。
- 证据：`reflection-intake/dev-flow-stability/dfg1/`、`reflection-intake/dev-flow-stability/dfg2/`、`dev-flow-stability/dfwg1/`、`dev-flow-stability/dfl2/`。原始失败、首次代码检查失败均保留，未覆盖成成功记录。
- 代码检查仅自动整理 import；无非 import AST 改动。另手动移除未使用 import，并按项目惯例显式复用测试 fixture。保留首轮测试原文，所有业务测试函数 AST 未变。
- 正式工作台的项目加载错误页补上“管理项目”入口，原有重试、历史查看与未知结果恢复保护保留；旧脚本已更新版本避免继续命中旧缓存。
- 所有已记录检查进程自然退出，已精确核验消失；当前无本任务在途测试/构建/服务进程。
- 用户截图未包含 URL，已请求补充以确认实际部署入口；不得声称已验证用户当前运行实例。

## 验证范围

已验证明确项目、有效空项目、匿名身份、跨租户/项目隔离、只读账号派发拒绝与空项目 GET 零 SQL 写；执行真实旧入口脚本验证导航到正式工作台，并回归失败页的历史恢复与当前正文隔离。

本阶段没有执行全库测试、完整前端构建、实际浏览器像素/主题检查或切换用户正在运行的服务。T-reflection-intake 及其他全链路增强仍在进行，其未验证修改不属于本次故障修复的通过结论。后续同类问题调查单独记录，静态候选不能视为已确认漏洞。
