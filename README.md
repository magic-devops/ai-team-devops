<div align="center">

# ai-team-devops

**AI 多 Agent 开发规约体系** — 让 AI 像资深工程师团队一样协作开发，持续自我进化

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Version](https://img.shields.io/badge/version-1.1.0-green.svg)](ROADMAP.md)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)
[![Tools](https://img.shields.io/badge/tools-Codex%20CLI%20%7C%20Claude%20Code%20%7C%20opencode%20%7C%20Cursor-orange.svg)](sop/tools/TOOL_INTEGRATION.md)

[快速开始](#快速开始) · [功能全景](#功能全景) · [使用手册](docs/USER_MANUAL.md) · [文档索引](docs/README.md) · [教程](TUTORIAL.md) · [架构](ARCHITECTURE.md) · [路线图](ROADMAP.md) · [参与贡献](CONTRIBUTING.md)

</div>

---

## 项目目标

AI 编码工具（Codex CLI、Claude Code、Cursor、opencode 等）正在改变软件开发方式，但面临三个核心挑战：

| 挑战 | ai-team-devops 的解法 |
|------|----------------------|
| AI 代码质量不稳定 | 规范驱动 + 质量门禁 + Hermes 自我反思修复 |
| 多 Agent 协作混乱 | 状态外化（LanceDB）+ A2A 协议 + 结构化通信 |
| AI 不会从错误中学习 | 规则自动提取 + 知识蒸馏 + 自进化循环 |

**目标**：提供一套开箱即用的 AI 开发规约体系，让任何团队都能快速建立高质量的 AI 辅助开发流程。

---

## 功能全景

### 🤖 多 Agent 协作
- **角色分工**：Orchestrator / Planner / Coder / Reviewer / Tester / Debugger
- **并行开发**：前后端 API 契约先行，多 Agent 并行实现
- **A2A 协议**：基于 Google A2A 标准，Agent 间互相发现和委托任务
- **Hermes 增强**：结构化工具调用、链式推理（CoT）、自我反思修复（最多 3 次重试）

### 🧠 智能记忆（LanceDB）
- **语义搜索**：相似历史任务、相关规则、知识库文档
- **自动上下文**：任务开始前自动获取相关历史经验
- **规则库**：从错误中自动提取规则，置信度驱动生命周期管理
- **知识索引**：`custom/` 目录文档自动索引，AI 可语义检索

### 📋 完整规范库
| 技术栈 | 规范文件 |
|--------|---------|
| Java/Spring Boot | `sop/specs/backend/JAVA_SPEC.md` |
| 前端（Vue3/React） | `sop/specs/frontend/` |
| 数据库（MySQL） | `sop/specs/database/` |
| 安全（OWASP） | `sop/specs/security/` |
| CI/CD | `sop/specs/cicd/CICD_SPEC.md` |
| 测试 | `sop/specs/testing/` |
| 多 Agent | `sop/specs/agents-collab/` |

### 🖥️ Web 管理后台
- **研发全流程**：`GET /api/dev-flow/summary` 聚合指标 + 阶段导航 + 低 Token 提示模板（[使用手册](docs/USER_MANUAL.md)）
- **鉴权与项目作用域**：JWT + 顶栏 **`X-Project-Id`**；控制台统一 **`apiFetch`**；SaaS 下非法项目返回 403/404（见 `docs/USER_MANUAL.md` §1.2）
- **Vibe Coding**：会话/记忆/附件、多模态 LLM、Markdown·代码·HTML 预览、项目目录只读浏览
- 需求看板、执行计划、迭代与 Sprint、问题中心、全局搜索、数据导出
- 技术方案管理、知识库（含文档抽取 / AI 润色）、规范与规则库
- Agent / 专家组 / 技能 / MCP / 模型 / **编排（开发工具目录、本机环境子页、AI 安装与受控一键安装）**、Docker 环境、CLI 配置、消息通知

### 🔧 多工具支持
一次初始化，自动生成所有工具配置：

```bash
bash sop/tools/init-ai-project.sh my-app
# 生成：AGENTS.md / .codex/config.toml / .codex/hooks.json / CLAUDE.md / opencode.json / .cursorrules / .windsurfrules / .trae/rules.md
```

支持：Codex CLI · Claude Code · opencode · Cursor · Trae · Qoder · Windsurf

### 🎛️ 统一 AI 能力控制平面
- **统一能力注册**：`.ai-memory/ai_capabilities.json` 描述上下文加载、工具守卫、权限决策、审计、状态持久化等标准能力
- **统一 Hook 引擎**：`sop/tools/sop_ai_hook.py` 承载策略，各工具只做 adapter 映射
- **统一调度优化**：Web / Vibe / Agent 编排 / MCP / A2A 共享状态、规则、知识和质量信号

### 🔌 MCP & 技能体系
- **MCP Server**：LanceDB 语义搜索直接暴露为 MCP 工具
- **自定义命令 / Skills**：`/plan` `/review` `/test` `/commit` `/debug` `/standup` `/evolve`
- **Hooks**：Codex/Claude 工具调用前安全检查、权限请求拦截、调用后状态更新、会话结束快照

---

## 快速开始

### 前置条件
- Git · Python **3.10+**（Web 与集成脚本推荐；见 `install-integrations.sh`）· 任意 AI 编码工具

### 5 分钟上手

```bash
# 1. 克隆
git clone https://github.com/magic-devops/ai-team-devops.git
cd ai-team-devops

# 2. 安装依赖（FastAPI / LanceDB / 可选 PDF 等，推荐虚拟环境）
bash sop/tools/install-integrations.sh

# 3. 初始化你的项目
bash sop/tools/init-ai-project.sh my-app

# 4. 启动 Web 管理后台（默认 PROJECT_PATH=当前目录）
bash sop/tools/start-manager.sh
# 打开 http://localhost:8765 — 详见 docs/USER_MANUAL.md 与 sop/web/README.md

# 5. 健康检查
bash sop/tools/health-check.sh
```

**脚本完整清单**：[sop/tools/SCRIPTS.md](sop/tools/SCRIPTS.md)。若需重置或创建管理员账号：`python3 sop/tools/reset-admin.py`（见脚本说明）。**CI/本地脚本调 API**：`MANAGER_SOP_TOKEN`（登录 JWT）+ `PROJECT_ID`（`X-Project-Id`），见 `sop/tools/manager_client.py`。

### 在 Claude Code 中使用

```bash
claude  # 自动读取 CLAUDE.md 和 .claude/settings.json
```

可用命令：`/plan` · `/review` · `/test` · `/commit` · `/debug` · `/standup` · `/evolve`

### 在 Codex CLI 中使用

```bash
npm install -g @openai/codex
codex  # 自动读取 AGENTS.md、.codex/config.toml 和 .codex/hooks.json
```

Codex hooks 首次出现时需要在 Codex 界面中审查并信任。项目默认 hook 只做 sop 上下文注入、危险命令拦截、活动审计和 `memory/current_state.json` 更新时间同步。

### 在 opencode 中使用

```bash
opencode  # 自动读取 opencode.json
```

---

## 项目结构

```
ai-team-devops/
├── sop/                       # 核心规约体系
│   ├── QUICK_REF.md           # ★ AI 启动必读速查卡（~2K tokens）
│   ├── agents/                # Agent 规范（含 Hermes/A2A）
│   ├── specs/                 # 开发规范（按技术栈）
│   ├── custom/                # 自定义模块（人工输入，AI 自我进化）
│   ├── knowledge/             # LanceDB 操作库
│   ├── integrations/          # 外部工具集成（MCP/A2A）
│   ├── web/                   # Web 管理后台
│   └── tools/                 # 工具脚本
├── .claude/                   # Claude Code 配置
│   ├── commands/              # 自定义命令
│   └── hooks/                 # 自动化 hooks
├── .codex/                    # Codex CLI 配置
│   ├── config.toml            # 模型 / 沙箱 / approval / feature flags
│   ├── hooks.json             # SessionStart / PreToolUse / PermissionRequest / PostToolUse / Stop
│   └── hooks/                 # sop hook 脚本
├── ARCHITECTURE.md            # 系统架构设计
├── docs/                      # 人类可读文档索引与使用手册
│   ├── README.md
│   └── USER_MANUAL.md         # Web 后台操作说明
├── TUTORIAL.md                # 详细使用教程
├── ROADMAP.md                 # 路线图
├── CONTRIBUTING.md            # 贡献指南
└── LICENSE                    # MIT 协议
```

---

## 使用手册

| 文档 | 读者 | 内容 |
|------|------|------|
| [docs/USER_MANUAL.md](docs/USER_MANUAL.md) | 使用 Web 后台的同事 | 启动、菜单、研发流、Vibe、常见问题 |
| [TUTORIAL.md](TUTORIAL.md) | 全员 | 初始化、日常工作流、多 Agent、Web、自定义模块、`/evolve`、多工具 |
| [sop/web/README.md](sop/web/README.md) | 维护 Web 的开发者 | 路由、页面模块、`main.py` 约定、环境变量 |
| [sop/tools/SCRIPTS.md](sop/tools/SCRIPTS.md) | 运维 / 集成 | `sop/tools` 下 Shell、Python、配置与规范文档索引 |

详细教程见 [TUTORIAL.md](TUTORIAL.md)，包含：项目初始化与配置、日常开发工作流、多 Agent 协作、Web 后台、自定义模块、自我进化、多工具切换与状态共享。

---

## 未来目标

见 [ROADMAP.md](ROADMAP.md)，近期重点：
- VS Code 插件（规范快速查阅）
- GitHub Actions 工作流模板
- 规范版本管理与 diff 对比
- 跨团队规范共享市场

---

## 参与贡献

**我们需要你！** 无论是修复文档错误、改进规范、贡献代码，还是分享使用经验，都非常欢迎。

```bash
# Fork → 修改 → PR
git checkout -b feat/improve-java-spec
git commit -m "docs(java-spec): 增加事务管理最佳实践"
```

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

- 💬 [Discussions](https://github.com/magic-devops/ai-team-devops/discussions) — 想法交流
- 🐛 [Issues](https://github.com/magic-devops/ai-team-devops/issues) — 问题反馈
- ⭐ Star 本项目，帮助更多开发者发现它！

---

## 作者

**superhero**
- 📧 Email: [zyc2012518@gmail.com](mailto:zyc2012518@gmail.com)
- 💬 微信: super_hero_88
- 🐙 GitHub: [magic-devops](https://github.com/magic-devops)

---

## 参考项目

- [obra/superpowers](https://github.com/obra/superpowers) — Claude Code hooks/commands 增强
- [sst/opencode](https://github.com/sst/opencode) — 多模型 AI 编码工具
- [google/A2A](https://github.com/google/A2A) — Agent-to-Agent 协议

## 许可证

[MIT License](LICENSE) © 2026 superhero (zyc2012518@gmail.com)
