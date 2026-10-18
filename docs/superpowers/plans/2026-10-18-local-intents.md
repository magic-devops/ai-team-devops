# 本地规范意图实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development to implement task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 让所有剩余实体、规则与文件发现生产入口形成明确原版本的规范意图，退出自动另造草稿和旧JSONL发送设计。

**Architecture:** 继续使用共享SQLite outbox和原Manager处理链；只扩展规范sync动作及原basis。watch生成审查快照，明确enqueue-plan冻结后入队；规则仅本地应用与明确推送。

**Tech Stack:** 现有Python SDK/CLI/FastAPI/SQLite，不新增依赖或服务；原Go发送器消费同一opaque冻结事件。

**Spec:** docs/LOCAL_INTENTS_DESIGN.md

## Global Constraints

- 不换原ID/键/时间/版本，不以网络错误推导未提交，不把local overlay当真实业务。
- 需求变更预览、任务basis/状态/发布/验收门禁继续生效；输入不支持时明确拒绝。
- scratch仅.cache/local-intents，证据.sop-runtime/delivery-evidence/local-intents；重要源/唯一证据先保存散列，再清理，不遍历链接。
- 不重试历史浏览器或12ui安装/上传拒绝；阶段完整验证后全部本地commit，不push。

## Review Focus

- 403/409/超时/已提交丢响应不能另造本地业务ID。
- 连续稀疏patch不从旧缓存恢复已删除或尚未送达字段。
- 目标存在性与任务/需求原basis必须同业务事务校验，失败保留原文。
- 模板同名、CRLF、symlink/junction改向与显式absent不可混为未知摘要。
- 同计划重试、部分已入队及规则重复应用不重复效果，旧原件保持可盘点。

### Task 1: Manager规范动作与来源

Files: delivery_contract.py、event_business.py、event_processing.py、event_assets.py、delivery_activity.py、agents.py及专属测试。

- [x] 原症状RED及create已存在/update缺失/需求preview/Taskbasis/资产basis真实事务测试。
- [x] 扩展SyncRecordApply动作/basis，复用原门禁并验证无重复/无验收旁路。
- [x] 资产原摘要严格计划、固定操作恢复；活动真实目标与规范onboarding命令。
- [x] 有限相关回归、契约说明与源码冻结收据。

### Task 2: 四实体CLI写入收敛

Files: commands/requirement.py、task.py、issue.py、sprint.py及专属测试。

Consumes: sop_cli.local_intents.submit_record(config, module, record, *, action, expected_version, key, event_time, local, task_basis=None, requirement_basis=None, change_preview_basis=None) -> dict。

- [x] 用真实SQLite重现自动fallback/patch回退/原操作重放RED。
- [x] 17个写命令要求原版本/键/时间，create要求record-id；稀疏patch，移除旧overlay/tombstone/Markdown/JSONL写helper。
- [x] 接通稳定Task/Requirement basis，拒绝旧非规范字段；只读缓存清晰标明。
- [x] 相关完整CLI回归、原症状GREEN及源码收据。

### Task 3: 共享提交、规则、文件快照

Files: sop_cli/local_intents.py、commands/sync.py、rule.py、context.py、doctor.py、status.py及SDK/CLI专属测试。

Produces: submit_record上列接口，统一先冻结/入队、再可选flush，分别返回原event与真实queue/processing结果。

- [x] 缺原参数/未知结果/重复key/无旧文件写入真实SQLite RED。
- [x] 实现共享提交与SDK可选basis透传，显式文件expected_sha256。
- [x] watch只读快照与明确enqueue-plan，路径/UTF8/摘要/重放/部分结果验证。
- [x] 规则稳定提案应用与显式推送；退出旧sync compact/repair及旧manifest生产声明。
- [x] 真实work缓存入口退出overlay；有界观察明确来源/完整性/验收，单配置/同代查询。
- [x] 修复类型检查定位的浏览器资产表单：原版本/原SHA与独立key，审阅固定、未知重放、项目/会话隔离，保持当前主题和三语文案。
- [x] 相关回归、文档和未完成范围更新。

### Task 4: 集成、独立复核与提交

- [x] 真实Manager/SDK/CLI同scope验证17类原操作和预览/任务basis/文件冲突/原回执。
- [x] 完整Manager/SDKCLI、受影响Web/Go消费回归与类型/构建（按实际变更选择），OpenAPI及wheel契约核验。
- [x] 独立增量审查，保留原RED/修复及环境夹具差异，更新memory/完整目标清单。
- [x] 盘点散列保留重要源和唯一证据、精确清理、阶段全部本地commit、不push，完整目标active。
