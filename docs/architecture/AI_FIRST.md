# AI-First 设计手册

> 让"AI 改 / AI 用"是默认体验，而不是事后兼容。

与 **v4 平台工程视图**（隔离、记忆、CLI、同步、Epic）对齐说明见 [UPGRADE_v4_ENGINEERING.md](UPGRADE_v4_ENGINEERING.md)。

## 一、AI 修改友好的代码结构

### 1. 文件大小红线

| 类型 | 上限 | 强制方式 |
|------|------|---------|
| Python 文件 | 500 行 | `ruff` + CI |
| Go 文件 | 400 行 | `golangci-lint` 自定 |
| TS/JS 组件 | 300 行 | `eslint-plugin-max-lines` |
| 函数 | 60 行 | `mccabe` 复杂度 ≤ 12 |

### 2. 每个文件顶部 `@ai_safe_edit` 注释

引导 AI 知道：
- 这个模块的职责
- 哪些是稳定 API，哪些可改
- 改动会影响哪些其它模块
- 跨域调用边界
- 测试在哪
- 行数预算

### 3. 强类型 + Schema-First

- 后端：Pydantic 全覆盖 + 严格模式
- 前端：TypeScript 严格模式 + 从 openapi.yaml 生成类型
- AI 改接口先改 schema，编译器/类型检查抓错

### 4. 测试金字塔

- 每个 domain 必有 `tests/`：unit（service）+ integration（router）
- AI 改代码 → 跑测试 → 失败自动 reflect 重试
- 关键路径快照测试

## 二、AI 用起来友好

### 1. 入口文档

每个项目根 `AGENTS.md` / `CLAUDE.md` 必含：
- 启动检查清单（读 memory/current_state.json、规则库）
- 技术栈 + 构建命令
- 模块入口 + 边界
- 失败重试策略 + 置信度上报要求
- 危险操作清单

### 2. 全套 AI 上下文

```
.ai-memory/
├── rules/RULES.md           ← 自进化规则库
├── ai_capabilities.json     ← 统一能力注册表
├── activity.log             ← Hook 活动审计
└── snapshots/               ← 会话快照
memory/
├── current_state.json       ← 当前状态
├── decisions/               ← ADR 决策记录
├── incidents/               ← 问题事件
└── sprints/                 ← Sprint 记录
```

### 3. 多工具一次配置

`sop init` 一键写入：
- `AGENTS.md`（Codex / 通用）
- `CLAUDE.md` + `.claude/settings.json` + `.claude/commands/` + `.claude/mcp.json`
- `.codex/config.toml` + `.codex/hooks.json` + `.codex/mcp.json`
- `opencode.json`
- `.cursorrules` + `.cursor/mcp.json`
- `.windsurfrules` + `.trae/rules.md` + `.qoder/context.md`

每个工具都能通过 MCP 调本地 sop-agentd 暴露的能力。

### 4. MCP 工具目录（项目侧自动拥有）

| MCP server | 用途 |
|-----------|------|
| `sop.lancedb` / `sop.qdrant` | 语义搜索（任务/规则/知识/反思） |
| `sop.knowledge` | 知识库读写、文档抽取 |
| `sop.tasks` | 拉取/更新任务（透传 Manager） |
| `sop.files` | 项目目录只读浏览（受 path_config 限制） |
| `sop.specs` | 按需加载规约片段（避免全量注入） |
| `sop.rules` | 规则查询、规则提案 |
| `sop.llm` | 透传 LLM Gateway（一处配置全工具可用） |
| `sop.sandbox` | 受控代码执行 |

### 5. AI Capability Control Plane

`ai-sop-ops/AI_CAPABILITY_CONTROL_PLANE.md` 规约：
- 工具适配统一调 `sop_ai_hook.py`（已存在）
- 决策点：上下文加载、工具守卫、权限请求、审计、状态持久化
- 工具新增 = 写 adapter，不动核心策略

## 三、AI 干活效率提升

### 1. Manager 内嵌 Copilot（M11）

- 全局 ⌘K：自然语言 → 跳转/搜索/执行
- 表格列支持 NLQ 过滤："本周 P0 且置信度 < 0.7"
- 新建需求 → AI 自动补充优先级/估点/标签
- Sprint 自动生成燃尽分析 + 周报
- 异常自动报警（速率掉档、积压、置信度异常）

### 2. 智能任务分配

- 根据 Agent 历史完成率 / 置信度 / 技能匹配自动派单
- 支持人工 override + 学习人工选择

### 3. 反思蒸馏

- 每周扫描 `agent_reflections`
- 候选规则提案（GPT 抽取）→ 人工 1 click 入库
- 规则置信度衰减（30 天不命中 → 候选废弃）

### 4. 提示工程基础设施

- `apps/manager/prompts/*.md`：每个 system prompt 一个文件，frontmatter 含 model/temperature/版本
- `sop eval` 命令：跑测试集对比不同 prompt/model 的成功率
- A/B 实验框架：灰度 20% 流量到新提示

## 四、AI 安全护栏

### 1. 危险命令拦截

`sop_ai_hook.py` 黑名单：
- `rm -rf /`, `git reset --hard`, `git clean -fdx`, `chmod -R 777`
- `curl ... | sh`, `wget ... | bash`
- 可由 Manager 下发动态策略覆盖

### 2. 权限分层

- 低风险（读、改 sop/custom/、改 .ai-memory/）→ 默认允许
- 中风险（改源码、git commit）→ approval-on-request
- 高风险（推远端、改 .codex/config.toml）→ 必须人工

### 3. LLM 输出审核

- 调用 Anthropic Constitutional / OpenAI Moderation API（可选）
- 敏感信息检测（密钥/PII 模式）
- 不可信内容标注

### 4. 沙箱

代码执行三档：
1. 用户机器（带黑名单）— 默认
2. Docker 容器 — `sandbox.mode=docker`
3. E2B/Daytona 云端 microVM — `sandbox.mode=cloud`

## 五、AI 学习闭环

```
执行任务
   ↓
<reflect> 记录成败 + 置信度
   ↓
identify pattern（连续 2 次相同问题）
   ↓
propose rule → 人工/自动审核
   ↓
write .ai-memory/rules/ + Manager 下发
   ↓
下次执行自动应用
   ↓
（按月）反思蒸馏 → 跨项目规则市场
```
