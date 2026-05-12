# AI Multi-Agent Development SOP System

> 面向 AI 智能体的完整开发规约体系，支持多智能体协作、进度追踪、记忆管理、质量控制。

## 目录结构

```
sop/
├── README.md                          # 本文件：系统入口与导航
├── QUICK_REF.md                       # ★ 速查卡（每次启动必读，~2K tokens）
├── core/                              # 核心规约
│   ├── PRINCIPLES.md                  # 开发原则（9条核心规则，含自我反思）
│   ├── ROLES.md                       # 智能体角色定义
│   ├── LIFECYCLE.md                   # 项目生命周期（INIT→RELEASE）
│   ├── CONTEXT_BUDGET.md              # 上下文预算管理
│   └── COST_CONTROL.md                # Token 成本控制与模型选择
├── agents/                            # 多智能体协作
│   ├── ORCHESTRATOR.md                # 编排者：主循环、调度、汇报
│   ├── PLANNER.md                     # 规划者：需求分析、任务拆解
│   ├── WORKER.md                      # 执行者：代码实现、验证
│   ├── REVIEWER.md                    # 审查者：质量门禁
│   ├── COORDINATOR.md                 # 协调协议：通信格式
│   ├── HANDOFF.md                     # 交接协议：上下文续接
│   ├── SCHEDULER.md                   # 并发调度器：任务分配算法
│   ├── CONCURRENCY.md                 # 并发冲突管理：锁、冲突解决
│   ├── CONCURRENT_BEST_PRACTICES.md   # 并发开发最佳实践
│   ├── SELF_EVOLUTION.md              # Agent 自进化：规则提取与学习
│   ├── KNOWLEDGE_DISTILL.md          # 知识蒸馏：经验提炼为规则
│   └── HERMES_AGENT.md               # ★ Hermes 能力：工具调用/CoT/自我反思
├── memory/                            # 记忆管理
│   ├── MEMORY_SYSTEM.md               # 记忆体系架构（三层）
│   ├── LANCEDB_SCHEMA.md              # LanceDB 向量库 Schema + CRUD
│   ├── STATE_MACHINE.md               # 状态机规范
│   └── CONTEXT_COMPRESSION.md        # 上下文压缩策略
├── workflow/                          # 开发流程
│   ├── ITERATION_CYCLE.md             # 迭代周期 SOP
│   ├── TASK_DECOMPOSITION.md          # 任务拆解规范
│   ├── PROGRESS_TRACKING.md           # 进度追踪规范
│   ├── ROLLBACK.md                    # 回滚与恢复规范
│   ├── CHANGE_MANAGEMENT.md           # 需求变更管理
│   └── ERROR_RECOVERY.md              # 错误恢复 SOP
├── quality/                           # 质量管理
│   ├── CODE_REVIEW.md                 # 代码审查规范（含清单）
│   ├── TESTING_SOP.md                 # 测试流程 SOP
│   ├── METRICS.md                     # 质量指标体系
│   └── EVALUATION.md                  # AI 输出四维评估框架
├── skills/                            # 技能库
│   ├── SKILL_REGISTRY.md              # 技能注册表（8个核心技能）
│   ├── PROMPT_PATTERNS.md             # Prompt 模式库（6种模式）
│   └── TOOL_USAGE.md                  # 工具使用规范
├── templates/                         # 模板库
│   └── TASK_TEMPLATE.md               # 任务/简报/问题报告/Sprint 模板
└── tools/                             # 工具集成
    ├── init-ai-project.sh             # ★ 项目快速初始化（生成所有工具配置）
    ├── start-manager.sh             # ★ 一键启动 Web 后台
    ├── health-check.sh                # 项目健康检查
    ├── snapshot.sh                    # LanceDB 记忆快照导出
    ├── sync-rules.sh                  # 同步规范到各工具配置
    ├── TOOL_INTEGRATION.md            # 多工具集成规范（opencode/Cursor/Trae/Qoder）
    ├── LANCEDB_SETUP.md               # LanceDB 配置指南
    ├── GIT_WORKFLOW.md                # Git 工作流规范
    ├── CI_CD.md                       # CI/CD 集成规范
    ├── MCP_INTEGRATION.md             # MCP 工具集成（Claude Code/Cursor）
    ├── AUTOMATION_TRIGGERS.md         # 自动化触发器（Git Hooks/CI/Cron）
    └── SCRIPTS.md                     # 持久化脚本集
dashboard/                             # ★ 项目管理 Web 后台（人机协同）
    ├── index.html                     # 前端（React，8个页面：总览/需求/任务/问题/Sprint/搜索/自定义/反思）
    ├── api.py                         # 后端 API（FastAPI + LanceDB，含创建/搜索/导出）
    └── README.md                      # 启动说明
custom/                                # ★ 自定义模块（人工输入，AI 自我进化）
    ├── specs/                         # 项目特定规范（覆盖通用规范）
    ├── examples/                      # 代码样例（java/frontend/sql）
    ├── design/                        # 设计规范（brand/components/layouts）
    ├── interaction/                   # 交互规范
    └── daily/                         # 日常输入（会议记录/用户反馈）
specs/
    └── database/TIMESTAMP_CONVENTION.md  # 时间字段命名约定（gmt_created/updated_at 决策）
```

## 快速入门

### 新项目初始化（一次性）

```bash
bash sop/tools/init-ai-project.sh <project-name>
```

### AI 智能体启动检查（每次）

```bash
# 1. 读取速查卡（必须，~2K tokens）
cat sop/QUICK_REF.md

# 2. 读取当前状态
cat memory/current_state.json

# 3. 读取项目规则
cat .ai-memory/rules/RULES.md
```

### 深度文档（按需读取）

| 场景 | 读取文档 |
|------|---------|
| 第一次了解体系 | `core/PRINCIPLES.md` → `core/ROLES.md` → `core/LIFECYCLE.md` |
| 开始新任务 | `workflow/ITERATION_CYCLE.md` |
| 拆解需求 | `workflow/TASK_DECOMPOSITION.md` |
| 并发开发 | `agents/SCHEDULER.md` + `agents/CONCURRENCY.md` |
| 代码审查 | `quality/CODE_REVIEW.md` |
| 遇到错误 | `workflow/ERROR_RECOVERY.md` + `agents/HERMES_AGENT.md#自修复` |
| 上下文不足 | `agents/HANDOFF.md` + `memory/CONTEXT_COMPRESSION.md` |
| 配置工具 | `tools/MCP_INTEGRATION.md` + `tools/AUTOMATION_TRIGGERS.md` |
| Hermes 工具调用/CoT/反思 | `agents/HERMES_AGENT.md` |
| Agent 自进化 | `agents/SELF_EVOLUTION.md` + `agents/HERMES_AGENT.md#反思驱动进化` |
| 查看项目进展（人工） | `dashboard/README.md` → 启动 Web 后台 |

## 核心设计理念

- **最小上下文原则**：每个智能体只加载当前任务所需的最小上下文
- **状态外化原则**：所有状态持久化到外部存储，不依赖上下文记忆
- **可追溯原则**：每个决策、每次变更均有记录可查
- **渐进式原则**：大任务拆解为可独立验证的小步骤
- **失败快速原则**：尽早发现问题，避免错误累积

## 版本

- SOP Version: 1.0.0
- Last Updated: 2026-05-12
- Compatible Models: Claude Opus 4.x, GPT-4o, Gemini 1.5 Pro+

## 技能、MCP、A2A 能力

### 技能体系（Skills）

技能是 Agent 可复用的原子能力单元，支持本地调用和 A2A 远程暴露：

```bash
# 查看技能清单
cat sop/skills/SKILLS_SPEC.md
```

### MCP Servers

`.claude/settings.json` 已内置 3 个 MCP Server：

| Server | 功能 |
|--------|------|
| `lancedb` | 语义搜索（semantic_search / get_task_context / add_rule） |
| `filesystem` | 文件系统操作 |
| `git` | Git 操作 |

### A2A 协议

支持 Google A2A 标准，Agent 间可互相发现和委托任务：

```bash
# 启动 Coder-Backend Agent
python sop/integrations/agents/coder_backend.py --port 8001

# 查看 Agent Card
curl http://localhost:8001/.well-known/agent.json
```

### 知识库（LanceDB）

```bash
# 索引 custom/ 目录
python sop/knowledge/lancedb_ops.py index-custom

# 获取任务上下文（相似任务+规则+知识）
python sop/knowledge/lancedb_ops.py context "实现支付功能"

# 语义搜索
python sop/knowledge/lancedb_ops.py search tasks "JWT 认证"
```

### 一键安装所有集成

```bash
bash sop/tools/install-integrations.sh
```
