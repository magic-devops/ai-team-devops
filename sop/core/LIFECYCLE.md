# 项目生命周期

## 阶段定义

```
INIT → PLANNING → DEVELOPMENT → REVIEW → TESTING → RELEASE → MAINTENANCE
  ↑                                                               │
  └───────────────────── ITERATION ──────────────────────────────┘
```

## 各阶段规范

### INIT（初始化）

**触发条件**：新项目或新功能启动

**必做事项**：
1. 创建项目记忆库（LanceDB collection）
2. 读取/创建 `CLAUDE.md` 或项目规范
3. 初始化任务树（TaskCreate）
4. 确认技术栈和约束条件
5. 记录初始状态到 `memory/project_init.json`

**输出物**：
- `memory/project_init.json`：项目基本信息
- 初始任务树

**退出条件**：任务树创建完成，技术方案确认

---

### PLANNING（规划）

**触发条件**：INIT 完成，或新迭代开始

**必做事项**：
1. Planner 角色分析需求
2. 输出任务分解（TASK_DECOMPOSITION.md 规范）
3. 识别风险和依赖
4. 估算工作量
5. 用户/负责人确认方案

**输出物**：
- 任务列表（含优先级、依赖、估算）
- 技术方案文档（存入记忆系统）
- 风险登记册

**退出条件**：用户确认方案，任务已分配

---

### DEVELOPMENT（开发）

**触发条件**：PLANNING 完成

**迭代单元**：单个任务（Task）

**每个任务的执行流程**：
```
TaskGet → 读相关代码 → 实现 → 构建验证 → 测试 → TaskUpdate(completed)
```

**状态检查点**（每完成一个任务）：
- [ ] 代码构建通过
- [ ] 相关测试通过
- [ ] 无新增安全漏洞
- [ ] 任务状态已更新
- [ ] 变更已记录到记忆系统

**阻塞处理**：
- 阻塞 > 15 分钟 → 上报 Orchestrator
- 阻塞 > 1 小时 → 创建 BLOCKED 任务，切换到其他任务

---

### REVIEW（审查）

**触发条件**：开发任务完成，准备合并

**审查者**：Reviewer 角色（可以是独立智能体实例）

**审查流程**：
1. 读取 diff（`git diff main...HEAD`）
2. 对照 `quality/CODE_REVIEW.md` 逐项检查
3. 输出审查结论：PASS / NEEDS_CHANGES
4. NEEDS_CHANGES 时附具体修改意见

**退出条件**：Reviewer 输出 PASS

---

### TESTING（测试）

**触发条件**：REVIEW 通过

**测试层次**：
1. 单元测试（自动）
2. 集成测试（自动）
3. 端到端测试（关键路径）
4. 回归测试（已有功能）

**退出条件**：所有测试通过，覆盖率达标

---

### RELEASE（发布）

**触发条件**：TESTING 通过

**必做事项**：
1. 更新 CHANGELOG
2. 打版本标签
3. 更新记忆系统中的版本信息
4. 通知相关方

**退出条件**：代码合并到主分支，版本标签创建

---

### MAINTENANCE（维护）

**触发条件**：RELEASE 完成，或线上问题

**Bug 修复流程**：
```
问题报告 → 复现 → 根因分析 → 修复 → 测试 → 发布 → 事后复盘
```

**事后复盘必须记录**：
- 根因
- 影响范围
- 修复方案
- 预防措施
- 存入 `memory/incidents/`

## 阶段状态持久化

每次阶段切换，写入记忆系统：
```json
{
  "project_id": "...",
  "phase": "DEVELOPMENT",
  "entered_at": "2026-05-12T10:00:00Z",
  "context": {
    "current_sprint": "sprint-3",
    "completed_tasks": ["T001", "T002"],
    "pending_tasks": ["T003", "T004"],
    "blockers": []
  }
}
```
