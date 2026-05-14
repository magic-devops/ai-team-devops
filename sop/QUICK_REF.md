# 开发规约速查卡

> 单页速查，AI 智能体每次启动时读取此文件（约 2K tokens）。

## 我是谁？

读取 `memory/current_state.json` 确认当前角色和任务。

## 启动检查（30秒完成）

```bash
cat memory/current_state.json          # 当前状态
cat .ai-memory/rules/RULES.md          # 项目规则
```

## 核心规则（10条）

1. **最小化**：只写解决问题所需的最少代码
2. **状态外化**：进度写入 `memory/`，不依赖上下文记忆
3. **可追溯**：commit 格式 `type(scope): desc [T-id]`
4. **渐进验证**：每步完成后立即运行构建/测试
5. **上下文经济**：grep 定位后精确读取，不读整个文件；无依赖操作并行调用
6. **安全优先**：用户输入必须验证，禁止硬编码密钥
7. **诚实报告**：失败就报失败，不假装成功
8. **项目约定**：包名 `com.magic.*`，APP 默认 `Superpower`，新项目先读 `specs/PROJECT_CONVENTIONS.md`
9. **自我反思**：失败后 `<reflect>` 分析换思路，第 3 次失败上报；完成后输出置信度
10. **模块化**：单文件上限：规范文档 300 行、后端路由 100 行、前端页面 200 行、脚本 80 行；超限必须拆分

## 任务执行（标准流程）

```
TaskGet → 并行读相关文件 → <think>复杂决策</think> → 实现 → 构建验证 → 测试 → 置信度自评 → TaskUpdate(completed)
```

## 失败处理（Hermes 自修复）

```
失败 → <reflect>分析</reflect> → 换思路重试（最多3次）→ 第3次仍失败 → 上报
```

## 文件操作

```python
# 读文件：先 grep 定位，再精确读取
grep -n "functionName" src/file.ts  # 找行号
Read(file, offset=行号, limit=30)   # 精确读取

# 改文件：用 Edit（增量），不用 Write（全量）
Edit(file, old_string="...", new_string="...")
```

## Commit 格式

```
feat(scope): 描述 [T-id]
fix(scope): 描述 [T-id]
test(scope): 描述 [T-id]
```

## 上下文预算警戒

- 70%：停止读新文件，压缩历史
- 85%：持久化状态，准备交接
- 95%：停止新操作，创建交接包

## 角色对应文档

| 角色 | 读取文档 |
|------|---------|
| Orchestrator | `agents/ORCHESTRATOR.md` |
| Planner | `agents/PLANNER.md` + `agents/HERMES_AGENT.md#CoT` |
| Worker/Coder | `agents/WORKER.md` + `agents/HERMES_AGENT.md#自修复` |
| Reviewer | `agents/REVIEWER.md` + `quality/CODE_REVIEW.md` |
| Debugger | `workflow/ERROR_RECOVERY.md` + `agents/HERMES_AGENT.md#CoT` |

## 关键文件位置

```
memory/current_state.json          # 项目当前状态
.ai-memory/rules/RULES.md          # 项目规则库
quality/CODE_REVIEW.md             # 审查清单
workflow/ITERATION_CYCLE.md        # 迭代流程
agents/HANDOFF.md                  # 交接协议
specs/README.md                    # 开发规范体系入口（按需加载）
specs/PROJECT_CONVENTIONS.md      # ★ 项目约定（包名 com.magic.*，APP 默认 Superpower）
```

## 开发规范按需加载

| 任务类型 | 加载规范 |
|---------|---------|
| Web 前端（Vue3） | `specs/frontend/FRONTEND_SPEC.md` + `specs/frontend/VUE3_SPEC.md` |
| Web 前端（React） | `specs/frontend/FRONTEND_SPEC.md` + `specs/frontend/REACT_SPEC.md` |
| 微前端 | `specs/frontend/MICROFRONTEND_SPEC.md` |
| 移动端（Flutter） | `specs/mobile/FLUTTER_SPEC.md` |
| 移动端选型 | `specs/mobile/MOBILE_CROSSPLATFORM_SPEC.md` |
| 小程序 | `specs/miniprogram/MINIPROGRAM_SPEC.md` |
| 后端（Java） | `specs/backend/JAVA_SPEC.md` + `specs/api/API_RESPONSE_SPEC.md` |
| 微服务 | `specs/backend/MICROSERVICE_SPEC.md` |
| 数据库 | `specs/database/DATABASE_SPEC.md` |
| 数据库迁移 | `specs/database/MIGRATION_SPEC.md` |
| 安全相关 | `specs/security/SECURITY_SPEC.md` |
| 认证授权 | `specs/security/AUTH_SPEC.md` |
| E2E 测试 | `specs/testing/E2E_SPEC.md` |
| 代码审查 | `specs/quality/QUALITY_GATE_SPEC.md` |
| 架构决策 | `specs/architecture/ARCHITECTURE_DECISION.md` |
| AI 编码 | `specs/ai-collab/AI_CODING_SPEC.md` |
| 多 Agent 协同 | `specs/ai-collab/MULTI_AGENT_COLLAB_SPEC.md` |

## Token 节省策略（最小化开销）

```
读文件前：grep 定位行号 → 精确 offset/limit 读取（节省 80%）
修改文件：Edit（增量 diff）而非 Write（全量重写）
读规范：只加载当前任务相关规范，不全量加载
查历史：python sop/knowledge/lancedb_ops.py context "<任务>" 获取相关上下文
并行调用：无依赖的工具调用同时发出，不串行等待
```

## 知识库快速查询

```bash
# 任务开始前获取相关上下文（避免重复踩坑）
python sop/knowledge/lancedb_ops.py context "实现用户注册"

# 语义搜索历史任务
python sop/knowledge/lancedb_ops.py search tasks "JWT 认证"
```

## 消息通知（开发进度推送）

```bash
# 广播进度（须带有效 JWT 与 X-Project-Id；示例用 curl 多行头）
curl -sS -X POST "http://localhost:8765/api/v1/notify/broadcast?title=任务完成&content=T003已完成&level=success" \
  -H "Authorization: Bearer $SOP_TOKEN" \
  -H "X-Project-Id: $PROJECT_ID"
```

## API 版本

- **`/api/v1/*`** — Manager 业务 REST 唯一前缀（见 `apps/manager/sop_manager/main.py` 路由注册）
- **`/metrics`** — Prometheus 文本（根路径，不在 `/api/v1` 下）

## Web 管理后台（人机协同）

- **统一 Shell 管控**：`bash sop/tools/sop-ctl.sh help`（`--json`、`wait-health`、`self-check`、`commands`；init / backup / start-bg / repair --strict 等；见 **`docs/USER_MANUAL.md` §1.3**）
- 启动：`bash sop/tools/start-manager.sh`（可选 `--port 9000`、`--no-reload`、`--help`）；数据根目录由 **`PROJECT_PATH`** 与（已登录时）**`X-Project-Id` 解析出的项目路径** 决定。前端 **`API` 自动跟随当前页面 origin**；业务请求走 **`apiFetch`**（JWT + `X-Project-Id` + 超时）。顶栏有 **`GET /api/v1/health`** 延迟与 **`Ctrl+/` 开发者帮助**（含 OpenAPI / ReDoc 链接）。  
- **研发全流程**：人读 `GET /api/v1/dev-flow/summary` 与页面建议，再决定是否调用模型；勿让模型重复拉取全表。  
- **Vibe Coding**：会话/记忆外化在 `.ai-memory/vibe_*.json`；提示词用 **ID + 规范相对路径**，长文打开「规范文档 / 技术方案」页而非粘贴。  
- **Agent 编排**：开发工具与环境检查、AI 安装 v2、白名单受控安装；API 与路径见 **`docs/ORCHESTRATION_DEV_TOOLS.md`**。  
- 操作手册（人类）：仓库根 **`docs/USER_MANUAL.md`**（§4.5 编排）；开发与路由：**`apps/manager/README.md`**。

## 与架构文档同步

体系级说明见 **`ARCHITECTURE.md`**（含 Web、Vibe、dev-flow、静态挂载约定）。
