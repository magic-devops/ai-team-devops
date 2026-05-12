# 回滚与恢复规范

## 回滚层次

```
代码回滚（Git）
    ↓
数据库回滚（Migration）
    ↓
状态回滚（LanceDB + 文件系统）
    ↓
配置回滚（环境变量/配置文件）
```

## 代码回滚 SOP

### 场景 1：回滚单个提交
```bash
# 查看提交历史
git log --oneline -10

# 创建回滚提交（安全，保留历史）
git revert {commit_hash}

# 禁止：git reset --hard（会丢失历史）
```

### 场景 2：回滚到某个版本
```bash
# 创建新分支保存当前状态
git checkout -b backup/before-rollback

# 回到目标版本（创建新提交）
git revert {bad_commit}..HEAD
```

### 场景 3：回滚整个功能分支
```bash
# 关闭 PR，不合并
# 在主分支上 revert merge commit
git revert -m 1 {merge_commit_hash}
```

## 数据库回滚 SOP

### 前提条件
- 每个迁移必须有对应的 down 迁移
- 迁移文件命名：`{timestamp}_{description}.sql`

### 回滚流程
```bash
# 查看当前迁移状态
migrate status

# 回滚最近一次迁移
migrate down 1

# 回滚到指定版本
migrate down --to {version}
```

### 数据迁移回滚注意事项
- 删除列的迁移：down 迁移只能恢复列结构，不能恢复数据
- 数据转换迁移：必须在迁移前备份数据
- 高风险迁移：先在 staging 环境验证 down 迁移

## 状态回滚 SOP

### LanceDB 状态回滚
```python
def rollback_to_snapshot(snapshot_date: str):
    # 从快照文件恢复
    snapshot = load_json(f".ai-memory/snapshots/{snapshot_date}.json")
    
    db = lancedb.connect(".ai-memory/lancedb")
    
    for collection, records in snapshot.items():
        table = db.open_table(collection)
        # 删除快照日期之后的记录
        table.delete(f"created_at > '{snapshot_date}'")
```

### 任务状态回滚
```python
def rollback_task(task_id: str):
    db = lancedb.connect(".ai-memory/lancedb")
    db.open_table("tasks").update(
        where=f"id = '{task_id}'",
        values={"status": "pending", "completed_at": None}
    )
```

## 快照策略

### 自动快照时机
- 每个 Sprint 开始时
- 每次 Release 前
- 重大重构前

### 快照格式
```python
def create_snapshot(project_id: str):
    db = lancedb.connect(".ai-memory/lancedb")
    snapshot = {}
    
    for collection in ["requirements", "tasks", "decisions"]:
        table = db.open_table(collection)
        snapshot[collection] = table.search().where(
            f"project_id = '{project_id}'"
        ).to_list()
    
    date_str = datetime.now().strftime("%Y%m%d_%H%M%S")
    write_json(f".ai-memory/snapshots/{date_str}.json", snapshot)
    return date_str
```

## 回滚决策树

```
发现问题
    │
    ▼
问题影响范围？
    ├── 仅代码逻辑 → git revert
    ├── 代码 + 数据库 → git revert + migrate down
    ├── 代码 + 状态 → git revert + 状态回滚
    └── 全部 → 按顺序：状态 → 数据库 → 代码
```

## 回滚后必做

1. 验证回滚后系统正常运行
2. 记录回滚事件到 LanceDB incidents
3. 分析根因，创建修复任务
4. 更新 `memory/current_state.json`

## Git 提交规范（支持可追溯性）

```
格式：{type}({scope}): {description} [{task-id}]

type:
  feat     新功能
  fix      Bug 修复
  refactor 重构（不改变功能）
  test     测试
  chore    构建/工具/依赖
  revert   回滚

示例：
  feat(auth): 实现 JWT token 生成 [T002]
  fix(email): 修复邮件发送失败时未记录错误 [T007]
  revert: 回滚 T005 邮件服务实现（SMTP 配置问题）
```
