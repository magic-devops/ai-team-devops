# 系统架构设计

> sop — AI 多 Agent 开发规约体系

## 设计理念

**三个核心问题**：
1. AI 如何在没有人工干预的情况下持续高质量地开发？
2. 多个 AI Agent 如何协作而不互相干扰？
3. AI 如何从错误中学习，越用越好？

**解决方案**：状态外化 + 规范驱动 + 自我进化

```
┌─────────────────────────────────────────────────────────────────┐
│                    sop 架构总览                            │
│                                                                 │
│  人工输入层    ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  (Human)      │ 需求描述  │  │ 优先级调整│  │ 问题反馈  │        │
│               └────┬─────┘  └────┬─────┘  └────┬─────┘        │
│                    │              │              │              │
│  编排层        ┌───▼──────────────▼──────────────▼───┐          │
│  (Orchestrator)│         Orchestrator Agent          │          │
│               │   任务分配 · 进度追踪 · 用户沟通       │          │
│               └───┬──────────┬──────────┬───────────┘          │
│                   │          │          │                       │
│  执行层        ┌──▼──┐   ┌──▼──┐   ┌──▼──┐                    │
│  (Workers)    │Planner│  │Coder│  │Reviewer│                   │
│               │规划者 │  │编码者│  │审查者  │                   │
│               └──┬──┘   └──┬──┘   └──┬──┘                    │
│                  │          │          │                        │
│  记忆层        ┌──▼──────────▼──────────▼───┐                  │
│  (Memory)     │         LanceDB              │                  │
│               │  需求·任务·问题·反思·规则      │                  │
│               └──────────────────────────────┘                 │
│                                                                 │
│  规范层        specs/ · custom/ · .ai-memory/rules/             │
│  (Specs)                                                        │
│                                                                 │
│  工具层        .claude/ · opencode.json · web/            │
│  (Tools)                                                        │
└─────────────────────────────────────────────────────────────────┘
```

## 核心模块

### 1. 规范体系（specs/）

```
specs/
├── PROJECT_CONVENTIONS.md   # 包名 com.magic.*，APP 默认 Superpower
├── backend/JAVA_SPEC.md     # Java/Spring Boot 规范
├── database/                # 数据库规范（含时间字段约定）
├── security/                # 安全规范（OWASP Top 10）
├── frontend/                # 前端规范（Vue3/React）
├── quality/                 # 质量门禁
└── ai-collab/               # AI 协作规范
```

**设计原则**：按需加载，不全量注入。每个规范文件独立，AI 根据任务类型选择加载。

### 2. Agent 体系（agents/）

```
Orchestrator ──► Planner ──► Worker(s) ──► Reviewer
     │                           │
     │◄──── 完成报告 ─────────────┘
     │
     ▼
  用户汇报
```

**关键设计**：
- 每个 Agent 无状态，状态全部外化到 LanceDB
- Hermes 能力：并行工具调用 + CoT 推理 + 自我反思
- 置信度驱动：< 0.70 自动触发 Reviewer

### 3. 记忆体系（memory/ + .ai-memory/）

```
工作记忆（上下文内）
    ↓ 持久化
项目记忆（LanceDB）
  ├── requirements  需求向量索引
  ├── tasks         任务状态
  ├── sprints       迭代记录
  ├── issues        问题记录
  └── agent_reflections  反思记录
    ↓ 蒸馏
长期记忆（.ai-memory/rules/）
  └── RULES.md      规则库（跨会话持久）
```

### 4. 自进化循环

```
执行任务
    ↓
<reflect> 分析结果
    ↓
识别可泛化模式（连续2次相同问题）
    ↓
提取规则 → 写入 .ai-memory/rules/
    ↓
下次执行时自动应用
```

### 5. 工具集成层

```
Claude Code  → CLAUDE.md + .claude/settings.json + .claude/commands/
opencode     → opencode.json
Cursor       → .cursorrules
Trae/Qoder   → .trae/rules.md / .qoder/context.md
Windsurf     → .windsurfrules

共享状态：memory/ + .ai-memory/（所有工具共用）
```

### 6. Web 后台（web/）

```
前端（React SPA）
    ↓ REST API
后端（FastAPI）
    ↓ 读写
LanceDB（.ai-memory/lancedb/）
    +
memory/current_state.json
```

**人工介入点**：调整需求优先级、解除任务阻塞、关闭问题、新建 Sprint

## 数据流

```
用户需求
    ↓
Orchestrator 分解为任务树（写入 LanceDB tasks）
    ↓
Worker 执行（读取规范 → 实现 → 验证 → 置信度自评）
    ↓
Reviewer 审查（置信度 < 0.85 时触发）
    ↓
完成 → 更新 LanceDB + current_state.json
    ↓
/evolve → 提取规则 → 更新 RULES.md
```

## 目录结构

```
ai-team-devops/
├── LICENSE                    # MIT 开源协议
├── README.md                  # 项目说明（本文件）
├── ARCHITECTURE.md            # 架构设计（本文件）
├── CLAUDE.md.template         # CLAUDE.md 模板
├── TUTORIAL.md                # 详细使用教程
├── .claude/                   # Claude Code 配置
│   ├── settings.json          # 权限 + hooks 配置
│   ├── hooks/                 # 自动化 hooks
│   │   ├── pre-tool-call.sh   # 工具调用前安全检查
│   │   ├── post-tool-call.sh  # 工具调用后状态更新
│   │   └── stop.sh            # 会话结束时快照
│   └── commands/              # 自定义命令（/plan /review /test 等）
├── sop/                # 核心规约体系
│   ├── QUICK_REF.md           # ★ 速查卡（每次启动必读）
│   ├── agents/                # Agent 规范
│   ├── core/                  # 核心原则
│   ├── memory/                # 记忆管理
│   ├── workflow/              # 开发流程
│   ├── quality/               # 质量管理
│   ├── skills/                # 技能库
│   ├── specs/                 # 开发规范（按技术栈）
│   ├── custom/                # 自定义模块（人工输入）
│   ├── templates/             # 模板库
│   ├── tools/                 # 工具脚本
│   └── web/             # Web 管理后台
└── ai-docs/                   # 参考文档（原始规范文档）
```

## 技术选型

| 组件 | 技术 | 理由 |
|------|------|------|
| 向量记忆 | LanceDB | 本地运行，零配置，原生向量搜索 |
| Web 后台后端 | FastAPI | 轻量，自动生成 OpenAPI 文档 |
| Web 后台前端 | React（单文件） | 无需构建，直接打开 |
| 规范格式 | Markdown | AI 可直接读取，人类友好 |
| 状态格式 | JSON | 通用，所有工具可读 |
| 脚本 | Bash + Python | 无额外依赖 |
