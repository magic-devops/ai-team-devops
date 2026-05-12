# Web 管理后台

## 模块化结构（AI 按需修改，最小 token 开销）

```
web/
├── main.py              # 入口（注册路由，向后兼容接口）
├── index.html           # 前端 shell（加载 pages/ 模块）
├── routers/             # 后端路由模块（每个 ≤100 行）
│   ├── db.py            # 共享 LanceDB 工具
│   ├── requirements.py  # 需求 CRUD
│   ├── tasks.py         # 任务 CRUD
│   ├── issues.py        # 问题 CRUD
│   ├── agents.py        # Agent 定义/专家组
│   ├── skills.py        # 技能注册/管理
│   ├── mcp_mgr.py       # MCP Server 管理
│   ├── auth.py          # 账号认证
│   └── system.py        # 脚本/配置/记忆管理
└── pages/               # 前端页面模块（每个独立 JS 文件）
    ├── agents.js        # Agent 管理页面
    ├── skills.js        # 技能管理页面
    ├── mcp.js           # MCP 管理页面
    ├── system.js        # 系统管理页面（脚本/配置/记忆）
    └── auth.js          # 账号管理页面
```

## 启动

```bash
bash sop/tools/start-manager.sh
# 打开 http://localhost:8765
```

## AI 修改原则

- 修改某个功能时，只读取对应的路由文件（≤100 行）
- 新增页面时，在 pages/ 创建新 JS 文件，在 index.html 加一行 `<script>` 引用
- 新增 API 时，在 routers/ 创建新文件，在 main.py 加一行 `include_router`
- 不要修改 main.py 的核心逻辑，只在末尾追加

## 页面列表（16个）

| 页面 | 文件 | 功能 |
|------|------|------|
| 📊 总览 | index.html | Sprint 进度、告警 |
| 📈 分析 | index.html | 统计图表 |
| 📋 执行计划 | index.html | 任务 CRUD |
| 🔄 迭代进度 | index.html | Sprint 详情 |
| 🗄️ 知识库 | index.html | 语义搜索、CRUD |
| ✏️ 规范编辑 | index.html | 规范文件编辑 |
| 📋 需求 | index.html | 需求看板 |
| ⚙️ 任务 | index.html | 任务追踪 |
| 🐛 问题 | index.html | 问题管理 |
| 🏃 Sprint | index.html | 迭代管理 |
| 📖 规范 | index.html | 规范浏览 |
| 📐 规则库 | index.html | 规则管理 |
| 📡 日志 | index.html | Agent 日志 |
| 🤖 Agent | pages/agents.js | Agent/专家组管理 |
| ⚡ 技能 | pages/skills.js | 技能注册 |
| 🔌 MCP | pages/mcp.js | MCP Server 管理 |
| 🖥️ 系统 | pages/system.js | 脚本/配置/记忆 |
| 👤 账号 | pages/auth.js | 用户管理 |

## 模块化开发约定（AI 必须遵守）

### 文件大小上限

| 类型 | 上限 | 超限处理 |
|------|------|---------|
| 后端路由 `routers/*.py` | 100 行 | 按资源拆分新文件 |
| 前端页面 `pages/*.js` | 200 行 | 按功能拆分子组件 |
| 入口文件 `main.py` | 250 行 | 只保留注册逻辑 |
| 入口文件 `index.html` | 保持 shell | 组件全部移到 pages/ |

### 新增功能流程

```
1. 后端：在 routers/ 创建新文件（≤100行）
2. 后端：在 main.py 加一行 include_router
3. 前端：在 pages/ 创建新 .js 文件（≤200行）
4. 前端：在 index.html 加一行 <script src="pages/xxx.js">
5. 前端：在 AppV2 的 tabs/pages 中注册
```

### 修改功能流程

```
1. 只读取对应的单个路由文件或页面文件
2. 不需要读取 main.py 全文或 index.html 全文
3. Edit 增量修改，不 Write 全量重写
```
